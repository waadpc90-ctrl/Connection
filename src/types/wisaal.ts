export type StageId = 'stage_1' | 'stage_2' | 'stage_3';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type PassTodayStatus = AttendanceStatus | 'none';
export type SchoolTab =
  | 'overview'
  | 'stage-broadcasts'
  | 'attendance'
  | 'grades'
  | 'students'
  | 'settings';

export type StageNamesMap = Record<StageId, string>;
export type StageTokensMap = Record<StageId, string>;

export const STAGE_IDS: StageId[] = ['stage_1', 'stage_2', 'stage_3'];

export const DEFAULT_STAGE_NAMES: StageNamesMap = {
  stage_1: 'المرحلة الأولى',
  stage_2: 'المرحلة الثانية',
  stage_3: 'المرحلة الثالثة',
};

export interface PassAlert {
  id: string;
  kind: 'grades' | 'attendance' | 'summary' | 'announcement' | 'urgent';
  title: string;
  body: string;
  createdAtIso: string;
  imageScope?: 'stage' | 'pass';
  imageScopeToken?: string;
  imageMediaId?: string;
  imageCaption?: string;
}

export type StageBroadcastKind = 'announcement' | 'grades' | 'attendance' | 'urgent';

export interface StageSectionInfo {
  classId: string;
  name: string;
  studentCount: number;
}

export interface StageBroadcastItem {
  id: string;
  kind: StageBroadcastKind;
  title: string;
  body: string;
  targetClassId: string; // 'all' or specific classroom id
  targetSectionName: string;
  subject?: string;
  imageMediaId?: string;
  imageCaption?: string;
  createdAtIso: string;
}

export interface MediaAttachmentDoc {
  ownerId: string;
  schoolId: string;
  dataUrl: string;
  caption: string;
  createdAt?: unknown;
}

