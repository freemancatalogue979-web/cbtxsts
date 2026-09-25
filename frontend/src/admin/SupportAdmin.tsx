/**
 * Support desk — the staff side of Customer Support.
 *
 * Search / filter / paginate the queue, open a ticket and answer it like a
 * chat. Statuses and assignments are server-checked; internal notes stay
 * invisible to players; replies ping the player's bell automatically.
 */
import {CheckCircle2, Inbox, Loader2, Lock, Search, Send, UserCog} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Avatar, Button, Card, Chip, SectionHeading, Select, Skeleton, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useSession} from '../store/session';

type Json = Record<string, unknown>;

interface TicketRow {
  id: number;
  status: string;
  status_label: string;
  category: string;
  category_label: string;
  subject: string;
  preview: string;
  assignee: string;
  staff_unread: number;
  last_message_at: string | null;
  student: {id: number; name: string} | null;
}
interface Message {
  id: number;
  author_kind: 'student' | 'staff' | 'system';
  author_name: string;
  body: string;
  internal: boolean;
  created_at: string | null;
}
interface ListPage {
  items: TicketRow[];
  total: number;
  open_count: number;
  unread_count: number;
  staff: {email: string; name: string}[];
  has_more: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  open: 'border-nova-400/35 bg-nova-500/12 text-nova-200',
  in_progress: 'border-violet-400/35 bg-violet-500/12 text-violet-200',
  waiting_user: 'border-amber-400/40 bg-amber-500/12 text-amber-300',
  resolved: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300',
  closed: 'border-white/12 bg-white/6 text-mist-400',
};

