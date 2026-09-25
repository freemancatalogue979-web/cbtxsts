/**
 * The group notification sheet — opened by the always-visible bell. Lists
 * per-group notifications (quiz starting, duel challenge, best answer, new
 * announcement, member joined…), each tappable to jump to the right section.
 * Paginated, with a one-tap "mark all read".
 */
import {Bell, CheckCheck} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Chip, EmptyState, Modal, Pager, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useGroup} from './context';
import type {GroupNotificationRow, PageMeta} from '../lib/types';

export default function NotificationSheet({open, onClose, onRead}: {open: boolean; onClose: () => void; onRead: () => void}) {
  const {groupId, go, openQuiz, openDuel} = useGroup();
  const [items, setItems] = useState<GroupNotificationRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!open) return;
    setLoading(true);
    api.groups
      .notifications(groupId, {page, size: 15})
      .then((payload) => {
        setItems(payload.items);
        setMeta(payload);
      })
      .finally(() => setLoading(false));
  }, [open, groupId, page]);

  useEffect(load, [load]);

  const markAll = async () => {
    try {
      await api.groups.readNotifications(groupId);
      setItems((prev) => prev.map((row) => ({...row, read: true})));
      onRead();
    } catch {
      /* ignore */
    }
  };

  const activate = (row: GroupNotificationRow) => {
    const meta = row.meta as Record<string, number | undefined>;
    if (!row.read) {
      setItems((prev) => prev.map((r) => (r.id === row.id ? {...r, read: true} : r)));
      onRead();
    }
    onClose();
    if (meta.quiz_id) openQuiz(meta.quiz_id);
    else if (meta.duel_id) openDuel(meta.duel_id);
    else if (meta.question_id) go('questions');
    else if (row.kind === 'announcement') go('announcements');
    else if (row.kind === 'join' || row.kind === 'member') go('members');
    else go('activity');
  };

  return (
    <Modal open={open} onClose={onClose} title="Group notifications" subtitle="What's new in this study group" size="md">
      <div className="grid gap-2">
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" />} onClick={() => void markAll()}>
            Mark all read
          </Button>
        </div>

        {loading && !items.length ? (
          <div className="grid gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Bell className="size-5" />} title="No notifications" detail="Quiz starts, challenges and answers show up here." />
        ) : (
          <ul className="grid gap-1.5">
            {items.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => activate(row)}
                  className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                    row.read ? 'border-white/8 bg-ink-900/40' : 'border-nova-500/30 bg-nova-500/8'
                  } hover:border-nova-400/40`}
                >
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${row.read ? 'bg-mist-700' : 'bg-nova-400'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-extrabold text-mist-50">{row.title}</p>
                    {row.message && <p className="mt-0.5 line-clamp-2 text-[0.74rem] font-medium text-mist-400">{row.message}</p>}
                    <span className="mt-1 block text-[0.66rem] font-semibold text-mist-600">{formatRelative(row.created_at)}</span>
                  </div>
                  {!row.read && <Chip className="shrink-0 border-nova-500/30 bg-nova-500/12 text-nova-200">New</Chip>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {meta && meta.pages > 1 && <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Notification pages" />}
      </div>
    </Modal>
  );
}
