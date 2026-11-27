import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { PushSubscriptionDoc } from '../types/wisaal';

export interface VapidKeyInfo {
  publicKey: string;
  persistentVapid: boolean;
}

const LOCAL_OS_SUB_MARKER = 'local_os_notifications';

export function getApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return configured;
}

export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${cleanPath}`;
}

function getScopedAssetUrl(relativePath: string): string {
  try {
    return new URL(relativePath, window.location.href).href;
  } catch {
    return relativePath;
  }
}

let cachedVapidInfo: VapidKeyInfo | null = null;

export function isExternalPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'Notification' in window
  );
}

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function getLocalSubStorageKey(scope: 'stage' | 'pass', scopeToken: string): string {
  return `wisaal_ext_push_${scope}_${scopeToken}`;
}

export function getSavedLocalSubId(scope: 'stage' | 'pass', scopeToken: string): string | null {
  try {
    return window.localStorage.getItem(getLocalSubStorageKey(scope, scopeToken));
  } catch {
    return null;
  }
}

function saveLocalSubId(scope: 'stage' | 'pass', scopeToken: string, subId: string | null) {
  try {
    const key = getLocalSubStorageKey(scope, scopeToken);
    if (subId) {
      window.localStorage.setItem(key, subId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors
  }
}

function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'جهاز ويب';
  const ua = navigator.userAgent;
  const os = /android/i.test(ua)
    ? 'Android'
    : /iphone|ipad|ipod/i.test(ua)
      ? 'iPhone / iPad'
      : /windows/i.test(ua)
        ? 'Windows'
        : /mac os/i.test(ua)
          ? 'macOS'
          : 'جهاز';
  const browser = /edg/i.test(ua)
    ? 'Edge'
    : /chrome|crios/i.test(ua)
      ? 'Chrome'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : 'متصفح';
  return `${os} · ${browser}`.slice(0, 60);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function computeSubDocId(endpoint: string): Promise<string> {
  const encoded = new TextEncoder().encode(endpoint);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sub_${hex.slice(0, 28)}`;
}

export async function registerWisaalServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('المتصفح لا يدعم خدمة الإشعارات.');
  }
  const existing = await navigator.serviceWorker.getRegistration('./');
  if (!existing) {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  }
  return navigator.serviceWorker.ready;
}

export async function fetchVapidPublicKey(): Promise<VapidKeyInfo> {
  if (cachedVapidInfo) return cachedVapidInfo;
  const resp = await fetch(buildApiUrl('/api/push/public-key'), { cache: 'no-store' });
  if (!resp.ok) {
    throw new Error('تعذر الاتصال بخادم الإشعارات الخارجية.');
  }
  const data = (await resp.json()) as Partial<VapidKeyInfo>;
  if (!data.publicKey || typeof data.publicKey !== 'string') {
    throw new Error('مفتاح الإشعارات الخارجية غير متوفر حالياً.');
  }
  cachedVapidInfo = {
    publicKey: data.publicKey,
    persistentVapid: Boolean(data.persistentVapid),
  };
  return cachedVapidInfo;
}

export async function showSystemNotificationViaSW(
  title: string,
  body: string,
  relativeUrl: string,
  tag?: string
): Promise<void> {
  if (!isExternalPushSupported() || Notification.permission !== 'granted') return;
  const iconUrl = getScopedAssetUrl('./pwa-192x192.png');
  const safeTarget = relativeUrl.startsWith('./') || relativeUrl.startsWith('/') ? relativeUrl : './';
  try {
    const reg = await registerWisaalServiceWorker();
    await reg.showNotification(title, {
      body,
      icon: iconUrl,
      badge: iconUrl,
      dir: 'rtl',
      lang: 'ar',
      tag: tag || `wisaal-${Date.now()}`,
      data: { url: safeTarget },
    });
  } catch {
    try {
      new Notification(title, { body, icon: iconUrl, dir: 'rtl', lang: 'ar' });
    } catch {
      // Ignore notification errors in restricted frames
    }
  }
}

export async function checkActiveExternalSubscription(
  scope: 'stage' | 'pass',
  scopeToken: string
): Promise<boolean> {
  if (!isExternalPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const savedId = getSavedLocalSubId(scope, scopeToken);
  if (!savedId) return false;
  if (savedId === LOCAL_OS_SUB_MARKER) {
    return true;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('./');
    if (!reg || !('pushManager' in reg)) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      saveLocalSubId(scope, scopeToken, null);
      return false;
    }
    const currentId = await computeSubDocId(sub.endpoint);
    return currentId === savedId;
  } catch {
    return false;
  }
}

