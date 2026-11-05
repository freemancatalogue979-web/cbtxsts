/**
 * Real-time group chat. One page, its own internal message scroll — the
 * browser never grows. Sends are authoritative (REST), inbound messages,
 * edits, deletes, reactions and typing arrive over the group socket. Replies
 * carry a referenced-message preview that scrolls to and highlights the
 * original; long-press (or hover) opens message actions.
 */
import {ChevronDown, ChevronLeft, CornerDownLeft, MoreHorizontal, Send} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Button, IconButton, Skeleton, TextInput} from '../components/ui';
import {Holdable} from '../components/Holdable';
import {ChatMessageRow, ChatMessageToolbar, ChatMessageMeta, ChatTombstone, ChatReplyQuote, ChatBubble, chatMessageActions, ChatReactionChips, ChatReactionPicker} from '../components/chat/shared';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {sfx} from '../lib/sfx';
import {useGroup} from './context';
import {MemberAvatar, PresenceDot} from './bits';
import type {GroupChatMessage, PresenceStatus} from '../lib/types';

const PAGE_SIZE = 40;

function upsert(rows: GroupChatMessage[], message: GroupChatMessage): GroupChatMessage[] {
  const index = rows.findIndex((row) => row.id === message.id);
  if (index === -1) return [...rows, message];
  const next = rows.slice();
  next[index] = {...next[index], ...message, pending: false, failed: false};
  return next;
}

export default function Chat() {
  const {groupId, group, myId, myName, can, room, presence, notify, openMember, go} = useGroup();
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const stickToBottom = useRef(true);
  const typingSent = useRef(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  const loadPage = useCallback(
    async (target: number, prepend: boolean) => {
      const payload = await api.groups.messages(groupId, {page: target, size: PAGE_SIZE});
      pageRef.current = payload.page;
      hasMoreRef.current = payload.page < payload.pages;
      setHasMore(hasMoreRef.current);
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
    if (!stickToBottom.current) {
      setShowLatest(true);
      return;
    }
    const list = listRef.current;
    if (list) {
      list.scrollTo({top: list.scrollHeight, behavior: 'smooth'});
      setShowLatest(false);
    }
  }, [messages.length, typing]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    stickToBottom.current = atBottom;
    setShowLatest(!atBottom);
  };

  const scrollToLatest = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({top: list.scrollHeight, behavior: 'smooth'});
    stickToBottom.current = true;
    setShowLatest(false);
  };

  const loadOlder = useCallback(async (): Promise<boolean> => {
    if (loadingOlderRef.current || !hasMoreRef.current) return false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const list = listRef.current;
    const prevHeight = list?.scrollHeight ?? 0;
    const next = pageRef.current + 1;
    try {
      const payload = await loadPage(next, true);
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - prevHeight;
      });
      return payload.items.length > 0;
    } catch (error) {
      notify('error', 'Could not load older messages', (error as Error).message);
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [loadPage, notify]);

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

  const jumpTo = useCallback(async (messageId: number) => {
    const findMessage = () => listRef.current?.querySelector<HTMLElement>(`[data-mid="${messageId}"]`) ?? null;
    let node = findMessage();
    /* Load each older page using the live page cursor; never repeat a stale page. */
    for (let step = 0; !node && step < 40 && hasMoreRef.current; step += 1) {
      const loaded = await loadOlder();
      if (!loaded) {
        if (hasMoreRef.current) return; // the loader already reported a failure, or another load is active
        break;
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      node = findMessage();
    }
    if (!node) {
      notify('info', 'Message unavailable', 'This reply points to a message that is no longer in the loaded conversation.');
      return;
    }
    node.scrollIntoView({behavior: 'smooth', block: 'center'});
    setHighlight(messageId);
    window.setTimeout(() => setHighlight((current) => (current === messageId ? null : current)), 1600);
  }, [loadOlder, notify]);

  const sorted = useMemo(() => messages, [messages]);
  const mobileHeader = (
    <header className="group-chat-mobile-head">
      <IconButton label="Back to group overview" variant="outline" onClick={() => go('overview')}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.86rem] font-extrabold text-mist-50">{group.name}</p>
        <p className="text-[0.66rem] font-semibold text-mist-500">Group chat</p>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="group-chat-root relative flex h-full min-h-0 flex-col">
        {mobileHeader}
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="ml-auto h-12 w-1/2" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="group-chat-root relative flex h-full min-h-0 flex-col">
      {mobileHeader}
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
          return (
            <ChatMessageRow key={message.id} id={message.id} prefix="gm" name={message.name} mine={mine} time={formatRelative(message.created_at)} highlight={isHighlight}
              avatar={<button type="button" onClick={() => !mine && openMember(message.student_id)} className="shrink-0" aria-label={mine ? message.name : `View ${message.name}`}><MemberAvatar member={message} size={30} status={mine ? undefined : status} /></button>}
              presence={!mine && <PresenceDot status={status} />}
              toolbar={!message.deleted && <ChatMessageToolbar onReply={() => setReplyTo(message)} onReact={() => setReactFor((current) => current === message.id ? null : message.id)} onEdit={mine ? () => startEdit(message) : undefined} />}>
                <Holdable
                  hint="Hold for actions"
                  actions={message.deleted ? [] : chatMessageActions({
                    message: {...message, kind: 'text'}, mine,
                    deleteLabel: !mine && can('moderate_chat') ? 'Delete for everyone' : undefined,
                    onReply: () => setReplyTo(message),
                    onOpenReactions: () => setReactFor(message.id),
                    onEdit: mine ? () => startEdit(message) : undefined,
                    onDelete: mine || can('moderate_chat') ? () => { void remove(message); } : undefined,
                  })}
                >
                  {message.deleted ? (
                    <ChatTombstone />
                  ) : isEditing ? (
                    <div className="mt-1 flex gap-2">
                      <TextInput value={editText} onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveEdit()} autoFocus />
                      <Button size="sm" variant="primary" onClick={() => void saveEdit()}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-0.5">
                      {message.reply_to && !message.reply_to.deleted && <ChatReplyQuote mine={mine} meta={{reply_to: {id: message.reply_to.id, name: message.reply_to.name, snippet: message.reply_to.body}}} onJump={(id) => void jumpTo(id)} />}
                      <ChatBubble mine={mine}>{message.body}</ChatBubble>
                      <ChatMessageMeta edited={Boolean(message.edited_at)} delivery={mine ? message.pending ? 'sending' : message.failed ? 'failed' : 'sent' : undefined} />
                    </div>
                  )}
                </Holdable>

                <ChatReactionChips message={message} mine={mine} onToggle={(emoji) => void react(message, emoji)} />
                {reactFor === message.id && !message.deleted && (
                  <ChatReactionPicker onPick={(emoji) => void react(message, emoji)} onClose={() => setReactFor(null)} />
                )}
            </ChatMessageRow>
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

      {showLatest && (
        <button type="button" className="group-chat-latest" onClick={scrollToLatest} aria-label="Scroll to latest messages">
          <ChevronDown className="size-4" /> Latest
        </button>
      )}

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
            aria-label="Message the group"
          />
          <Button variant="primary" onClick={() => void send()} disabled={!text.trim()} icon={<Send className="size-4" />} className="shrink-0" label="Send message">
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
