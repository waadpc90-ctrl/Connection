import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  ClipboardPaste,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import {
  extractStudentsLocallyFromImage,
  normalizeArabicForMatch,
  parseStudentsFromText,
  postJsonApiOrFallback,
} from '../lib/clientOcrFallback';
import { bulkCreateStudentsWithPasses } from '../lib/wisaalService';
import { Classroom, School, Student } from '../types/wisaal';

interface BulkStudentsImportModalProps {
  uid: string;
  school: School;
  classrooms: Classroom[];
  existingStudents: Student[];
  initialClassId: string;
  onClose: () => void;
  onImported: (classId: string, count: number) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

interface DraftStudentRow {
  rowKey: string;
  selected: boolean;
  fullName: string;
  studentCode: string;
  parentName: string;
  parentPhone: string;
}

type ImportMode = 'paste' | 'image';

function normalizeNameForCompare(name: string): string {
  return normalizeArabicForMatch(name);
}

async function compressRosterImageToBase64(
  file: File
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الصورة غير صالحة.'));
      img.onload = () => {
        const maxDim = 1600;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('تعذر معالجة الصورة.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        resolve({ base64, mimeType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function BulkStudentsImportModal({
  uid,
  school,
  classrooms,
  existingStudents,
  initialClassId,
  onClose,
  onImported,
  onNotify,
}: BulkStudentsImportModalProps) {
  const [targetClassId, setTargetClassId] = useState<string>(
    initialClassId || classrooms[0]?.id || ''
  );
  const [mode, setMode] = useState<ImportMode>('paste');
  const [pasteText, setPasteText] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState<DraftStudentRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const existingNamesInTargetClass = useMemo(() => {
    const set = new Set<string>();
    for (const s of existingStudents) {
      if (s.classId === targetClassId) {
        set.add(normalizeNameForCompare(s.fullName));
      }
    }
    return set;
  }, [existingStudents, targetClassId]);

  const populateDraftRows = (
    items: Array<{
      fullName: string;
      studentCode: string;
      parentName: string;
      parentPhone: string;
    }>
  ) => {
    const seenInBatch = new Set<string>();
    const nextRows: DraftStudentRow[] = items.map((item, idx) => {
      const norm = normalizeNameForCompare(item.fullName);
      const isDuplicate = existingNamesInTargetClass.has(norm) || seenInBatch.has(norm);
      seenInBatch.add(norm);
      return {
        rowKey: `row_${Date.now()}_${idx}`,
        selected: !isDuplicate,
        fullName: item.fullName,
        studentCode: item.studentCode,
        parentName: item.parentName,
        parentPhone: item.parentPhone,
      };
    });
    setDraftRows(nextRows);
  };

  const handleParseText = () => {
    setErrorMsg(null);
    const parsed = parseStudentsFromText(pasteText, false);
    if (parsed.length === 0) {
      setErrorMsg('لم يتم العثور على أسماء صالحة في النص الملصوق.');
      return;
    }
    populateDraftRows(parsed);
  };

  const handleImageSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('اختر صورة بصيغة JPG أو PNG أو WebP.');
      return;
    }

    setErrorMsg(null);
    setOcrProgress(null);
    setExtracting(true);
    try {
      const { base64, mimeType, previewUrl: compressed } = await compressRosterImageToBase64(file);
      setPreviewUrl(compressed);

      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('يرجى تسجيل الدخول أولاً.');
      }

      type ExtractStudentsResp = {
        rows?: Array<{
          fullName: string;
          studentCode: string;
          parentName: string;
          parentPhone: string;
        }>;
      };

      const attempt = await postJsonApiOrFallback<ExtractStudentsResp>(
        '/api/extract-students',
        idToken,
        { imageBase64: base64, mimeType }
      );

      let extracted: Array<{
        fullName: string;
        studentCode: string;
        parentName: string;
        parentPhone: string;
      }> = [];

      if (attempt.kind === 'ok') {
        extracted = Array.isArray(attempt.data.rows) ? attempt.data.rows : [];
      } else if (attempt.kind === 'api_error') {
        throw new Error(attempt.message);
      } else {
        // Static hosting (e.g. GitHub Pages PWA): run on-device Arabic OCR directly in browser
        setOcrProgress(5);
        extracted = await extractStudentsLocallyFromImage(compressed, (pct) => {
          setOcrProgress(pct);
        });
      }

      if (extracted.length === 0) {
        setErrorMsg('لم تظهر أسماء طلاب واضحة في الصورة. جرّب صورة أقرب وأوضح أو استخدم النسخ واللصق.');
      } else {
        populateDraftRows(extracted);
        onNotify('success', `تم استخراج ${extracted.length} اسماً من الصورة.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر قراءة الصورة.';
      setErrorMsg(msg);
      onNotify('error', msg);
    } finally {
      setExtracting(false);
      setOcrProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const updateRow = (rowKey: string, patch: Partial<DraftStudentRow>) => {
    setDraftRows((prev) =>
      prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row))
    );
  };

  const removeRow = (rowKey: string) => {
    setDraftRows((prev) => prev.filter((row) => row.rowKey !== rowKey));
  };

  const addBlankRow = () => {
    setDraftRows((prev) => [
      ...prev,
      {
        rowKey: `row_${Date.now()}_${prev.length}`,
        selected: true,
        fullName: '',
        studentCode: '',
        parentName: '',
        parentPhone: '',
      },
    ]);
  };

  const selectedValidRows = useMemo(
    () => draftRows.filter((r) => r.selected && r.fullName.trim().length >= 2),
    [draftRows]
  );

  const handleSaveBulk = async () => {
    const targetClass = classrooms.find((c) => c.id === targetClassId);
    if (!targetClass) {
      setErrorMsg('اختر الشعبة أولاً.');
      return;
    }
    if (selectedValidRows.length === 0) {
      setErrorMsg('اختر طالباً واحداً على الأقل للحفظ.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const { createdCount } = await bulkCreateStudentsWithPasses(
        uid,
        school,
        targetClass,
        selectedValidRows.map((r) => ({
          fullName: r.fullName,
          studentCode: r.studentCode,
          parentName: r.parentName,
          parentPhone: r.parentPhone,
        })),
        existingStudents.map((s) => s.studentCode)
      );
      onImported(targetClass.id, createdCount);
    } catch {
      setErrorMsg('تعذر حفظ قائمة الطلاب. حاول مرة أخرى.');
      onNotify('error', 'تعذر حفظ القائمة.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h3 className="font-display text-base font-bold text-slate-900">إضافة طلاب جماعي</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Target Section + Mode Switch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">الشعبة</label>
              <select
                value={targetClassId}
                onChange={(e) => setTargetClassId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {classrooms.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">طريقة الإدخال</label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMode('paste');
                    setErrorMsg(null);
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors ${
                    mode === 'paste'
                      ? 'bg-white text-emerald-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>نسخ ولصق</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('image');
                    setErrorMsg(null);
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors ${
                    mode === 'image'
                      ? 'bg-white text-emerald-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>من صورة</span>
                </button>
              </div>
            </div>
          </div>

          {/* Mode: Paste Text */}
          {mode === 'paste' ? (
            <div className="space-y-2.5">
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'ألصق الأسماء هنا (اسم في كل سطر)\nمثال:\n1. أحمد علي محمد\n2. زينب حسن كريم 07701234567\n3. مصطفى سعد عباس'}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-700 leading-relaxed resize-y"
              />
              <div className="flex items-center justify-end gap-2">
                {pasteText.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setPasteText('');
                      setDraftRows([]);
                      setErrorMsg(null);
                    }}
                    className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
                  >
                    مسح
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleParseText}
                  disabled={!pasteText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-lg"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>تجهيز القائمة</span>
                </button>
              </div>
            </div>
          ) : (
            /* Mode: Image Upload / Camera */
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void handleImageSelected(e.target.files?.[0])}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => void handleImageSelected(e.target.files?.[0])}
              />

              <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="معاينة الكشف"
                      className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                      <ImagePlus className="w-5 h-5" />
                    </div>
                  )}
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-800">صورة كشف أو قائمة الأسماء</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">مطبوعة أو بخط اليد أو لقطة شاشة</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={extracting}
                    onClick={() => cameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 disabled:opacity-50 rounded-lg"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>كاميرا</span>
                  </button>
                  <button
                    type="button"
                    disabled={extracting}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg"
                  >
                    {extracting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {extracting
                        ? ocrProgress !== null
                          ? `جاري القراءة ${ocrProgress}%`
                          : 'جاري القراءة...'
                        : 'اختيار صورة'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200/80 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Review & Edit Extracted List */}
          {draftRows.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  الأسماء الجاهزة ({selectedValidRows.length} / {draftRows.length})
                </span>
                <button
                  type="button"
                  onClick={addBlankRow}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>صف جديد</span>
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {draftRows.map((row, idx) => {
                  const isDup =
                    row.fullName.trim().length >= 2 &&
                    existingNamesInTargetClass.has(normalizeNameForCompare(row.fullName));
                  return (
                    <div
                      key={row.rowKey}
                      className={`p-2.5 flex items-center gap-2 ${
                        row.selected ? 'bg-white' : 'bg-slate-50/70 opacity-65'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => updateRow(row.rowKey, { selected: !row.selected })}
                        aria-label="تحديد الطالب"
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          row.selected
                            ? 'bg-emerald-700 border-emerald-700 text-white'
                            : 'bg-white border-slate-300 text-transparent'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                      </button>

                      <span className="text-[11px] font-mono text-slate-400 w-5 text-center shrink-0">
                        {idx + 1}
                      </span>

                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-1.5 min-w-0">
                        <div className="sm:col-span-6 relative">
                          <input
                            type="text"
                            maxLength={100}
                            value={row.fullName}
                            onChange={(e) =>
                              updateRow(row.rowKey, { fullName: e.target.value })
                            }
                            placeholder="اسم الطالب"
                            className="w-full px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md focus:outline-none focus:border-emerald-700"
                          />
                          {isDup && (
                            <span className="inline-block mt-0.5 text-[10px] font-medium text-amber-700">
                              موجود مسبقاً في الشعبة
                            </span>
                          )}
                        </div>

                        <input
                          type="text"
                          maxLength={32}
                          value={row.studentCode}
                          onChange={(e) =>
                            updateRow(row.rowKey, { studentCode: e.target.value })
                          }
                          placeholder="رمز تلقائي"
                          className="sm:col-span-3 px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-emerald-700"
                        />

                        <input
                          type="tel"
                          dir="ltr"
                          maxLength={24}
                          value={row.parentPhone}
                          onChange={(e) =>
                            updateRow(row.rowKey, { parentPhone: e.target.value })
                          }
                          placeholder="جوال (اختياري)"
                          className="sm:col-span-3 px-2 py-1.5 text-xs font-mono text-left border border-slate-200 rounded-md focus:outline-none focus:border-emerald-700"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => removeRow(row.rowKey)}
                        aria-label="حذف الصف"
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200/80 bg-slate-50/70 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg"
          >
            إلغاء
          </button>

          <button
            type="button"
            disabled={saving || extracting || selectedValidRows.length === 0}
            onClick={handleSaveBulk}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 rounded-lg"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>
              {saving
                ? 'جاري الحفظ...'
                : selectedValidRows.length > 0
                  ? `إضافة (${selectedValidRows.length})`
                  : 'حفظ الطلاب'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
