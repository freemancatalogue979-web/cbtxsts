import {BarChart3, Building2, GraduationCap, Plus, School, Sparkles, Users} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Button, Card, EmptyState, Field, Modal, PageBanner, SectionHeading, Skeleton, StatTile, TextInput, Select} from '../components/ui';
import {api, type Json} from '../lib/api';
import {useSession} from '../store/session';

export default function InstitutionsAdmin({onOpenTutor}: {onOpenTutor?: (prompt: string) => void}) {
  const {toast, profile} = useSession();
  const teacherOnly = String((profile as unknown as {role?: string} | null)?.role || '') === 'teacher';
  const [organizations, setOrganizations] = useState<Json[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<Json | null>(null);
  const [intelligence, setIntelligence] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOrg, setCreateOrg] = useState(false);
  const [createClass, setCreateClass] = useState(false);
  const [createTeacher, setCreateTeacher] = useState(false);
  const [createAssignment, setCreateAssignment] = useState(false);
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [assignmentInstructions, setAssignmentInstructions] = useState('');
  const [orgName, setOrgName] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [orgKind, setOrgKind] = useState('school');
  const [className, setClassName] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);

  const loadOrganizations = () => {
    setLoading(true);
    api.institutions.list().then((data) => {
      const rows = (data.organizations ?? []) as Json[];
      setOrganizations(rows);
      setSelected((current) => current ?? (Number(rows[0]?.id || 0) || null));
    }).catch((error: Error) => toast('error', 'Could not load institutions', error.message)).finally(() => setLoading(false));
  };

  useEffect(loadOrganizations, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) { setDashboard(null); return; }
    setDashboard(null); setIntelligence(null);
    api.institutions.dashboard(selected).then(setDashboard).catch((error: Error) => toast('error', 'Could not load school intelligence', error.message));
  }, [selected, toast]);

  const openClass = (id: number) => {
    setIntelligence(null);
    api.institutions.classIntelligence(id).then(setIntelligence).catch((error: Error) => toast('error', 'Could not load class intelligence', error.message));
  };

  const saveOrganization = async () => {
    if (!orgName.trim()) return;
    setBusy(true);
    try {
      const row = await api.institutions.create({name: orgName.trim(), kind: orgKind, plan: orgKind === 'enterprise' ? 'enterprise' : 'school', seats: 500});
      setCreateOrg(false); setOrgName('');
      await api.institutions.list().then((data) => setOrganizations((data.organizations ?? []) as Json[]));
      setSelected(Number(row.id));
      toast('success', 'Institution created', String(row.name));
    } catch (error) { toast('error', 'Could not create institution', (error as Error).message); }
    finally { setBusy(false); }
  };

  const saveTeacher = async () => {
    if (!selected || !teacherEmail.trim() || teacherPassword.length < 8) return;
    setBusy(true);
    try {
      await api.institutions.createTeacher(selected, {name: teacherName.trim() || 'Teacher', email: teacherEmail.trim(), password: teacherPassword});
      setCreateTeacher(false); setTeacherName(''); setTeacherEmail(''); setTeacherPassword('');
      toast('success', 'Teacher account ready', 'They can sign in through the staff login and only access their school workspace.');
    } catch (error) { toast('error', 'Could not create teacher', (error as Error).message); }
    finally { setBusy(false); }
  };

  const saveAssignment = async () => {
    const classId = Number((intelligence?.class as Json | undefined)?.id || 0);
    if (!classId || !assignmentTitle.trim()) return;
    setBusy(true);
    try {
      await api.institutions.createAssignment(classId, {title: assignmentTitle.trim(), instructions: assignmentInstructions.trim(), kind: 'practice', status: 'published', config: {adaptive: true}});
      setCreateAssignment(false); setAssignmentTitle(''); setAssignmentInstructions('');
      toast('success', 'Assignment published', 'Every active student in this class can now see it.');
    } catch (error) { toast('error', 'Could not publish assignment', (error as Error).message); }
    finally { setBusy(false); }
  };

  const saveClass = async () => {
    if (!selected || !className.trim()) return;
    setBusy(true);
    try {
      await api.institutions.createClass(selected, {name: className.trim(), level: classLevel.trim(), academic_year: academicYear.trim()});
      setCreateClass(false); setClassName(''); setClassLevel('');
      setDashboard(await api.institutions.dashboard(selected));
      toast('success', 'Class created', 'Assign teachers and enrol students when ready.');
    } catch (error) { toast('error', 'Could not create class', (error as Error).message); }
    finally { setBusy(false); }
  };

  const summary = (dashboard?.summary ?? {}) as Json;
  const topics = (dashboard?.topics ?? []) as Json[];
  const classes = (dashboard?.classes ?? []) as Json[];
  const classSummary = (intelligence?.summary ?? {}) as Json;
  const weakest = (intelligence?.weakest ?? []) as Json[];

  return (
    <div className="grid gap-4 sm:gap-6">
      <Card className="p-4 sm:p-5">
        <PageBanner eyebrow="People · Institutions" tone="cyan" title="Genesis for Schools" subtitle="Organizations, classes, teachers, assignments and learning intelligence" icon={<Building2 className="size-4" />} action={<div className="flex flex-wrap gap-2">{selected && !teacherOnly && <Button size="sm" variant="outline" onClick={() => setCreateTeacher(true)} icon={<Users className="size-4" />}>New teacher</Button>}{!teacherOnly && <Button size="sm" onClick={() => setCreateOrg(true)} icon={<Plus className="size-4" />}>New institution</Button>}</div>} />
        {loading ? <Skeleton className="h-12" /> : organizations.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {organizations.map((row) => <button key={String(row.id)} type="button" onClick={() => setSelected(Number(row.id))} className={`min-h-11 shrink-0 rounded-2xl border px-3.5 text-left ${selected === Number(row.id) ? 'border-nova-400/45 bg-nova-500/15 text-nova-100' : 'border-white/10 bg-white/[.035] text-mist-300'}`}><strong className="block text-[.78rem]">{String(row.name)}</strong><small className="text-[.62rem] font-bold uppercase tracking-wider opacity-70">{String(row.kind)}</small></button>)}
          </div>
        ) : <EmptyState icon={<School />} title="No institutions yet" detail="Create the first school or training organization." action={<Button onClick={() => setCreateOrg(true)}>Create institution</Button>} />}
      </Card>

      {selected && !dashboard ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map((n) => <Skeleton key={n} className="h-24" />)}</div> : dashboard ? <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Students" value={Number(summary.students || 0)} icon={<Users className="size-5" />} tone="nova" hint={`${Number(summary.active_today || 0)} active today`} />
          <StatTile label="Classes" value={Number(summary.classes || 0)} icon={<GraduationCap className="size-5" />} tone="pulse" />
          <StatTile label="School mastery" value={`${Math.round(Number(summary.average_mastery || 0))}%`} icon={<BarChart3 className="size-5" />} tone="mint" />
          <StatTile label="Measured topics" value={topics.length} icon={<Sparkles className="size-5" />} tone="gold" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <Card className="p-4 sm:p-5">
            <SectionHeading title="Classes" subtitle="Open a class for actionable intelligence" icon={<GraduationCap className="size-4" />} action={!teacherOnly ? <Button size="sm" variant="outline" onClick={() => setCreateClass(true)} icon={<Plus className="size-4" />}>New class</Button> : undefined} />
            {classes.length ? <div className="grid gap-2 sm:grid-cols-2">{classes.map((row) => <button key={String(row.id)} type="button" onClick={() => openClass(Number(row.id))} className="rounded-2xl border border-white/10 bg-white/[.035] p-3 text-left transition hover:border-nova-400/35 hover:bg-nova-500/8"><strong className="block text-[.84rem] text-mist-100">{String(row.name)}</strong><span className="mt-1 block text-[.7rem] font-semibold text-mist-500">{Number(row.students)} students · {Number(row.teachers)} teachers</span><span className="mt-2 block text-[.65rem] font-bold uppercase tracking-wider text-nova-300">Open intelligence →</span></button>)}</div> : <EmptyState icon={<GraduationCap />} title="No classes yet" detail="Create a class, assign a teacher and enrol students." />}
          </Card>
          <Card className="p-4 sm:p-5">
            <SectionHeading title="School topic health" subtitle="Weakest measured concepts first" icon={<BarChart3 className="size-4" />} />
            <div className="grid gap-3">{topics.slice(0, 8).map((row) => <div key={String(row.topic)}><div className="mb-1 flex justify-between gap-3 text-[.7rem] font-bold"><span className="truncate text-mist-200">{String(row.topic)}</span><span className="tabular text-mist-400">{Math.round(Number(row.mastery))}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-black/30"><span className="block h-full rounded-full bg-gradient-to-r from-flare-500 to-gold-400" style={{width: `${Math.max(3, Number(row.mastery))}%`}} /></div></div>)}</div>
          </Card>
        </div>
      </> : null}

      {intelligence && <Card className="p-4 sm:p-5"><SectionHeading title={String((intelligence.class as Json)?.name || 'Class intelligence')} subtitle={`${Number(classSummary.students || 0)} students · ${Number(classSummary.at_risk || 0)} need attention`} icon={<Sparkles className="size-4" />} action={<Button size="sm" onClick={() => setCreateAssignment(true)} icon={<Plus className="size-4" />}>New assignment</Button>} /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{weakest.map((row) => <div key={String(row.topic)} className="rounded-2xl border border-flare-500/20 bg-flare-500/7 p-3"><span className="text-[.63rem] font-black uppercase tracking-wider text-flare-300">Needs remediation</span><strong className="mt-1 block text-[.82rem] text-mist-100">{String(row.topic)}</strong><p className="mt-1 text-[.7rem] font-semibold text-mist-400">{Math.round(Number(row.mastery))}% mastery · {Number(row.students)} students measured</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => onOpenTutor?.(`Create a remedial lesson and targeted assignment for ${String((intelligence.class as Json)?.name || 'this class')} (course ids: ${String(((intelligence.class as Json)?.course_ids as number[] | undefined)?.join(', ') || 'not assigned')}) on ${String(row.topic)}. Class mastery is ${Math.round(Number(row.mastery))}%. Explain the likely misconceptions, provide a short lesson, guided examples, and a 10-question practice plan.`)}>Plan a fix with Teacher AI</Button></div>)}</div></Card>}

      <Modal open={createOrg} onClose={() => setCreateOrg(false)} title="Create an institution" subtitle="School, university, training provider or enterprise" footer={<><Button variant="ghost" onClick={() => setCreateOrg(false)}>Cancel</Button><Button disabled={busy || !orgName.trim()} onClick={() => void saveOrganization()}>{busy ? 'Creating…' : 'Create'}</Button></>}><div className="grid gap-3"><Field label="Institution name"><TextInput value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Genesis Academy" /></Field><Field label="Type"><Select className="ag-select w-full rounded-2xl border border-white/12 bg-ink-900/70 px-3.5 py-3 text-mist-100" value={orgKind} onChange={(e) => setOrgKind(e.target.value)}><option value="school">School</option><option value="university">University</option><option value="training">Training organization</option><option value="enterprise">Enterprise</option></Select></Field></div></Modal>
      <Modal open={createTeacher} onClose={() => setCreateTeacher(false)} title="Create a teacher account" subtitle="Teacher access is restricted to assigned school and class intelligence" footer={<><Button variant="ghost" onClick={() => setCreateTeacher(false)}>Cancel</Button><Button disabled={busy || !teacherEmail.includes('@') || teacherPassword.length < 8} onClick={() => void saveTeacher()}>{busy ? 'Creating…' : 'Create teacher'}</Button></>}><div className="grid gap-3"><Field label="Teacher name"><TextInput value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="Full name" /></Field><Field label="Email"><TextInput type="email" value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} placeholder="teacher@school.edu" /></Field><Field label="Temporary password" hint="At least 8 characters"><TextInput type="password" value={teacherPassword} onChange={(e) => setTeacherPassword(e.target.value)} /></Field></div></Modal>
      <Modal open={createAssignment} onClose={() => setCreateAssignment(false)} title="Publish an assignment" subtitle="Creates a tracked submission for every active student in this class" footer={<><Button variant="ghost" onClick={() => setCreateAssignment(false)}>Cancel</Button><Button disabled={busy || !assignmentTitle.trim()} onClick={() => void saveAssignment()}>{busy ? 'Publishing…' : 'Publish assignment'}</Button></>}><div className="grid gap-3"><Field label="Title"><TextInput value={assignmentTitle} onChange={(e) => setAssignmentTitle(e.target.value)} placeholder="e.g. Repair weak topics before Friday" /></Field><Field label="Instructions"><textarea className="min-h-28 w-full rounded-2xl border border-white/12 bg-ink-900/70 px-3.5 py-3 text-mist-100 outline-none focus:border-nova-400/60" value={assignmentInstructions} onChange={(e) => setAssignmentInstructions(e.target.value)} placeholder="What students should complete" /></Field></div></Modal>
      <Modal open={createClass} onClose={() => setCreateClass(false)} title="Create a class" subtitle="Teachers and students can be assigned after creation" footer={<><Button variant="ghost" onClick={() => setCreateClass(false)}>Cancel</Button><Button disabled={busy || !className.trim()} onClick={() => void saveClass()}>{busy ? 'Creating…' : 'Create class'}</Button></>}><div className="grid gap-3"><Field label="Class name"><TextInput value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. SS2A" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Level"><TextInput value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="SS2" /></Field><Field label="Academic year"><TextInput value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} /></Field></div></div></Modal>
    </div>
  );
}
