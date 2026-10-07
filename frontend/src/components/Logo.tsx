/** 9 CLOVER brand mark — sharp clover glyph + wordmark. */
export function CloverMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect width="48" height="48" rx="8" fill="#101015" stroke="#2b2b35" />
      {/* nine tile */}
      <path d="M13 6h22a3 3 0 0 1 3 3v9h-4.8V9.5H13V6Z" fill="#e11d48" />
      {/* clover: three leaves + stem, subtle green */}
      <g fill="#34d399">
        <ellipse cx="18.5" cy="18" rx="5" ry="5.6" transform="rotate(-28 18.5 18)" />
        <ellipse cx="29.5" cy="18" rx="5" ry="5.6" transform="rotate(28 29.5 18)" />
        <ellipse cx="24" cy="26.5" rx="5.2" ry="6" />
      </g>
      <path d="M24 31c0 4.5-1.8 7.5-4.5 9.5l2 2c3.7-2.5 5.5-6.8 5.5-11.5h-3Z" fill="#34d399" />
      {/* notch to read as IX/9 hybrid */}
      <rect x="13" y="33" width="4.6" height="9" rx="1.5" fill="#e11d48" opacity="0.9" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <CloverMark size={compact ? 26 : 30} />
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
