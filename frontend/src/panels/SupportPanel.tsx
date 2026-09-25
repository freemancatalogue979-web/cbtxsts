/**
 * Customer Support — real tickets, real conversation.
 *
 * Bug, wrong question, shop trouble: it becomes a numbered ticket with a
 * threaded chat. Staff replies ping your bell (inbox + websocket, same rails
 * as everything else) and the full history stays attached to the ticket.
 */
import {ArrowLeft, CheckCircle2, CircleHelp, LifeBuoy, Paperclip, Plus, Send} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Avatar, Button, Card, Chip, EmptyState, Field, Modal, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useSession} from '../store/session';



interface Ticket {
  id: number;
  status: string;
  status_label: string;
  category: string;
  category_label: string;
  subject: string;
  preview: string;
  created_at: string | null;
  last_message_at: string | null;
  student_unread: number;
  attachment_url: string;
  attachment_name: string;
  assignee: string;
}
interface Message {
  id: number;
  author_kind: 'student' | 'staff' | 'system';
  author_name: string;
  body: string;
  created_at: string | null;
}

const CATEGORIES: [string, string][] = [
  ['bug', 'Bug'],
  ['question', 'Question'],
  ['account', 'Account'],
  ['quiz', 'Quiz / exam'],
  ['duel', 'Duel'],
  ['ranked', 'Ranked'],
  ['study_group', 'Study Group'],
  ['shop', 'Shop / payment'],
  ['other', 'Other'],
];
const STATUS_STYLE: Record<string, string> = {
  open: 'border-nova-400/35 bg-nova-500/12 text-nova-200',
  in_progress: 'border-violet-400/35 bg-violet-500/12 text-violet-200',
  waiting_user: 'border-amber-400/40 bg-amber-500/12 text-amber-300',
  resolved: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300',
  closed: 'border-white/12 bg-white/6 text-mist-400',
};

