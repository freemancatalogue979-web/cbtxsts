/**
 * World Map — courses as worlds, topics as locations, exams as bosses.
 *
 * Visual language: an expedition atlas. Each course is a biome, each topic a
 * waypoint on a glowing path, each exam a boss gate. Mastery paints the trail;
 * locked areas stay visible but dim — "enter anyway" is always available.
 */
import {
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  Coins,
  Compass,
  Crown,
  Flame,
  Gift,
  Layers,
  Lock,
  Map,
  MapPin,
  Play,
  Sparkles,
  Star,
  Swords,
  Timer,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  GameTag,
  IconOrb,
  Modal,
  ProgressBar,
  SectionHeading,
  Skeleton,
  StatTile,
} from '../components/ui';
import SeasonBadge from '../components/SeasonBadge';
import DigitalEvolution from '../components/DigitalEvolution';
import Scenery from '../components/Scenery';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';
import type {MapNode, QuestRow, Quiz, WorldMap, WorldRow} from '../lib/types';

/* ------------------------------------------------------------------ helpers */

const STATE_META: Record<
  MapNode['state'],
  {
    label: string;
    ring: string;
    face: string;
    glow: string;
    badge: string;
    glyph: 'lock' | 'play' | 'brain' | 'check' | 'star';
  }
> = {
  locked: {
    label: 'Sealed',
    ring: 'border-white/15',
    face: 'from-ink-700 to-ink-900',
    glow: '',
    badge: 'bg-white/10 text-mist-400',
    glyph: 'lock',
  },
  available: {
    label: 'Open frontier',
    ring: 'border-pulse-300/80',
    face: 'from-pulse-300 via-pulse-400 to-pulse-700',
    glow: 'wm-node-pulse',
    badge: 'bg-pulse-500/25 text-pulse-200',
    glyph: 'play',
  },
  learning: {
    label: 'Under siege',
    ring: 'border-gold-300/80',
    face: 'from-gold-300 via-amber-400 to-gold-600',
    glow: 'wm-node-warm',
    badge: 'bg-gold-500/25 text-gold-200',
    glyph: 'brain',
  },
  mastered: {
    label: 'Conquered',
    ring: 'border-mint-300/80',
    face: 'from-mint-300 via-emerald-400 to-mint-700',
    glow: '',
    badge: 'bg-mint-500/25 text-mint-200',
    glyph: 'star',
  },
};

const QUEST_ICONS: Record<string, typeof Brain> = {
  brain: Brain,
  timer: Timer,
  cards: Layers,
  swords: Swords,
  star: Star,
  book: BookOpen,
};

function glyphFor(kind: 'lock' | 'play' | 'brain' | 'check' | 'star') {
  if (kind === 'lock') return <Lock className="size-5" strokeWidth={2.4} />;
  if (kind === 'play') return <Play className="size-5" strokeWidth={2.4} />;
  if (kind === 'brain') return <Brain className="size-5" strokeWidth={2.4} />;
  if (kind === 'star') return <Star className="size-5" strokeWidth={2.4} />;
  return <Check className="size-5" strokeWidth={2.8} />;
}

/* ---------------------------------------------------------------- quest card */

