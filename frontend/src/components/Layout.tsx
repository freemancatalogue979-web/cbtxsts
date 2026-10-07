import {
  BookOpenText,
  CalendarDays,
  ClipboardList,
  Crosshair,
  Dumbbell,
  Home,
  Layers,
  LogOut,
  Menu,
  ShieldBan,
  Swords,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { User } from "../lib/types";
import { hashRoute, navigate } from "../lib/util";
import { Wordmark } from "./Logo";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "training", label: "Training Center", icon: Dumbbell },
  { id: "scrims", label: "Scrims", icon: Swords },
  { id: "reviews", label: "Match Reviews", icon: ClipboardList },
  { id: "heroes", label: "Hero Database", icon: Crosshair },
  { id: "players", label: "Players", icon: Users },
  { id: "bans", label: "Ban Board", icon: ShieldBan },
  { id: "drafts", label: "Draft Lab", icon: Layers },
  { id: "strategy", label: "Strategy", icon: BookOpenText },
  { id: "events", label: "Calendar", icon: CalendarDays },
];

const ROLE_TONE: Record<string, string> = {
  admin: "text-crim border-crim/50",
  captain: "text-amber border-amber/40",
  coach: "text-leaf border-leaf/40",
  analyst: "text-sky border-sky/40",
  player: "text-mute border-edge-2",
};

function NavList({ current, onNavigate, user }: { current: string; onNavigate?: () => void; user: User }) {
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
            <Icon size={16} className={active ? "text-crim" : "text-faint"} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function UserCard({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="border-t border-edge p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded bg-crim-dim border border-crim/40 flex items-center justify-center font-extrabold text-crim text-sm">
        {(user.ign || user.name).slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold truncate">{user.ign || user.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`chip !text-[9px] !px-1.5 !py-0 uppercase ${ROLE_TONE[user.role] || ""}`}>{user.role_label}</span>
          {user.main_role && <span className="text-[10px] text-faint font-bold">{user.main_role}</span>}
        </div>
      </div>
      <button onClick={onLogout} className="text-faint hover:text-crim transition-colors" title="Sign out">
        <LogOut size={16} />
      </button>
    </div>
  );
}

export function Layout({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const [route, setRoute] = useState<string[]>(hashRoute());
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    const onHash = () => setRoute(hashRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const current = route[0] || "dashboard";

  return (
    <div className="min-h-screen bg-ink">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-edge bg-panel z-40">
        <div className="px-4 pt-4 pb-3 border-b border-edge">
          <Wordmark />
        </div>
        <NavList current={current} user={user} />
        <UserCard user={user} onLogout={onLogout} />
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
            <NavList current={current} user={user} onNavigate={() => setMobileNav(false)} />
            <UserCard user={user} onLogout={onLogout} />
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
