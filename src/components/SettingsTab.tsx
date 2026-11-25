import { useEffect, useState } from 'react';
import { Save, Sparkles } from 'lucide-react';
import { updateSchoolSettings } from '../lib/wisaalService';
import {
  Classroom,
  getSchoolStageNames,
  School,
  STAGE_IDS,
  StageNamesMap,
  Student,
} from '../types/wisaal';

interface SettingsTabProps {
  uid: string;
  school: School;
  classrooms: Classroom[];
  students: Student[];
  seeding: boolean;
  onSeedDemo: () => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

const STAGE_LABELS: Record<keyof StageNamesMap, string> = {
  stage_1: 'اسم المرحلة الأولى',
  stage_2: 'اسم المرحلة الثانية',
  stage_3: 'اسم المرحلة الثالثة',
};

export function SettingsTab({
  uid,
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
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    setName(school.name);
    setWhatsappNumber(school.whatsappNumber);
    setAcademicYear(school.academicYear);
    setThreshold(school.absenceAlertThreshold);
    setStageNames(getSchoolStageNames(school));
  }, [school]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateSchoolSettings(uid, students, classrooms, {
        name,
        whatsappNumber,
        academicYear,
        absenceAlertThreshold: threshold,
        stageNames,
      });
      onNotify('success', 'تم حفظ إعدادات المدرسة وأسماء المراحل ومزامنة جميع بطاقات الطلاب.');
    } catch {
      onNotify('error', 'تعذر حفظ الإعدادات. تحقق من صحة رقم الجوال.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="font-display text-lg font-bold text-slate-900 mb-1">
          بيانات المدرسة والمراحل الثلاث
        </h2>
        <p className="text-xs text-slate-500 mb-6">
          تُحدّث هذه البيانات وأسماء المراحل تلقائياً في رأس جميع بطاقات أولياء الأمور ورسائل
          واتساب.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">اسم المدرسة</label>
            <input
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                رقم واتساب الإدارة (لاستقبال أعذار الأهالي)
              </label>
              <input
                type="tel"
                dir="ltr"
                maxLength={24}
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="966500000000"
                className="w-full px-3.5 py-2 text-sm font-mono text-left border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">العام الدراسي</label>
              <input
                type="text"
                required
                maxLength={40}
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <h3 className="font-display text-sm font-bold text-slate-900 mb-1">
              تسمية المراحل الدراسية الثلاث
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              يمكنك تخصيص أسماء المراحل (مثال: الأول المتوسط / الثاني المتوسط / الثالث المتوسط، أو
              الابتدائية / المتوسطة / الثانوية).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STAGE_IDS.map((sid) => (
                <div key={sid}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              حد تنبيه رادار الغياب المتكرر (عدد أيام الغياب بدون عذر)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.min(30, Number(e.target.value) || 3)))}
              className="w-32 px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'جاري الحفظ...' : 'حفظ ومزامنة البطاقات'}</span>
            </button>
          </div>
        </form>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">
            إضافة 3 مراحل وشعب نموذجية للتجربة
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            ينشئ 3 مراحل دراسية (6 شعب) و9 طلاب بدرجات عدة مواد مجمّعة وسجلات حضور منفصلة لكل مرحلة.
          </p>
        </div>

        <button
          type="button"
          onClick={onSeedDemo}
          disabled={seeding}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>{seeding ? 'جاري الإضافة...' : 'تحميل بيانات نموذجية'}</span>
        </button>
      </section>
    </div>
  );
}
