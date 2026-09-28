/** Dashboard shell: routes between the arena tabs. */
import {AnimatePresence, motion} from 'motion/react';
import PlayPanel from '../panels/PlayPanel';
import {Suspense} from 'react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {Skeleton} from '../components/ui';
import {lazyScreen} from '../lib/lazy';
import type {Tab} from '../lib/nav';
import type {Duel, GroupSection, Quiz} from '../lib/types';

/* Home loads with the app; every other tab downloads the first time it opens
   (then the service worker keeps it). See lib/lazy.ts. */
const StudyPanel = lazyScreen(() => import('../panels/StudyPanel'));
const DuelsPanel = lazyScreen(() => import('../panels/DuelsPanel'));
const RanksPanel = lazyScreen(() => import('../panels/RanksPanel'));
const PrizesPanel = lazyScreen(() => import('../panels/PrizesPanel'));
const FeedPanel = lazyScreen(() => import('../panels/FeedPanel'));
const FriendsPanel = lazyScreen(() => import('../panels/FriendsPanel'));
const ProfilePanel = lazyScreen(() => import('../panels/ProfilePanel'));
const ShopPanel = lazyScreen(() => import('../panels/ShopPanel'));
const MaterialsPanel = lazyScreen(() => import('../panels/MaterialsPanel'));
const GameArenaPanel = lazyScreen(() => import('../panels/GameArenaPanel'));
const RankedPanel = lazyScreen(() => import('../panels/RankedPanel'));
const EventsPanel = lazyScreen(() => import('../panels/EventsPanel'));
const MysteryPanel = lazyScreen(() => import('../panels/MysteryPanel'));
const SupportPanel = lazyScreen(() => import('../panels/SupportPanel'));
const WorldMapPanel = lazyScreen(() => import('../panels/WorldMapPanel'));
const TutorPanel = lazyScreen(() => import('../panels/TutorPanel'));

/** Loaders for the tabs most players open next, warmed when the app is idle. */
export const LIKELY_TABS = [
  () => import('../panels/MaterialsPanel'),
  () => import('../panels/StudyPanel'),
  () => import('../panels/ProfilePanel'),
  () => import('../panels/DuelsPanel'),
  () => import('../panels/RanksPanel'),
];

function TabLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
      <Skeleton className="h-28" />
    </div>
  );
}

export default function Dashboard({
  tab,
  onStartExam,
  onOpenDuel,
  onOpenRoom,
  onOpenResult,
  onOpenDuels,
  onOpenMaterial,
  onOpenGroup,
  onSignOut,
}: {
  tab: Tab;
  onStartExam: (quiz: Quiz) => void;
  onOpenDuel: (duel: Duel) => void;
  onOpenRoom: (roomId: number) => void;
  onOpenResult: (attemptId: number) => void;
  onOpenDuels: () => void;
  onOpenMaterial: (materialId: number) => void;
  onOpenGroup: (groupId: number, section?: GroupSection) => void;
  onSignOut: () => void;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tab}
        initial={{opacity: 0, y: 12}}
        animate={{opacity: 1, y: 0}}
        exit={{opacity: 0, y: -8}}
        transition={{duration: 0.26, ease: [0.22, 1, 0.36, 1]}}
      >
        <ErrorBoundary key={tab} label={tab} inline>
        <Suspense fallback={<TabLoading />}>
        {tab === 'play' && <PlayPanel onStartExam={onStartExam} onOpenDuels={onOpenDuels} />}
        {tab === 'map' && (
          <WorldMapPanel onStartExam={onStartExam} onOpenDuels={onOpenDuels} onOpenMaterial={onOpenMaterial} />
        )}
        {tab === 'study' && <StudyPanel />}
        {tab === 'tutor' && <TutorPanel />}
        {tab === 'materials' && <MaterialsPanel />}
        {tab === 'arena' && <GameArenaPanel />}
        {tab === 'ranked' && <RankedPanel />}
        {tab === 'events' && <EventsPanel />}
        {tab === 'mystery' && <MysteryPanel />}
        {tab === 'support' && <SupportPanel />}
        {tab === 'duels' && <DuelsPanel onOpenDuel={onOpenDuel} onOpenRoom={onOpenRoom} />}
        {tab === 'friends' && <FriendsPanel onOpenDuel={onOpenDuel} onStartExam={onStartExam} onOpenGroup={onOpenGroup} />}
        {tab === 'ranks' && <RanksPanel />}
        {tab === 'shop' && <ShopPanel />}
        {tab === 'prizes' && <PrizesPanel />}
        {tab === 'feed' && <FeedPanel />}
        {tab === 'profile' && (
          <ProfilePanel onOpenResult={onOpenResult} onOpenDuels={onOpenDuels} onSignOut={onSignOut} />
        )}
        </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}
