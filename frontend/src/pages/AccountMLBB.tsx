import { useCallback, useEffect, useState } from "react";
import { Gamepad2, KeyRound, Link2, LogOut, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Badge, Empty, ErrorNote, Field, KV, PageTitle, SectionTitle, Spinner } from "../components/ui";
import { accountHeroes, accountMatches, accountProfile, connectLink, disconnectLink, linkStatus, sendLinkCode } from "../lib/mlbb";
import type { AnyRec, LinkStatus } from "../lib/mlbb";
import { recData, stripTags, pickNum, pickStr } from "../lib/mlbb";

function Wizard({ onLinked }: { onLinked: () => void }) {
  const [roleId, setRoleId] = useState("");
  const [zoneId, setZoneId] = useState("");
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
      <div className="flex items-center gap-2 text-leaf"><Link2 size={15} /><span className="label !text-[10px] !text-current">Connect MLBB account</span></div>
      <p className="text-[12px] text-mute leading-relaxed">
        Uses the official in-game mail verification — <b>we never ask for your game password</b>. You need access to
        the account's in-game mailbox. Codes expire in 5 minutes.
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
          <Field label="6-digit code">
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

function Section({ title, payload, hide }: { title: string; payload: unknown; hide?: string[] }) {
  const env = payload as AnyRec | undefined;
  if (!env) return null;
  if (typeof env.error === "string" || (typeof env.code === "number" && env.code !== 0)) {
    return (
      <div className="card p-4">
        <div className="label mb-1.5">{title}</div>
        <div className="text-[11.5px] text-faint">Unavailable right now (upstream endpoint deprecated or offline).</div>
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
  const isImgUrl = (v: string) => /^https?:\/\//.test(v) && (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(v) || /face\/|akmpicture|youngjoygame/.test(v));
  return (
    <div className="card p-4">
      <div className="label mb-2">{title}</div>
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
      {flat.length === 0 && <div className="text-[11.5px] text-faint">No further fields.</div>}
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
          <div className="text-[10px] uppercase tracking-[0.22em] text-leaf font-bold mb-1">MLBB · Verified link</div>
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
      <div className="relative px-5 pb-3 text-[9.5px] text-faint">Tier values are the official ladder index as reported upstream.</div>
    </div>
  );
}

function ListSection({ title, payload, heroNames }: { title: string; payload: unknown; heroNames: (d: AnyRec) => string | undefined }) {
  const rows = recData<AnyRec>(payload);
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? <Empty title="Nothing returned" hint="Upstream may not expose this yet" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {rows.slice(0, 12).map((r, i) => {
            const label = heroNames(r) ?? pickStr(r, "name", "title", "mode") ?? `Entry ${i + 1}`;
            const stats = Object.entries(r).filter(([k, v]) => ["number"].includes(typeof v) && !k.startsWith("_")).slice(0, 3);
            return (
              <div key={i} className="card p-3.5">
                <div className="text-[13px] font-bold truncate mb-1.5">{label}</div>
                <div className="space-y-0.5">
                  {stats.map(([k, v]) => <KV key={k} k={k.replace(/_/g, " ")} v={String(v)} />)}
                </div>
              </div>
            );
          })}
        </div>
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
          accountMatches(1, 10).catch((e) => ({ data: { error: String(e) } })),
          accountHeroes().catch((e) => ({ data: { error: String(e) } })),
        ]);
        setProfile(p); setMatches(m); setHeroes(h);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const unlink = async () => {
    if (!confirm("Disconnect your MLBB account? Your stats stop syncing (nothing is deleted upstream).")) return;
    await disconnectLink().catch(() => null);
    setProfile(null); setMatches(null); setHeroes(null);
    void load();
  };

  if (busy && !status) return <Spinner label="Checking account link" />;

  return (
    <div className="space-y-6">
      <PageTitle title="My MLBB" sub="Link your in-game account via mail verification — privacy-first, tokens stay server-side."
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
          <div className="card p-4 max-w-md text-[12px] text-mute leading-relaxed flex items-start gap-2.5">
            <ShieldCheck size={15} className="text-leaf mt-0.5 shrink-0" />
            Verification goes through the official in-game mail flow upstream. Your session token lives only on our
            server, tied to your 9 CLOVER login — never in the browser, never in logs.
          </div>
        </>
      ) : (
        <>
          <ProfileHeroCard status={status} info={profile?.info} />

          {profile && (
            <div className="grid lg:grid-cols-3 gap-4">
              <Section title="Profile details" payload={profile.info}
                hide={["avatar", "name", "level", "rank_level", "history_rank_level", "reg_country", "roleId", "zoneId", "role_id", "zone_id"]} />
              <Section title="Current season" payload={profile.season} />
              <Section title="Career stats" payload={profile.stats} />
            </div>
          )}

          {heroes && <ListSection title="Most played heroes" payload={heroes}
            heroNames={(d) => pickStr(d, "hero_name", "name") ?? (pickNum(d, "hero_id", "heroid") ? `Hero #${pickNum(d, "hero_id", "heroid")}` : undefined)} />}

          {matches && <ListSection title="Recent matches" payload={matches}
            heroNames={(d) => pickStr(d, "hero_name", "result") ?? (pickNum(d, "match_time", "time") ? new Date(Number(pickNum(d, "match_time", "time")) * 1000).toLocaleDateString() : undefined)} />}

          <div className="text-[11px] text-faint flex items-center gap-1.5">
            <LogOut size={11} /> Disconnect revokes your session upstream and wipes the stored token from our database.
          </div>
        </>
      )}
    </div>
  );
}
