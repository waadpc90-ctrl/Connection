import { Download } from 'lucide-react';
import { openInstallGuide, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, install } = usePWAInstall();

  if (isInstalled) {
    return null;
  }

  const handleClick = () => {
    if (isInstallable) {
      void install();
    } else {
      openInstallGuide();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
        compact ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-xs'
      }`}
    >
      <Download className="w-3.5 h-3.5 text-emerald-700" />
      <span>تثبيت التطبيق</span>
    </button>
  );
}