export interface PushSubscriptionDoc {
  id: string;
  schoolOwnerId: string;
  scope: 'stage' | 'pass';
  sectionId: string;
  studentId?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StagePortal {
  stageToken: string;
  ownerId: string;
  schoolId: string;
  stageId: StageId;
  stageName: string;
  schoolName: string;
  academicYear: string;
  sections: StageSectionInfo[];
  latestBroadcast?: StageBroadcastItem;
  broadcasts: StageBroadcastItem[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SubjectSummary {
  subject: string;
  latestScore: number;
  latestMaxScore: number;
  averagePercent: number;
  entriesCount: number;
  latestDate: string;
  latestNote: string;
}

export interface School {
  id: string;
  ownerId: string;
  name: string;
  whatsappNumber: string;
  absenceAlertThreshold: number;
  academicYear: string;
  stageNames?: StageNamesMap;
  stageTokens?: StageTokensMap;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Classroom {
  id: string;
  ownerId: string;
  schoolId: string;
  stageId?: StageId;
  name: string;
  stage: string;
  homeroomTeacher: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Student {
  id: string;
  ownerId: string;
  schoolId: string;
  stageId?: StageId;
  classId: string;
  className: string;
  fullName: string;
  studentCode: string;
  parentName: string;
  parentPhone: string;
  passToken: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceLog {
  id: string;
  ownerId: string;
  schoolId: string;
  stageId?: StageId;
  classId: string;
  studentId: string;
  studentName: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  note: string;
  notifiedViaWhatsapp: boolean;
  notifiedAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GradeEntry {
  id: string;
  ownerId: string;
  schoolId: string;
  stageId?: StageId;
  classId: string;
  studentId: string;
  studentName: string;
  subject: string;
  title: string;
  score: number;
  maxScore: number;
  date: string; // YYYY-MM-DD
  teacherNote: string;
  notifiedViaWhatsapp: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PassAttendanceItem {
  date: string;
  status: AttendanceStatus;
  note: string;
}

export interface PassGradeItem {
  id: string;
  subject: string;
  title: string;
  score: number;
  maxScore: number;
  date: string;
  teacherNote: string;
}

export interface StudentPass {
  passToken: string;
  ownerId: string;
  schoolId: string;
  studentId: string;
  stageId?: StageId;
  stageName?: string;
  schoolName: string;
  schoolWhatsapp: string;
  academicYear: string;
  studentDisplayName: string;
  studentCode: string;
  className: string;
  absenceAlertThreshold: number;
  todayDate: string;
  todayStatus: PassTodayStatus;
  totalAbsent: number;
  totalLate: number;
  totalExcused: number;
  averagePercent: number;
  subjectsCount?: number;
  totalScoreSum?: number;
  totalMaxScoreSum?: number;
  subjectSummaries?: SubjectSummary[];
  latestAlert?: PassAlert;
  recentAttendance: PassAttendanceItem[];
  recentGrades: PassGradeItem[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ParentAcknowledgement {
  id: string;
  authorId: string;
  schoolOwnerId: string;
  studentId: string;
  type: 'seen' | 'excuse';
  targetDate: string;
  message: string;
  senderLabel: string;
  schoolStatus: 'pending' | 'reviewed';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExtractedGradeRow {
  extractedName: string;
  matchedStudentId: string;
  score: number | null;
  note: string;
  confidence: 'high' | 'medium' | 'low';
}

export const FIELD_LIMITS = {
  schoolName: 120,
  phone: 24,
  academicYear: 40,
  className: 80,
  stage: 60,
  teacherName: 80,
  studentName: 100,
  studentCode: 32,
  parentName: 100,
  note: 300,
  subject: 80,
  gradeTitle: 120,
  ackMessage: 400,
  senderLabel: 80,
  broadcastTitle: 140,
  broadcastBody: 500,
  imageCaption: 140,
  maxImageDataUrlChars: 350000,
  maxRecentItems: 40,
  maxSubjects: 25,
  maxStageSections: 30,
  maxStageBroadcasts: 40,
} as const;

export const DEFAULT_SUBJECTS = [
  'الرياضيات',
  'اللغة العربية',
  'العلوم',
  'اللغة الإنجليزية',
  'الفيزياء',
  'الكيمياء',
  'الأحياء',
  'التربية الإسلامية',
  'الاجتماعيات',
  'الحاسوب',
];

export function getSchoolStageNames(school?: School | null): StageNamesMap {
  return {
    stage_1: school?.stageNames?.stage_1 || DEFAULT_STAGE_NAMES.stage_1,
    stage_2: school?.stageNames?.stage_2 || DEFAULT_STAGE_NAMES.stage_2,
    stage_3: school?.stageNames?.stage_3 || DEFAULT_STAGE_NAMES.stage_3,
  };
}

export function resolveClassroomStageId(cls: Pick<Classroom, 'stageId' | 'stage'>): StageId {
  if (cls.stageId === 'stage_1' || cls.stageId === 'stage_2' || cls.stageId === 'stage_3') {
    return cls.stageId;
  }
  const s = (cls.stage || '').trim();
  if (s.includes('الثانية') || s.includes('المتوسطة') || s.includes('ثاني')) return 'stage_2';
  if (s.includes('الثالثة') || s.includes('الثانوية') || s.includes('ثالث')) return 'stage_3';
  return 'stage_1';
}

export function resolveRecordStageId(
  recordStageId: StageId | undefined,
  classId: string,
  classStageLookup: Map<string, StageId>
): StageId {
  if (recordStageId === 'stage_1' || recordStageId === 'stage_2' || recordStageId === 'stage_3') {
    return recordStageId;
  }
  return classStageLookup.get(classId) || 'stage_1';
}

export function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatArabicDate(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('ar-SA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dateObj);
}

export function classifyPercentage(percent: number): {
  label: string;
  tier: 'excellent' | 'very-good' | 'good' | 'attention';
} {
  if (percent >= 90) return { label: 'ممتاز', tier: 'excellent' };
  if (percent >= 80) return { label: 'جيد جداً', tier: 'very-good' };
  if (percent >= 70) return { label: 'جيد', tier: 'good' };
  return { label: 'يحتاج متابعة', tier: 'attention' };
}

export function getAttendanceMeta(status: PassTodayStatus): {
  label: string;
  shortLabel: string;
  tone: 'emerald' | 'rose' | 'amber' | 'sky' | 'slate';
} {
  switch (status) {
    case 'present':
      return { label: 'حاضر بانتظام', shortLabel: 'حاضر', tone: 'emerald' };
    case 'absent':
      return { label: 'غائب بدون عذر', shortLabel: 'غائب', tone: 'rose' };
    case 'late':
      return { label: 'متأخر عن الطابور', shortLabel: 'متأخر', tone: 'amber' };
    case 'excused':
      return { label: 'غائب بعذر مقبول', shortLabel: 'بعذر', tone: 'sky' };
    default:
      return { label: 'لم يُرصد اليوم بعد', shortLabel: 'غير مرصود', tone: 'slate' };
  }
}
