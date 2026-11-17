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
import { StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "./themePalette";
// #3372 — naira shows "₦", not "NGN", whatever the engine or locale (#3341 rule).
import { withCurrencyGlyph } from "./currencyGlyph";
import type { ProjectedTripSchedule } from "./tripOfferingTypes";
import { accentFill } from "./themeAccentStyle";
import { OfferingRadioCard } from "./OfferingDecideParts";

export type TripPaymentPlanChoice = "full" | "installments";

function formatMoneyExact(cents: number, currency: string): string {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2,
      }).format(cents / 100),
      currency,
    );
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
  // issue #4420 — two whole-card choices (design file → P.trip "How you
  // pay"): "Pay over time" with the deposit as its amount and the schedule
  // under it once chosen, then "Pay in full". Same values, same math, same
  // onChange; the segmented tabs became radio cards.
  const overTimeDetail = `${resolvedPct}% deposit now, then ${futureCount} payment${
    futureCount === 1 ? "" : "s"
  }. ${fullLabel} total, no extra cost.`;
  return (
    <View
      style={styles.choices}
      accessibilityRole="radiogroup"
      accessibilityLabel="How you pay"
      testID={testID}
    >
      <OfferingRadioCard
        palette={palette}
        title="Pay over time"
        detail={overTimeDetail}
        price={depositLabel}
        selected={!isFull}
        onPress={() => onChange("installments")}
        fontFamily={fontFamily}
        accessibilityLabel={`Pay over time, ${depositLabel} deposit today plus ${futureCount} future payment${
          futureCount === 1 ? "" : "s"
        }`}
        testID={testID !== undefined ? `${testID}-over-time` : undefined}
      >
        {!isFull && showScheduleWhenInstallments ? (
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
      </OfferingRadioCard>
      <OfferingRadioCard
        palette={palette}
        title="Pay in full"
        detail="One payment, all-in. Taxes & fees included."
        price={fullLabel}
        selected={isFull}
        onPress={() => onChange("full")}
        fontFamily={fontFamily}
        accessibilityLabel={`Pay full ${fullLabel} now`}
        testID={testID !== undefined ? `${testID}-full` : undefined}
      />
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
          (future ? { backgroundColor: palette.tertiaryText } : accentFill(palette)),
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
  choices: { gap: 10 },
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
