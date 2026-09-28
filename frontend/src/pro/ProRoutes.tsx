/**
 * Pro Mode screens. Dedicated Pro workspaces where the experience differs
 * (dashboard, study, courses, exams, analytics, settings); the rich existing
 * tools (materials reader, question-bank practice, flashcards, AI tutor) are
 * reused as-is — same components, same data — under a Pro header and the Pro
 * design tokens.
 */
import {Suspense, lazy} from 'react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import type {Tab} from '../lib/nav';
import type {Quiz} from '../lib/types';
import {LoadingRows, PageHeader} from './ui';

const ProDashboard = lazy(() => import('./ProDashboard'));
const ProStudy = lazy(() => import('./ProStudy'));
const ProCourses = lazy(() => import('./ProCourses'));
const ProExams = lazy(() => import('./ProExams'));
const ProAnalytics = lazy(() => import('./ProAnalytics'));
const ProSettings = lazy(() => import('./ProSettings'));
const MaterialsPanel = lazy(() => import('../panels/MaterialsPanel'));
const PracticePanel = lazy(() => import('../panels/PracticePanel'));
const FlashcardsPanel = lazy(() => import('../panels/FlashcardsPanel'));
const TutorPanel = lazy(() => import('../panels/TutorPanel'));

function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="pro-skeleton h-9 w-56" />
      <LoadingRows rows={4} />
    </div>
  );
}

export default function ProRoutes({
  tab,
  onTab,
  onStartExam,
  onOpenResult,
  onSignOut,
  fallback,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  onStartExam: (quiz: Quiz) => void;
  onOpenResult: (attemptId: number) => void;
  onSignOut: () => void;
  /** Any other tab (duels, ranks…) keeps its Standard screen inside the Pro shell. */
  fallback: React.ReactNode;
}) {
  let body: React.ReactNode;
  switch (tab) {
    case 'play':
      body = <ProDashboard onTab={onTab} onStartExam={onStartExam} />;
      break;
    case 'study':
      body = <ProStudy onTab={onTab} />;
      break;
    case 'courses':
      body = <ProCourses onTab={onTab} />;
      break;
    case 'exams':
      body = <ProExams onStartExam={onStartExam} onOpenResult={onOpenResult} />;
      break;
    case 'analytics':
      body = <ProAnalytics onTab={onTab} />;
      break;
    case 'settings':
    case 'profile':
      body = <ProSettings onSignOut={onSignOut} />;
      break;
    case 'materials':
      body = (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <PageHeader title="Materials" description="Course reading, with your own notes alongside." />
          <MaterialsPanel />
        </div>
      );
      break;
    case 'bank':
      body = (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <PageHeader title="Question Bank" description="Practise from your courses' question banks by topic, size and time limit. Explanations follow every answer." />
          <PracticePanel />
        </div>
      );
      break;
    case 'flashcards':
      body = (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <PageHeader title="Flashcards" description="Spaced review of the ideas you need to keep." />
          <FlashcardsPanel />
        </div>
      );
      break;
    case 'tutor':
      body = (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <PageHeader eyebrow="AI Study Assistant" title="AI Assistant" description="Your academic assistant for understanding, practising and mastering your subjects. Answers cite your course materials." />
          <TutorPanel />
        </div>
      );
      break;
    default:
      body = fallback;
  }
  return (
    <ErrorBoundary key={tab} label={tab} inline>
      <Suspense fallback={<Loading />}>{body}</Suspense>
    </ErrorBoundary>
  );
}
