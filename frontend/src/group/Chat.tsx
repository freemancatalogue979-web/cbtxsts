/**
 * Real-time group chat. One page, its own internal message scroll — the
 * browser never grows. Sends are authoritative (REST), inbound messages,
 * edits, deletes, reactions and typing arrive over the group socket. Replies
 * carry a referenced-message preview that scrolls to and highlights the
 * original; long-press (or hover) opens message actions.
 */
import {Check, CornerDownLeft, MessageSquareReply, MoreHorizontal, Pencil, Send, Smile, Trash2} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Button, IconButton, Skeleton, TextInput} from '../components/ui';
import {Holdable} from '../components/Holdable';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {sfx} from '../lib/sfx';
import {useGroup} from './context';
import {MemberAvatar, PresenceDot} from './bits';
import type {GroupChatMessage, PresenceStatus} from '../lib/types';

const EMOJIS = ['👍', '❤️', '😂', '🔥', '🎉', '😮', '🤔', '✅'];
const PAGE_SIZE = 40;

function upsert(rows: GroupChatMessage[], message: GroupChatMessage): GroupChatMessage[] {
  const index = rows.findIndex((row) => row.id === message.id);
  if (index === -1) return [...rows, message];
  const next = rows.slice();
  next[index] = {...next[index], ...message, pending: false, failed: false};
  return next;
}

