/**
 * Reading emphasis for material text — makes study text easier to scan without
 * turning the page into a wall of bold.
 *
 * What gets emphasis (in priority order):
 *   **words**            → bold (staff or the AI rewrite marked them) — always kept
 *   the material's terms → bold + tinted (terms from its Key term / Definition blocks)
 *   case names           → tinted italic: Donoghue v Stevenson, Ojukwu v. Military Governor of Lagos State
 *   statutes             → bold: Evidence Act 2011, Legal Practitioners Act
 *   references           → bold: Section 36, Article 5(2), Rule 14, Order 3 r. 2, s. 12
 *   Latin / terms of art → italic: ejusdem generis, locus standi, ratio decidendi
 *   money, %, units      → bold: ₦5,000, 40%, 25 km, 12 marks, 14 days
 *   years                → bold: 1999 (outside citations)
 *   ACRONYMS             → bold, first time per block: RPC, NBA, CFRN
 *
 * What is deliberately left plain:
 *   - law-report citations — shown muted: (2004) 12 NWLR (Pt. 887) 1, [1932] AC 562
 *   - SHOUTED text (headings, affidavit forms in capitals) — no acronym bolding inside
 *   - ordinary capitalised words (THE, AND, COURT…), Roman numerals, list numbers,
 *     single-digit bare numbers
 *   - repeats of the same thing within a block (first mention only)
 *   - anything past a density cap (~1 emphasis per 8 words; lowest priority dropped first)
 *
 * Plain text in, React nodes out — never HTML, so nothing can be injected.
 */
import {createContext, Fragment, useContext, useMemo, type ReactNode} from 'react';
import type {MaterialBlock} from './types';

/** Key terms of the material being read (provided once per reader). */
export const TermsContext = createContext<string[]>([]);

const REFERENCE = String.raw`(?:Sections?|Articles?|Chapters?|Parts?|Rules?|Orders?|Regulations?|Schedules?|Clauses?|Paragraphs?|Steps?|Units?|Tables?|Figures?|Fig\.|Eqn\.|Equation|ss?\.|art\.|[OR]r?\.\s?(?=\d))\s?\d+[A-Za-z]?(?:\s?\(\d+[a-z]?\))*(?:\s?\([a-z]{1,4}\))*(?:\s(?:r(?:ule)?\.?|sub-?rule)\s?\d+)?`;
/** Law-report citations: (2004) 12 NWLR (Pt. 887) 1 · [1932] AC 562 · (1990) 1 SCNJ 1 at 12 · 2019 LPELR-46934(SC) */
const CITATION = String.raw`(?:[\(\[]\d{4}[\)\]]\s?(?:\d{1,3}\s)?[A-Z][A-Za-z.&]{1,10}(?:\s[A-Z][A-Za-z.]{1,6})?\s?(?:\(Pt\.?\s?\d+\)\s?)?\d+(?:\s?(?:at|@)\s?\d+(?:\s?[-–]\s?\d+)?)?|\b\d{4}\sLPELR[-–]\d+(?:\([A-Z]+\))?|\b(?:SC|CA|FHC|HC)[./]\s?\d+[A-Z]?\/\d{2,4})`;
const MONEY = String.raw`(?:₦|NGN\s?|N(?=\d)|\$|£|€)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion|thousand|trillion)\b)?`;
const UNIT = String.raw`(?:%|°[CF]?|\s?(?:per\s?cent|percent|km|kg|mg|ml|cm|mm|kW|MW|Hz|kHz|mol|hrs?|hours?|mins?|minutes?|seconds?|days?|weeks?|months?|years?|marks?|questions?|times|million|billion|thousand)\b)`;
const UNIT_NUMBER = String.raw`(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s?[–-]\s?\d[\d,]*(?:\.\d+)?)?(?:st|nd|rd|th)?${UNIT}`;
const YEAR = String.raw`(?<![\w.,/-])(?:1[5-9]\d{2}|20\d{2})(?:\s?[–-]\s?(?:1[5-9]\d{2}|20\d{2}|\d{2}))?(?![\w/])`;
const ORDINAL = String.raw`(?<![\w.])\d{1,3}(?:st|nd|rd|th)\b`;
const BARE = String.raw`(?<![\w.,/])(?<!\bNo\.?\s)\d{2,}(?:[.,]\d+)*(?![\w/])`;
/** Case names: "X v Y" / "X v. Y" / "X vs Y" with capitalised parties (≤ 7 words a side). */
const PARTY = String.raw`(?:[A-Z][\w.'’&-]*|\((?:Nig\.?|Nigeria)\)|Ltd\.?|Plc\.?)(?:\s(?:[A-Z][\w.'’&-]*|of|and|the|for|&|\((?:Nig\.?|Nigeria)\)|Ltd\.?|Plc\.?)){0,6}`;
const CASE = String.raw`${PARTY}\s(?:v\.?|vs\.?)\s${PARTY}`;
/** Statute names: Evidence Act 2011 · Rules of Professional Conduct for Legal Practitioners 2007 · Legal Practitioners Act. */
const STATUTE = String.raw`(?:(?:Rules|Code|Law)\sof\s(?:[A-Z][\w'’-]+(?:\s(?:of|for|and|the|in))?\s){0,6}[A-Z][\w'’-]+(?:,?\s\d{4})?\b|(?:(?:1[89]|20)\d{2}\s)?(?:[A-Z][\w'’-]+\s(?:(?:of|for|and|the|on|in|to)\s){0,2}){1,7}(?:Act|Law|Decree|Edict|Rules|Regulations|Constitution|Code)(?:\s\((?:Amendment|Procedure)\)|\sof\sthe\sFederation)?(?:,?\s(?:No\.?\s\d+\sof\s)?\d{4})?\b)`;
const ACRONYM = String.raw`\b[A-Z]{2,6}s?\b`;

