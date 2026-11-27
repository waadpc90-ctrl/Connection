import { useEffect, useState } from 'react';

export type InstallPlatform = 'android' | 'ios' | 'desktop';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_GUIDE_OPEN_EVENT = 'wisaal:open-install-guide';

let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let sharedIsInstalled = false;
let listenersInitialized = false;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
}

export function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function detectInstallPlatform(): InstallPlatform {
  if (typeof window === 'undefined') return 'desktop';
  const ua = window.navigator.userAgent.toLowerCase();
  const isIPadOS =
    ua.includes('macintosh') &&
    typeof window.navigator.maxTouchPoints === 'number' &&
    window.navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(ua) || isIPadOS) {
    return 'ios';
  }
  if (/android/.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

function ensureGlobalListeners() {
  if (listenersInitialized || typeof window === 'undefined') return;
  listenersInitialized = true;
  sharedIsInstalled = detectIsStandalone();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    sharedIsInstalled = true;
    sharedDeferredPrompt = null;
    notifySubscribers();
  });

  const standaloneMedia = window.matchMedia('(display-mode: standalone)');
  const handleDisplayModeChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      sharedIsInstalled = true;
      sharedDeferredPrompt = null;
      notifySubscribers();
    }
  };
  if (typeof standaloneMedia.addEventListener === 'function') {
    standaloneMedia.addEventListener('change', handleDisplayModeChange);
  }
}

export function openInstallGuide() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INSTALL_GUIDE_OPEN_EVENT));
  }
}

export function onOpenInstallGuide(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(INSTALL_GUIDE_OPEN_EVENT, handler);
  return () => window.removeEventListener(INSTALL_GUIDE_OPEN_EVENT, handler);
}

export function usePWAInstall() {
  ensureGlobalListeners();

  const [, setTick] = useState(0);
  const [platform] = useState<InstallPlatform>(() => detectInstallPlatform());

  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!sharedDeferredPrompt) return false;
    await sharedDeferredPrompt.prompt();
    const { outcome } = await sharedDeferredPrompt.userChoice;
    if (outcome === 'accepted') {
      sharedIsInstalled = true;
      sharedDeferredPrompt = null;
      notifySubscribers();
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!sharedDeferredPrompt,
    isInstalled: sharedIsInstalled,
    isIOS: platform === 'ios',
    platform,
    install,
  };
}
