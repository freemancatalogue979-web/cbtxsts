/**
 * The Arena Shop & Inventory — a marketplace and personal trophy room.
 *
 * Shelves rotate (featured / daily deals / the live event / the Diamond Vault),
 * every item wears its rarity, and a preview shows the plaque behind it: how
 * rare it is, when it was released, how many players own it and where it came
 * from.
 *
 * The Inventory tab lets players view their active loadout, equip or unequip
 * any owned item, and inspect their serial numbers and item histories.
 *
 * Everything here is cosmetic — nothing on this screen touches a score,
 * an XP multiplier or a reward. The server owns the prices; the client only
 * asks for a key.
 */
import {
  BadgeCheck,
  Check,
  Coins,
  Crown,
  Gem,
  Lock,
  Package,
  Sparkles,
  Store,
  Timer,
  TrendingUp,
} from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Avatar, Button, Card, Chip, Modal, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {
  answerEffectOf,
  auraOf,
  bubbleOf,
  frameOf,
  portraitOf,
  themeOf,
  titleOf,
  victoryOf,
  VICTORY_LINES,
} from '../lib/cosmetics';
import {formatNumber} from '../lib/format';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';
import type {ChestReward, ShopItem, ShopPlaque, ShopState} from '../lib/types';

/* ------------------------------------------------------------------ helpers */

const RARITY_BORDER: Record<string, string> = {
  common: 'border-mist-400/45',
  rare: 'border-pulse-400/60',
  epic: 'border-nova-400/65',
  legendary: 'border-gold-400/70',
  mythic: 'border-flare-400/75',
};

