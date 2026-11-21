/**
 * issue #4522 — checkout disclosure for the database-planned N-payment plan.
 * The component formats server values only; it never creates a schedule or
 * changes an amount. Missing/malformed plan truth renders nothing.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type {
  InstallmentChargeSchedule,
} from "@mingla/offering-rendering/discountQuote";
import type {
  TicketQuotePlanV2,
  TicketQuotePlanV2Availability,
} from "@mingla/offering-rendering/ticketQuotePlanV2Contract";

import { space } from "../../constants/designSystem";
import { color, themedStyles } from "../../theme/surfaceTokens";
import { formatCurrency } from "../../utils/currency";
import {
  AddOnPlanChoice,
  type AddOnPlanChoiceProps,
} from "./AddOnPlanChoice";

export type TripPlanV2CheckoutChoiceValue = "full" | "installments";

export interface TripPlanV2CheckoutChoiceProps {
  plan: TicketQuotePlanV2 | undefined;
  value: TripPlanV2CheckoutChoiceValue;
  onChange: (choice: TripPlanV2CheckoutChoiceValue) => void;
  currency: string;
  dueTodayCents: number | undefined;
  fullPriceCents: number | undefined;
  lockedChargeSchedule?: InstallmentChargeSchedule;
  addOnPlan?: AddOnPlanChoiceProps;
  flexEnabled: boolean;
  daysUntilDeparture: number;
  timeZone: string;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function tripPlanV2AvailabilityCopy(
  availability: Exclude<TicketQuotePlanV2Availability, "plan">,
  daysUntilDeparture: number,
): string {
  if (availability === "full_window") {
    return `You're booking within ${Math.max(0, Math.floor(daysUntilDeparture))} days of departure, so the trip is paid in full today.`;
  }
  if (availability === "closed") {
    return "This trip has already departed, so a payment plan is no longer available.";
  }
  return "This booking date only allows paying in full.";
}

const planDate = (iso: string, timeZone: string): string => {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timeZone.trim().length > 0 ? timeZone : "UTC",
    })
      .format(new Date(parsed))
      .replace(",", "");
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    })
      .format(new Date(parsed))
      .replace(",", "");
  }
};

export const TripPlanV2CheckoutChoice: React.FC<
  TripPlanV2CheckoutChoiceProps
> = ({
  plan,
  value,
  onChange,
  currency,
  dueTodayCents,
  fullPriceCents,
  lockedChargeSchedule,
  addOnPlan,
  flexEnabled,
  daysUntilDeparture,
  timeZone,
  loading = false,
  disabled = false,
  testID = "trip-plan-v2-checkout-choice",
}) => {
  const s = styles;
  if (loading) {
    return (
      <View
        style={s.card}
        accessibilityRole="progressbar"
        testID={`${testID}-loading`}
      >
        <Text style={s.kicker}>HOW YOU PAY</Text>
        <View style={s.skeletonWide} />
        <View style={s.skeletonShort} />
        {addOnPlan !== undefined ? (
          <AddOnPlanChoice {...addOnPlan} loading disabled />
        ) : null}
        <Text style={s.loadingText}>Working out your payments…</Text>
      </View>
    );
  }
  if (plan === undefined) return null;
  if (plan.availability !== "plan") {
    return (
      <View
        style={[s.card, s.infoCard]}
        accessibilityRole="alert"
        testID={`${testID}-full-only`}
      >
        <Text style={s.kicker}>PAYMENT PLAN</Text>
        <Text style={s.infoText}>
          {tripPlanV2AvailabilityCopy(plan.availability, daysUntilDeparture)}
        </Text>
      </View>
    );
  }
  if (plan.installmentSchedule === null) return null;

  const schedule = plan.installmentSchedule;
  const installments =
    lockedChargeSchedule?.payments.map((payment) => ({
      ordinal: payment.ordinal,
      dueAt: payment.dueAt,
      amountCents: payment.buyerTotalCents,
    })) ?? schedule.installments;
  const depositCents =
    value === "installments" && dueTodayCents !== undefined
      ? dueTodayCents
      : schedule.depositCents;
  const depositLabel = formatCurrency(depositCents, currency, true);
  const fullLabel =
    fullPriceCents === undefined
      ? null
      : formatCurrency(fullPriceCents, currency, true);
  const finalDate = planDate(schedule.finalDueAt, timeZone);
  const planLabel = `Pay ${depositLabel} today, then ${installments.length} payment${
    installments.length === 1 ? "" : "s"
  }`;
  const controlsDisabled = disabled || loading;

  return (
    <View style={s.card} testID={testID}>
      <Text style={s.kicker}>HOW YOU PAY</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="How you pay"
        style={s.choices}
      >
        <PlanRadio
          title="Pay in full"
          detail={
            fullLabel === null ? "One payment today" : `${fullLabel} today`
          }
          selected={value === "full"}
          disabled={controlsDisabled}
          onPress={() => onChange("full")}
          testID={`${testID}-full`}
        />
        <PlanRadio
          title={planLabel}
          detail={`Last one ${finalDate}`}
          selected={value === "installments"}
          disabled={controlsDisabled}
          onPress={() => onChange("installments")}
          testID={`${testID}-installments`}
        />
      </View>

      {value === "installments" ? (
        <View
          style={s.schedule}
          accessibilityRole="list"
          accessibilityLabel="Payment schedule"
        >
          {addOnPlan !== undefined &&
          addOnPlan.totalCents !== null &&
          addOnPlan.totalCents > 0 ? (
            <AddOnPlanChoice {...addOnPlan} />
          ) : null}
          <ScheduleRow label="Today" amount={depositLabel} />
          {installments.map((installment) => (
            <ScheduleRow
              key={installment.ordinal}
              label={planDate(installment.dueAt, timeZone)}
              amount={formatCurrency(installment.amountCents, currency, true)}
            />
          ))}
          {plan.countGiven < plan.countOffered ? (
            <Text style={s.caption}>
              You booked closer to the trip, so your plan has fewer payments.
            </Text>
          ) : null}
          {flexEnabled ? (
            <Text style={s.caption}>
              You can pay more at any time from My trip.
            </Text>
          ) : null}
          <Text style={s.caption}>
            We&rsquo;ll remind you before each payment.
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const PlanRadio: React.FC<{
  title: string;
  detail: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}> = ({ title, detail, selected, disabled, onPress, testID }) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityState={{ checked: selected, disabled }}
    aria-checked={selected}
    onPress={onPress}
    disabled={disabled}
    style={[styles.choice, selected ? styles.choiceSelected : null]}
    testID={testID}
  >
    <View style={[styles.dot, selected ? styles.dotSelected : null]}>
      {selected ? <View style={styles.dotInner} /> : null}
    </View>
    <View style={styles.choiceCopy}>
      <Text style={styles.choiceTitle}>{title}</Text>
      <Text style={styles.choiceDetail}>{detail}</Text>
    </View>
  </Pressable>
);

const ScheduleRow: React.FC<{ label: string; amount: string }> = ({
  label,
  amount,
}) => (
  <View
    style={styles.scheduleRow}
    accessibilityRole="text"
    accessibilityLabel={`${label}, ${amount}`}
  >
    <Text style={styles.scheduleDate}>{label}</Text>
    <Text style={styles.scheduleAmount}>{amount}</Text>
  </View>
);

const styles = themedStyles(() =>
  StyleSheet.create({
    card: {
      padding: space[4],
      marginBottom: space[4],
      borderRadius: 18,
      borderWidth: 1,
      borderColor: color.controlOutline,
      backgroundColor: color.card,
    },
    infoCard: { backgroundColor: color.card2 },
    kicker: {
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.3,
      color: color.text2,
      marginBottom: space[3],
    },
    choices: { gap: space[2] },
    choice: {
      minHeight: 68,
      padding: space[3],
      borderRadius: 14,
      borderWidth: 1,
      borderColor: color.controlOutline,
      backgroundColor: color.fill.inset,
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
    },
    choiceSelected: {
      borderColor: color.accent,
      backgroundColor: color.accentTint,
    },
    dot: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: color.text3,
      alignItems: "center",
      justifyContent: "center",
    },
    dotSelected: { borderColor: color.accent },
    dotInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: color.accent,
    },
    choiceCopy: { flex: 1, minWidth: 0 },
    choiceTitle: {
      color: color.text1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
    },
    choiceDetail: {
      color: color.text2,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    schedule: {
      marginTop: space[3],
      paddingTop: space[2],
      borderTopWidth: 1,
      borderTopColor: color.line,
      gap: space[1],
    },
    scheduleRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: space[3],
      paddingVertical: space[2],
    },
    scheduleDate: { flex: 1, color: color.text2, fontSize: 13 },
    scheduleAmount: { color: color.text1, fontSize: 14, fontWeight: "700" },
    caption: {
      color: color.text2,
      fontSize: 12,
      lineHeight: 17,
      marginTop: space[1],
    },
    infoText: {
      color: color.text1,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    skeletonWide: {
      height: 52,
      borderRadius: 14,
      backgroundColor: color.fill.inset,
    },
    skeletonShort: {
      width: "68%",
      height: 14,
      borderRadius: 7,
      marginTop: space[3],
      backgroundColor: color.fill.inset,
    },
    loadingText: { color: color.text2, fontSize: 13, marginTop: space[3] },
  }),
);

export default TripPlanV2CheckoutChoice;
