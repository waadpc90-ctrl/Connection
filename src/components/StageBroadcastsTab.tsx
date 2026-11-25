import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  Award,
  BellRing,
  Check,
  ClipboardCheck,
  Copy,
  ExternalLink,
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
import { MediaAttachmentPreview } from './MediaAttachmentPreview';

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
  { value: 'announcement', label: 'إعلان جماعي' },
  { value: 'urgent', label: 'تنبيه عاجل' },
  { value: 'grades', label: 'إشعار درجات' },
  { value: 'attendance', label: 'إشعار حضور وغياب' },
];

const QUICK_TEMPLATES: {
  label: string;
  kind: StageBroadcastKind;
  title: string;
  body: string;
}[] = [
  {
    label: 'اجتماع أولياء الأمور',
    kind: 'announcement',
    title: 'دعوة لحضور اجتماع أولياء الأمور',
    body: 'أولياء الأمور الكرام، يسعدنا حضوركم لقاء المتابعة الدوري لمناقشة المستوى الدراسي والانضباط لجميع شعب المرحلة.',
  },
  {
    label: 'صدور خلاصة الدرجات',
    kind: 'grades',
    title: 'تم تحديث خلاصة الدرجات لجميع المواد',
    body: 'تم رصد درجات المواد وتجميعها تلقائياً في بطاقة كل طالب. يرجى الاطلاع على البطاقة الحية لمتابعة مستوى ابنكم.',
  },
  {
    label: 'تذكير جدول الاختبارات',
    kind: 'urgent',
    title: 'تذكير هام بموعد الاختبارات الشهرية',
    body: 'يرجى متابعة استعداد الطلاب للاختبارات القادمة والالتزام بالحضور المبكر قبل بدء الطابور الصباحي.',
  },
  {
    label: 'تنبيه انضباط الحضور',
    kind: 'attendance',
    title: 'تنبيه حول انتظام الحضور الصباحي',
    body: 'نأمل من أولياء الأمور التأكيد على حضور الطلاب في الموعد المحدد وتقديم العذر إلكترونياً عبر البطاقة الحية عند الضرورة.',
  },
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stageNames = useMemo(() => getSchoolStageNames(school), [school]);
  const stageTokens = school.stageTokens;
  const activeStageToken = stageTokens?.[activeStageId] || '';

  // Reset target selector when switching stage
  useEffect(() => {
    setTargetValue('all');
  }, [activeStageId]);

  // Listen to active stage portal & its external Web Push subscribers in real time
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
      (snap) => {
        setStageExternalSubCount(snap.size);
      },
      () => {
        setStageExternalSubCount(0);
      }
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
    const stuId = targetValue.slice(4);
    return stageStudents.find((s) => s.id === stuId) || null;
  }, [isPrivateTarget, targetValue, stageStudents]);

  const selectedClassId = useMemo(() => {
    if (targetValue.startsWith('cls:')) return targetValue.slice(4);
    return 'all';
  }, [targetValue]);

  const targetedStudentsCount = useMemo(() => {
    if (isPrivateTarget) return selectedStudent ? 1 : 0;
    if (selectedClassId === 'all') return stageStudents.length;
    return stageStudents.filter((s) => s.classId === selectedClassId).length;
  }, [isPrivateTarget, selectedStudent, selectedClassId, stageStudents]);

  const handleCopyStageUrl = async (sid: StageId) => {
    const token = stageTokens?.[sid];
    if (!token) return;
    try {
      await navigator.clipboard.writeText(buildStagePortalUrl(token));
      setCopiedStageId(sid);
      onNotify('success', `تم نسخ رابط بوابة ${stageNames[sid]} بنجاح.`);
      setTimeout(() => setCopiedStageId((prev) => (prev === sid ? null : prev)), 2000);
    } catch {
      onNotify('error', 'تعذر نسخ الرابط.');
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
      const msg = err instanceof Error ? err.message : 'تعذر تجهيز الصورة المرفقة.';
      onNotify('error', msg);
    } finally {
      setCompressingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClearAttachedImage = () => {
    setAttachedImage(null);
    setImageCaption('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      onNotify('error', 'يرجى كتابة عنوان الإشعار ونص الرسالة.');
      return;
    }

    setSending(true);
    try {
      if (isPrivateTarget) {
        if (!selectedStudent) {
          onNotify('error', 'يرجى اختيار الطالب المستهدف أولاً.');
          return;
        }
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
        onNotify(
          'success',
          `تم إرسال الرسالة الخاصة${res.mediaId ? ' والصورة المرفقة' : ''} إلى بطاقة ${selectedStudent.fullName}${res.externalPushSent > 0 ? ` مع إشعار خارجي لـ ${res.externalPushSent} جهاز` : ''}.`
        );
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
          `تم إرسال الإشعار الفوري${result.broadcast.imageMediaId ? ' والصورة المرفقة' : ''} إلى ${result.affectedSectionsCount} شعب و${result.affectedStudentsCount} بطاقة طالب${result.externalPushSent > 0 ? ` · وصل كإشعار خارجي إلى ${result.externalPushSent} جهاز` : ''}.`
        );
      }
    } catch {
      onNotify('error', 'تعذر إرسال الإشعار الفوري. حاول مجدداً.');
    } finally {
      setSending(false);
    }
  };

  // Dedicated Printable 3-Stage QR Poster Sheet
  if (printPosterMode) {
    return (
      <div className="space-y-6">
        <div className="no-print bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              ملصق باركود المراحل الدراسية الثلاث — جاهز للطباعة والتعليق
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              يمسح ولي الأمر باركود مرحلة ابنه مرة واحدة ليصله كل إشعار جماعي للشعب عبر الموقع فوراً
              بدون واتساب.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPrintPosterMode(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap"
            >
              العودة للوحة
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة الملصق الآن</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-xs font-semibold text-emerald-800">{school.academicYear}</p>
          <h1 className="font-display text-2xl font-bold text-slate-900 mt-1">{school.name}</h1>
          <p className="text-sm text-slate-600 mt-1 mb-8">
            امسح باركود مرحلة ابنك بكاميرا الجوال لاستلام جميع التبليغات والإشعارات الفورية عبر
            الموقع مباشرة
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STAGE_IDS.map((sid) => {
              const token = stageTokens?.[sid];
              const info = stageSummaryByStage[sid];
              return (
                <div
                  key={sid}
                  className="print-break-inside-avoid border border-dashed border-slate-400 rounded-xl p-6 flex flex-col items-center text-center"
                >
                  <p className="font-display text-lg font-bold text-slate-900">{stageNames[sid]}</p>
                  <p className="text-xs text-slate-500 mt-1 mb-4">
                    {info.sections.length > 0
                      ? info.sections.map((c) => c.name).join(' · ')
                      : 'جميع شعب المرحلة'}
                  </p>
                  <div className="p-3 bg-white border border-slate-200 rounded-xl mb-4">
                    {token ? (
                      <QRCodeSVG value={buildStagePortalUrl(token)} size={156} level="M" />
                    ) : (
                      <div className="w-[156px] h-[156px] bg-slate-100 rounded" />
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    إشعارات فورية لجميع شعب {stageNames[sid]} عبر موقع المدرسة بدون تسجيل دخول.
                  </p>
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
      {/* 1. Collective & Private Instant In-Website Message + Image Composer */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-emerald-700 shrink-0" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                إرسال رسالة وصورة فورية لأولياء الأمور — {activeStageName}
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              أرسل تبليغاً نصياً مع إمكانية إرفاق صورة (جدول، تعميم، ورقة اختبار، نشاط) لجميع شعب{' '}
              {activeStageName} أو لشعبة محددة أو لولي أمر طالب محدد بشكل خاص.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap">
              <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
              <span>
                أجهزة الإشعارات الخارجية:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {stageExternalSubCount}
                </strong>
              </span>
            </span>

            {activeStageToken && (
              <button
                type="button"
                onClick={() => onPreviewStagePortal(activeStageToken)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>معاينة بوابة {activeStageName}</span>
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSendBroadcast} className="pt-5 space-y-4">
          {/* Quick Templates */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 ml-1">قوالب سريعة:</span>
            {QUICK_TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() => {
                  setKind(tpl.kind);
                  setTitle(tpl.title);
                  setBody(tpl.body);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                جهة الاستلام في {activeStageName}
              </label>
              <select
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
              >
                <optgroup label="تبليغ جماعي (بوابة باركود المرحلة + بطاقات الطلاب)">
                  <option value="all">
                    جميع شعب {activeStageName} ({stageClassrooms.length} شعب · {stageStudents.length}{' '}
                    طالب)
                  </option>
                  {stageClassrooms.map((cls) => {
                    const cnt = stageStudents.filter((s) => s.classId === cls.id).length;
                    return (
                      <option key={cls.id} value={`cls:${cls.id}`}>
                        {cls.name} فقط ({cnt} طالب)
                      </option>
                    );
                  })}
                </optgroup>
                {stageStudents.length > 0 && (
                  <optgroup label="رسالة خاصة لولي أمر طالب محدد (تظهر في بطاقته فقط)">
                    {stageStudents.map((stu) => (
                      <option key={stu.id} value={`stu:${stu.id}`}>
                        خاص: {stu.fullName} — {stu.className}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">نوع الإشعار</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {BROADCAST_KINDS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setKind(opt.value)}
                    className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      kind === opt.value
                        ? opt.value === 'urgent'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isPrivateTarget && selectedStudent && (
            <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-950 flex items-center gap-2.5">
              <UserCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                وضع الرسالة الخاصة: ستصل هذه الرسالة والصورة المرفقة حصرياً إلى البطاقة الخاصة
                بولي أمر <strong>{selectedStudent.fullName}</strong> ({selectedStudent.className}) ولن
                تظهر للعموم في بوابة باركود المرحلة.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">عنوان الإشعار</label>
            <input
              type="text"
              required
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                isPrivateTarget && selectedStudent
                  ? `مثال: ملاحظة أو صورة ورقة اختبار لولي أمر ${selectedStudent.fullName}`
                  : `مثال: تعميم أو جدول اختبارات لجميع شعب ${activeStageName}`
              }
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              نص الرسالة لأولياء الأمور
            </label>
            <textarea
              rows={3}
              required
              maxLength={500}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="اكتب تفاصيل الرسالة ليصل الإشعار الفوري مباشرة عبر الموقع..."
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          {/* Optional Image Attachment Picker */}
          <div className="pt-1">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              إرفاق صورة مع الرسالة (اختياري)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              onChange={handleSelectImageFile}
              className="hidden"
            />

            {!attachedImage ? (
              <button
                type="button"
                disabled={compressingImage}
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-lg transition-colors disabled:opacity-60"
              >
                <ImagePlus className="w-4 h-4 text-emerald-700" />
                <span>
                  {compressingImage
                    ? 'جاري ضغط وتجهيز الصورة...'
                    : 'اختر صورة لإرفاقها (تعميم، جدول، ورقة اختبار، نشاط)'}
                </span>
              </button>
            ) : (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-start gap-4">
                <img
                  src={attachedImage.dataUrl}
                  alt="معاينة الصورة المرفقة"
                  className="w-full sm:w-36 h-28 object-cover rounded-lg border border-slate-200 bg-white shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {attachedImage.fileName}
                      </p>
                      <p className="text-[11px] text-emerald-800 font-mono tabular-nums mt-0.5">
                        جاهزة للإرسال الفوري · {attachedImage.sizeKb} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearAttachedImage}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>إزالة</span>
                    </button>
                  </div>

                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.imageCaption}
                    value={imageCaption}
                    onChange={(e) => setImageCaption(e.target.value)}
                    placeholder="تعليق مختصر على الصورة (اختياري)..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              {isPrivateTarget && selectedStudent ? (
                <>
                  سيصل فوراً كرسالة خاصة إلى بطاقة ولي أمر{' '}
                  <span className="font-semibold text-slate-800">{selectedStudent.fullName}</span>
                  {attachedImage ? ' (مع الصورة المرفقة)' : ''}
                </>
              ) : (
                <>
                  سيتم البث الفوري عبر الموقع إلى{' '}
                  <span className="font-semibold text-slate-800">
                    {selectedClassId === 'all'
                      ? `جميع شعب ${activeStageName}`
                      : stageClassrooms.find((c) => c.id === selectedClassId)?.name || 'الشعبة'}
                  </span>{' '}
                  (<span className="font-mono tabular-nums">{targetedStudentsCount}</span> بطاقة طالب
                  + بوابة الباركود{attachedImage ? ' + الصورة المرفقة' : ''})
                </>
              )}
            </p>

            <button
              type="submit"
              disabled={sending || compressingImage}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>
                {sending
                  ? 'جاري الإرسال الفوري...'
                  : isPrivateTarget
                    ? 'إرسال رسالة خاصة لولي الأمر'
                    : 'إرسال إشعار فوري عبر الموقع'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {recentPrivateMessages.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                الرسائل الخاصة المرسلة مؤخراً في هذه الجلسة
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ظاهرة لولي أمر الطالب المستهدف فقط عبر بطاقته الحية.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {recentPrivateMessages.length} رسالة
            </span>
          </div>

          <div className="divide-y divide-slate-200">
            {recentPrivateMessages.map((msg) => (
              <div key={msg.id} className="py-3.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{msg.studentName}</span>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">{msg.className}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPreviewPass(msg.passToken)}
                    className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:text-emerald-950"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>معاينة بطاقة الطالب</span>
                  </button>
                </div>
                <p className="text-sm font-semibold text-slate-900">{msg.title}</p>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{msg.body}</p>
                {msg.mediaId && (
                  <MediaAttachmentPreview
                    scope="pass"
                    scopeToken={msg.passToken}
                    mediaId={msg.mediaId}
                    caption={msg.imageCaption}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. The 3 Stage QR Codes (One Barcode per Stage) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              باركود المراحل الدراسية الثلاث
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              وزّع باركود كل مرحلة على أولياء أمورها؛ كل مرحلة لها بوابة إشعارات مستقلة تماماً عن
              باقي المراحل.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPrintPosterMode(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة ملصق باركود المراحل الثلاث</span>
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
                className={`rounded-xl border p-5 flex flex-col items-center text-center transition-colors ${
                  isCurrent ? 'border-emerald-600 bg-emerald-50/25' : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-display text-base font-bold text-slate-900">{stageNames[sid]}</p>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {info.sections.length} شعب · {info.studentCount} طالب
                </p>

                <div className="my-4 p-2.5 bg-white border border-slate-200 rounded-xl">
                  {token ? (
                    <QRCodeSVG value={buildStagePortalUrl(token)} size={136} level="M" />
                  ) : (
                    <div className="w-[136px] h-[136px] bg-slate-100 rounded animate-pulse" />
                  )}
                </div>

                {info.sections.length > 0 && (
                  <p className="text-[11px] text-slate-600 mb-4 truncate max-w-full">
                    الشعب: {info.sections.map((s) => s.name).join(' · ')}
                  </p>
                )}

                <div className="w-full flex items-center justify-center gap-2 mt-auto">
                  <button
                    type="button"
                    disabled={!token}
                    onClick={() => handleCopyStageUrl(sid)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {copiedStageId === sid ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedStageId === sid ? 'تم النسخ' : 'نسخ الرابط'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!token}
                    onClick={() => token && onPreviewStagePortal(token)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>معاينة حية</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Live Published Broadcasts Feed for Active Stage */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              سجل الإشعارات المرسلة عبر الموقع — {activeStageName}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              يشمل التبليغات الجماعية وإشعارات نشر الدرجات والحضور التلقائية لهذه المرحلة فقط.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
            {activePortal?.broadcasts?.length || 0} إشعار
          </span>
        </div>

        {!activePortal || activePortal.broadcasts.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
            لم تُرسل إشعارات جماعية لـ {activeStageName} بعد. أرسل أول إشعار من النموذج أعلاه.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
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
                      : 'text-slate-700';

              return (
                <div key={item.id} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 font-semibold ${toneClass}`}>
                        <Icon className="w-3.5 h-3.5" />
                        <span>{item.targetSectionName}</span>
                      </span>
                      {item.subject && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-600">{item.subject}</span>
                        </>
                      )}
                    </div>
                    <span className="font-mono tabular-nums text-slate-500">
                      {formatTime(item.createdAtIso)}
                    </span>
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
