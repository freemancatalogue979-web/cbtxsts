/**
 * Hand-rolled, animated SVG charts (no chart library): lines that draw themselves, bars that
 * grow, a donut that sweeps in, an activity heatmap that pops in column by column, and
 * count-up numbers. Every chart has a hover/tap readout and a screen-reader table, and all
 * motion stops under "calm" effects or prefers-reduced-motion (see .chart-* in index.css).
 */
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** Chart paint. A section can repaint every chart inside it by setting the --chart-*
 *  variables (the light dashboard board does); otherwise the theme colours are used. */
export const CHART_COLORS = {
  accent: "var(--chart-accent, var(--color-crim))",
  win: "var(--chart-win, var(--color-leaf))",
  loss: "var(--chart-loss, var(--color-danger))",
  amber: "var(--chart-amber, var(--color-amber))",
  sky: "var(--chart-sky, var(--color-sky))",
  softBlue: "var(--chart-soft-blue, var(--color-sky))",
  violet: "var(--chart-violet, #c4b5fd)",
  pink: "var(--chart-pink, #f9a8d4)",
  teal: "var(--chart-teal, #5eead4)",
};

const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(digits);

export function calmMotion(): boolean {
  if (typeof window === "undefined") return true;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce || document.documentElement.dataset.effects === "calm";
}

/** Width of the element, kept in sync with ResizeObserver. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => { const w = Math.round(el.getBoundingClientRect().width); if (w > 0) setWidth(Math.max(220, w)); };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A number that counts up from 0 when it first shows, then glides to each new value. */
export function CountUp({ value, digits = 0, suffix = "", ms = 1100 }: { value: number | null | undefined; digits?: number; suffix?: string; ms?: number }) {
  const [shown, setShown] = useState<number>(value ?? 0);
  const from = useRef(0);
  useEffect(() => {
    if (value == null) return;
    if (calmMotion() || typeof requestAnimationFrame !== "function") { setShown(value); from.current = value; return; }
    let raf = 0;
    const start = performance.now();
    const origin = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = origin + (value - origin) * eased;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  if (value == null) return <>—</>;
  return <>{shown.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}{suffix}</>;
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] text-mute">
      {items.map((s) => (
        <li key={s.name} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-[3px] w-4 rounded-full"
            style={s.dashed ? { backgroundImage: `linear-gradient(90deg, ${s.color} 55%, transparent 55%)`, backgroundSize: "6px 3px" } : { background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Thin the x labels so they never collide. */
function labelEvery(count: number, width: number, min = 64) {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / min))));
}

type Pt = { x: number; y: number };

/** Catmull-Rom → cubic Bézier, control points clamped to the plot. */
function smoothPath(points: Pt[], top: number, bottom: number): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  const clamp = (y: number) => Math.min(bottom, Math.max(top, y));
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Runs of consecutive non-null points. */
function runs(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) { if (cur.length) out.push(cur); cur = []; return; }
    cur.push({ x: x(i), y: y(v) });
  });
  if (cur.length) out.push(cur);
  return out;
}

function Readout({ x, width, title, rows }: { x: number; width: number; title: string; rows: { name: string; color: string; value: string }[] }) {
  const left = Math.min(Math.max(x - 80, 4), width - 164);
  return (
    <div className="pointer-events-none absolute top-1 z-10 w-40 rounded-lg border border-edge-2 bg-panel/95 px-2.5 py-2 shadow-xl backdrop-blur" style={{ left }}>
      <div className="text-[10.5px] font-extrabold text-text mb-1 truncate">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-2 text-[10.5px]">
          <span className="inline-flex items-center gap-1.5 text-mute truncate"><span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.color }} />{r.name}</span>
          <b className="tabular-nums text-text">{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function SrTable({ caption, labels, series }: { caption: string; labels: string[]; series: { name: string; values: (number | null)[] }[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Period</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
      <tbody>{labels.map((l, i) => <tr key={`${l}-${i}`}><th scope="row">{l}</th>{series.map((s) => <td key={s.name}>{fmt(s.values[i])}</td>)}</tr>)}</tbody>
    </table>
  );
}

function usePointerIndex(count: number, padL: number, step: number) {
  const [index, setIndex] = useState<number | null>(null);
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    const i = Math.round((e.clientX - box.left - padL) / Math.max(step, 1));
    setIndex(Math.max(0, Math.min(count - 1, i)));
  };
  return { index, onMove, onLeave: () => setIndex(null) };
}

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  area?: boolean;
  dashed?: boolean;
  /** Plot on the right-hand scale (e.g. games next to a win %). */
  right?: boolean;
  format?: (v: number | null) => string;
}

