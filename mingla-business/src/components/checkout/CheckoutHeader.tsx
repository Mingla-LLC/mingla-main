/**
 * CheckoutHeader — shared header for J-C1 / J-C2 / J-C3.
 *
 * Layout: safe-area inset spacer + horizontal row
 *   [back IconChrome] [centered title] [step Pill]
 * + 1px bottom divider.
 *
 * Per Cycle 8 spec §4.11.
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

import { IconChrome } from "../ui/IconChrome";
import { Pill } from "../ui/Pill";

export interface CheckoutHeaderProps {
  /**
   * 0-indexed step. Event-side: 0=Tickets, 1=Buyer, 2=Payment. ORCH-1178 trip
   * funnel ALWAYS shows the cart step (index=0) so the trip sequence is
   * index(0) → buyer(1) → [intake] → payment(2 without intake, 3 with intake);
   * the intake step itself renders its own inline "3 OF N" header.
   */
  stepIndex: 0 | 1 | 2 | 3;
  /**
   * Total visible steps. Event checkouts are 3. ORCH-1178 trips ALWAYS keep the
   * cart/quantity step, so the trip funnel is 3 (no intake) or 4 (intake
   * present). (Legacy 2 retained for source-compat; the trip funnel no longer
   * collapses to 2 — ORCH-1178 supersedes the ORCH-1130 single-tier auto-skip.)
   */
  totalSteps: 2 | 3 | 4;
  title: string;
  onBack: () => void;
}

export const CheckoutHeader: React.FC<CheckoutHeaderProps> = ({
  stepIndex,
  totalSteps,
  title,
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top + spacing.sm },
      ]}
    >
      <View style={styles.row}>
        <IconChrome
          icon="arrowL"
          size={40}
          onPress={onBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.pillSlot}>
          <Pill variant="info">
            {stepIndex + 1} of {totalSteps}
          </Pill>
        </View>
      </View>
      <View style={styles.divider} />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: "#0c0e12",
    ...(Platform.OS === "web"
      ? {
          position: "sticky" as unknown as "absolute",
          top: 0,
          zIndex: 10,
        }
      : null),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  pillSlot: {
    minWidth: 56,
    alignItems: "flex-end",
  },
  divider: {
    marginTop: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
});

export default CheckoutHeader;
