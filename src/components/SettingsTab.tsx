import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, KeyRound, Plus, Save, Sparkles, Trash2, UserPlus, Users } from 'lucide-react';
import {
  isValidAdminPinFormat,
  isValidStaffEmail,
  normalizePinInput,
  verifyAdminPin,
} from '../lib/adminSecurity';
import {
  addSchoolStaffMember,
  promoteStageStudents,
  removeSchoolStaffMember,
  setSchoolAdminPin,
  updateAllStageSubjects,
  updateSchoolSettings,
} from '../lib/wisaalService';
import {
  Classroom,
  FIELD_LIMITS,
  getSchoolStageNames,
  getSchoolStageSubjectsMap,
  resolveClassroomStageId,
  School,
  STAFF_ROLE_LABELS,
  StaffMember,
  StaffRole,
  STAGE_IDS,
  StageId,
  StageNamesMap,
  StageSubjectsMap,
  Student,
} from '../types/wisaal';

interface SettingsTabProps {
  uid: string;
  currentUserUid: string;
  isSchoolOwner: boolean;
  staffMembers: StaffMember[];
  school: School;
  classrooms: Classroom[];
  students: Student[];
  seeding: boolean;
  onSeedDemo: () => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

const STAGE_LABELS: Record<keyof StageNamesMap, string> = {
  stage_1: 'المرحلة الأولى',
  stage_2: 'المرحلة الثانية',
  stage_3: 'المرحلة الثالثة',
};

const STAFF_ROLES: StaffRole[] = ['vice_principal', 'teacher', 'supervisor', 'admin_staff'];

export function SettingsTab({
  uid,
  currentUserUid,
  isSchoolOwner,
  staffMembers,
  school,
  classrooms,
  students,
  seeding,
  onSeedDemo,
  onNotify,
}: SettingsTabProps) {
  const [name, setName] = useState<string>(school.name);
  const [whatsappNumber, setWhatsappNumber] = useState<string>(school.whatsappNumber);
  const [academicYear, setAcademicYear] = useState<string>(school.academicYear);
  const [threshold, setThreshold] = useState<number>(school.absenceAlertThreshold);
  const [stageNames, setStageNames] = useState<StageNamesMap>(() => getSchoolStageNames(school));
  const [stageSubjects, setStageSubjects] = useState<StageSubjectsMap>(() =>
    getSchoolStageSubjectsMap(school)
  );
  const [activeSubjectsStage, setActiveSubjectsStage] = useState<StageId>('stage_1');
  const [newSubject, setNewSubject] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // Admin PIN update state (Owner only)
  const [currentPin, setCurrentPin] = useState<string>('');
  const [nextPin, setNextPin] = useState<string>('');
  const [confirmNextPin, setConfirmNextPin] = useState<string>('');
  const [savingPin, setSavingPin] = useState<boolean>(false);

  // Staff member management state (Owner only)
  const [staffName, setStaffName] = useState<string>('');
  const [staffEmail, setStaffEmail] = useState<string>('');
  const [staffRole, setStaffRole] = useState<StaffRole>('teacher');
  const [addingStaff, setAddingStaff] = useState<boolean>(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  // End-of-year stage promotion state (Owner only)
  const [promoteFromStage, setPromoteFromStage] = useState<StageId>('stage_1');
  const [promoteTargetClassId, setPromoteTargetClassId] = useState<string>('');
  const [confirmPromote, setConfirmPromote] = useState<boolean>(false);
  const [promoting, setPromoting] = useState<boolean>(false);

  const promoteToStage: StageId = promoteFromStage === 'stage_1' ? 'stage_2' : 'stage_3';
  const targetStageClassrooms = useMemo(
    () => classrooms.filter((c) => resolveClassroomStageId(c) === promoteToStage),
    [classrooms, promoteToStage]
  );
  const sourceStageStudentCount = useMemo(
    () => students.filter((s) => s.stageId === promoteFromStage).length,
    [students, promoteFromStage]
  );

  useEffect(() => {
    if (!targetStageClassrooms.some((c) => c.id === promoteTargetClassId)) {
      setPromoteTargetClassId(targetStageClassrooms[0]?.id || '');
    }
    setConfirmPromote(false);
  }, [promoteFromStage, targetStageClassrooms, promoteTargetClassId]);

  useEffect(() => {
    setName(school.name);
    setWhatsappNumber(school.whatsappNumber);
    setAcademicYear(school.academicYear);
    setThreshold(school.absenceAlertThreshold);
    setStageNames(getSchoolStageNames(school));
    setStageSubjects(getSchoolStageSubjectsMap(school));
  }, [school]);

  const activeStageSubjects = stageSubjects[activeSubjectsStage] || [];

  const handleAddSubject = () => {
    const trimmed = newSubject.trim().slice(0, FIELD_LIMITS.subject);
    if (!trimmed) return;
    if (activeStageSubjects.length >= FIELD_LIMITS.maxSchoolSubjects) {
      onNotify('error', `الحد الأقصى ${FIELD_LIMITS.maxSchoolSubjects} مادة لكل مرحلة.`);
      return;
    }
    if (activeStageSubjects.some((s) => s.trim() === trimmed)) {
      setNewSubject('');
      return;
    }
    setStageSubjects((prev) => ({
      ...prev,
      [activeSubjectsStage]: [...prev[activeSubjectsStage], trimmed],
    }));
    setNewSubject('');
  };

  const handleSwitchSubjectsStage = (nextStage: StageId) => {
    if (nextStage === activeSubjectsStage) return;
    const pending = newSubject.trim().slice(0, FIELD_LIMITS.subject);
    if (
      pending &&
      activeStageSubjects.length < FIELD_LIMITS.maxSchoolSubjects &&
      !activeStageSubjects.some((s) => s.trim() === pending)
    ) {
      setStageSubjects((prev) => ({
        ...prev,
        [activeSubjectsStage]: [...prev[activeSubjectsStage], pending],
      }));
    }
    setNewSubject('');
    setActiveSubjectsStage(nextStage);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pending = newSubject.trim().slice(0, FIELD_LIMITS.subject);
    const mergedMap: StageSubjectsMap = {
      stage_1: [...stageSubjects.stage_1],
      stage_2: [...stageSubjects.stage_2],
      stage_3: [...stageSubjects.stage_3],
    };
    if (pending) {
      mergedMap[activeSubjectsStage] = [...mergedMap[activeSubjectsStage], pending];
    }

    const cleanedMap: StageSubjectsMap = {
      stage_1: [],
      stage_2: [],
      stage_3: [],
    };
    for (const sid of STAGE_IDS) {
      const cleaned = mergedMap[sid]
        .map((s) => s.trim().slice(0, FIELD_LIMITS.subject))
        .filter(Boolean);
      if (cleaned.length === 0) {
        setActiveSubjectsStage(sid);
        onNotify('error', `أضف مادة واحدة على الأقل في ${stageNames[sid]}.`);
        return;
      }
      cleanedMap[sid] = cleaned;
    }

    setSaving(true);
    try {
      if (isSchoolOwner) {
        if (!name.trim()) return;
        await updateSchoolSettings(uid, students, classrooms, {
          name,
          whatsappNumber,
          academicYear,
          absenceAlertThreshold: threshold,
          stageNames,
          stageSubjects: cleanedMap,
        });
      } else {
        await updateAllStageSubjects(uid, cleanedMap);
      }
      setNewSubject('');
      onNotify('success', 'تم حفظ الإعدادات ومواد المراحل.');
    } catch {
      onNotify('error', 'تعذر الحفظ.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSchoolOwner) return;

    const cleanNew = normalizePinInput(nextPin);
    const cleanConfirm = normalizePinInput(confirmNextPin);

    if (!isValidAdminPinFormat(cleanNew)) {
      onNotify('error', 'الرمز الجديد يجب أن يكون بين 4 و 16 خانة.');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      onNotify('error', 'الرمزان غير متطابقين.');
      return;
    }

    setSavingPin(true);
    try {
      if (school.adminPinHash && school.adminPinSalt) {
        const ok = await verifyAdminPin(
          normalizePinInput(currentPin),
          school.adminPinHash,
          school.adminPinSalt
        );
        if (!ok) {
          onNotify('error', 'الرمز الحالي غير صحيح.');
          return;
        }
      }
      await setSchoolAdminPin(uid, cleanNew);
      setCurrentPin('');
      setNextPin('');
      setConfirmNextPin('');
      onNotify('success', 'تم تحديث رمز قفل لوحة الإدارة.');
    } catch {
      onNotify('error', 'تعذر تحديث الرمز.');
    } finally {
      setSavingPin(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSchoolOwner) return;
    if (!staffName.trim()) {
      onNotify('error', 'أدخل اسم عضو الإدارة.');
      return;
    }
    if (!isValidStaffEmail(staffEmail)) {
      onNotify('error', 'أدخل بريد Google صحيحاً.');
      return;
    }

    setAddingStaff(true);
    try {
      await addSchoolStaffMember(uid, currentUserUid, {
        displayName: staffName,
        email: staffEmail,
        role: staffRole,
      });
      setStaffName('');
      setStaffEmail('');
      setStaffRole('teacher');
      onNotify('success', 'تم إضافة عضو الإدارة بنجاح.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر إضافة العضو.');
    } finally {
      setAddingStaff(false);
    }
  };

  const handleRemoveStaff = async (email: string) => {
    setRemovingEmail(email);
    try {
      await removeSchoolStaffMember(email);
      onNotify('success', 'تم إزالة عضو الإدارة.');
    } catch {
      onNotify('error', 'تعذر إزالة العضو.');
    } finally {
      setRemovingEmail(null);
    }
  };

  const handlePromoteStage = async () => {
    if (!isSchoolOwner) return;
    const targetCls = targetStageClassrooms.find((c) => c.id === promoteTargetClassId);
    if (!targetCls) {
      onNotify('error', 'أضف شعبة في المرحلة التالية أولاً.');
      return;
    }
    if (sourceStageStudentCount === 0) {
      onNotify('error', 'لا يوجد طلاب في المرحلة المختارة.');
      return;
    }

    setPromoting(true);
    try {
      const { promotedCount } = await promoteStageStudents(
        uid,
        school,
        promoteFromStage,
        promoteToStage,
        targetCls,
        classrooms,
        students
      );
      setConfirmPromote(false);
      onNotify(
        'success',
        `تم ترفيع ${promotedCount} طالب إلى ${stageNames[promoteToStage]} (${targetCls.name}).`
      );
    } catch {
      onNotify('error', 'تعذر ترفيع الطلاب.');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {/* School Info & Subjects */}
      <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6">
        <h2 className="font-display text-base font-bold text-slate-900 mb-5">
          {isSchoolOwner ? 'بيانات المدرسة' : 'المواد الدراسية'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSchoolOwner && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    اسم المدرسة
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    العام الدراسي
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={academicYear}
                    onChange={(e) => setAcademicYear(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    هاتف الإدارة
                  </label>
                  <input
                    type="tel"
                    dir="ltr"
                    maxLength={24}
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    حد تنبيه الغياب (أيام)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={threshold}
                    onChange={(e) =>
                      setThreshold(Math.max(1, Math.min(30, Number(e.target.value) || 3)))
                    }
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-700 mb-3">أسماء المراحل</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {STAGE_IDS.map((sid) => (
                    <div key={sid}>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        {STAGE_LABELS[sid]}
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={60}
                        value={stageNames[sid]}
                        onChange={(e) =>
                          setStageNames((prev) => ({
                            ...prev,
                            [sid]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className={isSchoolOwner ? 'pt-3 border-t border-slate-100 space-y-3' : 'space-y-3'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">
                المواد الدراسية لكل مرحلة
              </p>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {activeStageSubjects.length} / {FIELD_LIMITS.maxSchoolSubjects}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100/90 rounded-lg">
              {STAGE_IDS.map((sid) => {
                const isSelected = activeSubjectsStage === sid;
                const count = stageSubjects[sid]?.length || 0;
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => handleSwitchSubjectsStage(sid)}
                    className={`px-2.5 py-2 text-xs rounded-md transition-colors truncate ${
                      isSelected
                        ? 'bg-white text-emerald-900 font-bold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 font-medium'
                    }`}
                  >
                    <span className="truncate">{stageNames[sid]}</span>{' '}
                    <span className="font-mono tabular-nums opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activeStageSubjects.map((sub, idx) => (
                <div key={`${activeSubjectsStage}_${idx}`} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.subject}
                    value={sub}
                    onChange={(e) =>
                      setStageSubjects((prev) => ({
                        ...prev,
                        [activeSubjectsStage]: prev[activeSubjectsStage].map((item, i) =>
                          i === idx ? e.target.value : item
                        ),
                      }))
                    }
                    placeholder="اسم المادة"
                    className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                  <button
                    type="button"
                    disabled={activeStageSubjects.length <= 1}
                    onClick={() =>
                      setStageSubjects((prev) => ({
                        ...prev,
                        [activeSubjectsStage]: prev[activeSubjectsStage].filter(
                          (_, i) => i !== idx
                        ),
                      }))
                    }
                    aria-label="حذف المادة"
                    className="p-1.5 text-slate-400 hover:text-rose-700 disabled:opacity-30 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSubject}
                maxLength={FIELD_LIMITS.subject}
                onChange={(e) => setNewSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSubject();
                  }
                }}
                placeholder={`إضافة مادة جديدة لـ ${stageNames[activeSubjectsStage]}...`}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />
              <button
                type="button"
                onClick={handleAddSubject}
                disabled={
                  !newSubject.trim() ||
                  activeStageSubjects.length >= FIELD_LIMITS.maxSchoolSubjects
                }
                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة</span>
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'جاري الحفظ...' : 'حفظ'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Owner-Only: Admin Members Management */}
      {isSchoolOwner && (
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-700" />
              <h2 className="font-display text-base font-bold text-slate-900">أعضاء الإدارة</h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {staffMembers.length}
            </span>
          </div>

          <form onSubmit={handleAddStaff} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <input
              type="text"
              required
              maxLength={80}
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="الاسم"
              className="sm:col-span-4 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            />
            <input
              type="email"
              required
              dir="ltr"
              maxLength={120}
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              placeholder="email@gmail.com"
              className="sm:col-span-5 px-3 py-2 text-sm font-mono text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            />
            <select
              value={staffRole}
              onChange={(e) => setStaffRole(e.target.value as StaffRole)}
              aria-label="الصفة"
              className="sm:col-span-3 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {STAFF_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <div className="sm:col-span-12">
              <button
                type="submit"
                disabled={addingStaff}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{addingStaff ? 'جاري الإضافة...' : 'إضافة عضو'}</span>
              </button>
            </div>
          </form>

          {staffMembers.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {staffMembers.map((member) => (
                <div
                  key={member.email}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {member.displayName}{' '}
                      <span className="text-xs font-normal text-emerald-800">
                        · {STAFF_ROLE_LABELS[member.role]}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500 font-mono truncate" dir="ltr">
                      {member.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={removingEmail === member.email}
                    onClick={() => void handleRemoveStaff(member.email)}
                    aria-label="حذف العضو"
                    className="p-1.5 text-slate-400 hover:text-rose-700 disabled:opacity-40 rounded-lg shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Owner-Only: Change Admin Lock PIN */}
      {isSchoolOwner && (
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-700" />
            <h2 className="font-display text-base font-bold text-slate-900">
              رمز قفل لوحة الإدارة
            </h2>
          </div>

          <form onSubmit={handleUpdatePin} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {school.adminPinHash && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    الرمز الحالي
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    required
                    autoComplete="off"
                    maxLength={16}
                    dir="ltr"
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value)}
                    placeholder="••••"
                    className="w-full px-3 py-2 text-sm font-mono text-center border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  الرمز الجديد
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  autoComplete="new-password"
                  maxLength={16}
                  dir="ltr"
                  value={nextPin}
                  onChange={(e) => setNextPin(e.target.value)}
                  placeholder="••••"
                  className="w-full px-3 py-2 text-sm font-mono text-center border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  تأكيد الرمز
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  autoComplete="new-password"
                  maxLength={16}
                  dir="ltr"
                  value={confirmNextPin}
                  onChange={(e) => setConfirmNextPin(e.target.value)}
                  placeholder="••••"
                  className="w-full px-3 py-2 text-sm font-mono text-center border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPin}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingPin ? 'جاري التحديث...' : 'تحديث الرمز'}</span>
            </button>
          </form>
        </section>
      )}

      {isSchoolOwner && (
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-emerald-700" />
            <h2 className="font-display text-base font-bold text-slate-900">
              ترفيع طلاب المرحلة (نهاية العام)
            </h2>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            انقل جميع طلاب مرحلة كاملة إلى المرحلة التالية مع الاحتفاظ ببطاقات QR نفسها لأولياء الأمور.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                المرحلة المراد ترفيعها
              </label>
              <select
                value={promoteFromStage}
                onChange={(e) => setPromoteFromStage(e.target.value as StageId)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                <option value="stage_1">
                  {stageNames.stage_1} ← {stageNames.stage_2}
                </option>
                <option value="stage_2">
                  {stageNames.stage_2} ← {stageNames.stage_3}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                الشعبة المستقبِلة في {stageNames[promoteToStage]}
              </label>
              <select
                value={promoteTargetClassId}
                onChange={(e) => setPromoteTargetClassId(e.target.value)}
                disabled={targetStageClassrooms.length === 0}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 disabled:bg-slate-50"
              >
                {targetStageClassrooms.length === 0 ? (
                  <option value="">لا توجد شعب في {stageNames[promoteToStage]}</option>
                ) : (
                  targetStageClassrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              عدد الطلاب: {sourceStageStudentCount}
            </span>

            {confirmPromote ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={promoting}
                  onClick={handlePromoteStage}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg"
                >
                  {promoting ? 'جاري الترفيع...' : `تأكيد ترفيع (${sourceStageStudentCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmPromote(false)}
                  className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={sourceStageStudentCount === 0 || !promoteTargetClassId}
                onClick={() => setConfirmPromote(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-lg"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>ترفيع الطلاب</span>
              </button>
            )}
          </div>
        </section>
      )}

      {isSchoolOwner && (
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 flex items-center justify-between gap-4">
          <span className="font-display text-sm font-bold text-slate-900">بيانات تجريبية</span>
          <button
            type="button"
            onClick={onSeedDemo}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-60 rounded-lg whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{seeding ? 'جاري...' : 'تحميل'}</span>
          </button>
        </section>
      )}
    </div>
  );
}
