import { useRef, useCallback } from 'react';

interface UseDebugGestureOptions {
  onTrigger: () => void;
  enabled?: boolean;
  tapCount?: number;
  tapWindow?: number;
}

/**
 * Returns a handler you can attach to any View's onTouchEnd.
 * Tap 5 times quickly (within 2s) to trigger the debug modal.
 * No native modules required — works in Expo Go.
 */
export const useDebugGesture = ({
  onTrigger,
  enabled = true,
  tapCount = 5,
  tapWindow = 2000,
}: UseDebugGestureOptions) => {
  const tapsRef = useRef<number[]>([]);

  const handleTap = useCallback(() => {
    if (!enabled) return;

    const now = Date.now();
    tapsRef.current.push(now);

    // Keep only taps within the window
    tapsRef.current = tapsRef.current.filter(t => now - t < tapWindow);

    if (tapsRef.current.length >= tapCount) {
      tapsRef.current = [];
      onTrigger();
    }
  }, [enabled, onTrigger, tapCount, tapWindow]);

  return { handleTap };
};
