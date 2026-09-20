/**
 * Events — admin-created, no-cap arena competitions.
 *
 * Upcoming cards count down on the server's clock (never the phone's), live
 * events serve questions at each player's own pace with resume-safe progress,
 * and finished events show positions, rewards and a full answer review. The
 * leaderboard ships top + own + nearby slices only, so a 5,000-player event
 * costs the same as a 50-player one.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Eye,
  Gift,
  LogOut,
  Play,
  Radio,
  Timer,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import {Avatar, Button, Card, Chip, EmptyState, ProgressBar, ReviewOptions, Segmented, Skeleton, StatTile} from '../components/ui';
import {api, tokenStore} from '../lib/api';
import {formatNumber} from '../lib/format';
import {sfx, uiClick} from '../lib/sfx';
import {LiveSocket} from '../lib/ws';
import {useSession} from '../store/session';
import type {
  ArenaEventSummary,
  EventLeaderboard,
  EventQuestionWindow,
  EventsListing,
  QuestionPublic,
  ReviewItem,
} from '../lib/types';

type ListTab = 'live' | 'upcoming' | 'past';

function parseTime(iso: string): number {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}

function countdownParts(target: number, now: number): {text: string; urgent: boolean} {
  const ms = target - now;
  if (ms <= 0) return {text: 'started', urgent: true};
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return {text: `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m`, urgent: false};
  if (hours > 0) return {text: `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`, urgent: false};
  return {text: `${pad(minutes)}m ${pad(seconds)}s`, urgent: true};
}

export default function EventsPanel() {
  const {profile, on, toast} = useSession();
  const meId = profile?.id ?? 0;
  const offsetRef = useRef(0);
  const [, forceTick] = useState(0);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ListTab>('live');
  const [listing, setListing] = useState<EventsListing | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [event, setEvent] = useState<ArenaEventSummary | null>(null);
  const [question, setQuestion] = useState<EventQuestionWindow | null>(null);
  const [leaderboard, setLeaderboard] = useState<EventLeaderboard | null>(null);
  const [myPick, setMyPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const questionStartRef = useRef(0);
  const socketRef = useRef<LiveSocket | null>(null);

  const sync = useCallback((serverNowIso: string) => {
    const drift = Date.now() - parseTime(serverNowIso);
    offsetRef.current = offsetRef.current === 0 ? drift : offsetRef.current * 0.7 + drift * 0.3;
  }, []);
  const serverNow = () => Date.now() - offsetRef.current;

  /* one-second ticker so every countdown breathes */
  useEffect(() => {
    const timer = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ------------------------------------------------------------ loaders */
  const loadListing = useCallback(async () => {
    try {
      const payload = await api.eventsList();
      if (payload.server_now) sync(payload.server_now);
      setListing(payload);
    } catch {
      /* offline — keep the last listing */
    } finally {
      setLoading(false);
    }
  }, [sync]);

  const loadDetail = useCallback(async (eventId: number) => {
    try {
      const payload = await api.eventDetail(eventId);
      if (payload.event.server_now) sync(payload.event.server_now);
      setEvent(payload.event);
      setQuestion(payload.question);
      setLeaderboard(payload.leaderboard);
      if (payload.question?.question && !payload.question.done) questionStartRef.current = Date.now();
    } catch (error) {
      toast('error', 'Event unavailable', (error as Error).message);
      setSelectedId(null);
    }
  }, [sync, toast]);

  useEffect(() => {
    void loadListing();
  }, [loadListing]);

  /* Open an event that just went live while the player is elsewhere. */
  useEffect(
    () =>
      on('event_started', (data) => {
        const payload = data as {name: string};
        toast('success', 'Event live', `${payload.name} has started — join from Events.`);
        void loadListing();
      }),
    [on, toast, loadListing],
  );
  useEffect(
    () =>
      on('event_reminder', (data) => {
        const payload = data as {name: string; starts_in: number};
        toast('info', 'Starting soon', `${payload.name} begins in ${Math.max(1, Math.round(payload.starts_in / 60))} minutes.`);
      }),
    [on, toast],
  );

  /* ------------------------------------------------- event websocket */
  useEffect(() => {
    if (selectedId == null || !tokenStore.get()) return undefined;
    const token = tokenStore.get() ?? '';
    const socket = new LiveSocket({
      token,
      path: `/ws/event/${selectedId}`,
      onEvent: (name, data) => {
        switch (name) {
          case 'event_leaderboard': {
            setLeaderboard(data as EventLeaderboard);
            break;
          }
          case 'event_activity': {
            const payload = data as {items: {text: string}[]};
            setActivityItems(payload.items ?? []);
            break;
          }
          case 'event_ending': {
            const payload = data as {ends_in: number};
            if (payload.ends_in > 0 && payload.ends_in < 310) {
              toast('info', 'Event ending', 'Final minutes — lock in your answers.');
            }
            break;
          }
          case 'event_end': {
            toast('success', 'Event finished', 'Results and rewards are in — check Events.');
            void loadDetail(selectedId);
            void loadListing();
            break;
          }
          default:
            break;
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const [activityItems, setActivityItems] = useState<{text: string}[]>([]);

  /* ---------------------------------------------------------- actions */
  const openEvent = (eventId: number) => {
    uiClick('nav');
    setSelectedId(eventId);
    setReview(null);
    setMyPick(null);
    void loadDetail(eventId);
  };

  const closeEvent = () => {
    uiClick('nav');
    setSelectedId(null);
    setEvent(null);
    setQuestion(null);
    setLeaderboard(null);
    setActivityItems([]);
    setReview(null);
    void loadListing();
  };

  const joinEvent = async () => {
    if (selectedId == null) return;
    uiClick('confirm');
    setBusy(true);
    try {
      const payload = await api.joinEvent(selectedId);
      setEvent(payload.event);
      setQuestion(payload.question);
      if (payload.question?.question) questionStartRef.current = Date.now();
      sfx.play('coin');
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const leaveEvent = async () => {
    if (selectedId == null) return;
    uiClick('cancel');
    try {
      const payload = await api.leaveEvent(selectedId);
      setEvent(payload.event);
      toast('info', 'Left the event', 'Your progress is saved — come back before it ends.');
    } catch (error) {
      toast('error', 'Could not leave', (error as Error).message);
    }
  };

  const answer = async (letter: string) => {
    if (selectedId == null || !question || myPick || busy) return;
    uiClick('select');
    const elapsed = Math.max(0, Date.now() - questionStartRef.current);
    setMyPick(letter);
    setBusy(true);
    try {
      const payload = await api.answerEvent(selectedId, letter, elapsed);
      sfx.play(payload.result.correct ? 'correct' : 'wrong');
      if (payload.result.progress.done) {
        setQuestion(null);
        void loadDetail(selectedId);
      } else {
        setQuestion(payload.result.progress);
        setMyPick(null);
        questionStartRef.current = Date.now();
      }
      if (payload.leaderboard) setLeaderboard(payload.leaderboard);
    } catch (error) {
      setMyPick(null);
      toast('error', 'Answer rejected', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resumeRun = async () => {
    if (selectedId == null) return;
    uiClick('confirm');
    await loadDetail(selectedId);
  };

  const openReview = async () => {
    if (selectedId == null) return;
    uiClick('nav');
    try {
      const payload = await api.eventReview(selectedId);
      setReview(payload.items);
    } catch (error) {
      toast('error', 'Review unavailable', (error as Error).message);
    }
  };

  /* -------------------------------------------------------- derived */
  const cards = useMemo(() => {
    if (!listing) return [];
    if (tab === 'live') return listing.live;
    if (tab === 'upcoming') return listing.upcoming;
    return listing.past;
  }, [listing, tab]);

  const timeModeLabel = (mode: string) =>
    mode === 'fixed' ? 'Fixed duration' : mode === 'per_question' ? 'Timed per question' : 'Untimed';

  /* --------------------------------------------------------- renders */
  if (loading) {
    return (
      <div className="w-full space-y-4 p-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  /* ------------------------------------------------- event detail view */
  if (selectedId != null && event) {
    const startsIn = countdownParts(parseTime(event.starts_at), serverNow());
    const endsIn = countdownParts(parseTime(event.ends_at), serverNow());
    const me = event.me;
    const joined = event.joined;
    const myBoardRow = leaderboard?.mine ?? null;
    const options = question?.question ? Object.entries(question.question.options as Record<string, string>) : [];

    return (
      <div className="w-full space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={closeEvent} icon={<ChevronLeft className="size-4" />}>
            Events
          </Button>
          <Chip
            className={
              event.status === 'live'
                ? 'border-mint-400/30 bg-mint-400/10 text-mint-300'
                : event.status === 'finished'
                  ? 'border-nova-400/30 bg-nova-400/10 text-nova-200'
                  : 'border-gold-400/30 bg-gold-400/10 text-gold-300'
            }
          >
            {event.status === 'live' ? 'Live' : event.status === 'finished' ? 'Finished' : 'Upcoming'}
          </Chip>
          <span className="ml-auto flex items-center gap-1.5 text-[0.7rem] font-extrabold text-mist-400">
            <Users className="size-3.5" /> {formatNumber(event.participants)} in
          </span>
        </div>

        {/* summary card — works as the mobile header too */}
        <Card className="p-4 sm:p-5">
          <h1 className="font-display text-[1.1rem] font-black tracking-tight text-mist-50 sm:text-[1.25rem]">{event.name}</h1>
          {event.description && <p className="mt-1.5 text-[0.8rem] font-medium leading-relaxed text-mist-400">{event.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip>{event.course_title}</Chip>
            <Chip>{event.question_count} questions</Chip>
            <Chip>{timeModeLabel(event.time_mode)}</Chip>
            {event.entry_xp > 0 && <Chip className="border-flare-400/30 bg-flare-400/10 text-flare-300">{formatNumber(event.entry_xp)} XP entry</Chip>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              label={event.status === 'live' ? 'Ends in' : event.status === 'finished' ? 'Finished' : 'Starts in'}
              value={event.status === 'live' ? endsIn.text : event.status === 'finished' ? '—' : startsIn.text}
            />
            <StatTile label="Prize pool" value={event.prize_pool.split(' · ')[0] ?? 'Glory'} hint={event.prize_pool} />
            <StatTile label="Players" value={formatNumber(event.participants)} hint={`${leaderboard?.active ?? 0} active now`} />
            <StatTile
              label="Your score"
              value={me ? formatNumber(me.score) : '—'}
              hint={myBoardRow?.position ? `${myBoardRow.position === 1 ? '1st' : `#${myBoardRow.position}`} on the board` : 'not on the board yet'}
            />
          </div>
          {event.scoring_note && <p className="mt-3 text-[0.72rem] font-semibold text-mist-500">Rules: {event.scoring_note}</p>}
        </Card>

        {/* ------------------------------------------------ scheduled: lobby */}
        {event.status === 'scheduled' && (
          <Card className="p-4 text-center sm:p-5">
            <Clock className="mx-auto size-6 text-gold-300" />
            <p className="mt-2 text-[0.9rem] font-extrabold text-mist-50">Starts in {startsIn.text}</p>
            <p className="mt-1 text-[0.74rem] font-medium text-mist-500">The countdown runs on the server clock — closing this page changes nothing.</p>
            {joined ? (
              <p className="mt-3 flex items-center justify-center gap-2 text-[0.8rem] font-extrabold text-mint-300">
                <Check className="size-4" /> You are registered — the questions open the moment it starts.
              </p>
            ) : (
              <Button className="mt-4" loading={busy} onClick={joinEvent} icon={<CalendarDays className="size-4" />}>
                Join event
              </Button>
            )}
          </Card>
        )}

        {/* ----------------------------------------------------- live: play */}
        {event.status === 'live' && (
          <>
            {joined && me && !me.finished && question?.question && (
              <Card className="p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Timer className="size-4 text-nova-300" />
                  <p className="text-[0.74rem] font-extrabold text-mist-300">
                    Question {question.index + 1} of {question.total}
                  </p>
                  <span className="ml-auto text-[0.68rem] font-bold text-mist-500">{question.answered} answered</span>
                </div>
                <ProgressBar className="mt-2" value={((question.index + 1) / question.total) * 100} />
                <h2 className="mt-3 text-[0.98rem] font-extrabold leading-snug text-mist-50">{question.question.text}</h2>
                <div className="mt-4 grid gap-2">
                  {options.map(([letter, text]) => (
                    <button
                      key={letter}
                      disabled={!!myPick}
                      onClick={() => answer(letter)}
                      className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all active:translate-y-px disabled:opacity-60 ${
                        myPick === letter ? 'border-nova-400/60 bg-nova-400/12' : 'border-white/10 bg-white/4 hover:border-white/25 hover:bg-white/8'
                      }`}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/6 font-display text-[0.72rem] font-black text-mist-200">
                        {letter}
                      </span>
                      <span className="text-[0.84rem] font-semibold text-mist-100">{text}</span>
                    </button>
                  ))}
                </div>
                {myPick && (
                  <p className="mt-3 flex items-center gap-2 text-[0.72rem] font-bold text-mist-400">Locked — on to the next one.</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={resumeRun} icon={<Play className="size-3.5" />}>
                    Refresh
                  </Button>
                  {event.allow_leave && (
                    <Button variant="ghost" size="sm" onClick={leaveEvent} icon={<LogOut className="size-3.5" />}>
                      Leave (progress saved)
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {joined && me?.finished && (
              <Card className="p-5 text-center">
                <Check className="mx-auto size-6 text-mint-300" />
                <p className="mt-2 text-[0.9rem] font-extrabold text-mist-50">Run complete</p>
                <p className="mt-1 text-[0.76rem] font-medium text-mist-400">
                  {me.correct}/{me.answered} correct · {formatNumber(me.score)} points. Rankings settle when the event ends.
                </p>
              </Card>
            )}

            {!joined && (
              <Card className="p-5 text-center">
                <p className="text-[0.86rem] font-extrabold text-mist-50">This event is live</p>
                <p className="mt-1 text-[0.76rem] font-medium text-mist-400">
                  {event.allow_join_during ? 'Jump in — you can still catch up.' : 'Joining mid-event is closed for this one.'}
                </p>
                {event.allow_join_during && (
                  <Button className="mt-4" loading={busy} onClick={joinEvent} icon={<Zap className="size-4" />}>
                    {event.entry_xp > 0 ? `Join · ${formatNumber(event.entry_xp)} XP entry` : 'Join event'}
                  </Button>
                )}
              </Card>
            )}

            {/* leaderboard: top + own slice only */}
            {event.leaderboard_visible && leaderboard && leaderboard.top.length > 0 && (
              <Card className="p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-gold-300" />
                  <h3 className="text-[0.9rem] font-extrabold text-mist-50">Leaderboard</h3>
                  <span className="ml-auto text-[0.66rem] font-bold text-mist-500">
                    {formatNumber(leaderboard.total)} players · {leaderboard.active} active
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {leaderboard.top.slice(0, 8).map((row) => (
                    <li
                      key={row.student_id}
                      className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${row.student_id === meId ? 'bg-nova-400/10' : ''}`}
                    >
                      <span className="w-6 text-center font-display text-[0.74rem] font-black text-mist-400">{row.position}</span>
                      <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={28} photo={{id: row.student_id, has: row.has_photo}} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.76rem] font-bold text-mist-100">{row.name}</p>
                        <p className="text-[0.6rem] font-semibold text-mist-500">
                          {row.correct}/{row.questions_total} · {Math.round((row.correct / Math.max(1, row.answered)) * 100)}% accuracy
                        </p>
                      </div>
                      <span className="font-display text-[0.82rem] font-black text-mist-50">{formatNumber(row.score)}</span>
                    </li>
                  ))}
                </ul>
                {leaderboard.mine && (leaderboard.mine.position ?? 0) > 8 && (
                  <p className="mt-2 border-t border-white/8 pt-2 text-center text-[0.7rem] font-bold text-mist-400">
                    You: #{leaderboard.mine.position ?? '—'} · {formatNumber(leaderboard.mine.score)} points
                  </p>
                )}
                {activityItems.length > 0 && (
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <p className="flex items-center gap-1.5 text-[0.62rem] font-extrabold text-mist-500">
                      <Radio className="size-3.5 text-nova-300" /> Live activity
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {activityItems.slice(-4).map((item, i) => (
                        <li key={i} className="truncate text-[0.68rem] font-semibold text-mist-400">
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {/* -------------------------------------------------- finished view */}
        {event.status === 'finished' && me && (
          <Card className="p-5 text-center sm:p-6">
            <Trophy className="mx-auto size-7 text-gold-300" />
            <p className="game-title mt-2 font-display text-[1.35rem] font-black">
              {me.position ? (me.position === 1 ? '1st' : me.position === 2 ? '2nd' : me.position === 3 ? '3rd' : `#${me.position}`) : '—'}
              <span className="text-mist-500"> of {formatNumber(event.participants)}</span>
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <StatTile label="Score" value={formatNumber(me.score)} />
              <StatTile label="Accuracy" value={`${Math.round((me.correct / Math.max(1, me.answered)) * 100)}%`} />
              <StatTile label="Correct" value={`${me.correct}/${me.answered}`} />
            </div>
            {Object.keys(me.rewards ?? {}).length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                <Gift className="size-4 text-gold-300" />
                {(me.rewards as Record<string, number>).xp ? <Chip className="border-gold-400/30 bg-gold-400/10 text-gold-300">{(me.rewards as Record<string, number>).xp} XP</Chip> : null}
                {(me.rewards as Record<string, number>).coins ? <Chip className="border-gold-400/30 bg-gold-400/10 text-gold-300">{(me.rewards as Record<string, number>).coins} coins</Chip> : null}
                {(me.rewards as Record<string, number>).diamonds ? <Chip className="border-nova-400/30 bg-nova-400/10 text-nova-200">{(me.rewards as Record<string, number>).diamonds} diamonds</Chip> : null}
                {(me.rewards as Record<string, string>).badge ? <Chip className="border-mint-400/30 bg-mint-400/10 text-mint-300">Event badge</Chip> : null}
              </div>
            )}
            <Button className="mt-4" variant="outline" onClick={openReview} icon={<Eye className="size-4" />}>
              View answers
            </Button>
          </Card>
        )}

        {/* review list */}
        <AnimatePresence>
          {review && (
            <motion.div initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReview(null)} icon={<ArrowLeft className="size-4" />}>
                  Hide answers
                </Button>
              </div>
              <ul className="mt-3 space-y-3">
                {review.map((item) => {
                  const q = item.question as QuestionPublic & {correct?: string; explanation?: string};
                  return (
                    <Card key={item.index} className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[0.7rem] font-black text-mist-500">Q{item.index + 1}</span>
                        <span className={`text-[0.66rem] font-extrabold ${item.correct ? 'text-mint-300' : 'text-flare-300'}`}>
                          {item.correct ? 'Correct' : item.selected ? 'Wrong' : 'Skipped'} · +{item.points}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[0.86rem] font-bold leading-snug text-mist-100">{q.text}</p>
                      <ReviewOptions options={q.options as Record<string, string>} correct={q.correct_label ?? q.correct} chosen={item.selected} />
                      {q.explanation && <p className="mt-1.5 text-[0.76rem] font-medium leading-relaxed text-mist-400">{q.explanation}</p>}
                      <p className="mt-2 text-[0.7rem] font-bold text-mist-500">
                        Your answer: {item.selected ?? '—'} · Correct: {q.correct_label ?? q.correct ?? '—'}
                      </p>
                    </Card>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  /* ------------------------------------------------------- listing view */
  return (
    <div className="w-full space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-5 text-nova-300" />
        <h1 className="font-display text-[1.15rem] font-black tracking-tight text-mist-50 sm:text-[1.35rem]">Events</h1>
      </div>

      <Segmented
        options={[
          {value: 'live', label: `Live${listing?.live.length ? ` (${listing.live.length})` : ''}`},
          {value: 'upcoming', label: `Upcoming${listing?.upcoming.length ? ` (${listing.upcoming.length})` : ''}`},
          {value: 'past', label: 'Past'},
        ]}
        value={tab}
        onChange={(next) => {
          uiClick('tap');
          setTab(next as ListTab);
        }}
      />

      {cards.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="size-6" />}
          title={tab === 'live' ? 'Nothing live right now' : tab === 'upcoming' ? 'No events scheduled' : 'No past events yet'}
          detail="Staff create events from the admin console — check back soon."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const startsIn = countdownParts(parseTime(card.starts_at), serverNow());
          const endsIn = countdownParts(parseTime(card.ends_at), serverNow());
          return (
            <Card key={card.id} className="flex flex-col p-4 transition-transform active:translate-y-px">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[0.95rem] font-extrabold text-mist-50">{card.name}</h2>
                  <p className="truncate text-[0.68rem] font-bold text-mist-500">{card.course_title}</p>
                </div>
                {card.status === 'live' ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-mint-400/30 bg-mint-400/10 px-2 py-0.5 text-[0.62rem] font-extrabold text-mint-300">
                    <span className="size-1.5 animate-pulse rounded-full bg-mint-400" /> Live
                  </span>
                ) : card.status === 'finished' ? (
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[0.62rem] font-extrabold text-mist-400">
                    Finished
                  </span>
                ) : (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.62rem] font-extrabold ${startsIn.urgent ? 'border-gold-400/30 bg-gold-400/10 text-gold-300' : 'border-white/10 bg-white/6 text-mist-300'}`}>
                    {startsIn.text}
                  </span>
                )}
              </div>
              {card.description && <p className="mt-2 line-clamp-2 text-[0.78rem] font-medium text-mist-400">{card.description}</p>}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Chip>{card.prize_pool}</Chip>
                <Chip>{card.question_count} questions</Chip>
                {card.entry_xp > 0 && <Chip className="border-flare-400/30 bg-flare-400/10 text-flare-300">{formatNumber(card.entry_xp)} XP entry</Chip>}
                {card.joined && <Chip className="border-mint-400/30 bg-mint-400/10 text-mint-300">Joined</Chip>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
                <p className="flex items-center gap-1.5 text-[0.68rem] font-bold text-mist-500">
                  <Users className="size-3.5" /> {formatNumber(card.participants)} players
                  {card.status === 'live' && <span className="text-mist-600"> · ends in {endsIn.text}</span>}
                </p>
                <Button size="sm" variant="outline" onClick={() => openEvent(card.id)}>
                  View event
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