const RARITY_GLOW: Record<string, string> = {
  common: '',
  rare: 'shadow-[0_10px_30px_-18px_rgba(56,189,248,0.85)]',
  epic: 'shadow-[0_12px_34px_-18px_rgba(168,85,247,0.9)]',
  legendary: 'shadow-[0_14px_38px_-18px_rgba(251,191,36,0.95)]',
  mythic: 'shadow-[0_16px_42px_-18px_rgba(244,63,94,1)]',
};

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  const secs = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** A countdown that ticks once a second and never needs a server round-trip. */
function useCountdown(target: string | null | undefined): number {
  const end = useMemo(() => (target ? new Date(target).getTime() : 0), [target]);
  const [left, setLeft] = useState(() => (end ? Math.max(0, (end - Date.now()) / 1000) : 0));
  useEffect(() => {
    if (!end) return undefined;
    const tick = () => setLeft(Math.max(0, (end - Date.now()) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [end]);
  return left;
}

/** Midnight tonight — when the daily deals turn over. */
function useMidnight(): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.toISOString();
}

/* ------------------------------------------------------------------ item card */

function ItemCard({
  item,
  equipped,
  onOpen,
  onToggleEquip,
  size = 'md',
  inventoryMode = false,
}: {
  item: ShopItem;
  equipped: boolean;
  onOpen: () => void;
  onToggleEquip?: (item: ShopItem) => void;
  size?: 'md' | 'lg';
  inventoryMode?: boolean;
}) {
  const price = item.price_diamonds ? `${formatNumber(item.price_diamonds)}` : formatNumber(item.price_coins);

  return (
    <motion.div
      layout
      className={`shelf-card group relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border-2 p-3 text-center transition-transform hover:-translate-y-0.5 ${RARITY_BORDER[item.rarity] ?? 'border-white/12'} ${RARITY_GLOW[item.rarity] ?? ''} ${
        size === 'lg' ? 'sm:p-4' : ''
      } ${item.available ? '' : 'opacity-60'}`}
    >
 <span className={`absolute top-1.5 left-1.5 rounded-full border border-black/25 px-1.5 py-0.5 text-[0.52rem] font-black tracking-wider ${item.rarity === 'mythic' ? 'bg-flare-500 text-white' : item.rarity === 'legendary' ? 'bg-gold-400 text-ink-950' : item.rarity === 'epic' ? 'bg-nova-500 text-white' : item.rarity === 'rare' ? 'bg-pulse-500 text-white' : 'bg-white/15 text-mist-200'}`}>
        {item.rarity_meta.label}
      </span>

      {equipped && (
        <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-mint-400 px-1.5 py-0.5 text-[0.52rem] font-black text-ink-950">
          <Check className="size-2.5" /> EQUIPPED
        </span>
      )}

      {inventoryMode && item.serial && !equipped && (
        <span className="absolute top-1.5 right-1.5 rounded-full border border-white/15 bg-white/10 px-1.5 py-0.5 text-[0.52rem] font-black tabular text-mist-300">
          #{item.serial}
        </span>
      )}

      <button onClick={onOpen} className="mt-3 grid place-items-center rounded-2xl border-2 border-black/25 bg-gradient-to-br from-white/12 to-black/25 transition-transform group-hover:scale-105 active:scale-95" style={{width: size === 'lg' ? 64 : 56, height: size === 'lg' ? 64 : 56, fontSize: size === 'lg' ? '2rem' : '1.7rem'}}>
        {item.glyph}
      </button>

      <button onClick={onOpen} className="w-full min-w-0 text-center">
        <span className="block truncate text-[0.8rem] font-extrabold text-mist-50 group-hover:text-gold-200">{item.name}</span>
 <span className="mt-0.5 block text-[0.6rem] font-bold tracking-[0.1em] text-mist-500">{item.slot_label}</span>
      </button>

      <div className="mt-auto flex w-full items-center justify-center gap-1 pt-1">
        {inventoryMode ? (
          <Button
            size="sm"
            variant={equipped ? 'outline' : 'primary'}
            className="w-full text-[0.68rem] py-1 h-7"
            onClick={(e) => {
              e.stopPropagation();
              onToggleEquip?.(item);
            }}
          >
            {equipped ? 'Unequip' : 'Equip'}
          </Button>
        ) : item.owned ? (
          <button onClick={onOpen} className="text-[0.7rem] font-black text-mint-300 hover:underline">
            {equipped ? 'Equipped' : 'Owned'}
          </button>
        ) : (
          <button onClick={onOpen} className="flex items-center justify-center gap-1 text-[0.72rem] font-black tabular text-mist-100 hover:text-mist-50">
            <span>{price}</span>
            {item.price_diamonds ? (
              <Gem className="size-3.5 text-nova-300" />
            ) : (
              <Coins className="size-3.5 text-gold-300" />
            )}
            {item.deal_off > 0 && (
              <span className="rounded-md bg-flare-500/20 px-1 text-[0.56rem] font-black text-flare-200">-{item.deal_off}%</span>
            )}
          </button>
        )}
      </div>

      {!inventoryMode && !item.unlocked && item.requirement && (
        <span className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-center gap-1 rounded-xl bg-ink-950/90 px-1.5 py-1 text-[0.54rem] font-black text-mist-300">
          <Lock className="size-3" /> {item.requirement}
        </span>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ preview & plaque */

function Preview({
  item,
  state,
  onClose,
  onBought,
  onEquipped,
}: {
  item: ShopItem | null;
  state: ShopState;
  onClose: () => void;
  onBought: (item: ShopItem) => void;
  onEquipped: (equipped: Record<string, string>) => void;
}) {
  const {toast} = useSession();
  const [plaque, setPlaque] = useState<ShopPlaque | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlaque(null);
    if (!item) return undefined;
    let alive = true;
    api
      .arenaShopItem(item.key)
      .then((data) => {
        if (alive) setPlaque(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item?.key]);

  if (!item) return null;
  const equipped = (state.equipped as Record<string, string> | undefined)?.[item.slot] === item.key;
  const priceLabel = item.price_diamonds ? `${formatNumber(item.price_diamonds)} Data Crystals` : `${formatNumber(item.price_coins)} coins`;
  const affordable = item.price_diamonds ? state.balance.diamonds >= item.price_diamonds : state.balance.coins >= item.price_coins;

  const buy = async () => {
    setBusy(true);
    try {
      const result = await api.arenaBuy(item.key);
      sfx.play('win');
      toast('success', `${result.receipt.name} unlocked`, `Serial #${result.receipt.serial ?? 1} — paid ${priceLabel}.`);
      onBought(item);
    } catch (error) {
      toast('error', 'Purchase refused', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const equip = async () => {
    setBusy(true);
    try {
      const result = equipped ? await api.arenaEquip(null, item.slot) : await api.arenaEquip(item.key);
      sfx.play('tap');
      onEquipped(result.equipped);
    } catch (error) {
      toast('error', 'Could not equip', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item.name} subtitle={`${item.rarity_meta.label} · ${item.slot_label}`} size="md">
      <div className="flex flex-col gap-3">
        {/* live preview: the actual aura / frame / portrait, not a picture of it */}
        <div className="relative grid place-items-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-ink-800/80 to-ink-950/90 py-6">
          <span aria-hidden className="pointer-events-none absolute -top-16 size-52 rounded-full blur-3xl" style={{background: item.rarity_meta.deep, opacity: 0.35}} />
          {item.slot === 'theme' ? (
            <span className={`cosy-preview ${themeOf({theme: item.key})?.className ?? ''} grid size-24 place-items-center rounded-2xl border-2 border-black/30 text-2xl`}>
              {item.glyph}
            </span>
          ) : item.slot === 'chat' ? (
            <span className={`rounded-2xl border-2 border-black/25 px-4 py-2 text-[0.8rem] font-bold text-white ${item.key === 'chat_sky' ? 'bubble-sky' : item.key === 'chat_sunset' ? 'bubble-sunset' : item.key === 'chat_neon' ? 'bubble-neon' : 'bubble-dragon'}`}>
              {item.glyph} Nice answer!
            </span>
          ) : item.slot === 'duel' ? (
            <span className="text-center">
              <span className="game-title block font-display text-xl font-black text-gold-300">{VICTORY_LINES[item.key]?.line ?? 'Victory'}</span>
              <span className="mt-1 block text-[0.72rem] font-semibold text-mist-400">{VICTORY_LINES[item.key]?.sub ?? ''}</span>
            </span>
          ) : item.slot === 'answer' ? (
            <span className="game-title font-display text-xl font-black text-mint-200">{answerEffectOf({answer: item.key})?.line ?? 'Correct!'}</span>
          ) : (
            <Avatar
              name="Arena"
              initials="A"
              size={84}
              cosmetics={{
                aura: item.slot === 'aura' ? item.key : state.equipped?.aura,
                frame: item.slot === 'frame' ? item.key : state.equipped?.frame,
                avatar: item.slot === 'avatar' ? item.key : state.equipped?.avatar,
              }}
            />
          )}
        </div>

        <p className="text-[0.82rem] leading-relaxed font-medium text-mist-300">{item.blurb}</p>

        {/* the plaque: rarity, release, owners, provenance */}
        <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
          <span className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
 <span className="block font-black tracking-wider text-mist-500">Rarity</span>
            <span className="font-extrabold" style={{color: item.rarity_meta.ink}}>{item.rarity_meta.label}</span>
          </span>
          <span className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
 <span className="block font-black tracking-wider text-mist-500">Released</span>
            <span className="font-extrabold text-mist-100">{plaque?.released ?? item.released}</span>
          </span>
          <span className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
 <span className="block font-black tracking-wider text-mist-500">Owners</span>
            <span className="font-extrabold tabular text-mist-100">{plaque?.owners ?? item.owners}</span>
          </span>
          <span className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
 <span className="block font-black tracking-wider text-mist-500">Obtained from</span>
            <span className="font-extrabold text-mist-100">{plaque?.obtained_from ?? (item.source === 'vault' ? 'Diamond vault' : item.source === 'event' ? 'Limited-time event' : item.source === 'achievement' ? 'Achievement only' : 'Arena shop')}</span>
          </span>
        </div>

        {plaque?.mine && (
          <p className="flex items-center gap-1.5 rounded-xl border border-mint-500/25 bg-mint-500/10 px-2.5 py-2 text-[0.72rem] font-bold text-mint-200">
            <BadgeCheck className="size-3.5" /> You own serial #{plaque.mine.serial} — obtained from {plaque.mine.source}.
          </p>
        )}
        {!item.unlocked && item.requirement && (
          <p className="flex items-center gap-1.5 rounded-xl border border-gold-500/25 bg-gold-500/10 px-2.5 py-2 text-[0.72rem] font-bold text-gold-200">
            <Lock className="size-3.5" /> {item.requirement} — this one can never be bought.
          </p>
        )}
        {!item.available && (
          <p className="flex items-center gap-1.5 rounded-xl border border-flare-500/25 bg-flare-500/10 px-2.5 py-2 text-[0.72rem] font-bold text-flare-200">
            <Timer className="size-3.5" /> Left with the event. It may come back next month.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {item.owned ? (
          <Button className="flex-1" variant={equipped ? 'outline' : 'primary'} loading={busy} onClick={equip} icon={equipped ? <Check className="size-4" /> : <Sparkles className="size-4" />}>
            {equipped ? 'Unequip' : 'Equip'}
          </Button>
        ) : (
          <Button
            className="flex-1"
            loading={busy}
            disabled={!item.available || !item.unlocked || !affordable || item.source === 'achievement'}
            onClick={buy}
            icon={item.price_diamonds ? <Gem className="size-4" /> : <Coins className="size-4" />}
          >
            {item.source === 'achievement' ? 'Earn it' : item.available && item.unlocked && affordable ? `Buy for ${priceLabel}` : item.available ? 'Not enough currency' : 'Event over'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ the panel */

const VIEW_TABS = [
  {value: 'market', label: '🛒 Market'},
  {value: 'inventory', label: '🎒 My Inventory'},
];

const SLOT_TABS: {value: string; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'avatar', label: 'Avatars'},
  {value: 'aura', label: 'Auras'},
  {value: 'frame', label: 'Frames'},
  {value: 'title', label: 'Titles'},
  {value: 'theme', label: 'Themes'},
  {value: 'chat', label: 'Chat'},
  {value: 'duel', label: 'Duels'},
  {value: 'answer', label: 'Answers'},
];

export default function ShopPanel() {
  const {profile, toast, refreshProfile} = useSession();
  const [viewMode, setViewMode] = useState<'market' | 'inventory'>('market');
  const [state, setState] = useState<ShopState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('all');
  const [preview, setPreview] = useState<ShopItem | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [reward, setReward] = useState<ChestReward | null>(null);
  const midnight = useMidnight();
  const dealsLeft = useCountdown(midnight);
  const eventLeft = useCountdown(state?.event?.closes_at ?? null);
  const eventOpensIn = useCountdown(state?.next_event?.opens_at ?? null);

  const load = useCallback(async () => {
    try {
      setState(await api.arenaShop());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = state?.items ?? [];
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const equipped = (state?.equipped ?? {}) as Record<string, string>;
  const shelfItems = useMemo(() => items.filter((item) => item.slot === tab || tab === 'all'), [items, tab]);
  const ownedItems = useMemo(() => items.filter((item) => item.owned && (item.slot === tab || tab === 'all')), [items, tab]);
  const featured = (state?.featured ?? []).map((key) => byKey.get(key)).filter(Boolean) as ShopItem[];
  const deals = (state?.deals ?? []).map((deal) => byKey.get(deal.key)).filter(Boolean) as ShopItem[];
  const eventItems = (state?.event_items ?? []).map((key) => byKey.get(key)).filter(Boolean) as ShopItem[];
  const vault = (state?.vault ?? []).map((key) => byKey.get(key)).filter(Boolean) as ShopItem[];

  const afterBuy = (item: ShopItem) => {
    setState((current) =>
      current
        ? {
            ...current,
            items: current.items.map((row) => (row.key === item.key ? {...row, owned: true, owners: row.owners + 1, serial: row.serial ?? 1} : row)),
            owned: [...current.owned, item.key],
          }
        : current,
    );
    void refreshProfile();
  };

  const afterEquip = (loadout: Record<string, string>) => {
    setState((current) => (current ? {...current, equipped: loadout as ShopState['equipped']} : current));
    void refreshProfile();
  };

  const toggleEquip = async (item: ShopItem) => {
    const isEquipped = equipped[item.slot] === item.key;
    try {
      const result = isEquipped ? await api.arenaEquip(null, item.slot) : await api.arenaEquip(item.key);
      sfx.play('tap');
      afterEquip(result.equipped);
      toast('success', isEquipped ? `Unequipped ${item.name}` : `Equipped ${item.name}`);
    } catch (err) {
      toast('error', 'Could not equip', (err as Error).message);
    }
  };

  const openChest = async (kind: string) => {
    setOpening(kind);
    try {
      const result = await api.arenaChest(kind);
      setState((current) => (current ? {...current, chests: result.chests} : current));
      setReward(result.reward);
      sfx.play(result.reward.type === 'item' ? 'win' : 'coin');
      void refreshProfile();
      void load(); // Refresh owned items if a cosmetic was found
    } catch (err) {
      toast('error', 'Chest would not open', (err as Error).message);
    } finally {
      setOpening(null);
    }
  };

  if (error) {
    return (
      <Card className="p-6 text-center">
        <Store className="mx-auto size-8 text-flare-300" />
        <p className="mt-3 text-[0.9rem] font-bold text-mist-100">The shop is shut for a moment</p>
        <p className="mt-1 text-[0.78rem] text-mist-500">{error}</p>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    );
  }

  if (!state) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const wallet = state.balance;
  const totalChests = Object.values(state.chests).reduce((sum, count) => sum + count, 0);

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* ---------------------------------------------------------- header & switcher */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title={viewMode === 'market' ? 'Neural Market' : 'My inventory'}
          subtitle={
            viewMode === 'market'
              ? 'Arena shop · Where knowledge becomes energy — Bio-tech relics, neural auras & cyber flora.'
              : 'Your cosmetic collection, equipped loadout, and earned chests.'
          }
          icon={viewMode === 'market' ? <Store className="size-4 text-teal-300" /> : <Package className="size-4 text-teal-300" />}
        />
        <div className="shrink-0">
          <Segmented
            value={viewMode}
            options={VIEW_TABS}
            onChange={(v) => {
              setViewMode(v as 'market' | 'inventory');
              setTab('all');
            }}
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- wallet bar */}
      <Card className="overflow-hidden p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hud-pill float-chip text-[0.86rem] text-gold-300 tabular" title="Coins">
            <Coins className="size-4" /> {formatNumber(wallet.coins)}
          </span>
          <span className="hud-pill float-chip text-[0.86rem] text-nova-300 tabular" title="Data Crystals — crystallized knowledge energy, earned only from milestones">
            <Gem className="size-4 text-nova-400" /> {formatNumber(wallet.diamonds)} <span className="hidden sm:inline text-[0.72rem] text-nova-200/80">Crystals</span>
          </span>
          <Chip className="border-white/12 bg-white/5 text-mist-300" icon={<TrendingUp className="size-3" />}>
            {state.collection.owned_count}/{state.collection.total} collected
          </Chip>
          <Chip className="border-white/12 bg-white/5 text-mist-300" icon={<Package className="size-3" />}>
            {totalChests} chests
          </Chip>
          <span className="ml-auto hidden text-[0.68rem] font-semibold text-mist-500 sm:block">
            Data Crystals come from milestones — never from coins.
          </span>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full border-2 border-black/25 bg-ink-800/70">
          <motion.span
            className="block h-full rounded-full bg-gradient-to-r from-nova-400 via-gold-300 to-flare-400"
            initial={false}
            animate={{width: `${(state.collection.owned_count / Math.max(1, state.collection.total)) * 100}%`}}
          />
        </div>
      </Card>

      {/* ========================================================= INVENTORY MODE */}
      {viewMode === 'inventory' && (
        <div className="space-y-4">
          {/* Active Loadout Showcase */}
          <Card className="relative overflow-hidden p-4 sm:p-6">
            <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-gold-600/15 blur-3xl" />
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-gold-300">
              <Crown className="size-3.5" /> Equipped loadout
            </p>
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="relative grid place-items-center rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <Avatar
                  name={profile?.name ?? 'Arena Player'}
                  initials={profile?.initials ?? 'AP'}
                  size={96}
                  cosmetics={profile?.cosmetics}
                />
              </div>
              <div className="grid w-full min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {slot: 'avatar', label: 'Avatar', key: equipped.avatar, glyph: portraitOf(profile?.cosmetics) ?? '👤'},
                  {slot: 'aura', label: 'Aura', key: equipped.aura, glyph: auraOf(profile?.cosmetics)?.label ?? 'None'},
                  {slot: 'frame', label: 'Frame', key: equipped.frame, glyph: frameOf(profile?.cosmetics)?.label ?? 'None'},
                  {slot: 'title', label: 'Title', key: equipped.title, glyph: titleOf(profile?.cosmetics) ?? 'None'},
                  {slot: 'theme', label: 'Theme', key: equipped.theme, glyph: themeOf(profile?.cosmetics)?.label ?? 'Default'},
                  {slot: 'chat', label: 'Chat', key: equipped.chat, glyph: bubbleOf(profile?.cosmetics) ? 'Equipped' : 'Default'},
                  {slot: 'duel', label: 'Duel Win', key: equipped.duel, glyph: victoryOf(profile?.cosmetics)?.line ?? 'Default'},
                  {slot: 'answer', label: 'Answer Fx', key: equipped.answer, glyph: answerEffectOf(profile?.cosmetics)?.line ?? 'Default'},
                ].map((s) => {
                  const item = s.key ? byKey.get(s.key) : null;
                  return (
                    <button
                      key={s.slot}
                      onClick={() => item && setPreview(item)}
                      className="flex flex-col items-start rounded-xl border border-white/8 bg-white/[0.02] p-2.5 text-left transition-colors hover:bg-white/[0.06]"
                    >
 <span className="text-[0.62rem] font-bold tracking-wider text-mist-500">{s.label}</span>
                      <span className="mt-1 truncate text-[0.78rem] font-extrabold text-mist-100">
                        {item ? item.name : s.glyph}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Unopened Chests */}
          {totalChests > 0 && (
            <div className="space-y-2">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
                <Package className="size-3.5 text-gold-300" /> Unopened mystery chests
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {state.chest_defs.filter((c) => (state.chests[c.key] ?? 0) > 0).map((chest) => {
                  const count = state.chests[chest.key] ?? 0;
                  return (
                    <Card key={chest.key} className={`flex min-w-0 items-center gap-3 border-2 p-3 ${RARITY_BORDER[chest.rarity] ?? ''}`}>
                      <span className="grid size-11 shrink-0 place-items-center rounded-2xl border-2 border-black/25 bg-gradient-to-br from-white/10 to-black/30 text-xl">
                        {chest.glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.82rem] font-extrabold text-mist-50">
                          {chest.name} <span className="text-mist-500">×{count}</span>
                        </span>
                        <span className="block text-[0.62rem] font-semibold text-mist-500">{chest.blurb}</span>
                      </span>
                      <Button size="sm" variant="primary" loading={opening === chest.key} onClick={() => void openChest(chest.key)}>
                        Open
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Owned Items List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
                <Sparkles className="size-3.5 text-nova-300" /> Owned items ({ownedItems.length})
              </p>
            </div>
            <Segmented value={tab} options={SLOT_TABS} onChange={setTab} className="w-full" />
            {ownedItems.length === 0 ? (
              <Card className="p-8 text-center">
                <Store className="mx-auto size-8 text-mist-600" />
                <p className="mt-2 text-[0.88rem] font-bold text-mist-300">No {tab === 'all' ? '' : tab} items owned yet</p>
                <p className="mt-1 text-[0.74rem] text-mist-500">Head over to the Market to spend coins or unlock diamond items!</p>
                <Button className="mt-4" size="sm" onClick={() => setViewMode('market')}>
                  Browse Market
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {ownedItems.map((item) => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    equipped={equipped[item.slot] === item.key}
                    onOpen={() => setPreview(item)}
                    onToggleEquip={toggleEquip}
                    inventoryMode
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= MARKET MODE */}
      {viewMode === 'market' && (
        <div className="space-y-4">
          {/* Featured Carousel */}
          <div>
            <div className="flex items-center justify-between gap-2">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
                <Sparkles className="size-3.5 text-gold-300" /> On the shelf right now
              </p>
              <span className="text-[0.66rem] font-bold text-mist-600">rotates every 6 hours</span>
            </div>
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
              {featured.map((item) => (
                <span key={item.key} className="w-[8.5rem] shrink-0">
                  <ItemCard item={item} equipped={equipped[item.slot] === item.key} onOpen={() => setPreview(item)} />
                </span>
              ))}
            </div>
          </div>

          {/* Daily deals + event */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="min-w-0 p-3">
              <div className="flex items-center justify-between gap-2">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.16em] text-mist-500">
                  <Coins className="size-3.5 text-gold-300" /> Daily deals
                </p>
                <span className="rounded-full border border-white/12 bg-white/5 px-2 py-0.5 text-[0.62rem] font-black tabular text-mist-300">
                  resets in {clock(dealsLeft)}
                </span>
              </div>
              <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto lg:grid lg:grid-cols-3">
                {deals.map((item) => (
                  <span key={item.key} className="w-[8.5rem] shrink-0 lg:w-auto">
                    <ItemCard item={item} equipped={equipped[item.slot] === item.key} onOpen={() => setPreview(item)} />
                  </span>
                ))}
              </div>
            </Card>

            <Card className="min-w-0 p-3">
              {state.event ? (
                <>
                  <div className="flex items-center justify-between gap-2">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.16em]" style={{color: state.event.color}}>
                      <Timer className="size-3.5" /> {state.event.glyph} {state.event.name} live
                    </p>
                    <span className="rounded-full border border-flare-500/30 bg-flare-500/12 px-2 py-0.5 text-[0.62rem] font-black tabular text-flare-200">
                      ends in {clock(eventLeft)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.72rem] font-semibold text-mist-500">{state.event.blurb}</p>
                  <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto lg:grid lg:grid-cols-4">
                    {eventItems.map((item) => (
                      <span key={item.key} className="w-[8.5rem] shrink-0 lg:w-auto">
                        <ItemCard item={item} equipped={equipped[item.slot] === item.key} onOpen={() => setPreview(item)} />
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <>
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.16em] text-mist-500">
                    <Timer className="size-3.5" /> Next limited-time event
                  </p>
                  <p className="mt-2 text-[1.05rem] font-black text-mist-100">
                    {state.next_event ? `${state.next_event.glyph} ${state.next_event.name}` : 'Later this season'}
                  </p>
                  <p className="mt-1 text-[0.72rem] font-semibold text-mist-500">
                    {state.next_event?.blurb ?? 'Seasonal collections rotate through the shop.'}
                  </p>
                  {state.next_event && (
                    <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[0.72rem] font-bold tabular text-mist-300">
                      Opens in {clock(eventOpensIn)}
                    </p>
                  )}
                </>
              )}
            </Card>
          </div>

          {/* Mystery Chests */}
          <div>
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
              <Package className="size-3.5 text-gold-300" /> Earned mystery chests
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {state.chest_defs.map((chest) => {
                const count = state.chests[chest.key] ?? 0;
                return (
                  <Card key={chest.key} className={`flex min-w-0 items-center gap-3 border-2 p-3 ${RARITY_BORDER[chest.rarity] ?? ''}`}>
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl border-2 border-black/25 bg-gradient-to-br from-white/10 to-black/30 text-xl">
                      {chest.glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.82rem] font-extrabold text-mist-50">
                        {chest.name} <span className="text-mist-500">×{count}</span>
                      </span>
                      <span className="block text-[0.62rem] font-semibold text-mist-500">{chest.blurb}</span>
                    </span>
                    <Button size="sm" variant={count > 0 ? 'primary' : 'outline'} disabled={count <= 0} loading={opening === chest.key} onClick={() => void openChest(chest.key)}>
                      Open
                    </Button>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Catalogue Shelves */}
          <div>
            <Segmented value={tab} options={SLOT_TABS} onChange={setTab} className="w-full" />
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {shelfItems.map((item) => (
                <ItemCard key={item.key} item={item} equipped={equipped[item.slot] === item.key} onOpen={() => setPreview(item)} />
              ))}
            </div>
          </div>

          {/* Diamond Vault */}
          <Card className="overflow-hidden border-nova-500/30 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-nova-300">
                <Crown className="size-3.5" /> The Cyber Vault
              </p>
              <span className="text-[0.66rem] font-bold text-mist-500">
                Ultra-rare crystalline relics — up to 25,000 Data Crystals. Seeing one in the wild means someone has truly grinded.
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {vault.map((item) => (
                <ItemCard key={item.key} item={item} size="lg" equipped={equipped[item.slot] === item.key} onOpen={() => setPreview(item)} />
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------------- modals */}
      <Preview item={preview} state={state} onClose={() => setPreview(null)} onBought={afterBuy} onEquipped={afterEquip} />

      {/* chest reward */}
      <Modal open={Boolean(reward)} onClose={() => setReward(null)} title="Chest opened" subtitle={reward?.name}>
        {reward && (
          <div className="grid place-items-center gap-2 py-3 text-center">
            <span className="grid size-20 place-items-center rounded-3xl border-2 border-black/25 bg-gradient-to-br from-white/12 to-black/30 text-4xl">
              {reward.glyph}
            </span>
            <p className="mt-1 text-[1rem] font-black text-mist-50">
              {reward.type === 'item' ? reward.item_name : reward.type === 'xp' ? `+${formatNumber(reward.amount ?? 0)} XP` : `+${formatNumber(reward.amount ?? 0)} coins`}
            </p>
            {reward.diamonds ? (
              <p className="flex items-center gap-1.5 text-[0.8rem] font-black text-nova-300">
                <Gem className="size-4" /> +{formatNumber(reward.diamonds)} Data Crystals
              </p>
            ) : null}
 {reward.type === 'item' && <p className="text-[0.72rem] font-bold tracking-wider text-mist-500">{(reward.rarity ?? '')} cosmetic added to your inventory</p>}
            <Button className="mt-2" onClick={() => setReward(null)}>
              Nice
            </Button>
          </div>
        )}
      </Modal>

      {/* footer reassurance */}
      <p className="text-center text-[0.66rem] font-semibold text-mist-600">
        {profile ? `${formatNumber(profile.coins)} coins · ${formatNumber(profile.diamonds ?? 0)} Data Crystals` : ''} — every item here is cosmetic.
        Nothing in this shop changes a score, an exam or a reward.
      </p>
    </div>
  );
}
