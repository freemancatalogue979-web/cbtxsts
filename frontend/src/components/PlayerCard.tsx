/**
 * Public player profile — identity, equipped look, competitive standing,
 * earned achievements and a short public activity history.
 */
import {Activity, BookOpen, Clock3, MessageCircle, Star, Swords, Target, Trophy, UserPlus, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Avatar, Button, Chip, IconButton} from './ui';
import {api} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {AURAS, FRAMES, THEMES, titleOf} from '../lib/cosmetics';
import {iconFor} from '../lib/icons';
import RankedBadge from './RankedBadge';
import SeasonBadge from './SeasonBadge';
import ProfileScenery, {OverallRankPlate, prestigeFor} from './ProfileScenery';
import {useSession} from '../store/session';
import type {PlayerSummary, PublicAchievement, PublicPlayerActivity} from '../lib/types';

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

function Achievement({badge}: {badge: PublicAchievement}) {
  const Icon = iconFor(badge.icon);
  const tone = badge.tier === 'platinum' ? 'text-pulse-300' : badge.tier === 'gold' ? 'text-gold-400' : badge.tier === 'silver' ? 'text-mist-300' : 'text-gold-600';
  return (
    <div className="profile-achievement flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2" data-tier={badge.tier}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/8">
        <Icon className={`size-4 ${tone}`} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.74rem] font-extrabold text-mist-100">{badge.name}</span>
        <span className="block truncate text-[0.62rem] font-semibold text-mist-500">{badge.description}</span>
      </span>
    </div>
  );
}

function historyIcon(kind: string) {
  if (kind === 'badge') return Star;
  if (kind === 'duel') return Swords;
  if (kind === 'prize') return Trophy;
  return Activity;
}

