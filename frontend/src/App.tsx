/** Root router: login, dashboard tabs, exam engine, duel arena, results, admin. */
import {ChevronLeft, Coins, Shield} from 'lucide-react';
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {AppShell} from './components/AppShell';
import {Wordmark} from './components/Brand';
import {ErrorBoundary} from './components/ErrorBoundary';
import {CelebrationLayer, Toasts} from './components/Overlays';
import {Button, Chip} from './components/ui';
import {applyFxProfile} from './lib/fx';
import {jumpToMaterial} from './lib/palette';
import {TABS} from './lib/nav';
import {formatNumber} from './lib/format';
import type {Tab} from './lib/nav';
import type {AttemptSummary, Duel, Quiz, RewardEvent} from './lib/types';
import Admin from './views/Admin';
import Dashboard from './views/Dashboard';
import DuelArena from './views/Duel';
import Room from './views/Room';
import Exam from './views/Exam';
import Welcome from './views/Welcome';
import Result from './views/Result';
import {useSession} from './store/session';

type Route =
  | {view: 'dashboard'; tab: Tab}
  | {view: 'exam'; quiz?: Quiz; attemptId?: number}
  | {view: 'result'; attemptId: number}
  | {view: 'duel'; duelId: number}
  | {view: 'room'; roomId: number}
  | {view: 'admin'};

const TAB_IDS = TABS.map((row) => row.id) as string[];

/** The routes worth putting in the address bar — every one of them reloads. */
function routePath(route: Route): string {
  switch (route.view) {
    case 'dashboard':
      return `#/${route.tab}`;
    case 'exam':
      return route.attemptId ? `#/exam/${route.attemptId}` : '#/exam';
    case 'result':
      return `#/result/${route.attemptId}`;
    case 'duel':
      return `#/duel/${route.duelId}`;
    case 'room':
      return `#/room/${route.roomId}`;
    default:
      return '#/admin';
  }
}

/**
 * Where the page opens. Tab routes and the id-based screens (an exam attempt, a
 * result, a duel, a room) all survive a reload, so a phone that locks mid-exam
 * comes back to the same question set instead of dumping the player home.
 */
