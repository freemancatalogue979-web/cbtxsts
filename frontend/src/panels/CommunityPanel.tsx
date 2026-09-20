/**
 * Tournaments and study groups — the competitive and collaborative layers.
 * Both read shared arena state, so a group quiz, a duel or an exam all move
 * the same leaderboards.
 */
import {Crown, Flag, Plus, Swords, Trophy, Users, Zap} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Modal, ProgressBar, SectionHeading, Skeleton, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';

type Tournament = {
  id: number;
  name: string;
  scope: string;
  kind: string;
  status: string;
  size: number;
  entries: number;
  prize_xp: number;
  prize_coins: number;
  cycle_key: string;
  joined: boolean;
};

type Group = {
  id: number;
  code: string;
  name: string;
  description: string;
  members: number;
  is_member: boolean;
  is_owner: boolean;
  goal: string;
};

/* ---------------------------------------------------------------- tournaments */
export function TournamentsPanel() {
  const {toast} = useSession();
  const [rows, setRows] = useState<Tournament[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Record<string, unknown> | null>(null);

  const load = () => {
    api.arena
      .tournaments()
      .then((payload) => setRows((payload as {tournaments: Tournament[]}).tournaments))
      .catch((error: Error) => toast('error', 'Tournaments unavailable', error.message));
  };

  useEffect(() => {
    load();
    api.arena.myTournaments().then(setHistory).catch(() => setHistory(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async (row: Tournament) => {
    try {
      await api.arena.joinTournament(row.id);
      toast('success', 'You are in', row.name);
      load();
      if (openId === row.id) openTournament(row.id);
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
    }
  };

  const openTournament = (id: number) => {
    setOpenId(id);
    setDetail(null);
    api.arena.tournament(id).then(setDetail).catch((error: Error) => toast('error', 'Bracket unavailable', error.message));
  };

  const standings = (detail?.standings as {student_id: number; name: string; wins: number; losses: number; score: number; is_you: boolean; eliminated: boolean}[] | undefined) ?? [];
  const matches = (detail?.matches as {id: number; round: number; a: {id: number | null; name: string}; b: {id: number | null; name: string}; winner_id: number | null; status: string}[] | undefined) ?? [];

  return (
    <div className="grid gap-4">
      <SectionHeading
        title="Tournaments"
        subtitle="Weekly cups, campus clash and course brackets — badges and prizes for the podium."
        icon={<Trophy className="size-4" />}
      />

      {!rows && <div className="grid gap-2 sm:grid-cols-2"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>}

      <ul className="grid gap-3 sm:grid-cols-2">
        {(rows ?? []).map((row) => (
          <li key={row.id}>
            <Card className="flex h-full flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[0.9rem] leading-snug font-extrabold break-words text-mist-50">{row.name}</h3>
                  <p className="mt-0.5 text-[0.72rem] font-semibold text-mist-500">
                    {row.kind === 'bracket' ? 'Knockout bracket' : 'Points ladder'} · {row.entries}/{row.size} in
                  </p>
                </div>
                <Chip className={row.status === 'open' ? 'border-mint-500/30 bg-mint-500/12 text-mint-200' : 'border-white/12 bg-white/6 text-mist-400'}>
                  {row.status}
                </Chip>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">+{row.prize_xp} XP</Chip>
                <Chip className="border-gold-500/25 bg-gold-500/10 text-gold-200">+{row.prize_coins}</Chip>
                <Chip className="border-white/12 bg-white/6 text-mist-400">{row.cycle_key}</Chip>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" disabled={row.joined} onClick={() => void join(row)}>
                  {row.joined ? 'Joined' : 'Join'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openTournament(row.id)}>
                  View bracket
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {history && Boolean((history.history as unknown[])?.length) && (
        <Card className="p-4">
          <SectionHeading title="Your tournament history" subtitle="Every bracket you have entered" icon={<Flag className="size-4" />} />
          <ul className="mt-3 grid gap-1.5">
            {((history.history as {tournament: {name: string; scope: string}; wins: number; losses: number; round_reached: number; champion: boolean}[]) ?? []).map((row, index) => (
              <li key={`${row.tournament.name}-${index}`} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                {row.champion && <Crown className="size-4 shrink-0 text-gold-300" />}
                <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-200">{row.tournament.name}</span>
                <span className="text-[0.72rem] font-semibold text-mint-300">{row.wins}W</span>
                <span className="text-[0.72rem] font-semibold text-rose-300">{row.losses}L</span>
                <span className="text-[0.72rem] font-black text-mist-400">R{row.round_reached}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Bracket" subtitle="Live standings and matches" size="lg">
        {!detail && <Skeleton className="h-40 w-full" />}
        {detail && (
          <div className="grid gap-4">
            <div>
 <h4 className="text-[0.8rem] font-black tracking-wide text-mist-400">Standings</h4>
              <ul className="mt-2 grid gap-1.5">
                {standings.map((row, position) => (
                  <li key={row.student_id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${row.is_you ? 'border-nova-400/40 bg-nova-500/10' : 'border-white/8 bg-ink-900/50'}`}>
                    <span className="w-6 text-[0.76rem] font-black text-mist-500">#{position + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.name}</span>
                    <span className="text-[0.72rem] font-semibold text-mint-300">{row.wins}W</span>
                    <span className="text-[0.72rem] font-semibold text-rose-300">{row.losses}L</span>
                    <span className="text-[0.72rem] font-black text-gold-300">{row.score}</span>
                  </li>
                ))}
                {!standings.length && <li className="text-[0.78rem] font-medium text-mist-500">No one has joined yet — be first.</li>}
              </ul>
            </div>
            {matches.length > 0 && (
              <div>
 <h4 className="text-[0.8rem] font-black tracking-wide text-mist-400">Matches</h4>
                <ul className="mt-2 grid gap-1.5">
                  {matches.map((match) => (
                    <li key={match.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                      <Chip className="border-white/12 bg-white/6 text-mist-400">R{match.round}</Chip>
                      <span className={`min-w-0 flex-1 truncate text-[0.8rem] font-bold ${match.winner_id === match.a.id ? 'text-mint-300' : 'text-mist-200'}`}>{match.a.name}</span>
                      <Swords className="size-3.5 shrink-0 text-mist-600" />
                      <span className={`min-w-0 flex-1 truncate text-right text-[0.8rem] font-bold ${match.winner_id === match.b.id ? 'text-mint-300' : 'text-mist-200'}`}>{match.b.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------------- groups */
export function GroupsPanel() {
  const {toast} = useSession();
  const [data, setData] = useState<{mine: Group[]; discover: Group[]} | null>(null);
  const [code, setCode] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState('');

  const load = () => {
    api.arena
      .groups()
      .then((payload) => setData(payload as unknown as {mine: Group[]; discover: Group[]}))
      .catch((error: Error) => toast('error', 'Study groups unavailable', error.message));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: number) => {
    setOpenId(id);
    setDetail(null);
    api.arena.group(id).then(setDetail).catch((error: Error) => toast('error', 'Group unavailable', error.message));
  };

  const joinByCode = async () => {
    if (code.trim().length < 4) return;
    try {
      await api.arena.joinGroup(code);
      setCode('');
      toast('success', 'Joined group', 'Welcome to the study room.');
      load();
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
    }
  };

  const create = async () => {
    try {
      await api.arena.createGroup({name: name.trim(), goal: goal.trim()});
      setCreateOpen(false);
      setName('');
      setGoal('');
      toast('success', 'Group created', 'Share the code with your classmates.');
      load();
    } catch (error) {
      toast('error', 'Could not create group', (error as Error).message);
    }
  };

  const send = async () => {
    if (!openId || draft.trim().length === 0) return;
    try {
      await api.arena.sendGroupMessage(openId, draft.trim());
      setDraft('');
      api.arena.group(openId).then(setDetail).catch(() => undefined);
    } catch (error) {
      toast('error', 'Message not sent', (error as Error).message);
    }
  };

  const startGroupQuiz = async () => {
    if (!openId) return;
    try {
      await api.arena.groupQuiz(openId, 10);
      toast('success', 'Group quiz started', 'Everyone can see the room question now.');
      api.arena.group(openId).then(setDetail).catch(() => undefined);
    } catch (error) {
      toast('error', 'Could not start quiz', (error as Error).message);
    }
  };

  return (
    <div className="grid gap-4">
      <SectionHeading title="Study groups" subtitle="Study together: shared quizzes, challenges and a group ladder." icon={<Users className="size-4" />} />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-40 flex-1 gap-1.5">
            <span className="text-[0.74rem] font-bold text-mist-400">Join with a code</span>
            <TextInput value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. K7TQ2M" maxLength={8} />
          </label>
          <Button variant="primary" onClick={() => void joinByCode()} disabled={code.trim().length < 4}>Join</Button>
          <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>New group</Button>
        </div>
      </Card>

      {!data && <Skeleton className="h-32 w-full" />}

      {data && (
        <>
          <div className="grid gap-3">
 <h3 className="text-[0.86rem] font-black tracking-wide text-mist-400">Your groups</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.mine.map((group) => (
                <li key={group.id}>
                  <Card className="flex h-full flex-col p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <h4 className="text-[0.88rem] font-extrabold text-mist-50">{group.name}</h4>
                        <p className="mt-0.5 line-clamp-2 text-[0.74rem] font-medium text-mist-500">{group.goal || group.description || 'No goal set'}</p>
                      </div>
                      <Chip className="ml-auto border-white/12 bg-white/6 text-mist-300">{group.members} members</Chip>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="primary" size="sm" onClick={() => open(group.id)}>Open</Button>
                      <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">{group.code}</Chip>
                    </div>
                  </Card>
                </li>
              ))}
              {!data.mine.length && (
                <li className="sm:col-span-2">
                  <EmptyState icon={<Users className="size-5" />} title="No groups yet" detail="Create one for your class, or join with a code a friend shared." />
                </li>
              )}
            </ul>
          </div>

          {Boolean(data.discover.length) && (
            <div className="grid gap-3">
 <h3 className="text-[0.86rem] font-black tracking-wide text-mist-400">Discover</h3>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.discover.map((group) => (
                  <li key={group.id}>
                    <Card className="flex h-full flex-col p-3.5">
                      <h4 className="text-[0.84rem] font-extrabold text-mist-100">{group.name}</h4>
                      <p className="mt-0.5 line-clamp-2 text-[0.72rem] font-medium text-mist-500">{group.description || group.goal || 'Open study group'}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Chip className="border-white/12 bg-white/6 text-mist-400">{group.members} members</Chip>
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void api.arena.joinGroup(group.code).then(load)}>
                          Join
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Study room" subtitle="Group ladder, live quiz and chat" size="lg">
        {!detail && <Skeleton className="h-48 w-full" />}
        {detail && (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" icon={<Zap className="size-4" />} onClick={() => void startGroupQuiz()}>Start group quiz</Button>
              <Button variant="ghost" size="sm" onClick={() => void api.arena.groupChallenge(Number(openId)).then(() => toast('success', 'Challenge sent', 'The group has been called out.'))}>
                Duel night
              </Button>
            </div>

            <div>
 <h4 className="text-[0.78rem] font-black tracking-wide text-mist-400">This week</h4>
              <ul className="mt-2 grid gap-1.5">
                {((detail.leaderboard as {id: number; name: string; xp: number}[]) ?? []).slice(0, 8).map((row, position) => (
                  <li key={row.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                    <span className="w-6 shrink-0 text-[0.76rem] font-black text-mist-500">#{position + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.name}</span>
                    <span className="shrink-0 text-[0.74rem] font-black tabular text-nova-300">{formatNumber(row.xp)} XP</span>
                  </li>
                ))}
              </ul>
              <ProgressBar value={Math.min(100, ((detail.leaderboard as unknown[])?.length ?? 0) * 12)} className="mt-3" />
            </div>

            <div>
 <h4 className="text-[0.78rem] font-black tracking-wide text-mist-400">Room chat</h4>
              <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                {((detail.messages as {id: number; name: string; body: string; kind: string}[]) ?? []).map((message) => (
                  <li key={message.id} className="rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
                    <p className="text-[0.7rem] font-bold text-mist-500">{message.name}</p>
                    <p className="text-[0.8rem] font-medium break-words text-mist-200">{message.body}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <TextInput value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message the group…" onKeyDown={(event) => { if (event.key === 'Enter') void send(); }} />
                <Button variant="primary" onClick={() => void send()}>Send</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a study group"
        subtitle="You will get a code to share."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void create()} disabled={name.trim().length < 2}>Create</Button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-[0.76rem] font-bold text-mist-400">Group name</span>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. 400L Evidence Study Circle" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.76rem] font-bold text-mist-400">Goal</span>
            <TextInput value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. 500 questions before mocks" />
          </label>
        </div>
      </Modal>
    </div>
  );
}