function HistoryRow({item}: {item: PublicPlayerActivity}) {
  const Icon = historyIcon(item.kind);
  return (
    <li className="flex min-w-0 items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/8 text-nova-300">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[0.76rem] font-extrabold text-mist-100">{item.title}</span>
        {item.detail && <span className="mt-0.5 block break-words text-[0.68rem] font-medium text-mist-400">{item.detail}</span>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-[0.6rem] font-semibold text-mist-500">
        <Clock3 className="size-3" /> {formatRelative(item.created_at)}
      </span>
    </li>
  );
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const prestige = prestigeFor(player?.level ?? 1);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? []);
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keys); previous?.focus(); };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setPlayer(null);
    api.player(playerId).then((row) => alive && setPlayer(row)).catch((error: Error) => toast('error', 'Could not open profile', error.message));
    return () => {
      alive = false;
    };
  }, [playerId, toast]);

  const add = async () => {
    setBusy(true);
    try {
      const result = await api.addFriend({student_id: playerId});
      const fresh = await api.player(playerId);
      setPlayer(fresh);
      const firstName = fresh.name.split(' ')[0];
      if (result.status === 'pending') toast('info', 'Request already sent', `${firstName} can find your request in Friends.`);
      else toast('success', 'Friend added', `${firstName} is now in your Friends list.`);
    } catch (error) {
      toast('error', 'Could not add', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const challenge = async () => {
    setBusy(true);
    try {
      await api.createDuel({opponent_id: playerId, stake_coins: 0});
      toast('success', 'Challenge sent', `${player?.name || 'They'} can accept it from Duels.`);
      onChallenge?.();
      onClose();
    } catch (error) {
      toast('error', 'Could not open a duel', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const flag = player?.flag || countryFlag(player?.country);
  const isFriend = player?.friendship_status === 'accepted' || (player?.friendship_status == null && player?.is_friend === true);
  const incomingRequest = player?.friendship_status === 'pending' && player.direction === 'incoming';
  const outgoingRequest = player?.friendship_status === 'pending' && player.direction === 'outgoing';
  const friendLabel = isFriend ? 'Friends' : incomingRequest ? 'Accept' : outgoingRequest ? 'Requested' : 'Add';
  const cosmetics = player?.cosmetics;
  const equippedTitle = titleOf(cosmetics);
  const equippedTheme = cosmetics?.theme ? THEMES[cosmetics.theme] : undefined;
  const equippedAura = cosmetics?.aura ? AURAS[cosmetics.aura] : undefined;
  const equippedFrame = cosmetics?.frame ? FRAMES[cosmetics.frame] : undefined;
  const stats = player?.stats;
  const achievements = player?.badges ?? [];
  const history = player?.history ?? [];
  const themeSurface = equippedTheme?.swatch
    ? {background: `linear-gradient(135deg, color-mix(in srgb, ${equippedTheme.swatch} 14%, transparent), transparent 56%), var(--qa-surface)`}
    : undefined;

  return (
    <div className="scrim fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto overscroll-contain p-2.5 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="my-auto w-full max-w-xl"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Public profile for ${player?.name || 'player'}`}
        aria-busy={!player}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="card profile-showcase max-h-[calc(100dvh-1rem)] w-full overflow-y-auto overscroll-contain p-0"
          data-profile-theme={cosmetics?.theme || 'classic'}
          data-prestige={prestige.name.toLowerCase()}
          style={themeSurface}
        >
          <ProfileScenery theme={cosmetics?.theme} level={player?.level} banner={player?.profile_banner} motion={player?.profile_motion} playerId={player?.id} hasImage={player?.has_banner} version={player?.banner_version} />
          <div className="profile-showcase-content p-4 sm:p-5">
            {player && <p className="profile-prestige-label mb-3 text-[0.62rem] font-black uppercase tracking-[0.24em]" style={{color: prestige.color}}>{prestige.name} · Level {player.level}</p>}
            <header className="flex min-w-0 items-start gap-3">
              <Avatar
                name={player?.name || 'Player'}
                hue={player?.avatar_hue || 265}
                initials={player?.initials}
                size={64}
                photo={player ? {id: player.id, has: player.has_photo} : undefined}
                cosmetics={cosmetics}
                className="profile-showcase-portrait mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="min-w-0 max-w-full break-words text-[1.05rem] font-black leading-tight text-mist-50 sm:text-xl">
                    {flag} {player?.name || 'Loading profile…'}
                  </h2>
                  {player?.online && <Chip tone="mint" size="xs" dot>Online</Chip>}
                </div>
                <p className="mt-1 text-[0.72rem] font-semibold text-mist-400">{countryName(player?.country)}</p>
                {player?.status_text && <p className="mt-1 break-words text-[0.74rem] font-medium text-mist-300">{player.status_text}</p>}
                {equippedTitle && <Chip className="mt-1.5" tone="gold" size="xs" icon={<Star className="size-3" />}>{equippedTitle}</Chip>}
              </div>
              <IconButton label="Close profile" variant="ghost" size="sm" className="-mr-1 -mt-1" onClick={onClose}>
                <X className="size-4 text-mist-400" />
              </IconButton>
            </header>

            {player?.bio && <p className="mt-3 break-words text-[0.78rem] font-medium leading-relaxed text-mist-300">{player.bio}</p>}

            <section aria-label="Equipped look" className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-mist-500">Loadout</span>
              <Chip size="xs" tone="nova" icon={<span className="size-2.5 rounded-full border border-white/30" style={{background: equippedTheme?.swatch || '#64748b'}} />}>{equippedTheme?.label || 'Classic theme'}</Chip>
              {equippedFrame && <Chip size="xs" tone="gold">{equippedFrame.label}</Chip>}
              {equippedAura && <Chip size="xs" tone="pulse">{equippedAura.label}</Chip>}
              {!equippedTheme && !equippedFrame && !equippedAura && !equippedTitle && (
                <span className="text-[0.66rem] font-medium text-mist-400">No extra cosmetics equipped</span>
              )}
            </section>

            {player && <div className="mt-4"><OverallRankPlate tier={player.tier} level={player.level} /></div>}
            <section className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Current ranks">
              {player?.season && (
                <div className="profile-competitive-rank flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-white/7 px-3 py-2.5">
                  <SeasonBadge rank={player.season.rank} level={player.season.level} size="md" current />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-mist-500">Season · {player.season.label}</p>
                    <p className="truncate text-[0.8rem] font-extrabold text-mist-100">{player.season.rank.label} · Lv {player.season.level}</p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-[0.56rem] font-bold text-mist-500">Board</span>
                    <span className="text-[0.76rem] font-black tabular text-mist-100">#{player.season.board_rank}</span>
                  </span>
                </div>
              )}
              {player?.ranked && (
                <div className="profile-competitive-rank flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-white/7 px-3 py-2.5">
                  {player.ranked.played > 0 ? <RankedBadge tier={player.ranked.tier} size="md" /> : <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/8"><Trophy className="size-4 text-gold-400" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-mist-500">Ranked ladder</p>
                    <p className="truncate text-[0.8rem] font-extrabold text-mist-100">{player.ranked.played > 0 ? player.ranked.tier.name : 'Placement pending'}</p>
                    <p className="truncate text-[0.64rem] font-semibold text-mist-500">{formatNumber(player.ranked.rating)} rating · {formatNumber(player.ranked.played)} played</p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block text-[0.56rem] font-bold text-mist-500">Rank</span>
                    <span className="text-[0.76rem] font-black tabular text-mist-100">{player.ranked.rank ? `#${player.ranked.rank}` : '—'}</span>
                  </span>
                </div>
              )}
            </section>

            <section className="mt-4" aria-label="Player statistics">
              <div className="mb-2 flex items-center gap-2">
                <Target className="size-3.5 text-nova-400" />
                <h3 className="text-[0.66rem] font-black uppercase tracking-[0.15em] text-mist-500">Arena record</h3>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
                {[
                  {label: 'Lifetime XP', value: player ? formatNumber(player.xp) : '—'},
                  {label: 'Streak', value: player ? `${formatNumber(player.streak)} days` : '—'},
                  {label: 'Questions', value: player ? formatNumber(stats?.questions_answered ?? 0) : '—'},
                  {label: 'Accuracy', value: player ? `${Number(stats?.accuracy ?? 0).toFixed(1)}%` : '—'},
                  {label: 'Exams', value: player ? `${formatNumber(player.exams_taken)} · ${formatNumber(stats?.exams_won ?? 0)} wins` : '—'},
                  {label: 'Best exam', value: player ? `${Number(player.best_percentage).toFixed(1)}%` : '—'},
                  {label: 'Duels', value: player ? `${formatNumber(player.duels_won)}W · ${formatNumber(player.duels_played)} played` : '—'},
                  {label: 'Ranked wins', value: player ? `${formatNumber(stats?.ranked_won ?? 0)} · ${formatNumber(stats?.ranked_played ?? 0)} played` : '—'},
                ].map((item) => (
                  <div key={item.label} className="profile-record-tile min-w-0 rounded-xl border border-white/10 bg-white/6 px-2.5 py-2">
                    <p className="truncate text-[0.56rem] font-black uppercase tracking-[0.12em] text-mist-500">{item.label}</p>
                    <p className="mt-0.5 break-words text-[0.76rem] font-black leading-tight text-mist-100 tabular">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4" aria-label="Achievements">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Trophy className="size-3.5 text-gold-500" />
                  <h3 className="text-[0.66rem] font-black uppercase tracking-[0.15em] text-mist-500">Achievements</h3>
                </div>
                {(player?.badges_total ?? 0) > 0 && <span className="text-[0.62rem] font-bold text-mist-500">{player?.badges_total} earned</span>}
              </div>
              {achievements.length ? (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {achievements.slice(0, 6).map((badge) => <Achievement key={badge.key} badge={badge} />)}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-white/12 px-3 py-2.5 text-[0.72rem] font-medium text-mist-500">No public achievements yet.</p>
              )}
            </section>

            <section className="mt-4" aria-label="Recent public history">
              <div className="mb-2 flex items-center gap-2">
                <BookOpen className="size-3.5 text-pulse-400" />
                <h3 className="text-[0.66rem] font-black uppercase tracking-[0.15em] text-mist-500">Recent highlights</h3>
              </div>
              {history.length ? (
                <ol className="divide-y divide-white/8 rounded-xl border border-white/10 bg-white/4 px-3 py-2">
                  {history.slice(0, 6).map((item) => <HistoryRow key={item.id} item={item} />)}
                </ol>
              ) : (
                <p className="rounded-xl border border-dashed border-white/12 px-3 py-2.5 text-[0.72rem] font-medium text-mist-500">Their public highlights will appear as they play.</p>
              )}
            </section>
          </div>

          {!mine && (
            <footer className="sticky bottom-0 z-10 flex flex-wrap gap-2 border-t border-white/10 px-4 py-3 sm:px-5" style={{background: 'var(--qa-surface-raised)'}}>
              <Button className="flex-1 gap-1.5" disabled={busy || !player} onClick={() => void challenge()}>
                <Swords className="size-4" /> Challenge
              </Button>
              <Button variant="outline" className="flex-1 gap-1.5" disabled={busy || !player || isFriend || outgoingRequest} onClick={() => void add()}>
                <UserPlus className="size-4" /> {friendLabel}
              </Button>
              <Button variant="ghost" className="gap-1.5" disabled={!player} onClick={() => {
                sessionStorage.setItem('ag.msg.with', String(playerId));
                onClose();
                window.dispatchEvent(new CustomEvent('ag:navigate', {detail: {tab: 'messages', withId: playerId}}));
              }} aria-label="Message player"><MessageCircle className="size-4" /> Message</Button>
            </footer>
          )}
          {mine && <p className="border-t border-white/10 px-4 py-3 text-center text-[0.7rem] font-semibold text-mist-500">This is your profile — manage your details in Profile.</p>}
        </div>
      </div>
    </div>
  );
}
