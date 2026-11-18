import { useState } from "react";

/** Avatar with fallback initials tile. */
export function AvatarImg({ user, size = 36, className = "" }: {
  user: { ign?: string; name: string; avatar?: string | null }; size?: number; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // The first two characters exactly as the member typed them (symbols and letter case kept).
  const label = Array.from(user.ign || user.name || "?").slice(0, 2).join("");
  if (!user.avatar || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-crim-dim border border-crim/40 ign text-crim select-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
      >
        {label}
      </div>
    );
  }
  return (
    <img
      src={user.avatar}
      alt={user.ign || user.name}
      width={size} height={size}
      onError={() => setFailed(true)}
      draggable={false}
      className={`rounded object-cover bg-raised border border-edge select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
