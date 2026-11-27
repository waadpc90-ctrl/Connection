import { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Award,
  ClipboardCheck,
  Copy,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  QrCode,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';
import { canManageDestructiveRecords } from '../lib/adminSecurity';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildParentsPortalUrl,
  ensureSchoolDocument,
  resolveAdminSchoolAccess,
  seedDemoSchoolData,
  syncStagePortalsMetadata,
} from '../lib/wisaalService';
import {
  AttendanceLog,
  Classroom,
  getSchoolStageNames,
  getTodayIso,
  GradeEntry,
  resolveClassroomStageId,
  resolveRecordStageId,
  School,
  SchoolTab,
  STAFF_ROLE_LABELS,
  StaffMember,
  STAGE_IDS,
  StageId,
  Student,
} from '../types/wisaal';
import { AdminPinGate } from './AdminPinGate';
import { AttendanceTab } from './AttendanceTab';
import { GradesTab } from './GradesTab';
import { OverviewTab } from './OverviewTab';
import { SettingsTab } from './SettingsTab';
import { StageBroadcastsTab } from './StageBroadcastsTab';
import { StudentsQrTab } from './StudentsQrTab';

interface SchoolDashboardProps {
  user: User;
  onSignOut: () => void;
  onPreviewPass: (passToken: string) => void;
  onPreviewStagePortal: (stageToken: string) => void;
  onOpenParentsPortal: (schoolId?: string) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

const NAV_ITEMS: { id: SchoolTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stage-broadcasts', label: 'الإشعارات', icon: Megaphone },
  { id: 'attendance', label: 'الغياب', icon: ClipboardCheck },
  { id: 'grades', label: 'الدرجات', icon: Award },
  { id: 'students', label: 'الطلاب', icon: QrCode },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

const MOBILE_BAR_TABS: SchoolTab[] = [
  'overview',
  'stage-broadcasts',
  'attendance',
  'grades',
  'students',
];

export function SchoolDashboard({
  user,
  onSignOut,
  onPreviewPass,
  onPreviewStagePortal,
  onOpenParentsPortal,
  onNotify,
}: SchoolDashboardProps) {
  const [activeTab, setActiveTab] = useState<SchoolTab>('overview');
  const [activeStageId, setActiveStageId] = useState<StageId>('stage_1');
  const [navDirection, setNavDirection] = useState<number>(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const [accessState, setAccessState] = useState<
    'checking' | 'authorized' | 'unauthorized'
  >('checking');
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [isSchoolOwner, setIsSchoolOwner] = useState<boolean>(false);
  const [currentStaffMember, setCurrentStaffMember] = useState<StaffMember | null>(null);
  const [isPinUnlocked, setIsPinUnlocked] = useState<boolean>(false);

  const [school, setSchool] = useState<School | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [gradeEntries, setGradeEntries] = useState<GradeEntry[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [seeding, setSeeding] = useState<boolean>(false);

  // Step 1: Resolve whether signed-in Google account is the school owner or an added admin staff member
  useEffect(() => {
    let active = true;
    setAccessState('checking');
    setIsPinUnlocked(false);
    setSchool(null);
    setSchoolId(null);
    setCurrentStaffMember(null);
    setLoading(true);

    const checkAccess = async () => {
      try {
        const res = await resolveAdminSchoolAccess(user.uid, user.email);
        if (!active) return;

        if (res.status === 'unauthorized') {
          setAccessState('unauthorized');
          setLoading(false);
          return;
        }

        if (res.status === 'owner_new') {
          await ensureSchoolDocument(res.schoolId);
          if (!active) return;
          setSchoolId(res.schoolId);
          setIsSchoolOwner(true);
          setAccessState('authorized');
          return;
        }

        if (res.status === 'owner') {
          await ensureSchoolDocument(res.schoolId);
          if (!active) return;
          setSchoolId(res.schoolId);
          setIsSchoolOwner(true);
          setAccessState('authorized');
          return;
        }

        // Staff member
        setSchoolId(res.schoolId);
        setIsSchoolOwner(false);
        setCurrentStaffMember(res.staffMember);
        setAccessState('authorized');
      } catch (err) {
        console.error('Admin access resolution failed:', err);
        if (active) {
          setAccessState('unauthorized');
          setLoading(false);
        }
      }
    };

    void checkAccess();
    return () => {
      active = false;
    };
  }, [user.uid, user.email]);

  // Step 2: Subscribe to school root doc (for PIN hash & school metadata)
  useEffect(() => {
    if (accessState !== 'authorized' || !schoolId) return;

    const schoolRef = doc(db, 'schools', schoolId);
    const unsub = onSnapshot(
      schoolRef,
      (snap) => {
        if (snap.exists()) {
          setSchool({ id: snap.id, ...(snap.data() as Omit<School, 'id'>) });
        } else {
          setSchool(null);
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.GET, `schools/${schoolId}`);
      }
    );

    return () => unsub();
  }, [accessState, schoolId]);

  // Step 3: Only subscribe to private school subcollections AFTER PIN is unlocked in memory
  useEffect(() => {
    if (accessState !== 'authorized' || !schoolId || !isPinUnlocked) {
      setClassrooms([]);
      setStudents([]);
      setAttendanceLogs([]);
      setGradeEntries([]);
      setStaffMembers([]);
      return;
    }

    const unsubs: (() => void)[] = [];

    const classesQ = query(
      collection(db, 'schools', schoolId, 'classrooms'),
      where('ownerId', '==', schoolId)
    );
    unsubs.push(
      onSnapshot(
        classesQ,
        (snap) => {
          setClassrooms(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/classrooms`)
      )
    );

    const studentsQ = query(
      collection(db, 'schools', schoolId, 'students'),
      where('ownerId', '==', schoolId)
    );
    unsubs.push(
      onSnapshot(
        studentsQ,
        (snap) => {
          setStudents(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/students`)
      )
    );

    const logsQ = query(
      collection(db, 'schools', schoolId, 'attendanceLogs'),
      where('ownerId', '==', schoolId)
    );
    unsubs.push(
      onSnapshot(
        logsQ,
        (snap) => {
          setAttendanceLogs(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceLog, 'id'>) }))
          );
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/attendanceLogs`)
      )
    );

    const gradesQ = query(
      collection(db, 'schools', schoolId, 'gradeEntries'),
      where('ownerId', '==', schoolId)
    );
    unsubs.push(
      onSnapshot(
        gradesQ,
        (snap) => {
          setGradeEntries(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeEntry, 'id'>) }))
          );
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `schools/${schoolId}/gradeEntries`)
      )
    );

    if (isSchoolOwner) {
      const staffQ = query(
        collection(db, 'staffMembers'),
        where('ownerId', '==', schoolId)
      );
      unsubs.push(
        onSnapshot(
          staffQ,
          (snap) => {
            setStaffMembers(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffMember, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'staffMembers')
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [accessState, schoolId, isPinUnlocked, isSchoolOwner]);

  const lastPortalSyncSigRef = useRef<string>('');

  const handleSeedDemo = async () => {
    if (!school || !schoolId) return;
    setSeeding(true);
    try {
      await seedDemoSchoolData(schoolId, school);
      onNotify('success', 'تم إضافة البيانات النموذجية للمراحل الثلاث.');
    } catch {
      onNotify('error', 'تعذر تحميل البيانات النموذجية.');
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    if (!school?.stageTokens || !schoolId || !isPinUnlocked) return;
    const classSig = classrooms
      .map((c) => `${c.id}:${c.name}:${resolveClassroomStageId(c)}`)
      .sort()
      .join('|');
    const studentCountsByClass: Record<string, number> = {};
    for (const s of students) {
      studentCountsByClass[s.classId] = (studentCountsByClass[s.classId] || 0) + 1;
    }
    const countsSig = Object.entries(studentCountsByClass)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const names = getSchoolStageNames(school);
    const sig = `${school.name}|${school.academicYear}|${names.stage_1}|${names.stage_2}|${names.stage_3}|${classSig}|${countsSig}`;
    if (sig === lastPortalSyncSigRef.current) return;
    lastPortalSyncSigRef.current = sig;

    const timer = window.setTimeout(() => {
      syncStagePortalsMetadata(schoolId, school, classrooms, students, isSchoolOwner).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [schoolId, school, classrooms, students, isPinUnlocked, isSchoolOwner]);

  const stageNames = useMemo(() => getSchoolStageNames(school), [school]);
  const activeStageName = stageNames[activeStageId];
  const activeStageToken = school?.stageTokens?.[activeStageId] || '';

  const classStageLookup = useMemo(
    () => new Map(classrooms.map((c) => [c.id, resolveClassroomStageId(c)])),
    [classrooms]
  );

  const stageStats = useMemo(() => {
    const map: Record<StageId, { sections: number; students: number }> = {
      stage_1: { sections: 0, students: 0 },
      stage_2: { sections: 0, students: 0 },
      stage_3: { sections: 0, students: 0 },
    };
    for (const c of classrooms) {
      map[resolveClassroomStageId(c)].sections += 1;
    }
    for (const s of students) {
      const sid = resolveRecordStageId(s.stageId, s.classId, classStageLookup);
      map[sid].students += 1;
    }
    return map;
  }, [classrooms, students, classStageLookup]);

  const stageClassrooms = useMemo(
    () => classrooms.filter((c) => resolveClassroomStageId(c) === activeStageId),
    [classrooms, activeStageId]
  );

  const stageStudents = useMemo(
    () =>
      students.filter(
        (s) => resolveRecordStageId(s.stageId, s.classId, classStageLookup) === activeStageId
      ),
    [students, classStageLookup, activeStageId]
  );

  const stageAttendanceLogs = useMemo(
    () =>
      attendanceLogs.filter(
        (l) => resolveRecordStageId(l.stageId, l.classId, classStageLookup) === activeStageId
      ),
    [attendanceLogs, classStageLookup, activeStageId]
  );

  const stageGradeEntries = useMemo(
    () =>
      gradeEntries.filter(
        (g) => resolveRecordStageId(g.stageId, g.classId, classStageLookup) === activeStageId
      ),
    [gradeEntries, classStageLookup, activeStageId]
  );

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const todayExceptionsCount = useMemo(() => {
    const today = getTodayIso();
    return stageAttendanceLogs.filter(
      (l) => l.date === today && (l.status === 'absent' || l.status === 'late')
    ).length;
  }, [stageAttendanceLogs]);

  const handleSelectTab = (tab: SchoolTab) => {
    if (tab !== activeTab) {
      const prevIdx = NAV_ITEMS.findIndex((n) => n.id === activeTab);
      const nextIdx = NAV_ITEMS.findIndex((n) => n.id === tab);
      setNavDirection(nextIdx >= prevIdx ? 1 : -1);
      setActiveTab(tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setMobileMenuOpen(false);
  };

  const handleSelectStage = (sid: StageId) => {
    if (sid === activeStageId) return;
    const prevIdx = STAGE_IDS.indexOf(activeStageId);
    const nextIdx = STAGE_IDS.indexOf(sid);
    setNavDirection(nextIdx >= prevIdx ? 1 : -1);
    setActiveStageId(sid);
  };

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  // Loading access resolution or school root doc
  if (accessState === 'checking' || (accessState === 'authorized' && loading)) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] flex items-center justify-center p-6">
        <div className="text-center">
          <p className="font-display text-2xl font-bold text-slate-900 mb-2">وصال</p>
          <p className="text-sm text-slate-500">جاري التحقق من صلاحية الدخول...</p>
        </div>
      </div>
    );
  }

  // Unauthorized Google account (not owner and not added to administration staff)
  if (accessState === 'unauthorized' || !schoolId || !school) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] text-slate-900 flex flex-col">
        <header className="bg-white/95 border-b border-slate-200/80">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <span className="font-display text-lg font-bold text-slate-900">وصال</span>
            <button
              type="button"
              onClick={() => onOpenParentsPortal()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowRight className="w-4 h-4" />
              <span>واجهة أولياء الأمور</span>
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full bg-white border border-slate-200/80 rounded-xl p-7 text-center space-y-4">
            <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h1 className="font-display text-lg font-bold text-slate-900">
              الحساب غير مصرح له
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              الحساب{' '}
              <span className="font-mono text-slate-900" dir="ltr">
                {user.email}
              </span>{' '}
              غير مضاف ضمن أعضاء الإدارة. اطلب من مدير المدرسة إضافة بريدك من الإعدادات.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={onSignOut}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تبديل الحساب</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenParentsPortal()}
                className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                الأولياء
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Admin PIN Lock Gate (always locked until unlocked in memory for this session)
  if (!isPinUnlocked) {
    const hasPinConfigured = Boolean(school.adminPinHash && school.adminPinSalt);
    return (
      <AdminPinGate
        schoolId={schoolId}
        schoolName={school.name}
        userEmail={user.email || ''}
        isSchoolOwner={isSchoolOwner}
        hasPinConfigured={hasPinConfigured}
        pinHash={school.adminPinHash}
        pinSalt={school.adminPinSalt}
        onUnlocked={() => setIsPinUnlocked(true)}
        onSignOut={onSignOut}
        onBackToParents={() => onOpenParentsPortal(schoolId)}
        onNotify={onNotify}
      />
    );
  }

  const roleLabel = isSchoolOwner
    ? 'مدير المدرسة'
    : currentStaffMember
      ? STAFF_ROLE_LABELS[currentStaffMember.role]
      : 'عضو إدارة';

  const contentTransitionKey = `${activeTab}_${activeTab === 'settings' ? 'all' : activeStageId}`;

  return (
    <div className="min-h-screen bg-[#F4F6F5] text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col w-[256px] shrink-0 bg-white border-l border-slate-200/80 sticky top-0 h-screen shadow-[0_0_24px_rgba(15,23,42,0.02)]">
        <div className="h-16 px-5 border-b border-slate-200/75 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-800 text-white flex items-center justify-center shrink-0 shadow-xs">
              <GraduationCap className="w-4 h-4" />
            </div>
            <span className="font-display text-lg font-bold text-slate-900 whitespace-nowrap tracking-tight">
              وصال
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsPinUnlocked(false)}
            title="قفل لوحة الإدارة"
            aria-label="قفل لوحة الإدارة"
            className="p-2 text-slate-400 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-900 truncate">{school.name}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {roleLabel} · {school.academicYear}
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="القائمة الرئيسية">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const metaCount =
              item.id === 'students'
                ? stageStudents.length
                : item.id === 'attendance' && todayExceptionsCount > 0
                  ? todayExceptionsCount
                  : null;

            return (
              <motion.button
                key={item.id}
                type="button"
                whileTap={{ scale: 0.985 }}
                onClick={() => handleSelectTab(item.id)}
                className={`relative w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm rounded-xl transition-colors whitespace-nowrap ${
                  active
                    ? 'text-emerald-950 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50/90 font-medium'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="desktop-nav-active"
                    transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    className="absolute inset-0 rounded-xl bg-emerald-50/95 border border-emerald-200/75 shadow-[0_1px_2px_rgba(6,95,70,0.05)]"
                  />
                )}
                {active && (
                  <motion.span
                    layoutId="desktop-nav-rail"
                    transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    className="absolute right-0 top-2.5 bottom-2.5 w-1 rounded-l-full bg-emerald-700"
                  />
                )}
                <span className="relative z-10 flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
                      active ? 'text-emerald-700 scale-105' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>

                {metaCount !== null && (
                  <span
                    className={`relative z-10 text-[11px] font-mono tabular-nums ${
                      item.id === 'attendance'
                        ? 'text-rose-700 font-semibold'
                        : active
                          ? 'text-emerald-800/80'
                          : 'text-slate-400'
                    }`}
                  >
                    {metaCount}
                  </span>
                )}
              </motion.button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200/75 space-y-2.5 bg-slate-50/50">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onOpenParentsPortal(schoolId)}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/70 rounded-lg transition-colors whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span>الأولياء</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(buildParentsPortalUrl(schoolId))
                  .then(() => onNotify('success', 'تم نسخ رابط بوابة الأولياء.'))
                  .catch(() => onNotify('error', 'تعذر النسخ.'));
              }}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5 shrink-0" />
              <span>الرابط</span>
            </button>
          </div>
          <p className="text-[11px] font-medium text-slate-500 truncate px-0.5" dir="ltr">
            {user.email}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setIsPinUnlocked(false)}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>قفل</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile RTL Slide Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="no-print fixed inset-0 z-40 lg:hidden flex">
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              className="relative z-10 w-[276px] max-w-[82vw] bg-white h-full border-l border-slate-200/80 shadow-2xl rounded-l-2xl flex flex-col"
            >
              <div className="h-14 px-5 border-b border-slate-200/75 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-800 text-white flex items-center justify-center shrink-0">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <span className="font-display text-base font-bold text-slate-900">وصال</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="إغلاق القائمة"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-5 py-3.5 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-900 truncate">{school.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {roleLabel} · {school.academicYear}
                </p>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectTab(item.id)}
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-xl transition-colors ${
                        active
                          ? 'bg-emerald-50 text-emerald-950 font-bold border border-emerald-200/70'
                          : 'text-slate-600 hover:bg-slate-50 font-medium'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] shrink-0 ${
                          active ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-slate-200/75 space-y-2 bg-slate-50/50 pb-safe">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenParentsPortal(schoolId);
                  }}
                  className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/70 rounded-xl"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>واجهة أولياء الأمور</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setIsPinUnlocked(false);
                    }}
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>قفل</span>
                  </button>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>خروج</span>
                  </button>
                </div>
              </div>
            </motion.aside>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex-1 bg-slate-950/35 backdrop-blur-[2px]"
              onClick={() => setMobileMenuOpen(false)}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col pb-20 lg:pb-0">
        <header className="no-print sticky top-0 z-20 h-14 sm:h-16 bg-white/88 backdrop-blur-md border-b border-slate-200/75 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="القائمة"
              className="lg:hidden min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 rounded-xl transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-baseline gap-2 min-w-0 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.h1
                  key={activeNavMeta.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="font-display text-base sm:text-lg font-bold text-slate-900 whitespace-nowrap"
                >
                  {activeNavMeta.label}
                </motion.h1>
              </AnimatePresence>
              {activeTab !== 'settings' && (
                <span className="hidden sm:inline text-xs text-slate-400 truncate">
                  · {activeStageName}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeTab !== 'settings' && (
              <div
                className="hidden md:inline-flex items-center gap-1 p-1 bg-slate-100/90 border border-slate-200/60 rounded-xl shrink-0"
                role="tablist"
                aria-label="اختيار المرحلة"
              >
                {STAGE_IDS.map((sid) => {
                  const isActive = activeStageId === sid;
                  const stat = stageStats[sid];
                  return (
                    <button
                      key={sid}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => handleSelectStage(sid)}
                      className={`relative px-3.5 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap ${
                        isActive
                          ? 'text-emerald-950 font-bold'
                          : 'text-slate-600 hover:text-slate-900 font-medium'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="desktop-stage-active"
                          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                          className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)] border border-slate-200/70"
                        />
                      )}
                      <span className="relative z-10 inline-flex items-center gap-1.5">
                        <span>{stageNames[sid]}</span>
                        <span
                          className={`font-mono tabular-nums text-[11px] ${
                            isActive ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {stat.students}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsPinUnlocked(false)}
              title="قفل لوحة الإدارة"
              aria-label="قفل لوحة الإدارة"
              className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 border border-slate-200/80 rounded-xl transition-colors"
            >
              <Lock className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Compact Mobile Stage Switcher (non-sticky so sticky cap stays <= 15%) */}
        {activeTab !== 'settings' && (
          <div className="no-print md:hidden bg-white/95 border-b border-slate-200/75 px-3.5 py-2">
            <div
              className="grid grid-cols-3 gap-1 p-1 bg-slate-100/90 rounded-xl"
              role="tablist"
              aria-label="اختيار المرحلة"
            >
              {STAGE_IDS.map((sid) => {
                const isActive = activeStageId === sid;
                return (
                  <button
                    key={sid}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSelectStage(sid)}
                    className={`relative px-2 py-1.5 text-xs rounded-lg transition-colors truncate ${
                      isActive ? 'text-emerald-950 font-bold' : 'text-slate-600 font-medium'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="mobile-stage-active"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        className="absolute inset-0 rounded-lg bg-white shadow-xs border border-slate-200/60"
                      />
                    )}
                    <span className="relative z-10 block truncate">{stageNames[sid]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-8 max-w-5xl w-full mx-auto overflow-x-clip">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={contentTransitionKey}
              initial={{ opacity: 0, x: navDirection * -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: navDirection * 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'overview' && (
                <OverviewTab
                  school={school}
                  stageId={activeStageId}
                  stageName={activeStageName}
                  stageToken={activeStageToken}
                  totalSchoolStudents={students.length}
                  classrooms={stageClassrooms}
                  students={stageStudents}
                  attendanceLogs={stageAttendanceLogs}
                  gradeEntries={stageGradeEntries}
                  seeding={seeding}
                  onSeedDemo={handleSeedDemo}
                  onNavigate={handleSelectTab}
                  onPreviewPass={onPreviewPass}
                  onPreviewStagePortal={onPreviewStagePortal}
                />
              )}

              {activeTab === 'stage-broadcasts' && (
                <StageBroadcastsTab
                  uid={schoolId}
                  school={school}
                  activeStageId={activeStageId}
                  activeStageName={activeStageName}
                  allClassrooms={classrooms}
                  allStudents={students}
                  stageClassrooms={stageClassrooms}
                  stageStudents={stageStudents}
                  onPreviewStagePortal={onPreviewStagePortal}
                  onPreviewPass={onPreviewPass}
                  onNotify={onNotify}
                />
              )}

              {activeTab === 'attendance' && (
                <AttendanceTab
                  uid={schoolId}
                  school={school}
                  stageId={activeStageId}
                  stageName={activeStageName}
                  stageToken={activeStageToken}
                  classrooms={stageClassrooms}
                  students={stageStudents}
                  attendanceLogs={stageAttendanceLogs}
                  gradeEntries={stageGradeEntries}
                  onPreviewPass={onPreviewPass}
                  onPreviewStagePortal={onPreviewStagePortal}
                  onNotify={onNotify}
                />
              )}

              {activeTab === 'grades' && (
                <GradesTab
                  uid={schoolId}
                  school={school}
                  stageId={activeStageId}
                  stageName={activeStageName}
                  stageToken={activeStageToken}
                  classrooms={stageClassrooms}
                  students={stageStudents}
                  attendanceLogs={stageAttendanceLogs}
                  gradeEntries={stageGradeEntries}
                  onPreviewPass={onPreviewPass}
                  onPreviewStagePortal={onPreviewStagePortal}
                  onNotify={onNotify}
                />
              )}

              {activeTab === 'students' && (
                <StudentsQrTab
                  uid={schoolId}
                  school={school}
                  stageId={activeStageId}
                  stageName={activeStageName}
                  classrooms={stageClassrooms}
                  allClassrooms={classrooms}
                  students={stageStudents}
                  canDeleteRecords={canManageDestructiveRecords(
                    isSchoolOwner,
                    currentStaffMember?.role
                  )}
                  onPreviewPass={onPreviewPass}
                  onNotify={onNotify}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsTab
                  uid={schoolId}
                  currentUserUid={user.uid}
                  isSchoolOwner={isSchoolOwner}
                  staffMembers={staffMembers}
                  school={school}
                  classrooms={classrooms}
                  students={students}
                  seeding={seeding}
                  onSeedDemo={handleSeedDemo}
                  onNotify={onNotify}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Flagship Glass Mobile Bottom Navigation Dock */}
      <nav
        aria-label="التنقل السفلي"
        className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/92 backdrop-blur-lg border-t border-slate-200/80 shadow-[0_-4px_20px_rgba(15,23,42,0.05)] pb-safe"
      >
        <div className="grid grid-cols-5 h-[62px] max-w-lg mx-auto px-1">
          {MOBILE_BAR_TABS.map((tabId) => {
            const item = NAV_ITEMS.find((n) => n.id === tabId)!;
            const Icon = item.icon;
            const active = activeTab === tabId;
            return (
              <motion.button
                key={tabId}
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => handleSelectTab(tabId)}
                className={`relative flex flex-col items-center justify-center gap-1 min-h-[48px] transition-colors ${
                  active ? 'text-emerald-800 font-bold' : 'text-slate-500 font-medium'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-tab-bar-top"
                    transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                    className="absolute top-0 inset-x-3 h-[2.5px] rounded-b-full bg-emerald-700"
                  />
                )}
                <span className="relative flex items-center justify-center w-11 h-7 rounded-xl">
                  {active && (
                    <motion.span
                      layoutId="mobile-tab-pill"
                      transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                      className="absolute inset-0 rounded-xl bg-emerald-50 border border-emerald-200/60"
                    />
                  )}
                  <Icon
                    className={`relative z-10 w-[19px] h-[19px] transition-transform duration-200 ${
                      active ? 'text-emerald-700 -translate-y-[0.5px]' : 'text-slate-500'
                    }`}
                  />
                </span>
                <span className="text-[10.5px] leading-none whitespace-nowrap truncate max-w-full px-0.5">
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
