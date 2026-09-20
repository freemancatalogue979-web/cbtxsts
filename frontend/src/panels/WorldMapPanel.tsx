/**
 * World Map — courses as worlds, topics as locations, exams as bosses.
 *
 * The map is the arena's home screen for progress: a winding illustrated path
 * through each course, where every node is a real topic from the question bank
 * and its state (locked → available → learning → mastered) comes straight from
 * the server's mastery bands. Tapping a node opens a location sheet with the
 * four things a player can actually do there — read, drill, flip cards, battle —
 * all wired to the existing materials, practice, flashcard and duel surfaces.
 *
 * Locked is a suggestion, never a wall: the sheet still offers "enter anyway",
 * because gating learning behind a metronome would be worse than the game feel
 * it buys.
 */
import {
  BookOpen,
  Brain,
  Check,
  Coins,
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
import {Avatar, Button, Card, Chip, EmptyState, GameTag, IconOrb, Modal, ProgressBar, SectionHeading, Skeleton, StatTile} from '../components/ui';
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
  {label: string; ring: string; face: string; glyph: 'lock' | 'play' | 'brain' | 'check' | 'star'}
> = {
  locked: {label: 'Locked', ring: 'border-white/12', face: 'from-ink-600 to-ink-800', glyph: 'lock'},
  available: {label: 'New area', ring: 'border-pulse-300/70', face: 'from-pulse-300 to-pulse-600', glyph: 'play'},
  learning: {label: 'In progress', ring: 'border-gold-300/70', face: 'from-gold-300 to-gold-500', glyph: 'brain'},
  mastered: {label: 'Mastered', ring: 'border-mint-300/70', face: 'from-mint-300 to-mint-600', glyph: 'star'},
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
  if (kind === 'lock') return <Lock className="size-5" />;
  if (kind === 'play') return <Play className="size-5" />;
  if (kind === 'brain') return <Brain className="size-5" />;
  if (kind === 'star') return <Star className="size-5" />;
  return <Check className="size-5" />;
}

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
  return (
    <motion.li variants={staggerItem} className="min-w-0">
      <Card className="flex h-full min-w-0 flex-col gap-2.5 p-3.5" press>
        <div className="flex items-start gap-2.5">
          <IconOrb tone={quest.complete ? 'mint' : quest.kind === 'daily' ? 'gold' : 'nova'} size="sm">
            <Icon className="size-4" />
          </IconOrb>
          <div className="min-w-0 flex-1">
            <p className="break-words text-[0.86rem] leading-tight font-extrabold text-mist-100">{quest.label}</p>
            <p className="mt-0.5 break-words text-[0.68rem] font-semibold text-mist-500">{quest.detail}</p>
          </div>
          <Chip className={quest.kind === 'daily' ? 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950' : 'bg-gradient-to-b from-nova-400 to-nova-700 text-white'}>
            {quest.kind}
          </Chip>
        </div>

        <ProgressBar value={quest.progress} max={quest.target} tone={quest.complete ? 'gold' : 'brand'} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.7rem] font-black text-mist-400 tabular">
            {quest.unit === 'seconds' ? `${Math.round(quest.progress / 60)}/${Math.round(quest.target / 60)} min` : `${quest.progress}/${quest.target}`}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] font-black text-mist-300">
            <Coins className="size-3.5 text-gold-300" />
            <span className="tabular">{quest.reward.coins}</span>
            <Sparkles className="size-3.5 text-nova-300" />
            <span className="tabular">{quest.reward.xp} XP</span>
          </span>
        </div>

        {quest.complete && !quest.claimed ? (
          <Button size="sm" variant="gold" block disabled={busy} onClick={() => onClaim(quest)} icon={<Gift className="size-4" />}>
            Collect
          </Button>
        ) : quest.claimed ? (
          <p className="flex items-center justify-center gap-1.5 text-[0.72rem] font-black text-mint-300">
            <Check className="size-3.5" /> Collected
          </p>
        ) : (
          <p className="text-center text-[0.68rem] font-bold text-mist-600">Keep going — it pays out when finished.</p>
        )}
      </Card>
    </motion.li>
  );
}

