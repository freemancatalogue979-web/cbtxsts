/**
 * Reading emphasis for material text — makes study text easier to scan.
 *
 *   **words**            → bold (staff or the AI rewrite marked them)
 *   numbers              → bold: 1999, 3.5, 40%, ₦5,000, 1st, 1914–1918, 25 km, 12 marks
 *   references           → bold: Section 36, Article 5(2), Chapter 3, s. 12, Figure 2
 *   the material's terms → bold + tinted (terms from its Key term / Definition blocks)
 *   ACRONYMS             → bold: ATP, NADPH, JAMB
 *
 * Plain text in, React nodes out — never HTML, so nothing can be injected.
 */
import {createContext, Fragment, useContext, useMemo, type ReactNode} from 'react';
import type {MaterialBlock} from './types';

/** Key terms of the material being read (provided once per reader). */
export const TermsContext = createContext<string[]>([]);

const REFERENCE = String.raw`(?:Sections?|Articles?|Chapters?|Parts?|Rules?|Orders?|Regulations?|Schedules?|Clauses?|Paragraphs?|Pages?|Steps?|Units?|Weeks?|Levels?|Tables?|Figures?|Fig\.|Eqn\.|Equation|ss?\.|art\.)\s?\d+[A-Za-z]?(?:\(\d+[a-z]?\))*`;
const MONEY = String.raw`(?:₦|NGN\s?|N(?=\d)|\$|£|€)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion|thousand|trillion)\b)?`;
const UNIT = String.raw`(?:%|°[CF]?|\s?(?:per\s?cent|percent|km|kg|mg|ml|cm|mm|kW|MW|Hz|kHz|mol|g|m|l|L|s|hrs?|hours?|mins?|minutes?|seconds?|days?|weeks?|months?|years?|marks?|questions?|times|million|billion|thousand)\b)`;
const NUMBER = String.raw`(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s?[–-]\s?\d[\d,]*(?:\.\d+)?)?(?:st|nd|rd|th)?${UNIT}?`;
const ACRONYM = String.raw`\b[A-Z]{2,6}s?\b`;

/** Capitalised words that are not worth bolding. */
const NOT_ACRONYMS = new Set(['OK', 'AM', 'PM', 'TV', 'ID', 'NO', 'OR', 'IT', 'IN', 'ON', 'AT', 'TO', 'BE', 'IS', 'OF', 'AN', 'AS', 'BY', 'IF', 'SO', 'UP', 'WE', 'US', 'MY', 'ME', 'HE', 'DO', 'GO']);

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Everything except the material's own terms (those are added per reader). */
const BASE_PATTERN = [`(?<ref>\\b${REFERENCE})`, `(?<money>${MONEY})`, `(?<num>${NUMBER})`, `(?<acr>${ACRONYM})`].join('|');

const CLASS = {
  strong: 'font-extrabold text-mist-50',
  term: 'font-bold text-nova-200',
  num: 'font-extrabold text-mist-50 tabular-nums',
  acr: 'font-bold text-mist-100',
};

function emphasise(text: string, pattern: RegExp, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[0] === '') {
      pattern.lastIndex += 1;
      continue;
    }
    const groups = match.groups ?? {};
    const value = match[0];
    let className = '';
    if (groups.term) className = CLASS.term;
    else if (groups.ref || groups.money || groups.num) className = CLASS.num;
    else if (groups.acr && !NOT_ACRONYMS.has(value.replace(/s$/, ''))) className = CLASS.acr;
    if (!className) continue;
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <strong key={`${keyPrefix}-${match.index}`} className={className}>
        {value}
      </strong>,
    );
    last = match.index + value.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render material text with emphasis. `terms` defaults to the reader's key terms. */
export function RichText({text, terms, plain = false}: {text?: string | null; terms?: string[]; plain?: boolean}) {
  const contextTerms = useContext(TermsContext);
  const list = terms ?? contextTerms;
  const pattern = useMemo(() => {
    // Terms match in any letter case; everything else is case-sensitive (acronyms must be CAPS).
    const usable = Array.from(new Set(list.map((term) => term.trim()).filter((term) => term.length >= 3 && term.length <= 60)))
      .sort((a, b) => b.length - a.length)
      .slice(0, 80);
    if (!usable.length) return new RegExp(BASE_PATTERN, 'g');
    const anyCase = usable.map((term) => term.split('').map((ch) => (/[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : escape(ch))).join(''));
    return new RegExp(`(?<term>\\b(?:${anyCase.join('|')})\\b)|${BASE_PATTERN}`, 'g');
  }, [list]);
  if (!text) return null;
  if (plain) return <>{text.replace(/\*\*(.+?)\*\*/g, '$1')}</>;
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
