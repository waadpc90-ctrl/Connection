import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="no-print fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-lg bg-amber-700 text-white px-3.5 py-2 text-xs font-medium shadow-md">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>لا يوجد اتصال بالإنترنت — سيتم التحديث تلقائياً عند عودة الشبكة</span>
    </div>
  );
}