export async function subscribeDeviceToExternalPush(params: {
  scope: 'stage' | 'pass';
  scopeToken: string;
  schoolOwnerId: string;
  sectionId?: string;
  studentId?: string;
  welcomeTitle?: string;
  welcomeBody?: string;
}): Promise<{ subId: string; mode: 'webpush' | 'local_os' }> {
  if (!isExternalPushSupported()) {
    throw new Error('متصفحك الحالي لا يدعم الإشعارات الخارجية.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('يرجى السماح بالإشعارات من إعدادات المتصفح لتلقي التنبيهات.');
  }

  const reg = await registerWisaalServiceWorker();
  const targetUrl =
    params.scope === 'stage'
      ? `./?stage=${encodeURIComponent(params.scopeToken)}`
      : `./?pass=${encodeURIComponent(params.scopeToken)}`;
  const iconUrl = getScopedAssetUrl('./pwa-192x192.png');

  // Try full background Web Push (VAPID) if backend push server is reachable
  let vapid: VapidKeyInfo | null = null;
  if ('PushManager' in window) {
    try {
      vapid = await fetchVapidPublicKey();
    } catch {
      vapid = null;
    }
  }

  if (vapid) {
    const expectedKey = urlBase64ToUint8Array(vapid.publicKey);
    let subscription = await reg.pushManager.getSubscription();

    // If an existing browser subscription was created with an older VAPID key, rotate it cleanly
    if (subscription && subscription.options?.applicationServerKey) {
      const existingKeyB64 = arrayBufferToBase64Url(subscription.options.applicationServerKey);
      const normalizedExpected = vapid.publicKey.replace(/=+$/, '');
      if (existingKeyB64 && existingKeyB64 !== normalizedExpected) {
        await subscription.unsubscribe().catch(() => undefined);
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKey,
      });
    }

    const jsonSub = subscription.toJSON();
    const endpoint = jsonSub.endpoint || subscription.endpoint;
    const p256dh = jsonSub.keys?.p256dh || '';
    const authKey = jsonSub.keys?.auth || '';

    if (!endpoint || !p256dh || !authKey) {
      throw new Error('تعذر استخراج مفاتيح الاشتراك من المتصفح.');
    }

    const subId = await computeSubDocId(endpoint);
    const parentCollection = params.scope === 'stage' ? 'stagePortals' : 'passes';
    const subRef = doc(db, parentCollection, params.scopeToken, 'pushSubscriptions', subId);
    const cleanSectionId = (params.sectionId || 'all').trim().slice(0, 128) || 'all';
    const deviceLabel = detectDeviceLabel();

    const createPayload: Record<string, unknown> = {
      schoolOwnerId: params.schoolOwnerId,
      scope: params.scope,
      sectionId: cleanSectionId,
      endpoint,
      p256dh,
      auth: authKey,
      deviceLabel,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.scope === 'pass' && params.studentId) {
      createPayload.studentId = params.studentId;
    }

    const updatePayload: Record<string, unknown> =
      params.scope === 'stage'
        ? {
            sectionId: cleanSectionId,
            p256dh,
            auth: authKey,
            deviceLabel,
            updatedAt: serverTimestamp(),
          }
        : {
            p256dh,
            auth: authKey,
            deviceLabel,
            updatedAt: serverTimestamp(),
          };

    try {
      await setDoc(subRef, createPayload);
    } catch {
      await updateDoc(subRef, updatePayload);
    }

    saveLocalSubId(params.scope, params.scopeToken, subId);

    await reg
      .showNotification(params.welcomeTitle || 'تم تفعيل الإشعارات الخارجية — وصال', {
        body:
          params.welcomeBody ||
          'ستصلك تنبيهات المدرسة فوراً على جهازك حتى عند إغلاق الموقع.',
        icon: iconUrl,
        badge: iconUrl,
        dir: 'rtl',
        lang: 'ar',
        tag: 'wisaal-welcome',
        data: { url: targetUrl },
      })
      .catch(() => undefined);

    return { subId, mode: 'webpush' };
  }

  // Static hosting fallback (e.g. GitHub Pages without external push relay):
  // Enable native Service Worker OS notifications directly so Android/Desktop alerts work cleanly
  saveLocalSubId(params.scope, params.scopeToken, LOCAL_OS_SUB_MARKER);

  await reg
    .showNotification(params.welcomeTitle || 'تم تفعيل إشعارات الجهاز — وصال', {
      body: params.welcomeBody || 'ستصلك تنبيهات المدرسة الفورية على جهازك.',
      icon: iconUrl,
      badge: iconUrl,
      dir: 'rtl',
      lang: 'ar',
      tag: 'wisaal-welcome',
      data: { url: targetUrl },
    })
    .catch(() => undefined);

  return { subId: LOCAL_OS_SUB_MARKER, mode: 'local_os' };
}