/** Big multi-line chart. Lines draw in, areas fade in, hover shows every series. */
export function LineChart({ labels, series, height = 260, yMax, rightMax, yFormat, rightFormat, caption, titleFor }: {
  labels: string[]; series: LineSeries[]; height?: number; yMax?: number; rightMax?: number;
  yFormat?: (v: number) => string; rightFormat?: (v: number) => string; caption: string; titleFor?: (i: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth();
  const hasRight = series.some((s) => s.right);
  const padL = 40, padR = hasRight ? 40 : 14, padT = 16, padB = 28;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const step = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const max = (right: boolean) => niceMax(Math.max(0, ...series.filter((s) => Boolean(s.right) === right).flatMap((s) => s.values.filter((v): v is number => v != null))));
  const leftTop = yMax ?? max(false);
  const rightTop = rightMax ?? (hasRight ? max(true) : 1);
  const x = (i: number) => padL + (labels.length > 1 ? i * step : plotW / 2);
  const yL = (v: number) => padT + plotH - (Math.min(v, leftTop) / leftTop) * plotH;
  const yR = (v: number) => padT + plotH - (Math.min(v, rightTop) / rightTop) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = labelEvery(labels.length, plotW);
  const { index, onMove, onLeave } = usePointerIndex(labels.length, padL, step);
  const signature = useMemo(() => JSON.stringify(series.map((s) => s.values)), [series]);
  // on a phone a month of daily points turns into a row of beads: draw only the latest one
  const dense = labels.length > 14 && step < 18;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} role="img" aria-label={caption} className="block overflow-visible" key={`${signature}-${width > 0}`}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${id}-g${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.38" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={padT + plotH * (1 - t)} y2={padT + plotH * (1 - t)} stroke="var(--color-edge)" strokeDasharray={t === 0 ? undefined : "3 5"} />
            <text x={padL - 8} y={padT + plotH * (1 - t) + 3.5} textAnchor="end" className="fill-faint text-[9.5px] tabular-nums">{yFormat ? yFormat(leftTop * t) : fmt(leftTop * t, 0)}</text>
            {hasRight && <text x={width - padR + 8} y={padT + plotH * (1 - t) + 3.5} className="fill-faint text-[9.5px] tabular-nums">{rightFormat ? rightFormat(rightTop * t) : fmt(rightTop * t, 0)}</text>}
          </g>
        ))}
        {labels.map((l, i) => i % every === 0 ? (
          <text key={`${l}-${i}`} x={x(i)} y={height - 8} textAnchor="middle" className="fill-faint text-[9.5px]">{l}</text>
        ) : null)}
        {series.map((s, si) => {
          const y = s.right ? yR : yL;
          const parts = runs(s.values, x, y);
          return (
            <g key={s.name}>
              {s.area && parts.map((pts, pi) => pts.length > 1 && (
                <path key={pi} className="chart-fade" style={{ animationDelay: `${300 + si * 120}ms` }} fill={`url(#${id}-g${si})`}
                  d={`${smoothPath(pts, padT, padT + plotH)} L${pts[pts.length - 1].x},${padT + plotH} L${pts[0].x},${padT + plotH} Z`} />
              ))}
              {parts.map((pts, pi) => (
                <path key={pi} className={s.dashed ? "chart-fade" : "chart-draw chart-glow"} pathLength={s.dashed ? undefined : 1}
                  style={{ animationDelay: `${si * 160}ms`, color: s.color }} d={smoothPath(pts, padT, padT + plotH)} fill="none"
                  stroke={s.color} strokeWidth={s.dashed ? 2 : 2.75} strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={s.dashed ? "5 6" : undefined} />
              ))}
              {(dense ? parts.map((pts) => pts[pts.length - 1]).filter(Boolean) : parts.flat()).map((p, pi) => (
                <circle key={pi} className="chart-pop" style={{ animationDelay: `${700 + pi * 25}ms` }} cx={p.x} cy={p.y} r={labels.length > 20 ? 2 : 3}
                  fill="var(--color-panel)" stroke={s.color} strokeWidth={1.75} />
              ))}
            </g>
          );
        })}
        {index != null && (
          <g pointerEvents="none">
            <line x1={x(index)} x2={x(index)} y1={padT} y2={padT + plotH} stroke="var(--color-edge-2)" />
            {series.map((s) => { const v = s.values[index]; return v == null ? null : (
              <circle key={s.name} cx={x(index)} cy={(s.right ? yR : yL)(v)} r={5} fill={s.color} stroke="var(--color-ink)" strokeWidth={2} />
            ); })}
          </g>
        )}
        <rect x={padL - step / 2} y={padT} width={plotW + step} height={plotH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={onLeave} />
      </svg>
      {index != null && (
        <Readout x={x(index)} width={width} title={titleFor ? titleFor(index) : labels[index]}
          rows={series.map((s) => ({ name: s.name, color: s.color, value: s.format ? s.format(s.values[index]) : fmt(s.values[index]) }))} />
      )}
      <SrTable caption={caption} labels={labels} series={series} />
    </div>
  );
}