export default function Chat() {
  const {groupId, myId, myName, can, room, presence, notify, openMember} = useGroup();
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const typingSent = useRef(0);
  const highlightRef = useRef<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  const loadPage = useCallback(
    async (target: number, prepend: boolean) => {
      const payload = await api.groups.messages(groupId, {page: target, size: PAGE_SIZE});
      setHasMore(payload.page < payload.pages);
      setMessages((current) => {
        if (!prepend) return payload.items;
        const seen = new Set(current.map((row) => row.id));
        const older = payload.items.filter((row) => !seen.has(row.id));
        return [...older, ...current];
      });
      return payload;
    },
    [groupId],
  );

  /* First load + merge the socket snapshot (both are the newest window). */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadPage(1, false);
        if (alive) {
          setPage(1);
          setLoading(false);
          requestAnimationFrame(() => {
            listRef.current?.scrollTo({top: listRef.current.scrollHeight});
          });
        }
      } catch {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadPage]);

  /* Live inbound events. */
  useEffect(
    () =>
      room.on('group_message', (data) => {
        const message = data as GroupChatMessage;
        setMessages((current) => upsert(current, message));
        if (message.student_id !== myId) sfx.play('chat');
      }),
    [room, myId],
  );

  useEffect(
    () =>
      room.on('group_message_update', (data) => {
        const message = data as GroupChatMessage;
        setMessages((current) => upsert(current, message));
      }),
    [room],
  );

  useEffect(
    () =>
      room.on('group_typing', (data) => {
        const payload = data as {student_id: number; name: string};
        if (payload.student_id === myId) return;
        setTyping(payload.name.split(' ')[0]);
        window.setTimeout(() => setTyping((current) => (current === payload.name.split(' ')[0] ? null : current)), 2500);
      }),
    [room, myId],
  );

  /* Auto-scroll only when the reader is already at the bottom. */
  useEffect(() => {
    if (!stickToBottom.current) return;
    const list = listRef.current;
    if (list) list.scrollTo({top: list.scrollHeight, behavior: 'smooth'});
  }, [messages.length, typing]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  };

  const loadOlder = async () => {
    if (loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    const list = listRef.current;
    const prevHeight = list?.scrollHeight ?? 0;
    const next = page + 1;
    try {
      await loadPage(next, true);
      setPage(next);
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const tempId = -Date.now();
    const optimistic: GroupChatMessage = {
      id: tempId,
      group_id: groupId,
      student_id: myId,
      name: myName,
      initials: myName.slice(0, 1).toUpperCase(),
      avatar_hue: 265,
      has_photo: false,
      kind: 'text',
      body,
      deleted: false,
      created_at: new Date().toISOString(),
      edited_at: null,
      reactions: {},
      my_reactions: [],
      reply_to: replyTo ? {id: replyTo.id, student_id: replyTo.student_id, name: replyTo.name, body: replyTo.body, deleted: false} : null,
      pending: true,
    };
    setMessages((current) => [...current, optimistic]);
    setText('');
    stickToBottom.current = true;
    const replyId = replyTo?.id ?? null;
    setReplyTo(null);
    try {
      const confirmed = await api.groups.sendMessage(groupId, body, replyId);
      setMessages((current) => {
        const withoutTemp = current.filter((row) => row.id !== tempId);
        return upsert(withoutTemp, confirmed);
      });
    } catch (error) {
      setMessages((current) => current.map((row) => (row.id === tempId ? {...row, pending: false, failed: true} : row)));
      notify('error', 'Message not sent', (error as Error).message);
    }
  };

  const onComposerChange = (value: string) => {
    setText(value);
    const now = Date.now();
    if (now - typingSent.current > 1500) {
      typingSent.current = now;
      room.send({type: 'typing'});
    }
  };

  const startEdit = (message: GroupChatMessage) => {
    setEditingId(message.id);
    setEditText(message.body);
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const body = editText.trim();
    if (!body) return;
    try {
      const updated = await api.groups.editMessage(groupId, editingId, body);
      setMessages((current) => upsert(current, updated));
    } catch (error) {
      notify('error', 'Could not edit', (error as Error).message);
    } finally {
      setEditingId(null);
      setEditText('');
    }
  };

  const remove = async (message: GroupChatMessage) => {
    try {
      const updated = await api.groups.deleteMessage(groupId, message.id);
      setMessages((current) => upsert(current, updated));
    } catch (error) {
      notify('error', 'Could not delete', (error as Error).message);
    }
  };

  const react = async (message: GroupChatMessage, emoji: string) => {
    setReactFor(null);
    try {
      const updated = await api.groups.reactMessage(groupId, message.id, emoji);
      setMessages((current) => upsert(current, updated));
    } catch (error) {
      notify('error', 'Could not react', (error as Error).message);
    }
  };

  const jumpTo = (messageId: number) => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-mid="${messageId}"]`);
    if (node) {
      node.scrollIntoView({behavior: 'smooth', block: 'center'});
      highlightRef.current = messageId;
      setHighlight(messageId);
      window.setTimeout(() => setHighlight((current) => (current === messageId ? null : current)), 1600);
      return;
    }
    /* Not loaded yet — walk back through history a few pages to find it. */
    if (hasMore) {
      void (async () => {
        for (let step = 0; step < 5 && hasMore; step += 1) {
          await loadOlder();
          const found = listRef.current?.querySelector<HTMLElement>(`[data-mid="${messageId}"]`);
          if (found) {
            found.scrollIntoView({behavior: 'smooth', block: 'center'});
            setHighlight(messageId);
            window.setTimeout(() => setHighlight(null), 1600);
            return;
          }
        }
      })();
    }
  };

  const sorted = useMemo(() => messages, [messages]);

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="ml-auto h-12 w-1/2" />
        <Skeleton className="h-12 w-2/3" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{height: 0, opacity: 0}}
            animate={{height: 'auto', opacity: 1}}
            exit={{height: 0, opacity: 0}}
            className="overflow-hidden border-b border-white/8 bg-ink-900/60"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <CornerDownLeft className="size-4 shrink-0 text-nova-300" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.7rem] font-bold text-nova-300">Replying to {replyTo.name}</p>
                <p className="truncate text-[0.74rem] font-medium text-mist-400">{replyTo.body}</p>
              </div>
              <IconButton label="Cancel reply" onClick={() => setReplyTo(null)}>
                <span className="text-mist-500">✕</span>
              </IconButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* messages */}
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2.5 py-3 sm:px-3.5">
        {hasMore && (
          <div className="pb-2 text-center">
            <Button size="sm" variant="ghost" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </Button>
          </div>
        )}
        {sorted.length === 0 && (
          <p className="pt-10 text-center text-[0.8rem] font-semibold text-mist-600">
            No messages yet — say hi to the group.
          </p>
        )}
        {sorted.map((message) => {
          const mine = message.student_id === myId;
          const status = (presence[String(message.student_id)] ?? 'offline') as PresenceStatus;
          const isEditing = editingId === message.id;
          const isHighlight = highlight === message.id;
          const reactionEntries = Object.entries(message.reactions ?? {});
          return (
            <div
              key={message.id}
              data-mid={message.id}
              id={`gm-${message.id}`}
              className={`group/msg flex items-start gap-2 rounded-xl px-1.5 py-1 transition-colors ${isHighlight ? 'bg-nova-500/20 ring-1 ring-nova-400/40' : ''}`}
            >
              <button
                type="button"
                onClick={() => !mine && openMember(message.student_id)}
                className="shrink-0"
                aria-label={mine ? message.name : `View ${message.name}`}
              >
                <MemberAvatar member={message} size={30} status={mine ? undefined : status} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[0.72rem] font-extrabold text-mist-200">{mine ? 'You' : message.name}</span>
                  {!mine && <PresenceDot status={status} />}
                  <span className="ml-auto shrink-0 text-[0.62rem] font-semibold text-mist-600">{formatRelative(message.created_at)}</span>
                </div>

                <Holdable
                  hint="Hold for actions"
                  actions={[
                    {key: 'reply', label: 'Reply', icon: <MessageSquareReply className="size-4" />, onAction: () => setReplyTo(message)},
                    {key: 'react', label: 'React', icon: <Smile className="size-4" />, onAction: () => setReactFor(message.id)},
                    ...(mine
                      ? [
                          {key: 'edit', label: 'Edit', icon: <Pencil className="size-4" />, onAction: () => startEdit(message)},
                          {key: 'delete', label: 'Delete', icon: <Trash2 className="size-4" />, tone: 'danger' as const, onAction: () => remove(message)},
                        ]
                      : can('moderate_chat')
                        ? [{key: 'delete', label: 'Delete', icon: <Trash2 className="size-4" />, tone: 'danger' as const, onAction: () => remove(message)}]
                        : []),
                  ]}
                >
                  {message.deleted ? (
                    <p className="mt-0.5 inline-block rounded-2xl rounded-tl-md bg-white/4 px-3 py-1.5 text-[0.78rem] italic text-mist-600">
                      This message was deleted
                    </p>
                  ) : isEditing ? (
                    <div className="mt-1 flex gap-2">
                      <TextInput value={editText} onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveEdit()} autoFocus />
                      <Button size="sm" variant="primary" onClick={() => void saveEdit()}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-0.5">
                      {message.reply_to && !message.reply_to.deleted && (
                        <button
                          type="button"
                          onClick={() => jumpTo(message.reply_to!.id)}
                          className="mb-1 block w-full max-w-sm truncate rounded-lg border-l-2 border-nova-400/50 bg-white/4 px-2.5 py-1 text-left"
                        >
                          <span className="block text-[0.66rem] font-bold text-nova-300">{message.reply_to.name}</span>
                          <span className="block truncate text-[0.72rem] font-medium text-mist-400">{message.reply_to.body}</span>
                        </button>
                      )}
                      <span
                        className={`inline-block max-w-full rounded-2xl px-3 py-1.5 text-[0.82rem] leading-snug font-semibold break-words ${
                          mine ? 'brand-gradient rounded-tl-md text-white' : 'rounded-tl-md bg-white/8 text-mist-100'
                        }`}
                      >
                        {message.body}
                      </span>
                      <span className="ml-1.5 inline-flex items-center gap-1 align-bottom text-[0.6rem] font-bold text-mist-600">
                        {message.edited_at && <span className="italic">edited</span>}
                        {mine && (message.pending ? <span>· sending…</span> : message.failed ? <span className="text-flare-300">· failed</span> : <Check className="size-3 text-mint-400" />)}
                      </span>
                    </div>
                  )}
                </Holdable>

                {/* reactions */}
                {reactionEntries.length > 0 && !message.deleted && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {reactionEntries.map(([emoji, count]) => {
                      const active = (message.my_reactions ?? []).includes(emoji);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void react(message, emoji)}
                          className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[0.68rem] font-bold transition-colors ${
                            active ? 'border-nova-400/50 bg-nova-500/20 text-nova-100' : 'border-white/12 bg-white/5 text-mist-300 hover:border-nova-400/30'
                          }`}
                        >
                          <span>{emoji}</span>
                          <span className="tabular">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* inline emoji picker */}
                <AnimatePresence>
                  {reactFor === message.id && (
                    <motion.div initial={{opacity: 0, y: -4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} className="mt-1 flex flex-wrap gap-1">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void react(message, emoji)}
                          className="grid size-8 place-items-center rounded-lg border border-white/12 bg-ink-900/80 text-base hover:border-nova-400/40"
                        >
                          {emoji}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* desktop hover toolbar */}
              <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 sm:flex">
                <IconButton label="Reply" onClick={() => setReplyTo(message)}>
                  <MessageSquareReply className="size-4 text-mist-500" />
                </IconButton>
                <IconButton label="React" onClick={() => setReactFor((current) => (current === message.id ? null : message.id))}>
                  <Smile className="size-4 text-mist-500" />
                </IconButton>
                {mine && (
                  <IconButton label="Edit" onClick={() => startEdit(message)}>
                    <Pencil className="size-4 text-mist-500" />
                  </IconButton>
                )}
              </div>
            </div>
          );
        })}
        {typing && (
          <p className="px-2 text-[0.7rem] font-semibold text-mist-500">
            <span className="inline-flex items-center gap-1">
              {typing} is typing
              <span className="flex gap-0.5">
                <span className="size-1 animate-bounce rounded-full bg-mist-500 [animation-delay:-0.3s]" />
                <span className="size-1 animate-bounce rounded-full bg-mist-500 [animation-delay:-0.15s]" />
                <span className="size-1 animate-bounce rounded-full bg-mist-500" />
              </span>
            </span>
          </p>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-white/8 bg-ink-900/60 p-2.5 safe-bottom">
        <div className="flex items-end gap-2">
          <TextInput
            value={text}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Message the group…'}
            maxLength={2000}
          />
          <Button variant="primary" onClick={() => void send()} disabled={!text.trim()} icon={<Send className="size-4" />} className="shrink-0">
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
        <p className="mt-1 flex items-center gap-1 px-0.5 text-[0.6rem] font-semibold text-mist-600">
          <MoreHorizontal className="size-3" /> Hold a message to reply, react, edit or delete
        </p>
      </div>
    </div>
  );
}
