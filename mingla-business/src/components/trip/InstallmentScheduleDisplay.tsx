/**
 * ORCH-0873 [Tr3 Installment Payments Stage 2 UI] —
 * <InstallmentScheduleDisplay /> read-only schedule render.
 *
 * Per SPEC_ORCH-0873 §3.5.2 + DESIGN_ORCH-0873 §4. Renders on:
 *  - mingla-business/src/components/trip/TripCheckoutFlow.tsx (variant="planner")
 *  - mingla-business/app/checkout/[eventId]/index.tsx (variant="buyer", SC-5a)
 *  - mingla-business/app/checkout/[eventId]/buyer.tsx (variant="buyer", SC-5b)
 *  - mingla-business/app/checkout/[eventId]/payment.tsx (variant="buyer", SC-5c)
 *
 * Currency-aware per Constitution #10 via Intl.NumberFormat.
 * Date formatting per Constitution #10 via Intl.DateTimeFormat.
 *
 * Empty state: returns null when schedule is null — caller layout
 * unchanged on non-installment trips.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { installmentReassuranceText } from "../../copy/installmentReassurance";

export interface InstallmentScheduleDisplaySchedule {
  fullPriceCents: number;
  depositCents: number;
  /** 3-letter ISO 4217 currency code from the trip. */
  currency: string;
  installments: Array<{
    ordinal: number;
    pct: number;
    amountCents: number;
    /** ISO 8601 UTC. */
    dueAt: string;
  }>;
}

export interface InstallmentScheduleDisplayProps {
  schedule: InstallmentScheduleDisplaySchedule | null;
  /**
   * "buyer" renders the buyer-facing layout WITH the reassurance copy.
   * "planner" renders the same layout WITHOUT the reassurance copy
   * (planner already knows what their buyers will pay).
   */
  variant: "buyer" | "planner";
}

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

function formatDate(iso: string): string {
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

export const InstallmentScheduleDisplay: React.FC<
  InstallmentScheduleDisplayProps
> = ({ schedule, variant }) => {
  const rows = useMemo(() => {
    if (schedule === null) return null;
    return {
      deposit: {
        label: "Deposit today",
        amount: formatCurrency(schedule.depositCents, schedule.currency),
      },
      installments: schedule.installments.map((inst) => ({
        ordinal: inst.ordinal,
        label: formatDate(inst.dueAt),
        amount: formatCurrency(inst.amountCents, schedule.currency),
      })),
      total: formatCurrency(schedule.fullPriceCents, schedule.currency),
      depositFormatted: formatCurrency(
        schedule.depositCents,
        schedule.currency,
      ),
      remainingFormatted: formatCurrency(
        schedule.fullPriceCents - schedule.depositCents,
        schedule.currency,
      ),
    };
  }, [schedule]);

  if (rows === null || schedule === null) return null;

  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Payment plan schedule"
      style={styles.host}
    >
      <GlassCard variant="elevated" padding={spacing.md} style={styles.card}>
        <View
          accessibilityRole="text"
          style={styles.row}
        >
          <Text style={styles.dateLabel}>{rows.deposit.label}</Text>
          <Text style={styles.amount}>{rows.deposit.amount}</Text>
        </View>
        {rows.installments.map((inst) => (
          <View
            key={inst.ordinal}
            accessibilityRole="text"
            accessibilityLabel={`${inst.label}, ${inst.amount}`}
            style={styles.row}
          >
            <Text style={styles.dateLabel}>{inst.label}</Text>
            <Text style={styles.amount}>{inst.amount}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View
          accessibilityRole="text"
          accessibilityLabel={`Total ${rows.total} across ${rows.installments.length + 1} payments`}
          style={styles.row}
        >
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>{rows.total}</Text>
        </View>
      </GlassCard>
      {variant === "buyer" ? (
        <Text style={styles.reassurance}>
          {installmentReassuranceText({
            depositFormatted: rows.depositFormatted,
            remainingFormatted: rows.remainingFormatted,
          })}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    width: "100%",
  },
  card: {
    // GlassCard owns radius / border / blur / shadow per design tokens.
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  dateLabel: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "400",
  },
  amount: {
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "right",
  },
  divider: {
    height: 1,
    backgroundColor: glass.border.profileElevated,
    marginVertical: spacing.sm,
  },
  totalLabel: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  totalAmount: {
    color: textTokens.primary,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "right",
  },
  reassurance: {
    color: textTokens.secondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.md,
  },
});
