/**
 * Command palette — the arena's quick-jump.
 *
 * One keystroke (⌘K / Ctrl+K, or `/` outside a text field) opens a fuzzy search
 * over every tab, the exam catalogue and the study materials. Results are a
 * plain list of buttons so it works the same on a phone (full-width sheet) as
 * on a desktop (centred dialog). Recently opened rows are remembered on the
 * device with the shared cache helper, so the top of the list is what *you*
 * actually use.
 */
import {BookOpen, CornerDownLeft, Gamepad2, Search, Sparkles, X} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {TABS, type Tab} from '../lib/nav';
import {api} from '../lib/api';
import {cacheRead, cacheWrite, userScope} from '../lib/cache';
import {useSession} from '../store/session';
import type {MaterialCard, Quiz} from '../lib/types';

type Hit = {
  key: string;
  label: string;
  hint: string;
  icon: typeof Search;
  score: number;
  run: () => void;
};

const RECENT_KEY = 'palette.recent';
const EXAM_ICON = Gamepad2;

/** Tiny subsequence matcher: every query character must appear in order. */
function fuzzyScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 1000 - direct * 4 - (haystack.length - needle.length);
  let index = 0;
  let score = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found < 0) return -1;
    score += found === index ? 6 : 2;
    index = found + 1;
  }
  return score;
}

export default function CommandPalette({
  open,
  onClose,
  onTab,
  onOpenMaterial,
}: {
  open: boolean;
  onClose: () => void;
  onTab: (tab: Tab) => void;
  onOpenMaterial: (materialId: number) => void;
}) {
  const {profile, toast} = useSession();
  const scope = userScope(profile?.id);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [materials, setMaterials] = useState<MaterialCard[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const recent = useMemo(() => cacheRead<{key: string; label: string}[]>(scope, RECENT_KEY) ?? [], [scope, open]);

  /* Catalogue is fetched once per session and refreshed in the background. */
  useEffect(() => {
    if (!open) return;
    api
      .quizzes()
      .then(setQuizzes)
      .catch(() => undefined);
    api.materials
      .library({limit: 40})
      .then((payload) => setMaterials(payload.items ?? []))
      .catch(() => undefined);
  }, [open]);

  /* Debounced material search while typing. */
  useEffect(() => {
    if (!open || query.trim().length < 2) return undefined;
    const handle = window.setTimeout(() => {
      api.materials
        .library({search: query.trim(), limit: 8})
        .then((payload) => setMaterials(payload.items ?? []))
        .catch(() => undefined);
    }, 240);
    return () => window.clearTimeout(handle);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    const handle = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(handle);
  }, [open]);

  const remember = useCallback(
    (key: string, label: string) => {
      const next = [{key, label}, ...recent.filter((row) => row.key !== key)].slice(0, 5);
      cacheWrite(scope, RECENT_KEY, next);
    },
    [recent, scope],
  );

  const hits = useMemo<Hit[]>(() => {
    const build = (): Hit[] => {
      const rows: Hit[] = [];
      for (const tab of TABS) {
        rows.push({
          key: `tab:${tab.id}`,
          label: tab.label,
          hint: 'Go to tab',
          icon: tab.icon,
          score: 0,
          run: () => {
            remember(`tab:${tab.id}`, tab.label);
            onTab(tab.id);
            onClose();
          },
        });
      }
      for (const quiz of quizzes) {
        rows.push({
          key: `exam:${quiz.id}`,
          label: quiz.title,
          hint: `${quiz.question_count} questions · ${quiz.status}`,
          icon: EXAM_ICON,
          score: 0,
          run: () => {
            remember(`exam:${quiz.id}`, quiz.title);
            onTab('play');
            onClose();
            toast('info', quiz.title, 'Open the exam from the Play tab to start the clock.');
          },
        });
      }
      for (const material of materials) {
        rows.push({
          key: `material:${material.id}`,
          label: material.title,
          hint: `${material.topic || material.course_title || 'Material'} · ${material.status}`,
          icon: BookOpen,
          score: 0,
          run: () => {
            remember(`material:${material.id}`, material.title);
            onOpenMaterial(material.id);
            onClose();
          },
        });
      }
      return rows;
    };
    const rows = build();
    const term = query.trim();
    if (!term) {
      // No query: recents first, then tabs, then the catalogue.
      const order = new Map(recent.map((row, index) => [row.key, index]));
      return rows
        .map((row) => ({...row, score: order.has(row.key) ? 500 - (order.get(row.key) as number) * 10 : 0}))
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
        .slice(0, 40);
    }
    return rows
      .map((row) => ({...row, score: Math.max(fuzzyScore(row.label, term), fuzzyScore(row.hint, term) - 120)}))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 30);
  }, [materials, onClose, onOpenMaterial, onTab, query, quizzes, recent, remember, toast]);

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(hits.length - 1, 0)));
  }, [hits.length]);

  const move = (delta: number) => {
    if (!hits.length) return;
    setCursor((current) => (current + delta + hits.length) % hits.length);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center scrim p-3 pt-[max(env(safe-area-inset-top,0px),0.75rem)] backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Quick jump"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="min-w-0 w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-ink-900/95 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5">
          <Search className="size-4 shrink-0 text-nova-300" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 80))}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                hits[cursor]?.run();
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Jump to a tab, exam or material…"
            aria-label="Search the arena"
            /* text-base keeps iOS from zooming the page on focus. */
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-mist-50 placeholder:text-mist-600 focus:outline-none"
          />
          <button onClick={onClose} aria-label="Close quick jump" className="shrink-0 text-mist-500 transition-colors hover:text-mist-200">
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[62dvh] overflow-y-auto overscroll-contain p-1.5">
          {hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-[0.8rem] font-semibold text-mist-500">Nothing matches “{query}”.</p>
          ) : (
            <ul className="space-y-0.5">
              {hits.map((hit, index) => {
                const Icon = hit.icon;
                const active = index === cursor;
                return (
                  <li key={hit.key}>
                    <button
                      onMouseEnter={() => setCursor(index)}
                      onClick={hit.run}
                      className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                        active ? 'bg-nova-500/16 ring-1 ring-nova-400/30' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <Icon className={`size-4 shrink-0 ${active ? 'text-nova-200' : 'text-mist-500'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.85rem] font-bold text-mist-100">{hit.label}</span>
                        <span className="block truncate text-[0.66rem] font-semibold text-mist-500">{hit.hint}</span>
                      </span>
                      {active && <CornerDownLeft className="hidden size-3.5 shrink-0 text-mist-500 sm:block" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/8 px-3 py-2 text-[0.62rem] font-bold text-mist-600">
          <span className="flex items-center gap-1">
            <Sparkles className="size-3 text-gold-300" /> {hits.length} result{hits.length === 1 ? '' : 's'}
          </span>
          <span className="ml-auto hidden sm:inline">↑↓ move · ⏎ open · esc close</span>
        </div>
      </div>
    </div>
  );
}