export interface BarSeries { name: string; color: string; values: number[] }

/** Stacked bars that grow from the floor, one column at a time. */
export function BarChart({ labels, series, height = 220, caption, titleFor, overlay }: {
  labels: string[]; series: BarSeries[]; height?: number; caption: string; titleFor?: (i: number) => string;
  /** An optional line drawn over the bars on a 0–100 scale (e.g. win %). */
  overlay?: LineSeries;
}) {
  const id = useId().replace(/:/g, "");
  const [ref, width] = useWidth();
  const padL = 34, padR = overlay ? 38 : 10, padT = 14, padB = 28;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const step = labels.length ? plotW / labels.length : plotW;
  const totals = labels.map((_, i) => series.reduce((t, s) => t + (s.values[i] || 0), 0));
  const top = niceMax(Math.max(0, ...totals));
  const barW = Math.max(4, Math.min(38, step * 0.62));
  const every = labelEvery(labels.length, plotW, 56);
  const [index, setIndex] = useState<number | null>(null);
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    setIndex(Math.max(0, Math.min(labels.length - 1, Math.floor((e.clientX - box.left - padL) / Math.max(step, 1)))));
  };
  const cx = (i: number) => padL + step * i + step / 2;
  const signature = JSON.stringify(series.map((s) => s.values));

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} role="img" aria-label={caption} className="block overflow-visible" key={signature}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${id}-b${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="1" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.55" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={padT + plotH * (1 - t)} y2={padT + plotH * (1 - t)} stroke="var(--color-edge)" strokeDasharray={t ? "3 5" : undefined} />
            <text x={padL - 7} y={padT + plotH * (1 - t) + 3.5} textAnchor="end" className="fill-faint text-[9.5px] tabular-nums">{fmt(top * t, 0)}</text>
            {overlay && <text x={width - padR + 7} y={padT + plotH * (1 - t) + 3.5} className="fill-faint text-[9.5px] tabular-nums">{Math.round(100 * t)}%</text>}
          </g>
        ))}
        {labels.map((l, i) => {
          let base = padT + plotH;
          return (
            <g key={`${l}-${i}`} className="chart-grow" style={{ animationDelay: `${i * 45}ms` }} opacity={index == null || index === i ? 1 : 0.55}>
              {series.map((s, si) => {
                const v = s.values[i] || 0;
                if (!v) return null;
                const h = (v / top) * plotH;
                base -= h;
                return <rect key={si} x={cx(i) - barW / 2} y={base} width={barW} height={Math.max(h - 1, 1)} rx={Math.min(5, barW / 3)} fill={`url(#${id}-b${si})`} />;
              })}
            </g>
          );
        })}
        {labels.map((l, i) => (i % every === 0 ? <text key={`t-${l}-${i}`} x={cx(i)} y={height - 8} textAnchor="middle" className="fill-faint text-[9.5px]">{l}</text> : null))}
        {overlay && runs(overlay.values, cx, (v) => padT + plotH - (Math.min(v, 100) / 100) * plotH).map((pts, pi) => (
          <g key={pi}>
            <path className="chart-draw chart-glow" pathLength={1} style={{ animationDelay: "500ms", color: overlay.color }} d={smoothPath(pts, padT, padT + plotH)}
              fill="none" stroke={overlay.color} strokeWidth={2.5} strokeLinecap="round" />
            {pts.map((p, k) => <circle key={k} className="chart-pop" style={{ animationDelay: `${1100 + k * 30}ms` }} cx={p.x} cy={p.y} r={3} fill="var(--color-panel)" stroke={overlay.color} strokeWidth={1.75} />)}
          </g>
        ))}
        <rect x={padL} y={padT} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setIndex(null)} />
      </svg>
      {index != null && (
        <Readout x={cx(index)} width={width} title={titleFor ? titleFor(index) : labels[index]}
          rows={[...series.map((s) => ({ name: s.name, color: s.color, value: fmt(s.values[index]) })),
            ...(overlay ? [{ name: overlay.name, color: overlay.color, value: overlay.format ? overlay.format(overlay.values[index]) : fmt(overlay.values[index]) }] : [])]} />
      )}
      <SrTable caption={caption} labels={labels} series={[...series, ...(overlay ? [overlay] : [])]} />
    </div>
  );
}

