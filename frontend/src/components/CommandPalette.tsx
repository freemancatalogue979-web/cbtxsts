import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { groupLabel, searchNav, type NavItem } from "../lib/nav";
import { accentFor, sectionTheme } from "../lib/theme";

/**
 * Quick jump: Ctrl/⌘ + K (or the search button) opens a filterable list of
 * every area. Arrow keys move, Enter opens, Escape closes. It is a standard
 * combobox + listbox, so screen readers announce the active option.
 */
export function CommandPalette({ items, current, onClose, onGo }: {
  items: NavItem[]; current: string; onClose: () => void; onGo: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const restore = useRef<Element | null>(null);
  const listId = useId();
  const results = useMemo(() => searchNav(items, query), [items, query]);

  useEffect(() => {
    restore.current = document.activeElement;
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      // Put focus back where it was, so keyboard users don't lose their place.
      if (restore.current instanceof HTMLElement) restore.current.focus();
    };
  }, []);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (item: NavItem | undefined) => { if (item) { onGo(item.id); onClose(); } };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => (results.length ? (i + 1) % results.length : 0)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0)); }
    if (event.key === "Enter") { event.preventDefault(); go(results[active]); }
    // Keep Tab inside the dialog: there is only the search box to focus.
    if (event.key === "Tab") event.preventDefault();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[12vh] sm:p-6 sm:pt-[14vh]" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Jump to a page"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-edge bg-panel/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search size={17} className="text-faint shrink-0" aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to… scrims, drafts, heroes"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            aria-autocomplete="list"
            aria-label="Search pages"
            className="h-14 w-full bg-transparent text-[15px] text-text placeholder:text-faint focus:outline-none"
          />
          <span className="kbd hidden sm:inline-flex">Esc</span>
        </div>
        <ul ref={list} id={listId} role="listbox" aria-label="Pages" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-[13px] text-faint" role="presentation">No page matches “{query}”.</li>
          )}
          {results.map((item, index) => {
            const Icon = item.icon;
            const selected = index === active;
            const accent = accentFor(sectionTheme(item.id).accent);
            return (
              <li
                key={item.id}
                id={`${listId}-${item.id}`}
                data-index={index}
                role="option"
                aria-selected={selected}
                onMouseMove={() => setActive(index)}
                onClick={() => go(item)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${selected ? "bg-white/[0.07]" : ""}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={{ color: accent.text, background: `color-mix(in srgb, ${accent.text} 14%, transparent)` }}>
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13.5px] font-bold text-text">
                    {item.label}
                    {item.id === current && <span className="chip !py-0 !text-[9px] uppercase">You are here</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-faint">{groupLabel(item.group)} · {item.blurb}</span>
                </span>
                {selected && <CornerDownLeft size={15} className="shrink-0 text-faint" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-edge px-4 py-2 text-[10.5px] text-faint">
          <span className="inline-flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
          <span className="inline-flex items-center gap-1"><span className="kbd">Enter</span> open</span>
          <span className="ml-auto hidden sm:inline">Ctrl / ⌘ + K anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
