/**
 * AI Tutor — ask anything about what you're learning.
 *
 * Streaming chats with memory, context from the course / question / material
 * the student came from, quick actions, flashcards, practice quizzes and study
 * material. All AI calls go through our backend (limits are enforced there;
 * this screen only shows them).
 */
import {
  BookOpen, Bot, Brain, CalendarCheck, Copy, FileText, GraduationCap, History, ImagePlus, Layers, Lightbulb,
  ListChecks, Lock, MessageSquarePlus, MoreHorizontal, Paperclip, Pencil, RefreshCw, Save, Send, Sparkles, Square,
  Target, Trash2, X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Modal, Select, Skeleton, copyText} from '../components/ui';
import {DeckView, GenerateSheet, LibraryView, MaterialView, NotesView, QuizView, type GenRequest, type ToolState} from '../components/tutor/TutorTools';
import {Markdown} from '../lib/markdown';
import {formatRelative} from '../lib/format';
import {
  ASK_TUTOR_EVENT, readImage, streamMessage, takePendingAsk, tutorApi, type Conversation, type GenKind, type SavedItem,
  type TutorAsk, type TutorContext, type TutorCourse, type TutorMessage, type TutorMode, type TutorStatus, type TutorUpload,
} from '../lib/tutor';
import {useSession} from '../store/session';

const LAST_CHAT_KEY = 'arena.tutor.chat';

const EXAMPLES: {label: string; prompt: string; mode?: TutorMode; gen?: GenKind; icon: typeof Bot}[] = [
  {label: 'Explain this topic', prompt: 'Explain this topic to me clearly.', mode: 'EXPLAIN', icon: Lightbulb},
  {label: 'Why is this answer correct?', prompt: 'Why is this answer correct?', mode: 'QUESTION_HELP', icon: Target},
  {label: 'Teach me from the beginning', prompt: 'Teach me this from the beginning.', mode: 'TEACH', icon: GraduationCap},
  {label: 'Give me an example', prompt: 'Give me a clear, real-life example.', mode: 'EXAMPLE', icon: Sparkles},
  {label: 'Make flashcards', prompt: '', gen: 'flashcards', icon: Layers},
  {label: 'Create practice questions', prompt: '', gen: 'practice', icon: ListChecks},
  {label: 'Summarize this material', prompt: 'Summarize this material.', mode: 'SUMMARY', icon: BookOpen},
  {label: 'Make a study plan', prompt: 'Make me a realistic study plan.', mode: 'STUDY_PLAN', icon: CalendarCheck},
  {label: 'What am I getting wrong?', prompt: 'What am I getting wrong, and what should I study next?', mode: 'WHAT_TO_STUDY', icon: Brain},
  {label: "Explain it like I'm a beginner", prompt: "Explain it like I'm a complete beginner.", mode: 'SIMPLE', icon: Bot},
];

const QUICK: {label: string; mode: TutorMode; prompt: string}[] = [
  {label: 'Explain this', mode: 'EXPLAIN', prompt: 'Explain this.'},
  {label: 'Teach me', mode: 'TEACH', prompt: 'Teach me this as a short lesson.'},
  {label: 'Explain simply', mode: 'SIMPLE', prompt: 'Explain it more simply.'},
  {label: 'Example', mode: 'EXAMPLE', prompt: 'Give me an example.'},
  {label: 'Notes', mode: 'NOTES', prompt: 'Turn this into clear study notes.'},
  {label: 'Glossary', mode: 'GLOSSARY', prompt: 'Make a glossary of the key terms.'},
  {label: 'What should I study?', mode: 'WHAT_TO_STUDY', prompt: 'What should I study next?'},
];

interface Attached {
  context: TutorContext;
  label: string;
}

