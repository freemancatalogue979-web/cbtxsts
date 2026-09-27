/**
 * Writing help in the material editor — staff always review before anything changes.
 *
 *  - SpellingReview: offline spelling / typo fixer. Lists each fix in context
 *    (sure fixes pre-ticked, "maybe" fixes unticked) and applies only the ticked ones.
 *  - RewriteReview: "Make it easy to read" with Google Gemini. Staff choose a
 *    style and sections, then compare each rewrite with the original and pick
 *    which to use. Numbers missing from a rewrite are flagged for a fact check.
 *
 * Both hand the result back to the editor, where it is one Undo step and is
 * only saved when staff press Save / Publish.
 */
import {AlertTriangle, CheckCheck, KeyRound, Laugh, ListChecks, SpellCheck, Sparkles, Target, Wand2} from 'lucide-react';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {Button, EmptyState, Modal, ProgressBar, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {stripMarks} from '../lib/richText';
import {useSession} from '../store/session';
import type {MaterialBlock, RewriteSection, SpellingChange, SpellingDoc} from '../lib/types';

/* ------------------------------------------------------------- spelling */

function describePath(path: string): string {
  const parts = path.split('.');
  if (parts[0] === 'title') return 'Title';
  if (parts[0] === 'description') return 'Description';
  if (parts[0] === 'summary') return `Summary point ${Number(parts[1]) + 1}`;
  if (parts[0] === 'sections') {
    const section = `Section ${Number(parts[1]) + 1}`;
    if (parts[2] === 'title') return `${section} · title`;
    const block = `block ${Number(parts[3]) + 1}`;
    const field = parts[4];
    if (field === 'items') return `${section} · ${block} · item ${Number(parts[5]) + 1}`;
    if (field === 'rows') return `${section} · table row ${Number(parts[5]) + 1}`;
    if (field === 'head') return `${section} · table header`;
    return `${section} · ${block}`;
  }
  return path;
}

export function SpellingReview({open, onClose, doc, onApply}: {open: boolean; onClose: () => void; doc: SpellingDoc; onApply: (fixed: SpellingDoc, applied: number) => void}) {
  const {toast} = useSession();
  const [changes, setChanges] = useState<SpellingChange[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChanges(null);
    api.materials
      .assistSpelling(doc)
      .then((payload) => {
        setChanges(payload.changes);
        setPicked(new Set(payload.changes.filter((row) => row.confidence === 'sure').map((row) => row.id)));
      })
      .catch((error: Error) => {
        toast('error', 'Could not check spelling', error.message);
        onClose();
      });
    // run once per opening, on the content as it was when opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sure = changes?.filter((row) => row.confidence === 'sure').length ?? 0;
  const toggle = (id: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!picked.size) return;
    setBusy(true);
    try {
      const payload = await api.materials.assistSpelling({...doc, accept: Array.from(picked)});
      if (payload.document) onApply(payload.document, payload.applied ?? picked.size);
      onClose();
    } catch (error) {
      toast('error', 'Could not apply the fixes', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fix spelling"
      subtitle={changes ? (changes.length ? `${changes.length} fix${changes.length === 1 ? '' : 'es'} found · ${sure} sure, ${changes.length - sure} to check` : 'All clear') : 'Checking every word…'}
      size="lg"
      footer={
        changes?.length ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button icon={<CheckCheck className="size-4" />} loading={busy} disabled={!picked.size} onClick={() => void apply()}>
              Apply {picked.size} fix{picked.size === 1 ? '' : 'es'}
            </Button>
          </>
        ) : undefined
      }
    >
      {!changes ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : !changes.length ? (
        <EmptyState icon={<SpellCheck className="size-5" />} title="No spelling mistakes found" detail="British spellings, names, acronyms and the material's own terms are left as they are." />
      ) : (
        <div className="min-w-0 space-y-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="min-w-0 flex-1 text-[0.76rem] font-semibold text-mist-400">Sure fixes are ticked. Names, British spellings and course terms are never changed.</p>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(changes.map((row) => row.id)))}>
              Tick all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Untick all
            </Button>
          </div>
          <ul className="min-w-0 space-y-1.5">
            {changes.slice(0, 400).map((row) => (
              <li key={row.id}>
                <label
                  className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors ${
                    picked.has(row.id) ? 'border-mint-500/30 bg-mint-500/[0.06]' : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  <input type="checkbox" className="mt-1 size-4 shrink-0" checked={picked.has(row.id)} onChange={() => toggle(row.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.84rem] leading-snug text-mist-300 [overflow-wrap:anywhere]">
                      {row.before}
                      <del className="rounded bg-flare-500/15 px-0.5 text-flare-300">{row.from.replace(/ /g, '·') || '·'}</del>
                      <ins className="ml-0.5 rounded bg-mint-500/15 px-0.5 font-bold text-mint-200 no-underline">{row.to.replace(/ /g, '·') || '·'}</ins>
                      {row.after}
                    </span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.68rem] font-bold">
                      <span className={row.confidence === 'sure' ? 'text-mint-300' : 'text-gold-300'}>{row.confidence === 'sure' ? row.reason : `${row.reason} — check`}</span>
                      <span className="truncate text-mist-500">{describePath(row.path)}</span>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- rewrite */

type Style = 'easy' | 'fun' | 'exam';

const STYLE_INFO: Record<Style, {label: string; detail: string; icon: typeof Sparkles}> = {
  easy: {label: 'Easy to read', detail: 'Plain words, short sentences, every hard word explained.', icon: Sparkles},
  fun: {label: 'Fun to learn', detail: 'Friendly tone and everyday examples — may add a tip or example.', icon: Laugh},
  exam: {label: 'Exam-ready', detail: 'Crisp definitions and steps; each section ends with “Remember:”.', icon: Target},
};

type SourceSection = {title: string; blocks: MaterialBlock[]};

export function RewriteReview({
  open,
  onClose,
  title,
  sections,
  renderBlock,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sections: SourceSection[];
  renderBlock: (block: MaterialBlock, key: number) => ReactNode;
  onUse: (chosen: RewriteSection[]) => void;
}) {
  const [ai, setAi] = useState<{configured: boolean; model: string; setup: string | null} | null>(null);
  const [style, setStyle] = useState<Style>('easy');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<RewriteSection[]>([]);
  const [progress, setProgress] = useState<{done: number; total: number} | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<number[]>([]);
  const [use, setUse] = useState<Set<number>>(new Set());
  const [showing, setShowing] = useState<Record<number, 'new' | 'old'>>({});
  const [model, setModel] = useState('');

  useEffect(() => {
    if (!open) return;
    setResults([]);
    setError('');
    setPending([]);
    setProgress(null);
    setUse(new Set());
    setShowing({});
    setChosen(new Set(sections.map((_, index) => index).filter((index) => sections[index].blocks.length)));
    api.materials
      .assistStatus()
      .then((payload) => setAi(payload.ai))
      .catch(() => setAi({configured: false, model: '', setup: 'Could not check the AI settings.'}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Small batches: progress for staff, friendlier to the free rate limit, and
   * each request answers well inside proxy time limits (~100-120 s). */
  const batches = (indexes: number[]) => {
    const out: number[][] = [];
    let current: number[] = [];
    let size = 0;
    for (const index of indexes) {
      const weight = JSON.stringify(sections[index]).length;
      if (current.length && (current.length >= 2 || size + weight > 5000)) {
        out.push(current);
        current = [];
        size = 0;
      }
      current.push(index);
      size += weight;
    }
    if (current.length) out.push(current);
    return out;
  };

  const run = async (indexes: number[]) => {
    setError('');
    const groups = batches(indexes);
    const total = indexes.length + results.length;
    let done = results.length;
    setProgress({done, total});
    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g];
      try {
        const payload = await api.materials.assistRewrite({
          title,
          style,
          sections: group.map((index) => ({index, title: sections[index].title, blocks: sections[index].blocks})),
        });
        setModel(payload.model);
        setResults((current) => [...current.filter((row) => !group.includes(row.index)), ...payload.sections].sort((a, b) => a.index - b.index));
        setUse((current) => {
          const next = new Set(current);
          payload.sections.filter((row) => row.changed).forEach((row) => next.add(row.index));
          return next;
        });
        done += group.length;
        setProgress({done, total});
      } catch (problem) {
        setError((problem as Error).message);
        setPending(groups.slice(g).flat());
        setProgress(null);
        return;
      }
    }
    setPending([]);
    setProgress(null);
  };

  const reviewing = results.length > 0 && !progress;
  const selectedResults = useMemo(() => results.filter((row) => use.has(row.index) && row.changed), [results, use]);

  const footer = !ai?.configured ? (
    <Button variant="ghost" onClick={onClose}>
      Close
    </Button>
  ) : reviewing ? (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setResults([]);
          setUse(new Set());
        }}
      >
        Start over
      </Button>
      <Button
        icon={<CheckCheck className="size-4" />}
        disabled={!selectedResults.length}
        onClick={() => {
          onUse(selectedResults);
          onClose();
        }}
      >
        Use {selectedResults.length} section{selectedResults.length === 1 ? '' : 's'}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={Boolean(progress)}>
        Cancel
      </Button>
      <Button icon={<Wand2 className="size-4" />} loading={Boolean(progress)} disabled={!chosen.size} onClick={() => void run(Array.from(chosen).sort((a, b) => a - b))}>
        Rewrite {chosen.size} section{chosen.size === 1 ? '' : 's'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={() => (progress ? undefined : onClose())}
      title="Make it easy to read"
      subtitle={reviewing ? `Review each section — nothing changes until you choose “Use”.${model ? ` · ${model}` : ''}` : 'Google Gemini rewrites the text in simple, friendly English. You review it first.'}
      size="lg"
      footer={footer}
    >
      {!ai ? (
        <Skeleton className="h-32 w-full" />
      ) : !ai.configured ? (
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 gap-3 rounded-2xl border border-gold-500/25 bg-gold-500/10 p-3.5">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-gold-300" />
            <div className="min-w-0 text-[0.84rem] leading-relaxed text-mist-200">
              <p className="font-extrabold text-mist-50">AI writing help isn't set up yet</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                <li>
                  Open <b>aistudio.google.com</b>, sign in and choose <b>Get API key</b> — it's free.
                </li>
                <li>
                  On the server, add <code className="rounded bg-white/10 px-1">GEMINI_API_KEY=your-key</code> to <code className="rounded bg-white/10 px-1">backend/.env</code>.
                </li>
                <li>Restart the API, then come back here.</li>
              </ol>
              <p className="mt-2 text-[0.76rem] text-mist-400">Never paste the key into chat or into the app — only into the server's settings. Spelling fixes work without a key.</p>
            </div>
          </div>
        </div>
      ) : progress ? (
        <div className="min-w-0 space-y-3 py-4 text-center">
          <Wand2 className="mx-auto size-7 animate-pulse text-nova-300" />
          <p className="text-[0.9rem] font-extrabold text-mist-50">
            Rewriting {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </p>
          <ProgressBar value={Math.round((progress.done / Math.max(1, progress.total)) * 100)} />
          <p className="text-[0.74rem] text-mist-500">This can take a little while on the free plan.</p>
        </div>
      ) : reviewing ? (
        <div className="min-w-0 space-y-3">
          {error ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-flare-500/30 bg-flare-500/10 p-2.5 text-[0.8rem] text-flare-200">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {error} {pending.length ? `${pending.length} section${pending.length === 1 ? '' : 's'} not done yet.` : ''}
              </span>
              {pending.length ? (
                <Button size="sm" variant="outline" onClick={() => void run(pending)}>
                  Try the rest
                </Button>
              ) : null}
            </div>
          ) : null}
          {results.map((row) => {
            const view = showing[row.index] ?? 'new';
            const source = sections[row.index];
            return (
              <div key={row.index} className={`min-w-0 rounded-2xl border p-3 ${use.has(row.index) ? 'border-nova-500/35 bg-nova-500/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      disabled={!row.changed}
                      checked={use.has(row.index) && row.changed}
                      onChange={() =>
                        setUse((current) => {
                          const next = new Set(current);
                          if (next.has(row.index)) next.delete(row.index);
                          else next.add(row.index);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 truncate text-[0.88rem] font-extrabold text-mist-50">
                      {row.index + 1}. {stripMarks(view === 'new' ? row.title : source?.title)}
                    </span>
                  </label>
                  {row.changed ? (
                    <Segmented
                      value={view}
                      onChange={(value) => setShowing((current) => ({...current, [row.index]: value}))}
                      options={[
                        {value: 'new' as const, label: 'New'},
                        {value: 'old' as const, label: 'Original'},
                      ]}
                    />
                  ) : null}
                </div>
                {row.warnings.map((warning) => (
                  <p key={warning} className="mt-2 flex gap-1.5 rounded-lg border border-gold-500/25 bg-gold-500/10 px-2.5 py-1.5 text-[0.74rem] font-semibold text-gold-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {warning}
                  </p>
                ))}
                <div className="mt-2.5 max-h-[45vh] min-w-0 space-y-2 overflow-y-auto pr-1">
                  {(view === 'new' ? row.blocks : (source?.blocks ?? [])).map((block, index) => renderBlock(block, index))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-w-0 space-y-3.5">
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            {(Object.keys(STYLE_INFO) as Style[]).map((key) => {
              const info = STYLE_INFO[key];
              const Icon = info.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStyle(key)}
                  className={`min-w-0 rounded-2xl border p-3 text-left transition-colors ${style === key ? 'border-nova-400/60 bg-nova-500/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <span className="flex items-center gap-1.5 text-[0.86rem] font-extrabold text-mist-50">
                    <Icon className="size-4 shrink-0 text-nova-300" /> {info.label}
                  </span>
                  <span className="mt-1 block text-[0.74rem] leading-snug text-mist-400">{info.detail}</span>
                </button>
              );
            })}
          </div>
          {error ? <p className="rounded-xl border border-flare-500/30 bg-flare-500/10 p-2.5 text-[0.8rem] text-flare-200">{error}</p> : null}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.78rem] font-black text-mist-300">
                <ListChecks className="size-4 shrink-0" /> Sections to rewrite
              </p>
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(sections.map((_, index) => index)))}>
                All
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
                None
              </Button>
            </div>
            <ul className="mt-1.5 max-h-[40vh] min-w-0 space-y-1 overflow-y-auto">
              {sections.map((section, index) => (
                <li key={index}>
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-2">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={chosen.has(index)}
                      onChange={() =>
                        setChosen((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-200">
                      {index + 1}. {stripMarks(section.title) || `Section ${index + 1}`}
                    </span>
                    <span className="shrink-0 text-[0.68rem] font-bold text-mist-500">{section.blocks.length} blocks</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[0.72rem] leading-snug text-mist-500">
            Facts, numbers, names and cases are kept; key terms come back in <b className="text-mist-300">bold</b>. On the free plan Google may use submitted text to improve its
            models — don't send private student data.
          </p>
        </div>
      )}
    </Modal>
  );
}
