import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import * as webpushModule from 'web-push';

const webpush =
  (webpushModule as unknown as { default?: typeof webpushModule }).default ?? webpushModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64_LENGTH = 9_500_000; // ~7MB binary image
const MAX_PUSH_RECIPIENTS = 200;

// Web Push VAPID setup: prefer configured server-side env secrets; fall back safely to ephemeral keys
const envVapidPublic = (process.env.VAPID_PUBLIC_KEY || '').trim();
const envVapidPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim();
const rawSubject = (process.env.VAPID_SUBJECT || 'mailto:notifications@wisaal.app').trim();
const vapidSubject =
  rawSubject.startsWith('mailto:') || rawSubject.startsWith('https://')
    ? rawSubject
    : 'mailto:notifications@wisaal.app';

let hasPersistentVapid = Boolean(envVapidPublic && envVapidPrivate);
let activeVapidKeys = hasPersistentVapid
  ? { publicKey: envVapidPublic, privateKey: envVapidPrivate }
  : webpush.generateVAPIDKeys();

try {
  webpush.setVapidDetails(vapidSubject, activeVapidKeys.publicKey, activeVapidKeys.privateKey);
} catch (err) {
  console.warn('Invalid VAPID configuration in environment; falling back to ephemeral VAPID keys:', err);
  hasPersistentVapid = false;
  activeVapidKeys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails('mailto:notifications@wisaal.app', activeVapidKeys.publicKey, activeVapidKeys.privateKey);
}

const ALLOWED_PUSH_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
]);

function isAllowedPushEndpoint(rawEndpoint: string): boolean {
  if (typeof rawEndpoint !== 'string' || rawEndpoint.length < 24 || rawEndpoint.length > 1000) {
    return false;
  }
  try {
    const parsed = new URL(rawEndpoint);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password || parsed.port) return false;
    const host = parsed.hostname.toLowerCase();
    // Block loopback, IP literals, and private network hostnames
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.includes(':')
    ) {
      return false;
    }
    if (ALLOWED_PUSH_EXACT_HOSTS.has(host)) return true;
    if (/^[a-z0-9-]+\.push\.apple\.com$/.test(host)) return true;
    if (/^[a-z0-9-]+\.notify\.windows\.com$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

const BASE64_KEY_REGEX = /^[A-Za-z0-9_\-+/=]+$/;
const SAFE_RELATIVE_URL_REGEX = /^\/(\?(stage|pass)=[a-zA-Z0-9_\-]+)?$/;

interface FirebaseAppletConfig {
  apiKey?: string;
  projectId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

const firebaseCfg = loadFirebaseConfig();

async function verifyFirebaseBearerToken(req: Request): Promise<{ uid: string; email: string } | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken || idToken.length > 4096) return null;

  const apiKey = firebaseCfg.apiKey;
  if (!apiKey) return null;

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId || !user.emailVerified) return null;
    return { uid: user.localId, email: user.email || '' };
  } catch {
    return null;
  }
}

interface SectionStudentInput {
  id: string;
  fullName: string;
  studentCode: string;
}

interface ExtractedGradeRow {
  extractedName: string;
  matchedStudentId: string;
  score: number | null;
  note: string;
  confidence: 'high' | 'medium' | 'low';
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.post('/api/extract-grades', async (req: Request, res: Response) => {
    // 1. Verify authenticated Firebase user
    const caller = await verifyFirebaseBearerToken(req);
    if (!caller) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول بحساب إدارة موثق قبل تحليل صور الكشوف.' });
      return;
    }

    // 2. Validate inputs strictly
    const body = req.body as {
      imageBase64?: unknown;
      mimeType?: unknown;
      subject?: unknown;
      maxScore?: unknown;
      sectionStudents?: unknown;
    };

    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length < 32 || body.imageBase64.length > MAX_BASE64_LENGTH) {
      res.status(400).json({ error: 'الصورة المرفوعة غير صالحة أو يتجاوز حجمها الحد المسموح.' });
      return;
    }

    if (typeof body.mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(body.mimeType)) {
      res.status(400).json({ error: 'صيغة الصورة غير مدعومة. يرجى رفع صورة JPG أو PNG أو WebP.' });
      return;
    }

