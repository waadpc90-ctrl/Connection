import { useCallback, useEffect, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { auth, googleProvider } from './lib/firebase';
import {
  clearLockedStageToken,
  readLockedStageToken,
  saveLockedStageToken,
} from './lib/adminSecurity';
import { DEMO_PARENT_PASS, DEMO_STAGE_PORTAL } from './data/demoPassData';
import { AdminLoginView } from './components/AdminLoginView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FirstVisitInstallGuide } from './components/FirstVisitInstallGuide';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ParentHomeView } from './components/ParentHomeView';
import { ParentPassView } from './components/ParentPassView';
import { SchoolDashboard } from './components/SchoolDashboard';
import { StagePortalView } from './components/StagePortalView';
import { Toast, ToastState } from './components/Toast';
import { registerWisaalServiceWorker } from './lib/pushNotifications';
import { StageId } from './types/wisaal';

function readTokenFromUrl(paramName: 'pass' | 'stage'): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get(paramName);
  if (token && /^[a-zA-Z0-9_\-]{16,64}$/.test(token)) {
    return token;
  }
  return null;
}

function readSchoolParamFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const val = params.get('school');
  if (val && /^[a-zA-Z0-9_\-]{1,128}$/.test(val)) {
    return val;
  }
  return null;
}

function readInitialModeFromUrl(): 'parents' | 'admin' {
  const params = new URLSearchParams(window.location.search);
  if (params.get('admin') === '1') return 'admin';
  return 'parents';
}

