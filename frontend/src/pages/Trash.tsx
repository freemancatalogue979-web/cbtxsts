import { ArchiveRestore, Lock, Search, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, qs } from "../lib/api";
import { navItem } from "../lib/nav";
import type { User } from "../lib/types";
import { fmtStamp, navigate } from "../lib/util";
import { Empty, ErrorNote, PageTitle, Spinner } from "../components/ui";

export interface TrashEntry {
  id: number;
  kind: string;
  area: string;
  label: string;
  summary: string;
  target_id: string;
  deleted_at: string | null;
  deleted_by: { id: number; name: string } | null;
  restricted: boolean;
  rows: number;
  files: number;
  can_purge: boolean;
}

interface TrashList {
  items: TrashEntry[];
  areas: Record<string, number>;
  total: number;
}

interface Restored {
  id: number;
  label: string;
  area: string;
  target_id: string;
  warnings: string[];
}

function areaLabel(area: string): string {
  return navItem(area)?.label ?? area;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return "Something went wrong";
}

export function TrashPage({ me }: { me: User }) {
  const [data, setData] = useState<TrashList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [area, setArea] = useState<string>("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<number | "empty" | null>(null);
  const [problem, setProblem] = useState<{ id: number; text: string } | null>(null);
  const [restored, setRestored] = useState<Restored | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<TrashList>(`/trash${qs({ area: area || undefined, q: query.trim() || undefined })}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [area, query]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, query ? 220 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  const purgeable = useMemo(() => (data?.items ?? []).filter((it) => it.can_purge).length, [data]);
  const areas = useMemo(() => Object.entries(data?.areas ?? {}).sort((a, b) => b[1] - a[1]), [data]);

  async function restore(item: TrashEntry) {
    setBusy(item.id); setProblem(null); setRestored(null);
    try {
      const out = await api.post<Restored>(`/trash/${item.id}/restore`);
      setRestored(out);
      await load();
    } catch (err) {
      setProblem({ id: item.id, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function purge(item: TrashEntry) {
    if (!window.confirm(`Delete “${item.label}” forever? This one can't be brought back.`)) return;
    setBusy(item.id); setProblem(null);
    try {
      await api.del(`/trash/${item.id}`);
      await load();
    } catch (err) {
      setProblem({ id: item.id, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function emptyTrash() {
    const msg = me.role === "admin"
      ? `Delete ${purgeable} ${purgeable === 1 ? "item" : "items"} forever? Nothing in this list can be restored after that.`
      : `Delete your ${purgeable} private ${purgeable === 1 ? "item" : "items"} forever?`;
    if (!window.confirm(msg)) return;
    setBusy("empty"); setRestored(null);
    try {
      await api.del(`/trash?confirm=true`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Trash"
        sub="Nothing deleted is gone. It waits here, with everything that went with it, until someone restores it."
        right={purgeable > 0 && (
          <button type="button" className="btn-ghost" onClick={emptyTrash} disabled={busy !== null}>
            <Trash2 size={14} /> {busy === "empty" ? "Emptying…" : "Empty trash"}
          </button>
        )} />

      <div className="card p-3.5 flex items-start gap-3 text-[12px] text-mute leading-relaxed">
        <Lock size={15} className="text-crim shrink-0 mt-0.5" />
        <p>
          Private things (AI chats and memory, private archive drops, your own inbox) only show up for you. Shared
          things show for whoever deleted them and for admins.
          {me.role === "admin" ? " Only admins can delete shared things forever." : " Only admins can delete shared things forever, so a mistake can always be undone."}
        </p>
      </div>

      {restored && (
        <div className="card p-3.5 border-l-2 !border-l-leaf flex flex-wrap items-center gap-3" role="status">
          <ArchiveRestore size={16} className="text-leaf" />
          <span className="text-[12.5px] font-bold">Restored “{restored.label}”</span>
          {navItem(restored.area) && (
            <button type="button" className="btn-ghost !py-1 !px-2.5 !text-[11px] ml-auto"
              onClick={() => navigate(restored.area)}>Open {areaLabel(restored.area)}</button>
          )}
          {restored.warnings.length > 0 && (
            <ul className="basis-full text-[11.5px] text-amber space-y-0.5">
              {restored.warnings.map((w) => <li key={w}>· {w}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px] max-w-sm">
          <span className="sr-only">Search trash</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !pl-9" placeholder="Search trash" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by area">
          <button type="button" aria-pressed={!area} onClick={() => setArea("")}
            className={`chip ${!area ? "border-crim text-crim" : "text-mute"}`}>
            All · {data?.total ?? 0}
          </button>
          {areas.map(([id, n]) => {
            const Icon = navItem(id)?.icon;
            return (
              <button type="button" key={id} aria-pressed={area === id} onClick={() => setArea(area === id ? "" : id)}
                className={`chip ${area === id ? "border-crim text-crim" : "text-mute"}`}>
                {Icon && <Icon size={12} />} {areaLabel(id)} · {n}
              </button>
            );
          })}
        </div>
      </div>

      <ErrorNote error={error} />
      {!data && !error && <Spinner />}

      <div className="space-y-2">
        {(data?.items ?? []).map((item) => {
          const Icon = navItem(item.area)?.icon ?? Trash2;
          return (
            <article key={item.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="mt-0.5 w-9 h-9 rounded-lg border border-edge bg-raised grid place-items-center shrink-0 text-crim">
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-extrabold break-words">{item.label}</span>
                    {item.restricted && (
                      <span className="chip !text-[9.5px] text-amber border-amber/40 bg-amber/10"><Lock size={10} /> only you</span>
                    )}
                  </div>
                  {item.summary && <p className="text-[12px] text-mute mt-0.5 break-words">{item.summary}</p>}
                  <div className="text-[10.5px] text-faint mt-1">
                    {areaLabel(item.area)} · deleted {fmtStamp(item.deleted_at)}
                    {item.deleted_by ? ` by ${item.deleted_by.id === me.id ? "you" : item.deleted_by.name}` : ""}
                    {item.files ? ` · ${item.files} ${item.files === 1 ? "file" : "files"} kept` : ""}
                  </div>
                  {problem?.id === item.id && (
                    <p className="mt-1.5 text-[11.5px] text-danger flex items-start gap-1.5" role="alert">
                      <TriangleAlert size={13} className="shrink-0 mt-0.5" /> {problem.text}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <button type="button" className="btn-primary !py-1.5 !text-[12px]" disabled={busy !== null}
                  onClick={() => restore(item)} aria-label={`Restore ${item.label}`}>
                  <Undo2 size={13} /> {busy === item.id ? "Restoring…" : "Restore"}
                </button>
                {item.can_purge && (
                  <button type="button" className="btn-ghost !py-1.5 !text-[12px] hover:!text-danger" disabled={busy !== null}
                    onClick={() => purge(item)} aria-label={`Delete ${item.label} forever`}>
                    <Trash2 size={13} /> Delete forever
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {data && data.items.length === 0 && (
          <Empty title={query || area ? "Nothing matches" : "Trash is empty"}
            hint={query || area ? "Try another search or area." : "Anything deleted anywhere in the hub lands here and can be restored."} />
        )}
      </div>
    </div>
  );
}
