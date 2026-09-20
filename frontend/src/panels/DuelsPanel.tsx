/** Duels tab: lobby, invites, live matches, quick match, join-by-code, history. */
import {
  Ban,
  Check,
  Clock,
  Crown,
  Hourglass,
  Link2,
  Plus,
  Radar,
  RotateCcw,
  Search,
  Skull,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Avatar, Button, Card, Chip, CopyCode, EmptyState, Field, Modal, SectionHeading, Skeleton, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSize} from '../lib/responsive';
import {useSession} from '../store/session';
import RoomsSection from './RoomsSection';
import type {Course, Duel, DuelList, DuelMode, PlayerSummary} from '../lib/types';

const STAKES = [10, 25, 50, 100];
const LENGTHS = [5, 10, 15, 20];
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 100;

function countdownLabel(duel: Duel): string | null {
  /* Live clocks are per-question and server-owned — the arena view renders the
     real countdown; the card only labels the format. */
  if (duel.status === 'live') return `${duel.time_limit_seconds}s/question`;
  if (duel.status === 'starting') return 'starting…';
  if (duel.expires_at) {
    const expires = new Date(duel.expires_at.endsWith('Z') ? duel.expires_at : `${duel.expires_at}Z`).getTime();
    const left = Math.round((expires - Date.now()) / 1000);
    if (left <= 0) return 'expiring';
    return `expires in ${Math.floor(left / 60)}m ${left % 60}s`;
  }
  return null;
}

