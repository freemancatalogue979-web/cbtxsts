/** Prizes tab: the vault, eligibility, and coin/rank claims. */
import {CheckCircle2, Coins, Crown, Gift, Lock, Medal, Sparkles, Tag} from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Skeleton, TextArea} from '../components/ui';
import {api} from '../lib/api';
import {coinRain} from '../lib/confetti';
import {HAPTICS} from '../lib/haptics';
import {formatNumber} from '../lib/format';
import {iconFor, TIER_GRADIENT} from '../lib/icons';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSession} from '../store/session';
import type {Prize, PrizeVault} from '../lib/types';

function PrizeCard({prize, onClaim}: {prize: Prize; onClaim: (prize: Prize) => void}) {
  const Icon = iconFor(prize.icon, Gift);
  const gradient = TIER_GRADIENT[prize.tier] ?? TIER_GRADIENT.bronze;
  const rankLocked = prize.kind === 'rank';
  const affordable = !rankLocked && prize.cost_coins > 0 ? prize.eligible : true;

  return (
    <motion.li variants={staggerItem}>
      <Card className="group relative flex h-full flex-col overflow-hidden p-4 sm:p-5">
        <div className={`pointer-events-none absolute -top-20 -right-14 size-44 rounded-full bg-gradient-to-br ${gradient} opacity-20 blur-3xl`} />
        <div className="relative flex items-start justify-between gap-3">
          <span className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${gradient} text-ink-950 shadow-lg sm:size-14`}>
            <Icon className="size-6 sm:size-7" strokeWidth={2.2} />
          </span>
          <div className="flex flex-col items-end gap-1 sm:gap-1.5">
            <Chip className="border-white/14 bg-white/6 text-mist-300 capitalize">{prize.tier}</Chip>
            {prize.claimed ? (
              <Chip className="border-mint-500/32 bg-mint-500/14 text-mint-300" icon={<CheckCircle2 className="size-3" />}>
                Claimed
              </Chip>
            ) : !prize.eligible ? (
              <Chip className="border-white/12 bg-white/5 text-mist-500" icon={<Lock className="size-3" />}>
                Locked
              </Chip>
            ) : prize.stock >= 0 ? (
              <Chip className="border-white/12 bg-white/5 text-mist-500" icon={<Tag className="size-3" />}>
                {prize.stock} left
              </Chip>
            ) : null}
          </div>
        </div>

        <h3 className="relative mt-3 text-[0.95rem] leading-snug font-extrabold text-mist-50 sm:mt-4 sm:text-[1rem]">{prize.title}</h3>
        <p className="relative mt-1 flex-1 text-[0.78rem] font-medium leading-relaxed text-mist-500 sm:mt-1.5 sm:text-[0.82rem]">{prize.description}</p>

        <div className="relative mt-3 flex items-center justify-between gap-2 sm:mt-4 sm:gap-3">
          {rankLocked ? (
            <span className="flex items-center gap-1.5 text-[0.74rem] font-bold text-gold-300 sm:text-[0.78rem]">
              <Medal className="size-4" />
              Rank {prize.min_rank}
              {prize.max_rank && prize.max_rank !== prize.min_rank ? `–${prize.max_rank}` : ''} only
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[0.74rem] font-bold text-gold-300 sm:text-[0.78rem]">
              <Coins className="size-4" />
              {formatNumber(prize.cost_coins)} coins
            </span>
          )}

          <Button
            size="sm"
            variant={prize.claimed ? 'outline' : prize.eligible && affordable ? 'gold' : 'outline'}
            disabled={prize.claimed || !prize.eligible || !affordable}
            onClick={() => onClaim(prize)}
          >
            {prize.claimed ? 'Submitted' : prize.eligible && affordable ? 'Claim' : 'Not eligible'}
          </Button>
        </div>
      </Card>
    </motion.li>
  );
}

export default function PrizesPanel() {
  const {profile, toast, refreshProfile} = useSession();
  const [vault, setVault] = useState<PrizeVault | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Prize | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .prizes()
      .then((data) => {
        setVault(data);
        setLoading(false);
      })
      .catch((error: Error) => {
        toast('error', 'Could not load the vault', error.message);
        setLoading(false);
      });
  }, [toast]);

  useEffect(load, [load]);

  const claim = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const result = await api.claimPrize(target.id, note.trim());
      coinRain(90);
      HAPTICS.reward();
      toast('success', 'Prize claimed!', result.prize.title);
      setTarget(null);
      setNote('');
      load();
      refreshProfile();
    } catch (error) {
      toast('error', 'Claim rejected', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const prizes = vault?.prizes ?? [];
  const mine = prizes.filter((prize) => prize.claimed);
  const available = prizes.filter((prize) => !prize.claimed);

  return (
    <div className="space-y-4 sm:space-y-6">
      <SectionHeading
        title="Prize vault"
        subtitle={vault?.prize_pool_note || 'Spend coins or top the board to unlock real rewards.'}
        icon={<Gift className="size-4" />}
        action={
          <Chip className="border-gold-500/28 bg-gold-500/12 text-gold-300" icon={<Coins className="size-3.5" />}>
            {formatNumber(profile?.coins ?? 0)} coins
          </Chip>
        }
      />

      {vault && (
        <Card className="relative overflow-hidden p-4 sm:p-5">
          <div className="pointer-events-none absolute -top-20 -left-10 size-56 rounded-full bg-gold-500/12 blur-3xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
 <p className="flex items-center gap-2 text-[0.62rem] font-black tracking-[0.16em] text-mist-500 sm:text-[0.68rem] sm:tracking-[0.24em]">
                <Sparkles className="size-3.5 text-gold-400" /> {vault.season}
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-xl font-black tracking-tight text-mist-50 sm:mt-1.5 sm:text-2xl">
                <Crown className="size-5 shrink-0 text-gold-400 sm:size-6" />
                <span className="truncate">{vault.rank_label}</span>
              </h2>
              <p className="mt-1 text-[0.8rem] font-semibold text-mist-400 sm:text-[0.84rem]">
                {vault.my_rank > 0 ? `Rank #${vault.my_rank} on the all-time board` : 'Submit an exam to get ranked'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:w-auto sm:gap-2">
              {[
                {label: 'Prizes', value: prizes.length},
                {label: 'Claimed', value: vault.prizes.filter((p) => p.claimed).length},
                {label: 'Coins', value: formatNumber(profile?.coins ?? 0)},
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/5 px-1.5 py-2.5 text-center sm:px-4 sm:py-3">
                  <p className="truncate text-base font-black tabular text-mist-50 sm:text-lg">{stat.value}</p>
 <p className="truncate text-[0.56rem] font-bold tracking-[0.06em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.14em]">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-48 sm:h-52" />
          ))}
        </div>
      ) : available.length === 0 && mine.length === 0 ? (
        <EmptyState icon={<Gift className="size-6" />} title="The vault is empty" detail="Staff can publish prize tiers from the admin console." />
      ) : (
        <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {available.map((prize) => (
            <PrizeCard key={prize.id} prize={prize} onClaim={(item) => setTarget(item)} />
          ))}
          {mine.map((prize) => (
            <PrizeCard key={prize.id} prize={prize} onClaim={(item) => setTarget(item)} />
          ))}
        </motion.ul>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={target ? `Claim “${target.title}”` : ''}
        subtitle={target?.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button variant="gold" onClick={claim} loading={busy} icon={<Gift className="size-4" />}>
              Confirm claim
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${TIER_GRADIENT[target.tier] ?? TIER_GRADIENT.gold} text-ink-950 sm:size-11`}>
                {(() => {
                  const Icon = iconFor(target.icon, Gift);
                  return <Icon className="size-5" />;
                })()}
              </span>
              <div>
                <p className="text-[0.86rem] font-extrabold text-mist-50">
                  {target.kind === 'rank' ? 'Rank reward' : `${formatNumber(target.cost_coins)} coins`}
                </p>
                <p className="text-[0.76rem] font-semibold text-mist-500">
                  {target.kind === 'rank'
                    ? `Reserved for rank ${target.min_rank}${target.max_rank !== target.min_rank ? `–${target.max_rank}` : ''}`
                    : `Deducted from your ${formatNumber(profile?.coins ?? 0)} coin balance`}
                </p>
              </div>
            </div>
            <Field label="Delivery note" hint="Where should staff reach you? Phone, WhatsApp, hostel — anything helpful.">
              <TextArea rows={3} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
            </Field>
            <p className="text-[0.78rem] font-medium text-mist-500">
              Claims land in the staff console for approval. You will see the status change on your next visit.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
