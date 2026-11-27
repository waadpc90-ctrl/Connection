import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  hashAdminPin,
  isValidAdminPinFormat,
  isValidStaffEmail,
  normalizeStaffEmail,
} from './adminSecurity';
import { isValidMediaDataUrl } from './imageCompression';
import {
  dispatchExternalPushForStageBroadcast,
  dispatchExternalPushForStudentPass,
} from './pushNotifications';
import {
  AttendanceLog,
  AttendanceStatus,
  classifyPercentage,
  Classroom,
  DEFAULT_STAGE_NAMES,
  FIELD_LIMITS,
  formatArabicDate,
  getSchoolStageNames,
  getSchoolStageSubjectsMap,
  getTodayIso,
  GradeEntry,
  PassAlert,
  PassAttendanceItem,
  PassGradeItem,
  resolveClassroomStageId,
  sanitizeSchoolSubjects,
  sanitizeStageSubjects,
  School,
  StaffMember,
  StaffRole,
  STAGE_IDS,
  StageBroadcastItem,
  StageBroadcastKind,
  StageId,
  StageNamesMap,
  StageSectionInfo,
  StageSubjectsMap,
  StageTokensMap,
  Student,
  StudentPass,
  SubjectSummary,
} from '../types/wisaal';

// --- Defensive Payload Sanitization Helpers (synchronized with firebase-blueprint.json) ---
export function sanitizeText(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function sanitizePhone(value: string): string {
  const western = value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  return western.replace(/[^0-9+\-\s]/g, '').trim().slice(0, FIELD_LIMITS.phone);
}

export function generateSafeId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  return `${prefix}_${token}`;
}

export function generatePassToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ws_${hex.slice(0, 22)}`;
}

export function generateStageToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `stg_${hex.slice(0, 22)}`;
}

// --- Smart Pass & Stage Portal URL Builders ---
export function buildPassUrl(passToken: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?pass=${encodeURIComponent(passToken)}`;
}

