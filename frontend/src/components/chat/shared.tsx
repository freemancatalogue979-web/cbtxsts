import {Copy, Flag, Pencil, Reply, SmilePlus, Trash2} from 'lucide-react';
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
}: {
  message: ChatMessage;
  mine: boolean;
  onReply?: () => void;
  onOpenReactions?: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  onReport?: () => void;
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
  actions.push({
    key: 'delete', label: mine && !gone ? 'Delete for both' : 'Hide for me',
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
      {reply.name && <span className="font-black">{reply.name}</span>}
      {reply.snippet ? `${reply.name ? ': ' : ''}${reply.snippet}` : ''}
    </>
  );
  const className = `mb-1.5 block w-full border-l-2 pl-2 text-left text-[0.68rem] leading-snug font-semibold ${
    variant === 'pro'
      ? 't-reply-quote'
      : mine ? 'theme-ok border-white/60 text-white/85' : 'border-nova-400/60 text-mist-400'
  } ${canJump ? 'cursor-pointer active:opacity-80 hover:opacity-90' : ''}`;
  const style = variant === 'pro' ? {borderColor: 'var(--pro-accent, #8b5cf6)'} : undefined;
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
  message: ChatMessage;
  mine: boolean;
  onToggle: (emoji: string) => void;
  variant?: 'arena' | 'pro';
}) {
  const entries = Object.entries(message.reactions ?? {}).filter(([, count]) => count > 0);
  if (!entries.length || message.deleted) return null;
  const mineSet = new Set(message.my_reactions ?? []);
  return (
    <div className={`mt-1 flex min-w-0 flex-wrap gap-1 ${variant === 'arena' && mine ? 'justify-end' : ''}`}>
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