/** Legal Latin and terms of art worth marking (matched in any case). */
const LATIN = [
  'ejusdem generis', 'noscitur a sociis', 'expressio unius est exclusio alterius', 'expressio unius',
  'generalia specialibus non derogant', 'generalibus specialia derogant', 'ut res magis valeat quam pereat',
  'reddendo singula singulis', 'contemporanea expositio', 'in pari materia', 'stare decisis', 'ratio decidendi',
  'obiter dicta', 'obiter dictum', 'per incuriam', 'locus standi', 'res judicata', 'sub judice', 'prima facie',
  'bona fide', 'bona fides', 'mala fide', 'mens rea', 'actus reus', 'ultra vires', 'intra vires', 'inter alia',
  'audi alteram partem', 'nemo judex in causa sua', 'ex parte', 'inter partes', 'suo motu', 'ab initio',
  'de novo', 'mutatis mutandis', 'pari passu', 'ipso facto', 'in limine', 'amicus curiae', 'functus officio',
  'nolle prosequi', 'habeas corpus', 'certiorari', 'mandamus', 'res ipsa loquitur', 'volenti non fit injuria',
  'caveat emptor', 'ex turpi causa', 'uberrimae fidei', 'quantum meruit', 'lex specialis', 'lex posterior',
  'casus omissus', 'dies non', 'jus tertii', 'ad idem', 'in personam', 'in rem', 'per se', 'pro bono',
  'sine qua non', 'status quo', 'viva voce', 'de facto', 'de jure', 'et seq', 'ibid', 'supra', 'infra',
];

