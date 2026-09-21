/**
 * The study-group workspace — a full-page, real-time community (never a modal).
 * Owns the ONE group socket, the presence map, the unread badge and the
 * section router, then shares them with every section through GroupProvider.
 *
 * Layout is app-like: a compact header (back · identity · bell · more), a
 * three-column body on desktop (left nav · centre · right rail) and a bottom
 * dock under xl. The centre is the only region that scrolls, so the page never
 * grows into one endless document.
 */
import {
  Activity as ActivityIcon,
  Bell,
  Check,
  ChevronLeft,
  Copy,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircleQuestion,
  MessagesSquare,
  MoreHorizontal,
  Radio,
  Settings2,
  Swords,
  Users,
  Zap,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Button, Card, Chip, Field, IconButton, Modal, Select, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {useGroupRoom} from '../lib/groupSocket';
import {useSession} from '../store/session';
import {canDo, GroupProvider, useGroup} from '../group/context';
import type {GroupCtx} from '../group/context';
import {PresenceDot} from '../group/bits';
import Overview from '../group/Overview';
import Chat from '../group/Chat';
import Quizzes from '../group/Quizzes';
import Duels from '../group/Duels';
import Questions from '../group/Questions';
import Members from '../group/Members';
import Announcements from '../group/Announcements';
import Activity from '../group/Activity';
import MemberProfile from '../group/MemberProfile';
import NotificationSheet from '../group/NotificationSheet';
import type {Course, GroupSection, PresenceStatus, StudyGroupSummary} from '../lib/types';

const NAV: {id: GroupSection; label: string; short: string; icon: typeof Zap}[] = [
  {id: 'overview', label: 'Overview', short: 'Home', icon: LayoutDashboard},
  {id: 'chat', label: 'Chat', short: 'Chat', icon: MessagesSquare},
  {id: 'quizzes', label: 'Quizzes', short: 'Quizzes', icon: Zap},
  {id: 'duels', label: 'Duels', short: 'Duels', icon: Swords},
  {id: 'questions', label: 'Questions', short: 'Q&A', icon: MessageCircleQuestion},
  {id: 'members', label: 'Members', short: 'Members', icon: Users},
  {id: 'announcements', label: 'News', short: 'News', icon: Megaphone},
  {id: 'activity', label: 'Activity', short: 'Activity', icon: ActivityIcon},
];

function SettingsModal({open, onClose, group, onSaved}: {open: boolean; onClose: () => void; group: StudyGroupSummary; onSaved: () => void}) {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [goal, setGoal] = useState(group.goal);
  const [courseId, setCourseId] = useState<number | ''>(group.course_id ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group.name);
    setDescription(group.description);
    setGoal(group.goal);
    setCourseId(group.course_id ?? '');
    api.courses().then(setCourses).catch(() => setCourses([]));
  }, [open, group]);

  const save = async () => {
    if (name.trim().length < 3) {
      toast('error', 'Name too short', 'Give the group a name of at least 3 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.groups.updateSettings(group.id, {
        name: name.trim(),
        description: description.trim(),
        goal: goal.trim(),
        course_id: courseId === '' ? null : Number(courseId),
      });
      toast('success', 'Group updated');
      onSaved();
      onClose();
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Group settings"
      subtitle="Owner controls"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy} icon={<Check className="size-4" />}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Group name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Description">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
        </Field>
        <Field label="Goal">
          <TextInput value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={200} placeholder="e.g. Ace Government by finals" />
        </Field>
        <Field label="Course">
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">No specific course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} — {course.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/** The body/header/nav — a child of GroupProvider so it can read the context. */
function Workspace({
  section,
  memberId,
  clearMember,
  unread,
  onExit,
}: {
  section: GroupSection;
  memberId: number | null;
  clearMember: () => void;
  unread: number;
  onExit: () => void;
}) {
  const {group, can, presence, onlineIds, go, openMember, notify, refresh} = useGroup();
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(group.code);
      setCopied(true);
      notify('success', 'Invite code copied', group.code);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      notify('error', 'Copy failed', 'Your browser blocked the clipboard.');
    }
    setMenuOpen(false);
  };

  const leave = async () => {
    setMenuOpen(false);
    try {
      await api.groups.leave(group.id);
      notify('info', 'Left the group', 'You can rejoin with the invite code.');
      onExit();
    } catch (error) {
      notify('error', 'Could not leave', (error as Error).message);
    }
  };

  const onlineCount = onlineIds.length;
  const activeNav = NAV.find((row) => row.id === section);

  const body = () => {
    if (memberId !== null) return <MemberProfile studentId={memberId} onBack={clearMember} />;
    switch (section) {
      case 'chat':
        return <Chat />;
      case 'quizzes':
        return <Quizzes />;
      case 'duels':
        return <Duels />;
      case 'questions':
        return <Questions />;
      case 'members':
        return <Members />;
      case 'announcements':
        return <Announcements />;
      case 'activity':
        return <Activity />;
      default:
        return <Overview />;
    }
  };

  return (
    <div className="aurora relative flex h-dvh flex-col overflow-hidden">
      <div className="grid-lines pointer-events-none fixed inset-0 opacity-50" />

      {/* ------------------------------------------------------------ header */}
      <header className="print-hide safe-top relative z-30 shrink-0 border-b border-white/8 bg-ink-950/70 backdrop-blur">
        <div className="flex min-h-14 items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-4">
          <IconButton label="Back" variant="outline" className="size-9 shrink-0" onClick={onExit}>
            <ChevronLeft className="size-5" />
          </IconButton>

          <button type="button" onClick={() => go('overview')} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <span className="tf-orb grid size-9 shrink-0 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br from-nova-300 to-nova-600 text-ink-950 shadow-[inset_0_2px_0_rgba(255,255,255,0.45)]">
              <Users className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.95rem] leading-tight font-extrabold text-mist-50">{group.name}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[0.68rem] font-semibold text-mist-500">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" /> {group.member_count}
                </span>
                <span className="inline-flex items-center gap-1 text-mint-300">
                  <Radio className="size-3" /> {onlineCount}
                </span>
                {activeNav && section !== 'overview' && memberId === null && <span className="hidden truncate sm:inline">· {activeNav.label}</span>}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label="Group notifications"
              className="relative grid size-9 place-items-center rounded-xl border border-white/12 bg-white/5 text-mist-200 transition-colors hover:border-nova-400/40"
            >
              <Bell className="size-[18px]" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 grid min-w-4.5 place-items-center rounded-full bg-flare-500 px-1 text-[0.6rem] font-black text-white ring-2 ring-ink-950">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>

            <div className="relative" ref={menuRef}>
              <IconButton label="More" variant="outline" className="size-9" onClick={() => setMenuOpen((v) => !v)}>
                <MoreHorizontal className="size-5" />
              </IconButton>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{opacity: 0, y: -6, scale: 0.97}}
                    animate={{opacity: 1, y: 0, scale: 1}}
                    exit={{opacity: 0, y: -6, scale: 0.97}}
                    transition={{duration: 0.14}}
                    className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-white/12 bg-ink-900/95 p-1 shadow-2xl backdrop-blur"
                  >
                    <button type="button" onClick={() => void copyCode()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.82rem] font-semibold text-mist-200 hover:bg-white/6">
                      {copied ? <Check className="size-4 text-mint-300" /> : <Copy className="size-4 text-nova-300" />}
                      {copied ? 'Copied!' : 'Copy invite code'}
                      <span className="ml-auto font-mono text-[0.72rem] text-mist-500">{group.code}</span>
                    </button>
                    {can('edit_group') && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setSettingsOpen(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.82rem] font-semibold text-mist-200 hover:bg-white/6"
                      >
                        <Settings2 className="size-4 text-nova-300" /> Group settings
                      </button>
                    )}
                    <button type="button" onClick={() => void leave()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.82rem] font-semibold text-flare-300 hover:bg-flare-500/10">
                      <LogOut className="size-4" /> Leave group
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* desktop tab rail (md–xl, above the dock) */}
        <nav className="no-scrollbar hidden items-center gap-1 overflow-x-auto border-t border-white/6 px-3 py-1.5 md:flex xl:hidden">
          {NAV.map((row) => {
            const active = row.id === section && memberId === null;
            const Icon = row.icon;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => go(row.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.78rem] font-bold transition-colors ${active ? 'bg-nova-500/20 text-white' : 'text-mist-400 hover:bg-white/6 hover:text-mist-100'}`}
              >
                <Icon className="size-4" /> {row.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* -------------------------------------------------------------- body */}
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* left nav (xl+) */}
        <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-white/8 bg-ink-950/40 p-3 xl:flex">
          <p className="px-2 pb-1 text-[0.62rem] font-black tracking-[0.16em] text-mist-600">SECTIONS</p>
          {NAV.map((row) => {
            const active = row.id === section && memberId === null;
            const Icon = row.icon;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => go(row.id)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[0.84rem] font-bold transition-colors ${active ? 'bg-nova-500/18 text-white ring-1 ring-nova-500/30' : 'text-mist-300 hover:bg-white/6'}`}
              >
                <Icon className={`size-4.5 ${active ? 'text-nova-300' : 'text-mist-500'}`} />
                {row.label}
                {row.id === 'chat' && presence && onlineCount > 0 && <span className="ml-auto text-[0.66rem] font-black text-mint-300">{onlineCount}</span>}
              </button>
            );
          })}
          <div className="mt-auto rounded-xl border border-white/8 bg-white/4 p-3">
            <p className="text-[0.62rem] font-black tracking-wider text-mist-600">INVITE CODE</p>
            <button type="button" onClick={() => void copyCode()} className="mt-1 flex w-full items-center gap-2 text-left">
              <span className="font-mono text-[0.95rem] font-black text-nova-200">{group.code}</span>
              {copied ? <Check className="size-4 text-mint-300" /> : <Copy className="size-4 text-mist-500" />}
            </button>
          </div>
        </aside>

        {/* centre */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body()}</div>
        </main>

        {/* right rail (xl+) */}
        <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/8 bg-ink-950/40 p-3 xl:flex">
          <Card className="p-3.5">
            <p className="text-[0.62rem] font-black tracking-[0.16em] text-mist-600">GROUP PULSE</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[0.6rem] font-bold tracking-wider text-mist-500">MEMBERS</p>
                <p className="text-[1.05rem] font-black tabular text-mist-50">{group.member_count}</p>
              </div>
              <div className="rounded-xl bg-mint-500/10 px-3 py-2">
                <p className="text-[0.6rem] font-bold tracking-wider text-mint-300">ONLINE</p>
                <p className="text-[1.05rem] font-black tabular text-mint-200">{onlineCount}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <PresenceDot status="online" />
              <span className="text-[0.7rem] font-semibold text-mist-500">{onlineCount} studying right now</span>
            </div>
          </Card>

          <Card className="p-3.5">
            <p className="text-[0.62rem] font-black tracking-[0.16em] text-mist-600">QUICK ACTIONS</p>
            <div className="mt-2 grid gap-1.5">
              {can('set_quiz') && (
                <Button size="sm" variant="outline" icon={<Zap className="size-4" />} onClick={() => go('quizzes', 'create')}>Set a quiz</Button>
              )}
              {can('challenge_duels') && (
                <Button size="sm" variant="outline" icon={<Swords className="size-4" />} onClick={() => go('duels', 'create')}>Start a duel</Button>
              )}
              {can('ask_questions') && (
                <Button size="sm" variant="outline" icon={<MessageCircleQuestion className="size-4" />} onClick={() => go('questions', 'create')}>Ask a question</Button>
              )}
              {can('publish_announcements') && (
                <Button size="sm" variant="outline" icon={<Megaphone className="size-4" />} onClick={() => go('announcements', 'create')}>Announce</Button>
              )}
              <Button size="sm" variant="ghost" icon={<Users className="size-4" />} onClick={() => go('members')}>View members</Button>
            </div>
          </Card>

          <Card className="p-3.5">
            <p className="text-[0.62rem] font-black tracking-[0.16em] text-mist-600">ONLINE NOW</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {onlineIds.slice(0, 24).map((id) => (
                <button key={id} type="button" onClick={() => openMember(id)} className="relative">
                  <OnlinePip studentId={id} />
                </button>
              ))}
              {onlineIds.length === 0 && <span className="text-[0.72rem] font-medium text-mist-600">No one else online.</span>}
            </div>
          </Card>
        </aside>
      </div>

      {/* ------------------------------------------------------ mobile dock */}
      <nav className="print-hide safe-bottom relative z-20 shrink-0 border-t border-white/8 bg-ink-950/85 backdrop-blur md:hidden">
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-2 py-1.5">
          {NAV.map((row) => {
            const active = row.id === section && memberId === null;
            const Icon = row.icon;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => go(row.id)}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[0.62rem] font-bold transition-colors ${active ? 'bg-nova-500/18 text-white' : 'text-mist-500'}`}
              >
                <Icon className={`size-5 ${active ? 'text-nova-300' : ''}`} />
                {row.short}
              </button>
            );
          })}
        </div>
      </nav>

      <NotificationSheet open={notifOpen} onClose={() => setNotifOpen(false)} onRead={refresh} />
      {can('edit_group') && <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} group={group} onSaved={refresh} />}
    </div>
  );
}

/** A tiny avatar pip for an online member id (best-effort; falls back to a dot). */
function OnlinePip({studentId}: {studentId: number}) {
  const {groupId, presence} = useGroup();
  const [name, setName] = useState<string | null>(null);
  const [hue, setHue] = useState(260);
  useEffect(() => {
    let alive = true;
    api.groups
      .memberProfile(groupId, studentId)
      .then((profile) => {
        if (!alive) return;
        setName(profile.student.name);
        setHue(profile.student.avatar_hue);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, studentId]);
  const status = (presence[String(studentId)] ?? 'online') as PresenceStatus;
  if (!name) return <span className="block size-7 rounded-full bg-white/10 ring-2 ring-mint-400/40" />;
  return (
    <span className="relative block">
      <span className="grid size-7 place-items-center rounded-full text-[0.62rem] font-black text-ink-950" style={{background: `hsl(${hue} 70% 65%)`}}>
        {name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
      </span>
      <PresenceDot status={status} className="absolute -right-0.5 -bottom-0.5" />
    </span>
  );
}

export default function Group({
  groupId,
  section,
  onExit,
  onOpenQuiz,
  onOpenDuel,
  onSection,
}: {
  groupId: number;
  section: GroupSection;
  onExit: () => void;
  onOpenQuiz: (quizId: number) => void;
  onOpenDuel: (duelId: number) => void;
  onSection: (section: GroupSection) => void;
}) {
  const {profile, toast, on} = useSession();
  const room = useGroupRoom(groupId);
  const [group, setGroup] = useState<StudyGroupSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, PresenceStatus>>({});
  const [unread, setUnread] = useState(0);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [intent, setIntent] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.groups
      .detail(groupId)
      .then((payload) => {
        setGroup(payload);
        setLoadError(null);
        setUnread(payload.unread_notifications ?? 0);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, [groupId]);

  useEffect(refresh, [refresh]);

  /* Seed presence + unread from the join snapshot. */
  useEffect(() => {
    if (!room.snapshot) return;
    setPresence(room.snapshot.presence?.statuses ?? {});
    setUnread(room.snapshot.unread_notifications ?? 0);
  }, [room.snapshot]);

  /* Live presence deltas. */
  useEffect(
    () =>
      room.on('group_presence', (data) => {
        const payload = data as {statuses?: Record<string, PresenceStatus>; student_id?: number; status?: PresenceStatus};
        if (payload.statuses) setPresence((prev) => ({...prev, ...payload.statuses}));
        else if (payload.student_id != null && payload.status) setPresence((prev) => ({...prev, [String(payload.student_id)]: payload.status as PresenceStatus}));
      }),
    [room],
  );

  /* Anything that changes the group shell (rename, member count, unread). */
  useEffect(() => room.on('group_updated', refresh), [room, refresh]);
  useEffect(() => room.on('group_member_update', refresh), [room, refresh]);

  /* Group notifications are delivered to the student's personal socket, not the
     room, so the bell listens on the session bus and only counts this group. */
  useEffect(
    () =>
      on('group_notification', (data) => {
        const payload = data as {group_id?: number};
        if (payload.group_id === groupId) setUnread((prev) => prev + 1);
      }),
    [on, groupId],
  );

  const onlineIds = useMemo(
    () => Object.entries(presence).filter(([, status]) => status === 'online' || status === 'away').map(([id]) => Number(id)),
    [presence],
  );

  const go = useCallback(
    (next: GroupSection, nextIntent?: string) => {
      setIntent(nextIntent ?? null);
      setMemberId(null);
      onSection(next);
    },
    [onSection],
  );

  const notify = useCallback((kind: 'success' | 'error' | 'info', title: string, detail?: string) => toast(kind, title, detail), [toast]);

  const ctx: GroupCtx | null = group
    ? {
        groupId,
        group,
        myId: profile?.id ?? 0,
        myName: profile?.name ?? '',
        can: (action: string) => canDo(group, action),
        isStaff: canDo(group, 'set_quiz') || canDo(group, 'publish_announcements') || canDo(group, 'remove_members'),
        room,
        presence,
        onlineIds,
        refresh,
        go,
        intent,
        clearIntent: () => setIntent(null),
        openQuiz: onOpenQuiz,
        openDuel: onOpenDuel,
        openMember: (studentId: number) => setMemberId(studentId),
        notify,
      }
    : null;

  if (loadError) {
    return (
      <div className="aurora grid min-h-dvh place-items-center p-6">
        <Card className="max-w-sm p-5 text-center">
          <p className="text-[1rem] font-extrabold text-mist-50">Could not open this group</p>
          <p className="mt-1 text-[0.82rem] font-medium text-mist-400">{loadError}</p>
          <Button className="mt-3" variant="outline" onClick={onExit}>Back</Button>
        </Card>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="aurora grid min-h-dvh place-items-center p-6">
        <div className="flex flex-col items-center gap-3">
          <span className="tf-orb grid size-14 place-items-center rounded-full border-2 border-black/35 bg-gradient-to-br from-nova-300 to-nova-600 text-ink-950">
            <Users className="size-6" />
          </span>
          <Chip className="border-white/12 bg-white/6 text-mist-400">Opening the study group…</Chip>
        </div>
      </div>
    );
  }

  return (
    <GroupProvider value={ctx}>
      <Workspace section={section} memberId={memberId} clearMember={() => setMemberId(null)} unread={unread} onExit={onExit} />
    </GroupProvider>
  );
}
