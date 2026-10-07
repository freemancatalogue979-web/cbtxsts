import { BellRing, CheckCheck, Megaphone, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { NoticeItem, User } from "../lib/types";
import { Empty, ErrorNote, Field, PageTitle, SectionTitle, Spinner } from "../components/ui";

const STAFF = ["admin", "captain", "coach", "analyst"];
const ROLE_GROUPS = [
  { id: "player", label: "All players" },
  { id: "captain", label: "Captains" },
  { id: "coach", label: "Coaches" },
  { id: "analyst", label: "Analysts" },
];

function refreshBadge() {
  window.dispatchEvent(new Event("clover:notifications-changed"));
}

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function AnnounceComposer({ onSent }: { onSent: () => void }) {
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "role" | "user">("all");
  const [role, setRole] = useState("player");
  const [targetUser, setTargetUser] = useState("");
  const [roster, setRoster] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.get<User[]>("/players").then(setRoster).catch(() => setRoster([])); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setSent(null);
    try {
      const res = await api.post<{ sent: number }>("/notifications/send", {
        body: body.trim(), audience,
        role: audience === "role" ? role : undefined,
        user_id: audience === "user" ? Number(targetUser) : undefined,
      });
      setSent(res.sent);
      setBody("");
      onSent();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <SectionTitle><Megaphone size={14} className="text-crim mr-1.5 inline -mt-0.5" />Send announcement</SectionTitle>
      <form onSubmit={send} className="card p-4 space-y-3.5">
        <div className="flex flex-wrap gap-1.5">
          {([["all", "Everyone"], ["role", "Role group"], ["user", "One person"]] as const).map(([id, label]) => (
            <button type="button" key={id}
              className={`chip !cursor-pointer !text-[10px] uppercase ${audience === id ? "border-crim/50 text-crim bg-crim/10" : "text-faint border-edge"}`}
              onClick={() => setAudience(id)}>{label}</button>
          ))}
          {audience === "role" && (
            <select className="input !w-auto !py-1 !text-[12px] ml-1" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          )}
          {audience === "user" && (
            <select className="input !w-auto !py-1 !text-[12px] ml-1" value={targetUser} onChange={(e) => setTargetUser(e.target.value)} required>
              <option value="">Pick a player…</option>
              {roster.map((u) => <option key={u.id} value={u.id}>{u.ign} — {u.main_role || u.role_label}</option>)}
            </select>
          )}
        </div>
        <Field label={`Message (${body.length}/600)`}>
          <textarea className="input min-h-20" maxLength={600} required value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Practice moved to 21:00. Reps before scrims, VOD mandatory after…" />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary !py-2" disabled={busy || !body.trim()}>
            <Send size={13} /> {busy ? "Sending…" : "Broadcast"}
          </button>
          {sent != null && <span className="text-leaf text-[12.5px] font-bold">Delivered to {sent} teammate{sent === 1 ? "" : "s"}</span>}
        </div>
        <ErrorNote error={err} />
      </form>
    </section>
  );
}

export function NotificationsPage({ me }: { me: User }) {
  const [items, setItems] = useState<NoticeItem[] | null>(null);
  const [marking, setMarking] = useState(false);
  const canPost = STAFF.includes(me.role);

  const load = useCallback(() => {
    api.get<NoticeItem[]>("/notifications").then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const unread = (items ?? []).filter((n) => !n.read).length;

  async function readAll() {
    setMarking(true);
    try { await api.post("/notifications/read-all", {}); refreshBadge(); load(); }
    finally { setMarking(false); }
  }

  async function openItem(n: NoticeItem) {
    if (!n.read) {
      api.post(`/notifications/${n.id}/read`, {}).then(() => {
        refreshBadge();
        setItems((s) => s?.map((x) => x.id === n.id ? { ...x, read: true } : x) ?? s);
      }).catch(() => {});
    }
    if (n.link?.startsWith("#/")) window.location.hash = n.link.slice(1);
  }

  return (
    <div className="space-y-7">
      <PageTitle title="Notifications"
        sub={unread ? `${unread} unread — announcements and assignment reminders from your staff.` : "Announcements and assignment reminders from your staff."}
        right={unread > 0 && (
          <button className="btn-ghost" onClick={readAll} disabled={marking}>
            <CheckCheck size={14} /> {marking ? "Marking…" : "Mark all read"}
          </button>
        )} />

      {canPost && <AnnounceComposer onSent={load} />}

      <section>
        <SectionTitle><BellRing size={14} className="text-crim mr-1.5 inline -mt-0.5" />Inbox</SectionTitle>
        {!items && <Spinner />}
        <div className="space-y-2">
          {(items ?? []).map((n) => (
            <button key={n.id} onClick={() => openItem(n)}
              className={`w-full text-left card p-4 flex items-start gap-3 transition-colors ${n.read ? "opacity-60" : "card-hover border-l-2 !border-l-crim"}`}>
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read ? "bg-edge-2" : "bg-crim animate-pulse"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip !text-[8.5px] uppercase ${n.kind === "reminder" ? "text-amber border-amber/40 bg-amber/10" : "text-sky border-sky/40 bg-sky/10"}`}>
                    {n.kind}
                  </span>
                  <span className="text-[13px] font-extrabold">{n.title}</span>
                  <span className="text-[10.5px] text-faint ml-auto">{when(n.created_at)}</span>
                </div>
                <p className="text-[12.5px] text-mute mt-1 leading-relaxed whitespace-pre-wrap">{n.body}</p>
                <div className="text-[10.5px] text-faint mt-1.5">from {n.from}{n.link ? " · tap to open" : ""}</div>
              </div>
            </button>
          ))}
          {items && items.length === 0 && <Empty title="Nothing yet" hint="Announcements and assignment reminders land here." />}
        </div>
      </section>
    </div>
  );
}