/** Capitalised words that are ordinary words, not acronyms. */
const NOT_ACRONYMS = new Set(
  (
    'OK AM PM TV ID NO OR IT IN ON AT TO BE IS OF AN AS BY IF SO UP WE US MY ME HE DO GO ' +
    'THE AND FOR BUT NOT ARE WAS YOU ALL ANY CAN HAS HAD HIS HER ITS OUR OUT WHO WHY HOW MAY SHE ONE TWO ' +
    'NEW OLD SEE USE WAY OWN PER VIA ETC ALSO THAT THIS WITH FROM HAVE BEEN WILL SHALL MUST WHEN THEY THEM ' +
    'SUCH THAN THEN INTO UPON ONLY SOME EACH MADE MAKE BOTH COURT CASE LAW LAWS ACT ACTS RULE RULES PART NOTE ' +
    'OATH SWORN NAME DATE FACTS BRIEF WRIT SUIT HELD HOLD SAID DOES DONE TRUE BEFORE AFTER UNDER ABOVE WHERE ' +
    'WHICH WHAT THERE THEIR OTHER ABOUT'
  ).split(' '),
);
const ROMAN = /^[IVXLCDM]+$/;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyCase = (term: string) => term.split('').map((ch) => (/[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : escape(ch))).join('');
const LATIN_SOURCE = LATIN.slice().sort((a, b) => b.length - a.length).map(anyCase).join('|');

/** Order matters: the first alternative that matches at a position wins. */
const BASE_PARTS = [
  `(?<cite>${CITATION})`,
  `(?<case>${CASE})`,
  `(?<statute>${STATUTE})`,
  `(?<ref>\\b${REFERENCE})`,
  `(?<latin>\\b(?:${LATIN_SOURCE})\\b)`,
  `(?<money>${MONEY})`,
  `(?<unit>${UNIT_NUMBER})`,
  `(?<year>${YEAR})`,
  `(?<ord>${ORDINAL})`,
  `(?<num>${BARE})`,
  `(?<acr>${ACRONYM})`,
];
const BASE_PATTERN = BASE_PARTS.join('|');

type Kind = 'term' | 'case' | 'statute' | 'ref' | 'latin' | 'money' | 'unit' | 'year' | 'ord' | 'num' | 'acr' | 'cite';

const CLASS: Record<Kind | 'strong', string> = {
  strong: 'font-extrabold text-mist-50',
  term: 'font-bold text-nova-200',
  case: 'font-semibold italic text-gold-200',
  statute: 'font-bold text-mist-50',
  ref: 'font-extrabold text-mist-50',
  latin: 'italic text-mist-100',
  money: 'font-extrabold text-mist-50 tabular-nums',
  unit: 'font-extrabold text-mist-50 tabular-nums',
  year: 'font-bold text-mist-50 tabular-nums',
  ord: 'font-bold text-mist-50',
  num: 'font-bold text-mist-100 tabular-nums',
  acr: 'font-bold text-mist-100',
  cite: 'font-medium text-mist-400',
};

/** Higher wins when the density cap has to drop something. Citations are muted, not counted. */
const PRIORITY: Record<Kind, number> = {term: 9, case: 8, statute: 7, ref: 7, latin: 6, money: 5, unit: 5, year: 3, ord: 2, acr: 2, num: 1, cite: 0};

/** Words people use to open a sentence before a case name — kept out of the name. */
const LEAD_ONE = /^(?:In|See|Also|Per|Cf\.?|And|But|As|Thus|Under|From|Following|Applying|Similarly|Compare|Accordingly|Again|Moreover|Further|Hence|Therefore|Where|When|While|Although|Recall|Consider|Held|The|Of|case|of)\s/;

function isShouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.6;
}

/** Is this ALL-CAPS word part of a run of capitals (a shouted phrase, not an acronym)? */
function inCapsRun(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 24), start).match(/([A-Za-z]+)\W*$/);
  const after = text.slice(end, end + 24).match(/^\W*([A-Za-z]+)/);
  const caps = (word?: string) => Boolean(word && word.length >= 2 && word === word.toUpperCase());
  return caps(before?.[1]) || caps(after?.[1]);
}

type Hit = {start: number; end: number; kind: Kind; value: string};

