/**
 * Pro Mode shell — "the interface disappears behind the work".
 *
 *   ≥1024px   fixed sidebar + slim top bar
 *   768–1023  top bar with a navigation drawer
 *   <768px    top bar + four-item bottom bar + drawer for the rest
 *
 * No music, no sound, no mascots, no reward pop-ups (see lib/mode.ts). The
 * command menu (Ctrl+K, or Ctrl+/) reaches every workspace, exam and material.
 */
import {Search, LogOut, Menu, Moon, Sun, Monitor, Sparkles, X, ArrowLeftRight, Settings as SettingsIcon, ChevronDown} from 'lucide-react';
import {MotionConfig} from 'motion/react';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import CommandPalette from '../components/CommandPalette';
import {jumpToMaterial} from '../lib/palette';
import {setAppearance, setExperience, useExperience, type Appearance} from '../lib/mode';
import type {Tab} from '../lib/nav';
import type {Quiz} from '../lib/types';
import {askTutor} from '../lib/tutor';
import {useSession} from '../store/session';
import {PRO_MOBILE, PRO_NAV, PRO_SETTINGS, proLabel} from './nav';

const APPEARANCE_NEXT: Record<Appearance, Appearance> = {dark: 'light', light: 'system', system: 'dark'};
const APPEARANCE_ICON = {dark: Moon, light: Sun, system: Monitor};

function Brand({compact = false}: {compact?: boolean}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <img src="/brand/ag-icon-192.png" alt="" width={28} height={28} className="size-7 shrink-0 rounded-md" draggable={false} />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[0.8125rem] font-semibold tracking-tight" style={{color: 'var(--pro-text)'}}>
            Absolute Genesis
          </p>
          <p className="text-[0.625rem] font-semibold tracking-[0.14em]" style={{color: 'var(--pro-accent-text)'}}>
            PRO
          </p>
        </div>
      )}
    </div>
  );
}

