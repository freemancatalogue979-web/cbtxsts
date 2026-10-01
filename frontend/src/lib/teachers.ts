/** Teacher Network client: discovery, requests, studio, content, reviews, admin. */
import {request, tokenStore} from './api';

/* ------------------------------------------------------------------ types */
export type Person = {id: number; name: string; username: string; avatar_hue: number; has_photo: boolean; last_active?: string | null};
export type Specialty = {subject: string; topics: string[]};
export type TeacherBadge = {key: string; label: string; reason: string};
export type TeacherStats = {
  rating: number;
  review_count: number;
  students_taught: number;
  active_students: number;
  completed_relationships: number;
  response_rate: number | null;
  response_hours: number | null;
  retention: number | null;
  groups: number;
  group_members: number;
  materials: number;
  quizzes: number;
  quiz_attempts: number;
  open_reports?: number;
};
export type TeacherCard = {
  id: number;
  student_id: number;
  name: string;
  full_name: string;
  avatar_hue: number;
  has_photo: boolean;
  headline: string;
  bio: string;
  verified: boolean;
  experience_years: number;
  institution: string;
  languages: string[];
  formats: 'one' | 'group' | 'both';
  accepting: boolean;
  availability_now: 'available' | 'busy' | 'unavailable';
  specialties: Specialty[];
  stats: TeacherStats;
  badges: TeacherBadge[];
};
export type Slot = {day: number; start: string; end: string};
export type TFile = {id: number; name: string; mime: string; size: number; is_image: boolean};
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed' | 'expired';
export type TRequest = {
  id: number;
  teacher_id: number;
  teacher: {id: number; name: string; student_id: number; avatar_hue: number; has_photo: boolean; verified: boolean} | null;
  student: Person | {id: number};
  subject: string;
  topic: string;
  message: string;
  format: 'one' | 'group' | 'either';
  preferred_time: string;
  status: RequestStatus;
  response_note: string;
  created_at: string;
  responded_at: string | null;
};
export type Visibility = 'private' | 'students' | 'group' | 'public';
export type TMaterial = {
  id: number;
  teacher_id: number;
  title: string;
  description: string;
  subject: string;
  topic: string;
  kind: 'file' | 'text' | 'link';
  link: string;
  file: TFile | null;
  visibility: Visibility;
  group: {id: number; name: string} | null;
  created_at: string;
  updated_at: string;
  body?: string;
  teacher_name?: string;
  teacher?: {id: number; name: string; verified: boolean} | null;
  stats?: {views: number; unique_viewers: number; downloads: number};
};
export type QKind = 'mcq' | 'tf' | 'short' | 'numeric';
export type TQuestion = {
  id?: number;
  position?: number;
  kind: QKind;
  prompt: string;
  options: string[];
  answer: string;
  tolerance: number;
  explanation: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  source_question_id?: number | null;
};
export type TQuiz = {
  id: number;
  teacher_id: number;
  title: string;
  description: string;
  subject: string;
  topic: string;
  time_limit_minutes: number;
  pass_mark: number;
  visibility: Visibility;
  group: {id: number; name: string} | null;
  status: 'draft' | 'published' | 'archived' | 'removed';
  question_count: number;
  total_marks: number;
  created_at: string;
  published_at: string | null;
  stats?: {attempts: number; students: number; average: number | null; pass_rate: number | null};
  my_attempts?: number;
  my_best?: number | null;
  in_progress_id?: number | null;
  teacher_name?: string;
  teacher?: {id: number; name: string; verified: boolean} | null;
  attempts?: {id: number; percentage: number; passed: boolean; submitted_at: string}[];
  questions?: TQuestion[];
};
export type AttemptQuestion = {id: number; position: number; kind: QKind; prompt: string; options: string[]; marks: number; given?: string | null; answer?: string; explanation?: string; correct?: boolean};
export type TAttempt = {
  id: number;
  quiz: {id: number; title: string; time_limit_minutes: number; pass_mark: number};
  status: 'in_progress' | 'submitted';
  questions: AttemptQuestion[];
  answers: Record<string, string | null>;
  remaining_seconds: number | null;
  score: number;
  max_score: number;
  percentage: number;
  passed: boolean;
  submitted_at: string | null;
};
export type TReview = {
  id: number;
  teacher_id: number;
  rating: number;
  body: string;
  anonymous: boolean;
  author: string;
  author_id?: number | null;
  is_mine: boolean;
  editable: boolean;
  status: 'visible' | 'hidden';
  teacher_response: string;
  responded_at: string | null;
  created_at: string;
};
export type TGroup = {
  id: number;
  name: string;
  description: string;
  subject: string;
  topic: string;
  privacy: 'open' | 'public' | 'request' | 'invite';
  capacity: number;
  members: number;
  full: boolean;
  teacher: {id: number; name: string; verified: boolean; student_id: number} | null;
  is_member: boolean;
  my_role: string | null;
  request_pending: boolean;
  code: string | null;
  created_at: string;
  pending_requests?: number;
  materials?: number;
  quizzes?: number;
};
export type TeacherDetail = TeacherCard & {
  experience: string;
  availability: Slot[];
  qualifications: {id: number; title: string; institution: string; year: string; verified: boolean; has_document: boolean}[];
  groups: TGroup[];
  materials: TMaterial[];
  quizzes: TQuiz[];
  reviews: TReview[];
  rating_distribution: Record<string, number>;
  is_me: boolean;
  relationship: {id: number; status: string} | null;
  pending_request: TRequest | null;
  can_message: boolean;
  can_review: boolean;
  my_review: TReview | null;
};
export type ApplicationStatus = 'draft' | 'pending' | 'needs_info' | 'approved' | 'rejected' | 'suspended';
export type MyProfile = {
  id: number;
  status: ApplicationStatus;
  verified: boolean;
  headline: string;
  bio: string;
  experience_years: number;
  experience: string;
  institution: string;
  languages: string[];
  formats: 'one' | 'group' | 'both';
  availability: Slot[];
  accepting: boolean;
  staff_message: string;
  submitted_at: string | null;
  approved_at: string | null;
  specialties: Specialty[];
  qualifications: {id: number; title: string; institution: string; year: string; status: string; file: TFile | null}[];
  history: {action: string; created_at: string}[];
};
export type Catalog = {subjects: Specialty[]; languages: string[]; popular: string[]; teacher_count: number};
export type Learning = {
  teachers: {relationship: {id: number; status: string; subject: string; topic: string; started_at: string; ended_at: string | null}; teacher: TeacherCard; can_review: boolean; reviewed: boolean}[];
  requests: TRequest[];
  materials: TMaterial[];
  quizzes: TQuiz[];
  groups: TGroup[];
};
export type Conversation = {
  with: Person;
  role: 'teacher' | 'student' | 'request' | 'friend';
  last: {body: string; mine: boolean; created_at: string; read: boolean} | null;
  unread: number;
  blocked: boolean;
};
export type StudioOverview = {
  profile: {id: number; name: string; short_name: string; verified: boolean; headline: string; accepting: boolean};
  today: {new_requests: number; active_students: number; unread_messages: number; group_requests: number};
  stats: TeacherStats;
  badges: TeacherBadge[];
  pending: TRequest[];
  activity: {kind: string; text: string; at: string}[];
};
export type StudioStudent = {
  relationship: {id: number; status: string; subject: string; topic: string; started_at: string};
  student: Person;
  progress: number | null;
  quiz_attempts: number;
  last_activity_at: string;
};
export type StudentDetail = {
  student: Person;
  relationship: {id: number; status: string; subject: string; topic: string; started_at: string; ended_at: string | null};
  performance: {attempts: number; average: number | null; passed: number; streak: number};
  attempts: {id: number; quiz: string; percentage: number; passed: boolean; submitted_at: string}[];
  materials: {id: number; title: string; downloaded: boolean; viewed_at: string}[];
  groups: {id: number; name: string}[];
  requests: TRequest[];
  notes: {weak_areas: string; progress: string; next_step: string; body: string; updated_at: string} | null;
};
export type SearchParams = {
  q?: string;
  subject?: string;
  topic?: string;
  verified?: boolean;
  min_rating?: number;
  min_experience?: number;
  format?: string;
  language?: string;
  available?: boolean;
  sort?: string;
  page?: number;
};

