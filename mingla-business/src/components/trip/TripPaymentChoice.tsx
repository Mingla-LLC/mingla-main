/**
 * TripPaymentChoice — ORCH-1130 [public trip page payment-structure +
 * installments UX redesign].
 *
 * The shared "HOW YOU PAY" module: a prominent two-segment toggle
 * ("Pay in full" | "Pay over time") with the price/terms/schedule copy
 * rendered in a full-width block BELOW the toggle (NOT cramped inside the
 * segments). Per the Seth-BINDING RESOLVED FORK 1 in
 * SPEC_ORCH-1130_PUBLIC_TRIP_PAYMENT_UX.md: the toggle is the control; the
 * supporting copy block sells the decision.
 *
 * Single implementation rendered by BOTH the public trip page
 * (`TripCheckoutFlow`) AND the Review & pay step (`payment.tsx`) so the choice
 * presented at consideration time is byte-identical to the last-chance editor.
 *
 * Returns `null` when `schedule === null` (no-plan trip → the caller renders a
 * quiet price recap instead). Null-on-null parity with
 * `<InstallmentScheduleDisplay />`.
 *
 * Accessibility: the segment list is `accessibilityRole="radiogroup"` and each
 * segment `accessibilityRole="radio"` + `accessibilityState={{ selected }}` —
 * a segmented control is still an accessible single-select group. The selected
 * state is signaled by THREE redundant channels (border color, fill tint, dot)
 * so it is never color-alone.
 *
 * Currency-aware per Constitution #10 via the shared `formatCurrency`
 * (`Intl.NumberFormat`). No hardcoded currency glyphs. No fabricated numbers —
 * every amount derives from the projected schedule the caller passes in.
 */

import React from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { spacing, text as textTokens } from "../../constants/designSystem";
import type { ThemePalette } from "@mingla/event-rendering";
import { GlassCard } from "../ui/GlassCard";
import { formatCurrency } from "../../utils/currency";
import {
  InstallmentScheduleDisplay,
  type InstallmentScheduleDisplaySchedule,
} from "./InstallmentScheduleDisplay";

export type TripPaymentChoiceValue = "full" | "installments";

// ORCH-1138 B5 — additive palette theming. When a `palette` is passed (the
// public trip page), the segmented track / selected fill / dots / amount / copy
// derive from the brand palette. When ABSENT (the /checkout-trip payment route +
// wizard Step 5), every override resolves to undefined and the component renders
// BYTE-IDENTICAL to the pre-1138 designSystem tokens. Protected by RT-2.
interface PaletteOverrides {
  selectedSegment?: ViewStyle;
  selectedSegmentTitle?: TextStyle;
  selectedDotBorder?: ViewStyle;
  selectedDotInner?: ViewStyle;
  amountValue?: TextStyle;
  amountLabel?: TextStyle;
  primaryText?: TextStyle;
}

const paletteOverrides = (
  palette: ThemePalette | undefined,
): PaletteOverrides => {
  if (palette === undefined) return {};
  return {
    selectedSegment: {
      borderColor: palette.panelBorder,
      backgroundColor: palette.accentWash,
    },
    selectedSegmentTitle: { color: palette.primaryText },
    selectedDotBorder: { borderColor: palette.accent },
    selectedDotInner: { backgroundColor: palette.accent },
    amountValue: { color: palette.primaryText },
    amountLabel: { color: palette.secondaryText },
    primaryText: { color: palette.primaryText },
  };
};

export interface TripPaymentChoiceProps {
  /**
   * The projected schedule for the selected tier (cart-quantity scaled). When
   * `null` the module renders nothing — the caller shows a quiet price recap.
   */
  schedule: InstallmentScheduleDisplaySchedule | null;
  /** Full trip price in cents (qty-scaled). Used for the "Pay in full" amount. */
  fullPriceCents: number;
  /** ISO 4217 currency code from the trip tier. */
  currency: string;
  /** Deposit percentage from the schedule template (never hardcoded). */
  depositPct: number;
  value: TripPaymentChoiceValue;
  onChange: (value: TripPaymentChoiceValue) => void;
  /**
   * When true (default) the `InstallmentScheduleDisplay` ladder + reassurance
   * render under the supporting block while "Pay over time" is selected.
   */
  showScheduleWhenInstallments?: boolean;
  /**
   * ORCH-1138 B5 (additive). When present, the toggle/amount/copy derive from
   * the brand palette. When ABSENT, renders byte-identical to pre-1138. The
   * checkout-trip payment route + wizard Step 5 do NOT pass it (RT-2 guards
   * this); the public trip page does.
   */
  palette?: ThemePalette;
  testID?: string;
}