function QuestCard({
  quest,
  busy,
  onClaim,
}: {
  quest: QuestRow;
  busy: boolean;
  onClaim: (quest: QuestRow) => void;
}) {
  const Icon = QUEST_ICONS[quest.icon] ?? Star;
  const done = quest.complete;
  const claimed = quest.claimed;
  const daily = quest.kind === 'daily';

  return (
    <motion.li variants={staggerItem} className="min-w-0">
      <div
        className={`wm-quest relative flex h-full min-w-0 flex-col gap-2.5 overflow-hidden p-3.5 ${
          done && !claimed ? 'wm-quest-ready' : claimed ? 'opacity-70' : ''
        }`}
      >
        <div className="pointer-events-none absolute -top-8 -right-6 size-24 rounded-full bg-gradient-to-br from-white/8 to-transparent blur-2xl" />
        <div className="relative flex items-start gap-2.5">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-2xl border border-black/40 shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] ${
              done
                ? 'bg-gradient-to-br from-mint-300 to-mint-600 text-ink-950'
                : daily
                  ? 'bg-gradient-to-br from-gold-300 to-gold-600 text-ink-950'
                  : 'bg-gradient-to-br from-nova-400 to-nova-700 text-white'
            }`}
          >
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="break-words text-[0.86rem] leading-tight font-extrabold text-mist-50">{quest.label}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-[0.58rem] font-black tracking-wider uppercase ${
                  daily ? 'bg-gold-500/20 text-gold-200' : 'bg-nova-500/20 text-nova-200'
                }`}
              >
                {quest.kind}
              </span>
            </div>
            <p className="mt-0.5 break-words text-[0.68rem] font-semibold text-mist-400">{quest.detail}</p>
          </div>
        </div>

        <div className="relative">
          <ProgressBar value={quest.progress} max={quest.target} tone={done ? 'gold' : 'brand'} />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[0.7rem] font-black text-mist-400 tabular">
              {quest.unit === 'seconds'
                ? `${Math.round(quest.progress / 60)}/${Math.round(quest.target / 60)} min`
                : `${quest.progress}/${quest.target}`}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] font-black text-mist-200">
              <Coins className="size-3.5 text-gold-300" />
              <span className="tabular">{quest.reward.coins}</span>
              <Sparkles className="size-3.5 text-nova-300" />
              <span className="tabular">{quest.reward.xp} XP</span>
            </span>
          </div>
        </div>

        {done && !claimed ? (
          <Button size="sm" variant="gold" block disabled={busy} onClick={() => onClaim(quest)} icon={<Gift className="size-4" />}>
            Collect rewards
          </Button>
        ) : claimed ? (
          <p className="flex items-center justify-center gap-1.5 text-[0.72rem] font-bold text-mint-300">
            <Check className="size-3.5" /> Banked
          </p>
        ) : null}
      </div>
    </motion.li>
  );
}

/* ---------------------------------------------------------------- map node */

function MapNodeButton({
  node,
  index,
  total,
  offset,
  onOpen,
}: {
  node: MapNode;
  index: number;
  total: number;
  offset: number;
  onOpen: (node: MapNode) => void;
}) {
  const meta = STATE_META[node.state];
  const flip = offset % 2 === 1;
  const progress = Math.min(100, Math.max(0, node.mastery));

  return (
    <motion.li variants={staggerItem} className="relative min-w-0">
      {/* trail connector above (except first) */}
      {index > 0 && (
        <div className="wm-trail pointer-events-none absolute -top-4 left-1/2 h-4 w-0.5 -translate-x-1/2" aria-hidden />
      )}

      <div className={`flex min-w-0 items-center gap-3 sm:gap-4 ${flip ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          onClick={() => {
            sfx.play('tap');
            onOpen(node);
          }}
          aria-label={`${node.topic} — ${meta.label}`}
          className={`wm-node shrink-0 bg-gradient-to-br ${meta.face} ${meta.ring} ${meta.glow} ${
            node.state === 'locked' ? 'wm-node-locked' : ''
          } text-ink-950`}
        >
          {/* mastery ring */}
          <svg className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 64 64" aria-hidden>
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="3" />
            {progress > 0 && (
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(progress / 100) * 176} 176`}
              />
            )}
          </svg>
          <span className="relative z-[1] grid place-items-center">{glyphFor(meta.glyph)}</span>
          {node.state === 'mastered' && (
            <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2 border-black/40 bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 shadow-md">
              <Check className="size-3" strokeWidth={3.5} />
            </span>
          )}
          {node.state === 'available' && (
            <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-pulse-300 shadow-[0_0_10px_2px_rgba(168,85,247,0.7)]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            sfx.play('tap');
            onOpen(node);
          }}
          className={`wm-node-card min-w-0 flex-1 text-left ${flip ? 'text-right' : ''}`}
        >
          <div className={`flex flex-wrap items-center gap-1.5 ${flip ? 'justify-end' : ''}`}>
            <p className="truncate text-[0.9rem] font-extrabold text-mist-50">{node.topic}</p>
            <span className={`rounded-full px-1.5 py-0.5 text-[0.58rem] font-black tracking-wide ${meta.badge}`}>
              {meta.label}
            </span>
          </div>
          <p
            className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.66rem] font-bold text-mist-400 ${
              flip ? 'justify-end' : ''
            }`}
          >
            <span className="inline-flex items-center gap-1 tabular">
              <Brain className="size-3 opacity-70" />
              {node.questions} Qs
            </span>
            {node.mastery > 0 && (
              <span className={`tabular ${node.mastery >= 75 ? 'text-mint-300' : 'text-gold-300'}`}>
                · {Math.round(node.mastery)}% mastery
              </span>
            )}
            {node.materials.length > 0 && (
              <span className="inline-flex items-center gap-1">
                · <BookOpen className="size-3" /> {node.materials.length}
              </span>
            )}
          </p>
          {node.mastery > 0 && (
            <div className={`mt-2 max-w-[11rem] ${flip ? 'ml-auto' : ''}`}>
              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${node.mastery >= 75 ? 'bg-mint-400' : 'bg-gold-400'}`}
                  style={{width: `${Math.min(100, node.mastery)}%`}}
                />
              </div>
            </div>
          )}
        </button>
      </div>
    </motion.li>
  );
}

