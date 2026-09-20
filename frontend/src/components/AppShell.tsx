/** App chrome: desktop nav tabs, mobile bottom bar, header stats, notifications. */
import {Bell, BellRing, CheckCircle2, ChevronDown, CircleHelp, Coins, Flame, Gem, LogOut, Menu, MoreHorizontal, Music2, Pause, Play, Radio, Search, Shield, Sparkles, User as UserIcon, Volume2, VolumeX, Wifi, WifiOff, X} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {Avatar, Button, Chip, IconButton, Modal} from './ui';
import {Holdable} from './Holdable';
import {api} from '../lib/api';
import {cacheRead, cacheWrite, userScope} from '../lib/cache';
import {LogoMark, Wordmark} from './Brand';
import SeasonBadge from './SeasonBadge';
import {music} from '../lib/music';
import {sfx} from '../lib/sfx';
import {DESKTOP_MORE_TABS, DESKTOP_PRIMARY_TABS, MOBILE_TABS, MORE_TABS, TABS} from '../lib/nav';
import {IconOrb} from './ui';
import CommandPalette from './CommandPalette';
import {jumpToMaterial} from '../lib/palette';
import type {Tab} from '../lib/nav';
import {formatNumber, formatRelative} from '../lib/format';
import {useSession} from '../store/session';

const SEEN_KEY = 'arena.notices.seen';

const NOTE_ICONS: Record<string, typeof Bell> = {help: CircleHelp, answer: CheckCircle2, nudge: BellRing};

/**
 * The browser refused autoplay (no gesture yet): float a simple start button
 * above the nav until the player taps it — or dismisses it for the session.
 */
