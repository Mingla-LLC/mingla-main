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
  children: React.ReactNode;
}

export function PublicVenueReservationSheet({
  visible,
  onClose,
  onDismissed,
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
          accessibilityLabel="Reserve a table"
        >
          <Text style={styles.heading}>Reserve a table</Text>
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
