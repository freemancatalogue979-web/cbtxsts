/** Teacher application wizard + the same editor for approved teachers' profiles. */
import {ArrowLeft, ArrowRight, BadgeCheck, BookOpen, CalendarClock, CheckCircle2, Clock, FileText, GraduationCap, Hourglass, Loader2, Plus, Save, ScrollText, Send, ShieldAlert, Sparkles, Trash2, Upload, UserRound, Users, XCircle} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {ApiError} from '../lib/api';
import {DAYS, fileUrl, teachers, type Catalog, type MyProfile, type Slot, type Specialty} from '../lib/teachers';
import {LoadingRows} from '../pro/ui';
import {useSession} from '../store/session';
import {Field, Toggle, timeAgo} from './ui';

const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

type Draft = {
  headline: string;
  bio: string;
  experience_years: number;
  experience: string;
  institution: string;
  languages: string[];
  formats: 'one' | 'group' | 'both';
  availability: Slot[];
  accepting: boolean;
  specialties: Specialty[];
};

const emptyDraft: Draft = {headline: '', bio: '', experience_years: 0, experience: '', institution: '', languages: ['English'], formats: 'both', availability: [], accepting: true, specialties: []};

function toDraft(p: MyProfile | null): Draft {
  if (!p) return emptyDraft;
  return {
    headline: p.headline,
    bio: p.bio,
    experience_years: p.experience_years,
    experience: p.experience,
    institution: p.institution,
    languages: p.languages.length ? p.languages : ['English'],
    formats: p.formats,
    availability: p.availability,
    accepting: p.accepting,
    specialties: p.specialties.map((s) => ({subject: s.subject, topics: s.topics.filter(Boolean)})),
  };
}

/* ----------------------------------------------------------- status page */
export function ApplicationGate({profile, onChanged}: {profile: MyProfile | null; onChanged: (p: MyProfile | null) => void}) {
  const [editing, setEditing] = useState(!profile || profile.status === 'draft');
  if (profile && !editing) {
    if (profile.status === 'pending') return <PendingScreen profile={profile} onChanged={onChanged} onEdit={() => setEditing(true)} />;
    if (profile.status === 'needs_info' || profile.status === 'rejected') return <DecisionScreen profile={profile} onEdit={() => setEditing(true)} />;
    if (profile.status === 'suspended') return <SuspendedScreen profile={profile} />;
  }
  if (!profile && !editing) setEditing(true);
  return <ApplyWizard profile={profile} onChanged={onChanged} onSubmitted={() => setEditing(false)} />;
}

function StatusShell({icon, hue, title, body, children}: {icon: React.ReactNode; hue: string; title: string; body: React.ReactNode; children?: React.ReactNode}) {
  return (
    <div className="pro-card mx-auto grid w-full max-w-2xl gap-5 p-6 text-center md:p-8">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl" style={{color: `var(--pro-h-${hue})`, background: `var(--pro-h-${hue}-soft)`}}>
        {icon}
      </span>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <h1 className="pro-h2">{title}</h1>
        <div className="pro-secondary mx-auto max-w-lg">{body}</div>
      </div>
      {children}
    </div>
  );
}

