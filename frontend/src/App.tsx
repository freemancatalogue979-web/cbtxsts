/** Root router: login, dashboard tabs, exam engine, duel arena, results, admin. */
import {ChevronLeft, Coins, Shield} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {AppShell} from './components/AppShell';
import {Wordmark} from './components/Brand';
import {ErrorBoundary} from './components/ErrorBoundary';
import {CelebrationLayer, Toasts} from './components/Overlays';
import {Button, Chip} from './components/ui';
import {applyFxProfile} from './lib/fx';
import {jumpToMaterial} from './lib/palette';
import {ASK_TUTOR_EVENT, OPEN_MINI_EXAM_EVENT} from './lib/tutor';
import {PRO_ONLY_TABS, TABS} from './lib/nav';
import {isPro, useExperience} from './lib/mode';
import ProShell from './pro/ProShell';
import ProRoutes from './pro/ProRoutes';
import {formatNumber} from './lib/format';
import type {Tab} from './lib/nav';
import type {AttemptSummary, Duel, GroupSection, Quiz, RewardEvent} from './lib/types';
import Dashboard from './views/Dashboard';
import Exam from './views/Exam';
import Welcome from './views/Welcome';
import {useSession} from './store/session';
import {lazyScreen, prefetchWhenIdle} from './lib/lazy';
import {LIKELY_TABS} from './views/Dashboard';

/* In the first download: sign-in, home and the exam engine (an exam must reopen
   offline). The staff console, duels, rooms, groups and result pages download
   on first open, then the service worker keeps them. */
const Admin = lazyScreen(() => import('./views/Admin'));
const DuelArena = lazyScreen(() => import('./views/Duel'));
const Room = lazyScreen(() => import('./views/Room'));
const Group = lazyScreen(() => import('./views/Group'));
const GroupQuiz = lazyScreen(() => import('./views/GroupQuiz'));
const Result = lazyScreen(() => import('./views/Result'));
const MiniExam = lazyScreen(() => import('./views/MiniExam'));

function ScreenLoading() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
      <span className="size-9 animate-spin rounded-full border-[3px] border-white/10 border-t-nova-400" />
    </div>
  );
}

const GROUP_SECTIONS: GroupSection[] = ['overview', 'chat', 'quizzes', 'duels', 'questions', 'members', 'announcements', 'activity'];

type Route =
  | {view: 'dashboard'; tab: Tab}
  | {view: 'exam'; quiz?: Quiz; attemptId?: number}
  | {view: 'result'; attemptId: number}
  | {view: 'duel'; duelId: number}
  | {view: 'room'; roomId: number}
  | {view: 'group'; groupId: number; section: GroupSection}
  | {view: 'groupquiz'; groupId: number; quizId: number}
  | {view: 'mini'; examId: number}
  | {view: 'admin'};

const TAB_IDS = [...TABS.map((row) => row.id), ...PRO_ONLY_TABS] as string[];

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
    case 'group':
      return `#/group/${route.groupId}/${route.section}`;
    case 'groupquiz':
      return `#/group/${route.groupId}/quiz/${route.quizId}`;
    case 'mini':
      return `#/mini/${route.examId}`;
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
  const parts = (window.location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = parts[0];
  const id = Number(parts[1]);
  const hasId = Number.isFinite(id) && id > 0;
  if (head && TAB_IDS.includes(head)) return {view: 'dashboard', tab: head as Tab};
  if (head === 'exam' && hasId) return {view: 'exam', attemptId: id};
  if (head === 'result' && hasId) return {view: 'result', attemptId: id};
  if (head === 'duel' && hasId) return {view: 'duel', duelId: id};
  if (head === 'room' && hasId) return {view: 'room', roomId: id};
  if (head === 'mini' && hasId) return {view: 'mini', examId: id};
  if (head === 'group' && hasId) {
    /* #/group/{id}/quiz/{quizId} — the dedicated runner. */
    if (parts[2] === 'quiz') {
      const quizId = Number(parts[3]);
      if (Number.isFinite(quizId) && quizId > 0) return {view: 'groupquiz', groupId: id, quizId};
    }
    const section = (GROUP_SECTIONS.includes(parts[2] as GroupSection) ? parts[2] : 'overview') as GroupSection;
    return {view: 'group', groupId: id, section};
  }
  return {view: 'dashboard', tab: 'play'};
}

