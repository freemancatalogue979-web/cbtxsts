/**
 * Mystery — learn by detective work.
 *
 * Cases are built from the arena's own course questions and Materials: study
 * the clues (unlocking costs coins when pricey), answer the dealt questions on
 * the server's honor, and every correct deduction unlocks the next paragraph
 * of the solution. Solve enough and the case — and the topic — is yours.
 */
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Coins,
  Lightbulb,
  Lock,
  PackageOpen,
  RotateCcw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, ProgressBar, SectionHeading, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';

type Json = Record<string, unknown>;

interface Clue {
  id: number;
  position: number;
  text: string;
  cost_coins: number;
  material_id: number | null;
  opened: boolean;
}
interface CaseRow {
  id: number;
  title: string;
  blurb: string;
  brief: string;
  difficulty: string;
  topic: string;
  cover: string;
  question_count: number;
  pass_count: number;
  reward_xp: number;
  reward_coins: number;
  clues: Clue[];
  pool_ready: number;
  my: {status: string; position: number; total: number; score: number; answers: Record<string, {correct: boolean}>; opened_clues: number[]; attempts: number} | null;
}
interface Detail {
  case: CaseRow;
  question: {id: number; text: string; options: Record<string, string>} | null;
}

const COVERS: Record<string, string> = {
  magnifier: '🔍',
  case: '🗂️',
  moon: '🌒',
  key: '🗝️',
  map: '🗺️',
  ghost: '👻',
};