function findHits(text: string, pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  const shouting = isShouting(text);
  const seen = new Set<string>();
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[0] === '') {
      pattern.lastIndex += 1;
      continue;
    }
    const groups = match.groups ?? {};
    let value = match[0];
    let start = match.index;
    const kind = (Object.keys(groups) as Kind[]).find((key) => groups[key] !== undefined);
    if (!kind) continue;
    if (kind === 'case') {
      // "In Donoghue v Stevenson" → emphasise only the name.
      let lead = '';
      for (let step = value.slice(0).match(LEAD_ONE); step; step = value.slice(lead.length).match(LEAD_ONE)) lead += step[0];
      if (lead) {
        value = value.slice(lead.length);
        start += lead.length;
      }
      value = value.replace(/[\s,;:]+$/, '');
      if (value.endsWith('.') && !/\b(?:Ltd|Plc|Co|Nig|Inc|v|vs)\.$/.test(value)) value = value.slice(0, -1);
      if (!/\sv(?:s)?\.?\s/.test(value) || shouting) continue;
    }
    if (kind === 'statute') {
      let lead = '';
      for (let step = value.match(LEAD_ONE); step; step = value.slice(lead.length).match(LEAD_ONE)) lead += step[0];
      const lower = value.slice(lead.length).match(/^(?:[a-z]+\s)+/)?.[0] ?? '';
      lead += lower;
      value = value.slice(lead.length);
      start += lead.length;
      // "1999 Constitution and the Evidence Act 2011" is two statutes: stop at the first
      // title word and let the scan continue from there.
      const first = value.match(/^.*?\b(?:Act|Law|Decree|Edict|Rules|Regulations|Constitution|Code)\b(?:\s\((?:Amendment|Procedure)\)|\sof\sthe\sFederation)?(?:,?\s(?:No\.?\s\d+\sof\s)?\d{4}\b)?/);
      if (first && first[0].length < value.length && !/^(?:Rules|Code|Law)\sof\s/.test(value)) {
        value = first[0];
        pattern.lastIndex = start + value.length;
      }
      if (shouting || value.split(/\s+/).length < 2) continue;
    }
    if (kind === 'acr') {
      const bare = value.replace(/s$/, '');
      if (shouting || NOT_ACRONYMS.has(bare) || ROMAN.test(bare) || inCapsRun(text, start, start + value.length)) continue;
    }
    if (kind === 'num') {
      // list numbering at the start ("12. The court…") is not information
      if (start === 0 && /^[.)]/.test(text.slice(value.length))) continue;
    }
    const key = `${kind}:${value.toLowerCase()}`;
    if (kind !== 'cite' && seen.has(key)) continue; // first mention per block
    seen.add(key);
    hits.push({start, end: start + value.length, kind, value});
  }
  // Density cap: about one emphasis per 8 words (min 3), lowest priority dropped first.
  const words = text.split(/\s+/).filter(Boolean).length;
  const cap = Math.max(3, Math.ceil(words / 8));
  const counted = hits.filter((hit) => hit.kind !== 'cite');
  if (counted.length > cap) {
    const keep = new Set(
      counted
        .map((hit, order) => ({hit, order}))
        .sort((a, b) => PRIORITY[b.hit.kind] - PRIORITY[a.hit.kind] || a.order - b.order)
        .slice(0, cap)
        .map(({hit}) => hit),
    );
    return hits.filter((hit) => hit.kind === 'cite' || keep.has(hit));
  }
  return hits;
}