function hasExplicitParentsParam(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('parents') === '1';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Strict separation: default '/' is ALWAYS 'parents' (inquiry only); '?admin=1' is 'admin' (recording)
  const [appMode, setAppMode] = useState<'parents' | 'admin'>(() =>
    readInitialModeFromUrl()
  );
  const [schoolParam, setSchoolParam] = useState<string | null>(() => readSchoolParamFromUrl());

  // Direct parent pass (?pass=...) or collective stage QR portal (?stage=...)
  const [urlPassToken, setUrlPassToken] = useState<string | null>(() => readTokenFromUrl('pass'));
  const [urlStageToken, setUrlStageToken] = useState<string | null>(() =>
    readTokenFromUrl('stage')
  );
  // Persisted stage lock when parent connected via a Stage QR barcode (shows ONLY that stage)
  const [lockedStageToken, setLockedStageToken] = useState<string | null>(() => {
    const fromUrl = readTokenFromUrl('stage');
    if (fromUrl) {
      saveLockedStageToken(fromUrl);
      return fromUrl;
    }
    if (hasExplicitParentsParam()) {
      clearLockedStageToken();
      return null;
    }
    return readLockedStageToken();
  });

  const [activePassToken, setActivePassToken] = useState<string | null>(null);
  const [activePassFromAdmin, setActivePassFromAdmin] = useState<boolean>(false);
  const [activeStageToken, setActiveStageToken] = useState<string | null>(null);
  const [previewDemoPass, setPreviewDemoPass] = useState<boolean>(false);
  const [previewDemoStage, setPreviewDemoStage] = useState<{
    stageId: StageId;
    stageName: string;
  } | null>(null);

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
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          const base = `${window.location.origin}${window.location.pathname}`;
          window.history.replaceState({}, '', `${base}?admin=1`);
          setAppMode('admin');
          notify('success', 'تم تسجيل الدخول بنجاح.');
        }
      })
      .catch(() => {
        // Ignore redirect result errors when no redirect occurred
      });
    return () => unsub();
  }, [notify]);

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
      const nextStage = readTokenFromUrl('stage');
      if (nextStage) {
        saveLockedStageToken(nextStage);
        setLockedStageToken(nextStage);
      } else if (hasExplicitParentsParam()) {
        clearLockedStageToken();
        setLockedStageToken(null);
      }
      setUrlPassToken(readTokenFromUrl('pass'));
      setUrlStageToken(nextStage);
      setSchoolParam(readSchoolParamFromUrl());
      setAppMode(readInitialModeFromUrl());
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      const base = `${window.location.origin}${window.location.pathname}`;
      window.history.replaceState({}, '', `${base}?admin=1`);
      setAppMode('admin');
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
        const isStandaloneWindow = window.self === window.top;
        if (isStandaloneWindow) {
          try {
            await signInWithRedirect(auth, googleProvider);
            return;
          } catch {
            // Fall through to error message below
          }
        }
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
      setActivePassToken(null);
      setActivePassFromAdmin(false);
      setActiveStageToken(null);
      setAppMode('parents');
      const cleanUrl = `${window.location.origin}${window.location.pathname}`;
      window.history.replaceState({}, '', cleanUrl);
      notify('success', 'تم تسجيل الخروج بأمان.');
    } catch {
      notify('error', 'تعذر تسجيل الخروج.');
    }
  };

  const clearUrlTokensToParents = () => {
    clearLockedStageToken();
    setLockedStageToken(null);
    const base = `${window.location.origin}${window.location.pathname}`;
    const nextUrl = schoolParam
      ? `${base}?parents=1&school=${encodeURIComponent(schoolParam)}`
      : `${base}?parents=1`;
    window.history.replaceState({}, '', nextUrl);
    setUrlPassToken(null);
    setUrlStageToken(null);
    setActivePassToken(null);
    setActivePassFromAdmin(false);
    setActiveStageToken(null);
    setPreviewDemoPass(false);
    setPreviewDemoStage(null);
    setAppMode('parents');
  };

  const switchToAdminInterface = () => {
    const base = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, '', `${base}?admin=1`);
    setUrlPassToken(null);
    setUrlStageToken(null);
    setActivePassToken(null);
    setActivePassFromAdmin(false);
    setActiveStageToken(null);
    setPreviewDemoPass(false);
    setPreviewDemoStage(null);
    setAppMode('admin');
  };

  const switchToParentsInterface = (targetSchoolId?: string) => {
    clearLockedStageToken();
    setLockedStageToken(null);
    const base = `${window.location.origin}${window.location.pathname}`;
    const nextSchool = targetSchoolId ?? schoolParam;
    if (targetSchoolId) setSchoolParam(targetSchoolId);
    const nextUrl = nextSchool
      ? `${base}?parents=1&school=${encodeURIComponent(nextSchool)}`
      : `${base}?parents=1`;
    window.history.replaceState({}, '', nextUrl);
    setUrlPassToken(null);
    setUrlStageToken(null);
    setActivePassToken(null);
    setActivePassFromAdmin(false);
    setActiveStageToken(null);
    setPreviewDemoPass(false);
    setPreviewDemoStage(null);
    setAppMode('parents');
  };

  const renderContent = () => {
    // 1. Live Student Card opened from a Stage Portal, Parents Portal, or Admin Preview
    if (activePassToken) {
      return (
        <ParentPassView
          passToken={activePassToken}
          isAdminPreview={activePassFromAdmin}
          onExit={() => {
            setActivePassToken(null);
            setActivePassFromAdmin(false);
          }}
          onNotify={notify}
        />
      );
    }

    // 2. Direct Stage QR Broadcast Portal via URL (?stage=...) — Strictly Locked to THAT Stage Only
    if (urlStageToken) {
      return (
        <StagePortalView
          stageToken={urlStageToken}
          lockedToStage
          onExit={clearUrlTokensToParents}
          onOpenStudentPass={(pt) => {
            setActivePassFromAdmin(false);
            setActivePassToken(pt);
          }}
          onNotify={notify}
        />
      );
    }

    // 3. Direct Parent Smart Pass via URL (?pass=...) — Locked to Student Card Only
    if (urlPassToken) {
      return (
        <ParentPassView
          passToken={urlPassToken}
          lockedToPass
          onExit={clearUrlTokensToParents}
          onNotify={notify}
        />
      );
    }

    // 4. Demo Stage Portal selected from Parents Portal
    if (previewDemoStage) {
      return (
        <StagePortalView
          demoPortal={{
            ...DEMO_STAGE_PORTAL,
            stageId: previewDemoStage.stageId,
            stageName: previewDemoStage.stageName,
          }}
          onExit={() => setPreviewDemoStage(null)}
          onOpenStudentPass={() => {
            setPreviewDemoStage(null);
            setPreviewDemoPass(true);
          }}
          onNotify={notify}
        />
      );
    }

    // 5. Demo Student Card selected from Parents Portal
    if (previewDemoPass) {
      return (
        <ParentPassView
          demoPass={DEMO_PARENT_PASS}
          onExit={() => setPreviewDemoPass(false)}
          onNotify={notify}
        />
      );
    }

    // 6. Live Stage Portal opened from Parents Portal or Admin Preview (can return via Back)
    if (activeStageToken) {
      return (
        <StagePortalView
          stageToken={activeStageToken}
          onExit={() => setActiveStageToken(null)}
          onOpenStudentPass={(pt) => {
            setActiveStageToken(null);
            setActivePassFromAdmin(false);
            setActivePassToken(pt);
          }}
          onNotify={notify}
        />
      );
    }

    // 7. Dedicated Parents Interface (Default View at '/')
    if (appMode === 'parents') {
      // If this parent previously connected via a Stage QR barcode, keep them strictly inside THAT stage ONLY
      if (lockedStageToken) {
        return (
          <StagePortalView
            stageToken={lockedStageToken}
            lockedToStage
            onExit={clearUrlTokensToParents}
            onOpenStudentPass={(pt) => {
              setActivePassFromAdmin(false);
              setActivePassToken(pt);
            }}
            onNotify={notify}
          />
        );
      }

      return (
        <ParentHomeView
          schoolId={schoolParam}
          isAdminSignedIn={Boolean(user)}
          onSelectLiveStage={(token) => setActiveStageToken(token)}
          onSelectDemoStage={(stageId, stageName) => setPreviewDemoStage({ stageId, stageName })}
          onOpenLivePass={(token) => {
            setActivePassFromAdmin(false);
            setActivePassToken(token);
          }}
          onOpenDemoPass={() => setPreviewDemoPass(true)}
          onOpenAdmin={switchToAdminInterface}
          onNotify={notify}
        />
      );
    }

    // 8. Admin Mode (?admin=1): wait for Firebase Auth state
    if (!authReady) {
      return (
        <div className="min-h-screen bg-[#F7F8F7] flex items-center justify-center p-6">
          <div className="text-center">
            <p className="font-display text-2xl font-bold text-slate-900 mb-2">وصال</p>
            <p className="text-sm text-slate-500">جاري التحميل...</p>
          </div>
        </div>
      );
    }

    // 9. Admin Interface — Authenticated & PIN-Locked Recording & Management Dashboard
    if (user) {
      return (
        <SchoolDashboard
          user={user}
          onSignOut={handleSignOut}
          onPreviewPass={(token) => {
            setActivePassFromAdmin(true);
            setActivePassToken(token);
          }}
          onPreviewStagePortal={(token) => setActiveStageToken(token)}
          onOpenParentsPortal={(sid) => switchToParentsInterface(sid)}
          onNotify={notify}
        />
      );
    }

    // 10. Dedicated Admin Login Screen (?admin=1)
    return (
      <AdminLoginView
        onSignIn={handleSignIn}
        signingIn={signingIn}
        authError={authError}
        onBackToParents={() => switchToParentsInterface()}
      />
    );
  };

  const activeViewKey = activePassToken
    ? `pass_${activePassToken}`
    : urlStageToken
      ? `url_stage_${urlStageToken}`
      : urlPassToken
        ? `url_pass_${urlPassToken}`
        : previewDemoStage
          ? `demo_stage_${previewDemoStage.stageId}`
          : previewDemoPass
            ? 'demo_pass'
            : activeStageToken
              ? `stage_${activeStageToken}`
              : appMode === 'parents'
                ? lockedStageToken
                  ? `locked_stage_${lockedStageToken}`
                  : 'parents_home'
                : !authReady
                  ? 'admin_loading'
                  : user
                    ? `admin_dashboard_${user.uid}`
                    : 'admin_login';

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeViewKey}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-screen"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
        <FirstVisitInstallGuide onNotify={notify} />
        <Toast toast={toast} onDismiss={() => setToast(null)} />
        <OfflineIndicator />
      </ErrorBoundary>
    </MotionConfig>
  );
}
