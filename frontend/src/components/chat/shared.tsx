import {Check, CheckCheck, Copy, Flag, Pencil, Reply, SmilePlus, Trash2} from 'lucide-react';
import type {ReactNode} from 'react';
import type {ChatMessage} from '../../lib/types';
import {Holdable, type HoldAction} from '../Holdable';

export const CHAT_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😮', '🤔', '✅'] as const;

/** One source of truth for the action menu shared by Friends and teacher chat. */
export function chatMessageActions({
  message,
  mine,
  onReply,
  onOpenReactions,
  onDelete,
  onEdit,
  onReport,
  deleteLabel,
}: {
  message: Pick<ChatMessage, 'body' | 'kind' | 'deleted'>;
  mine: boolean;
  onReply?: () => void;
  onOpenReactions?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onReport?: () => void;
  deleteLabel?: string;
}): HoldAction[] {
  const gone = Boolean(message.deleted);
  const actions: HoldAction[] = [];
  if (!gone && onReply) actions.push({key: 'reply', label: 'Reply', icon: <Reply className="size-4" />, tone: 'accent', onAction: onReply});
  if (!gone && onOpenReactions) actions.push({key: 'react', label: 'React', icon: <SmilePlus className="size-4" />, tone: 'neutral', onAction: onOpenReactions});
  if (!gone && message.body) {
    actions.push({
      key: 'copy', label: 'Copy text', icon: <Copy className="size-4" />, tone: 'neutral',
      onAction: () => { void navigator.clipboard?.writeText(message.body).catch(() => undefined); },
    });
  }
  if (!gone && mine && message.kind === 'text' && onEdit) actions.push({key: 'edit', label: 'Edit', icon: <Pencil className="size-4" />, tone: 'neutral', onAction: onEdit});
  if (onDelete) actions.push({
    key: 'delete', label: deleteLabel ?? (mine && !gone ? 'Delete for both' : 'Hide for me'),
    icon: <Trash2 className="size-4" />, tone: 'danger', onAction: onDelete,
  });
  if (!mine && !gone && onReport) actions.push({key: 'report', label: 'Report', icon: <Flag className="size-4" />, tone: 'danger', onAction: onReport});
  return actions;
}

/** Clickable reply quote; a valid reply id jumps to the original message. */
export function ChatReplyQuote({
  meta,
  mine,
  onJump,
  variant = 'arena',
}: {
  meta: Record<string, unknown>;
  mine: boolean;
  onJump?: (messageId: number) => void;
  variant?: 'arena' | 'pro';
}) {
  const reply = (meta?.reply_to ?? null) as {id?: number; name?: string; snippet?: string} | null;
  if (!reply) return null;
  const canJump = Number.isSafeInteger(reply.id) && Number(reply.id) > 0 && Boolean(onJump);
  const text = (
    <>
      {reply.name && <span className="block text-[0.66rem] font-bold text-nova-300">{reply.name}</span>}
      <span className="block truncate text-[0.72rem] font-medium text-mist-400">{reply.snippet || 'Message'}</span>
    </>
  );
  const className = 'mb-1 block w-full max-w-sm truncate rounded-lg border-l-2 border-nova-400/50 bg-white/4 px-2.5 py-1 text-left';
  const style = variant === 'pro' && mine ? {borderColor: 'var(--pro-accent, #8b5cf6)'} : undefined;
  return canJump ? (
    <button type="button" className={className} style={style} onClick={() => onJump?.(Number(reply.id))} aria-label="Jump to replied message">
      {text}
    </button>
  ) : (
    <span className={className} style={style}>{text}</span>
  );
}

/** Consistent, compact emoji picker opened by the single “React” action. */
export function ChatReactionPicker({
  onPick,
  onClose,
  variant = 'arena',
}: {
  onPick: (emoji: string) => void;
  onClose?: () => void;
  variant?: 'arena' | 'pro';
}) {
  return (
    <div className={`mt-1 flex max-w-full flex-wrap gap-1 rounded-xl p-1 ${variant === 'pro' ? 't-reaction-picker' : 'border border-white/10 bg-ink-950/90'}`} role="group" aria-label="Choose a reaction">
      {CHAT_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => { onPick(emoji); onClose?.(); }}
          className={`grid size-8 place-items-center rounded-lg text-base transition-colors ${variant === 'pro' ? 't-reaction-pick' : 'hover:bg-white/10 active:scale-95'}`}
          aria-label={`React with ${emoji}`}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
      {onClose && (
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-mist-500 hover:bg-white/10" aria-label="Close reactions" title="Close">
          ×
        </button>
      )}
    </div>
  );
}

