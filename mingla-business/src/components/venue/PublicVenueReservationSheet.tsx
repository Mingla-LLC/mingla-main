import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, type View as ViewInstance } from "react-native";

import { spacing, text, typography } from "../../constants/designSystem";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Sheet } from "../ui/Sheet";

// Keep focus restoration beyond every canonical close/unmount animation.
const FOCUS_RETURN_DELAY_MS = 320;

export interface PublicVenueReservationSheetProps {
  visible: boolean;
  onClose: () => void;
  onDismissed?: () => void;
  /**
   * #1532 D7 — REQUIRED, and required is the point.
   *
   * This heading used to be a hardcoded restaurant string, so a hotel guest
   * tapped Reserve this Stay and landed on a sheet inviting them to reserve a
   * table — directly above their check-in and check-out times. The component
   * took no category prop at all: it was structurally incapable of saying
   * anything else.
   *
   * An OPTIONAL prop with a restaurant default would have preserved exactly
   * that failure for anyone who forgot to pass it. Being REQUIRED means a new
   * call site cannot compile without deciding, and
   * `venueReserveCopy.reserveSheetTitle()` is the one place that decides — so
   * the heading and the CTA that opens it can never drift apart again.
   */
  title: string;
  children: React.ReactNode;
}

export function PublicVenueReservationSheet({
  visible,
  onClose,
  onDismissed,
  title,
  children,
}: PublicVenueReservationSheetProps): React.ReactElement {
  const headingRef = useRef<ViewInstance | null>(null);
  const wasVisibleRef = useRef(visible);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      headingRef.current?.focus();
    }, 0);
    return (): void => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      wasVisibleRef.current = true;
      return;
    }
    if (!wasVisibleRef.current) return;
    wasVisibleRef.current = false;

    let frame: number | null = null;
    const timer = setTimeout(() => {
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(() => onDismissed?.());
      } else {
        onDismissed?.();
      }
    }, FOCUS_RETURN_DELAY_MS);

    return (): void => {
      clearTimeout(timer);
      if (frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
    };
  }, [onDismissed, visible]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint="full"
      testID="issue-1380-public-venue-reservation-sheet"
    >
      <View style={styles.host} accessibilityViewIsModal={visible}>
        <View
          ref={headingRef}
          accessible
          focusable
          tabIndex={-1}
          accessibilityRole="header"
          accessibilityLabel={title}
        >
          <Text style={styles.heading}>{title}</Text>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {visible ? children : null}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
    gap: spacing.sm,
  },
  heading: {
    ...typography.h2,
    color: text.primary,
  },
  scroll: {
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  content: {
    paddingBottom: spacing.xl,
  },
});
