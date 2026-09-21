/** Shared context for the study-group workspace and all of its sections. */
import {createContext, useContext} from 'react';
import type {ReactNode} from 'react';
import type {GroupRoom} from '../lib/groupSocket';
import type {GroupSection, PresenceStatus, StudyGroupSummary} from '../lib/types';

export interface GroupCtx {
  groupId: number;
  group: StudyGroupSummary;
  myId: number;
  myName: string;
  can: (action: string) => boolean;
  isStaff: boolean;
  room: GroupRoom;
  presence: Record<string, PresenceStatus>;
  onlineIds: number[];
  /** Bump to ask the workspace to re-read the group + overview. */
  refresh: () => void;
  go: (section: GroupSection, intent?: string) => void;
  /** One-shot instruction for a section (e.g. open the create form). */
  intent: string | null;
  clearIntent: () => void;
  openQuiz: (quizId: number) => void;
  openDuel: (duelId: number) => void;
  openMember: (studentId: number) => void;
  notify: (kind: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

const Ctx = createContext<GroupCtx | null>(null);

export function GroupProvider({value, children}: {value: GroupCtx; children: ReactNode}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGroup(): GroupCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error('useGroup must be used inside <GroupProvider>');
  return value;
}

/** True when the viewer can perform a permissioned action in this group. */
export function canDo(group: StudyGroupSummary | null | undefined, action: string): boolean {
  return Boolean(group?.permissions?.[action]);
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  moderator: 'Moderator',
  member: 'Member',
};
