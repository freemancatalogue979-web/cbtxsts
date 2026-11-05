/**
 * The group activity feed: joins, quiz publishes, duel challenges/results,
 * questions answered, announcements. Server-paginated, filtered by kind, and
 * appended live over the group socket so it stays current without a reload.
 */
import {
  Activity as ActivityIcon,
  CheckCircle2,
  Crown,
  Megaphone,
  MessageCircleQuestion,
  Swords,
  Trophy,
  UserPlus,
  Zap,
} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Card, EmptyState, Pager, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useGroup} from './context';
import type {GroupActivityRow, PageMeta} from '../lib/types';

type Filter = 'all' | 'join' | 'quiz' | 'duel' | 'question' | 'announcement' | 'member';

const KIND_ICON: Record<string, typeof Zap> = {
  join: UserPlus,
  member_join: UserPlus,
  member_leave: UserPlus,
  role_change: Crown,
  quiz_created: Zap,
  quiz_starting: Zap,
  quiz_reminder: Zap,
  quiz_completed: CheckCircle2,
  quiz_passed: Trophy,
  quiz_result: Trophy,
  duel_created: Swords,
  duel_result: Swords,
  question_asked: MessageCircleQuestion,
  question_answered: MessageCircleQuestion,
  question_resolved: CheckCircle2,
  announcement: Megaphone,
  announcement_published: Megaphone,
};

function kindIcon(kind: string) {
  const Icon = KIND_ICON[kind] ?? ActivityIcon;
  return <Icon className="size-4" />;
}

export default function Activity() {
  const {groupId, room} = useGroup();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<GroupActivityRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.groups
      .activity(groupId, {kind: filter === 'all' ? '' : filter, page, size: 20})
      .then((payload) => {
        setItems(payload.items);
        setMeta(payload);
      })
      .finally(() => setLoading(false));
  }, [groupId, filter, page]);

  useEffect(load, [load]);

  /* Live activity appends to page 1 only, so it never fights the pager. */
  useEffect(
    () =>
      room.on('group_activity', (data) => {
        if (page !== 1) return;
        const row = data as GroupActivityRow;
        if (!row || !row.id) return;
        setItems((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev].slice(0, 20)));
      }),
    [room, page],
  );

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <SectionHeading title="Activity" subtitle="What has been happening in the group" icon={<ActivityIcon className="size-4" />} />
      <div className="overflow-x-auto">
        <Segmented
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          options={[
            {value: 'all', label: 'All'},
            {value: 'join', label: 'Joins'},
            {value: 'quiz', label: 'Quizzes'},
            {value: 'duel', label: 'Duels'},
            {value: 'question', label: 'Questions'},
            {value: 'announcement', label: 'News'},
          ]}
        />
      </div>

      {loading && !items.length ? (
        <div className="grid gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<ActivityIcon className="size-5" />} title="No activity yet" detail="Joins, quizzes, duels and questions show up here." />
      ) : (
        <ul className="grid gap-1.5">
          {items.map((row) => (
            <li key={row.id}>
              <Card className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-nova-300">{kindIcon(row.kind)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.82rem] leading-snug font-medium text-mist-200">
                    {row.actor && <span className="font-extrabold text-mist-50">{row.actor.name.split(' ')[0]} </span>}
                    {row.text}
                  </p>
                  <span className="mt-1 block text-[0.68rem] font-semibold text-mist-600">{formatRelative(row.created_at)}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.pages > 1 && (
        <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Activity pages" />
      )}
    </div>
  );
}
