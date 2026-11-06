/** The official Absolute Genesis neon crown artwork. */
export const GENESIS_LOGO = '/brand/absolute-genesis-current.webp';

export type GenesisCrestProps = {
  /** Fixed artwork height in pixels, or null to size it with utility classes. */
  size?: number | null;
  className?: string;
  /** Decorative by default — pass a title to expose the artwork as an image. */
  title?: string;
};

/**
 * The visible product logo. Favicons and install icons intentionally keep
 * their own simplified sigil; this component is only for in-app branding.
 */
export function GenesisCrest({size = 42, className = '', title}: GenesisCrestProps) {
  return (
    <img
      src={GENESIS_LOGO}
      width={size ? Math.round(size * 1.5) : undefined}
      height={size ?? undefined}
      className={`shrink-0 object-contain ${className}`}
      alt={title || ''}
      aria-hidden={title ? undefined : true}
      draggable={false}
      decoding="async"
    />
  );
}

export default GenesisCrest;
