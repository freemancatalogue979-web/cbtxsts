/**
 * Room — the multiplayer quiz-night view.
 *
 * One socket per room drives everything: the member list, the question that is
 * live for the whole room, the per-question clock, the rolling scoreboard and
 * the chat that runs from the lobby to the final standings. Hosts get the
 * control bar (start, reveal early, next question); guests get the buzzer.
 */
import {
  Check,
  ChevronLeft,
  Copy,
  Crown,
  LogOut,
  Medal,
  MessageCircle,
  Play,
  Send,
  SkipForward,
  Swords,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Avatar, Button, Card, Chip, EmptyState, ProgressBar, Skeleton, TextInput} from '../components/ui';
import {api, tokenStore} from '../lib/api';
import {formatNumber} from '../lib/format';
import {sfx} from '../lib/sfx';
import {LiveSocket} from '../lib/ws';
import {useSession} from '../store/session';
import type {RoomFinishPayload, RoomMessage, RoomQuestionPayload, RoomRevealPayload, RoomState} from '../lib/types';

function parseTime(iso: string): number {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}

function ChatPanel({
  messages,
  onSend,
  myId,
  connected,
}: {
  messages: RoomMessage[];
  onSend: (body: string) => void;
  myId: number;
  connected: boolean;
}) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({top: listRef.current.scrollHeight, behavior: 'smooth'});
  }, [messages.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText('');
  };

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-white/8 px-3.5 py-2.5">
        <MessageCircle className="size-4 text-nova-300" />
        <h3 className="text-[0.8rem] font-extrabold text-mist-100">Room chat</h3>
        <span className={`ml-auto size-2 rounded-full ${connected ? 'bg-mint-400' : 'bg-gold-400 animate-pulse'}`} />
      </div>
      <div ref={listRef} className="min-h-40 flex-1 space-y-2 overflow-y-auto px-3 py-3 max-h-64 lg:max-h-[26rem]">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-[0.74rem] font-semibold text-mist-600">
            Say hi — ask about a question, hype your friends, talk trash.
          </p>
        )}
        {messages.map((message) => {
          const mine = message.sender_id === myId;
          return (
            <div key={message.id} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar name={message.sender_name} hue={message.sender_hue} initials={message.sender_initials} size={26} />
              <div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}>
                <p className="text-[0.62rem] font-bold text-mist-600">{mine ? 'You' : message.sender_name}</p>
                <p
                  className={`mt-0.5 inline-block rounded-2xl px-3 py-1.5 text-[0.78rem] font-semibold leading-snug ${
                    mine ? 'brand-gradient text-white rounded-br-md' : 'bg-white/8 text-mist-200 rounded-bl-md'
                  }`}
                >
                  {message.body}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-white/8 p-2.5">
        <TextInput
          className="min-w-0 flex-1"
          placeholder={connected ? 'Message the room…' : 'Reconnecting…'}
          value={text}
          maxLength={400}
          onChange={(event) => setText(event.target.value)}
          disabled={!connected}
        />
        <Button type="submit" size="sm" className="shrink-0 px-3" disabled={!connected || !text.trim()} aria-label="Send message">
          <Send className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

export default function Room({roomId, onExit}: {roomId: number; onExit: () => void}) {
  const {profile, toast, on} = useSession();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [question, setQuestion] = useState<RoomQuestionPayload | null>(null);
  const [reveal, setReveal] = useState<RoomRevealPayload | null>(null);
  const [finish, setFinish] = useState<RoomFinishPayload | null>(null);
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [myPick, setMyPick] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<LiveSocket | null>(null);
  const myId = profile?.id ?? 0;

  /* ---------------------------------------------------------- boot + ws */
  useEffect(() => {
    let alive = true;
    api
      .roomDetail(roomId)
      .then((data) => {
        if (!alive) return;
        setRoom(data.room);
        setMessages(data.messages);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (!alive) return;
        toast('error', 'Could not open the room', error.message);
        setLoading(false);
        onExit();
      });

    const socket = new LiveSocket({
      token: tokenStore.get() ?? '',
      path: `/ws/room/${roomId}`,
      onStatus: (status) => setConnected(status === 'open'),
      onEvent: (event, raw) => {
        if (!alive) return;
        const data = raw as Record<string, unknown>;
        switch (event) {
          case 'room_state': {
            const state = data as unknown as {room: RoomState; messages: RoomMessage[]};
            setRoom(state.room);
            setMessages(state.messages);
            setLoading(false);
            break;
          }
          case 'room_join':
          case 'room_leave':
          case 'room_kicked': {
            if (event === 'room_kicked' && (data.student_id as number) === myId) {
              toast('error', 'Kicked from the room', 'The host removed you.');
              onExit();
              return;
            }
            if (event === 'room_leave' && (data.student_id as number) === myId) {
              onExit();
              return;
            }
            api.roomDetail(roomId).then((fresh) => setRoom(fresh.room)).catch(() => undefined);
            break;
          }
          case 'room_chat': {
            const message = data as unknown as RoomMessage;
            setMessages((rows) => [...rows, message]);
            if (message.sender_id !== myId) sfx.play('chat');
            break;
          }
          case 'room_start':
            toast('success', 'Room is live!', 'First question incoming…');
            break;
          case 'room_question': {
            const payload = data as unknown as RoomQuestionPayload;
            setQuestion(payload);
            setReveal(null);
            setLockedIds([]);
            setMyPick(null);
            sfx.play('duel');
            break;
          }
          case 'room_answered':
            setLockedIds((rows) => (rows.includes(data.student_id as number) ? rows : [...rows, data.student_id as number]));
            break;
          case 'room_reveal': {
            const payload = data as unknown as RoomRevealPayload;
            setReveal(payload);
            setLockedIds([]);
            sfx.play(payload.correct_ids.includes(myId) ? 'correct' : 'wrong');
            break;
          }
          case 'room_finish': {
            const payload = data as unknown as RoomFinishPayload;
            setFinish(payload);
            setQuestion(null);
            setReveal(null);
            const mine = payload.rewards.find((row) => row.student_id === myId);
            if (mine && mine.xp > 0) {
              toast('success', 'Room complete!', `You earned ${mine.xp} XP and ${mine.coins} coins.`);
            }
            sfx.play('win');
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
      alive = false;
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Refresh the scoreboard whenever the global channel reports room updates.
  useEffect(() => on('rooms_update', () => api.roomDetail(roomId).then((d) => setRoom(d.room)).catch(() => undefined)), [on, roomId]);

  /* ------------------------------------------------------------ actions */
  const answer = async (letter: string) => {
    if (!question || reveal || lockedIds.includes(myId) || busy) return;
    const elapsed = Math.max(0, Date.now() - (parseTime(question.deadline) - question.seconds * 1000));
    setBusy(true);
    try {
      const result = await api.answerRoom(roomId, letter, elapsed);
      setMyPick(letter);
      setLockedIds((rows) => (rows.includes(myId) ? rows : [...rows, myId]));
      sfx.play(result.result.correct ? 'correct' : 'wrong');
      if (result.reveal) {
        setReveal(result.reveal);
        setLockedIds([]);
      }
      setRoom(result.room);
    } catch (error) {
      toast('error', 'Answer rejected', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hostAction = async (action: 'start' | 'next' | 'reveal') => {
    setBusy(true);
    try {
      if (action === 'start') {
        const result = await api.startRoom(roomId);
        setRoom(result.room);
        if (result.question) setQuestion(result.question);
      } else if (action === 'reveal') {
        const result = await api.revealRoom(roomId);
        setReveal(result.reveal);
        setLockedIds([]);
      } else {
        const result = await api.nextRoom(roomId);
        setRoom(result.room);
        if (result.question) {
          setQuestion(result.question);
          setReveal(null);
          setLockedIds([]);
          setMyPick(null);
        } else if (result.finish) {
          setFinish(result.finish);
          setQuestion(null);
          setReveal(null);
        }
      }
    } catch (error) {
      toast('error', 'Host action failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    try {
      await api.leaveRoom(roomId);
    } catch {
      /* room may already be gone */
    }
    onExit();
  };

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      toast('success', 'Room code copied', `Share ${room.code} with friends.`);
    } catch {
      toast('info', 'Room code', room.code);
    }
  };

  const sendChat = useCallback((body: string) => {
    socketRef.current?.send({type: 'chat', body});
  }, []);

  const standings = useMemo(() => {
    const rows = finish?.standings ?? reveal?.standings ?? [];
    if (rows.length) return rows;
    return [...(room?.members ?? [])].sort((a, b) => b.score - a.score);
  }, [finish, reveal, room]);

  const iLocked = lockedIds.includes(myId);
  const myCorrect = reveal?.correct_ids.includes(myId) ?? false;

  /* ------------------------------------------------------------- render */
  if (loading) {
    return (
      <div className="w-full space-y-4 p-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!room) return null;

  return (
    <div className="w-full space-y-4 p-3 sm:p-4">
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={leave} icon={<ChevronLeft className="size-4" />}>
          <span className="hidden sm:inline">Leave room</span>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.05rem] font-black tracking-tight text-mist-50 sm:text-[1.25rem]">
            {room.title}
          </h1>
          <p className="text-[0.7rem] font-bold text-mist-500">
            {room.members.length}/{room.capacity} players ·{' '}
            {room.status === 'lobby' ? 'lobby' : room.status === 'live' ? `question ${Math.max(1, room.round_index + 1)} of ${room.questions_total}` : 'finished'}
          </p>
        </div>
        <button
          onClick={copyCode}
          className="hud-pill flex items-center gap-1.5 px-3 py-1.5 font-display text-[0.85rem] font-black tracking-[0.18em] text-gold-300 touch-manipulation"
          title="Copy room code"
        >
          {room.code}
          <Copy className="size-3.5" />
        </button>
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setChatOpen((open) => !open)} aria-label="Toggle room chat">
          <MessageCircle className="size-4" />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* ------------------------------------------------------ main column */}
        <div className="min-w-0 space-y-4">
          {room.status === 'lobby' && (
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Users className="size-4 text-nova-300" />
                <h2 className="text-[0.95rem] font-extrabold text-mist-50">Lobby</h2>
                <Chip>Share code {room.code}</Chip>
              </div>
              <p className="mt-1.5 text-[0.8rem] font-medium text-mist-400">
                {room.question_count} questions · {room.per_question_seconds}s each ·{' '}
                {room.course_id ? 'course bank' : 'the whole arena'}. Chat is already live.
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {room.members.map((member) => (
                  <li key={member.student_id} className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/4 px-2.5 py-2">
                    <Avatar
                      name={member.name}
                      hue={member.avatar_hue}
                      initials={member.initials}
                      size={32}
                      ring={member.is_host}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.76rem] font-extrabold text-mist-100">{member.name}</p>
                      <p className="text-[0.62rem] font-bold text-mist-600">{member.is_host ? 'Host' : member.student_id === myId ? 'You' : 'Guest'}</p>
                    </div>
                    {member.is_host && <Crown className="size-3.5 shrink-0 text-gold-400" />}
                  </li>
                ))}
              </ul>
              {room.is_host ? (
                <Button
                  className="mt-4 w-full"
                  size="lg"
                  onClick={() => hostAction('start')}
                  loading={busy}
                  disabled={room.members.length < 2}
                  icon={<Play className="size-4" />}
                >
                  {room.members.length < 2 ? 'Waiting for players…' : 'Start the room'}
                </Button>
              ) : (
                <p className="mt-4 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-center text-[0.78rem] font-bold text-mist-400">
                  Waiting for the host to start… warm up in the chat.
                </p>
              )}
            </Card>
          )}

          {room.status === 'live' && question && (
            <Card className="relative overflow-hidden p-4 sm:p-5">
              <RoomClock question={question} reveal={reveal} />
              <p className="mt-3 text-[0.95rem] font-bold leading-relaxed text-mist-50 sm:text-[1.05rem]">{question.question.text}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(question.question.options).map(([letter, text]) => {
                  const isCorrect = reveal?.correct === letter;
                  const myPickWrong = Boolean(reveal && myPick === letter && !myCorrect);
                  return (
                    <button
                      key={letter}
                      onClick={() => answer(letter)}
                      disabled={Boolean(reveal) || iLocked || busy}
                      className={`flex min-h-12 items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left text-[0.84rem] font-bold transition-all touch-manipulation ${
                        isCorrect
                          ? 'border-mint-400/50 bg-mint-500/15 text-mint-200'
                          : reveal
                            ? 'border-white/8 bg-white/4 text-mist-500'
                            : iLocked
                              ? 'border-nova-400/40 bg-nova-500/10 text-mist-300'
                              : 'border-white/10 bg-white/6 text-mist-100 hover:border-nova-400/40 hover:bg-nova-500/8 active:scale-[0.98]'
                      }`}
                    >
                      <span className={`grid size-7 shrink-0 place-items-center rounded-lg font-display text-[0.8rem] font-black ${isCorrect ? 'bg-mint-400/25 text-mint-200' : 'bg-white/10 text-mist-300'}`}>
                        {letter}
                      </span>
                      <span className="min-w-0 flex-1">{text}</span>
                      {isCorrect && <Check className="size-4 shrink-0 text-mint-300" />}
                      {myPickWrong && <X className="size-4 shrink-0 text-flare-400" />}
                    </button>
                  );
                })}
              </div>

              {reveal && (
                <div className="rise-in mt-3 rounded-2xl border border-white/10 bg-ink-950/50 p-3.5">
                  <p className="flex items-center gap-2 text-[0.82rem] font-extrabold text-mist-100">
                    {myCorrect ? <Zap className="size-4 text-gold-300" /> : <Swords className="size-4 text-flare-400" />}
                    {myCorrect ? 'Correct!' : `Answer: ${reveal.correct}`} · {reveal.correct_ids.length}/{reveal.answered || room.members.length} got it
                  </p>
                  {reveal.explanation && <p className="mt-1 text-[0.76rem] font-medium leading-relaxed text-mist-400">{reveal.explanation}</p>}
                  <p className="mt-1 text-[0.7rem] font-bold text-mist-600">
                    {reveal.correct_ids.includes(myId) ? '' : 'Watch the standings — '}
                    {room.is_host ? 'Press Next question when the room is ready.' : 'The host will move to the next question.'}
                  </p>
                </div>
              )}

              {!reveal && (iLocked ? (
                <p className="mt-3 text-center text-[0.78rem] font-extrabold text-mint-300">Answer locked — waiting for the room…</p>
              ) : (
                <p className="mt-3 text-center text-[0.74rem] font-bold text-mist-600">{lockedIds.length}/{room.members.length} locked in</p>
              ))}

              {room.is_host && (
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => hostAction('reveal')} disabled={busy} icon={<Check className="size-4" />}>
                    Reveal now
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => hostAction('next')} loading={busy} icon={<SkipForward className="size-4" />}>
                    {reveal ? 'Next question' : 'Skip + next'}
                  </Button>
                </div>
              )}
            </Card>
          )}

          {room.status === 'live' && !question && (
            <Card className="grid place-items-center p-8 text-center">
              <EmptyState icon={<Zap className="size-6" />} title="Get ready…" detail="The next question is loading for everyone." />
            </Card>
          )}

          {finish && (
            <Card className="p-4 sm:p-5">
              <h2 className="font-display text-[1.1rem] font-black text-gold-300">Final standings</h2>
              <ul className="mt-3 space-y-2">
                {finish.standings.map((member, index) => {
                  const reward = finish.rewards.find((row) => row.student_id === member.student_id);
                  return (
                    <li
                      key={member.student_id}
                      className={`flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 ${
                        index === 0 ? 'border-gold-400/40 bg-gold-400/10' : 'border-white/8 bg-white/4'
                      }`}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10 font-display text-[0.85rem] font-black text-mist-100">
                        {index + 1}
                      </span>
                      <Avatar name={member.name} hue={member.avatar_hue} initials={member.initials} size={34} ring={index === 0} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.84rem] font-extrabold text-mist-50">
                          {member.name} {member.student_id === myId && <span className="text-mist-500">(you)</span>}
                        </p>
                        <p className="text-[0.68rem] font-bold text-mist-500">
                          {member.correct_count} correct · {member.score} pts
                        </p>
                      </div>
                      {index < 3 && <Medal className={`size-4 shrink-0 ${index === 0 ? 'text-gold-300' : 'text-mist-400'}`} />}
                      {reward && (reward.xp > 0 || reward.coins > 0) && (
                        <span className="shrink-0 text-right text-[0.66rem] font-black text-mint-300">
                          +{reward.xp} XP
                          <br />+{formatNumber(reward.coins)} coins
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Button className="mt-4 w-full" size="lg" onClick={onExit} icon={<LogOut className="size-4" />}>
                Back to the duel arena
              </Button>
            </Card>
          )}
        </div>

        {/* ------------------------------------------------------ side column */}
        <div className={`min-w-0 space-y-4 ${chatOpen ? '' : 'hidden lg:block'}`}>
          {!finish && (
            <Card className="p-3.5">
              <h3 className="flex items-center gap-2 text-[0.8rem] font-extrabold text-mist-100">
                <Crown className="size-3.5 text-gold-400" /> Scoreboard
              </h3>
              <ul className="mt-2 space-y-1.5">
                <AnimatePresence initial={false}>
                  {standings.slice(0, 8).map((member, index) => (
                    <motion.li
                      key={member.student_id}
                      layout
                      initial={{opacity: 0, x: 8}}
                      animate={{opacity: 1, x: 0}}
                      className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${member.student_id === myId ? 'bg-nova-500/12' : ''}`}
                    >
                      <span className="w-4 text-center text-[0.68rem] font-black text-mist-600">{index + 1}</span>
                      <Avatar name={member.name} hue={member.avatar_hue} initials={member.initials} size={24} />
                      <span className="min-w-0 flex-1 truncate text-[0.74rem] font-bold text-mist-200">
                        {member.student_id === myId ? 'You' : member.name.split(' ')[0]}
                        {lockedIds.includes(member.student_id) && !reveal && <Check className="ml-1 inline size-3 text-mint-400" />}
                      </span>
                      <span className="shrink-0 font-display text-[0.74rem] font-black tabular-nums text-gold-300">{member.score}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Card>
          )}
          <ChatPanel messages={messages} onSend={sendChat} myId={myId} connected={connected} />
        </div>
      </div>
    </div>
  );
}


/* The question clock owns its own 250ms tick so only this chip re-renders,
   never the whole room view. */
function RoomClock({question, reveal}: {question: RoomQuestionPayload; reveal: RoomRevealPayload | null}) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (reveal) {
      setSecondsLeft(0);
      return undefined;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((parseTime(question.deadline) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [question, reveal]);
  return (
    <>
      <div className="flex items-center gap-2">
        <Chip className="border-nova-400/30 bg-nova-500/12 text-nova-200">Question {question.index + 1} / {question.total}</Chip>
        <span className={`ml-auto font-display text-[0.95rem] font-black tabular-nums ${secondsLeft <= 5 && !reveal ? 'text-flare-400 animate-pulse' : 'text-gold-300'}`}>
          {reveal ? 'Locked' : `${secondsLeft}s`}
        </span>
      </div>
      {!reveal && (
        <div className="mt-2">
          <ProgressBar value={Math.round((secondsLeft / question.seconds) * 100)} tone="gold" barClassName={secondsLeft <= 5 ? 'bg-flare-500' : ''} />
        </div>
      )}
    </>
  );
}