function DuelCard({
  duel,
  onOpen,
  onAccept,
  onDecline,
  onCancel,
}: {
  duel: Duel;
  onOpen: (duel: Duel) => void;
  onAccept: (duel: Duel) => void;
  onDecline: (duel: Duel) => void;
  onCancel: (duel: Duel) => void;
}) {
  const {profile} = useSession();
  const [, force] = useState(0);
  const faceSize = useSize(38, 44);
  const isInvite = duel.status === 'invited';
  const challenger = duel.participants.find((p) => p.seat === 'challenger');
  const opponent = duel.participants.find((p) => p.student_id !== profile?.id);
  // An open duel with a single seat filled must never offer "accept" to its creator.
  const inviteForMe = isInvite && opponent?.student_id === profile?.id;
  const soloOpen = isInvite && !opponent;
  const timer = countdownLabel(duel);

  useEffect(() => {
    if (!timer) return undefined;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const result = duel.status === 'finished' ? (duel.winner_id === profile?.id ? 'win' : duel.draw ? 'draw' : 'loss') : null;

  return (
    <motion.li variants={staggerItem}>
      <Card className="relative overflow-hidden p-4">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${
            result === 'win'
              ? 'bg-gradient-to-r from-mint-400 to-pulse-500'
              : result === 'loss'
                ? 'bg-gradient-to-r from-flare-600 to-flare-400'
                : duel.status === 'live'
                  ? 'brand-gradient-animated'
                  : 'bg-white/10'
          }`}
        />
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="flex shrink-0 items-center -space-x-3">
            <Avatar name={challenger?.name ?? '?'} hue={challenger?.avatar_hue ?? 260} initials={challenger?.initials} size={faceSize} ring photo={challenger ? {id: challenger.student_id, has: challenger.has_photo} : null} />
            {opponent && opponent.student_id !== challenger?.student_id && (
              <Avatar name={opponent.name} hue={opponent.avatar_hue} initials={opponent.initials} size={faceSize} ring photo={{id: opponent.student_id, has: opponent.has_photo}} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.86rem] font-extrabold text-mist-50 sm:text-[0.92rem]">
              {inviteForMe
                ? `${challenger?.name ?? 'A player'} challenged you`
                : soloOpen
                  ? `${duel.topic || 'Open duel'} · waiting for a rival`
                  : duel.topic || 'Arena duel'}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] font-semibold text-mist-500 sm:text-[0.74rem]">
              <span className="inline-flex items-center gap-1">
                <CoinsGlyph /> {duel.stake_coins} stake
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {duel.question_count} Q · {duel.time_limit_seconds}s/Q
              </span>
              {timer && (
                <span className={`inline-flex items-center gap-1 tabular ${duel.status === 'live' ? 'text-flare-300' : 'text-mist-500'}`}>
                  <Hourglass className="size-3" /> {timer}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {duel.status === 'live' && (
              <Chip className="animate-pulse border-flare-500/40 bg-flare-500/16 text-flare-300" icon={<Zap className="size-3" />}>
                Live
              </Chip>
            )}
            {duel.status === 'starting' && (
              <Chip className="animate-pulse border-nova-500/40 bg-nova-500/16 text-nova-200" icon={<Hourglass className="size-3" />}>
                Starting
              </Chip>
            )}
            {duel.status === 'invited' && <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-300">Invite</Chip>}
            {result === 'win' && (
              <Chip className="border-mint-500/32 bg-mint-500/14 text-mint-300" icon={<Trophy className="size-3" />}>
                Won
              </Chip>
            )}
            {result === 'loss' && (
              <Chip className="border-flare-500/32 bg-flare-500/14 text-flare-300" icon={<Skull className="size-3" />}>
                Lost
              </Chip>
            )}
            {result === 'draw' && <Chip className="border-white/16 bg-white/8 text-mist-300">Draw</Chip>}
            {duel.status === 'cancelled' && <Chip className="border-white/12 bg-white/6 text-mist-500">Cancelled</Chip>}
            {duel.status === 'expired' && <Chip className="border-white/12 bg-white/6 text-mist-500">Expired</Chip>}
          </div>
        </div>

        {duel.status === 'invited' && duel.code && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[0.76rem] font-semibold text-mist-400">
              <Link2 className="size-3.5 text-nova-400" /> Share code to invite anyone
            </span>
            <CopyCode code={duel.code} size="sm" className="ml-auto" />
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2 sm:mt-4">
          {inviteForMe && (
            <>
              <Button size="sm" onClick={() => onAccept(duel)} icon={<Check className="size-4" />}>
                Accept duel
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecline(duel)} icon={<X className="size-4" />}>
                Decline
              </Button>
            </>
          )}
          {(duel.status === 'live' || (!inviteForMe && duel.status === 'invited')) && (
            <Button size="sm" variant={duel.status === 'live' ? 'primary' : 'outline'} onClick={() => onOpen(duel)} icon={<Swords className="size-4" />}>
              {duel.status === 'live' ? 'Enter arena' : soloOpen ? 'Open waiting room' : 'View duel'}
            </Button>
          )}
          {duel.status === 'invited' && challenger?.student_id === profile?.id && (
            <Button size="sm" variant="ghost" onClick={() => onCancel(duel)} icon={<Ban className="size-4" />}>
              Cancel invite
            </Button>
          )}
          {result && (
            <Button size="sm" variant="ghost" onClick={() => onOpen(duel)} icon={<Crown className="size-4" />}>
              See breakdown
            </Button>
          )}
        </div>
      </Card>
    </motion.li>
  );
}

function CoinsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 text-gold-400" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <circle cx="12" cy="12" r="6.4" />
    </svg>
  );
}

function ChallengeModal({
  open,
  onClose,
  onCreated,
  coins,
  defaultPlayer,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (duel: Duel) => void;
  coins: number;
  defaultPlayer?: PlayerSummary | null;
}) {
  const {toast} = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSummary[]>([]);
  const [selected, setSelected] = useState<PlayerSummary | null>(defaultPlayer ?? null);
  const [stake, setStake] = useState(25);
  const [count, setCount] = useState(10);
  const [openToAll, setOpenToAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [mode, setMode] = useState<DuelMode>('casual');
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(1);
  const [difficulty, setDifficulty] = useState('');
  const [suddenDeath, setSuddenDeath] = useState(false);

  useEffect(() => setSelected(defaultPlayer ?? null), [defaultPlayer]);

  useEffect(() => {
    if (!open || courses.length) return;
    api
      .courses()
      .then(setCourses)
      .catch(() => setCourses([]));
  }, [open, courses.length]);

  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = window.setTimeout(() => {
      api
        .searchPlayers(query.trim())
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(id);
  }, [query, open]);

  const create = async () => {
    setBusy(true);
    try {
      // Ranked/casual + best-of + sudden death are decided by the server; the
      // client only picks the format.
      const duel = openToAll
        ? await api.openDuel({question_count: count, stake_coins: stake, course_id: courseId, mode, best_of: bestOf, difficulty, sudden_death: suddenDeath})
        : await api.createDuel({
            opponent_id: selected?.id,
            opponent_phone: selected ? undefined : query.trim(),
            question_count: count,
            stake_coins: stake,
            course_id: courseId,
            mode,
            best_of: bestOf,
            difficulty,
            sudden_death: suddenDeath,
          });
      toast('success', openToAll ? 'Open duel published' : 'Challenge sent', `Code ${duel.code}`);
      onCreated(duel);
      onClose();
      setQuery('');
      setSelected(null);
      setCourseId(null);
    } catch (error) {
      toast('error', 'Could not create duel', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const capped = Math.min(stake, coins);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a duel"
      subtitle="Winner takes the pot — plus a 25-coin arena bonus."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} loading={busy} disabled={!openToAll && !selected && query.trim().length < 7} icon={<Swords className="size-4" />}>
            {openToAll ? 'Publish open duel' : mode === 'ranked' ? 'Send ranked challenge' : 'Send challenge'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        <div className="grid gap-2 sm:flex">
          <button
            onClick={() => setOpenToAll(false)}
            className={`flex-1 rounded-2xl border px-3.5 py-2.5 text-left transition-colors touch-manipulation sm:px-4 sm:py-3 ${
              !openToAll ? 'border-nova-400/50 bg-nova-500/14' : 'border-white/10 bg-white/4 hover:border-white/20'
            }`}
          >
            <p className="flex items-center gap-2 text-[0.86rem] font-extrabold text-mist-50">
              <Users className="size-4 text-nova-300" /> Pick an opponent
            </p>
            <p className="mt-1 text-[0.76rem] font-medium text-mist-500">Search by name or phone number.</p>
          </button>
          <button
            onClick={() => setOpenToAll(true)}
            className={`flex-1 rounded-2xl border px-3.5 py-2.5 text-left transition-colors touch-manipulation sm:px-4 sm:py-3 ${
              openToAll ? 'border-flare-400/50 bg-flare-500/14' : 'border-white/10 bg-white/4 hover:border-white/20'
            }`}
          >
            <p className="flex items-center gap-2 text-[0.86rem] font-extrabold text-mist-50">
              <Radar className="size-4 text-flare-300" /> Open to anyone
            </p>
            <p className="mt-1 text-[0.76rem] font-medium text-mist-500">Publish a join code for the arena.</p>
          </button>
        </div>

        {!openToAll && (
          <Field label="Opponent">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-mist-500" />
              <TextInput
                className="pl-11"
                placeholder="Name or phone number"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {selected && (
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-mint-500/25 bg-mint-500/10 px-3 py-2.5">
                <Avatar name={selected.name} hue={selected.avatar_hue} initials={selected.initials} size={36} online={selected.online} photo={{id: selected.id, has: selected.has_photo}} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.86rem] font-extrabold text-mist-50">{selected.name}</p>
                  <p className="text-[0.74rem] font-semibold text-mist-500">
                    Lv {selected.level} · {formatNumber(selected.xp)} XP · {selected.duels_won} wins
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  Change
                </Button>
              </div>
            )}
            {!selected && results.length > 0 && (
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto overscroll-contain sm:max-h-52">
                {results.map((player) => (
                  <li key={player.id}>
                    <button
                      onClick={() => setSelected(player)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition-colors hover:border-nova-400/40 hover:bg-nova-500/10"
                    >
                      <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={34} online={player.online} photo={{id: player.id, has: player.has_photo}} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.84rem] font-bold text-mist-100">{player.name}</span>
                        <span className="block truncate text-[0.72rem] font-semibold text-mist-500">
                          Lv {player.level} · {player.title} · {player.duels_won}W/{player.duels_played}
                        </span>
                      </span>
                      <Plus className="size-4 text-nova-300" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}

        <Field label="Questions from" hint="One course bank, or a random mix of everything live.">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5">
            <button
              onClick={() => setCourseId(null)}
              className={`min-h-11 shrink-0 rounded-xl border px-3.5 py-2 text-[0.8rem] font-black transition-colors touch-manipulation ${
                courseId === null ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
              }`}
            >
              🎲 Random mix
            </button>
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => setCourseId(course.id)}
                title={course.title}
                className={`min-h-11 shrink-0 rounded-xl border px-3.5 py-2 text-[0.8rem] font-black transition-colors touch-manipulation ${
                  courseId === course.id ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                }`}
              >
                {course.code}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label={`Stake · ${capped} coins`}>
            <div className="flex gap-2">
              {STAKES.map((value) => (
                <button
                  key={value}
                  onClick={() => setStake(value)}
                  className={`min-h-11 flex-1 rounded-xl border py-2 text-[0.82rem] font-black tabular transition-colors touch-manipulation ${
                    stake === value ? 'border-gold-400/50 bg-gold-500/16 text-gold-300' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Questions" hint={`Any number from ${MIN_QUESTIONS} to ${MAX_QUESTIONS} — every question runs on a 20-second server clock.`}>
            <div className="flex gap-2">
              {LENGTHS.map((value) => (
                <button
                  key={value}
                  onClick={() => setCount(value)}
                  className={`min-h-11 flex-1 rounded-xl border py-2 text-[0.82rem] font-black tabular transition-colors touch-manipulation ${
                    count === value ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-[0.7rem] font-bold text-mist-500">Custom</span>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_QUESTIONS}
                max={MAX_QUESTIONS}
                value={Number.isFinite(count) ? count : ''}
                onChange={(event) => {
                  const value = parseInt(event.target.value, 10);
                  if (!Number.isNaN(value)) setCount(Math.max(MIN_QUESTIONS, Math.min(MAX_QUESTIONS, value)));
                }}
                aria-label="Custom question count"
                className="w-full min-w-0 flex-1 rounded-xl border border-white/12 bg-ink-900/70 px-3 py-2.5 text-[0.9rem] font-bold tabular text-mist-50 focus:border-nova-400/60 focus:outline-none"
              />
            </label>
            {count < MIN_QUESTIONS || count > MAX_QUESTIONS ? (
              <p className="mt-1.5 text-[0.7rem] font-bold text-flare-300">
                Pick between {MIN_QUESTIONS} and {MAX_QUESTIONS} questions.
              </p>
            ) : null}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Format" hint="Ranked duels move your rating; casual ones are just for pride.">
            <div className="flex gap-2">
              {(['casual', 'ranked'] as DuelMode[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`min-h-11 flex-1 rounded-xl border py-2 text-[0.8rem] font-black capitalize transition-colors touch-manipulation ${
                    mode === value ? 'border-flare-400/50 bg-flare-500/16 text-flare-200' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Series" hint="Best-of series tally every game in one scoreboard.">
            <div className="flex gap-2">
              {([1, 3, 5] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setBestOf(value)}
                  className={`min-h-11 flex-1 rounded-xl border py-2 text-[0.82rem] font-black tabular transition-colors touch-manipulation ${
                    bestOf === value ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {value === 1 ? 'Single' : `Bo${value}`}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Difficulty">
            <div className="flex gap-2">
              {['', 'easy', 'medium', 'hard'].map((value) => (
                <button
                  key={value || 'any'}
                  onClick={() => setDifficulty(value)}
                  className={`min-h-11 flex-1 rounded-xl border py-2 text-[0.78rem] font-black capitalize transition-colors touch-manipulation ${
                    difficulty === value ? 'border-mint-400/50 bg-mint-500/16 text-mint-200' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {value || 'Any'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Sudden death" hint="One wrong answer ends it — pure nerve.">
            <button
              onClick={() => setSuddenDeath((value) => !value)}
              aria-pressed={suddenDeath}
              className={`min-h-11 w-full rounded-xl border py-2 text-[0.8rem] font-black transition-colors touch-manipulation ${
                suddenDeath ? 'border-flare-400/50 bg-flare-500/16 text-flare-200' : 'border-white/10 bg-white/4 text-mist-400'
              }`}
            >
              {suddenDeath ? 'Sudden death on' : 'Off'}
            </button>
          </Field>
        </div>

        {stake > coins && (
          <p className="rounded-2xl border border-gold-500/25 bg-gold-500/10 px-4 py-3 text-[0.8rem] font-semibold text-gold-300">
            You only hold {formatNumber(coins)} coins — the stake will be capped automatically.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default function DuelsPanel({onOpenDuel, onOpenRoom}: {onOpenDuel: (duel: Duel) => void; onOpenRoom: (roomId: number) => void}) {
  const {profile, toast, on, onlineIds} = useSession();
  const [data, setData] = useState<DuelList | null>(null);
  const [loading, setLoading] = useState(true);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);

  const load = useCallback(() => {
    api
      .duels()
      .then((rows) => {
        setData(rows);
        setLoading(false);
      })
      .catch((error: Error) => {
        toast('error', 'Could not load duels', error.message);
        setLoading(false);
      });
  }, [toast]);

  useEffect(load, [load]);

  // Any duel lifecycle event should refresh the lobby (the open arena included:
  // a published duel appears for everyone the moment it is created, and
  // disappears the moment a rival takes the seat).
  useEffect(() => {
    const off = ['duel_invite', 'duel_started', 'duel_finished', 'duel_cancelled', 'duel_open', 'duel_joined', 'duel_expired', 'friend_added'].map(
      (event) => on(event, () => load()),
    );
    return () => off.forEach((dispose) => dispose());
  }, [on, load]);

  useEffect(() => {
    const id = window.setInterval(load, 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  const quickMatch = async () => {
    setQuickBusy(true);
    try {
      const duel = await api.quickMatch();
      toast('success', 'Opponent found!', `Duel ${duel.code} is live.`);
      onOpenDuel(duel);
    } catch (error) {
      toast('info', 'No opponent yet', (error as Error).message);
    } finally {
      setQuickBusy(false);
    }
  };

  const joinByCode = async () => {
    if (joinCode.trim().length < 4) return;
    setJoinBusy(true);
    try {
      const duel = await api.joinDuel(joinCode);
      toast('success', 'Joined the duel', `Code ${duel.code}`);
      setJoinCode('');
      onOpenDuel(duel);
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
    } finally {
      setJoinBusy(false);
    }
  };

  // The open arena: join a PUBLIC duel straight from the list. The server
  // re-validates that a seat is still free; a stale card surfaces as an error.
  const joinOpenBusyId = useRef<number | null>(null);
  const joinOpen = async (duel: Duel) => {
    if (joinOpenBusyId.current === duel.id) return;
    joinOpenBusyId.current = duel.id;
    try {
      const joined = await api.joinDuelById(duel.id);
      toast('success', 'Joined the duel', `Code ${joined.code}`);
      onOpenDuel(joined);
    } catch (error) {
      toast('error', 'Could not join that duel', (error as Error).message);
      load();
    } finally {
      joinOpenBusyId.current = null;
    }
  };

  const [record, setRecord] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.arena
      .duelStats()
      .then(setRecord)
      .catch(() => setRecord(null));
  }, [data]);

  const rematch = async (duel: Duel) => {
    try {
      const next = await api.arena.rematch(duel.id, {best_of: 1});
      toast('success', 'Rematch sent', `Code ${next.code}`);
      load();
      if (next.status === 'live' || next.status === 'starting' || next.status === 'invited') onOpenDuel(next);
    } catch (error) {
      toast('error', 'Could not rematch', (error as Error).message);
    }
  };

  const accept = async (duel: Duel) => {
    try {
      const live = await api.acceptDuel(duel.id);
      toast('success', 'Duel accepted', 'Good luck!');
      onOpenDuel(live);
    } catch (error) {
      toast('error', 'Could not accept', (error as Error).message);
      load();
    }
  };

  const decline = async (duel: Duel) => {
    try {
      await api.declineDuel(duel.id);
      toast('info', 'Invite declined');
      load();
    } catch {
      load();
    }
  };

  const cancel = async (duel: Duel) => {
    try {
      await api.cancelDuel(duel.id);
      toast('info', 'Invite cancelled', 'Your stake was refunded.');
      load();
    } catch {
      load();
    }
  };

  const active = data?.active ?? [];
  const history = data?.history ?? [];
  /* Public duels with a free seat — never includes private challenges. Duels
     I already sit in stay out of the join list. */
  const openArena = (data?.open ?? []).filter((duel) => !duel.is_yours && duel.participants.length < 2);
  const onlineFriends = useMemo(
    () => active.filter((duel) => duel.participants.some((p) => p.student_id !== profile?.id && onlineIds.includes(p.student_id))),
    [active, onlineIds, profile?.id],
  );

  return (
    <div className="space-y-5 sm:space-y-8">
      <SectionHeading
        title="Duel arena"
        subtitle="Head-to-head, real time. Fastest correct answers score the most."
        icon={<Swords className="size-4" />}
        action={
          <Button size="sm" onClick={() => setChallengeOpen(true)} icon={<Plus className="size-4" />}>
            New duel
          </Button>
        }
      />

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card className="relative overflow-hidden p-4 sm:p-5">
          <div className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-flare-600/18 blur-3xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-black tracking-tight text-mist-50 sm:text-lg">Quick match</h3>
              <p className="mt-1 text-[0.8rem] font-medium text-mist-400 sm:text-[0.84rem]">
                We pair you with an idle player of a similar level. {data?.online ?? 0} players online right now.
              </p>
            </div>
            <Button className="w-full sm:w-auto" variant="danger" size="lg" onClick={quickMatch} loading={quickBusy} icon={<Radar className="size-4" />}>
              Find opponent
            </Button>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 className="text-[0.9rem] font-extrabold text-mist-50">Join with a code</h3>
          <p className="mt-1 text-[0.8rem] font-medium text-mist-500">Six characters from a friend's open duel.</p>
          <div className="mt-3 flex gap-2">
            <TextInput
 className="min-w-0 flex-1 tracking-[0.2em] sm:tracking-[0.3em]"
              placeholder="ABC123"
              maxLength={6}
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') joinByCode();
              }}
            />
            <Button className="shrink-0 px-4 sm:px-5" onClick={joinByCode} loading={joinBusy} disabled={joinCode.trim().length < 4}>
              Join
            </Button>
          </div>
        </Card>
      </div>

      {/* The open arena: public duels anyone can join. Private duels never
          show here — the server only lists visibility=public matches. */}
      {openArena.length > 0 && (
        <section aria-label="Open arena">
          <SectionHeading
            title="Open arena"
            subtitle="Public duels anyone can jump into — no code needed."
            icon={<Users className="size-4" />}
          />
          <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
            {openArena.map((duel) => {
              const host = duel.participants.find((p) => p.seat === 'challenger');
              return (
                <Card key={duel.id} className="flex min-w-0 items-center gap-3 p-3.5 sm:p-4">
                  <Avatar name={host?.name ?? '?'} hue={host?.avatar_hue ?? 260} initials={host?.initials} size={38} photo={host ? {id: host.student_id, has: host.has_photo} : null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.86rem] font-extrabold text-mist-50">{host?.name ?? 'A player'} is waiting</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.7rem] font-semibold text-mist-500">
                      <span>{duel.question_count} Q · {duel.time_limit_seconds}s/Q</span>
                      <span className="inline-flex items-center gap-1">
                        <CoinsGlyph /> {duel.stake_coins * 2 + 25} pot
                      </span>
                    </p>
                  </div>
                  <Button size="sm" onClick={() => joinOpen(duel)} icon={<Zap className="size-3.5" />}>
                    Join
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {record && (
        <Card className="min-w-0 p-4 sm:p-5">
          <SectionHeading
            title="Competitive record"
            subtitle="Rating, streaks and the rivals you keep meeting on the ladder."
            icon={<Trophy className="size-4" />}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {label: 'Rating', value: formatNumber(Number(record.rating ?? 1000)), tone: 'text-gold-300'},
              {label: 'Win rate', value: `${Number(record.win_rate ?? 0).toFixed(0)}%`, tone: 'text-mint-300'},
              {label: 'Streak', value: `${Number(record.current_streak ?? 0)}W`, tone: 'text-flare-300'},
              {label: 'Ranked played', value: formatNumber(Number(record.ranked_played ?? 0)), tone: 'text-nova-300'},
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
 <p className="text-[0.58rem] font-black tracking-[0.14em] text-mist-500">{tile.label}</p>
                <p className={`mt-1 font-display text-lg font-black tabular ${tile.tone}`}>{tile.value}</p>
              </div>
            ))}
          </div>

          {Array.isArray(record.rivals) && (record.rivals as {id: number; name: string; wins?: number; losses?: number}[]).length > 0 && (
            <div className="mt-3">
 <p className="text-[0.66rem] font-black tracking-[0.16em] text-mist-500">Rivals</p>
              <ul className="mt-1.5 space-y-1.5">
                {(record.rivals as {id: number; name: string; wins?: number; losses?: number}[]).slice(0, 4).map((rival) => (
                  <li key={rival.id} className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-200">{rival.name}</span>
                    <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">{rival.wins ?? 0}W</Chip>
                    <Chip className="border-flare-500/25 bg-flare-500/10 text-flare-200">{rival.losses ?? 0}L</Chip>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(record.history as {id: number; won: boolean; mode?: string; opponent?: {name: string}[]}[] | undefined)?.length ? (
            <div className="mt-3">
 <p className="text-[0.66rem] font-black tracking-[0.16em] text-mist-500">Last bouts</p>
              <ul className="mt-1.5 space-y-1.5">
                {(record.history as {id: number; won: boolean; mode?: string; opponent?: {name: string}[]}[]).slice(0, 4).map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <Chip className={row.won ? 'border-mint-500/30 bg-mint-500/12 text-mint-200' : 'border-flare-500/30 bg-flare-500/12 text-flare-200'}>
                      {row.won ? 'Win' : 'Loss'}
                    </Chip>
                    <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-200">
                      vs {row.opponent?.[0]?.name ?? 'Arena player'}
                    </span>
                    <Chip className="capitalize">{row.mode ?? 'casual'}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      )}

      <RoomsSection onOpenRoom={onOpenRoom} />

      <section>
        <SectionHeading title="Active duels" subtitle={onlineFriends.length ? `${onlineFriends.length} with online players` : undefined} />
        {loading ? (
          <div className="grid gap-2.5 sm:gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={<Swords className="size-6" />}
            title="No duels running"
            detail="Challenge a friend, publish an open duel, or hit quick match to find a rival instantly."
            action={
              <Button size="sm" onClick={() => setChallengeOpen(true)} icon={<Plus className="size-4" />}>
                Start a duel
              </Button>
            }
          />
        ) : (
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid gap-2.5 sm:gap-3 lg:grid-cols-2">
            <AnimatePresence initial={false}>
              {active.map((duel) => (
                <DuelCard key={duel.id} duel={duel} onOpen={onOpenDuel} onAccept={accept} onDecline={decline} onCancel={cancel} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </section>

      <section>
        <SectionHeading title="Duel history" subtitle="Every bout you have fought in the arena." />
        {history.length === 0 ? (
          <EmptyState icon={<Trophy className="size-6" />} title="Nothing yet" detail="Your finished duels will pile up here." />
        ) : (
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid gap-2.5 sm:gap-3 lg:grid-cols-2">
            {history.slice(0, 8).map((duel) => (
              <div key={duel.id} className="min-w-0 space-y-1.5">
                <DuelCard duel={duel} onOpen={onOpenDuel} onAccept={accept} onDecline={decline} onCancel={cancel} />
                <Button size="sm" variant="outline" block onClick={() => void rematch(duel)} icon={<RotateCcw className="size-3.5" />}>
                  Rematch this rival
                </Button>
              </div>
            ))}
          </motion.ul>
        )}
      </section>

      <ChallengeModal
        open={challengeOpen}
        onClose={() => setChallengeOpen(false)}
        onCreated={(duel) => {
          load();
          /* The creator is ALREADY inside the duel — drop them straight into
             their waiting room; no re-join, no "not ready" errors. */
          onOpenDuel(duel);
        }}
        coins={profile?.coins ?? 0}
      />
    </div>
  );
}
