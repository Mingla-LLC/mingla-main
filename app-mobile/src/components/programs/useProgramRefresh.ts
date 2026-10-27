import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { isForegroundReturn } from './programRefresh';

/**
 * #3872 — re-read a program screen when it gains focus (opened again, returned
 * to, or reopened by a link) and when the app comes back to the foreground
 * while the screen is showing. The callback is held in a ref, so the
 * subscriptions are set up once and a new callback each render never loops.
 */
export function useRefreshOnFocus(refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  const focused = useRef(false);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    latest.current();
    return () => { focused.current = false; };
  }, []));

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (focused.current && isForegroundReturn(previous, next)) latest.current();
      previous = next;
    });
    return () => subscription.remove();
  }, []);
}
