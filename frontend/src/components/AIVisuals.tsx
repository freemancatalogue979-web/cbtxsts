import { ArrowDown, BarChart3, GitBranch } from "lucide-react";
import { Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AISource, AIVisual } from "../lib/cloverAI";
import { HeroImg } from "./HeroImg";

const safeHeroName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 60
  && /^[\p{L}\p{N} .'’_-]+$/u.test(value) && !value.includes("..");
const shortText = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";

// Model-supplied image URLs can track private viewers. Only local bundled hero
// art is rendered in Markdown; external URLs and SVG/HTML are never fetched.
export function safeLocalHeroImage(src: unknown): src is string {
  return typeof src === "string" && /^\/heroes\/(?:head-)?[a-z0-9][a-z0-9.'-]{0,79}\.webp$/i.test(src)
    && !src.includes("..");
}

type Step = { label: string; detail: string; hero?: string };
type Diagram = { title: string; steps: Step[] };
export function parseAIDiagram(raw: string): Diagram | null {
  if (raw.length > 5000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate.steps) || candidate.steps.length < 2 || candidate.steps.length > 6) return null;
    const steps: Step[] = [];
    for (const item of candidate.steps) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const label = shortText(row.label, 60);
      if (!label) return null;
      steps.push({ label, detail: shortText(row.detail, 220), hero: safeHeroName(row.hero) ? row.hero : undefined });
    }
    return { title: shortText(candidate.title, 100) || "Game plan", steps };
  } catch { return null; }
}

function DiagramCard({ diagram }: { diagram: Diagram }) {
  return <section role="group" aria-label={`${diagram.title} diagram`} className="my-4 rounded-xl border border-leaf/25 bg-leaf/[0.04] p-3 sm:p-4">
    <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-leaf"><GitBranch size={15} aria-hidden="true" /> {diagram.title}</div>
    <ol className="mt-3 space-y-1 list-none p-0">{diagram.steps.map((step, index) => <Fragment key={`${index}-${step.label}`}>
      {index > 0 && <li aria-hidden="true" className="flex pl-4 text-leaf/75"><ArrowDown size={15} /></li>}
      <li className="flex items-center gap-3 rounded-lg border border-edge bg-panel/70 p-2.5">
        {step.hero && <HeroImg name={step.hero} size={36} className="rounded-md shrink-0" />}
        <div className="min-w-0"><div className="text-[11px] font-extrabold text-text">{index + 1}. {step.label}</div>
          {step.detail && <div className="mt-0.5 text-[11px] leading-relaxed text-mute break-words">{step.detail}</div>}</div>
      </li>
    </Fragment>)}</ol>
  </section>;
}

export function AIMarkdown({ content }: { content: string }) {
  const parts: { kind: "text" | "diagram"; value: string }[] = [];
  const pattern = /```clover-diagram[ \t]*\r?\n([\s\S]*?)```/gi;
  let last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > last) parts.push({ kind: "text", value: content.slice(last, match.index) });
    parts.push({ kind: "diagram", value: match[1] });
    last = pattern.lastIndex;
  }
  if (last < content.length || !parts.length) parts.push({ kind: "text", value: content.slice(last) });
  return <>{parts.map((part, index) => {
    if (part.kind === "diagram") {
      const diagram = parseAIDiagram(part.value);
      return diagram ? <DiagramCard key={index} diagram={diagram} /> : <pre key={index} className="whitespace-pre-wrap break-words text-[11px]">{part.value}</pre>;
    }
    return <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ children }) => <span>{children}</span>,
      img: ({ src, alt }) => safeLocalHeroImage(src) ? <img src={src} alt={alt || "Hero artwork"} loading="lazy" decoding="async" className="max-h-64 max-w-full rounded-lg object-contain" /> : null,
    }}>{part.value}</ReactMarkdown>;
  })}</>;
}

