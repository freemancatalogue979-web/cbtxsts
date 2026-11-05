/**
 * The Vault — where the highest realm badges are kept on display.
 *
 * Two things live here:
 *
 *   1. **The Ascendants.** The players at the top of the season board, each
 *      standing in their own alcove with the realm badge they are carrying.
 *      The badge is the thing: you come here to look at it.
 *   2. **The Hundred Realms.** Every realm on the ladder, lit if you have
 *      reached it and dimmed if you have not.
 *
 * The frame is deliberately quiet — a deep panel, a hairline rule and a lot of
 * dark space — so the badges are the only thing with colour in it.
 */
import {useEffect, useMemo, useState} from 'react';
import {motion} from 'motion/react';
import {Crown, Gem, Lock, Sparkles, Trophy, Users} from 'lucide-react';

import type {SeasonRank} from '../components/SeasonBadge';
import {RealmBadge} from '../components/Badge';
import {Avatar, Card, Chip, EmptyState, SectionHeading, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {MYSTICAL_FROM, REALMS, realmFromRank, type Realm} from '../lib/realms';
import {useSession} from '../store/session';

type Leader = {
  id: number;
  name: string;
  avatar_hue?: number;
  initials?: string;
  country?: string;
  season_xp: number;
  rank: number;
  level?: number;
  realm?: SeasonRank;
};

type SeasonPayload = {
  season: {key: string; number: number; label: string; days_left: number};
  me_season: {xp: number; level: number; rank: SeasonRank; board_rank: number};
  ladder: SeasonRank[];
  leaderboard: Leader[];
};

/** One realm in the gallery: its badge, its name and its line. */
function RealmTile({realm, reached, mine}: {realm: Realm; reached: boolean; mine: boolean}) {
  return (
    <div
      className={`vault-realm ${reached ? 'vault-realm--lit' : ''} ${mine ? 'vault-realm--mine' : ''} ${
        realm.mystical ? 'vault-realm--mystical' : ''
      }`}
    >
      <RealmBadge
        realm={realm.realm}
        label={realm.label}
        deep={realm.deep}
        bright={realm.bright}
        glyph={realm.glyph}
        shape={realm.shape}
        mystical={realm.mystical}
        size="md"
        locked={!reached}
        showNumber
      />
      <p className="vault-realm__name">{realm.label}</p>
      <p className="vault-realm__band">Realm {realm.realm}</p>
      {!reached ? (
        <span className="vault-realm__lock" aria-hidden="true">
          <Lock className="size-3" />
        </span>
      ) : null}
    </div>
  );
}

/** One ascendant: their avatar, their realm badge and their standing. */
function Ascendant({leader, mine}: {leader: Leader; mine: boolean}) {
  const realm = leader.realm ? realmFromRank(leader.realm) : undefined;
  const rank = realm?.realm ?? leader.level ?? 0;
  return (
    <motion.div variants={staggerItem} className={`vault-ascendant ${mine ? 'vault-ascendant--mine' : ''}`}>
      <div className="vault-ascendant__badge">
        {realm ? (
          <RealmBadge
            realm={realm.realm}
            label={realm.label}
            deep={realm.deep}
            bright={realm.bright}
            glyph={realm.glyph}
            shape={realm.shape}
            mystical={realm.mystical}
            size="lg"
            showNumber
          />
        ) : (
          <span className="grid size-[70px] place-items-center rounded-2xl border border-white/10 text-mist-600">
            <Lock className="size-5" />
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('ag:player', {detail: {id: leader.id}}))}
        className="vault-ascendant__name"
        aria-label={`View ${leader.name}'s profile`}
      >
        <Avatar name={leader.name} hue={leader.avatar_hue} initials={leader.initials} size={34} />
        <span className="min-w-0 text-left">
          <b className="block truncate text-[0.82rem] font-extrabold text-mist-50">{leader.name}</b>
          <small className="block truncate text-[0.64rem] font-bold text-mist-500">
            {realm ? `Realm ${rank} · ${realm.label}` : 'Realm unreached'}
          </small>
          <small className="block truncate text-[0.6rem] font-bold text-mist-600 tabular">{formatNumber(leader.season_xp)} XP</small>
        </span>
      </button>
      <span className="vault-ascendant__rank">
        <Crown className={leader.rank === 1 ? 'size-3.5 text-gold-300' : 'size-3.5 text-mist-500'} />#{leader.rank}
      </span>
    </motion.div>
  );
}

export default function RealmVaultPanel() {
  const {profile} = useSession();
  const [data, setData] = useState<SeasonPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.arena
      .season()
      .then((payload) => setData(payload as unknown as SeasonPayload))
      .catch((err: Error) => setError(err.message));
  }, []);

  const ladder = data?.ladder ?? [];
  const myLevel = data?.me_season.level ?? 0;

  /* The gallery is driven by the ladder the server sent; when the server is
     older and sends twelve bands, the local table fills the gaps so the vault
     still shows a hundred realms. */
  const gallery = useMemo(() => {
    const byRealm = new Map<number, Realm>();
    for (const rank of ladder) {
      const realm = realmFromRank(rank);
      byRealm.set(realm.realm, realm);
    }
    for (const realm of REALMS) {
      if (!byRealm.has(realm.realm)) byRealm.set(realm.realm, realm);
    }
    return [...byRealm.values()].sort((a, b) => a.realm - b.realm);
  }, [ladder]);

  const bands = useMemo(() => {
    const grouped = new Map<string, Realm[]>();
    for (const realm of gallery) {
      const key = realm.band || realm.family;
      grouped.set(key, [...(grouped.get(key) ?? []), realm]);
    }
    return [...grouped.entries()];
  }, [gallery]);

  const ascendants = useMemo(() => {
    const rows = [...(data?.leaderboard ?? [])];
    // The highest badge comes first, so the vault opens on the best of it.
    rows.sort((a, b) => (b.realm?.realm ?? b.level ?? 0) - (a.realm?.realm ?? a.level ?? 0));
    return rows.slice(0, 12);
  }, [data]);

  if (error) {
    return (
      <Card className="p-5 text-center">
        <p className="text-[0.84rem] font-bold text-mist-400">Could not open the vault — {error}</p>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const myRealm = realmFromRank(data.me_season.rank);

  return (
    <div className="min-w-0 space-y-3.5 sm:space-y-4">
      {/* ---------------------------------------------------------- the frame */}
      <section className="vault-frame">
        <div className="vault-frame__head">
          <div className="min-w-0">
            <p className="ag-eyebrow">
              <Gem className="size-3.5 text-nova-300" />
              The Vault · Season {data.season.number}
            </p>
            <h2 className="ag-title mt-1 text-[1.5rem] leading-none sm:text-[1.9rem]">The Hundred Realms</h2>
            <p className="mt-1.5 text-[0.78rem] font-semibold text-mist-400">
              Every badge the arena has to give, and the players carrying the highest ones.
            </p>
          </div>
          <div className="vault-frame__mine">
            <RealmBadge
              realm={myRealm.realm}
              label={myRealm.label}
              deep={myRealm.deep}
              bright={myRealm.bright}
              glyph={myRealm.glyph}
              shape={myRealm.shape}
              mystical={myRealm.mystical}
              size="xl"
              current
              showNumber
            />
            <div>
              <p className="text-[0.6rem] font-black tracking-[0.18em] text-mist-500">YOUR REALM</p>
              <p className="text-[1.02rem] font-black text-mist-50">{myRealm.label}</p>
              <p className="text-[0.68rem] font-bold text-mist-500 tabular">
                Realm {myRealm.realm} of {REALMS.length} · #{data.me_season.board_rank} on the board
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- the ascendants */}
      <Card className="min-w-0 p-4">
        <SectionHeading
          title="The Ascendants"
          subtitle="The highest realm badges on the board right now. Tap one to open their profile."
          icon={<Trophy className="size-4" />}
          action={<Chip tone="mint">{ascendants.length} on show</Chip>}
        />
        {ascendants.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="Nobody has claimed a realm yet"
            detail="The first player past level 1 opens the vault."
          />
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          >
            {ascendants.map((leader) => (
              <Ascendant key={leader.id} leader={leader} mine={profile?.id === leader.id} />
            ))}
          </motion.div>
        )}
      </Card>

      {/* ------------------------------------------------------ the whole ladder */}
      <Card className="min-w-0 p-4">
        <SectionHeading
          title="Every realm"
          subtitle={`A hundred realms across ten families. From realm ${MYSTICAL_FROM} upward the badges glow — those are entities, not medals.`}
          icon={<Sparkles className="size-4" />}
          action={<Chip tone="neutral">{gallery.length} realms</Chip>}
        />
        <div className="mt-3 space-y-4">
          {bands.map(([band, realms]) => {
            const mystical = realms[0]?.mystical;
            return (
              <div key={band}>
                <div className="vault-band">
                  <span className={`vault-band__name ${mystical ? 'vault-band__name--mystical' : ''}`}>{band}</span>
                  <span className="vault-band__rule" />
                  <span className="vault-band__range tabular">
                    Realms {realms[0].realm}–{realms[realms.length - 1].realm}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-10">
                  {realms.map((realm) => (
                    <RealmTile key={realm.realm} realm={realm} reached={realm.realm <= myLevel} mine={realm.realm === myRealm.realm} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="flex items-center justify-center gap-1.5 text-[0.7rem] font-semibold text-mist-500">
        <Sparkles className="size-3.5" />
        A realm resets with the season. The badge you end on is the one you keep until the next month opens.
      </p>
    </div>
  );
}
