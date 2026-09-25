/** Admin: announcements (live broadcast) and the prize vault. */
import {Check, Gift, Megaphone, Pencil, Plus, Sparkles, Trash2} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {iconFor, TIER_GRADIENT} from '../lib/icons';
import {useSession} from '../store/session';
import type {Notice, Prize} from '../lib/types';

const KINDS = ['general', 'exam', 'result', 'duel', 'prize'] as const;
const TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const;
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
    if (!window.confirm('Delete this announcement?')) return;
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
      <SectionHeading
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
                    {notice.is_pinned && <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-300">Pinned</Chip>}
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

      <Modal
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
              <TextInput value={form.title} maxLength={180} onChange={(event) => setForm({...form, title: event.target.value})} />
            </Field>
            <Field label="Message" className="sm:col-span-2">
              <TextArea rows={4} value={form.message} onChange={(event) => setForm({...form, message: event.target.value})} />
            </Field>
            <Field label="Kind">
              <Select value={form.kind} onChange={(event) => setForm({...form, kind: event.target.value as (typeof KINDS)[number]})}>
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target course code" hint="Optional — shown as a tag only.">
              <TextInput value={form.target_course} onChange={(event) => setForm({...form, target_course: event.target.value.toUpperCase()})} />
            </Field>
            <label className="flex items-center gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.is_pinned}
                onChange={(event) => setForm({...form, is_pinned: event.target.checked})}
                className="size-5 accent-fuchsia-500"
              />
              <span className="text-[0.86rem] font-bold text-mist-200">Pin to the top of the feed</span>
            </label>
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
    if (!window.confirm(`Delete “${prize.title}”?`)) return;
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
      <SectionHeading
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
                      <Chip className={prize.is_active ? 'border-mint-500/30 bg-mint-500/12 text-mint-300' : ''}>
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

      <Modal
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
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <Field label="Title">
              <TextInput value={editing.title} onChange={(event) => setEditing({...editing, title: event.target.value})} />
            </Field>
            <Field label="Tier">
              <Select value={editing.tier} onChange={(event) => setEditing({...editing, tier: event.target.value as (typeof TIERS)[number]})}>
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <TextArea rows={2} value={editing.description} onChange={(event) => setEditing({...editing, description: event.target.value})} />
            </Field>
            <Field label="Type">
              <Select value={editing.kind} onChange={(event) => setEditing({...editing, kind: event.target.value as 'rank' | 'coins'})}>
                <option value="rank">Rank reward (top players only)</option>
                <option value="coins">Coin purchase</option>
              </Select>
            </Field>
            <Field label="Icon">
              <Select value={editing.icon} onChange={(event) => setEditing({...editing, icon: event.target.value})}>
                {ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {icon}
                  </option>
                ))}
              </Select>
            </Field>
            {editing.kind === 'rank' ? (
              <>
                <Field label="Min rank">
                  <TextInput type="number" min={1} value={editing.min_rank} onChange={(event) => setEditing({...editing, min_rank: Number(event.target.value)})} />
                </Field>
                <Field label="Max rank" hint="Same as min for a single place.">
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
            <Field label="Sort order">
              <TextInput type="number" value={editing.sort_order} onChange={(event) => setEditing({...editing, sort_order: Number(event.target.value)})} />
            </Field>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(event) => setEditing({...editing, is_active: event.target.checked})}
                className="size-5 accent-fuchsia-500"
              />
              <span className="text-[0.86rem] font-bold text-mist-200">Visible in the vault</span>
            </label>
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
