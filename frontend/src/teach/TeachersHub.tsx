/** Student side of the Teacher Network: find → profile → request → my teachers. */
import {
  ArrowLeft,
  BookOpen,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Flag,
  GraduationCap,
  Inbox,
  Languages,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  UserPlus,
  Users,
  Zap,
  Award,
  Quote,
  TrendingUp,
  MapPin,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {ApiError} from '../lib/api';
import {
  DAYS,
  FORMAT_LABEL,
  teachers,
  type Catalog,
  type Learning,
  type TeacherCard,
  type TeacherDetail,
  type TGroup,
  type TRequest,
} from '../lib/teachers';
import {Empty, LoadingRows} from '../pro/ui';
import {useSession} from '../store/session';
import {MaterialSheet, QuizRunner, ReportSheet} from './content';
import {HowItWorks, HubHero, LearningSnapshot, SectionHead, SubjectGrid, TeachCta} from './sections';
import {ActionMenu, BadgeRow, Cover, Field, PersonAvatar, ProScope, Sheet, StarInput, StatTile, Stars, StatusPill, SubjectChip, Toggle, VerifiedMark, goTo, responseLabel, subjectLook, takeIntent, timeAgo, hueOf, type HueName} from './ui';

type View = 'find' | 'mine' | 'requests' | 'groups';
const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

export default function TeachersHub() {
  const [view, setView] = useState<View>(() => (takeIntent('ag.teachers.view') as View | null) ?? 'find');
  const [openId, setOpenId] = useState<number | null>(() => {
    const raw = takeIntent('ag.teacher.open');
    return raw ? Number(raw) : null;
  });
  const [learning, setLearning] = useState<Learning | null>(null);
  const [material, setMaterial] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<number | null>(null);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [openGroups, setOpenGroups] = useState<TGroup[] | null>(null);
  useEffect(() => {
    teachers.catalog().then(setCatalog).catch(() => {});
    teachers
      .discoverGroups('')
      .then((res) => setOpenGroups(res.items))
      .catch(() => setOpenGroups([]));
  }, []);
  const findTeachers = () => {
    setView('find');
    window.setTimeout(() => document.getElementById('t-search')?.focus(), 60);
  };

  const loadLearning = useCallback(() => {
    teachers.learning().then(setLearning).catch(() => setLearning({teachers: [], requests: [], materials: [], quizzes: [], groups: []}));
  }, []);
  useEffect(loadLearning, [loadLearning]);

  useEffect(() => {
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent<{tab?: string; teacherId?: number; view?: string}>).detail;
      if (detail?.tab !== 'teachers') return;
      if (detail.teacherId) setOpenId(detail.teacherId);
      if (detail.view) setView(detail.view as View);
    };
    window.addEventListener('ag:navigate', onNav);
    return () => window.removeEventListener('ag:navigate', onNav);
  }, []);

  const pendingCount = learning?.requests.filter((r) => r.status === 'pending').length ?? 0;

  if (openId !== null) {
    return (
      <ProScope>
        <TeacherProfile
          id={openId}
          onBack={() => setOpenId(null)}
          onChanged={loadLearning}
          onOpenMaterial={setMaterial}
          onOpenQuiz={setQuiz}
        />
        <MaterialSheet id={material} onClose={() => setMaterial(null)} />
        <QuizRunner quizId={quiz} onClose={() => setQuiz(null)} />
      </ProScope>
    );
  }

  return (
    <ProScope>
      <HubHero catalog={catalog} learning={learning} groups={openGroups?.length ?? null} onFind={findTeachers} compact={view !== 'find'} />
      <div className="pro-tabs pro-tabs-fit" role="tablist" aria-label="Teachers">
        {(
          [
            ['find', 'Find', 'Find', Search],
            ['mine', 'My teachers', 'Mine', GraduationCap],
            ['requests', 'Requests', 'Requests', Inbox],
            ['groups', 'Groups', 'Groups', Users],
          ] as const
        ).map(([id, label, short, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className="pro-tab inline-flex items-center justify-center gap-1.5" onClick={() => setView(id)}>
            <Icon className="size-4 max-sm:hidden" />
            <span className="max-sm:hidden">{label}</span>
            <span className="sm:hidden">{short}</span>
            {id === 'requests' && pendingCount > 0 && <span className="t-unread">{pendingCount}</span>}
          </button>
        ))}
      </div>
      {view === 'find' && <LearningSnapshot learning={learning} onTab={setView} />}
      {view === 'find' && <FindTeachers catalog={catalog} groups={openGroups} onOpen={setOpenId} onGroups={() => setView('groups')} onReloadGroups={loadLearning} />}
      {view === 'mine' && <MyTeachers learning={learning} onOpen={setOpenId} onReload={loadLearning} onOpenMaterial={setMaterial} onOpenQuiz={setQuiz} onFind={() => setView('find')} />}
      {view === 'requests' && <MyRequests learning={learning} onOpen={setOpenId} onReload={loadLearning} onFind={() => setView('find')} />}
      {view === 'groups' && <TeacherGroups mine={learning?.groups ?? []} onReload={loadLearning} />}
      <MaterialSheet id={material} onClose={() => setMaterial(null)} />
      <QuizRunner quizId={quiz} onClose={() => setQuiz(null)} />
    </ProScope>
  );
}

