/**
 * useAddToCalendar — issue #4420. The ONE entry point behind every buyer
 * "Add to calendar" control (event flyer, event body, RSVP body).
 *
 *   native  open() opens the Google Calendar page (Host app previews).
 *   web     open() opens the chooser: a sheet on phones, a small menu anchored
 *           to the tapped control on desktop. The chooser code loads on the
 *           first tap, not at boot (it is not on the eager boot payload).
 *
 * Anonymous-tolerant: never reads auth.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ErrorBoundary } from "react-error-boundary";
import type { FallbackProps } from "react-error-boundary";

import type { OfferingCalendarEntry } from "@mingla/offering-rendering/offeringCalendar.cjs";

import { color, radius, space, type } from "../../constants/designSystem";
import { addOfferingToCalendar } from "../../utils/offeringCalendarAction";
import type { MenuAnchor } from "../ui/Menu";
import type { AddToCalendarChooserProps } from "./AddToCalendarChooser";

const loadChooser = (): Promise<{ default: React.ComponentType<AddToCalendarChooserProps> }> =>
  import("./AddToCalendarChooser");

/**
 * The control that was just tapped, as page coordinates. Read synchronously
 * inside the tap (the click event is still `window.event`); null when the
 * browser does not expose it, and the chooser then shows as a sheet.
 */
export const readTriggerAnchor = (): MenuAnchor | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const current: Event | undefined = (window as Window & { event?: Event }).event;
  const target = current?.target as Element | null | undefined;
  if (target === null || target === undefined || typeof target.closest !== "function") return null;
  const trigger = target.closest('[role="button"],button,a') ?? target;
  const rect = trigger.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

// Shown only if the chooser's code could not be fetched (offline, a stale
// deploy). Plain react-native pieces on purpose: this file is on the page's
// eager graph, so it must not pull the Sheet or Button stacks in.
const LoadFailed: React.FC<FallbackProps> = ({ resetErrorBoundary }) => (
  <Modal visible transparent animationType="none" onRequestClose={resetErrorBoundary}>
    <View style={styles.failedScrim}>
      <View style={styles.failedCard} accessibilityRole="alert" testID="add-to-calendar-load-failed">
        <Text style={styles.failedTitle}>Couldn&apos;t load calendar options</Text>
        <Text style={styles.failedBody}>Check your connection and try again.</Text>
        <Pressable
          onPress={resetErrorBoundary}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={styles.failedButton}
        >
          <Text style={styles.failedButtonLabel}>Try again</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

export interface UseAddToCalendar {
  open: () => void;
  chooser: React.ReactElement | null;
}

export const useAddToCalendar = (
  entry: OfferingCalendarEntry | null,
  icsUrl: string | null,
): UseAddToCalendar => {
  const [visible, setVisible] = useState<boolean>(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  // A failed chunk load is cached by React.lazy for good, so a retry needs a
  // fresh lazy component (same approach as RetryableLazyBoundary).
  const [generation, setGeneration] = useState<number>(0);
  const LazyChooser = useMemo(() => {
    void generation;
    return React.lazy(loadChooser);
  }, [generation]);

  const open = useCallback((): void => {
    if (entry === null) return;
    if (Platform.OS !== "web") {
      addOfferingToCalendar(entry);
      return;
    }
    setAnchor(readTriggerAnchor());
    setVisible(true);
  }, [entry]);

  const close = useCallback((): void => setVisible(false), []);
  const retry = useCallback((): void => {
    setVisible(false);
    setGeneration((g) => g + 1);
  }, []);

  const chooser =
    Platform.OS === "web" && visible && entry !== null && icsUrl !== null ? (
      <ErrorBoundary FallbackComponent={LoadFailed} onReset={retry}>
        <React.Suspense fallback={null}>
          {React.createElement<AddToCalendarChooserProps>(LazyChooser, {
            visible,
            onClose: close,
            entry,
            icsUrl,
            anchor,
          })}
        </React.Suspense>
      </ErrorBoundary>
    ) : null;

  return { open, chooser };
};

const styles = StyleSheet.create({
  failedScrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", padding: space[4] },
  failedCard: { width: "100%", maxWidth: 360, borderRadius: radius.md, backgroundColor: color.card2, padding: space[4], gap: space[3] },
  failedTitle: { ...type.row, color: color.text1 },
  failedBody: { ...type.small, color: color.text2 },
  failedButton: { minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  failedButtonLabel: { ...type.row, color: color.text1 },
});
