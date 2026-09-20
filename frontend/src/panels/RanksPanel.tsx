/** Ranks tab: global / weekly / friends / duel leaderboards with a live podium. */
import {BarChart3, Crown, Flame, Globe, HandHelping, Medal, Swords, Trophy, Users, Zap} from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import SeasonPanel from './SeasonPanel';
import {TournamentsPanel} from './CommunityPanel';
import {Avatar, Card, Chip, EmptyState, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber, TIER_STYLES} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSize} from '../lib/responsive';
import {useSession} from '../store/session';
import type {Leaderboard, LeaderboardRow} from '../lib/types';

type Scope = 'global' | 'weekly' | 'friends' | 'duels' | 'helpers';

const SCOPES: {value: Scope; label: string; icon: typeof Globe}[] = [
  {value: 'global', label: 'All-time', icon: Globe},
  {value: 'weekly', label: 'This week', icon: Flame},
  {value: 'friends', label: 'Friends', icon: Users},
  {value: 'duels', label: 'Duel wins', icon: Swords},
  {value: 'helpers', label: 'Tutors', icon: HandHelping},
];

const SCOPE_META: Record<Scope, {unit: string; hint: string}> = {
  global: {unit: 'XP', hint: 'Every point you have ever earned in the arena.'},
  weekly: {unit: 'XP this week', hint: 'Resets Monday 00:00 — climb fast, climb far.'},
  friends: {unit: 'XP', hint: 'Only players in your circle.'},
  duels: {unit: 'duel wins', hint: 'Head-to-head victories.'},
  helpers: {unit: 'tutor points', hint: 'Players who answered ask-a-friend requests correctly.'},
};