export function buildStagePortalUrl(stageToken: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?stage=${encodeURIComponent(stageToken)}`;
}

export function buildParentsPortalUrl(schoolId?: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return schoolId
    ? `${base}?parents=1&school=${encodeURIComponent(schoolId)}`
    : `${base}?parents=1`;
}

// --- Multi-Subject & Stage-Isolated Pass Aggregation Helper ---
export function computePassMetrics(
  studentId: string,
  allLogs: AttendanceLog[],
  allGrades: GradeEntry[],
  stageId?: StageId
): {
  todayDate: string;
  todayStatus: StudentPass['todayStatus'];
  totalAbsent: number;
  totalLate: number;
  totalExcused: number;
  averagePercent: number;
  subjectsCount: number;
  totalScoreSum: number;
  totalMaxScoreSum: number;
  subjectSummaries: SubjectSummary[];
  recentAttendance: PassAttendanceItem[];
  recentGrades: PassGradeItem[];
} {
  const studentLogs = allLogs
    .filter((l) => l.studentId === studentId && (!stageId || !l.stageId || l.stageId === stageId))
    .sort((a, b) => b.date.localeCompare(a.date));

  const studentGrades = allGrades
    .filter((g) => g.studentId === studentId && (!stageId || !g.stageId || g.stageId === stageId))
    .sort((a, b) => b.date.localeCompare(a.date));

  const today = getTodayIso();
  const todayLog = studentLogs.find((l) => l.date === today) || studentLogs[0];

  const totalAbsent = studentLogs.filter((l) => l.status === 'absent').length;
  const totalLate = studentLogs.filter((l) => l.status === 'late').length;
  const totalExcused = studentLogs.filter((l) => l.status === 'excused').length;

  // Aggregate by Subject (combining all grades of this student across all subjects)
  const bySubject = new Map<string, GradeEntry[]>();
  for (const g of studentGrades) {
    const key = g.subject.trim();
    const list = bySubject.get(key) || [];
    list.push(g);
    bySubject.set(key, list);
  }

  const subjectSummaries: SubjectSummary[] = Array.from(bySubject.entries())
    .slice(0, FIELD_LIMITS.maxSubjects)
    .map(([subName, entries]) => {
      const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
      const latest = sorted[0];
      const avgPct = Math.round(
        sorted.reduce((sum, item) => sum + (item.score / Math.max(1, item.maxScore)) * 100, 0) /
          sorted.length
      );
      return {
        subject: sanitizeText(subName, FIELD_LIMITS.subject),
        latestScore: Number(latest.score),
        latestMaxScore: Number(latest.maxScore),
        averagePercent: Math.max(0, Math.min(100, avgPct)),
        entriesCount: sorted.length,
        latestDate: latest.date,
        latestNote: sanitizeText(latest.teacherNote || '', FIELD_LIMITS.note),
      };
    });

  const totalScoreSum = Math.round(
    subjectSummaries.reduce((sum, s) => sum + s.latestScore, 0) * 10
  ) / 10;
  const totalMaxScoreSum = Math.round(
    subjectSummaries.reduce((sum, s) => sum + s.latestMaxScore, 0) * 10
  ) / 10;

  const averagePercent =
    totalMaxScoreSum > 0
      ? Math.round((totalScoreSum / totalMaxScoreSum) * 100)
      : studentGrades.length > 0
        ? Math.round(
            studentGrades.reduce((sum, g) => sum + (g.score / Math.max(1, g.maxScore)) * 100, 0) /
              studentGrades.length
          )
        : 0;

  const recentAttendance: PassAttendanceItem[] = studentLogs
    .slice(0, FIELD_LIMITS.maxRecentItems)
    .map((l) => ({
      date: l.date,
      status: l.status,
      note: sanitizeText(l.note || '', FIELD_LIMITS.note),
    }));

  const recentGrades: PassGradeItem[] = studentGrades
    .slice(0, FIELD_LIMITS.maxRecentItems)
    .map((g) => ({
      id: g.id,
      subject: sanitizeText(g.subject, FIELD_LIMITS.subject),
      title: sanitizeText(g.title, FIELD_LIMITS.gradeTitle),
      score: Number(g.score),
      maxScore: Number(g.maxScore),
      date: g.date,
      teacherNote: sanitizeText(g.teacherNote || '', FIELD_LIMITS.note),
    }));

  return {
    todayDate: todayLog ? todayLog.date : today,
    todayStatus: todayLog ? todayLog.status : 'none',
    totalAbsent: Math.min(365, totalAbsent),
    totalLate: Math.min(365, totalLate),
    totalExcused: Math.min(365, totalExcused),
    averagePercent: Math.max(0, Math.min(100, averagePercent)),
    subjectsCount: subjectSummaries.length,
    totalScoreSum: Math.min(50000, Math.max(0, totalScoreSum)),
    totalMaxScoreSum: Math.min(50000, Math.max(0, totalMaxScoreSum)),
    subjectSummaries,
    recentAttendance,
    recentGrades,
  };
}

function makePassAlert(
  kind: PassAlert['kind'],
  title: string,
  body: string,
  imageRef?: {
    scope: 'stage' | 'pass';
    scopeToken: string;
    mediaId: string;
    caption?: string;
  }
): PassAlert {
  const alert: PassAlert = {
    id: generateSafeId('alrt'),
    kind,
    title: sanitizeText(title, 140),
    body: sanitizeText(body, 500),
    createdAtIso: new Date().toISOString().slice(0, 19),
  };
  if (imageRef) {
    alert.imageScope = imageRef.scope;
    alert.imageScopeToken = imageRef.scopeToken;
    alert.imageMediaId = imageRef.mediaId;
    const cleanCaption = sanitizeText(imageRef.caption || '', FIELD_LIMITS.imageCaption);
    if (cleanCaption) {
      alert.imageCaption = cleanCaption;
    }
  }
  return alert;
}

function buildStageSectionsList(
  stageId: StageId,
  classrooms: Classroom[],
  students: Student[]
): StageSectionInfo[] {
  return classrooms
    .filter((c) => resolveClassroomStageId(c) === stageId)
    .slice(0, FIELD_LIMITS.maxStageSections)
    .map((c) => ({
      classId: c.id,
      name: sanitizeText(c.name, FIELD_LIMITS.className),
      studentCount: students.filter((s) => s.classId === c.id).length,
    }));
}

function makeStageBroadcast(
  kind: StageBroadcastKind,
  title: string,
  body: string,
  targetClassId: string,
  targetSectionName: string,
  subject?: string,
  imageRef?: { mediaId: string; caption?: string }
): StageBroadcastItem {
  const item: StageBroadcastItem = {
    id: generateSafeId('brc'),
    kind,
    title: sanitizeText(title, FIELD_LIMITS.broadcastTitle) || 'إشعار مدرسي',
    body: sanitizeText(body, FIELD_LIMITS.broadcastBody) || 'تحديث جديد من إدارة المدرسة.',
    targetClassId: sanitizeText(targetClassId || 'all', 128) || 'all',
    targetSectionName: sanitizeText(targetSectionName || 'جميع شعب المرحلة', FIELD_LIMITS.className),
    createdAtIso: new Date().toISOString().slice(0, 19),
  };
  if (subject && subject.trim()) {
    item.subject = sanitizeText(subject, FIELD_LIMITS.subject);
  }
  if (imageRef) {
    item.imageMediaId = imageRef.mediaId;
    const cleanCaption = sanitizeText(imageRef.caption || '', FIELD_LIMITS.imageCaption);
    if (cleanCaption) {
      item.imageCaption = cleanCaption;
    }
  }
  return item;
}

// --- Firestore Write Operations ---
export async function ensureSchoolDocument(
  uid: string,
  defaults?: Partial<
    Pick<
      School,
      'name' | 'whatsappNumber' | 'academicYear' | 'absenceAlertThreshold' | 'stageNames' | 'stageTokens'
    >
  >
): Promise<StageTokensMap> {
  const path = `schools/${uid}`;
  const schoolRef = doc(db, 'schools', uid);
  try {
    const snap = await getDoc(schoolRef);
    const defaultStageNames = defaults?.stageNames || DEFAULT_STAGE_NAMES;

    if (!snap.exists()) {
      const stageTokens: StageTokensMap = {
        stage_1: generateStageToken(),
        stage_2: generateStageToken(),
        stage_3: generateStageToken(),
      };
      const cleanName = sanitizeText(defaults?.name || 'مدرسة البيان النموذجية', FIELD_LIMITS.schoolName);
      const cleanYear = sanitizeText(defaults?.academicYear || '1448 هـ / 2026 م', FIELD_LIMITS.academicYear);

      await setDoc(schoolRef, {
        ownerId: uid,
        name: cleanName,
        whatsappNumber: sanitizePhone(defaults?.whatsappNumber || '966500000000'),
        absenceAlertThreshold: Math.max(1, Math.min(30, defaults?.absenceAlertThreshold ?? 3)),
        academicYear: cleanYear,
        stageNames: defaultStageNames,
        stageTokens,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const portalBatch = writeBatch(db);
      for (const sid of STAGE_IDS) {
        portalBatch.set(doc(db, 'stagePortals', stageTokens[sid]), {
          ownerId: uid,
          schoolId: uid,
          stageId: sid,
          stageName: defaultStageNames[sid],
          schoolName: cleanName,
          academicYear: cleanYear,
          sections: [],
          broadcasts: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await portalBatch.commit();
      await syncPublicPortalDirectory(uid, cleanName, cleanYear, defaultStageNames, stageTokens);
      return stageTokens;
    }

    const existingSchool = snap.data() as Omit<School, 'id'>;
    const existingTokens = existingSchool.stageTokens;
    const hasAllTokens =
      existingTokens &&
      typeof existingTokens.stage_1 === 'string' &&
      existingTokens.stage_1.length >= 16 &&
      typeof existingTokens.stage_2 === 'string' &&
      existingTokens.stage_2.length >= 16 &&
      typeof existingTokens.stage_3 === 'string' &&
      existingTokens.stage_3.length >= 16;

    const stageNames: StageNamesMap = {
      stage_1: existingSchool.stageNames?.stage_1 || DEFAULT_STAGE_NAMES.stage_1,
      stage_2: existingSchool.stageNames?.stage_2 || DEFAULT_STAGE_NAMES.stage_2,
      stage_3: existingSchool.stageNames?.stage_3 || DEFAULT_STAGE_NAMES.stage_3,
    };

    if (!hasAllTokens) {
      const stageTokens: StageTokensMap = {
        stage_1: existingTokens?.stage_1 || generateStageToken(),
        stage_2: existingTokens?.stage_2 || generateStageToken(),
        stage_3: existingTokens?.stage_3 || generateStageToken(),
      };
      await updateDoc(schoolRef, {
        stageTokens,
        updatedAt: serverTimestamp(),
      });

      for (const sid of STAGE_IDS) {
        const portalRef = doc(db, 'stagePortals', stageTokens[sid]);
        const pSnap = await getDoc(portalRef);
        if (!pSnap.exists()) {
          await setDoc(portalRef, {
            ownerId: uid,
            schoolId: uid,
            stageId: sid,
            stageName: stageNames[sid],
            schoolName: sanitizeText(existingSchool.name, FIELD_LIMITS.schoolName),
            academicYear: sanitizeText(existingSchool.academicYear, FIELD_LIMITS.academicYear),
            sections: [],
            broadcasts: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      return stageTokens;
    }

    return existingTokens;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncStagePortalsMetadata(
  uid: string,
  school: School,
  classrooms: Classroom[],
  students: Student[],
  syncPublicDirectory = true
): Promise<void> {
  const tokens = school.stageTokens || (await ensureSchoolDocument(uid, school));
  const stageNames = getSchoolStageNames(school);
  const cleanName = sanitizeText(school.name, FIELD_LIMITS.schoolName);
  const cleanYear = sanitizeText(school.academicYear, FIELD_LIMITS.academicYear);

  try {
    for (const sid of STAGE_IDS) {
      const token = tokens[sid];
      if (!token) continue;
      const sections = buildStageSectionsList(sid, classrooms, students);
      const portalRef = doc(db, 'stagePortals', token);
      const snap = await getDoc(portalRef);
      if (snap.exists()) {
        await updateDoc(portalRef, {
          stageName: stageNames[sid],
          schoolName: cleanName,
          academicYear: cleanYear,
          sections,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(portalRef, {
          ownerId: uid,
          schoolId: uid,
          stageId: sid,
          stageName: stageNames[sid],
          schoolName: cleanName,
          academicYear: cleanYear,
          sections,
          broadcasts: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    if (syncPublicDirectory) {
      await syncPublicPortalDirectory(uid, cleanName, cleanYear, stageNames, tokens);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'stagePortals');
  }
}

export async function syncPublicPortalDirectory(
  uid: string,
  schoolName: string,
  academicYear: string,
  stageNames: StageNamesMap,
  stageTokens: StageTokensMap
): Promise<void> {
  const cleanName = sanitizeText(schoolName, FIELD_LIMITS.schoolName) || 'مدرستي';
  const cleanYear = sanitizeText(academicYear, FIELD_LIMITS.academicYear) || '2026';

  const upsertPortalDoc = async (portalId: string, allowClaimPrimary: boolean) => {
    try {
      const ref = doc(db, 'publicPortals', portalId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const existingOwner = (snap.data() as { ownerId?: string })?.ownerId;
        if (existingOwner && existingOwner !== uid) return;
        await updateDoc(ref, {
          schoolName: cleanName,
          academicYear: cleanYear,
          stageNames,
          stageTokens,
          updatedAt: serverTimestamp(),
        });
      } else if (allowClaimPrimary || portalId === uid) {
        await setDoc(ref, {
          ownerId: uid,
          schoolId: uid,
          schoolName: cleanName,
          academicYear: cleanYear,
          stageNames,
          stageTokens,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-blocking if another school owns the primary alias
    }
  };

  await upsertPortalDoc(uid, false);
  await upsertPortalDoc('primary', true);
}

export async function sendStageCollectiveBroadcast(
  uid: string,
  school: School,
  stageId: StageId,
  stageClassrooms: Classroom[],
  stageStudents: Student[],
  payload: {
    kind: StageBroadcastKind;
    title: string;
    body: string;
    targetClassId: string; // 'all' or classroom.id
    subject?: string;
    imageDataUrl?: string;
    imageCaption?: string;
  }
): Promise<{
  stageToken: string;
  broadcast: StageBroadcastItem;
  affectedStudentsCount: number;
  affectedSectionsCount: number;
  externalPushSent: number;
  externalPushAttempted: number;
  externalPushServerReachable: boolean;
}> {
  const tokens = school.stageTokens || (await ensureSchoolDocument(uid, school));
  const stageToken = tokens[stageId];
  const stageNames = getSchoolStageNames(school);
  const cleanSchoolName = sanitizeText(school.name, FIELD_LIMITS.schoolName);
  const cleanYear = sanitizeText(school.academicYear, FIELD_LIMITS.academicYear);

  const targetClass =
    payload.targetClassId !== 'all'
      ? stageClassrooms.find((c) => c.id === payload.targetClassId)
      : undefined;

  const targetClassId = targetClass ? targetClass.id : 'all';
  const targetSectionName = targetClass
    ? sanitizeText(targetClass.name, FIELD_LIMITS.className)
    : `جميع شعب ${stageNames[stageId]}`;

  const sections = buildStageSectionsList(stageId, stageClassrooms, stageStudents);
  const portalRef = doc(db, 'stagePortals', stageToken);

  try {
    const portalSnap = await getDoc(portalRef);

    // Ensure the parent stagePortals document exists BEFORE creating any media subcollection doc
    // (required by Firestore security rules and prevents parent onSnapshot race conditions).
    if (!portalSnap.exists()) {
      await setDoc(portalRef, {
        ownerId: uid,
        schoolId: uid,
        stageId,
        stageName: stageNames[stageId],
        schoolName: cleanSchoolName,
        academicYear: cleanYear,
        sections,
        broadcasts: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    let broadcastImageRef: { mediaId: string; caption?: string } | undefined;
    let passImageRef:
      | { scope: 'stage'; scopeToken: string; mediaId: string; caption?: string }
      | undefined;

    if (payload.imageDataUrl && isValidMediaDataUrl(payload.imageDataUrl)) {
      const mediaId = generateSafeId('img');
      const cleanCaption = sanitizeText(payload.imageCaption || '', FIELD_LIMITS.imageCaption);
      await setDoc(doc(db, 'stagePortals', stageToken, 'media', mediaId), {
        ownerId: uid,
        schoolId: uid,
        dataUrl: payload.imageDataUrl,
        caption: cleanCaption,
        createdAt: serverTimestamp(),
      });
      broadcastImageRef = { mediaId, caption: cleanCaption };
      passImageRef = {
        scope: 'stage',
        scopeToken: stageToken,
        mediaId,
        caption: cleanCaption,
      };
    }

    const broadcast = makeStageBroadcast(
      payload.kind,
      payload.title,
      payload.body,
      targetClassId,
      targetSectionName,
      payload.subject,
      broadcastImageRef
    );

    const existingBroadcasts: StageBroadcastItem[] = portalSnap.exists()
      ? (((portalSnap.data() as { broadcasts?: StageBroadcastItem[] }).broadcasts || []).slice(
          0,
          FIELD_LIMITS.maxStageBroadcasts - 1
        ))
      : [];

    const nextBroadcasts = [broadcast, ...existingBroadcasts].slice(
      0,
      FIELD_LIMITS.maxStageBroadcasts
    );

    await updateDoc(portalRef, {
      stageName: stageNames[stageId],
      schoolName: cleanSchoolName,
      academicYear: cleanYear,
      sections,
      latestBroadcast: broadcast,
      broadcasts: nextBroadcasts,
      updatedAt: serverTimestamp(),
    });

    // Also push instant alert (with image reference if attached) to all targeted students' individual passes
    const targetedStudents =
      targetClassId === 'all'
        ? stageStudents
        : stageStudents.filter((s) => s.classId === targetClassId);

    const passAlertKind: PassAlert['kind'] =
      payload.kind === 'urgent'
        ? 'urgent'
        : payload.kind === 'grades'
          ? 'grades'
          : payload.kind === 'attendance'
            ? 'attendance'
            : 'announcement';

    const CHUNK_SIZE = 10;
    for (let i = 0; i < targetedStudents.length; i += CHUNK_SIZE) {
      const chunk = targetedStudents.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const student of chunk) {
        batch.update(doc(db, 'passes', student.passToken), {
          stageId,
          stageName: stageNames[stageId],
          latestAlert: makePassAlert(passAlertKind, broadcast.title, broadcast.body, passImageRef),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    const pushTitle = `${cleanSchoolName} — ${broadcast.title}`;
    const pushBody = broadcast.imageMediaId
      ? `${broadcast.body} (مرفق صورة)`
      : broadcast.body;
    const pushResult = await dispatchExternalPushForStageBroadcast({
      uid,
      stageToken,
      targetClassId,
      targetedPassTokens: targetedStudents.map((s) => s.passToken),
      title: pushTitle.slice(0, 140),
      body: pushBody.slice(0, 500),
      tag: broadcast.id,
      requireInteraction: payload.kind === 'urgent',
    });

    return {
      stageToken,
      broadcast,
      affectedStudentsCount: targetedStudents.length,
      affectedSectionsCount: targetClass ? 1 : stageClassrooms.length,
      externalPushSent: pushResult.sent,
      externalPushAttempted: pushResult.attempted,
      externalPushServerReachable: pushResult.serverReachable,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `stagePortals/${stageToken}`);
  }
}

export async function sendDirectStudentMessage(
  uid: string,
  school: School,
  stageId: StageId,
  student: Student,
  payload: {
    kind: StageBroadcastKind;
    title: string;
    body: string;
    imageDataUrl?: string;
    imageCaption?: string;
  }
): Promise<{
  alert: PassAlert;
  mediaId?: string;
  externalPushSent: number;
  externalPushAttempted: number;
  externalPushServerReachable: boolean;
}> {
  const stageNames = getSchoolStageNames(school);
  const cleanSchoolName = sanitizeText(school.name, FIELD_LIMITS.schoolName);
  const cleanTitle = sanitizeText(payload.title, 140) || 'رسالة من إدارة المدرسة';
  const cleanBody = sanitizeText(payload.body, 500) || 'إشعار خاص من إدارة المدرسة.';
  const passAlertKind: PassAlert['kind'] =
    payload.kind === 'urgent'
      ? 'urgent'
      : payload.kind === 'grades'
        ? 'grades'
        : payload.kind === 'attendance'
          ? 'attendance'
          : 'announcement';

  try {
    let imageRef:
      | { scope: 'pass'; scopeToken: string; mediaId: string; caption?: string }
      | undefined;

    if (payload.imageDataUrl && isValidMediaDataUrl(payload.imageDataUrl)) {
      const mediaId = generateSafeId('img');
      const cleanCaption = sanitizeText(payload.imageCaption || '', FIELD_LIMITS.imageCaption);
      // Strictly isolated under this student's private pass — never written to stagePortals
      await setDoc(doc(db, 'passes', student.passToken, 'media', mediaId), {
        ownerId: uid,
        schoolId: uid,
        dataUrl: payload.imageDataUrl,
        caption: cleanCaption,
        createdAt: serverTimestamp(),
      });
      imageRef = {
        scope: 'pass',
        scopeToken: student.passToken,
        mediaId,
        caption: cleanCaption,
      };
    }

    const alert = makePassAlert(passAlertKind, cleanTitle, cleanBody, imageRef);

    await updateDoc(doc(db, 'passes', student.passToken), {
      stageId,
      stageName: stageNames[stageId],
      latestAlert: alert,
      updatedAt: serverTimestamp(),
    });

    const pushTitle = `${cleanSchoolName} (${student.fullName}) — ${cleanTitle}`;
    const pushBody = imageRef ? `${cleanBody} (مرفق صورة)` : cleanBody;
    const pushResult = await dispatchExternalPushForStudentPass({
      uid,
      passToken: student.passToken,
      title: pushTitle.slice(0, 140),
      body: pushBody.slice(0, 500),
      tag: alert.id,
      requireInteraction: payload.kind === 'urgent',
    });

    return {
      alert,
      mediaId: imageRef?.mediaId,
      externalPushSent: pushResult.sent,
      externalPushAttempted: pushResult.attempted,
      externalPushServerReachable: pushResult.serverReachable,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `passes/${student.passToken}`);
  }
}

function stripImageFromBroadcast(item: StageBroadcastItem): StageBroadcastItem {
  const cleaned: StageBroadcastItem = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    targetClassId: item.targetClassId,
    targetSectionName: item.targetSectionName,
    createdAtIso: item.createdAtIso,
  };
  if (item.subject) {
    cleaned.subject = item.subject;
  }
  return cleaned;
}

function stripImageFromPassAlert(alert: PassAlert): PassAlert {
  return {
    id: alert.id,
    kind: alert.kind,
    title: alert.title,
    body: alert.body,
    createdAtIso: alert.createdAtIso,
  };
}

export async function deleteStageBroadcast(
  stageToken: string,
  broadcastId: string,
  stageStudents: Student[]
): Promise<{ deletedMediaId?: string }> {
  const portalPath = `stagePortals/${stageToken}`;
  const portalRef = doc(db, 'stagePortals', stageToken);

  try {
    const portalSnap = await getDoc(portalRef);
    if (!portalSnap.exists()) {
      return {};
    }

    const data = portalSnap.data() as {
      broadcasts?: StageBroadcastItem[];
      latestBroadcast?: StageBroadcastItem;
    };
    const existingBroadcasts = Array.isArray(data.broadcasts) ? data.broadcasts : [];
    const target = existingBroadcasts.find((b) => b.id === broadcastId);
    const nextBroadcasts = existingBroadcasts.filter((b) => b.id !== broadcastId);

    await updateDoc(portalRef, {
      broadcasts: nextBroadcasts,
      latestBroadcast: nextBroadcasts.length > 0 ? nextBroadcasts[0] : deleteField(),
      updatedAt: serverTimestamp(),
    });

    const deletedMediaId = target?.imageMediaId;
    if (deletedMediaId) {
      await deleteDoc(doc(db, 'stagePortals', stageToken, 'media', deletedMediaId)).catch(
        () => undefined
      );
    }

    // Clean up matching latestAlert on ALL targeted students' passes in chunks (non-blocking)
    if (target && stageStudents.length > 0) {
      const candidates =
        target.targetClassId === 'all'
          ? stageStudents
          : stageStudents.filter((s) => s.classId === target.targetClassId);

      const CLEANUP_CHUNK = 25;
      for (let i = 0; i < candidates.length; i += CLEANUP_CHUNK) {
        const chunk = candidates.slice(i, i + CLEANUP_CHUNK);
        await Promise.allSettled(
          chunk.map(async (stu) => {
            const passRef = doc(db, 'passes', stu.passToken);
            const passSnap = await getDoc(passRef);
            if (!passSnap.exists()) return;
            const alert = (passSnap.data() as { latestAlert?: PassAlert }).latestAlert;
            if (!alert) return;
            const matchesMedia = Boolean(deletedMediaId && alert.imageMediaId === deletedMediaId);
            const matchesText = alert.title === target.title && alert.body === target.body;
            if (matchesMedia || matchesText) {
              await updateDoc(passRef, {
                latestAlert: deleteField(),
                updatedAt: serverTimestamp(),
              });
            }
          })
        );
      }
    }

    return { deletedMediaId };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, portalPath);
  }
}

export async function removeStageBroadcastImage(
  stageToken: string,
  broadcastId: string,
  stageStudents: Student[]
): Promise<{ deletedMediaId?: string }> {
  const portalPath = `stagePortals/${stageToken}`;
  const portalRef = doc(db, 'stagePortals', stageToken);

  try {
    const portalSnap = await getDoc(portalRef);
    if (!portalSnap.exists()) {
      return {};
    }

    const data = portalSnap.data() as {
      broadcasts?: StageBroadcastItem[];
      latestBroadcast?: StageBroadcastItem;
    };
    const existingBroadcasts = Array.isArray(data.broadcasts) ? data.broadcasts : [];
    const target = existingBroadcasts.find((b) => b.id === broadcastId);
    const deletedMediaId = target?.imageMediaId;
    if (!target || !deletedMediaId) {
      return {};
    }

    const nextBroadcasts = existingBroadcasts.map((b) =>
      b.id === broadcastId ? stripImageFromBroadcast(b) : b
    );
    const nextLatest =
      data.latestBroadcast?.id === broadcastId
        ? stripImageFromBroadcast(data.latestBroadcast)
        : data.latestBroadcast;

    await updateDoc(portalRef, {
      broadcasts: nextBroadcasts,
      ...(nextLatest ? { latestBroadcast: nextLatest } : {}),
      updatedAt: serverTimestamp(),
    });

    await deleteDoc(doc(db, 'stagePortals', stageToken, 'media', deletedMediaId)).catch(
      () => undefined
    );

    if (stageStudents.length > 0) {
      const candidates =
        target.targetClassId === 'all'
          ? stageStudents
          : stageStudents.filter((s) => s.classId === target.targetClassId);

      const CLEANUP_CHUNK = 25;
      for (let i = 0; i < candidates.length; i += CLEANUP_CHUNK) {
        const chunk = candidates.slice(i, i + CLEANUP_CHUNK);
        await Promise.allSettled(
          chunk.map(async (stu) => {
            const passRef = doc(db, 'passes', stu.passToken);
            const passSnap = await getDoc(passRef);
            if (!passSnap.exists()) return;
            const alert = (passSnap.data() as { latestAlert?: PassAlert }).latestAlert;
            if (alert && alert.imageMediaId === deletedMediaId) {
              await updateDoc(passRef, {
                latestAlert: stripImageFromPassAlert(alert),
                updatedAt: serverTimestamp(),
              });
            }
          })
        );
      }
    }

    return { deletedMediaId };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, portalPath);
  }
}

export async function deleteDirectStudentAlert(
  passToken: string,
  mediaId?: string
): Promise<void> {
  const path = `passes/${passToken}`;
  try {
    await updateDoc(doc(db, 'passes', passToken), {
      latestAlert: deleteField(),
      updatedAt: serverTimestamp(),
    });
    if (mediaId) {
      await deleteDoc(doc(db, 'passes', passToken, 'media', mediaId)).catch(() => undefined);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeDirectStudentAlertImage(
  passToken: string,
  mediaId: string
): Promise<void> {
  const path = `passes/${passToken}`;
  try {
    const passRef = doc(db, 'passes', passToken);
    const passSnap = await getDoc(passRef);
    if (passSnap.exists()) {
      const alert = (passSnap.data() as { latestAlert?: PassAlert }).latestAlert;
      if (alert && alert.imageMediaId === mediaId) {
        await updateDoc(passRef, {
          latestAlert: stripImageFromPassAlert(alert),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await deleteDoc(doc(db, 'passes', passToken, 'media', mediaId)).catch(() => undefined);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export type AdminAccessResolution =
  | { status: 'owner'; schoolId: string }
  | { status: 'owner_new'; schoolId: string }
  | { status: 'staff'; schoolId: string; staffMember: StaffMember }
  | { status: 'unauthorized' };

export async function resolveAdminSchoolAccess(
  uid: string,
  email: string | null | undefined
): Promise<AdminAccessResolution> {
  const normalizedEmail = email ? normalizeStaffEmail(email) : '';

  // 1. Check if this Google user is an explicitly added administration staff member
  if (normalizedEmail && isValidStaffEmail(normalizedEmail)) {
    try {
      const staffSnap = await getDoc(doc(db, 'staffMembers', normalizedEmail));
      if (staffSnap.exists()) {
        const data = staffSnap.data() as Omit<StaffMember, 'id'>;
        return {
          status: 'staff',
          schoolId: data.schoolId,
          staffMember: { id: staffSnap.id, ...data },
        };
      }
    } catch {
      // Not a staff member or no access — continue checking ownership
    }
  }

  // 2. Check if this user already owns a school document
  try {
    const ownSchoolSnap = await getDoc(doc(db, 'schools', uid));
    if (ownSchoolSnap.exists()) {
      return { status: 'owner', schoolId: uid };
    }
  } catch {
    // Continue to check primary portal claim
  }

  // 3. If no primary school exists yet (or user is app admin), allow initial school creation
  if (normalizedEmail === 'waadpc90@gmail.com') {
    return { status: 'owner_new', schoolId: uid };
  }

  try {
    const primarySnap = await getDoc(doc(db, 'publicPortals', 'primary'));
    if (!primarySnap.exists()) {
      return { status: 'owner_new', schoolId: uid };
    }
    const primaryData = primarySnap.data() as { ownerId?: string };
    if (primaryData?.ownerId === uid) {
      return { status: 'owner_new', schoolId: uid };
    }
  } catch {
    // Default deny if directory check fails
  }

  return { status: 'unauthorized' };
}

export async function setSchoolAdminPin(schoolId: string, newPin: string): Promise<void> {
  if (!isValidAdminPinFormat(newPin)) {
    throw new Error('الرمز يجب أن يكون بين 4 و 16 خانة.');
  }
  const path = `schools/${schoolId}`;
  const { hash, salt } = await hashAdminPin(newPin);
  try {
    await updateDoc(doc(db, 'schools', schoolId), {
      adminPinHash: hash,
      adminPinSalt: salt,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addSchoolStaffMember(
  schoolId: string,
  addedByUid: string,
  input: {
    email: string;
    displayName: string;
    role: StaffRole;
  }
): Promise<StaffMember> {
  const email = normalizeStaffEmail(input.email);
  if (!isValidStaffEmail(email)) {
    throw new Error('أدخل بريداً إلكترونياً صحيحاً.');
  }
  const displayName = sanitizeText(input.displayName, 80);
  if (!displayName) {
    throw new Error('أدخل اسم عضو الإدارة.');
  }
  const role: StaffRole = ['vice_principal', 'teacher', 'supervisor', 'admin_staff'].includes(
    input.role
  )
    ? input.role
    : 'admin_staff';

  const path = `staffMembers/${email}`;
  const ref = doc(db, 'staffMembers', email);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data() as Omit<StaffMember, 'id'>;
      if (existingData.ownerId !== schoolId) {
        throw new Error('هذا البريد مرتبط بمدرسة أخرى.');
      }
      await updateDoc(ref, {
        displayName,
        role,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        schoolId,
        ownerId: schoolId,
        email,
        displayName,
        role,
        addedByUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return {
      id: email,
      schoolId,
      ownerId: schoolId,
      email,
      displayName,
      role,
      addedByUid,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'هذا البريد مرتبط بمدرسة أخرى.') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeSchoolStaffMember(memberEmail: string): Promise<void> {
  const email = normalizeStaffEmail(memberEmail);
  const path = `staffMembers/${email}`;
  try {
    await deleteDoc(doc(db, 'staffMembers', email));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateStageSubjects(
  uid: string,
  school: School,
  stageId: StageId,
  subjects: string[]
): Promise<string[]> {
  const path = `schools/${uid}`;
  const currentMap = getSchoolStageSubjectsMap(school);
  const cleanList = sanitizeSchoolSubjects(subjects);
  const nextMap: StageSubjectsMap = {
    ...currentMap,
    [stageId]: cleanList,
  };
  try {
    await updateDoc(doc(db, 'schools', uid), {
      stageSubjects: nextMap,
      updatedAt: serverTimestamp(),
    });
    return cleanList;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateAllStageSubjects(
  uid: string,
  stageSubjects: StageSubjectsMap
): Promise<StageSubjectsMap> {
  const path = `schools/${uid}`;
  const cleanMap = sanitizeStageSubjects(stageSubjects);
  try {
    await updateDoc(doc(db, 'schools', uid), {
      stageSubjects: cleanMap,
      updatedAt: serverTimestamp(),
    });
    return cleanMap;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSchoolSettings(
  uid: string,
  students: Student[],
  classrooms: Classroom[],
  updates: {
    name: string;
    whatsappNumber: string;
    absenceAlertThreshold: number;
    academicYear: string;
    stageNames: StageNamesMap;
    subjects?: string[];
    stageSubjects?: StageSubjectsMap;
  }
): Promise<void> {
  const path = `schools/${uid}`;
  const cleanName = sanitizeText(updates.name, FIELD_LIMITS.schoolName) || 'مدرستي';
  const cleanPhone = sanitizePhone(updates.whatsappNumber);
  const cleanThreshold = Math.max(1, Math.min(30, Math.round(Number(updates.absenceAlertThreshold) || 3)));
  const cleanYear = sanitizeText(updates.academicYear, FIELD_LIMITS.academicYear) || '2026';
  const cleanStageNames: StageNamesMap = {
    stage_1: sanitizeText(updates.stageNames.stage_1, FIELD_LIMITS.stage) || DEFAULT_STAGE_NAMES.stage_1,
    stage_2: sanitizeText(updates.stageNames.stage_2, FIELD_LIMITS.stage) || DEFAULT_STAGE_NAMES.stage_2,
    stage_3: sanitizeText(updates.stageNames.stage_3, FIELD_LIMITS.stage) || DEFAULT_STAGE_NAMES.stage_3,
  };
  const cleanSubjects = updates.subjects ? sanitizeSchoolSubjects(updates.subjects) : undefined;
  const cleanStageSubjects = updates.stageSubjects
    ? sanitizeStageSubjects(updates.stageSubjects)
    : undefined;

  const classStageLookup = new Map(classrooms.map((c) => [c.id, resolveClassroomStageId(c)]));

  try {
    const schoolUpdatePayload: Record<string, unknown> = {
      name: cleanName,
      whatsappNumber: cleanPhone,
      absenceAlertThreshold: cleanThreshold,
      academicYear: cleanYear,
      stageNames: cleanStageNames,
      updatedAt: serverTimestamp(),
    };
    if (cleanSubjects) {
      schoolUpdatePayload.subjects = cleanSubjects;
    }
    if (cleanStageSubjects) {
      schoolUpdatePayload.stageSubjects = cleanStageSubjects;
    }

    await updateDoc(doc(db, 'schools', uid), schoolUpdatePayload);

    const CHUNK_SIZE = 10;
    for (let i = 0; i < students.length; i += CHUNK_SIZE) {
      const chunk = students.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const student of chunk) {
        const sid = student.stageId || classStageLookup.get(student.classId) || 'stage_1';
        batch.update(doc(db, 'passes', student.passToken), {
          schoolName: cleanName,
          schoolWhatsapp: cleanPhone,
          absenceAlertThreshold: cleanThreshold,
          academicYear: cleanYear,
          stageId: sid,
          stageName: cleanStageNames[sid],
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    const schoolSnap = await getDoc(doc(db, 'schools', uid));
    if (schoolSnap.exists()) {
      const updatedSchool = { id: schoolSnap.id, ...(schoolSnap.data() as Omit<School, 'id'>) };
      await syncStagePortalsMetadata(uid, updatedSchool, classrooms, students);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createClassroom(
  uid: string,
  school: School,
  input: { name: string; stageId: StageId; homeroomTeacher: string }
): Promise<string> {
  const classId = generateSafeId('cls');
  const path = `schools/${uid}/classrooms/${classId}`;
  const stageNames = getSchoolStageNames(school);
  try {
    await setDoc(doc(db, 'schools', uid, 'classrooms', classId), {
      ownerId: uid,
      schoolId: uid,
      stageId: input.stageId,
      name: sanitizeText(input.name, FIELD_LIMITS.className),
      stage: sanitizeText(stageNames[input.stageId], FIELD_LIMITS.stage),
      homeroomTeacher: sanitizeText(input.homeroomTeacher || '', FIELD_LIMITS.teacherName),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return classId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteClassroom(uid: string, classId: string): Promise<void> {
  const path = `schools/${uid}/classrooms/${classId}`;
  try {
    await deleteDoc(doc(db, 'schools', uid, 'classrooms', classId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createStudentWithPass(
  uid: string,
  school: School,
  classroom: Classroom,
  input: {
    fullName: string;
    studentCode: string;
    parentName: string;
    parentPhone: string;
  }
): Promise<{ studentId: string; passToken: string }> {
  const studentId = generateSafeId('stu');
  const passToken = generatePassToken();
  const path = `schools/${uid}/students/${studentId}`;
  const stageId = resolveClassroomStageId(classroom);
  const stageNames = getSchoolStageNames(school);

  const cleanName = sanitizeText(input.fullName, FIELD_LIMITS.studentName);
  const cleanCode = sanitizeText(
    input.studentCode || `ST-${Math.floor(100 + Math.random() * 899)}`,
    FIELD_LIMITS.studentCode
  );
  const cleanParentName = sanitizeText(input.parentName || '', FIELD_LIMITS.parentName);
  const cleanParentPhone = sanitizePhone(input.parentPhone || '');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'schools', uid, 'students', studentId), {
      ownerId: uid,
      schoolId: uid,
      stageId,
      classId: classroom.id,
      className: sanitizeText(classroom.name, FIELD_LIMITS.className),
      fullName: cleanName,
      studentCode: cleanCode,
      parentName: cleanParentName,
      parentPhone: cleanParentPhone,
      passToken,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'passes', passToken), {
      ownerId: uid,
      schoolId: uid,
      studentId,
      stageId,
      stageName: stageNames[stageId],
      schoolName: sanitizeText(school.name, FIELD_LIMITS.schoolName),
      schoolWhatsapp: sanitizePhone(school.whatsappNumber),
      academicYear: sanitizeText(school.academicYear, FIELD_LIMITS.academicYear),
      studentDisplayName: cleanName,
      studentCode: cleanCode,
      className: sanitizeText(classroom.name, FIELD_LIMITS.className),
      absenceAlertThreshold: school.absenceAlertThreshold,
      todayDate: getTodayIso(),
      todayStatus: 'none',
      totalAbsent: 0,
      totalLate: 0,
      totalExcused: 0,
      averagePercent: 0,
      subjectsCount: 0,
      totalScoreSum: 0,
      totalMaxScoreSum: 0,
      subjectSummaries: [],
      recentAttendance: [],
      recentGrades: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return { studentId, passToken };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function bulkCreateStudentsWithPasses(
  uid: string,
  school: School,
  classroom: Classroom,
  entries: Array<{
    fullName: string;
    studentCode?: string;
    parentName?: string;
    parentPhone?: string;
  }>,
  existingCodes: string[] = []
): Promise<{ createdCount: number }> {
  const path = `schools/${uid}/students`;
  const stageId = resolveClassroomStageId(classroom);
  const stageNames = getSchoolStageNames(school);
  const cleanSchoolName = sanitizeText(school.name, FIELD_LIMITS.schoolName);
  const cleanSchoolWhatsapp = sanitizePhone(school.whatsappNumber);
  const cleanAcademicYear = sanitizeText(school.academicYear, FIELD_LIMITS.academicYear);
  const cleanClassName = sanitizeText(classroom.name, FIELD_LIMITS.className);
  const todayIso = getTodayIso();

  const usedCodes = new Set(existingCodes.map((c) => c.trim().toLowerCase()).filter(Boolean));
  let seqNum = Math.max(101, existingCodes.length + 101);

  const nextUniqueCode = (): string => {
    while (usedCodes.has(`st-${seqNum}`)) {
      seqNum += 1;
    }
    const code = `ST-${seqNum}`;
    usedCodes.add(code.toLowerCase());
    seqNum += 1;
    return code;
  };

  const validEntries = entries
    .map((entry) => {
      const fullName = sanitizeText(entry.fullName || '', FIELD_LIMITS.studentName);
      if (!fullName) return null;
      const rawCode = sanitizeText(entry.studentCode || '', FIELD_LIMITS.studentCode);
      const studentCode = rawCode || nextUniqueCode();
      usedCodes.add(studentCode.toLowerCase());
      return {
        fullName,
        studentCode,
        parentName: sanitizeText(entry.parentName || '', FIELD_LIMITS.parentName),
        parentPhone: sanitizePhone(entry.parentPhone || ''),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 200);

  if (validEntries.length === 0) {
    return { createdCount: 0 };
  }

  try {
    // Each student writes 2 docs (student + pass), so chunk at 150 students = 300 ops (< 500 Firestore batch limit)
    const CHUNK_SIZE = 150;
    for (let i = 0; i < validEntries.length; i += CHUNK_SIZE) {
      const chunk = validEntries.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      for (const item of chunk) {
        const studentId = generateSafeId('stu');
        const passToken = generatePassToken();

        batch.set(doc(db, 'schools', uid, 'students', studentId), {
          ownerId: uid,
          schoolId: uid,
          stageId,
          classId: classroom.id,
          className: cleanClassName,
          fullName: item.fullName,
          studentCode: item.studentCode,
          parentName: item.parentName,
          parentPhone: item.parentPhone,
          passToken,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'passes', passToken), {
          ownerId: uid,
          schoolId: uid,
          studentId,
          stageId,
          stageName: stageNames[stageId],
          schoolName: cleanSchoolName,
          schoolWhatsapp: cleanSchoolWhatsapp,
          academicYear: cleanAcademicYear,
          studentDisplayName: item.fullName,
          studentCode: item.studentCode,
          className: cleanClassName,
          absenceAlertThreshold: school.absenceAlertThreshold,
          todayDate: todayIso,
          todayStatus: 'none',
          totalAbsent: 0,
          totalLate: 0,
          totalExcused: 0,
          averagePercent: 0,
          subjectsCount: 0,
          totalScoreSum: 0,
          totalMaxScoreSum: 0,
          subjectSummaries: [],
          recentAttendance: [],
          recentGrades: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    return { createdCount: validEntries.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStudentAndPass(
  uid: string,
  school: School,
  student: Student,
  classroom: Classroom,
  input: {
    fullName: string;
    studentCode: string;
    parentName: string;
    parentPhone: string;
  }
): Promise<void> {
  const path = `schools/${uid}/students/${student.id}`;
  const stageId = resolveClassroomStageId(classroom);
  const stageNames = getSchoolStageNames(school);
  const cleanName = sanitizeText(input.fullName, FIELD_LIMITS.studentName);
  const cleanCode = sanitizeText(input.studentCode, FIELD_LIMITS.studentCode);
  const cleanParentName = sanitizeText(input.parentName, FIELD_LIMITS.parentName);
  const cleanParentPhone = sanitizePhone(input.parentPhone);
  const cleanClassName = sanitizeText(classroom.name, FIELD_LIMITS.className);
  const movedClassOrStage = student.classId !== classroom.id || student.stageId !== stageId;
  const renamedStudent = student.fullName !== cleanName;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'schools', uid, 'students', student.id), {
      stageId,
      classId: classroom.id,
      className: cleanClassName,
      fullName: cleanName,
      studentCode: cleanCode,
      parentName: cleanParentName,
      parentPhone: cleanParentPhone,
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'passes', student.passToken), {
      stageId,
      stageName: stageNames[stageId],
      studentDisplayName: cleanName,
      studentCode: cleanCode,
      className: cleanClassName,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    // Keep historical attendance logs and grade entries aligned if student moved class/stage or was renamed
    if (movedClassOrStage || renamedStudent) {
      const [attSnap, grdSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'schools', uid, 'attendanceLogs'),
            where('studentId', '==', student.id)
          )
        ),
        getDocs(
          query(
            collection(db, 'schools', uid, 'gradeEntries'),
            where('studentId', '==', student.id)
          )
        ),
      ]);

      const refsToSync = [
        ...attSnap.docs.map((d) => ({ ref: d.ref })),
        ...grdSnap.docs.map((d) => ({ ref: d.ref })),
      ];

      const CHUNK = 150;
      for (let i = 0; i < refsToSync.length; i += CHUNK) {
        const subBatch = writeBatch(db);
        for (const item of refsToSync.slice(i, i + CHUNK)) {
          subBatch.update(item.ref, {
            stageId,
            classId: classroom.id,
            studentName: cleanName,
            updatedAt: serverTimestamp(),
          });
        }
        await subBatch.commit();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudentWithPass(uid: string, student: Student): Promise<void> {
  const path = `schools/${uid}/students/${student.id}`;
  try {
    // 1. Collect all orphaned child records (attendance logs, grade entries, pass subcollections)
    const [attSnap, grdSnap, pushSnap, ackSnap, passSnap] = await Promise.all([
      getDocs(
        query(collection(db, 'schools', uid, 'attendanceLogs'), where('studentId', '==', student.id))
      ),
      getDocs(
        query(collection(db, 'schools', uid, 'gradeEntries'), where('studentId', '==', student.id))
      ),
      getDocs(
        query(
          collection(db, 'passes', student.passToken, 'pushSubscriptions'),
          where('schoolOwnerId', '==', uid)
        )
      ).catch(() => null),
      getDocs(
        query(
          collection(db, 'passes', student.passToken, 'acknowledgements'),
          where('schoolOwnerId', '==', uid)
        )
      ).catch(() => null),
      getDoc(doc(db, 'passes', student.passToken)).catch(() => null),
    ]);

    const deleteRefs = [
      ...attSnap.docs.map((d) => d.ref),
      ...grdSnap.docs.map((d) => d.ref),
      ...(pushSnap ? pushSnap.docs.map((d) => d.ref) : []),
      ...(ackSnap ? ackSnap.docs.map((d) => d.ref) : []),
    ];

    if (passSnap?.exists()) {
      const alert = (passSnap.data() as { latestAlert?: PassAlert }).latestAlert;
      if (alert?.imageScope === 'pass' && alert.imageMediaId) {
        deleteRefs.push(doc(db, 'passes', student.passToken, 'media', alert.imageMediaId));
      }
    }

    // Delete dependent records in safe batches (< 500 ops)
    const CHUNK = 200;
    for (let i = 0; i < deleteRefs.length; i += CHUNK) {
      const depBatch = writeBatch(db);
      for (const ref of deleteRefs.slice(i, i + CHUNK)) {
        depBatch.delete(ref);
      }
      await depBatch.commit();
    }

    // Finally delete the student document and their public pass atomically
    const finalBatch = writeBatch(db);
    finalBatch.delete(doc(db, 'schools', uid, 'students', student.id));
    finalBatch.delete(doc(db, 'passes', student.passToken));
    await finalBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function promoteStageStudents(
  uid: string,
  school: School,
  fromStageId: StageId,
  toStageId: StageId,
  targetClassroom: Classroom,
  allClassrooms: Classroom[],
  allStudents: Student[]
): Promise<{ promotedCount: number }> {
  const path = `schools/${uid}/students`;
  const stageNames = getSchoolStageNames(school);
  const cleanClassName = sanitizeText(targetClassroom.name, FIELD_LIMITS.className);
  const targetStageStudents = allStudents.filter((s) => s.stageId === fromStageId);

  if (targetStageStudents.length === 0) {
    return { promotedCount: 0 };
  }

  try {
    // Update students + passes in chunks of 100 (= 200 ops per batch)
    const CHUNK = 100;
    for (let i = 0; i < targetStageStudents.length; i += CHUNK) {
      const chunk = targetStageStudents.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const stu of chunk) {
        batch.update(doc(db, 'schools', uid, 'students', stu.id), {
          stageId: toStageId,
          classId: targetClassroom.id,
          className: cleanClassName,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'passes', stu.passToken), {
          stageId: toStageId,
          stageName: stageNames[toStageId],
          className: cleanClassName,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    // Sync updated section student counts to stage portals
    const updatedStudents = allStudents.map((s) =>
      s.stageId === fromStageId
        ? { ...s, stageId: toStageId, classId: targetClassroom.id, className: cleanClassName }
        : s
    );
    await syncStagePortalsMetadata(uid, school, allClassrooms, updatedStudents, false);

    return { promotedCount: targetStageStudents.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveClassAttendanceBatch(
  uid: string,
  school: School,
  stageId: StageId,
  classStudents: Student[],
  existingAllLogs: AttendanceLog[],
  existingAllGrades: GradeEntry[],
  date: string,
  statusMap: Record<string, AttendanceStatus>,
  noteMap: Record<string, string>
): Promise<void> {
  const path = `schools/${uid}/attendanceLogs`;
  const stageNames = getSchoolStageNames(school);

  try {
    const existingById = new Map(existingAllLogs.map((l) => [l.id, l]));
    const updatedLogsPool = [...existingAllLogs];
    const CHUNK_SIZE = 5;

    for (let i = 0; i < classStudents.length; i += CHUNK_SIZE) {
      const chunk = classStudents.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      for (const student of chunk) {
        const logId = `${date}_${student.id}`;
        const status: AttendanceStatus = statusMap[student.id] || 'present';
        const note = sanitizeText(noteMap[student.id] || '', FIELD_LIMITS.note);
        const existingLog = existingById.get(logId);
        const logRef = doc(db, 'schools', uid, 'attendanceLogs', logId);

        if (existingLog) {
          batch.update(logRef, {
            stageId,
            status,
            note,
            studentName: sanitizeText(student.fullName, FIELD_LIMITS.studentName),
            classId: student.classId,
            notifiedViaWhatsapp:
              existingLog.status === status ? existingLog.notifiedViaWhatsapp : false,
            notifiedAt: existingLog.status === status ? existingLog.notifiedAt : '',
            updatedAt: serverTimestamp(),
          });
          const idx = updatedLogsPool.findIndex((l) => l.id === logId);
          if (idx >= 0) {
            updatedLogsPool[idx] = { ...existingLog, stageId, status, note };
          }
        } else {
          const newLog: AttendanceLog = {
            id: logId,
            ownerId: uid,
            schoolId: uid,
            stageId,
            classId: student.classId,
            studentId: student.id,
            studentName: sanitizeText(student.fullName, FIELD_LIMITS.studentName),
            date,
            status,
            note,
            notifiedViaWhatsapp: false,
            notifiedAt: '',
          };
          batch.set(logRef, {
            ownerId: newLog.ownerId,
            schoolId: newLog.schoolId,
            stageId,
            classId: newLog.classId,
            studentId: newLog.studentId,
            studentName: newLog.studentName,
            date: newLog.date,
            status: newLog.status,
            note: newLog.note,
            notifiedViaWhatsapp: false,
            notifiedAt: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          updatedLogsPool.push(newLog);
        }

        const passMetrics = computePassMetrics(
          student.id,
          updatedLogsPool,
          existingAllGrades,
          stageId
        );

        const alertTitle =
          status === 'absent'
            ? `تنبيه غياب — ${formatArabicDate(date)}`
            : status === 'late'
              ? `إشعار تأخر — ${formatArabicDate(date)}`
              : status === 'excused'
                ? `غياب بعذر — ${formatArabicDate(date)}`
                : `تأكيد حضور — ${formatArabicDate(date)}`;

        const alertBody =
          status === 'absent'
            ? `تم تسجيل غياب الطالب في ${stageNames[stageId]}${note ? ` (${note})` : ''}.`
            : status === 'late'
              ? `تم تسجيل تأخر الطالب عن الطابور الصباحي${note ? ` (${note})` : ''}.`
              : status === 'excused'
                ? `تم اعتماد عذر الغياب لهذا اليوم${note ? ` (${note})` : ''}.`
                : `نطمئنكم بحضور الطالب بانتظام اليوم.`;

        batch.update(doc(db, 'passes', student.passToken), {
          stageId,
          stageName: stageNames[stageId],
          todayDate: passMetrics.todayDate,
          todayStatus: passMetrics.todayStatus,
          totalAbsent: passMetrics.totalAbsent,
          totalLate: passMetrics.totalLate,
          totalExcused: passMetrics.totalExcused,
          recentAttendance: passMetrics.recentAttendance,
          latestAlert: makePassAlert('attendance', alertTitle, alertBody),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    // Automatically push collective instant attendance notification to this stage's QR portal
    if (classStudents.length > 0 && school.stageTokens?.[stageId]) {
      const sectionName = classStudents[0].className;
      const sectionId = classStudents[0].classId;
      let presentCnt = 0;
      let absentCnt = 0;
      let lateCnt = 0;
      for (const s of classStudents) {
        const st = statusMap[s.id] || 'present';
        if (st === 'present') presentCnt++;
        else if (st === 'absent') absentCnt++;
        else if (st === 'late') lateCnt++;
      }
      const portalRef = doc(db, 'stagePortals', school.stageTokens[stageId]);
      const pSnap = await getDoc(portalRef);
      const prevBroadcasts: StageBroadcastItem[] = pSnap.exists()
        ? (((pSnap.data() as { broadcasts?: StageBroadcastItem[] }).broadcasts || []).slice(
            0,
            FIELD_LIMITS.maxStageBroadcasts - 1
          ))
        : [];
      const bItem = makeStageBroadcast(
        'attendance',
        `اعتماد حضور وغياب ${sectionName} — ${formatArabicDate(date)}`,
        `تم تحديث سجل الحضور والغياب في ${stageNames[stageId]} (${sectionName}): حاضر ${presentCnt} · غائب ${absentCnt} · متأخر ${lateCnt}. تم إرسال إشعار فوري لبطاقة كل طالب.`,
        sectionId,
        sectionName
      );
      if (pSnap.exists()) {
        await updateDoc(portalRef, {
          latestBroadcast: bItem,
          broadcasts: [bItem, ...prevBroadcasts].slice(0, FIELD_LIMITS.maxStageBroadcasts),
          updatedAt: serverTimestamp(),
        });
      }

      // Trigger external OS push notifications for stage subscribers + absent/late students' parents
      void dispatchExternalPushForStageBroadcast({
        uid,
        stageToken: school.stageTokens[stageId],
        targetClassId: sectionId,
        targetedPassTokens: [],
        title: `${school.name} — ${bItem.title}`.slice(0, 140),
        body: bItem.body.slice(0, 500),
        tag: bItem.id,
      });

      const alertStudents = classStudents.filter((s) => {
        const st = statusMap[s.id] || 'present';
        return st === 'absent' || st === 'late';
      });
      void (async () => {
        const PUSH_CHUNK = 25;
        for (let i = 0; i < alertStudents.length; i += PUSH_CHUNK) {
          const chunk = alertStudents.slice(i, i + PUSH_CHUNK);
          await Promise.allSettled(
            chunk.map((student) => {
              const st = statusMap[student.id];
              const note = sanitizeText(noteMap[student.id] || '', FIELD_LIMITS.note);
              const title =
                st === 'absent'
                  ? `${school.name}: تنبيه غياب ${student.fullName}`
                  : `${school.name}: إشعار تأخر ${student.fullName}`;
              const body =
                st === 'absent'
                  ? `تم تسجيل غياب ${student.fullName} اليوم (${formatArabicDate(date)})${note ? ` — ${note}` : ''}.`
                  : `تم تسجيل تأخر ${student.fullName} اليوم (${formatArabicDate(date)})${note ? ` — ${note}` : ''}.`;
              return dispatchExternalPushForStudentPass({
                uid,
                passToken: student.passToken,
                title: title.slice(0, 140),
                body: body.slice(0, 500),
                tag: `att_${date}_${student.id}`,
                requireInteraction: st === 'absent',
              });
            })
          );
        }
      })();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveClassGradesBatch(
  uid: string,
  school: School,
  stageId: StageId,
  classStudents: Student[],
  existingAllLogs: AttendanceLog[],
  existingAllGrades: GradeEntry[],
  payload: {
    subject: string;
    title: string;
    maxScore: number;
    date: string;
    scores: Record<string, string>;
    notes: Record<string, string>;
  }
): Promise<GradeEntry[]> {
  const path = `schools/${uid}/gradeEntries`;
  const stageNames = getSchoolStageNames(school);
  const cleanSubject = sanitizeText(payload.subject, FIELD_LIMITS.subject);
  const cleanTitle = sanitizeText(payload.title, FIELD_LIMITS.gradeTitle);
  const cleanMax = Math.max(1, Math.min(1000, Number(payload.maxScore) || 20));
  const createdEntries: GradeEntry[] = [];
  const updatedGradesPool = [...existingAllGrades];

  const eligibleStudents = classStudents.filter((student) => {
    const rawScore = payload.scores[student.id];
    return rawScore !== undefined && rawScore.trim() !== '' && !Number.isNaN(Number(rawScore));
  });

  if (eligibleStudents.length === 0) {
    return [];
  }

  try {
    const CHUNK_SIZE = 5;
    for (let i = 0; i < eligibleStudents.length; i += CHUNK_SIZE) {
      const chunk = eligibleStudents.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      for (const student of chunk) {
        const numericScore = Number(payload.scores[student.id]);
        const clampedScore = Math.max(0, Math.min(cleanMax, Math.round(numericScore * 10) / 10));
        const cleanNote = sanitizeText(payload.notes[student.id] || '', FIELD_LIMITS.note);
        const gradeId = generateSafeId('grd');

        const entry: GradeEntry = {
          id: gradeId,
          ownerId: uid,
          schoolId: uid,
          stageId,
          classId: student.classId,
          studentId: student.id,
          studentName: sanitizeText(student.fullName, FIELD_LIMITS.studentName),
          subject: cleanSubject,
          title: cleanTitle,
          score: clampedScore,
          maxScore: cleanMax,
          date: payload.date,
          teacherNote: cleanNote,
          notifiedViaWhatsapp: false,
        };

        batch.set(doc(db, 'schools', uid, 'gradeEntries', gradeId), {
          ownerId: entry.ownerId,
          schoolId: entry.schoolId,
          stageId,
          classId: entry.classId,
          studentId: entry.studentId,
          studentName: entry.studentName,
          subject: entry.subject,
          title: entry.title,
          score: entry.score,
          maxScore: entry.maxScore,
          date: entry.date,
          teacherNote: entry.teacherNote,
          notifiedViaWhatsapp: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        createdEntries.push(entry);
        updatedGradesPool.push(entry);

        const passMetrics = computePassMetrics(
          student.id,
          existingAllLogs,
          updatedGradesPool,
          stageId
        );
        const rating = classifyPercentage(passMetrics.averagePercent);
        const alertTitle = `إشعار فوري: رصد درجة ${cleanSubject} (${clampedScore}/${cleanMax})`;
        const alertBody = `تم تجميع ${passMetrics.subjectsCount} مواد في بطاقة الخلاصة · المجموع ${passMetrics.totalScoreSum}/${passMetrics.totalMaxScoreSum} · المعدل العام ${passMetrics.averagePercent}% (${rating.label}).`;

        batch.update(doc(db, 'passes', student.passToken), {
          stageId,
          stageName: stageNames[stageId],
          averagePercent: passMetrics.averagePercent,
          subjectsCount: passMetrics.subjectsCount,
          totalScoreSum: passMetrics.totalScoreSum,
          totalMaxScoreSum: passMetrics.totalMaxScoreSum,
          subjectSummaries: passMetrics.subjectSummaries,
          recentGrades: passMetrics.recentGrades,
          latestAlert: makePassAlert('grades', alertTitle, alertBody),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    // Automatically push collective instant grade-release broadcast to this stage's QR portal
    if (createdEntries.length > 0 && school.stageTokens?.[stageId]) {
      const sectionName = eligibleStudents[0]?.className || 'الشعبة';
      const sectionId = eligibleStudents[0]?.classId || 'all';
      const avgPct = Math.round(
        createdEntries.reduce((acc, g) => acc + (g.score / Math.max(1, g.maxScore)) * 100, 0) /
          createdEntries.length
      );
      const portalRef = doc(db, 'stagePortals', school.stageTokens[stageId]);
      const pSnap = await getDoc(portalRef);
      const prevBroadcasts: StageBroadcastItem[] = pSnap.exists()
        ? (((pSnap.data() as { broadcasts?: StageBroadcastItem[] }).broadcasts || []).slice(
            0,
            FIELD_LIMITS.maxStageBroadcasts - 1
          ))
        : [];
      const bItem = makeStageBroadcast(
        'grades',
        `نشر درجات ${cleanSubject} (${cleanTitle}) — ${sectionName}`,
        `تم رصد درجات مادة ${cleanSubject} لـ ${createdEntries.length} طالب في ${stageNames[stageId]} (${sectionName}) بمتوسط ${avgPct}%، وتجميعها تلقائياً مع باقي المواد في بطاقة خلاصة كل طالب.`,
        sectionId,
        sectionName,
        cleanSubject
      );
      if (pSnap.exists()) {
        await updateDoc(portalRef, {
          latestBroadcast: bItem,
          broadcasts: [bItem, ...prevBroadcasts].slice(0, FIELD_LIMITS.maxStageBroadcasts),
          updatedAt: serverTimestamp(),
        });
      }

      // Trigger external OS push notifications for stage & student pass subscribers
      void dispatchExternalPushForStageBroadcast({
        uid,
        stageToken: school.stageTokens[stageId],
        targetClassId: sectionId,
        targetedPassTokens: eligibleStudents.map((s) => s.passToken),
        title: `${school.name} — ${bItem.title}`.slice(0, 140),
        body: bItem.body.slice(0, 500),
        tag: bItem.id,
      });
    }

    return createdEntries;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function pushInstantSummaryAlertToSection(
  school: School,
  stageId: StageId,
  sectionStudents: Student[],
  allLogs: AttendanceLog[],
  allGrades: GradeEntry[]
): Promise<void> {
  const stageNames = getSchoolStageNames(school);
  const CHUNK_SIZE = 10;

  try {
    for (let i = 0; i < sectionStudents.length; i += CHUNK_SIZE) {
      const chunk = sectionStudents.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      for (const student of chunk) {
        const metrics = computePassMetrics(student.id, allLogs, allGrades, stageId);
        const rating = classifyPercentage(metrics.averagePercent);
        const title = `خلاصة الدرجات والغياب جاهزة — ${stageNames[stageId]}`;
        const body =
          metrics.subjectsCount > 0
            ? `إجمالي ${metrics.subjectsCount} مواد: ${metrics.totalScoreSum}/${metrics.totalMaxScoreSum} (${metrics.averagePercent}% — ${rating.label}) · الغياب: ${metrics.totalAbsent}.`
            : `تحديث سجل الحضور: الغياب بدون عذر ${metrics.totalAbsent} · التأخر ${metrics.totalLate}.`;

        batch.update(doc(db, 'passes', student.passToken), {
          stageId,
          stageName: stageNames[stageId],
          averagePercent: metrics.averagePercent,
          subjectsCount: metrics.subjectsCount,
          totalScoreSum: metrics.totalScoreSum,
          totalMaxScoreSum: metrics.totalMaxScoreSum,
          subjectSummaries: metrics.subjectSummaries,
          recentAttendance: metrics.recentAttendance,
          recentGrades: metrics.recentGrades,
          latestAlert: makePassAlert('summary', title, body),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    // Also notify the Stage QR Portal instantly via website
    if (sectionStudents.length > 0 && school.stageTokens?.[stageId]) {
      const sectionName = sectionStudents[0].className;
      const sectionId = sectionStudents[0].classId;
      const portalRef = doc(db, 'stagePortals', school.stageTokens[stageId]);
      const pSnap = await getDoc(portalRef);
      const prevBroadcasts: StageBroadcastItem[] = pSnap.exists()
        ? (((pSnap.data() as { broadcasts?: StageBroadcastItem[] }).broadcasts || []).slice(
            0,
            FIELD_LIMITS.maxStageBroadcasts - 1
          ))
        : [];
      const bItem = makeStageBroadcast(
        'grades',
        `خلاصة جميع المواد جاهزة — ${sectionName} (${stageNames[stageId]})`,
        `تم تجميع درجات جميع المواد والغياب في بطاقة خلاصة موحدة لطلاب ${sectionName}. يرجى فتح بطاقة ابنكم للاطلاع الفوري.`,
        sectionId,
        sectionName
      );
      if (pSnap.exists()) {
        await updateDoc(portalRef, {
          latestBroadcast: bItem,
          broadcasts: [bItem, ...prevBroadcasts].slice(0, FIELD_LIMITS.maxStageBroadcasts),
          updatedAt: serverTimestamp(),
        });
      }

      void dispatchExternalPushForStageBroadcast({
        uid: school.ownerId,
        stageToken: school.stageTokens[stageId],
        targetClassId: sectionId,
        targetedPassTokens: sectionStudents.map((s) => s.passToken),
        title: `${school.name} — ${bItem.title}`.slice(0, 140),
        body: bItem.body.slice(0, 500),
        tag: bItem.id,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'passes');
  }
}

export async function deleteGradeEntryAndSyncPass(
  uid: string,
  entry: GradeEntry,
  student: Student | undefined,
  allLogs: AttendanceLog[],
  allGrades: GradeEntry[]
): Promise<void> {
  const path = `schools/${uid}/gradeEntries/${entry.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'schools', uid, 'gradeEntries', entry.id));

    if (student) {
      const remainingGrades = allGrades.filter((g) => g.id !== entry.id);
      const passMetrics = computePassMetrics(
        student.id,
        allLogs,
        remainingGrades,
        student.stageId
      );
      batch.update(doc(db, 'passes', student.passToken), {
        averagePercent: passMetrics.averagePercent,
        subjectsCount: passMetrics.subjectsCount,
        totalScoreSum: passMetrics.totalScoreSum,
        totalMaxScoreSum: passMetrics.totalMaxScoreSum,
        subjectSummaries: passMetrics.subjectSummaries,
        recentGrades: passMetrics.recentGrades,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- One-Click 3-Stage Realistic Arabic Demo Seeder ---
function offsetDateIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function seedDemoSchoolData(uid: string, school: School): Promise<void> {
  try {
    await ensureSchoolDocument(uid, school);
    const stageNames = getSchoolStageNames(school);

    // Create 6 sections across all 3 stages (2 sections per stage)
    const sectionSpecs: {
      id: string;
      stageId: StageId;
      name: string;
      teacher: string;
    }[] = [
      { id: generateSafeId('cls'), stageId: 'stage_1', name: 'شعبة أ', teacher: 'أ. عبد الله الحربي' },
      { id: generateSafeId('cls'), stageId: 'stage_1', name: 'شعبة ب', teacher: 'أ. سالم الدليمي' },
      { id: generateSafeId('cls'), stageId: 'stage_2', name: 'شعبة أ', teacher: 'أ. خالد الشمري' },
      { id: generateSafeId('cls'), stageId: 'stage_2', name: 'شعبة ب', teacher: 'أ. حيدر الجبوري' },
      { id: generateSafeId('cls'), stageId: 'stage_3', name: 'شعبة أ', teacher: 'أ. طارق العزاوي' },
      { id: generateSafeId('cls'), stageId: 'stage_3', name: 'شعبة ب', teacher: 'أ. مصطفى السعدي' },
    ];

    const classBatch = writeBatch(db);
    for (const sec of sectionSpecs) {
      classBatch.set(doc(db, 'schools', uid, 'classrooms', sec.id), {
        ownerId: uid,
        schoolId: uid,
        stageId: sec.stageId,
        name: sec.name,
        stage: stageNames[sec.stageId],
        homeroomTeacher: sec.teacher,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await classBatch.commit();

    const demoStudentsSpec = [
      // Stage 1 - Section A
      {
        sec: sectionSpecs[0],
        fullName: 'يوسف عبد الرحمن العتيبي',
        studentCode: 'M1-101',
        parentName: 'أبو يوسف العتيبي',
        parentPhone: '966551234501',
        statuses: ['present', 'present', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 94, max: 100, note: 'متفوق في حل المسائل.' },
          { subject: 'اللغة العربية', score: 90, max: 100, note: 'أسلوب كتابي ممتاز.' },
          { subject: 'العلوم', score: 96, max: 100, note: 'مشاركة مميزة في المختبر.' },
        ],
      },
      {
        sec: sectionSpecs[0],
        fullName: 'سارة محمد القحطاني',
        studentCode: 'M1-102',
        parentName: 'والد الطالبة سارة',
        parentPhone: '966551234502',
        statuses: ['absent', 'absent', 'absent'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 62, max: 100, note: 'تحتاج مراجعة التمارين اليومية.' },
          { subject: 'اللغة العربية', score: 74, max: 100, note: 'تحسن جيد في القراءة.' },
          { subject: 'العلوم', score: 68, max: 100, note: 'يرجى المتابعة المنزلية.' },
        ],
      },
      {
        sec: sectionSpecs[0],
        fullName: 'عمر فيصل الدوسري',
        studentCode: 'M1-103',
        parentName: 'فيصل الدوسري',
        parentPhone: '966551234503',
        statuses: ['late', 'present', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 85, max: 100, note: 'أداء جيد جداً.' },
          { subject: 'اللغة العربية', score: 88, max: 100, note: 'تفاعل منتظم.' },
          { subject: 'العلوم', score: 82, max: 100, note: 'جيد جداً.' },
        ],
      },
      // Stage 1 - Section B
      {
        sec: sectionSpecs[1],
        fullName: 'ليان ناصر الغامدي',
        studentCode: 'M1-201',
        parentName: 'ناصر الغامدي',
        parentPhone: '966551234504',
        statuses: ['present', 'excused', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 98, max: 100, note: 'إتقان كامل للمنهج.' },
          { subject: 'اللغة العربية', score: 95, max: 100, note: 'متميزة.' },
        ],
      },
      // Stage 2 - Section A
      {
        sec: sectionSpecs[2],
        fullName: 'نورة سلطان الشهري',
        studentCode: 'M2-101',
        parentName: 'سلطان الشهري',
        parentPhone: '966551234601',
        statuses: ['present', 'present', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 92, max: 100, note: 'دقة عالية في الحل.' },
          { subject: 'الفيزياء', score: 95, max: 100, note: 'فهم رائع للقوانين.' },
          { subject: 'اللغة الإنجليزية', score: 89, max: 100, note: 'مشاركة فعالة.' },
        ],
      },
      {
        sec: sectionSpecs[2],
        fullName: 'أحمد طارق الزهراني',
        studentCode: 'M2-102',
        parentName: 'طارق الزهراني',
        parentPhone: '966551234602',
        statuses: ['absent', 'late', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 65, max: 100, note: 'يحتاج تركيزاً أكبر.' },
          { subject: 'الفيزياء', score: 68, max: 100, note: 'يحتاج مراجعة المسائل.' },
        ],
      },
      // Stage 2 - Section B
      {
        sec: sectionSpecs[3],
        fullName: 'حسين علي الساعدي',
        studentCode: 'M2-201',
        parentName: 'علي الساعدي',
        parentPhone: '9647701234501',
        statuses: ['present', 'present', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 88, max: 100, note: 'أداء مستقر.' },
          { subject: 'الفيزياء', score: 91, max: 100, note: 'ممتاز.' },
        ],
      },
      // Stage 3 - Section A
      {
        sec: sectionSpecs[4],
        fullName: 'زينب كريم الحسيني',
        studentCode: 'M3-101',
        parentName: 'كريم الحسيني',
        parentPhone: '9647701234601',
        statuses: ['present', 'present', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 97, max: 100, note: 'مستوى متفوق.' },
          { subject: 'الكيمياء', score: 94, max: 100, note: 'إتقان للمعادلات.' },
          { subject: 'الأحياء', score: 96, max: 100, note: 'درجة ممتازة.' },
        ],
      },
      // Stage 3 - Section B
      {
        sec: sectionSpecs[5],
        fullName: 'مصطفى علاء التميمي',
        studentCode: 'M3-201',
        parentName: 'علاء التميمي',
        parentPhone: '9647701234602',
        statuses: ['late', 'absent', 'present'] as AttendanceStatus[],
        grades: [
          { subject: 'الرياضيات', score: 78, max: 100, note: 'جيد ويتطور.' },
          { subject: 'الكيمياء', score: 72, max: 100, note: 'يحتاج مراجعة الفصل الثاني.' },
        ],
      },
    ];

    const dates = [offsetDateIso(0), offsetDateIso(1), offsetDateIso(2)];

    for (const spec of demoStudentsSpec) {
      const studentBatch = writeBatch(db);
      const studentId = generateSafeId('stu');
      const passToken = generatePassToken();
      const stageId = spec.sec.stageId;

      studentBatch.set(doc(db, 'schools', uid, 'students', studentId), {
        ownerId: uid,
        schoolId: uid,
        stageId,
        classId: spec.sec.id,
        className: spec.sec.name,
        fullName: spec.fullName,
        studentCode: spec.studentCode,
        parentName: spec.parentName,
        parentPhone: spec.parentPhone,
        passToken,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const studentLogs: AttendanceLog[] = [];
      spec.statuses.forEach((st, idx) => {
        const d = dates[idx];
        const logId = `${d}_${studentId}`;
        const note =
          st === 'absent' && idx === 0
            ? 'لم يحضر الحصة الأولى'
            : st === 'late' && idx === 0
              ? 'تأخر 15 دقيقة عن الطابور'
              : st === 'excused'
                ? 'عذر طبي مقبول'
                : '';

        const logObj: AttendanceLog = {
          id: logId,
          ownerId: uid,
          schoolId: uid,
          stageId,
          classId: spec.sec.id,
          studentId,
          studentName: spec.fullName,
          date: d,
          status: st,
          note,
          notifiedViaWhatsapp: idx > 0 && st !== 'present',
          notifiedAt: idx > 0 && st !== 'present' ? `${d}T08:15:00` : '',
        };
        studentLogs.push(logObj);

        studentBatch.set(doc(db, 'schools', uid, 'attendanceLogs', logId), {
          ownerId: uid,
          schoolId: uid,
          stageId,
          classId: spec.sec.id,
          studentId,
          studentName: spec.fullName,
          date: d,
          status: st,
          note,
          notifiedViaWhatsapp: logObj.notifiedViaWhatsapp,
          notifiedAt: logObj.notifiedAt,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      const studentGrades: GradeEntry[] = spec.grades.map((g, idx) => ({
        id: generateSafeId('grd'),
        ownerId: uid,
        schoolId: uid,
        stageId,
        classId: spec.sec.id,
        studentId,
        studentName: spec.fullName,
        subject: g.subject,
        title: 'امتحان الشهر الأول',
        score: g.score,
        maxScore: g.max,
        date: dates[idx % dates.length],
        teacherNote: g.note,
        notifiedViaWhatsapp: idx > 0,
      }));

      for (const g of studentGrades) {
        studentBatch.set(doc(db, 'schools', uid, 'gradeEntries', g.id), {
          ownerId: g.ownerId,
          schoolId: g.schoolId,
          stageId,
          classId: g.classId,
          studentId: g.studentId,
          studentName: g.studentName,
          subject: g.subject,
          title: g.title,
          score: g.score,
          maxScore: g.maxScore,
          date: g.date,
          teacherNote: g.teacherNote,
          notifiedViaWhatsapp: g.notifiedViaWhatsapp,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const passMetrics = computePassMetrics(studentId, studentLogs, studentGrades, stageId);
      const rating = classifyPercentage(passMetrics.averagePercent);
      studentBatch.set(doc(db, 'passes', passToken), {
        ownerId: uid,
        schoolId: uid,
        studentId,
        stageId,
        stageName: stageNames[stageId],
        schoolName: school.name,
        schoolWhatsapp: school.whatsappNumber,
        academicYear: school.academicYear,
        studentDisplayName: spec.fullName,
        studentCode: spec.studentCode,
        className: spec.sec.name,
        absenceAlertThreshold: school.absenceAlertThreshold,
        todayDate: passMetrics.todayDate,
        todayStatus: passMetrics.todayStatus,
        totalAbsent: passMetrics.totalAbsent,
        totalLate: passMetrics.totalLate,
        totalExcused: passMetrics.totalExcused,
        averagePercent: passMetrics.averagePercent,
        subjectsCount: passMetrics.subjectsCount,
        totalScoreSum: passMetrics.totalScoreSum,
        totalMaxScoreSum: passMetrics.totalMaxScoreSum,
        subjectSummaries: passMetrics.subjectSummaries,
        latestAlert: makePassAlert(
          'summary',
          `خلاصة ${passMetrics.subjectsCount} مواد جاهزة — ${stageNames[stageId]}`,
          `المجموع ${passMetrics.totalScoreSum}/${passMetrics.totalMaxScoreSum} · المعدل العام ${passMetrics.averagePercent}% (${rating.label}).`
        ),
        recentAttendance: passMetrics.recentAttendance,
        recentGrades: passMetrics.recentGrades,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await studentBatch.commit();
    }

    // Seed initial live collective broadcasts on all 3 Stage QR Portals
    const tokens = await ensureSchoolDocument(uid, school);
    for (const sid of STAGE_IDS) {
      const stageSections: StageSectionInfo[] = sectionSpecs
        .filter((s) => s.stageId === sid)
        .map((s) => ({
          classId: s.id,
          name: s.name,
          studentCount: demoStudentsSpec.filter((st) => st.sec.id === s.id).length,
        }));

      const welcomeBroadcast = makeStageBroadcast(
        'announcement',
        `بوابة ${stageNames[sid]}`,
        `تصل هنا جميع الإعلانات وتنبيهات الغياب والدرجات بشكل فوري ومباشر.`,
        'all',
        `جميع شعب ${stageNames[sid]}`
      );
      const gradesBroadcast = makeStageBroadcast(
        'grades',
        `درجات الشهر الأول — ${stageNames[sid]}`,
        `تم تحديث درجات المواد لشعب ${stageNames[sid]}.`,
        'all',
        `جميع شعب ${stageNames[sid]}`
      );

      const portalRef = doc(db, 'stagePortals', tokens[sid]);
      const pSnap = await getDoc(portalRef);
      if (pSnap.exists()) {
        await updateDoc(portalRef, {
          stageName: stageNames[sid],
          schoolName: sanitizeText(school.name, FIELD_LIMITS.schoolName),
          academicYear: sanitizeText(school.academicYear, FIELD_LIMITS.academicYear),
          sections: stageSections,
          latestBroadcast: gradesBroadcast,
          broadcasts: [gradesBroadcast, welcomeBroadcast],
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(portalRef, {
          ownerId: uid,
          schoolId: uid,
          stageId: sid,
          stageName: stageNames[sid],
          schoolName: sanitizeText(school.name, FIELD_LIMITS.schoolName),
          academicYear: sanitizeText(school.academicYear, FIELD_LIMITS.academicYear),
          sections: stageSections,
          latestBroadcast: gradesBroadcast,
          broadcasts: [gradesBroadcast, welcomeBroadcast],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schools/${uid}`);
  }
}
