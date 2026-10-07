import { useState } from "react";

/** 9 CLOVER brand mark — sharp clover glyph + wordmark.
 *
 * Drop the official team artwork at frontend/public/brand/logo.png and it
 * takes over everywhere (sidebar, login, favicon). The SVG mark below is the
 * built-in fallback so the app always has a clean brand. */
const CANDIDATES = ["/brand/logo.png", "/brand/logo.webp", "/brand/logo.svg", "/brand/logo.jpg"];

export function CloverMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect width="48" height="48" rx="8" fill="#101015" stroke="#2b2b35" />
      <path d="M13 6h22a3 3 0 0 1 3 3v9h-4.8V9.5H13V6Z" fill="#e11d48" />
      <g fill="#34d399">
        <ellipse cx="18.5" cy="18" rx="5" ry="5.6" transform="rotate(-28 18.5 18)" />
        <ellipse cx="29.5" cy="18" rx="5" ry="5.6" transform="rotate(28 29.5 18)" />
        <ellipse cx="24" cy="26.5" rx="5.2" ry="6" />
      </g>
      <path d="M24 31c0 4.5-1.8 7.5-4.5 9.5l2 2c3.7-2.5 5.5-6.8 5.5-11.5h-3Z" fill="#34d399" />
      <rect x="13" y="33" width="4.6" height="9" rx="1.5" fill="#e11d48" opacity="0.9" />
    </svg>
  );
}

function BrandImg({ size, className = "" }: { size: number; className?: string }) {
  const [idx, setIdx] = useState(0);
  if (idx >= CANDIDATES.length) return <CloverMark size={size} />;
  return (
    <img
      src={CANDIDATES[idx]}
      alt="9 CLOVER"
      width={size}
      height={size}
      onError={() => setIdx((i) => i + 1)}
      className={`rounded object-contain ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <BrandImg size={compact ? 26 : 32} />
      <div className="leading-none">
        <div className="font-extrabold tracking-[0.22em] text-[15px]">
          9&nbsp;<span className="text-crim">CLOVER</span>
        </div>
        {!compact && (
          <div className="text-[8.5px] font-semibold uppercase tracking-[0.3em] text-faint mt-1">
            Competitive Operations
          </div>
        )}
      </div>
    </div>
  );
}

/** Big centered mark for the login screen — the full tribal-flame emblem. */
export function HeroMark({ size = 180 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <BrandImg size={size / 2.4} />;
  return (
    <img
      src="/brand/logo-full.png"
      alt="9 CLOVER"
      onError={() => setFailed(true)}
      className="mx-auto rounded-lg drop-shadow-[0_0_46px_rgba(0,0,0,0.9)] border border-edge/70"
      style={{ height: size, width: "auto" }}
      draggable={false}
    />
  );
}