export default function MysteryPanel() {
  const {toast} = useSession();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [progress, setProgress] = useState({solved: 0, total: 0});
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Json | null>(null);

  const loadList = useCallback(() => {
    api
      .mysteryList()
      .then((data) => {
        const payload = data as unknown as {cases: CaseRow[]; solved: number; total: number};
        setCases(payload.cases);
        setProgress({solved: payload.solved, total: payload.total});
      })
      .catch(() => setCases([]));
  }, []);

  useEffect(loadList, [loadList]);

  const openCase = (id: number) => {
    setOpenId(id);
    setFeedback(null);
    api
      .mysteryCase(id)
      .then((data) => setDetail(data as unknown as Detail))
      .catch(() => setDetail(null));
  };

  const begin = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.mysteryBegin(detail.case.id);
      const data = await api.mysteryCase(detail.case.id);
      setDetail(data as unknown as Detail);
      loadList();
    } catch (error) {
      toast('error', 'The case file stayed shut', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unlockClue = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.mysteryClue(detail.case.id);
      const data = await api.mysteryCase(detail.case.id);
      setDetail(data as unknown as Detail);
      sfx.play('whoosh');
    } catch (error) {
      toast('error', 'Clue stays locked', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (label: string) => {
    if (!detail?.question || busy) return;
    setBusy(true);
    try {
      const result = (await api.mysteryAnswer(detail.case.id, {selected: label})) as unknown as {
        correct: boolean;
        correct_answer: string;
        explanation: string;
        story_unlocked?: string[];
        solved?: string;
        next?: Detail['question'];
        solve?: {position: number; total: number; score: number; status: string};
      };
      sfx.play(result.correct ? 'correct' : 'wrong');
      setFeedback(result as unknown as Json);
      setDetail({...detail, question: result.next ?? null});
      if (result.solved && result.solved !== 'active') {
        toast(
          result.solved === 'solved' ? 'success' : 'info',
          result.solved === 'solved' ? 'Mystery solved 🎉' : 'Case went cold… for now',
          result.solved === 'solved'
            ? `+${detail.case.reward_xp} XP · +${detail.case.reward_coins} coins`
            : `You need ${detail.case.pass_count}/${detail.case.question_count} deductions. Retry from the case file.`,
        );
        loadList();
      }
    } catch (error) {
      toast('error', 'That deduction did not land', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (cases === null) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-20 rounded-3xl" />
        <Skeleton className="h-36 rounded-3xl" />
      </div>
    );
  }

  /* ---------------------------------------------------------- case detail */
  if (openId !== null && detail) {
    const row = detail.case;
    const solved = row.my?.status === 'solved';
    const nextClue = row.clues.find((clue) => !clue.opened);
    const answeredCount = row.my ? Object.keys(row.my.answers || {}).length : 0;
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-3">
        <Card className="!p-3.5">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => { setOpenId(null); setDetail(null); loadList(); }} icon={<ArrowLeft className="size-4" />}>
              Cases
            </Button>
            <p className="min-w-0 flex-1 truncate text-[0.98rem] font-black text-mist-50">
              {COVERS[row.cover] ?? '🔍'} {row.title}
            </p>
            {row.my && <Chip className={solved ? 'border-emerald-400/40 bg-emerald-500/12 text-emerald-300' : 'border-white/12 bg-white/6 text-mist-300'}>{solved ? 'Solved' : `Question ${Math.min((row.my.position ?? 0) + 1, row.my.total || 1)}/${row.my.total || row.question_count}`}</Chip>}
          </div>
        </Card>

        {!row.my && (
          <Card className="!p-5">
            <p className="text-[0.9rem] leading-relaxed font-bold text-mist-100">The brief</p>
            <p className="mt-2 text-[0.84rem] leading-relaxed font-semibold text-mist-300">{row.brief || row.blurb}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.74rem] font-black text-mist-400">
              <Chip><Search className="size-3" /> {row.question_count} questions</Chip>
              <Chip>solve at {row.pass_count}</Chip>
              <Chip className="border-gold-400/40 bg-gold-500/12 text-gold-300"><Sparkles className="size-3" /> +{row.reward_xp} XP · +{row.reward_coins} 🪙</Chip>
            </div>
            <Button className="mt-4" size="sm" variant="mint" loading={busy} disabled={row.pool_ready === 0} onClick={() => void begin()} icon={<PackageOpen className="size-4" />}>
              Open the case file
            </Button>
            {row.pool_ready === 0 && <p className="mt-1.5 text-[0.72rem] font-bold text-flare-300">The staff need to approve questions for this case first.</p>}
          </Card>
        )}

        {row.my && (
          <>
            {/* story + clues */}
            <Card className="!p-4">
              <SectionHeading icon={<Lightbulb className="size-4" />} title="Clues" subtitle="Study them — they carry the topic you need to answer well." />
              <ul className="grid gap-1.5">
                {row.clues.map((clue) =>
                  clue.opened ? (
                    <li key={clue.id} className="rounded-xl border border-gold-400/25 bg-gold-500/8 px-3 py-2 text-[0.82rem] leading-relaxed font-semibold text-mist-100">
                      <span className="mr-1.5 text-[0.68rem] font-black text-gold-300 uppercase">Clue {clue.position}</span>
                      {clue.text}
                      {clue.material_id ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-[0.68rem] font-black text-nova-300"><BookOpen className="size-3" /> material {clue.material_id}</span>
                      ) : null}
                    </li>
                  ) : (
                    <li key={clue.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[0.8rem] font-bold text-mist-500">
                      <Lock className="size-3.5" /> Clue {clue.position}
                      {clue.cost_coins > 0 && <span className="ml-auto inline-flex items-center gap-0.5 text-[0.7rem] font-black text-gold-300"><Coins className="size-3" />{clue.cost_coins}</span>}
                    </li>
                  ),
                )}
              </ul>
              {nextClue && !solved && (
                <Button size="sm" variant="outline" className="mt-2" loading={busy} onClick={() => void unlockClue()} icon={<Sparkles className="size-4 text-gold-300" />}>
                  Unlock clue {nextClue.position}
                  {nextClue.cost_coins ? ` (${nextClue.cost_coins} coins)` : ' (free)'}
                </Button>
              )}
            </Card>

            {/* the investigation */}
            {solved ? (
              <Card className="!p-5 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                  <CheckCircle2 className="size-6" />
                </span>
                <p className="mt-2 text-[1rem] font-black text-mist-50">Case closed.</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-mist-300">
                  Solved in {row.my.attempts} attempt{row.my.attempts === 1 ? '' : 's'} with {row.my.score}/{row.my.total} deductions.
                </p>
              </Card>
            ) : row.my.status === 'failed' ? (
              <Card className="!p-5 text-center">
                <p className="text-[0.95rem] font-black text-mist-100">The evidence didn't add up ({row.my.score}/{row.my.total} — needed {row.pass_count}).</p>
                <Button size="sm" variant="mint" className="mt-3" loading={busy} onClick={() => void begin()} icon={<RotateCcw className="size-4" />}>
                  Reopen the case
                </Button>
              </Card>
            ) : detail.question ? (
              <Card className="!p-4 sm:!p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">Deduction {Math.min(answeredCount + 1, row.my.total)}</p>
                  <div className="w-32">
                    <ProgressBar value={answeredCount} max={Math.max(1, row.my.total)} barClassName="bg-gold-500" />
                  </div>
                </div>
                <p className="mt-2 text-[0.94rem] leading-snug font-bold text-mist-50">{detail.question.text}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(detail.question.options).map(([label, text]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={busy}
                      onClick={() => void answer(label)}
                      className="flex items-start gap-2.5 rounded-2xl border border-white/12 bg-white/5 px-3 py-2.5 text-left transition hover:border-gold-400/50 hover:bg-gold-500/8 disabled:opacity-60"
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/6 text-[0.72rem] font-black text-gold-200">{label}</span>
                      <span className="min-w-0 flex-1 text-[0.84rem] leading-snug font-bold text-mist-100">{text}</span>
                    </button>
                  ))}
                </div>
                {feedback && (
                  <div className={`mt-3 rounded-2xl border p-3 ${(feedback as {correct?: boolean}).correct ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-flare-500/40 bg-flare-500/10'}`}>
                    <div className="flex items-center gap-2">
                      {(feedback as {correct?: boolean}).correct ? <CheckCircle2 className="size-5 text-emerald-300" /> : <XCircle className="size-5 text-flare-300" />}
                      <p className="text-[0.88rem] font-black text-mist-50">
                        {(feedback as {correct?: boolean}).correct ? 'The clue fits.' : `The key was ${(feedback as {correct_answer?: string}).correct_answer}`}
                      </p>
                    </div>
                    {(feedback as {explanation?: string}).explanation && (
                      <p className="mt-1.5 text-[0.79rem] leading-relaxed font-semibold text-mist-300">{(feedback as {explanation?: string}).explanation}</p>
                    )}
                    {((feedback as {story_unlocked?: string[]}).story_unlocked?.length ?? 0) > 0 && (
                      <p className="mt-2 rounded-xl bg-gold-500/10 px-2.5 py-2 text-[0.79rem] leading-relaxed font-black text-gold-200">
                        🗄️ Solution unlocked: {(feedback as {story_unlocked?: string[]}).story_unlocked!.join(' ')}
                      </p>
                    )}
                    {Boolean((feedback as {next?: unknown}).next) && (
                      <Button size="sm" className="mt-2.5" variant="mint" onClick={() => setFeedback(null)}>Next deduction</Button>
                    )}
                  </div>
                )}
              </Card>
            ) : (
              <Card className="!p-5 text-center text-[0.84rem] font-bold text-mist-300">
                The board is waiting — reload the case file.
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={() => openCase(row.id)}>Reload</Button>
                </div>
              </Card>
            )}

            {/* unlocked story so far */}
            {((feedback as {story?: string[]})?.story ?? []).length > 0 && (
              <Card className="!p-4">
                <p className="text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">The solution</p>
                {((feedback as {story?: string[]}).story ?? []).map((line, index) => (
                  <p key={index} className="mt-1.5 text-[0.84rem] leading-relaxed font-semibold text-mist-200">{line}</p>
                ))}
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------- the shelf */
  return (
    <div className="grid gap-3 sm:gap-4">
      <Card className="relative overflow-hidden !p-4 sm:!p-5">
        <div className="pointer-events-none absolute -top-14 -right-8 size-36 rounded-full bg-gold-500/12 blur-3xl" />
        <div className="flex items-center gap-3">
          <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded-2xl text-white">
            <Search className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.05rem] font-black text-mist-50">Mystery cases</h2>
            <p className="text-[0.78rem] font-semibold text-mist-400">Clues, deductions, a real solution — every case teaches a course topic.</p>
          </div>
          <Chip className="border-gold-400/40 bg-gold-500/12 text-gold-300">{progress.solved}/{progress.total} solved</Chip>
        </div>
      </Card>

      {cases.length === 0 ? (
        <EmptyState icon={<PackageOpen className="size-6" />} title="No cases on the shelf yet" detail="Staff build mysteries from the course banks — check back after the next drop." />
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {cases.map((row) => {
            const solved = row.my?.status === 'solved';
            const active = row.my?.status === 'active';
            return (
              <li key={row.id}>
                <Card className={`h-full !p-4 transition ${active ? 'ring-1 ring-gold-400/40' : 'hover:border-white/20'}`}>
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/6 text-[1.35rem]">{COVERS[row.cover] ?? '🔍'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.95rem] font-black text-mist-50">{row.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[0.76rem] font-semibold text-mist-400">{row.blurb}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Chip className="border-white/12 bg-white/6 text-mist-300">{row.difficulty}</Chip>
                    {row.topic && <Chip className="border-nova-400/30 bg-nova-500/10 text-nova-200">{row.topic}</Chip>}
                    <Chip>{row.clues.length} clues</Chip>
                    <Chip className="border-gold-400/40 bg-gold-500/12 text-gold-300">+{row.reward_xp} XP</Chip>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {solved ? (
                      <span className="inline-flex items-center gap-1.5 text-[0.8rem] font-black text-emerald-300"><CheckCircle2 className="size-4" /> Solved {row.my?.score ?? 0}/{row.my?.total ?? 0}</span>
                    ) : active ? (
                      <span className="text-[0.76rem] font-black text-gold-300">Case open — {row.my?.position ?? 0}/{row.my?.total ?? row.question_count} deductions</span>
                    ) : row.pool_ready === 0 ? (
                      <span className="text-[0.76rem] font-black text-mist-500">Bank warming up</span>
                    ) : (
                      <span className="text-[0.76rem] font-black text-mist-500">{row.pass_count}/{row.question_count} needed</span>
                    )}
                    <Button size="sm" variant={active ? 'mint' : 'outline'} className="ml-auto" onClick={() => openCase(row.id)}>
                      {solved ? 'Revisit' : active ? 'Continue' : 'Investigate'}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
