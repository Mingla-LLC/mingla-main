/**
 * Issue #4522 slice 3 — Host payment-plan v2 editor.
 *
 * This module is the feature's single lazy owner. PaymentPlanPreview is a
 * static child of this chunk (never a nested lazy boundary).
 */

import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

import { color, materials, radius, space, type } from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { PaymentPlanPreview } from "./PaymentPlanPreview";
import type {
  TripPlanV2EditorRuntime,
  TripPaymentPlanV2,
} from "./tripPlanV2EditorModel";

export interface PaymentPlanEditorV2Props {
  value: TripPaymentPlanV2;
  onChange: (next: TripPaymentPlanV2) => void;
  totalAmountMinor: number;
  currency: string;
  tripStartAt: string | null;
  timeZone: string | null;
  locked?: boolean;
  lockedReason?: string;
  packageCount: number;
  sharePaymentPlan: boolean;
  onSharePaymentPlanChange: (next: boolean) => void;
  showShareControl: boolean;
  model: TripPlanV2EditorRuntime;
}

const PRESETS = [3, 4, 6] as const;

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(amountMinor / 100),
      currency,
    );
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const digits = (value: string): number => {
  const cleaned = value.replace(/[^0-9]/g, "");
  return cleaned.length === 0 ? 0 : Number.parseInt(cleaned, 10);
};

const moneyInputToMinor = (value: string): number => {
  const clean = value.replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const ToggleRow: React.FC<{
  label: string;
  help: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  testID: string;
}> = ({ label, help, value, onValueChange, disabled, testID }) => (
  <View style={styles.toggleRow} testID={testID}>
    <View style={styles.toggleCopy}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.help}>{help}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: color.fill.step, true: color.accent }}
      thumbColor={color.paper}
      accessibilityLabel={label}
    />
  </View>
);