function HeroCard({ visual }: { visual: Extract<AIVisual, { kind: "hero" }> }) {
  if (!safeHeroName(visual.name)) return null;
  const ratings = Object.entries(visual.ratings && typeof visual.ratings === "object" && !Array.isArray(visual.ratings) ? visual.ratings : {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10).slice(0, 4);
  const roles = Array.isArray(visual.roles) ? visual.roles.filter((role) => typeof role === "string").slice(0, 3) : [];
  return <section role="group" aria-label={`${visual.name} hero profile`} className="overflow-hidden rounded-xl border border-edge bg-panel/65">
    <div className="flex gap-3 p-3">
      <div className="h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-edge">
        <HeroImg name={visual.name} variant="art" size={96} className="!w-full !h-full object-top" />
      </div>
      <div className="min-w-0 flex-1"><div className="text-[10px] font-extrabold uppercase tracking-wider text-leaf">Hero reference</div>
        <div className="mt-1 text-[15px] font-extrabold text-text break-words">{visual.name}</div>
        {shortText(visual.title, 100) && <div className="text-[11px] text-mute break-words">{shortText(visual.title, 100)}</div>}
        {!!roles.length && <div className="mt-1 text-[10px] font-semibold text-mute">{roles.join(" · ")}</div>}
        {!!ratings.length && <dl className="mt-2 space-y-1">{ratings.map(([label, value]) => <div key={label} className="grid grid-cols-[74px_1fr_auto] items-center gap-2 text-[9px] text-mute">
          <dt className="capitalize truncate">{label.replace(/_/g, " ")}</dt>
          <dd aria-hidden="true" className="h-1.5 rounded-full bg-overlay overflow-hidden"><div className="h-full rounded-full bg-leaf" style={{ width: `${value * 10}%` }} /></dd>
          <dd className="font-bold tabular-nums text-text">{value}/10</dd>
        </div>)}</dl>}
      </div>
    </div>
    <p className="border-t border-edge px-3 py-2 text-[10px] leading-relaxed text-mute">Historical community hero profile; abilities and ratings may have changed.</p>
  </section>;
}

function PicksChart({ visual }: { visual: Extract<AIVisual, { kind: "picks_chart" }> }) {
  const bars = (Array.isArray(visual.bars) ? visual.bars : []).filter((bar) => bar && typeof bar === "object" && safeHeroName(bar.label) && Number.isSafeInteger(bar.value) && bar.value > 0).slice(0, 6);
  if (!bars.length) return null;
  const max = Math.max(...bars.map((bar) => bar.value));
  return <section role="group" aria-label={shortText(visual.title, 120)} className="rounded-xl border border-leaf/25 bg-panel/65 p-3 sm:p-4">
    <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-leaf"><BarChart3 size={15} aria-hidden="true" /> {shortText(visual.title, 120)}</div>
    <p className="mt-1 text-[10px] text-mute">{visual.complete_games} complete {visual.complete_games === 1 ? "game" : "games"} counted{visual.incomplete_data ? " · some data is incomplete" : ""}</p>
    <ol className="mt-3 space-y-2 list-none p-0">{bars.map((bar, index) => <li key={`${bar.label}-${index}`} className="flex items-center gap-2">
      <HeroImg name={bar.label} size={30} className="rounded-md shrink-0" />
      <div className="min-w-0 flex-1"><div className="flex justify-between gap-2 text-[11px] font-semibold text-text"><span className="truncate">{bar.label}</span><span className="tabular-nums shrink-0">{bar.value} {bar.value === 1 ? "pick" : "picks"}</span></div>
        <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-overlay"><div className="h-full rounded-full bg-leaf" style={{ width: `${bar.value / max * 100}%` }} /></div></div>
    </li>)}</ol>
    <p className="mt-3 text-[10px] leading-relaxed text-mute">{shortText(visual.notice, 200)}</p>
  </section>;
}

export function AIVisuals({ sources }: { sources: AISource[] }) {
  const visuals = sources.map((source) => source.visual).filter((visual): visual is AIVisual => Boolean(visual)).slice(0, 5);
  if (!visuals.length) return null;
  return <div className="mt-4 grid gap-2 sm:grid-cols-2">{visuals.map((visual, index) => visual.kind === "hero"
    ? <HeroCard key={`hero-${visual.name}-${index}`} visual={visual} />
    : visual.kind === "picks_chart" ? <PicksChart key={`chart-${index}`} visual={visual} /> : null)}</div>;
}
