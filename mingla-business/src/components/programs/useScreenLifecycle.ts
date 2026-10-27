/**
 * #3872 round 2 follow-ups — screen lifecycle hooks for Host program screens.
 *
 * - useRefreshOnFocus: refetch live state when the screen regains focus or
 *   the app comes back to the foreground (rules in ./screenLifecycle).
 * - useCloseOnBlur: a program sheet lives in its own native Modal window, so
 *   it would stay on top of whatever screen the host navigates to. Close it
 *   when its screen blurs or unmounts.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { createFocusRefresher } from "./screenLifecycle";

export function useRefreshOnFocus(refresh: () => unknown): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const controller = useMemo(
    () =>
      createFocusRefresher(
        () => refreshRef.current(),
        AppState.currentState ?? "active",
      ),
    [],
  );
  useFocusEffect(
    useCallback(() => {
      controller.focus();
      return () => controller.blur();
    }, [controller]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) =>
      controller.appState(next),
    );
    return () => subscription.remove();
  }, [controller]);
}

export function useCloseOnBlur(visible: boolean, onClose: () => void): void {
  const latest = useRef({ visible, onClose });
  latest.current = { visible, onClose };
  useFocusEffect(
    useCallback(
      () => () => {
        if (latest.current.visible) latest.current.onClose();
      },
      [],
    ),
  );
}
