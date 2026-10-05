/** Messages — one inbox for teacher ↔ student (and existing friend) conversations. */
import {ArrowLeft, Check, CheckCheck, FileText, Flag, GraduationCap, ListChecks, Loader2, Lock, MessageSquare, MessagesSquare, MoreVertical, Paperclip, Search, Send, Share2, ShieldOff, Users} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {ApiError, api} from '../lib/api';
import {fileUrl, formatBytes, teachers, type Conversation, type TMaterial, type TQuiz} from '../lib/teachers';
import type {ChatMessage} from '../lib/types';
import {Empty, LoadingRows, PageHeader} from '../pro/ui';
import {useSession} from '../store/session';
import {MaterialSheet, QuizRunner, ReportSheet} from './content';
import {ActionMenu, PersonAvatar, ProScope, activeLabel, Sheet, clockTime, dayLabel, goTo, takeIntent, timeAgo, useLive} from './ui';
import {askConfirm} from '../components/ui';

const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
const ROLE_LABEL: Record<Conversation['role'], string> = {teacher: 'Your teacher', student: 'Your student', request: 'Request', friend: 'Friend'};

export default function Messages() {
  const {profile, onlineIds, setChatFocus, refreshChatUnread} = useSession();
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(() => {
    const raw = takeIntent('ag.msg.with');
    return raw ? Number(raw) : null;
  });
  const [term, setTerm] = useState('');
  const [blockedOpen, setBlockedOpen] = useState(false);

  const load = useCallback(() => {
    teachers
      .conversations()
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent<{tab?: string; withId?: number}>).detail;
      if (detail?.tab === 'messages' && detail.withId) {
        takeIntent('ag.msg.with');
        setActiveId(detail.withId);
      }
    };
    window.addEventListener('ag:navigate', onNav);
    return () => window.removeEventListener('ag:navigate', onNav);
  }, []);

  // Keep the list fresh as messages arrive anywhere.
  useLive('chat', () => load());
  useLive('notify', () => load());

  useEffect(() => {
    setChatFocus(activeId);
    return () => setChatFocus(null);
  }, [activeId, setChatFocus]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (items ?? []).filter((c) => !needle || c.with.name.toLowerCase().includes(needle) || c.with.username.toLowerCase().includes(needle));
  }, [items, term]);
  const active = items?.find((c) => c.with.id === activeId) ?? null;

  return (
    <ProScope>
      <div className={activeId ? 'max-md:hidden' : ''}>
        <PageHeader eyebrow="Inbox" hue="blue" icon={<MessagesSquare />} title="Messages" description="Conversations with your teachers, students and friends. Contact details stay private." />
      </div>
      <section className="pro-card t-chat">
        <div className={`t-chat-list ${activeId ? 'max-[899px]:hidden' : ''}`}>
          <div className="grid gap-2 border-b p-3" style={{borderColor: 'var(--pro-border)'}}>
            <label className="pro-search min-w-0">
              <Search />
              <input className="pro-input w-full" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items === null && (
              <div className="p-3">
                <LoadingRows rows={4} />
              </div>
            )}
            {items && filtered.length === 0 && (
              <Empty
                icon={<MessageSquare className="size-6" />}
                hue="blue"
                title={term ? 'No matches' : 'No conversations yet'}
                body={term ? undefined : 'When a teacher accepts your request — or you send one — you can chat here.'}
                action={
                  !term && (
                    <button type="button" className="pro-btn pro-btn-sm" onClick={() => goTo({tab: 'teachers'})}>
                      <GraduationCap className="size-4" /> Find a teacher
                    </button>
                  )
                }
              />
            )}
            {filtered.map((c) => (
              <button
                key={c.with.id}
                type="button"
                className="t-row t-row-btn border-b"
                style={{borderColor: 'var(--pro-border)', background: c.with.id === activeId ? 'var(--pro-hover)' : undefined}}
                onClick={() => setActiveId(c.with.id)}
              >
                <PersonAvatar id={c.with.id} name={c.with.name} hue={c.with.avatar_hue} hasPhoto={c.with.has_photo} size={44} online={onlineIds.includes(c.with.id)} ring={c.role === 'teacher' ? 'brand' : c.role === 'student' ? 'hue' : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[0.9rem] font-semibold">{c.with.name}</span>
                    <span className="pro-meta shrink-0">{c.last ? timeAgo(c.last.created_at) : ''}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="pro-meta truncate" style={{color: c.unread ? 'var(--pro-text)' : undefined, fontWeight: c.unread ? 650 : undefined}}>
                      {c.blocked ? 'Blocked' : c.last ? `${c.last.mine ? 'You: ' : ''}${c.last.body}` : ROLE_LABEL[c.role]}
                    </span>
                    {c.unread > 0 ? <span className="t-unread">{c.unread}</span> : c.role !== 'friend' && <span className="t-topic shrink-0 whitespace-nowrap !py-0 !text-[0.65rem]">{ROLE_LABEL[c.role]}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t p-2" style={{borderColor: 'var(--pro-border)'}}>
            <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm w-full" onClick={() => setBlockedOpen(true)}>
              <ShieldOff className="size-4" /> Blocked people
            </button>
          </div>
        </div>

        <div className={`t-chat-thread ${activeId ? '' : 'max-[899px]:hidden'}`}>
          {activeId && profile ? (
            <Thread
              key={activeId}
              meId={profile.id}
              otherId={activeId}
              conversation={active}
              online={onlineIds.includes(activeId)}
              onBack={() => setActiveId(null)}
              onChanged={() => {
                load();
                refreshChatUnread();
              }}
            />
          ) : (
            <div className="grid h-full place-items-center p-6">
              <Empty icon={<MessageSquare className="size-6" />} hue="violet" title="Select a conversation" body="Share files, materials and quizzes right in the chat." />
            </div>
          )}
        </div>
      </section>
      <BlockedSheet open={blockedOpen} onClose={() => setBlockedOpen(false)} onChanged={load} />
    </ProScope>
  );
}

function Thread({meId, otherId, conversation, online, onBack, onChanged}: {meId: number; otherId: number; conversation: Conversation | null; online: boolean; onBack: () => void; onChanged: () => void}) {
  const {toast, refreshChatUnread} = useSession();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [report, setReport] = useState<{kind: string; id: number; label: string} | null>(null);
  const [share, setShare] = useState(false);
  const [material, setMaterial] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const typingTimer = useRef<number | null>(null);
  const isTeacherHere = conversation?.role === 'student' || conversation?.role === 'request';
  const other = conversation?.with;

  const markRead = useCallback(() => {
    api
      .markChatRead(otherId)
      .then(() => refreshChatUnread())
      .catch(() => {});
  }, [otherId, refreshChatUnread]);

  useEffect(() => {
    api
      .chatWith(otherId)
      .then((res) => {
        setMessages(res.messages);
        markRead();
        onChanged();
      })
      .catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useLive('chat', (data) => {
    const msg = data as ChatMessage;
    const mine = msg.sender_id === meId && msg.recipient_id === otherId;
    const theirs = msg.sender_id === otherId && msg.recipient_id === meId;
    if (!mine && !theirs) return;
    setMessages((current) => (current && !current.some((m) => m.id === msg.id) ? [...current, msg] : current));
    if (theirs) {
      setTyping(false);
      markRead();
    }
  });
  useLive('chat_edit', (data) => {
    const msg = data as ChatMessage;
    setMessages((current) => current?.map((m) => (m.id === msg.id ? {...m, ...msg} : m)) ?? current);
  });
  useLive('chat_read', (data) => {
    const payload = data as {by: number; ids: number[]};
    if (payload.by !== otherId) return;
    setMessages((current) => current?.map((m) => (payload.ids.includes(m.id) ? {...m, read: true} : m)) ?? current);
  });
  useLive('typing', (data) => {
    if ((data as {from: number}).from !== otherId) return;
    setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 4000);
  });

  const send = async (payload: {kind?: ChatMessage['kind']; body?: string; meta?: Record<string, unknown>}) => {
    setSending(true);
    try {
      const msg = await api.sendChat({to: otherId, ...payload});
      setMessages((current) => (current && !current.some((m) => m.id === msg.id) ? [...current, msg] : current));
      onChanged();
      return true;
    } catch (e) {
      toast('error', 'Not sent', errText(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendText = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    const ok = await send({kind: 'text', body});
    if (!ok) setDraft(body);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && window.matchMedia('(min-width: 768px)').matches) {
      event.preventDefault();
      void sendText();
    }
  };

  const onDraft = (value: string) => {
    setDraft(value);
    if (Date.now() - typingSent.current > 3000 && value.trim()) {
      typingSent.current = Date.now();
      void teachers.typing(otherId).catch(() => {});
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast('error', 'File too large', 'Attachments can be at most 15 MB.');
      return;
    }
    setUploading(true);
    try {
      const stored = await teachers.upload(file, 'chat');
      await send({kind: 'file', meta: {id: stored.id}, body: draft.trim()});
      setDraft('');
    } catch (e) {
      toast('error', 'Upload failed', errText(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const block = async () => {
    if (!(await askConfirm(`Block ${other?.name ?? 'this person'}? Neither of you will be able to message the other.`))) return;
    await teachers.block(otherId);
    toast('info', 'Blocked');
    onChanged();
    onBack();
  };

  const rows = useMemo(() => {
    const out: ({type: 'day'; label: string} | {type: 'msg'; msg: ChatMessage})[] = [];
    let last = '';
    for (const msg of messages ?? []) {
      const label = dayLabel(msg.created_at);
      if (label !== last) {
        out.push({type: 'day', label});
        last = label;
      }
      out.push({type: 'msg', msg});
    }
    return out;
  }, [messages]);
  const lastMine = [...(messages ?? [])].reverse().find((m) => m.sender_id === meId);

  return (
    <>
      <header className="t-chat-head">
        <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm min-[900px]:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </button>
        <PersonAvatar id={otherId} name={other?.name ?? '…'} hue={other?.avatar_hue} hasPhoto={other?.has_photo} size={40} online={online} ring={conversation?.role === 'teacher' ? 'brand' : conversation?.role === 'student' ? 'hue' : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{other?.name ?? 'Conversation'}</p>
          <p className="pro-meta truncate">
            {typing ? 'typing…' : online ? 'Online' : other?.last_active ? activeLabel(other.last_active) : conversation ? ROLE_LABEL[conversation.role] : ''}
            {conversation && conversation.role !== 'friend' && !typing ? ` · ${ROLE_LABEL[conversation.role]}` : ''}
          </p>
        </div>
        {isTeacherHere && (
          <button type="button" className="pro-btn pro-btn-sm max-sm:hidden" onClick={() => goTo({tab: 'studio', view: 'students'})}>
            <Users className="size-4" /> Student
          </button>
        )}
        <ActionMenu
          label="Conversation options"
          triggerClassName="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm"
          icon={<MoreVertical className="size-4" />}
          items={[
            {key: 'report', label: 'Report person', detail: 'Staff review it privately', icon: <Flag />, onSelect: () => setReport({kind: 'teacher_student', id: otherId, label: other?.name ?? 'Player'})},
            {key: 'block', label: 'Block', detail: 'No messages either way', icon: <Lock />, danger: true, onSelect: () => void block()},
          ]}
        />
      </header>

      <div className="t-chat-scroll" ref={scrollRef} aria-live="polite">
        {error && <p className="pro-secondary p-4 text-center">{error}</p>}
        {messages === null && !error && <LoadingRows rows={4} />}
        {messages && messages.length === 0 && (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="grid max-w-xs gap-2">
              <p className="pro-h3">Say hello</p>
              <p className="pro-secondary">Keep conversations on Genesis — never share passwords or pay anyone off-platform.</p>
            </div>
          </div>
        )}
        {rows.map((row, i) =>
          row.type === 'day' ? (
            <span key={`d${i}`} className="t-day">
              {row.label}
            </span>
          ) : (
            <MessageBubble
              key={row.msg.id}
              msg={row.msg}
              mine={row.msg.sender_id === meId}
              showSeen={row.msg.id === lastMine?.id}
              onOpenMaterial={setMaterial}
              onOpenQuiz={setQuiz}
              onReport={() => setReport({kind: 'chat_message', id: row.msg.id, label: 'Message'})}
            />
          ),
        )}
        {typing && (
          <div className="t-msg">
            <div className="t-bubble">
              <span className="t-typing" aria-label="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      {conversation?.blocked ? (
        <div className="t-composer justify-center">
          <p className="pro-meta">You blocked this person. Unblock from Blocked people to message again.</p>
        </div>
      ) : (
        <div className="t-composer">
          <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif" onChange={(e) => void attach(e.target.files?.[0])} />
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon shrink-0" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Attach a file" title="Attach a file (max 15 MB)">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>
          {isTeacherHere && (
            <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon shrink-0" onClick={() => setShare(true)} aria-label="Share a material or quiz" title="Share a material or quiz">
              <Share2 className="size-4" />
            </button>
          )}
          <textarea className="pro-input" rows={1} value={draft} onChange={(e) => onDraft(e.target.value)} onKeyDown={onKey} placeholder="Write a message" maxLength={600} aria-label="Message" />
          <button type="button" className="pro-btn pro-btn-primary pro-btn-icon shrink-0" onClick={() => void sendText()} disabled={!draft.trim() || sending} aria-label="Send" title="Send">
            <Send className="size-4" />
          </button>
        </div>
      )}

      <ShareSheet
        open={share}
        onClose={() => setShare(false)}
        onPick={async (kind, item) => {
          const ok = await send({kind, meta: {id: item.id}});
          if (ok) setShare(false);
        }}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      <MaterialSheet id={material} onClose={() => setMaterial(null)} />
      <QuizRunner quizId={quiz} onClose={() => setQuiz(null)} />
    </>
  );
}

function MessageBubble({msg, mine, showSeen, onOpenMaterial, onOpenQuiz, onReport}: {msg: ChatMessage; mine: boolean; showSeen: boolean; onOpenMaterial: (id: number) => void; onOpenQuiz: (id: number) => void; onReport: () => void}) {
  const meta = msg.meta as {id?: number; name?: string; size?: number; mime?: string; is_image?: boolean; title?: string; topic?: string; subject?: string; questions?: number; minutes?: number};
  let content: React.ReactNode;
  if (msg.deleted) content = <div className="t-bubble opacity-60">This message was deleted</div>;
  else if (msg.kind === 'file' && meta.id) {
    content = (
      <div className="grid gap-1.5">
        {meta.is_image ? (
          <a href={fileUrl(meta.id)} target="_blank" rel="noopener noreferrer">
            <img src={fileUrl(meta.id)} alt={meta.name} className="max-h-64 max-w-full rounded-2xl border object-cover" style={{borderColor: 'var(--pro-border)'}} loading="lazy" />
          </a>
        ) : (
          <a className="t-attach" href={fileUrl(meta.id, true)}>
            <span className="t-attach-icon">
              <FileText />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.85rem] font-semibold">{meta.name}</span>
              <span className="pro-meta">{formatBytes(meta.size ?? 0)} · Download</span>
            </span>
          </a>
        )}
        {msg.body && <div className="t-bubble">{msg.body}</div>}
      </div>
    );
  } else if ((msg.kind === 'material' || msg.kind === 'tquiz') && meta.id) {
    const quiz = msg.kind === 'tquiz';
    content = (
      <button type="button" className="t-attach" onClick={() => (quiz ? onOpenQuiz(meta.id!) : onOpenMaterial(meta.id!))}>
        <span className="t-attach-icon" style={{['--mark' as string]: quiz ? 'var(--pro-h-green)' : 'var(--pro-h-blue)'}}>
          {quiz ? <ListChecks /> : <FileText />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="pro-eyebrow block">{quiz ? 'Quiz' : 'Material'}</span>
          <span className="block truncate text-[0.88rem] font-semibold">{meta.title}</span>
          <span className="pro-meta block truncate">{quiz ? `${meta.questions ?? 0} questions${meta.minutes ? ` · ${meta.minutes} min` : ''} · Tap to start` : `${meta.topic || meta.subject || 'Open'} · Tap to read`}</span>
        </span>
      </button>
    );
  } else if (msg.kind === 'duel') content = <div className="t-bubble">⚔ Duel invite{msg.body ? ` — ${msg.body}` : ''}</div>;
  else if (msg.kind === 'quiz') content = <div className="t-bubble">Quiz plan{msg.body ? ` — ${msg.body}` : ''}</div>;
  else content = <div className="t-bubble">{msg.body}</div>;

  return (
    <div className="t-msg group" data-mine={mine ? '' : undefined}>
      {content}
      <span className="t-msg-meta">
        {clockTime(msg.created_at)}
        {msg.edited_at && ' · edited'}
        {mine && showSeen && (msg.read ? <CheckCheck className="size-3.5" style={{color: 'var(--pro-accent-text)'}} aria-label="Seen" /> : <Check className="size-3.5" aria-label="Sent" />)}
        {mine && showSeen && (msg.read ? 'Seen' : 'Sent')}
        {!mine && !msg.deleted && (
          <button type="button" className="opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={onReport} aria-label="Report message" title="Report message">
            <Flag className="size-3" />
          </button>
        )}
      </span>
    </div>
  );
}

function ShareSheet({open, onClose, onPick}: {open: boolean; onClose: () => void; onPick: (kind: 'material' | 'tquiz', item: {id: number}) => Promise<void>}) {
  const [materials, setMaterials] = useState<TMaterial[] | null>(null);
  const [quizzes, setQuizzes] = useState<TQuiz[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    teachers.materials().then((r) => setMaterials(r.items)).catch(() => setMaterials([]));
    teachers.quizzes().then((r) => setQuizzes(r.items.filter((q) => q.status === 'published'))).catch(() => setQuizzes([]));
  }, [open]);
  const pick = async (kind: 'material' | 'tquiz', id: number) => {
    setBusy(`${kind}${id}`);
    await onPick(kind, {id});
    setBusy(null);
  };
  return (
    <Sheet open={open} onClose={onClose} icon={<Share2 />} title="Share with this student" subtitle="They get access straight away, even to private items.">
      {(materials === null || quizzes === null) && <LoadingRows rows={3} />}
      {materials && quizzes && materials.length + quizzes.length === 0 && <Empty title="Nothing to share yet" body="Create materials and publish quizzes in Teacher Studio." />}
      <div className="grid gap-2">
        {quizzes?.map((q) => (
          <button key={`q${q.id}`} type="button" className="t-attach" disabled={!!busy} onClick={() => void pick('tquiz', q.id)}>
            <span className="t-attach-icon" style={{['--mark' as string]: 'var(--pro-h-green)'}}>
              <ListChecks />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{q.title}</span>
              <span className="pro-meta">Quiz · {q.question_count} questions</span>
            </span>
            {busy === `tquiz${q.id}` && <Loader2 className="size-4 animate-spin" />}
          </button>
        ))}
        {materials?.map((m) => (
          <button key={`m${m.id}`} type="button" className="t-attach" disabled={!!busy} onClick={() => void pick('material', m.id)}>
            <span className="t-attach-icon">
              <FileText />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{m.title}</span>
              <span className="pro-meta">Material · {m.topic || m.subject || m.kind}</span>
            </span>
            {busy === `material${m.id}` && <Loader2 className="size-4 animate-spin" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function BlockedSheet({open, onClose, onChanged}: {open: boolean; onClose: () => void; onChanged: () => void}) {
  const [items, setItems] = useState<{id: number; name: string; avatar_hue: number; has_photo: boolean}[] | null>(null);
  const load = useCallback(() => {
    teachers.blocks().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  return (
    <Sheet open={open} onClose={onClose} size="sm" icon={<ShieldOff />} title="Blocked people" subtitle="Blocked people can't message you or see you in teacher search.">
      {items === null && <LoadingRows rows={2} />}
      {items && items.length === 0 && <p className="pro-secondary">You haven't blocked anyone.</p>}
      <div className="grid gap-2">
        {items?.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <PersonAvatar id={p.id} name={p.name} hue={p.avatar_hue} hasPhoto={p.has_photo} size={34} />
            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
            <button
              type="button"
              className="pro-btn pro-btn-sm"
              onClick={async () => {
                await teachers.unblock(p.id);
                load();
                onChanged();
              }}
            >
              Unblock
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