function routeFromHash(): Route {
  if (typeof window === 'undefined') return {view: 'dashboard', tab: 'play'};
  const [head, rawId] = (window.location.hash || '').replace(/^#\/?/, '').split('/');
  const id = Number(rawId);
  const hasId = Number.isFinite(id) && id > 0;
  if (head && TAB_IDS.includes(head)) return {view: 'dashboard', tab: head as Tab};
  if (head === 'exam' && hasId) return {view: 'exam', attemptId: id};
  if (head === 'result' && hasId) return {view: 'result', attemptId: id};
  if (head === 'duel' && hasId) return {view: 'duel', duelId: id};
  if (head === 'room' && hasId) return {view: 'room', roomId: id};
  return {view: 'dashboard', tab: 'play'};
}

/**
 * The loading screen: the arena crest is the whole point of it, so it is shown
 * as big as the viewport allows with a soft pulse and a shimmer ring behind it.
 */
function Splash() {
  const reduced = useReducedMotion();
  return (
    <div className="aurora grid min-h-dvh place-items-center overflow-hidden px-6">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-50" />
      <div className="relative flex flex-col items-center gap-6">
        <div className="relative grid place-items-center">
          {/* soft brand halo */}
          <motion.span
            aria-hidden
            animate={reduced ? {opacity: 0.5} : {opacity: [0.35, 0.75, 0.35], scale: [0.94, 1.06, 0.94]}}
            transition={reduced ? {duration: 0} : {repeat: Infinity, duration: 2.6, ease: 'easeInOut'}}
            className="absolute size-56 rounded-full bg-nova-600/25 blur-3xl sm:size-72"
          />
          <motion.span
            aria-hidden
            animate={reduced ? {rotate: 0} : {rotate: 360}}
            transition={reduced ? {duration: 0} : {repeat: Infinity, duration: 3.6, ease: 'linear'}}
            className="absolute size-40 rounded-full border border-dashed border-white/15 sm:size-52"
          />
          <motion.img
            src="/brand/logo.webp"
            alt="Quiz Arena"
            draggable={false}
            initial={{opacity: 0, scale: 0.82}}
            animate={reduced ? {opacity: 1, scale: 1} : {opacity: 1, scale: [1, 1.05, 1]}}
            transition={reduced ? {duration: 0} : {opacity: {duration: 0.35}, scale: {repeat: Infinity, duration: 1.8, ease: 'easeInOut'}}}
            className="relative w-40 drop-shadow-[0_18px_40px_rgba(250,204,21,0.35)] sm:w-52 lg:w-60"
          />
        </div>
 <p className="game-title text-center font-display text-[0.9rem] font-black tracking-[0.34em] text-mist-400 sm:text-[1rem]">
          Entering the arena
        </p>
      </div>
    </div>
  );
}

/** Chrome for focused screens (exam, duel, result) — no bottom tabs. */
function FocusShell({children, onBack, backLabel}: {children: React.ReactNode; onBack: () => void; backLabel: string}) {
  const {profile} = useSession();
  return (
    <div className="aurora min-h-dvh">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-50" />
      {/* Same floating chrome as the main shell: no bar, no shadow — just the
          page's own back button and the player's coins, on top of the world. */}
      <header className="print-hide sticky top-0 z-50 safe-top">
        <div className="flex min-h-13 w-full items-center gap-2 px-2.5 py-1 sm:min-h-14 sm:gap-3 sm:px-5 lg:px-8">
          <Button variant="outline" size="sm" onClick={onBack} icon={<ChevronLeft className="size-4" />} className="float-chip -ml-1.5">
            <span className="hidden sm:inline">{backLabel}</span>
          </Button>
          <Wordmark size="sm" className="hidden sm:block" />
          {profile && (
            <div className="ml-auto flex items-center gap-2">
              <Chip className="float-chip border-gold-500/28 text-gold-300" icon={<Coins className="size-3.5" />}>
                {formatNumber(profile.coins)}
              </Chip>
              <Chip className="float-chip hidden border-nova-500/28 text-nova-300 sm:inline-flex">
                Lv {profile.progress.level}
              </Chip>
            </div>
          )}
        </div>
      </header>
      <main className="relative w-full px-3 pt-3.5 pb-8 sm:px-5 sm:py-5 lg:px-8">{children}</main>
    </div>
  );
}

export default function App() {
  const {ready, role, profile, signOut, on, toast, pushRewards, pushCelebration, refreshProfile} = useSession();
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [started, setStarted] = useState(false);

  /* ---------------------------------------------------------- navigation
     One door in and out of every screen. Each move is a real history entry, so
     the device back button (Android, the iOS edge swipe, the desktop browser)
     lands on the page the player actually came from — and the in-page back
     button simply asks the browser to go back, which keeps them identical. */
  const depth = useRef(0);
  const originTab = useRef<Tab>('play');
  const routeRef = useRef(route);
  routeRef.current = route;

  const navigate = useCallback((next: Route, mode: 'push' | 'replace' = 'push') => {
    if (next.view === 'dashboard') originTab.current = next.tab;
    if (typeof window !== 'undefined') {
      const url = routePath(next);
      if (mode === 'replace') {
        window.history.replaceState(next, '', url);
      } else {
        depth.current += 1;
        window.history.pushState(next, '', url);
      }
    }
    setRoute(next);
  }, []);

  /* The first entry is the page we opened on — never a push. */
  useEffect(() => {
    window.history.replaceState(routeRef.current, '', routePath(routeRef.current));
    const onPop = (event: PopStateEvent) => {
      depth.current = Math.max(0, depth.current - 1);
      const state = event.state as Route | null;
      const next = state && typeof state === 'object' && 'view' in state ? state : {view: 'dashboard' as const, tab: 'play' as Tab};
      if (next.view === 'dashboard') originTab.current = next.tab;
      setRoute(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* Back always means back: the previous screen when there is one, otherwise
     the tab this page was opened from. */
  const goBack = useCallback(
    (fallback: Tab = 'play') => {
      if (depth.current > 0) {
        window.history.back();
        return;
      }
      navigate({view: 'dashboard', tab: fallback}, 'replace');
    },
    [navigate],
  );

  /** Back label for a focused page: it names the page it lands on. */
  const backLabel = () => TABS.find((row) => row.id === originTab.current)?.label ?? 'Back';

  useEffect(() => {
    if (ready) setStarted(true);
  }, [ready]);

  /* Game layer: measure the device once and stamp data-fx on <html>. */
  useEffect(() => {
    applyFxProfile();
  }, []);

  /* -------------------------------------------------- live duel routing */
  useEffect(
    () =>
      on('duel_start', (data) => {
        const duel = data as Duel;
        navigate({view: 'duel', duelId: duel.id});
      }),
    [on, navigate],
  );

  useEffect(
    () =>
      on('duel_invite', () => {
        if (routeRef.current.view === 'dashboard') navigate({view: 'dashboard', tab: 'duels'}, 'replace');
      }),
    [on, navigate],
  );

  useEffect(
    () =>
      on('duel_result', (data) => {
        const duel = data as Duel & {rewards?: RewardEvent[]};
        void refreshProfile();
        {
          const current = routeRef.current;
          // If the player is already in the arena, that screen handles the reveal.
          if (current.view === 'duel' && current.duelId === duel.id) return;
          const iWon = duel.winner_id === profile?.id;
          if (iWon) {
            pushCelebration({
              kind: 'duel_win',
              title: 'Duel won!',
              subtitle: `Code ${duel.code}`,
              detail: 'You took the pot.',
              rewards: duel.rewards,
            });
          } else {
            toast(duel.draw ? 'info' : 'error', duel.draw ? 'Duel drawn' : 'Duel lost', `Stake settled on duel ${duel.code}.`);
            if (duel.rewards?.length) pushRewards(duel.rewards);
          }
        }
      }),
    [on, profile?.id, pushCelebration, pushRewards, refreshProfile, toast],
  );

  useEffect(
    () =>
      on('claim_updated', (data) => {
        const payload = data as {prize: string; status: string; note: string};
        toast(payload.status === 'rejected' ? 'error' : 'success', `Prize ${payload.status}`, payload.prize);
        void refreshProfile();
      }),
    [on, refreshProfile, toast],
  );

  useEffect(
    () =>
      on('config_updated', () => {
        void 0;
      }),
    [on],
  );

  if (!started || !ready) return <Splash />;

  /* ------------------------------------------------------------- admin */
  if (role === 'admin') {
    return (
      <>
        <Admin onExit={signOut} />
        <Toasts />
        <CelebrationLayer />
      </>
    );
  }

  if (role !== 'student' || !profile) {
    return (
      <>
        <Welcome onAdminMode={() => navigate({view: 'admin'}, 'replace')} />
        <Toasts />
        <CelebrationLayer />
      </>
    );
  }

  const startExam = (quiz: Quiz) => {
    const attempt: AttemptSummary | null | undefined = quiz.my_attempt;
    if (attempt?.status === 'in_progress') {
      navigate({view: 'exam', attemptId: attempt.id, quiz});
      return;
    }
    if (attempt && (attempt.status === 'submitted' || attempt.status === 'expired')) {
      navigate({view: 'result', attemptId: attempt.id});
      return;
    }
    navigate({view: 'exam', quiz});
  };

  const openDuel = (duel: Duel) => navigate({view: 'duel', duelId: duel.id});
  const openRoom = (roomId: number) => navigate({view: 'room', roomId});
  const backToDashboard = (tab: Tab = 'play') => navigate({view: 'dashboard', tab});

  return (
    <>
      <ErrorBoundary key={route.view} label={route.view}>
      <AnimatePresence mode="wait">
        <motion.div
          key={route.view}
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          transition={{duration: 0.2}}
        >
          {route.view === 'dashboard' && (
            <AppShell
              tab={route.tab}
              onTab={(tab) => navigate({view: 'dashboard', tab})}
              onAdmin={() => toast('info', 'Staff only', 'Sign out and use the Staff tab to manage the arena.')}
              onProfile={() => navigate({view: 'dashboard', tab: 'profile'})}
              onSignOut={signOut}
            >
              <Dashboard
                tab={route.tab}
                onStartExam={startExam}
                onOpenDuel={openDuel}
                onOpenRoom={openRoom}
                onOpenResult={(attemptId) => navigate({view: 'result', attemptId})}
                onOpenDuels={() => navigate({view: 'dashboard', tab: 'duels'})}
                onOpenMaterial={(materialId) => {
                  navigate({view: 'dashboard', tab: 'materials'});
                  jumpToMaterial(materialId);
                }}
                onSignOut={signOut}
              />
            </AppShell>
          )}

          {route.view === 'exam' && (
            <FocusShell onBack={() => goBack('play')} backLabel={backLabel()}>
              <Exam
                quiz={route.quiz}
                attemptId={route.attemptId}
                /* Submitting swaps the exam screen for the result: replace, so
                   back never walks into a paper that is already handed in. */
                onFinished={(attemptId) => navigate({view: 'result', attemptId}, 'replace')}
                onExit={() => goBack('play')}
                /* Name the attempt in the address as soon as it exists, so a
                   refresh mid-paper reopens this exact attempt. */
                onAttempt={(id) =>
                  navigate({view: 'exam', attemptId: id, quiz: route.view === 'exam' ? route.quiz : undefined}, 'replace')
                }
              />
            </FocusShell>
          )}

          {route.view === 'result' && (
            <FocusShell onBack={() => goBack('play')} backLabel={backLabel()}>
              <Result
                attemptId={route.attemptId}
                onExit={() => goBack('play')}
                onLeaderboard={() => backToDashboard('ranks')}
              />
            </FocusShell>
          )}

          {route.view === 'duel' && (
            <FocusShell onBack={() => goBack('duels')} backLabel={backLabel()}>
              <DuelArena key={route.duelId} duelId={route.duelId} onExit={() => goBack('duels')} onOpenDuels={() => backToDashboard('duels')} />
            </FocusShell>
          )}

          {route.view === 'room' && (
            <FocusShell onBack={() => goBack('duels')} backLabel={backLabel()}>
              <Room roomId={route.roomId} onExit={() => goBack('duels')} />
            </FocusShell>
          )}
        </motion.div>
      </AnimatePresence>
      </ErrorBoundary>

      <Toasts />
      <CelebrationLayer />

      {role === 'student' && (
        <button
          onClick={() => toast('info', 'Staff console', 'Sign out, then use the Staff tab on the login screen.')}
          className="print-hide fixed bottom-24 left-4 z-40 hidden items-center gap-1.5 rounded-full border border-white/12 bg-ink-900/80 px-3 py-1.5 text-[0.7rem] font-bold text-mist-500 backdrop-blur transition-colors hover:text-mist-200 lg:flex"
          title="Admin console"
        >
          <Shield className="size-3.5" /> Staff
        </button>
      )}
    </>
  );
}
