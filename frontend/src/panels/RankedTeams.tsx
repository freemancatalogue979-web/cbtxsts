/**
 * Team Ranked — the ranked war room next to the solo queue.
 *
 * One dashboard for rating, records and rooms; friend lobbies at any size
 * from 1v1 up to 5v5 (never forced); matchmaking, teams, questions, clocks,
 * scores and rank points are all server-owned. Lobby and match screens poll
 * plus listen on the live socket so the room feels instant on a phone.
 */
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  LogOut,
  Search,
  Send,
  ShieldAlert,
  Swords,
  Target,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Avatar, Button, Card, Chip, Field, Modal, ProgressBar, SectionHeading, Select, Skeleton, StatTile, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';

type Json = Record<string, unknown>;

interface LobbyMember {
  student_id: number;
  name: string;
  avatar: string;
  is_host: boolean;
  ready: boolean;
  rating: number;
  connection: string;
}
interface Lobby {
  id: number;
  code: string;
  status: string;
  team_size: number;
  course_id: number | null;
  course_title: string;
  members: LobbyMember[];
  full: boolean;
  viewer_is_member: boolean;
  viewer_is_host: boolean;
  error?: string | null;
}
interface Dashboard {
  rating: number;
  tier: {label: string; icon?: string; metal?: string} | null;
  played: number;
  won: number;
  team_matches: number;
  team_wins: number;
  accuracy: number | null;
  avg_score: number | null;
  win_streak: number;
  recent: {match_id: number; finished_at: string | null; score: number; correct: number; total: number; delta: number; won: boolean; draw: boolean; team_size: number}[];
  friends_in_lobbies: {student_id: number; name: string; lobby_code: string; team_size: number; lobby_status: string}[];
  open_lobbies: Lobby[];
  courses: {id: number; title: string; code: string; pool: number; playable: boolean}[];
  my_lobby: Lobby | null;
  active_match_id: number | null;
}
interface TeamSide {
  team: number;
  name: string;
  score: number;
  correct: number;
  answered: number;
  total: number;
  members: {
    student_id: number;
    name: string;
    score: number;
    correct: number;
    answered: number;
    total: number;
    streak: number;
    connected: boolean;
    you: boolean;
    rating_delta: number;
  }[];
}
interface MatchState {
  match: {
    id: number;
    status: string;
    team_size: number;
    question_count: number;
    round_index: number;
    countdown_ends_at: string | null;
    round_deadline: string | null;
    winner_team: number | null;
    server_now: string;
  };
  teams: TeamSide[];
  current: {id: number; text: string; options: Record<string, string>} | null;
  you: {team: number; position: number; score: number; correct: number; streak: number; rating_before: number; rating_delta: number; xp: number; coins: number} | null;
}
interface Review {
  match: {status: string; winner_team: number | null; team_size: number; question_count: number};
  teams: {team: number; name: string; score: number; members: {name: string; score: number; correct: number; total: number; accuracy: number; streak: number; delta: number; xp: number; coins: number; you: boolean}[]}[];
  items: {question: string; your_answer: string; correct_answer: string; correct: boolean | null; unanswered: boolean; why: string; topic: string}[];
}

const SIZES = [1, 2, 3, 4, 5];