/** One location on the path: a chunky circle with a state ring and a signpost. */
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
  const isBoss = index === total - 1;
  return (
    <motion.li variants={staggerItem} className="relative min-w-0">
      <div className={`flex min-w-0 items-center gap-3 ${offset % 2 === 0 ? '' : 'flex-row-reverse'}`}>
        <button
          onClick={() => {
            sfx.play('tap');
            onOpen(node);
          }}
          aria-label={`${node.topic} — ${meta.label}`}
          className={`map-node shrink-0 bg-gradient-to-br ${meta.face} ${meta.ring} ${
            node.state === 'available' ? 'map-node-current' : ''
          } ${node.state === 'locked' ? 'map-node-locked' : ''} text-ink-950`}
        >
          <span className="text-[1.25rem] leading-none">{isBoss ? '👑' : glyphFor(meta.glyph)}</span>
          {node.state === 'mastered' && (
            <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2 border-black/40 bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950">
              <Check className="size-3" strokeWidth={3.5} />
            </span>
          )}
        </button>

        <div className={`min-w-0 flex-1 ${offset % 2 === 0 ? 'text-left' : 'text-right'}`}>
          <p className="truncate text-[0.9rem] font-extrabold text-mist-100">{node.topic}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[0.66rem] font-bold text-mist-500" style={{justifyContent: offset % 2 === 0 ? 'flex-start' : 'flex-end'}}>
            <span className="tabular">{node.questions} questions</span>
            {node.mastery > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span className={`tabular ${node.mastery >= 75 ? 'text-mint-300' : 'text-gold-300'}`}>{Math.round(node.mastery)}% mastery</span>
              </>
            )}
            {node.materials.length > 0 && (
              <>
                <span className="opacity-50">·</span>
                <BookOpen className="size-3" />
                <span className="tabular">{node.materials.length}</span>
              </>
            )}
          </p>
        </div>
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
  /** Deep-links into the materials reader (same bridge the palette uses). */
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
    // The boss gate opens the real exam screen, which needs the catalogue row.
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

  /* Any reward that lands elsewhere refreshes the map's totals. */
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

  /* --------------------------------------------------------------- loading */
  if (loading && !data) {
    return (
      <div className="min-w-0 space-y-3.5">
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
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

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <SectionHeading
        title="World map"
        subtitle="Your courses as worlds — walk the path, clear locations, beat the bosses."
        icon={<Map size={18} />}
      />

      {/* ------------------------------------------------------- player hero */}
      <section className="panel-hero rise-in">
        <Scenery layer="map" className="opacity-70" />
        <div className="relative p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={profile?.name ?? 'Player'} hue={profile?.avatar_hue} initials={profile?.initials} size={52} ring />
            <div className="min-w-0 flex-1">
 <p className="text-[0.62rem] font-black tracking-[0.2em] text-mist-400">Level {data.player.level} · {data.player.title}</p>
              <p className="truncate text-[1.05rem] font-extrabold text-mist-50">{profile?.name ?? 'Challenger'}</p>
              {/* the badge this month's ladder has earned, worn on the map */}
              {profile?.season ? (
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.68rem] font-bold text-mist-400">
                  <SeasonBadge rank={profile.season.rank} level={profile.season.level} size="xs" showLevel={false} />
                  {profile.season.rank.label} · season Lv {profile.season.level} · {profile.season.days_left}d left
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="hud-pill text-[0.76rem] text-gold-300 tabular">
                <Coins className="size-3.5" /> {formatNumber(data.player.coins)}
              </span>
              <span className="hud-pill text-[0.76rem] text-flare-300 tabular">
                <Flame className="size-3.5" /> {data.player.streak}d combo
              </span>
            </div>
          </div>

          <div className="mt-3.5">
 <div className="mb-1.5 flex items-center justify-between text-[0.66rem] font-black tracking-wider text-mist-400">
              <span>Experience</span>
              <span className="tabular">{formatNumber(data.player.xp)} XP</span>
            </div>
            <ProgressBar value={levelPercent} max={100} tone="gold" />
          </div>

          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Areas cleared" value={`${data.totals.mastered}/${data.totals.nodes}`} icon={<Star className="size-4" />} tone="mint" />
            <StatTile label="Path walked" value={`${Math.round(data.totals.path_percent)}%`} icon={<MapPin className="size-4" />} tone="nova" />
            <StatTile label="Scrolls" value={data.totals.materials} icon={<BookOpen className="size-4" />} tone="pulse" />
            <StatTile label="Bosses open" value={data.totals.bosses} icon={<Crown className="size-4" />} tone="gold" />
          </div>
        </div>
      </section>

      {/* -------------------------------------------- digital evolution living ecosystem */}
      <DigitalEvolution level={data.player.level} />

      {/* ----------------------------------------------------------- world bar */}
      <div className="no-scrollbar -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1">
        {data.worlds.map((row) => {
          const active = row.course_id === world.course_id;
          return (
            <button
              key={row.course_id}
              onClick={() => {
                sfx.play('tap');
                setWorldId(row.course_id);
              }}
              className={`gpress flex min-w-[13rem] shrink-0 items-center gap-2.5 rounded-2xl border-2 p-2.5 text-left ${
                active ? 'border-nova-400/70 bg-nova-500/16' : 'border-white/12 bg-white/[0.03]'
              }`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br from-ink-500 to-ink-800 text-[1.15rem] shadow-[inset_0_2px_0_rgba(255,255,255,0.25)]">
                {row.theme.emoji}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.78rem] font-black text-mist-100">{row.code}</span>
                <span className="block truncate text-[0.66rem] font-bold text-teal-300">Biome · {row.theme.label}</span>
              </span>
              <span className="ml-auto shrink-0 text-[0.7rem] font-black text-mint-300 tabular">{Math.round(row.percent)}%</span>
            </button>
          );
        })}
      </div>

      {/* -------------------------------------------------------------- world */}
      <section className="panel-hero overflow-hidden">
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b ${world.theme.sky ?? 'from-nova-500/25'} to-transparent`} />
        <Scenery layer="map" />
        <div className="relative">
          <div className="panel-band flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <IconOrb tone="gold" size="md">
              <span className="text-[1.3rem] leading-none">{world.theme.emoji}</span>
            </IconOrb>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[1.05rem] font-extrabold text-mist-50 sm:text-[1.15rem]">{world.title}</h2>
 <p className="truncate text-[0.68rem] font-bold tracking-wider text-mist-500">
                {world.code} · {world.theme.label} · {world.nodes.length} locations
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <GameTag tone={world.percent >= 100 ? 'mastered' : world.percent >= 50 ? 'medium' : 'new'}>
                {Math.round(world.percent)}% cleared
              </GameTag>
            </div>
          </div>

          {world.description && (
            <p className="px-4 pt-3 text-[0.8rem] leading-relaxed font-medium break-words text-mist-400">{world.description}</p>
          )}

          {/* the winding path */}
          <div className="relative px-3 pt-4 pb-2 sm:px-6">
            <div className="pointer-events-none absolute inset-y-4 left-1/2 w-1 -translate-x-1/2 rounded-full bg-white/8" aria-hidden="true" />
            <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="relative space-y-4">
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
              <div className="relative mt-5 flex min-w-0 flex-col items-center gap-2 text-center">
 <span className="text-[0.68rem] font-black tracking-[0.2em] text-gold-300">
                  {bossOpen ? 'Boss is live' : world.boss.status === 'completed' ? 'Boss defeated' : 'Boss approaching'}
                </span>
                <button
                  onClick={() => {
                    if (world.boss) openExam(world.boss.quiz_id);
                  }}
                  className={`map-node bg-gradient-to-br from-flare-400 to-nova-700 text-white ${bossOpen ? 'anim-glow' : ''}`}
                  aria-label={`Boss: ${world.boss.title}`}
                >
                  <Crown className="size-7" />
                </button>
                <p className="max-w-xs text-[0.85rem] font-extrabold break-words text-mist-100">{world.boss.title}</p>
                <p className="text-[0.68rem] font-bold text-mist-500">
                  {world.boss.question_count} questions
                  {world.boss.best_percentage !== null && ` · best ${Math.round(world.boss.best_percentage)}%`}
                  {world.boss.attempts > 0 && ` · ${world.boss.attempts} attempts`}
                </p>
                <Button
                  size="sm"
                  variant={bossOpen ? 'gold' : 'outline'}
                  onClick={() => world.boss && openExam(world.boss.quiz_id)}
                  icon={<Swords className="size-4" />}
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
          title="Quests"
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
        <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid min-w-0 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {[...daily, ...weekly].map((quest) => (
            <QuestCard key={quest.key} quest={quest} busy={busyQuest === quest.key} onClaim={(row) => void claim(row)} />
          ))}
        </motion.ul>
      </section>

      {/* ------------------------------------------------------- location card */}
      <AnimatePresence>
        {openNode && (
          <Modal open onClose={() => setOpenNode(null)} title={openNode.topic} subtitle={`${world.code} · ${STATE_META[openNode.state].label}`}>
            <div className="min-w-0 space-y-3.5">
              <div className="grid min-w-0 grid-cols-3 gap-2">
                <StatTile label="Questions" value={openNode.questions} icon={<Brain className="size-4" />} tone="nova" />
                <StatTile label="Mastery" value={`${Math.round(openNode.mastery)}%`} icon={<Star className="size-4" />} tone="mint" />
                <StatTile label="Answered" value={openNode.answered} icon={<Check className="size-4" />} tone="pulse" />
              </div>

              <ProgressBar value={openNode.mastery} max={100} tone="gold" />

              {openNode.state === 'locked' && (
                <p className="rounded-2xl border-2 border-white/12 bg-white/[0.03] px-3 py-2 text-[0.76rem] font-semibold text-mist-400">
                  The path hasn&apos;t reached here yet — clear the location before it to light the way. You can still jump in early.
                </p>
              )}

              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <Button
                  variant="soft"
                  block
                  disabled={openNode.materials.length === 0}
                  icon={<BookOpen className="size-4" />}
                  onClick={() => {
                    const material = openNode.materials[0];
                    setOpenNode(null);
                    if (!material) return;
                    // Hand the reader a deep link through the same bridge the
                    // command palette uses, so the tab switch lands on the book.
                    onOpenMaterial(material.id);
                  }}
                >
                  Read the scrolls
                </Button>
                <Button
                  variant="outline"
                  block
                  icon={<Brain className="size-4" />}
                  onClick={() => {
                    toast('info', 'Practice ready', `Start a drill on ${openNode.topic} from the Study Lab.`);
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
 <p className="text-[0.64rem] font-black tracking-[0.16em] text-mist-500">Knowledge scrolls</p>
                  {openNode.materials.map((material) => (
                    <div key={material.id} className="sunken flex min-w-0 items-center gap-2.5 px-2.5 py-2">
                      <BookOpen className="size-4 shrink-0 text-pulse-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8rem] font-bold text-mist-100">{material.title}</span>
                        <span className="block text-[0.64rem] font-semibold text-mist-500">
                          {material.minutes > 0 ? `${material.minutes} min read` : 'Reading'} · {material.percent}% done
                        </span>
                      </span>
                      {material.status === 'completed' && <Check className="size-4 shrink-0 text-mint-300" />}
                    </div>
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