export const TripPaymentChoice: React.FC<TripPaymentChoiceProps> = ({
  schedule,
  fullPriceCents,
  currency,
  depositPct,
  value,
  onChange,
  showScheduleWhenInstallments = true,
  palette,
  testID,
}) => {
  // Null-on-null: no plan → caller renders the quiet recap line instead.
  if (schedule === null) return null;

  const ov = paletteOverrides(palette);

  const fullLabel = formatCurrency(fullPriceCents, currency, true);
  const depositLabel = formatCurrency(schedule.depositCents, currency, true);
  const futureCount = schedule.installments.length;
  const isFull = value === "full";
  const isInstallments = value === "installments";

  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={spacing.md}
      style={styles.card}
      testID={testID}
    >
      <Text style={styles.label}>HOW YOU PAY</Text>

      {/* Segmented toggle — two segments, the CONTROL. */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="How you pay"
        style={styles.segmentGroup}
      >
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={`Pay full ${fullLabel} now`}
          accessibilityState={{ selected: isFull }}
          onPress={() => onChange("full")}
          style={[
            styles.segment,
            isFull ? styles.segmentSelected : null,
            isFull ? ov.selectedSegment : null,
          ]}
        >
          <View
            style={[
              styles.dot,
              isFull ? styles.dotSelected : null,
              isFull ? ov.selectedDotBorder : null,
            ]}
            pointerEvents="none"
          >
            {isFull ? (
              <View style={[styles.dotInner, ov.selectedDotInner]} />
            ) : null}
          </View>
          <Text
            style={[
              styles.segmentTitle,
              isFull ? styles.segmentTitleSelected : null,
              isFull ? ov.selectedSegmentTitle : null,
            ]}
          >
            Pay in full
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={`Pay over time, ${depositLabel} deposit today plus ${futureCount} future payment${
            futureCount === 1 ? "" : "s"
          }`}
          accessibilityState={{ selected: isInstallments }}
          onPress={() => onChange("installments")}
          style={[
            styles.segment,
            isInstallments ? styles.segmentSelected : null,
            isInstallments ? ov.selectedSegment : null,
          ]}
        >
          <View
            style={[
              styles.dot,
              isInstallments ? styles.dotSelected : null,
              isInstallments ? ov.selectedDotBorder : null,
            ]}
            pointerEvents="none"
          >
            {isInstallments ? (
              <View style={[styles.dotInner, ov.selectedDotInner]} />
            ) : null}
          </View>
          <Text
            style={[
              styles.segmentTitle,
              isInstallments ? styles.segmentTitleSelected : null,
              isInstallments ? ov.selectedSegmentTitle : null,
            ]}
          >
            Pay over time
          </Text>
        </Pressable>
      </View>

      {/* Full-width supporting block BELOW the toggle — sells the decision. */}
      <View style={styles.block}>
        {isFull ? (
          <>
            <View style={styles.amountRow}>
              <Text style={[styles.amountLabel, ov.amountLabel]}>
                Charged today
              </Text>
              <Text style={[styles.amountValue, ov.amountValue]}>
                {fullLabel}
              </Text>
            </View>
            <Text style={styles.termsCopy}>
              You&rsquo;ll be charged {fullLabel} today. No future bills for this
              booking. Refunds follow the organizer&rsquo;s policy.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.amountRow}>
              <Text style={[styles.amountLabel, ov.amountLabel]}>
                {depositPct}% deposit today
              </Text>
              <Text style={[styles.amountValue, ov.amountValue]}>
                {depositLabel} today + {futureCount} more
              </Text>
            </View>
            {showScheduleWhenInstallments ? (
              <View style={styles.scheduleWrap}>
                <InstallmentScheduleDisplay
                  schedule={schedule}
                  variant="buyer"
                  isProjection={true}
                />
              </View>
            ) : null}
          </>
        )}
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  segmentGroup: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  segmentSelected: {
    borderColor: "rgba(235, 120, 37, 0.75)",
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  segmentTitle: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "700",
    color: textTokens.secondary,
  },
  segmentTitleSelected: {
    color: textTokens.primary,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotSelected: {
    borderColor: "rgba(235, 120, 37, 0.95)",
  },
  dotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(235, 120, 37, 0.95)",
  },
  block: {
    marginTop: spacing.md,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  amountLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  amountValue: {
    fontSize: 15,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  termsCopy: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "400",
    color: textTokens.tertiary,
  },
  scheduleWrap: {
    marginTop: spacing.md,
    width: "100%",
  },
});

export default TripPaymentChoice;