export default function SupportPanel() {
  const {toast} = useSession();
  const [openTicket, setOpenTicket] = useState<number | null>(null);
  const [page, setPage] = useState<{items: Ticket[]; total: number; unread: number} | null>(null);
  const [offset, setOffset] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const limit = 10;

  const load = useCallback(() => {
    api
      .supportTickets({limit, offset})
      .then((data) => setPage(data as unknown as {items: Ticket[]; total: number; unread: number}))
      .catch(() => setPage({items: [], total: 0, unread: 0}));
  }, [offset]);
  useEffect(load, [load]);

  if (openTicket !== null) {
    return (
      <TicketThread
        id={openTicket}
        onBack={() => {
          setOpenTicket(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-3">
      <Card className="flex flex-wrap items-center gap-3 !p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-nova-500/15 text-nova-300">
          <LifeBuoy className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[1rem] font-black text-mist-50">Customer Support</p>
          <p className="text-[0.74rem] font-semibold text-mist-400">Tickets stay numbered and threaded — nothing gets lost in chat.</p>
        </div>
        {(page?.unread ?? 0) > 0 && <Chip className={STATUS_STYLE.open}>● {page?.unread} new reply</Chip>}
        <Button size="sm" variant="mint" onClick={() => setNewOpen(true)} icon={<Plus className="size-4" />}>
          New request
        </Button>
      </Card>

      {!page ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : page.items.length === 0 ? (
        <EmptyState icon={<CircleHelp className="size-6" />} title="No tickets — that's good" detail="Report a bug, ask a question or flag a wrong question; staff answer here." />
      ) : (
        <ul className="grid gap-2">
          {page.items.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => setOpenTicket(ticket.id)}
                className="w-full rounded-3xl border border-white/8 bg-white/4 px-3.5 py-3 text-left transition hover:border-nova-400/30"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[0.7rem] font-black text-mist-500">#{ticket.id}</span>
                  <p className="min-w-0 flex-1 truncate text-[0.9rem] font-extrabold text-mist-50">{ticket.subject}</p>
                  {ticket.student_unread > 0 && <span className="grid size-5 place-items-center rounded-full bg-flare-500 text-[0.62rem] font-black text-white">{ticket.student_unread}</span>}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[0.76rem] font-semibold text-mist-400">{ticket.preview}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Chip className={STATUS_STYLE[ticket.status] ?? ''}>{ticket.status_label}</Chip>
                  <Chip className="border-white/12 bg-white/6 text-mist-400">{ticket.category_label}</Chip>
                  <span className="text-[0.66rem] font-black text-mist-600">{ticket.last_message_at ? formatRelative(ticket.last_message_at) : ''}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {page && page.total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-[0.72rem] font-black text-mist-500">
            {offset + 1}–{Math.min(offset + limit, page.total)} of {page.total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={offset + limit >= page.total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      )}

      <NewTicketModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          load();
          setOpenTicket(id);
        }}
        toast={toast}
      />
    </div>
  );
}

function NewTicketModal({
  open,
  onClose,
  onCreated,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [category, setCategory] = useState('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (subject.trim().length < 4 || message.trim().length < 3) {
      toast('info', 'A little more detail', 'Give the subject and the first message some substance so staff can act.');
      return;
    }
    setBusy(true);
    try {
      const data = (await api.supportOpen({
        category,
        subject: subject.trim(),
        message: message.trim(),
        attachment_url: attachment.trim(),
        attachment_name: attachment.trim() ? attachment.split('/').pop()?.slice(0, 160) ?? '' : '',
      })) as unknown as {ticket: Ticket};
      toast('success', `Ticket #${data.ticket.id} opened`, 'Staff will answer here — and ping your bell.');
      setSubject('');
      setMessage('');
      setAttachment('');
      onCreated(data.ticket.id);
    } catch (error) {
      toast('error', 'Could not open the ticket', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New support request"
      subtitle="One ticket, one thread — you can follow up any time."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy} icon={<Send className="size-4" />}>Send to staff</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Category">
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Subject">
          <TextInput value={subject} maxLength={200} placeholder="e.g. Ranked match ended but my points didn't update" onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field label="Message" hint="What happened, when, and what you expected.">
          <TextArea rows={5} value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} />
        </Field>
        <Field label="Attachment link (optional)" hint="Paste a public image/screenshot URL if you have one.">
          <TextInput value={attachment} maxLength={400} placeholder="https://…" onChange={(event) => setAttachment(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function TicketThread({id, onBack}: {id: number; onBack: () => void}) {
  const {toast} = useSession();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    api
      .supportTicket(id)
      .then((data) => {
        const payload = data as unknown as {ticket: Ticket; messages: Message[]; can_reply: boolean};
        setTicket(payload.ticket);
        setMessages(payload.messages);
      })
      .catch(() => setTicket(null));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({block: 'nearest'});
  }, [messages.length]);

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const data = (await api.supportReply(id, {body: draft.trim()})) as unknown as {messages: Message[]};
      setMessages(data.messages);
      setDraft('');
      load();
    } catch (error) {
      toast('error', 'Message stuck', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!ticket) return <Skeleton className="h-64 rounded-3xl" />;
  const closed = ticket.status === 'closed';

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-3">
      <Card className="flex flex-wrap items-center gap-2.5 !p-3.5">
        <Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
          Tickets
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.92rem] font-black text-mist-50">
            #{ticket.id} · {ticket.subject}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Chip className={STATUS_STYLE[ticket.status] ?? ''}>{ticket.status_label}</Chip>
            <Chip className="border-white/12 bg-white/6 text-mist-400">{ticket.category_label}</Chip>
            {ticket.assignee && <Chip className="border-emerald-400/25 bg-emerald-500/8 text-emerald-300">with {ticket.assignee.split('@')[0]}</Chip>}
          </div>
        </div>
      </Card>

      <Card className="!p-3">
        <ul className="grid max-h-[54vh] gap-2 overflow-y-auto overscroll-contain pr-0.5">
          {messages.map((message) => {
            const mine = message.author_kind === 'student';
            if (message.author_kind === 'system') {
              return (
                <li key={message.id} className="mx-auto max-w-[90%] rounded-full bg-white/6 px-3 py-1 text-center text-[0.7rem] font-black text-mist-400">
                  {message.body}
                </li>
              );
            }
            return (
              <li key={message.id} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                {!mine && <Avatar name={message.author_name || 'Staff'} size={26} />}
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${mine ? 'rounded-br-md bg-nova-500/18 text-mist-50' : 'rounded-bl-md bg-white/7 text-mist-100'}`}>
                  {!mine && <p className="mb-0.5 text-[0.64rem] font-black tracking-wide text-emerald-300 uppercase">{message.author_name || 'Staff'}</p>}
                  <p className="text-[0.84rem] leading-relaxed font-semibold whitespace-pre-wrap">{message.body}</p>
                  <p className="mt-1 text-right text-[0.6rem] font-bold text-mist-500">{message.created_at ? formatRelative(message.created_at) : ''}</p>
                </div>
              </li>
            );
          })}
          {ticket.attachment_url && (
            <li className="flex justify-end">
              <a href={ticket.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-nova-400/30 bg-nova-500/10 px-2.5 py-1.5 text-[0.74rem] font-black text-nova-200">
                <Paperclip className="size-3.5" /> {ticket.attachment_name || 'attachment'}
              </a>
            </li>
          )}
        </ul>
        <div ref={bottomRef} />
      </Card>

      {!closed ? (
        <Card className="!p-3">
          <div className="flex items-end gap-2">
            <TextArea
              rows={2}
              className="flex-1"
              value={draft}
              maxLength={4000}
              placeholder="Add a follow-up…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
              }}
            />
            <Button size="sm" variant="mint" loading={busy} onClick={() => void send()} icon={<Send className="size-4" />}>
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p className="mt-1.5 text-[0.64rem] font-bold text-mist-600">Ctrl/⌘ + Enter sends. Staff replies also land in your bell.</p>
        </Card>
      ) : (
        <Card className="flex items-center gap-2 !p-3.5 text-[0.82rem] font-bold text-mist-400">
          <CheckCircle2 className="size-4 text-emerald-300" /> This ticket is closed — open a new request and quote #{ticket.id} to continue it.
        </Card>
      )}
    </div>
  );
}
