/** Original bevelled vector rank art. Colours and tier stay server-owned. */
import {HeraldicCrest} from './Badge';
import type {Tier} from '../lib/types';

export default function RankCrest({tier, className = '', playerName, founderNumber}: {
  tier: Tier;
  className?: string;
  playerName?: string;
  founderNumber?: number | null;
}) {
  return <HeraldicCrest tier={tier} className={className} playerName={playerName} founderNumber={founderNumber} />;
}
