import CountryFlag from '../components/CountryFlag';
/**
 * Friends tab — your circle, their live status, and a real chat.
 *
 * Conversations support plain text plus two playable message kinds: a duel
 * invite (join straight from the bubble) and a quiz plan (pick an exam and a
 * time, and the card carries both). Hold any bubble for the whole action menu:
 * reply, react, copy, edit, delete (yours) or report (theirs) — or swipe a
 * bubble sideways to reply instantly. Nothing is painted on the bubble itself.
 * Friends can also be nudged with one tap and messages arrive live over the
 * arena socket.
 */
import {ArrowLeft, BellRing, CalendarPlus, Check, ChevronDown, Flag, Gamepad2, Loader2, MessageCircle, Pencil, Reply, Send, Swords, Trash2, UserPlus, Users, X, CalendarPlusIcon} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Avatar, Button, Card, EmptyState, Modal, Segmented, Skeleton, TextArea, TextInput, PageBanner, askConfirm, Select} from '../components/ui';
import {openPlayer} from '../components/PlayerCard';
import {useChatNav} from '../components/AppShell';
import {Holdable} from '../components/Holdable';
import {ChatMessageRow, ChatMessageToolbar, ChatMessageMeta, ChatTombstone, ChatBubble, ChatActionSurface, ChatReactionChips, ChatReactionPicker, ChatReplyQuote} from '../components/chat/shared';
import {HAPTICS} from '../lib/haptics';
import {GroupsPanel} from './CommunityPanel';
import {api} from '../lib/api';
import {bubbleOf} from '../lib/cosmetics';
import {cacheAge, cacheRead, cacheWrite, userScope} from '../lib/cache';
import {formatDateTime, formatRelative} from '../lib/format';
import {sfx, uiClick} from '../lib/sfx';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSession} from '../store/session';
import type {ChatMessage, Duel, GroupSection, PlayerSummary, Quiz} from '../lib/types';

const QUICK_PHRASES = ['👋 Hello!', 'GG!', 'Rematch?', 'Ready when you are 🔥'];

/**
 * Swipe a bubble sideways to reply — the WhatsApp gesture. `touch-action:
 * pan-y` keeps vertical scrolling native while horizontal drags come here:
 * the bubble follows the finger, a reply arrow is revealed, and releasing
 * past the threshold arms the composer. Short presses and slow holds fall
 * through to Holdable untouched, so hold-for-options and swipe coexist.
 */
const SWIPE_TRIGGER = 56;
const SWIPE_MAX = 84;

