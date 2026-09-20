/** Admin console shell: rail navigation, live overview, and arena settings. */
import {CalendarDays,
  Activity,
  Award,
  BarChart3,
  BookOpen,
  Coins,
  FileText,
  Gauge,
  Gift,
  LayoutGrid,
  Megaphone,
  PackageCheck,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import {useIsDesktop} from '../lib/viewport';
import {Avatar, Button, Card, Chip, Field, SectionHeading, Skeleton, StatTile, TextInput} from '../components/ui';
import {Wordmark} from '../components/Brand';
import ContentAdmin from '../admin/ContentAdmin';
import PeopleAdmin from '../admin/PeopleAdmin';
import BroadcastAdmin from '../admin/BroadcastAdmin';
import EventsAdmin from '../admin/EventsAdmin';
import StudioAdmin from '../admin/StudioAdmin';
import {api} from '../lib/api';
import {formatCompact, formatNumber, formatRelative} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSession} from '../store/session';
import type {AdminOverview, Config} from '../lib/types';

type Section = 'overview' | 'studio' | 'content' | 'events' | 'people' | 'results' | 'broadcast' | 'prizes' | 'claims' | 'settings';

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

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1fr_1.2fr]">
        <motion.div variants={staggerItem}>
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

        <motion.div variants={staggerItem}>
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
      </div>

      <motion.div variants={staggerItem}>
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

export default function Admin({onExit}: {onExit: () => void}) {
  const [section, setSection] = useState<Section>('overview');
  // Bumping the key remounts a section so it re-fetches after a mutation.
  const [bump, setBump] = useState(0);
  const refresh = () => setBump((value) => value + 1);
  // The staff console needs a real desk: wide tables, side-by-side builders and
  // bulk editors. Below 1024px we explain instead of shipping a broken screen.
  const desktop = useIsDesktop();

  if (!desktop) {
    return (
      <div className="aurora relative grid min-h-dvh place-items-center overflow-x-clip px-4 py-10">
        <div className="pointer-events-none fixed inset-0 grid-lines opacity-50" />
        <div className="glass-strong relative w-full max-w-md rounded-[1.4rem] p-5 text-center">
          <div className="brand-gradient absolute inset-x-0 top-0 h-1" />
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-flare-500/30 bg-flare-500/12">
            <Shield className="size-6 text-flare-300" />
          </span>
          <h1 className="mt-3 font-display text-[1.15rem] font-black tracking-tight text-mist-50">Staff console is desktop-only</h1>
          <p className="mt-2 text-[0.84rem] leading-relaxed font-medium text-mist-400">
            The bank dashboard, bulk editors and builders need a wide screen. Open this account on a laptop or desktop
            (1024px and up) to manage the arena.
          </p>
          <div className="mt-4 flex justify-center">
            <Button size="sm" variant="outline" onClick={onExit} icon={<Activity className="size-4" />}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aurora min-h-dvh">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-50" />

      <header className="sticky top-0 z-50 bg-ink-950/85 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.95)] backdrop-blur-xl safe-top">
        <div className="mx-auto flex w-full items-center gap-2 px-2.5 py-1.5 sm:gap-3 sm:px-5 sm:py-2">
          <Wordmark size="header" />
          <Chip className="hidden border-flare-500/30 bg-flare-500/12 text-flare-300 sm:inline-flex" icon={<Shield className="size-3.5" />}>
            Staff console
          </Chip>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onExit} icon={<Activity className="size-4" />}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto flex max-w-[92rem] flex-col gap-3 px-3 pt-3.5 pb-6 sm:px-5 sm:py-5 lg:flex-row lg:gap-5">
        <nav className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0">
          {SECTIONS.map((item) => {
            const active = section === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`relative flex min-h-11 shrink-0 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left text-[0.82rem] font-bold transition-colors touch-manipulation sm:text-[0.84rem] lg:w-full lg:px-4 lg:py-3 ${
                  active ? 'text-white' : 'text-mist-500 hover:bg-white/6 hover:text-mist-200'
                }`}
              >
                {active && <motion.span layoutId="admin-rail" className="brand-gradient absolute inset-0 -z-1 rounded-2xl" />}
                <Icon className="size-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
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
              {section === 'overview' && <Overview key={`overview-${bump}`} onGoto={setSection} />}
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
