/**
 * Insights — personal analytics, mastery heatmap, study plan and the badge
 * collection. Everything is derived from the same answer records exams, duels
 * and practice write to, so the numbers can never disagree with the arena.
 */
import {Award, BarChart3, Brain, Flame, Lightbulb, Target, TrendingUp, Trophy} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {Card, Chip, ProgressBar, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {api, type Json} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';

type Segment = 'overview' | 'topics' | 'plan' | 'collection';

const TIER_TONE: Record<string, string> = {
  bronze: 'border-amber-700/40 bg-amber-700/12 text-amber-200',
  silver: 'border-white/25 bg-white/8 text-mist-200',
  gold: 'border-gold-500/35 bg-gold-500/12 text-gold-200',
  platinum: 'border-nova-500/35 bg-nova-500/12 text-nova-200',
  diamond: 'border-nova-400/35 bg-nova-400/12 text-nova-200',
};

function Sparkline({points}: {points: number[]}) {
  if (points.length < 2) return <div className="h-16 rounded-xl border border-white/8 bg-ink-900/50" />;
  const max = Math.max(...points, 1);
  const path = points
    .map((value, index) => `${(index / (points.length - 1)) * 100},${100 - (value / max) * 92}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(168 85 247 / 0.55)" />
          <stop offset="100%" stopColor="rgb(168 85 247 / 0)" />
        </linearGradient>
      </defs>
      <polyline points={`0,100 ${path} 100,100`} fill="url(#spark)" stroke="none" />
      <polyline points={path} fill="none" stroke="rgb(196 132 252)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function InsightsPanel() {
  const {toast} = useSession();
  const [segment, setSegment] = useState<Segment>('overview');
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [mastery, setMastery] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);
  const [collection, setCollection] = useState<Record<string, unknown> | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [season, setSeason] = useState<Record<string, unknown> | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    api.arena.analytics(days).then(setAnalytics).catch((error: Error) => toast('error', 'Analytics unavailable', error.message));
  }, [days, toast]);
  useEffect(() => {
    api.arena.mastery().then(setMastery).catch(() => setMastery(null));
    api.arena.studyPlan().then(setPlan).catch(() => setPlan(null));
    api.arena.collection().then(setCollection).catch(() => setCollection(null));
    api.arena.weeklyReport().then(setReport).catch(() => setReport(null));
    api.arena.season().then(setSeason).catch(() => setSeason(null));
  }, []);

  const overview = (analytics?.overview as Record<string, number> | undefined) ?? null;
  const timeline = useMemo(() => (analytics?.accuracy_over_time as {day: string; accuracy: number; answered: number}[] | undefined) ?? [], [analytics]);
  const topics = useMemo(() => (analytics?.weakest_topics as {key: string; accuracy: number; answered: number}[] | undefined) ?? [], [analytics]);
  const strong = useMemo(() => (analytics?.strongest_topics as {key: string; accuracy: number; answered: number}[] | undefined) ?? [], [analytics]);
  const difficulties = useMemo(() => (analytics?.difficulty as {key: string; accuracy: number; answered: number}[] | undefined) ?? [], [analytics]);
  const distribution = useMemo(() => (analytics?.score_distribution as {band: string; count: number}[] | undefined) ?? [], [analytics]);
  const heatmap = useMemo(() => (analytics?.mastery_heatmap as {topic: string; mastery: number; answered: number}[] | undefined) ?? [], [analytics]);

  const maxBand = Math.max(...distribution.map((row) => row.count), 1);

  return (
    <div className="grid gap-4">
      <Segmented
        value={segment}
        onChange={setSegment}
        options={[
          {value: 'overview', label: 'Overview', icon: BarChart3},
          {value: 'topics', label: 'Mastery', icon: Brain},
          {value: 'plan', label: 'Study plan', icon: Lightbulb},
          {value: 'collection', label: 'Achievements', icon: Trophy},
        ]}
      />

      {segment === 'overview' && (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SectionHeading title="Your arena numbers" subtitle={`Last ${days} days across every mode`} icon={<TrendingUp className="size-4" />} />
              <div className="ml-auto flex gap-1">
                {[7, 30, 90].map((value) => (
                  <button
                    key={value}
                    onClick={() => setDays(value)}
                    className={`rounded-xl border px-2.5 py-1 text-[0.72rem] font-extrabold ${
                      days === value ? 'border-nova-400/40 bg-nova-500/15 text-nova-200' : 'border-white/12 bg-white/6 text-mist-400'
                    }`}
                  >
                    {value}d
                  </button>
                ))}
              </div>
            </div>

            {!overview && <div className="mt-3 grid gap-2 sm:grid-cols-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}

            {overview && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    {label: 'Accuracy', value: `${overview.accuracy}%`},
                    {label: 'Answered', value: formatNumber(overview.answered)},
                    {label: 'Avg per question', value: `${overview.average_seconds}s`},
                    {label: 'Questions / day', value: String(overview.questions_per_day)},
                    {label: 'Exams', value: String(overview.exams)},
                    {label: 'Duels won', value: `${overview.duel_wins}/${overview.duels}`},
                    {label: 'Cards reviewed', value: String(overview.flashcards_reviewed)},
                    {label: 'Practice runs', value: String(overview.practice_runs)},
                  ].map((tile) => (
                    <div key={tile.label} className="rounded-2xl border border-white/8 bg-ink-900/50 px-3 py-2.5">
 <p className="text-[0.68rem] font-bold tracking-wide text-mist-500">{tile.label}</p>
                      <p className="mt-0.5 text-[0.98rem] font-black text-mist-50">{tile.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Chip className="border-gold-500/25 bg-gold-500/10 text-gold-200" icon={<Flame className="size-3.5" />}>
                    {overview.streak}-day streak (best {overview.best_streak})
                  </Chip>
                  <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">Level {overview.level} · {overview.title}</Chip>
                  <Chip className="border-white/12 bg-white/6 text-mist-300">Rank #{overview.rank}</Chip>
                  <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">Best exam {overview.best_percentage}%</Chip>
                </div>
              </>
            )}
          </Card>

          <Card className="p-4">
            <SectionHeading title="Accuracy over time" subtitle="Every answered question, bucketed by day" icon={<BarChart3 className="size-4" />} />
            <div className="mt-3">
              <Sparkline points={timeline.map((row) => row.accuracy)} />
            </div>
            <div className="mt-2 flex justify-between text-[0.68rem] font-semibold text-mist-500">
              <span>{timeline[0]?.day ?? '—'}</span>
              <span>{timeline[timeline.length - 1]?.day ?? '—'}</span>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <SectionHeading title="Score distribution" subtitle="Submitted exam percentages" icon={<Target className="size-4" />} />
              <ul className="mt-3 grid gap-2">
                {distribution.map((row) => (
                  <li key={row.band} className="flex items-center gap-2">
                    <span className="w-14 text-[0.72rem] font-bold text-mist-500">{row.band}%</span>
                    <ProgressBar value={(row.count / maxBand) * 100} className="flex-1" />
                    <span className="w-6 text-right text-[0.72rem] font-black text-mist-300">{row.count}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-4">
              <SectionHeading title="By difficulty" subtitle="Where your accuracy actually sits" icon={<Brain className="size-4" />} />
              <ul className="mt-3 grid gap-2">
                {difficulties.map((row) => (
                  <li key={row.key} className="flex items-center gap-2">
                    <span className="w-16 text-[0.72rem] font-bold capitalize text-mist-400">{row.key}</span>
                    <ProgressBar value={row.accuracy} className="flex-1" />
                    <span className="w-10 text-right text-[0.72rem] font-black text-mist-300">{row.accuracy}%</span>
                  </li>
                ))}
                {!difficulties.length && <li className="text-[0.78rem] font-medium text-mist-500">Answer a few questions to see this.</li>}
              </ul>
            </Card>
          </div>
        </>
      )}

      {segment === 'topics' && (
        <>
          <Card className="p-4">
            <SectionHeading title="Mastery heatmap" subtitle="Confidence grows with volume — low cells are your targets" icon={<Brain className="size-4" />} />
            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
              {heatmap.slice(0, 48).map((row) => {
                const intensity = Math.min(1, row.mastery / 100);
                return (
                  <div
                    key={row.topic}
                    title={`${row.topic}: ${row.mastery}% mastery over ${row.answered} answers`}
                    className="aspect-square rounded-lg border border-white/8"
                    style={{background: `rgb(168 85 247 / ${0.12 + intensity * 0.7})`}}
                  />
                );
              })}
              {!heatmap.length && <p className="col-span-4 text-[0.78rem] font-medium text-mist-500 sm:col-span-8">No topic data yet.</p>}
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <SectionHeading title="Weakest topics" subtitle="Fix these first" icon={<Target className="size-4" />} />
              <ul className="mt-3 grid gap-2">
                {topics.map((row) => (
                  <li key={row.key} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-200">{row.key}</span>
                      <span className="text-[0.72rem] font-black text-rose-300">{row.accuracy}%</span>
                    </div>
                    <ProgressBar value={row.accuracy} />
                  </li>
                ))}
                {!topics.length && <li className="text-[0.78rem] font-medium text-mist-500">Not enough answers yet.</li>}
              </ul>
            </Card>

            <Card className="p-4">
              <SectionHeading title="Strongest topics" subtitle="Keep them warm" icon={<Award className="size-4" />} />
              <ul className="mt-3 grid gap-2">
                {strong.map((row) => (
                  <li key={row.key} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-200">{row.key}</span>
                      <span className="text-[0.72rem] font-black text-mint-300">{row.accuracy}%</span>
                    </div>
                    <ProgressBar value={row.accuracy} />
                  </li>
                ))}
                {!strong.length && <li className="text-[0.78rem] font-medium text-mist-500">Not enough answers yet.</li>}
              </ul>
            </Card>
          </div>

          {mastery && (
            <Card className="p-4">
              <SectionHeading title="Course mastery" subtitle={`Overall ${String(mastery.overall ?? 0)}%`} icon={<Brain className="size-4" />} />
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {((mastery.course as {key: string; mastery: number; answered: number}[]) ?? []).map((row) => (
                  <li key={row.key} className="rounded-2xl border border-white/8 bg-ink-900/50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.key}</span>
                      <span className="text-[0.74rem] font-black text-nova-300">{row.mastery}%</span>
                    </div>
                    <ProgressBar value={row.mastery} className="mt-1.5" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {segment === 'plan' && (
        <>
          <Card className="p-4">
            <SectionHeading title="What to study next" subtitle="Recommended from your own answer history" icon={<Lightbulb className="size-4" />} />
            <ul className="mt-3 grid gap-2">
              {((plan?.recommendations as {kind: string; title: string; detail: string; cta: string}[]) ?? []).map((row) => (
                <li key={row.title} className="rounded-2xl border border-white/8 bg-ink-900/50 px-3 py-2.5">
                  <p className="text-[0.84rem] font-extrabold text-mist-100">{row.title}</p>
                  <p className="mt-0.5 text-[0.76rem] font-medium text-mist-500">{row.detail}</p>
                  <Chip className="mt-2 border-nova-500/25 bg-nova-500/10 text-nova-200">{row.cta}</Chip>
                </li>
              ))}
              {!plan && <Skeleton className="h-24 w-full" />}
            </ul>
          </Card>

          {(plan?.weak_topics as Json[] | undefined)?.length ? (
            <Card className="p-4">
              <SectionHeading title="Topic drill-down" subtitle="Accuracy, mastery and the pool size for each weak topic" icon={<Target className="size-4" />} />
              <ul className="mt-3 grid gap-2">
                {(plan?.weak_topics as {topic: string; accuracy: number; answered: number; pool: number}[]).map((row) => (
                  <li key={row.topic} className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-ink-900/50 px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.topic}</span>
                    <Chip className="border-rose-500/25 bg-rose-500/10 text-rose-200">{row.accuracy}%</Chip>
                    <Chip className="border-white/12 bg-white/6 text-mist-400">{row.pool} in bank</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {report && (
            <Card className="p-4">
              <SectionHeading title={String(report.label ?? 'Weekly report')} subtitle="A snapshot you can share with your study group" icon={<BarChart3 className="size-4" />} />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {label: 'Answered', value: String(report.answered ?? 0)},
                  {label: 'Accuracy', value: `${report.accuracy ?? 0}%`},
                  {label: 'Active days', value: String(report.active_days ?? 0)},
                  {label: 'XP earned', value: formatNumber(Number(report.xp_gained ?? 0))},
                ].map((tile) => (
                  <div key={tile.label} className="rounded-2xl border border-white/8 bg-ink-900/50 px-3 py-2.5">
 <p className="text-[0.68rem] font-bold tracking-wide text-mist-500">{tile.label}</p>
                    <p className="mt-0.5 text-[0.98rem] font-black text-mist-50">{tile.value}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {season && (
            <Card className="p-4">
              <SectionHeading title={String(season.label ?? 'Season')} subtitle={`Rank #${(season.my as Record<string, number>)?.rank ?? '—'} · ${String(season.prestige_tier ?? '')} prestige`} icon={<Trophy className="size-4" />} />
              <ul className="mt-3 grid gap-1.5">
                {((season.rewards as {rank: string; xp: number; coins: number}[]) ?? []).map((row) => (
                  <li key={row.rank} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                    <span className="min-w-0 flex-1 text-[0.8rem] font-bold text-mist-200">{row.rank}</span>
                    <span className="text-[0.74rem] font-semibold text-nova-300">+{row.xp} XP</span>
                    <span className="text-[0.74rem] font-semibold text-gold-300">+{row.coins}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {segment === 'collection' && (
        <>
          <Card className="p-4">
            <SectionHeading
              title="Achievements"
              subtitle={collection ? `${collection.earned}/${collection.total} unlocked · ${collection.completion}% complete` : 'Loading…'}
              icon={<Trophy className="size-4" />}
            />
            <ProgressBar value={Number(collection?.completion ?? 0)} className="mt-3" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {((collection?.items as {
                key: string;
                name: string;
                description: string;
                earned: boolean;
                tier?: string;
                category?: string;
                hidden?: boolean;
                progress?: {value: number; goal: number} | null;
              }[]) ?? []).map((item) => (
                <div
                  key={item.key}
                  className={`rounded-2xl border px-3 py-2.5 ${
                    item.earned ? 'border-white/14 bg-ink-900/60' : 'border-white/8 bg-ink-900/35 opacity-80'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{item.earned ? '🏆' : '🔒'}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-extrabold text-mist-100">
                      {item.hidden ? 'Secret achievement' : item.name}
                    </span>
                    {item.tier && <Chip className={TIER_TONE[item.tier] ?? TIER_TONE.bronze}>{item.tier}</Chip>}
                  </div>
                  <p className="mt-1 text-[0.74rem] font-medium text-mist-500">{item.hidden ? 'Keep playing to reveal it.' : item.description}</p>
                  {item.progress && !item.earned && (
                    <div className="mt-2">
                      <ProgressBar value={(item.progress.value / Math.max(item.progress.goal, 1)) * 100} />
                      <p className="mt-1 text-[0.68rem] font-bold text-mist-500">
                        {item.progress.value}/{item.progress.goal}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
