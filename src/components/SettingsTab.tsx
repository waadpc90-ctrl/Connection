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
  stage_1: 'المرحلة الأولى',
  stage_2: 'المرحلة الثانية',
  stage_3: 'المرحلة الثالثة',
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
      onNotify('success', 'تم حفظ الإعدادات.');
    } catch {
      onNotify('error', 'تعذر الحفظ.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6">
        <h2 className="font-display text-base font-bold text-slate-900 mb-5">بيانات المدرسة</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">اسم المدرسة</label>
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
              <label className="block text-xs font-medium text-slate-600 mb-1">العام الدراسي</label>
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
              <label className="block text-xs font-medium text-slate-600 mb-1">هاتف الإدارة</label>
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
                onChange={(e) => setThreshold(Math.max(1, Math.min(30, Number(e.target.value) || 3)))}
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
    </div>
  );
}
