/**
 * Materials — the reading half of the Study → Game loop.
 *
 * Library search, "continue reading", the block reader with highlights / notes /
 * bookmarks, confusion reports, the class discussion and the server-graded
 * self-test. Read time is what unlocks Game Arena playtime, which is why the
 * reader keeps a quiet heartbeat while a section is on screen.
 */
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Flame,
  GraduationCap,
  Highlighter,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  Play,
  Quote,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Trophy,
  Video,
  XCircle,
  Zap,
  ExternalLink,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Card, Chip, EmptyState, Modal, ProgressBar, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {DifficultyChip, QuestionCard} from '../components/QuestionCard';
import Character from '../components/Character';
import {AnswerFeedback, AnswerTile} from '../components/GameQuestion';
import {api} from '../lib/api';
import {OPEN_MATERIAL_EVENT} from '../lib/palette';
import {formatNumber} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {studyRewards} from '../lib/rewards';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';
import type {
  MaterialBlock,
  MaterialCard,
  MaterialDetail,
  MaterialPost,
  MyLearning,
  PlaytimeBank,
  QuestionPublic,
} from '../lib/types';

type View = 'library' | 'mine' | 'reader' | 'test' | 'glossary';
const HIGHLIGHT_COLOURS: {id: 'yellow' | 'blue' | 'green' | 'red'; label: string; className: string}[] = [
  {id: 'yellow', label: 'Key point', className: 'bg-gold-400/30'},
  {id: 'blue', label: 'Definition', className: 'bg-nova-400/30'},
  {id: 'green', label: 'Example', className: 'bg-mint-400/30'},
  {id: 'red', label: 'Confusing', className: 'bg-flare-400/30'},
];

const ACCENTS: Record<string, string> = {
  violet: 'border-nova-500/30 bg-nova-500/12 text-nova-300',
  gold: 'border-gold-500/30 bg-gold-500/12 text-gold-300',
  mint: 'border-mint-500/30 bg-mint-500/12 text-mint-300',
  flare: 'border-flare-500/30 bg-flare-500/12 text-flare-300',
};

/* ---------------------------------------------------------------- blocks */