function Podium({rows, unit}: {rows: LeaderboardRow[]; unit: string}) {
  const order = [1, 0, 2];
  const heights = ['h-16 sm:h-24', 'h-20 sm:h-32', 'h-14 sm:h-20'];
  const firstFace = useSize(56, 68);
  const otherFace = useSize(46, 54);
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-5">
      {order.map((index) => {
        const row = rows[index];
        // A namespaced key: the podium mixes empty slots with real rows, and a
        // bare index can collide with a player id (the fresh-arena case where
        // the top player is student #1).
        if (!row) return <div key={`empty-slot-${index}`} className="w-[5.5rem] sm:w-32" />;
        const first = index === 0;
        const medals = [Crown, Medal, Medal];
        const Icon = medals[index];
        return (
          <motion.div
            key={row.id}
            variants={staggerItem}
            initial="hidden"
            animate="show"
            transition={{delay: index * 0.08}}
            className="flex w-[5.5rem] flex-col items-center sm:w-32"
          >
            <div className="relative">
              <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={first ? firstFace : otherFace} ring photo={{id: row.id, has: row.has_photo}} cosmetics={row.cosmetics} />
              {first && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-gold-400 animate-float sm:-top-5"><Crown className="size-5 sm:size-6" /></span>}
            </div>
            <p className="mt-1.5 w-full truncate text-center text-[0.74rem] font-extrabold text-mist-100 sm:mt-2 sm:text-[0.8rem]">{row.name.split(' ')[0]}</p>
            <p className="truncate text-[0.66rem] font-bold tabular text-nova-300 sm:text-[0.7rem]">
              {formatNumber(row.value)} <span className="text-mist-500">{unit.split(' ')[0]}</span>
            </p>
            <div
              className={`mt-1.5 w-full rounded-t-2xl border border-b-0 border-white/12 sm:mt-2 ${heights[index]} ${
                first ? 'brand-gradient-animated' : 'bg-white/6'
              } grid place-items-start-center pt-2`}
            >
              <span className={`flex items-center gap-1 text-[0.74rem] font-black sm:text-[0.8rem] ${first ? 'text-white' : 'text-mist-300'}`}>
                <Icon className="size-3.5" /> #{row.rank}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function RankRow({row, unit, me}: {row: LeaderboardRow; unit: string; me?: boolean}) {
  const tier = TIER_STYLES[row.tier] ?? TIER_STYLES.bronze;
  const face = useSize(32, 38);
  return (
    <motion.li
      variants={staggerItem}
      className={`flex items-center gap-2.5 rounded-2xl border px-2.5 py-2 transition-colors sm:gap-3 sm:px-3 sm:py-2.5 ${
        me ? 'border-nova-400/40 bg-nova-500/12' : 'border-white/6 bg-white/[0.025] hover:border-white/14'
      }`}
    >
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-xl text-[0.78rem] font-black tabular sm:size-8 sm:text-[0.82rem] ${
          row.rank === 1
            ? 'bg-gold-400/20 text-gold-300'
            : row.rank === 2
              ? 'bg-mist-200/14 text-mist-200'
              : row.rank === 3
                ? 'bg-flare-500/16 text-flare-300'
                : 'bg-white/5 text-mist-500'
        }`}
      >
        {row.rank}
      </span>
      <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={face} photo={{id: row.id, has: row.has_photo}} cosmetics={row.cosmetics} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.82rem] font-extrabold text-mist-100 sm:text-[0.86rem]">
 {row.name} {me && <span className="ml-1 text-[0.66rem] font-black tracking-wider text-nova-300">You</span>}
        </p>
        <p className="flex items-center gap-1.5 truncate text-[0.68rem] font-semibold text-mist-500 sm:gap-2 sm:text-[0.72rem]">
          <span>Lv {row.level}</span>
          <span className="text-mist-600">·</span>
          <span className={tier.className.split(' ')[0]}>{row.title}</span>
          {row.streak > 1 && (
            <>
              <span className="text-mist-600">·</span>
              <span className="inline-flex items-center gap-0.5 text-flare-300">
                <Flame className="size-3" />
                {row.streak}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[0.86rem] font-black tabular text-mist-50 sm:text-[0.92rem]">{formatNumber(row.value)}</p>
 <p className="text-[0.58rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.64rem] sm:tracking-[0.14em]">{unit}</p>
      </div>
    </motion.li>
  );
}

/** Extra boards (accuracy, speed, streaks, flashcards, campus…) from the arena engine. */
function ExtraBoards() {
  const {toast} = useSession();
  const [scope, setScope] = useState('accuracy');
  const [data, setData] = useState<{rows: LeaderboardRow[]; me?: LeaderboardRow; my_rank?: number; passed_players?: number} | null>(null);
  const [loading, setLoading] = useState(true);

  const OPTIONS = [
    {key: 'accuracy', label: 'Accuracy'},
    {key: 'speed', label: 'Speed'},
    {key: 'streak', label: 'Streaks'},
    {key: 'duel', label: 'Duels'},
    {key: 'flashcard', label: 'Flashcards'},
    {key: 'course', label: 'Course'},
    {key: 'topic', label: 'Topic'},
    {key: 'class', label: 'Class'},
    {key: 'campus', label: 'Campus'},
    {key: 'season', label: 'Season'},
  ];

  useEffect(() => {
    setLoading(true);
    api.arena
      .leaderboards({scope, limit: 20})
      .then((payload) => {
        setData(payload as unknown as {rows: LeaderboardRow[]; me?: LeaderboardRow; my_rank?: number; passed_players?: number});
        setLoading(false);
      })
      .catch((error: Error) => {
        toast('error', 'Could not load that board', error.message);
        setLoading(false);
      });
  }, [scope, toast]);

  const rows = data?.rows ?? [];
  const unit = scope === 'accuracy' ? '%' : scope === 'speed' ? 's avg' : 'pts';

  return (
    <Card className="p-3 sm:p-4">
      <SectionHeading
        title="More boards"
        subtitle="Skill boards built from the same answer records as exams, duels and practice."
        icon={<BarChart3 className="size-4" />}
        action={data?.passed_players ? <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">passed {data.passed_players} players</Chip> : undefined}
      />
      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => setScope(option.key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.74rem] font-bold transition-colors ${
              scope === option.key ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-500 hover:text-mist-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-1.5">
        {loading && [0, 1, 2].map((key) => <Skeleton key={key} className="h-12" />)}
        {!loading && rows.length === 0 && (
          <EmptyState icon={<BarChart3 className="size-5" />} title="Nothing here yet" detail="This board fills up as players answer questions in that mode." />
        )}
        {!loading && rows.map((row) => (
          <RankRow key={`${scope}-${row.id}`} row={row} unit={unit} me={false} />
        ))}
      </div>
    </Card>
  );
}

export default function RanksPanel() {
  const {profile, online, toast, on} = useSession();
  const [view, setView] = useState<'boards' | 'season' | 'tournaments'>('boards');
  const [scope, setScope] = useState<Scope>('global');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (target: Scope) => {
      setLoading(true);
      api
        .leaderboard(target, 30)
        .then((data) => {
          setBoard(data);
          setLoading(false);
        })
        .catch((error: Error) => {
          toast('error', 'Could not load leaderboard', error.message);
          setLoading(false);
        });
    },
    [toast],
  );

  useEffect(() => load(scope), [scope, load]);

  // Live leaderboard pushes from the server keep the board fresh.
  useEffect(
    () =>
      on('leaderboard', (data) => {
        const payload = data as {scope: string; rows: LeaderboardRow[]};
        if (payload.scope === scope) setBoard((current) => (current ? {...current, rows: payload.rows} : current));
      }),
    [on, scope],
  );

  const meta = SCOPE_META[scope];
  const rows = board?.rows ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <SectionHeading
        title="Leaderboards"
        subtitle={meta.hint}
        icon={<Trophy className="size-4" />}
        action={
          <Chip className="border-mint-500/28 bg-mint-500/12 text-mint-300" icon={<Zap className="size-3.5" />}>
            {online} online
          </Chip>
        }
      />

      <Segmented
        value={view}
        onChange={setView}
        options={[
          {value: 'boards', label: 'Leaderboards', icon: Trophy},
          {value: 'season', label: 'Season', icon: Medal},
          {value: 'tournaments', label: 'Tournaments', icon: Swords},
        ]}
      />

      {/* the badge ladder — 12 ranks, 100 levels, reset every month */}
      {view === 'season' && <SeasonPanel onOpenRanks={() => setView('boards')} />}

      {view === 'tournaments' && <TournamentsPanel />}

      {view === 'boards' && (
        <>
      <Segmented value={scope} options={SCOPES} onChange={setScope} />

      <Card className="p-3 sm:p-6">
        {loading ? (
          <div className="space-y-2.5 sm:space-y-3">
            <Skeleton className="mx-auto h-36 w-full max-w-72 sm:h-40" />
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Trophy className="size-6" />}
            title={scope === 'friends' ? 'No friends on the board yet' : 'The board is empty'}
            detail={
              scope === 'friends'
                ? 'Add rivals by phone number from your profile and they will show up here.'
                : 'Scores appear as soon as players submit exams.'
            }
          />
        ) : (
          <>
            {scope !== 'friends' && <Podium rows={rows.slice(0, 3)} unit={meta.unit} />}

            <motion.ul
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className={`space-y-1.5 ${scope !== 'friends' ? 'mt-4 sm:mt-6' : ''}`}
            >
              {rows.slice(scope === 'friends' ? 0 : 3).map((row) => (
                <RankRow key={row.id} row={row} unit={meta.unit} me={row.id === profile?.id} />
              ))}
            </motion.ul>

            {board?.me && board.me.id !== profile?.id && (
              <div className="mt-4 border-t border-white/8 pt-4">
                <RankRow row={board.me} unit={meta.unit} me />
              </div>
            )}
          </>
        )}
      </Card>

      <ExtraBoards />

      {profile && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            {label: 'Your XP', value: formatNumber(profile.xp), icon: Zap, tone: 'text-nova-300'},
            {label: 'This week', value: formatNumber(profile.weekly_xp), icon: Flame, tone: 'text-flare-300'},
            {label: 'Duel wins', value: formatNumber(profile.stats.duels_won), icon: Swords, tone: 'text-pulse-300'},
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3.5">
                <Icon className={`size-4 shrink-0 sm:size-5 ${stat.tone}`} />
                <div className="min-w-0">
 <p className="truncate text-[0.6rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.68rem] sm:tracking-[0.14em]">
                    {stat.label}
                  </p>
                  <p className="truncate text-base font-black tabular text-mist-50 sm:text-lg">{stat.value}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
}
