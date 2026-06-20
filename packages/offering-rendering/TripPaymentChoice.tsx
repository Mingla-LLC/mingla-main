/**
 * TripPaymentChoice — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * THE ONE promoted "Choose how you pay" box (the palette `PaymentMockupCard` path
 * of the business `mingla-business/src/components/trip/TripPaymentChoice.tsx`,
 * lifted into the shared package + the consumer's ~190-line inline re-implementation
 * (ConsumerTripDetailScreen :1035-1228) RETIRED — one owner, one math, one copy).
 *
 * Pure-presentational (I-MOR-0827): segmented Pay-in-full/Pay-over-time TAB toggle,
 * the 34px amount block, the schedule rows + total, the locked copy. Returns null
 * when `schedule === null` (no-plan → the caller renders the quiet price recap).
 *
 * NOTE: the business-local TripPaymentChoice.tsx STAYS for its NO-PALETTE callers
 * (/checkout-trip/payment + wizard Step-5, byte-identical to pre-1138, RT-2). The
 * public trip page's §10 box uses THIS package version.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "./themePalette";
import type { ProjectedTripSchedule } from "./tripOfferingTypes";

export type TripPaymentPlanChoice = "full" | "installments";

function formatMoneyExact(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

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

export interface TripPaymentChoiceProps {
  /** The projected schedule for the selected tier. null → renders nothing. */
  schedule: ProjectedTripSchedule | null;
  /** ISO 4217 currency code. */
  currency: string;
  /** Deposit percentage (derived from amounts when 0 is passed — never hardcoded). */
  depositPct: number;
  value: TripPaymentPlanChoice;
  onChange: (value: TripPaymentPlanChoice) => void;
  palette: ThemePalette;
  fontFamily?: string;
  /** Render the schedule ladder under the over-time option (default true). */
  showScheduleWhenInstallments?: boolean;
  testID?: string;
}

export const TripPaymentChoice: React.FC<TripPaymentChoiceProps> = ({
  schedule,
  currency,
  depositPct,
  value,
  onChange,
  palette,
  fontFamily,
  showScheduleWhenInstallments = true,
  testID,
}) => {
  if (schedule === null) return null;

  const isFull = value === "full";
  const fullLabel = formatMoneyExact(schedule.fullPriceCents, currency);
  const depositLabel = formatMoneyExact(schedule.depositCents, currency);
  const futureCount = schedule.installments.length;
  // derive pct from amounts when the caller passes 0 (never hardcoded/fabricated).
  const resolvedPct =
    depositPct > 0
      ? depositPct
      : schedule.fullPriceCents > 0
        ? Math.round((schedule.depositCents / schedule.fullPriceCents) * 100)
        : 0;
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder },
      ]}
      testID={testID}
    >
      <View style={[styles.accentBar, { backgroundColor: palette.accent }]} />
      <View style={styles.inner}>
        {/* segmented TAB toggle */}
        <View
          accessibilityRole="tablist"
          accessibilityLabel="How you pay"
          style={[styles.seg, { borderColor: palette.panelBorder }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pay full ${fullLabel} now`}
            accessibilityState={{ selected: isFull }}
            onPress={() => onChange("full")}
            style={[styles.segBtn, isFull ? { backgroundColor: palette.accent } : null]}
          >
            <Text
              style={[
                styles.segBtnText,
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
            style={[styles.segBtn, !isFull ? { backgroundColor: palette.accent } : null]}
          >
            <Text
              style={[
                styles.segBtnText,
                { color: !isFull ? palette.accentText : palette.secondaryText },
              ]}
            >
              Pay over time
            </Text>
          </Pressable>
        </View>

        {isFull ? (
          <View>
            <View style={styles.amtRow}>
              <Text style={[styles.amt, { color: palette.primaryText }, fontStyle]}>
                {fullLabel}
              </Text>
            </View>
            <Text style={[styles.sub, { color: palette.secondaryText }]}>
              One payment, all-in. Taxes &amp; fees included.
            </Text>
          </View>
        ) : (
          <View>
            <View style={styles.amtRow}>
              <Text style={[styles.amtLabel, { color: palette.tertiaryText }]}>
                Due today
              </Text>
              <Text style={[styles.amt, { color: palette.primaryText }, fontStyle]}>
                {depositLabel}
              </Text>
            </View>
            <Text style={[styles.sub, { color: palette.secondaryText }]}>
              {resolvedPct}% deposit now, then {futureCount} payment
              {futureCount === 1 ? "" : "s"}. {fullLabel} total — no extra cost.
            </Text>
            {showScheduleWhenInstallments ? (
              <View style={[styles.schedule, { borderTopColor: palette.panelBorder }]}>
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
                    when={formatScheduleDate(inst.dueAtIso)}
                    amount={formatMoneyExact(inst.amountCents, currency)}
                    future
                  />
                ))}
                <View style={[styles.schedTotal, { borderTopColor: palette.panelBorder }]}>
                  <Text style={[styles.schedTotalLabel, { color: palette.secondaryText }]}>
                    Total
                  </Text>
                  <Text style={[styles.schedTotalValue, { color: palette.primaryText }]}>
                    {fullLabel}
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
  palette: ThemePalette;
  when: string;
  amount: string;
  future: boolean;
  tag?: string;
  first?: boolean;
}> = ({ palette, when, amount, future, tag, first }) => (
  <View
    style={[
      styles.schedRow,
      first !== true
        ? { borderTopWidth: 1, borderTopColor: palette.panelBorder }
        : null,
    ]}
  >
    <View style={styles.schedWhen}>
      <View
        style={[
          styles.schedDot,
          { backgroundColor: future ? palette.tertiaryText : palette.accent },
        ]}
      />
      <Text style={[styles.schedWhenText, { color: palette.secondaryText }]}>
        {when}
      </Text>
      {tag !== undefined ? (
        <Text style={[styles.schedTag, { color: palette.accent }]}>{tag}</Text>
      ) : null}
    </View>
    <Text style={[styles.schedAmt, { color: palette.primaryText }]}>{amount}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  accentBar: { height: 4 },
  inner: { padding: 18 },
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
  segBtnText: { fontSize: 13, fontWeight: "800" },
  amtRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 16 },
  amtLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  amt: { fontSize: 34, fontWeight: "900", letterSpacing: -1 },
  sub: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  schedule: { marginTop: 16, borderTopWidth: 1, paddingTop: 14 },
  schedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  schedWhen: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  schedDot: { width: 8, height: 8, borderRadius: 4 },
  schedWhenText: { fontSize: 13 },
  schedTag: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginLeft: 8,
  },
  schedAmt: { fontSize: 14, fontWeight: "800" },
  schedTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  schedTotalLabel: { fontSize: 13 },
  schedTotalValue: { fontSize: 13, fontWeight: "900" },
});

export default TripPaymentChoice;