export async function updateStagePushSectionFilter(
  stageToken: string,
  sectionId: string
): Promise<void> {
  const savedSubId = getSavedLocalSubId('stage', stageToken);
  if (!savedSubId || savedSubId === LOCAL_OS_SUB_MARKER) return;
  try {
    const cleanSectionId = (sectionId || 'all').trim().slice(0, 128) || 'all';
    await updateDoc(doc(db, 'stagePortals', stageToken, 'pushSubscriptions', savedSubId), {
      sectionId: cleanSectionId,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking sync if subscription expired
  }
}

export async function unsubscribeDeviceFromExternalPush(
  scope: 'stage' | 'pass',
  scopeToken: string
): Promise<void> {
  const savedId = getSavedLocalSubId(scope, scopeToken);
  saveLocalSubId(scope, scopeToken, null);
  if (!isExternalPushSupported() || savedId === LOCAL_OS_SUB_MARKER) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('./');
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await sub.unsubscribe();
    }
  } catch {
    // Ignore unsubscribe errors
  }
}

export async function sendLocalTestExternalNotification(
  title: string,
  body: string,
  relativeUrl: string
): Promise<void> {
  if (!isExternalPushSupported() || Notification.permission !== 'granted') {
    throw new Error('يرجى تفعيل الإشعارات أولاً.');
  }
  await showSystemNotificationViaSW(title, body, relativeUrl, `wisaal-test-${Date.now()}`);
}

// --- School-Side External Push Dispatch (Authenticated via Firebase Bearer Token) ---

export interface PushDispatchResult {
  sent: number;
  attempted: number;
  serverReachable: boolean;
}

async function postPushBatchToServer(payload: {
  title: string;
  body: string;
  url: string;
  tag?: string;
  requireInteraction?: boolean;
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;
}): Promise<{ sent: number; failed: number; expiredEndpoints: string[]; serverReachable: boolean }> {
  if (payload.subscriptions.length === 0) {
    return { sent: 0, failed: 0, expiredEndpoints: [], serverReachable: true };
  }
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { sent: 0, failed: 0, expiredEndpoints: [], serverReachable: false };
  }
  try {
    const idToken = await currentUser.getIdToken();
    const BATCH_LIMIT = 500;
    let totalSent = 0;
    let totalFailed = 0;
    const allExpired: string[] = [];
    let anyReachable = false;

    for (let i = 0; i < payload.subscriptions.length; i += BATCH_LIMIT) {
      const subChunk = payload.subscriptions.slice(i, i + BATCH_LIMIT);
      const resp = await fetch(buildApiUrl('/api/push/send'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ ...payload, subscriptions: subChunk }),
      });
      if (!resp.ok) {
        totalFailed += subChunk.length;
        continue;
      }
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        totalFailed += subChunk.length;
        continue;
      }
      anyReachable = true;
      const json = (await resp.json()) as {
        sent?: number;
        failed?: number;
        expiredEndpoints?: string[];
      };
      totalSent += Number(json.sent || 0);
      totalFailed += Number(json.failed || 0);
      if (Array.isArray(json.expiredEndpoints)) {
        allExpired.push(...json.expiredEndpoints);
      }
    }

    return {
      sent: totalSent,
      failed: totalFailed,
      expiredEndpoints: allExpired,
      serverReachable: anyReachable,
    };
  } catch {
    return {
      sent: 0,
      failed: payload.subscriptions.length,
      expiredEndpoints: [],
      serverReachable: false,
    };
  }
}

