/** Small shared Pro actions (start practice for a topic, create a mini exam, ask the AI). */
import {api} from '../lib/api';
import type {Tab} from '../lib/nav';
import {askTutor, miniExamApi, openMiniExam} from '../lib/tutor';

type Toast = (kind: 'success' | 'error' | 'info', title: string, body?: string) => void;

export async function practiseTopic(
  {courseId, topic, size = 10, minutes = 10}: {courseId: number | null; topic?: string | null; size?: number; minutes?: number},
  onTab: (tab: Tab) => void,
  toast: Toast,
): Promise<void> {
  if (!courseId) {
    onTab('bank');
    return;
  }
  try {
    await api.arena.startPractice({
      mode: 'custom',
      course_id: courseId,
      topic: topic || '',
      size,
      time_limit_seconds: minutes * 60,
    });
    onTab('bank');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start practice.';
    // An unfinished run blocks a new one: take the student to it.
    if (/active|progress|already/i.test(message)) {
      toast('info', 'Practice in progress', 'Finish or end your current run first.');
      onTab('bank');
      return;
    }
    toast('error', 'Practice not started', message);
  }
}

export async function createMiniExam(
  {courseId, topics, count = 10, minutes = 10, difficulty = 'mixed', focus}: {courseId: number; topics?: string[]; count?: number; minutes?: number; difficulty?: string; focus?: 'mixed' | 'weak' | 'new'},
  toast: Toast,
): Promise<boolean> {
  try {
    const exam = await miniExamApi.create({course_id: courseId, topics, question_count: count, duration_minutes: minutes, difficulty, focus});
    openMiniExam(exam.id);
    return true;
  } catch (error) {
    toast('error', 'Mini exam not created', error instanceof Error ? error.message : 'Try a different topic or size.');
    return false;
  }
}

/** AI study actions: open the assistant with a ready prompt, attached to the topic. */
export const AI_ACTIONS: {key: string; label: string; prompt: (topic: string) => string}[] = [
  {key: 'explain', label: 'Explain', prompt: (t) => `Explain the topic "${t}" clearly, with the key concepts in order.`},
  {key: 'simplify', label: 'Simplify', prompt: (t) => `Explain "${t}" simply, as if I am new to it. Use plain language.`},
  {key: 'examples', label: 'Give examples', prompt: (t) => `Give me worked examples for "${t}" from my course materials.`},
  {key: 'test', label: 'Test me', prompt: (t) => `Test me on "${t}": ask me 5 questions one at a time and mark each answer.`},
  {key: 'flashcards', label: 'Create flashcards', prompt: (t) => `Create flashcards for "${t}" from my course materials.`},
  {key: 'analyze', label: 'Analyse my understanding', prompt: (t) => `Analyse my understanding of "${t}" from my results and mistakes, and tell me exactly what to revise.`},
];

export function askAbout(topic: string, prompt: string, onTab: (tab: Tab) => void): void {
  onTab('tutor');
  askTutor({prompt, autoSend: true, newChat: true, label: topic});
}
