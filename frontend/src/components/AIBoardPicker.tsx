import { Check, ClipboardList, Loader2, Map as MapIcon, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { AI_BOARD_LIMIT, shortDate, toggleBoardSelection, type AIBoardSummary } from "../lib/cloverAI";
import { ErrorNote } from "./ui";

type BoardKind = "draft" | "map";

function BoardList({ title, kind, boards, selected, filter, onToggle }: {
  title: string; kind: BoardKind; boards: AIBoardSummary[]; selected: AIBoardSummary[];
  filter: string; onToggle: (item: AIBoardSummary) => void;
}) {
  const term = filter.trim().toLocaleLowerCase();
  const filtered = boards.filter((board) => `${board.name} ${board.opponent}`.toLocaleLowerCase().includes(term));
  return <section className="min-w-0">
    <div className="flex items-center justify-between gap-2 mb-2"><h3 className="section-pill">{title}</h3><span className="text-[10px] text-mute font-bold">{selected.length} / {AI_BOARD_LIMIT}</span></div>
    <div className="space-y-1.5 max-h-52 overflow-y-auto overscroll-contain pr-0.5">
      {!filtered.length && <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-[11px] text-mute">{term ? "No saved boards match this search." : `No saved ${kind === "draft" ? "drafts" : "maps"} yet.`}</p>}
      {filtered.slice(0, 60).map((board) => {
        const active = selected.some((item) => item.id === board.id);
        return <button key={board.id} type="button" aria-pressed={active} disabled={!active && selected.length >= AI_BOARD_LIMIT} onClick={() => onToggle(board)}
          className={`w-full flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors disabled:opacity-40 ${active ? "border-leaf/40 bg-leaf/5" : "border-edge bg-raised/40 hover:border-edge-2"}`}>
          <span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold break-words">{board.name}</span>
            <span className="block text-[10px] text-mute mt-1">{board.opponent ? `${board.opponent} · ` : ""}Saved {shortDate(board.updated_at)}</span></span>
          <span className={`h-5 w-5 grid place-items-center shrink-0 rounded border ${active ? "border-leaf bg-leaf text-ink" : "border-edge-2"}`}>{active && <Check size={12} />}</span>
        </button>;
      })}
      {filtered.length > 60 && <p className="text-[10px] text-mute px-1">Showing 60 boards. Search to find another.</p>}
    </div>
  </section>;
}

export function AIBoardPicker({ initialDrafts, initialMaps, onApply, onCancel }: {
  initialDrafts: AIBoardSummary[]; initialMaps: AIBoardSummary[];
  onApply: (drafts: AIBoardSummary[], maps: AIBoardSummary[]) => void; onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<AIBoardSummary[]>(initialDrafts);
  const [maps, setMaps] = useState<AIBoardSummary[]>(initialMaps);
  const [availableDrafts, setAvailableDrafts] = useState<AIBoardSummary[]>([]);
  const [availableMaps, setAvailableMaps] = useState<AIBoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [consent, setConsent] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    Promise.all([api.get<AIBoardSummary[]>("/drafts"), api.get<AIBoardSummary[]>("/maps")])
      .then(([draftRows, mapRows]) => { if (active) { setAvailableDrafts(draftRows); setAvailableMaps(mapRows); } })
      .catch((err) => { if (active) setError(err); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const hasBoards = drafts.length + maps.length > 0;
  return <div className="space-y-4">
    <div className="flex gap-3 rounded-lg border border-leaf/20 bg-leaf/5 p-3">
      <ShieldCheck size={17} className="text-leaf shrink-0 mt-0.5" />
      <p className="text-[11px] text-mute leading-relaxed">Choose up to two saved drafts and two saved maps. Their latest saved contents and notes, including team edits, are sent to the external AI provider with your next message only. Unsaved edits and Archive items are not included.</p>
    </div>
    <label className="relative block"><span className="sr-only">Search saved boards</span><Search size={14} className="absolute left-3 top-3 text-mute pointer-events-none" />
      <input className="input !pl-9 !text-[12px]" maxLength={100} placeholder="Search board name or opponent…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {loading ? <p className="flex items-center gap-2 text-[11px] text-mute py-4"><Loader2 size={14} className="animate-spin" /> Loading saved boards…</p> :
      error ? <div><ErrorNote error={error} /><button type="button" className="text-[11px] text-leaf underline mt-2" onClick={() => setReload((value) => value + 1)}>Retry boards</button></div> :
        <div className="grid sm:grid-cols-2 gap-4"><BoardList title="Draft Lab" kind="draft" boards={availableDrafts} selected={drafts} filter={search} onToggle={(board) => { setDrafts((previous) => toggleBoardSelection(previous, board)); setConsent(false); }} />
          <BoardList title="Map Lab" kind="map" boards={availableMaps} selected={maps} filter={search} onToggle={(board) => { setMaps((previous) => toggleBoardSelection(previous, board)); setConsent(false); }} /></div>}
    {hasBoards && <label className="flex items-start gap-2 text-[11px] text-mute leading-relaxed cursor-pointer"><input type="checkbox" className="mt-0.5 accent-leaf" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
      <span>I agree to share the selected saved team boards and notes with the external AI provider for my next message.</span></label>}
    <p className="text-[10px] text-mute leading-relaxed">Selections clear when you send, switch chats or reload. Prior messages, backups or provider logs may still retain previously shared information.</p>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-ghost !text-[11px]" onClick={onCancel}>Cancel</button>
      <button type="button" className="btn-primary !text-[11px]" disabled={loading || Boolean(error) || (hasBoards && !consent)} onClick={() => onApply(drafts, maps)}>
        {hasBoards ? <><ClipboardList size={13} /> Use {drafts.length + maps.length} board{drafts.length + maps.length === 1 ? "" : "s"}</> : <><MapIcon size={13} /> Use no boards</>}
      </button></div>
  </div>;
}