export const PaymentPlanEditorV2: React.FC<PaymentPlanEditorV2Props> = ({
  value,
  onChange,
  totalAmountMinor,
  currency,
  tripStartAt,
  timeZone,
  locked = false,
  lockedReason,
  packageCount,
  sharePaymentPlan,
  onSharePaymentPlanChange,
  showShareControl,
  model,
}) => {
  const validation = useMemo(
    () =>
      model.validateTripPaymentPlanV2(
        value,
        totalAmountMinor,
        formatMoney(totalAmountMinor, currency),
      ),
    [currency, model, totalAmountMinor, value],
  );
  const depositMinor = model.depositMinorForPlan(value, totalAmountMinor);
  const customOn = Array.isArray(value.custom_amounts_minor);
  const customFallback = Math.max(
    100,
    Math.floor(Math.max(0, totalAmountMinor - depositMinor) / value.count / 100) * 100,
  );

  const setCount = (nextCount: number): void => {
    const count = Math.max(1, Math.min(12, Math.round(nextCount)));
    onChange({
      ...value,
      count,
      ...(customOn
        ? {
            custom_amounts_minor: model.resizeCustomAmountsMinor(
              value.custom_amounts_minor,
              count,
              customFallback,
            ),
          }
        : {}),
    });
  };

  if (locked) {
    return (
      <GlassCard variant="elevated" padding={space[4]} style={styles.card}>
        <Text style={styles.lockedTitle}>Payment plan</Text>
        <Text style={styles.lockedCopy} testID="trip-plan-v2-locked">
          {lockedReason ?? "Payment plan locked — travelers have booked under this setup."}
        </Text>
        <View style={styles.summaryRow}>
          <Text style={styles.help}>Deposit at booking</Text>
          <Text style={styles.summaryAmount}>{formatMoney(depositMinor, currency)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.help}>Remaining payments</Text>
          <Text style={styles.summaryAmount}>{value.count}</Text>
        </View>
      </GlassCard>
    );
  }

  return (
    <GlassCard
      variant="elevated"
      padding={space[4]}
      style={styles.card}
      testID="payment-plan-editor-v2"
    >
      <Text style={styles.sectionTitle}>Deposit at booking</Text>
      <View accessibilityRole="tablist" style={styles.segmented}>
        {(["amount", "percent"] as const).map((mode) => {
          const selected = value.deposit.mode === mode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="tab"
              accessibilityLabel={mode === "amount" ? "Amount" : "Percent"}
              accessibilityState={{ selected }}
              onPress={() => {
                if (selected) return;
                onChange({
                  ...value,
                  deposit: mode === "amount"
                    ? {
                        mode: "amount",
                        amount_minor: Math.max(100, depositMinor),
                      }
                    : {
                        mode: "percent",
                        pct: totalAmountMinor > 0
                          ? Math.max(1, Math.min(100, Math.round(depositMinor / totalAmountMinor * 100)))
                          : 25,
                      },
                });
              }}
              style={[styles.segment, selected && styles.segmentOn]}
              testID={`trip-plan-v2-deposit-${mode}`}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>
                {mode === "amount" ? "Amount" : "Percent"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.inputWithSuffix}>
        <TextInput
          value={
            value.deposit.mode === "amount"
              ? (value.deposit.amount_minor / 100).toFixed(2)
              : String(value.deposit.pct)
          }
          onChangeText={(text) =>
            onChange({
              ...value,
              deposit: value.deposit.mode === "amount"
                ? { mode: "amount", amount_minor: moneyInputToMinor(text) }
                : { mode: "percent", pct: digits(text) },
            })
          }
          keyboardType="decimal-pad"
          accessibilityLabel="Deposit at booking"
          style={styles.input}
          testID="trip-plan-v2-deposit-input"
        />
        <Text style={styles.suffix}>
          {value.deposit.mode === "amount" ? currency.toUpperCase() : "%"}
        </Text>
      </View>
      <Text style={styles.help}>
        Traveler pays {formatMoney(Math.max(0, depositMinor), currency)} today.
      </Text>

      <Text style={styles.sectionTitle}>Split the rest into</Text>
      <View style={styles.pills}>
        {PRESETS.map((count) => (
          <Pressable
            key={count}
            onPress={() => setCount(count)}
            accessibilityRole="button"
            accessibilityLabel={`${count} payments`}
            accessibilityState={{ selected: value.count === count }}
            style={[styles.pill, value.count === count && styles.pillOn]}
            testID={`trip-plan-v2-count-${count}`}
          >
            <Text style={[styles.pillText, value.count === count && styles.pillTextOn]}>
              {count}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setCount(PRESETS.includes(value.count as 3 | 4 | 6) ? 5 : value.count)}
          accessibilityRole="button"
          accessibilityState={{ selected: !PRESETS.includes(value.count as 3 | 4 | 6) }}
          style={[
            styles.pill,
            !PRESETS.includes(value.count as 3 | 4 | 6) && styles.pillOn,
          ]}
          testID="trip-plan-v2-count-custom"
        >
          <Text
            style={[
              styles.pillText,
              !PRESETS.includes(value.count as 3 | 4 | 6) && styles.pillTextOn,
            ]}
          >
            Custom
          </Text>
        </Pressable>
      </View>
      {!PRESETS.includes(value.count as 3 | 4 | 6) ? (
        <View style={styles.stepper}>
          <Pressable
            onPress={() => setCount(value.count - 1)}
            disabled={value.count <= 1}
            accessibilityRole="button"
            accessibilityLabel="Fewer payments"
            style={styles.stepperButton}
          >
            <Text style={styles.stepperText}>−</Text>
          </Pressable>
          <Text style={styles.stepperValue}>{value.count} payments</Text>
          <Pressable
            onPress={() => setCount(value.count + 1)}
            disabled={value.count >= 12}
            accessibilityRole="button"
            accessibilityLabel="More payments"
            style={styles.stepperButton}
          >
            <Text style={styles.stepperText}>+</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Final payment due</Text>
      <View style={styles.inputWithSuffix}>
        <TextInput
          value={String(value.final_due_days_before_start)}
          onChangeText={(text) =>
            onChange({ ...value, final_due_days_before_start: digits(text) })
          }
          keyboardType="number-pad"
          accessibilityLabel="Days before departure for final payment"
          style={styles.input}
          testID="trip-plan-v2-final-days"
        />
        <Text style={styles.suffix}>days before departure</Text>
      </View>

      <ToggleRow
        label="Adjust automatically for late bookings"
        help="Fewer payments, at least 7 days apart. Inside the last window travelers pay in full."
        value={value.auto_adjust !== false}
        onValueChange={(next) => onChange({ ...value, auto_adjust: next })}
        testID="trip-plan-v2-auto-adjust"
      />
      <ToggleRow
        label="Let travelers pay any amount toward their balance"
        help="Their later payments shrink to match."
        value={value.flex?.enabled === true}
        onValueChange={(next) =>
          onChange({
            ...value,
            flex: next
              ? {
                  enabled: true,
                  min_payment_minor: model.defaultFlexMinimumMinor(value, totalAmountMinor),
                }
              : { enabled: false },
          })
        }
        testID="trip-plan-v2-flex"
      />
      {value.flex?.enabled === true ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Smallest payment they can make</Text>
          <View style={styles.inputWithSuffix}>
            <TextInput
              value={(value.flex.min_payment_minor / 100).toFixed(2)}
              onChangeText={(text) =>
                onChange({
                  ...value,
                  flex: { enabled: true, min_payment_minor: moneyInputToMinor(text) },
                })
              }
              keyboardType="decimal-pad"
              accessibilityLabel="Smallest flexible payment"
              style={styles.input}
              testID="trip-plan-v2-flex-min"
            />
            <Text style={styles.suffix}>{currency.toUpperCase()}</Text>
          </View>
        </View>
      ) : null}

      {showShareControl && packageCount > 1 ? (
        <ToggleRow
          label="Use this plan for all packages"
          help="Changes to this plan update every package."
          value={sharePaymentPlan}
          onValueChange={onSharePaymentPlanChange}
          testID="trip-plan-v2-share"
        />
      ) : null}

      <ToggleRow
        label="Advanced: set each payment's amount"
        help="Custom amounts. The last payment balances itself."
        value={customOn}
        onValueChange={(next) =>
          onChange({
            ...value,
            custom_amounts_minor: next
              ? model.defaultCustomAmountsMinor(value, totalAmountMinor)
              : null,
          })
        }
        testID="trip-plan-v2-custom"
      />
      {customOn ? (
        <View style={styles.customRows}>
          {value.custom_amounts_minor?.map((amount, index) => (
            <View key={index} style={styles.customRow}>
              <Text style={styles.help}>Payment {index + 1}</Text>
              <TextInput
                value={(amount / 100).toFixed(2)}
                onChangeText={(text) => {
                  const next = [...(value.custom_amounts_minor ?? [])];
                  next[index] = moneyInputToMinor(text);
                  onChange({ ...value, custom_amounts_minor: next });
                }}
                keyboardType="decimal-pad"
                accessibilityLabel={`Custom payment ${index + 1}`}
                style={styles.customInput}
                testID={`trip-plan-v2-custom-${index}`}
              />
            </View>
          ))}
          <View style={styles.customRow}>
            <Text style={styles.help}>Final payment</Text>
            <Text style={styles.summaryAmount} testID="trip-plan-v2-custom-final">
              {formatMoney(validation.customFinalMinor ?? validation.balanceMinor, currency)}
            </Text>
          </View>
        </View>
      ) : null}

      {!validation.ok ? (
        <Text accessibilityRole="alert" style={styles.error} testID="trip-plan-v2-error">
          {validation.message}
        </Text>
      ) : null}

      <PaymentPlanPreview
        plan={value}
        totalAmountMinor={totalAmountMinor}
        currency={currency}
        tripStartAt={tripStartAt}
        timeZone={timeZone}
      />
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  card: { gap: space[4] },
  sectionTitle: { fontSize: type.body.fontSize, fontWeight: "700", color: color.text1 },
  fieldLabel: { fontSize: type.small.fontSize, fontWeight: "600", color: color.text1 },
  fieldGroup: { gap: space[2] },
  help: { flex: 1, fontSize: type.caption.fontSize, lineHeight: 18, color: color.text2 },
  segmented: {
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: color.fill.step,
  },
  segment: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  // #4522 S-7 — the house selected surface (as the discount controls use):
  // the selected label is light on a dark selected fill, never on paper white.
  segmentOn: {
    backgroundColor: materials.selected.solidFill,
    borderWidth: 1,
    borderColor: materials.selected.rim.edge,
    borderTopColor: materials.selected.rim.top ?? materials.selected.rim.edge,
  },
  segmentText: { fontSize: type.small.fontSize, color: color.text2 },
  segmentTextOn: { color: color.textStrong, fontWeight: "700" },
  inputWithSuffix: { flexDirection: "row", alignItems: "center", gap: space[2] },
  input: {
    flex: 1,
    // #4522 W-7 — a web text field will not shrink below its default width
    // unless told it may; beside a suffix it pushed the row past a 375 px card.
    minWidth: 0,
    minHeight: 46,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  suffix: { maxWidth: "55%", flexShrink: 1, fontSize: type.small.fontSize, color: color.text2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  pill: {
    minWidth: 54,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tableHead,
  },
  pillOn: { borderColor: color.accent, backgroundColor: color.accentTint },
  pillText: { fontSize: type.small.fontSize, color: color.text2 },
  pillTextOn: { color: color.text1, fontWeight: "700" },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[3] },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
  },
  stepperText: { fontSize: 21, fontWeight: "700", color: color.text1 },
  stepperValue: { minWidth: 100, textAlign: "center", fontSize: type.body.fontSize, color: color.text1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  toggleCopy: { flex: 1, gap: 2 },
  customRows: { gap: space[2] },
  customRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  customInput: {
    width: 120,
    minHeight: 42,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
    color: color.text1,
    textAlign: "right",
  },
  error: {
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.errorLine,
    backgroundColor: color.errorTint,
    color: color.errorText,
    fontSize: type.small.fontSize,
  },
  lockedTitle: { fontSize: type.body.fontSize, fontWeight: "700", color: color.text1 },
  lockedCopy: { fontSize: type.small.fontSize, color: color.text2 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  summaryAmount: { fontSize: type.small.fontSize, fontWeight: "700", color: color.text1 },
});

export default PaymentPlanEditorV2;
