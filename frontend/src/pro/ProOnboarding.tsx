import {BarChart3, BookOpen, Check, ChevronRight, GraduationCap, ListChecks, Sparkles, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import type {Tab} from '../lib/nav';

const KEY = 'arena.pro.onboarding.v1';
const steps: {tab: Tab; title: string; detail: string; icon: typeof GraduationCap}[] = [
  {tab: 'study', title: 'Build your study path', detail: 'Choose a topic and Pro keeps your next step, weak areas and mistakes together.', icon: GraduationCap},
  {tab: 'bank', title: 'Practise with purpose', detail: 'Run focused question sessions and continue exactly where you stopped.', icon: ListChecks},
  {tab: 'tutor', title: 'Use your AI assistant', detail: 'Explain difficult ideas, create notes, flashcards, quizzes and study plans.', icon: Sparkles},
  {tab: 'analytics', title: 'Read your progress', detail: 'See accuracy, activity, mastery and the topics that need attention.', icon: BarChart3},
];

function saved(): boolean {
  try { return localStorage.getItem(KEY) === 'done'; } catch { return false; }
}

export default function ProOnboarding({onTab}: {onTab: (tab: Tab) => void}) {
  const [open, setOpen] = useState(() => !saved());
  const [visited, setVisited] = useState<Tab[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeRef.current?.focus(), 50);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = before;
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const finish = () => {
    try { localStorage.setItem(KEY, 'done'); } catch { /* device preference only */ }
    setOpen(false);
  };

  if (!open) return null;
  return (
    <div className="pro-onboard-layer" role="presentation">
      <button className="pro-onboard-scrim" type="button" aria-label="Skip Pro introduction" onClick={finish} />
      <section ref={dialogRef} className="pro-onboard" role="dialog" aria-modal="true" aria-labelledby="pro-welcome-title" aria-describedby="pro-welcome-copy">
        <button ref={closeRef} type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-onboard-close" aria-label="Close introduction" onClick={finish}>
          <X />
        </button>
        <div className="pro-onboard-intro">
          <span className="pro-onboard-logo"><Sparkles /></span>
          <p className="pro-eyebrow">Your Pro workspace</p>
          <h2 id="pro-welcome-title">Study with a system.</h2>
          <p id="pro-welcome-copy">Four focused workspaces turn your activity into a clear next move. Open any one now, or explore at your own pace.</p>
        </div>
        <div className="pro-onboard-steps">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const done = visited.includes(step.tab);
            return (
              <button
                key={step.tab}
                type="button"
                className="pro-onboard-step"
                data-visited={done || undefined}
                onClick={() => {
                  setVisited((current) => current.includes(step.tab) ? current : [...current, step.tab]);
                  finish();
                  onTab(step.tab);
                }}
              >
                <span className="pro-onboard-number">{done ? <Check /> : String(index + 1).padStart(2, '0')}</span>
                <span className="pro-onboard-step-icon"><Icon /></span>
                <span className="min-w-0 flex-1">
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </span>
                <ChevronRight className="pro-onboard-arrow" />
              </button>
            );
          })}
        </div>
        <div className="pro-onboard-footer">
          <span><BookOpen /> Your courses and progress are already here.</span>
          <button type="button" className="pro-btn pro-btn-primary" onClick={finish}>Enter dashboard <ChevronRight /></button>
        </div>
      </section>
    </div>
  );
}
