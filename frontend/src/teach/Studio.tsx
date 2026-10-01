/** Teacher Studio — the professional teaching workspace. */
import {
  BadgeCheck,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Search,
  Star,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {ApiError} from '../lib/api';
import {FORMAT_LABEL, teachers, type MyProfile, type Person, type StudentDetail, type StudioOverview, type StudioStudent, type TGroup, type TRequest, type TReview, type TeacherStats} from '../lib/teachers';
import {Empty, LoadingRows, PageHeader, Seg} from '../pro/ui';
import {useSession} from '../store/session';
import {ApplicationGate, ProfileEditor} from './Apply';
import {StudioMaterials, StudioQuizzes} from './StudioContent';
import {BadgeRow, Cover, Field, PersonAvatar, ProScope, Sheet, Stars, StatusPill, SubjectChip, VerifiedMark, subjectLook, goTo, responseLabel, takeIntent, timeAgo, useLive} from './ui';

const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

type View = 'home' | 'requests' | 'students' | 'groups' | 'materials' | 'quizzes' | 'reviews' | 'profile';
const VIEWS: {id: View; label: string; icon: ReactNode}[] = [
  {id: 'home', label: 'Home', icon: <LayoutDashboard />},
  {id: 'requests', label: 'Requests', icon: <Inbox />},
  {id: 'students', label: 'Students', icon: <Users />},
  {id: 'groups', label: 'Groups', icon: <UserPlus />},
  {id: 'materials', label: 'Materials', icon: <BookOpen />},
  {id: 'quizzes', label: 'Quizzes', icon: <ListChecks />},
  {id: 'reviews', label: 'Reviews', icon: <Star />},
  {id: 'profile', label: 'Profile', icon: <UserRound />},
];
const isView = (v: unknown): v is View => VIEWS.some((x) => x.id === v);

export default function Studio() {
  const [profile, setProfile] = useState<MyProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    teachers
      .myProfile()
      .then((r) => setProfile(r.profile))
      .catch((e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);
  useLive('notify', (data) => {
    const meta = (data as {meta?: {tab?: string}}).meta;
    if (meta?.tab === 'studio') load();
  });

  return (
    <ProScope>
      {error && <Empty title="Teacher Studio is unavailable" body={error} />}
      {profile === undefined && !error && <LoadingRows rows={5} />}
      {profile !== undefined && (profile?.status === 'approved' ? <Workspace profile={profile} onProfile={setProfile} /> : <ApplicationGate profile={profile} onChanged={setProfile} />)}
    </ProScope>
  );
}

/* ------------------------------------------------------------- workspace */
function Workspace({profile, onProfile}: {profile: MyProfile; onProfile: (p: MyProfile) => void}) {
  const {chatUnread} = useSession();
  const [view, setView] = useState<View>(() => {
    const intent = takeIntent('ag.studio.view');
    return isView(intent) ? intent : 'home';
  });
  const [overview, setOverview] = useState<StudioOverview | null>(null);
  const [groups, setGroups] = useState<TGroup[]>([]);
  const [more, setMore] = useState(false);

  const loadOverview = useCallback(() => {
    teachers.overview().then(setOverview).catch(() => {});
    teachers.groups().then((r) => setGroups(r.items)).catch(() => {});
  }, []);
  useEffect(loadOverview, [loadOverview]);
  useLive('notify', loadOverview);

  useEffect(() => {
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent<{tab?: string; view?: string}>).detail;
      if (detail?.tab === 'studio' && isView(detail.view)) {
        takeIntent('ag.studio.view');
        setView(detail.view);
      }
    };
    window.addEventListener('ag:navigate', onNav);
    return () => window.removeEventListener('ag:navigate', onNav);
  }, []);

  const open = (next: View) => {
    setView(next);
    setMore(false);
    window.scrollTo({top: 0, behavior: 'smooth'});
  };
  const unreadMessages = Object.values(chatUnread).reduce((a, b) => a + b, 0);
  const counts: Partial<Record<View, number>> = {requests: overview?.today.new_requests ?? 0, groups: overview?.today.group_requests ?? 0};
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {/* desktop / tablet strip */}
      <div className="flex min-w-0 items-center gap-2">
        <nav className="t-studio-nav min-w-0 flex-1" data-phone-hide="" role="tablist" aria-label="Teacher Studio">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => open(v.id)}>
              {v.icon}
              {v.label}
              {!!counts[v.id] && <span className="t-unread">{counts[v.id]}</span>}
            </button>
          ))}
        </nav>
      </div>

      {/* phone: five-item teacher bar + menu */}
      <div className="grid gap-2 md:hidden">
        <nav className="t-phone-bar" role="tablist" aria-label="Teacher Studio">
          {(['home', 'students', 'groups'] as View[]).map((id) => {
            const v = VIEWS.find((x) => x.id === id)!;
            return (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => open(id)}>
                {v.icon}
                {v.label}
                {!!counts[id] && <span className="t-unread">{counts[id]}</span>}
              </button>
            );
          })}
          <button type="button" onClick={() => goTo({tab: 'messages'})}>
            <MessageSquare />
            Messages
            {unreadMessages > 0 && <span className="t-unread">{unreadMessages}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === 'profile'} onClick={() => open('profile')}>
            <UserRound />
            Profile
          </button>
        </nav>
        {!['home', 'students', 'groups', 'profile'].includes(view) && (
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="pro-eyebrow inline-flex items-center gap-1.5">
              {current.label}
            </p>
            <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => setMore(true)}>
              <MoreHorizontal className="size-4" /> Sections
            </button>
          </div>
        )}
      </div>

      {view === 'home' && <Home profile={profile} overview={overview} onOpen={open} onChanged={loadOverview} onMore={() => setMore(true)} />}
      {view === 'requests' && <Requests onChanged={loadOverview} />}
      {view === 'students' && <Students groups={groups} />}
      {view === 'groups' && <Groups groups={groups} onChanged={loadOverview} />}
      {view === 'materials' && <StudioMaterials groups={groups} />}
      {view === 'quizzes' && <StudioQuizzes groups={groups} />}
      {view === 'reviews' && <Reviews />}
      {view === 'profile' && <ProfileView profile={profile} overview={overview} onProfile={onProfile} />}

      <Sheet open={more} onClose={() => setMore(false)} size="sm" icon={<LayoutDashboard />} title="Teacher Studio">
        <div className="grid gap-1">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className="t-row t-row-btn rounded-xl" style={{background: view === v.id ? 'var(--pro-hover)' : undefined}} onClick={() => open(v.id)}>
              <span className="t-attach-icon">{v.icon}</span>
              <span className="flex-1 font-semibold">{v.label}</span>
              {!!counts[v.id] && <span className="t-unread">{counts[v.id]}</span>}
              <ChevronRight className="size-4 opacity-50" />
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ home */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Home({profile, overview, onOpen, onChanged, onMore}: {profile: MyProfile; overview: StudioOverview | null; onOpen: (v: View) => void; onChanged: () => void; onMore: () => void}) {
  const me = useSession().profile;
  if (!overview) return <LoadingRows rows={6} />;
  const t = overview.today;
  const kpis: {label: string; value: number; sub: string; action: () => void; hue: string; icon: ReactNode}[] = [
    {label: 'New requests', value: t.new_requests, sub: t.new_requests ? 'Waiting for you' : 'All answered', action: () => onOpen('requests'), hue: 'amber', icon: <Inbox />},
    {label: 'Active students', value: t.active_students, sub: `${overview.stats.students_taught} taught in total`, action: () => onOpen('students'), hue: 'blue', icon: <Users />},
    {label: 'Unread messages', value: t.unread_messages, sub: 'Across conversations', action: () => goTo({tab: 'messages'}), hue: 'violet', icon: <MessageSquare />},
    {label: 'Group requests', value: t.group_requests, sub: `${overview.stats.groups} group${overview.stats.groups === 1 ? '' : 's'}`, action: () => onOpen('groups'), hue: 'teal', icon: <UserPlus />},
  ];
  return (
    <div className="grid min-w-0 gap-5">
      <section className="t-hero-teacher t-studio-hero grid gap-4">
        <Cover deg={subjectLook(profile.specialties[0]?.subject).deg} deg2={((me?.avatar_hue ?? 260) + 40) % 360} icon={subjectLook(profile.specialties[0]?.subject).Icon} height={70} className="t-studio-cover" />
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3.5">
          {me && <PersonAvatar id={me.id} name={me.name} hue={me.avatar_hue} hasPhoto={me.has_photo} size={72} ring="brand" verified={profile.verified} />}
          <div className="min-w-0 pt-[34px]">
            <p className="pro-eyebrow">Teacher Studio</p>
            <h1 className="pro-h1 mt-1 flex flex-wrap items-center gap-x-2 [overflow-wrap:anywhere] max-sm:!text-[1.55rem] md:!text-[2.1rem]">
              {greeting()}, {overview.profile.short_name}
              {profile.verified && <VerifiedMark />}
            </h1>
            <p className="pro-secondary mt-1 max-w-xl">{overview.profile.headline || 'Your teaching workspace.'}</p>
          </div>
          </div>
          <span className="pro-badge sm:mt-[40px]" data-tone={overview.profile.accepting ? 'success' : 'neutral'}>
            {overview.profile.accepting ? 'Accepting students' : 'Not accepting'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <button key={k.label} type="button" className="t-kpi pro-lift text-left" onClick={k.action}>
              <span className="flex items-center gap-1.5">
                <i className="grid size-6 place-items-center rounded-lg [&>svg]:size-3.5" style={{color: `var(--pro-h-${k.hue})`, background: `var(--pro-h-${k.hue}-soft)`}}>
                  {k.icon}
                </i>
                {k.label}
              </span>
              <b>{k.value}</b>
              <small>{k.sub}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          <section className="pro-card overflow-hidden">
            <header className="flex items-center justify-between gap-2 p-4 pb-2">
              <h2 className="pro-h3">Pending requests</h2>
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => onOpen('requests')}>
                All <ChevronRight className="size-4" />
              </button>
            </header>
            {overview.pending.length === 0 ? (
              <p className="pro-secondary px-4 pb-4">No requests waiting. Students find you through Find a teacher — a complete profile helps.</p>
            ) : (
              <div className="grid gap-2 p-3 pt-1">
                {overview.pending.slice(0, 3).map((r) => (
                  <RequestCard key={r.id} request={r} onChanged={onChanged} compact />
                ))}
              </div>
            )}
          </section>

          <section className="pro-card p-4">
            <h2 className="pro-h3 mb-3">Quick actions</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['New quiz', <ListChecks key="q" />, 'green', () => onOpen('quizzes')],
                  ['Add material', <BookOpen key="m" />, 'blue', () => onOpen('materials')],
                  ['Create group', <UserPlus key="g" />, 'teal', () => onOpen('groups')],
                  ['All sections', <MoreHorizontal key="s" />, 'violet', onMore],
                ] as const
              ).map(([label, icon, hue, action]) => (
                <button key={label} type="button" className="pro-card pro-lift grid justify-items-start gap-2 p-3 text-left" onClick={action}>
                  <span className="grid size-9 place-items-center rounded-xl [&>svg]:size-[18px]" style={{color: `var(--pro-h-${hue})`, background: `var(--pro-h-${hue}-soft)`}}>
                    {icon}
                  </span>
                  <span className="text-[0.85rem] font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <ReputationCard stats={overview.stats} badges={overview.badges} />
          <section className="pro-card p-4">
            <h2 className="pro-h3 mb-2">Recent activity</h2>
            {overview.activity.length === 0 ? (
              <p className="pro-secondary">Activity from your students appears here.</p>
            ) : (
              <ol className="grid gap-3">
                {overview.activity.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{background: a.kind === 'request' ? 'var(--pro-warning)' : a.kind === 'quiz' ? 'var(--pro-success)' : a.kind === 'review' ? '#f5b544' : 'var(--pro-accent)'}} />
                    <span className="min-w-0">
                      <span className="block text-[0.85rem] [overflow-wrap:anywhere]">{a.text}</span>
                      <span className="pro-meta">{timeAgo(a.at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ReputationCard({stats, badges}: {stats: TeacherStats; badges: StudioOverview['badges']}) {
  const rows: [string, string][] = [
    ['Rating', stats.review_count ? `${stats.rating.toFixed(1)} from ${stats.review_count} review${stats.review_count === 1 ? '' : 's'}` : 'No reviews yet'],
    ['Students taught', String(stats.students_taught)],
    ['Typical response', stats.response_hours === null ? 'Not enough requests yet' : `${responseLabel(stats.response_hours)}${stats.response_rate != null ? ` · ${Math.round(stats.response_rate)}% answered` : ''}`],
    ['Quiz attempts', String(stats.quiz_attempts)],
  ];
  return (
    <section className="pro-card p-4">
      <h2 className="pro-h3">Your reputation</h2>
      <p className="pro-meta mb-3">What students see — plain numbers, no hidden score.</p>
      <dl className="grid gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-[0.85rem]">
            <dt className="pro-secondary">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {badges.length > 0 ? (
        <div className="mt-3 border-t pt-3" style={{borderColor: 'var(--pro-border)'}}>
          <BadgeRow badges={badges} />
        </div>
      ) : (
        <p className="pro-meta mt-3 border-t pt-3" style={{borderColor: 'var(--pro-border)'}}>
          Badges like “Fast responder” and “Top rated” are earned from these numbers.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- requests */
function RequestCard({request: r, onChanged, compact}: {request: TRequest; onChanged: () => void; compact?: boolean}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const student = r.student as Person;
  const decide = async (decision: 'accept' | 'decline') => {
    setBusy(decision);
    try {
      await teachers.decide(r.id, decision, note);
      toast('success', decision === 'accept' ? `${student.name} is now your student` : 'Request declined', decision === 'accept' ? 'You can message them and share materials.' : undefined);
      setDeclining(false);
      onChanged();
    } catch (e) {
      toast('error', 'Could not update request', errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className={compact ? 'grid gap-2.5 rounded-2xl p-3' : 'pro-card t-card'} style={compact ? {background: 'var(--pro-hover)'} : undefined}>
      <div className="flex min-w-0 items-start gap-3">
        <PersonAvatar id={student.id} name={student.name ?? 'Student'} hue={student.avatar_hue} hasPhoto={student.has_photo} size={44} ring="hue" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate font-semibold">{student.name}</p>
            {!compact && <StatusPill status={r.status} />}
          </div>
          <p className="pro-meta truncate">
            {FORMAT_LABEL[r.format] ?? r.format} · {timeAgo(r.created_at)}
          </p>
        </div>
      </div>
      {r.subject ? <SubjectChip subject={r.subject} label={r.topic || r.subject} size="sm" /> : <span className="t-topic justify-self-start">General help</span>}
      <p className={`t-quote ${compact ? 'line-clamp-2' : 'whitespace-pre-wrap'}`}>{r.message}</p>
      <div className="t-stat-line empty:hidden">
        {r.preferred_time && (
          <span>
            <CalendarClock className="size-3.5" /> {r.preferred_time}
          </span>
        )}
      </div>
      {r.response_note && !compact && <p className="pro-meta">Your note: {r.response_note}</p>}
      {r.status === 'pending' && !declining && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => void decide('accept')} disabled={!!busy}>
            {busy === 'accept' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Accept
          </button>
          <button type="button" className="pro-btn pro-btn-sm" onClick={() => setDeclining(true)} disabled={!!busy}>
            <X className="size-4" /> Decline
          </button>
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => goTo({tab: 'messages', withId: student.id})}>
            <MessageSquare className="size-4" /> Ask a question
          </button>
        </div>
      )}
      {declining && (
        <div className="grid gap-2">
          <textarea className="pro-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="Optional note to the student — e.g. who might suit them better" />
          <div className="flex gap-2">
            <button type="button" className="pro-btn pro-btn-sm" onClick={() => setDeclining(false)}>
              Back
            </button>
            <button type="button" className="pro-btn pro-btn-sm" style={{color: 'var(--pro-danger)'}} onClick={() => void decide('decline')} disabled={!!busy}>
              {busy === 'decline' && <Loader2 className="size-4 animate-spin" />} Decline request
            </button>
          </div>
        </div>
      )}
      {r.status === 'accepted' && !compact && (
        <button type="button" className="pro-btn pro-btn-sm justify-self-start" onClick={() => goTo({tab: 'messages', withId: student.id})}>
          <MessageSquare className="size-4" /> Message
        </button>
      )}
    </article>
  );
}

function Requests({onChanged}: {onChanged: () => void}) {
  const [state, setState] = useState('pending');
  const [data, setData] = useState<{items: TRequest[]; counts: Record<string, number>} | null>(null);
  const load = useCallback(() => {
    teachers.studioRequests(state).then(setData).catch(() => setData({items: [], counts: {}}));
  }, [state]);
  useEffect(load, [load]);
  useLive('notify', load);
  const c = data?.counts ?? {};
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader eyebrow="Teacher Studio" title="Requests" description="Students asking for your help. Respond quickly — response time is shown on your profile." />
      <Seg
        value={state}
        onChange={setState}
        label="Request status"
        size="sm"
        options={[
          {value: 'pending', label: `Pending${c.pending ? ` · ${c.pending}` : ''}`},
          {value: 'accepted', label: 'Accepted'},
          {value: 'declined', label: 'Declined'},
          {value: 'all', label: 'All'},
        ]}
      />
      {data === null && <LoadingRows rows={3} />}
      {data?.items.length === 0 && <Empty icon={<Inbox className="size-6" />} hue="amber" title={state === 'pending' ? 'No pending requests' : 'Nothing here'} body={state === 'pending' ? "You're all caught up." : undefined} />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.items.map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            onChanged={() => {
              load();
              onChanged();
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- students */
function Students({groups}: {groups: TGroup[]}) {
  const [items, setItems] = useState<StudioStudent[] | null>(null);
  const [term, setTerm] = useState('');
  const [state, setState] = useState<'active' | 'past'>('active');
  const [openId, setOpenId] = useState<number | null>(null);
  const load = useCallback(() => {
    teachers.students().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (items ?? []).filter((s) => (state === 'active' ? s.relationship.status === 'active' : s.relationship.status !== 'active') && (!needle || s.student.name.toLowerCase().includes(needle) || s.relationship.topic.toLowerCase().includes(needle)));
  }, [items, term, state]);
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader eyebrow="Teacher Studio" title="Students" description="Everyone you teach. Open a student for progress, quiz results and your private notes." />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="pro-search min-w-0 self-start">
          <Search />
          <input className="pro-input w-full" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name or topic" aria-label="Search students" />
        </label>
        <Seg value={state} onChange={(v) => setState(v as typeof state)} label="Students" size="sm" options={[{value: 'active', label: 'Active'}, {value: 'past', label: 'Past'}]} />
      </div>
      {items === null && <LoadingRows rows={4} />}
      {items && shown.length === 0 && (
        <Empty
          icon={<Users className="size-6" />}
          hue="blue"
          title={items.length ? 'No students match' : 'No students yet'}
          body={items.length ? undefined : 'Accept a request and the student appears here.'}
        />
      )}
      {shown.length > 0 && (
        <div className="pro-card overflow-hidden">
          {shown.map((s, i) => (
            <button key={s.relationship.id} type="button" className="t-row t-row-btn" style={{borderTop: i ? '1px solid var(--pro-border)' : undefined}} onClick={() => setOpenId(s.student.id)}>
              <PersonAvatar id={s.student.id} name={s.student.name} hue={s.student.avatar_hue} hasPhoto={s.student.has_photo} size={44} ring="hue" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.student.name}</span>
                <span className="pro-meta block truncate">
                  {[s.relationship.topic || s.relationship.subject, `${s.quiz_attempts} quiz${s.quiz_attempts === 1 ? '' : 'zes'}`, `active ${timeAgo(s.last_activity_at)}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              {s.progress != null && <ProgressRing value={s.progress} />}
              <ChevronRight className="size-4 shrink-0 opacity-50" />
            </button>
          ))}
        </div>
      )}
      <StudentSheet studentId={openId} groups={groups} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}

function ProgressRing({value}: {value: number}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const hue = v >= 70 ? 'green' : v >= 50 ? 'blue' : 'amber';
  return (
    <span className="t-ring" style={{['--v' as string]: String(v), ['--c' as string]: `var(--pro-h-${hue})`}} title={`Average quiz score ${v}%`} aria-label={`Average quiz score ${v}%`}>
      <b>{v}</b>
    </span>
  );
}

const PROGRESS_OPTIONS = ['', 'Just started', 'Improving', 'On track', 'Excellent', 'Needs attention'];

function StudentSheet({studentId, groups, onClose, onChanged}: {studentId: number | null; groups: TGroup[]; onClose: () => void; onChanged: () => void}) {
  const {toast} = useSession();
  const [data, setData] = useState<StudentDetail | null>(null);
  const [notes, setNotes] = useState({weak_areas: '', progress: '', next_step: '', body: ''});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviteGroup, setInviteGroup] = useState<number | ''>('');
  useEffect(() => {
    setData(null);
    if (!studentId) return;
    teachers
      .student(studentId)
      .then((d) => {
        setData(d);
        setNotes({weak_areas: d.notes?.weak_areas ?? '', progress: d.notes?.progress ?? '', next_step: d.notes?.next_step ?? '', body: d.notes?.body ?? ''});
        setSavedAt(d.notes?.updated_at ?? null);
      })
      .catch((e) => {
        toast('error', 'Could not open student', errText(e));
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const saveNotes = async () => {
    if (!studentId) return;
    setSaving(true);
    try {
      const res = await teachers.saveNotes(studentId, notes);
      setSavedAt(res.updated_at);
      toast('success', 'Notes saved', 'Only you can see them.');
    } catch (e) {
      toast('error', 'Could not save notes', errText(e));
    } finally {
      setSaving(false);
    }
  };
  const invite = async () => {
    if (!studentId || !inviteGroup) return;
    try {
      await teachers.inviteToGroup(inviteGroup, studentId);
      toast('success', 'Added to group');
      setInviteGroup('');
    } catch (e) {
      toast('error', 'Could not add', errText(e));
    }
  };
  const complete = async () => {
    if (!data || !window.confirm(`Mark your lessons with ${data.student.name} as completed? They'll be able to leave a review.`)) return;
    try {
      await teachers.completeRelationship(data.relationship.id);
      toast('success', 'Marked as completed');
      onChanged();
      onClose();
    } catch (e) {
      toast('error', 'Could not update', errText(e));
    }
  };

  const p = data?.performance;
  return (
    <Sheet
      open={studentId !== null}
      onClose={onClose}
      size="lg"
      icon={<GraduationCap />}
      title={data?.student.name ?? 'Student'}
      subtitle={data ? `${[data.relationship.subject, data.relationship.topic].filter(Boolean).join(' · ') || 'General'} · since ${timeAgo(data.relationship.started_at)}` : undefined}
    >
      {!data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="grid min-w-0 gap-5">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => goTo({tab: 'messages', withId: data.student.id})}>
              <MessageSquare className="size-4" /> Message
            </button>
            {data.relationship.status === 'active' && (
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => void complete()}>
                <Check className="size-4" /> Mark completed
              </button>
            )}
            <StatusPill status={data.relationship.status} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Quiz attempts', String(p?.attempts ?? 0)],
              ['Average', p?.average != null ? `${Math.round(p.average)}%` : '—'],
              ['Passed', String(p?.passed ?? 0)],
              ['Study streak', `${p?.streak ?? 0} day${p?.streak === 1 ? '' : 's'}`],
            ].map(([k, v]) => (
              <div key={k} className="t-kpi">
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>

          <section className="grid gap-3 rounded-2xl p-4" style={{background: 'var(--pro-hover)', border: '1px dashed var(--pro-border-strong)'}}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="pro-h3 inline-flex items-center gap-2">
                <NotebookPen className="size-4" style={{color: 'var(--pro-accent-text)'}} /> Private notes
              </h3>
              <span className="pro-badge" data-tone="neutral">
                <Lock className="size-3" /> Only you can see these
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Weak areas">
                <input className="pro-input" value={notes.weak_areas} onChange={(e) => setNotes({...notes, weak_areas: e.target.value})} maxLength={2000} placeholder="e.g. chain rule, word problems" />
              </Field>
              <Field label="Progress">
                <select className="pro-input" value={notes.progress} onChange={(e) => setNotes({...notes, progress: e.target.value})}>
                  {PROGRESS_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o || '—'}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Next step">
              <input className="pro-input" value={notes.next_step} onChange={(e) => setNotes({...notes, next_step: e.target.value})} maxLength={1000} placeholder="What to cover next" />
            </Field>
            <Field label="Notes">
              <textarea className="pro-input" style={{minHeight: 110}} value={notes.body} onChange={(e) => setNotes({...notes, body: e.target.value})} maxLength={6000} />
            </Field>
            <div className="flex items-center justify-between gap-2">
              <span className="pro-meta">{savedAt ? `Saved ${timeAgo(savedAt)}` : 'Not saved yet'}</span>
              <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => void saveNotes()} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />} Save notes
              </button>
            </div>
          </section>

          <section className="grid gap-2">
            <h3 className="pro-h3">Quiz results</h3>
            {data.attempts.length === 0 && <p className="pro-secondary">No quizzes taken yet. Share one from Messages or Quizzes.</p>}
            {data.attempts.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 text-[0.88rem]">
                <span className="min-w-0 truncate">{a.quiz}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="pro-meta">{timeAgo(a.submitted_at)}</span>
                  <span className="pro-badge" data-tone={a.passed ? 'success' : 'warning'}>
                    {Math.round(a.percentage)}%
                  </span>
                </span>
              </div>
            ))}
          </section>

          <section className="grid gap-2">
            <h3 className="pro-h3">Materials opened</h3>
            {data.materials.length === 0 && <p className="pro-secondary">Nothing opened yet.</p>}
            {data.materials.slice(0, 8).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 text-[0.88rem]">
                <span className="min-w-0 truncate">{m.title}</span>
                <span className="pro-meta shrink-0">
                  {m.downloaded ? 'Downloaded · ' : ''}
                  {timeAgo(m.viewed_at)}
                </span>
              </div>
            ))}
          </section>

          {groups.length > 0 && data.relationship.status === 'active' && (
            <section className="grid gap-2">
              <h3 className="pro-h3">Groups</h3>
              {data.groups.length > 0 && <p className="pro-secondary">Member of {data.groups.map((g) => g.name).join(', ')}</p>}
              <div className="flex gap-2">
                <select className="pro-input min-w-0 flex-1" value={inviteGroup} onChange={(e) => setInviteGroup(e.target.value ? Number(e.target.value) : '')} aria-label="Add to group">
                  <option value="">Add to a group…</option>
                  {groups
                    .filter((g) => !data.groups.some((x) => x.id === g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
                <button type="button" className="pro-btn" onClick={() => void invite()} disabled={!inviteGroup}>
                  <UserPlus className="size-4" /> Add
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- groups */
const PRIVACY_LABEL: Record<string, string> = {public: 'Public — anyone can join', request: 'Request to join', invite: 'Invite only', open: 'Public'};

function Groups({groups, onChanged}: {groups: TGroup[]; onChanged: () => void}) {
  const [editing, setEditing] = useState<TGroup | 'new' | null>(null);
  const [requestsFor, setRequestsFor] = useState<TGroup | null>(null);
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        eyebrow="Teacher Studio"
        title="Groups"
        description="Study groups with chat, shared materials and quizzes."
        actions={
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> New group
          </button>
        }
      />
      {groups.length === 0 && (
        <Empty
          icon={<Users className="size-6" />}
          hue="teal"
          title="No groups yet"
          body="Create a group for a topic — e.g. “JAMB Physics evening class”. Choose public, request-to-join or invite only."
          action={
            <button type="button" className="pro-btn pro-btn-sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Create a group
            </button>
          }
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <article key={g.id} className="pro-card t-card">
            <div className="flex items-start gap-3">
              <span className="t-attach-icon" style={{['--mark' as string]: 'var(--pro-h-teal)'}}>
                <Users />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="pro-h3 truncate">{g.name}</h3>
                <p className="pro-meta truncate">{[g.subject, g.topic].filter(Boolean).join(' · ') || 'General'}</p>
              </div>
              {!!g.pending_requests && (
                <button type="button" className="pro-badge" data-tone="warning" onClick={() => setRequestsFor(g)}>
                  {g.pending_requests} request{g.pending_requests === 1 ? '' : 's'}
                </button>
              )}
            </div>
            {g.description && <p className="pro-secondary line-clamp-2 [overflow-wrap:anywhere]">{g.description}</p>}
            <div>
              <div className="mb-1 flex justify-between text-[0.75rem] font-semibold" style={{color: 'var(--pro-text-2)'}}>
                <span>
                  {g.members}
                  {g.capacity ? ` / ${g.capacity}` : ''} members
                </span>
                <span>{PRIVACY_LABEL[g.privacy]}</span>
              </div>
              {g.capacity > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full" style={{background: 'var(--pro-track)'}}>
                  <div className="h-full rounded-full" style={{width: `${Math.min(100, (g.members / g.capacity) * 100)}%`, background: g.full ? 'var(--pro-warning)' : 'var(--pro-accent)'}} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => goTo({tab: 'groups', groupId: g.id})}>
                <ExternalLink className="size-4" /> Open
              </button>
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => setEditing(g)}>
                Edit
              </button>
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => setRequestsFor(g)}>
                <Inbox className="size-4" /> Requests
              </button>
            </div>
          </article>
        ))}
      </div>
      <GroupEditor
        open={editing !== null}
        group={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
      <GroupRequests group={requestsFor} onClose={() => setRequestsFor(null)} onChanged={onChanged} />
    </div>
  );
}

function GroupEditor({open, group, onClose, onSaved}: {open: boolean; group: TGroup | null; onClose: () => void; onSaved: () => void}) {
  const {toast} = useSession();
  const [form, setForm] = useState({name: '', description: '', subject: '', topic: '', capacity: 30, privacy: 'request'});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({name: group?.name ?? '', description: group?.description ?? '', subject: group?.subject ?? '', topic: group?.topic ?? '', capacity: group?.capacity ?? 30, privacy: group?.privacy === 'open' ? 'public' : group?.privacy ?? 'request'});
  }, [open, group]);
  const save = async () => {
    setBusy(true);
    try {
      if (group) await teachers.updateGroup(group.id, form);
      else await teachers.createGroup(form);
      toast('success', group ? 'Group updated' : 'Group created');
      onSaved();
    } catch (e) {
      toast('error', 'Could not save', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={<Users />}
      title={group ? 'Edit group' : 'New study group'}
      footer={
        <>
          <button type="button" className="pro-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void save()} disabled={busy || form.name.trim().length < 3}>
            {busy && <Loader2 className="size-4 animate-spin" />} {group ? 'Save' : 'Create group'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name">
          <input className="pro-input" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} maxLength={140} placeholder="e.g. Organic Chemistry — weekend class" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject">
            <input className="pro-input" value={form.subject} onChange={(e) => setForm({...form, subject: e.target.value})} maxLength={80} />
          </Field>
          <Field label="Topic">
            <input className="pro-input" value={form.topic} onChange={(e) => setForm({...form, topic: e.target.value})} maxLength={120} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="pro-input" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} maxLength={300} />
        </Field>
        <Field label="Who can join" group>
          <div className="grid gap-1.5">
            {(['public', 'request', 'invite'] as const).map((p) => (
              <button key={p} type="button" className="t-chip-btn justify-start" aria-pressed={form.privacy === p} onClick={() => setForm({...form, privacy: p})}>
                {PRIVACY_LABEL[p]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Capacity" hint="0 = no limit">
          <input className="pro-input" type="number" min={0} max={500} value={form.capacity} onChange={(e) => setForm({...form, capacity: Math.max(0, Math.min(500, Number(e.target.value) || 0))})} />
        </Field>
      </div>
    </Sheet>
  );
}

function GroupRequests({group, onClose, onChanged}: {group: TGroup | null; onClose: () => void; onChanged: () => void}) {
  const {toast} = useSession();
  const [items, setItems] = useState<{id: number; student: Person; message: string; created_at: string}[] | null>(null);
  const load = useCallback(() => {
    if (group) teachers.groupRequests(group.id).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [group]);
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);
  const decide = async (id: number, decision: 'approve' | 'reject') => {
    if (!group) return;
    try {
      await teachers.decideGroupRequest(group.id, id, decision);
      load();
      onChanged();
    } catch (e) {
      toast('error', 'Could not update', errText(e));
    }
  };
  return (
    <Sheet open={!!group} onClose={onClose} size="sm" icon={<Inbox />} title="Join requests" subtitle={group?.name}>
      {items === null && <LoadingRows rows={2} />}
      {items?.length === 0 && <p className="pro-secondary">No pending requests.</p>}
      <div className="grid gap-3">
        {items?.map((r) => (
          <div key={r.id} className="grid gap-2 rounded-2xl p-3" style={{background: 'var(--pro-hover)'}}>
            <div className="flex items-center gap-3">
              <PersonAvatar id={r.student.id} name={r.student.name} hue={r.student.avatar_hue} hasPhoto={r.student.has_photo} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.student.name}</span>
                <span className="pro-meta">{timeAgo(r.created_at)}</span>
              </span>
            </div>
            {r.message && <p className="pro-secondary [overflow-wrap:anywhere]">{r.message}</p>}
            <div className="flex gap-2">
              <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => void decide(r.id, 'approve')}>
                <Check className="size-4" /> Approve
              </button>
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => void decide(r.id, 'reject')}>
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- reviews */
function Reviews() {
  const [data, setData] = useState<{items: TReview[]; stats: TeacherStats; distribution: Record<string, number>} | null>(null);
  const load = useCallback(() => {
    teachers.studioReviews().then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!data) return <LoadingRows rows={4} />;
  const total = Object.values(data.distribution).reduce((a, b) => a + b, 0);
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader eyebrow="Teacher Studio" title="Reviews" description="Only students who completed lessons with you can review. Reply publicly to show you listen." />
      <div className="pro-card grid gap-5 p-4 sm:grid-cols-[180px_minmax(0,1fr)] md:p-5">
        <div className="grid content-center justify-items-center gap-1 text-center">
          <b className="text-[2.4rem] font-bold leading-none tracking-tight">{data.stats.review_count ? data.stats.rating.toFixed(1) : '—'}</b>
          <Stars value={data.stats.rating} />
          <span className="pro-meta">
            {data.stats.review_count} review{data.stats.review_count === 1 ? '' : 's'}
          </span>
        </div>
        <div className="grid content-center gap-1.5">
          {[5, 4, 3, 2, 1].map((n) => (
            <div key={n} className="t-dist">
              <span>{n} ★</span>
              <div>
                <i style={{width: `${total ? ((data.distribution[String(n)] ?? 0) / total) * 100 : 0}%`}} />
              </div>
              <span className="text-right">{data.distribution[String(n)] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
      {data.items.length === 0 && <Empty icon={<Star className="size-6" />} hue="amber" title="No reviews yet" body="When a relationship is marked completed, the student is invited to review you." />}
      <div className="grid gap-3">
        {data.items.map((r) => (
          <ReviewItem key={r.id} review={r} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

function ReviewItem({review: r, onChanged}: {review: TReview; onChanged: () => void}) {
  const {toast} = useSession();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState(r.teacher_response);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await teachers.respondReview(r.id, text);
      toast('success', 'Reply posted');
      setReplying(false);
      onChanged();
    } catch (e) {
      toast('error', 'Could not reply', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="pro-card t-card">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Stars value={r.rating} />
          <span className="font-semibold">{r.author}</span>
        </span>
        <span className="pro-meta">{timeAgo(r.created_at)}</span>
      </div>
      {r.status === 'hidden' && (
        <span className="pro-badge justify-self-start" data-tone="warning">
          Hidden by moderators
        </span>
      )}
      {r.body && <p className="pro-body [overflow-wrap:anywhere]">{r.body}</p>}
      {r.teacher_response && !replying && (
        <div className="rounded-xl p-3" style={{background: 'var(--pro-hover)', borderLeft: '3px solid var(--pro-accent)'}}>
          <p className="pro-eyebrow">Your reply</p>
          <p className="pro-secondary mt-1 [overflow-wrap:anywhere]">{r.teacher_response}</p>
        </div>
      )}
      {replying ? (
        <div className="grid gap-2">
          <textarea className="pro-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} placeholder="Thank them, or respond calmly to concerns." />
          <div className="flex gap-2">
            <button type="button" className="pro-btn pro-btn-sm" onClick={() => setReplying(false)}>
              Cancel
            </button>
            <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => void send()} disabled={busy || text.trim().length < 2}>
              Post reply
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm justify-self-start" onClick={() => setReplying(true)}>
          {r.teacher_response ? 'Edit reply' : 'Reply'}
        </button>
      )}
    </article>
  );
}

/* --------------------------------------------------------------- profile */
function ProfileView({profile, overview, onProfile}: {profile: MyProfile; overview: StudioOverview | null; onProfile: (p: MyProfile) => void}) {
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        eyebrow="Teacher Studio"
        title={
          <span className="inline-flex items-center gap-2">
            Your profile {profile.verified && <VerifiedMark />}
          </span>
        }
        description="This is what students see in search and on your profile page."
        actions={
          overview && (
            <button type="button" className="pro-btn" onClick={() => goTo({tab: 'teachers', teacherId: overview.profile.id})}>
              <ExternalLink className="size-4" /> View public profile
            </button>
          )
        }
      />
      {profile.verified && (
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{background: 'var(--pro-success-soft)'}}>
          <BadgeCheck className="mt-0.5 size-5 shrink-0" style={{color: 'var(--pro-success)'}} />
          <p className="pro-secondary">
            <b style={{color: 'var(--pro-text)'}}>Verified teacher</b> since {profile.approved_at ? new Date(profile.approved_at + (profile.approved_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString() : 'approval'}. Qualifications are managed by Genesis staff — contact Support to add new ones.
          </p>
        </div>
      )}
      <ProfileEditor profile={profile} onChanged={onProfile} />
    </div>
  );
}
