/**
 * EventsAdmin — create and manage arena events.
 *
 * The creator exposes every knob the backend honours: scheduling on the
 * server clock, question source (course + optional topics), timing mode,
 * entry requirement, visibility, join/leave rules, leaderboard visibility and
 * the reward stack. Everything here goes through the admin API — the players'
 * Events tab is the only other door.
 */
import {useCallback, useEffect, useState} from 'react';
import {CalendarDays, Clock, Loader2, Pencil, Plus, Trash2, Trophy, Users, Zap} from 'lucide-react';
import {Button, Card, Chip, Field, Modal, Select, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {uiClick} from '../lib/sfx';
import {useSession} from '../store/session';
import type {ArenaEventSummary, Course} from '../lib/types';

type TimeMode = 'untimed' | 'fixed' | 'per_question';

interface FormState {
  name: string;
  description: string;
  course_id: string;
  topics: string;
  starts_at: string;
  ends_at: string;
  question_count: number;
  time_mode: TimeMode;
  duration_minutes: number;
  per_question_seconds: number;
  entry_xp: number;
  visibility: 'public' | 'course';
  reward_xp: number;
  reward_coins: number;
  reward_diamonds: number;
  reward_badge: string;
  banner: string;
  scoring_note: string;
  allow_join_during: boolean;
  allow_leave: boolean;
  leaderboard_visible: boolean;
  featured: boolean;
}

/** Local datetime input → ISO for the API (the backend stores naive UTC). */
function toIso(local: string): string {
  if (!local) return '';
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 19);
}

