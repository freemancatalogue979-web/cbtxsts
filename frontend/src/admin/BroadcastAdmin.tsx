/** Admin: announcements (live broadcast) and the prize vault. */
import {Check, Gift, Megaphone, Pencil, Plus, Sparkles, Trash2, GiftIcon, MegaphoneIcon, Pin, Eye, Info, FileText, BarChart3, Swords, Trophy, Coins, Medal} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Modal, PageBanner, PillSelect, Skeleton, SwitchRow, TextArea, TextInput, askConfirm} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {iconFor, TIER_GRADIENT} from '../lib/icons';
import {useSession} from '../store/session';
import type {Notice, Prize} from '../lib/types';

const KINDS = ['general', 'exam', 'result', 'duel', 'prize'] as const;
const TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const;
const KIND_ICON: Record<(typeof KINDS)[number], typeof Info> = {general: Info, exam: FileText, result: BarChart3, duel: Swords, prize: Gift};
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const ICONS = ['gift', 'trophy', 'medal', 'crown', 'headphones', 'laptop', 'book', 'wallet', 'star', 'zap', 'sparkles', 'shopping'];

const emptyNotice = {title: '', message: '', kind: 'general' as (typeof KINDS)[number], target_course: '', is_pinned: false};
const emptyPrize = {
  title: '',
  description: '',
  tier: 'gold' as (typeof TIERS)[number],
  kind: 'rank' as 'rank' | 'coins',
  min_rank: 1,
  max_rank: 1,
  cost_coins: 0,
  icon: 'gift',
  stock: -1,
  is_active: true,
  sort_order: 0,
};

