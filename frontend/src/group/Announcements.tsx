/**
 * Announcements. Staff publish a title, message, optional image, priority and
 * schedule, and can pin. Pinned items sit at the top of their own page — never
 * in the middle of chat. Everyone else just reads.
 */
import {ArrowLeft, Megaphone, Pin, Plus, Trash2} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Pager, SectionHeading, Segmented, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useGroup} from './context';
import type {GroupAnnouncement, PageMeta} from '../lib/types';

function toUtcIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function CreateAnnouncement({onDone, onCancel}: {onDone: () => void; onCancel: () => void}) {
  const {groupId, notify} = useGroup();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [pinned, setPinned] = useState(false);
  const [publishAt, setPublishAt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (title.trim().length < 3) {
      notify('error', 'Add a title', 'Announcements need a title.');
      return;
    }
    setBusy(true);
    try {
      await api.groups.createAnnouncement(groupId, {
        title: title.trim(),
        body: body.trim(),
        priority,
        pinned,
        scheduled_at: toUtcIso(publishAt),
      });
      notify('success', 'Announcement published', 'Members have been notified.');
      onDone();
    } catch (error) {
      notify('error', 'Could not publish', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} icon={<ArrowLeft className="size-4" />}>Back</Button>
        <h2 className="text-[1rem] font-extrabold text-mist-50">Publish announcement</h2>
      </div>
      <Card className="grid gap-3 p-4">
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Quiz moved to Friday" maxLength={200} />
        </Field>
        <Field label="Message">
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="What do members need to know?" maxLength={4000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority">
            <Segmented value={priority} onChange={(v) => setPriority(v)} options={[{value: 'normal', label: 'Normal'}, {value: 'high', label: 'High'}]} />
          </Field>
          <Field label="Schedule (optional)">
            <TextInput type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[0.8rem] font-semibold text-mist-300">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4 accent-nova-400" />
          Pin to the top
        </label>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void submit()} disabled={busy} icon={<Megaphone className="size-4" />}>
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

export default function Announcements() {
  const {groupId, can, room, notify, intent, clearIntent} = useGroup();
  const [view, setView] = useState<'list' | 'create'>('list');
  const [items, setItems] = useState<GroupAnnouncement[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (intent === 'create' && can('publish_announcements')) {
      setView('create');
      clearIntent();
    }
  }, [intent, can, clearIntent]);

  const load = useCallback(() => {
    setLoading(true);
    api.groups
      .announcements(groupId, {page, size: 10})
      .then((list) => {
        setItems(list.items);
        setMeta(list);
      })
      .finally(() => setLoading(false));
  }, [groupId, page]);

  useEffect(load, [load]);
  useEffect(() => room.on('group_announcement', load), [room, load]);

  const remove = async (id: number) => {
    try {
      await api.groups.deleteAnnouncement(groupId, id);
      notify('success', 'Announcement removed');
      load();
    } catch (error) {
      notify('error', 'Could not remove', (error as Error).message);
    }
  };

  if (view === 'create')
    return (
      <CreateAnnouncement
        onCancel={() => setView('list')}
        onDone={() => {
          setView('list');
          setPage(1);
          load();
        }}
      />
    );

  /* The server sorts pinned-first, so page 1 leads with the pinned items. */
  const pinned = page === 1 ? items.filter((row) => row.pinned) : [];
  const rest = page === 1 ? items.filter((row) => !row.pinned) : items;

  const renderCard = (row: GroupAnnouncement, isPinned: boolean) => (
    <Card key={row.id} className={`p-3.5 ${isPinned ? 'border-gold-500/30 bg-gold-500/[0.05]' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl border ${isPinned ? 'border-gold-500/30 bg-gold-500/12 text-gold-300' : 'border-white/10 bg-white/5 text-nova-300'}`}>
          {isPinned ? <Pin className="size-4" /> : <Megaphone className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[0.9rem] font-extrabold text-mist-50">{row.title}</h3>
            {row.priority === 'high' && <Chip className="border-flare-500/30 bg-flare-500/12 text-flare-200">High</Chip>}
            {can('delete_announcements') && (
              <Button size="sm" variant="ghost" onClick={() => void remove(row.id)} icon={<Trash2 className="size-3.5 text-flare-300" />}>
                <span className="sr-only">Delete</span>
              </Button>
            )}
          </div>
          <p className="mt-0.5 text-[0.7rem] font-semibold text-mist-500">
            {row.author?.name ?? 'Staff'} · {formatRelative(row.created_at)}
          </p>
          {row.body && <p className="mt-1.5 text-[0.84rem] leading-relaxed font-medium whitespace-pre-wrap text-mist-200">{row.body}</p>}
          {row.image && <img src={row.image} alt="" className="mt-2 max-h-56 rounded-xl border border-white/10 object-cover" />}
        </div>
      </div>
    </Card>
  );

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <SectionHeading
        title="Announcements"
        subtitle="Updates from the group staff"
        icon={<Megaphone className="size-4" />}
        action={can('publish_announcements') ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setView('create')}>New</Button> : undefined}
      />

      {pinned.length > 0 && (
        <div className="grid gap-2">
          <h4 className="inline-flex items-center gap-1 text-[0.72rem] font-black tracking-wider text-gold-300"><Pin className="size-3.5" /> PINNED</h4>
          {pinned.map((row) => renderCard(row, true))}
        </div>
      )}

      {loading && !items.length ? (
        <div className="grid gap-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-5" />} title="No announcements" detail={can('publish_announcements') ? 'Publish the first update.' : 'Updates from staff appear here.'} />
      ) : (
        <div className="grid gap-2">{rest.map((row) => renderCard(row, false))}</div>
      )}

      {meta && meta.pages > 1 && <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Announcement pages" />}
    </div>
  );
}
