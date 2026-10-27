import { useState, useSyncExternalStore } from "react";
import { artFor, artVersion, heroArt, heroHead, heroSlug, subscribeArt } from "../lib/mlbb";

export { heroSlug };

/** Candidate chain (local DB first, Rone CDN as backup):
 *  icon → bundled square head → Rone head;  art → bundled splash portrait → Rone art. */
function useHeroCandidates(name: string, variant: "icon" | "art"): string[] {
  useSyncExternalStore(subscribeArt, artVersion); // re-render when the art index lands
  const remote = artFor(name);
  const list = variant === "art"
    ? [heroArt(name), remote?.art]
    : [heroHead(name), remote?.head];
  return list.filter((u): u is string => Boolean(u));
}

/** Hero portrait — bundled official artwork, Rone CDN backup, initials tile last. */
export function HeroImg({ name, size = 40, className = "", eager = false, variant = "icon" }: {
  name: string; size?: number; className?: string; eager?: boolean; variant?: "icon" | "art";
}) {
  const candidates = useHeroCandidates(name || "", variant);
  const [failed, setFailed] = useState(0);
  if (failed >= candidates.length || !name) {
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
  return (
    <img
      src={candidates[failed]}
      alt={name}
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed((f) => f + 1)}
      className={`object-cover bg-raised select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
