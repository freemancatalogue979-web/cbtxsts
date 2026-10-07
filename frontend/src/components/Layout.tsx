import {
  Bell,
  BookOpenText,
  CalendarDays,
  ClipboardList,
  Crosshair,
  Dumbbell,
  Home,
  Layers,
  LogOut,
  Map,
  Menu,
  ShieldBan,
  Swords,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { User } from "../lib/types";
import { hashRoute, navigate } from "../lib/util";
import { Wordmark } from "./Logo";
import { AvatarImg } from "./Avatar";
import { ErrorNote, Field } from "./ui";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "training", label: "Training Center", icon: Dumbbell },
  { id: "scrims", label: "Scrims", icon: Swords },
  { id: "reviews", label: "Match Reviews", icon: ClipboardList },
  { id: "heroes", label: "Hero Database", icon: Crosshair },
  { id: "players", label: "Players", icon: Users },
  { id: "bans", label: "Ban Board", icon: ShieldBan },
  { id: "drafts", label: "Draft Lab", icon: Layers },
  { id: "maps", label: "Map Lab", icon: Map },
  { id: "strategy", label: "Strategy", icon: BookOpenText },
  { id: "events", label: "Calendar", icon: CalendarDays },
  { id: "notifications", label: "Notifications", icon: Bell },
];

const ROLE_TONE: Record<string, string> = {
  admin: "text-crim border-crim/50",
  captain: "text-amber border-amber/40",
  coach: "text-leaf border-leaf/40",
  analyst: "text-sky border-sky/40",
  player: "text-mute border-edge-2",
};