/* -------------------------------------------------------------------- panel */

export default function WorldMapPanel({
  onStartExam,
  onOpenDuels,
  onOpenMaterial,
}: {
  onStartExam: (quiz: Quiz) => void;
  onOpenDuels: () => void;
  onOpenMaterial: (materialId: number) => void;
}) {
  const {profile, toast, on, refreshProfile, pushRewards} = useSession();
  const [data, setData] = useState<WorldMap | null>(null);
  const [worldId, setWorldId] = useState<number | null>(null);
  const [openNode, setOpenNode] = useState<MapNode | null>(null);
  const [busyQuest, setBusyQuest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);

  const load = useCallback(async () => {
    try {
      const payload = await api.arena.worldMap();
      setData(payload);
      setWorldId((current) => current ?? payload.worlds[0]?.course_id ?? null);
    } catch (error) {
      toast('error', 'Could not open the world map', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    api
      .quizzes()
      .then(setQuizzes)
      .catch(() => undefined);
  }, [load]);

  const openExam = useCallback(
    (quizId: number) => {
      const quiz = quizzes.find((row) => row.id === quizId);
      if (!quiz) {
        toast('info', 'Exam not in your catalogue yet', 'It will appear on the Play tab once an admin opens its window.');
        return;
      }
      onStartExam(quiz);
    },
    [onStartExam, quizzes, toast],
  );

  useEffect(() => on('rewards', () => void load()), [on, load]);

  const world: WorldRow | null = useMemo(
    () => data?.worlds.find((row) => row.course_id === worldId) ?? data?.worlds[0] ?? null,
    [data, worldId],
  );

  const daily = (data?.quests ?? []).filter((row) => row.kind === 'daily');
  const weekly = (data?.quests ?? []).filter((row) => row.kind === 'weekly');
  const collectable = (data?.quests ?? []).filter((row) => row.complete && !row.claimed);

  const claim = useCallback(
    async (quest: QuestRow) => {
      setBusyQuest(quest.key);
      try {
        const result = await api.arena.claimQuest(quest.key);
        if (result.rewards?.length) pushRewards(result.rewards);
        sfx.play('coin');
        toast('success', 'Quest complete', `${quest.label} — rewards banked.`);
        await Promise.all([load(), refreshProfile()]);
      } catch (error) {
        toast('error', 'Could not collect that', (error as Error).message);
      } finally {
        setBusyQuest(null);
      }
    },
    [load, pushRewards, refreshProfile, toast],
  );

  const claimAll = useCallback(async () => {
    for (const quest of collectable) {
      await claim(quest);
    }
  }, [claim, collectable]);

  if (loading && !data) {
    return (
      <div className="min-w-0 space-y-3.5">
        <Skeleton className="h-48" />
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!data || !world) {
    return (
      <Card className="p-2">
        <EmptyState
          icon={<MapPin className="size-6" />}
          title="No worlds are open yet"
          detail="As soon as a course has questions in the bank, its world appears here as an adventure path."
        />
      </Card>
    );
  }

  const levelPercent = data.player.xp % 1000 ? (data.player.xp % 1000) / 10 : 0;
  const bossOpen = world.boss?.status === 'active';
  const cleared = world.nodes.filter((n) => n.state === 'mastered').length;

  return (
    <div className="wm-root min-w-0 space-y-4 sm:space-y-5">
      {/* ------------------------------------------------------- expedition HUD */}
      <section className="wm-hero relative overflow-hidden">
        <div className="wm-hero-aurora pointer-events-none absolute inset-0" aria-hidden />
        <Scenery layer="map" className="opacity-50" />
        <div className="relative p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[0.62rem] font-black tracking-[0.22em] text-nova-300 uppercase">
                <Compass className="size-3.5" /> Expedition atlas
              </p>
              <h1 className="mt-1 text-[1.25rem] leading-tight font-black tracking-tight text-mist-50 sm:text-[1.4rem]">
                World map
              </h1>
              <p className="mt-1 max-w-md text-[0.78rem] font-medium text-mist-400">
                Courses become biomes. Topics are waypoints. Exams are bosses. Clear the path.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="wm-pill text-gold-200">
                <Coins className="size-3.5 text-gold-300" />
                <span className="tabular">{formatNumber(data.player.coins)}</span>
              </span>
              <span className="wm-pill text-flare-200">
                <Flame className="size-3.5 text-flare-300" />
                <span className="tabular">{data.player.streak}d</span>
              </span>
            </div>
          </div>

          <div className="mt-4 flex min-w-0 items-center gap-3">
            <Avatar name={profile?.name ?? 'Player'} hue={profile?.avatar_hue} initials={profile?.initials} size={48} ring />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-extrabold text-mist-50">{profile?.name ?? 'Challenger'}</p>
              <p className="text-[0.68rem] font-bold text-mist-400">
                Lv {data.player.level} · {data.player.title}
              </p>
              {profile?.season ? (
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.66rem] font-bold text-mist-500">
                  <SeasonBadge rank={profile.season.rank} level={profile.season.level} size="xs" showLevel={false} />
                  {profile.season.rank.label} · {profile.season.days_left}d left
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-3.5">
            <div className="mb-1 flex items-center justify-between text-[0.64rem] font-black tracking-wider text-mist-400">
              <span>XP TO NEXT LEVEL</span>
              <span className="tabular text-mist-300">{formatNumber(data.player.xp)} XP</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-nova-400 via-pulse-400 to-gold-400 shadow-[0_0_12px_rgba(168,85,247,0.45)]"
                style={{width: `${Math.min(100, levelPercent)}%`}}
              />
            </div>
          </div>

          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="wm-stat">
              <Star className="size-4 text-mint-300" />
              <div className="min-w-0">
                <p className="text-[0.58rem] font-black tracking-wider text-mist-500">CLEARED</p>
                <p className="text-[0.95rem] font-black tabular text-mist-50">
                  {data.totals.mastered}
                  <span className="text-mist-500">/{data.totals.nodes}</span>
                </p>
              </div>
            </div>
            <div className="wm-stat">
              <MapPin className="size-4 text-nova-300" />
              <div className="min-w-0">
                <p className="text-[0.58rem] font-black tracking-wider text-mist-500">PATH</p>
                <p className="text-[0.95rem] font-black tabular text-mist-50">{Math.round(data.totals.path_percent)}%</p>
              </div>
            </div>
            <div className="wm-stat">
              <BookOpen className="size-4 text-pulse-300" />
              <div className="min-w-0">
                <p className="text-[0.58rem] font-black tracking-wider text-mist-500">SCROLLS</p>
                <p className="text-[0.95rem] font-black tabular text-mist-50">{data.totals.materials}</p>
              </div>
            </div>
            <div className="wm-stat">
              <Crown className="size-4 text-gold-300" />
              <div className="min-w-0">
                <p className="text-[0.58rem] font-black tracking-wider text-mist-500">BOSSES</p>
                <p className="text-[0.95rem] font-black tabular text-mist-50">{data.totals.bosses}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <DigitalEvolution level={data.player.level} />

      {/* ----------------------------------------------------------- biome picker */}
      <section className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
          <p className="text-[0.62rem] font-black tracking-[0.18em] text-mist-500">BIOMES · {data.worlds.length} WORLDS</p>
          <p className="text-[0.66rem] font-bold text-mist-500">{cleared}/{world.nodes.length} cleared here</p>
        </div>
        <div className="no-scrollbar -mx-1 flex min-w-0 gap-2.5 overflow-x-auto px-1 pb-1">
          {data.worlds.map((row) => {
            const active = row.course_id === world.course_id;
            return (
              <button
                key={row.course_id}
                type="button"
                onClick={() => {
                  sfx.play('tap');
                  setWorldId(row.course_id);
                }}
                className={`wm-biome shrink-0 ${active ? 'wm-biome-active' : ''}`}
              >
                <span className="text-[1.35rem] leading-none">{row.theme.emoji}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.78rem] font-extrabold text-mist-100">{row.code}</span>
                  <span className="block truncate text-[0.62rem] font-bold text-mist-400">{row.theme.label}</span>
                </span>
                <span
                  className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[0.62rem] font-black tabular ${
                    row.percent >= 100 ? 'bg-mint-500/25 text-mint-200' : 'bg-white/10 text-mist-300'
                  }`}
                >
                  {Math.round(row.percent)}%
                </span>
                {active && <span className="wm-biome-bar" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------------- path */}
      <section className="wm-path-panel relative overflow-hidden">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b ${world.theme.sky ?? 'from-nova-500/30'} to-transparent`}
        />
        <div className="wm-path-stars pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <Scenery layer="map" />

        <div className="relative">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/8 bg-black/25 px-4 py-3 backdrop-blur-sm">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-black/40 bg-gradient-to-br from-white/15 to-white/5 text-[1.35rem] shadow-[inset_0_2px_0_rgba(255,255,255,0.25)]">
              {world.theme.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[1.05rem] font-extrabold text-mist-50 sm:text-[1.15rem]">{world.title}</h2>
              <p className="truncate text-[0.68rem] font-bold tracking-wider text-mist-400">
                {world.code} · {world.theme.label} · {world.nodes.length} locations
              </p>
            </div>
            <GameTag tone={world.percent >= 100 ? 'mastered' : world.percent >= 50 ? 'medium' : 'new'}>
              {Math.round(world.percent)}% cleared
            </GameTag>
          </div>

          {world.description && (
            <p className="px-4 pt-3 text-[0.8rem] leading-relaxed font-medium break-words text-mist-400">{world.description}</p>
          )}

          {/* winding path */}
          <div className="relative px-3 pt-5 pb-3 sm:px-6">
            {/* central spine */}
            <div className="wm-spine pointer-events-none absolute inset-y-6 left-1/2 w-[3px] -translate-x-1/2 rounded-full" aria-hidden />

            <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="relative space-y-5">
              {world.nodes.map((node, index) => (
                <MapNodeButton
                  key={`${world.course_id}-${node.topic}`}
                  node={node}
                  index={index}
                  total={world.nodes.length}
                  offset={index}
                  onOpen={setOpenNode}
                />
              ))}
            </motion.ul>

            {/* boss gate */}
            {world.boss && (
              <div className="wm-boss relative mt-6 flex min-w-0 flex-col items-center gap-2.5 px-2 text-center">
                <div className="wm-boss-aura pointer-events-none absolute -inset-x-4 -top-6 h-40" aria-hidden />
                <span className="relative text-[0.66rem] font-black tracking-[0.22em] text-gold-300 uppercase">
                  {bossOpen ? 'Boss is live' : world.boss.status === 'completed' ? 'Boss defeated' : 'Boss approaching'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (world.boss) openExam(world.boss.quiz_id);
                  }}
                  className={`wm-boss-node ${bossOpen ? 'wm-boss-live' : ''}`}
                  aria-label={`Boss: ${world.boss.title}`}
                >
                  <Crown className="size-8" />
                </button>
                <p className="relative max-w-xs text-[0.9rem] font-extrabold break-words text-mist-50">{world.boss.title}</p>
                <p className="relative text-[0.68rem] font-bold text-mist-400">
                  {world.boss.question_count} questions
                  {world.boss.best_percentage !== null && ` · best ${Math.round(world.boss.best_percentage)}%`}
                  {world.boss.attempts > 0 && ` · ${world.boss.attempts} attempts`}
                </p>
                <Button
                  size="sm"
                  variant={bossOpen ? 'gold' : 'outline'}
                  onClick={() => world.boss && openExam(world.boss.quiz_id)}
                  icon={<Swords className="size-4" />}
                  className="relative"
                >
                  {bossOpen ? 'Enter the boss fight' : world.boss.status === 'completed' ? 'Review the exam' : 'View the exam'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ quests */}
      <section className="min-w-0">
        <SectionHeading
          title="Missions"
          subtitle="Daily and weekly goals — verified on the server, paid once."
          icon={<Zap className="size-4" />}
          action={
            collectable.length > 1 ? (
              <Button size="sm" variant="gold" onClick={() => void claimAll()} disabled={busyQuest !== null} icon={<Gift className="size-3.5" />}>
                Collect all ({collectable.length})
              </Button>
            ) : undefined
          }
        />
        <motion.ul
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="mt-2 grid min-w-0 gap-2.5 sm:grid-cols-2"
        >
          {[...daily, ...weekly].map((quest) => (
            <QuestCard key={quest.key} quest={quest} busy={busyQuest === quest.key} onClaim={(row) => void claim(row)} />
          ))}
        </motion.ul>
        {daily.length + weekly.length === 0 && (
          <Card className="mt-2 p-4">
            <EmptyState icon={<Trophy className="size-5" />} title="No active missions" detail="Check back after you answer a few questions." />
          </Card>
        )}
      </section>

      {/* location sheet */}
      <AnimatePresence>
        {openNode && (
          <Modal
            icon={MapPin}
            tone="cyan"
            open
            onClose={() => setOpenNode(null)}
            title={openNode.topic}
            subtitle={`${world.code} · ${STATE_META[openNode.state].label}`}
          >
            <div className="grid min-w-0 gap-3">
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Questions" value={openNode.questions} icon={<Brain className="size-4" />} tone="nova" />
                <StatTile label="Mastery" value={`${Math.round(openNode.mastery)}%`} icon={<Star className="size-4" />} tone="mint" />
                <StatTile label="Answered" value={openNode.answered} icon={<Check className="size-4" />} tone="pulse" />
              </div>
              <ProgressBar value={openNode.mastery} max={100} tone="gold" />

              <div className="grid gap-2">
                {openNode.state === 'locked' && (
                  <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[0.75rem] font-semibold text-mist-400">
                    Sealed for the path — you can still enter and study. Lock is a suggestion, never a wall.
                  </p>
                )}
                <Button
                  block
                  icon={<Play className="size-4" />}
                  onClick={() => {
                    toast('info', 'Drill mode', 'Open Practice from Study to train this topic.');
                    setOpenNode(null);
                  }}
                >
                  Drill this topic
                </Button>
                <Button
                  variant="outline"
                  block
                  icon={<Layers className="size-4" />}
                  onClick={() => {
                    toast('info', 'Training cards', 'The Study Lab builds a deck from this topic.');
                    setOpenNode(null);
                  }}
                >
                  Flashcards
                </Button>
                <Button
                  variant="outline"
                  block
                  icon={<Users className="size-4" />}
                  onClick={() => {
                    setOpenNode(null);
                    onOpenDuels();
                  }}
                >
                  Challenge a friend
                </Button>
              </div>

              {openNode.materials.length > 0 && (
                <div className="min-w-0 space-y-1.5">
                  <p className="text-[0.64rem] font-black tracking-[0.16em] text-mist-500">KNOWLEDGE SCROLLS</p>
                  {openNode.materials.map((material) => (
                    <button
                      key={material.id}
                      type="button"
                      onClick={() => {
                        setOpenNode(null);
                        onOpenMaterial(material.id);
                      }}
                      className="sunken flex w-full min-w-0 items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:border-nova-400/40"
                    >
                      <BookOpen className="size-4 shrink-0 text-pulse-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8rem] font-bold text-mist-100">{material.title}</span>
                        <span className="block text-[0.64rem] font-semibold text-mist-500">
                          {material.minutes > 0 ? `${material.minutes} min read` : 'Reading'} · {material.percent}% done
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-mist-500" />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-[0.72rem] font-bold text-mist-500">
                <Trophy className="size-3.5 text-gold-300" />
                {openNode.practice.runs > 0
                  ? `Best drill ${formatNumber(openNode.practice.best)} · ${Math.round(openNode.practice.accuracy)}% accuracy`
                  : 'No drills recorded here yet.'}
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
