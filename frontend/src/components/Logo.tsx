import { useState } from "react";

/** 9 CLOVER brand mark: the glossy four-leaf "9" emblem + wordmark.
 *
 * All brand files are generated from frontend/public/brand/logo-source.png by
 * scripts/make-brand.py. The SVG mark below is only an offline fallback. */
const CANDIDATES = ["/brand/logo.png", "/brand/logo.webp", "/brand/logo.svg", "/brand/logo.jpg"];

export function CloverMark({ size = 28 }: { size?: number }) {
  // Simplified offline stand-in for the glossy four-leaf "9" emblem.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <g fill="#f2f4f8" stroke="#000" strokeWidth="1.2">
        <path d="M24 21c-6-2-9-7-6.5-11 2.2-3.4 5.5-2.6 6.5.5 1-3.1 4.3-3.9 6.5-.5C33 14 30 19 24 21Z" />
        <path d="M22 24c-2-6-7-9-11-6.5-3.4 2.2-2.6 5.5.5 6.5-3.1 1-3.9 4.3-.5 6.5C15 33 20 30 22 24Z" />
        <path d="M26 24c2-6 7-9 11-6.5 3.4 2.2 2.6 5.5-.5 6.5 3.1 1 3.9 4.3.5 6.5C33 33 28 30 26 24Z" />
        <path d="M25.5 29 20 44h2.6l5.4-15Z" />
      </g>
      <path d="m24 17.5 5 2.9v5.8l-3.6 2.1L22 34h-2.7l3.2-5.6-3.5-2.1v-5.9Z" fill="#f2f4f8" stroke="#000" strokeWidth="1" />
      <path d="m24 21 2 1.2v2.4L24 25.8l-2-1.2v-2.4Z" fill="#000" />
    </svg>
  );
}

export function BrandImg({ size, className = "", rounded = "rounded" }: { size: number; className?: string; rounded?: string }) {
  const [idx, setIdx] = useState(0);
  if (idx >= CANDIDATES.length) return <CloverMark size={size} />;
  return (
    <img
      src={CANDIDATES[idx]}
      alt="9 CLOVER"
      width={size}
      height={size}
      onError={() => setIdx((i) => i + 1)}
      className={`${rounded} object-contain ${className}`}
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
      </div>
    </div>
  );
}

/** Big centered emblem for the login screen, floating over the live backdrop. */
export function HeroMark({ size = 180 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <BrandImg size={size / 2.4} />;
  return (
    <img
      src="/brand/logo-full.png"
      alt="9 CLOVER"
      onError={() => setFailed(true)}
      className="brand-emblem mx-auto"
      style={{ height: size, width: "auto" }}
      draggable={false}
    />
  );
}
