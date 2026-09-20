/**
 * Holdable — press and hold something to get its actions (reply, delete,
 * remove, dismiss…). No permanent buttons, no swipe panels: the row looks
 * exactly like it always did until you hold it.
 *
 * • Touch, pen and mouse all work; a hold is abandoned the moment the pointer
 *   travels far enough to mean "they are scrolling".
 * • Desktop players also get a tiny `⋯` that fades in on hover, because a
 *   mouse press-and-hold is not an obvious gesture.
 * • The menu is portalled to the body so nothing clips it, closes on outside
 *   press / Escape / any action, and only one is open at a time.
 */
import {MoreHorizontal} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
import {HOLD_MS, holdAbandoned, menuPosition, menuSize} from '../lib/hold';
import {HAPTICS} from '../lib/haptics';
import {sfx} from '../lib/sfx';

export interface HoldAction {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: 'danger' | 'accent' | 'neutral';
  onAction: () => void;
}

const TONES: Record<'danger' | 'accent' | 'neutral', string> = {
  danger: 'text-flare-300 hover:bg-flare-500/12',
  accent: 'text-nova-200 hover:bg-nova-500/12',
  neutral: 'text-mist-200 hover:bg-white/6',
};

/* Only one menu open at a time. */
const openMenus = new Set<() => void>();
function closeOthers(self: () => void): void {
  openMenus.forEach((close) => {
    if (close !== self) close();
  });
}

export function Holdable({
  actions,
  children,
  className = '',
  contentClassName = '',
  disabled = false,
  hint = 'Hold for options',
  desktopTrigger = true,
  allowOnButton = false,
  menuWidth,
}: {
  actions: HoldAction[];
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  hint?: string;
  desktopTrigger?: boolean;
  allowOnButton?: boolean;
  menuWidth?: number;
}) {
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null);
  const timer = useRef<number | null>(null);
  const origin = useRef<{x: number; y: number} | null>(null);
  const suppressClick = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    openMenus.add(close);
    return () => {
      openMenus.delete(close);
      clearTimer();
    };
  }, [close, clearTimer]);

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onScroll = () => close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [menu, close]);

  const open = (point: {x: number; y: number}) => {
    const size = menuSize(actions.length, menuWidth);
    const spot = menuPosition(point, size, {width: window.innerWidth, height: window.innerHeight});
    suppressClick.current = true;
    HAPTICS.tap();
    sfx.play('tick');
    closeOthers(close);
    setMenu(spot);
    // Release the click-block once the finger is up.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 600);
  };

  const start = (event: React.PointerEvent) => {
    if (disabled || actions.length === 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Presses that begin on a real control inside the row keep working.
    if (!allowOnButton && (event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    const point = {x: event.clientX, y: event.clientY};
    origin.current = point;
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      open(point);
    }, HOLD_MS);
  };

  return (
    <div className={`group/hold relative min-w-0 ${className}`}>
      <div
        className={`min-w-0 select-none ${contentClassName}`}
        style={{WebkitTouchCallout: 'none'} as React.CSSProperties}
        onPointerDown={start}
        onPointerMove={(event) => {
          if (!origin.current) return;
          if (holdAbandoned(event.clientX - origin.current.x, event.clientY - origin.current.y)) clearTimer();
        }}
        onPointerUp={clearTimer}
        onPointerCancel={clearTimer}
        onPointerLeave={clearTimer}
        onContextMenu={(event) => {
          // Right-click / long-press context menu becomes our own menu.
          if (disabled || actions.length === 0) return;
          event.preventDefault();
          open({x: event.clientX, y: event.clientY});
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>

      {desktopTrigger && !disabled && actions.length > 0 && (
        <button
          type="button"
          aria-label={hint}
          title={hint}
          onClick={(event) => {
            const rect = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            open({x: rect.left + rect.width / 2, y: rect.top + Math.min(28, rect.height / 2)});
          }}
          className="absolute top-1/2 right-1 hidden size-7 -translate-y-1/2 place-items-center rounded-full border border-white/12 bg-ink-900/80 text-mist-500 opacity-0 transition-opacity hover:text-mist-100 group-hover/hold:opacity-100 lg:grid"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}

      {menu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] scrim-soft"
            onPointerDown={(event) => {
              event.preventDefault();
              close();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              close();
            }}
          >
            <div
              role="menu"
              className="glass-strong absolute overflow-hidden rounded-2xl p-1 shadow-2xl shadow-black/60"
              style={{left: menu.x, top: menu.y, width: menuSize(actions.length, menuWidth).width}}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    action.onAction();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[0.82rem] font-bold transition-colors touch-manipulation ${
                    TONES[action.tone ?? 'neutral']
                  }`}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
