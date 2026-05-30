/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] — <PaymentPlanEditor />.
 *
 * Per SPEC_ORCH-0873 §3.5.1 + DESIGN_ORCH-0873 §3 Mockup A + sticky footer.
 * Renders inside <TripCreatorStep4Pricing /> when the parent toggle is ON
 * (value !== null). Toggle off / on lives on the parent — this component
 * does NOT render the toggle row itself.
 *
 * Lock states (Q6 resolution):
 *  - locked === true + value !== null → read-only banner v3 + collapsed preview.
 *  - locked === true + value === null → render disabled placeholder copy
 *    (parent typically renders the toggle disabled in this state; we render
 *    nothing visible from inside the editor).
 *  - locked === false + value !== null → full editor.
 *
 * 5%-step lock per Q8 resolution. Date monotonicity enforced at UI layer
 * even though backend only catches first-past-due (QA P3-1).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";

// ---------- shape ----------

export interface TripInstallmentSchedule {
  deposit_pct: number;
  installments: Array<{
    ordinal: number;
    pct: number;
    days_after_booking?: number;
    /** ISO date "YYYY-MM-DD" — UTC midnight semantics. */
    fixed_date?: string;
  }>;
}

export interface PaymentPlanEditorProps {
  value: TripInstallmentSchedule | null;
  onChange: (next: TripInstallmentSchedule | null) => void;
  /** Trip full price in minor units (cents). */
  totalAmountCents: number;
  /** 3-letter ISO 4217 currency code from the trip. */
  currency: string;
  /**
   * v1: locked=true renders read-only banner state when at least one buyer
   * has booked under the current schedule (Q6 resolution).
   */
  locked: boolean;
}

// ---------- constants ----------

const DEPOSIT_MIN_PCT = 10;
const DEPOSIT_MAX_PCT = 95;
const DEPOSIT_STEP = 5;
const INSTALLMENT_MIN_PCT = 5;
const INSTALLMENT_STEP = 5;
const MAX_INSTALLMENTS = 11;
const DAYS_MIN = 1;
const DAYS_MAX = 365;
const SUM_TOLERANCE = 0.01;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LOCKED_BANNER_COPY =
  "Payment plan locked — at least one buyer has booked under this schedule. To change pricing, create a new trip.";