/** A shared reaction row; style variants retain each mode's existing palette. */
export function ChatReactionChips({
  message,
  mine,
  onToggle,
  variant = 'arena',
}: {
  message: Pick<ChatMessage, 'reactions' | 'my_reactions' | 'deleted'>;
  mine: boolean;
  onToggle: (emoji: string) => void;
  variant?: 'arena' | 'pro';
}) {
  const entries = Object.entries(message.reactions ?? {}).filter(([, count]) => count > 0);
  if (!entries.length || message.deleted) return null;
  const mineSet = new Set(message.my_reactions ?? []);
  return (
    <div className="mt-1 flex min-w-0 flex-wrap gap-1" data-mine={mine || undefined}>
      {entries.map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-bold transition-colors ${
            variant === 'pro'
              ? mineSet.has(emoji) ? 't-reaction-chip t-reaction-chip-on' : 't-reaction-chip'
              : mineSet.has(emoji) ? 'border-nova-400/60 bg-nova-500/22 text-nova-100' : 'border-white/12 bg-white/[0.04] text-mist-400'
          }`}
          aria-label={`${mineSet.has(emoji) ? 'Remove' : 'Add'} ${emoji} reaction (${count})`}
          aria-pressed={mineSet.has(emoji)}
        >
          <span className="text-[0.8rem] leading-none">{emoji}</span>
          <span className="tabular">{count}</span>
        </button>
      ))}
    </div>
  );
}

/** Small utility for wrapping a bubble with the shared hold menu. */
export function ChatActionSurface({
  message,
  mine,
  children,
  onReply,
  onOpenReactions,
  onDelete,
  onEdit,
  onReport,
  className,
  menuWidth = 214,
}: {
  message: ChatMessage;
  mine: boolean;
  children: ReactNode;
  onReply?: () => void;
  onOpenReactions?: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  onReport?: () => void;
  className?: string;
  menuWidth?: number;
}) {
  return (
    <Holdable
      actions={chatMessageActions({message, mine, onReply, onOpenReactions, onDelete, onEdit, onReport})}
      hint="Hold a message for the full menu"
      menuWidth={menuWidth}
      className={className}
    >
      {children}
    </Holdable>
  );
}


/** The actual study-group bubble shape, reused instead of independently styled copies. */
export function chatBubbleClass(mine: boolean): string {
  return `inline-block max-w-full rounded-2xl rounded-tl-md px-3 py-1.5 text-[0.82rem] leading-snug font-semibold whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${mine ? 'brand-gradient text-white' : 'bg-white/8 text-mist-100'}`;
}

/** Canonical Study Group layout, used by Friends and Teacher chat too. */
export function ChatMessageRow({id, prefix, name, mine, time, avatar, presence, highlight, toolbar, children}: {
  id: number; prefix: string; name: string; mine: boolean; time: string;
  avatar: ReactNode; presence?: ReactNode; highlight?: boolean; toolbar?: ReactNode; children: ReactNode;
}) {
  return (
    <div data-chat-row data-mid={id} data-mine={mine || undefined} id={`${prefix}-${id}`}
      className={`group/msg flex w-full min-w-0 shrink-0 items-start gap-2 rounded-xl px-1.5 py-1 transition-colors ${highlight ? 'bg-nova-500/20 ring-1 ring-nova-400/40' : ''}`}>
      <div className="shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="truncate text-[0.72rem] font-extrabold text-mist-200">{mine ? 'You' : name}</span>
          {presence}
          <span className="ml-auto shrink-0 text-[0.62rem] font-semibold text-mist-600">{time}</span>
        </div>
        {children}
      </div>
      {toolbar}
    </div>
  );
}

export function ChatMessageToolbar({onReply, onReact, onEdit}: {onReply: () => void; onReact: () => void; onEdit?: () => void}) {
  const actions = [{label: 'Reply', Icon: Reply, run: onReply}, {label: 'React', Icon: SmilePlus, run: onReact}, ...(onEdit ? [{label: 'Edit', Icon: Pencil, run: onEdit}] : [])];
  return <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 sm:flex">
    {actions.map(({label, Icon, run}) => <button key={label} type="button" aria-label={label} title={label} onClick={run} className="grid size-8 place-items-center rounded-lg text-mist-500 hover:bg-white/8"><Icon className="size-4" /></button>)}
  </div>;
}

/** One bubble implementation; text, sizing and corners cannot drift by inbox. */
export function ChatBubble({mine, className = '', children}: {mine: boolean; className?: string; children: ReactNode}) {
  return <div data-chat-bubble className={`${chatBubbleClass(mine)} ${className}`}>{children}</div>;
}

export function ChatMessageMeta({edited, delivery}: {edited?: boolean; delivery?: 'sending' | 'failed' | 'sent' | 'seen'}) {
  if (!edited && !delivery) return null;
  return <span className="ml-1.5 inline-flex items-center gap-1 align-bottom text-[0.6rem] font-bold text-mist-600">
    {edited && <span className="italic">edited</span>}
    {delivery && <span className={`inline-flex items-center gap-0.5 ${delivery === 'failed' ? 'text-flare-300' : ''}`} aria-label={delivery}>
      {delivery === 'seen' ? <CheckCheck className="size-3 text-mint-400" /> : delivery === 'sent' ? <Check className="size-3 text-mint-400" /> : delivery === 'sending' ? 'sending…' : 'failed'}
    </span>}
  </span>;
}

export function ChatTombstone() {
  return <p className="mt-0.5 inline-block rounded-2xl rounded-tl-md bg-white/4 px-3 py-1.5 text-[0.78rem] italic text-mist-600">This message was deleted</p>;
}
