/**
 * Minimal, safe Markdown for tutor answers: headings, lists, bold/italic,
 * inline code, code blocks, quotes and simple tables. Text in, React nodes
 * out — never raw HTML, so nothing from the AI can be injected.
 */
import {Fragment, type ReactNode} from 'react';

const REF = /\b(proposals?|tasks?|materials?|questions?|topics?|exams?)\s+#(\d+)\b/gi;
const REF_TONE: Record<string, string> = {
  proposal: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  task: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  material: 'border-mint-400/30 bg-mint-500/10 text-mint-100',
};

/** "proposal #16" → a small tag; everything else stays plain text. */
function refs(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const kind = m[1].toLowerCase().replace(/s$/, '');
    out.push(
      <span key={`${key}-r${n++}`} className={`mx-px inline-flex items-baseline gap-0.5 rounded-md border px-1.5 py-px text-[0.82em] font-bold whitespace-nowrap ${REF_TONE[kind] ?? 'border-white/12 bg-white/[0.06] text-mist-100'}`}>
        {m[1]} <span className="tabular opacity-80">#{m[2]}</span>
      </span>,
    );
    last = at + m[0].length;
  }
  if (!out.length) return [text];
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(...refs(text.slice(last, match.index), `${key}-t${i}`));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith('`')) out.push(<code key={k} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-nova-200">{token.slice(1, -1)}</code>);
    else if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={k} className="font-extrabold text-mist-50">{refs(token.slice(2, -2), k)}</strong>);
    else out.push(<em key={k}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(...refs(text.slice(last), `${key}-end`));
  return out;
}

export function Markdown({text, className = ''}: {text: string; className?: string}) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="overflow-x-auto rounded-xl border border-white/10 bg-ink-950/80 p-3 font-mono text-[0.8rem] leading-relaxed text-mist-200">{code.join('\n')}</pre>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={k} className="my-1 border-white/10" />);
      i++;
      continue;
    }
    const label = /^\s*(?:\*\*|__)([^*_]{1,60}?)(?::)?(?:\*\*|__)\s*:?\s*$/.exec(line);
    if (label) {
      blocks.push(
        <p key={k} className="flex items-center gap-2 pt-1.5 text-[0.68rem] font-black tracking-[0.12em] text-nova-200 uppercase first:pt-0">
          <span className="h-3 w-0.5 rounded-full bg-nova-400" />
          {label[1].trim()}
        </p>,
      );
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls = level <= 2 ? 'mt-3 text-[1rem] font-extrabold text-mist-50' : 'mt-2 text-[0.92rem] font-extrabold text-mist-100';
      blocks.push(<p key={k} className={cls}>{inline(heading[2], k)}</p>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={k} className="overflow-x-auto">
          <table className="w-full min-w-[16rem] border-collapse text-[0.82rem]">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border-b border-white/15 px-2 py-1.5 text-left font-extrabold text-mist-100">{inline(c, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-white/5 px-2 py-1.5 align-top">{inline(c, `${k}${ri}-${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: {text: string; depth: number}[] = [];
      const itemRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
      const anyItem = /^\s*([-*•]|\d+[.)])\s+/;
      while (i < lines.length && (itemRe.test(lines[i]) || (items.length > 0 && /^\s{2,}([-*•]|\d+[.)])\s+/.test(lines[i])))) {
        const depth = Math.min(2, Math.floor((/^\s*/.exec(lines[i])?.[0].length ?? 0) / 2));
        let item = lines[i].replace(anyItem, '');
        i++;
        // continuation lines (indented, not a new item)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !anyItem.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push({text: item, depth});
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={k} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5 marker:text-nova-300`}>
          {items.map((item, j) => (
            <li key={j} className={item.depth ? 'marker:text-mist-500' : ''} style={item.depth ? {marginLeft: `${item.depth * 1.1}rem`, listStyleType: 'circle'} : undefined}>
              {inline(item.text, `${k}-${j}`)}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k} className="border-l-2 border-nova-400/60 pl-3 text-mist-300">{inline(quote.join(' '), k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i]) && !(para.length && /^\s*(\*\*|__)[^*_]{1,60}(\*\*|__)\s*:?\s*$/.test(lines[i]))) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(
      <p key={k}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className={`space-y-2 break-words text-[0.9rem] leading-relaxed text-mist-200 ${className}`}>{blocks}</div>;
}
