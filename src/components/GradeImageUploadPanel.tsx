import { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Send,
  Trash2,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { buildApiUrl } from '../lib/pushNotifications';
import { ExtractedGradeRow, Student } from '../types/wisaal';

interface GradeImageUploadPanelProps {
  sectionName: string;
  stageName: string;
  subject: string;
  maxScore: number;
  sectionStudents: Student[];
  onDetectedMetadata: (meta: { subject?: string; maxScore?: number }) => void;
  onPublishExtracted: (
    scores: Record<string, string>,
    notes: Record<string, string>
  ) => Promise<void>;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

async function compressImageToBase64(
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        resolve({ base64, mimeType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function GradeImageUploadPanel({
  sectionName,
  subject,
  maxScore,
  sectionStudents,
  onDetectedMetadata,
  onPublishExtracted,
  onNotify,
}: GradeImageUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<ExtractedGradeRow[]>([]);
  const [detectedMeta, setDetectedMeta] = useState<{ subject: string; maxScore: number }>({
    subject: '',
    maxScore: 0,
  });

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('اختر صورة بصيغة JPG أو PNG أو WebP.');
      return;
    }

    setErrorMsg(null);
    setRows([]);
    setExtracting(true);

    try {
      const { base64, mimeType, previewUrl: compressedPreview } = await compressImageToBase64(file);
      setPreviewUrl(compressedPreview);

      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('يرجى تسجيل الدخول أولاً.');
      }

      const resp = await fetch(buildApiUrl('/api/extract-grades'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          subject,
          maxScore,
          sectionStudents: sectionStudents.map((s) => ({
            id: s.id,
            fullName: s.fullName,
            studentCode: s.studentCode,
          })),
        }),
      });

      const data = (await resp.json()) as {
        error?: string;
        detectedSubject?: string;
        detectedMaxScore?: number;
        rows?: ExtractedGradeRow[];
      };

      if (!resp.ok) {
        throw new Error(data.error || 'تعذر قراءة الصورة.');
      }

      const extractedRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(extractedRows);
      setDetectedMeta({
        subject: data.detectedSubject || '',
        maxScore: data.detectedMaxScore || 0,
      });

      if (extractedRows.length === 0) {
        setErrorMsg('لم تظهر درجات واضحة في الصورة.');
      } else {
        onNotify('success', `تم استخراج ${extractedRows.length} سطراً.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر قراءة الصورة.';
      setErrorMsg(msg);
      onNotify('error', msg);
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const matchedValidCount = rows.filter(
    (r) => r.matchedStudentId && r.score !== null && !Number.isNaN(r.score)
  ).length;

  const handleConfirmPublish = async () => {
    const scores: Record<string, string> = {};
    const notes: Record<string, string> = {};

    for (const r of rows) {
      if (!r.matchedStudentId || r.score === null) continue;
      scores[r.matchedStudentId] = String(r.score);
      if (r.note.trim()) notes[r.matchedStudentId] = r.note.trim();
    }

    if (Object.keys(scores).length === 0) {
      onNotify('error', 'طابق طالباً واحداً على الأقل.');
      return;
    }

    setPublishing(true);
    try {
      await onPublishExtracted(scores, notes);
      setRows([]);
      setPreviewUrl(null);
      setDetectedMeta({ subject: '', maxScore: 0 });
    } finally {
      setPublishing(false);
    }
  };

  const handleUpdateRow = (index: number, patch: Partial<ExtractedGradeRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleRemoveRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm sm:text-base font-bold text-slate-900">
          كشف {sectionName} · {subject}
        </h3>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void handleFileSelected(e.target.files?.[0])}
            className="hidden"
          />
          <button
            type="button"
            disabled={extracting || sectionStudents.length === 0}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {extracting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
            <span>{extracting ? 'جاري القراءة...' : 'رفع صورة الكشف'}</span>
          </button>
        </div>
      </div>

      {sectionStudents.length === 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          أضف طلاباً للشعبة أولاً.
        </p>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!previewUrl && !extracting && (
        <button
          type="button"
          disabled={sectionStudents.length === 0}
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-10 px-6 border-2 border-dashed border-slate-200 hover:border-emerald-600/60 bg-[#F7F8F7] hover:bg-emerald-50/30 disabled:opacity-50 rounded-xl flex flex-col items-center justify-center text-center transition-colors"
        >
          <ImagePlus className="w-7 h-7 text-emerald-700 mb-2" />
          <p className="text-sm font-semibold text-slate-800">اختر أو التقط صورة كشف الدرجات</p>
        </button>
      )}

      {extracting && (
        <div className="p-8 border border-slate-200 rounded-xl bg-slate-50/60 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-6 h-6 text-emerald-700 animate-spin mb-2.5" />
          <p className="text-sm font-medium text-slate-800">جاري قراءة الدرجات...</p>
        </div>
      )}

      {!extracting && rows.length > 0 && (
        <div className="space-y-4">
          {(detectedMeta.subject || detectedMeta.maxScore > 0) && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-xs text-emerald-950">
              <span>
                {detectedMeta.subject || ''}
                {detectedMeta.maxScore > 0 ? ` · العظمى ${detectedMeta.maxScore}` : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  onDetectedMetadata({
                    subject: detectedMeta.subject || undefined,
                    maxScore: detectedMeta.maxScore > 0 ? detectedMeta.maxScore : undefined,
                  })
                }
                className="font-semibold text-emerald-800 underline whitespace-nowrap"
              >
                تطبيق
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {previewUrl && (
              <div className="lg:col-span-4 border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                <img
                  src={previewUrl}
                  alt="كشف الدرجات"
                  className="w-full max-h-[380px] object-contain"
                />
                <div className="p-2.5 border-t border-slate-200 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewUrl(null);
                      setRows([]);
                    }}
                    className="text-xs text-rose-700 hover:underline"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            <div className="lg:col-span-8 border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums">
                  {matchedValidCount} / {rows.length}
                </span>
                <button
                  type="button"
                  disabled={publishing || matchedValidCount === 0}
                  onClick={handleConfirmPublish}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{publishing ? 'جاري النشر...' : `نشر (${matchedValidCount})`}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white text-slate-500">
                      <th className="py-2 px-3">في الصورة</th>
                      <th className="py-2 px-3">الطالب</th>
                      <th className="py-2 px-3 w-20">الدرجة</th>
                      <th className="py-2 px-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, idx) => {
                      const isMatched = Boolean(row.matchedStudentId);
                      return (
                        <tr
                          key={`${row.extractedName}_${idx}`}
                          className={isMatched ? 'bg-white' : 'bg-amber-50/40'}
                        >
                          <td className="py-2 px-3">
                            <span className="font-medium text-slate-900 inline-flex items-center gap-1">
                              {isMatched && row.confidence === 'high' && (
                                <CheckCircle2 className="w-3 h-3 text-emerald-700 shrink-0" />
                              )}
                              <span>{row.extractedName || '—'}</span>
                            </span>
                          </td>

                          <td className="py-2 px-3">
                            <select
                              value={row.matchedStudentId}
                              onChange={(e) =>
                                handleUpdateRow(idx, { matchedStudentId: e.target.value })
                              }
                              className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-emerald-700"
                            >
                              <option value="">— تجاهل —</option>
                              {sectionStudents.map((stu) => (
                                <option key={stu.id} value={stu.id}>
                                  {stu.fullName}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="py-2 px-3">
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              max={maxScore}
                              value={row.score === null ? '' : row.score}
                              onChange={(e) =>
                                handleUpdateRow(idx, {
                                  score:
                                    e.target.value.trim() === '' ? null : Number(e.target.value),
                                })
                              }
                              className="w-20 px-2 py-1 text-xs font-mono tabular-nums text-center border border-slate-200 rounded-md focus:outline-none focus:border-emerald-700"
                            />
                          </td>

                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(idx)}
                              aria-label="حذف"
                              className="p-1 text-slate-400 hover:text-rose-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
