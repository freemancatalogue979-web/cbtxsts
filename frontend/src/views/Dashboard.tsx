/** Dashboard shell: routes between the arena tabs. */
import {AnimatePresence, motion} from 'motion/react';
import PlayPanel from '../panels/PlayPanel';
import StudyPanel from '../panels/StudyPanel';
import DuelsPanel from '../panels/DuelsPanel';
import RanksPanel from '../panels/RanksPanel';
import PrizesPanel from '../panels/PrizesPanel';
import FeedPanel from '../panels/FeedPanel';
import FriendsPanel from '../panels/FriendsPanel';
import ProfilePanel from '../panels/ProfilePanel';
import ShopPanel from '../panels/ShopPanel';
import MaterialsPanel from '../panels/MaterialsPanel';
import GameArenaPanel from '../panels/GameArenaPanel';
import WorldMapPanel from '../panels/WorldMapPanel';
import type {Tab} from '../lib/nav';
import type {Duel, Quiz} from '../lib/types';

export default function Dashboard({
  tab,
  onStartExam,
  onOpenDuel,
  onOpenRoom,
  onOpenResult,
  onOpenDuels,
  onOpenMaterial,
  onSignOut,
}: {
  tab: Tab;
  onStartExam: (quiz: Quiz) => void;
  onOpenDuel: (duel: Duel) => void;
  onOpenRoom: (roomId: number) => void;
  onOpenResult: (attemptId: number) => void;
  onOpenDuels: () => void;
  onOpenMaterial: (materialId: number) => void;
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
        {tab === 'play' && <PlayPanel onStartExam={onStartExam} onOpenDuels={onOpenDuels} />}
        {tab === 'map' && (
          <WorldMapPanel onStartExam={onStartExam} onOpenDuels={onOpenDuels} onOpenMaterial={onOpenMaterial} />
        )}
        {tab === 'study' && <StudyPanel />}
        {tab === 'materials' && <MaterialsPanel />}
        {tab === 'arena' && <GameArenaPanel />}
        {tab === 'duels' && <DuelsPanel onOpenDuel={onOpenDuel} onOpenRoom={onOpenRoom} />}
        {tab === 'friends' && <FriendsPanel onOpenDuel={onOpenDuel} onStartExam={onStartExam} />}
        {tab === 'ranks' && <RanksPanel />}
        {tab === 'shop' && <ShopPanel />}
        {tab === 'prizes' && <PrizesPanel />}
        {tab === 'feed' && <FeedPanel />}
        {tab === 'profile' && (
          <ProfilePanel onOpenResult={onOpenResult} onOpenDuels={onOpenDuels} onSignOut={onSignOut} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
