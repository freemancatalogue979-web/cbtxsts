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
import {LoadingRows} from './ui';

const ProDashboard = lazy(() => import('./ProDashboard'));
const ProStudy = lazy(() => import('./ProStudy'));
const ProCourses = lazy(() => import('./ProCourses'));
const ProExams = lazy(() => import('./ProExams'));
const ProAnalytics = lazy(() => import('./ProAnalytics'));
const ProSettings = lazy(() => import('./ProSettings'));
const ProMaterials = lazy(() => import('./ProMaterials'));
const ProBank = lazy(() => import('./ProBank'));
const ProFlashcards = lazy(() => import('./ProFlashcards'));
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
      body = <ProMaterials />;
      break;
    case 'bank':
      body = <ProBank />;
      break;
    case 'flashcards':
      body = <ProFlashcards />;
      break;
    case 'tutor':
      body = <TutorPanel />;
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
