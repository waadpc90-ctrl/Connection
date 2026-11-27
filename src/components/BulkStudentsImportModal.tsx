import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  ClipboardPaste,
  Crop,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import {
  CropBoundsRatio,
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

async function compressCroppedImageForApi(
  file: File,
  crop?: CropBoundsRatio
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الصورة غير صالحة.'));
      img.onload = () => {
        const sx = Math.round((crop?.left ?? 0) * img.width);
        const sy = Math.round((crop?.top ?? 0) * img.height);
        const sw = Math.max(20, Math.round(((crop?.right ?? 1) - (crop?.left ?? 0)) * img.width));
        const sh = Math.max(20, Math.round(((crop?.bottom ?? 1) - (crop?.top ?? 0)) * img.height));

        const maxDim = 2000;
        let width = sw;
        let height = sh;
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
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);
  const [showCropTools, setShowCropTools] = useState<boolean>(false);
  const [cropLeftPct, setCropLeftPct] = useState<number>(0);
  const [cropRightPct, setCropRightPct] = useState<number>(100);
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
        set.add(normalizeArabicForMatch(s.fullName));
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
      const norm = normalizeArabicForMatch(item.fullName);
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
    // Strict Arabic student names-only filter
    const parsed = parseStudentsFromText(pasteText, true);
    if (parsed.length === 0) {
      setErrorMsg('لم يتم العثور على أسماء عربية صالحة (ثنائية أو ثلاثية) في النص.');
      return;
    }
    populateDraftRows(parsed);
  };

  const runExtractionOnFile = async (file: File, crop?: CropBoundsRatio) => {
    setErrorMsg(null);
    setOcrProgress(null);
    setExtracting(true);
    try {
      const { base64, mimeType } = await compressCroppedImageForApi(file, crop);
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
        const serverRows = Array.isArray(attempt.data.rows) ? attempt.data.rows : [];
        // Keep strictly clean Arabic student names
        const joinedNames = serverRows.map((r) => r.fullName).join('\n');
        extracted = parseStudentsFromText(joinedNames, true);
      } else if (attempt.kind === 'api_error') {
        throw new Error(attempt.message);
      } else {
        // Static hosting (GitHub Pages / Android PWA): run pure high-accuracy Arabic OCR on original full-res file
        setOcrProgress(5);
        extracted = await extractStudentsLocallyFromImage(file, {
          crop,
          namesOnly: true,
          onProgress: (pct) => setOcrProgress(pct),
        });
      }

      if (extracted.length === 0) {
        setShowCropTools(true);
        setErrorMsg(
          'لم تظهر أسماء عربية واضحة. استخدم زر «تحديد عمود الأسماء» لقص عمود الأسماء فقط ثم أعد القراءة.'
        );
      } else {
        populateDraftRows(extracted);
        onNotify('success', `تمت تصفية واستخراج ${extracted.length} اسماً عربياً.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر قراءة الصورة.';
      setErrorMsg(msg);
      onNotify('error', msg);
    } finally {
      setExtracting(false);
      setOcrProgress(null);
    }
  };

  const handleImageSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('اختر صورة بصيغة JPG أو PNG أو WebP.');
      return;
    }

    setSelectedFile(file);
    setCropLeftPct(0);
    setCropRightPct(100);
    setShowCropTools(false);

    const previewReader = new FileReader();
    previewReader.onload = () => setFullPreviewUrl(String(previewReader.result || ''));
    previewReader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';

    await runExtractionOnFile(file);
  };

  const handleReExtractCropped = async () => {
    if (!selectedFile) return;
    const left = Math.min(cropLeftPct, cropRightPct - 10) / 100;
    const right = Math.max(cropRightPct, cropLeftPct + 10) / 100;
    await runExtractionOnFile(selectedFile, {
      left: Math.max(0, left),
      right: Math.min(1, right),
      top: 0,
      bottom: 1,
    });
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
                placeholder={'ألصق القائمة هنا وسيتم تصفية الأسماء العربية فقط تلقائياً\n(تحذف الأرقام والدرجات والرموز والعناوين)'}
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
                  <span>تصفية واستخراج الأسماء</span>
                </button>
              </div>
            </div>
          ) : (
            /* Mode: Image Upload / Camera + Column Cropper */
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

              <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/70 space-y-3">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {fullPreviewUrl ? (
                      <img
                        src={fullPreviewUrl}
                        alt="معاينة الكشف"
                        className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                        <ImagePlus className="w-5 h-5" />
                      </div>
                    )}
                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-800">
                        استخراج الأسماء العربية فقط من الصورة
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        يصفّي الأرقام والعناوين ويبقي الأسماء فقط
                      </p>
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

                {/* Column Focus / Cropper for Dense Multi-Column Sheets */}
                {selectedFile && fullPreviewUrl && (
                  <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowCropTools((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      <span>
                        {showCropTools ? 'إخفاء تحديد عمود الأسماء' : 'تحديد عمود الأسماء فقط (للكشوف متعددة الأعمدة)'}
                      </span>
                    </button>

                    {showCropTools && (
                      <div className="space-y-3 bg-white p-3 rounded-xl border border-slate-200">
                        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 max-h-52 flex items-center justify-center">
                          <div className="relative inline-block">
                            <img
                              src={fullPreviewUrl}
                              alt="تحديد عمود الأسماء"
                              className="max-h-52 w-auto block select-none"
                            />
                            {/* Dimmed left overlay */}
                            <div
                              className="absolute inset-y-0 left-0 bg-slate-950/55 pointer-events-none"
                              style={{ width: `${cropLeftPct}%` }}
                            />
                            {/* Dimmed right overlay */}
                            <div
                              className="absolute inset-y-0 right-0 bg-slate-950/55 pointer-events-none"
                              style={{ width: `${100 - cropRightPct}%` }}
                            />
                            {/* Highlight frame */}
                            <div
                              className="absolute inset-y-0 border-x-2 border-emerald-500 pointer-events-none"
                              style={{
                                left: `${cropLeftPct}%`,
                                width: `${Math.max(0, cropRightPct - cropLeftPct)}%`,
                              }}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3" dir="ltr">
                          <label className="text-[11px] text-slate-600 flex flex-col gap-1">
                            <span className="text-right font-medium" dir="rtl">
                              بداية العمود من اليسار ({cropLeftPct}%)
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={85}
                              value={cropLeftPct}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setCropLeftPct(Math.min(val, cropRightPct - 15));
                              }}
                              className="accent-emerald-700"
                            />
                          </label>

                          <label className="text-[11px] text-slate-600 flex flex-col gap-1">
                            <span className="text-right font-medium" dir="rtl">
                              نهاية العمود من اليمين ({cropRightPct}%)
                            </span>
                            <input
                              type="range"
                              min={15}
                              max={100}
                              value={cropRightPct}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setCropRightPct(Math.max(val, cropLeftPct + 15));
                              }}
                              className="accent-emerald-700"
                            />
                          </label>
                        </div>

                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            disabled={extracting}
                            onClick={handleReExtractCropped}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${extracting ? 'animate-spin' : ''}`} />
                            <span>إعادة قراءة العمود المحدد</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
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

          {/* Review & Edit Filtered Arabic Names */}
          {draftRows.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  الأسماء المصفّاة ({selectedValidRows.length} / {draftRows.length})
                </span>
                <button
                  type="button"
                  onClick={addBlankRow}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة اسم</span>
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {draftRows.map((row, idx) => {
                  const isDup =
                    row.fullName.trim().length >= 2 &&
                    existingNamesInTargetClass.has(normalizeArabicForMatch(row.fullName));
                  return (
                    <div
                      key={row.rowKey}
                      className={`px-3 py-2 flex items-center gap-2 ${
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

                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          maxLength={100}
                          value={row.fullName}
                          onChange={(e) => updateRow(row.rowKey, { fullName: e.target.value })}
                          placeholder="اسم الطالب"
                          className="w-full px-2.5 py-1.5 text-sm font-medium border border-slate-200 rounded-md focus:outline-none focus:border-emerald-700"
                        />
                        {isDup && (
                          <span className="inline-block mt-0.5 text-[10px] font-medium text-amber-700">
                            موجود مسبقاً في الشعبة
                          </span>
                        )}
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