function MusicStartPill() {
  const musicState = useSyncExternalStore(music.subscribe, music.state);
  const [dismissed, setDismissed] = useState(false);
  if (musicState !== 'blocked' || dismissed) return null;
  return (
    <div className="print-hide fixed bottom-20 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-gold-400/40 bg-ink-900/94 py-1.5 pr-1.5 pl-3.5 shadow-xl shadow-black/50 backdrop-blur-xl lg:bottom-6">
      <Music2 className="size-4 shrink-0 text-gold-300" />
      <p className="min-w-0 truncate text-[0.74rem] font-bold text-mist-200">Background music is ready</p>
      <Button
        size="sm"
        variant="gold"
        className="shrink-0"
        onClick={() => music.toggle()}
        icon={<Play className="size-3.5" />}
      >
        Start
      </Button>
      <button
        aria-label="Keep music off"
        onClick={() => {
          music.setEnabled(false);
          setDismissed(true);
        }}
        className="grid size-7 shrink-0 place-items-center rounded-full text-mist-500 transition-colors hover:text-mist-200 touch-manipulation"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function NoticeBell({className = ''}: {className?: string}) {
  const {notices, inbox, refreshInbox, profile} = useSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Dismissed items stay dismissed on this device (the announcement itself is
  // still there for everyone else — this only clears your own bell).
  const scope = userScope(profile?.id ?? 'anon');
  const [dismissed, setDismissed] = useState<{inbox: number[]; notices: number[]}>(() =>
    cacheRead(scope, 'bell.dismissed') ?? {inbox: [], notices: []},
  );

  const dismiss = (kind: 'inbox' | 'notices', id: number) => {
    setDismissed((current) => {
      const next = {...current, [kind]: [...new Set([...(current[kind] ?? []), id])].slice(-80)};
      cacheWrite(scope, 'bell.dismissed', next);
      return next;
    });
    sfx.play('whoosh');
  };

  const liveInbox = inbox.filter((note) => !dismissed.inbox.includes(note.id));
  const liveNotices = notices.filter((notice) => !dismissed.notices.includes(notice.id));

  const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
  const unread =
    liveNotices.filter((notice) => {
      const at = new Date(notice.created_at.endsWith('Z') ? notice.created_at : `${notice.created_at}Z`).getTime();
      return Number.isNaN(at) ? false : at > seen;
    }).length + liveInbox.filter((note) => !note.read).length;

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const markSeen = () => {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
    setOpen(true);
    api
      .inboxRead()
      .then(() => refreshInbox())
      .catch(() => {});
  };

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <IconButton label="Notifications" variant="outline" className="float-chip" onClick={() => (open ? setOpen(false) : markSeen())}>
        <span className="relative">
          <Bell className="size-[18px] text-mist-300" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-2 grid min-w-4 place-items-center rounded-full bg-flare-500 px-1 text-[0.6rem] font-black text-white">
              {unread}
            </span>
          )}
        </span>
      </IconButton>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{opacity: 0, y: -8, scale: 0.97}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: -8, scale: 0.97}}
            transition={{duration: 0.18}}
            className="glass-strong absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-3xl shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <p className="text-[0.82rem] font-extrabold text-mist-50">Notifications</p>
              <Chip>{liveInbox.length + liveNotices.length}</Chip>
            </header>
            <div className="max-h-[60vh] overflow-y-auto">
              {inbox.length > 0 && (
                <div className="border-b border-white/8">
 <p className="px-4 pt-3 text-[0.62rem] font-black tracking-[0.18em] text-nova-300">For you</p>
                  {liveInbox.slice(0, 12).map((note) => {
                    const Icon = NOTE_ICONS[note.kind] ?? Sparkles;
                    return (
                      <Holdable
                        key={note.id}
                        className="border-b border-white/6 last:border-0"
                        hint="Hold to dismiss"
                        actions={[
                          {
                            key: 'dismiss',
                            label: 'Dismiss',
                            icon: <X className="size-4" />,
                            tone: 'danger',
                            onAction: () => dismiss('inbox', note.id),
                          },
                        ]}
                      >
                        <article className={`px-4 py-3 ${note.read ? 'opacity-70' : ''}`}>
                          <div className="flex items-center gap-2">
                            <Icon className="size-3.5 shrink-0 text-nova-400" />
                            <p className="truncate text-[0.84rem] font-extrabold text-mist-100">{note.title}</p>
                          </div>
                          {note.message && <p className="mt-1 break-words text-[0.8rem] font-medium text-mist-400">{note.message}</p>}
 <p className="mt-1.5 text-[0.68rem] font-bold tracking-wider text-mist-600">{formatRelative(note.created_at)}</p>
                        </article>
                      </Holdable>
                    );
                  })}
 <p className="px-4 pt-2.5 pb-1 text-[0.62rem] font-black tracking-[0.18em] text-mist-500">Announcements</p>
                </div>
              )}
              {liveNotices.length === 0 && liveInbox.length === 0 && (
                <p className="px-4 py-8 text-center text-[0.84rem] font-medium text-mist-500">Nothing yet.</p>
              )}
              {liveNotices.map((notice) => (
                <Holdable
                  key={notice.id}
                  className="border-b border-white/6 last:border-0"
                  hint="Hold to hide"
                  actions={[
                    {
                      key: 'hide',
                      label: 'Hide',
                      icon: <X className="size-4" />,
                      tone: 'neutral',
                      onAction: () => dismiss('notices', notice.id),
                    },
                  ]}
                >
                  <article className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-3.5 shrink-0 text-nova-400" />
                      <p className="truncate text-[0.84rem] font-extrabold text-mist-100">{notice.title}</p>
                    </div>
                    <p className="mt-1 text-[0.8rem] font-medium text-mist-400">{notice.message}</p>
 <p className="mt-1.5 text-[0.68rem] font-bold tracking-wider text-mist-600">
                      {notice.author} · {formatRelative(notice.created_at)}
                    </p>
                  </article>
                </Holdable>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AccountMenu({onSignOut, onProfile}: {onSignOut: () => void; onProfile: () => void}) {
  const {profile} = useSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!profile) return null;

  return (
    <div className="relative" ref={wrapRef}>
      {/* On a phone the avatar sits in a true circle: square padding all round,
          aspect-square so the ring can never stretch into a pill. The name is
          what turns it into a pill, and that only appears from sm up. */}
      <button
        onClick={() => setOpen((value) => !value)}
        className="float-chip flex aspect-square shrink-0 items-center justify-center rounded-full border border-white/12 p-1 transition-colors hover:border-nova-400/40 sm:aspect-auto sm:gap-2 sm:pr-3"
        aria-label="Account menu"
      >
        <Avatar name={profile.name} hue={profile.avatar_hue} initials={profile.initials} size={30} />
        <span className="hidden text-[0.8rem] font-bold text-mist-200 sm:block">{profile.name.split(' ')[0]}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{opacity: 0, y: -8, scale: 0.97}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: -8, scale: 0.97}}
            className="glass-strong absolute right-0 z-50 mt-2 w-[min(16rem,calc(100vw-1.25rem))] overflow-hidden rounded-3xl p-2 shadow-2xl"
          >
            <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-3">
              <Avatar name={profile.name} hue={profile.avatar_hue} initials={profile.initials} size={42} />
              <div className="min-w-0">
                <p className="truncate text-[0.88rem] font-extrabold text-mist-50">{profile.name}</p>
                <p className="truncate text-[0.74rem] font-semibold text-nova-300">
                  Lv {profile.progress.level} · {profile.progress.title}
                </p>
                {profile.season ? (
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[0.68rem] font-bold text-mist-400">
                    <SeasonBadge rank={profile.season.rank} level={profile.season.level} size="xs" showLevel={false} />
                    {profile.season.rank.label} · {profile.season.days_left}d left
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 px-1 text-center">
              {[
                {label: 'XP', value: formatNumber(profile.xp)},
                {label: 'Coins', value: formatNumber(profile.coins)},
                {label: 'Streak', value: `${profile.streak}d`},
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl bg-white/5 py-2">
                  <p className="text-[0.86rem] font-black tabular text-mist-50">{stat.value}</p>
 <p className="text-[0.6rem] font-bold tracking-wider text-mist-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-col">
              <button
                onClick={() => {
                  setOpen(false);
                  onProfile();
                }}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[0.84rem] font-bold text-mist-300 hover:bg-white/6 hover:text-mist-50"
              >
                <UserIcon className="size-4" /> My profile
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[0.84rem] font-bold text-flare-300 hover:bg-flare-500/12"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LivePill() {
  const {socketStatus, online} = useSession();
  const label = socketStatus === 'open' ? 'Connected' : socketStatus === 'connecting' ? 'Reconnecting…' : 'Offline';
  const tone =
    socketStatus === 'open'
      ? 'border-mint-500/30 text-mint-300'
      : socketStatus === 'connecting'
        ? 'border-gold-500/30 text-gold-300'
        : 'border-flare-500/30 text-flare-300';
  return (
    <div
      className={`float-chip flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[0.7rem] font-bold sm:px-3 ${tone}`}
      title={`${label} to the live channel — the app re-syncs silently when the connection returns`}
    >
      {socketStatus === 'open' ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5 animate-pulse" />}
      <span className="tabular">{label}</span>
      <span className="hidden opacity-70 sm:inline">
        · {online} online
      </span>
      {socketStatus === 'open' && <span className="size-1.5 animate-pulse rounded-full bg-mint-400" />}
    </div>
  );
}

export function AppShell({
  tab,
  onTab,
  onAdmin,
  onProfile,
  onSignOut,
  children,
}: {
  tab: Tab | null;
  onTab: (tab: Tab) => void;
  onAdmin: () => void;
  onProfile: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const {profile, role, chatUnread} = useSession();
  const chatTotal = Object.values(chatUnread).reduce((sum, count) => sum + count, 0);
  const musicState = useSyncExternalStore(music.subscribe, music.state);
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const desktopMoreRef = useRef<HTMLDivElement>(null);

  const isMoreActive = DESKTOP_MORE_TABS.some((id) => tab === id);

  /* Close desktop more dropdown on outside click */
  useEffect(() => {
    if (!desktopMoreOpen) return undefined;
    const onClick = (event: MouseEvent) => {
      if (desktopMoreRef.current && !desktopMoreRef.current.contains(event.target as Node)) {
        setDesktopMoreOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [desktopMoreOpen]);

  /* ⌘K / Ctrl+K (and plain "/" outside a field) opens the quick jump. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="aurora min-h-dvh">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-60" />

      <header className="print-hide sticky top-0 z-50 safe-top">
        <div className="flex w-full items-center justify-between gap-1.5 px-2 py-1.5 sm:gap-2.5 sm:px-4 sm:py-2 lg:px-8">
          {/* Mobile hamburger & Callsign & Level */}
          <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2 lg:order-last lg:ml-3">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Tactical Command Menu"
              className="float-chip grid size-9 shrink-0 place-items-center rounded-lg border border-white/12 text-mist-300 hover:border-nova-400/50 hover:text-mist-50 lg:hidden"
            >
              <Menu className="size-4" />
            </button>

            <div className="hidden shrink items-center gap-1.5 lg:flex">
              <LogoMark size={26} className="size-6 shrink-0 sm:size-7" />
 <span className="font-display text-[0.80rem] font-black tracking-wider text-mist-50 sm:text-[0.92rem]">
                Quiz <span className="text-nova-400">Arena</span>
              </span>
            </div>

            {profile && (
              <span className="hud-pill float-chip shrink-0 px-1.5 py-0.5 text-[0.66rem] font-black tracking-tight text-nova-300 tabular">
                LV{profile.progress.level}
              </span>
            )}
          </div>

          {/* Desktop Primary Navigation + MORE ▾ */}
          <nav className="float-chip hidden items-center gap-1 rounded-xl border border-white/10 p-1 lg:order-first lg:flex">
            {DESKTOP_PRIMARY_TABS.map((id) => {
              const item = TABS.find((row) => row.id === id)!;
              const active = tab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => onTab(item.id)}
 className={`relative flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[0.80rem] font-bold tracking-wide transition-colors ${
                    active ? 'text-white' : 'text-mist-400 hover:text-mist-100'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="brand-gradient absolute inset-0 -z-1 rounded-lg"
                      transition={{type: 'spring', stiffness: 400, damping: 32}}
                    />
                  )}
                  <Icon className="size-4" />
                  {item.label}
                </button>
              );
            })}

            {/* Desktop MORE dropdown */}
            <div className="relative" ref={desktopMoreRef}>
              <button
                onClick={() => setDesktopMoreOpen((prev) => !prev)}
 className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.80rem] font-bold tracking-wide transition-colors ${
                  isMoreActive ? 'bg-nova-500/20 text-nova-300' : 'text-mist-400 hover:text-mist-100'
                }`}
                aria-expanded={desktopMoreOpen}
              >
                <span>More</span>
                <ChevronDown className={`size-3.5 transition-transform ${desktopMoreOpen ? 'rotate-180' : ''}`} />
              </button>

              <div
                className={`glass-strong absolute top-full left-0 z-50 mt-2 flex w-52 flex-col gap-1 rounded-xl border border-white/14 p-1.5 shadow-2xl backdrop-blur-xl transition-all ${
                  desktopMoreOpen ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-95'
                }`}
              >
                {DESKTOP_MORE_TABS.map((id) => {
                  const item = TABS.find((row) => row.id === id)!;
                  const active = tab === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setDesktopMoreOpen(false);
                        onTab(item.id);
                      }}
 className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.78rem] font-bold tracking-wide transition-colors ${
                        active ? 'bg-nova-500/20 text-nova-300' : 'text-mist-300 hover:bg-white/6 hover:text-mist-50'
                      }`}
                    >
                      <Icon className="size-4 shrink-0 text-nova-400" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* Right: Telemetry & Permanent PFP */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Quick jump"
              title="Quick jump — ⌘K"
              className="float-chip grid size-9 shrink-0 place-items-center rounded-lg border border-white/12 text-mist-400 hover:border-nova-400/40 hover:text-mist-200"
            >
              <Search className="size-4" />
            </button>
            <LivePill />
            {profile && (
              <>
                <span className="hud-pill float-chip shrink-0 px-2 py-1 text-[0.74rem] font-extrabold text-nova-300 tabular" title="Data Crystals">
                  <Gem className="size-3 text-nova-400" />
                  {formatNumber(profile.diamonds ?? 0)}
                </span>
                <span className="hud-pill float-chip hidden shrink-0 px-2 py-1 text-[0.74rem] font-extrabold text-amber-300 tabular xs:inline-flex" title="Credits">
                  <Coins className="size-3 text-amber-400" />
                  {formatNumber(profile.coins)}
                </span>
                <span className="hud-pill float-chip hidden text-[0.74rem] text-rose-300 tabular md:inline-flex" title="Daily streak">
                  <Flame className="size-3.5 text-rose-400" />
                  {profile.streak}d
                </span>
                <IconButton
                  label={
                    musicState === 'playing'
                      ? 'Pause background music'
                      : musicState === 'paused'
                        ? 'Resume background music'
                        : musicState === 'blocked'
                          ? 'Start background music'
                          : 'Play background music'
                  }
                  variant="outline"
                  className={`float-chip hidden sm:grid ${musicState === 'blocked' ? 'border-amber-400/50' : ''}`}
                  onClick={() => music.toggle()}
                >
                  {musicState === 'playing' ? (
                    <Pause className="size-[17px] text-nova-300" />
                  ) : musicState === 'blocked' ? (
                    <Play className="size-[17px] text-amber-300" />
                  ) : musicState === 'paused' ? (
                    <Play className="size-[17px] text-emerald-300" />
                  ) : (
                    <VolumeX className="size-[17px] text-mist-500" />
                  )}
                </IconButton>
                <NoticeBell className="hidden sm:inline-flex" />
                {role === 'admin' && (
                  <IconButton label="Admin console" variant="outline" className="hidden lg:inline-flex" onClick={onAdmin}>
                    <Shield className="size-[18px] text-rose-400" />
                  </IconButton>
                )}
                {/* AccountMenu (Avatar PFP): Always visible, never hidden, never wrapped */}
                <AccountMenu onSignOut={onSignOut} onProfile={onProfile} />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="w-full px-3 pt-3.5 pb-24 sm:px-5 sm:pt-5 lg:px-8 lg:pb-10">{children}</main>

      <MusicStartPill />

      {/* ------------------------------------------------- the game bottom bar
          A floating rounded dock rather than an edge-to-edge strip, with the
          active tab lifted into a coin. Safe-area padding keeps it clear of the
          home indicator; nothing here can scroll sideways. */}
      <nav className="print-hide fixed inset-x-0 bottom-0 z-50 px-2.5 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-1 rounded-[1.4rem] border-2 border-white/12 bg-ink-900/94 p-1.5 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          {MOBILE_TABS.map((id) => TABS.find((row) => row.id === id)!).map((item) => {
            const active = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onTab(item.id)}
                className={`relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1rem] py-1.5 touch-manipulation transition-transform active:scale-[0.93] ${
                  active ? 'bg-white/8' : ''
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="tab-coin"
                    transition={{type: 'spring', stiffness: 480, damping: 34}}
                    className="absolute inset-0 -z-1 rounded-[1rem] border-2 border-black/35 bg-gradient-to-br from-nova-400 to-nova-700 shadow-[inset_0_2px_0_rgba(255,255,255,0.35)]"
                  />
                )}
                <Icon className={`size-[19px] shrink-0 transition-colors ${active ? 'text-white' : 'text-mist-500'}`} />
                <span
                  className={`truncate text-[0.55rem] font-black tracking-wide sm:text-[0.62rem] ${
                    active ? 'text-white' : 'text-mist-600'
                  }`}
                >
                  {item.short}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={`relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1rem] py-1.5 touch-manipulation transition-transform active:scale-[0.93] ${
              MORE_TABS.includes(tab as Tab) ? 'bg-white/8' : ''
            }`}
          >
            {MORE_TABS.includes(tab as Tab) && (
              <motion.span
                layoutId="tab-coin"
                transition={{type: 'spring', stiffness: 480, damping: 34}}
                className="absolute inset-0 -z-1 rounded-[1rem] border-2 border-black/35 bg-gradient-to-br from-nova-400 to-nova-700 shadow-[inset_0_2px_0_rgba(255,255,255,0.35)]"
              />
            )}
            <span className="relative">
              <MoreHorizontal className={`size-[19px] ${MORE_TABS.includes(tab as Tab) ? 'text-white' : 'text-mist-500'}`} />
              {chatTotal > 0 && (
                <span className="absolute -top-1.5 -right-2 grid min-w-4 place-items-center rounded-full bg-flare-500 px-1 text-[0.5rem] leading-4 font-black text-white tabular">
                  {chatTotal}
                </span>
              )}
            </span>
            <span className={`text-[0.55rem] font-black tracking-wide sm:text-[0.62rem] ${MORE_TABS.includes(tab as Tab) ? 'text-white' : 'text-mist-600'}`}>
              More
            </span>
          </button>
        </div>
      </nav>

      {/* The overflow menu: a game menu grid rather than a list of links. */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu" subtitle="Everything else in the arena.">
        <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4">
          {MORE_TABS.map((id) => {
            const item = TABS.find((row) => row.id === id);
            if (!item) return null;
            const Icon = item.icon;
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setMoreOpen(false);
                  onTab(id);
                }}
                className={`gpress flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border-2 p-2.5 ${
                  active ? 'border-nova-400/60 bg-nova-500/16' : 'border-white/12 bg-white/[0.03]'
                }`}
              >
                <IconOrb tone={active ? 'nova' : 'ink'} size="sm">
                  <Icon className="size-4" />
                </IconOrb>
                <span className="w-full truncate text-center text-[0.7rem] font-extrabold text-mist-100">{item.label}</span>
              </button>
            );
          })}
        </div>

        {profile && (
          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
            <div className="sunken flex min-w-0 items-center gap-2 px-3 py-2.5">
              <Coins className="size-4 shrink-0 text-gold-300" />
              <span className="min-w-0">
 <span className="block text-[0.6rem] font-black tracking-wider text-mist-500">Coins</span>
                <span className="block truncate text-[0.9rem] font-extrabold text-gold-200 tabular">{formatNumber(profile.coins)}</span>
              </span>
            </div>
            <div className="sunken flex min-w-0 items-center gap-2 px-3 py-2.5">
              <Flame className="size-4 shrink-0 text-flare-300" />
              <span className="min-w-0">
 <span className="block text-[0.6rem] font-black tracking-wider text-mist-500">Combo</span>
                <span className="block truncate text-[0.9rem] font-extrabold text-flare-200 tabular">{profile.streak} days</span>
              </span>
            </div>
          </div>
        )}
      </Modal>

      {profile && role === 'student' && (
        <div className="print-hide fixed right-4 bottom-24 z-40 hidden items-center gap-1.5 rounded-full border border-mint-500/25 bg-ink-900/85 px-3 py-1.5 text-[0.7rem] font-bold text-mint-300 backdrop-blur lg:flex">
          <Radio className="size-3.5 animate-pulse" />
          Live sync on
        </div>
      )}
      {/* Tactical Command Drawer (Mobile slide-out HUD) */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            className="fixed inset-0 z-60 flex bg-black/80 backdrop-blur-md lg:hidden"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div
              className="relative flex h-full w-[min(20rem,85vw)] flex-col border-r border-nova-500/30 bg-[#090d14] p-4 shadow-2xl"
              initial={{x: -320}}
              animate={{x: 0}}
              exit={{x: -320}}
              transition={{type: 'spring', stiffness: 350, damping: 32}}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-nova-400 animate-pulse" />
 <span className="font-display text-[0.84rem] font-black tracking-widest text-mist-100">
                    COMMAND CENTER
                  </span>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="grid size-8 place-items-center rounded-lg border border-white/12 text-mist-400 hover:text-mist-50"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Player Dossier Summary */}
              {profile && (
                <div className="my-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                  <Avatar name={profile.name} hue={profile.avatar_hue} initials={profile.initials} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.85rem] font-bold text-mist-50">{profile.name}</p>
                    <div className="flex items-center gap-2 text-[0.70rem] font-bold text-nova-300">
                      <span>LV {profile.progress.level}</span>
                      <span>·</span>
                      <span className="truncate">{profile.progress.title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[0.72rem] font-bold tabular">
                      <span className="text-amber-300">🪙 {formatNumber(profile.coins)}</span>
                      <span className="text-nova-300">💎 {formatNumber(profile.diamonds ?? 0)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tactical Navigation List */}
              <div className="flex-1 overflow-y-auto py-1">
 <p className="px-2 py-1.5 text-[0.62rem] font-black tracking-widest text-mist-500">
                  SYSTEM OPERATIONS
                </p>
                <div className="flex flex-col gap-1">
                  {TABS.map((item) => {
                    const active = tab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onTab(item.id);
                          setDrawerOpen(false);
                        }}
 className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[0.80rem] font-bold tracking-wide transition-colors ${
                        active
                          ? 'border border-nova-400/40 bg-nova-500/15 text-nova-300'
                          : 'text-mist-300 hover:bg-white/6 hover:text-mist-50'
                      }`}
                      >
                        <Icon className={`size-4 shrink-0 ${active ? 'text-nova-300' : 'text-mist-400'}`} />
                        <span className="flex-1">{item.label}</span>
                        {item.id === 'friends' && chatTotal > 0 && (
                          <span className="rounded bg-rose-500 px-1.5 py-0.5 text-[0.6rem] font-black text-white">
                            {chatTotal}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Drawer Quick Controls Footer */}
              <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      sfx.setEnabled(!sfx.isEnabled());
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-1.5 text-[0.72rem] font-bold text-mist-300 hover:text-mist-50"
                  >
                    <Volume2 className="size-3.5 text-nova-400" />
                    <span>SFX: {sfx.isEnabled() ? 'on' : 'off'}</span>
                  </button>
                  <button
                    onClick={() => music.toggle()}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-1.5 text-[0.72rem] font-bold text-mist-300 hover:text-mist-50"
                  >
                    <Music2 className="size-3.5 text-nova-400" />
                    <span>BGM: {musicState === 'playing' ? 'on' : 'off'}</span>
                  </button>
                </div>
                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    onSignOut();
                  }}
 className="flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 py-1.5 text-[0.74rem] font-bold tracking-wide text-red-300 hover:bg-red-500/20"
                >
                  <LogOut className="size-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onTab={onTab}
        onOpenMaterial={(id) => {
          onTab('materials');
          jumpToMaterial(id);
        }}
      />
    </div>
  );
}

export {Button};
