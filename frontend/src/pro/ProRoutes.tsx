/**
 * Pro Mode screens. Dedicated Pro workspaces where the experience differs
 * (dashboard, study, courses, exams, analytics, settings); the rich existing
 * tools (materials reader, question-bank practice, flashcards, AI tutor) are
 * reused as-is — same components, same data — under a Pro header and the Pro
 * design tokens.
 */
import {Suspense, useEffect} from 'react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import type {Tab} from '../lib/nav';
import type {Quiz} from '../lib/types';
import {LoadingRows} from './ui';
import {lazyScreen, prefetchWhenIdle} from '../lib/lazy';

const proDashboard = () => import('./ProDashboard');
const ProDashboard = lazyScreen(proDashboard);
const proStudy = () => import('./ProStudy');
const ProStudy = lazyScreen(proStudy);
const proCourses = () => import('./ProCourses');
const ProCourses = lazyScreen(proCourses);
const proExams = () => import('./ProExams');
const ProExams = lazyScreen(proExams);
const proAnalytics = () => import('./ProAnalytics');
const ProAnalytics = lazyScreen(proAnalytics);
const proSettings = () => import('./ProSettings');
const ProSettings = lazyScreen(proSettings);
const proMaterials = () => import('./ProMaterials');
const ProMaterials = lazyScreen(proMaterials);
const proBank = () => import('./ProBank');
const ProBank = lazyScreen(proBank);
const proFlashcards = () => import('./ProFlashcards');
const ProFlashcards = lazyScreen(proFlashcards);
const tutorPanel = () => import('../panels/TutorPanel');
const TutorPanel = lazyScreen(tutorPanel);
const teachersHub = () => import('../teach/TeachersHub');
const TeachersHub = lazyScreen(teachersHub);
const messages = () => import('../teach/Messages');
const Messages = lazyScreen(messages);
const studio = () => import('../teach/Studio');
const Studio = lazyScreen(studio);

/** Warm every Pro destination so URL navigation does not wait on a cold chunk. */
const PRO_LOADERS = [proDashboard, proStudy, proCourses, proExams, proAnalytics, proSettings, proMaterials, proBank, proFlashcards, tutorPanel, teachersHub, messages, studio];

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
  useEffect(() => {
    prefetchWhenIdle(PRO_LOADERS, 250);
  }, []);

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
    case 'teachers':
      body = <TeachersHub />;
      break;
    case 'messages':
      body = <Messages />;
      break;
    case 'studio':
      body = <Studio />;
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