export default function TutorPanel() {
  const {toast} = useSession();
  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [courses, setCourses] = useState<TutorCourse[]>([]);
  const [uploads, setUploads] = useState<TutorUpload[]>([]);
  const [chats, setChats] = useState<Conversation[] | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [topic, setTopic] = useState('');
  const [attached, setAttached] = useState<Attached | null>(null);
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [gen, setGen] = useState<{kind: GenKind; text?: string} | null>(null);
  const [tool, setTool] = useState<ToolState | null>(null);
  const [library, setLibrary] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const docInput = useRef<HTMLInputElement | null>(null);
  const pendingSend = useRef<TutorAsk | null>(null);

  const refreshStatus = useCallback(() => tutorApi.status().then(setStatus).catch(() => undefined), []);
  const refreshChats = useCallback(() => tutorApi.conversations().then((r) => setChats(r.conversations)).catch(() => setChats([])), []);

  const openChat = useCallback(async (id: number | null) => {
    abortRef.current?.abort();
    setChatId(id);
    setTool(null);
    setLibrary(false);
    setHistoryOpen(false);
    if (id) localStorage.setItem(LAST_CHAT_KEY, String(id));
    else localStorage.removeItem(LAST_CHAT_KEY);
    if (!id) {
      setMessages([]);
      return;
    }
    setLoadingChat(true);
    try {
      const convo = await tutorApi.conversation(id);
      setMessages(convo.messages);
      if (convo.course_id) setCourseId(convo.course_id);
      if (convo.topic) setTopic(convo.topic);
    } catch {
      setMessages([]);
      setChatId(null);
      localStorage.removeItem(LAST_CHAT_KEY);
    } finally {
      setLoadingChat(false);
    }
  }, []);

  // first load
  useEffect(() => {
    refreshStatus();
    refreshChats();
    tutorApi.options().then((r) => {
      setCourses(r.courses);
      setUploads(r.uploads);
    }).catch(() => undefined);
    const ask = takePendingAsk();
    const last = Number(localStorage.getItem(LAST_CHAT_KEY)) || null;
    if (ask) applyAsk(ask);
    else if (last) void openChat(last);
    const onAsk = () => {
      const next = takePendingAsk();
      if (next) applyAsk(next);
    };
    window.addEventListener(ASK_TUTOR_EVENT, onAsk);
    return () => {
      window.removeEventListener(ASK_TUTOR_EVENT, onAsk);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyAsk = (ask: TutorAsk) => {
    if (ask.newChat !== false) {
      setChatId(null);
      setMessages([]);
      localStorage.removeItem(LAST_CHAT_KEY);
    }
    setTool(null);
    setLibrary(false);
    if (ask.context?.course_id) setCourseId(ask.context.course_id);
    if (ask.context?.topic) setTopic(ask.context.topic);
    const {course_id: _c, topic: _t, ...rest} = ask.context ?? {};
    setAttached(Object.keys(rest).length ? {context: rest, label: ask.label || 'Attached'} : null);
    if (ask.autoSend && ask.prompt) pendingSend.current = ask;
    else if (ask.prompt) setDraft(ask.prompt);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: streaming ? 'auto' : 'smooth'});
  }, [messages, streaming]);

  const topics = courses.find((c) => c.id === courseId)?.topics ?? [];
  const locked = status?.exam_locked ?? null;
  const unavailable = status && (!status.configured || !status.enabled);
  const remaining = status?.remaining_today ?? null;

  const send = useCallback(async (text: string, mode: TutorMode = 'CHAT', extra?: TutorContext, label?: string) => {
    const content = text.trim();
    if ((!content && !image) || streaming) return;
    if (locked) return toast('error', 'AI Tutor is paused', locked);
    let id = chatId;
    if (!id) {
      try {
        const convo = await tutorApi.createConversation({course_id: courseId, topic});
        id = convo.id;
        setChatId(id);
        localStorage.setItem(LAST_CHAT_KEY, String(id));
      } catch (error) {
        return toast('error', 'Could not start a chat', (error as Error).message);
      }
    }
    const context: TutorContext = {course_id: courseId, topic: topic || undefined, ...(attached?.context ?? {}), ...(extra ?? {})};
    const now = new Date().toISOString();
    const sentImage = image;
    const userMsg: TutorMessage = {id: -Date.now(), role: 'user', content: content || 'Explain this image.', type: 'chat', meta: {mode, ...(sentImage ? {image: true} : {}), ...(label || attached ? {label: label || attached?.label} : {})}, created_at: now};
    const botId = -Date.now() - 1;
    setMessages((m) => [...m, userMsg, {id: botId, role: 'assistant', content: '', type: 'chat', meta: {}, created_at: now, pending: true}]);
    setDraft('');
    setImage(null);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const patchBot = (patch: Partial<TutorMessage> | ((m: TutorMessage) => Partial<TutorMessage>)) =>
      setMessages((list) => list.map((m) => (m.id === botId ? {...m, ...(typeof patch === 'function' ? patch(m) : patch)} : m)));
    try {
      await streamMessage(
        id,
        {content, mode, context, image: sentImage},
        {
          onMeta: (meta) => {
            setMessages((list) => list.map((m) => (m.id === userMsg.id ? {...m, id: meta.user_message_id} : m)));
            setChats((list) => {
              const rest = (list ?? []).filter((c) => c.id !== meta.conversation_id);
              return [{id: meta.conversation_id, title: meta.title, course_id: courseId, topic, archived: false, created_at: now, last_message_at: now}, ...rest];
            });
          },
          onDelta: (piece) => patchBot((m) => ({content: m.content + piece})),
          onDone: (done) => {
            patchBot({id: done.message_id, pending: false, meta: {mode, finish: done.finish}});
            setStatus((s) => (s ? {...s, remaining_today: done.remaining_today, usage: {...s.usage, today: s.usage.today + 1}} : s));
          },
          onError: (detail, partial) => {
            patchBot((m) => ({pending: false, failed: true, content: partial && m.content ? `${m.content}\n\n_(answer cut off)_` : detail}));
            toast('error', 'The tutor hit a problem', detail);
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) patchBot((m) => ({pending: false, content: m.content ? `${m.content}\n\n_(stopped)_` : '_(stopped)_'}));
    } catch (error) {
      // Refused before streaming (limit, exam lock, AI down): put the text back for a retry.
      setMessages((list) => list.filter((m) => m.id !== botId && m.id !== userMsg.id));
      setDraft(content);
      if (sentImage) setImage(sentImage);
      toast('error', 'Not sent', (error as Error).message);
      refreshStatus();
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [attached, chatId, courseId, image, locked, refreshStatus, streaming, toast, topic]);

  // auto-send from the bridge once state has settled
  useEffect(() => {
    const ask = pendingSend.current;
    if (ask && status && !streaming) {
      pendingSend.current = null;
      void send(ask.prompt ?? '', ask.mode ?? 'CHAT', undefined, ask.label);
    }
  }, [status, streaming, send, attached]);

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  const runExample = (row: (typeof EXAMPLES)[number]) => {
    if (row.gen) return setGen({kind: row.gen});
    void send(row.prompt, row.mode);
  };

  const onPickImage = async (file?: File | null) => {
    if (!file) return;
    try {
      setImage(await readImage(file));
      inputRef.current?.focus();
    } catch (error) {
      toast('error', 'Image not added', (error as Error).message);
    }
  };

  const onPickDoc = async (file?: File | null) => {
    if (!file) return;
    if (file.type.startsWith('image/')) return onPickImage(file);
    setUploading(true);
    try {
      const up = await tutorApi.upload(file);
      const row = {id: up.id, title: up.title, sections: up.sections};
      setUploads((list) => [row, ...list]);
      setAttached({context: {upload_id: up.id}, label: up.title});
      toast('success', 'Upload ready', `${up.sections} parts · ${up.words.toLocaleString()} words. Ask anything about it.`);
    } catch (error) {
      toast('error', 'Upload failed', (error as Error).message);
    } finally {
      setUploading(false);
      if (docInput.current) docInput.current.value = '';
    }
  };

  const regenerate = async () => {
    if (!tool?.request) return;
    setRegenerating(true);
    try {
      const result = await tutorApi.generate(tool.request as GenRequest);
      setTool({kind: tool.request.kind, data: result.data, request: tool.request} as ToolState);
      setStatus((s) => (s ? {...s, remaining_today: result.remaining_today} : s));
    } catch (error) {
      toast('error', 'Could not regenerate', (error as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const openSaved = async (item: SavedItem) => {
    try {
      const full = await tutorApi.savedItem(item.id);
      setLibrary(false);
      setTool({kind: full.kind, data: full.data, savedId: full.id} as ToolState);
    } catch (error) {
      toast('error', 'Could not open it', (error as Error).message);
    }
  };

  const saveMessage = async (message: TutorMessage) => {
    const kind = message.type === 'study_plan' ? 'plan' : 'notes';
    const title = (lastUser?.content || 'Tutor notes').slice(0, 80);
    try {
      await tutorApi.save({kind, title, data: {title, content: message.content}, course_id: courseId, topic, conversation_id: chatId});
      toast('success', kind === 'plan' ? 'Study plan saved' : 'Saved to your notes');
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    }
  };

  const askFromTool = (prompt: string, mode: TutorMode = 'CHAT', context?: TutorContext, label?: string) => {
    setTool(null);
    setLibrary(false);
    if (context) {
      const {course_id: _c, topic: t, ...rest} = context;
      if (t) setTopic(t);
      if (Object.keys(rest).length) setAttached({context: rest, label: label || 'Attached'});
    }
    window.setTimeout(() => void send(prompt, mode, context, label), 0);
  };

  const meta = {course_id: courseId, topic, conversation_id: chatId};
  const toolView = useMemo(() => {
    if (!tool) return null;
    const common = {
      savedId: tool.savedId,
      request: tool.request,
      meta,
      onBack: () => setTool(null),
      onSaved: (id: number) => setTool((t) => (t ? ({...t, savedId: id} as ToolState) : t)),
      onRegenerate: tool.request ? regenerate : undefined,
      regenerating,
      onDeleted: () => setTool(null),
      onAsk: askFromTool,
    };
    const onChange = (data: unknown) => setTool((t) => (t ? ({...t, data} as ToolState) : t));
    if (tool.kind === 'flashcards') return <DeckView {...common} data={tool.data} onChange={onChange} />;
    if (tool.kind === 'practice') return <QuizView {...common} data={tool.data} onChange={onChange} />;
    if (tool.kind === 'material') return <MaterialView {...common} data={tool.data} onChange={onChange} />;
    return <NotesView {...common} kind={tool.kind} data={tool.data} onChange={onChange} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, regenerating, courseId, topic, chatId, send]);

  const chatList = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Button size="sm" block icon={<MessageSquarePlus className="size-4" />} onClick={() => { setAttached(null); void openChat(null); }}>New chat</Button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {chats === null ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)
        ) : chats.length ? (
          chats.map((c) => (
            <ChatRow
              key={c.id}
              chat={c}
              active={c.id === chatId}
              onOpen={() => void openChat(c.id)}
              onRename={async (title) => {
                try {
                  const next = await tutorApi.updateConversation(c.id, {title});
                  setChats((list) => (list ?? []).map((x) => (x.id === c.id ? {...x, title: next.title} : x)));
                } catch (error) {
                  toast('error', 'Could not rename', (error as Error).message);
                }
              }}
              onDelete={async () => {
                try {
                  await tutorApi.deleteConversation(c.id);
                  setChats((list) => (list ?? []).filter((x) => x.id !== c.id));
                  if (c.id === chatId) void openChat(null);
                  toast('info', 'Chat deleted');
                } catch (error) {
                  toast('error', 'Could not delete', (error as Error).message);
                }
              }}
            />
          ))
        ) : (
          <p className="px-1 py-4 text-center text-[0.78rem] text-mist-500">Your chats will appear here.</p>
        )}
      </div>
      <button onClick={() => { setHistoryOpen(false); setTool(null); setLibrary(true); }} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[0.8rem] font-bold text-mist-200 hover:bg-white/[0.06]">
        <Save className="size-4 text-nova-300" /> My library
      </button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.3)]">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.05rem] leading-tight font-extrabold text-mist-50 sm:text-lg">AI Tutor</h1>
          <p className="truncate text-[0.74rem] font-medium text-mist-500">Patient help that teaches, not just tells.</p>
        </div>
        {remaining !== null && status?.configured && (
          <span className={`rounded-full border px-2.5 py-1 text-[0.72rem] font-bold ${remaining <= 3 ? 'border-flare-400/40 text-flare-200' : 'border-white/10 text-mist-300'}`} title={`${status.usage.today} used today · ${status.usage.month} this month`}>
            {remaining} left today
          </span>
        )}
        <button className="grid size-9 place-items-center rounded-lg border border-white/10 text-mist-300 hover:bg-white/[0.06] lg:hidden" aria-label="Chats and library" onClick={() => setHistoryOpen(true)}>
          <History className="size-4.5" />
        </button>
      </div>

      {locked && (
        <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-gold-400/35 bg-gold-500/10 px-3 py-2.5 text-[0.82rem] text-gold-100">
          <Lock className="mt-0.5 size-4 shrink-0" /> {locked}
        </div>
      )}
      {unavailable && (
        <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2.5 text-[0.82rem] text-mist-300">
          <Bot className="mt-0.5 size-4 shrink-0" />
          {!status?.configured ? 'AI Tutor is not set up on this server yet — the arena staff need to add the AI key.' : 'AI Tutor is switched off by the arena staff right now.'}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="card hidden h-[calc(100dvh-11rem)] min-h-[28rem] flex-col p-2.5 lg:flex">{chatList}</aside>

        <section className="card flex h-[calc(100dvh-12.5rem)] min-h-[26rem] flex-col p-2.5 sm:p-3 lg:h-[calc(100dvh-11rem)]">
          {library ? (
            <LibraryView
              uploads={uploads}
              onBack={() => setLibrary(false)}
              onOpen={openSaved}
              uploading={uploading}
              onUpload={() => docInput.current?.click()}
              onUseUpload={(u) => { setLibrary(false); setAttached({context: {upload_id: u.id}, label: u.title}); inputRef.current?.focus(); }}
              onDeleteUpload={async (u) => {
                if (!window.confirm(`Delete "${u.title}"?`)) return;
                try {
                  await tutorApi.deleteUpload(u.id);
                  setUploads((list) => list.filter((x) => x.id !== u.id));
                  if (attached?.context.upload_id === u.id) setAttached(null);
                } catch (error) {
                  toast('error', 'Could not delete', (error as Error).message);
                }
              }}
            />
          ) : tool ? (
            toolView
          ) : (
            <>
              {/* context bar */}
              <div className="flex flex-wrap items-center gap-1.5 pb-2">
                <Select value={courseId ?? ''} onChange={(e) => { setCourseId(Number(e.target.value) || null); setTopic(''); }} className="!h-8 min-w-0 max-w-[11rem] flex-1 !py-0 text-[0.76rem] sm:flex-none" aria-label="Course">
                  <option value="">Any course</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                </Select>
                <input
                  list="tutor-topics"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Topic (optional)"
                  maxLength={120}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950/60 px-2.5 text-[0.76rem] text-mist-100 placeholder:text-mist-600 focus:border-nova-400/60 focus:outline-none sm:max-w-[14rem]"
                  aria-label="Topic"
                />
                <datalist id="tutor-topics">{topics.map((t) => <option key={t.id} value={t.name} />)}</datalist>
                {attached && (
                  <span className="flex max-w-full items-center gap-1 rounded-full border border-nova-400/40 bg-nova-500/15 py-1 pr-1 pl-2.5 text-[0.72rem] font-bold text-nova-100">
                    <Paperclip className="size-3 shrink-0" />
                    <span className="truncate">{attached.label}</span>
                    <button className="grid size-5 place-items-center rounded-full hover:bg-white/15" aria-label="Remove attachment" onClick={() => setAttached(null)}><X className="size-3" /></button>
                  </span>
                )}
              </div>

              {/* messages */}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5">
                {loadingChat ? (
                  <div className="space-y-3 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
                ) : messages.length === 0 ? (
                  <div className="mx-auto flex max-w-2xl flex-col items-center px-1 py-5 text-center sm:py-8">
                    <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white"><Bot className="size-6" /></span>
                    <h2 className="mt-3 text-[1.08rem] font-extrabold text-mist-50 sm:text-xl">Ask anything about what you're learning.</h2>
                    <p className="mt-1 max-w-md text-[0.8rem] text-mist-500">Pick a course or topic above for sharper answers — or attach a document or photo of a question.</p>
                    <div className="mt-4 grid w-full grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
                      {EXAMPLES.map((row) => (
                        <button key={row.label} disabled={!!locked || !!unavailable} onClick={() => runExample(row)} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-[0.8rem] font-bold text-mist-200 transition-colors enabled:hover:border-nova-400/40 enabled:hover:bg-nova-500/10 disabled:opacity-40">
                          <row.icon className="size-4 shrink-0 text-nova-300" />
                          <span className="min-w-0">{row.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 py-1">
                    {messages.map((m, i) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        last={i === messages.length - 1}
                        busy={streaming}
                        onFollow={(prompt, mode) => void send(prompt, mode)}
                        onSave={() => saveMessage(m)}
                        onFlashcards={() => setGen({kind: 'flashcards', text: m.content})}
                        onRetry={() => { if (lastUser) { setMessages((list) => list.slice(0, -2)); void send(lastUser.content, (lastUser.meta.mode as TutorMode) || 'CHAT'); } }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* quick actions */}
              {messages.length > 0 && !locked && (
                <div className="no-scrollbar -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pt-2">
                  {QUICK.map((q) => (
                    <button key={q.label} disabled={streaming} onClick={() => void send(q.prompt, q.mode)} className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[0.72rem] font-bold text-mist-300 hover:bg-white/[0.06] disabled:opacity-40">
                      {q.label}
                    </button>
                  ))}
                  <button disabled={streaming} onClick={() => setSummaryOpen(true)} className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[0.72rem] font-bold text-mist-300 hover:bg-white/[0.06] disabled:opacity-40">Summarize…</button>
                  <button disabled={streaming} onClick={() => setGen({kind: 'flashcards'})} className="shrink-0 rounded-full border border-nova-400/30 px-2.5 py-1 text-[0.72rem] font-bold text-nova-200 hover:bg-nova-500/10 disabled:opacity-40">Flashcards</button>
                  <button disabled={streaming} onClick={() => setGen({kind: 'practice'})} className="shrink-0 rounded-full border border-nova-400/30 px-2.5 py-1 text-[0.72rem] font-bold text-nova-200 hover:bg-nova-500/10 disabled:opacity-40">Practice me</button>
                  <button disabled={streaming} onClick={() => setGen({kind: 'material'})} className="shrink-0 rounded-full border border-nova-400/30 px-2.5 py-1 text-[0.72rem] font-bold text-nova-200 hover:bg-nova-500/10 disabled:opacity-40">Study material</button>
                </div>
              )}

              {/* composer */}
              <div className="pt-2">
                {image && (
                  <div className="mb-1.5 flex items-center gap-2">
                    <img src={image} alt="Attached" className="size-12 rounded-lg border border-white/15 object-cover" />
                    <button className="text-[0.74rem] font-bold text-mist-400 hover:text-flare-300" onClick={() => setImage(null)}>Remove image</button>
                  </div>
                )}
                <div className="flex items-end gap-1.5 rounded-2xl border border-white/12 bg-ink-950/70 p-1.5 focus-within:border-nova-400/60">
                  <ComposerMenu
                    disabled={!!locked || !!unavailable || streaming}
                    uploading={uploading}
                    onImage={() => imageInput.current?.click()}
                    onDoc={() => docInput.current?.click()}
                    onGen={(kind) => setGen({kind})}
                  />
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(min-width: 640px)').matches) {
                        e.preventDefault();
                        void send(draft);
                      }
                    }}
                    onPaste={(e) => {
                      const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
                      if (file) {
                        e.preventDefault();
                        void onPickImage(file);
                      }
                    }}
                    rows={1}
                    maxLength={status?.limits.max_message_chars ?? 4000}
                    disabled={!!locked || !!unavailable}
                    placeholder={locked ? 'Paused during your exam' : image ? 'What should I explain about this image?' : 'Ask the tutor…'}
                    className="max-h-40 min-h-[2.4rem] flex-1 resize-none bg-transparent px-1.5 py-2 text-[0.9rem] text-mist-50 placeholder:text-mist-600 focus:outline-none"
                    style={{fieldSizing: 'content'} as React.CSSProperties}
                    aria-label="Message"
                  />
                  {streaming ? (
                    <button onClick={() => abortRef.current?.abort()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-mist-100 hover:bg-white/15" aria-label="Stop answering">
                      <Square className="size-4 fill-current" />
                    </button>
                  ) : (
                    <button onClick={() => void send(draft)} disabled={(!draft.trim() && !image) || !!locked || !!unavailable} className="brand-gradient grid size-10 shrink-0 place-items-center rounded-xl text-white disabled:opacity-40" aria-label="Send">
                      <Send className="size-4" />
                    </button>
                  )}
                </div>
                <p className="mt-1 hidden px-1 text-[0.66rem] text-mist-600 sm:block">Enter to send · Shift+Enter for a new line · The tutor can make mistakes — check important facts with your materials.</p>
              </div>
            </>
          )}
        </section>
      </div>

      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { void onPickImage(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={docInput} type="file" accept=".pdf,.docx,.txt,.md,.pptx,.rtf,.odt,.html,.htm" className="hidden" onChange={(e) => void onPickDoc(e.target.files?.[0])} />

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Your chats" size="sm">
        <div className="flex h-[60dvh] flex-col">{chatList}</div>
      </Modal>

      <Modal open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Summarize" subtitle="Summaries use the attached material, upload or this chat." size="sm">
        <div className="grid gap-2">
          {([
            ['quick', 'Quick summary', 'A few key points'],
            ['detailed', 'Detailed summary', 'Section by section with the important details'],
            ['revision', 'Revision notes', 'Exam-focused notes: facts, definitions, what to remember'],
          ] as const).map(([value, label, hint]) => (
            <button key={value} onClick={() => { setSummaryOpen(false); void send(`Give me a ${label.toLowerCase()}.`, 'SUMMARY', {summary_length: value}); }} className="rounded-xl border border-white/10 px-3 py-2.5 text-left hover:bg-white/[0.06]">
              <p className="text-[0.86rem] font-bold text-mist-50">{label}</p>
              <p className="text-[0.74rem] text-mist-500">{hint}</p>
            </button>
          ))}
        </div>
      </Modal>

      <GenerateSheet
        open={!!gen}
        onClose={() => setGen(null)}
        initialKind={gen?.kind ?? 'flashcards'}
        conversationId={chatId && messages.length ? chatId : null}
        courses={courses}
        uploads={uploads}
        courseId={courseId}
        topic={topic}
        selectedText={gen?.text ?? attached?.context.selected_text}
        onResult={(next, left) => {
          setTool(next);
          setStatus((s) => (s ? {...s, remaining_today: left} : s));
        }}
      />
    </div>
  );
}

function ChatRow({chat, active, onOpen, onRename, onDelete}: {chat: Conversation; active: boolean; onOpen: () => void; onRename: (title: string) => void; onDelete: () => void}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`group relative flex items-center rounded-lg ${active ? 'bg-nova-500/15' : 'hover:bg-white/[0.05]'}`}>
      <button onClick={onOpen} className="min-w-0 flex-1 px-2.5 py-2 text-left">
        <span className={`block truncate text-[0.8rem] font-bold ${active ? 'text-white' : 'text-mist-200'}`}>{chat.title}</span>
        <span className="block truncate text-[0.66rem] text-mist-500">{formatRelative(chat.last_message_at)}</span>
      </button>
      <button className="grid size-8 shrink-0 place-items-center rounded-md text-mist-500 hover:text-mist-200" aria-label="Chat options" onClick={() => setMenu((v) => !v)}>
        <MoreHorizontal className="size-4" />
      </button>
      {menu && (
        <div className="absolute top-full right-1 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-white/10 bg-ink-900 shadow-xl" onMouseLeave={() => setMenu(false)}>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-[0.78rem] text-mist-200 hover:bg-white/[0.06]" onClick={() => { setMenu(false); const title = window.prompt('Rename chat', chat.title); if (title?.trim()) onRename(title.trim()); }}>
            <Pencil className="size-3.5" /> Rename
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-[0.78rem] text-flare-300 hover:bg-flare-500/10" onClick={() => { setMenu(false); if (window.confirm('Delete this chat?')) onDelete(); }}>
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function ComposerMenu({disabled, uploading, onImage, onDoc, onGen}: {disabled: boolean; uploading: boolean; onImage: () => void; onDoc: () => void; onGen: (kind: GenKind) => void}) {
  const [open, setOpen] = useState(false);
  const item = (icon: React.ReactNode, label: string, action: () => void) => (
    <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[0.8rem] font-semibold text-mist-100 hover:bg-white/[0.06]" onClick={() => { setOpen(false); action(); }}>
      {icon}
      {label}
    </button>
  );
  return (
    <div className="relative">
      <button disabled={disabled} onClick={() => setOpen((v) => !v)} className="grid size-10 shrink-0 place-items-center rounded-xl text-mist-300 hover:bg-white/[0.08] disabled:opacity-40" aria-label="Attach or create">
        {uploading ? <RefreshCw className="size-4.5 animate-spin" /> : <Paperclip className="size-4.5" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-30 mb-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-900 py-1 shadow-2xl">
            {item(<ImagePlus className="size-4 text-pulse-300" />, 'Photo of a question', onImage)}
            {item(<FileText className="size-4 text-pulse-300" />, 'Upload notes (PDF, DOCX, TXT)', onDoc)}
            <div className="my-1 border-t border-white/8" />
            {item(<Layers className="size-4 text-nova-300" />, 'Make flashcards', () => onGen('flashcards'))}
            {item(<ListChecks className="size-4 text-nova-300" />, 'Practice me (AI quiz)', () => onGen('practice'))}
            {item(<BookOpen className="size-4 text-nova-300" />, 'Create study material', () => onGen('material'))}
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({message, last, busy, onFollow, onSave, onFlashcards, onRetry}: {
  message: TutorMessage;
  last: boolean;
  busy: boolean;
  onFollow: (prompt: string, mode: TutorMode) => void;
  onSave: () => void;
  onFlashcards: () => void;
  onRetry: () => void;
}) {
  const {toast} = useSession();
  if (message.role === 'user') {
    const label = message.meta.label as string | undefined;
    return (
      <div className="flex flex-col items-end gap-1">
        {(label || Boolean(message.meta.image)) && (
          <span className="flex items-center gap-1 text-[0.66rem] font-bold text-mist-500">
            <Paperclip className="size-3" /> {[label, message.meta.image ? 'image' : ''].filter(Boolean).join(' · ')}
          </span>
        )}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-nova-600/35 px-3.5 py-2 text-[0.9rem] whitespace-pre-wrap text-mist-50">{message.content}</div>
      </div>
    );
  }
  const generated = message.meta.generated as string | undefined;
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-nova-400 to-pulse-500 text-white"><Sparkles className="size-3.5" /></span>
      <div className="min-w-0 flex-1">
        <div className={`rounded-2xl rounded-tl-md border px-3.5 py-2.5 ${message.failed ? 'border-flare-400/30 bg-flare-500/[0.07]' : 'border-white/8 bg-white/[0.03]'}`}>
          {message.pending && !message.content ? (
            <span className="flex items-center gap-1.5 py-1 text-[0.8rem] text-mist-400">
              <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-nova-300" style={{animationDelay: `${i * 0.15}s`}} />)}</span>
              Thinking…
            </span>
          ) : (
            <Markdown text={message.content} />
          )}
        </div>
        {!message.pending && !generated && message.content && (
          <div className="mt-1 flex flex-wrap items-center gap-0.5">
            <MiniAction label="Copy" icon={<Copy className="size-3.5" />} onClick={async () => { const ok = await copyText(message.content); toast(ok ? 'success' : 'error', ok ? 'Copied' : 'Copy failed'); }} />
            {!message.failed && (
              <>
                <MiniAction label="Save" icon={<Save className="size-3.5" />} onClick={onSave} />
                <MiniAction label="Why?" onClick={() => onFollow('Why? Explain the reasoning behind that.', 'CHAT')} disabled={busy} />
                <MiniAction label="Simpler" onClick={() => onFollow('Explain that more simply.', 'SIMPLE')} disabled={busy} />
                <MiniAction label="Example" onClick={() => onFollow('Give me an example of that.', 'EXAMPLE')} disabled={busy} />
                <MiniAction label="Flashcards" icon={<Layers className="size-3.5" />} onClick={onFlashcards} disabled={busy} />
              </>
            )}
            {last && message.failed && <MiniAction label="Retry" icon={<RefreshCw className="size-3.5" />} onClick={onRetry} disabled={busy} />}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniAction({label, icon, onClick, disabled}: {label: string; icon?: React.ReactNode; onClick: () => void; disabled?: boolean}) {
  return (
    <button disabled={disabled} onClick={onClick} className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.7rem] font-bold text-mist-500 hover:bg-white/[0.06] hover:text-mist-200 disabled:opacity-40">
      {icon}
      {label}
    </button>
  );
}
