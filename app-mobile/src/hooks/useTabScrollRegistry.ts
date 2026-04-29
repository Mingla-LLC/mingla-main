// ORCH-0679 Wave 2.8 Path B — Tab scroll registry hook.
//
// Preserves per-tab scroll position across tab unmount/remount under the
// Path B mount-only-active-tab pattern. Reads initial position from the
// Zustand registry on mount, restores via scrollTo with rAF (waits for
// layout). Throttles writes to 100ms while scrolling so we don't hammer
// Zustand at 60Hz.
//
// Spec: Mingla_Artifacts/specs/SPEC_ORCH-0679_WAVE2_8_PATH_B_TAB_MOUNT_UNMOUNT.md §4

import { useCallback, useEffect, useRef } from 'react';
import type { ScrollView, FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useAppStore } from '../store/appStore';

type ScrollKey = keyof ReturnType<typeof useAppStore.getState>['tabScroll'];

interface UseTabScrollRegistryReturn {
  /** Pass to ScrollView/FlatList ref */
  scrollRef: React.MutableRefObject<ScrollView | FlatList | null>;
  /** Pass to onScroll prop */
  handleScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

const WRITE_THROTTLE_MS = 100;

/**
 * Hook for tab components to restore scroll position on remount and persist
 * it on every scroll. Pass `scrollRef` to your ScrollView/FlatList ref prop
 * and `handleScroll` to its onScroll prop.
 *
 * Example:
 *   const { scrollRef, handleScroll } = useTabScrollRegistry('saved');
 *   return <FlatList ref={scrollRef} onScroll={handleScroll} ... />;
 */
export function useTabScrollRegistry(key: ScrollKey): UseTabScrollRegistryReturn {
  const scrollRef = useRef<ScrollView | FlatList | null>(null);
  const setTabScroll = useAppStore((s) => s.setTabScroll);
  // Read initial value once (snapshot at mount time). Don't subscribe to
  // updates — we don't want re-renders when other tabs scroll.
  const initialYRef = useRef<number>(useAppStore.getState().tabScroll[key]);

  // Restore on mount via rAF (wait for content layout).
  useEffect(() => {
    const initialY = initialYRef.current;
    if (initialY <= 0) return; // First-time mount — start at top.

    const raf = requestAnimationFrame(() => {
      const ref = scrollRef.current;
      if (!ref) return;
      // FlatList has scrollToOffset; ScrollView has scrollTo.
      if ('scrollToOffset' in ref && typeof (ref as FlatList).scrollToOffset === 'function') {
        (ref as FlatList).scrollToOffset({ offset: initialY, animated: false });
      } else if ('scrollTo' in ref && typeof (ref as ScrollView).scrollTo === 'function') {
        (ref as ScrollView).scrollTo({ y: initialY, animated: false });
      }
    });

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount-only — initialYRef captured once at mount.

  // Throttled write: only every 100ms while scrolling.
  const lastWriteRef = useRef(0);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const now = Date.now();
      if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return;
      lastWriteRef.current = now;
      setTabScroll(key, e.nativeEvent.contentOffset.y);
    },
    [key, setTabScroll]
  );

  return { scrollRef, handleScroll };
}
