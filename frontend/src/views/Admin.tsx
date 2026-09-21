/** Admin console shell: rail navigation, live overview, and arena settings. */
import {CalendarDays,
  Activity,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Coins,
  FileText,
  Gauge,
  Gift,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  Menu,
  PackageCheck,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Avatar, Button, Card, Chip, Field, IconButton, SectionHeading, Skeleton, StatTile, TextInput} from '../components/ui';
import {Wordmark} from '../components/Brand';
import ContentAdmin from '../admin/ContentAdmin';
import PeopleAdmin from '../admin/PeopleAdmin';
import BroadcastAdmin from '../admin/BroadcastAdmin';
import EventsAdmin from '../admin/EventsAdmin';
import StudioAdmin from '../admin/StudioAdmin';
import GroupsAdmin from '../admin/GroupsAdmin';
import {api} from '../lib/api';
import {formatCompact, formatNumber, formatRelative} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSession} from '../store/session';
import type {AdminOverview, Config, Notice} from '../lib/types';

type Section = 'overview' | 'studio' | 'content' | 'events' | 'people' | 'results' | 'broadcast' | 'prizes' | 'claims' | 'groups' | 'settings';

const SECTIONS: {id: Section; label: string; icon: typeof Gauge; group: string}[] = [
  {id: 'overview', label: 'Overview', icon: Gauge, group: 'Arena'},
  {id: 'studio', label: 'Arena studio', icon: Sparkles, group: 'Content'},
  {id: 'content', label: 'Courses & exams', icon: BookOpen, group: 'Content'},
  {id: 'broadcast', label: 'Announcements', icon: Megaphone, group: 'Content'},
  {id: 'events', label: 'Arena events', icon: CalendarDays, group: 'Content'},
  {id: 'prizes', label: 'Prize vault', icon: Gift, group: 'Content'},
  {id: 'people', label: 'Players', icon: Users, group: 'People'},
  {id: 'results', label: 'Results', icon: BarChart3, group: 'People'},
  {id: 'claims', label: 'Prize claims', icon: PackageCheck, group: 'People'},
  {id: 'groups', label: 'Study groups', icon: GraduationCap, group: 'People'},
  {id: 'settings', label: 'Settings', icon: Settings, group: 'System'},
];