function NoticesTab({onChanged}: {onChanged: () => void}) {
  const {toast} = useSession();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [form, setForm] = useState<typeof emptyNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const limit = 40;

  const load = useCallback(() => {
    api.admin
      .notifications({limit, offset})
      .then((data) => {
        setNotices(data.rows);
        setTotal(data.total);
      })
      .catch((error: Error) => toast('error', 'Could not load announcements', error.message));
  }, [offset, toast]);

  useEffect(load, [load]);

  const send = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await api.admin.createNotification(form);
      toast('success', 'Broadcast sent', 'Every connected player was notified live.');
      setForm(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not broadcast', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (notice: Notice) => {
    if (!(await askConfirm('Delete this announcement?'))) return;
    try {
      await api.admin.deleteNotification(notice.id);
      toast('info', 'Announcement deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <PageBanner
        eyebrow="Content · Live broadcast"
        tone="flare"
        title="Announcements"
        subtitle="Broadcasts push instantly to every player currently online."
        icon={<Megaphone className="size-4" />}
        action={
          <Button size="sm" onClick={() => setForm({...emptyNotice})} icon={<Plus className="size-4" />}>
            New broadcast
          </Button>
        }
      />

      {!notices ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-24" />
          ))}
        </div>
      ) : notices.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-6" />} title="Nothing broadcast yet" />
      ) : (
        <ul className="space-y-2">
          {notices.map((notice) => (
            <li key={notice.id}>
              <Card className="flex items-start gap-3 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-nova-500/14 text-nova-300">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-extrabold text-mist-50">
                    {notice.title}
                    {notice.is_pinned && <Chip tone="gold">Pinned</Chip>}
                    <Chip className="capitalize">{notice.kind}</Chip>
                  </p>
                  <p className="mt-1 text-[0.82rem] font-medium text-mist-400">{notice.message}</p>
 <p className="mt-1.5 text-[0.7rem] font-bold tracking-wider text-mist-600">
                    {notice.author} · {formatRelative(notice.created_at)}
                    {notice.target_course ? ` · ${notice.target_course}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(notice)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <span className="text-[0.78rem] font-bold text-mist-500">
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {formatNumber(total)}
        </span>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </Button>
      </div>

      <Modal icon={MegaphoneIcon} tone="amber"
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title="Broadcast an announcement"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={send} loading={busy} icon={<Megaphone className="size-4" />}>
              Send now
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <Field label="Title" className="sm:col-span-2">
              <TextInput value={form.title} maxLength={180} placeholder="e.g. Mid-semester results are out" onChange={(event) => setForm({...form, title: event.target.value})} />
            </Field>
            <Field label="Message" className="sm:col-span-2" aside={<span>{form.message.length} chars</span>}>
              <TextArea rows={4} value={form.message} placeholder="What should every player know?" onChange={(event) => setForm({...form, message: event.target.value})} />
            </Field>
            <Field label="Kind" className="sm:col-span-2">
              <PillSelect
                aria-label="Kind"
                value={form.kind}
                onChange={(kind) => setForm({...form, kind})}
                options={KINDS.map((kind) => ({value: kind, label: cap(kind), icon: KIND_ICON[kind]}))}
              />
            </Field>
            <Field label="Target course code" hint="Optional — shown as a tag only.">
              <TextInput value={form.target_course} placeholder="ENG 101" onChange={(event) => setForm({...form, target_course: event.target.value.toUpperCase()})} />
            </Field>
            <SwitchRow
              className="sm:col-span-2"
              icon={Pin}
              label="Pin to the top of the feed"
              description="Stays above newer posts until you unpin it."
              checked={form.is_pinned}
              onChange={(is_pinned) => setForm({...form, is_pinned})}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

function PrizesTab({onChanged}: {onChanged: () => void}) {
  const {toast} = useSession();
  const [prizes, setPrizes] = useState<Prize[] | null>(null);
  const [editing, setEditing] = useState<(typeof emptyPrize & {id?: number}) | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.admin
      .prizes()
      .then(setPrizes)
      .catch((error: Error) => toast('error', 'Could not load prizes', error.message));
  }, [toast]);

  useEffect(load, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.admin.updatePrize(editing.id, editing);
      else await api.admin.createPrize(editing);
      toast('success', editing.id ? 'Prize updated' : 'Prize published', editing.title);
      setEditing(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not save prize', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (prize: Prize) => {
    if (!(await askConfirm(`Delete “${prize.title}”?`))) return;
    try {
      await api.admin.deletePrize(prize.id);
      toast('info', 'Prize deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  const toggleActive = async (prize: Prize) => {
    try {
      await api.admin.updatePrize(prize.id, {...prize, is_active: !prize.is_active});
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not update', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <PageBanner
        eyebrow="Content · Rewards"
        tone="gold"
        title="Prize vault"
        subtitle="Rank rewards and coin purchases players can claim."
        icon={<Gift className="size-4" />}
        action={
          <Button size="sm" onClick={() => setEditing({...emptyPrize})} icon={<Plus className="size-4" />}>
            New prize
          </Button>
        }
      />

      {!prizes ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-32" />
          ))}
        </div>
      ) : prizes.length === 0 ? (
        <EmptyState icon={<Gift className="size-6" />} title="The vault is empty" detail="Publish a prize to give players something to chase." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {prizes.map((prize) => {
            const Icon = iconFor(prize.icon, Gift);
            return (
              <motion.li key={prize.id} layout>
                <Card className={`flex items-start gap-3 p-4 ${prize.is_active ? '' : 'opacity-55'}`}>
                  <span className={`grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${TIER_GRADIENT[prize.tier]} text-ink-950`}>
                    <Icon className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.92rem] font-extrabold text-mist-50">{prize.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[0.78rem] font-medium text-mist-500">{prize.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip className="capitalize">{prize.tier}</Chip>
                      <Chip>{prize.kind === 'rank' ? `Rank ${prize.min_rank}${prize.max_rank !== prize.min_rank ? `–${prize.max_rank}` : ''}` : `${formatNumber(prize.cost_coins)} coins`}</Chip>
                      <Chip>{prize.stock < 0 ? 'Unlimited' : `${prize.stock} left`}</Chip>
                      <Chip tone={prize.is_active ? 'mint' : 'neutral'}>
                        {prize.is_active ? 'Live' : 'Hidden'}
                      </Chip>
                      <Chip>{prize.claims} claimed</Chip>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({...prize})} icon={<Pencil className="size-3.5" />} />
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(prize)}>
                      {prize.is_active ? 'Hide' : 'Show'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(prize)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                  </div>
                </Card>
              </motion.li>
            );
          })}
        </ul>
      )}

      <Modal icon={GiftIcon} tone="gold"
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit prize' : 'New prize'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} icon={<Check className="size-4" />}>
              Save prize
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Field label="Title" className="col-span-2 sm:col-span-1">
              <TextInput value={editing.title} placeholder="e.g. Wireless headphones" onChange={(event) => setEditing({...editing, title: event.target.value})} />
            </Field>
            <Field label="Tier" className="col-span-2 sm:col-span-1">
              <PillSelect aria-label="Tier" value={editing.tier} onChange={(tier) => setEditing({...editing, tier})} options={TIERS.map((tier) => ({value: tier, label: cap(tier), icon: Medal}))} />
            </Field>
            <Field label="Description" className="col-span-2">
              <TextArea rows={2} value={editing.description} placeholder="What the winner receives" onChange={(event) => setEditing({...editing, description: event.target.value})} />
            </Field>
            <Field label="Type" className="col-span-2">
              <PillSelect
                aria-label="Type"
                value={editing.kind}
                onChange={(kind) => setEditing({...editing, kind})}
                options={[
                  {value: 'rank', label: 'Rank reward', icon: Trophy},
                  {value: 'coins', label: 'Coin purchase', icon: Coins},
                ]}
              />
            </Field>
            <Field label="Icon" className="col-span-2">
              <div role="radiogroup" aria-label="Icon" className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                {ICONS.map((icon) => {
                  const Glyph = iconFor(icon);
                  const on = editing.icon === icon;
                  return (
                    <button
                      key={icon}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={icon}
                      title={cap(icon)}
                      onClick={() => setEditing({...editing, icon})}
                      className={`grid aspect-square place-items-center rounded-xl border transition active:scale-95 ${
                        on ? 'border-gold-400/60 bg-gold-500/15 text-gold-200 shadow-[0_4px_16px_-8px_rgba(250,204,21,0.8)]' : 'border-white/10 bg-white/[0.03] text-mist-400 hover:border-white/20 hover:text-mist-100'
                      }`}
                    >
                      <Glyph className="size-4.5" />
                    </button>
                  );
                })}
              </div>
            </Field>
            {editing.kind === 'rank' ? (
              <>
                <Field label="Min rank">
                  <TextInput type="number" min={1} value={editing.min_rank} onChange={(event) => setEditing({...editing, min_rank: Number(event.target.value)})} />
                </Field>
                <Field label="Max rank" hint="Same as min for one place.">
                  <TextInput type="number" min={1} value={editing.max_rank} onChange={(event) => setEditing({...editing, max_rank: Number(event.target.value)})} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Cost in coins">
                  <TextInput type="number" min={0} value={editing.cost_coins} onChange={(event) => setEditing({...editing, cost_coins: Number(event.target.value)})} />
                </Field>
                <Field label="Stock" hint="-1 means unlimited.">
                  <TextInput type="number" min={-1} value={editing.stock} onChange={(event) => setEditing({...editing, stock: Number(event.target.value)})} />
                </Field>
              </>
            )}
            <Field label="Sort order" className="col-span-2 sm:col-span-1">
              <TextInput type="number" value={editing.sort_order} onChange={(event) => setEditing({...editing, sort_order: Number(event.target.value)})} />
            </Field>
            <SwitchRow
              className="col-span-2"
              icon={Eye}
              label="Visible in the vault"
              description={editing.is_active ? 'Players can see and claim it.' : 'Hidden from players.'}
              checked={editing.is_active}
              onChange={(is_active) => setEditing({...editing, is_active})}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function BroadcastAdmin({tab, onChanged}: {tab: 'notices' | 'prizes'; onChanged: () => void}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div key={tab} initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}>
        {tab === 'notices' ? <NoticesTab onChanged={onChanged} /> : <PrizesTab onChanged={onChanged} />}
      </motion.div>
    </AnimatePresence>
  );
}
