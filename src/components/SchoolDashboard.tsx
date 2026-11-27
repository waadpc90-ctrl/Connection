import { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  Award,
  ClipboardCheck,
  Copy,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  QrCode,
  Settings,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildParentsPortalUrl,
  ensureSchoolDocument,
  seedDemoSchoolData,
  syncStagePortalsMetadata,
} from '../lib/wisaalService';
import {
  AttendanceLog,
  Classroom,
  getSchoolStageNames,
  GradeEntry,
  resolveClassroomStageId,
  resolveRecordStageId,
  School,
  SchoolTab,
  STAGE_IDS,
  StageId,
  Student,
} from '../types/wisaal';
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
  onOpenParentsPortal: (schoolId: string) => void;
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
  const uid = user.uid;
  const [activeTab, setActiveTab] = useState<SchoolTab>('overview');
  const [activeStageId, setActiveStageId] = useState<StageId>('stage_1');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const [school, setSchool] = useState<School | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [gradeEntries, setGradeEntries] = useState<GradeEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [seeding, setSeeding] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const unsubs: (() => void)[] = [];

    const setup = async () => {
      try {
        await ensureSchoolDocument(uid);
      } catch (err) {
        console.error('School init failed:', err);
        if (active) setLoading(false);
        return;
      }

      if (!active) return;

      const schoolRef = doc(db, 'schools', uid);
      unsubs.push(
        onSnapshot(
          schoolRef,
          (snap) => {
            if (snap.exists()) {
              setSchool({ id: snap.id, ...(snap.data() as Omit<School, 'id'>) });
            }
            setLoading(false);
          },
          (err) => handleFirestoreError(err, OperationType.GET, `schools/${uid}`)
        )
      );

      const classesQ = query(
        collection(db, 'schools', uid, 'classrooms'),
        where('ownerId', '==', uid)
      );
      unsubs.push(
        onSnapshot(
          classesQ,
          (snap) => {
            setClassrooms(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Classroom, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${uid}/classrooms`)
        )
      );

      const studentsQ = query(
        collection(db, 'schools', uid, 'students'),
        where('ownerId', '==', uid)
      );
      unsubs.push(
        onSnapshot(
          studentsQ,
          (snap) => {
            setStudents(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${uid}/students`)
        )
      );

      const logsQ = query(
        collection(db, 'schools', uid, 'attendanceLogs'),
        where('ownerId', '==', uid)
      );
      unsubs.push(
        onSnapshot(
          logsQ,
          (snap) => {
            setAttendanceLogs(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceLog, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${uid}/attendanceLogs`)
        )
      );

      const gradesQ = query(
        collection(db, 'schools', uid, 'gradeEntries'),
        where('ownerId', '==', uid)
      );
      unsubs.push(
        onSnapshot(
          gradesQ,
          (snap) => {
            setGradeEntries(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GradeEntry, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `schools/${uid}/gradeEntries`)
        )
      );
    };

    void setup();

    return () => {
      active = false;
      unsubs.forEach((u) => u());
    };
  }, [uid]);

  const lastPortalSyncSigRef = useRef<string>('');

  const handleSeedDemo = async () => {
    if (!school) return;
    setSeeding(true);
    try {
      await seedDemoSchoolData(uid, school);
      onNotify('success', 'تم إضافة البيانات النموذجية للمراحل الثلاث.');
    } catch {
      onNotify('error', 'تعذر تحميل البيانات النموذجية.');
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    if (!school?.stageTokens) return;
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
      syncStagePortalsMetadata(uid, school, classrooms, students).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [uid, school, classrooms, students]);

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

  const handleSelectTab = (tab: SchoolTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#F7F8F7] text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col w-[240px] shrink-0 bg-white border-l border-slate-200/80 sticky top-0 h-screen">
        <div className="h-16 px-5 border-b border-slate-200/80 flex items-center justify-between">
          <span className="font-display text-xl font-bold text-slate-900 whitespace-nowrap">
            وصال
          </span>
        </div>

        <div className="px-5 py-3.5 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {school?.name || '...'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{school?.academicYear || ''}</p>
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
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 text-emerald-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-700' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200/80 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onOpenParentsPortal(uid)}
              className="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span>الأولياء</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(buildParentsPortalUrl(uid))
                  .then(() => onNotify('success', 'تم نسخ رابط بوابة الأولياء.'))
                  .catch(() => onNotify('error', 'تعذر النسخ.'));
              }}
              className="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5 shrink-0" />
              <span>الرابط</span>
            </button>
          </div>
          <p className="text-xs font-medium text-slate-500 truncate pt-1" dir="ltr">
            {user.email}
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>خروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden flex">
          <div className="w-64 bg-white h-full border-l border-slate-200 flex flex-col">
            <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-slate-900">وصال</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-lg transition-colors ${
                      active
                        ? 'bg-emerald-50 text-emerald-900 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 font-medium'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenParentsPortal(uid);
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>واجهة أولياء الأمور</span>
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            </div>
          </div>
          <div className="flex-1 bg-slate-900/35" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col pb-16 lg:pb-0">
        <header className="no-print sticky top-0 z-20 h-14 sm:h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="القائمة"
              className="lg:hidden p-2 -mr-1 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              {activeNavMeta.label}
            </h1>
          </div>

          {!loading && school && activeTab !== 'settings' && (
            <div className="hidden md:inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
              {STAGE_IDS.map((sid) => {
                const isActive = activeStageId === sid;
                const stat = stageStats[sid];
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => setActiveStageId(sid)}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 font-medium'
                    }`}
                  >
                    <span>{stageNames[sid]}</span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400 mr-1.5">
                      {stat.students}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Mobile Stage Switcher */}
        {!loading && school && activeTab !== 'settings' && (
          <div className="no-print md:hidden bg-white border-b border-slate-200/80 px-4 py-2.5">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
              {STAGE_IDS.map((sid) => {
                const isActive = activeStageId === sid;
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => setActiveStageId(sid)}
                    className={`px-2 py-1.5 text-xs rounded-md transition-colors truncate ${
                      isActive
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 font-medium'
                    }`}
                  >
                    {stageNames[sid]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-8 max-w-5xl w-full mx-auto">
          {loading || !school ? (
            <div className="space-y-4">
              <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
              <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
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
                  onNavigate={setActiveTab}
                  onPreviewPass={onPreviewPass}
                  onPreviewStagePortal={onPreviewStagePortal}
                />
              )}

              {activeTab === 'stage-broadcasts' && (
                <StageBroadcastsTab
                  uid={uid}
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
                  uid={uid}
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
                  uid={uid}
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
                  uid={uid}
                  school={school}
                  stageId={activeStageId}
                  stageName={activeStageName}
                  classrooms={stageClassrooms}
                  students={stageStudents}
                  onPreviewPass={onPreviewPass}
                  onNotify={onNotify}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsTab
                  uid={uid}
                  school={school}
                  classrooms={classrooms}
                  students={students}
                  seeding={seeding}
                  onSeedDemo={handleSeedDemo}
                  onNotify={onNotify}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Compact Mobile Bottom Navigation */}
      <nav className="no-print lg:hidden fixed bottom-0 inset-x-0 z-20 h-14 bg-white border-t border-slate-200 grid grid-cols-5">
        {MOBILE_BAR_TABS.map((tabId) => {
          const item = NAV_ITEMS.find((n) => n.id === tabId)!;
          const Icon = item.icon;
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => handleSelectTab(tabId)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                active ? 'text-emerald-700 font-semibold' : 'text-slate-500 font-medium'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