function Overview({onGoto}: {onGoto: (section: Section) => void}) {
  const {toast} = useSession();
  const [data, setData] = useState<AdminOverview | null>(null);

  const load = useCallback(() => {
    api.admin
      .overview()
      .then(setData)
      .catch((error: Error) => toast('error', 'Could not load overview', error.message));
  }, [toast]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!data) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-16 sm:h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4 sm:space-y-6">
      <motion.div variants={staggerItem} className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatTile label="Players" value={formatNumber(data.players)} icon={<Users className="size-5" />} tone="nova" hint={`${data.online} online now`} />
        <StatTile label="Submissions" value={formatNumber(data.submissions)} icon={<ScrollText className="size-5" />} tone="pulse" hint={`${data.in_progress} in progress`} />
        <StatTile label="Duels" value={formatNumber(data.duels)} icon={<Swords className="size-5" />} tone="flare" hint={`${data.duels_live} live · ${data.duels_today} today`} />
        <StatTile
          label="Claims pending"
          value={formatNumber(data.prize_claims_pending)}
          icon={<Gift className="size-5" />}
          tone="gold"
          hint={data.prize_claims_pending ? 'Needs your attention' : 'All clear'}
        />
      </motion.div>

      <motion.div variants={staggerItem} className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatTile label="Exams live" value={`${data.active_quizzes}/${data.quizzes}`} icon={<FileText className="size-5" />} tone="mint" />
        <StatTile label="Questions banked" value={formatNumber(data.questions)} icon={<BookOpen className="size-5" />} tone="pulse" />
        <StatTile label="XP in circulation" value={formatCompact(data.xp_awarded)} icon={<Zap className="size-5" />} tone="nova" />
        <StatTile label="Coins in circulation" value={formatCompact(data.coins_in_circulation)} icon={<Coins className="size-5" />} tone="gold" />
      </motion.div>

      {/* Command centre stacking on phones: activity → quick actions →
          records; the desktop two-column split is untouched. */}
      <div className="flex flex-col gap-3 sm:gap-4 lg:grid lg:grid-cols-[1fr_1.2fr]">
        <motion.div variants={staggerItem} className="order-3 lg:order-none">
          <Card className="p-3.5 sm:p-5">
            <SectionHeading
              title="Top players"
              subtitle="By all-time XP"
              icon={<Trophy className="size-4" />}
              action={
                <Button size="sm" variant="ghost" onClick={() => onGoto('people')}>
                  Manage
                </Button>
              }
            />
            <ul className="space-y-1.5">
              {data.top_players.map((player, position) => (
                <li key={player.id} className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.025] px-3 py-2.5">
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-xl text-[0.8rem] font-black tabular ${
                      position === 0 ? 'bg-gold-400/20 text-gold-300' : 'bg-white/6 text-mist-400'
                    }`}
                  >
                    {position + 1}
                  </span>
                  <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={36} online={player.online} photo={{id: player.id, has: player.has_photo}} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.84rem] font-extrabold text-mist-100">{player.name}</p>
                    <p className="truncate text-[0.72rem] font-semibold text-mist-500">
                      Lv {player.level} · {player.title} · {player.duels_won} duel wins
                    </p>
                  </div>
                  <span className="shrink-0 text-[0.82rem] font-black tabular text-nova-300">{formatNumber(player.xp)} XP</span>
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem} className="order-1 lg:order-none">
          <Card className="p-3.5 sm:p-5">
            <SectionHeading title="Live activity" subtitle="Latest events across the arena" icon={<Activity className="size-4" />} />
            <ul className="max-h-[18rem] space-y-1.5 overflow-y-auto overscroll-contain pr-1 sm:max-h-[26rem]">
              {data.recent_activity.map((item) => (
                <li key={item.id} className="flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-3 py-2.5">
                  {item.student ? (
                    <Avatar name={item.student.name} hue={item.student.avatar_hue} initials={item.student.initials} size={32} photo={{id: item.student.id, has: item.student.has_photo}} />
                  ) : (
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-nova-500/14 text-nova-300">
                      <Sparkles className="size-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-bold text-mist-100">{item.title}</p>
                    <p className="truncate text-[0.72rem] font-semibold text-mist-500">
                      {item.student?.name ? `${item.student.name} · ` : ''}
                      {formatRelative(item.created_at)}
                    </p>
                  </div>
                  {item.amount !== 0 && (
                    <span className={`shrink-0 text-[0.74rem] font-black tabular ${item.amount > 0 ? 'text-mint-300' : 'text-flare-300'}`}>
                      {item.amount > 0 ? '+' : ''}
                      {item.amount}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem} className="order-2 lg:order-none lg:col-span-2">
          <Card className="p-3.5 sm:p-5">
            <SectionHeading title="Quick actions" icon={<LayoutGrid className="size-4" />} />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button variant="outline" onClick={() => onGoto('content')} icon={<BookOpen className="size-4" />}>
                New exam
              </Button>
              <Button variant="outline" onClick={() => onGoto('broadcast')} icon={<Megaphone className="size-4" />}>
                Broadcast announcement
              </Button>
              <Button variant="outline" onClick={() => onGoto('prizes')} icon={<Gift className="size-4" />}>
                Publish a prize
              </Button>
              <Button variant="outline" onClick={() => onGoto('claims')} icon={<Award className="size-4" />}>
                Review claims
              </Button>
              <Button variant="outline" onClick={() => onGoto('results')} icon={<BarChart3 className="size-4" />}>
                Export results CSV
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

function SettingsPanel() {
  const {toast, loadBootstrap} = useSession();
  const [config, setConfig] = useState<Config | null>(null);
  const [form, setForm] = useState({institution: '', campus: '', faculty: '', season_name: '', prize_pool_note: ''});
  const [toggles, setToggles] = useState({duels_enabled: true, exams_enabled: true});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.admin
      .config()
      .then((data) => {
        setConfig(data);
        setForm({
          institution: data.institution,
          campus: data.campus,
          faculty: data.faculty,
          season_name: data.season_name,
          prize_pool_note: data.prize_pool_note,
        });
        setToggles({duels_enabled: data.duels_enabled, exams_enabled: data.exams_enabled});
      })
      .catch((error: Error) => toast('error', 'Could not load settings', error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.admin.updateConfig({...form, ...toggles});
      setConfig(updated);
      toast('success', 'Settings saved', 'Broadcast to every connected player.');
      loadBootstrap();
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card className="p-4 sm:p-6">
        <SectionHeading title="Arena identity" subtitle="Shown on the login screen, slips and broadcasts." icon={<Shield className="size-4" />} />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Institution">
            <TextInput value={form.institution} onChange={(event) => setForm({...form, institution: event.target.value})} />
          </Field>
          <Field label="Campus">
            <TextInput value={form.campus} onChange={(event) => setForm({...form, campus: event.target.value})} />
          </Field>
          <Field label="Faculty / department">
            <TextInput value={form.faculty} onChange={(event) => setForm({...form, faculty: event.target.value})} />
          </Field>
          <Field label="Season name">
            <TextInput value={form.season_name} onChange={(event) => setForm({...form, season_name: event.target.value})} />
          </Field>
          <Field label="Prize pool note" className="sm:col-span-2">
            <TextInput value={form.prize_pool_note} onChange={(event) => setForm({...form, prize_pool_note: event.target.value})} />
          </Field>
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <SectionHeading title="Gameplay switches" icon={<Zap className="size-4" />} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {key: 'exams_enabled', label: 'Exams open', detail: 'Players can start and submit arena exams.'},
              {key: 'duels_enabled', label: 'Duels open', detail: 'Players can challenge each other and quick match.'},
            ] as const
          ).map((toggle) => (
            <button
              key={toggle.key}
              onClick={() => setToggles({...toggles, [toggle.key]: !toggles[toggle.key]})}
              className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors touch-manipulation sm:px-4 sm:py-3.5 ${
                toggles[toggle.key] ? 'border-mint-500/35 bg-mint-500/10' : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${toggles[toggle.key] ? 'bg-mint-500' : 'bg-white/15'}`}
              >
                <motion.span
                  className="absolute top-0.5 size-5 rounded-full bg-white"
                  animate={{left: toggles[toggle.key] ? '1.375rem' : '0.125rem'}}
                  transition={{type: 'spring', stiffness: 500, damping: 32}}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.88rem] font-extrabold text-mist-50">{toggle.label}</span>
                <span className="block text-[0.76rem] font-medium text-mist-500">{toggle.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <SectionHeading title="Grading scale" subtitle="Percent thresholds drive the grade shown on slips." icon={<Award className="size-4" />} />
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2 lg:grid-cols-9">
          {config.grading_scale.map((band) => (
            <div key={band.grade} className="rounded-2xl border border-white/8 bg-white/[0.03] px-2 py-2 text-center sm:px-3 sm:py-2.5">
              <p className="text-base font-black text-mist-50 sm:text-lg">{band.grade}</p>
              <p className="text-[0.62rem] font-bold tabular text-mist-500 sm:text-[0.68rem]">≥ {band.min_percent}%</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} loading={saving} icon={<Settings className="size-4" />}>
          Save settings
        </Button>
        <Chip>Admin login: {config.admin_email ?? 'admin@quizarena.ng'}</Chip>
        {config.updated_at && <span className="text-[0.76rem] font-semibold text-mist-600">Updated {formatRelative(config.updated_at)}</span>}
      </div>
    </div>
  );
}

const BELL_SEEN_KEY = 'admin.bell.seen';

function noticeTime(notice: Notice): number {
  const raw = notice.created_at || '';
  return new Date(raw.endsWith('Z') ? raw : `${raw}Z`).getTime() || 0;
}

/** Staff notification bell — the broadcasts this console has sent, newest first. */
function AdminBell() {
  const [rows, setRows] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(BELL_SEEN_KEY) || 0));
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.admin
      .notifications({limit: 12})
      .then((data) => setRows(data.rows))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const unread = rows.filter((row) => noticeTime(row) > seen).length;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      load();
      const stamp = Date.now();
      localStorage.setItem(BELL_SEEN_KEY, String(stamp));
      setSeen(stamp);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative grid size-10 shrink-0 place-items-center rounded-2xl transition-colors touch-manipulation hover:bg-white/8"
      >
        <Bell className="size-[1.15rem] text-mist-300" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-flare-500 px-1 text-[0.6rem] font-black text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{opacity: 0, y: -6, scale: 0.97}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: -6, scale: 0.97}}
            transition={{duration: 0.16}}
            className="glass-strong absolute top-full right-0 z-60 mt-1.5 w-[19rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-3xl border border-white/10"
          >
            <p className="border-b border-white/8 px-3.5 py-2.5 text-[0.74rem] font-extrabold text-mist-300">
              Latest broadcasts
            </p>
            <div className="max-h-[22rem] overflow-y-auto overscroll-contain">
              {rows.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[0.78rem] font-semibold text-mist-500">
                  Nothing broadcast yet.
                </p>
              ) : (
                rows.map((row) => (
                  <div key={row.id} className="border-b border-white/6 px-3.5 py-2.5 last:border-0">
                    <p className="truncate text-[0.8rem] font-extrabold text-mist-100">{row.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[0.72rem] font-medium text-mist-500">{row.message}</p>
                    <p className="mt-1 text-[0.66rem] font-bold text-mist-600">{formatRelative(row.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Compact profile control: settings shortcut + sign-out, phone-friendly. */
function AdminProfile({onSettings, onExit}: {onSettings: () => void; onExit: () => void}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label="Staff profile"
        className="grid size-10 shrink-0 place-items-center rounded-2xl transition-colors touch-manipulation hover:bg-white/8"
      >
        <span className="brand-gradient grid size-8 place-items-center rounded-xl text-white">
          <Shield className="size-4" />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{opacity: 0, y: -6, scale: 0.97}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: -6, scale: 0.97}}
            transition={{duration: 0.16}}
            className="glass-strong absolute top-full right-0 z-60 mt-1.5 w-52 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-3xl border border-white/10 p-1.5"
          >
            <p className="px-2.5 pt-1.5 pb-2 text-[0.7rem] font-bold text-mist-500">Signed in as staff</p>
            <button
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
              className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left text-[0.82rem] font-bold text-mist-200 transition-colors touch-manipulation hover:bg-white/8"
            >
              <Settings className="size-4 text-mist-400" /> Console settings
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onExit();
              }}
              className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left text-[0.82rem] font-bold text-flare-300 transition-colors touch-manipulation hover:bg-white/8"
            >
              <Activity className="size-4" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Admin({onExit}: {onExit: () => void}) {
  const [section, setSection] = useState<Section>('overview');
  // Bumping the key remounts a section so it re-fetches after a mutation.
  const [bump, setBump] = useState(0);
  const refresh = () => setBump((value) => value + 1);
  // Phones get the full console too: the rail folds into a hamburger drawer
  // below lg, every section keeps its permissions and functionality.
  const [navOpen, setNavOpen] = useState(false);

  const goto = (next: Section) => {
    setSection(next);
    setNavOpen(false);
    window.scrollTo({top: 0});
  };

  const groups = SECTIONS.reduce<{name: string; items: typeof SECTIONS}[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else acc.push({name: item.group, items: [item]});
    return acc;
  }, []);

  return (
    <div className="aurora min-h-dvh">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-50" />

      <header className="sticky top-0 z-50 bg-ink-950/85 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.95)] backdrop-blur-xl safe-top">
        <div className="mx-auto flex w-full items-center gap-1 px-2 py-1.5 sm:gap-3 sm:px-5 sm:py-2">
          <IconButton label="Open console menu" className="rounded-2xl lg:hidden" onClick={() => setNavOpen(true)}>
            <Menu className="size-5 text-mist-200" />
          </IconButton>
          <Wordmark size="header" className="hidden sm:block" />
          <p className="min-w-0 flex-1 truncate text-[0.86rem] font-black tracking-tight text-mist-100 sm:flex-none sm:text-[0.92rem]">
            <span className="sm:hidden">Staff console</span>
          </p>
          <Chip className="hidden border-flare-500/30 bg-flare-500/12 text-flare-300 sm:inline-flex" icon={<Shield className="size-3.5" />}>
            Staff console
          </Chip>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-2">
            <AdminBell />
            <span className="hidden sm:block">
              <AdminProfile onSettings={() => goto('settings')} onExit={onExit} />
            </span>
            <Button size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={onExit} icon={<Activity className="size-4" />}>
              Sign out
            </Button>
            <span className="sm:hidden">
              <AdminProfile onSettings={() => goto('settings')} onExit={onExit} />
            </span>
          </div>
        </div>
      </header>

      {/* Mobile navigation drawer — the desktop rail folds in here below lg. */}
      <AnimatePresence>
        {navOpen && (
          <>
            <motion.div
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              onClick={() => setNavOpen(false)}
              className="scrim fixed inset-0 z-60 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{x: '-102%'}}
              animate={{x: 0}}
              exit={{x: '-102%'}}
              transition={{type: 'spring', stiffness: 380, damping: 34}}
              className="fixed inset-y-0 left-0 z-60 flex w-[17.5rem] max-w-[86vw] flex-col border-r border-white/10 bg-ink-950/97 backdrop-blur-xl lg:hidden"
            >
              <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3 safe-top">
                <span className="brand-gradient grid size-9 shrink-0 place-items-center rounded-2xl text-white">
                  <Shield className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.88rem] font-black tracking-tight text-mist-50">Staff console</p>
                  <p className="truncate text-[0.68rem] font-bold text-mist-500">Quiz Arena admin</p>
                </div>
                <IconButton label="Close menu" onClick={() => setNavOpen(false)}>
                  <X className="size-4.5 text-mist-300" />
                </IconButton>
              </div>
              <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
                {groups.map((group) => (
                  <div key={group.name} className="mb-3 last:mb-0">
                    <p className="px-2.5 pb-1.5 text-[0.66rem] font-extrabold tracking-wide text-mist-600">{group.name}</p>
                    <div className="flex flex-col gap-0.5">
                      {group.items.map((item) => {
                        const active = section === item.id;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            onClick={() => goto(item.id)}
                            className={`relative flex min-h-11 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-[0.84rem] font-bold transition-colors touch-manipulation ${
                              active ? 'text-white' : 'text-mist-400 hover:bg-white/6 hover:text-mist-200'
                            }`}
                          >
                            {active && <span className="brand-gradient absolute inset-0 -z-1 rounded-2xl" />}
                            <Icon className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
              <div className="border-t border-white/8 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
                <Button size="sm" variant="outline" className="w-full justify-center" onClick={onExit} icon={<Activity className="size-4" />}>
                  Sign out
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="relative mx-auto flex max-w-[92rem] flex-col gap-3 px-3 pt-3.5 pb-6 sm:px-5 sm:py-5 lg:flex-row lg:gap-5">
        <nav className="hidden w-60 shrink-0 flex-col lg:flex">
          {groups.map((group) => (
            <div key={group.name} className="mb-2.5 last:mb-0">
              <p className="px-4 pb-1 text-[0.66rem] font-extrabold tracking-wide text-mist-600">{group.name}</p>
              {group.items.map((item) => {
                const active = section === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => goto(item.id)}
                    className={`relative flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left text-[0.84rem] font-bold transition-colors touch-manipulation ${
                      active ? 'text-white' : 'text-mist-500 hover:bg-white/6 hover:text-mist-200'
                    }`}
                  >
                    {active && <motion.span layoutId="admin-rail" className="brand-gradient absolute inset-0 -z-1 rounded-2xl" />}
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{opacity: 0, y: 12}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -8}}
              transition={{duration: 0.24}}
            >
              {section === 'overview' && <Overview key={`overview-${bump}`} onGoto={goto} />}
              {section === 'studio' && <StudioAdmin key={`studio-${bump}`} />}
              {section === 'content' && <ContentAdmin key={`content-${bump}`} onChanged={refresh} />}
              {section === 'events' && <EventsAdmin key={`events-${bump}`} onChanged={refresh} />}
              {(section === 'broadcast' || section === 'prizes') && (
                <BroadcastAdmin key={`broadcast-${section}-${bump}`} tab={section === 'broadcast' ? 'notices' : 'prizes'} onChanged={refresh} />
              )}
              {(section === 'people' || section === 'results' || section === 'claims') && (
                <PeopleAdmin
                  key={`people-${section}-${bump}`}
                  tab={section === 'people' ? 'players' : section === 'results' ? 'results' : 'claims'}
                  onChanged={refresh}
                />
              )}
              {section === 'groups' && <GroupsAdmin key={`groups-${bump}`} />}
              {section === 'settings' && <SettingsPanel key={`settings-${bump}`} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <p className="px-4 pb-6 text-center text-[0.7rem] font-semibold text-mist-600 sm:pb-8 sm:text-[0.72rem]">
        Quiz Arena staff console · every change broadcasts live to connected players
      </p>
    </div>
  );
}
