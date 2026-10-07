/**
 * Public player card — country flag, record, and a way to challenge or friend them.
 * Open from anywhere: window.dispatchEvent(new CustomEvent('ag:player', {detail: {id}}))
 */
import {Swords, UserPlus, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Avatar} from './ui';
import {Button, Card, Chip} from './ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import type {PlayerSummary} from '../lib/types';

export const COUNTRIES: {code: string; name: string; flag: string}[] = [
  {code: 'NG', name: 'Nigeria', flag: '🇳🇬'},
  {code: 'GH', name: 'Ghana', flag: '🇬🇭'},
  {code: 'KE', name: 'Kenya', flag: '🇰🇪'},
  {code: 'ZA', name: 'South Africa', flag: '🇿🇦'},
  {code: 'IN', name: 'India', flag: '🇮🇳'},
  {code: 'PK', name: 'Pakistan', flag: '🇵🇰'},
  {code: 'BD', name: 'Bangladesh', flag: '🇧🇩'},
  {code: 'GB', name: 'United Kingdom', flag: '🇬🇧'},
  {code: 'CA', name: 'Canada', flag: '🇨🇦'},
  {code: 'US', name: 'United States', flag: '🇺🇸'},
  {code: 'AU', name: 'Australia', flag: '🇦🇺'},
];

export function countryFlag(code?: string): string {
  return COUNTRIES.find((row) => row.code === (code || '').toUpperCase())?.flag || '🌍';
}

export function countryName(code?: string): string {
  return COUNTRIES.find((row) => row.code === (code || '').toUpperCase())?.name || 'No country set';
}

export function openPlayer(id: number) {
  window.dispatchEvent(new CustomEvent('ag:player', {detail: {id}}));
}

export default function PlayerCard({
  playerId,
  onClose,
  onChallenge,
}: {
  playerId: number;
  onClose: () => void;
  onChallenge?: () => void;
}) {
  const {toast, profile} = useSession();
  const [player, setPlayer] = useState<PlayerSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = profile?.id === playerId;

  useEffect(() => {
    let alive = true;
    api.player(playerId).then((row) => alive && setPlayer(row)).catch((error: Error) => toast('error', 'Could not open profile', error.message));
    return () => {
      alive = false;
    };
  }, [playerId, toast]);

  const add = async () => {
    setBusy(true);
    try {
      await api.addFriend({student_id: playerId});
      toast('success', 'Request sent', `${player?.name.split(' ')[0] || 'They'} can accept from Friends.`);
      const fresh = await api.player(playerId);
      setPlayer(fresh);
    } catch (error) {
      toast('error', 'Could not add', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const challenge = async () => {
    setBusy(true);
    try {
      const duel = await api.openDuel({stake_coins: 0});
      toast('success', 'Duel room open', `Code ${duel.code} — share it or wait for them to join.`);
      onChallenge?.();
      onClose();
    } catch (error) {
      toast('error', 'Could not open a duel', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const flag = player?.flag || countryFlag(player?.country);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose}>
      <Card className="w-full max-w-md p-4" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3">
          <Avatar name={player?.name || 'Player'} hue={player?.avatar_hue || 265} initials={player?.initials} size={56} photo={player ? {id: player.id, has: player.has_photo} : undefined} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[1.05rem] font-black text-mist-50">
              {flag} {player?.name || 'Loading…'}
            </p>
            <p className="text-[0.74rem] font-semibold text-mist-400">{countryName(player?.country)}{player?.online ? ' · online' : ''}</p>
            {player?.status_text && <p className="mt-1 text-[0.74rem] font-medium text-mist-300">{player.status_text}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-mist-400" aria-label="Close profile">
            <X className="size-4" />
          </button>
        </div>
        {player?.bio && <p className="mt-3 text-[0.8rem] font-medium text-mist-300">{player.bio}</p>}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            ['Level', player ? String(player.level) : '—'],
            ['XP', player ? formatNumber(player.xp) : '—'],
            ['Streak', player ? String(player.streak) : '—'],
            ['Duels won', player ? `${player.duels_won}` : '—'],
            ['Exams', player ? String(player.exams_taken) : '—'],
            ['Best', player ? `${player.best_percentage}%` : '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/5 px-2 py-2 text-center">
              <p className="text-[0.58rem] font-black tracking-wider text-mist-500">{label}</p>
              <p className="text-[0.86rem] font-black text-mist-50">{value}</p>
            </div>
          ))}
        </div>
        {!mine && (
          <div className="mt-4 flex gap-2">
            <Button className="flex-1 gap-1.5" disabled={busy} onClick={() => void challenge()}>
              <Swords className="size-4" /> Challenge
            </Button>
            <Button variant="outline" className="flex-1 gap-1.5" disabled={busy || player?.friendship_status === 'accepted'} onClick={() => void add()}>
              <UserPlus className="size-4" /> {player?.friendship_status === 'accepted' ? 'Friends' : 'Add'}
            </Button>
          </div>
        )}
        {mine && <Chip className="mt-3">This is you — set your flag in Profile</Chip>}
      </Card>
    </div>
  );
}
