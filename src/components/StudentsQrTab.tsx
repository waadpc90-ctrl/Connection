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
import {
  Classroom,
  ParentAcknowledgement,
  School,
  StageId,
  Student,
} from '../types/wisaal';

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

  // Classroom modal state
  const [showClassModal, setShowClassModal] = useState<boolean>(false);
  const [classNameInput, setClassNameInput] = useState<string>('');
  const [teacherInput, setTeacherInput] = useState<string>('');
  const [savingClass, setSavingClass] = useState<boolean>(false);

  useEffect(() => {
    setFilterClassId('all');
    setPrintSheetMode(false);
  }, [stageId]);

  // Student add/edit modal state
  const [showStudentModal, setShowStudentModal] = useState<boolean>(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [stuClassId, setStuClassId] = useState<string>('');
  const [stuFullName, setStuFullName] = useState<string>('');
  const [stuCode, setStuCode] = useState<string>('');
  const [stuParentName, setStuParentName] = useState<string>('');
  const [stuParentPhone, setStuParentPhone] = useState<string>('');
  const [savingStudent, setSavingStudent] = useState<boolean>(false);

  // QR & Acknowledgements Drawer/Modal
  const [qrStudent, setQrStudent] = useState<Student | null>(null);
  const [studentAcks, setStudentAcks] = useState<ParentAcknowledgement[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Delete inline confirmation
  const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState<string | null>(null);
  const [confirmDeleteClassId, setConfirmDeleteClassId] = useState<string | null>(null);

  // Printable QR Sheet mode
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
      onNotify('success', `تم إضافة الشعبة الجديدة في ${stageName} بنجاح.`);
    } catch {
      onNotify('error', 'تعذر إضافة الشعبة الدراسية.');
    } finally {
      setSavingClass(false);
    }
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClass = classrooms.find((c) => c.id === stuClassId);
    if (!targetClass || !stuFullName.trim()) {
      onNotify('error', 'يرجى تحديد الشعبة وكتابة اسم الطالب.');
      return;
    }

    setSavingStudent(true);
    try {
      if (editingStudent) {
        await updateStudentAndPass(uid, school, editingStudent, targetClass, {
          fullName: stuFullName,
          studentCode: stuCode,
          parentName: stuParentName,
          parentPhone: stuParentPhone,
        });
        onNotify('success', 'تم تحديث بيانات الطالب وبطاقته الحية.');
      } else {
        await createStudentWithPass(uid, school, targetClass, {
          fullName: stuFullName,
          studentCode: stuCode,
          parentName: stuParentName,
          parentPhone: stuParentPhone,
        });
        onNotify('success', 'تم إضافة الطالب وتوليد بطاقة QR الخاصة به فوراً.');
      }
      setShowStudentModal(false);
    } catch {
      onNotify('error', 'تعذر حفظ بيانات الطالب. تأكد من صحة رقم الجوال.');
    } finally {
      setSavingStudent(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    try {
      await deleteStudentWithPass(uid, student);
      setConfirmDeleteStudentId(null);
      onNotify('success', 'تم حذف الطالب وبطاقته الحية.');
    } catch {
      onNotify('error', 'تعذر حذف الطالب.');
    }
  };

  const handleDeleteClass = async (classId: string) => {
    const hasStudents = students.some((s) => s.classId === classId);
    if (hasStudents) {
      onNotify('error', 'انقل أو احذف طلاب هذا الفصل أولاً قبل حذفه.');
      setConfirmDeleteClassId(null);
      return;
    }
    try {
      await deleteClassroom(uid, classId);
      setConfirmDeleteClassId(null);
      if (filterClassId === classId) setFilterClassId('all');
      onNotify('success', 'تم حذف الفصل.');
    } catch {
      onNotify('error', 'تعذر حذف الفصل.');
    }
  };

  const handleCopyPassUrl = async (passToken: string) => {
    try {
      await navigator.clipboard.writeText(buildPassUrl(passToken));
      setCopiedToken(passToken);
      onNotify('success', 'تم نسخ رابط البطاقة الحية لولي الأمر.');
      setTimeout(() => setCopiedToken((prev) => (prev === passToken ? null : prev)), 2000);
    } catch {
      onNotify('error', 'تعذر نسخ الرابط.');
    }
  };

  const handleReviewAck = async (passToken: string, ackId: string) => {
    try {
      await markAcknowledgementReviewed(passToken, ackId);
      onNotify('success', 'تم اعتماد مراجعة رسالة ولي الأمر.');
    } catch {
      onNotify('error', 'تعذر تحديث حالة المراجعة.');
    }
  };

  // Dedicated Printable Class QR Sticker Sheet
  if (printSheetMode) {
    return (
      <div className="space-y-6">
        <div className="no-print bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              ورقة بطاقات QR الجاهزة للطباعة والقص
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              اطبع هذه الورقة وألصق بطاقة كل طالب في دفتره ليتمكن ولي أمره من المسح والمتابعة طوال
              العام.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPrintSheetMode(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap"
            >
              العودة للقائمة
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة الورقة الآن</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map((student) => (
            <div
              key={student.id}
              className="print-break-inside-avoid bg-white border border-dashed border-slate-400 rounded-xl p-5 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-emerald-800 truncate">
                  {school.name} · {stageName}
                </p>
                <p className="font-display text-base font-bold text-slate-900 mt-0.5 truncate">
                  {student.fullName}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {student.className} ·{' '}
                  <span className="font-mono tabular-nums">{student.studentCode}</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-2.5 leading-snug">
                  امسح الرمز بكاميرا الجوال لمتابعة الحضور والدرجات فوراً بدون تسجيل دخول.
                </p>
              </div>
              <div className="p-1.5 border border-slate-200 rounded-lg bg-white shrink-0">
                <QRCodeSVG value={buildPassUrl(student.passToken)} size={82} level="M" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Classrooms Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              شعب {stageName}
            </h2>
            <p className="text-xs text-slate-500">
              اختر شعبة لتصفية الطلاب أو أضف شعبة جديدة داخل {stageName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowClassModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>شعبة جديدة</span>
            </button>

            <button
              type="button"
              onClick={openAddStudent}
              disabled={classrooms.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة طالب</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterClassId('all')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              filterClassId === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            جميع شعب {stageName} ({students.length})
          </button>

          {classrooms.map((cls) => {
            const count = students.filter((s) => s.classId === cls.id).length;
            const active = filterClassId === cls.id;
            return (
              <div key={cls.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFilterClassId(cls.id)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
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
                    className="px-2 py-1.5 text-[11px] font-semibold text-white bg-rose-600 rounded-lg"
                  >
                    حذف؟
                  </button>
                ) : (
                  count === 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteClassId(cls.id)}
                      title="حذف الفصل الفارغ"
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg"
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

      {/* Students Directory & QR Controls */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم الطالب أو الرمز أو رقم ولي الأمر..."
              className="w-full pr-9 pl-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          <button
            type="button"
            onClick={() => setPrintSheetMode(true)}
            disabled={filteredStudents.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة ورقة بطاقات QR ({filteredStudents.length})</span>
          </button>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            لا يوجد طلاب مطابقون للبحث الحالي.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-5">الطالب</th>
                  <th className="py-3 px-4">الفصل</th>
                  <th className="py-3 px-4">ولي الأمر ورقم الواتساب</th>
                  <th className="py-3 px-5 text-left">بطاقة المتابعة والإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50/60">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-slate-900">{student.fullName}</p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        {student.studentCode}
                      </p>
                    </td>

                    <td className="py-3.5 px-4 text-xs text-slate-700">{student.className}</td>

                    <td className="py-3.5 px-4">
                      <p className="text-xs font-medium text-slate-800">
                        {student.parentName || '—'}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums" dir="ltr">
                        {student.parentPhone || 'غير مسجل'}
                      </p>
                    </td>

                    <td className="py-3.5 px-5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setQrStudent(student)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>بطاقة QR</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onPreviewPass(student.passToken)}
                          title="معاينة البطاقة الحية"
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditStudent(student)}
                          title="تعديل بيانات الطالب"
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        {confirmDeleteStudentId === student.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteStudent(student)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg whitespace-nowrap"
                            >
                              تأكيد
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteStudentId(null)}
                              className="px-2 py-1.5 text-xs text-slate-600"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteStudentId(student.id)}
                            title="حذف الطالب"
                            className="p-2 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
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

      {/* Modal: Add Section in Active Stage */}
      {showClassModal && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-bold text-slate-900">
                إضافة شعبة جديدة في {stageName}
              </h3>
              <button
                type="button"
                onClick={() => setShowClassModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم الشعبة</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={classNameInput}
                  onChange={(e) => setClassNameInput(e.target.value)}
                  placeholder="مثال: شعبة أ — أو الأول أ"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                />
              </div>

              <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                المرحلة المحددة: <span className="font-semibold text-slate-900">{stageName}</span>
                {' · '}سيتم فصل درجات وغيابات هذه الشعبة تلقائياً ضمن هذه المرحلة.
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  مرشد الشعبة (اختياري)
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={teacherInput}
                  onChange={(e) => setTeacherInput(e.target.value)}
                  placeholder="مثال: أ. محمد السعيد"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClassModal(false)}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingClass}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg"
                >
                  {savingClass ? 'جاري الحفظ...' : 'حفظ الشعبة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Student */}
      {showStudentModal && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-bold text-slate-900">
                {editingStudent ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setShowStudentModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الفصل</label>
                <select
                  required
                  value={stuClassId}
                  onChange={(e) => setStuClassId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                >
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  اسم الطالب الكامل
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={stuFullName}
                  onChange={(e) => setStuFullName(e.target.value)}
                  placeholder="مثال: عبد الله فهد العتيبي"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    رمز الطالب
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={stuCode}
                    onChange={(e) => setStuCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    اسم ولي الأمر
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={stuParentName}
                    onChange={(e) => setStuParentName(e.target.value)}
                    placeholder="أبو عبد الله"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  رقم واتساب ولي الأمر (محفوظ بخصوصية داخل المدرسة فقط)
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  maxLength={24}
                  value={stuParentPhone}
                  onChange={(e) => setStuParentPhone(e.target.value)}
                  placeholder="966551234567"
                  className="w-full px-3 py-2 text-sm font-mono text-left border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingStudent}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg"
                >
                  {savingStudent ? 'جاري الحفظ...' : editingStudent ? 'حفظ التعديلات' : 'إضافة وتوليد QR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Student QR Card & Parent Acknowledgements */}
      {qrStudent && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  بطاقة الطالب الحية — {qrStudent.fullName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {stageName} · {qrStudent.className} · رمز {qrStudent.studentCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrStudent(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col items-center text-center p-5 bg-[#F8F9F7] border border-slate-200 rounded-xl mb-5">
              <div className="p-3 bg-white border border-slate-200 rounded-xl mb-3">
                <QRCodeSVG value={buildPassUrl(qrStudent.passToken)} size={160} level="M" />
              </div>
              <p className="text-xs text-slate-600 max-w-xs leading-relaxed mb-4">
                شارك هذا الرابط أو الرمز مع ولي الأمر لمتابعة الغياب والدرجات لحظياً بدون تسجيل
                دخول.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyPassUrl(qrStudent.passToken)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                >
                  {copiedToken === qrStudent.passToken ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedToken === qrStudent.passToken ? 'تم نسخ الرابط' : 'نسخ رابط البطاقة'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const token = qrStudent.passToken;
                    setQrStudent(null);
                    onPreviewPass(token);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>فتح معاينة ولي الأمر</span>
                </button>
              </div>
            </div>

            {/* Parent Acknowledgements / Excuses Inbox for this Student */}
            <div>
              <h4 className="font-display text-sm font-bold text-slate-900 mb-2.5">
                ردود وأعذار ولي الأمر الموثقة ({studentAcks.length})
              </h4>
              {studentAcks.length === 0 ? (
                <p className="text-xs text-slate-500 p-4 border border-dashed border-slate-200 rounded-lg text-center">
                  لا توجد ردود أو أعذار موثقة من ولي الأمر على هذه البطاقة بعد.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {studentAcks.map((ack) => (
                    <div
                      key={ack.id}
                      className="p-3.5 rounded-lg border border-slate-200 bg-white flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">
                          {ack.type === 'excuse' ? 'عذر غياب' : 'تأكيد اطلاع'} · {ack.senderLabel}
                        </p>
                        <p className="text-slate-600 mt-1">{ack.message}</p>
                      </div>

                      {ack.schoolStatus === 'reviewed' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium whitespace-nowrap shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تمت المراجعة</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleReviewAck(qrStudent.passToken, ack.id)}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap shrink-0"
                        >
                          اعتماد المراجعة
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
    </div>
  );
}
