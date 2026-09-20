/**
 * Materials and arena payouts arrive in the server's own bookkeeping shape
 * (`awarded` / `amount` / `reason`). The celebration layer speaks
 * `RewardEvent`, so everything funnels through here instead of being cast.
 */
import type {RewardEvent} from './types';

export function studyRewards(
  rows: {amount?: number; awarded?: number; reason?: string}[] | undefined | null,
): RewardEvent[] {
  if (!rows?.length) return [];
  return rows
    .map((row) => ({
      type: 'xp' as const,
      amount: Number(row.awarded ?? row.amount ?? 0),
      reason: row.reason ?? 'study',
    }))
    .filter((row) => row.amount > 0);
}
