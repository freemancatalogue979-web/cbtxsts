/** Quiz Arena brand mark: gradient badge, arena ring and bolt, red → purple → blue. */
import {useIsDesktop} from '../lib/viewport';

/**
 * The uploaded Quiz Arena crest — crown, shield and bolt — as the brand mark.
 * Pass a number for a fixed pixel size, or `size={null}` to size the crest with
 * responsive utility classes (used by the app header so it scales per breakpoint).
 */
export function LogoMark({size = 42, className = ''}: {size?: number | null; className?: string}) {
  return (
    <img
      src="/brand/logo.webp"
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
  if (!desktop) return null;
  return (
    <div className={`flex min-w-0 shrink items-center gap-2 sm:gap-3 ${className}`}>
      <LogoMark size={s.mark} className={s.markClass} />
      <span className="sr-only">Quiz Arena</span>
      {tagline && (
 <p className={`${s.tag} min-w-0 truncate font-bold tracking-[0.26em] text-mist-500 ${taglineClassName}`}>
          Compete · Conquer · Climb
        </p>
      )}
    </div>
  );
}
