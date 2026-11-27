import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildPassUrl,
  createClassroom,
  createStudentWithPass,
  deleteClassroom,
  deleteStudentWithPass,
  markAcknowledgementReviewed,
  updateStudentAndPass,
} from '../lib/wisaalService';
import { Classroom, ParentAcknowledgement, School, StageId, Student } from '../types/wisaal';
import { BulkStudentsImportModal } from './BulkStudentsImportModal';

interface StudentsQrTabProps {
  uid: string;
  school: School;
  stageId: StageId;
  stageName: string;
  classrooms: Classroom[];
  students: Student[];
  onPreviewPass: (passToken: string) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

export function StudentsQrTab({
  uid,
  school,
  stageId,
  stageName,
  classrooms,
  students,
  onPreviewPass,
  onNotify,
}: StudentsQrTabProps) {
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [showClassModal, setShowClassModal] = useState<boolean>(false);
  const [classNameInput, setClassNameInput] = useState<string>('');
  const [teacherInput, setTeacherInput] = useState<string>('');
  const [savingClass, setSavingClass] = useState<boolean>(false);

  useEffect(() => {
    setFilterClassId('all');
    setPrintSheetMode(false);
  }, [stageId]);

  const [showStudentModal, setShowStudentModal] = useState<boolean>(false);
  const [showBulkModal, setShowBulkModal] = useState<boolean>(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [stuClassId, setStuClassId] = useState<string>('');
  const [stuFullName, setStuFullName] = useState<string>('');
  const [stuCode, setStuCode] = useState<string>('');
  const [stuParentName, setStuParentName] = useState<string>('');
  const [stuParentPhone, setStuParentPhone] = useState<string>('');
  const [savingStudent, setSavingStudent] = useState<boolean>(false);

  const [qrStudent, setQrStudent] = useState<Student | null>(null);
  const [studentAcks, setStudentAcks] = useState<ParentAcknowledgement[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState<string | null>(null);
  const [confirmDeleteClassId, setConfirmDeleteClassId] = useState<string | null>(null);
  const [printSheetMode, setPrintSheetMode] = useState<boolean>(false);

  useEffect(() => {
    if (!qrStudent) {
      setStudentAcks([]);
      return;
    }

    const acksCol = collection(db, 'passes', qrStudent.passToken, 'acknowledgements');
    const q = query(acksCol, where('schoolOwnerId', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setStudentAcks(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ParentAcknowledgement, 'id'>),
          }))
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `passes/${qrStudent.passToken}/acknowledgements`);
      }
    );

    return () => unsub();
  }, [qrStudent, uid]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students
      .filter((s) => filterClassId === 'all' || s.classId === filterClassId)
      .filter(
        (s) =>
          !q ||
          s.fullName.toLowerCase().includes(q) ||
          s.studentCode.toLowerCase().includes(q) ||
          s.parentName.toLowerCase().includes(q) ||
          s.parentPhone.includes(q)
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  }, [students, filterClassId, searchQuery]);

  const openAddStudent = () => {
    setEditingStudent(null);
    setStuClassId(filterClassId !== 'all' ? filterClassId : classrooms[0]?.id || '');
    setStuFullName('');
    setStuCode(`ST-${Math.floor(100 + Math.random() * 899)}`);
    setStuParentName('');
    setStuParentPhone('');
    setShowStudentModal(true);
  };

  const openEditStudent = (student: Student) => {
    setEditingStudent(student);
    setStuClassId(student.classId);
    setStuFullName(student.fullName);
    setStuCode(student.studentCode);
    setStuParentName(student.parentName);
    setStuParentPhone(student.parentPhone);
    setShowStudentModal(true);
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classNameInput.trim()) return;
    setSavingClass(true);
    try {
      const newId = await createClassroom(uid, school, {
        name: classNameInput,
        stageId,
        homeroomTeacher: teacherInput,
      });
      setClassNameInput('');
      setTeacherInput('');
      setShowClassModal(false);
      setFilterClassId(newId);
      onNotify('success', 'تم إضافة الشعبة.');
    } catch {
      onNotify('error', 'تعذر الإضافة.');
    } finally {
      setSavingClass(false);
    }
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClass = classrooms.find((c) => c.id === stuClassId);
    if (!targetClass || !stuFullName.trim()) return;

    setSavingStudent(true);
    try {
      if (editingStudent) {
        await updateStudentAndPass(uid, school, editingStudent, targetClass, {
          fullName: stuFullName,
          studentCode: stuCode,
          parentName: stuParentName,
          parentPhone: stuParentPhone,
        });
        onNotify('success', 'تم التحديث.');
      } else {
        await createStudentWithPass(uid, school, targetClass, {
          fullName: stuFullName,
          studentCode: stuCode,
          parentName: stuParentName,
          parentPhone: stuParentPhone,
        });
        onNotify('success', 'تم إضافة الطالب.');
      }
      setShowStudentModal(false);
    } catch {
      onNotify('error', 'تعذر الحفظ.');
    } finally {
      setSavingStudent(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    try {
      await deleteStudentWithPass(uid, student);
      setConfirmDeleteStudentId(null);
      onNotify('success', 'تم الحذف.');
    } catch {
      onNotify('error', 'تعذر الحذف.');
    }
  };

  const handleDeleteClass = async (classId: string) => {
    if (students.some((s) => s.classId === classId)) {
      onNotify('error', 'الشعبة تحتوي على طلاب.');
      setConfirmDeleteClassId(null);
      return;
    }
    try {
      await deleteClassroom(uid, classId);
      setConfirmDeleteClassId(null);
      if (filterClassId === classId) setFilterClassId('all');
      onNotify('success', 'تم حذف الشعبة.');
    } catch {
      onNotify('error', 'تعذر الحذف.');
    }
  };

  const handleCopyPassUrl = async (passToken: string) => {
    try {
      await navigator.clipboard.writeText(buildPassUrl(passToken));
      setCopiedToken(passToken);
      onNotify('success', 'تم النسخ.');
      setTimeout(() => setCopiedToken((prev) => (prev === passToken ? null : prev)), 2000);
    } catch {
      onNotify('error', 'تعذر النسخ.');
    }
  };

  const handleReviewAck = async (passToken: string, ackId: string) => {
    try {
      await markAcknowledgementReviewed(passToken, ackId);
      onNotify('success', 'تمت المراجعة.');
    } catch {
      onNotify('error', 'تعذر التحديث.');
    }
  };

  if (printSheetMode) {
    return (
      <div className="space-y-5">
        <div className="no-print bg-white border border-slate-200/80 rounded-xl p-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-bold text-slate-900">
            بطاقات QR ({filteredStudents.length})
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPrintSheetMode(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
            >
              رجوع
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map((student) => (
            <div
              key={student.id}
              className="print-break-inside-avoid bg-white border border-dashed border-slate-300 rounded-xl p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-emerald-800 truncate">{school.name}</p>
                <p className="font-display text-sm font-bold text-slate-900 mt-0.5 truncate">
                  {student.fullName}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {student.className} ·{' '}
                  <span className="font-mono tabular-nums">{student.studentCode}</span>
                </p>
              </div>
              <div className="p-1.5 border border-slate-200 rounded-lg bg-white shrink-0">
                <QRCodeSVG value={buildPassUrl(student.passToken)} size={76} level="M" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Sections Bar */}
      <section className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold text-slate-900">شعب {stageName}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowClassModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>شعبة</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBulkModal(true)}
              disabled={classrooms.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 disabled:opacity-50 rounded-lg whitespace-nowrap"
            >
              <Users className="w-3.5 h-3.5" />
              <span>إضافة جماعية</span>
            </button>

            <button
              type="button"
              onClick={openAddStudent}
              disabled={classrooms.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>طالب</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterClassId('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              filterClassId === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            الكل ({students.length})
          </button>

          {classrooms.map((cls) => {
            const count = students.filter((s) => s.classId === cls.id).length;
            const active = filterClassId === cls.id;
            return (
              <div key={cls.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFilterClassId(cls.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {cls.name} ({count})
                </button>
                {confirmDeleteClassId === cls.id ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteClass(cls.id)}
                    className="px-2 py-1 text-[11px] font-semibold text-white bg-rose-600 rounded-md"
                  >
                    حذف
                  </button>
                ) : (
                  count === 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteClassId(cls.id)}
                      aria-label="حذف الشعبة"
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Students Table */}
      <section className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث..."
              className="w-full pr-9 pl-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            />
          </div>

          <button
            type="button"
            onClick={() => setPrintSheetMode(true)}
            disabled={filteredStudents.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>طباعة البطاقات</span>
          </button>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">لا يوجد طلاب</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5">الطالب</th>
                  <th className="py-3 px-4">الشعبة</th>
                  <th className="py-3 px-4">ولي الأمر</th>
                  <th className="py-3 px-5 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-5">
                      <p className="font-semibold text-slate-900">{student.fullName}</p>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        {student.studentCode}
                      </p>
                    </td>

                    <td className="py-3 px-4 text-xs text-slate-600">{student.className}</td>

                    <td className="py-3 px-4">
                      <p className="text-xs font-medium text-slate-800">
                        {student.parentName || '—'}
                      </p>
                      {student.parentPhone && (
                        <p className="text-xs text-slate-400 font-mono tabular-nums" dir="ltr">
                          {student.parentPhone}
                        </p>
                      )}
                    </td>

                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setQrStudent(student)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg whitespace-nowrap"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>QR</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onPreviewPass(student.passToken)}
                          aria-label="معاينة"
                          className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditStudent(student)}
                          aria-label="تعديل"
                          className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        {confirmDeleteStudentId === student.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteStudent(student)}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-rose-600 rounded-md"
                            >
                              حذف
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteStudentId(null)}
                              className="px-2 py-1 text-xs text-slate-500"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteStudentId(student.id)}
                            aria-label="حذف"
                            className="p-2 text-slate-400 hover:text-rose-700 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal: Add Section */}
      {showClassModal && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-sm w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                شعبة جديدة · {stageName}
              </h3>
              <button
                type="button"
                onClick={() => setShowClassModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="space-y-3.5">
              <input
                type="text"
                required
                maxLength={80}
                value={classNameInput}
                onChange={(e) => setClassNameInput(e.target.value)}
                placeholder="اسم الشعبة (مثال: شعبة أ)"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />

              <input
                type="text"
                maxLength={80}
                value={teacherInput}
                onChange={(e) => setTeacherInput(e.target.value)}
                placeholder="مرشد الشعبة (اختياري)"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowClassModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingClass}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  {savingClass ? 'جاري...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Student */}
      {showStudentModal && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingStudent ? 'تعديل طالب' : 'طالب جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setShowStudentModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="space-y-3">
              <select
                required
                value={stuClassId}
                onChange={(e) => setStuClassId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <input
                type="text"
                required
                maxLength={100}
                value={stuFullName}
                onChange={(e) => setStuFullName(e.target.value)}
                placeholder="اسم الطالب الكامل"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  maxLength={32}
                  value={stuCode}
                  onChange={(e) => setStuCode(e.target.value)}
                  placeholder="الرمز"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                />
                <input
                  type="text"
                  maxLength={100}
                  value={stuParentName}
                  onChange={(e) => setStuParentName(e.target.value)}
                  placeholder="ولي الأمر"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>

              <input
                type="tel"
                dir="ltr"
                maxLength={24}
                value={stuParentPhone}
                onChange={(e) => setStuParentPhone(e.target.value)}
                placeholder="رقم الجوال (اختياري)"
                className="w-full px-3 py-2 text-sm font-mono text-left border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingStudent}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  {savingStudent ? 'جاري...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Student QR & Replies */}
      {qrStudent && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  {qrStudent.fullName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {qrStudent.className} · {qrStudent.studentCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrStudent(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col items-center p-5 bg-[#F7F8F7] border border-slate-200/80 rounded-xl">
              <div className="p-3 bg-white border border-slate-200 rounded-xl mb-4">
                <QRCodeSVG value={buildPassUrl(qrStudent.passToken)} size={152} level="M" />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyPassUrl(qrStudent.passToken)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  {copiedToken === qrStudent.passToken ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedToken === qrStudent.passToken ? 'نُسخ' : 'نسخ الرابط'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const token = qrStudent.passToken;
                    setQrStudent(null);
                    onPreviewPass(token);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>فتح</span>
                </button>
              </div>
            </div>

            <div>
              <h4 className="font-display text-sm font-bold text-slate-900 mb-2.5">
                ردود ولي الأمر ({studentAcks.length})
              </h4>
              {studentAcks.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">لا توجد ردود</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {studentAcks.map((ack) => (
                    <div
                      key={ack.id}
                      className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">
                          {ack.type === 'excuse' ? 'عذر غياب' : 'تأكيد اطلاع'} · {ack.senderLabel}
                        </p>
                        <p className="text-slate-600 mt-0.5">{ack.message}</p>
                      </div>

                      {ack.schoolStatus === 'reviewed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleReviewAck(qrStudent.passToken, ack.id)}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 rounded-md whitespace-nowrap shrink-0"
                        >
                          اعتماد
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bulk Student Import (Paste or Image) */}
      {showBulkModal && (
        <BulkStudentsImportModal
          uid={uid}
          school={school}
          classrooms={classrooms}
          existingStudents={students}
          initialClassId={filterClassId !== 'all' ? filterClassId : classrooms[0]?.id || ''}
          onClose={() => setShowBulkModal(false)}
          onImported={(classId, count) => {
            setShowBulkModal(false);
            setFilterClassId(classId);
            onNotify('success', `تم إضافة ${count} طالباً بنجاح.`);
          }}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