/**
 * The launch screen — Absolute Genesis crest rising over a violet dawn.
 * Styles live inline in index.html (so the same screen paints before the
 * bundle loads); this copy carries `ag-splash--live` to skip a second entrance.
 */
function Splash() {
  return (
    <div className="ag-splash ag-splash--live" role="status" aria-label="Loading Absolute Genesis">
      <div className="ag-splash__rays" />
      <div className="ag-splash__glow" />
      <div className="ag-splash__stars" />
      <div className="ag-splash__stack">
        <img
          className="ag-splash__logo"
          src="/brand/ag-logo.webp"
          alt="Absolute Genesis"
          width={616}
          height={629}
          draggable={false}
        />
        <p className="ag-splash__tag">A completely new beginning</p>
        <div className="ag-splash__bar">
          <span />
        </div>
      </div>
      <p className="ag-splash__foot">CBT exams · Study · Compete</p>
    </div>
  );
}

/** Chrome for focused screens (exam, duel, result) — no bottom tabs. */
function FocusShell({children, onBack, backLabel}: {children: React.ReactNode; onBack: () => void; backLabel: string}) {
  const {profile} = useSession();
  const {pro} = useExperience();
  /* Pro / exam: a strict, distraction-free frame — back, title, nothing else. */
  if (pro) {
    return (
      <div className="pro-app">
        <header className="pro-topbar print-hide sticky top-0 z-50 safe-top">
          <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center gap-3 px-3 md:px-6">
            <button type="button" onClick={onBack} className="pro-btn pro-btn-ghost pro-btn-sm -ml-1" aria-label={`Back to ${backLabel}`}>
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">{backLabel}</span>
            </button>
            <span className="text-[0.8125rem] font-semibold tracking-tight" style={{color: 'var(--pro-text-2)'}}>
              Absolute Genesis <span style={{color: 'var(--pro-accent-text)'}}>PRO</span>
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1100px] min-w-0 px-3 pt-4 pb-10 sm:px-5 md:pt-6">{children}</main>
      </div>
    );
  }
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
  const {ready, role, profile, signOut, on, toast, pushRewards, pushCelebration, refreshProfile, switchTo, beginSwitch, cancelSwitch, switchTarget} = useSession();
  const {pro} = useExperience();
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

  /* Once a player is in, quietly fetch the screens they usually open next
     (never on Data Saver / 2G). The service worker then keeps them offline. */
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || role !== 'student' || !profile) return;
    warmed.current = true;
    prefetchWhenIdle([() => import('./views/Result'), ...LIKELY_TABS]);
  }, [role, profile]);

  /* "Ask AI Tutor" from any screen (result, practice, reader…): switch to the
     tutor tab; the panel picks the attached context up when it mounts. */
  useEffect(() => {
    const onAsk = () => {
      if (routeRef.current.view !== 'dashboard' || routeRef.current.tab !== 'tutor') navigate({view: 'dashboard', tab: 'tutor'});
    };
    window.addEventListener(ASK_TUTOR_EVENT, onAsk);
    return () => window.removeEventListener(ASK_TUTOR_EVENT, onAsk);
  }, [navigate]);

  /* The AI tutor made a mini exam → open it as its own screen. */
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = Number((event as CustomEvent<{id: number}>).detail?.id);
      if (id > 0) navigate({view: 'mini', examId: id});
    };
    window.addEventListener(OPEN_MINI_EXAM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MINI_EXAM_EVENT, onOpen);
  }, [navigate]);

  /* Teacher Network deep links (goTo in teach/ui.tsx): switch tab or open a
     group; the target screen reads the one-shot intent when it mounts. */
  useEffect(() => {
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent<{tab?: string; groupId?: number}>).detail ?? {};
      if (detail.groupId) {
        navigate({view: 'group', groupId: detail.groupId, section: 'overview'});
        return;
      }
      const tab = detail.tab as Tab | undefined;
      if (!tab || !TAB_IDS.includes(tab)) return;
      if (routeRef.current.view !== 'dashboard' || routeRef.current.tab !== tab) navigate({view: 'dashboard', tab});
    };
    window.addEventListener('ag:navigate', onNav);
    return () => window.removeEventListener('ag:navigate', onNav);
  }, [navigate]);

  /* Pro-only workspaces don't exist in Standard: land on Home instead. */
  useEffect(() => {
    if (!pro && route.view === 'dashboard' && PRO_ONLY_TABS.includes(route.tab)) navigate({view: 'dashboard', tab: 'play'}, 'replace');
  }, [pro, route, navigate]);

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
        // Pro Mode never pulls the student away from their work.
        if (isPro()) return;
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

  /* Admin ⇄ Player: the stored slot for the other role switches instantly;
     without one, the sign-in sheet opens for exactly that role (beginSwitch)
     — both flows land in the app without a browser refresh. */
  const gotoRole = (target: 'student' | 'admin') => {
    void switchTo(target).then((outcome) => {
      if (outcome === 'missing') {
        beginSwitch(target);
        toast(
          'info',
          target === 'admin' ? 'Staff session needed' : 'Player session needed',
          'Sign in once and the switch button will flip between both, no re-login, ever.',
        );
      }
    });
  };

  /* ------------------------------------------------------------- admin */
  if (role === 'admin') {
    return (
      <>
        <Suspense fallback={<ScreenLoading />}>
          <Admin onExit={signOut} onSwitchToPlayer={() => gotoRole('student')} />
        </Suspense>
        <Toasts />
        <CelebrationLayer />
      </>
    );
  }

  if (role !== 'student' || !profile) {
    return (
      <>
        <Welcome
          onAdminMode={() => navigate({view: 'admin'}, 'replace')}
          switchTarget={switchTarget}
          onSwitchCancel={cancelSwitch}
        />
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
  const openGroup = (groupId: number, section: GroupSection = 'overview') => navigate({view: 'group', groupId, section});
  const backToDashboard = (tab: Tab = 'play') => navigate({view: 'dashboard', tab});

  return (
    <>
      <ErrorBoundary key={route.view} label={route.view}>
      <Suspense fallback={<ScreenLoading />}>
      <AnimatePresence mode="wait">
        <motion.div
          key={route.view}
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          transition={{duration: 0.2}}
        >
          {route.view === 'dashboard' && pro && (
            <ProShell tab={route.tab} onTab={(tab) => navigate({view: 'dashboard', tab})} onSignOut={signOut} onStartExam={startExam}>
              <ProRoutes
                tab={route.tab}
                onTab={(tab) => navigate({view: 'dashboard', tab})}
                onStartExam={startExam}
                onOpenResult={(attemptId) => navigate({view: 'result', attemptId})}
                onSignOut={signOut}
                fallback={
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
                    onOpenGroup={openGroup}
                    onSignOut={signOut}
                  />
                }
              />
            </ProShell>
          )}

          {route.view === 'dashboard' && !pro && (
            <AppShell
              tab={route.tab}
              onTab={(tab) => navigate({view: 'dashboard', tab})}
              onAdmin={() => gotoRole('admin')}
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
                onOpenGroup={openGroup}
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

          {route.view === 'mini' && (
            <FocusShell onBack={() => goBack('tutor')} backLabel={backLabel()}>
              <MiniExam
                key={route.examId}
                examId={route.examId}
                onExit={() => goBack('tutor')}
                onOpen={(id) => navigate({view: 'mini', examId: id}, 'replace')}
              />
            </FocusShell>
          )}

          {route.view === 'room' && (
            <FocusShell onBack={() => goBack('duels')} backLabel={backLabel()}>
              <Room roomId={route.roomId} onExit={() => goBack('duels')} />
            </FocusShell>
          )}

          {route.view === 'group' && (
            <Group
              groupId={route.groupId}
              section={route.section}
              onExit={() => goBack('friends')}
              onSection={(section) => {
                if (route.view === 'group') navigate({view: 'group', groupId: route.groupId, section}, 'replace');
              }}
              onOpenQuiz={(quizId) => {
                if (route.view === 'group') navigate({view: 'groupquiz', groupId: route.groupId, quizId});
              }}
              onOpenDuel={(duelId) => navigate({view: 'duel', duelId})}
            />
          )}

          {route.view === 'groupquiz' && (
            <GroupQuiz
              groupId={route.groupId}
              quizId={route.quizId}
              onExit={() => {
                if (route.view === 'groupquiz') navigate({view: 'group', groupId: route.groupId, section: 'quizzes'}, 'replace');
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
      </Suspense>
      </ErrorBoundary>

      <Toasts />
      <CelebrationLayer />

      {role === 'student' && !pro && (
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