async function loadSubscriptionsForParent(
  uid: string,
  parentCollection: 'stagePortals' | 'passes',
  scopeToken: string
): Promise<Array<PushSubscriptionDoc & { parentCollection: 'stagePortals' | 'passes'; scopeToken: string }>> {
  if (!scopeToken) return [];
  try {
    const q = query(
      collection(db, parentCollection, scopeToken, 'pushSubscriptions'),
      where('schoolOwnerId', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      parentCollection,
      scopeToken,
      ...(d.data() as Omit<PushSubscriptionDoc, 'id'>),
    }));
  } catch {
    return [];
  }
}

async function cleanupExpiredSubscriptions(
  records: Array<{ id: string; endpoint: string; parentCollection: 'stagePortals' | 'passes'; scopeToken: string }>,
  expiredEndpoints: string[]
): Promise<void> {
  if (expiredEndpoints.length === 0) return;
  const expiredSet = new Set(expiredEndpoints);
  const toDelete = records.filter((r) => expiredSet.has(r.endpoint));
  await Promise.allSettled(
    toDelete.map((r) =>
      deleteDoc(doc(db, r.parentCollection, r.scopeToken, 'pushSubscriptions', r.id))
    )
  );
}

export async function dispatchExternalPushForStageBroadcast(params: {
  uid: string;
  stageToken: string;
  targetClassId: string;
  targetedPassTokens: string[];
  title: string;
  body: string;
  tag: string;
  requireInteraction?: boolean;
}): Promise<PushDispatchResult> {
  try {
    const stageSubs = await loadSubscriptionsForParent(params.uid, 'stagePortals', params.stageToken);
    const matchingStageSubs = stageSubs.filter(
      (sub) =>
        params.targetClassId === 'all' ||
        sub.sectionId === 'all' ||
        sub.sectionId === params.targetClassId
    );

    const passSubs: Array<PushSubscriptionDoc & { parentCollection: 'stagePortals' | 'passes'; scopeToken: string }> = [];
    const TOKEN_CHUNK = 25;
    for (let i = 0; i < params.targetedPassTokens.length; i += TOKEN_CHUNK) {
      const chunk = params.targetedPassTokens.slice(i, i + TOKEN_CHUNK);
      const chunkArrays = await Promise.all(
        chunk.map((pt) => loadSubscriptionsForParent(params.uid, 'passes', pt))
      );
      for (const arr of chunkArrays) {
        passSubs.push(...arr);
      }
    }

    const allRecords = [...matchingStageSubs, ...passSubs];
    if (allRecords.length === 0) {
      return { sent: 0, attempted: 0, serverReachable: true };
    }

    const seen = new Set<string>();
    const uniqueSubs: Array<{ endpoint: string; p256dh: string; auth: string }> = [];
    for (const r of allRecords) {
      if (seen.has(r.endpoint)) continue;
      seen.add(r.endpoint);
      uniqueSubs.push({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth });
    }

    const res = await postPushBatchToServer({
      title: params.title,
      body: params.body,
      url: `/?stage=${encodeURIComponent(params.stageToken)}`,
      tag: params.tag,
      requireInteraction: params.requireInteraction,
      subscriptions: uniqueSubs,
    });

    await cleanupExpiredSubscriptions(allRecords, res.expiredEndpoints);
    return {
      sent: res.sent,
      attempted: uniqueSubs.length,
      serverReachable: res.serverReachable,
    };
  } catch {
    return { sent: 0, attempted: 0, serverReachable: false };
  }
}

export async function dispatchExternalPushForStudentPass(params: {
  uid: string;
  passToken: string;
  title: string;
  body: string;
  tag: string;
  requireInteraction?: boolean;
}): Promise<PushDispatchResult> {
  try {
    const passSubs = await loadSubscriptionsForParent(params.uid, 'passes', params.passToken);
    if (passSubs.length === 0) {
      return { sent: 0, attempted: 0, serverReachable: true };
    }

    const res = await postPushBatchToServer({
      title: params.title,
      body: params.body,
      url: `/?pass=${encodeURIComponent(params.passToken)}`,
      tag: params.tag,
      requireInteraction: params.requireInteraction,
      subscriptions: passSubs.map((s) => ({
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
      })),
    });

    await cleanupExpiredSubscriptions(passSubs, res.expiredEndpoints);
    return {
      sent: res.sent,
      attempted: passSubs.length,
      serverReachable: res.serverReachable,
    };
  } catch {
    return { sent: 0, attempted: 0, serverReachable: false };
  }
}