    const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 80) : '';
    const maxScoreNum = typeof body.maxScore === 'number' && Number.isFinite(body.maxScore)
      ? Math.max(1, Math.min(1000, body.maxScore))
      : 100;

    const rawStudents = Array.isArray(body.sectionStudents) ? body.sectionStudents.slice(0, 80) : [];
    const sectionStudents: SectionStudentInput[] = rawStudents
      .filter(
        (s): s is SectionStudentInput =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as SectionStudentInput).id === 'string' &&
          typeof (s as SectionStudentInput).fullName === 'string'
      )
      .map((s) => ({
        id: s.id.slice(0, 128),
        fullName: s.fullName.trim().slice(0, 100),
        studentCode: typeof s.studentCode === 'string' ? s.studentCode.trim().slice(0, 32) : '',
      }));

    const validStudentIds = new Set(sectionStudents.map((s) => s.id));

    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'خدمة تحليل الصور غير مفعّلة حالياً على الخادم. يرجى التأكد من إعداد مفتاح Gemini في الإعدادات.',
      });
      return;
    }

    try {
      const rosterLines = sectionStudents
        .map((s, idx) => `${idx + 1}. id="${s.id}" | name="${s.fullName}" | code="${s.studentCode}"`)
        .join('\n');

      const promptText = [
        'أنت خبير دقيق في قراءة كشوف الدرجات المدرسية العربية (المطبوعة أو المكتوبة بخط اليد).',
        'استخرج أسماء جميع الطلاب ودرجاتهم من صورة كشف الدرجات المرفقة.',
        `المادة المتوقعة: ${subject || 'غير محددة'} — الدرجة العظمى المتوقعة: ${maxScoreNum}.`,
        'إذا ظهرت المادة أو الدرجة العظمى بوضوح في ترويسة الورقة فأعدها في detectedSubject و detectedMaxScore.',
        'قائمة طلاب الشعبة المسجلين في النظام:',
        rosterLines || '(لا يوجد طلاب مسجلون حالياً)',
        'التعليمات الصارمة:',
        '1. حوّل جميع الأرقام العربية الشرقية (٠١٢٣٤٥٦٧٨٩) إلى أرقام رقمية قياسية (0-9).',
        '2. طابق كل اسم مستخرج من الصورة مع أقرب طالب في قائمة الشعبة وأعد معرّفه الدقيق في matchedStudentId، وإذا لم يطابق أياً منهم فأعد سلسلة فارغة "".',
        '3. إذا كانت الدرجة مكتوبة ككسر مثل 18/20 فاستخرج البسط (18) كقيمة score.',
        '4. إذا كُتب أمام الطالب غائب أو لم يمتحن فاجعل score يساوي null واكتب "غائب عن الاختبار" في note.',
        '5. حدد مستوى الثقة confidence بـ high أو medium أو low.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: body.mimeType,
                data: body.imageBase64,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedSubject: {
                type: Type.STRING,
                description: 'Subject name if written in sheet header, otherwise empty string.',
              },
              detectedMaxScore: {
                type: Type.NUMBER,
                description: 'Max score if explicitly visible on sheet, otherwise 0.',
              },
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    extractedName: { type: Type.STRING },
                    matchedStudentId: { type: Type.STRING },
                    score: { type: Type.NUMBER, nullable: true },
                    note: { type: Type.STRING },
                    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
                  },
                  required: ['extractedName', 'matchedStudentId', 'note', 'confidence'],
                },
              },
            },
            required: ['detectedSubject', 'detectedMaxScore', 'rows'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        detectedSubject?: unknown;
        detectedMaxScore?: unknown;
        rows?: unknown[];
      };

      const cleanRows: ExtractedGradeRow[] = Array.isArray(parsed.rows)
        ? parsed.rows.slice(0, 80).map((item) => {
            const r = item as Record<string, unknown>;
            const rawId = typeof r.matchedStudentId === 'string' ? r.matchedStudentId.trim() : '';
            const rawScore = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null;
            const conf =
              r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
                ? r.confidence
                : 'medium';
            return {
              extractedName: typeof r.extractedName === 'string' ? r.extractedName.trim().slice(0, 100) : '',
              matchedStudentId: validStudentIds.has(rawId) ? rawId : '',
              score: rawScore !== null ? Math.max(0, Math.min(1000, Math.round(rawScore * 10) / 10)) : null,
              note: typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '',
              confidence: conf,
            };
          })
        : [];

      res.json({
        detectedSubject:
          typeof parsed.detectedSubject === 'string' ? parsed.detectedSubject.trim().slice(0, 80) : '',
        detectedMaxScore:
          typeof parsed.detectedMaxScore === 'number' && parsed.detectedMaxScore >= 1 && parsed.detectedMaxScore <= 1000
            ? parsed.detectedMaxScore
            : 0,
        rows: cleanRows,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Extract grades error:', errMsg);
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'تم تجاوز حد الطلبات المؤقت لخدمة قراءة الصور. يرجى المحاولة بعد قليل.',
        });
        return;
      }
      if (errMsg.includes('403') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('400')) {
        res.status(400).json({
          error: 'تعذر قراءة الصورة عبر خدمة التحليل. يرجى التحقق من جودة الصورة أو مفتاح API في الإعدادات.',
        });
        return;
      }
      res.status(500).json({ error: 'حدث خطأ أثناء قراءة صورة كشف الدرجات. حاول بصورة أوضح.' });
    }
  });

  // Public VAPID key for parent browsers to subscribe to external OS Web Push notifications
  app.get('/api/push/public-key', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      publicKey: activeVapidKeys.publicKey,
      persistentVapid: hasPersistentVapid,
    });
  });

  // Authenticated school-only Web Push external notification relay
  app.post('/api/push/send', async (req: Request, res: Response) => {
    const caller = await verifyFirebaseBearerToken(req);
    if (!caller) {
      res.status(401).json({ error: 'يجب تسجيل الدخول بحساب مدرسة موثق لإرسال الإشعارات الخارجية.' });
      return;
    }

    const body = req.body as {
      title?: unknown;
      body?: unknown;
      url?: unknown;
      tag?: unknown;
      requireInteraction?: unknown;
      subscriptions?: unknown;
    };

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const messageBody = typeof body.body === 'string' ? body.body.trim().slice(0, 500) : '';
    if (!title || !messageBody) {
      res.status(400).json({ error: 'عنوان الإشعار ونص الرسالة مطلوبان.' });
      return;
    }

    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '/';
    const safeUrl = SAFE_RELATIVE_URL_REGEX.test(rawUrl) ? rawUrl : '/';
    const rawTag = typeof body.tag === 'string' ? body.tag.trim().slice(0, 64) : 'wisaal-alert';
    const safeTag = /^[a-zA-Z0-9_\-]+$/.test(rawTag) ? rawTag : 'wisaal-alert';
    const requireInteraction = Boolean(body.requireInteraction);

    if (!Array.isArray(body.subscriptions) || body.subscriptions.length === 0) {
      res.json({ sent: 0, failed: 0, expiredEndpoints: [] });
      return;
    }

    const validSubs: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = [];
    const seenEndpoints = new Set<string>();

    for (const raw of body.subscriptions.slice(0, MAX_PUSH_RECIPIENTS)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { endpoint?: unknown; p256dh?: unknown; auth?: unknown };
      if (
        typeof item.endpoint !== 'string' ||
        typeof item.p256dh !== 'string' ||
        typeof item.auth !== 'string'
      ) {
        continue;
      }
      if (!isAllowedPushEndpoint(item.endpoint)) continue;
      if (
        item.p256dh.length < 16 ||
        item.p256dh.length > 200 ||
        !BASE64_KEY_REGEX.test(item.p256dh)
      ) {
        continue;
      }
      if (item.auth.length < 8 || item.auth.length > 100 || !BASE64_KEY_REGEX.test(item.auth)) {
        continue;
      }
      if (seenEndpoints.has(item.endpoint)) continue;
      seenEndpoints.add(item.endpoint);
      validSubs.push({
        endpoint: item.endpoint,
        keys: { p256dh: item.p256dh, auth: item.auth },
      });
    }

    if (validSubs.length === 0) {
      res.json({ sent: 0, failed: 0, expiredEndpoints: [] });
      return;
    }

    const payloadJson = JSON.stringify({
      title,
      body: messageBody,
      url: safeUrl,
      tag: safeTag,
      requireInteraction,
    });

    let sent = 0;
    let failed = 0;
    const expiredEndpoints: string[] = [];

    const CHUNK_SIZE = 20;
    for (let i = 0; i < validSubs.length; i += CHUNK_SIZE) {
      const chunk = validSubs.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((sub) =>
          webpush.sendNotification(sub, payloadJson, {
            TTL: 86400,
            urgency: requireInteraction ? 'high' : 'normal',
          })
        )
      );

      results.forEach((outcome, idx) => {
        if (outcome.status === 'fulfilled') {
          sent += 1;
        } else {
          failed += 1;
          const errObj = outcome.reason as { statusCode?: number } | undefined;
          if (errObj?.statusCode === 404 || errObj?.statusCode === 410) {
            expiredEndpoints.push(chunk[idx].endpoint);
          }
        }
      });
    }

    res.json({ sent, failed, expiredEndpoints });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Wisaal server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