function Block({block, onHighlight, colourOf}: {block: MaterialBlock; onHighlight?: (text: string) => void; colourOf?: (text: string) => string | null}) {
  const selectable = (text?: string) =>
    text ? (
      <span
        className={`cursor-text rounded px-0.5 transition-colors ${
          colourOf?.(text) ? `${HIGHLIGHT_COLOURS.find((c) => c.id === colourOf(text))?.className ?? 'bg-gold-400/30'}` : 'hover:bg-white/6'
        }`}
        onDoubleClick={() => onHighlight?.(text)}
        title="Double-tap or select to highlight"
      >
        {text}
      </span>
    ) : null;

  switch (block.type) {
    case 'heading':
      return <h2 className="mt-1 break-words text-[1.15rem] font-black leading-snug text-mist-50 sm:text-[1.3rem]">{selectable(block.text)}</h2>;
    case 'subheading':
      return <h3 className="mt-1 break-words text-[1rem] font-extrabold text-mist-100">{selectable(block.text)}</h3>;
    case 'list':
    case 'numbers':
      return (
        <ul className={`space-y-1.5 pl-5 ${block.type === 'numbers' ? 'list-decimal' : 'list-disc'} marker:text-nova-400`}>
          {(block.items ?? []).map((item, index) => (
            <li key={index} className="break-words text-[0.92rem] leading-relaxed text-mist-300">
              {selectable(item)}
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[18rem] border-collapse overflow-hidden rounded-xl text-left text-[0.84rem]">
            {block.head?.length ? (
              <thead>
                <tr className="bg-white/6">
                  {block.head.map((cell, index) => (
                    <th key={index} className="px-2.5 py-2 font-extrabold text-mist-100">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {(block.rows ?? []).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-white/8 odd:bg-white/[0.02]">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="break-words px-2.5 py-2 align-top text-mist-300">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'keyterm':
      return (
        <div className="rounded-xl border border-nova-500/25 bg-nova-500/8 p-3">
 <p className="flex items-center gap-1.5 text-[0.72rem] font-black tracking-wide text-nova-300">
            <Star className="size-3.5" /> {block.term}
          </p>
          <p className="mt-1 text-[0.9rem] leading-relaxed text-mist-200">{block.meaning}</p>
        </div>
      );
    case 'definition':
      return (
        <div className="rounded-xl border-l-2 border-nova-400/60 bg-white/[0.03] p-3">
          {block.title ? <p className="text-[0.8rem] font-black text-mist-100">{block.title}</p> : null}
          <p className="text-[0.9rem] leading-relaxed text-mist-300">{selectable(block.text)}</p>
        </div>
      );
    case 'note':
    case 'tip':
      return (
        <div className="flex gap-2.5 rounded-xl border border-mint-500/25 bg-mint-500/8 p-3">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-mint-300" />
          <p className="min-w-0 text-[0.9rem] leading-relaxed text-mint-100/90">
            {block.title ? <span className="font-black">{block.title}: </span> : null}
            {block.text}
          </p>
        </div>
      );
    case 'example':
      return (
        <div className="rounded-xl border border-gold-500/25 bg-gold-500/8 p-3">
 <p className="text-[0.72rem] font-black tracking-wide text-gold-300">Example</p>
          <p className="mt-1 text-[0.9rem] leading-relaxed text-mist-200">{block.text}</p>
        </div>
      );
    case 'summary':
      return (
        <div className="rounded-xl border border-white/12 bg-white/[0.04] p-3">
 <p className="text-[0.72rem] font-black tracking-wide text-mist-400">Summary</p>
          <p className="mt-1 text-[0.9rem] leading-relaxed text-mist-200">{block.text}</p>
        </div>
      );
    case 'quote':
      return (
        <blockquote className="flex gap-2.5 border-l-2 border-nova-400/50 pl-3 text-[0.92rem] leading-relaxed text-mist-300 italic">
          <Quote className="mt-0.5 size-4 shrink-0 text-nova-400/70" />
          <span className="min-w-0 break-words">{block.text}</span>
        </blockquote>
      );
    case 'reference':
      return (
        <p className="flex items-start gap-2 text-[0.82rem] leading-relaxed text-mist-400">
          <Link2 className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{block.text}</span>
        </p>
      );
    case 'image':
      return (
        <figure className="overflow-hidden rounded-xl border border-white/10">
          {block.url ? <img src={block.url} alt={block.caption || ''} loading="lazy" className="h-auto w-full object-cover" /> : (
            <div className="flex items-center gap-2 bg-white/[0.03] p-3 text-mist-500">
              <ImageIcon className="size-4" /> <span className="text-[0.8rem]">Image unavailable</span>
            </div>
          )}
          {block.caption ? <figcaption className="px-3 py-2 text-[0.76rem] text-mist-500">{block.caption}</figcaption> : null}
        </figure>
      );
    case 'video':
      return (
        <a
          href={block.url || '#'}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-xl border border-nova-500/25 bg-nova-500/8 p-3 text-[0.86rem] font-bold text-nova-200"
        >
          <Video className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{block.title || block.url}</span>
        </a>
      );
    case 'attachment':
      return (
        <a
          href={block.url || '#'}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.03] p-3 text-[0.86rem] font-bold text-mist-200"
        >
          <FileText className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{block.caption || block.url}</span>
        </a>
      );
    case 'divider':
      return <hr className="border-white/10" />;
    default:
      return <p className="break-words text-[0.94rem] leading-relaxed text-mist-300">{selectable(block.text)}</p>;
  }
}

/* ----------------------------------------------------------------- cards */

function MaterialTile({material, onOpen, accent = 'violet'}: {material: MaterialCard; onOpen: () => void; accent?: string}) {
  const percent = material.progress?.percent ?? 0;
  return (
    <motion.button
      variants={staggerItem}
      whileTap={{scale: 0.98}}
      onClick={() => {
        sfx.play('tap');
        onOpen();
      }}
      className="card min-w-0 p-3.5 text-left transition-colors hover:border-white/20"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${ACCENTS[accent] ?? ACCENTS.violet}`}>
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[0.92rem] font-extrabold leading-snug text-mist-50">{material.title}</p>
          <p className="mt-0.5 truncate text-[0.72rem] font-bold text-mist-500">
            {material.topic || material.course_title || 'General'} · {material.section_count} sections · {material.estimated_minutes} min
          </p>
        </div>
      </div>
      {material.description ? <p className="mt-2 line-clamp-2 text-[0.78rem] leading-snug text-mist-400">{material.description}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Chip className={ACCENTS[accent] ?? ACCENTS.violet}>{material.difficulty}</Chip>
        {(material.tags ?? []).slice(0, 2).map((tag) => (
          <Chip key={tag} className="border-white/10 bg-white/4 text-mist-400">
            {tag}
          </Chip>
        ))}
        {percent > 0 && <Chip className="border-mint-500/25 bg-mint-500/12 text-mint-300">{percent}% read</Chip>}
      </div>
      {percent > 0 && <ProgressBar className="mt-2.5" value={percent} />}
    </motion.button>
  );
}

function BankStrip({bank, streak}: {bank: PlaytimeBank | null; streak?: {current: number} | null}) {
  if (!bank) return null;
  const remaining = Math.max(0, bank.remaining_seconds);
  const minutes = Math.round(remaining / 60);
  const next = bank.thresholds.find((threshold) => threshold > bank.study_xp_today);
  return (
    <Card className="relative overflow-hidden p-3.5">
      <div className="pointer-events-none absolute -top-14 -right-8 size-36 rounded-full bg-nova-500/14 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-nova-500/30 bg-nova-500/12">
          <Play className="size-4 text-nova-300" />
        </span>
        <div className="min-w-0">
 <p className="text-[0.72rem] font-black tracking-wide text-mist-500">Arena time unlocked</p>
          <p className="text-[1.05rem] font-black text-mist-50 tabular">{minutes} min left today</p>
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip className="border-gold-500/25 bg-gold-500/12 text-gold-300">{bank.study_xp_today} study XP today</Chip>
          <Chip className="border-mint-500/25 bg-mint-500/12 text-mint-300">
            <Flame className="size-3" /> {streak?.current ?? 0} day streak
          </Chip>
        </div>
      </div>
      <ProgressBar className="mt-2.5" value={next ? Math.min(100, (bank.study_xp_today / next) * 100) : 100} />
      <p className="mt-1.5 text-[0.72rem] font-semibold text-mist-500">
        {next
          ? `${next - bank.study_xp_today} more Study XP unlocks another ${Math.round(bank.seconds_per_threshold / 60)} minutes.`
          : 'Every study goal unlocked today — bank is full up to the daily cap.'}
      </p>
    </Card>
  );
}

/* --------------------------------------------------------------- reader */

function Reader({
  material,
  onBack,
  onToast,
  onProfileRefresh,
}: {
  material: MaterialDetail;
  onBack: () => void;
  onToast: (kind: 'success' | 'error', title: string, body?: string) => void;
  onProfileRefresh: () => void;
}) {
  const {pushRewards} = useSession();
  const [detail, setDetail] = useState(material);
  const [bank, setBank] = useState<PlaytimeBank | null>(null);
  const [bankBusy, setBankBusy] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(material.progress?.last_section_id ?? material.sections[0]?.id ?? null);
  const [marks, setMarks] = useState({highlights: material.highlights, notes: material.notes, bookmarks: material.bookmarks});
  const [draft, setDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [colour, setColour] = useState<'yellow' | 'blue' | 'green' | 'red'>('yellow');
  const [highlightTarget, setHighlightTarget] = useState('');
  const [showMarks, setShowMarks] = useState(false);
  const [confusion, setConfusion] = useState({open: false, text: '', busy: false});
  const [discussion, setDiscussion] = useState<MaterialPost[]>([]);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sectionsRef = useRef<Record<number, HTMLElement | null>>({});
  // Notes the lecturer attached to this material (separate from the player's own marks).
  const [view, setView] = useState<'read' | 'staff'>('read');
  const [staffNotes, setStaffNotes] = useState<MaterialDetail[] | null>(null);
  useEffect(() => {
    let live = true;
    api.materials
      .staffNotes(material.id)
      .then((payload) => live && setStaffNotes(payload.notes ?? []))
      .catch(() => live && setStaffNotes([]));
    return () => {
      live = false;
    };
  }, [material.id]);
  const activeSection = detail.sections.find((section) => section.id === activeId) ?? detail.sections[0] ?? null;

  const visited = useMemo(() => new Set(detail.progress?.visited ?? []), [detail.progress]);

  const colourOf = useCallback(
    (text: string) => marks.highlights.find((row) => row.text === text)?.colour ?? null,
    [marks.highlights],
  );

  /* ---- progress heartbeat: time on a section is what pays study XP ---- */
  useEffect(() => {
    if (!activeSection) return undefined;
    let seconds = 0;
    const tick = window.setInterval(() => {
      seconds += 5;
      void api.materials
        .progress(detail.id, {section_id: activeSection.id, seconds: 5})
        .then((payload) => {
          setDetail((current) => ({...current, progress: payload.progress}));
          setBank(payload.playtime);
          setBankBusy(false);
          const gained = (payload.rewards ?? []).filter((row) => (row.awarded ?? 0) > 0);
          if (gained.length) {
            sfx.play('coin');
            pushRewards(studyRewards(gained));
            onProfileRefresh();
            if ((payload.rewards ?? []).some((row) => (row.playtime_unlocked ?? []).length > 0)) {
              onToast('success', 'Arena time unlocked', 'Your reading just bought more game time.');
            }
          }
        })
        .catch(() => {
          /* a dropped heartbeat is harmless — the next one carries on */
        });
    }, 5000);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection?.id, detail.id]);

  useEffect(() => {
    void api.materials.read(detail.id).then((payload) => {
      setDetail(payload);
      setMarks({highlights: payload.highlights, notes: payload.notes, bookmarks: payload.bookmarks});
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  const openDiscussion = async () => {
    setDiscussionOpen(true);
    try {
      const payload = await api.materials.discussion(detail.id);
      setDiscussion(payload.posts ?? []);
    } catch (error) {
      onToast('error', 'Discussion unavailable', (error as Error).message);
    }
  };

  const addHighlight = async (text: string, chosen?: 'yellow' | 'blue' | 'green' | 'red') => {
    const clean = text.trim().slice(0, 600);
    if (clean.length < 3) {
      onToast('error', 'Select a little more text');
      return;
    }
    try {
      const row = await api.materials.highlight(detail.id, {text: clean, colour: chosen ?? colour, section_id: activeSection?.id ?? null});
      setMarks((current) => ({...current, highlights: [...current.highlights, row]}));
      setHighlightTarget('');
      sfx.play('tap');
    } catch (error) {
      onToast('error', 'Could not save the highlight', (error as Error).message);
    }
  };

  const removeHighlight = async (id: number) => {
    await api.materials.removeHighlight(detail.id, id).catch(() => undefined);
    setMarks((current) => ({...current, highlights: current.highlights.filter((row) => row.id !== id)}));
  };

  const saveNote = async () => {
    if (!noteDraft.trim()) return;
    try {
      const row = await api.materials.note(detail.id, {body: noteDraft.trim(), section_id: activeSection?.id ?? null, quote: highlightTarget});
      setMarks((current) => ({...current, notes: [row, ...current.notes]}));
      setNoteDraft('');
      sfx.play('tap');
    } catch (error) {
      onToast('error', 'Could not save the note', (error as Error).message);
    }
  };

  const toggleBookmark = async () => {
    if (!activeSection) return;
    const existing = marks.bookmarks.find((row) => row.section_id === activeSection.id);
    if (existing) {
      await api.materials.removeBookmark(detail.id, existing.id).catch(() => undefined);
      setMarks((current) => ({...current, bookmarks: current.bookmarks.filter((row) => row.id !== existing.id)}));
      return;
    }
    const row = await api.materials
      .bookmark(detail.id, {section_id: activeSection.id, label: activeSection.title, snippet: (activeSection.blocks?.[0]?.text ?? '').slice(0, 200)})
      .catch(() => null);
    if (row) setMarks((current) => ({...current, bookmarks: [row, ...current.bookmarks]}));
  };

  const sendConfusion = async () => {
    setConfusion((current) => ({...current, busy: true}));
    try {
      const row = await api.materials.confusion(detail.id, {
        section_id: activeSection?.id ?? null,
        quote: highlightTarget.slice(0, 400),
        question: confusion.text.trim().slice(0, 600),
      });
      onToast('success', 'Sent to the class', 'A classmate or your tutor can pick this up.');
      setConfusion({open: false, text: '', busy: false});
      setDiscussion((current) => [
        {id: row.id, body: confusion.text.trim(), kind: 'question', section_id: activeSection?.id ?? null, name: 'You'},
        ...current,
      ]);
    } catch (error) {
      setConfusion((current) => ({...current, busy: false}));
      onToast('error', 'Could not send that', (error as Error).message);
    }
  };

  const sendPost = async (kind: 'question' | 'tip' | 'answer', parentId?: number) => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const row = await api.materials.post(detail.id, {
        body: draft.trim(),
        section_id: activeSection?.id ?? null,
        kind,
        parent_id: parentId ?? null,
        quote: highlightTarget.slice(0, 400),
      });
      setDiscussion((current) => [
        {id: row.id, body: row.body, kind: row.kind, section_id: activeSection?.id ?? null, name: 'You', parent_id: parentId ?? null},
        ...current,
      ]);
      if (row.reward) pushRewards([row.reward]);
      setDraft('');
      sfx.play('tap');
    } catch (error) {
      onToast('error', 'Could not post', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendFeedback = async (verdict: 'yes' | 'somewhat' | 'no') => {
    setFeedbackSent(true);
    await api.materials.feedback(detail.id, {verdict}).catch(() => undefined);
    if (verdict !== 'no') onToast('success', 'Thanks!', 'Your feedback tunes this material for everyone.');
    else onToast('success', 'Noted', 'Use “Confused here” to ask the class about the exact bit.');
  };

  const markRead = async () => {
    if (!activeSection) return;
    setBankBusy(true);
    const payload = await api.materials.progress(detail.id, {section_id: activeSection.id, seconds: 15}).catch(() => null);
    setBankBusy(false);
    if (payload) {
      setDetail((current) => ({...current, progress: payload.progress}));
      setBank(payload.playtime);
      const gained = (payload.rewards ?? []).filter((row) => (row.awarded ?? 0) > 0);
      if (gained.length) {
        pushRewards(studyRewards(gained));
        onProfileRefresh();
        sfx.play('coin');
      }
      setDetail((current) => ({...current, progress: payload.progress}));
      const next = detail.sections.find((section) => !payload.progress.visited.includes(section.id));
      if (next) setActiveId(next.id);
      if (payload.progress.status === 'completed') onToast('success', 'Material completed', 'Nice — that whole topic is banked.');
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Library
        </Button>
        <div className="min-w-0 flex-1" />
        <Button variant="ghost" size="sm" icon={<BookmarkCheck className="size-4" />} onClick={() => setShowMarks(true)}>
          My marks ({marks.highlights.length + marks.notes.length})
        </Button>
      </div>

      <Card className="relative min-w-0 overflow-hidden p-4">
        <div className="pointer-events-none absolute -top-20 -right-10 size-44 rounded-full bg-nova-500/14 blur-3xl" />
        <div className="relative min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip className={ACCENTS[detail.accent] ?? ACCENTS.violet}>{detail.topic || 'General'}</Chip>
            <Chip className="border-white/10 bg-white/4 text-mist-400">{detail.difficulty}</Chip>
            <Chip className="border-white/10 bg-white/4 text-mist-400">
              <Clock3 className="size-3" /> {detail.estimated_minutes} min
            </Chip>
            {detail.streak?.current ? (
              <Chip className="border-gold-500/25 bg-gold-500/12 text-gold-300">
                <Flame className="size-3" /> {detail.streak.current} day streak
              </Chip>
            ) : null}
          </div>
          <h1 className="mt-2 text-[1.15rem] font-black leading-tight text-mist-50 sm:text-[1.4rem]">{detail.title}</h1>
          {detail.description ? <p className="mt-1 text-[0.86rem] leading-relaxed text-mist-400">{detail.description}</p> : null}
          {detail.link_url ? (
            <a
              href={detail.link_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-xl border border-nova-500/30 bg-nova-500/10 px-3 text-[0.8rem] font-bold text-nova-100 hover:bg-nova-500/20"
            >
              <ExternalLink className="size-4 shrink-0" />
              <span className="truncate">{detail.link_url.startsWith('/api/material-files/') ? 'Open the original document' : 'Open attached resource'}</span>
            </a>
          ) : null}
          <div className="mt-3 flex min-w-0 items-center gap-2.5">
            <ProgressBar className="min-w-0 flex-1" value={detail.progress?.percent ?? 0} />
            <span className="shrink-0 text-[0.78rem] font-black text-mist-200 tabular">{detail.progress?.percent ?? 0}%</span>
          </div>
          {detail.summary?.length ? (
            <ul className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              {detail.summary.map((point, index) => (
                <li key={index} className="flex gap-2 text-[0.82rem] leading-snug text-mist-300">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-gold-300" />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<ListChecks className="size-4" />} onClick={() => setActiveId(activeSection?.id ?? null)}>
              Reading
            </Button>
            <Button size="sm" variant="soft" icon={<Target className="size-4" />} onClick={() => setShowMarks(false)}>
              {detail.questions?.linked ?? 0} linked questions
            </Button>
            <Button size="sm" variant="outline" icon={<MessagesSquare className="size-4" />} onClick={openDiscussion}>
              Class discussion
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Layers className="size-4" />}
              onClick={async () => {
                try {
                  const deck = await api.materials.flashcards(detail.id);
                  sfx.play('coin');
                  onToast(
                    'success',
                    deck.created ? 'Flashcard deck created' : 'Deck already ready',
                    `${deck.cards} cards · open Study Lab → Decks to flip them.`,
                  );
                } catch (error) {
                  onToast('error', 'Could not build flashcards', (error as Error).message);
                }
              }}
            >
              Flashcards
            </Button>
          </div>
        </div>
      </Card>

      <BankStrip bank={bank} streak={detail.streak} />

      {staffNotes?.length ? (
        <Segmented
          value={view}
          onChange={setView}
          options={[
            {value: 'read', label: 'Reading', icon: BookOpen},
            {value: 'staff', label: `Lecturer notes (${staffNotes.length})`, icon: NotebookPen},
          ]}
        />
      ) : null}

      {view === 'staff' && staffNotes ? (
        <div className="min-w-0 space-y-3">
          {staffNotes.map((note) => (
            <Card key={note.id} className="min-w-0 p-4">
              <div className="flex min-w-0 items-start gap-2">
                <NotebookPen className="mt-0.5 size-4 shrink-0 text-nova-300" />
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-[0.98rem] font-black text-mist-50">{note.title}</h2>
                  <p className="text-[0.7rem] font-bold text-mist-500">
                    {note.topic || detail.topic || 'General'}
                    {note.author ? ` · ${note.author}` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-3 min-w-0 space-y-3">
                {(note.sections ?? []).map((section) => (
                  <div key={section.id} className="min-w-0 space-y-3">
                    {(note.sections?.length ?? 0) > 1 ? <h3 className="text-[0.9rem] font-extrabold text-mist-100">{section.title}</h3> : null}
                    {(section.blocks ?? []).map((block, index) => (
                      <Block key={index} block={block} />
                    ))}
                  </div>
                ))}
              </div>
              {note.link_url ? (
                <a
                  href={note.link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-xl border border-nova-500/30 bg-nova-500/10 px-3 text-[0.8rem] font-bold text-nova-100"
                >
                  <ExternalLink className="size-4 shrink-0" />
                  <span className="truncate">{note.link_url.startsWith('/api/material-files/') ? 'Open the original document' : 'Open attached resource'}</span>
                </a>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {view === 'read' && (
        <>
      {/* section tabs */}
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {detail.sections.map((section) => (
          <button
            key={section.id}
            onClick={() => {
              setActiveId(section.id);
              sectionsRef.current[section.id]?.scrollIntoView({behavior: 'smooth', block: 'start'});
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.76rem] font-bold transition-colors ${
              section.id === activeId ? 'border-nova-400/50 bg-nova-500/20 text-nova-100' : 'border-white/10 bg-white/[0.03] text-mist-400'
            }`}
          >
            {visited.has(section.id) ? <Star className="size-3 text-mint-300" /> : <span className="tabular">{section.position}</span>}
            <span className="max-w-[9rem] truncate">{section.title}</span>
          </button>
        ))}
      </div>

      {/* blocks */}
      <div className="min-w-0 space-y-3.5">
        {detail.sections.map((section) => (
          <section
            key={section.id}
            ref={(node) => {
              sectionsRef.current[section.id] = node;
            }}
            className={`card min-w-0 scroll-mt-20 p-4 ${section.id === activeId ? 'ring-1 ring-nova-400/30' : ''}`}
            onFocus={() => setActiveId(section.id)}
            onClick={() => setActiveId(section.id)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/12 bg-white/6 text-[0.72rem] font-black text-mist-200 tabular">
                {section.position}
              </span>
              <h2 className="min-w-0 flex-1 truncate text-[0.98rem] font-black text-mist-50">{section.title}</h2>
              <span className="shrink-0 text-[0.68rem] font-bold text-mist-500">{section.estimated_minutes ?? 3} min</span>
            </div>

            <div className="mt-3 min-w-0 space-y-3">
              {(section.blocks ?? []).map((block, index) => (
                <Block
                  key={index}
                  block={block}
                  colourOf={colourOf}
                  onHighlight={(text) => {
                    setHighlightTarget(text);
                    void addHighlight(text);
                  }}
                />
              ))}
            </div>

            <div className="mt-3.5 flex min-w-0 flex-wrap items-center gap-2 border-t border-white/8 pt-3">
              <Button
                size="sm"
                variant={visited.has(section.id) && detail.progress.last_section_id === section.id ? 'mint' : 'outline'}
                icon={<CheckMark />}
                loading={bankBusy}
                onClick={markRead}
              >
                {visited.has(section.id) ? 'Read again' : 'Mark as read'}
              </Button>
              <Button size="sm" variant="ghost" icon={<Bookmark className="size-4" />} onClick={toggleBookmark}>
                {marks.bookmarks.some((row) => row.section_id === section.id) ? 'Bookmarked' : 'Bookmark'}
              </Button>
              <Button size="sm" variant="ghost" icon={<TriangleAlert className="size-4" />} onClick={() => setConfusion({open: true, text: '', busy: false})}>
                Confused here
              </Button>
              <span className="ml-auto text-[0.7rem] font-bold text-mist-600">{section.words ? `${formatNumber(section.words)} words` : ''}</span>
            </div>
          </section>
        ))}
      </div>
        </>
      )}

      <Card className="min-w-0 p-4">
        <SectionHeading
          title="Highlights & notes"
          subtitle={highlightTarget ? 'Selected text is ready to mark up.' : 'Double-tap any sentence to highlight it.'}
        />
        <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5">
          {HIGHLIGHT_COLOURS.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setColour(option.id);
                if (highlightTarget) void addHighlight(highlightTarget, option.id);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-bold transition-colors ${
                colour === option.id ? 'border-nova-400/50 bg-nova-500/18 text-nova-100' : 'border-white/12 bg-white/[0.03] text-mist-400'
              }`}
            >
              <span className={`size-2.5 rounded-full ${option.className}`} />
              {option.label}
            </button>
          ))}
          {highlightTarget ? (
            <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setHighlightTarget('')}>
              Clear selection
            </Button>
          ) : null}
        </div>

        <div className="mt-3 min-w-0 space-y-2">
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={2}
            placeholder="Write a note for yourself…"
            className="w-full min-w-0 resize-y rounded-xl border border-white/12 bg-ink-950/60 p-3 text-[0.86rem] text-mist-100 outline-none placeholder:text-mist-600 focus:border-nova-400/50"
          />
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button size="sm" variant="soft" icon={<NotebookPen className="size-4" />} onClick={saveNote} disabled={!noteDraft.trim()}>
              Save note
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Send className="size-4" />}
              onClick={() => {
                void openDiscussion();
                setDiscussionOpen(true);
              }}
            >
              Ask the class
            </Button>
          </div>
        </div>

        {marks.notes.length ? (
          <ul className="mt-3 min-w-0 space-y-1.5">
            {marks.notes.slice(0, 4).map((note) => (
              <li key={note.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                <NotebookPen className="mt-0.5 size-3.5 shrink-0 text-gold-300" />
                <span className="min-w-0 flex-1 text-[0.82rem] leading-snug text-mist-300">{note.body}</span>
                <button onClick={() => void api.materials.removeNote(detail.id, note.id).then(() => setMarks((c) => ({...c, notes: c.notes.filter((row) => row.id !== note.id)})))} className="shrink-0 text-mist-600 hover:text-flare-400">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {!feedbackSent ? (
        <Card className="min-w-0 p-4">
          <SectionHeading title="Was this helpful?" subtitle="One tap — it tunes the material for the next reader." />
          <div className="mt-2.5 flex min-w-0 flex-wrap gap-2">
            <Button size="sm" variant="mint" icon={<ThumbsUp className="size-4" />} onClick={() => void sendFeedback('yes')}>
              Yes
            </Button>
            <Button size="sm" variant="outline" icon={<CircleHelp className="size-4" />} onClick={() => void sendFeedback('somewhat')}>
              Sort of
            </Button>
            <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => void sendFeedback('no')}>
              Not really
            </Button>
          </div>
        </Card>
      ) : null}

      {/* confusion sheet */}
      <Modal open={confusion.open} onClose={() => setConfusion({open: false, text: '', busy: false})} title="Confused here?" subtitle="Send it to the class — someone will explain it.">
        <div className="min-w-0 space-y-3">
          {highlightTarget ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-[0.8rem] text-mist-400 italic">“{highlightTarget}”</p>
          ) : null}
          <textarea
            value={confusion.text}
            onChange={(event) => setConfusion((current) => ({...current, text: event.target.value}))}
            rows={3}
            placeholder="What exactly is unclear?"
            className="w-full min-w-0 rounded-xl border border-white/12 bg-ink-950/60 p-3 text-[0.88rem] text-mist-100 outline-none placeholder:text-mist-600 focus:border-nova-400/50"
          />
          <Button block variant="primary" icon={<Send className="size-4" />} loading={confusion.busy} disabled={!confusion.text.trim()} onClick={() => void sendConfusion()}>
            Send to the class
          </Button>
        </div>
      </Modal>

      {/* marks sheet */}
      <Modal open={showMarks} onClose={() => setShowMarks(false)} title="My marks" subtitle={`${marks.highlights.length} highlights · ${marks.notes.length} notes · ${marks.bookmarks.length} bookmarks`}>
        <div className="min-w-0 space-y-3">
          {marks.bookmarks.length ? (
            <div className="min-w-0">
 <p className="text-[0.72rem] font-black tracking-wide text-mist-500">Bookmarks</p>
              <ul className="mt-1.5 space-y-1.5">
                {marks.bookmarks.map((row) => (
                  <li key={row.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <Bookmark className="size-3.5 shrink-0 text-gold-300" />
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">{row.label || `Section ${row.section_id}`}</span>
                    <button
                      onClick={() => {
                        if (row.section_id) setActiveId(row.section_id);
                        setShowMarks(false);
                      }}
                      className="shrink-0 text-[0.72rem] font-black text-nova-300"
                    >
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {marks.highlights.length ? (
            <div className="min-w-0">
 <p className="text-[0.72rem] font-black tracking-wide text-mist-500">Highlights</p>
              <ul className="mt-1.5 space-y-1.5">
                {marks.highlights.map((row) => (
                  <li key={row.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <Highlighter className="mt-0.5 size-3.5 shrink-0 text-nova-300" />
                    <span className="min-w-0 flex-1 text-[0.82rem] leading-snug text-mist-300">{row.text}</span>
                    <button onClick={() => void removeHighlight(row.id)} className="shrink-0 text-mist-600 hover:text-flare-400">
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!marks.bookmarks.length && !marks.highlights.length && !marks.notes.length ? (
            <EmptyState icon={<Highlighter className="size-5" />} title="Nothing marked yet" detail="Double-tap a sentence in the reader to highlight it." />
          ) : null}
        </div>
      </Modal>

      {/* discussion sheet */}
      <Modal open={discussionOpen} onClose={() => setDiscussionOpen(false)} title="Class discussion" subtitle="Questions, answers and tips from everyone reading this material.">
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask or explain something…"
              className="min-w-0 flex-1 rounded-xl border border-white/12 bg-ink-950/60 px-3 py-2.5 text-[0.86rem] text-mist-100 outline-none placeholder:text-mist-600 focus:border-nova-400/50"
            />
            <Button size="sm" variant="primary" icon={<Send className="size-4" />} loading={busy} disabled={!draft.trim()} onClick={() => void sendPost('question')}>
              Post
            </Button>
          </div>
          {discussion.length ? (
            <ul className="min-w-0 space-y-2">
              {discussion.map((post) => (
                <li key={post.id} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <p className="flex items-center gap-1.5 text-[0.7rem] font-black text-mist-500">
                    <Zap className="size-3 text-nova-300" /> {post.name ?? 'Classmate'}
                    <span className="font-bold text-mist-600">· {post.kind}</span>
                  </p>
                  <p className="mt-1 text-[0.84rem] leading-snug text-mist-200">{post.body}</p>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => {
                        setDraft(`@${post.name ?? 'classmate'} `);
                      }}
                      className="text-[0.7rem] font-black text-nova-300"
                    >
                      Reply
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<MessagesSquare className="size-5" />} title="No posts yet" detail="Be the first to ask — confusion is a group activity." />
          )}
        </div>
      </Modal>
    </div>
  );
}

function CheckMark() {
  return <ListChecks className="size-4" />;
}

/* -------------------------------------------------------------- self test */

function SelfTest({
  material,
  onBack,
  onToast,
}: {
  material: MaterialDetail;
  onBack: () => void;
  onToast: (kind: 'success' | 'error', title: string, body?: string) => void;
}) {
  const {pushRewards} = useSession();
  const [questions, setQuestions] = useState<QuestionPublic[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{is_correct: boolean; correct: string; explanation: string} | null>(null);
  const [tally, setTally] = useState({right: 0, wrong: 0});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setIndex(0);
    setPicked(null);
    setVerdict(null);
    setTally({right: 0, wrong: 0});
    try {
      const payload = await api.materials.selfTest(material.id, 5);
      setQuestions(payload.questions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [material.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const question = questions[index];

  const answer = async (letter: string) => {
    if (!question || picked) return;
    setPicked(letter);
    try {
      const payload = await api.materials.selfTestAnswer(material.id, {question_id: question.id, choice: letter});
      setVerdict({is_correct: payload.is_correct, correct: payload.correct, explanation: payload.explanation});
      setTally((current) => ({right: current.right + (payload.is_correct ? 1 : 0), wrong: current.wrong + (payload.is_correct ? 0 : 1)}));
      sfx.play(payload.is_correct ? 'correct' : 'wrong');
      if (payload.reward) pushRewards([payload.reward]);
    } catch (err) {
      setPicked(null);
      onToast('error', 'Could not grade that', (err as Error).message);
    }
  };

  const next = () => {
    setPicked(null);
    setVerdict(null);
    setIndex((current) => current + 1);
  };

  const done = !loading && questions.length > 0 && index >= questions.length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-3.5">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
        Back to the material
      </Button>
      <Card className="min-w-0 p-4">
        <SectionHeading title="Test myself" subtitle={`${material.title} · graded on the server against the stored key`} />
        {loading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : error ? (
          <EmptyState icon={<TriangleAlert className="size-5" />} title="No questions yet" detail={error} action={<Button size="sm" variant="soft" icon={<RotateCcw className="size-4" />} onClick={() => void load()}>Try again</Button>} />
        ) : done ? (
          <div className="mt-3 min-w-0">
            <p className="text-[1rem] font-black text-mist-50">
              {tally.right}/{questions.length} right
            </p>
            <ProgressBar className="mt-2" value={(tally.right / Math.max(1, questions.length)) * 100} />
            <p className="mt-2 text-[0.82rem] text-mist-400">
              {tally.right === questions.length ? 'Flawless — that topic is yours.' : 'Every wrong one is worth a re-read of the section it came from.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => void load()}>
                Another round
              </Button>
              <Button size="sm" variant="outline" onClick={onBack}>
                Back to reading
              </Button>
            </div>
          </div>
        ) : question ? (
          <div className="mt-3 min-w-0 space-y-3">
            <div className="flex items-center justify-between text-[0.72rem] font-black text-mist-500">
              <span>
                Question {index + 1} of {questions.length}
              </span>
              <span className="tabular text-mint-300">{tally.right} right</span>
            </div>
            <ProgressBar value={(index / questions.length) * 100} />
            <QuestionCard
              number={index + 1}
              className="min-w-0"
              chips={
                <>
                  <DifficultyChip level={question.difficulty} />
                  <Chip>{question.points ?? 1} pt</Chip>
                </>
              }
              text={question.text}
              aside={<Character mood={verdict ? (verdict.is_correct ? 'cheer' : 'sad') : 'idle'} size={48} tone="day" className="hidden sm:inline-block" label="Arena hero" />}
            >
              <div className="mt-3.5 grid gap-2">
                {(['A', 'B', 'C', 'D'] as const)
                  .filter((key) => question.options[key])
                  .map((key) => {
                    const chosen = picked === key;
                    const isKey = verdict?.correct === key;
                    const wrongPick = Boolean(verdict) && chosen && !verdict?.is_correct;
                    return (
                      <AnswerTile
                        key={key}
                        letter={key}
                        text={question.options[key]}
                        disabled={Boolean(picked)}
                        state={
                          wrongPick ? 'wrong' : isKey && verdict ? 'correct' : chosen ? 'picked' : 'idle'
                        }
                        onPick={() => void answer(key)}
                      />
                    );
                  })}
              </div>
            </QuestionCard>
            <AnimatePresence>
              {verdict ? (
                <motion.div initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} className="mt-3 min-w-0">
                  <AnswerFeedback
                    correct={verdict.is_correct}
                    chosen={picked}
                    answer={verdict.correct}
                    note={verdict.explanation || undefined}
                    action={
                      <Button size="sm" variant="soft" icon={<ChevronRight className="size-4" />} onClick={next}>
                        {index + 1 >= questions.length ? 'See results' : 'Next question'}
                      </Button>
                    }
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : (
          <EmptyState icon={<ListChecks className="size-5" />} title="Nothing to test" detail="Link questions to this material in the studio first." />
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- container */

export default function MaterialsPanel() {
  const {toast, refreshProfile} = useSession();
  const [view, setView] = useState<View>('library');
  const [library, setLibrary] = useState<MaterialCard[]>([]);
  const [mine, setMine] = useState<MyLearning | null>(null);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [bank, setBank] = useState<PlaytimeBank | null>(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [topics, setTopics] = useState<{topic: string; count: number}[]>([]);
  const [glossary, setGlossary] = useState<{term: string; meaning: string; material_id: number; material_title: string}[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [payload, learning, hub] = await Promise.all([
        api.materials.library({search: term, topic, difficulty, limit: 60}),
        api.materials.mine(),
        api.game.hub(),
      ]);
      setLibrary(payload.items ?? []);
      setTopics(payload.topics ?? []);
      setMine(learning);
      setBank(hub.playtime);
    } catch (error) {
      toast('error', 'Could not load materials', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [term, topic, difficulty, toast]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), term ? 320 : 0);
    return () => window.clearTimeout(id);
  }, [load, term]);

  /* The command palette can deep-link straight into a material. */
  useEffect(() => {
    const handler = (event: Event) => {
      const id = Number((event as CustomEvent).detail);
      if (!id) return;
      setView('library');
      void openMaterial(id);
    };
    window.addEventListener(OPEN_MATERIAL_EVENT, handler);
    return () => window.removeEventListener(OPEN_MATERIAL_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openMaterial = async (id: number) => {
    setLoading(true);
    try {
      const payload = await api.materials.read(id);
      setDetail(payload);
      setView('reader');
    } catch (error) {
      toast('error', 'Could not open that material', (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openGlossary = async () => {
    setView('glossary');
    try {
      const payload = await api.materials.glossary(topic);
      setGlossary(payload.terms ?? []);
    } catch (error) {
      toast('error', 'Glossary unavailable', (error as Error).message);
    }
  };

  if (view === 'reader' && detail) {
    return (
      <Reader
        material={detail}
        onBack={() => {
          setView('library');
          void load();
        }}
        onToast={toast}
        onProfileRefresh={() => void refreshProfile()}
      />
    );
  }

  if (view === 'test' && detail) {
    return <SelfTest material={detail} onBack={() => setView('reader')} onToast={toast} />;
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SectionHeading title="Materials" subtitle="Read now, play later — reading time unlocks the arena." />
        <Button size="sm" variant="ghost" icon={<BookOpen className="size-4" />} onClick={() => void openGlossary()}>
          Glossary
        </Button>
      </div>

      <BankStrip bank={bank} streak={mine ? {current: 0} : null} />

      <Segmented
        value={view === 'mine' ? 'mine' : 'library'}
        options={[
          {value: 'library', label: 'Library', icon: BookOpen},
          {value: 'mine', label: 'My learning', icon: GraduationCap},
        ]}
        onChange={(value) => setView(value as View)}
      />

      {view === 'glossary' ? (
        <Card className="min-w-0 p-4">
          <SectionHeading title="Glossary" subtitle="Every key term your materials define." action={<Button size="sm" variant="ghost" onClick={() => setView('library')}>Close</Button>} />
          {glossary.length ? (
            <ul className="mt-2.5 divide-y divide-white/8">
              {glossary.map((row, index) => (
                <li key={`${row.term}-${index}`} className="flex min-w-0 flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="shrink-0 text-[0.86rem] font-black text-nova-200">{row.term}</span>
                  <span className="min-w-0 flex-1 text-[0.82rem] leading-snug text-mist-300">{row.meaning}</span>
                  <button onClick={() => void openMaterial(row.material_id)} className="shrink-0 text-left text-[0.7rem] font-black text-mist-500 hover:text-nova-300">
                    {row.material_title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<BookOpen className="size-5" />} title="No terms yet" detail="Add key-term blocks to a material and they land here automatically." />
          )}
        </Card>
      ) : view === 'mine' ? (
        <div className="min-w-0 space-y-3.5">
          {mine ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                {label: 'Reading', value: mine.summary.reading, icon: BookOpen},
                {label: 'Completed', value: mine.summary.completed, icon: Trophy},
                {label: 'Minutes read', value: mine.summary.minutes, icon: Clock3},
                {label: 'Highlights', value: mine.summary.bookmarks + mine.summary.notes, icon: Highlighter},
              ].map((tile) => (
                <Card key={tile.label} className="min-w-0 p-3">
                  <tile.icon className="size-4 text-nova-300" />
                  <p className="mt-1.5 text-[1.05rem] font-black text-mist-50 tabular">{formatNumber(tile.value)}</p>
 <p className="text-[0.68rem] font-bold tracking-wide text-mist-500">{tile.label}</p>
                </Card>
              ))}
            </div>
          ) : null}

          <Card className="min-w-0 p-4">
            <SectionHeading title="Continue reading" subtitle="Pick up exactly where you stopped." />
            {mine?.continue_reading?.length ? (
              <motion.div variants={staggerContainer} initial="hidden" animate="show" className="mt-2.5 grid min-w-0 gap-2.5 sm:grid-cols-2">
                {mine.continue_reading.map((row) => (
                  <MaterialTile key={row.material_id} material={{...row, id: row.material_id} as MaterialCard} onOpen={() => void openMaterial(row.material_id)} />
                ))}
              </motion.div>
            ) : (
              <EmptyState icon={<BookOpen className="size-5" />} title="Nothing in progress" detail="Open a material from the library and it will wait for you here." />
            )}
          </Card>

          {mine?.confusions?.length ? (
            <Card className="min-w-0 p-4">
              <SectionHeading title="Waiting on answers" subtitle="Your confusion reports the class can still explain." />
              <ul className="mt-2.5 space-y-1.5">
                {mine.confusions.map((row) => (
                  <li key={row.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-flare-300" />
                    <span className="min-w-0 flex-1 text-[0.82rem] leading-snug text-mist-300">{row.question || row.title}</span>
                    <button onClick={() => void openMaterial(row.material_id)} className="shrink-0 text-[0.7rem] font-black text-nova-300">
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/12 bg-ink-950/60 px-3 py-2.5">
              <Search className="size-4 shrink-0 text-mist-500" />
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search materials, topics, tags…"
                className="min-w-0 flex-1 bg-transparent text-[0.88rem] text-mist-100 outline-none placeholder:text-mist-600"
              />
              {term ? (
                <button onClick={() => setTerm('')} className="shrink-0 text-mist-500">
                  <XCircle className="size-4" />
                </button>
              ) : null}
            </label>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
              className="min-w-0 rounded-xl border border-white/12 bg-ink-950/60 px-2.5 py-2.5 text-[0.82rem] font-bold text-mist-200 outline-none"
            >
              <option value="">Any level</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          {topics.length ? (
            <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
              <button
                onClick={() => setTopic('')}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.74rem] font-bold ${!topic ? 'border-nova-400/50 bg-nova-500/20 text-nova-100' : 'border-white/10 bg-white/[0.03] text-mist-400'}`}
              >
                All topics
              </button>
              {topics.map((row) => (
                <button
                  key={row.topic}
                  onClick={() => setTopic(row.topic)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.74rem] font-bold ${
                    topic === row.topic ? 'border-nova-400/50 bg-nova-500/20 text-nova-100' : 'border-white/10 bg-white/[0.03] text-mist-400'
                  }`}
                >
                  {row.topic} · {row.count}
                </button>
              ))}
            </div>
          ) : null}

          {loading ? (
            <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} className="h-32 w-full" />
              ))}
            </div>
          ) : library.length ? (
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid min-w-0 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {library.map((row) => (
                <MaterialTile key={row.id} material={row} accent={row.accent} onOpen={() => void openMaterial(row.id)} />
              ))}
            </motion.div>
          ) : (
            <EmptyState
              icon={<Layers className="size-5" />}
              title={term ? 'Nothing matches that search' : 'No materials published yet'}
              detail={term ? 'Try a different word or clear the filters.' : 'Staff can publish materials from the content studio.'}
              action={
                term ? (
                  <Button size="sm" variant="soft" onClick={() => setTerm('')}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}

      {detail && view === 'library' ? (
        <Button block variant="soft" icon={<Target className="size-4" />} onClick={() => setView('test')}>
          Continue to the self-test
        </Button>
      ) : null}
    </div>
  );
}
