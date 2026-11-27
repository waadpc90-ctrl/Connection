import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  Award,
  Check,
  ClipboardCheck,
  Copy,
  ExternalLink,
  ImageOff,
  ImagePlus,
  Megaphone,
  Printer,
  Send,
  Smartphone,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { compressImageToDataUrl } from '../lib/imageCompression';
import {
  buildStagePortalUrl,
  deleteDirectStudentAlert,
  deleteStageBroadcast,
  removeDirectStudentAlertImage,
  removeStageBroadcastImage,
  sendDirectStudentMessage,
  sendStageCollectiveBroadcast,
} from '../lib/wisaalService';
import {
  Classroom,
  FIELD_LIMITS,
  formatArabicDate,
  getSchoolStageNames,
  resolveClassroomStageId,
  resolveRecordStageId,
  School,
  STAGE_IDS,
  StageBroadcastKind,
  StageId,
  StagePortal,
  Student,
} from '../types/wisaal';
import { evictMediaFromCache, MediaAttachmentPreview } from './MediaAttachmentPreview';

interface StageBroadcastsTabProps {
  uid: string;
  school: School;
  activeStageId: StageId;
  activeStageName: string;
  allClassrooms: Classroom[];
  allStudents: Student[];
  stageClassrooms: Classroom[];
  stageStudents: Student[];
  onPreviewStagePortal: (stageToken: string) => void;
  onPreviewPass: (passToken: string) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

interface RecentPrivateMessage {
  id: string;
  studentName: string;
  className: string;
  passToken: string;
  title: string;
  body: string;
  createdAtIso: string;
  mediaId?: string;
  imageCaption?: string;
}

const BROADCAST_KINDS: { value: StageBroadcastKind; label: string }[] = [
  { value: 'announcement', label: 'تعميم' },
  { value: 'urgent', label: 'عاجل' },
  { value: 'grades', label: 'درجات' },
  { value: 'attendance', label: 'غياب' },
];

function formatTime(iso: string): string {
  if (!iso) return '';
  const datePart = iso.slice(0, 10);
  const timePart = iso.length >= 16 ? iso.slice(11, 16) : '';
  return timePart ? `${formatArabicDate(datePart)} · ${timePart}` : formatArabicDate(datePart);
}

export function StageBroadcastsTab({
  uid,
  school,
  activeStageId,
  activeStageName,
  allClassrooms,
  allStudents,
  stageClassrooms,
  stageStudents,
  onPreviewStagePortal,
  onPreviewPass,
  onNotify,
}: StageBroadcastsTabProps) {
  const [targetValue, setTargetValue] = useState<string>('all');
  const [kind, setKind] = useState<StageBroadcastKind>('announcement');
  const [title, setTitle] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [attachedImage, setAttachedImage] = useState<{
    dataUrl: string;
    sizeKb: number;
    fileName: string;
  } | null>(null);
  const [imageCaption, setImageCaption] = useState<string>('');
  const [compressingImage, setCompressingImage] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [copiedStageId, setCopiedStageId] = useState<StageId | null>(null);
  const [printPosterMode, setPrintPosterMode] = useState<boolean>(false);
  const [activePortal, setActivePortal] = useState<StagePortal | null>(null);
  const [stageExternalSubCount, setStageExternalSubCount] = useState<number>(0);
  const [recentPrivateMessages, setRecentPrivateMessages] = useState<RecentPrivateMessage[]>([]);
  const [confirmActionKey, setConfirmActionKey] = useState<string | null>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stageNames = useMemo(() => getSchoolStageNames(school), [school]);
  const stageTokens = school.stageTokens;
  const activeStageToken = stageTokens?.[activeStageId] || '';

  useEffect(() => {
    setTargetValue('all');
  }, [activeStageId]);

  useEffect(() => {
    if (!activeStageToken) {
      setActivePortal(null);
      setStageExternalSubCount(0);
      return;
    }
    const unsubPortal = onSnapshot(doc(db, 'stagePortals', activeStageToken), (snap) => {
      if (snap.exists()) {
        setActivePortal({
          stageToken: snap.id,
          ...(snap.data() as Omit<StagePortal, 'stageToken'>),
        });
      } else {
        setActivePortal(null);
      }
    });

    const subsQ = query(
      collection(db, 'stagePortals', activeStageToken, 'pushSubscriptions'),
      where('schoolOwnerId', '==', uid)
    );
    const unsubSubs = onSnapshot(
      subsQ,
      (snap) => setStageExternalSubCount(snap.size),
      () => setStageExternalSubCount(0)
    );

    return () => {
      unsubPortal();
      unsubSubs();
    };
  }, [activeStageToken, uid]);

  const classStageLookup = useMemo(
    () => new Map(allClassrooms.map((c) => [c.id, resolveClassroomStageId(c)])),
    [allClassrooms]
  );

  const stageSummaryByStage = useMemo(() => {
    const out: Record<StageId, { sections: Classroom[]; studentCount: number }> = {
      stage_1: { sections: [], studentCount: 0 },
      stage_2: { sections: [], studentCount: 0 },
      stage_3: { sections: [], studentCount: 0 },
    };
    for (const c of allClassrooms) {
      out[resolveClassroomStageId(c)].sections.push(c);
    }
    for (const s of allStudents) {
      const sid = resolveRecordStageId(s.stageId, s.classId, classStageLookup);
      out[sid].studentCount += 1;
    }
    return out;
  }, [allClassrooms, allStudents, classStageLookup]);

  const isPrivateTarget = targetValue.startsWith('stu:');
  const selectedStudent = useMemo(() => {
    if (!isPrivateTarget) return null;
    return stageStudents.find((s) => s.id === targetValue.slice(4)) || null;
  }, [isPrivateTarget, targetValue, stageStudents]);

  const selectedClassId = useMemo(() => {
    if (targetValue.startsWith('cls:')) return targetValue.slice(4);
    return 'all';
  }, [targetValue]);

  const handleCopyStageUrl = async (sid: StageId) => {
    const token = stageTokens?.[sid];
    if (!token) return;
    try {
      await navigator.clipboard.writeText(buildStagePortalUrl(token));
      setCopiedStageId(sid);
      onNotify('success', 'تم نسخ الرابط.');
      setTimeout(() => setCopiedStageId((prev) => (prev === sid ? null : prev)), 2000);
    } catch {
      onNotify('error', 'تعذر النسخ.');
    }
  };

  const handleSelectImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressingImage(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      setAttachedImage({
        dataUrl: compressed.dataUrl,
        sizeKb: compressed.sizeKb,
        fileName: file.name,
      });
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تجهيز الصورة.');
    } finally {
      setCompressingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearAttachedImage = () => {
    setAttachedImage(null);
    setImageCaption('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      onNotify('error', 'اكتب العنوان ونص الرسالة.');
      return;
    }

    setSending(true);
    try {
      if (isPrivateTarget) {
        if (!selectedStudent) return;
        const res = await sendDirectStudentMessage(uid, school, activeStageId, selectedStudent, {
          kind,
          title,
          body,
          imageDataUrl: attachedImage?.dataUrl,
          imageCaption,
        });
        setRecentPrivateMessages((prev) => [
          {
            id: res.alert.id,
            studentName: selectedStudent.fullName,
            className: selectedStudent.className,
            passToken: selectedStudent.passToken,
            title: res.alert.title,
            body: res.alert.body,
            createdAtIso: res.alert.createdAtIso,
            mediaId: res.mediaId,
            imageCaption: res.alert.imageCaption,
          },
          ...prev.slice(0, 9),
        ]);
        setTitle('');
        setBody('');
        handleClearAttachedImage();
        onNotify('success', `تم الإرسال إلى ${selectedStudent.fullName}.`);
      } else {
        const result = await sendStageCollectiveBroadcast(
          uid,
          school,
          activeStageId,
          stageClassrooms,
          stageStudents,
          {
            kind,
            title,
            body,
            targetClassId: selectedClassId,
            imageDataUrl: attachedImage?.dataUrl,
            imageCaption,
          }
        );
        setTitle('');
        setBody('');
        handleClearAttachedImage();
        onNotify(
          'success',
          `تم الإرسال إلى ${result.affectedStudentsCount} طالب${result.externalPushSent > 0 ? ` · ${result.externalPushSent} إشعار خارجي` : ''}.`
        );
      }
    } catch {
      onNotify('error', 'تعذر الإرسال.');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteBroadcast = async (broadcastId: string) => {
    if (!activeStageToken) return;
    const key = `del-b:${broadcastId}`;
    setBusyActionKey(key);
    try {
      const { deletedMediaId } = await deleteStageBroadcast(
        activeStageToken,
        broadcastId,
        stageStudents
      );
      if (deletedMediaId) {
        evictMediaFromCache('stage', activeStageToken, deletedMediaId);
      }
      setConfirmActionKey(null);
      onNotify('success', 'تم حذف الإعمام.');
    } catch {
      onNotify('error', 'تعذر حذف الإعمام.');
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleRemoveBroadcastImage = async (broadcastId: string) => {
    if (!activeStageToken) return;
    const key = `img-b:${broadcastId}`;
    setBusyActionKey(key);
    try {
      const { deletedMediaId } = await removeStageBroadcastImage(
        activeStageToken,
        broadcastId,
        stageStudents
      );
      if (deletedMediaId) {
        evictMediaFromCache('stage', activeStageToken, deletedMediaId);
      }
      setConfirmActionKey(null);
      onNotify('success', 'تم حذف الصورة.');
    } catch {
      onNotify('error', 'تعذر حذف الصورة.');
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleDeletePrivateMessage = async (msg: RecentPrivateMessage) => {
    const key = `del-p:${msg.id}`;
    setBusyActionKey(key);
    try {
      await deleteDirectStudentAlert(msg.passToken, msg.mediaId);
      if (msg.mediaId) {
        evictMediaFromCache('pass', msg.passToken, msg.mediaId);
      }
      setRecentPrivateMessages((prev) => prev.filter((item) => item.id !== msg.id));
      setConfirmActionKey(null);
      onNotify('success', 'تم حذف الرسالة.');
    } catch {
      onNotify('error', 'تعذر حذف الرسالة.');
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleRemovePrivateImage = async (msg: RecentPrivateMessage) => {
    if (!msg.mediaId) return;
    const key = `img-p:${msg.id}`;
    setBusyActionKey(key);
    try {
      await removeDirectStudentAlertImage(msg.passToken, msg.mediaId);
      evictMediaFromCache('pass', msg.passToken, msg.mediaId);
      setRecentPrivateMessages((prev) =>
        prev.map((item) =>
          item.id === msg.id ? { ...item, mediaId: undefined, imageCaption: undefined } : item
        )
      );
      setConfirmActionKey(null);
      onNotify('success', 'تم حذف الصورة.');
    } catch {
      onNotify('error', 'تعذر حذف الصورة.');
    } finally {
      setBusyActionKey(null);
    }
  };

  if (printPosterMode) {
    return (
      <div className="space-y-6">
        <div className="no-print bg-white border border-slate-200/80 rounded-xl p-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-bold text-slate-900">
            ملصق باركود المراحل
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPrintPosterMode(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg whitespace-nowrap"
            >
              رجوع
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-8 text-center">
          <h1 className="font-display text-2xl font-bold text-slate-900">{school.name}</h1>
          <p className="text-xs text-slate-500 mt-1 mb-8">{school.academicYear}</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STAGE_IDS.map((sid) => {
              const token = stageTokens?.[sid];
              const info = stageSummaryByStage[sid];
              return (
                <div
                  key={sid}
                  className="print-break-inside-avoid border border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center"
                >
                  <p className="font-display text-lg font-bold text-slate-900">{stageNames[sid]}</p>
                  <p className="text-xs text-slate-500 mt-1 mb-4">
                    {info.sections.map((c) => c.name).join(' · ')}
                  </p>
                  <div className="p-3 bg-white border border-slate-200 rounded-xl">
                    {token ? (
                      <QRCodeSVG value={buildStagePortalUrl(token)} size={156} level="M" />
                    ) : (
                      <div className="w-[156px] h-[156px] bg-slate-100 rounded" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Composer */}
      <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <h2 className="font-display text-base font-bold text-slate-900">
            إشعار جديد · {activeStageName}
          </h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
              <span>{stageExternalSubCount} جهاز</span>
            </span>
            {activeStageToken && (
              <button
                type="button"
                onClick={() => onPreviewStagePortal(activeStageToken)}
                className="inline-flex items-center gap-1 font-medium text-emerald-800 hover:text-emerald-950 whitespace-nowrap"
              >
                <span>معاينة</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSendBroadcast} className="pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              aria-label="جهة الاستلام"
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            >
              <optgroup label="إشعار جماعي">
                <option value="all">
                  جميع شعب {activeStageName} ({stageStudents.length})
                </option>
                {stageClassrooms.map((cls) => (
                  <option key={cls.id} value={`cls:${cls.id}`}>
                    {cls.name}
                  </option>
                ))}
              </optgroup>
              {stageStudents.length > 0 && (
                <optgroup label="رسالة خاصة لطالب">
                  {stageStudents.map((stu) => (
                    <option key={stu.id} value={`stu:${stu.id}`}>
                      {stu.fullName} — {stu.className}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
              {BROADCAST_KINDS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKind(opt.value)}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    kind === opt.value
                      ? opt.value === 'urgent'
                        ? 'bg-rose-600 text-white'
                        : 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <input
            type="text"
            required
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان الرسالة"
            className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
          />

          <textarea
            rows={3}
            required
            maxLength={500}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="نص الرسالة..."
            className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            onChange={handleSelectImageFile}
            className="hidden"
          />

          {attachedImage && (
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start gap-3">
              <img
                src={attachedImage.dataUrl}
                alt="مرفق"
                className="w-24 h-20 object-cover rounded-lg border border-slate-200 bg-white shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-600 truncate">
                    {attachedImage.fileName} · {attachedImage.sizeKb} KB
                  </span>
                  <button
                    type="button"
                    onClick={handleClearAttachedImage}
                    className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                    aria-label="إزالة"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.imageCaption}
                  value={imageCaption}
                  onChange={(e) => setImageCaption(e.target.value)}
                  placeholder="وصف مختصر للصورة (اختياري)"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              disabled={compressingImage}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <ImagePlus className="w-4 h-4 text-emerald-700" />
              <span>{compressingImage ? 'جاري التجهيز...' : attachedImage ? 'تغيير الصورة' : 'إرفاق صورة'}</span>
            </button>

            <button
              type="submit"
              disabled={sending || compressingImage}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {sending ? 'جاري الإرسال...' : isPrivateTarget ? 'إرسال خاص' : 'إرسال الإشعار'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {recentPrivateMessages.length > 0 && (
        <section className="bg-white border border-slate-200/80 rounded-xl p-5">
          <h2 className="font-display text-base font-bold text-slate-900 mb-3">
            الرسائل الخاصة
          </h2>
          <div className="divide-y divide-slate-100">
            {recentPrivateMessages.map((msg) => {
              const delKey = `del-p:${msg.id}`;
              const imgKey = `img-p:${msg.id}`;
              return (
                <div key={msg.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs mb-1">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{msg.studentName}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPreviewPass(msg.passToken)}
                        className="text-emerald-800 hover:underline"
                      >
                        البطاقة
                      </button>

                      {msg.mediaId &&
                        (confirmActionKey === imgKey ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busyActionKey === imgKey}
                              onClick={() => handleRemovePrivateImage(msg)}
                              className="px-2 py-0.5 text-[11px] font-semibold text-white bg-amber-600 rounded"
                            >
                              تأكيد حذف الصورة
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmActionKey(null)}
                              className="px-1.5 py-0.5 text-[11px] text-slate-500"
                            >
                              إلغاء
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmActionKey(imgKey)}
                            className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900"
                            title="حذف الصورة فقط"
                          >
                            <ImageOff className="w-3.5 h-3.5" />
                            <span>حذف الصورة</span>
                          </button>
                        ))}

                      {confirmActionKey === delKey ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyActionKey === delKey}
                            onClick={() => handleDeletePrivateMessage(msg)}
                            className="px-2 py-0.5 text-[11px] font-semibold text-white bg-rose-600 rounded"
                          >
                            تأكيد الحذف
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmActionKey(null)}
                            className="px-1.5 py-0.5 text-[11px] text-slate-500"
                          >
                            إلغاء
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmActionKey(delKey)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded"
                          aria-label="حذف الرسالة"
                          title="حذف الرسالة"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{msg.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{msg.body}</p>
                  {msg.mediaId && (
                    <MediaAttachmentPreview
                      scope="pass"
                      scopeToken={msg.passToken}
                      mediaId={msg.mediaId}
                      caption={msg.imageCaption}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Stage QR Codes */}
      <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 className="font-display text-base font-bold text-slate-900">باركود المراحل</h2>
          <button
            type="button"
            onClick={() => setPrintPosterMode(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>طباعة الملصق</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STAGE_IDS.map((sid) => {
            const token = stageTokens?.[sid];
            const info = stageSummaryByStage[sid];
            const isCurrent = sid === activeStageId;

            return (
              <div
                key={sid}
                className={`rounded-xl border p-4 flex flex-col items-center text-center ${
                  isCurrent ? 'border-emerald-600 bg-emerald-50/20' : 'border-slate-200/80 bg-white'
                }`}
              >
                <p className="font-display text-sm font-bold text-slate-900">{stageNames[sid]}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                  {info.sections.length} شعب · {info.studentCount} طالب
                </p>

                <div className="my-4 p-2 bg-white border border-slate-200 rounded-lg">
                  {token ? (
                    <QRCodeSVG value={buildStagePortalUrl(token)} size={120} level="M" />
                  ) : (
                    <div className="w-[120px] h-[120px] bg-slate-100 rounded animate-pulse" />
                  )}
                </div>

                <div className="w-full flex items-center gap-2 mt-auto">
                  <button
                    type="button"
                    disabled={!token}
                    onClick={() => handleCopyStageUrl(sid)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {copiedStageId === sid ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedStageId === sid ? 'نُسخ' : 'نسخ'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!token}
                    onClick={() => token && onPreviewStagePortal(token)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>فتح</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sent Broadcasts */}
      <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-display text-base font-bold text-slate-900">السجل</h2>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            {activePortal?.broadcasts?.length || 0}
          </span>
        </div>

        {!activePortal || activePortal.broadcasts.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">لا توجد إشعارات بعد</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {activePortal.broadcasts.map((item) => {
              const Icon =
                item.kind === 'urgent'
                  ? AlertTriangle
                  : item.kind === 'grades'
                    ? Award
                    : item.kind === 'attendance'
                      ? ClipboardCheck
                      : Megaphone;
              const toneClass =
                item.kind === 'urgent'
                  ? 'text-rose-700'
                  : item.kind === 'grades'
                    ? 'text-emerald-800'
                    : item.kind === 'attendance'
                      ? 'text-amber-700'
                      : 'text-slate-600';

              const delKey = `del-b:${item.id}`;
              const imgKey = `img-b:${item.id}`;

              return (
                <div key={item.id} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1">
                    <span className={`inline-flex items-center gap-1 font-semibold ${toneClass}`}>
                      <Icon className="w-3.5 h-3.5" />
                      <span>{item.targetSectionName}</span>
                    </span>

                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-slate-400">
                        {formatTime(item.createdAtIso)}
                      </span>

                      {item.imageMediaId &&
                        (confirmActionKey === imgKey ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busyActionKey === imgKey}
                              onClick={() => handleRemoveBroadcastImage(item.id)}
                              className="px-2 py-0.5 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded"
                            >
                              {busyActionKey === imgKey ? '...' : 'حذف الصورة'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmActionKey(null)}
                              className="px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-700"
                            >
                              إلغاء
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmActionKey(imgKey)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap"
                            title="حذف الصورة مع بقاء نص الإعمام"
                          >
                            <ImageOff className="w-3 h-3" />
                            <span>حذف الصورة</span>
                          </button>
                        ))}

                      {confirmActionKey === delKey ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyActionKey === delKey}
                            onClick={() => handleDeleteBroadcast(item.id)}
                            className="px-2 py-0.5 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded"
                          >
                            {busyActionKey === delKey ? '...' : 'تأكيد الحذف'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmActionKey(null)}
                            className="px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-700"
                          >
                            إلغاء
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmActionKey(delKey)}
                          aria-label="حذف الإعمام"
                          title="حذف الإعمام"
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed whitespace-pre-line">
                    {item.body}
                  </p>
                  {item.imageMediaId && activeStageToken && (
                    <MediaAttachmentPreview
                      scope="stage"
                      scopeToken={activeStageToken}
                      mediaId={item.imageMediaId}
                      caption={item.imageCaption}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
