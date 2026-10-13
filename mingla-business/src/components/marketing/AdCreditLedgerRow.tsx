/**
 * toward #3697 Wave 7 — compact Ads credit ledger row (Blast → Ads history).
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { AdCreditLedgerRow as LedgerRow } from "../../services/adCreditService";
import { formatCurrency } from "../../utils/currency";

export interface AdCreditLedgerRowProps {
  row: LedgerRow;
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "top_up":
      return "Top-up";
    case "withdraw":
      return "Withdraw";
    case "unspend_return":
      return "Returned to credit";
    default:
      return kind;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const AdCreditLedgerRow: React.FC<AdCreditLedgerRowProps> = ({
  row,
}) => {
  const amountLine = useMemo(() => {
    const signed = formatCurrency(row.amount_cents, row.currency, true);
    const prefix = row.amount_cents > 0 ? "+" : "";
    return `${prefix}${signed}`;
  }, [row.amount_cents, row.currency]);

  const detail = useMemo(() => {
    const bits: string[] = [];
    if (row.entry_kind === "top_up" && row.fee_cents > 0) {
      bits.push(
        `Fee ${formatCurrency(row.fee_cents, row.currency, true)}`,
      );
    }
    if (row.entry_kind === "withdraw" && row.refund_cents != null) {
      bits.push(
        `Refund ${formatCurrency(row.refund_cents, row.currency, true)}`,
      );
    }
    bits.push(
      `Balance ${formatCurrency(row.balance_after_cents, row.currency, true)}`,
    );
    return bits.join(" · ");
  }, [row]);

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`${kindLabel(row.entry_kind)} ${amountLine}, ${detail}`}
    >
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {kindLabel(row.entry_kind)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatWhen(row.created_at)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text
        style={[
          styles.amount,
          row.amount_cents > 0 ? styles.amountIn : styles.amountOut,
        ]}
        numberOfLines={1}
      >
        {amountLine}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
  },
  main: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  title: {
    ...typography.body,
    color: textTokens.primary,
  },
  meta: {
    ...typography.caption,
    color: textTokens.secondary,
    marginTop: 2,
  },
  amount: {
    ...typography.body,
  },
  amountIn: {
    color: textTokens.primary,
  },
  amountOut: {
    color: textTokens.secondary,
  },
});