/* ---------------------------------------------------------------- helpers */
const qs = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false || value === 0) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

/** Authenticated URL for <img>/<a> (the API accepts ?token= for downloads). */
export function fileUrl(fileId: number, download = false, admin = false): string {
  const token = tokenStore.get() ?? '';
  const base = admin ? `/api/admin/teachers/files/${fileId}` : `/api/teachers/files/${fileId}`;
  return `${base}?token=${encodeURIComponent(token)}${download ? '&download=true' : ''}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const FORMAT_LABEL: Record<string, string> = {one: 'One-on-one', group: 'Group', both: 'One-on-one & group', either: 'Either'};
export const VISIBILITY_LABEL: Record<Visibility, string> = {private: 'Only me', students: 'My students', group: 'A group', public: 'Public'};
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* -------------------------------------------------------------------- api */
const T = '/api/teachers';
export const teachers = {
  catalog: () => request<Catalog>(`${T}/catalog`),
  search: (params: SearchParams) => request<{items: TeacherCard[]; total: number; page: number; pages: number}>(`${T}${qs(params)}`),
  detail: (id: number) => request<TeacherDetail>(`${T}/${id}`),
  request: (id: number, body: {subject: string; topic: string; message: string; format: string; preferred_time: string}) => request<TRequest>(`${T}/${id}/requests`, {method: 'POST', body}),
  cancelRequest: (id: number) => request<TRequest>(`${T}/requests/${id}/cancel`, {method: 'POST'}),
  learning: () => request<Learning>(`${T}/me/learning`),
  completeRelationship: (id: number) => request<{ok: boolean}>(`${T}/relationships/${id}/complete`, {method: 'POST'}),
  endRelationship: (id: number) => request<{ok: boolean}>(`${T}/relationships/${id}/end`, {method: 'POST'}),
  review: (teacherId: number, body: {rating: number; body: string; anonymous: boolean}) => request<TReview>(`${T}/${teacherId}/reviews`, {method: 'POST', body}),
  editReview: (id: number, body: {rating: number; body: string; anonymous: boolean}) => request<TReview>(`${T}/reviews/${id}`, {method: 'PATCH', body}),
  respondReview: (id: number, response: string) => request<TReview>(`${T}/reviews/${id}/response`, {method: 'POST', body: {response}}),
  report: (kind: string, target_id: number, reason: string) => request<{ok: boolean}>(`${T}/report`, {method: 'POST', body: {kind, target_id, reason}}),
  blocks: () => request<{items: (Person & {created_at: string})[]}>(`${T}/blocks`),
  block: (id: number) => request<{ok: boolean}>(`${T}/blocks/${id}`, {method: 'POST'}),
  unblock: (id: number) => request<{ok: boolean}>(`${T}/blocks/${id}`, {method: 'DELETE'}),
  typing: (to: number) => request<{ok: boolean}>(`${T}/typing`, {method: 'POST', body: {to}}),
  conversations: () => request<{items: Conversation[]}>(`${T}/conversations`),
  discoverGroups: (q = '') => request<{items: TGroup[]}>(`${T}/groups/discover${qs({q})}`),
  joinGroup: (id: number, message = '') => request<TGroup>(`${T}/groups/${id}/join`, {method: 'POST', body: {message}}),
  cancelGroupJoin: (id: number) => request<{ok: boolean}>(`${T}/groups/${id}/join/cancel`, {method: 'POST'}),
  material: (id: number) => request<TMaterial>(`${T}/materials/${id}`),
  quiz: (id: number) => request<TQuiz>(`${T}/quizzes/${id}`),
  startQuiz: (id: number) => request<TAttempt>(`${T}/quizzes/${id}/start`, {method: 'POST'}),
  saveAnswers: (attemptId: number, answers: Record<string, string | null>) => request<{ok: boolean}>(`${T}/quizzes/attempts/${attemptId}/save`, {method: 'POST', body: {answers}}),
  submitQuiz: (attemptId: number, answers: Record<string, string | null>) => request<TAttempt>(`${T}/quizzes/attempts/${attemptId}/submit`, {method: 'POST', body: {answers}}),
  attempt: (attemptId: number) => request<TAttempt>(`${T}/quizzes/attempts/${attemptId}`),
  upload: (file: File, purpose: 'material' | 'chat') => {
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', file);
    return request<TFile>(`${T}/files`, {method: 'POST', body: form});
  },

  /* application */
  myProfile: () => request<{profile: MyProfile | null}>(`${T}/me/profile`),
  saveProfile: (body: Omit<MyProfile, 'id' | 'status' | 'verified' | 'staff_message' | 'submitted_at' | 'approved_at' | 'qualifications' | 'history'>) =>
    request<{profile: MyProfile}>(`${T}/me/profile`, {method: 'PUT', body}),
  submit: () => request<{profile: MyProfile}>(`${T}/me/submit`, {method: 'POST'}),
  withdraw: () => request<{profile: MyProfile}>(`${T}/me/withdraw`, {method: 'POST'}),
  addQualification: (fields: {title: string; institution: string; year: string}, file?: File | null) => {
    const form = new FormData();
    form.append('title', fields.title);
    form.append('institution', fields.institution);
    form.append('year', fields.year);
    if (file) form.append('file', file);
    return request<{profile: MyProfile}>(`${T}/me/qualifications`, {method: 'POST', body: form});
  },
  deleteQualification: (id: number) => request<{profile: MyProfile}>(`${T}/me/qualifications/${id}`, {method: 'DELETE'}),

  /* studio */
  overview: () => request<StudioOverview>(`${T}/studio/overview`),
  studioRequests: (state = 'pending') => request<{items: TRequest[]; counts: Record<string, number>}>(`${T}/studio/requests${qs({state})}`),
  decide: (id: number, decision: 'accept' | 'decline', note = '') => request<TRequest>(`${T}/studio/requests/${id}/${decision}`, {method: 'POST', body: {note}}),
  students: () => request<{items: StudioStudent[]}>(`${T}/studio/students`),
  student: (id: number) => request<StudentDetail>(`${T}/studio/students/${id}`),
  saveNotes: (id: number, body: {weak_areas: string; progress: string; next_step: string; body: string}) =>
    request<{ok: boolean; updated_at: string}>(`${T}/studio/students/${id}/notes`, {method: 'PUT', body}),
  materials: () => request<{items: TMaterial[]}>(`${T}/studio/materials`),
  studioMaterial: (id: number) => request<TMaterial>(`${T}/studio/materials/${id}`),
  createMaterial: (body: Record<string, unknown>) => request<TMaterial>(`${T}/studio/materials`, {method: 'POST', body}),
  updateMaterial: (id: number, body: Record<string, unknown>) => request<TMaterial>(`${T}/studio/materials/${id}`, {method: 'PUT', body}),
  deleteMaterial: (id: number) => request<{ok: boolean}>(`${T}/studio/materials/${id}`, {method: 'DELETE'}),
  shareMaterial: (id: number, student_ids: number[]) => request<{shared: number}>(`${T}/studio/materials/${id}/share`, {method: 'POST', body: {student_ids}}),
  quizzes: () => request<{items: TQuiz[]}>(`${T}/studio/quizzes`),
  studioQuiz: (id: number) => request<TQuiz>(`${T}/studio/quizzes/${id}`),
  createQuiz: (body: Record<string, unknown>) => request<TQuiz>(`${T}/studio/quizzes`, {method: 'POST', body}),
  updateQuiz: (id: number, body: Record<string, unknown>) => request<TQuiz>(`${T}/studio/quizzes/${id}`, {method: 'PUT', body}),
  publishQuiz: (id: number) => request<TQuiz>(`${T}/studio/quizzes/${id}/publish`, {method: 'POST'}),
  archiveQuiz: (id: number) => request<TQuiz>(`${T}/studio/quizzes/${id}/archive`, {method: 'POST'}),
  unarchiveQuiz: (id: number) => request<TQuiz>(`${T}/studio/quizzes/${id}/unarchive`, {method: 'POST'}),
  deleteQuiz: (id: number) => request<{ok: boolean; archived: boolean}>(`${T}/studio/quizzes/${id}`, {method: 'DELETE'}),
  bankPreview: (course_id: number, topic: string, count: number) => request<{items: TQuestion[]; available: number}>(`${T}/studio/quizzes/bank-preview`, {method: 'POST', body: {course_id, topic, count}}),
  shareQuiz: (id: number, student_ids: number[]) => request<{shared: number}>(`${T}/studio/quizzes/${id}/share`, {method: 'POST', body: {student_ids}}),
  quizResults: (id: number) =>
    request<{quiz: TQuiz; completion: number | null; targets: number; attempts: {id: number; student: Person; percentage: number; passed: boolean; submitted_at: string}[]; questions: {id: number; prompt: string; correct_rate: number | null}[]}>(
      `${T}/studio/quizzes/${id}/results`,
    ),
  groups: () => request<{items: TGroup[]}>(`${T}/studio/groups`),
  createGroup: (body: {name: string; description: string; subject: string; topic: string; capacity: number; privacy: string}) => request<TGroup>(`${T}/studio/groups`, {method: 'POST', body}),
  updateGroup: (id: number, body: {name: string; description: string; subject: string; topic: string; capacity: number; privacy: string}) => request<TGroup>(`${T}/studio/groups/${id}`, {method: 'PATCH', body}),
  groupRequests: (id: number) => request<{items: {id: number; student: Person; message: string; created_at: string}[]}>(`${T}/studio/groups/${id}/requests`),
  decideGroupRequest: (groupId: number, id: number, decision: 'approve' | 'reject') => request<{ok: boolean}>(`${T}/studio/groups/${groupId}/requests/${id}/${decision}`, {method: 'POST'}),
  inviteToGroup: (groupId: number, student_id: number) => request<{ok: boolean}>(`${T}/studio/groups/${groupId}/invite`, {method: 'POST', body: {student_id}}),
  studioReviews: () => request<{items: TReview[]; stats: TeacherStats; distribution: Record<string, number>}>(`${T}/studio/reviews`),
};

/* ------------------------------------------------------------------ admin */
const A = '/api/admin/teachers';
export type AdminTeacherRow = {
  id: number;
  student_id: number;
  name: string;
  username: string;
  avatar_hue: number;
  has_photo: boolean;
  headline: string;
  status: ApplicationStatus;
  verified: boolean;
  experience_years: number;
  specialties: Specialty[];
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  stats: TeacherStats;
};
export type AdminReport = {id: number; kind: string; target_id: number; target: {label: string; status?: string}; teacher_id: number | null; reason: string; reporter: string; status: string; resolved_by: string; created_at: string};
export type AdminTeacherDetail = AdminTeacherRow & {
  bio: string;
  experience: string;
  institution: string;
  languages: string[];
  formats: string;
  accepting: boolean;
  staff_message: string;
  account: {joined: string | null; is_banned: boolean; level: number | null};
  qualifications: {id: number; title: string; institution: string; year: string; status: string; file: TFile | null}[];
  history: {id: number; action: string; note: string; actor: string; created_at: string}[];
  reviews: {id: number; rating: number; body: string; anonymous: boolean; author: string; status: string; teacher_response: string; created_at: string}[];
  reports: AdminReport[];
  materials: {id: number; title: string; visibility: string; status: string; kind: string}[];
  quizzes: {id: number; title: string; status: string; visibility: string}[];
  groups: {id: number; name: string; privacy: string; capacity: number}[];
};
export const teacherAdmin = {
  summary: () => request<{counts: Record<string, number>; verified: number; open_reports: number; hidden_reviews: number; relationships: number; pending_requests: number}>(`${A}/summary`),
  list: (state: string, q = '') => request<{items: AdminTeacherRow[]}>(`${A}${qs({state, q})}`),
  detail: (id: number) => request<AdminTeacherDetail>(`${A}/${id}`),
  act: (id: number, action: string, note: string, message: string) => request<AdminTeacherDetail>(`${A}/${id}/action`, {method: 'POST', body: {action, note, message}}),
  qualification: (id: number, status: string) => request<{ok: boolean}>(`${A}/qualifications/${id}`, {method: 'POST', body: {status}}),
  reports: (state = 'open') => request<{items: AdminReport[]}>(`${A}/moderation/reports${qs({state})}`),
  decideReport: (id: number, status: string, action: string, note = '') => request<AdminReport>(`${A}/moderation/reports/${id}`, {method: 'POST', body: {status, action, note}}),
  setReview: (id: number, status: 'visible' | 'hidden') => request<{ok: boolean}>(`${A}/moderation/reviews/${id}`, {method: 'POST', body: {status}}),
  setContent: (kind: 'materials' | 'quizzes', id: number, verb: 'remove' | 'restore') => request<{ok: boolean}>(`${A}/moderation/${kind}/${id}/${verb}`, {method: 'POST'}),
};
