/**
 * The course / topic the student is working on in Pro Mode. Courses, Study
 * and the command menu share it so "Open topic" lands in the workspace with
 * the right context. Kept for the browser session (a refresh stays put).
 */
import {useSyncExternalStore} from 'react';

export type ProFocus = {courseId: number | null; courseCode?: string; courseTitle?: string; topic: string | null};

const KEY = 'ag.pro.focus';
const listeners = new Set<() => void>();

function load(): ProFocus {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) return {courseId: null, topic: null, ...JSON.parse(raw)};
  } catch {
    /* ignore */
  }
  return {courseId: null, topic: null};
}

let focus: ProFocus = typeof window === 'undefined' ? {courseId: null, topic: null} : load();

export function getFocus(): ProFocus {
  return focus;
}

export function setFocus(next: Partial<ProFocus>): void {
  focus = {...focus, ...next};
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(focus));
  } catch {
    /* ignore */
  }
  listeners.forEach((listener) => listener());
}

export function useFocus(): ProFocus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => focus,
    () => focus,
  );
}