function emphasise(text: string, pattern: RegExp, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const hit of findHits(text, pattern)) {
    if (hit.start < last) continue;
    if (hit.start > last) out.push(text.slice(last, hit.start));
    const Tag = hit.kind === 'cite' || hit.kind === 'latin' || hit.kind === 'case' ? 'span' : 'strong';
    out.push(
      <Tag key={`${keyPrefix}-${hit.start}`} className={CLASS[hit.kind]}>
        {hit.value}
      </Tag>,
    );
    last = hit.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Exposed for tests: which spans would be emphasised, and how. */
export function emphasisPlan(text: string, terms: string[] = []): {kind: string; value: string}[] {
  return findHits(text, buildPattern(terms)).map(({kind, value}) => ({kind, value}));
}

function buildPattern(list: string[]): RegExp {
  // Terms match in any letter case; everything else is case-sensitive (acronyms must be CAPS).
  const usable = Array.from(new Set(list.map((term) => term.trim()).filter((term) => term.length >= 3 && term.length <= 60)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 80);
  if (!usable.length) return new RegExp(BASE_PATTERN, 'g');
  return new RegExp(`(?<term>\\b(?:${usable.map(anyCase).join('|')})\\b)|${BASE_PATTERN}`, 'g');
}

/** Render material text with emphasis. `terms` defaults to the reader's key terms. */
export function RichText({text, terms, plain = false, lead = false}: {text?: string | null; terms?: string[]; plain?: boolean; lead?: boolean}) {
  const contextTerms = useContext(TermsContext);
  const list = terms ?? contextTerms;
  const pattern = useMemo(() => buildPattern(list), [list]);
  if (!text) return null;
  if (plain) return <>{text.replace(/\*\*(.+?)\*\*/g, '$1')}</>;
  const split = lead ? leadIn(text) : null;
  if (split) {
    // "Name of the court: the court in which…" — the point's label stands out.
    return (
      <>
        <strong className={CLASS.strong}>{split.label}:</strong> <RichText text={split.rest} terms={terms} />
      </>
    );
  }
  // 1) explicit **bold** first, 2) automatic emphasis inside the rest
  const pieces = text.split(/(\*\*[^*\n]+?\*\*)/g);
  return (
    <>
      {pieces.map((piece, index) =>
        piece.startsWith('**') && piece.endsWith('**') && piece.length > 4 ? (
          <strong key={index} className={CLASS.strong}>
            {piece.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{emphasise(piece, pattern, String(index))}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The label of a list point, if it has one: "Name of the court: the court in which…"
 * → {label: "Name of the court", rest: "the court in which…"}. Short (≤ 7 words),
 * starts with a capital, and is followed by the explanation.
 */
export function leadIn(text: string): {label: string; rest: string} | null {
  const match = /^([A-Z][^:\n]{1,70}?):\s+(\S[\s\S]*)$/.exec(text.trim());
  if (!match) return null;
  const label = match[1].replace(/\*\*/g, '').trim();
  const words = label.split(/\s+/).length;
  if (words > 7 || /[.;!?(]/.test(label)) return null;
  return {label, rest: match[2]};
}

/** Key terms a material defines (Key term / Definition blocks). */
export function materialTerms(sections: {blocks?: MaterialBlock[]}[] | undefined): string[] {
  const terms: string[] = [];
  for (const section of sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block.type === 'keyterm' && block.term) terms.push(block.term.replace(/\*\*/g, ''));
      if (block.type === 'definition' && block.title) terms.push(block.title.replace(/\*\*/g, ''));
    }
  }
  return terms;
}

/** Text without the ** markers (for titles, search, previews). */
export const stripMarks = (text?: string | null) => (text ?? '').replace(/\*\*(.+?)\*\*/g, '$1');

/* --------------------------------------------------------------- list numbering */
const toRoman = (value: number) => {
  const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  let rest = value;
  for (const [amount, letters] of table) {
    while (rest >= amount) {
      out += letters;
      rest -= amount;
    }
  }
  return out;
};
const toLetters = (value: number) => {
  let out = '';
  let rest = value;
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
};

/** The marker for item `index` of a numbered list block, as the notes wrote it: "3." "(c)" "iv)" "B." */
export function listMarker(block: Pick<MaterialBlock, 'style' | 'wrap' | 'start'>, index: number): string {
  const value = (block.start && block.start > 0 ? block.start : 1) + index;
  const style = block.style ?? 'decimal';
  let label = String(value);
  if (style === 'lower-alpha') label = toLetters(value);
  else if (style === 'upper-alpha') label = toLetters(value).toUpperCase();
  else if (style === 'lower-roman') label = toRoman(value);
  else if (style === 'upper-roman') label = toRoman(value).toUpperCase();
  if (block.wrap === 'paren') return `(${label})`;
  if (block.wrap === 'rparen') return `${label})`;
  return `${label}.`;
}

/** Left indent for nested lists (level 0–2). */
export const listIndent = (level?: number) => (level === 2 ? 'ml-10' : level === 1 ? 'ml-5' : '');

export const NUMBERING_OPTIONS: {value: string; label: string; style?: MaterialBlock['style']; wrap?: MaterialBlock['wrap']}[] = [
  {value: 'decimal-dot', label: '1. 2. 3.'},
  {value: 'decimal-paren', label: '(1) (2) (3)', wrap: 'paren'},
  {value: 'lower-alpha-paren', label: '(a) (b) (c)', style: 'lower-alpha', wrap: 'paren'},
  {value: 'lower-alpha-rparen', label: 'a) b) c)', style: 'lower-alpha', wrap: 'rparen'},
  {value: 'lower-alpha-dot', label: 'a. b. c.', style: 'lower-alpha'},
  {value: 'upper-alpha-dot', label: 'A. B. C.', style: 'upper-alpha'},
  {value: 'lower-roman-paren', label: '(i) (ii) (iii)', style: 'lower-roman', wrap: 'paren'},
  {value: 'lower-roman-dot', label: 'i. ii. iii.', style: 'lower-roman'},
  {value: 'upper-roman-dot', label: 'I. II. III.', style: 'upper-roman'},
];
export const numberingValue = (block: Pick<MaterialBlock, 'style' | 'wrap'>) =>
  `${block.style ?? 'decimal'}-${block.wrap ?? 'dot'}`;
