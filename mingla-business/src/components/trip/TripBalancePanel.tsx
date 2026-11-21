import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  aggregateTripBalanceSchedule,
  rebalanceTripPlan,
  type TripBalance,
  type TripBalanceChoice,
  tripBalanceOptions,
} from "@mingla/offering-rendering/tripBalance";

import { radius, space, type } from "../../constants/designSystem";
import { color, themedStyles } from "../../theme/surfaceTokens";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { formatCurrency } from "../../utils/currency";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

export function balanceMoney(amountMinor: number, currency: string): string {
  return withCurrencyGlyph(
    formatCurrency(amountMinor, currency, true),
    currency,
  );
}

const due = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
      .format(date);
};

interface Props {
  balance: TripBalance;
  tripTitle: string;
  brandName?: string;
  choice: TripBalanceChoice;
  customAmount: string;
  amountMinor: number | null;
  customError?: string | null;
  busy?: boolean;
  onChoice: (choice: TripBalanceChoice) => void;
  onCustomAmount: (value: string) => void;
  onPay: () => void;
}

export function TripBalancePanel({
  balance,
  tripTitle,
  brandName,
  choice,
  customAmount,
  amountMinor,
  customError,
  busy = false,
  onChoice,
  onCustomAmount,
  onPay,
}: Props): React.ReactElement {
  const styles = balanceStyles;
  const options = tripBalanceOptions(balance);
  const after = useMemo(
    () =>
      amountMinor === null ? balance.openRows : rebalanceTripPlan(
        balance.openRows,
        amountMinor,
        balance.minPaymentMinor,
      ),
    [amountMinor, balance.minPaymentMinor, balance.openRows],
  );
  const progress = balance.totalMinor > 0
    ? Math.min(100, Math.max(0, (balance.paidMinor / balance.totalMinor) * 100))
    : 100;
  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{brandName ?? "MINGLA TRIP"}</Text>
        <Text style={styles.trip}>{tripTitle}</Text>
        <Text style={styles.label}>Balance remaining</Text>
        <Text
          accessibilityLabel={`${
            balanceMoney(balance.remainingMinor, balance.currency)
          } remaining`}
          style={styles.balance}
        >
          {balanceMoney(balance.remainingMinor, balance.currency)}
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: balance.totalMinor,
            now: balance.paidMinor,
          }}
          style={styles.track}
        >
          <View style={[styles.progress, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressCopy}>
          {balanceMoney(balance.paidMinor, balance.currency)} paid of{" "}
          {balanceMoney(balance.totalMinor, balance.currency)}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Choose what to pay</Text>
        <View style={styles.options}>
          {options.map((option) => {
            const selected = choice === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: selected }}
                onPress={() => onChoice(option.key)}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionAmount}>
                  {option.amountMinor === null
                    ? "Enter amount"
                    : balanceMoney(option.amountMinor, balance.currency)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {choice === "other"
          ? (
            <View style={styles.custom}>
              <Input
                accessibilityLabel="Other payment amount"
                variant="number"
                onChangeText={onCustomAmount}
                placeholder="0.00"
                value={customAmount}
              />
              {customError
                ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {customError}
                  </Text>
                )
                : null}
            </View>
          )
          : null}
        {choice !== "other" && customError
          ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {customError}
            </Text>
          )
          : null}
      </View>

      {amountMinor !== null
        ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Your remaining payments update after you pay
            </Text>
            <View style={styles.scheduleColumns}>
              <Schedule
                title="Now"
                rows={aggregateTripBalanceSchedule(balance.openRows)}
                currency={balance.currency}
              />
              <Schedule
                title={`After paying ${
                  balanceMoney(amountMinor, balance.currency)
                }`}
                rows={after}
                currency={balance.currency}
              />
            </View>
          </View>
        )
        : null}

      {balance.history.length > 0
        ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Paid so far</Text>
            {balance.history.map((row) => (
              <View key={row.installmentId} style={styles.historyRow}>
                <Text style={styles.muted}>
                  {row.kind === "deposit" ? "Deposit" : "Payment"}
                </Text>
                <Text style={styles.historyAmount}>
                  {balanceMoney(row.amountMinor, balance.currency)}
                </Text>
              </View>
            ))}
          </View>
        )
        : null}

      <Button
        disabled={busy || amountMinor === null || balance.paymentInFlight}
        fullWidth
        label={busy
          ? "Starting payment…"
          : amountMinor === null
          ? "Choose an amount"
          : `Pay ${balanceMoney(amountMinor, balance.currency)}`}
        onPress={onPay}
        size="lg"
      />
      {balance.paymentInFlight
        ? (
          <Text style={styles.notice}>
            A payment on this trip is already processing. Check again in a
            moment.
          </Text>
        )
        : null}
    </View>
  );
}

