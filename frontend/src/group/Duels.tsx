/**
 * Group duels. Members challenge each other using the existing authoritative
 * duel engine; the duel records which group it belongs to and whether it is
 * public to that group (private challenges stay private). Setting up a
 * challenge is a small, focused action, so it lives in a modal — but the duel
 * itself opens the full duel arena page.
 */
import {Eye, Lock, Search, Swords, Trophy} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Avatar, Button, Card, Chip, EmptyState, Field, Modal, Pager, SectionHeading, Segmented, Select, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useGroup} from './context';
import type {Course, GroupDuelRow, GroupMemberRow, PageMeta} from '../lib/types';

type Filter = 'all' | 'live' | 'invited' | 'finished';

function ChallengeModal({open, onClose, presetOpponent}: {open: boolean; onClose: () => void; presetOpponent: number | null}) {
  const {groupId, notify, openDuel} = useGroup();
  const [courses, setCourses] = useState<Course[]>([]);
  const [members, setMembers] = useState<GroupMemberRow[]>([]);
  const [search, setSearch] = useState('');
  const [opponent, setOpponent] = useState<number | null>(presetOpponent);
  const [courseId, setCourseId] = useState<number | ''>('');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [isPublic, setIsPublic] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) api.courses().then(setCourses).catch(() => setCourses([]));
  }, [open]);

  useEffect(() => {
    setOpponent(presetOpponent);
  }, [presetOpponent, open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      api.groups
        .members(groupId, {q: search, size: 20})
        .then((payload) => setMembers(payload.items))
        .catch(() => setMembers([]));
    }, 250);
    return () => window.clearTimeout(id);
  }, [open, search, groupId]);

  const selected = members.find((row) => row.student_id === opponent) ?? null;

  const submit = async () => {
    if (!opponent) {
      notify('error', 'Pick an opponent', 'Choose a member to challenge.');
      return;
    }
    setBusy(true);
    try {
      const duel = await api.groups.challenge(groupId, {
        opponent_id: opponent,
        course_id: courseId === '' ? null : Number(courseId),
        topic: topic.trim(),
        question_count: Math.min(100, Math.max(3, count)),
        public: isPublic,
        message: message.trim(),
      });
      notify('success', 'Challenge sent', 'You are in the waiting room.');
      onClose();
      openDuel(duel.id);
    } catch (error) {
      notify('error', 'Could not start duel', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Challenge a member"
      subtitle="20 seconds per question · the arena engine runs the match"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !opponent} icon={<Swords className="size-4" />}>
            {busy ? 'Sending…' : 'Send challenge'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Opponent">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist-600" />
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="pl-9" />
          </div>
        </Field>
        <ul className="max-h-44 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-white/8 bg-ink-950/50 p-1">
          {members.map((row) => (
            <li key={row.student_id}>
              <button
                type="button"
                onClick={() => setOpponent(row.student_id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${opponent === row.student_id ? 'bg-nova-500/20' : 'hover:bg-white/6'}`}
              >
                <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={28} photo={{id: row.student_id, has: row.has_photo}} />
                <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-100">{row.name}</span>
                <span className="shrink-0 text-[0.68rem] font-semibold text-mist-500">Lv {row.level ?? 1}</span>
              </button>
            </li>
          ))}
          {members.length === 0 && <li className="px-2 py-3 text-center text-[0.76rem] font-medium text-mist-600">No members match.</li>}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Course">
            <Select value={courseId} onChange={(e) => setCourseId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Random arena</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} — {course.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic (optional)">
            <TextInput value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Evidence" maxLength={120} />
          </Field>
        </div>

        <Field label={`Questions (${count} max 100)`}>
          <input type="range" min={3} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-nova-400" />
        </Field>

        <Field label="Message (optional)">
          <TextInput value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Rematch me!" maxLength={240} />
        </Field>

        <label className="flex items-center gap-2 text-[0.8rem] font-semibold text-mist-300">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-4 accent-nova-400" />
          {isPublic ? 'Public to the group (shows in activity)' : 'Private (only you and your opponent see it)'}
        </label>
        {selected && <p className="text-[0.72rem] font-medium text-mist-500">Challenging {selected.name} · {count * 20}s total clock.</p>}
      </div>
    </Modal>
  );
}

export default function Duels() {
  const {groupId, can, room, myId, openDuel, intent, clearIntent} = useGroup();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<GroupDuelRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [challengeOpen, setChallengeOpen] = useState(false);

  useEffect(() => {
    if (intent === 'create' && can('challenge_duels')) {
      setChallengeOpen(true);
      clearIntent();
    }
  }, [intent, can, clearIntent]);

  const load = useCallback(() => {
    api.groups
      .duels(groupId, {filter, page, size: 10})
      .then((payload) => {
        setItems(payload.items);
        setMeta(payload);
      })
      .catch(() => undefined);
  }, [groupId, filter, page]);

  useEffect(load, [load]);
  useEffect(() => room.on('group_duel_update', load), [room, load]);

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <SectionHeading
        title="Duels"
        subtitle="Head-to-head challenges between members"
        icon={<Swords className="size-4" />}
        action={can('challenge_duels') ? <Button size="sm" variant="primary" icon={<Swords className="size-4" />} onClick={() => setChallengeOpen(true)}>Challenge</Button> : undefined}
      />
      <Segmented
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        options={[
          {value: 'all', label: 'All'},
          {value: 'live', label: 'Live'},
          {value: 'invited', label: 'Invited'},
          {value: 'finished', label: 'Finished'},
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={<Swords className="size-5" />} title="No duels yet" detail={can('challenge_duels') ? 'Challenge a member to start one.' : 'Challenges between members appear here.'} />
      ) : (
        <ul className="grid gap-2">
          {items.map((duel) => {
            const me = duel.players.find((p) => p.id === myId);
            const opponent = duel.players.find((p) => p.id !== myId);
            const label = me ? opponent?.name ?? 'Open duel' : duel.players.map((p) => p.name).join(' vs ');
            const tone =
              duel.status === 'live'
                ? 'border-mint-500/30 bg-mint-500/12 text-mint-200'
                : duel.status === 'invited'
                  ? 'border-gold-500/30 bg-gold-500/12 text-gold-200'
                  : 'border-white/12 bg-white/6 text-mist-400';
            return (
              <li key={duel.id}>
                <Card className="flex items-center gap-3 p-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-nova-300">
                    <Swords className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.86rem] font-extrabold text-mist-50">{label}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.72rem] font-semibold text-mist-500">
                      {duel.topic} · {duel.question_count} Qs
                      {!duel.public && (
                        <span className="inline-flex items-center gap-0.5 text-mist-600">
                          <Lock className="size-3" /> private
                        </span>
                      )}
                      {duel.winner && (
                        <span className="inline-flex items-center gap-0.5 text-gold-300">
                          <Trophy className="size-3" /> {duel.winner.name.split(' ')[0]}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Chip className={tone}>{duel.status}</Chip>
                    {duel.i_am_in ? (
                      <Button size="sm" variant={duel.status === 'finished' ? 'ghost' : 'primary'} onClick={() => openDuel(duel.id)}>
                        {duel.status === 'finished' ? 'Result' : 'Enter'}
                      </Button>
                    ) : duel.public ? (
                      <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-mist-600">
                        <Eye className="size-3.5" /> {formatRelative(duel.created_at)}
                      </span>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {meta && meta.pages > 1 && <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Duel pages" />}

      <ChallengeModal open={challengeOpen} onClose={() => setChallengeOpen(false)} presetOpponent={null} />
    </div>
  );
}

export {ChallengeModal};