/* ------------------------------------------------------------------ find */
function FindTeachers({catalog, groups, onOpen, onGroups, onReloadGroups}: {catalog: Catalog | null; groups: TGroup[] | null; onOpen: (id: number) => void; onGroups: () => void; onReloadGroups: () => void}) {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [verified, setVerified] = useState(false);
  const [available, setAvailable] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [minExperience, setMinExperience] = useState(0);
  const [format, setFormat] = useState('');
  const [language, setLanguage] = useState('');
  const [sort, setSort] = useState('relevance');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<TeacherCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [requestFor, setRequestFor] = useState<TeacherCard | null>(null);

  const params = useMemo(
    () => ({q: query, subject, topic, verified, available, min_rating: minRating, min_experience: minExperience, format, language, sort}),
    [query, subject, topic, verified, available, minRating, minExperience, format, language, sort],
  );
  useEffect(() => {
    let live = true;
    setItems(null);
    teachers
      .search({...params, page: 1})
      .then((res) => {
        if (!live) return;
        setItems(res.items);
        setTotal(res.total);
        setPage(1);
        setPages(res.pages);
      })
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [params]);

  const more = async () => {
    const res = await teachers.search({...params, page: page + 1});
    setItems((current) => [...(current ?? []), ...res.items]);
    setPage(res.page);
    setPages(res.pages);
  };

  const topics = catalog?.subjects.find((s) => s.subject === subject)?.topics ?? [];
  const activeFilters = [minRating > 0, minExperience > 0, !!format, !!language, sort !== 'relevance'].filter(Boolean).length;
  const browsing = !query && !subject && !topic && !verified && !available && activeFilters === 0;
  const openGroups = (groups ?? []).filter((g) => !g.is_member).slice(0, 4);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(term.trim());
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="pro-search min-w-0">
          <Search />
          <input id="t-search" className="pro-input w-full" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Try “calculus”, “organic chemistry” or a teacher's name" aria-label="Search teachers" enterKeyHint="search" />
        </label>
        <button type="submit" className="pro-btn pro-btn-primary max-sm:hidden">
          Search
        </button>
      </form>

      {catalog && catalog.popular.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-2" aria-label="Popular topics">
          {catalog.popular.map((name) => (
            <button
              key={name}
              type="button"
              className="t-chip-btn"
              aria-pressed={query.toLowerCase() === name.toLowerCase()}
              onClick={() => {
                const next = query.toLowerCase() === name.toLowerCase() ? '' : name;
                setTerm(next);
                setQuery(next);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
        <select className="pro-input min-w-0 md:w-48" value={subject} onChange={(e) => (setSubject(e.target.value), setTopic(''))} aria-label="Subject">
          <option value="">All subjects</option>
          {catalog?.subjects.map((s) => (
            <option key={s.subject} value={s.subject}>
              {s.subject}
            </option>
          ))}
        </select>
        <select className="pro-input min-w-0 md:w-48" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" disabled={!subject}>
          <option value="">{subject ? 'All topics' : 'Pick a subject first'}</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" className="t-chip-btn justify-center" aria-pressed={verified} onClick={() => setVerified((v) => !v)}>
          <ShieldCheck className="size-4" /> Verified
        </button>
        <button type="button" className="t-chip-btn justify-center" aria-pressed={available} onClick={() => setAvailable((v) => !v)}>
          <Clock className="size-4" /> Available now
        </button>
        <button type="button" className="t-chip-btn col-span-2 justify-center md:col-span-1" aria-pressed={activeFilters > 0} onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="size-4" /> More filters{activeFilters ? ` · ${activeFilters}` : ''}
        </button>
      </div>

      <SubjectGrid catalog={catalog} active={subject} onPick={(next) => (setSubject(next), setTopic(''))} />

      <SectionHead
        icon={browsing ? <Star /> : <Search />}
        title={browsing ? 'Featured teachers' : 'Results'}
        sub={items === null ? 'Searching…' : `${total} teacher${total === 1 ? '' : 's'}${query ? ` for “${query}”` : subject ? ` in ${topic || subject}` : ''}`}
        action={
          !browsing ? (
            <button
              type="button"
              className="pro-btn pro-btn-ghost pro-btn-sm"
              onClick={() => {
                setTerm('');
                setQuery('');
                setSubject('');
                setTopic('');
                setVerified(false);
                setAvailable(false);
                setMinRating(0);
                setMinExperience(0);
                setFormat('');
                setLanguage('');
                setSort('relevance');
              }}
            >
              Clear all
            </button>
          ) : undefined
        }
      />

      {items === null && <LoadingRows rows={3} />}
      {items && items.length === 0 && (
        <div className="pro-card">
          <Empty
            icon={<Search className="size-6" />}
            hue="blue"
            title="No teachers match yet"
            body={catalog?.teacher_count ? 'Try a broader topic or clear a filter.' : 'Teachers are joining the network. Check back soon — or apply to teach yourself from Teacher Studio.'}
          />
        </div>
      )}
      {items && items.length > 0 && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {items.map((t) => (
            <TeacherCardView key={t.id} teacher={t} onOpen={() => onOpen(t.id)} onRequest={() => setRequestFor(t)} />
          ))}
        </div>
      )}
      {items && page < pages && (
        <button type="button" className="pro-btn justify-self-center" onClick={() => void more()}>
          Show more teachers
        </button>
      )}

      {browsing && <HowItWorks />}

      {browsing && openGroups.length > 0 && (
        <section className="grid min-w-0 gap-3">
          <SectionHead
            icon={<Users />}
            title="Open study groups"
            sub="Small groups led by teachers — learn alongside other students"
            action={
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={onGroups}>
                See all <ChevronRight className="size-4" />
              </button>
            }
          />
          <div className="grid min-w-0 gap-2 md:grid-cols-2">
            {openGroups.map((g) => (
              <GroupRow key={g.id} group={g} onChanged={onReloadGroups} />
            ))}
          </div>
        </section>
      )}

      {browsing && <TeachCta />}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        icon={<SlidersHorizontal />}
        title="Filters"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="pro-btn"
              onClick={() => {
                setMinRating(0);
                setMinExperience(0);
                setFormat('');
                setLanguage('');
                setSort('relevance');
              }}
            >
              Reset
            </button>
            <button type="button" className="pro-btn pro-btn-primary" onClick={() => setFiltersOpen(false)}>
              Show results
            </button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Minimum rating">
            <select className="pro-input" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
              <option value={0}>Any rating</option>
              <option value={3}>3.0+</option>
              <option value={4}>4.0+</option>
              <option value={4.5}>4.5+</option>
            </select>
          </Field>
          <Field label="Experience">
            <select className="pro-input" value={minExperience} onChange={(e) => setMinExperience(Number(e.target.value))}>
              <option value={0}>Any</option>
              <option value={2}>2+ years</option>
              <option value={5}>5+ years</option>
              <option value={10}>10+ years</option>
            </select>
          </Field>
          <Field label="Teaching format">
            <select className="pro-input" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Any</option>
              <option value="one">One-on-one</option>
              <option value="group">Group</option>
            </select>
          </Field>
          <Field label="Language">
            <select className="pro-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Any</option>
              {catalog?.languages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Sort by">
            <select className="pro-input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Best match</option>
              <option value="rating">Highest rated</option>
              <option value="experience">Most experienced</option>
              <option value="students">Most students</option>
              <option value="newest">Newest</option>
            </select>
          </Field>
        </div>
      </Sheet>

      <RequestSheet teacher={requestFor} onClose={() => setRequestFor(null)} onSent={() => setRequestFor(null)} />
    </div>
  );
}

function TeacherCardView({teacher: t, onOpen, onRequest}: {teacher: TeacherCard; onOpen: () => void; onRequest: () => void}) {
  const main = subjectLook(t.specialties[0]?.subject);
  const chips = t.specialties.flatMap((sp) => (sp.topics.length ? sp.topics.map((topic) => [sp.subject, topic] as const) : [[sp.subject, sp.subject] as const]));
  const avail = t.availability_now;
  return (
    <article className="pro-card t-tcard pro-lift">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Open ${t.name}'s profile`}>
        <Cover deg={main.deg} deg2={(t.avatar_hue + 40) % 360} icon={main.Icon} height={84}>
          <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
            <span className="t-glass" data-state={avail}>
              <i /> {avail === 'available' ? 'Available now' : avail === 'busy' ? 'Busy today' : t.accepting ? 'Accepting students' : 'Not accepting'}
            </span>
            {t.stats.review_count > 0 && (
              <span className="t-glass">
                <Star style={{color: '#ffcf5c', fill: '#ffcf5c'}} /> {t.stats.rating.toFixed(1)} <span className="opacity-70">({t.stats.review_count})</span>
              </span>
            )}
          </div>
        </Cover>
        <div className="t-tcard-id">
          <PersonAvatar id={t.student_id} name={t.full_name || t.name} hue={t.avatar_hue} hasPhoto={t.has_photo} size={68} ring={t.verified ? 'brand' : 'hue'} verified={t.verified} />
          <div className="min-w-0 flex-1 pt-8">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="pro-h3 truncate">{t.name}</span>
              {t.verified && <VerifiedMark size={15} />}
            </span>
            <span className="pro-meta block truncate">{[t.institution, t.languages.slice(0, 2).join(' · ')].filter(Boolean).join(' — ') || 'Teacher on Genesis'}</span>
          </div>
        </div>
      </button>
      <div className="grid min-w-0 gap-3 px-4 pb-4">
        <p className="pro-secondary line-clamp-2 min-h-[2.6em] [overflow-wrap:anywhere]">{t.headline || 'Teacher on Genesis'}</p>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {chips.slice(0, 3).map(([subject, topic]) => (
            <SubjectChip key={subject + topic} subject={subject} label={topic} size="sm" />
          ))}
          {chips.length > 3 && <span className="t-topic">+{chips.length - 3}</span>}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <MiniStat icon={<Users />} value={t.stats.students_taught} label="students" hue="blue" />
          <MiniStat icon={<Briefcase />} value={t.experience_years ? `${t.experience_years}y` : '—'} label="experience" hue="violet" />
          <MiniStat icon={<Zap />} value={shortReply(t.stats.response_hours)} label="reply time" hue="green" />
        </div>
        <BadgeRow badges={t.badges.filter((b) => b.key !== 'verified')} max={2} compact />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
          <button type="button" className="pro-btn" onClick={onOpen}>
            Profile
          </button>
          <button type="button" className="pro-btn pro-btn-primary" onClick={onRequest} disabled={!t.accepting}>
            <UserPlus className="size-4" /> {t.accepting ? 'Request help' : 'Not accepting'}
          </button>
        </div>
      </div>
    </article>
  );
}

/** Compact reply time for small tiles: New, <1h, 5h, 2d. */
function shortReply(hours: number | null): string {
  if (hours == null) return 'New';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function MiniStat({icon, value, label, hue}: {icon: React.ReactNode; value: React.ReactNode; label: string; hue: HueName}) {
  return (
    <span className="t-mini" data-hue={hue}>
      {icon}
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}

/* --------------------------------------------------------------- request */
function RequestSheet({teacher, onClose, onSent}: {teacher: {id: number; name: string; specialties: {subject: string; topics: string[]}[]} | null; onClose: () => void; onSent: (request: TRequest) => void}) {
  const {toast} = useSession();
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [format, setFormat] = useState<'one' | 'group' | 'either'>('either');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!teacher) return;
    const first = teacher.specialties[0];
    setSubject(first?.subject ?? '');
    setTopic(first?.topics[0] ?? '');
    setMessage('');
    setFormat('either');
    setTime('');
  }, [teacher]);
  const topics = teacher?.specialties.find((s) => s.subject === subject)?.topics ?? [];
  const send = async () => {
    if (!teacher) return;
    setBusy(true);
    try {
      const req = await teachers.request(teacher.id, {subject, topic, message, format, preferred_time: time});
      toast('success', 'Request sent', `${teacher.name} will reply soon. You can message them while you wait.`);
      onSent(req);
    } catch (e) {
      toast('error', 'Could not send request', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={teacher !== null}
      onClose={onClose}
      icon={<UserPlus />}
      title={`Request help from ${teacher?.name ?? ''}`}
      subtitle="Be specific — teachers accept clear requests faster."
      footer={
        <>
          <button type="button" className="pro-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void send()} disabled={busy || message.trim().length < 10}>
            {busy && <Loader2 className="size-4 animate-spin" />} Send request
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject">
            <select className="pro-input" value={subject} onChange={(e) => (setSubject(e.target.value), setTopic(teacher?.specialties.find((s) => s.subject === e.target.value)?.topics[0] ?? ''))}>
              {teacher?.specialties.map((s) => (
                <option key={s.subject}>{s.subject}</option>
              ))}
            </select>
          </Field>
          <Field label="Topic">
            <select className="pro-input" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {topics.map((t) => (
                <option key={t}>{t}</option>
              ))}
              {topics.length === 0 && <option value="">General</option>}
            </select>
          </Field>
        </div>
        <Field label="What do you need help with?" hint={`${message.trim().length}/1500 · at least 10 characters`}>
          <textarea className="pro-input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500} placeholder="e.g. I understand limits but get stuck on the chain rule. My exam is in three weeks." />
        </Field>
        <Field label="Format" group>
          <div className="pro-seg pro-seg-fill" role="radiogroup" aria-label="Format">
            {(['one', 'group', 'either'] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} className="pro-seg-item" onClick={() => setFormat(f)}>
                {f === 'one' ? 'One-on-one' : f === 'group' ? 'Group' : 'Either'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Preferred time (optional)">
          <input className="pro-input" value={time} onChange={(e) => setTime(e.target.value)} maxLength={160} placeholder="e.g. Weekday evenings after 6pm" />
        </Field>
        <p className="pro-meta inline-flex items-start gap-1.5">
          <Lock className="mt-0.5 size-3.5 shrink-0" /> Your phone number is never shared. Keep conversations on Genesis.
        </p>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- profile */
function TeacherProfile({id, onBack, onChanged, onOpenMaterial, onOpenQuiz}: {id: number; onBack: () => void; onChanged: () => void; onOpenMaterial: (id: number) => void; onOpenQuiz: (id: number) => void}) {
  const {toast} = useSession();
  const [teacher, setTeacher] = useState<TeacherDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [report, setReport] = useState<{kind: string; id: number; label: string} | null>(null);

  const load = useCallback(() => {
    teachers
      .detail(id)
      .then(setTeacher)
      .catch((e) => setError(errText(e)));
  }, [id]);
  useEffect(load, [load]);

  if (error)
    return (
      <div className="pro-card">
        <Empty title="Teacher unavailable" body={error} action={<button type="button" className="pro-btn" onClick={onBack}>Back</button>} />
      </div>
    );
  if (!teacher) return <LoadingRows rows={5} />;
  const t = teacher;
  const s = t.stats;

  const cancel = async () => {
    if (!t.pending_request) return;
    try {
      await teachers.cancelRequest(t.pending_request.id);
      toast('info', 'Request cancelled');
      load();
      onChanged();
    } catch (e) {
      toast('error', 'Could not cancel', errText(e));
    }
  };
  const block = async () => {
    if (!window.confirm(`Block ${t.name}? They won't be able to message you and you won't see them in search.`)) return;
    await teachers.block(t.student_id);
    toast('info', 'Blocked', 'You can unblock from Messages → Blocked.');
    onChanged();
    onBack();
  };
  const maxDist = Math.max(1, ...Object.values(t.rating_distribution));

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm justify-self-start" onClick={onBack}>
        <ArrowLeft className="size-4" /> All teachers
      </button>

      <section className="pro-card t-profile-hero">
        <Cover deg={subjectLook(t.specialties[0]?.subject).deg} deg2={(t.avatar_hue + 40) % 360} icon={subjectLook(t.specialties[0]?.subject).Icon} height={128} className="t-profile-cover">
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <span className="t-glass" data-state={t.availability_now}>
              <i /> {t.availability_now === 'available' ? 'Available now' : t.availability_now === 'busy' ? 'Busy today' : t.accepting ? 'Accepting students' : 'Not accepting'}
            </span>
            <ActionMenu
              label="More actions"
              triggerClassName="t-glass !p-2"
              icon={<MoreHorizontal />}
              items={[
                {key: 'report', label: 'Report teacher', detail: 'Staff review it privately', icon: <Flag />, onSelect: () => setReport({kind: 'teacher', id: t.id, label: t.name})},
                {key: 'block', label: 'Block', detail: 'No messages, off your search', icon: <Lock />, danger: true, onSelect: () => void block()},
              ]}
            />
          </div>
        </Cover>
        <div className="t-profile-body">
          <div className="t-profile-id">
            <PersonAvatar id={t.student_id} name={t.full_name || t.name} hue={t.avatar_hue} hasPhoto={t.has_photo} size={typeof window !== 'undefined' && window.innerWidth < 640 ? 88 : 112} ring={t.verified ? 'brand' : 'hue'} verified={t.verified} />
            <div className="min-w-0 flex-1 pt-[50px] sm:pt-[66px]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="pro-h1 [overflow-wrap:anywhere] max-sm:!text-[1.6rem] md:!text-[2rem]">{t.name}</h1>
                {t.verified && (
                  <span className="pro-badge" data-tone="accent">
                    <ShieldCheck className="size-3" /> Verified
                  </span>
                )}
              </div>
              <p className="pro-body mt-1 [overflow-wrap:anywhere]" style={{color: 'var(--pro-text-2)'}}>
                {t.headline}
              </p>
            </div>
          </div>
          <div className="t-stat-line">
            {t.institution && (
              <span>
                <MapPin /> {t.institution}
              </span>
            )}
            {t.languages.length > 0 && (
              <span>
                <Languages /> {t.languages.join(', ')}
              </span>
            )}
            <span>
              <Users /> {FORMAT_LABEL[t.formats]}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {t.specialties.flatMap((sp) => (sp.topics.length ? sp.topics : [sp.subject]).map((topic) => <SubjectChip key={sp.subject + topic} subject={sp.subject} label={topic} />))}
          </div>
          <BadgeRow badges={t.badges.filter((b) => b.key !== 'verified')} />
          {!t.is_me && (
            <div className="flex flex-wrap gap-2">
              {t.relationship && t.relationship.status === 'active' ? (
                <button type="button" className="pro-btn pro-btn-primary" onClick={() => goTo({tab: 'messages', withId: t.student_id})}>
                  <MessageSquare className="size-4" /> Message
                </button>
              ) : t.pending_request ? (
                <>
                  <button type="button" className="pro-btn pro-btn-primary" onClick={() => goTo({tab: 'messages', withId: t.student_id})}>
                    <MessageSquare className="size-4" /> Message
                  </button>
                  <button type="button" className="pro-btn" onClick={() => void cancel()}>
                    Cancel request
                  </button>
                  <span className="pro-meta self-center">Request sent {timeAgo(t.pending_request.created_at)}</span>
                </>
              ) : (
                <button type="button" className="pro-btn pro-btn-primary" disabled={!t.accepting} onClick={() => setRequesting(true)}>
                  <UserPlus className="size-4" /> {t.accepting ? (t.relationship ? 'Request again' : 'Request help') : 'Not accepting students'}
                </button>
              )}
              {t.relationship?.status === 'completed' && (
                <button type="button" className="pro-btn" onClick={() => goTo({tab: 'messages', withId: t.student_id})}>
                  <MessageSquare className="size-4" /> Message
                </button>
              )}
              {t.can_review && (
                <button type="button" className="pro-btn" onClick={() => setReviewing(true)}>
                  <Star className="size-4" /> Write a review
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section aria-label="Reputation" className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile hue="amber" icon={<Star />} label={s.review_count ? `${s.review_count} review${s.review_count === 1 ? '' : 's'}` : 'No reviews yet'} value={s.review_count ? s.rating.toFixed(1) : '—'} />
        <StatTile hue="blue" icon={<Users />} label="students taught" value={s.students_taught} sub={`${s.active_students} active now`} />
        <StatTile hue="green" icon={<CheckCircle2 />} label="answered" value={s.response_rate === null ? '—' : `${s.response_rate}%`} />
        <StatTile hue="teal" icon={<Zap />} label="typical reply" value={responseLabel(s.response_hours)} />
        <StatTile hue="violet" icon={<Award />} label="years teaching" value={t.experience_years || '—'} />
        <StatTile hue="rose" icon={<TrendingUp />} label="quiz attempts" value={s.quiz_attempts} />
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          <section className="pro-card grid gap-3 p-4 md:p-5">
            <h2 className="pro-h3">About</h2>
            <p className="pro-body whitespace-pre-wrap [overflow-wrap:anywhere]">{t.bio}</p>
            {t.experience && (
              <>
                <h3 className="pro-eyebrow mt-2">Teaching experience</h3>
                <p className="pro-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">{t.experience}</p>
              </>
            )}
          </section>

          {(t.materials.length > 0 || t.quizzes.length > 0) && (
            <section className="pro-card grid gap-1 p-2">
              <h2 className="pro-h3 px-3 pt-2 pb-1">Free resources</h2>
              <div className="pro-rows">
                {t.materials.map((m) => (
                  <button key={`m${m.id}`} type="button" className="t-row t-row-btn rounded-xl" onClick={() => onOpenMaterial(m.id)}>
                    <span className="t-attach-icon">
                      <FileText />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{m.title}</span>
                      <span className="pro-meta block truncate">{m.topic || m.subject || 'Material'}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
                  </button>
                ))}
                {t.quizzes.map((q) => (
                  <button key={`q${q.id}`} type="button" className="t-row t-row-btn rounded-xl" onClick={() => onOpenQuiz(q.id)}>
                    <span className="t-attach-icon" style={{['--mark' as string]: 'var(--pro-h-green)'}}>
                      <ListChecks />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{q.title}</span>
                      <span className="pro-meta block truncate">
                        {q.question_count} questions{q.my_best != null ? ` · your best ${q.my_best}%` : ''}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="pro-card grid gap-4 p-4 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="pro-h3">Reviews</h2>
              {t.my_review && <span className="pro-meta">You reviewed this teacher</span>}
            </div>
            {s.review_count > 0 && (
              <div className="grid gap-1.5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div key={n} className="t-dist">
                    <span>{n} ★</span>
                    <div>
                      <i style={{width: `${((t.rating_distribution[String(n)] ?? 0) / maxDist) * 100}%`}} />
                    </div>
                    <span className="text-right">{t.rating_distribution[String(n)] ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
            {t.reviews.length === 0 && <p className="pro-secondary">No reviews yet. Reviews come only from students who completed lessons with this teacher.</p>}
            <div className="grid gap-3">
              {t.reviews.map((r) => (
                <article key={r.id} className="t-review">
                  <Quote className="t-review-quote" aria-hidden />
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PersonAvatar id={r.anonymous ? null : r.author_id} name={r.anonymous ? '?' : r.author} hue={r.anonymous ? 230 : hueOf(r.author)} size={36} ring="hue" />
                      <span className="grid min-w-0">
                        <span className="truncate text-[0.85rem] font-semibold">{r.anonymous ? 'Anonymous student' : r.author}</span>
                        <Stars value={r.rating} size={12} />
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="pro-meta">{timeAgo(r.created_at)}</span>
                      {!r.is_mine && (
                        <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm pro-btn-icon" aria-label="Report review" title="Report review" onClick={() => setReport({kind: 'teacher_review', id: r.id, label: `Review by ${r.author}`})}>
                          <Flag className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                  {r.body && <p className="pro-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">{r.body}</p>}
                  {r.teacher_response && (
                    <div className="t-review-reply">
                      <PersonAvatar id={t.student_id} name={t.full_name || t.name} hue={t.avatar_hue} hasPhoto={t.has_photo} size={26} ring="brand" />
                      <div className="min-w-0">
                        <p className="pro-eyebrow">{t.name} replied</p>
                        <p className="pro-secondary [overflow-wrap:anywhere]">{r.teacher_response}</p>
                      </div>
                    </div>
                  )}
                  {r.is_mine && r.editable && (
                    <button type="button" className="pro-btn pro-btn-sm justify-self-start" onClick={() => setReviewing(true)}>
                      Edit review
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="grid min-w-0 content-start gap-5">
          <section className="pro-card grid gap-3 p-4">
            <h2 className="pro-h3">Teaches</h2>
            {t.specialties.map((sp) => (
              <div key={sp.subject} className="grid gap-1.5">
                <p className="pro-eyebrow">{sp.subject}</p>
                <div className="flex flex-wrap gap-1.5">
                  {sp.topics.map((topic) => (
                    <span key={topic} className="t-topic">
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
          {t.qualifications.length > 0 && (
            <section className="pro-card grid gap-2 p-4">
              <h2 className="pro-h3">Qualifications</h2>
              {t.qualifications.map((q) => (
                <div key={q.id} className="flex items-start gap-2">
                  {q.verified ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{color: 'var(--pro-success)'}} /> : <BookOpen className="mt-0.5 size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />}
                  <span className="min-w-0">
                    <span className="block text-[0.86rem] font-semibold [overflow-wrap:anywhere]">{q.title}</span>
                    <span className="pro-meta">
                      {[q.institution, q.year].filter(Boolean).join(' · ')}
                      {q.verified ? ' · checked by staff' : ''}
                    </span>
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="pro-card grid gap-3 p-4">
            <h2 className="pro-h3">Weekly availability</h2>
            {t.availability.length === 0 ? (
              <p className="pro-secondary">Flexible — mention a time in your request.</p>
            ) : (
              <div className="t-week">
                {DAYS.map((d, i) => {
                  const slots = t.availability.filter((slot) => slot.day === i);
                  return (
                    <div key={d}>
                      <b>{d}</b>
                      {slots.length ? slots.map((slot) => <span key={slot.start} title={`${slot.start}–${slot.end}`}>{slot.start}</span>) : <em>—</em>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          {t.groups.length > 0 && (
            <section className="pro-card grid gap-2 p-4">
              <h2 className="pro-h3">Study groups</h2>
              {t.groups.map((g) => (
                <GroupRow key={g.id} group={g} onChanged={load} />
              ))}
            </section>
          )}
        </aside>
      </div>

      <RequestSheet
        teacher={requesting ? t : null}
        onClose={() => setRequesting(false)}
        onSent={() => {
          setRequesting(false);
          load();
          onChanged();
        }}
      />
      <ReviewSheet
        open={reviewing}
        teacherId={t.id}
        teacherName={t.name}
        existing={t.my_review}
        onClose={() => setReviewing(false)}
        onDone={() => {
          setReviewing(false);
          load();
          onChanged();
        }}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </div>
  );
}

function ReviewSheet({open, teacherId, teacherName, existing, onClose, onDone}: {open: boolean; teacherId: number; teacherName: string; existing: TeacherDetail['my_review']; onClose: () => void; onDone: () => void}) {
  const {toast} = useSession();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRating(existing?.rating ?? 5);
    setBody(existing?.body ?? '');
    setAnonymous(existing?.anonymous ?? true);
  }, [open, existing]);
  const save = async () => {
    setBusy(true);
    try {
      if (existing) await teachers.editReview(existing.id, {rating, body, anonymous});
      else await teachers.review(teacherId, {rating, body, anonymous});
      toast('success', existing ? 'Review updated' : 'Thanks for your review', 'It helps other students choose well.');
      onDone();
    } catch (e) {
      toast('error', 'Could not save review', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={<Star />}
      title={existing ? 'Edit your review' : `Review ${teacherName}`}
      subtitle="Only students who completed lessons can review. You can edit within 7 days."
      footer={
        <>
          <button type="button" className="pro-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void save()} disabled={busy}>
            {existing ? 'Save changes' : 'Post review'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <StarInput value={rating} onChange={setRating} />
        <Field label="Your experience (optional)">
          <textarea className="pro-input" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="What did they explain well? How did your results change?" />
        </Field>
        <Toggle checked={anonymous} onChange={setAnonymous} label="Post anonymously" />
        <p className="pro-meta">{anonymous ? 'Your name is hidden from everyone except Genesis staff.' : 'Your first name and initial will be shown.'}</p>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ my teachers */
function MyTeachers({learning, onOpen, onReload, onOpenMaterial, onOpenQuiz, onFind}: {learning: Learning | null; onOpen: (id: number) => void; onReload: () => void; onOpenMaterial: (id: number) => void; onOpenQuiz: (id: number) => void; onFind: () => void}) {
  const {toast} = useSession();
  if (!learning) return <LoadingRows rows={3} />;
  const complete = async (relationshipId: number, name: string) => {
    if (!window.confirm(`Mark your lessons with ${name} as complete? You'll be able to leave a review and still message them.`)) return;
    try {
      await teachers.completeRelationship(relationshipId);
      toast('success', 'Marked complete', 'You can now leave a review.');
      onReload();
    } catch (e) {
      toast('error', 'Could not update', errText(e));
    }
  };
  const live = learning.teachers.filter((row) => row.relationship.status !== 'ended');
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      {live.length === 0 ? (
        <div className="pro-card">
          <Empty
            icon={<GraduationCap className="size-6" />}
            hue="blue"
            title="No teachers yet"
            body="When a teacher accepts your request they appear here, with everything they share with you."
            action={
              <button type="button" className="pro-btn pro-btn-primary" onClick={onFind}>
                Find a teacher
              </button>
            }
          />
        </div>
      ) : null}
      {live.length === 0 ? (
        <HowItWorks />
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {live.map(({relationship: rel, teacher: t, can_review}) => (
            <article key={rel.id} className="pro-card t-tcard">
              <Cover deg={subjectLook(rel.subject).deg} deg2={(t.avatar_hue + 40) % 360} icon={subjectLook(rel.subject).Icon} height={56}>
                <div className="absolute top-2.5 right-3">
                  <StatusPill status={rel.status} />
                </div>
              </Cover>
              <div className="grid min-w-0 gap-3 px-4 pb-4">
              <div className="-mt-7 flex min-w-0 items-start gap-3">
                <PersonAvatar id={t.student_id} name={t.full_name || t.name} hue={t.avatar_hue} hasPhoto={t.has_photo} size={60} ring={t.verified ? 'brand' : 'hue'} verified={t.verified} />
                <div className="min-w-0 flex-1 pt-[32px]">
                  <p className="flex items-center gap-1.5">
                    <span className="pro-h3 truncate">{t.name}</span>
                    {t.verified && <VerifiedMark size={15} />}
                  </p>
                  <p className="pro-meta truncate">
                    {[rel.topic || rel.subject, `since ${new Date(rel.started_at).toLocaleDateString(undefined, {month: 'short', year: 'numeric'})}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => goTo({tab: 'messages', withId: t.student_id})}>
                  <MessageSquare className="size-4" /> Message
                </button>
                <button type="button" className="pro-btn pro-btn-sm" onClick={() => onOpen(t.id)}>
                  Profile
                </button>
                {rel.status === 'active' && (
                  <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => void complete(rel.id, t.name)}>
                    <CheckCircle2 className="size-4" /> Mark complete
                  </button>
                )}
                {can_review && (
                  <button type="button" className="pro-btn pro-btn-sm" onClick={() => onOpen(t.id)}>
                    <Star className="size-4" /> Review
                  </button>
                )}
              </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {(learning.materials.length > 0 || learning.quizzes.length > 0) && (
        <section className="grid min-w-0 gap-3">
          <h2 className="pro-h3">From your teachers</h2>
          <div className="pro-card pro-rows overflow-hidden">
            {learning.quizzes.map((q) => (
              <button key={`q${q.id}`} type="button" className="t-row t-row-btn" onClick={() => onOpenQuiz(q.id)}>
                <span className="t-attach-icon" style={{['--mark' as string]: 'var(--pro-h-green)'}}>
                  <ListChecks />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{q.title}</span>
                  <span className="pro-meta block truncate">
                    Quiz · {q.teacher_name} · {q.question_count} questions{q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''}
                  </span>
                </span>
                {q.my_best != null ? <span className="pro-badge" data-tone={q.my_best >= q.pass_mark ? 'success' : 'warning'}>{q.my_best}%</span> : <span className="pro-badge" data-tone="accent">New</span>}
              </button>
            ))}
            {learning.materials.map((m) => (
              <button key={`m${m.id}`} type="button" className="t-row t-row-btn" onClick={() => onOpenMaterial(m.id)}>
                <span className="t-attach-icon">
                  <FileText />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.title}</span>
                  <span className="pro-meta block truncate">
                    {m.kind === 'file' ? 'Document' : m.kind === 'link' ? 'Link' : 'Notes'} · {m.teacher_name}
                    {m.group ? ` · ${m.group.name}` : ''}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- requests */
function MyRequests({learning, onOpen, onReload, onFind}: {learning: Learning | null; onOpen: (id: number) => void; onReload: () => void; onFind: () => void}) {
  const {toast} = useSession();
  if (!learning) return <LoadingRows rows={3} />;
  if (learning.requests.length === 0)
    return (
      <div className="pro-card">
        <Empty icon={<Inbox className="size-6" />} hue="amber" title="No requests yet" body="Send a request from a teacher's profile. Pending requests expire after 14 days." action={<button type="button" className="pro-btn pro-btn-primary" onClick={onFind}>Find a teacher</button>} />
      </div>
    );
  const cancel = async (id: number) => {
    try {
      await teachers.cancelRequest(id);
      toast('info', 'Request cancelled');
      onReload();
    } catch (e) {
      toast('error', 'Could not cancel', errText(e));
    }
  };
  return (
    <div className="pro-card pro-rows overflow-hidden">
      {learning.requests.map((r) => (
        <div key={r.id} className="grid min-w-0 gap-2.5 p-4">
          <div className="flex min-w-0 items-center gap-3">
            {r.teacher && <PersonAvatar id={r.teacher.student_id} name={r.teacher.name} hue={r.teacher.avatar_hue} hasPhoto={r.teacher.has_photo} size={44} ring={r.teacher.verified ? 'brand' : 'hue'} />}
            <div className="min-w-0 flex-1">
              <button type="button" className="flex items-center gap-1.5 text-left" onClick={() => r.teacher && onOpen(r.teacher.id)}>
                <span className="truncate font-semibold">{r.teacher?.name ?? 'Teacher'}</span>
                {r.teacher?.verified && <VerifiedMark size={14} />}
              </button>
              <p className="pro-meta truncate">
                {[FORMAT_LABEL[r.format], timeAgo(r.created_at)].filter(Boolean).join(' · ')}
              </p>
            </div>
            <StatusPill status={r.status} />
          </div>
          {r.subject && <SubjectChip subject={r.subject} label={r.topic || r.subject} size="sm" />}
          <p className="t-quote line-clamp-3">{r.message}</p>
          {r.response_note && (
            <p className="pro-secondary border-l-2 pl-3 [overflow-wrap:anywhere]" style={{borderColor: 'var(--pro-accent)'}}>
              {r.response_note}
            </p>
          )}
          {r.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              {r.teacher && (
                <button type="button" className="pro-btn pro-btn-sm" onClick={() => goTo({tab: 'messages', withId: r.teacher!.student_id})}>
                  <MessageSquare className="size-4" /> Message
                </button>
              )}
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => void cancel(r.id)}>
                Cancel
              </button>
            </div>
          )}
          {r.status === 'accepted' && r.teacher && (
            <button type="button" className="pro-btn pro-btn-primary pro-btn-sm justify-self-start" onClick={() => goTo({tab: 'messages', withId: r.teacher!.student_id})}>
              <MessageSquare className="size-4" /> Start chatting
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- groups */
function GroupRow({group: g, onChanged}: {group: TGroup; onChanged: () => void}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try {
      const next = await teachers.joinGroup(g.id);
      toast('success', next.is_member ? `Joined ${g.name}` : 'Request sent', next.is_member ? 'Open it any time from Groups.' : 'The teacher will approve your request.');
      onChanged();
    } catch (e) {
      toast('error', 'Could not join', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    await teachers.cancelGroupJoin(g.id);
    onChanged();
  };
  return (
    <div className="t-group-row">
      <GroupMark subject={g.subject} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9rem] font-semibold">{g.name}</span>
        <span className="pro-meta flex min-w-0 items-center gap-1.5">
          <span className="truncate">{[g.topic || g.subject, g.teacher?.name].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <span className="t-capacity" title={`${g.members} members`}>
            <i style={{width: `${g.capacity ? Math.min(100, (g.members / g.capacity) * 100) : 30}%`}} />
          </span>
          <span className="pro-meta whitespace-nowrap">
            {g.members}
            {g.capacity ? `/${g.capacity}` : ''} · {g.privacy === 'request' ? 'Approval' : g.privacy === 'invite' ? 'Invite only' : 'Open'}
          </span>
        </span>
      </span>
      {g.is_member ? (
        <button type="button" className="pro-btn pro-btn-sm" onClick={() => goTo({groupId: g.id})}>
          Open
        </button>
      ) : g.request_pending ? (
        <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm" onClick={() => void cancel()} title="Cancel request">
          Requested
        </button>
      ) : (
        <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" disabled={busy || g.full || g.privacy === 'invite'} onClick={() => void join()}>
          {g.full ? 'Full' : g.privacy === 'request' ? 'Ask to join' : 'Join'}
        </button>
      )}
    </div>
  );
}

function GroupMark({subject}: {subject?: string}) {
  const look = subjectLook(subject);
  return (
    <span className="t-group-mark" style={{['--deg' as string]: String(look.deg)}}>
      <look.Icon />
    </span>
  );
}

function TeacherGroups({mine, onReload}: {mine: TGroup[]; onReload: () => void}) {
  const [items, setItems] = useState<TGroup[] | null>(null);
  const [term, setTerm] = useState('');
  const load = useCallback(() => {
    teachers
      .discoverGroups(term)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [term]);
  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);
  const refresh = () => {
    load();
    onReload();
  };
  const discover = (items ?? []).filter((g) => !g.is_member);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      {mine.length > 0 && (
        <section className="grid gap-2">
          <h2 className="pro-h3">Your teacher groups</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {mine.map((g) => (
              <GroupRow key={g.id} group={g} onChanged={refresh} />
            ))}
          </div>
        </section>
      )}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="pro-h3">Discover groups</h2>
        </div>
        <label className="pro-search min-w-0">
          <Search />
          <input className="pro-input w-full" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by topic or group name" aria-label="Search groups" />
        </label>
        {items === null ? (
          <LoadingRows rows={3} />
        ) : discover.length === 0 ? (
          <div className="pro-card">
            <Empty icon={<Users className="size-6" />} hue="teal" title="No open groups right now" body="Teachers create topic groups for focused study. Invite-only groups are joined through your teacher." />
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {discover.map((g) => (
              <div key={g.id} className="grid gap-1">
                <GroupRow group={g} onChanged={refresh} />
                {g.teacher && (
                  <p className="pro-meta inline-flex items-center gap-1 pl-2.5">
                    Led by {g.teacher.name} {g.teacher.verified && <VerifiedMark size={12} />}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