// ---------- helpers ----------

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDateForDisplay(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

function todayPlusDays(daysFromToday: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function pctSum(schedule: TripInstallmentSchedule): number {
  return (
    schedule.deposit_pct +
    schedule.installments.reduce((sum, i) => sum + i.pct, 0)
  );
}

interface ValidationResult {
  ok: boolean;
  /** First user-facing copy line to render in the sticky footer. */
  footerMessage: string;
  /** Per-installment row-level errors keyed by ordinal. */
  perRow: Map<number, string>;
}

function validateSchedule(
  schedule: TripInstallmentSchedule,
): ValidationResult {
  const perRow = new Map<number, string>();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  // Sum check first — the dominant validation.
  const sum = pctSum(schedule);
  if (Math.abs(sum - 100) > SUM_TOLERANCE) {
    const delta = Math.round(Math.abs(100 - sum));
    const verb = sum < 100 ? "Add" : "Remove";
    return {
      ok: false,
      footerMessage: `Percentages must add to 100% (currently ${Math.round(sum)}%). ${verb} ${delta}% to balance.`,
      perRow,
    };
  }

  // Per-row checks.
  let prevDueMs = todayMs;
  for (let i = 0; i < schedule.installments.length; i += 1) {
    const inst = schedule.installments[i];
    if (
      (inst.days_after_booking === undefined ||
        inst.days_after_booking === null) &&
      (inst.fixed_date === undefined || inst.fixed_date === null)
    ) {
      perRow.set(inst.ordinal, "Pick a due date.");
      continue;
    }
    if (
      inst.days_after_booking !== undefined &&
      inst.days_after_booking !== null
    ) {
      if (inst.days_after_booking < DAYS_MIN) {
        perRow.set(inst.ordinal, "Days after booking must be at least 1.");
      }
      // days_after_booking IS the actual offset; ordering across rows is the
      // operator's responsibility, but we sanity-check monotonicity assuming
      // all rows use days mode by treating the days value as the position.
      const dueMs = todayMs + inst.days_after_booking * MS_PER_DAY;
      if (i > 0 && dueMs <= prevDueMs) {
        perRow.set(
          inst.ordinal,
          `Installment ${i + 1} due before installment ${i} — fix dates.`,
        );
      }
      prevDueMs = dueMs;
    } else if (inst.fixed_date !== undefined && inst.fixed_date !== null) {
      const dueMs = new Date(`${inst.fixed_date}T00:00:00Z`).getTime();
      if (!Number.isFinite(dueMs) || dueMs <= todayMs) {
        perRow.set(inst.ordinal, "Date must be in the future.");
      } else if (i > 0 && dueMs <= prevDueMs) {
        perRow.set(
          inst.ordinal,
          `Installment ${i + 1} due before installment ${i} — fix dates.`,
        );
      }
      prevDueMs = dueMs;
    }
  }

  if (perRow.size > 0) {
    const firstErr = Array.from(perRow.values())[0];
    return { ok: false, footerMessage: firstErr, perRow };
  }
  return { ok: true, footerMessage: "", perRow };
}

// ---------- subcomponents ----------

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onDecrement: () => void;
  onIncrement: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

const Stepper: React.FC<StepperProps> = ({
  label,
  value,
  min,
  max,
  step: _step,
  unit,
  onDecrement,
  onIncrement,
  accessibilityLabel,
  disabled,
}) => {
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={onDecrement}
          disabled={!canDec}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityLabel} decrease`}
          accessibilityState={{ disabled: !canDec }}
          style={[styles.stepperBtn, !canDec && styles.stepperBtnDisabled]}
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{
            text: `${value}${unit}`,
            min,
            max,
            now: value,
          }}
          style={styles.stepperValue}
        >
          <Text style={styles.stepperValueText}>
            {value}
            {unit}
          </Text>
        </View>
        <Pressable
          onPress={onIncrement}
          disabled={!canInc}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityLabel} increase`}
          accessibilityState={{ disabled: !canInc }}
          style={[styles.stepperBtn, !canInc && styles.stepperBtnDisabled]}
        >
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

interface SegmentedControlProps {
  selected: "days" | "fixed";
  onSelect: (next: "days" | "fixed") => void;
  accessibilityLabelBase: string;
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({
  selected,
  onSelect,
  accessibilityLabelBase,
}) => (
  <View
    accessibilityRole="tablist"
    style={styles.segmentedHost}
  >
    <Pressable
      onPress={() => onSelect("days")}
      accessibilityRole="tab"
      accessibilityLabel={`${accessibilityLabelBase} mode: days after booking`}
      accessibilityState={{ selected: selected === "days" }}
      style={[
        styles.segmentedBtn,
        selected === "days" && styles.segmentedBtnActive,
      ]}
    >
      <Text
        style={[
          styles.segmentedBtnText,
          selected === "days" && styles.segmentedBtnTextActive,
        ]}
      >
        Days after booking
      </Text>
    </Pressable>
    <Pressable
      onPress={() => onSelect("fixed")}
      accessibilityRole="tab"
      accessibilityLabel={`${accessibilityLabelBase} mode: fixed date`}
      accessibilityState={{ selected: selected === "fixed" }}
      style={[
        styles.segmentedBtn,
        selected === "fixed" && styles.segmentedBtnActive,
      ]}
    >
      <Text
        style={[
          styles.segmentedBtnText,
          selected === "fixed" && styles.segmentedBtnTextActive,
        ]}
      >
        Fixed date
      </Text>
    </Pressable>
  </View>
);

// ---------- main component ----------

export const PaymentPlanEditor: React.FC<PaymentPlanEditorProps> = ({
  value,
  onChange,
  totalAmountCents,
  currency,
  locked,
}) => {
  const [openDatePickerOrdinal, setOpenDatePickerOrdinal] =
    useState<number | null>(null);

  const validation = useMemo(
    () => (value !== null ? validateSchedule(value) : null),
    [value],
  );

  // ---------- locked-state render ----------
  if (locked && value !== null) {
    return (
      <GlassCard
        variant="elevated"
        padding={spacing.md}
        style={styles.card}
        testID="payment-plan-editor-locked"
      >
        <View
          accessibilityRole="text"
          accessibilityLabel="Payment plan locked"
          style={styles.lockedBanner}
        >
          <Text style={styles.lockedBannerText}>{LOCKED_BANNER_COPY}</Text>
        </View>
        <View style={styles.lockedPreview}>
          <View style={styles.lockedRow}>
            <Text style={styles.lockedLabel}>Deposit at booking</Text>
            <Text style={styles.lockedAmount}>
              {formatCurrency(
                Math.floor((totalAmountCents * value.deposit_pct) / 100),
                currency,
              )}
            </Text>
          </View>
          {value.installments.map((inst, idx) => {
            const amount = Math.floor((totalAmountCents * inst.pct) / 100);
            const dateLabel =
              inst.fixed_date !== undefined && inst.fixed_date !== null
                ? formatDateForDisplay(inst.fixed_date)
                : inst.days_after_booking !== undefined &&
                    inst.days_after_booking !== null
                  ? `${inst.days_after_booking} days after booking`
                  : `Installment ${idx + 1}`;
            return (
              <View key={inst.ordinal} style={styles.lockedRow}>
                <Text style={styles.lockedLabel}>{dateLabel}</Text>
                <Text style={styles.lockedAmount}>
                  {formatCurrency(amount, currency)}
                </Text>
              </View>
            );
          })}
        </View>
      </GlassCard>
    );
  }

  if (value === null) return null;

  // ---------- live amounts ----------
  const depositCents = Math.floor((totalAmountCents * value.deposit_pct) / 100);

  // ---------- handlers ----------
  const updateDeposit = useCallback(
    (next: number) => {
      onChange({
        ...value,
        deposit_pct: clampPct(next, DEPOSIT_MIN_PCT, DEPOSIT_MAX_PCT),
      });
    },
    [onChange, value],
  );

  const updateInstallmentPct = useCallback(
    (ordinal: number, next: number) => {
      onChange({
        ...value,
        installments: value.installments.map((inst) =>
          inst.ordinal === ordinal
            ? { ...inst, pct: clampPct(next, INSTALLMENT_MIN_PCT, 95) }
            : inst,
        ),
      });
    },
    [onChange, value],
  );

  const updateInstallmentMode = useCallback(
    (ordinal: number, mode: "days" | "fixed") => {
      onChange({
        ...value,
        installments: value.installments.map((inst) => {
          if (inst.ordinal !== ordinal) return inst;
          if (mode === "days") {
            return {
              ordinal: inst.ordinal,
              pct: inst.pct,
              days_after_booking: inst.days_after_booking ?? 30,
            };
          }
          return {
            ordinal: inst.ordinal,
            pct: inst.pct,
            fixed_date: inst.fixed_date ?? todayPlusDays(30),
          };
        }),
      });
    },
    [onChange, value],
  );

  const updateInstallmentDays = useCallback(
    (ordinal: number, days: number) => {
      onChange({
        ...value,
        installments: value.installments.map((inst) =>
          inst.ordinal === ordinal
            ? {
                ordinal: inst.ordinal,
                pct: inst.pct,
                days_after_booking: Math.max(
                  DAYS_MIN,
                  Math.min(DAYS_MAX, Math.floor(days)),
                ),
              }
            : inst,
        ),
      });
    },
    [onChange, value],
  );

  const updateInstallmentDate = useCallback(
    (ordinal: number, isoDate: string) => {
      onChange({
        ...value,
        installments: value.installments.map((inst) =>
          inst.ordinal === ordinal
            ? {
                ordinal: inst.ordinal,
                pct: inst.pct,
                fixed_date: isoDate,
              }
            : inst,
        ),
      });
    },
    [onChange, value],
  );

  const addInstallment = useCallback(() => {
    if (value.installments.length >= MAX_INSTALLMENTS) return;
    const nextOrdinal = value.installments.length + 1;
    const lastDays =
      value.installments[value.installments.length - 1]?.days_after_booking ??
      30;
    onChange({
      ...value,
      installments: [
        ...value.installments,
        {
          ordinal: nextOrdinal,
          pct: INSTALLMENT_MIN_PCT,
          days_after_booking: lastDays + 30,
        },
      ],
    });
  }, [onChange, value]);

  const removeInstallment = useCallback(
    (ordinal: number) => {
      if (value.installments.length <= 1) return;
      const filtered = value.installments
        .filter((inst) => inst.ordinal !== ordinal)
        .map((inst, idx) => ({ ...inst, ordinal: idx + 1 }));
      onChange({ ...value, installments: filtered });
    },
    [onChange, value],
  );

  const onDateChange = useCallback(
    (ordinal: number) =>
      (event: DateTimePickerEvent, selected?: Date): void => {
        if (Platform.OS !== "ios") setOpenDatePickerOrdinal(null);
        if (event.type === "dismissed" || selected === undefined) return;
        const iso = selected.toISOString().slice(0, 10);
        updateInstallmentDate(ordinal, iso);
      },
    [updateInstallmentDate],
  );

  // ---------- render ----------
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.md}
      style={styles.card}
      testID="payment-plan-editor"
    >
      {/* Deposit row */}
      <View style={styles.section}>
        <Stepper
          label="Deposit at booking"
          value={value.deposit_pct}
          min={DEPOSIT_MIN_PCT}
          max={DEPOSIT_MAX_PCT}
          step={DEPOSIT_STEP}
          unit="%"
          onDecrement={() => updateDeposit(value.deposit_pct - DEPOSIT_STEP)}
          onIncrement={() => updateDeposit(value.deposit_pct + DEPOSIT_STEP)}
          accessibilityLabel="Deposit percentage stepper"
        />
        <Text style={styles.helperText}>
          Buyer pays {formatCurrency(depositCents, currency)} today.
        </Text>
      </View>

      {/* Installment rows */}
      {value.installments.map((inst, idx) => {
        const mode: "days" | "fixed" =
          inst.fixed_date !== undefined && inst.fixed_date !== null
            ? "fixed"
            : "days";
        const amountCents = Math.floor((totalAmountCents * inst.pct) / 100);
        const rowError = validation?.perRow.get(inst.ordinal);
        const canRemove = value.installments.length > 1;
        return (
          <View
            key={inst.ordinal}
            style={styles.section}
            testID={`payment-plan-installment-${inst.ordinal}`}
          >
            <View style={styles.installmentHeader}>
              <Text style={styles.installmentTitle}>
                Installment {idx + 1}
              </Text>
              <Pressable
                onPress={() => removeInstallment(inst.ordinal)}
                disabled={!canRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove installment ${inst.ordinal}`}
                accessibilityHint={
                  canRemove
                    ? "Removes this installment; remaining installments will be re-numbered."
                    : "At least one installment required."
                }
                accessibilityState={{ disabled: !canRemove }}
                style={[
                  styles.removeBtn,
                  !canRemove && styles.removeBtnDisabled,
                ]}
              >
                <Text style={styles.removeBtnText}>Remove</Text>
              </Pressable>
            </View>
            <Stepper
              label="Amount"
              value={inst.pct}
              min={INSTALLMENT_MIN_PCT}
              max={95}
              step={INSTALLMENT_STEP}
              unit="%"
              onDecrement={() =>
                updateInstallmentPct(inst.ordinal, inst.pct - INSTALLMENT_STEP)
              }
              onIncrement={() =>
                updateInstallmentPct(inst.ordinal, inst.pct + INSTALLMENT_STEP)
              }
              accessibilityLabel={`Installment ${inst.ordinal} percentage stepper`}
            />
            <Text style={styles.helperText}>
              → {formatCurrency(amountCents, currency)}
            </Text>
            <SegmentedControl
              selected={mode}
              onSelect={(next) => updateInstallmentMode(inst.ordinal, next)}
              accessibilityLabelBase={`Installment ${inst.ordinal} due date`}
            />
            {mode === "days" ? (
              <View style={styles.daysInputRow}>
                <TextInput
                  style={styles.daysInput}
                  value={String(inst.days_after_booking ?? 30)}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  accessibilityLabel={`Installment ${inst.ordinal} days after booking`}
                  onChangeText={(t) => {
                    const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
                    if (Number.isFinite(n)) {
                      updateInstallmentDays(inst.ordinal, n);
                    }
                  }}
                />
                <Text style={styles.daysSuffix}>days after booking</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => setOpenDatePickerOrdinal(inst.ordinal)}
                accessibilityRole="button"
                accessibilityLabel={`Installment ${inst.ordinal} due date`}
                accessibilityHint="Opens date picker"
                style={styles.dateInputRow}
              >
                <Text style={styles.dateInputText}>
                  {inst.fixed_date !== undefined && inst.fixed_date !== null
                    ? formatDateForDisplay(inst.fixed_date)
                    : "Pick a date"}
                </Text>
              </Pressable>
            )}
            {openDatePickerOrdinal === inst.ordinal && mode === "fixed" ? (
              <DateTimePicker
                value={
                  inst.fixed_date !== undefined && inst.fixed_date !== null
                    ? new Date(`${inst.fixed_date}T00:00:00Z`)
                    : new Date(`${todayPlusDays(30)}T00:00:00Z`)
                }
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={new Date(`${todayPlusDays(1)}T00:00:00Z`)}
                onChange={onDateChange(inst.ordinal)}
              />
            ) : null}
            {rowError !== undefined ? (
              <Text style={styles.rowError}>{rowError}</Text>
            ) : null}
          </View>
        );
      })}

      {/* Add-installment button */}
      <Pressable
        onPress={addInstallment}
        disabled={value.installments.length >= MAX_INSTALLMENTS}
        accessibilityRole="button"
        accessibilityLabel="Add another installment"
        accessibilityHint="Up to 11 installments after deposit"
        accessibilityState={{
          disabled: value.installments.length >= MAX_INSTALLMENTS,
        }}
        style={[
          styles.addBtn,
          value.installments.length >= MAX_INSTALLMENTS &&
            styles.addBtnDisabled,
        ]}
      >
        <Text style={styles.addBtnText}>
          {value.installments.length >= MAX_INSTALLMENTS
            ? "Maximum 11 installments after deposit"
            : "+ Add installment"}
        </Text>
      </Pressable>

      {/* Sticky validation footer (inside card) */}
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.stickyFooter,
          validation?.ok ? styles.stickyFooterOk : styles.stickyFooterError,
        ]}
      >
        <Text
          style={[
            styles.stickyFooterText,
            validation?.ok
              ? styles.stickyFooterTextOk
              : styles.stickyFooterTextError,
          ]}
        >
          {validation?.ok
            ? `Adds to 100% · Total ${formatCurrency(totalAmountCents, currency)}`
            : (validation?.footerMessage ?? "")}
        </Text>
      </View>
    </GlassCard>
  );
};

// ---------- styles ----------

const styles = StyleSheet.create({
  card: {
    // GlassCard owns radius / blur / border / shadow.
  },
  section: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  helperText: {
    color: textTokens.secondary,
    fontSize: 13,
    marginTop: spacing.xxs,
    marginLeft: spacing.xs,
  },
  // Stepper
  stepperRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepperLabel: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "500",
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: 1,
    borderColor: glass.border.chrome,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperBtnText: {
    color: textTokens.primary,
    fontSize: 20,
    fontWeight: "600",
  },
  stepperValue: {
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  stepperValueText: {
    color: textTokens.primary,
    fontSize: 17,
    fontWeight: "600",
  },
  // Installment header (title + Remove)
  installmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  installmentTitle: {
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  removeBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnDisabled: {
    opacity: 0.4,
  },
  removeBtnText: {
    color: semantic.error,
    fontSize: 14,
    fontWeight: "500",
  },
  // Segmented control
  segmentedHost: {
    flexDirection: "row",
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: 1,
    borderColor: glass.border.chrome,
    overflow: "hidden",
  },
  segmentedBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  segmentedBtnActive: {
    backgroundColor: accent.warm,
  },
  segmentedBtnText: {
    color: textTokens.secondary,
    fontSize: 14,
    fontWeight: "500",
  },
  segmentedBtnTextActive: {
    color: textTokens.inverse,
    fontWeight: "600",
  },
  // Days input
  daysInputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  daysInput: {
    width: 72,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
    color: textTokens.primary,
    fontSize: 15,
    textAlign: "center",
  },
  daysSuffix: {
    color: textTokens.secondary,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  // Date input
  dateInputRow: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
    marginTop: spacing.sm,
    justifyContent: "center",
  },
  dateInputText: {
    color: textTokens.primary,
    fontSize: 15,
  },
  // Row error
  rowError: {
    color: semantic.error,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  // Add button
  addBtn: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  addBtnDisabled: {
    opacity: 0.5,
    borderColor: glass.border.chrome,
  },
  addBtnText: {
    color: accent.warm,
    fontSize: 15,
    fontWeight: "600",
  },
  // Sticky footer
  stickyFooter: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  stickyFooterOk: {
    backgroundColor: semantic.successTint,
  },
  stickyFooterError: {
    backgroundColor: semantic.errorTint,
  },
  stickyFooterText: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  stickyFooterTextOk: {
    color: semantic.success,
  },
  stickyFooterTextError: {
    color: semantic.error,
  },
  // Locked banner
  lockedBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.warningTint,
    marginBottom: spacing.md,
  },
  lockedBannerText: {
    color: textTokens.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  lockedPreview: {
    paddingHorizontal: spacing.xs,
  },
  lockedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  lockedLabel: {
    flex: 1,
    color: textTokens.secondary,
    fontSize: 14,
  },
  lockedAmount: {
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "600",
  },
});
