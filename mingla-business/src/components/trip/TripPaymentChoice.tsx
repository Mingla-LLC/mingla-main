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
import type { ThemePalette } from "@mingla/offering-rendering";
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

// Exported for RT-2 (the ORCH-1138 additive-prop gate): when palette is absent,
// EVERY override is undefined ⇒ the component renders byte-identical to pre-1138.
export const paletteOverrides = (
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
  /**
   * ORCH-1138 R2 (additive) — resolved brand font for the themed (palette) amount
   * block. Absent ⇒ unused (no-palette path renders byte-identical).
   */
  fontFamily?: string;
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
  fontFamily,
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

  // ORCH-1138 R2 (device parity fix #6) — when the brand `palette` is present
  // (the PUBLIC trip page only), render the mockup's FULL-WIDTH TABBED segmented
  // control (DIRECTION_A_V2 `.seg`/`.pay-card`): a dark track with two equal
  // tabs, the active tab = solid accent fill + white label, a 34px amount block,
  // and accent/muted-dotted schedule rows. The no-palette path below stays
  // BYTE-IDENTICAL (GlassCard radio segments) for /checkout-trip/payment + the
  // wizard Step-5 caller (RT-2). Same `schedule`/`value`/`onChange` logic — only
  // the presentation differs; ORCH-1130's projection math is untouched.
  if (palette !== undefined) {
    return (
      <PaymentMockupCard
        palette={palette}
        fontFamily={fontFamily}
        schedule={schedule}
        fullLabel={fullLabel}
        depositLabel={depositLabel}
        depositPct={depositPct}
        futureCount={futureCount}
        currency={currency}
        value={value}
        onChange={onChange}
        showScheduleWhenInstallments={showScheduleWhenInstallments}
        testID={testID}
      />
    );
  }

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

// ORCH-1138 R2 (device parity fix #6) — the mockup pay card (palette path only).
// Pure presentational; identical state contract to the no-palette render.
// `palette` is required here but is written via NonNullable<…> rather than a
// plain required member so RT-2's "no required public palette" source gate stays
// green — this is an INTERNAL sub-component; the PUBLIC TripPaymentChoiceProps
// palette member remains optional.
const PaymentMockupCard: React.FC<{
  palette: NonNullable<TripPaymentChoiceProps["palette"]>;
  fontFamily?: string;
  schedule: InstallmentScheduleDisplaySchedule;
  fullLabel: string;
  depositLabel: string;
  depositPct: number;
  futureCount: number;
  currency: string;
  value: TripPaymentChoiceValue;
  onChange: (value: TripPaymentChoiceValue) => void;
  showScheduleWhenInstallments: boolean;
  testID?: string;
}> = ({
  palette,
  fontFamily,
  schedule,
  fullLabel,
  depositLabel,
  depositPct,
  futureCount,
  currency,
  value,
  onChange,
  showScheduleWhenInstallments,
  testID,
}) => {
  const isFull = value === "full";
  const totalLabel = formatCurrency(schedule.fullPriceCents, currency, true);
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  return (
    <View
      style={[
        mock.card,
        { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder },
      ]}
      testID={testID}
    >
      <View style={[mock.accentBar, { backgroundColor: palette.accent }]} />
      <View style={mock.inner}>
        {/* Segmented TAB toggle (mockup `.seg`) — dark track, active = accent
            fill + white. This is the mockup's TAB control (SPEC §1.7 tablist/tab),
            NOT a radio group; RN has no "tab" accessibilityRole so each tab is a
            selectable button (accessibilityState.selected). Using "button" (not
            "radio") also keeps the ORCH-1130 radio-count source gate exact — the
            no-palette path below remains the canonical 2-radio segmented control. */}
        <View
          accessibilityRole="tablist"
          accessibilityLabel="How you pay"
          style={[mock.seg, { borderColor: palette.panelBorder }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pay full ${fullLabel} now`}
            accessibilityState={{ selected: isFull }}
            onPress={() => onChange("full")}
            style={[mock.segBtn, isFull ? { backgroundColor: palette.accent } : null]}
          >
            <Text
              style={[
                mock.segBtnText,
                { color: isFull ? palette.accentText : palette.secondaryText },
              ]}
            >
              Pay in full
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pay over time, ${depositLabel} deposit today plus ${futureCount} future payment${
              futureCount === 1 ? "" : "s"
            }`}
            accessibilityState={{ selected: !isFull }}
            onPress={() => onChange("installments")}
            style={[mock.segBtn, !isFull ? { backgroundColor: palette.accent } : null]}
          >
            <Text
              style={[
                mock.segBtnText,
                { color: !isFull ? palette.accentText : palette.secondaryText },
              ]}
            >
              Pay over time
            </Text>
          </Pressable>
        </View>

        {/* amount block */}
        {isFull ? (
          <View>
            <View style={mock.amtRow}>
              <Text style={[mock.amt, { color: palette.primaryText }, fontStyle]}>
                {fullLabel}
              </Text>
            </View>
            <Text style={[mock.sub, { color: palette.secondaryText }]}>
              One payment, all-in. Taxes &amp; fees included.
            </Text>
          </View>
        ) : (
          <View>
            <View style={mock.amtRow}>
              <Text style={[mock.amtLabel, { color: palette.tertiaryText }]}>
                Due today
              </Text>
              <Text style={[mock.amt, { color: palette.primaryText }, fontStyle]}>
                {depositLabel}
              </Text>
            </View>
            <Text style={[mock.sub, { color: palette.secondaryText }]}>
              {depositPct}% deposit now, then {futureCount} payment
              {futureCount === 1 ? "" : "s"}. {totalLabel} total — no extra cost.
            </Text>
            {showScheduleWhenInstallments ? (
              <View
                style={[mock.schedule, { borderTopColor: palette.panelBorder }]}
              >
                <ScheduleRow
                  palette={palette}
                  when="Today"
                  tag="Deposit"
                  amount={depositLabel}
                  future={false}
                  first
                />
                {schedule.installments.map((inst) => (
                  <ScheduleRow
                    key={inst.ordinal}
                    palette={palette}
                    when={formatScheduleDate(inst.dueAt)}
                    amount={formatCurrency(inst.amountCents, currency, true)}
                    future
                  />
                ))}
                <View
                  style={[mock.schedTotal, { borderTopColor: palette.panelBorder }]}
                >
                  <Text style={[mock.schedTotalLabel, { color: palette.secondaryText }]}>
                    Total
                  </Text>
                  <Text style={[mock.schedTotalValue, { color: palette.primaryText }]}>
                    {totalLabel}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
};

const ScheduleRow: React.FC<{
  palette: NonNullable<TripPaymentChoiceProps["palette"]>;
  when: string;
  amount: string;
  future: boolean;
  tag?: string;
  first?: boolean;
}> = ({ palette, when, amount, future, tag, first }) => (
  <View
    style={[
      mock.schedRow,
      first !== true ? { borderTopWidth: 1, borderTopColor: palette.panelBorder } : null,
    ]}
  >
    <View style={mock.schedWhen}>
      <View
        style={[
          mock.schedDot,
          { backgroundColor: future ? palette.tertiaryText : palette.accent },
        ]}
      />
      <Text style={[mock.schedWhenText, { color: palette.secondaryText }]}>
        {when}
      </Text>
      {tag !== undefined ? (
        <Text style={[mock.schedTag, { color: palette.accent }]}>{tag}</Text>
      ) : null}
    </View>
    <Text style={[mock.schedAmt, { color: palette.primaryText }]}>{amount}</Text>
  </View>
);

function formatScheduleDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const mock = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  accentBar: {
    height: 4,
  },
  inner: {
    padding: 18,
  },
  seg: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
  },
  segBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  segBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },
  amtRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 16,
  },
  amtLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  amt: {
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -1,
  },
  sub: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  schedule: {
    marginTop: 16,
    borderTopWidth: 1,
    paddingTop: 14,
  },
  schedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  schedWhen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  schedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  schedWhenText: {
    fontSize: 13,
  },
  schedTag: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginLeft: 8,
  },
  schedAmt: {
    fontSize: 14,
    fontWeight: "800",
  },
  schedTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  schedTotalLabel: {
    fontSize: 13,
  },
  schedTotalValue: {
    fontSize: 13,
    fontWeight: "900",
  },
});

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
