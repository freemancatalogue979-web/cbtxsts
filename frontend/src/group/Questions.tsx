/**
 * The group Q&A board. Members ask questions (course/topic, details, optional
 * image), others answer and reply, the asker or a moderator marks the best
 * answer. Search + filter + server-side pagination keep it from becoming one
 * endless scroll. Asking and reading a thread are real work, so they are
 * in-section pages, not modals.
 */
import {ArrowLeft, CheckCircle2, Image as ImageIcon, MessageCircleQuestion, Plus, Search, ThumbsUp} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Pager, SectionHeading, Segmented, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {useGroup} from './context';
import {MemberAvatar} from './bits';
import type {Course, GroupQuestionItem, GroupQuestionReply, PageMeta} from '../lib/types';

type Filter = 'all' | 'unanswered' | 'answered' | 'mine';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 380_000) {
      reject(new Error('Image too large (keep it under ~380 KB).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function AskForm({onDone, onCancel}: {onDone: () => void; onCancel: () => void}) {
  const {groupId, notify} = useGroup();
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [courseId, setCourseId] = useState<number | ''>('');
  const [topic, setTopic] = useState('');
  const [attachment, setAttachment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.courses().then(setCourses).catch(() => setCourses([]));
  }, []);

  const submit = async () => {
    if (title.trim().length < 5) {
      notify('error', 'Add a clear title', 'At least 5 characters so others know what you need.');
      return;
    }
    setBusy(true);
    try {
      await api.groups.askQuestion(groupId, {
        title: title.trim(),
        body: body.trim(),
        course_id: courseId === '' ? null : Number(courseId),
        topic: topic.trim(),
        attachment,
      });
      notify('success', 'Question posted', 'The group can see it now.');
      onDone();
    } catch (error) {
      notify('error', 'Could not post', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} icon={<ArrowLeft className="size-4" />}>Back</Button>
        <h2 className="text-[1rem] font-extrabold text-mist-50">Ask the group</h2>
      </div>
      <Card className="grid gap-3 p-4">
        <Field label="Question">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Can someone explain this part of Wuthering Heights?" maxLength={220} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
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
          <Field label="Topic (optional)">
            <TextInput value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Chapter 9" maxLength={120} />
          </Field>
        </div>
        <Field label="Details">
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Add context so members can help…" maxLength={4000} />
        </Field>
        <Field label="Attach an image (optional)">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/4 px-3 py-2 text-[0.78rem] font-semibold text-mist-400 hover:border-nova-400/40">
            <ImageIcon className="size-4" />
            {attachment ? 'Image attached — tap to replace' : 'Choose an image'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                readFileAsDataUrl(file)
                  .then(setAttachment)
                  .catch((err: Error) => notify('error', 'Attach failed', err.message));
              }}
            />
          </label>
        </Field>
        {attachment && <img src={attachment} alt="attachment preview" className="max-h-40 rounded-xl border border-white/10 object-contain" />}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void submit()} disabled={busy} icon={<Plus className="size-4" />}>
            {busy ? 'Posting…' : 'Post question'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

function ReplyRow({reply, question, onChanged}: {reply: GroupQuestionReply; question: GroupQuestionItem; onChanged: () => void}) {
  const {groupId, myId, can, notify} = useGroup();
  const isAsker = question.is_mine;
  const canMarkBest = isAsker || can('moderate_questions');

  const toggleUseful = async () => {
    try {
      await api.groups.usefulAnswer(groupId, question.id, reply.id);
      onChanged();
    } catch (error) {
      notify('error', 'Could not update', (error as Error).message);
    }
  };
  const markBest = async () => {
    try {
      await api.groups.bestAnswer(groupId, question.id, reply.id);
      onChanged();
    } catch (error) {
      notify('error', 'Could not mark best', (error as Error).message);
    }
  };

  return (
    <li className={`rounded-xl border px-3 py-2.5 ${reply.is_best ? 'border-mint-500/40 bg-mint-500/8' : 'border-white/8 bg-ink-900/50'}`}>
      <div className="flex items-start gap-2">
        <MemberAvatar member={reply.author} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.78rem] font-bold text-mist-100">{reply.author?.name ?? 'Member'}</span>
            {reply.is_best && <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200" icon={<CheckCircle2 className="size-3" />}>Best answer</Chip>}
            <span className="ml-auto shrink-0 text-[0.64rem] font-semibold text-mist-600">{formatRelative(reply.created_at)}</span>
          </div>
          <p className="mt-1 text-[0.82rem] leading-snug font-medium break-words text-mist-200">{reply.body}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleUseful()}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-bold transition-colors ${
                reply.marked_useful ? 'border-nova-400/50 bg-nova-500/20 text-nova-100' : 'border-white/12 bg-white/5 text-mist-400 hover:border-nova-400/30'
              }`}
            >
              <ThumbsUp className="size-3" /> Useful · {reply.useful_count}
            </button>
            {canMarkBest && (
              <button type="button" onClick={() => void markBest()} className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/5 px-2 py-0.5 text-[0.7rem] font-bold text-mist-400 hover:border-mint-400/40 hover:text-mint-200">
                <CheckCircle2 className="size-3" /> {reply.is_best ? 'Unmark best' : 'Mark best'}
              </button>
            )}
            {reply.author?.id === myId && <span className="text-[0.66rem] font-semibold text-mist-600">your reply</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

function QuestionDetail({questionId, onBack}: {questionId: number; onBack: () => void}) {
  const {groupId, room, notify} = useGroup();
  const [question, setQuestion] = useState<GroupQuestionItem | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.groups.question(groupId, questionId).then(setQuestion).catch(() => setQuestion(null));
  }, [groupId, questionId]);

  useEffect(load, [load]);
  useEffect(() => room.on('group_question_update', (data) => { if ((data as {question_id?: number}).question_id === questionId) load(); }), [room, questionId, load]);

  const submit = async () => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.groups.answerQuestion(groupId, questionId, {body});
      setReply('');
      load();
    } catch (error) {
      notify('error', 'Could not reply', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!question) return <Skeleton className="m-4 h-64 w-auto" />;
  const replies = [...(question.replies ?? [])].sort((a, b) => Number(b.is_best) - Number(a.is_best));

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-y-auto p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Questions</Button>
      </div>

      <Card className="p-4">
        <div className="flex items-start gap-2">
          <MemberAvatar member={question.asker} size={34} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[1rem] font-black text-mist-50">{question.title}</h2>
            <p className="mt-0.5 text-[0.72rem] font-semibold text-mist-500">
              {question.asker?.name ?? 'Member'} · {formatRelative(question.created_at)}
              {[question.course_title, question.topic].filter(Boolean).length > 0 && ` · ${[question.course_title, question.topic].filter(Boolean).join(' · ')}`}
            </p>
          </div>
          {question.status === 'open' ? (
            <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200">Open</Chip>
          ) : (
            <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Answered</Chip>
          )}
        </div>
        {question.body && <p className="mt-2 text-[0.85rem] leading-relaxed font-medium break-words text-mist-200">{question.body}</p>}
        {question.attachment && <img src={question.attachment} alt="question attachment" className="mt-2 max-h-64 rounded-xl border border-white/10 object-contain" />}
      </Card>

      <div className="grid gap-2">
        <h3 className="text-[0.82rem] font-black tracking-wide text-mist-400">{question.answers_count} replies</h3>
        <ul className="grid gap-2">
          {replies.map((row) => (
            <ReplyRow key={row.id} reply={row} question={question} onChanged={load} />
          ))}
          {replies.length === 0 && <li className="text-[0.8rem] font-medium text-mist-600">No answers yet — be the first to help.</li>}
        </ul>
      </div>

      <Card className="p-3">
        <div className="flex items-end gap-2">
          <TextArea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Write an answer or reply…" maxLength={4000} />
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !reply.trim()} className="shrink-0">
            {busy ? 'Posting…' : 'Reply'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function Questions() {
  const {groupId, can, room, intent, clearIntent} = useGroup();
  const [view, setView] = useState<'list' | 'ask' | 'detail'>('list');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<GroupQuestionItem[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (intent === 'create' && can('ask_questions')) {
      setView('ask');
      clearIntent();
    }
  }, [intent, can, clearIntent]);

  const load = useCallback(() => {
    setLoading(true);
    api.groups
      .questions(groupId, {filter, q: search, page, size: 10})
      .then((payload) => {
        setItems(payload.items);
        setMeta(payload);
      })
      .finally(() => setLoading(false));
  }, [groupId, filter, search, page]);

  useEffect(() => {
    const id = window.setTimeout(load, search ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, search]);
  useEffect(() => room.on('group_question', () => { if (view === 'list') load(); }), [room, load, view]);

  if (view === 'ask')
    return (
      <AskForm
        onCancel={() => setView('list')}
        onDone={() => {
          setView('list');
          setPage(1);
          load();
        }}
      />
    );
  if (view === 'detail' && detailId) return <QuestionDetail questionId={detailId} onBack={() => setView('list')} />;

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <SectionHeading
        title="Questions"
        subtitle="Ask, answer and resolve together"
        icon={<MessageCircleQuestion className="size-4" />}
        action={can('ask_questions') ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setView('ask')}>Ask</Button> : undefined}
      />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist-600" />
        <TextInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search questions…" className="pl-9" />
      </div>
      <Segmented
        value={filter}
        onChange={(value) => { setFilter(value); setPage(1); }}
        options={[
          {value: 'all', label: 'All'},
          {value: 'unanswered', label: 'Unanswered'},
          {value: 'answered', label: 'Answered'},
          {value: 'mine', label: 'My questions'},
        ]}
      />

      {loading && !items.length ? (
        <div className="grid gap-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<MessageCircleQuestion className="size-5" />} title="No questions" detail={can('ask_questions') ? 'Ask the first question.' : 'Nothing posted yet.'} />
      ) : (
        <ul className="grid gap-2">
          {items.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => { setDetailId(row.id); setView('detail'); }} className="w-full text-left">
                <Card className="flex items-start gap-3 p-3.5 transition-colors hover:border-nova-400/40">
                  <MemberAvatar member={row.asker} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-[0.88rem] font-extrabold text-mist-50">{row.title}</h3>
                      {row.status === 'open' ? (
                        <Chip className="shrink-0 border-gold-500/30 bg-gold-500/12 text-gold-200">Open</Chip>
                      ) : (
                        <Chip className="shrink-0 border-mint-500/30 bg-mint-500/12 text-mint-200">
                          {row.resolved ? 'Resolved' : 'Answered'}
                        </Chip>
                      )}
                    </div>
                    {row.body && <p className="mt-0.5 line-clamp-2 text-[0.76rem] font-medium text-mist-400">{row.body}</p>}
                    <p className="mt-1 flex items-center gap-2 text-[0.7rem] font-semibold text-mist-500">
                      <span>{row.asker?.name?.split(' ')[0]}</span>
                      <span>· {formatRelative(row.created_at)}</span>
                      <span className="inline-flex items-center gap-1">· <MessageCircleQuestion className="size-3" /> {row.answers_count}</span>
                      {[row.course_title, row.topic].filter(Boolean).length > 0 && <span className="truncate">· {[row.course_title, row.topic].filter(Boolean).join(' · ')}</span>}
                    </p>
                  </div>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.pages > 1 && <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Question pages" />}
    </div>
  );
}