function Schedule(
  { title, rows, currency }: {
    title: string;
    rows: TripBalance["openRows"];
    currency: string;
  },
): React.ReactElement {
  const styles = balanceStyles;
  return (
    <View style={styles.schedule}>
      <Text style={styles.scheduleTitle}>{title}</Text>
      {rows.length === 0
        ? <Text style={styles.paidFull}>Paid in full</Text>
        : rows.map((row) => (
          <View key={row.installmentId} style={styles.scheduleRow}>
            <Text style={styles.muted}>{due(row.dueAt)}</Text>
            <Text style={styles.scheduleAmount}>
              {balanceMoney(row.amountMinor, currency)}
            </Text>
          </View>
        ))}
    </View>
  );
}

const balanceStyles = themedStyles(() =>
  StyleSheet.create({
    stack: { width: "100%", gap: space[5] },
    hero: {
      padding: space[6],
      borderRadius: radius.lg,
      backgroundColor: color.card,
      borderWidth: 1,
      borderColor: color.lineStrong,
    },
    eyebrow: {
      ...type.small,
      color: color.accent,
      fontWeight: "800",
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
    trip: { ...type.h2, color: color.text1, marginTop: space[2] },
    label: { ...type.small, color: color.text3, marginTop: space[6] },
    balance: { ...type.display, color: color.text1, marginTop: space[1] },
    track: {
      height: 8,
      borderRadius: radius.full,
      backgroundColor: color.fill.inset,
      overflow: "hidden",
      marginTop: space[4],
    },
    progress: {
      height: "100%",
      borderRadius: radius.full,
      backgroundColor: color.accent,
    },
    progressCopy: { ...type.small, color: color.text2, marginTop: space[2] },
    section: {
      padding: space[5],
      borderRadius: radius.lg,
      backgroundColor: color.card,
      borderWidth: 1,
      borderColor: color.lineStrong,
      gap: space[4],
    },
    sectionTitle: { ...type.h2, color: color.text1 },
    options: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
    option: {
      flexGrow: 1,
      flexBasis: "45%",
      minHeight: 84,
      padding: space[4],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.controlOutline,
      backgroundColor: color.fill.input,
      justifyContent: "space-between",
    },
    optionSelected: {
      borderColor: color.accent,
      backgroundColor: color.fill.step,
    },
    optionLabel: { ...type.small, color: color.text2, fontWeight: "700" },
    optionAmount: { ...type.h2, color: color.text1, marginTop: space[2] },
    pressed: { opacity: 0.72 },
    custom: { gap: space[2] },
    error: { ...type.small, color: color.errorText },
    scheduleColumns: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: space[3],
    },
    schedule: {
      flex: 1,
      padding: space[3],
      borderRadius: radius.md,
      backgroundColor: color.fill.inset,
      gap: space[3],
    },
    scheduleTitle: { ...type.small, color: color.text2, fontWeight: "800" },
    scheduleRow: { gap: 2 },
    scheduleAmount: { ...type.body, color: color.text1, fontWeight: "800" },
    muted: { ...type.small, color: color.text3 },
    paidFull: { ...type.body, color: color.successText, fontWeight: "800" },
    historyRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: space[3],
    },
    historyAmount: { ...type.body, color: color.text1, fontWeight: "700" },
    notice: { ...type.small, color: color.text2, textAlign: "center" },
  })
);
