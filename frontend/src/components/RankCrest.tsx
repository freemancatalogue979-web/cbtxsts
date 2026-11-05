/** Original bevelled vector rank art. Colours and tier stay server-owned. */
import {HeraldicCrest} from './Badge';
import type {Tier} from '../lib/types';

export default function RankCrest({tier, className = ''}: {tier: Tier; className?: string}) {
  return <HeraldicCrest tier={tier} className={className} />;
}
