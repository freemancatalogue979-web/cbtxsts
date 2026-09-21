/** Admin: a cross-group moderation list of every study group in the arena. */
import {MessageSquare, MoveHorizontal, Search, Users} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Modal, SectionHeading, Skeleton, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatDate, formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import type {AdminGroupRow} from '../lib/types';

export default function GroupsAdmin() {
  const {toast} = useSession();
  const [rows, setRows] = useState<AdminGroupRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AdminGroupRow | null>(null);
  const limit = 40;

  const load = useCallback(() => {
    api.admin
      .groups({q: query, limit, offset})
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((error: Error) => toast('error', 'Could not load study groups', error.message));
  }, [query, offset, toast]);

  useEffect(() => {
    const id = window.setTimeout(load, query ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, query]);

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Study groups"
        subtitle={`${formatNumber(total)} groups · click a row for the full sheet`}
        icon={<Users className="size-4" />}
        action={
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mist-500" />
            <TextInput
              className="h-10 py-2 pl-10 text-[0.84rem]"
              placeholder="Name or join code"
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
        <EmptyState icon={<Users className="size-6" />} title="No study groups match" detail="Try a different name or join code." />
      ) : (
        <Card className="overflow-hidden">
          <p className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2 text-[0.68rem] font-bold text-mist-500 sm:hidden">
            <MoveHorizontal className="size-3.5" /> Swipe sideways for the full table
          </p>
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[44rem] text-left sm:min-w-[52rem]">
              <thead className="border-b border-white/8 bg-white/[0.03]">
                <tr className="text-[0.66rem] font-black tracking-[0.14em] text-mist-500">
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Group</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Owner</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Course</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Members</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Messages</th>
                  <th className="px-2.5 py-2 sm:px-4 sm:py-3">Created</th>
                  <th className="px-2.5 py-2 text-right sm:px-4 sm:py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {rows.map((group) => (
                  <tr key={group.id} className="cursor-pointer transition-colors hover:bg-white/[0.04]" onClick={() => setDetail(group)}>
                    <td className="px-2.5 py-2 sm:px-4 sm:py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[0.84rem] font-extrabold text-mist-100">{group.name}</p>
                        <p className="truncate text-[0.7rem] font-semibold tabular text-mist-500">#{group.id} · code {group.code}</p>
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-[0.8rem] font-semibold text-mist-300 sm:px-4 sm:py-2.5">{group.owner.name}</td>
                    <td className="max-w-[14rem] truncate px-2.5 py-2 text-[0.8rem] font-semibold text-mist-400 sm:px-4 sm:py-2.5">
                      {group.course_title ?? '—'}
                    </td>
                    <td className="px-2.5 py-2 text-right text-[0.8rem] font-black tabular text-nova-300 sm:px-4 sm:py-2.5">
                      {formatNumber(group.member_count)}
                    </td>
                    <td className="px-2.5 py-2 text-right text-[0.8rem] font-bold tabular text-mist-400 sm:px-4 sm:py-2.5">
                      {formatNumber(group.message_count)}
                    </td>
                    <td className="px-2.5 py-2 text-[0.76rem] font-semibold text-mist-500 sm:px-4 sm:py-2.5">
                      {formatDate(group.created_at, true)}
                    </td>
                    <td className="px-2.5 py-2 text-right sm:px-4 sm:py-2.5" onClick={(event) => event.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => setDetail(group)}>
                        View
                      </Button>
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
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {formatNumber(total)}
        </span>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </Button>
      </div>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.name} subtitle={detail ? `Code ${detail.code}` : ''} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {label: 'Members', value: formatNumber(detail.member_count)},
                {label: 'Messages', value: formatNumber(detail.message_count)},
                {label: 'Group ID', value: `#${detail.id}`},
                {label: 'Created', value: formatDate(detail.created_at, true)},
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
                  <p className="text-base font-black tabular text-mist-50">{stat.value}</p>
                  <p className="text-[0.62rem] font-bold tracking-[0.14em] text-mist-500">{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-[0.82rem] font-bold text-mist-300">
                <Users className="size-4 text-nova-300" /> Owner: {detail.owner.name} <Chip>#{detail.owner.id}</Chip>
              </p>
              <p className="text-[0.82rem] font-bold text-mist-300">Course: {detail.course_title ?? 'None'}</p>
              {detail.goal && <p className="text-[0.82rem] font-semibold text-mist-400">Goal: {detail.goal}</p>}
              {detail.description && <p className="text-[0.82rem] font-medium text-mist-400">{detail.description}</p>}
            </div>
            <p className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[0.78rem] font-semibold text-mist-500">
              <MessageSquare className="size-4" /> Open the group workspace as a member to moderate chat, quizzes and questions in place.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
