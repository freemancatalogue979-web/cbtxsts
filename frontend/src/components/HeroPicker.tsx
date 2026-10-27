import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Hero } from "../lib/types";
import { Modal } from "./ui";
import { HeroImg } from "./HeroImg";

const LANES = ["", "EXP", "GOLD", "MID", "ROAM", "JUNGLE"] as const;
const STATUS_RANK: Record<string, number> = { META: 0, STRONG: 1, VIABLE: 2, SITUATIONAL: 3, WEAK: 4 };

/**
 * Hero picker modal — replaces every hero <select>. Search + lane filter + tiles with art.
 * `value` is the hero id (number | ""), `onChange` gets "" when cleared.
 * Pass `allowCustom` to offer a "+ Custom / not in database" action returning -1 semantics:
 * when customChosen is true the parent keeps its old free-text flow.
 */
export function HeroPickerModal({ heroes, value, onChange, onCustom, placeholder = "Pick a hero…", disabled = false }: {
  heroes: Hero[];
  value: number | "";
  onChange: (id: number | "") => void;
  /** when set, the modal shows a "custom / not in database" choice which calls this */
  onCustom?: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<string>("");
  const sel = heroes.find((h) => String(h.id) === String(value));
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byLane = lane ? heroes.filter((h) => (h.role ?? "").toUpperCase() === lane) : heroes;
    const pool = needle ? byLane.filter((h) => h.name.toLowerCase().includes(needle)) : byLane;
    return [...pool].sort((a, b) =>
      (STATUS_RANK[a.meta_status] ?? 9) - (STATUS_RANK[b.meta_status] ?? 9) ||
      b.clover_rating - a.clover_rating || a.name.localeCompare(b.name));
  }, [heroes, q, lane]);
  const pick = (h: Hero) => {
    onChange(h.id);
    setOpen(false);
    setQ("");
  };
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}
        className="input !py-2 flex items-center gap-2.5 text-left w-full disabled:opacity-60">
        {sel ? (
          <>
            <HeroImg name={sel.name} size={26} className="rounded" />
            <span className="text-[13px] font-bold truncate">{sel.name}</span>
            <span className="chip !text-[8.5px] border-edge-2 text-faint ml-auto shrink-0">{sel.role}</span>
          </>
        ) : (
          <span className="text-faint text-[13px]">{placeholder}</span>
        )}
      </button>
      {open && (
        <Modal title={placeholder} onClose={() => { setOpen(false); setQ(""); }}>
          <div className="space-y-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input autoFocus className="input !pl-8 !py-2" placeholder="Search heroes…"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANES.map((l) => (
                <button key={l || "all"} type="button" onClick={() => setLane(l)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border transition ${
                    lane === l ? "border-crim/60 bg-crim-dim/40 text-crim" : "border-edge text-faint hover:text-mute"}`}>
                  {l || "All lanes"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[46vh] overflow-y-auto pr-1">
              {list.map((h) => (
                <button key={h.id} type="button" onClick={() => pick(h)}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition text-center
                    ${String(h.id) === String(value)
                      ? "border-crim/60 bg-crim-dim/30"
                      : "border-[#C8AA6E]/10 bg-[#111111] hover:border-[#C8AA6E]/40 hover:brightness-110"}`}>
                  <HeroImg name={h.name} size={52} className="rounded-md !w-13 !h-13" />
                  <span className="text-[10px] font-bold leading-tight truncate w-full">{h.name}</span>
                  <span className="text-[8px] text-faint uppercase tracking-wide -mt-0.5">{h.role}</span>
                </button>
              ))}
              {list.length === 0 && (
                <div className="col-span-full text-center text-[11px] text-faint py-6">No heroes match.</div>
              )}
            </div>
            {onCustom && (
              <button type="button" onClick={() => { onCustom(); setOpen(false); }}
                className="btn-ghost w-full !text-[11px]">＋ Custom / not in database</button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