function SwipeToReply({onReply, children}: {onReply: () => void; children: React.ReactNode}) {
  const dragRef = useRef<HTMLDivElement | null>(null);
  const hintLeftRef = useRef<HTMLSpanElement | null>(null);
  const hintRightRef = useRef<HTMLSpanElement | null>(null);
  const gesture = useRef<{x: number; y: number; engaged: boolean; ticking: boolean; t0: number} | null>(null);

  const paint = (dx: number) => {
    const node = dragRef.current;
    if (node) node.style.transform = dx ? `translateX(${dx}px)` : '';
    const progress = Math.min(1, Math.abs(dx) / SWIPE_TRIGGER);
    if (hintLeftRef.current) hintLeftRef.current.style.opacity = dx > 0 ? String(progress) : '0';
    if (hintRightRef.current) hintRightRef.current.style.opacity = dx < 0 ? String(progress) : '0';
  };

  const settle = () => {
    const node = dragRef.current;
    if (node) {
      node.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
      node.style.transform = '';
      window.setTimeout(() => {
        node.style.transition = '';
      }, 240);
    }
    for (const hint of [hintLeftRef.current, hintRightRef.current]) {
      if (hint) hint.style.opacity = '0';
    }
    gesture.current = null;
  };

  return (
    <div className="relative min-w-0">
      {/* Revealed where the bubble used to sit, on the side it was pulled from. */}
      <span ref={hintLeftRef} aria-hidden className="pointer-events-none absolute inset-y-0 left-1 grid place-items-center opacity-0">
        <span className="grid size-7 place-items-center rounded-full bg-nova-500/25 text-nova-200">
          <Reply className="size-3.5" />
        </span>
      </span>
      <span ref={hintRightRef} aria-hidden className="pointer-events-none absolute inset-y-0 right-1 grid place-items-center opacity-0">
        <span className="grid size-7 place-items-center rounded-full bg-nova-500/25 text-nova-200">
          <Reply className="size-3.5 -scale-x-100" />
        </span>
      </span>
      <div
        ref={dragRef}
        className="min-w-0 touch-pan-y"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
          gesture.current = {x: event.clientX, y: event.clientY, engaged: false, ticking: false, t0: performance.now()};
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g) return;
          const dx = event.clientX - g.x;
          const dy = event.clientY - g.y;
          if (!g.engaged) {
            // Give Holdable the first ~320ms to claim a long-press action.
            if (performance.now() - g.t0 < 320 && Math.abs(dx) < 28) return;
            if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
              gesture.current = null; // vertical intent — this is a scroll, not a swipe
              return;
            }
            if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
            g.engaged = true;
          }
          const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
          paint(clamped);
          if (Math.abs(clamped) >= SWIPE_TRIGGER && !g.ticking) {
            g.ticking = true;
            HAPTICS.tap();
          } else if (Math.abs(clamped) < SWIPE_TRIGGER && g.ticking) {
            g.ticking = false;
          }
        }}
        onPointerUp={(event) => {
          const g = gesture.current;
          if (!g) return;
          const dx = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, event.clientX - g.x));
          const triggered = g.engaged && Math.abs(dx) >= SWIPE_TRIGGER;
          settle();
          if (triggered) {
            HAPTICS.tap();
            sfx.play('tap');
            onReply();
          }
        }}
        onPointerCancel={() => settle()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Hold a bubble for the shared Friends / teacher action menu. Replies and
 * reactions stay tucked away until requested, keeping the mobile thread clean.
 */
function HoldMessage({
  message,
  peer,
  mine,
  onReply,
  onDelete,
  onEdit,
  onOpenReactions,
  onToggleReaction,
  onReport,
  showPicker = false,
  highlight = false,
  children,
}: {
  message: ChatMessage;
  peer: PlayerSummary | null;
  mine: boolean;
  onReply: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onOpenReactions: (message: ChatMessage) => void;
  onToggleReaction: (message: ChatMessage, emoji: string) => void;
  onReport: (message: ChatMessage) => void;
  showPicker?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const {profile} = useSession();
  const sender = mine ? profile : peer;
  const senderName = mine ? 'You' : sender?.name || 'Friend';
  const gone = Boolean(message.deleted);
  const holdable = (
    <ChatActionSurface
      message={message}
      mine={mine}
      onReply={() => onReply(message)}
      onOpenReactions={() => onOpenReactions(message)}
      onDelete={() => onDelete(message)}
      onEdit={() => onEdit(message)}
      onReport={() => onReport(message)}
      menuWidth={214}
      className="min-w-0"
    >
      <div className="min-w-0">
        {children}
        {showPicker && !gone && (
          <ChatReactionPicker
            onPick={(emoji) => onToggleReaction(message, emoji)}
            onClose={() => onOpenReactions(message)}
          />
        )}
      </div>
    </ChatActionSurface>
  );
  return (
    <ChatMessageRow id={message.id} prefix="fm" name={senderName} mine={mine} time={formatRelative(message.created_at)} highlight={highlight}
      avatar={<button type="button" onClick={() => openPlayer(message.sender_id)} aria-label={`View ${sender?.name || senderName}`}><Avatar name={sender?.name || senderName} hue={sender?.avatar_hue} size={30} photo={{id: message.sender_id, has: sender?.has_photo}} cosmetics={sender?.cosmetics} /></button>}
      toolbar={!gone && <ChatMessageToolbar onReply={() => onReply(message)} onReact={() => onOpenReactions(message)} onEdit={mine && message.kind === 'text' ? () => onEdit(message) : undefined} />}>
      {gone ? holdable : <SwipeToReply onReply={() => onReply(message)}>{holdable}</SwipeToReply>}
    </ChatMessageRow>
  );
}

/** Shared reaction chips — a quick tap toggles your reaction. */
function Reactions({message, mine, onToggle}: {message: ChatMessage; mine: boolean; onToggle: (emoji: string) => void}) {
  return <ChatReactionChips message={message} mine={mine} onToggle={onToggle} />;
}

/** Reply quotes are actionable when the original message is in history. */
function QuoteBlock({meta, mine, onJump}: {meta: Record<string, unknown>; mine: boolean; onJump: (id: number) => void}) {
  return <ChatReplyQuote meta={meta} mine={mine} onJump={onJump} />;
}

export default function FriendsPanel({
  onOpenDuel,
  onStartExam,
  onOpenGroup,
}: {
  onOpenDuel: (duel: Duel) => void;
  onStartExam: (quiz: Quiz) => void;
  onOpenGroup: (groupId: number, section?: GroupSection) => void;
}) {
  const {toast, chatUnread, setChatFocus, on, profile} = useSession();
  /* Your own bubbles wear the chat cosmetic you equipped. */
  const myBubble = bubbleOf(profile?.cosmetics);
  // Everything the circle shows is mirrored on the device, so reopening the tab
  // (or reloading on a slow phone) paints instantly and then refreshes.
  const scope = userScope(profile?.id);
  const [data, setData] = useState<{friends: PlayerSummary[]; requests: PlayerSummary[]; rivals: PlayerSummary[]} | null>(
    () => cacheRead(scope, 'friends'),
  );
  const [offline, setOffline] = useState(false);
  const [editTo, setEditTo] = useState<ChatMessage | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [selected, setSelected] = useState<PlayerSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [outbox, setOutbox] = useState<{key: number; body: string; kind: 'text' | 'duel' | 'quiz'; meta: Record<string, unknown>; failed: boolean}[]>([]);
  // Messages deleted from this device: the thread hides them for good, while
  // the other player keeps their copy.
  const [hidden, setHidden] = useState<Record<number, true>>(() => cacheRead(scope, 'chat.hidden') ?? {});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [planFor, setPlanFor] = useState<{quizId: number; when: string} | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [reportingMessage, setReportingMessage] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState('Abusive or inappropriate');
  const [reportDetail, setReportDetail] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const highlightTimer = useRef<number | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const selectedIdRef = useRef<number | null>(null);
  const [pane, setPane] = useState<'friends' | 'groups'>('friends');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  const load = useCallback(() => {
    api
      .friends()
      .then((payload) => {
        setData(payload);
        cacheWrite(scope, 'friends', payload);
        setOffline(false);
      })
      .catch((error: Error) => {
        // Keep whatever the device already has instead of blanking the list.
        setOffline(true);
        if (!cacheRead(scope, 'friends')) toast('error', 'Could not load your circle', error.message);
      });
  }, [scope, toast]);

  useEffect(() => {
    load();
    api
      .quizzes()
      .then(setQuizzes)
      .catch(() => {});
  }, [load]);

  /* Live messages for the open thread. */
  useEffect(
    () =>
      on('chat', (payload) => {
        const message = payload as ChatMessage;
        if (!selected || message.sender_id !== selected.id) return;
        setMessages((current) => (current.some((row) => row.id === message.id) ? current : [...current, message]));
        setUnseen((current) => current + 1);
      }),
    [on, selected],
  );

  /* Edits, deletes and reactions arrive on the same socket. */
  useEffect(
    () =>
      on('chat_edit', (payload) => {
        const message = payload as ChatMessage;
        setMessages((current) => current.map((row) => (row.id === message.id ? {...row, ...message} : row)));
      }),
    [on],
  );

  const openThread = useCallback(
    (friend: PlayerSummary) => {
      selectedIdRef.current = friend.id;
      setSelected(friend);
      setChatFocus(friend.id);
      setReplyTo(null);
      setReactFor(null);
      setHighlight(null);
      setHasMore(false);
      hasMoreRef.current = false;
      // Paint the saved conversation immediately, then sync with the server.
      const cached = cacheRead<ChatMessage[]>(scope, `thread.${friend.id}`) ?? [];
      messagesRef.current = cached;
      setMessages(cached);
      api
        .chatWith(friend.id)
        .then((result) => {
          if (selectedIdRef.current !== friend.id) return;
          messagesRef.current = result.messages;
          hasMoreRef.current = result.has_more;
          setMessages(result.messages);
          setHasMore(result.has_more);
          cacheWrite(scope, `thread.${friend.id}`, result.messages.slice(-200));
        })
        .catch((error: Error) => {
          if (!cacheRead(scope, `thread.${friend.id}`)) {
            setMessages([]);
            toast('error', 'Could not open the chat', error.message);
          } else {
            toast('info', 'Showing saved messages', 'Reconnecting to the live thread…');
          }
        });
    },
    [scope, setChatFocus, toast],
  );

  const closeThread = useCallback(() => {
    selectedIdRef.current = null;
    setSelected(null);
    setReplyTo(null);
    setReactFor(null);
    setChatFocus(null);
  }, [setChatFocus]);

  /* While a thread is open on mobile, ask the shell to tuck the bottom tab
     bar away so the conversation gets the full screen (a floating pill can
     bring it back temporarily). Closing the thread restores the bar. */
  const chatNav = useChatNav();
  useEffect(() => {
    chatNav.setThreadOpen(Boolean(selected && pane === 'friends'));
    return () => chatNav.setThreadOpen(false);
  }, [selected, pane, chatNav.setThreadOpen]);

  const atBottom = useRef(true);

  const loadOlder = useCallback(async (): Promise<boolean> => {
    const friendId = selected?.id;
    const oldestId = messagesRef.current[0]?.id;
    if (!friendId || !oldestId || !hasMoreRef.current || loadingOlderRef.current) return false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const node = scrollRef.current;
    const oldHeight = node?.scrollHeight ?? 0;
    const oldTop = node?.scrollTop ?? 0;
    try {
      const result = await api.chatWith(friendId, {beforeId: oldestId, limit: 60});
      if (selectedIdRef.current !== friendId) return false;
      const existing = new Set(messagesRef.current.map((row) => row.id));
      const olderRows = result.messages.filter((row) => !existing.has(row.id));
      const next = [...olderRows, ...messagesRef.current];
      messagesRef.current = next;
      hasMoreRef.current = result.has_more && olderRows.length > 0;
      setMessages(next);
      setHasMore(hasMoreRef.current);
      if (olderRows.length) {
        requestAnimationFrame(() => {
          if (node && scrollRef.current === node) node.scrollTop = oldTop + node.scrollHeight - oldHeight;
        });
        cacheWrite(scope, `thread.${friendId}`, next.slice(-200));
        return true;
      }
      return false;
    } catch (error) {
      toast('error', 'Could not load older messages', (error as Error).message);
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [scope, selected?.id, toast]);

  const jumpToMessage = useCallback(async (messageId: number) => {
    let target = scrollRef.current?.querySelector(`[data-mid="${messageId}"]`) as HTMLElement | null;
    let pages = 0;
    while (!target && hasMoreRef.current && pages < 40) {
      const loaded = await loadOlder();
      if (!loaded) break;
      pages += 1;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      target = scrollRef.current?.querySelector(`[data-mid="${messageId}"]`) as HTMLElement | null;
    }
    if (!target) {
      toast('info', 'Message unavailable', 'This reply points to a message that is no longer in the conversation.');
      return;
    }
    target.scrollIntoView({behavior: 'smooth', block: 'center'});
    setHighlight(messageId);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 1700);
  }, [loadOlder, toast]);

  const scrollToEnd = useCallback((smooth = true) => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto'});
    setUnseen(0);
    atBottom.current = true;
  }, []);

  useEffect(() => {
    // Never yank a reader who is scrolled up: offer the jump pill instead.
    if (atBottom.current) scrollToEnd(false);
  }, [messages, scrollToEnd]);

  /* Mirror the open thread on the device (debounced — sends can be rapid). */
  useEffect(() => {
    if (!selected || messages.length === 0) return undefined;
    const handle = window.setTimeout(() => cacheWrite(scope, `thread.${selected.id}`, messages.slice(-200)), 600);
    return () => window.clearTimeout(handle);
  }, [messages, scope, selected]);

  /**
   * Hold → Delete. Your own messages are deleted for both sides (a tombstone
   * stays in the thread); other people's are hidden on this device only, and a
   * hide is remembered across reloads.
   */
  const dropMessage = useCallback(
    async (message: ChatMessage) => {
      const mine = message.sender_id === profile?.id;
      if (mine && !message.deleted) {
        try {
          const updated = await api.deleteChat(message.id);
          setMessages((current) => current.map((row) => (row.id === message.id ? {...row, ...updated} : row)));
          sfx.play('whoosh');
          toast('success', 'Message deleted', 'It is gone from both sides of the chat.');
          return;
        } catch (error) {
          toast('error', 'Could not delete that', (error as Error).message);
        }
      }
      setHidden((current) => {
        const next = {...current, [message.id]: true as const};
        cacheWrite(scope, 'chat.hidden', next);
        return next;
      });
      setMessages((current) => {
        const next = current.filter((row) => row.id !== message.id);
        if (selected) cacheWrite(scope, `thread.${selected.id}`, next.slice(-200));
        return next;
      });
      sfx.play('whoosh');
      toast('success', 'Hidden for you', 'The other player keeps their copy.');
    },
    [profile?.id, scope, selected, toast],
  );

  const reactTo = useCallback(
    async (message: ChatMessage, emoji: string) => {
      try {
        const updated = await api.reactChat(message.id, emoji);
        setMessages((current) => current.map((row) => (row.id === message.id ? {...row, ...updated} : row)));
        sfx.play('tap');
      } catch (error) {
        toast('error', 'Could not react', (error as Error).message);
      }
    },
    [toast],
  );

  const reportMessage = useCallback((message: ChatMessage) => {
    setReportingMessage(message);
    setReportReason('Abusive or inappropriate');
    setReportDetail('');
  }, []);

  const submitReport = useCallback(async () => {
    if (!reportingMessage || reportBusy) return;
    setReportBusy(true);
    try {
      const reason = [reportReason, reportDetail.trim()].filter(Boolean).join(': ').slice(0, 400);
      await api.reportChat(reportingMessage.id, reason);
      setReportingMessage(null);
      toast('success', 'Report sent', 'Thank you — moderators will review it.');
    } catch (error) {
      toast('error', 'Could not report that', (error as Error).message);
    } finally {
      setReportBusy(false);
    }
  }, [reportingMessage, reportBusy, reportReason, reportDetail, toast]);

  const startEdit = useCallback((message: ChatMessage) => {
    setEditTo(message);
    setReplyTo(null);
    setDraft(message.body);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editTo) return;
    const body = draft.trim();
    if (!body || body === editTo.body) {
      setEditTo(null);
      return;
    }
    setBusy(true);
    try {
      const updated = await api.editChat(editTo.id, body);
      setMessages((current) => current.map((row) => (row.id === editTo.id ? {...row, ...updated} : row)));
      setEditTo(null);
      setDraft('');
      sfx.play('tap');
    } catch (error) {
      toast('error', 'Could not save the edit', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draft, editTo, toast]);

  const removeFriend = useCallback(
    async (friend: PlayerSummary) => {
      if (!(await askConfirm(`Remove ${friend.name} from your friends?`))) return;
      try {
        await api.removeFriend(friend.id);
        sfx.play('whoosh');
        toast('success', 'Friend removed', `${friend.name} is no longer in your circle.`);
        if (selected?.id === friend.id) closeThread();
        load();
      } catch (error) {
        toast('error', 'Could not remove friend', (error as Error).message);
      }
    },
    [closeThread, load, selected?.id, toast],
  );

  const send = useCallback(
    (kind: 'text' | 'duel' | 'quiz', body: string, meta: Record<string, unknown> = {}) => {
      if (!selected) return;
      /* Optimistic send: the bubble appears instantly, the server confirms
         or the row flips to a retry state — the composer is never blocked. */
      const key = Date.now() + Math.random();
      setOutbox((current) => [...current, {key, body, kind, meta, failed: false}]);
      void deliver(key, kind, body, meta);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected],
  );

  const deliver = useCallback(
    async (key: number, kind: 'text' | 'duel' | 'quiz', body: string, meta: Record<string, unknown>) => {
      if (!selected) return;
      try {
        const message = await api.sendChat({to: selected.id, kind, body, meta});
        setMessages((current) => (current.some((row) => row.id === message.id) ? current : [...current, message]));
        setOutbox((current) => current.filter((row) => row.key !== key));
        sfx.play('chat');
      } catch {
        setOutbox((current) => current.map((row) => (row.key === key ? {...row, failed: true} : row)));
      }
    },
    [selected],
  );

  const inviteDuel = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const duel = await api.openDuel({stake_coins: 0});
      await send('duel', `Challenge sent — code ${duel.code}`, {duel_id: duel.id, code: duel.code});
      toast('success', 'Duel room open', `Share code ${duel.code} or wait for ${selected.name.split(' ')[0]} to tap in.`);
    } catch (error) {
      toast('error', 'Could not open a duel room', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nudge = async () => {
    if (!selected) return;
    try {
      await api.nudge(selected.id);
      sfx.play('whoosh');
      toast('success', `Nudged ${selected.name.split(' ')[0]}`, 'They just got a ping about you.');
    } catch (error) {
      toast('error', 'Nudge failed', (error as Error).message);
    }
  };

  const friends = data?.friends ?? [];
  const requests = data?.requests ?? [];
  const rivals = data?.rivals ?? [];

  return (
    <div className={`friends-panel min-w-0 space-y-3.5 sm:space-y-5 ${selected && pane === 'friends' ? 'friends-thread-open' : ''}`}>
      <PageBanner className="friends-page-heading" tone="nova" eyebrow="Social"
        title="Friends"
        subtitle="See who is online, chat, and turn conversations into duels."
        icon={<Users className="size-4" />}
        action={
          selected ? (
            <Button size="sm" variant="outline" onClick={closeThread} icon={<ArrowLeft className="size-3.5" />} className="lg:hidden">
              Everyone
            </Button>
          ) : undefined
        }
      />

      <div className="friends-pane-switch">
      <Segmented
        value={pane}
        onChange={(next) => {
          setPane(next);
          if (next === 'groups') closeThread();
        }}
        options={[
          {value: 'friends', label: 'Friends', icon: Users},
          {value: 'groups', label: 'Study groups', icon: Users},
        ]}
      />
      </div>

      {pane === 'groups' && <GroupsPanel onOpenGroup={onOpenGroup} />}

      {pane === 'friends' && (
      <div className="friends-layout grid min-w-0 gap-3.5 lg:grid-cols-[20rem_1fr] lg:gap-4">
        {/* ---------------------------------------------------- the circle */}
        <section className={`friends-circle min-w-0 space-y-3 ${selected ? 'hidden lg:block' : ''}`}>
          {!data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-16" />
              ))}
            </div>
          ) : (
            <>
              {requests.length > 0 && (
                <Card className="min-w-0 p-3">
 <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Requests</p>
                  <div className="mt-2 space-y-2">
                    {requests.map((row) => (
                      <div key={row.id} className="flex items-center gap-2.5">
                        <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={34} photo={{id: row.id, has: row.has_photo}} />
                        <span className="min-w-0 flex-1 truncate text-[0.82rem] font-extrabold text-mist-100">{row.name}</span>
                        <Button
                          size="sm"
                          variant="mint"
                          onClick={() => {
                            void api.addFriend({student_id: row.id}).then(() => {
                              toast('success', `You and ${row.name.split(' ')[0]} are friends`);
                              load();
                            });
                          }}
                          icon={<Check className="size-3.5" />}
                        >
                          Accept
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="min-w-0 divide-y divide-white/6">
                {offline && friends.length > 0 && (
                  <p className="px-3 py-2 text-[0.68rem] font-bold text-gold-300 sm:px-3.5">
                    Showing your saved circle{cacheAge(scope, 'friends') ? ` · cached ${formatRelative(new Date(cacheAge(scope, 'friends') as number).toISOString())}` : ''}
                  </p>
                )}
                {friends.length === 0 ? (
                  <EmptyState
                    icon={<UserPlus className="size-6" />}
                    title="No friends yet"
                    detail="Search players from the Profile tab, or duel someone — rivals show up here for rematches and chats."
                  />
                ) : (
                  friends.map((row) => (
                    <Holdable
                      key={row.id}
                      className="min-w-0"
                      allowOnButton
                      menuWidth={210}
                      hint={`Hold ${row.name.split(' ')[0]} for options`}
                      actions={[
                        {key: 'profile', label: 'View profile', icon: <Users className="size-4" />, tone: 'accent', onAction: () => openPlayer(row.id)},
                        {
                          key: 'chat',
                          label: 'Open chat',
                          icon: <MessageCircle className="size-4" />,
                          tone: 'accent',
                          onAction: () => openThread(row),
                        },
                        {
                          key: 'remove',
                          label: 'Remove friend',
                          icon: <Trash2 className="size-4" />,
                          tone: 'danger',
                          onAction: () => void removeFriend(row),
                        },
                      ]}
                    >
                      <div className="flex min-w-0 items-center">
                      <button
                        type="button"
                        onClick={() => openThread(row)}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors touch-manipulation hover:bg-white/4 sm:px-3.5"
                      >
                        <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={36} online={row.online} photo={{id: row.id, has: row.has_photo}} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.84rem] font-extrabold text-mist-100"><CountryFlag code={row.country} /> {row.name}</span>
                          <span className="block truncate text-[0.66rem] font-bold text-mist-500">
                            {row.status_text || (row.online ? 'Online now' : `Offline · Lv ${row.level} ${row.title}`)}
                          </span>
                        </span>
                        {(chatUnread[row.id] ?? 0) > 0 && (
                          <span className="grid size-5 shrink-0 place-items-center rounded-full brand-gradient text-[0.6rem] font-black text-white tabular">
                            {chatUnread[row.id]}
                          </span>
                        )}
                        <MessageCircle className="size-4 shrink-0 text-mist-600" />
                      </button>
                      <button type="button" aria-label={`View ${row.name}'s profile`} title="View player profile" onClick={() => openPlayer(row.id)} className="mr-2 grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-nova-300"><Users className="size-4" /></button>
                      </div>
                    </Holdable>
                  ))
                )}
              </Card>

              {rivals.length > 0 && (
                <Card className="min-w-0 p-3">
 <p className="text-[0.66rem] font-black tracking-[0.18em] text-mist-500">Recent rivals</p>
                  <div className="mt-2 space-y-2">
                    {rivals.slice(0, 6).map((row) => (
                      <div key={row.id} className="flex items-center gap-2.5">
                        <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={32} online={row.online} photo={{id: row.id, has: row.has_photo}} />
                        <span className="min-w-0 flex-1 truncate text-[0.78rem] font-extrabold text-mist-200">{row.name}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void api.addFriend({student_id: row.id}).then(() => {
                              toast('success', 'Friend added');
                              load();
                            });
                          }}
                          icon={<UserPlus className="size-3.5" />}
                        >
                          Add
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </section>

        {/* ---------------------------------------------------- the thread */}
        <section className={`friends-thread min-w-0 ${selected ? '' : 'hidden lg:block'}`}>
          {!selected ? (
            <Card className="grid min-h-[18rem] place-items-center p-6">
              <EmptyState
                icon={<MessageCircle className="size-6" />}
                title="Pick a friend"
                detail="Say hello, send a duel invite, or schedule an exam together — right inside the chat."
              />
            </Card>
          ) : (
            /* On phones the thread is a self-contained column that fits between
               the app header and the bottom nav: the message list scrolls
               INTERNALLY and the composer stays pinned in view, so the page
               itself never becomes the scroll container and the nav can never
               cover the latest messages. While the tab bar is tucked away the
               thread claims the freed space too. Desktop keeps natural height. */
            <Card
              className={`friends-thread-card flex min-h-[24rem] min-w-0 flex-col overflow-hidden p-0 max-lg:min-h-[20rem] ${
                chatNav.collapsed ? 'max-lg:h-[calc(100dvh-13rem)]' : 'max-lg:h-[calc(100dvh-16.5rem)]'
              }`}
            >
              <div className="flex items-center gap-2.5 border-b border-white/8 px-3 py-2.5 sm:px-4">
                <Button variant="ghost" size="sm" onClick={closeThread} icon={<ArrowLeft className="size-4" />} aria-label="Back to friends" className="-ml-1.5 lg:hidden" />
                <Avatar name={selected.name} hue={selected.avatar_hue} initials={selected.initials} size={34} online={selected.online} photo={{id: selected.id, has: selected.has_photo}} />
                <span className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-left text-[0.86rem] font-extrabold text-mist-50 hover:text-nova-200" onClick={() => window.dispatchEvent(new CustomEvent('ag:player', {detail: {id: selected.id}}))}>
                    <CountryFlag code={selected.country} /> {selected.name}
                  </button>
                  <span className="block text-[0.64rem] font-bold text-mist-500">
                    {selected.online ? 'Online now' : `Lv ${selected.level} ${selected.title}`}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={nudge} aria-label={`Nudge ${selected.name.split(' ')[0]}`} icon={<BellRing className="size-4 text-gold-300" />} />
                <Button size="sm" variant="outline" onClick={inviteDuel} disabled={busy} icon={<Swords className="size-3.5 text-nova-300" />}>
                  <span className="hidden sm:inline">Duel invite</span>
                  <span className="sm:hidden">Duel</span>
                </Button>
              </div>

              <div
                ref={scrollRef}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
                  atBottom.current = bottom;
                  if (bottom) setUnseen(0);
                  if (node.scrollTop < 44 && hasMoreRef.current && !loadingOlderRef.current) void loadOlder();
                }}
                className="relative min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pt-3 pb-4 sm:px-4 lg:max-h-none"
              >
                {hasMore && (
                  <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="sticky top-0 z-[1] mx-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-950/90 px-3 py-1 text-[0.68rem] font-bold text-mist-400 shadow-sm disabled:opacity-60">
                    {loadingOlder ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3 rotate-180" />}
                    {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
                  </button>
                )}
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-[0.78rem] font-semibold text-mist-500">
                    No messages yet — break the ice with a 👋 or a challenge.
                  </p>
                ) : (
                  <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
                    {messages.filter((message) => !hidden[message.id]).map((message) => {
                      const mine = message.sender_id === profile?.id;
                      if (message.kind === 'duel') {
                        return (
                          <motion.li key={message.id} variants={staggerItem}>
                            <HoldMessage
                              peer={selected}
                              message={message}
                              mine={mine}
                              onReply={setReplyTo}
                              onDelete={dropMessage}
                              onEdit={startEdit}
                              onOpenReactions={(row) => setReactFor((current) => current === row.id ? null : row.id)}
                              onToggleReaction={reactTo}
                              onReport={reportMessage}
                              showPicker={reactFor === message.id}
                              highlight={highlight === message.id}
                            >
                              <div className="min-w-0">
                              <div className="rounded-2xl border border-nova-500/30 bg-nova-500/10 px-3 py-2.5">
 <p className="flex items-center gap-1.5 text-[0.72rem] font-black tracking-wider text-nova-300">
                                  <Swords className="size-3.5" /> Duel invite
                                </p>
                                <QuoteBlock meta={message.meta} mine={mine} onJump={jumpToMessage} />
                                <p className="mt-1 text-[0.78rem] font-semibold text-mist-200">{message.body}</p>
                                {!mine && (
                                  <Button
                                    size="sm"
                                    className="mt-2"
                                    onClick={() => {
                                      api
                                        .duel(Number(message.meta.duel_id))
                                        .then(onOpenDuel)
                                        .catch((error: Error) => toast('error', 'Could not open that duel', error.message));
                                    }}
                                    icon={<Swords className="size-3.5" />}
                                  >
                                    Join the duel
                                  </Button>
                                )}
                              </div>
                              <Reactions message={message} mine={mine} onToggle={(emoji) => void reactTo(message, emoji)} />
                              </div>
                            </HoldMessage>
                          </motion.li>
                        );
                      }
                      if (message.kind === 'quiz') {
                        const quizId = Number(message.meta.quiz_id);
                        const quiz = quizzes.find((row) => row.id === quizId);
                        const when = message.meta.when ? String(message.meta.when) : '';
                        return (
                          <motion.li key={message.id} variants={staggerItem}>
                            <HoldMessage
                              peer={selected}
                              message={message}
                              mine={mine}
                              onReply={setReplyTo}
                              onDelete={dropMessage}
                              onEdit={startEdit}
                              onOpenReactions={(row) => setReactFor((current) => current === row.id ? null : row.id)}
                              onToggleReaction={reactTo}
                              onReport={reportMessage}
                              showPicker={reactFor === message.id}
                              highlight={highlight === message.id}
                            >
                              <div className="min-w-0">
                              <div className="rounded-2xl border border-pulse-500/30 bg-pulse-500/10 px-3 py-2.5">
 <p className="flex items-center gap-1.5 text-[0.72rem] font-black tracking-wider text-pulse-300">
                                  <CalendarPlus className="size-3.5" /> Quiz plan
                                </p>
                                <QuoteBlock meta={message.meta} mine={mine} onJump={jumpToMessage} />
                                <p className="mt-1 text-[0.82rem] font-extrabold text-mist-100">
                                  {String(message.meta.title ?? 'Exam')}
                                </p>
                                {when && <p className="mt-0.5 text-[0.72rem] font-bold text-mist-400">{formatDateTime(when)}</p>}
                                {quiz && (
                                  <Button size="sm" variant="outline" className="mt-2" onClick={() => onStartExam(quiz)} icon={<Gamepad2 className="size-3.5" />}>
                                    Open exam
                                  </Button>
                                )}
                              </div>
                              <Reactions message={message} mine={mine} onToggle={(emoji) => void reactTo(message, emoji)} />
                              </div>
                            </HoldMessage>
                          </motion.li>
                        );
                      }
                      return (
                        <motion.li key={message.id} variants={staggerItem}>
                          <HoldMessage
                              peer={selected}
                            message={message}
                            mine={mine}
                            onReply={setReplyTo}
                            onDelete={dropMessage}
                            onEdit={startEdit}
                            onOpenReactions={(row) => setReactFor((current) => current === row.id ? null : row.id)}
                            onToggleReaction={reactTo}
                            onReport={reportMessage}
                            showPicker={reactFor === message.id}
                            highlight={highlight === message.id}
                          >
                            <div className="min-w-0">
                              {message.deleted ? (
                                <ChatTombstone />
                              ) : (
                                <>
                                <QuoteBlock meta={message.meta} mine={mine} onJump={jumpToMessage} />
                                <ChatBubble mine={mine} className={mine && myBubble ? myBubble : ''}>
                                  {(message.kind === 'file' || message.kind === 'material' || message.kind === 'tquiz') && (
                                    <button
                                      type="button"
                                      className="mb-1 block text-left text-[0.78rem] font-extrabold underline underline-offset-2"
                                      onClick={() => {
                                        sessionStorage.setItem('ag.msg.with', String(mine ? message.recipient_id : message.sender_id));
                                        window.dispatchEvent(new CustomEvent('ag:navigate', {detail: {tab: 'messages', withId: mine ? message.recipient_id : message.sender_id}}));
                                      }}
                                    >
                                      {message.kind === 'file' ? `📎 ${String(message.meta.name ?? 'Attachment')}` : `${message.kind === 'tquiz' ? 'Quiz' : 'Material'}: ${String(message.meta.title ?? '')}`} · open in Messages
                                    </button>
                                  )}
                                  {message.body && <span>{message.body}</span>}
                                </ChatBubble>
                                <ChatMessageMeta edited={Boolean(message.edited_at)} delivery={mine ? message.read ? 'seen' : 'sent' : undefined} />
                                </>
                              )}
                              <Reactions message={message} mine={mine} onToggle={(emoji) => void reactTo(message, emoji)} />
                            </div>
                          </HoldMessage>
                        </motion.li>
                      );
                    })}
                  </motion.ul>
                )}
                {/* Optimistic outbox: rows appear instantly and flip to a
                    retry state if the server does not confirm them. */}
                {outbox.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    <AnimatePresence>
                      {outbox.map((row) => (
                        <motion.li
                          key={row.key}
                          initial={{opacity: 0, y: 6, scale: 0.98}}
                          animate={{opacity: 1, y: 0, scale: 1}}
                          exit={{opacity: 0, scale: 0.97}}
                          transition={{duration: 0.18, ease: [0.22, 1, 0.36, 1]}}
                          className="flex justify-end"
                        >
                          <div
                            className={`max-w-[78%] rounded-2xl border px-3 py-2 text-[0.82rem] font-medium ${
                              row.failed
                                ? 'border-flare-400/40 bg-flare-400/10 text-flare-200'
                                : 'border-nova-500/30 bg-nova-500/15 text-mist-200 opacity-80'
                            }`}
                          >
                            <p>{row.body}</p>
                            <p className="mt-1 flex items-center gap-1.5 text-[0.6rem] font-bold">
                              {row.failed ? (
                                <>
                                  <span>Not sent</span>
                                  <button
                                    onClick={() => {
                                      uiClick('tap');
                                      setOutbox((current) => current.map((entry) => (entry.key === row.key ? {...entry, failed: false} : entry)));
                                      void deliver(row.key, row.kind, row.body, row.meta);
                                    }}
                                    className="rounded-full border border-flare-400/40 px-2 py-0.5 text-flare-200 transition-colors hover:bg-flare-400/15 active:translate-y-px"
                                  >
                                    Retry
                                  </button>
                                </>
                              ) : (
                                <>
                                  <Loader2 className="size-3 animate-spin" /> Sending…
                                </>
                              )}
                            </p>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
                {unseen > 0 ? (
                  <button
                    onClick={() => scrollToEnd()}
                    className="sticky bottom-1 left-1/2 z-10 mt-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full brand-gradient px-3 py-1.5 text-[0.72rem] font-black text-white shadow-lg"
                  >
                    <ChevronDown className="size-3.5" /> {unseen} new message{unseen === 1 ? '' : 's'}
                  </button>
                ) : null}
              </div>

              <div className="border-t border-white/8 px-3 py-2.5 sm:px-4">
                {editTo ? (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-2.5 py-1.5">
                    <Pencil className="size-3.5 shrink-0 text-gold-300" />
                    <p className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold text-mist-300">Editing your message</p>
                    <button
                      onClick={() => {
                        setEditTo(null);
                        setDraft('');
                      }}
                      aria-label="Cancel edit"
                      className="shrink-0 text-mist-500 hover:text-mist-200"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : null}
                {replyTo && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-nova-500/30 bg-nova-500/10 px-2.5 py-1.5">
                    <Reply className="size-3.5 shrink-0 text-nova-300" />
                    <p className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold text-mist-300">
                      {replyTo.sender_id === profile?.id ? 'You' : selected.name.split(' ')[0]}:{' '}
                      {replyTo.kind === 'text' ? replyTo.body : replyTo.kind === 'duel' ? '⚔️ Duel invite' : '📅 Quiz plan'}
                    </p>
                    <button onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="shrink-0 text-mist-500 hover:text-mist-200">
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
                <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
                  {QUICK_PHRASES.map((phrase) => (
                    <button
                      key={phrase}
                      disabled={busy}
                      onClick={() => void send('text', phrase)}
                      className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[0.7rem] font-bold text-mist-300 transition-colors touch-manipulation hover:border-nova-400/40 hover:text-nova-200"
                    >
                      {phrase}
                    </button>
                  ))}
                  <button
                    disabled={busy}
                    onClick={() => setPlanFor({quizId: quizzes[0]?.id ?? 0, when: ''})}
                    className="shrink-0 rounded-full border border-pulse-500/30 bg-pulse-500/10 px-2.5 py-1.5 text-[0.7rem] font-bold text-pulse-300 transition-colors touch-manipulation"
                  >
                    📅 Plan a quiz
                  </button>
                </div>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = draft.trim();
                    if (!body) return;
                    if (editTo) {
                      void saveEdit();
                      return;
                    }
                    setDraft('');
                    const meta: Record<string, unknown> = replyTo
                      ? {
                          reply_to: {
                            id: replyTo.id,
                            name: replyTo.sender_id === profile?.id ? 'You' : selected.name.split(' ')[0],
                            snippet: (
                              replyTo.kind === 'text'
                                ? replyTo.body
                                : replyTo.kind === 'duel'
                                  ? '⚔️ Duel invite'
                                  : '📅 Quiz plan'
                            ).slice(0, 80),
                          },
                        }
                      : {};
                    setReplyTo(null);
                    void send('text', body, meta);
                  }}
                >
                  <TextInput
                    placeholder={editTo ? 'Update your message…' : `Message ${selected.name.split(' ')[0]}…`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, 600))}
                    className="min-w-0 flex-1"
                  />
                  <Button type="submit" disabled={busy || !draft.trim()} icon={<Send className="size-4" />} aria-label="Send message">
                    <span className="hidden sm:inline">Send</span>
                  </Button>
                </form>
              </div>
            </Card>
          )}
        </section>
      </div>
      )}

      <Modal
        open={Boolean(reportingMessage)}
        onClose={() => { if (!reportBusy) setReportingMessage(null); }}
        title="Report message"
        subtitle="Reports are private and reviewed by the moderation team."
        footer={
          <>
            <Button size="sm" variant="outline" disabled={reportBusy} onClick={() => setReportingMessage(null)}>Cancel</Button>
            <Button size="sm" className="whitespace-nowrap" loading={reportBusy} disabled={!reportReason.trim()} onClick={() => void submitReport()} icon={<Flag className="size-4" />}>
              Submit report
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[0.72rem] font-extrabold text-mist-400">
            Reason
            <Select value={reportReason} onChange={(event) => setReportReason(event.target.value)} aria-label="Report reason" className="w-full">
              {['Abusive or inappropriate', 'Spam or advertising', 'Harassment or bullying', 'Scam or phishing', 'Other'].map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1.5 text-[0.72rem] font-extrabold text-mist-400">
            Details (optional)
            <TextArea value={reportDetail} onChange={(event) => setReportDetail(event.target.value.slice(0, 300))} maxLength={300} rows={4} placeholder="Add context for the moderators…" />
          </label>
        </div>
      </Modal>

      {/* -------------------------------------------------- quiz plan modal
          Uses the shared Modal so the dialog gets a max-height + internal
          scroll and the action bar stays pinned in its footer: the Send button
          can never escape the panel on tall screens, and a mobile keyboard can
          never push it out of reach. */}
      <Modal icon={CalendarPlusIcon} tone="pulse"
        open={Boolean(planFor && selected)}
        onClose={() => setPlanFor(null)}
        title={selected ? `Plan a quiz with ${selected.name.split(' ')[0]}` : 'Plan a quiz'}
        subtitle="They get a card in the chat with the exam and your proposed time."
        footer={
          planFor ? (
            <>
              <Button variant="outline" onClick={() => setPlanFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !planFor.quizId}
                onClick={() => {
                  const quiz = quizzes.find((row) => row.id === planFor.quizId);
                  const whenIso = planFor.when ? new Date(planFor.when).toISOString() : '';
                  void send('quiz', quiz ? `Let's sit ${quiz.title}${whenIso ? ` on ${formatDateTime(whenIso)}` : ''}` : 'Quiz plan', {
                    quiz_id: planFor.quizId,
                    title: quiz?.title ?? 'Exam',
                    when: whenIso,
                  });
                  setPlanFor(null);
                }}
                icon={<CalendarPlus className="size-4" />}
              >
                Send plan
              </Button>
            </>
          ) : null
        }
      >
        {planFor && (
          <div className="space-y-3">
            <div>
              <label className="block text-[0.68rem] font-black tracking-[0.16em] text-mist-500">Exam</label>
              <Select
                value={planFor.quizId}
                onChange={(event) => setPlanFor({...planFor, quizId: Number(event.target.value)})}
                className="mt-1 w-full rounded-2xl border border-white/12 bg-ink-900/70 px-3.5 py-3 text-base font-semibold text-mist-50 focus:border-nova-400/60 focus:outline-none"
              >
                {quizzes.map((quiz) => (
                  <option key={quiz.id} value={quiz.id}>
                    {quiz.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-[0.68rem] font-black tracking-[0.16em] text-mist-500">When (optional)</label>
              <input
                type="datetime-local"
                value={planFor.when}
                onChange={(event) => setPlanFor({...planFor, when: event.target.value})}
                className="mt-1 w-full rounded-2xl border border-white/12 bg-ink-900/70 px-3.5 py-3 text-base font-semibold text-mist-50 focus:border-nova-400/60 focus:outline-none"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