function PendingScreen({profile, onChanged, onEdit}: {profile: MyProfile; onChanged: (p: MyProfile) => void; onEdit: () => void}) {
  const {toast} = useSession();
  const withdraw = async () => {
    if (!window.confirm('Withdraw your application? You can edit and resubmit any time.')) return;
    try {
      const res = await teachers.withdraw();
      onChanged(res.profile);
      onEdit();
    } catch (e) {
      toast('error', 'Could not withdraw', errText(e));
    }
  };
  return (
    <StatusShell icon={<Hourglass className="size-8" />} hue="amber" title="Your application is under review" body={<>Submitted {timeAgo(profile.submitted_at)}. Genesis staff check your qualifications and profile — usually within 2–3 days. We'll notify you as soon as there's a decision.</>}>
      <ol className="mx-auto grid w-full max-w-sm gap-2 text-left">
        {[
          ['Application submitted', true],
          ['Staff review', false],
          ['Teacher Studio opens', false],
        ].map(([label, done], i) => (
          <li key={String(label)} className="flex items-center gap-3 rounded-xl p-3" style={{background: 'var(--pro-hover)'}}>
            {done ? <CheckCircle2 className="size-5" style={{color: 'var(--pro-success)'}} /> : <span className="grid grid-cols-[minmax(0,1fr)] size-5 place-items-center rounded-full text-[0.7rem] font-bold" style={{border: '1.5px solid var(--pro-border-strong)', color: 'var(--pro-muted)'}}>{i + 1}</span>}
            <span className="font-semibold">{label}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="pro-btn justify-self-center" onClick={() => void withdraw()}>
        Withdraw to edit
      </button>
    </StatusShell>
  );
}

function DecisionScreen({profile, onEdit}: {profile: MyProfile; onEdit: () => void}) {
  const needsInfo = profile.status === 'needs_info';
  return (
    <StatusShell
      icon={needsInfo ? <ShieldAlert className="size-8" /> : <XCircle className="size-8" />}
      hue={needsInfo ? 'amber' : 'rose'}
      title={needsInfo ? 'We need a little more information' : "Your application wasn't approved"}
      body={needsInfo ? 'Update your application using the note from our team, then resubmit.' : 'You can improve your application and apply again.'}
    >
      {profile.staff_message && (
        <div className="rounded-xl p-4 text-left" style={{background: 'var(--pro-hover)', borderLeft: '3px solid var(--pro-warning)'}}>
          <p className="pro-eyebrow">Message from Genesis staff</p>
          <p className="pro-body mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{profile.staff_message}</p>
        </div>
      )}
      <button type="button" className="pro-btn pro-btn-primary justify-self-center" onClick={onEdit}>
        Update application
      </button>
    </StatusShell>
  );
}

function SuspendedScreen({profile}: {profile: MyProfile}) {
  return (
    <StatusShell icon={<ShieldAlert className="size-8" />} hue="rose" title="Your teacher account is suspended" body="Your profile is hidden and Teacher Studio is paused. Your students can still see the materials they already have.">
      {profile.staff_message && (
        <div className="rounded-xl p-4 text-left" style={{background: 'var(--pro-hover)'}}>
          <p className="pro-eyebrow">Reason</p>
          <p className="pro-body mt-1 [overflow-wrap:anywhere]">{profile.staff_message}</p>
        </div>
      )}
      <p className="pro-meta">Questions? Contact us from Support.</p>
    </StatusShell>
  );
}

/* ----------------------------------------------------------------- wizard */
const STEPS = ['About you', 'Subjects', 'Qualifications', 'Availability'] as const;
const STEP_META = [
  {short: 'About', icon: UserRound, blurb: 'The first thing students read about you.'},
  {short: 'Subjects', icon: BookOpen, blurb: 'Students search by topic — be specific.'},
  {short: 'Credentials', icon: ScrollText, blurb: 'Degrees and certificates staff can verify.'},
  {short: 'Schedule', icon: CalendarClock, blurb: 'When you are usually free to teach.'},
] as const;

const PERKS = [
  {icon: BadgeCheck, title: 'Verified badge', body: 'Staff check your credentials'},
  {icon: Users, title: 'Real students', body: 'Found by the topics you teach'},
  {icon: Sparkles, title: 'Your own studio', body: 'Groups, notes and quizzes'},
] as const;

function ApplyWizard({profile, onChanged, onSubmitted}: {profile: MyProfile | null; onChanged: (p: MyProfile | null) => void; onSubmitted: () => void}) {
  const {toast} = useSession();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    teachers.catalog().then(setCatalog).catch(() => {});
  }, []);

  const save = async (quiet = true) => {
    setSaving(true);
    try {
      const res = await teachers.saveProfile(draft);
      onChanged(res.profile);
      if (!quiet) toast('success', 'Draft saved');
      return res.profile;
    } catch (e) {
      toast('error', 'Could not save', errText(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    const saved = await save();
    if (saved) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    const saved = await save();
    if (!saved) return;
    setSaving(true);
    try {
      const res = await teachers.submit();
      onChanged(res.profile);
      toast('success', 'Application submitted', "We'll notify you when staff have reviewed it.");
      onSubmitted();
    } catch (e) {
      toast('error', 'Not ready to submit', errText(e));
    } finally {
      setSaving(false);
    }
  };

  const checks = [
    draft.headline.trim().length >= 8 && draft.bio.trim().length >= 60,
    draft.specialties.some((s) => s.topics.length > 0),
    (profile?.qualifications.length ?? 0) > 0,
    draft.availability.length > 0,
  ];

  const doneCount = checks.filter(Boolean).length;
  const StepIcon = STEP_META[step].icon;

  return (
    <div className="t-apply grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5">
      {!profile?.submitted_at && (
        <section className="t-apply-hero" aria-labelledby="t-apply-title">
          <div className="t-apply-hero-crest" aria-hidden="true">
            <GraduationCap />
          </div>
          <div className="min-w-0">
            <p className="pro-eyebrow">Teacher Studio · Application</p>
            <h1 id="t-apply-title" className="pro-h1 mt-1">Teach on Genesis</h1>
            <p className="pro-secondary mt-1.5 max-w-xl">Help students with the exact topics they struggle with. Apply once — staff verify you, then students can find and request you.</p>
          </div>
          <ul className="t-apply-perks">
            {PERKS.map(({icon: Icon, title, body}) => (
              <li key={title}>
                <Icon />
                <span className="min-w-0">
                  <b>{title}</b>
                  <small>{body}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pro-card t-apply-card grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-4 md:p-6">
        {/* quest track */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="pro-eyebrow">Step {step + 1} of {STEPS.length}</p>
            <p className="pro-meta tabular">{doneCount}/{STEPS.length} ready</p>
          </div>
          <ol className="t-quest" aria-label="Application steps" style={{['--quest' as string]: String(step / (STEPS.length - 1))}}>
            {STEPS.map((label, i) => {
              const Icon = STEP_META[i].icon;
              return (
                <li key={label}>
                  <button type="button" aria-current={step === i ? 'step' : undefined} data-done={checks[i] && i !== step ? '' : undefined} onClick={() => void save().then((ok) => ok && setStep(i))}>
                    <i>{checks[i] && i !== step ? <CheckCircle2 /> : <Icon />}</i>
                    <span>{STEP_META[i].short}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* step header */}
        <header className="t-step-head">
          <span className="t-step-head-orb" aria-hidden="true">
            <StepIcon />
          </span>
          <span className="min-w-0">
            <h2 className="pro-h2">{STEPS[step]}</h2>
            <span className="pro-meta block">{STEP_META[step].blurb}</span>
          </span>
        </header>

        {step === 0 && <AboutStep draft={draft} setDraft={setDraft} languages={catalog?.languages ?? []} />}
        {step === 1 && <SubjectsStep draft={draft} setDraft={setDraft} catalog={catalog} />}
        {step === 2 && <QualificationsStep profile={profile} onChanged={onChanged} ensureSaved={save} />}
        {step === 3 && <AvailabilityStep draft={draft} setDraft={setDraft} />}

        <div className="t-apply-foot">
          <button type="button" className="pro-btn pro-btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} aria-label="Back">
            <ArrowLeft className="size-4" /> <span className="max-sm:hidden">Back</span>
          </button>
          <button type="button" className="pro-btn" onClick={() => void save(false)} disabled={saving}>
            <Save className="size-4" /> <span>Save<span className="max-sm:hidden"> draft</span></span>
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="pro-btn pro-btn-primary" onClick={() => void next()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Continue <ArrowRight className="size-4" />
            </button>
          ) : (
            <button type="button" className="pro-btn pro-btn-primary" onClick={() => void submit()} disabled={saving || !checks.slice(0, 3).every(Boolean)}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Submit
            </button>
          )}
        </div>
        {step === STEPS.length - 1 && !checks.slice(0, 3).every(Boolean) && (
          <p className="pro-meta -mt-2 sm:text-right">Complete {STEPS.filter((_, i) => i < 3 && !checks[i]).join(', ')} before submitting.</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- sections */
export function AboutStep({draft, setDraft, languages}: {draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; languages: string[]}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({...d, [key]: value}));
  const allLanguages = useMemo(() => Array.from(new Set([...(languages.length ? languages : ['English', 'Pidgin', 'Igbo', 'Yoruba', 'Hausa', 'French']), ...draft.languages])), [languages, draft.languages]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4">
      <Field label="Headline" hint="One line students see in search. e.g. “Calculus & Physics tutor for 100-level students”">
        <input className="pro-input" value={draft.headline} onChange={(e) => set('headline', e.target.value)} maxLength={140} />
      </Field>
      <Field label="About you" hint={`${draft.bio.trim().length} characters · at least 60. How do you teach? Who do you help best?`}>
        <textarea className="pro-input" style={{minHeight: 140}} value={draft.bio} onChange={(e) => set('bio', e.target.value)} maxLength={3000} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field label="Years of teaching experience">
          <input className="pro-input" type="number" min={0} max={60} value={draft.experience_years} onChange={(e) => set('experience_years', Math.max(0, Math.min(60, Number(e.target.value) || 0)))} />
        </Field>
        <Field label="Institution (optional)">
          <input className="pro-input" value={draft.institution} onChange={(e) => set('institution', e.target.value)} maxLength={160} placeholder="e.g. University of Port Harcourt" />
        </Field>
      </div>
      <Field label="Teaching experience (optional)">
        <textarea className="pro-input" value={draft.experience} onChange={(e) => set('experience', e.target.value)} maxLength={2000} placeholder="Schools, tutoring, exam prep, results you're proud of…" />
      </Field>
      <Field label="Languages you teach in" group>
        <div className="flex flex-wrap gap-2">
          {allLanguages.map((lang) => {
            const on = draft.languages.includes(lang);
            return (
              <button key={lang} type="button" className="t-chip-btn" aria-pressed={on} onClick={() => set('languages', on ? draft.languages.filter((l) => l !== lang) : [...draft.languages, lang])}>
                {on && <CheckCircle2 className="size-3.5" />} {lang}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Formats" group>
        <div className="pro-seg pro-seg-fill" role="radiogroup" aria-label="Formats">
          {(['one', 'group', 'both'] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={draft.formats === f} className="pro-seg-item" onClick={() => set('formats', f)}>
              {f === 'one' ? 'One-on-one' : f === 'group' ? 'Groups' : 'Both'}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function SubjectsStep({draft, setDraft, catalog}: {draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; catalog: Catalog | null}) {
  const [subject, setSubject] = useState('');
  const [custom, setCustom] = useState('');
  const subjects = catalog?.subjects ?? [];
  const current = subject || draft.specialties[0]?.subject || subjects[0]?.subject || '';
  const selected = draft.specialties.find((s) => s.subject === current)?.topics ?? [];
  const known = subjects.find((s) => s.subject === current)?.topics ?? [];
  const topics = Array.from(new Set([...known, ...selected]));
  const toggle = (topic: string) =>
    setDraft((d) => {
      const rest = d.specialties.filter((s) => s.subject !== current);
      const existing = d.specialties.find((s) => s.subject === current)?.topics ?? [];
      const next = existing.includes(topic) ? existing.filter((t) => t !== topic) : [...existing, topic];
      return {...d, specialties: next.length ? [...rest, {subject: current, topics: next}] : rest};
    });
  const addCustom = () => {
    const value = custom.trim();
    if (value.length < 2 || !current) return;
    if (!selected.includes(value)) toggle(value);
    setCustom('');
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4">
      <p className="pro-secondary">Pick specific topics — students search by topic, so “Organic Chemistry” beats just “Chemistry”. Up to 8 subjects.</p>
      <div className="flex min-w-0 flex-wrap gap-2">
        {subjects.map((s) => {
          const count = draft.specialties.find((x) => x.subject === s.subject)?.topics.length ?? 0;
          return (
            <button key={s.subject} type="button" className="t-chip-btn" aria-pressed={current === s.subject} onClick={() => setSubject(s.subject)}>
              {s.subject}
              {count > 0 && <span className="t-unread">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl p-4" style={{background: 'var(--pro-hover)'}}>
        <p className="pro-eyebrow">{current} topics</p>
        <div className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <button key={topic} type="button" className="t-chip-btn" aria-pressed={selected.includes(topic)} onClick={() => toggle(topic)}>
              {selected.includes(topic) && <CheckCircle2 className="size-3.5" />} {topic}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="pro-input min-w-0 flex-1" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())} placeholder={`Add another ${current} topic`} maxLength={120} />
          <button type="button" className="pro-btn" onClick={addCustom}>
            <Plus className="size-4" /> Add
          </button>
        </div>
      </div>
      {draft.specialties.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="pro-eyebrow">You'll appear for</p>
          {draft.specialties.map((s) => (
            <p key={s.subject} className="pro-secondary [overflow-wrap:anywhere]">
              <b style={{color: 'var(--pro-text)'}}>{s.subject}:</b> {s.topics.join(', ')}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function QualificationsStep({profile, onChanged, ensureSaved}: {profile: MyProfile | null; onChanged: (p: MyProfile) => void; ensureSaved: () => Promise<MyProfile | null>}) {
  const {toast} = useSession();
  const [title, setTitle] = useState('');
  const [institution, setInstitution] = useState('');
  const [year, setYear] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const add = async () => {
    if (title.trim().length < 2) return;
    setBusy(true);
    try {
      if (!profile) await ensureSaved();
      const res = await teachers.addQualification({title, institution, year}, file);
      onChanged(res.profile);
      setTitle('');
      setInstitution('');
      setYear('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      toast('error', 'Could not add', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    const res = await teachers.deleteQualification(id);
    onChanged(res.profile);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4">
      <p className="pro-secondary">Degrees, certificates or teaching licences. Documents are seen only by Genesis staff for verification — never by students.</p>
      {(profile?.qualifications ?? []).length > 0 && (
        <div className="pro-card pro-rows overflow-hidden">
          {profile!.qualifications.map((q) => (
            <div key={q.id} className="t-row">
              <span className="t-attach-icon">{q.status === 'verified' ? <BadgeCheck /> : <FileText />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{q.title}</span>
                <span className="pro-meta block truncate">
                  {[q.institution, q.year, q.file ? q.file.name : 'No document', q.status === 'verified' ? 'Verified' : q.status === 'rejected' ? 'Not accepted' : 'Awaiting check'].filter(Boolean).join(' · ')}
                </span>
              </span>
              {q.file && (
                <a className="pro-btn pro-btn-ghost pro-btn-sm max-sm:hidden" href={fileUrl(q.file.id)} target="_blank" rel="noopener noreferrer">
                  View
                </a>
              )}
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={() => void remove(q.id)} aria-label="Remove qualification" title="Remove">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl p-4" style={{background: 'var(--pro-hover)'}}>
        <p className="pro-eyebrow">Add a qualification</p>
        <Field label="Title">
          <input className="pro-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. B.Sc. Mathematics (First Class)" maxLength={160} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <Field label="Institution">
            <input className="pro-input" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={160} />
          </Field>
          <Field label="Year">
            <input className="pro-input" value={year} onChange={(e) => setYear(e.target.value)} maxLength={10} inputMode="numeric" />
          </Field>
        </div>
        <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="pro-btn" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> {file ? 'Change document' : 'Attach document'}
          </button>
          <span className="pro-meta min-w-0 truncate">{file ? file.name : 'PDF or image, up to 15 MB (optional but speeds up verification)'}</span>
        </div>
        <button type="button" className="pro-btn pro-btn-primary justify-self-start" onClick={() => void add()} disabled={busy || title.trim().length < 2}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add qualification
        </button>
      </div>
    </div>
  );
}

export function AvailabilityStep({draft, setDraft}: {draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void}) {
  const [day, setDay] = useState(0);
  const [start, setStart] = useState('17:00');
  const [end, setEnd] = useState('19:00');
  const add = () => {
    if (start >= end) return;
    setDraft((d) => ({...d, availability: [...d.availability, {day, start, end}].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))}));
  };
  const remove = (index: number) => setDraft((d) => ({...d, availability: d.availability.filter((_, i) => i !== index)}));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4">
      <p className="pro-secondary">When are you usually free to teach? Students see this as a weekly guide and an “available now” signal. Phase 2 adds bookable lessons.</p>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Day">
          <select className="pro-input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input className="pro-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To">
          <input className="pro-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <button type="button" className="pro-btn max-sm:col-span-3" onClick={add} disabled={start >= end}>
          <Plus className="size-4" /> Add slot
        </button>
      </div>
      {draft.availability.length === 0 ? (
        <p className="pro-meta inline-flex items-center gap-1.5">
          <Clock className="size-3.5" /> No slots yet — you'll show as “flexible”.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {draft.availability.map((slot, i) => (
            <span key={`${slot.day}${slot.start}${i}`} className="t-chip-btn">
              {DAYS[slot.day]} {slot.start}–{slot.end}
              <button type="button" onClick={() => remove(i)} aria-label="Remove slot" className="opacity-70 hover:opacity-100">
                <XCircle className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Toggle checked={draft.accepting} onChange={(v) => setDraft((d) => ({...d, accepting: v}))} label="Accepting new students" />
      <div className="flex items-start gap-3 rounded-2xl p-4" style={{background: 'var(--pro-accent-soft)'}}>
        <Sparkles className="mt-0.5 size-5 shrink-0" style={{color: 'var(--pro-accent-text)'}} />
        <p className="pro-secondary">
          After approval your profile shows a <b style={{color: 'var(--pro-text)'}}>Verified</b> badge. Reputation is shown as plain numbers — rating, reviews, students taught, response time — never a hidden score.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------ approved: profile editor */
export function ProfileEditor({profile, onChanged}: {profile: MyProfile; onChanged: (p: MyProfile) => void}) {
  const {toast} = useSession();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<'about' | 'subjects' | 'availability'>('about');
  useEffect(() => {
    teachers.catalog().then(setCatalog).catch(() => {});
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      const res = await teachers.saveProfile(draft);
      onChanged(res.profile);
      toast('success', 'Profile saved', 'Students see the changes straight away.');
    } catch (e) {
      toast('error', 'Could not save', errText(e));
    } finally {
      setSaving(false);
    }
  };
  if (!catalog) return <LoadingRows rows={4} />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4">
      <div className="pro-tabs pro-tabs-fit" role="tablist" aria-label="Profile sections">
        {(
          [
            ['about', 'About'],
            ['subjects', 'Subjects'],
            ['availability', 'Availability'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className="pro-tab" onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="pro-card grid gap-5 p-4 md:p-6">
        {section === 'about' && <AboutStep draft={draft} setDraft={setDraft} languages={catalog.languages} />}
        {section === 'subjects' && <SubjectsStep draft={draft} setDraft={setDraft} catalog={catalog} />}
        {section === 'availability' && <AvailabilityStep draft={draft} setDraft={setDraft} />}
        <div className="flex justify-end border-t pt-4" style={{borderColor: 'var(--pro-border)'}}>
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} Save profile
          </button>
        </div>
      </div>
    </div>
  );
}