function NavList({ current, onNavigate, user, unread = 0 }: { current: string; onNavigate?: () => void; user: User; unread?: number }) {
  const items = user.role === "admin" ? [...NAV, { id: "admin", label: "Team Admin", icon: Menu }] : NAV;
  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {items.map((item) => {
        const active = current === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => { navigate(item.id); onNavigate?.(); }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
              active ? "text-text bg-raised nav-active" : "text-mute hover:text-text hover:bg-raised/60"
            }`}
          >
            <Icon size={16} className={active ? "text-crim" : "text-faint"} style={item.id === "notifications" && unread > 0 ? { color: "#e11d48" } : undefined} />
            {item.label}
            {item.id === "notifications" && unread > 0 && (
              <span className="ml-auto text-[10px] font-extrabold bg-crim text-white rounded-full min-w-5 h-5 px-1 inline-flex items-center justify-center">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function ProfileModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (u: User) => void }) {
  const [f, setF] = useState({ name: user.name, ign: user.ign, main_role: user.main_role, bio: user.bio });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const u = await api.patch<User>("/users/me", f);
      onSaved(u);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const u = await api.upload<User>("/users/me/avatar", form);
      onSaved(u);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form className="card p-6 w-full max-w-md space-y-4 bg-panel" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="flex items-center gap-4">
          <AvatarImg user={user} size={64} />
          <div className="flex-1">
            <div className="text-[15px] font-extrabold">{user.ign || user.name}</div>
            <div className="text-[11px] text-faint">{user.email}</div>
            <div className="flex gap-2 mt-2">
              <button type="button" className="btn-ghost !py-1 !text-[11px]" onClick={() => fileRef.current?.click()}>
                Upload photo
              </button>
              {user.avatar && (
                <button type="button" className="btn-ghost !py-1 !text-[11px] hover:!text-crim"
                  onClick={async () => { await api.del("/users/me/avatar"); onSaved({ ...user, avatar: null }); }}>
                  Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f2 = e.target.files?.[0]; if (f2) upload(f2); e.target.value = ""; }} />
          </div>
        </div>
        <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="In-game name"><input className="input" value={f.ign} onChange={(e) => setF({ ...f, ign: e.target.value })} /></Field>
          <Field label="Main lane">
            <select className="input" value={f.main_role} onChange={(e) => setF({ ...f, main_role: e.target.value })}>
              {["", "EXP", "JUNGLE", "MID", "GOLD", "ROAM"].map((l) => <option key={l} value={l}>{l || "—"}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Bio"><textarea className="input min-h-20" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Role, goals, offline focus…" /></Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
        </div>
      </form>
    </div>
  );
}

function UserCard({ user, onLogout, onUserUpdate }: { user: User; onLogout: () => void; onUserUpdate: (u: User) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="border-t border-edge p-3 flex items-center gap-3">
      <button className="shrink-0" onClick={() => setEditing(true)} title="Edit profile">
        <AvatarImg user={user} size={36} />
      </button>
      <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(true)} title="Edit profile">
        <div className="text-[13px] font-bold truncate">{user.ign || user.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`chip !text-[9px] !px-1.5 !py-0 uppercase ${ROLE_TONE[user.role] || ""}`}>{user.role_label}</span>
          {user.main_role && <span className="text-[10px] text-faint font-bold">{user.main_role}</span>}
        </div>
      </button>
      <button onClick={onLogout} className="text-faint hover:text-crim transition-colors" title="Sign out">
        <LogOut size={16} />
      </button>
      {editing && <ProfileModal user={user} onClose={() => setEditing(false)} onSaved={(u) => { onUserUpdate(u); setEditing(false); }} />}
    </div>
  );
}

export function Layout({ user, onLogout, onUserUpdate, children }: {
  user: User; onLogout: () => void; onUserUpdate: (u: User) => void; children: ReactNode;
}) {
  const [route, setRoute] = useState<string[]>(hashRoute());
  const [mobileNav, setMobileNav] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const onHash = () => setRoute(hashRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    let alive = true;
    const fetchCount = () => api.get<{ count: number }>("/notifications/unread-count")
      .then((r) => { if (alive) setUnread(r.count); }).catch(() => {});
    fetchCount();
    const t = setInterval(fetchCount, 45000);
    window.addEventListener("clover:notifications-changed", fetchCount);
    return () => { alive = false; clearInterval(t); window.removeEventListener("clover:notifications-changed", fetchCount); };
  }, [user.id]);
  const current = route[0] || "dashboard";

  return (
    <div className="min-h-screen bg-ink">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-edge bg-panel z-40">
        <div className="px-4 pt-4 pb-3 border-b border-edge">
          <Wordmark />
        </div>
        <NavList current={current} user={user} unread={unread} />
        <UserCard user={user} onLogout={onLogout} onUserUpdate={onUserUpdate} />
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 bg-panel/95 backdrop-blur border-b border-edge">
        <div className="flex items-center justify-between px-4 h-14">
          <Wordmark compact />
          <div className="flex items-center gap-2">
            <span className={`chip !text-[9px] uppercase ${ROLE_TONE[user.role] || ""}`}>{user.ign || user.role_label}</span>
            <button className="btn-ghost !px-2 !py-1.5" onClick={() => setMobileNav(true)} aria-label="Menu">
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-panel border-r border-edge flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-edge">
              <Wordmark compact />
              <button className="text-faint" onClick={() => setMobileNav(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <NavList current={current} user={user} unread={unread} onNavigate={() => setMobileNav(false)} />
            <UserCard user={user} onLogout={onLogout} onUserUpdate={onUserUpdate} />
          </div>
        </div>
      )}

      <main className="md:pl-60 pb-20 md:pb-10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-7">{children}</div>
      </main>

      {/* Mobile bottom quick bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-edge">
        <div className="grid grid-cols-5">
          {[NAV[0], NAV[1], NAV[2], NAV[3], NAV[4]].map((item) => {
            const active = current === item.id;
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => navigate(item.id)}
                className={`flex flex-col items-center gap-1 py-2 text-[9px] font-bold uppercase tracking-wide ${active ? "text-crim" : "text-faint"}`}>
                <Icon size={17} />
                {item.label.split(" ")[0]}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
