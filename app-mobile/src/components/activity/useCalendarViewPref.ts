/**
 * Issue #4265 — remembers the Calendar's List · Week · Month choice per user.
 *
 * A client-only UI preference (Constitution #5) in AsyncStorage under a
 * `mingla:`-prefixed key, so sign-out's private-key sweep clears it (#6).
 * `hydrated` gates the first paint (#14): until the stored value is read the
 * caller keeps the default, and a later read never overwrites a choice the
 * user made in the meantime.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  calendarViewStorageKey,
  DEFAULT_CALENDAR_VIEW,
  parseCalendarView,
  type CalendarView,
} from "./calendarAgendaModel";

export function useCalendarViewPref(userId: string | undefined): {
  view: CalendarView;
  setView: (view: CalendarView) => void;
  hydrated: boolean;
} {
  const [view, setViewState] = useState<CalendarView>(DEFAULT_CALENDAR_VIEW);
  const [hydrated, setHydrated] = useState(false);
  const touchedRef = useRef(false);

  useEffect(() => {
    touchedRef.current = false;
    setHydrated(false);
    if (!userId) {
      setViewState(DEFAULT_CALENDAR_VIEW);
      setHydrated(true);
      return undefined;
    }
    let alive = true;
    AsyncStorage.getItem(calendarViewStorageKey(userId))
      .then((raw) => {
        if (alive && !touchedRef.current) setViewState(parseCalendarView(raw));
      })
      .catch((error: unknown) => {
        console.warn("[CalendarTab] could not read the saved calendar view:", error);
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const setView = useCallback(
    (next: CalendarView) => {
      touchedRef.current = true;
      setViewState(next);
      if (!userId) return;
      AsyncStorage.setItem(calendarViewStorageKey(userId), next).catch((error: unknown) => {
        console.warn("[CalendarTab] could not save the calendar view:", error);
      });
    },
    [userId],
  );

  return { view, setView, hydrated };
}
