import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowRight, CheckCircle2, History, CircleAlert, CircleHelp, Gamepad2, KeyRound, Link2, LogOut, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Badge, Empty, ErrorNote, Field, KV, PageTitle, SectionTitle, Spinner } from "../components/ui";
import { HeroImg } from "../components/HeroImg";
import { navigate } from "../lib/util";
import { accountCheck, accountHeroes, accountMatches, accountProfile, connectLink, disconnectLink, linkStatus, sendLinkCode } from "../lib/mlbb";
import type { AccountCheck, AnyRec, LinkStatus } from "../lib/mlbb";
import { recData, stripTags, pickNum, pickStr } from "../lib/mlbb";

function Wizard({ onLinked, roleId0, zoneId0, refresh }: { onLinked: () => void; roleId0?: number; zoneId0?: number; refresh?: boolean }) {
  const [roleId, setRoleId] = useState(roleId0 ? String(roleId0) : "");
  const [zoneId, setZoneId] = useState(zoneId0 ? String(zoneId0) : "");
  const [vc, setVc] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await sendLinkCode(Number(roleId), Number(zoneId));
      setHint(r.hint);
      setStep(2);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not send code"); }
    finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await connectLink(Number(roleId), Number(zoneId), vc.trim());
      onLinked();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Verification failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="card p-5 max-w-md space-y-4">
      <div className="flex items-center gap-2 text-leaf"><Link2 size={15} /><span className="section-pill section-pill--leaf">{refresh ? "Refresh your MLBB sign-in" : "Connect MLBB account"}</span></div>
      <p className="text-[12px] text-mute leading-relaxed">
        Straight from Moonton's own servers, same as the official MLBB site. You get a code in your in-game mail —
        <b>we never ask for your game password</b>. Codes expire in 5 minutes.
      </p>
      {step === 1 ? (
        <form onSubmit={sendCode} className="space-y-3">
          <Field label="Role ID" hint="Profile → long number shown next to your name">
            <input className="input" inputMode="numeric" required value={roleId} onChange={(e) => setRoleId(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Zone ID" hint="The smaller number in brackets, e.g. (1234)">
            <input className="input" inputMode="numeric" required value={zoneId} onChange={(e) => setZoneId(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <ErrorNote error={err} />
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send verification code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <div className="rounded-lg border border-leaf/40 bg-leaf-dim/30 p-3 text-[12px] text-leaf flex items-start gap-2">
            <KeyRound size={14} className="mt-0.5 shrink-0" /> {hint ?? "Code sent."}
          </div>
          <Field label="Code from your in-game mail">
            <input className="input tracking-[0.5em] text-center text-lg font-black" inputMode="numeric" required maxLength={8}
              value={vc} onChange={(e) => setVc(e.target.value.replace(/\D/g, ""))} placeholder="••••••" autoFocus />
          </Field>
          <ErrorNote error={err} />
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Verifying…" : "Link account"}</button>
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep(1); setErr(null); }}>← Change IDs / resend</button>
        </form>
      )}
    </div>
  );
}

type AccountCache = { observed_at?: string; status?: string; refreshing?: boolean; refresh_failed?: boolean };
function accountCache(payload: unknown): AccountCache | null {
  if (!payload || typeof payload !== "object") return null;
  const meta = (payload as AnyRec)._clover_cache;
  return meta && typeof meta === "object" ? meta as AccountCache : null;
}
function SnapshotNote({ payload }: { payload: unknown }) {
  const cache = accountCache(payload);
  if (!cache?.observed_at) return null;
  return <p className="text-[10px] text-mute mt-2" role="status">
    Saved {new Date(cache.observed_at).toLocaleString()} · {cache.status === "stale" ? "may be out of date" : "recent snapshot"}
    {cache.refreshing ? " · refreshing" : cache.refresh_failed ? " · refresh failed; saved data retained" : ""}
  </p>;
}

/** Whatever MLBB actually said, never a generic "couldn't reach". */
function reason(env: AnyRec): string {
  for (const k of ["msg", "message", "detail", "error"]) {
    const v = env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return `MLBB answered with code ${String(env.code)}`;
}

function Section({ title, payload, hide }: { title: string; payload: unknown; hide?: string[] }) {
  const env = payload as AnyRec | undefined;
  if (!env) return null;
  const why = failed(env);
  if (why) {
    return (
      <div className="card p-4">
        <div className="section-pill mb-1.5">{title}</div>
        <div className="text-[11.5px] text-faint break-words">{why}</div>
      </div>
    );
  }
  const hidden = new Set((hide ?? []).map((k) => k.toLowerCase()));
  const data = env.data;
  const flat: [string, string][] = [];
  const walk = (o: unknown, prefix = "") => {
    if (flat.length >= 12 || !o) return;
    if (["string", "number", "boolean"].includes(typeof o)) {
      if (hidden.has((prefix.split(".").pop() ?? "").toLowerCase())) return;
      flat.push([prefix.replace(/^\.|\.$/g, "").replace(/\./g, " · ") || "value", stripTags(String(o)).slice(0, 90)]);
      return;
    }
    if (Array.isArray(o)) return; // lists rendered elsewhere
    if (typeof o === "object") for (const [k, v] of Object.entries(o as AnyRec)) {
      if (k.startsWith("_")) continue;
      walk(v, `${prefix}.${k}`);
    }
  };
  walk(data);
  if (flat.length === 0) return null; // nothing beyond what the banner already shows
  const isImgUrl = (v: string) => /^https?:\/\//.test(v) && (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(v) || /face\/|akmpicture|youngjoygame/.test(v));
  return (
    <div className="card p-4">
      <div className="section-pill mb-2">{title}</div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {flat.slice(0, 12).map(([k, v]) =>
          isImgUrl(v) ? (
            <div key={k} className="flex items-center justify-between gap-4 py-1.5">
              <span className="label pt-0.5 shrink-0">{k}</span>
              <img src={v} alt={k} width={44} height={44} loading="lazy" referrerPolicy="no-referrer"
                className="rounded-lg border border-edge object-cover bg-raised"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          ) : (
            <KV key={k} k={k} v={v} />
          ))}
      </div>
      <SnapshotNote payload={payload} />
    </div>
  );
}

/** Premium identity banner — avatar as art, rank/level as chips, no raw URLs. */
function ProfileHeroCard({ status, info }: { status: LinkStatus; info: unknown }) {
  const env = info as AnyRec | undefined;
  const d = (env && env.code === 0 && typeof env.data === "object" && env.data ? env.data : {}) as AnyRec;
  const avatar = pickStr(d, "avatar") ?? status.avatar ?? "";
  const name = pickStr(d, "name") ?? status.name ?? "Linked account";
  const level = pickNum(d, "level") ?? null;
  const rank = pickNum(d, "rank_level") ?? null;
  const best = pickNum(d, "history_rank_level") ?? null;
  const country = (pickStr(d, "reg_country") ?? "").toUpperCase();
  const roleId = pickNum(d, "roleId", "role_id") ?? status.role_id;
  const zoneId = pickNum(d, "zoneId", "zone_id") ?? status.zone_id;
  return (
    <div className="card relative overflow-hidden border-leaf/40">
      <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-crim/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-20 w-64 h-64 rounded-full bg-leaf/10 blur-3xl" />
      <div className="relative p-5 flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt={name} width={84} height={84} referrerPolicy="no-referrer"
              className="rounded-2xl border-2 border-crim/60 shadow-[0_0_28px_rgba(225,29,72,0.35)] object-cover" />
          ) : (
            <span className="w-[84px] h-[84px] rounded-2xl border-2 border-edge-2 bg-raised grid place-items-center">
              <Gamepad2 size={30} className="text-faint" />
            </span>
          )}
          {level != null && (
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-crim text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap">
              Lv {level}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="section-pill section-pill--leaf mb-1">MLBB · Verified link</div>
          <div className="text-xl font-extrabold truncate">{name}</div>
          <div className="text-[11px] text-faint font-mono mt-0.5">ID {roleId} · Zone {zoneId}</div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {rank != null && <Badge cls="text-crim border-crim/50">Rank tier {rank}</Badge>}
            {best != null && <Badge cls="text-amber border-amber/50">Best {best}</Badge>}
            {country && <Badge cls="text-sky border-sky/50">{country}</Badge>}
          </div>
        </div>
        <Badge cls="text-leaf border-leaf/40">connected</Badge>
      </div>
      <div className="relative px-5 pb-3 text-[9.5px] text-faint">Tier values are the ladder index Moonton reports.<SnapshotNote payload={info} /></div>
    </div>
  );
}

function rowsOf(payload: unknown): AnyRec[] {
  const env = payload as AnyRec | undefined;
  const data = env && typeof env.data === "object" && env.data ? env.data as AnyRec : null;
  return data && Array.isArray(data.records) ? (data.records as AnyRec[]).filter((r) => r && typeof r === "object") : recData<AnyRec>(payload);
}
function failed(payload: unknown): string | null {
  const env = payload as AnyRec | undefined;
  if (!env) return null;
  const inner = env.data as AnyRec | undefined;
  if (inner && typeof inner.error === "string") return inner.error.replace(/^Error:\s*/, "");
  if (typeof env.error === "string") return env.error.replace(/^Error:\s*/, "");
  if (env.code != null && env.code !== 0) return reason(env);
  return null;
}

function HeroFace({ row, size = 40 }: { row: AnyRec; size?: number }) {
  const name = pickStr(row, "hero_name") ?? "";
  const icon = pickStr(row, "hero_icon");
  if (name) return <HeroImg name={name} size={size} />;
  return icon
    ? <img src={icon} alt="" width={size} height={size} referrerPolicy="no-referrer" className="rounded-lg border border-edge object-cover" />
    : <span className="rounded-lg border border-edge bg-raised" style={{ width: size, height: size }} />;
}

export function MatchList({ payload }: { payload: unknown }) {
  const rows = rowsOf(payload);
  const err = failed(payload);
  const meta = ((payload as AnyRec | undefined)?.data ?? {}) as AnyRec;
  const wins = rows.filter((r) => r.result === "win").length;
  return (
    <div className="mlbb-list">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SectionTitle>Recent games</SectionTitle>
        {rows.length > 0 && <span className="text-[11px] text-mute">{wins}W {rows.length - wins}L · {Math.round((100 * wins) / rows.length)}% won{typeof meta.season_id === "number" ? ` · season ${meta.season_id}` : ""}</span>}
      </div>
      <SnapshotNote payload={payload} />
      {err ? <div className="card p-4 mt-2 text-[11.5px] text-faint break-words">{err}</div>
        : rows.length === 0 ? <Empty title="No games this season yet" hint="Play a few and hit Refresh" /> : (
        <ul className="grid gap-2 mt-2">
          {rows.slice(0, 20).map((r, i) => {
            const win = r.result === "win";
            const when = pickNum(r, "match_time");
            return (
              <li key={String(r.match_id ?? i)} className={`mlbb-game card p-2.5 flex items-center gap-3 min-w-0 border-l-4 ${win ? "border-l-leaf" : "border-l-danger"}`}>
                <HeroFace row={r} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-bold truncate">{pickStr(r, "hero_name") ?? "Unknown hero"}</span>
                    {r.mvp === 1 && <Badge cls="text-amber border-amber/50">MVP</Badge>}
                  </div>
                  <div className="text-[11px] text-mute truncate">
                    {[pickStr(r, "lane"), when ? new Date(when * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] font-black tabular-nums">{pickNum(r, "kills") ?? 0}/{pickNum(r, "deaths") ?? 0}/{pickNum(r, "assists") ?? 0}</div>
                  <div className={`text-[10.5px] font-bold ${win ? "text-leaf" : "text-danger"}`}>{win ? "Victory" : "Defeat"}{typeof r.score === "number" ? ` · ${r.score.toFixed(1)}` : ""}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function HeroList({ payload }: { payload: unknown }) {
  const rows = rowsOf(payload);
  const err = failed(payload);
  const top = Math.max(1, ...rows.map((r) => Number(r.matches) || 0));
  return (
    <div className="mlbb-list">
      <SectionTitle>Most played heroes</SectionTitle>
      <SnapshotNote payload={payload} />
      {err ? <div className="card p-4 mt-2 text-[11.5px] text-faint break-words">{err}</div>
        : rows.length === 0 ? <Empty title="No heroes this season yet" hint="Play a few and hit Refresh" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-2">
          {rows.slice(0, 12).map((r, i) => {
            const games = Number(r.matches) || 0;
            const rate = typeof r.win_rate === "number" ? r.win_rate : null;
            return (
              <div key={String(r.hero_id ?? i)} className="mlbb-hero card p-3 flex items-center gap-3 min-w-0">
                <HeroFace row={r} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold truncate">{pickStr(r, "hero_name") ?? `Hero ${r.hero_id ?? ""}`}</div>
                  <div className="text-[11px] text-mute">{games} games{rate != null ? ` · ${rate}% won` : ""}</div>
                  <div className="h-1.5 rounded-full bg-raised mt-1.5 overflow-hidden">
                    <div className={`h-full rounded-full ${rate != null && rate < 50 ? "bg-danger" : "bg-leaf"}`} style={{ width: `${Math.max(6, (100 * games) / top)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Moonton retired the web battle report (30 Jun 2026). Say so once, point at what works. */
export function HistoryRetired() {
  return (
    <div className="mlbb-retired card p-5 border-sky/40 grid gap-3 max-w-3xl">
      <div className="flex items-center gap-2 text-sky"><History size={16} /><span className="section-pill">Game history</span></div>
      <p className="text-[13px] font-bold">MLBB doesn't share your games or stats outside the game any more.</p>
      <p className="text-[12px] text-mute leading-relaxed">
        Moonton switched off the web battle report on 30 June 2026 when it closed MLBB Academy. Every outside
        app and site lost it at the same time, the backup relay included. Your link still works for your name,
        level, rank and avatar, and those keep syncing.
      </p>
      <p className="text-[12px] text-mute leading-relaxed">
        To track games, drop screenshots of your match history or results in Utility. They're read for you and land in
        your hero pool and charts.
      </p>
      <div><button className="btn-primary" onClick={() => navigate("utility")}>Add games in Utility <ArrowRight size={14} /></button></div>
    </div>
  );
}

function CheckRow({ label, part }: { label: string; part?: { ok: boolean | null; detail: string; ms?: number } }) {
  if (!part) return null;
  const Icon = part.ok ? CheckCircle2 : part.ok === null ? CircleHelp : CircleAlert;
  return (
    <li className="flex items-start gap-2.5 min-w-0">
      <Icon size={15} className={`mt-0.5 shrink-0 ${part.ok ? "text-leaf" : part.ok === null ? "text-mute" : "text-danger"}`} />
      <div className="min-w-0">
        <div className="text-[12px] font-bold">{label}{part.ms != null ? <span className="text-faint font-normal"> · {part.ms} ms</span> : null}</div>
        <div className="text-[11.5px] text-mute break-words">{part.detail}</div>
      </div>
    </li>
  );
}

export function ConnectionCheck() {
  const [res, setRes] = useState<AccountCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await accountCheck()); } catch (e) { setErr(e instanceof Error ? e.message : "Check failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mlbb-check card p-4 max-w-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="section-pill">Connection check</div>
        <button className="btn-ghost" onClick={() => void run()} disabled={busy}><Activity size={14} /> {busy ? "Checking…" : "Check connection"}</button>
      </div>
      {!res && !err && <p className="text-[11.5px] text-mute mt-2">Tests whether this server can talk to Moonton, whether your sign-in still works, and whether the backup answers.</p>}
      <ErrorNote error={err} />
      {res && (
        <ul className="grid gap-2.5 mt-3">
          <CheckRow label="Moonton servers" part={res.moonton} />
          <CheckRow label="Your MLBB sign-in" part={res.session} />
          <CheckRow label="Game history from MLBB" part={res.battle_report} />
          <CheckRow label="Backup relay" part={res.backup} />
        </ul>
      )}
    </div>
  );
}

export function AccountMLBBPage() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [matches, setMatches] = useState<Record<string, unknown> | null>(null);
  const [heroes, setHeroes] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const st = await linkStatus();
      setStatus(st);
      if (st.linked) {
        const [p, m, h] = await Promise.all([
          accountProfile().catch((e) => ({ data: { error: String(e) } })),
          accountMatches(1, 20).catch((e) => ({ data: { error: String(e) } })),
          accountHeroes().catch((e) => ({ data: { error: String(e) } })),
        ]);
        setProfile(p); setMatches(m); setHeroes(h);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const needsRelink = Boolean(status?.linked && (status.session_expired
    || [profile?.info, profile?.season, profile?.stats, matches, heroes].some((p) => (p as AnyRec | undefined)?.relink === true)));
  const history = [profile?.season, profile?.stats, matches, heroes].filter(Boolean) as AnyRec[];
  const historyRetired = history.length > 0 && history.every((p) => p.offline === true);
  const refreshing = [profile?.info, profile?.season, profile?.stats, matches, heroes].some((item) => accountCache(item)?.refreshing);
  useEffect(() => {
    if (!refreshing) return;
    const timer = window.setTimeout(() => { void load(); }, 4000);
    return () => window.clearTimeout(timer);
  }, [refreshing, profile, matches, heroes, load]);

  const unlink = async () => {
    if (!confirm("Disconnect your MLBB account? Saved account snapshots and their AI-sharing consent are removed here; nothing is deleted upstream.")) return;
    try {
      await disconnectLink();
      setProfile(null); setMatches(null); setHeroes(null);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not disconnect."); }
  };

  if (busy && !status) return <Spinner label="Checking account link" />;

  return (
    <div className="space-y-6">
      <PageTitle title="My MLBB" sub="Straight from Moonton. Saved copies load first and refresh in the background; your sign-in stays on our server."
        right={status?.linked && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
            <button className="btn-ghost !text-crim" onClick={() => void unlink()}><Unplug size={14} /> Disconnect</button>
          </div>
        )} />
      <ErrorNote error={err} />

      {!status?.linked ? (
        <>
          <Wizard onLinked={() => void load()} />
          <ConnectionCheck />
          <div className="card p-4 max-w-md text-[12px] text-mute leading-relaxed flex items-start gap-2.5">
            <ShieldCheck size={15} className="text-leaf mt-0.5 shrink-0" />
            The code comes from Moonton's own in-game mail. Your MLBB sign-in lives only on our
            server, tied to your 9 Clover login — never in the browser, never in logs.
          </div>
        </>
      ) : (
        <>
          <ProfileHeroCard status={status} info={profile?.info} />

          {needsRelink && (
            <div className="mlbb-relink grid gap-3">
              <div className="card p-4 border-amber/50 text-[12px] text-amber flex items-start gap-2.5">
                <KeyRound size={15} className="mt-0.5 shrink-0" />
                <span>Your MLBB sign-in expired — Moonton only keeps it for about a day. Send a new code to refresh it; your saved games, heroes and sharing choice stay.</span>
              </div>
              <Wizard refresh roleId0={status.role_id} zoneId0={status.zone_id} onLinked={() => void load()} />
            </div>
          )}

          {profile && (
            <Section title="Profile details" payload={profile.info}
              hide={["avatar", "name", "level", "rank_level", "history_rank_level", "reg_country", "roleId", "zoneId", "role_id", "zone_id"]} />
          )}

          {historyRetired ? <HistoryRetired /> : (
            <>
              {profile && (
                <div className="grid lg:grid-cols-2 gap-4">
                  <Section title="Current season" payload={profile.season} />
                  <Section title="Career stats" payload={profile.stats} />
                </div>
              )}
              {heroes && <HeroList payload={heroes} />}
              {matches && <MatchList payload={matches} />}
            </>
          )}

          <ConnectionCheck />

          <div className="text-[11px] text-faint flex items-center gap-1.5">
            <LogOut size={11} /> Disconnect removes your saved account snapshots, AI-sharing consent and stored token. Upstream logout is attempted.
          </div>
        </>
      )}
    </div>
  );
}
