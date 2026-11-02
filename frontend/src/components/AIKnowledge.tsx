import { BookOpenText, ExternalLink, LibraryBig, Loader2, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { safeExternal, shortDate } from "../lib/cloverAI";
import type { AIKnowledgeResponse } from "../lib/cloverAI";
import { navigate } from "../lib/util";
import { ErrorNote } from "./ui";
import { HeroImg } from "./HeroImg";

export function AIKnowledge({ canModerate = false }: { canModerate?: boolean }) {
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<AIKnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null);
      api.get<AIKnowledgeResponse>(`/ai/knowledge${qs({ q: query })}`)
        .then((result) => { if (alive) setData(result); })
        .catch((e) => { if (alive) { setData(null); setError(e); } })
        .finally(() => { if (alive) setLoading(false); });
    }, query ? 250 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, revision]);

  async function removeNote(id: string) {
    if (!window.confirm("Remove this shared note from the AI knowledge library? It will no longer be retrieved in new answers.")) return;
    try { await api.del(`/ai/knowledge/${id}`); setRevision((value) => value + 1); }
    catch (e) { setError(e); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="section-pill section-pill--leaf">THE KNOWLEDGE BASE</div>
          <h2 className="text-xl font-extrabold mt-1">A library that grows with the squad.</h2>
          <p className="text-[12px] text-mute mt-1.5 leading-relaxed max-w-2xl">Search hero records and human-reviewed community notes. Your own taught memories are private and managed separately in chat.</p>
        </div>
        <LibraryBig size={25} className="text-leaf/70 hidden sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-edge bg-raised/60 px-4 py-3"><div className="label">Hero records</div><div className="text-lg font-extrabold mt-1">{data?.hero_count ?? "—"}</div><div className="text-[10px] text-faint">Historical snapshot</div></div>
        <div className="rounded-lg border border-edge bg-raised/60 px-4 py-3"><div className="label">Reviewed notes</div><div className="text-lg font-extrabold mt-1">{data?.community_count ?? "—"}</div><div className="text-[10px] text-faint">Community guidance</div></div>
      </div>
      <div className="rounded-lg border border-amber/25 bg-amber/5 p-3 text-[11px] text-mute leading-relaxed">
        <strong className="text-amber">Freshness matters.</strong> This library uses keyword search; the chat can also search the web when enabled. There is no verified live Original/Advanced patch feed or current-meta database here. Hero profiles were imported from <a href="https://mlbbdex.com/en/api-doc" target="_blank" rel="noreferrer noopener" className="text-text underline">MLBBDex / Mobile Legends Wiki</a> (CC BY-SA); the bundled source labels its snapshot 2.2.16, but its import date and server channel are unverified.
      </div>
      <label className="relative block">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <span className="sr-only">Search AI knowledge</span>
        <input className="input !pl-10" placeholder="Search a hero or topic..." maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ErrorNote error={error} />
      {loading && <div className="flex items-center gap-2 text-xs text-faint"><Loader2 size={14} className="animate-spin" /> Searching library…</div>}
      {!loading && data && (
        <div className="space-y-5">
          {data.heroes.length > 0 && <section>
            <div className="section-pill mb-2">Hero snapshots</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {data.heroes.map((hero) => <button key={hero.id} onClick={() => navigate(`heroes/${hero.id}`)}
                className="rounded-lg border border-edge hover:border-crim/40 bg-raised/50 text-left p-3 flex items-center gap-3 min-w-0 transition-colors">
                <HeroImg name={hero.name} size={42} className="rounded-md border border-edge" />
                <span className="min-w-0"><span className="block text-[13px] font-extrabold truncate">{hero.name}</span>
                  <span className="block text-[11px] text-mute mt-1">{[...hero.roles, ...hero.lanes].join(" · ") || "Profile details not recorded"}</span>
                  <span className="block text-[10px] text-faint mt-1">{hero.roles.length || hero.lanes.length ? "Historical snapshot" : "Local name only"} · tap for hero page</span></span>
              </button>)}
            </div>
          </section>}
          <section>
            <div className="section-pill mb-2">Reviewed community notes</div>
            {data.notes.length ? <div className="grid gap-2">{data.notes.map((note) => {
              const link = safeExternal(note.source_url);
              return <article key={note.id} className="rounded-lg border border-edge bg-raised/40 p-4 min-w-0">
                <div className="flex items-start gap-2"><BookOpenText size={15} className="text-leaf shrink-0 mt-0.5" /><h3 className="text-[13px] font-extrabold break-words">{note.title}</h3></div>
                <p className="text-[12px] text-mute leading-relaxed whitespace-pre-wrap break-words mt-2">{note.content}</p>
                <div className="flex flex-wrap gap-3 mt-3 text-[10px] font-semibold text-faint">
                  <span>Reviewed {shortDate(note.reviewed_at)} · not independently verified</span>
                  {link && <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-leaf hover:underline">Submitted source <ExternalLink size={11} /></a>}
                  {canModerate && <button type="button" onClick={() => void removeNote(note.id)} className="inline-flex items-center gap-1 text-faint hover:text-crim"><Trash2 size={11} /> Remove note</button>}
                </div>
              </article>;
            })}</div> : <div className="rounded-lg border border-dashed border-edge-2 bg-raised/20 px-4 py-6 text-center text-[12px] text-faint">
              {query ? "No reviewed note matches those keywords." : "No community notes published yet. Submit a contribution for review."}
            </div>}
          </section>
          {query && !data.heroes.length && !data.notes.length && <p className="text-[11px] text-faint">No matching saved sources. Try a hero name or another keyword.</p>}
        </div>
      )}
    </div>
  );
}
