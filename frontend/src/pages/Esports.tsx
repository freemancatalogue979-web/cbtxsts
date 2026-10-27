import { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { Empty, ErrorNote, PageTitle, Spinner, Tabs } from "../components/ui";
import { intelRaw, type AnyRec } from "../lib/mlbb";

const REGIONS = [
  { id: "id", label: "Indonesia", league: "MPL ID" },
  { id: "ph", label: "Philippines", league: "MPL PH" },
  { id: "my", label: "Malaysia", league: "MPL MY" },
  { id: "kh", label: "Cambodia", league: "MPL KH" },
];

/** Pull a displayable list out of whatever shape the region returns. */
function extractRows(payload: unknown): AnyRec[] {
  const data = (payload as AnyRec)?.data;
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as AnyRec[];
  if (data && typeof data === "object") {
    const rec = data as AnyRec;
    for (const key of ["records", "matches", "schedule", "standings", "rows", "list", "data"]) {
      const v = rec[key];
      if (Array.isArray(v)) {
        return (v as AnyRec[]).map((x) => (x && typeof x === "object" && typeof (x as AnyRec).data === "object"
          ? ({ ...(x as AnyRec), ...((x as AnyRec).data as AnyRec) } as AnyRec) : x)) as AnyRec[];
      }
    }
    // single object → field rows
    return [rec];
  }
  return [];
}

function RowCard({ row }: { row: AnyRec }) {
  const primitives = Object.entries(row)
    .filter(([, v]) => ["string", "number"].includes(typeof v) && String(v).length < 120)
    .filter(([k]) => !k.startsWith("_"))
    .slice(0, 8);
  const title = (["team1", "home", "team_a", "name", "title", "team"] as const).map((k) => row[k]).find(Boolean) as string | undefined;
  const vs = (["team2", "away", "team_b", "opponent"] as const).map((k) => row[k]).find(Boolean) as string | undefined;
  return (
    <div className="card p-3.5">
      {(title || vs) && (
        <div className="text-[13px] font-extrabold mb-2">
          {title ?? "—"}{vs ? <span className="text-faint font-bold"> <span className="text-crim">vs</span> {vs}</span> : null}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {primitives.slice(title || vs ? 0 : 0).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 text-[11px]">
            <dt className="text-faint truncate">{k.replace(/_/g, " ")}</dt>
            <dd className="font-semibold text-right truncate">{String(v)}</dd>
          </div>
        ))}
      </dl>
      {primitives.length === 0 && !title && <div className="text-[11px] text-faint">Entry without displayable fields.</div>}
    </div>
  );
}

export function EsportsPage() {
  const [region, setRegion] = useState("ph");
  const [view, setView] = useState("schedule");
  const [rows, setRows] = useState<AnyRec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true); setErr(null); setRows(null);
    intelRaw<Record<string, unknown>>(`esports/${region}/${view}`)
      .then((d) => { if (live) setRows(extractRows(d)); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : "Failed"); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [region, view]);

  const league = useMemo(() => REGIONS.find((r) => r.id === region)?.league ?? region.toUpperCase(), [region]);

  return (
    <div className="space-y-5">
      <PageTitle title="Esports" sub="MPL schedules, standings and playoff brackets — community Rone Arena dataset." />
      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map((r) => (
          <button key={r.id} onClick={() => setRegion(r.id)}
            className={`chip ${region === r.id ? "border-leaf/60 text-leaf bg-leaf-dim/40" : "text-faint"}`}>
            <Globe2 size={11} /> {r.league}
          </button>
        ))}
      </div>
      <Tabs value={view} onChange={setView} tabs={[
        { id: "schedule", label: "Schedule" },
        { id: "standings", label: "Standings" },
        { id: "playoffs", label: "Playoffs" },
      ]} />
      <ErrorNote error={err && `${err} — upstream may be unreachable from this host, or the ${league} season may be on break.`} />
      {busy && <Spinner label={`Loading ${league} ${view}`} />}
      {!busy && !err && rows && rows.length === 0 && (
        <Empty title={`No ${view} data for ${league} right now`} hint="Off-season or the upstream feed is empty" />
      )}
      {!busy && rows && rows.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r, i) => <RowCard key={i} row={r} />)}
        </div>
      )}
      <p className="text-[10.5px] text-faint leading-relaxed border-t border-edge/60 pt-3">
        Community data feed — fixtures/results only when the season feed provides them; not official Moonton/MPL output.
      </p>
    </div>
  );
}
