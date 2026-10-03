/** Absolute Genesis brand mark: the AG crest under a rising star, violet and gold. */
import {useIsDesktop} from '../lib/viewport';
import type React from 'react';

/**
 * The Absolute Genesis crest — rising star, AG shield and open book — as the brand mark.
 * Pass a number for a fixed pixel size, or `size={null}` to size the crest with
 * responsive utility classes (used by the app header so it scales per breakpoint).
 */
export function LogoMark({size = 42, className = ''}: {size?: number | null; className?: string}) {
  return (
    <img
      src="/brand/ag-logo.webp"
      alt=""
      width={size ?? undefined}
      height={size ?? undefined}
      draggable={false}
      className={`shrink-0 object-contain drop-shadow-[0_6px_16px_rgba(250,204,21,0.25)] ${className}`}
      style={size ? {width: size, height: size} : undefined}
    />
  );
}

export function Wordmark({
  size = 'md',
  tagline = false,
  taglineClassName = '',
  className = '',
}: {
  size?: 'sm' | 'header' | 'brand' | 'md' | 'lg';
  tagline?: boolean;
  taglineClassName?: string;
  className?: string;
}) {
  const sizes: Record<'sm' | 'header' | 'brand' | 'md' | 'lg', {mark: number | null; markClass: string; tag: string}> = {
    sm: {mark: 46, markClass: '', tag: 'text-[0.5rem] sm:text-[0.6rem]'},
    // Bigger crest for the app header — grows with the viewport, never clipped.
    header: {mark: null, markClass: 'h-11 w-11 sm:h-14 sm:w-14 lg:h-15 lg:w-15', tag: 'text-[0.6rem] sm:text-[0.66rem]'},
    // The brand crest on the public pages: owns the top-left corner.
    brand: {mark: null, markClass: 'h-13 w-13 sm:h-18 sm:w-18 lg:h-22 lg:w-22', tag: 'text-[0.6rem] sm:text-[0.7rem] lg:text-[0.78rem]'},
    md: {mark: 52, markClass: '', tag: 'text-[0.62rem] sm:text-[0.66rem]'},
    lg: {mark: 88, markClass: '', tag: 'text-[0.7rem] sm:text-[0.78rem]'},
  };
  const s = sizes[size];
  // The header brand block is desktop-only. On phones the crest + wordmark
  // crowd the chrome; we leave the right-side controls to own the top bar.
  const desktop = useIsDesktop();
  if (!desktop) {
    // Public pages on a phone: a compact crest + name so the brand is never missing
    // (the hero art carries no lettering). In-app headers stay clean on phones.
    if (size !== 'brand') return null;
    return (
      <div className={`flex min-w-0 shrink items-center gap-2 ${className}`}>
        <img src="/brand/ag-crest.webp" alt="" width={36} height={34} draggable={false} className="h-9 w-auto shrink-0 object-contain" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-display text-[0.9rem] font-black tracking-[0.06em] text-mist-50">Absolute Genesis</span>
          {tagline && <span className="block truncate text-[0.6rem] font-bold tracking-[0.08em] text-mist-500">A completely new beginning</span>}
        </span>
      </div>
    );
  }
  return (
    <div className={`flex min-w-0 shrink items-center gap-2 sm:gap-3 ${className}`}>
      <LogoMark size={s.mark} className={s.markClass} />
      <span className="sr-only">Absolute Genesis</span>
      {tagline && (
 <p className={`${s.tag} min-w-0 truncate font-bold tracking-[0.26em] text-mist-500 ${taglineClassName}`}>
          A completely new beginning
        </p>
      )}
    </div>
  );
}

/**
 * The official brand lockup: crest in a rotating ray halo, the two-tone
 * ABSOLUTE GENESIS wordmark and the tagline between gold rules. Pure markup;
 * styles live in index.css (.agb-*). Shows on phones and desktops alike.
 */
export function BrandLockup({className = '', tagline = true}: {className?: string; tagline?: boolean}) {
  return (
    <div className={`agb-lockup ${className}`} aria-label="Absolute Genesis">
      <span className="agb-crest" aria-hidden="true">
        <span className="agb-crest-rays" />
        <span className="agb-crest-ring" />
        <img src="/brand/ag-logo.webp" alt="" width={616} height={629} draggable={false} />
      </span>
      <span className="agb-words">
        <span className="agb-name">
          Absolute <b>Genesis</b>
        </span>
        {tagline && (
          <span className="agb-tag">
            <i aria-hidden="true" />A completely new beginning
          </span>
        )}
      </span>
    </div>
  );
}

/** Floating glass brand bar for the public pages (landing, sign-in). */
export function BrandBar({left, children, className = ''}: {left?: React.ReactNode; children?: React.ReactNode; className?: string}) {
  return (
    <header className={`agb-header safe-top ${className}`}>
      <div className="agb-bar">
        <span className="agb-bar-glint" aria-hidden="true" />
        {left}
        <BrandLockup />
        {children && <div className="agb-actions">{children}</div>}
      </div>
    </header>
  );
}

/** Coins + diamonds in one HUD pill — always visible in the top bar. */
export function WalletPill({coins, diamonds, className = '', onClick}: {coins: number; diamonds: number; className?: string; onClick?: () => void}) {
  const fmt = (n: number) => (n >= 100000 ? `${Math.round(n / 1000)}k` : n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : n.toLocaleString());
  const body = (
    <>
      <span className="wallet-seg" data-k="coins" title={`${coins.toLocaleString()} coins`}>
        <span className="wallet-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v9M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5h-2.5a1.75 1.75 0 0 0 0 3.5H14.5" /></svg>
        </span>
        <b>{fmt(coins)}</b>
      </span>
      <i className="wallet-div" aria-hidden="true" />
      <span className="wallet-seg" data-k="gems" title={`${diamonds.toLocaleString()} diamonds`}>
        <span className="wallet-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z" /><path d="M2 9h20M12 21 8 9l4-6 4 6z" /></svg>
        </span>
        <b>{fmt(diamonds)}</b>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={`wallet-pill ${className}`} onClick={onClick} aria-label={`${coins} coins, ${diamonds} diamonds`}>
      {body}
    </button>
  ) : (
    <span className={`wallet-pill ${className}`} aria-label={`${coins} coins, ${diamonds} diamonds`}>
      {body}
    </span>
  );
}
