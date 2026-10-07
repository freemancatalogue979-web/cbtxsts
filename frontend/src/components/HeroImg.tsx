import { useState } from "react";

/** name → icon slug: "Yu Zhong" → yu-zhong, "Chang'e" → chang-e, "X.Borg" → x.borg */
export function heroSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, " ")
    .trim()
    .split(/\s+/)
    .join("-");
}

/** Hero icon with initials fallback (never a broken image). */
export function HeroImg({ name, size = 40, className = "", eager = false }: {
  name: string; size?: number; className?: string; eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed || !name) {
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
      src={`/heroes/${heroSlug(name)}.webp`}
      alt={name}
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={`object-cover bg-raised select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