function fromIso(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyForm(): FormState {
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const end = new Date(Date.now() + 30 * 60 * 1000 + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    name: '',
    description: '',
    course_id: '',
    topics: '',
    starts_at: local(start),
    ends_at: local(end),
    question_count: 15,
    time_mode: 'fixed',
    duration_minutes: 20,
    per_question_seconds: 30,
    entry_xp: 0,
    visibility: 'public',
    reward_xp: 500,
    reward_coins: 300,
    reward_diamonds: 0,
    reward_badge: '',
    banner: '',
    scoring_note: 'Standard scoring — accuracy first, speed breaks ties.',
    allow_join_during: true,
    allow_leave: true,
    leaderboard_visible: true,
    featured: false,
  };
}

export default function EventsAdmin({onChanged}: {onChanged?: () => void}) {
  const {toast} = useSession();
  const [events, setEvents] = useState<ArenaEventSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const limit = 40;
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  // Raw typing for the question-count field so it never snaps back mid-edit.
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState<ArenaEventSummary | null>(null);

  const load = useCallback(() => {
    Promise.all([api.adminEvents({limit, offset}), api.admin.courses().catch(() => [])])
      .then(([eventsPayload, coursesPayload]) => {
        setEvents(eventsPayload.events);
        setTotal(eventsPayload.total);
        setCourses(coursesPayload);
      })
      .catch((error: Error) => toast('error', 'Could not load events', error.message))
      .finally(() => setLoading(false));
  }, [offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({...current, [key]: value}));

  const openCreator = () => {
    uiClick('confirm');
    setEditing(null);
    setForm(emptyForm());
    setCreating(true);
  };

  const openEditor = (event: ArenaEventSummary) => {
    uiClick('nav');
    setEditing(event);
    setForm({
      ...emptyForm(),
      name: event.name,
      description: event.description,
      course_id: event.course_id ? String(event.course_id) : '',
      topics: (event.topics ?? []).join(', '),
      starts_at: fromIso(event.starts_at),
      ends_at: fromIso(event.ends_at),
      question_count: event.question_count,
      time_mode: event.time_mode,
      duration_minutes: event.duration_minutes,
      per_question_seconds: event.per_question_seconds,
      entry_xp: event.entry_xp,
      visibility: event.visibility === 'course' ? 'course' : 'public',
      reward_xp: Number((event.rewards as Record<string, number>).xp ?? 0),
      reward_coins: Number((event.rewards as Record<string, number>).coins ?? 0),
      reward_diamonds: Number((event.rewards as Record<string, number>).diamonds ?? 0),
      reward_badge: String((event.rewards as Record<string, string>).badge_key ?? ''),
      banner: event.banner,
      scoring_note: event.scoring_note,
      allow_join_during: event.allow_join_during,
      allow_leave: event.allow_leave,
      leaderboard_visible: event.leaderboard_visible,
      featured: (event as {featured?: boolean}).featured ?? false,
    });
    setCountDraft(null);
    setCreating(true);
  };

  const submit = async () => {
    uiClick('confirm');
    if (!form.name.trim()) {
      toast('error', 'Name required', 'Give the event a name players will recognize.');
      return;
    }
    if (form.question_count < 3 || form.question_count > 100) {
      toast('error', 'Questions: 3 to 100', `You typed ${form.question_count} — clear the box and enter a fresh count.`);
      return;
    }
    setBusy(true);
    const body = {
      name: form.name.trim(),
      description: form.description,
      course_id: form.course_id ? Number(form.course_id) : null,
      topics: form.topics
        .split(',')
        .map((topic) => topic.trim())
        .filter(Boolean),
      starts_at: toIso(form.starts_at),
      ends_at: toIso(form.ends_at),
      question_count: form.question_count,
      time_mode: form.time_mode,
      duration_minutes: form.duration_minutes,
      per_question_seconds: form.per_question_seconds,
      entry_xp: form.entry_xp,
      visibility: form.visibility,
      rewards: {
        xp: form.reward_xp,
        coins: form.reward_coins,
        diamonds: form.reward_diamonds,
        ...(form.reward_badge ? {badge_key: form.reward_badge} : {}),
      },
      banner: form.banner,
      scoring_note: form.scoring_note,
      allow_join_during: form.allow_join_during,
      allow_leave: form.allow_leave,
      leaderboard_visible: form.leaderboard_visible,
      featured: form.featured,
    };
    try {
      if (editing) {
        await api.adminUpdateEvent(editing.id, body);
        toast('success', 'Event updated', `${body.name} was saved.`);
      } else {
        await api.adminCreateEvent(body);
        toast('success', 'Event created', `${body.name} is on the calendar.`);
      }
      setCreating(false);
      setCountDraft(null);
      load();
      onChanged?.();
    } catch (error) {
      toast('error', editing ? 'Could not update' : 'Could not create', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event: ArenaEventSummary) => {
    if (!window.confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
    uiClick('cancel');
    try {
      await api.adminDeleteEvent(event.id);
      toast('success', 'Event deleted', `${event.name} is gone.`);
      load();
      onChanged?.();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-5 text-nova-300" />
        <h2 className="text-[1.05rem] font-extrabold text-mist-50">Arena events</h2>
        <span className="text-[0.7rem] font-bold text-mist-500">{formatNumber(total)} on the calendar</span>
        <Button className="ml-auto" size="sm" onClick={openCreator} icon={<Plus className="size-4" />}>
          New event
        </Button>
      </div>

      {loading && (
        <Card className="flex items-center justify-center gap-2 p-8 text-[0.8rem] font-bold text-mist-500">
          <Loader2 className="size-4 animate-spin" /> Loading events…
        </Card>
      )}

      {!loading && events.length === 0 && (
        <Card className="p-8 text-center">
          <CalendarDays className="mx-auto size-6 text-mist-500" />
          <p className="mt-2 text-[0.86rem] font-extrabold text-mist-100">No events yet</p>
          <p className="mt-1 text-[0.76rem] font-medium text-mist-400">
            Events are timed, no-cap competitions — create one and every player sees it in their Events tab.
          </p>
          <Button className="mt-4" onClick={openCreator} icon={<Plus className="size-4" />}>
            Create the first event
          </Button>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {events.map((event) => (
          <Card key={event.id} className="flex flex-col p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.92rem] font-extrabold text-mist-50">{event.name}</p>
                <p className="truncate text-[0.68rem] font-bold text-mist-500">{event.course_title}</p>
              </div>
              <Chip
                className={
                  event.status === 'live'
                    ? 'border-mint-400/30 bg-mint-400/10 text-mint-300'
                    : event.status === 'scheduled'
                      ? 'border-gold-400/30 bg-gold-400/10 text-gold-300'
                      : event.status === 'cancelled'
                        ? 'border-flare-400/30 bg-flare-400/10 text-flare-300'
                        : 'border-white/10 bg-white/6 text-mist-400'
                }
              >
                {event.status === 'live' ? 'Live' : event.status === 'scheduled' ? 'Scheduled' : event.status === 'cancelled' ? 'Cancelled' : 'Finished'}
              </Chip>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip>{event.question_count} questions</Chip>
              <Chip>{event.time_mode === 'fixed' ? 'Fixed duration' : event.time_mode === 'per_question' ? 'Per-question clock' : 'Untimed'}</Chip>
              {event.entry_xp > 0 && <Chip>{formatNumber(event.entry_xp)} XP entry</Chip>}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-[0.7rem] font-bold text-mist-400">
              <p className="flex items-center gap-1.5">
                <Clock className="size-3.5 text-nova-300" /> {fromIso(event.starts_at).replace('T', ' · ')}
              </p>
              <p className="flex items-center gap-1.5">
                <Users className="size-3.5 text-nova-300" /> {formatNumber(event.participants)} players
              </p>
              <p className="flex items-center gap-1.5">
                <Trophy className="size-3.5 text-gold-300" /> {event.prize_pool}
              </p>
              <p className="flex items-center gap-1.5">
                <Zap className="size-3.5 text-flare-300" /> {event.visibility === 'course' ? 'Course only' : 'Everyone'}
              </p>
            </div>
            {event.status !== 'finished' && event.status !== 'live' && (
              <div className="mt-3 flex gap-2 border-t border-white/8 pt-3">
                <Button size="sm" variant="outline" onClick={() => openEditor(event)} icon={<Pencil className="size-3.5" />}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(event)} icon={<Trash2 className="size-3.5" />}>
                  Delete
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

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

      {/* ------------------------------------------------------ creator */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={editing ? 'Edit event' : 'New arena event'}
        subtitle="Everything runs on the server clock — players can close their browsers mid-event."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={submit} icon={<CalendarDays className="size-4" />}>
              {editing ? 'Save changes' : 'Create event'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="Shown on every event card.">
            <TextInput value={form.name} maxLength={160} onChange={(e) => set('name', e.target.value)} placeholder="Friday Night Clash" />
          </Field>
          <Field label="Course" hint="Leave empty for the whole arena bank.">
            <Select value={form.course_id} onChange={(e) => set('course_id', e.target.value)}>
              <option value="">Whole arena</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" hint="One or two lines players will read.">
            <TextInput value={form.description} maxLength={400} onChange={(e) => set('description', e.target.value)} placeholder="A one-hour sprint across the whole syllabus." />
          </Field>
          <Field label="Topics (optional)" hint="Comma-separated — narrows the question draw.">
            <TextInput value={form.topics} onChange={(e) => set('topics', e.target.value)} placeholder="Natural Law, Jurisprudence" />
          </Field>
          <Field label="Starts at" hint="Server time drives everything.">
            <TextInput type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
          </Field>
          <Field label="Ends at" hint="Ranked finalize here automatically.">
            <TextInput type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
          </Field>
          <Field label="Questions" hint="Fixed order, same for every player.">
            <TextInput
              type="number"
              value={countDraft ?? String(form.question_count)}
              onChange={(e) => {
                setCountDraft(e.target.value);
                const raw = e.target.value.trim();
                const n = raw === '' ? 0 : Math.floor(Number(raw));
                set('question_count', Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0);
              }}
              onBlur={() => setCountDraft(null)}
            />
          </Field>
          <Field label="Timing mode">
            <Select value={form.time_mode} onChange={(e) => set('time_mode', e.target.value as TimeMode)}>
              <option value="fixed">Fixed duration (event clock)</option>
              <option value="per_question">Timed per question</option>
              <option value="untimed">Untimed until the end</option>
            </Select>
          </Field>
          {form.time_mode === 'fixed' && (
            <Field label="Duration (minutes)" hint="Caps the event window.">
              <TextInput type="number" value={form.duration_minutes} onChange={(e) => set('duration_minutes', Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          )}
          {form.time_mode === 'per_question' && (
            <Field label="Seconds per question">
              <TextInput type="number" value={form.per_question_seconds} onChange={(e) => set('per_question_seconds', Math.max(5, Number(e.target.value) || 5))} />
            </Field>
          )}
          <Field label="Entry requirement (XP)" hint="Players below this cannot join. 0 = open to all.">
            <TextInput type="number" value={form.entry_xp} onChange={(e) => set('entry_xp', Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Visibility">
            <Select value={form.visibility} onChange={(e) => set('visibility', e.target.value as 'public' | 'course')}>
              <option value="public">Everyone</option>
              <option value="course">Course players only</option>
            </Select>
          </Field>
          <Field label="Reward XP" hint="Winner takes the full amount; lower places earn a share.">
            <TextInput type="number" value={form.reward_xp} onChange={(e) => set('reward_xp', Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Reward coins">
            <TextInput type="number" value={form.reward_coins} onChange={(e) => set('reward_coins', Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Reward diamonds" hint="Prestige currency — use sparingly.">
            <TextInput type="number" value={form.reward_diamonds} onChange={(e) => set('reward_diamonds', Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Event badge key" hint="Existing badge key granted to the winner.">
            <TextInput value={form.reward_badge} onChange={(e) => set('reward_badge', e.target.value)} placeholder="badge_key" />
          </Field>
          <Field label="Scoring note" hint="Shown as the rules line.">
            <TextInput value={form.scoring_note} maxLength={400} onChange={(e) => set('scoring_note', e.target.value)} />
          </Field>
          <Field label="Banner label" hint="Optional short tag shown on the card.">
            <TextInput value={form.banner} maxLength={120} onChange={(e) => set('banner', e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 border-t border-white/8 pt-3">
          {(
            [
              ['allow_join_during', 'Allow joining after the start'],
              ['allow_leave', 'Allow leaving mid-event'],
              ['leaderboard_visible', 'Leaderboard visible to players'],
              ['featured', '★ Featured on the events hub'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[0.76rem] font-bold text-mist-300">
              <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} className="size-4 accent-violet-500" />
              {label}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