/** A donut that sweeps in. `center` sits in the hole. */
export function Donut({ parts, size = 168, thickness = 18, center, caption }: {
  parts: { label: string; value: number; color: string }[]; size?: number; thickness?: number; center?: ReactNode; caption: string;
}) {
  const id = useId().replace(/:/g, "");
  const total = parts.reduce((t, p) => t + p.value, 0);
  const r = (size - thickness) / 2;
  let start = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`} className="-rotate-90">
        <defs>
          <mask id={`${id}-m`}>
            <circle className="chart-draw" pathLength={1} cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeWidth={thickness + 4} />
          </mask>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-raised)" strokeWidth={thickness} />
        <g mask={`url(#${id}-m)`}>
          {total > 0 && parts.map((p) => {
            const share = (p.value / total) * 100;
            const el = share > 0 ? (
              <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={thickness} pathLength={100}
                strokeDasharray={`${Math.max(share - 0.6, 0.01)} ${100 - Math.max(share - 0.6, 0.01)}`} strokeDashoffset={-start} />
            ) : null;
            start += share;
            return el;
          })}
        </g>
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

/** One value on a 0–100 ring. */
export function Ring({ value, size = 120, thickness = 11, color = CHART_COLORS.accent, label, sub }: {
  value: number | null; size?: number; thickness?: number; color?: string; label: string; sub?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${label}: ${value == null ? "no data" : `${Math.round(v)}%`}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-raised)" strokeWidth={thickness} />
        {value != null && v > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" pathLength={100}
            strokeDasharray={`${v} 100`} className="chart-ring chart-glow" style={{ color }} />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <div className="text-[22px] font-extrabold tabular-nums" style={{ fontSize: size * 0.2 }}>{value == null ? "—" : <CountUp value={Math.round(v)} suffix="%" />}</div>
          {sub && <div className="text-[9.5px] text-faint mt-1">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/** Rows × days grid (who was active when). */
export function Heatmap({ rows, columns, caption, color = CHART_COLORS.accent, cell = 14 }: {
  rows: { label: string; cells: number[]; hint?: string }[]; columns: string[]; caption: string; color?: string; cell?: number;
}) {
  const [ref, width] = useWidth();
  const labelW = Math.round(Math.min(120, Math.max(78, width * 0.24)));
  const gap = 3;
  // phones can't fit 28 readable squares: keep cells at least 11px and show the latest days that fit
  const fit = width > 0 ? Math.max(1, Math.floor((width - labelW - 8) / (11 + gap))) : columns.length;
  const from = Math.max(0, columns.length - fit);
  const cols = columns.slice(from);
  const size = Math.max(11, Math.min(cell + 6, Math.floor((width - labelW - 8) / Math.max(cols.length, 1)) - gap));
  const pitch = Math.max(size + gap, 18);
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const height = rows.length * pitch + 20;
  const every = labelEvery(cols.length, cols.length * (size + gap), 52);
  const chars = Math.max(4, Math.floor((labelW - 10) / 7.2));
  return (
    <div ref={ref} className="w-full overflow-hidden">
      {from > 0 && <div className="text-[10px] text-faint mb-1.5">Last {cols.length} days</div>}
      <svg width={width} height={height} role="img" aria-label={caption} className="block">
        {rows.map((r, ri) => (
          <g key={`${r.label}-${ri}`}>
            <text x={labelW - 8} y={ri * pitch + pitch / 2 + 3.5} textAnchor="end" className="fill-mute text-[10px]">{r.label.length > chars ? `${r.label.slice(0, chars - 1)}…` : r.label}</text>
            {r.cells.slice(from).map((v, ci) => (
              <rect key={ci} className="chart-pop" style={{ animationDelay: `${ci * 18 + ri * 10}ms` }}
                x={labelW + ci * (size + gap)} y={ri * pitch + (pitch - size) / 2} width={size} height={size} rx={Math.min(4, size / 3)}
                fill={v ? color : "var(--color-raised)"} fillOpacity={v ? 0.25 + 0.75 * (v / max) : 1} stroke="var(--color-edge)" strokeOpacity={v ? 0 : 0.6}>
                <title>{`${r.label} · ${cols[ci]}: ${v ? `${v} visit${v === 1 ? "" : "s"}` : "not active"}`}</title>
              </rect>
            ))}
          </g>
        ))}
        {cols.map((c, ci) => (ci % every === 0 && labelW + ci * (size + gap) + 46 <= width ? (
          <text key={`${c}-${ci}`} x={labelW + ci * (size + gap)} y={height - 3} className="fill-faint text-[9px]">{c}</text>
        ) : null))}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>{rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th><td>{r.cells.filter(Boolean).length} active days{r.hint ? `, ${r.hint}` : ""}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Horizontal bars with a label, a value and an optional second figure. */
export function HBars({ rows, max, color = CHART_COLORS.accent, format = (v: number) => fmt(v), caption }: {
  rows: { label: ReactNode; key: string; value: number; extra?: ReactNode; tone?: string }[]; max?: number; color?: string;
  format?: (v: number) => string; caption: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" aria-label={caption}>
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-2.5">
          <span className="min-w-0 truncate text-[11.5px] font-bold">{r.label}</span>
          <span className="relative h-2.5 rounded-full bg-raised overflow-hidden border border-edge/50">
            <span className="chart-bar-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, (r.value / top) * 100)}%`, background: r.tone ?? color, animationDelay: `${i * 70}ms` }} />
          </span>
          <span className="text-[11px] tabular-nums text-mute whitespace-nowrap">{format(r.value)}{r.extra ? <> · {r.extra}</> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Small inline trend line. */
export function Sparkline({ values, color = CHART_COLORS.accent, width = 96, height = 28, label }: {
  values: (number | null)[]; color?: string; width?: number; height?: number; label: string;
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <span className="text-[10px] text-faint">—</span>;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = hi - lo || 1;
  const x = (i: number) => 2 + (i / Math.max(values.length - 1, 1)) * (width - 4);
  const y = (v: number) => height - 3 - ((v - lo) / span) * (height - 6);
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
      {runs(values, x, y).map((pts, i) => (
        <path key={i} className="chart-draw" pathLength={1} d={smoothPath(pts, 1, height - 1)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Short week label: "6 Oct". */
export function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
