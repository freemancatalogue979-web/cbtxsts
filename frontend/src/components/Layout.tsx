import { ChevronsLeft, ChevronsRight, Gamepad2, LogOut, Menu, Palette, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { linkOf } from "../lib/mlbb";
import type { LinkSummary } from "../lib/mlbb";
import type { User } from "../lib/types";
import { hashRoute, navigate } from "../lib/util";
import { FONT_CHOICES, type FontChoice } from "../lib/fontPrefs";
import { ACCENTS, accentFor, heroArt, sectionTheme, type SectionId, type ThemePrefs } from "../lib/theme";
import {
  MOBILE_QUICK, NAV_GROUPS, groupLabel, navItem, readNavCollapsed, saveNavCollapsed, visibleNav, type NavItem,
} from "../lib/nav";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { CommandPalette } from "./CommandPalette";
import { Wordmark, BrandImg } from "./Logo";
import { AvatarImg } from "./Avatar";
import { ErrorNote, Field, PageChrome } from "./ui";

const ROLE_TONE: Record<string, string> = {
  admin: "text-crim border-crim/50",
  captain: "text-amber border-amber/40",
  coach: "text-leaf border-leaf/40",
  analyst: "text-sky border-sky/40",
  player: "text-mute border-edge-2",
};

function deviceStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Each area keeps its own colour on its icon, so the sidebar reads like a map of the hub. */
function itemAccent(item: NavItem): string {
  return accentFor(sectionTheme(item.id).accent).text;
}

function NavList({ current, onNavigate, user, unread = 0, collapsed = false }: {
  current: string; onNavigate?: () => void; user: User; unread?: number; collapsed?: boolean;
}) {
  const items = visibleNav(user.role === "admin");
  return (
    <nav aria-label="Main" className={`flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3 ${collapsed ? "nav-rail" : ""}`}>
      {NAV_GROUPS.map((group) => {
        const entries = items.filter((item) => item.group === group.id);
        if (!entries.length) return null;
        return (
          <div key={group.id} role="group" aria-label={group.label}>
            <div className="nav-group-label" aria-hidden="true">{group.label}</div>
            <ul className="space-y-0.5">
              {entries.map((item) => {
                const active = current === item.id;
                const Icon = item.icon;
                const count = item.id === "notifications" ? unread : 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => { navigate(item.id); onNavigate?.(); }}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? `${item.label}${count ? ` (${count} unread)` : ""}` : undefined}
                      className="nav-item"
                      style={{ ["--item-accent" as string]: itemAccent(item) }}
                    >
                      <span className="nav-item__icon" aria-hidden="true"><Icon size={16} /></span>
                      <span className="nav-item__label truncate">{item.label}</span>
                      {count > 0 && (
                        <span className="nav-badge" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SearchButton({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <button type="button" onClick={onOpen} aria-label="Jump to a page" title="Jump to a page (Ctrl+K)"
        className="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-edge bg-raised/70 text-faint hover:text-text hover:border-edge-2">
        <Search size={15} />
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} aria-keyshortcuts="Control+K Meta+K"
      className="flex w-full items-center gap-2 rounded-lg border border-edge bg-raised/70 px-3 py-2 text-left text-[12px] text-faint transition-colors hover:border-edge-2 hover:text-mute">
      <Search size={14} aria-hidden="true" />
      <span className="flex-1 truncate">Jump to…</span>
      <span className="kbd" aria-hidden="true">Ctrl K</span>
    </button>
  );
}

function FontPicker({ value, onChange }: { value: FontChoice; onChange: (choice: FontChoice) => void }) {
  return (
    <div className="rounded-lg border border-edge bg-raised px-3.5 py-3">
      <div className="text-[12px] font-bold">Text style</div>
      <p className="text-[10.5px] text-faint mt-0.5 leading-relaxed" id="font-picker-hint">
        DM Mono in small caps is the default. Pick Montserrat for larger mixed-case text, or Corptic for the slanted display look. Saved on this device only.
      </p>
      <div role="radiogroup" aria-label="Text style" aria-describedby="font-picker-hint" className="grid grid-cols-3 gap-2 mt-2.5">
        {FONT_CHOICES.map((choice) => {
          const active = choice.id === value;
          return (
            <button key={choice.id} type="button" role="radio" aria-checked={active} onClick={() => onChange(choice.id)}
              className={`min-w-0 rounded-md border px-2.5 py-2 text-left transition-colors ${
                active ? "border-leaf/60 bg-leaf/10" : "border-edge bg-panel hover:border-edge-2 hover:bg-overlay"
              }`}>
              <span className="block break-words text-[12.5px] leading-tight font-bold" style={{ fontFamily: choice.stack }}>{choice.label}</span>
              <span className={`mt-0.5 block text-[9.5px] leading-snug ${active ? "text-leaf" : "text-faint"}`}>{choice.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThemePicker({ theme, onChange }: { theme: ThemePrefs; onChange: (next: ThemePrefs) => void }) {
  const options: { id: ThemePrefs["mode"]; label: string; color: string }[] = [
    { id: "auto", label: "Auto · follows the area", color: "linear-gradient(135deg, #fda4af, #34d399 34%, #fbbf24 62%, #a78bfa)" },
    ...ACCENTS.map((accent) => ({ id: accent.id, label: accent.label, color: accent.text })),
  ];
  return (
    <div className="rounded-lg border border-edge bg-raised px-3.5 py-3 space-y-3">
      <div>
        <div className="text-[12px] font-bold">Colour theme</div>
        <p className="text-[10.5px] text-faint mt-0.5 leading-relaxed" id="theme-picker-hint">
          Auto gives every area its own colour and MLBB hero art. Pin one colour if you want it everywhere. Saved on this device.
        </p>
        <div role="radiogroup" aria-label="Colour theme" aria-describedby="theme-picker-hint" className="flex flex-wrap gap-2 mt-2.5">
          {options.map((option) => {
            const active = theme.mode === option.id;
            return (
              <button key={option.id} type="button" role="radio" aria-checked={active} aria-label={option.label}
                onClick={() => onChange({ ...theme, mode: option.id })}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] font-bold transition-colors ${
                  active ? "border-leaf/60 bg-leaf/10 text-leaf" : "border-edge bg-panel text-mute hover:border-edge-2 hover:bg-overlay"
                }`}>
                <span aria-hidden className="h-3.5 w-3.5 rounded-sm border border-white/25" style={{ background: option.color }} />
                {option.id === "auto" ? "Auto" : option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {([
          { key: "backdrop", label: "Hero backdrop", hint: "MLBB art behind the hub", value: theme.backdrop },
          { key: "motion", label: "Live motion", hint: "Drifting 3D wallpaper", value: theme.motion },
        ] as const).map((toggle) => (
          <button key={toggle.key} type="button" role="switch" aria-checked={toggle.value}
            onClick={() => onChange({ ...theme, [toggle.key]: !toggle.value })}
            className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
              toggle.value ? "border-leaf/40 bg-leaf/5" : "border-edge bg-panel hover:border-edge-2"
            }`}>
            <span className="min-w-0">
              <span className="block text-[11.5px] font-bold">{toggle.label}</span>
              <span className="block text-[9.5px] text-faint leading-snug">{toggle.hint}</span>
            </span>
            <span aria-hidden className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${
              toggle.value ? "border-leaf/60 bg-leaf/30" : "border-edge-2 bg-overlay"
            }`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${toggle.value ? "left-3.5 bg-leaf" : "left-0.5 bg-mute"}`} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileModal({ user, font, onFontChange, theme, onThemeChange, onClose, onSaved }: {
  user: User; font: FontChoice; onFontChange: (choice: FontChoice) => void;
  theme: ThemePrefs; onThemeChange: (next: ThemePrefs) => void;
  onClose: () => void; onSaved: (u: User) => void;
}) {
  const [f, setF] = useState({ name: user.name, ign: user.ign, main_role: user.main_role, bio: user.bio });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mlbb, setMlbb] = useState<LinkSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { linkOf(user.id).then(setMlbb).catch(() => setMlbb({ linked: false })); }, [user.id]);

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

  // Rendered into <body>: the blurred sidebar and drawer create containing
  // blocks, so a fixed dialog inside them would be cropped and mispositioned.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-3 sm:p-4" onClick={onClose}>
      <form className="card p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto space-y-4 bg-panel" onClick={(e) => e.stopPropagation()} onSubmit={save}
        role="dialog" aria-modal="true" aria-label="Edit profile">
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
        {mlbb && (
          <div className={`rounded-lg px-3.5 py-3 flex items-center gap-3 border ${mlbb.linked ? "bg-raised border-leaf/35" : "bg-raised border-edge/60"}`}>
            {mlbb.linked ? (
              <>
                <span className="w-10 h-10 rounded-lg overflow-hidden border border-edge-2 bg-overlay grid place-items-center shrink-0">
                  {mlbb.avatar
                    ? <img src={mlbb.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" className="object-cover w-full h-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    : <Gamepad2 size={16} className="text-leaf" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-extrabold text-leaf truncate">{mlbb.name || "MLBB account"} <span className="text-[9px] uppercase text-faint font-bold">· connected</span></div>
                  <div className="text-[10px] text-faint">
                    {mlbb.level != null ? `Lv ${mlbb.level} · ` : ""}{mlbb.rank_level != null ? `rank tier ${mlbb.rank_level} · ` : ""}ID {mlbb.role_id}
                  </div>
                </div>
                {mlbb.name && (
                  <button type="button" className="btn-ghost !py-1 !text-[10px] shrink-0" title="Copy MLBB in-game name (exact casing) into the profile IGN field"
                    onClick={() => setF({ ...f, ign: mlbb.name! })}>
                    Use as IGN
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2.5 w-full">
                <Gamepad2 size={15} className="text-faint shrink-0" />
                <div className="text-[11px] text-faint flex-1">MLBB account not connected — rank, level and official IGN can fill this profile.</div>
                <button type="button" className="btn-ghost !py-1 !text-[11px] !text-rose-300 shrink-0" onClick={() => { onClose(); navigate("mlbb"); }}>Connect</button>
              </div>
            )}
          </div>
        )}
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
        <FontPicker value={font} onChange={onFontChange} />
        <ThemePicker theme={theme} onChange={onThemeChange} />
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function UserCard({ user, font, onFontChange, theme, onThemeChange, onLogout, onUserUpdate, collapsed = false }: {
  user: User; font: FontChoice; onFontChange: (choice: FontChoice) => void;
  theme: ThemePrefs; onThemeChange: (next: ThemePrefs) => void;
  onLogout: () => void; onUserUpdate: (u: User) => void; collapsed?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const modal = editing && <ProfileModal user={user} font={font} onFontChange={onFontChange} theme={theme} onThemeChange={onThemeChange} onClose={() => setEditing(false)} onSaved={(u) => { onUserUpdate(u); setEditing(false); }} />;
  if (collapsed) {
    return (
      <div className="border-t border-edge py-3 flex flex-col items-center gap-2">
        <button onClick={() => setEditing(true)} title={`Edit profile — ${user.ign || user.name}`} aria-label={`Edit profile — ${user.ign || user.name}`}
          className="rounded-full ring-2 ring-transparent hover:ring-crim/50 transition">
          <AvatarImg user={user} size={34} />
        </button>
        <button onClick={() => setEditing(true)} className="text-faint hover:text-crim transition-colors p-1" title="Colour theme and text style" aria-label="Appearance settings">
          <Palette size={15} />
        </button>
        <button onClick={onLogout} className="text-faint hover:text-crim transition-colors p-1" title="Sign out" aria-label="Sign out">
          <LogOut size={15} />
        </button>
        {modal}
      </div>
    );
  }
  return (
    <div className="m-2.5 mt-0 rounded-xl border border-edge bg-raised/60 p-2.5 flex items-center gap-2.5">
      {/* One target for the avatar and name: the visible text is the accessible
          name, so screen readers announce exactly what is on screen. */}
      <button className="flex flex-1 min-w-0 items-center gap-2.5 text-left" onClick={() => setEditing(true)} title="Edit profile">
        <span className="shrink-0"><AvatarImg user={user} size={36} /></span>
        <span className="min-w-0">
          <span className="block text-[13px] font-bold truncate">{user.ign || user.name}</span>
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className={`chip !text-[9px] !px-1.5 !py-0 uppercase ${ROLE_TONE[user.role] || ""}`}>{user.role_label}</span>
            {user.main_role && <span className="text-[10px] text-faint font-bold">{user.main_role}</span>}
          </span>
        </span>
      </button>
      <button onClick={() => setEditing(true)} className="text-faint hover:text-crim transition-colors p-1" title="Colour theme and text style" aria-label="Appearance settings">
        <Palette size={16} />
      </button>
      <button onClick={onLogout} className="text-faint hover:text-crim transition-colors p-1" title="Sign out" aria-label="Sign out">
        <LogOut size={16} />
      </button>
      {modal}
    </div>
  );
}

export function Layout({ user, onLogout, onUserUpdate, font, onFontChange, theme, onThemeChange, section, hideDesktopNav = false, children }: {
  user: User; onLogout: () => void; onUserUpdate: (u: User) => void;
  font: FontChoice; onFontChange: (choice: FontChoice) => void;
  theme: ThemePrefs; onThemeChange: (next: ThemePrefs) => void;
  section: SectionId; hideDesktopNav?: boolean; children: ReactNode;
}) {
  const [route, setRoute] = useState<string[]>(hashRoute());
  const [mobileNav, setMobileNav] = useState(false);
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useState(() => readNavCollapsed(deviceStorage()));
  const [palette, setPalette] = useState(false);
  const drawerClose = useRef<HTMLButtonElement>(null);
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
  useEffect(() => { saveNavCollapsed(deviceStorage(), collapsed); }, [collapsed]);
  // Ctrl/⌘ + K opens the quick-jump palette from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The drawer behaves like a dialog: focus the close button, Escape closes it.
  useEffect(() => {
    if (!mobileNav) return;
    drawerClose.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNav(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNav]);

  const current = route[0] || "dashboard";
  const items = useMemo(() => visibleNav(user.role === "admin"), [user.role]);
  const openPalette = useCallback(() => { setMobileNav(false); setPalette(true); }, []);

  // Every page header gets this area's icon, group and hero portrait.
  const here = navItem(section);
  const chrome = useMemo(() => {
    if (!here) return null;
    const Icon = here.icon;
    return { icon: <Icon />, eyebrow: `${groupLabel(here.group)} · ${here.label}`, art: heroArt(sectionTheme(section).spotlight) };
  }, [here, section]);

  const navWidth = collapsed ? "md:w-[76px]" : "md:w-64";
  const navPad = hideDesktopNav ? "" : collapsed ? "md:pl-[76px]" : "md:pl-64";

  return (
    <div className="min-h-screen bg-ink">
      <AmbientBackdrop section={section} motion={theme.motion} />
      {/* Desktop sidebar */}
      <aside id="site-desktop-navigation" aria-label="Site navigation"
        className={`${hideDesktopNav ? "hidden" : "hidden md:flex"} ${navWidth} fixed inset-y-0 left-0 flex-col border-r border-edge bg-panel/80 backdrop-blur-xl z-40 transition-[width] duration-200 motion-reduce:transition-none`}>
        <div className={`flex items-center gap-2 border-b border-edge ${collapsed ? "flex-col px-2 py-3" : "px-4 pt-4 pb-3"}`}>
          {collapsed ? <BrandImg size={32} /> : <div className="min-w-0 flex-1"><Wordmark /></div>}
          <button type="button" onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="site-desktop-navigation"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-white/5 hover:text-text">
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
        <div className={collapsed ? "py-3" : "px-3 pt-3"}><SearchButton onOpen={openPalette} compact={collapsed} /></div>
        <NavList current={current} user={user} unread={unread} collapsed={collapsed} />
        <UserCard user={user} font={font} onFontChange={onFontChange} theme={theme} onThemeChange={onThemeChange} onLogout={onLogout} onUserUpdate={onUserUpdate} collapsed={collapsed} />
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 bg-panel/80 backdrop-blur-xl border-b border-edge">
        <div className="flex items-center justify-between px-4 h-14">
          <Wordmark compact />
          <div className="flex items-center gap-2">
            <span className={`chip !text-[9px] uppercase ${ROLE_TONE[user.role] || ""}`}>{user.ign || user.role_label}</span>
            <button className="btn-ghost !px-2 !py-1.5" onClick={openPalette} aria-label="Jump to a page">
              <Search size={17} />
            </button>
            <button className="btn-ghost !px-2 !py-1.5" onClick={() => setMobileNav(true)} aria-label="Menu" aria-expanded={mobileNav}>
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[86vw] bg-panel/95 backdrop-blur-xl border-r border-edge flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-edge">
              <Wordmark compact />
              <button ref={drawerClose} className="text-faint p-1" onClick={() => setMobileNav(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="px-3 pt-3"><SearchButton onOpen={openPalette} /></div>
            <NavList current={current} user={user} unread={unread} onNavigate={() => setMobileNav(false)} />
            <UserCard user={user} font={font} onFontChange={onFontChange} theme={theme} onThemeChange={onThemeChange} onLogout={onLogout} onUserUpdate={onUserUpdate} />
          </div>
        </div>
      )}

      <main className={`relative z-10 ${navPad} pb-24 md:pb-10 transition-[padding] duration-200 motion-reduce:transition-none`}>
        <PageChrome.Provider value={chrome}>
          <div className={`${hideDesktopNav ? "max-w-none" : "max-w-7xl"} mx-auto px-4 sm:px-8 pt-5 sm:pt-7`}>{children}</div>
        </PageChrome.Provider>
      </main>

      {/* Mobile bottom quick bar */}
      <nav aria-label="Quick links" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/90 backdrop-blur-xl border-t border-edge pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6">
          {MOBILE_QUICK.map((id) => {
            const item = navItem(id)!;
            const short = item.short;
            const active = current === item.id;
            const Icon = item.icon;
            const accessibleLabel = item.label === short || item.label.endsWith(` ${short}`) ? item.label : `${short} — ${item.label}`;
            return (
              <button key={item.id} onClick={() => navigate(item.id)} aria-label={accessibleLabel} aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wide ${active ? "text-crim" : "text-mute"}`}>
                {active && <span aria-hidden="true" className="absolute top-0 h-[3px] w-8 rounded-b-full bg-crim shadow-[0_0_12px_rgb(var(--accent-glow)/0.9)]" />}
                <span className={`grid h-7 w-10 place-items-center rounded-full transition-colors ${active ? "bg-crim/15" : ""}`}><Icon size={17} /></span>
                {short}
              </button>
            );
          })}
        </div>
      </nav>

      {palette && <CommandPalette items={items} current={current} onClose={() => setPalette(false)} onGo={(id) => navigate(id)} />}
    </div>
  );
}
