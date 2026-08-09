import { useEffect, useState } from 'react';

export function useShareNetworkState(): boolean {
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false);
  useEffect(() => {
    const handleOnline = (): void => setOnline(true);
    const handleOffline = (): void => setOnline(false);
    globalThis.addEventListener?.('online', handleOnline);
    globalThis.addEventListener?.('offline', handleOffline);
    return () => {
      globalThis.removeEventListener?.('online', handleOnline);
      globalThis.removeEventListener?.('offline', handleOffline);
    };
  }, []);
  return online;
}
