/** Admin: players, results (with CSV export) and prize claims. */
import {
  Award,
  Ban,
  BarChart3,
  CheckCircle2,
  Coins,
  Download,
  Medal,
  MoveHorizontal,
  PackageCheck,
  Search,
  Swords,
  Trash2,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Avatar, Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api, tokenStore} from '../lib/api';
import {formatDate, formatNumber, formatPhone, GRADE_STYLES} from '../lib/format';
import {useSession} from '../store/session';
import type {AttemptSummary, PlayerSummary, PrizeClaim, Profile, Quiz} from '../lib/types';

interface ResultRow {
  id?: number;
  rank?: number;
  rank_label?: string;
  student: PlayerSummary;
  result?: AttemptSummary;
  quiz?: {id: number; title: string};
  score?: number;
  percentage?: number;
  grade?: string;
  submitted_at?: string;
}

function PlayersTab({onChanged}: {onChanged: () => void}) {
  const {toast} = useSession();
  const [rows, setRows] = useState<PlayerSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<Profile | null>(null);
  const [adjusting, setAdjusting] = useState<PlayerSummary | null>(null);
  const [adjust, setAdjust] = useState({xp: 0, coins: 0, reason: 'Staff adjustment'});
  const [busy, setBusy] = useState(false);
  const limit = 40;

  const load = useCallback(() => {
    api.admin
      .students({q: query, limit, offset})
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((error: Error) => toast('error', 'Could not load players', error.message));
  }, [query, offset, toast]);

  useEffect(() => {
    const id = window.setTimeout(load, query ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, query]);

  const ban = async (player: PlayerSummary) => {
    try {
      const result = await api.admin.toggleBan(player.id);
      toast(result.is_banned ? 'info' : 'success', result.is_banned ? 'Player banned' : 'Ban lifted', player.name);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not update', (error as Error).message);
    }
  };

  const remove = async (player: PlayerSummary) => {
    if (!window.confirm(`Delete ${player.name}? All their attempts, duels and XP go too.`)) return;
    try {
      await api.admin.deleteStudent(player.id);
      toast('info', 'Player deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  const applyAdjust = async () => {
    if (!adjusting) return;
    setBusy(true);
    try {
      await api.admin.adjust(adjusting.id, Number(adjust.xp) || 0, Number(adjust.coins) || 0, adjust.reason.trim() || 'Staff adjustment');
      toast('success', 'Progress adjusted', adjusting.name);
      setAdjusting(null);
      setAdjust({xp: 0, coins: 0, reason: 'Staff adjustment'});
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not adjust', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (player: PlayerSummary) => {
    try {
      setDetail(await api.admin.student(player.id));
    } catch (error) {
      toast('error', 'Could not load player', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Players"
        subtitle={`${formatNumber(total)} registered · click a row for the full sheet`}
        icon={<Users className="size-4" />}
        action={
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mist-500" />
            <TextInput
              className="h-10 py-2 pl-10 text-[0.84rem]"
              placeholder="Name or phone"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOffset(0);
              }}
            />
          </div>
        }
      />

      {!rows ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-16" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="No players match" detail="Try a different name or phone number." />
      ) : (
        <Card className="overflow-hidden">
          <p className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2 text-[0.68rem] font-bold text-mist-500 sm:hidden">
            <MoveHorizontal className="size-3.5" /> Swipe sideways for the full table
          </p>
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[44rem] text-left sm:min-w-[52rem]">
              <thead className="border-b border-white/8 bg-white/[0.03]">
 <tr className="text-[0.66rem] font-black tracking-[0.14em] text-mist-500">
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Player</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Phone</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Level</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">XP</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Coins</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Duels</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {rows.map((player) => (
                  <tr key={player.id} className="cursor-pointer transition-colors hover:bg-white/[0.04]" onClick={() => openDetail(player)}>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={player.name} hue={player.avatar_hue} initials={player.initials} size={34} online={player.online} />
                        <div className="min-w-0">
                          <p className="truncate text-[0.84rem] font-extrabold text-mist-100">{player.name}</p>
                          <p className="truncate text-[0.7rem] font-semibold text-mist-500">{player.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[0.8rem] font-semibold tabular text-mist-400">{formatPhone(player.phone)}</td>
                    <td className="px-4 py-2.5 text-[0.8rem] font-black tabular text-nova-300">{player.level}</td>
                    <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5 text-[0.8rem] font-black tabular text-mist-100">{formatNumber(player.xp)}</td>
                    <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5 text-[0.8rem] font-black tabular text-gold-300">{formatNumber(player.coins)}</td>
                    <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5 text-[0.8rem] font-bold tabular text-mist-400">
                      {player.duels_won}/{player.duels_played}
                    </td>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-2.5">
                      <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAdjusting(player);
                            setAdjust({xp: 0, coins: 0, reason: 'Staff adjustment'});
                          }}
                          icon={<Zap className="size-3.5 text-nova-300" />}
                        >
                          Adjust
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => ban(player)} icon={<Ban className="size-3.5 text-flare-400" />} />
                        <Button size="sm" variant="ghost" onClick={() => remove(player)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <span className="text-[0.78rem] font-bold text-mist-500">
          {offset + 1}–{Math.min(offset + limit, total)} of {formatNumber(total)}
        </span>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </Button>
      </div>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.name} subtitle={detail ? formatPhone(detail.phone) : ''} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar name={detail.name} hue={detail.avatar_hue} initials={detail.initials} size={64} />
              <div>
                <p className="text-[0.92rem] font-extrabold text-mist-50">
                  Level {detail.progress.level} · {detail.progress.title}
                </p>
                <p className="text-[0.8rem] font-semibold text-mist-500">
                  {detail.reg_no ?? 'No reg no'} · {detail.class_name} · {detail.faculty}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {label: 'XP', value: formatNumber(detail.xp)},
                {label: 'Coins', value: formatNumber(detail.coins)},
                {label: 'Streak', value: `${detail.streak}d`},
                {label: 'Weekly XP', value: formatNumber(detail.weekly_xp)},
                {label: 'Exams', value: detail.stats.exams_taken},
                {label: 'Best score', value: `${detail.stats.best_percentage}%`},
                {label: 'Duels', value: `${detail.stats.duels_won}W/${detail.stats.duels_lost}L`},
                {label: 'Badges', value: detail.badges.length},
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
                  <p className="text-base font-black tabular text-mist-50">{stat.value}</p>
 <p className="text-[0.62rem] font-bold tracking-[0.14em] text-mist-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {detail.badges.length > 0 && (
              <div>
 <p className="text-[0.68rem] font-black tracking-[0.18em] text-mist-500">Badges</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.badges.map((badge) => (
                    <Chip key={badge.key} className="border-gold-500/28 bg-gold-500/12 text-gold-300">
                      {badge.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
        title={`Adjust ${adjusting?.name ?? ''}`}
        subtitle="Positive or negative — lands instantly and logs an activity entry."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button onClick={applyAdjust} loading={busy} icon={<CheckCircle2 className="size-4" />}>
              Apply
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="XP delta">
            <TextInput type="number" value={adjust.xp} onChange={(event) => setAdjust({...adjust, xp: Number(event.target.value)})} />
          </Field>
          <Field label="Coin delta">
            <TextInput type="number" value={adjust.coins} onChange={(event) => setAdjust({...adjust, coins: Number(event.target.value)})} />
          </Field>
          <Field label="Reason" className="sm:col-span-2">
            <TextInput value={adjust.reason} maxLength={120} onChange={(event) => setAdjust({...adjust, reason: event.target.value})} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {[
              {label: '+100 XP', xp: 100, coins: 0},
              {label: '+500 coins', xp: 0, coins: 500},
              {label: 'Duel refund', xp: 0, coins: 25},
              {label: 'Penalty', xp: -50, coins: -50},
            ].map((preset) => (
              <Button
                key={preset.label}
                size="sm"
                variant="outline"
                onClick={() => setAdjust({...adjust, xp: preset.xp, coins: preset.coins, reason: preset.label})}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ResultsTab({onChanged}: {onChanged: () => void}) {
  const {toast} = useSession();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizId, setQuizId] = useState<number | ''>('');
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.admin
      .quizzes()
      .then(setQuizzes)
      .catch(() => setQuizzes([]));
  }, []);

  const load = useCallback(() => {
    api.admin
      .results({quiz_id: quizId || undefined, q: query})
      .then((data) => setRows(data.rows as unknown as ResultRow[]))
      .catch((error: Error) => toast('error', 'Could not load results', error.message));
  }, [quizId, query, toast]);

  useEffect(() => {
    const id = window.setTimeout(load, query ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, query]);

  const normalize = (row: ResultRow) => ({
    id: row.id ?? row.result?.id ?? 0,
    rank: row.rank,
    rankLabel: row.rank_label,
    name: row.student.name,
    phone: row.student.phone,
    student: row.student,
    score: row.result?.score ?? row.score ?? 0,
    percentage: row.result?.percentage ?? row.percentage ?? 0,
    grade: row.result?.grade ?? row.grade ?? '—',
    submittedAt: row.result?.submitted_at ?? row.submitted_at ?? null,
    quizTitle: row.quiz?.title,
  });

  const exportCsv = async () => {
    if (!quizId) {
      toast('info', 'Pick an exam first', 'CSV export works per exam.');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(api.admin.exportUrl(quizId), {headers: {Authorization: `Bearer ${tokenStore.get() ?? ''}`}});
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `arena-results-quiz-${quizId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast('success', 'CSV downloaded');
    } catch (error) {
      toast('error', 'Could not export', (error as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const clearAll = async () => {
    if (!quizId) return;
    if (!window.confirm('Delete every attempt for this exam? Players lose the XP they earned from it.')) return;
    try {
      await api.admin.clearResults(quizId);
      toast('info', 'Results cleared');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not clear', (error as Error).message);
    }
  };

  const removeRow = async (row: ResultRow) => {
    const attemptId = normalize(row).id;
    if (!attemptId) return;
    try {
      await api.admin.deleteResult(attemptId);
      toast('info', 'Attempt deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Results"
        subtitle="Per-exam leaderboards, CSV export and attempt cleanup."
        icon={<BarChart3 className="size-4" />}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} loading={exporting} icon={<Download className="size-3.5" />}>
              Export CSV
            </Button>
            {quizId && (
              <Button size="sm" variant="danger" onClick={clearAll} icon={<Trash2 className="size-3.5" />}>
                Clear exam
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
        <Field label="Exam">
          <Select value={quizId} onChange={(event) => setQuizId(event.target.value ? Number(event.target.value) : '')}>
            <option value="">All recent submissions</option>
            {quizzes.map((quiz) => (
              <option key={quiz.id} value={quiz.id}>
                {quiz.title} ({quiz.question_count} Q)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search player">
          <TextInput placeholder="Name or phone" value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
      </div>

      {!rows ? (
        <Skeleton className="h-56" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<BarChart3 className="size-6" />} title="No submissions yet" detail="Results appear the moment players submit." />
      ) : (
        <Card className="overflow-hidden">
          <p className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2 text-[0.68rem] font-bold text-mist-500 sm:hidden">
            <MoveHorizontal className="size-3.5" /> Swipe sideways for the full table
          </p>
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[40rem] text-left sm:min-w-[46rem]">
              <thead className="border-b border-white/8 bg-white/[0.03]">
 <tr className="text-[0.66rem] font-black tracking-[0.14em] text-mist-500">
                  {quizId && <th className="px-2.5 py-2 sm:px-4 sm:py-3">Rank</th>}
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Player</th>
                  {!quizId && <th className="px-2.5 py-2 sm:px-4 sm:py-3">Exam</th>}
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Score</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">%</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Grade</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Submitted</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {rows.map((row) => {
                  const data = normalize(row);
                  return (
                    <tr key={`${data.id}-${data.name}`} className="transition-colors hover:bg-white/[0.04]">
                      {quizId && (
                        <td className="px-2.5 py-2 sm:px-4 sm:py-2.5">
                          <span className="grid size-7 place-items-center rounded-lg bg-white/6 text-[0.76rem] font-black tabular text-mist-300">
                            {data.rank ?? '—'}
                          </span>
                        </td>
                      )}
                      <td className="px-2.5 py-2 sm:px-4 sm:py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={data.name} hue={data.student.avatar_hue} initials={data.student.initials} size={30} />
                          <div className="min-w-0">
                            <p className="truncate text-[0.82rem] font-extrabold text-mist-100">{data.name}</p>
                            <p className="truncate text-[0.68rem] font-semibold tabular text-mist-500">{formatPhone(data.phone)}</p>
                          </div>
                        </div>
                      </td>
                      {!quizId && <td className="max-w-[14rem] truncate px-4 py-2.5 text-[0.8rem] font-semibold text-mist-400">{data.quizTitle}</td>}
                      <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5 text-[0.82rem] font-black tabular text-mist-100">{data.score}</td>
                      <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5 text-[0.82rem] font-black tabular text-mist-300">{data.percentage.toFixed(0)}%</td>
                      <td className="px-2.5 py-2 sm:px-4 sm:py-2.5">
                        <Chip className={GRADE_STYLES[data.grade] ?? 'border-white/12 bg-white/6 text-mist-400'}>{data.grade}</Chip>
                      </td>
                      <td className="px-4 py-2.5 text-[0.76rem] font-semibold text-mist-500">{formatDate(data.submittedAt, true)}</td>
                      <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5">
                        <Button size="sm" variant="ghost" onClick={() => removeRow(row)} icon={<X className="size-3.5 text-flare-400" />} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ClaimsTab({onChanged}: {onChanged: () => void}) {
  const {toast} = useSession();
  const [claims, setClaims] = useState<PrizeClaim[] | null>(null);
  const [target, setTarget] = useState<PrizeClaim | null>(null);
  const [status, setStatus] = useState<'approved' | 'delivered' | 'rejected'>('approved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.admin
      .claims()
      .then(setClaims)
      .catch((error: Error) => toast('error', 'Could not load claims', error.message));
  }, [toast]);

  useEffect(load, [load]);

  const apply = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.admin.updateClaim(target.id, status, note.trim());
      toast('success', `Claim ${status}`, target.prize.title);
      setTarget(null);
      setNote('');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not update claim', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusStyle: Record<string, string> = {
    pending: 'border-gold-500/32 bg-gold-500/12 text-gold-300',
    approved: 'border-pulse-500/32 bg-pulse-500/12 text-pulse-300',
    delivered: 'border-mint-500/32 bg-mint-500/12 text-mint-300',
    rejected: 'border-flare-500/32 bg-flare-500/12 text-flare-300',
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Prize claims"
        subtitle="Approve, deliver or reject — the player is notified instantly."
        icon={<PackageCheck className="size-4" />}
        action={
          <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-300">
            {claims?.filter((claim) => claim.status === 'pending').length ?? 0} pending
          </Chip>
        }
      />

      {!claims ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-20" />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <EmptyState icon={<Award className="size-6" />} title="No claims yet" detail="Players claim prizes from the vault." />
      ) : (
        <ul className="space-y-2">
          {claims.map((claim) => (
            <motion.li key={claim.id} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <Avatar name={claim.student.name} hue={claim.student.avatar_hue} initials={claim.student.initials} size={42} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-extrabold text-mist-50">{claim.prize.title}</p>
                  <p className="truncate text-[0.78rem] font-semibold text-mist-500">
                    {claim.student.name} · {formatPhone(claim.student.phone)} · {formatDate(claim.created_at, true)}
                  </p>
                  {claim.note && <p className="mt-1 truncate text-[0.76rem] font-medium text-mist-400">“{claim.note}”</p>}
                </div>
                <Chip className={statusStyle[claim.status]}>{claim.status}</Chip>
                <div className="flex gap-1.5">
                  {claim.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="mint"
                      onClick={() => {
                        setTarget(claim);
                        setStatus('approved');
                      }}
                      icon={<UserCheck className="size-3.5" />}
                    >
                      Approve
                    </Button>
                  )}
                  {claim.status === 'approved' && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setTarget(claim);
                        setStatus('delivered');
                      }}
                      icon={<Medal className="size-3.5" />}
                    >
                      Mark delivered
                    </Button>
                  )}
                  {claim.status !== 'rejected' && claim.status !== 'delivered' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTarget(claim);
                        setStatus('rejected');
                      }}
                      icon={<X className="size-3.5 text-flare-400" />}
                    >
                      Reject
                    </Button>
                  )}
                </div>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={`${status === 'rejected' ? 'Reject' : status === 'delivered' ? 'Deliver' : 'Approve'} claim`}
        subtitle={target?.prize.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={apply} loading={busy} icon={<CheckCircle2 className="size-4" />}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['approved', 'delivered', 'rejected'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setStatus(option)}
                className={`rounded-2xl border px-4 py-2 text-[0.82rem] font-bold capitalize transition-colors ${
                  status === option ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <Field label="Note to player" hint="Shown in their claim history.">
            <TextArea rows={3} value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {target?.prize.kind === 'coins' && (
            <p className="flex items-center gap-2 rounded-2xl border border-gold-500/25 bg-gold-500/10 px-4 py-3 text-[0.8rem] font-semibold text-gold-300">
              <Coins className="size-4" /> {formatNumber(target.prize.cost_coins)} coins were deducted at claim time.
            </p>
          )}
          {target?.prize.kind === 'rank' && (
            <p className="flex items-center gap-2 rounded-2xl border border-nova-500/25 bg-nova-500/10 px-4 py-3 text-[0.8rem] font-semibold text-nova-300">
              <Swords className="size-4" /> Rank reward for place {target.prize.min_rank}
              {target.prize.max_rank !== target.prize.min_rank ? `–${target.prize.max_rank}` : ''}.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default function PeopleAdmin({tab, onChanged}: {tab: 'players' | 'results' | 'claims'; onChanged: () => void}) {
  const normalized = useMemo(() => tab, [tab]);
  if (normalized === 'players') return <PlayersTab onChanged={onChanged} />;
  if (normalized === 'results') return <ResultsTab onChanged={onChanged} />;
  return <ClaimsTab onChanged={onChanged} />;
}
