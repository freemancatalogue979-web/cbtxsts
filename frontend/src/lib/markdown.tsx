/**
 * Minimal, safe Markdown for tutor answers: headings, lists, bold/italic,
 * inline code, code blocks, quotes and simple tables. Text in, React nodes
 * out — never raw HTML, so nothing from the AI can be injected.
 */
import {Fragment, type ReactNode} from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith('`')) out.push(<code key={k} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-nova-200">{token.slice(1, -1)}</code>);
    else if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={k} className="font-extrabold text-mist-50">{token.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
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
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[i]) : /^\s*[-*•]\s+/.test(lines[i]))) {
        let item = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/, '');
        i++;
        // continuation lines (indented, not a new item)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={k} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5 marker:text-nova-300`}>
          {items.map((item, j) => <li key={j}>{inline(item, `${k}-${j}`)}</li>)}
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
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++]);
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