function NavList({tab, onTab, onDone}: {tab: Tab; onTab: (tab: Tab) => void; onDone?: () => void}) {
  const current = tab === 'profile' ? 'settings' : tab;
  return (
    <nav aria-label="Pro navigation" className="grid gap-0.5">
      {PRO_NAV.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className="pro-nav-item"
            aria-current={current === item.id ? 'page' : undefined}
            onClick={() => {
              onTab(item.id);
              onDone?.();
            }}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function ProShell({
  tab,
  onTab,
  onSignOut,
  onStartExam,
  children,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  onSignOut: () => void;
  onStartExam: (quiz: Quiz) => void;
  children: ReactNode;
}) {
  const {profile} = useSession();
  const {appearance} = useExperience();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [account, setAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const AppearanceIcon = APPEARANCE_ICON[appearance];
  const mainRef = useRef<HTMLElement>(null);

  /* Keyboard: Ctrl/⌘+K command menu, Ctrl/⌘+/ search, Esc closes. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === 'k' || event.key === 'K' || event.key === '/')) {
        event.preventDefault();
        setPalette(true);
      } else if (event.key === 'Escape') {
        setDrawer(false);
        setAccount(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!account) return undefined;
    const onDown = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccount(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [account]);

  /* New workspace → top of the page, focus to main for screen readers. */
  useEffect(() => {
    window.scrollTo({top: 0});
  }, [tab]);

  const go = (next: Tab) => {
    setDrawer(false);
    onTab(next);
  };

  const paletteTabs = useMemo(() => [...PRO_NAV, PRO_SETTINGS].map((row) => ({id: row.id, label: row.label, icon: row.icon, hint: row.hint})), []);
  const paletteActions = useMemo(
    () => [
      {key: 'ask-ai', label: 'Ask AI', hint: 'Open the AI Study Assistant', icon: Sparkles, run: () => {
        onTab('tutor');
        askTutor({newChat: true});
      }},
      {key: 'appearance', label: 'Toggle appearance', hint: 'Dark · Light · System', icon: Moon, run: () => setAppearance(APPEARANCE_NEXT[appearance])},
      {key: 'standard', label: 'Switch to Standard mode', hint: 'Same account and progress, playful interface', icon: ArrowLeftRight, run: () => setExperience('standard')},
    ],
    [appearance, onTab],
  );

  const initials = profile?.initials || (profile?.name || '?').slice(0, 2).toUpperCase();

  return (
    <MotionConfig reducedMotion="always">
      <div className="pro-app">
        <a href="#pro-main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] pro-btn">
          Skip to content
        </a>

        {/* ------------------------------------------------ sidebar (desktop) */}
        <aside className="pro-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex">
          <div className="flex h-14 items-center px-4">
            <Brand />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <NavList tab={tab} onTab={go} />
          </div>
          <div className="grid gap-0.5 border-t px-3 py-3" style={{borderColor: 'var(--pro-border)'}}>
            <button type="button" className="pro-nav-item" aria-current={tab === 'settings' || tab === 'profile' ? 'page' : undefined} onClick={() => go('settings')}>
              <SettingsIcon className="size-4 shrink-0" />
              <span>Settings</span>
            </button>
            <button type="button" className="pro-nav-item" onClick={() => setExperience('standard')}>
              <ArrowLeftRight className="size-4 shrink-0" />
              <span>Standard mode</span>
            </button>
          </div>
        </aside>

        <div className="lg:pl-60">
          {/* ------------------------------------------------------ top bar */}
          <header className="pro-topbar print-hide sticky top-0 z-20 safe-top">
            <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-3 md:px-6 lg:px-8">
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon lg:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}>
                <Menu className="size-5" />
              </button>
              <div className="min-w-0 lg:hidden">
                <p className="truncate text-[0.9375rem] font-semibold" style={{color: 'var(--pro-text)'}}>
                  {proLabel(tab)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPalette(true)}
                className="pro-input ml-auto hidden max-w-sm items-center gap-2 text-left md:flex lg:ml-0"
                aria-label="Search (Ctrl+K)"
              >
                <Search className="size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
                <span className="min-w-0 flex-1 truncate text-[0.875rem]" style={{color: 'var(--pro-muted)'}}>
                  Search courses, exams, materials…
                </span>
                <span className="pro-kbd">Ctrl K</span>
              </button>

              <div className="ml-auto flex items-center gap-1">
                <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon md:hidden" aria-label="Search" onClick={() => setPalette(true)}>
                  <Search className="size-[18px]" />
                </button>
                <button
                  type="button"
                  className="pro-btn pro-btn-ghost pro-btn-icon"
                  aria-label={`Appearance: ${appearance}. Switch to ${APPEARANCE_NEXT[appearance]}`}
                  title={`Appearance: ${appearance}`}
                  onClick={() => setAppearance(APPEARANCE_NEXT[appearance])}
                >
                  <AppearanceIcon className="size-[18px]" />
                </button>
                <div ref={accountRef} className="relative">
                  <button
                    type="button"
                    className="pro-btn pro-btn-ghost gap-1.5 px-1.5"
                    aria-haspopup="menu"
                    aria-expanded={account}
                    aria-label="Account menu"
                    onClick={() => setAccount((open) => !open)}
                  >
                    <span
                      className="grid size-7 place-items-center rounded-full text-[0.6875rem] font-semibold"
                      style={{background: 'var(--pro-accent-soft)', color: 'var(--pro-accent-text)'}}
                    >
                      {initials}
                    </span>
                    <ChevronDown className="hidden size-3.5 sm:block" />
                  </button>
                  {account && (
                    <div role="menu" className="pro-pop absolute top-full right-0 z-40 mt-1.5 w-60 p-1.5">
                      <div className="px-2.5 py-2">
                        <p className="truncate text-[0.875rem] font-semibold" style={{color: 'var(--pro-text)'}}>
                          {profile?.name}
                        </p>
                        <p className="pro-meta truncate">@{profile?.username}</p>
                      </div>
                      <div className="pro-divider my-1" />
                      <button role="menuitem" type="button" className="pro-menu-item" onClick={() => { setAccount(false); go('settings'); }}>
                        <SettingsIcon className="size-4" /> Settings
                      </button>
                      <button role="menuitem" type="button" className="pro-menu-item" onClick={() => { setAccount(false); setExperience('standard'); }}>
                        <ArrowLeftRight className="size-4" /> Switch to Standard
                      </button>
                      <div className="pro-divider my-1" />
                      <button role="menuitem" type="button" className="pro-menu-item" onClick={() => { setAccount(false); onSignOut(); }}>
                        <LogOut className="size-4" /> Sign out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>

          {/* ------------------------------------------------------ content */}
          <main
            id="pro-main"
            ref={mainRef}
            tabIndex={-1}
            className="mx-auto w-full max-w-[1280px] min-w-0 px-4 pt-5 pb-28 focus:outline-none md:px-6 md:pt-8 md:pb-12 lg:px-8"
          >
            <div key={tab} className="pro-page min-w-0">
              {children}
            </div>
          </main>
        </div>

        {/* -------------------------------------------------- phone bottom bar */}
        <nav aria-label="Primary" className="pro-bottom-nav print-hide fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 pb-[env(safe-area-inset-bottom)] md:hidden">
          {PRO_MOBILE.map((id) => {
            const item = PRO_NAV.find((row) => row.id === id)!;
            const Icon = item.icon;
            return (
              <button key={id} type="button" className="pro-bottom-item" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
                <Icon className="size-5" />
                <span className="max-w-full truncate px-1">{item.label === 'AI Assistant' ? 'AI' : item.label}</span>
              </button>
            );
          })}
          <button type="button" className="pro-bottom-item" aria-label="More" onClick={() => setDrawer(true)}>
            <Menu className="size-5" />
            <span>More</span>
          </button>
        </nav>

        {/* ---------------------------------------------------------- drawer */}
        {drawer && (
          <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" aria-label="Close navigation" className="scrim absolute inset-0" onClick={() => setDrawer(false)} />
            <div className="pro-sidebar absolute inset-y-0 left-0 flex w-[min(18rem,86vw)] flex-col pb-[env(safe-area-inset-bottom)]">
              <div className="flex h-14 items-center justify-between px-4 safe-top">
                <Brand />
                <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon" aria-label="Close navigation" onClick={() => setDrawer(false)}>
                  <X className="size-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                <NavList tab={tab} onTab={go} onDone={() => setDrawer(false)} />
              </div>
              <div className="grid gap-0.5 border-t px-3 py-3" style={{borderColor: 'var(--pro-border)'}}>
                <button type="button" className="pro-nav-item" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => go('settings')}>
                  <SettingsIcon className="size-4" /> Settings
                </button>
                <button type="button" className="pro-nav-item" onClick={() => { setDrawer(false); setExperience('standard'); }}>
                  <ArrowLeftRight className="size-4" /> Standard mode
                </button>
                <button type="button" className="pro-nav-item" onClick={() => { setDrawer(false); onSignOut(); }}>
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        <CommandPalette
          open={palette}
          onClose={() => setPalette(false)}
          onTab={go}
          tabs={paletteTabs}
          actions={paletteActions}
          onStartExam={onStartExam}
          placeholder="Search workspaces, exams, materials, commands…"
          onOpenMaterial={(id) => {
            go('materials');
            jumpToMaterial(id);
          }}
        />
      </div>
    </MotionConfig>
  );
}
