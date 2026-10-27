import { useState, useSyncExternalStore } from "react";
import { artFor, artVersion, subscribeArt } from "../lib/mlbb";

/** name → icon slug: "Yu Zhong" → yu-zhong, "Chang'e" → chang-e, "X.Borg" → x.borg */
export function heroSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, " ")
    .trim()
    .split(/\s+/)
    .join("-");
}

const localIcon = (name: string) => `/heroes/${heroSlug(name)}.webp`;

/** Chain: official CDN art → local icon → initials (never a broken image). */
function useHeroSrc(name: string, variant: "icon" | "art"): string | null {
  useSyncExternalStore(subscribeArt, artVersion); // re-render when the art index lands
  const remote = artFor(name);
  const preferred = variant === "art" ? (remote?.art ?? remote?.head) : (remote?.head ?? remote?.art);
  return preferred ?? null;
}

/** Hero portrait — official CDN artwork first, bundled icon fallback, initials last. */
export function HeroImg({ name, size = 40, className = "", eager = false, variant = "icon" }: {
  name: string; size?: number; className?: string; eager?: boolean; variant?: "icon" | "art";
}) {
  const remote = useHeroSrc(name || "", variant);
  const [failed, setFailed] = useState<0 | 1 | 2>(0);
  if (failed === 2 || !name) {
    return (
      <div
        className={`flex items-center justify-center bg-overlay border border-edge text-[10px] font-extrabold text-mute select-none ${className}`}
        style={{ width: size, height: size }}
        aria-label={name}
      >
        {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
      </div>
    );
  }
  const src = failed === 0 && remote ? remote : localIcon(name);
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed((f) => (f === 0 ? (remote ? 1 : 2) : 2))}
      className={`object-cover bg-raised select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