export default function RankedTeams({onSoloQueue}: {onSoloQueue?: () => void}) {
  const {toast, on} = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [screen, setScreen] = useState<'board' | 'create' | {lobby: true} | {match: number} | {review: number}>('board');
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [, setMatchId] = useState<number | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);

  const loadBoard = useCallback(() => {
    api
      .rankedDashboard()
      .then((payload) => {
        const d = payload as unknown as Dashboard;
        setData(d);
        setLobby(d.my_lobby);
        if (d.my_lobby?.status === 'launched' && d.my_lobby.code) {
          // launched lobbies point at their match; jump straight in
          if (d.active_match_id) setScreen({match: d.active_match_id});
        }
      })
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);


  const enterLobby = useCallback(() => {
    api
      .teamLobby()
      .then((res) => {
        const next = res.lobby as unknown as Lobby | null;
        setLobby(next);
        if (next) setScreen({lobby: true});
      })
      .catch(() => undefined);
  }, []);

  // Live lobby/match signalling: ws events nudge a poll; the 2.5s timer covers
  // dead zones (no double-fetch storms — one request at a time).
  useEffect(() => {
    const offLobby = on('team_lobby', (payload) => {
      const next = payload as unknown as Lobby;
      if (next && 'code' in next) setLobby(next);
      setScreen((current) => (current && typeof current === 'object' && 'match' in current ? current : {lobby: true}));
    });
    const offMatch = on('team_match', (payload) => {
      const id = Number((payload as {match_id?: number}).match_id ?? 0);
      if (id) {
        setMatchId(id);
        setScreen({match: id});
        sfx.play('whoosh');
      }
    });
    return () => {
      offLobby();
      offMatch();
    };
  }, [on]);

  useEffect(() => {
    if (!lobby || lobby.status === 'launched') return undefined;
    const timer = window.setInterval(() => {
      api.teamLobby().then((res) => setLobby(res.lobby as unknown as Lobby | null)).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [lobby?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const doLeave = async () => {
    try {
      await api.teamLobbyLeave();
      setLobby(null);
      setScreen('board');
      loadBoard();
    } catch (error) {
      toast('error', 'Could not leave', (error as Error).message);
    }
  };

  if (!data) return <Skeleton className="h-64 rounded-3xl" />;

  if (joinOpen) {
    return (
      <JoinScreen
        open
        onClose={() => {
          setJoinOpen(false);
          setScreen('board');
        }}
        onJoined={() => {
          setJoinOpen(false);
          enterLobby();
          loadBoard();
        }}
        openLobbies={data.open_lobbies}
        toast={toast}
      />
    );
  }

  if (lobby && (screen === 'board' || (typeof screen === 'object' && 'lobby' in screen))) {
    if (lobby.status === 'launched') {
      return (
        <MatchScreen
          preferId={data.active_match_id}
          onBack={() => {
            setLobby(null);
            setScreen('board');
            loadBoard();
          }}
        />
      );
    }
    return (
      <LobbyScreen
        lobby={lobby}
        setLobby={setLobby}
        onLeave={() => void doLeave()}
        toast={toast}
        backToBoard={() => {
          setScreen('board');
          loadBoard();
        }}
      />
    );
  }

  if (typeof screen === 'object' && 'match' in screen) {
    return (
      <MatchScreen
        preferId={screen.match > 0 ? screen.match : data.active_match_id}
        onBack={() => {
          setScreen('board');
          enterLobby();
          loadBoard();
        }}
      />
    );
  }

  if (typeof screen === 'object' && 'review' in screen) {
    return (
      <Card className="!p-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => { loadBoard(); setScreen('board'); }} icon={<ArrowLeft className="size-4" />}>
            Board
          </Button>
          <p className="min-w-0 flex-1 text-[0.95rem] font-black text-mist-50">Match #{screen.review} — full record</p>
        </div>
        <ReviewEmbed matchId={screen.review} />
      </Card>
    );
  }

  if (screen === 'create') {
    return (
      <CreateScreen
        courses={data.courses}
        onCancel={() => setScreen('board')}
        onCreated={() => {
          enterLobby();
          loadBoard();
        }}
        toast={toast}
      />
    );
  }

  /* -------------------------------------------------------------- board */
  return (
    <div className="grid gap-3 sm:gap-4">
      <Card className="relative overflow-hidden !p-4 sm:!p-5">
        <div className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-flare-500/12 blur-3xl" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="brand-gradient grid size-12 shrink-0 place-items-center rounded-2xl text-white">
            <TrendingUp className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[1.1rem] font-black text-mist-50">Ranked war room</p>
            <p className="text-[0.76rem] font-semibold text-mist-400">
              {data.tier?.label ? `${data.tier.label} · ` : ''}
              {data.rating} rating · solo queue and squads, one ladder.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="mint" onClick={onSoloQueue} icon={<Zap className="size-4" />}>
              Find solo match
            </Button>
            <Button size="sm" variant="outline" onClick={() => setScreen('create')} icon={<Users className="size-4" />}>
              Create lobby
            </Button>
            <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)} icon={<Search className="size-4" />}>
              Join lobby
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Rating" value={String(data.rating)} icon={<Award className="size-4" />} />
          <StatTile label="Win / loss" value={`${data.won}–${Math.max(0, data.played - data.won)}`} icon={<Trophy className="size-4" />} />
          <StatTile label="Accuracy" value={data.accuracy === null ? '—' : `${data.accuracy}%`} icon={<Target className="size-4" />} />
          <StatTile label="Team streak" value={data.win_streak > 0 ? `${data.win_streak}🔥` : String(data.win_streak)} icon={<Zap className="size-4" />} />
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <section>
          <SectionHeading icon={<Clock className="size-4" />} title="Recent ranked matches" />
          <Card className="!p-3">
            {data.recent.length === 0 ? (
              <p className="px-1 py-2 text-[0.8rem] font-semibold text-mist-500">No team matches yet — ready a squad and search, or run the solo queue.</p>
            ) : (
              <ul className="grid gap-1.5">
                {data.recent.slice(0, 6).map((row) => (
                  <li key={row.match_id}>
                    <button
                      type="button"
                      onClick={() => setScreen({review: row.match_id})}
                      className="flex w-full items-center gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2 text-left transition hover:border-white/20"
                    >
                      <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-[0.72rem] font-black ${row.won ? 'bg-emerald-500/20 text-emerald-300' : row.draw ? 'bg-white/10 text-mist-300' : 'bg-flare-500/15 text-flare-300'}`}>
                        {row.won ? 'W' : row.draw ? 'D' : 'L'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.82rem] font-extrabold text-mist-100">
                          {row.team_size}v{row.team_size} · {row.correct}/{row.total} correct
                        </span>
                        <span className="block text-[0.68rem] font-bold text-mist-500">{row.finished_at ? formatRelative(row.finished_at) : ''}</span>
                      </span>
                      <span className={`text-[0.78rem] font-black tabular ${row.delta >= 0 ? 'text-emerald-300' : 'text-flare-300'}`}>{row.delta >= 0 ? `+${row.delta}` : row.delta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section>
          <SectionHeading icon={<Users className="size-4" />} title="Friends in ranked lobbies" />
          <Card className="!p-3">
            {data.friends_in_lobbies.length === 0 ? (
              <p className="px-1 py-2 text-[0.8rem] font-semibold text-mist-500">Nobody you know is in a ranked lobby right now.</p>
            ) : (
              <ul className="grid gap-1.5">
                {data.friends_in_lobbies.map((row) => (
                  <li key={row.student_id} className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2">
                    <Avatar name={row.name} size={26} />
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-extrabold text-mist-100">{row.name}</span>
                    <Chip className="border-white/12 bg-white/6 text-mist-400">{row.team_size}v{row.team_size}</Chip>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void api.teamLobbyJoin(row.lobby_code).then(() => {
                          enterLobby();
                          loadBoard();
                        }).catch((error: Error) => toast('error', 'Could not join', error.message));
                      }}
                    >
                      Join {row.lobby_code}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="mt-3">
            <SectionHeading icon={<ShieldAlert className="size-4" />} title="Open lobbies" subtitle="Public rooms that still have space" />
            <Card className="!p-3">
              {data.open_lobbies.length === 0 ? (
                <p className="px-1 py-2 text-[0.8rem] font-semibold text-mist-500">Empty arena right now — start the first lobby and friends can drop in.</p>
              ) : (
                <ul className="grid gap-1.5">
                  {data.open_lobbies.slice(0, 5).map((row) => (
                    <li key={row.id} className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-nova-500/15 text-[0.7rem] font-black text-nova-200">{row.team_size}v{row.team_size}</span>
                      <span className="min-w-0 flex-1 truncate text-[0.8rem] font-extrabold text-mist-100">
                        {row.members.length}/{row.team_size} · {row.course_title}
                      </span>
                      <span className="font-mono text-[0.72rem] font-black tracking-widest text-mist-300">{row.code}</span>
                      <Button size="sm" variant="ghost" onClick={() => { void api.teamLobbyJoin(row.code).then(() => { enterLobby(); loadBoard(); }).catch((error: Error) => toast('error', 'Could not join', error.message)); }}>
                        Join
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </section>
      </div>

      <section>
        <SectionHeading icon={<Award className="size-4" />} title="Ranked pools" subtitle="Courses the engine can draw squad matches from — solo queue uses the same pools" />
        <div className="flex flex-wrap gap-1.5">
          {data.courses.filter((course) => course.playable).slice(0, 10).map((course) => (
            <Chip key={course.id} className="border-white/12 bg-white/6 text-mist-300">
              {course.code} · {course.pool} q
            </Chip>
          ))}
          {data.courses.filter((course) => course.playable).length === 0 && (
            <p className="text-[0.8rem] font-semibold text-mist-500">No course has a deep enough bank yet — the Any-course ladder always works.</p>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- create */
function CreateScreen({
  courses,
  onCancel,
  onCreated,
  toast,
}: {
  courses: {id: number; title: string; code: string; pool: number; playable: boolean}[];
  onCancel: () => void;
  onCreated: () => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [size, setSize] = useState(1);
  const [courseId, setCourseId] = useState<number | 0>(0);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.teamLobbyCreate({team_size: size, course_id: courseId || null});
      toast('success', `Lobby open · ${size}v${size}`, 'Share the code or invite friends — ready up when the squad is in.');
      onCreated();
    } catch (error) {
      toast('error', 'Could not open the lobby', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="!p-5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} icon={<ArrowLeft className="size-4" />}>Back</Button>
          <p className="min-w-0 flex-1 text-[1rem] font-black text-mist-50">Create a ranked lobby</p>
        </div>
        <p className="mt-1 text-[0.78rem] font-semibold text-mist-400">Pick a team size — every player on your side answers their own dealt set.</p>
        <div className="mt-4 grid grid-cols-5 gap-1.5">
          {SIZES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSize(value)}
              className={
                size === value
                  ? 'rounded-xl border border-nova-400/70 bg-nova-500/18 py-2 text-[0.8rem] font-black text-nova-100'
                  : 'rounded-xl border border-white/10 bg-white/5 py-2 text-[0.8rem] font-black text-mist-400 hover:border-white/25'
              }
            >
              {value}v{value}
            </button>
          ))}
        </div>
        <Field label="Course pool" className="mt-4">
          <Select value={courseId} onChange={(event) => setCourseId(Number(event.target.value))}>
            <option value={0}>Any course (mixed ladder pool)</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id} disabled={!course.playable}>
                {course.code} — {course.title} ({course.pool} q{course.playable ? '' : ' · too thin'})
              </option>
            ))}
          </Select>
        </Field>
        <Button block className="mt-4" variant="mint" loading={busy} onClick={() => void create()} icon={<Swords className="size-4" />}>
          Open lobby
        </Button>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- join */
function JoinScreen({
  open,
  onClose,
  onJoined,
  openLobbies,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: () => void;
  openLobbies: Lobby[];
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api.teamLobbyJoin(value.trim().toUpperCase());
      toast('success', 'Lobby joined', 'Ready up when you are in.');
      onJoined();
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Join a ranked lobby" subtitle="Type a friend's code or grab an open public room." size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void join(code)} icon={<Users className="size-4" />}>Join by code</Button>
        </>
      }
    >
      <TextInput value={code} placeholder="e.g. K7T9QM" maxLength={10} className="uppercase tracking-[0.3em] text-center font-black" onChange={(event) => setCode(event.target.value)} />
      {openLobbies.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[0.68rem] font-black tracking-wide text-mist-500 uppercase">Open rooms</p>
          <ul className="grid gap-1.5">
            {openLobbies.slice(0, 6).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => void join(row.code)}
                  className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-left hover:border-nova-400/40"
                >
                  <span className="text-[0.8rem] font-black text-mist-100">{row.team_size}v{row.team_size}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.74rem] font-bold text-mist-400">{row.members.map((m) => m.name.split(' ')[0]).join(', ')}</span>
                  <span className="font-mono text-[0.7rem] font-black text-nova-200">{row.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- lobby */
function LobbyScreen({
  lobby,
  setLobby,
  onLeave,
  backToBoard,
  toast,
}: {
  lobby: Lobby;
  setLobby: (value: Lobby | null) => void;
  onLeave: () => void;
  backToBoard: () => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = (fn: () => Promise<{lobby?: unknown} | unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
      const res = await api.teamLobby();
      setLobby(res.lobby as unknown as Lobby | null);
    } catch (error) {
      toast('error', 'That did not go through', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-xl gap-3">
      <Card className="!p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="sm" variant="ghost" onClick={backToBoard} icon={<ArrowLeft className="size-4" />}>Leave</Button>
          <p className="min-w-0 flex-1 text-[1rem] font-black text-mist-50">{lobby.team_size}v{lobby.team_size} lobby</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(lobby.code);
              toast('info', 'Code copied', lobby.code);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/6 px-2.5 py-1.5 text-[0.82rem] font-black tracking-[0.22em] text-nova-100"
          >
            {lobby.code} <Copy className="size-3.5 text-mist-400" />
          </button>
        </div>
        <p className="mt-1 text-[0.74rem] font-bold text-mist-400">
          {lobby.course_title} · status <span className="font-black text-mist-200">{lobby.status}</span> · everyone must ready up, then the host searches.
        </p>
        {lobby.error && <p className="mt-2 rounded-xl bg-flare-500/12 px-2.5 py-1.5 text-[0.76rem] font-black text-flare-200">{lobby.error}</p>}

        {/* YOUR TEAM */}
        <p className="mt-3 text-[0.68rem] font-black tracking-[0.18em] text-mist-500 uppercase">Your team</p>
        <ul className="mt-1.5 grid gap-1.5">
          {lobby.members.map((member) => (
            <li key={member.student_id} className="flex items-center gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2">
              <span className="relative">
                <Avatar name={member.name} size={30} />
                <span className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-[#0b1016] ${member.connection === 'online' ? 'bg-emerald-400' : 'bg-mist-600'}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.84rem] font-extrabold text-mist-50">
                  {member.name}
                  {member.is_host && <Crown className="ml-1 inline size-3.5 text-gold-300" />}
                </span>
                <span className="block text-[0.66rem] font-black text-mist-500">{member.rating} rating · {member.connection}</span>
              </span>
              {member.ready ? (
                <Chip className="border-emerald-400/35 bg-emerald-500/12 text-emerald-300"><CheckCircle2 className="size-3" /> ready</Chip>
              ) : (
                <Chip className="border-white/12 bg-white/6 text-mist-400">waiting</Chip>
              )}
              {lobby.viewer_is_host && !member.is_host && (
                <Button size="sm" variant="ghost" disabled={busy || lobby.status === 'matching'} onClick={() => void patch(() => api.teamLobbyKick(member.student_id))()} icon={<XCircle className="size-3.5 text-flare-300" />}>
                  <span className="sr-only">Remove</span>
                </Button>
              )}
            </li>
          ))}
          {Array.from({length: Math.max(0, lobby.team_size - lobby.members.length)}).map((_, index) => (
            <li key={`slot-${index}`} className="flex items-center gap-2.5 rounded-2xl border border-dashed border-white/10 px-3 py-2 text-[0.78rem] font-bold text-mist-600">
              <span className="grid size-[30px] place-items-center rounded-full bg-white/5">?</span> open slot
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="mint" loading={busy} onClick={() => void patch(() => api.teamLobbyReady(true))()}>
            Ready up
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void patch(() => api.teamLobbyReady(false))()}>Un-ready</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setInviteOpen(true)} icon={<UserPlus className="size-4" />}>Invite friends</Button>
          {lobby.viewer_is_host && (
            lobby.status === 'matching' ? (
              <Button size="sm" variant="outline" loading={busy} onClick={() => void patch(() => api.teamLobbyCancelSearch())()} icon={<XCircle className="size-4" />}>Stop search</Button>
            ) : (
              <Button size="sm" variant="mint" loading={busy} onClick={() => void patch(() => api.teamLobbyFind())()} icon={<Search className="size-4" />}>
                Find opponents
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" onClick={onLeave} icon={<LogOut className="size-4" />}>Leave lobby</Button>
        </div>
        {lobby.status === 'matching' && (
          <div className="mt-2 rounded-xl border border-nova-400/25 bg-nova-500/8 px-3 py-2">
            <p className="flex items-center gap-2 text-[0.8rem] font-black text-nova-100">
              <span className="inline-block size-2 animate-pulse rounded-full bg-nova-300" /> Searching for a {lobby.team_size}v{lobby.team_size} squad — same size, same pool, ratings inside ±250.
            </p>
            <ProgressBar value={40} animated barClassName="bg-nova-500/70" />
          </div>
        )}
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} lobby={lobby} toast={toast} />
      <p className="text-center text-[0.68rem] font-bold text-mist-600">
        The server pairs full, ready squads of equal size — nobody gets dropped into a match mid-invite.
      </p>
    </div>
  );
}

function InviteModal({open, onClose, lobby, toast}: {open: boolean; onClose: () => void; lobby: Lobby; toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<{friends: {id: number; name: string}[]} | null>(null);
  useEffect(() => {
    if (!open) return;
    api.friends().then((data) => setRows({friends: data.friends.map((friend) => ({id: friend.id, name: friend.name}))})).catch(() => setRows({friends: []}));
  }, [open]);

  const filtered = (rows?.friends ?? []).filter((friend) => !query || friend.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <Modal open={open} onClose={onClose} title="Invite a friend" subtitle={`They land straight in ${lobby.code} — only friends can be pulled in.`} size="md">
      <TextInput placeholder="Search your friends…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul className="mt-3 grid max-h-64 gap-1.5 overflow-y-auto">
        {filtered.length === 0 && <li className="px-1 py-3 text-center text-[0.8rem] font-semibold text-mist-500">{rows ? 'No friend matches that name — friends can also join with the code.' : 'Loading…'}</li>}
        {filtered.map((friend) => (
          <li key={friend.id} className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <Avatar name={friend.name} size={26} />
            <span className="min-w-0 flex-1 truncate text-[0.82rem] font-extrabold text-mist-100">{friend.name}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void api
                  .teamLobbyInvite(friend.id)
                  .then(() => toast('success', `Invite sent to ${friend.name}`, 'They get a bell ping with the code.'))
                  .catch((error: Error) => toast('error', 'Invite blocked', error.message))
              }
              icon={<Send className="size-3.5" />}
            >
              Invite
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---------------------------------------------------------------- match */
function MatchScreen({preferId, onBack}: {preferId: number | null; onBack: () => void}) {
  const {on, toast} = useSession();
  const [matchId, setMatchId] = useState<number | null>(preferId);
  const [state, setState] = useState<MatchState | null>(null);
  const [feedback, setFeedback] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const tick = useRef(0);

  useEffect(() => {
    if (preferId && preferId !== matchId) setMatchId(preferId);
  }, [preferId, matchId]);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      const data = (await api.teamMatch(matchId)) as unknown as MatchState;
      setState(data);
      if (data.match.status === 'finished') {
        sfx.play(data.you && data.teams[0]?.members.some((m) => m.you && m.rating_delta > 0) ? 'win' : 'whoosh');
      }
    } catch (error) {
      toast('error', 'Match unreachable', (error as Error).message);
    }
  }, [matchId, toast]);

  useEffect(() => {
    void refresh();
    tick.current = window.setInterval(() => void refresh(), 1200) as unknown as number;
    return () => window.clearInterval(tick.current);
  }, [refresh]);

  useEffect(() => {
    const offs = ['team_round', 'team_reveal', 'team_match_result'].map((event) => on(event, () => void refresh()));
    return () => offs.forEach((off) => off());
  }, [on, refresh]);

  const answer = async (label: string) => {
    if (!state?.current || !matchId || busy) return;
    setBusy(true);
    try {
      const data = (await api.teamMatchAnswer(matchId, {question_id: state.current.id, selected: label, elapsed_ms: 0})) as unknown as {result: Json};
      sfx.play((data.result as {correct?: boolean}).correct ? 'correct' : 'wrong');
      setFeedback(data.result as unknown as Json);
      void refresh();
    } catch (error) {
      toast('error', 'Answer rejected', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!matchId) {
    return (
      <Card className="!p-5 text-center">
        <p className="text-[0.86rem] font-bold text-mist-300">No live team match.</p>
        <Button size="sm" className="mt-3" variant="outline" onClick={onBack}>Back to the board</Button>
      </Card>
    );
  }
  if (!state) return <Skeleton className="h-64 rounded-3xl" />;

  const finished = state.match.status === 'finished';
  const countdownLeft = state.match.countdown_ends_at ? Math.max(0, (new Date(state.match.countdown_ends_at).getTime() - Date.now()) / 1000) : 0;
  const roundLeft = state.match.round_deadline ? Math.max(0, (new Date(state.match.round_deadline).getTime() - Date.now()) / 1000) : 0;
  const [sideA, sideB] = state.teams;
  const won = finished && state.match.winner_team !== null && state.you !== null && state.match.winner_team === state.you.team;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-3">
      {/* scoreboard header */}
      <Card className="!p-3.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <TeamScore side={sideA} align="left" winner={finished ? state.match.winner_team === 0 : null} />
          <div className="text-center">
            <p className="text-[0.62rem] font-black tracking-[0.2em] text-mist-500 uppercase">
              {finished ? 'Final' : state.match.status === 'starting' ? 'Starts in' : `Round ${Math.max(0, state.match.round_index) + 1}/${state.match.question_count}`}
            </p>
            <p className="text-[1.15rem] font-black tabular text-mist-50">
              {finished ? '—' : state.match.status === 'starting' ? `${Math.ceil(countdownLeft)}s` : `${Math.ceil(roundLeft)}s`}
            </p>
            {!finished && state.match.status === 'live' && <ProgressBar value={(roundLeft / 20) * 100} barClassName="bg-flare-500" />}
          </div>
          <TeamScore side={sideB} align="right" winner={finished ? state.match.winner_team === 1 : null} />
        </div>
      </Card>

      {finished ? (
        <Card className="!p-5 text-center">
          <span className={`mx-auto grid size-12 place-items-center rounded-2xl ${won ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/8 text-mist-300'}`}>
            <Trophy className="size-6" />
          </span>
          <p className="mt-2 text-[1.05rem] font-black text-mist-50">{won ? 'Squad victory' : state.match.winner_team === null ? 'Dead even — a draw' : 'Squad defeat'}</p>
          <p className="mt-1 text-[0.8rem] font-bold text-mist-400">
            {state.you ? `${state.you.correct} correct · ${state.you.score} pts · ${state.you.rating_delta >= 0 ? '+' : ''}${state.you.rating_delta} rating · +${state.you.xp} XP · +${state.you.coins} 🪙` : ''}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" variant="mint" onClick={() => { setMatchId(null); onBack(); }}>Back to ranked</Button>
          </div>
          <ReviewEmbed matchId={matchId} />
        </Card>
      ) : state.match.status === 'starting' ? (
        <Card className="!p-6 text-center">
          <p className="text-[0.92rem] font-black text-mist-50">The clock is set — {state.match.question_count} questions each, {Math.ceil(countdownLeft)}s to lock in.</p>
          <p className="mt-1 text-[0.78rem] font-semibold text-mist-400">Every player gets a private question set from the pool; teams share only the scoreboard.</p>
        </Card>
      ) : state.current ? (
        <Card className="!p-4 sm:!p-5">
          <div className="flex items-center gap-2 text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">
            <Swords className="size-3.5" /> round {Math.max(0, state.match.round_index) + 1} · your question {Math.max(0, state.match.round_index) + 1} of {state.match.question_count}
          </div>
          <p className="mt-2 text-[0.96rem] leading-snug font-bold text-mist-50">{state.current.text}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(state.current.options).map(([label, text]) => (
              <button
                key={label}
                type="button"
                disabled={busy || Boolean(feedback)}
                onClick={() => void answer(label)}
                className="flex items-start gap-2.5 rounded-2xl border border-white/12 bg-white/5 px-3 py-2.5 text-left transition hover:border-flare-400/50 hover:bg-flare-500/10 disabled:opacity-60"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/6 text-[0.72rem] font-black text-flare-200">{label}</span>
                <span className="min-w-0 flex-1 text-[0.85rem] leading-snug font-bold text-mist-100">{text}</span>
              </button>
            ))}
          </div>
          {feedback && (
            <div className={`mt-3 rounded-2xl border p-3 ${(feedback as {correct?: boolean}).correct ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-flare-500/40 bg-flare-500/10'}`}>
              <div className="flex items-center gap-2">
                {(feedback as {correct?: boolean}).correct ? <CheckCircle2 className="size-5 text-emerald-300" /> : <XCircle className="size-5 text-flare-300" />}
                <p className="text-[0.88rem] font-black text-mist-50">
                  {(feedback as {correct?: boolean}).correct ? `Correct · +${(feedback as {points?: number}).points} pts` : `Key: ${(feedback as {correct_answer?: string}).correct_answer}`}
                </p>
              </div>
              {(feedback as {explanation?: string}).explanation && (
                <p className="mt-1.5 text-[0.79rem] leading-relaxed font-semibold text-mist-300">{(feedback as {explanation?: string}).explanation}</p>
              )}
              <p className="mt-1 text-[0.68rem] font-black text-mist-500 uppercase">streak {(feedback as {streak?: number}).streak ?? 0} · next round when the squad finishes or the clock hits zero</p>
            </div>
          )}
        </Card>
      ) : (
        <Card className="!p-5 text-center text-[0.86rem] font-bold text-mist-300">
          {state.you && state.you.position >= state.match.question_count ? 'Your paper is in — waiting for the squad clock.' : 'Waiting for the next round…'}
        </Card>
      )}
    </div>
  );
}

function TeamScore({side, align, winner}: {side: TeamSide | undefined; align: 'left' | 'right'; winner: boolean | null}) {
  if (!side) return <span />;
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <p className={`truncate text-[0.78rem] font-black ${winner === true ? 'text-emerald-300' : winner === false ? 'text-mist-500' : 'text-mist-100'}`}>{side.name}</p>
      <p className="text-[1.35rem] leading-none font-black tabular text-mist-50">{side.score}</p>
      <p className="mt-0.5 truncate text-[0.64rem] font-bold text-mist-500">
        {side.members.map((member) => `${member.name.split(' ')[0]} ${member.score}`).join(' · ')}
      </p>
    </div>
  );
}

function ReviewEmbed({matchId}: {matchId: number}) {
  const [review, setReview] = useState<Review | null>(null);
  useEffect(() => {
    api.teamMatchReview(matchId).then((data) => setReview(data as unknown as Review)).catch(() => setReview(null));
  }, [matchId]);
  if (!review) return <Skeleton className="mt-4 h-24 rounded-2xl" />;
  return (
    <div className="mt-4 text-left">
      <SectionHeading title="Team results" subtitle="Individuals stay visible — one teammate never carries the scoreboard." />
      <ul className="grid gap-1.5">
        {review.teams.map((team) => (
          <li key={team.team}>
            <p className="mb-1 text-[0.72rem] font-black tracking-wide text-mist-400 uppercase">{team.name} — {team.score}</p>
            <ul className="grid gap-1">
              {team.members.map((member) => (
                <li key={member.name + member.coins} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[0.78rem] font-bold ${member.you ? 'bg-nova-500/12 text-mist-50' : 'bg-white/4 text-mist-300'}`}>
                  <Avatar name={member.name} size={20} />
                  <span className="min-w-0 flex-1 truncate">{member.name}{member.you ? ' (you)' : ''}</span>
                  <span className="tabular">{member.correct}/{member.total} · {member.accuracy}%</span>
                  <span className={`tabular font-black ${member.delta >= 0 ? 'text-emerald-300' : 'text-flare-300'}`}>{member.delta >= 0 ? `+${member.delta}` : member.delta}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {review.items.length > 0 && (
        <>
          <p className="mt-3 mb-1.5 text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">Your paper</p>
          <ul className="grid max-h-64 gap-1.5 overflow-y-auto pr-0.5">
            {review.items.map((row) => (
              <li key={row.question} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
                <p className="line-clamp-2 text-[0.78rem] font-bold text-mist-200">{row.question}</p>
                <p className="mt-0.5 text-[0.68rem] font-black">
                  {row.unanswered ? <span className="text-mist-500">skipped</span> : row.correct ? <span className="text-emerald-300">right ✓</span> : <span className="text-flare-300">you {row.your_answer} → key {row.correct_answer}</span>}
                  {row.topic ? ` · ${row.topic}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