export default function SupportAdmin() {
  const {toast} = useSession();
  const [page, setPage] = useState<ListPage | null>(null);
  const [filters, setFilters] = useState({q: '', status: '', category: '', unassigned: false});
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const limit = 15;

  const load = useCallback(() => {
    const params: Record<string, string | number | boolean> = {limit, offset};
    if (filters.q.trim()) params.q = filters.q.trim();
    if (filters.status) params.status = filters.status;
    if (filters.category) params.category = filters.category;
    if (filters.unassigned) params.only_unassigned = true;
    api.admin
      .supportList(params)
      .then((data) => setPage(data as unknown as ListPage))
      .catch(() => setPage({items: [], total: 0, open_count: 0, unread_count: 0, staff: [], has_more: false}));
  }, [filters, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0 space-y-2.5">
        <SectionHeading
          icon={<Inbox className="size-4" />}
          title="Support queue"
          subtitle={page ? `${page.open_count} open · ${page.unread_count} waiting on a reply · ${page.total} total` : 'Loading…'}
          action={
            page && page.total > limit ? (
              <div className="flex items-center gap-1.5 text-[0.72rem] font-black text-mist-500">
                <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="rounded-lg border border-white/10 px-2 py-1 disabled:opacity-40">
                  ←
                </button>
                {offset + 1}–{Math.min(offset + limit, page.total)}
                <button type="button" disabled={!page.has_more} onClick={() => setOffset(offset + limit)} className="rounded-lg border border-white/10 px-2 py-1 disabled:opacity-40">
                  →
                </button>
              </div>
            ) : undefined
          }
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mist-500" />
            <TextInput
              className="pl-8"
              placeholder="Search subject or message…"
              value={filters.q}
              onChange={(event) => {
                setFilters((current) => ({...current, q: event.target.value}));
                setOffset(0);
              }}
            />
          </div>
          <Select
            value={filters.status}
            onChange={(event) => {
              setFilters((current) => ({...current, status: event.target.value}));
              setOffset(0);
            }}
          >
            <option value="">Any status</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_user">Waiting for user</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>
          <Select
            value={filters.category}
            onChange={(event) => {
              setFilters((current) => ({...current, category: event.target.value}));
              setOffset(0);
            }}
          >
            <option value="">Any category</option>
            {['bug', 'question', 'account', 'quiz', 'duel', 'ranked', 'study_group', 'shop', 'other'].map((row) => (
              <option key={row} value={row}>{row.replaceAll('_', ' ')}</option>
            ))}
          </Select>
          <label className="flex items-center gap-2 self-center px-1 text-[0.74rem] font-black whitespace-nowrap text-mist-300">
            <input
              type="checkbox"
              className="size-4 accent-violet-500"
              checked={filters.unassigned}
              onChange={(event) => {
                setFilters((current) => ({...current, unassigned: event.target.checked}));
                setOffset(0);
              }}
            />
            unassigned
          </label>
        </div>

        {!page ? (
          <Skeleton className="h-52 rounded-3xl" />
        ) : page.items.length === 0 ? (
          <Card className="p-6 text-center text-[0.84rem] font-bold text-mist-500">Queue is empty — or the filters are.</Card>
        ) : (
          <ul className="grid gap-2">
            {page.items.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(row.id)}
                  className={`w-full rounded-2xl border px-3.5 py-3 text-left transition ${openId === row.id ? 'border-nova-400/45 bg-nova-500/10' : 'border-white/8 bg-white/4 hover:border-white/20'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[0.68rem] font-black text-mist-500">#{row.id}</span>
                    <p className="min-w-0 flex-1 truncate text-[0.88rem] font-extrabold text-mist-50">{row.subject}</p>
                    {row.staff_unread > 0 && <span className="grid size-5 place-items-center rounded-full bg-flare-500 text-[0.6rem] font-black text-white">{row.staff_unread}</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[0.74rem] font-semibold text-mist-400">
                    {row.student?.name ?? 'Player'} — {row.preview}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Chip className={STATUS_STYLE[row.status] ?? ''}>{row.status_label}</Chip>
                    <Chip className="border-white/12 bg-white/6 text-mist-400">{row.category_label}</Chip>
                    {row.assignee ? (
                      <Chip className="border-emerald-400/25 bg-emerald-500/8 text-emerald-300">@{row.assignee.split('@')[0]}</Chip>
                    ) : (
                      <Chip className="border-amber-400/25 bg-amber-500/8 text-amber-300">unassigned</Chip>
                    )}
                    <span className="ml-auto text-[0.64rem] font-black text-mist-600">{row.last_message_at ? formatRelative(row.last_message_at) : ''}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openId !== null && page ? (
        <TicketPanel id={openId} staff={page.staff} onMutated={load} toast={toast} />
      ) : (
        <Card className="hidden items-center justify-center p-8 text-center lg:flex">
          <div>
            <UserCog className="mx-auto size-7 text-mist-600" />
            <p className="mt-2 text-[0.84rem] font-bold text-mist-500">Pick a ticket to open the conversation.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

function TicketPanel({
  id,
  staff,
  onMutated,
  toast,
}: {
  id: number;
  staff: {email: string; name: string}[];
  onMutated: () => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [data, setData] = useState<{ticket: TicketRow & Json; messages: Message[]} | null>(null);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.admin
      .supportTicket(id)
      .then((payload) => setData(payload as unknown as {ticket: TicketRow & Json; messages: Message[]}))
      .catch(() => setData(null));
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', message);
      load();
      onMutated();
    } catch (error) {
      toast('error', 'That did not land', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data)
    return (
      <Card className="flex items-center justify-center p-8">
        <Loader2 className="size-5 animate-spin text-mist-500" />
      </Card>
    );
  const ticket = data.ticket;

  return (
    <Card className="flex max-h-[calc(100dvh-8rem)] min-w-0 flex-col !p-3.5 lg:sticky lg:top-20">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/8 pb-2.5">
        <p className="min-w-0 flex-1 text-[0.9rem] font-black text-mist-50">
          #{ticket.id} · {ticket.subject}
        </p>
        <Chip className={STATUS_STYLE[ticket.status] ?? ''}>{ticket.status_label}</Chip>
      </div>
      <p className="mt-1.5 text-[0.72rem] font-bold text-mist-500">
        {ticket.student?.name ?? 'Player'} · {ticket.category_label} · {ticket.created_at ? formatRelative(String(ticket.created_at)) : ''}
      </p>

      <ul className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {data.messages.map((message) => {
          const mine = message.author_kind === 'staff';
          if (message.author_kind === 'system')
            return (
              <li key={message.id} className="mx-auto max-w-[92%] rounded-full bg-white/6 px-3 py-1 text-center text-[0.68rem] font-black text-mist-400">
                {message.body}
              </li>
            );
          return (
            <li key={message.id} className={`flex items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
              {!mine && <Avatar name={message.author_name || 'Player'} size={22} />}
              <div
                className={`max-w-[85%] rounded-2xl px-2.5 py-1.5 text-[0.8rem] leading-relaxed font-semibold whitespace-pre-wrap ${
                  message.internal ? 'border border-amber-400/30 bg-amber-500/10 text-amber-100' : mine ? 'rounded-br-md bg-emerald-500/15 text-mist-50' : 'rounded-bl-md bg-white/7 text-mist-100'
                }`}
              >
                {message.internal && (
                  <p className="mb-0.5 flex items-center gap-1 text-[0.6rem] font-black tracking-wide uppercase">
                    <Lock className="size-2.5" /> internal note
                  </p>
                )}
                {message.body}
                <p className="mt-0.5 text-right text-[0.58rem] font-bold opacity-60">{message.created_at ? formatRelative(message.created_at) : ''}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 border-t border-white/8 pt-2">
        <div className="flex items-end gap-1.5">
          <TextInput
            className="flex-1"
            placeholder={internal ? 'Note for staff only…' : 'Reply to the player…'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim())
                void act(() => api.admin.supportReply(id, {body: draft.trim(), internal}), internal ? 'Note saved' : 'Reply sent');
            }}
          />
          <Button size="sm" variant={internal ? 'outline' : 'mint'} loading={busy} onClick={() => draft.trim() && void act(() => api.admin.supportReply(id, {body: draft.trim(), internal}), internal ? 'Note saved' : 'Reply sent')} icon={<Send className="size-3.5" />}>
            <span className="sr-only">Send</span>
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[0.68rem] font-black text-mist-400">
            <input type="checkbox" className="size-3.5 accent-amber-400" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
            internal note
          </label>
          <Select
            className="ml-auto min-w-40 sm:max-w-52"
            value={String(ticket.status ?? 'open')}
            onChange={(event) => void act(() => api.admin.supportUpdate(id, {status: event.target.value}), 'Status updated')}
          >
            {['open', 'in_progress', 'waiting_user', 'resolved', 'closed'].map((value) => (
              <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>
            ))}
          </Select>
          <Select
            className="min-w-36 sm:max-w-44"
            value={String(ticket.assignee ?? '')}
            onChange={(event) => void act(() => api.admin.supportUpdate(id, {assignee: event.target.value}), 'Assigned')}
          >
            <option value="">Unassigned</option>
            {staff.map((row) => (
              <option key={row.email} value={row.email}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[0.62rem] font-bold text-mist-600">
          <CheckCircle2 className="size-3 text-emerald-400" />
          Player replies keep the ticket yours until it is resolved; replies and status flips ping the player's bell.
        </p>
      </div>
    </Card>
  );
}
