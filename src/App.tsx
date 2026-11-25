import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { DEMO_PARENT_PASS, DEMO_STAGE_PORTAL } from './data/demoPassData';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingView } from './components/LandingView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ParentPassView } from './components/ParentPassView';
import { SchoolDashboard } from './components/SchoolDashboard';
import { StagePortalView } from './components/StagePortalView';
import { Toast, ToastState } from './components/Toast';
import { registerWisaalServiceWorker } from './lib/pushNotifications';

function readTokenFromUrl(paramName: 'pass' | 'stage'): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get(paramName);
  if (token && /^[a-zA-Z0-9_\-]{16,64}$/.test(token)) {
    return token;
  }
  return null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Direct parent pass (?pass=...) or collective stage QR portal (?stage=...)
  const [urlPassToken, setUrlPassToken] = useState<string | null>(() => readTokenFromUrl('pass'));
  const [urlStageToken, setUrlStageToken] = useState<string | null>(() =>
    readTokenFromUrl('stage')
  );
  const [previewPassToken, setPreviewPassToken] = useState<string | null>(null);
  const [previewStageToken, setPreviewStageToken] = useState<string | null>(null);
  const [previewDemoPass, setPreviewDemoPass] = useState<boolean>(false);
  const [previewDemoStage, setPreviewDemoStage] = useState<boolean>(false);

  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((kind: 'success' | 'error', message: string) => {
    const id = Date.now();
    setToast({ id, kind, message });
    window.setTimeout(() => {
      setToast((prev) => (prev && prev.id === id ? null : prev));
    }, 3800);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Register Service Worker early so external Web Push & PWA installability are immediately ready
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      registerWisaalServiceWorker().catch(() => {
        // Non-blocking if running inside a restricted preview frame
      });
    }
  }, []);

  useEffect(() => {
    const handlePop = () => {
      setUrlPassToken(readTokenFromUrl('pass'));
      setUrlStageToken(readTokenFromUrl('stage'));
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      notify('success', 'تم تسجيل الدخول بنجاح.');
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const msg = err instanceof Error ? err.message : '';
      if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
        // User intentionally dismissed the Google sign-in window
      } else if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        setAuthError(
          `هذا النطاق (${window.location.hostname}) غير مضاف بعد في النطاقات المصرح بها في Firebase Authentication. أضفه من إعدادات Firebase ثم أعد المحاولة.`
        );
      } else if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
        setAuthError(
          'قام المتصفح بحظر نافذة تسجيل الدخول المنبثقة. اسمح بالنوافذ المنبثقة لهذا الموقع من إعدادات المتصفح ثم أعد المحاولة.'
        );
      } else if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
        setAuthError('تعذر الاتصال بخادم المصادقة. تحقق من اتصال الإنترنت ثم أعد المحاولة.');
      } else {
        setAuthError(
          'تعذر إتمام تسجيل الدخول عبر Google. تأكد من السماح بالنوافذ المنبثقة وتصريح النطاق في Firebase ثم أعد المحاولة.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setPreviewPassToken(null);
      setPreviewStageToken(null);
      notify('success', 'تم تسجيل الخروج بأمان.');
    } catch {
      notify('error', 'تعذر تسجيل الخروج.');
    }
  };

  const clearUrlTokens = () => {
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, '', cleanUrl);
    setUrlPassToken(null);
    setUrlStageToken(null);
  };

  const renderContent = () => {
    // 1. Direct Stage QR Broadcast Portal via URL (?stage=...) — Zero-Login Instant Notifications
    if (urlStageToken) {
      return (
        <StagePortalView
          stageToken={urlStageToken}
          onExit={clearUrlTokens}
          onOpenStudentPass={(pt) => {
            clearUrlTokens();
            setPreviewPassToken(pt);
          }}
          onNotify={notify}
        />
      );
    }

    // 2. Direct Parent Smart Pass via URL (?pass=...) — Instant Zero-Login Access
    if (urlPassToken) {
      return (
        <ParentPassView
          passToken={urlPassToken}
          user={user}
          onSignIn={handleSignIn}
          onExit={clearUrlTokens}
          onNotify={notify}
        />
      );
    }

    // 3. Demo Stage QR Portal Preview from Landing Page
    if (previewDemoStage) {
      return (
        <StagePortalView
          demoPortal={DEMO_STAGE_PORTAL}
          onExit={() => setPreviewDemoStage(false)}
          onOpenStudentPass={() => {
            setPreviewDemoStage(false);
            setPreviewDemoPass(true);
          }}
          onNotify={notify}
        />
      );
    }

    // 4. Demo Parent Pass Preview from Landing Page
    if (previewDemoPass) {
      return (
        <ParentPassView
          demoPass={DEMO_PARENT_PASS}
          user={user}
          onSignIn={handleSignIn}
          onExit={() => setPreviewDemoPass(false)}
          onNotify={notify}
        />
      );
    }

    // 5. School Admin Previewing a Stage's Live QR Broadcast Portal
    if (previewStageToken) {
      return (
        <StagePortalView
          stageToken={previewStageToken}
          onExit={() => setPreviewStageToken(null)}
          onOpenStudentPass={(pt) => {
            setPreviewStageToken(null);
            setPreviewPassToken(pt);
          }}
          onNotify={notify}
        />
      );
    }

    // 6. School Admin Previewing a Specific Student's Live Pass
    if (previewPassToken) {
      return (
        <ParentPassView
          passToken={previewPassToken}
          user={user}
          onSignIn={handleSignIn}
          onExit={() => setPreviewPassToken(null)}
          onNotify={notify}
        />
      );
    }

    // 7. Waiting for Firebase Auth initial state
    if (!authReady) {
      return (
        <div className="min-h-screen bg-[#F8F9F7] flex items-center justify-center p-6">
          <div className="text-center">
            <p className="font-display text-2xl font-bold text-slate-900 mb-2">وصال</p>
            <p className="text-sm text-slate-500">جاري تجهيز المنصة...</p>
          </div>
        </div>
      );
    }

    // 8. Authenticated School Administrator Dashboard
    if (user) {
      return (
        <SchoolDashboard
          user={user}
          onSignOut={handleSignOut}
          onPreviewPass={(token) => setPreviewPassToken(token)}
          onPreviewStagePortal={(token) => setPreviewStageToken(token)}
          onNotify={notify}
        />
      );
    }

    // 9. Editorial Landing Page
    return (
      <LandingView
        onSignIn={handleSignIn}
        signingIn={signingIn}
        onPreviewParentPass={() => setPreviewDemoPass(true)}
        onPreviewStagePortal={() => setPreviewDemoStage(true)}
        authError={authError}
      />
    );
  };

  return (
    <ErrorBoundary>
      {renderContent()}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <OfflineIndicator />
    </ErrorBoundary>
  );
}
