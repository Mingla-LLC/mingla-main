import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { space } from "../../constants/designSystem";
import { checkoutStyles, color } from "./checkoutTheme";
import { BUYER_CLAIM_COPY } from "../../constants/buyerClaimCopy";
import { formatCurrency } from "../../utils/currency";
import type { BuyerConfirmationReceipt } from "./CartContext";
import { GlassCard } from "../ui/GlassCard";

export interface BuyerCheckoutReceiptProps {
  eventName: string;
  brandName?: string | null;
  orderId: string;
  receipt: BuyerConfirmationReceipt | null | undefined;
}

function money(cents: number, currency: string): string {
  return cents === 0
    ? BUYER_CLAIM_COPY.receipt.free
    : formatCurrency(cents / 100, currency);
}

export function BuyerCheckoutReceipt({
  eventName,
  brandName,
  orderId,
  receipt,
}: BuyerCheckoutReceiptProps): React.ReactElement | null {
  if (receipt === null || receipt === undefined) return null;

  const contextLine = [receipt.dateLine, brandName?.trim() || null]
    .filter((value): value is string => value !== null && value.length > 0)
    .join(" · ");

  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={space[4]}
      style={styles.card}
      testID="buyer-checkout-receipt"
    >
      <View style={styles.header}>
        <Text style={styles.eventName} numberOfLines={2}>
          {eventName}
        </Text>
        {contextLine.length > 0 ? (
          <Text
            style={styles.context}
            numberOfLines={2}
            testID="issue-2338-summary-date-line"
          >
            {contextLine}
          </Text>
        ) : null}
      </View>

      <View style={styles.divider} />
      {receipt.lines.map((line, index) => (
        <View key={`${line.name}:${index}`} style={styles.line}>
          <Text style={styles.qty}>{line.qty}×</Text>
          <Text style={styles.name} numberOfLines={1}>
            {line.name}
          </Text>
          <Text style={styles.amount}>
            {money(line.amountCents, receipt.currency)}
          </Text>
        </View>
      ))}
      {receipt.discountLines.map((line, index) => (
        <View key={`${line.label}:${index}`} style={styles.totalRow}>
          <Text style={styles.totalLabel}>{line.label}</Text>
          <Text style={styles.totalValue}>
            −{formatCurrency(line.amountCents / 100, receipt.currency)}
          </Text>
        </View>
      ))}

      <View style={styles.divider} />
      {receipt.feesAndTaxCents > 0 ? (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {BUYER_CLAIM_COPY.receipt.feesTax}
          </Text>
          <Text style={styles.totalValue}>
            {formatCurrency(receipt.feesAndTaxCents / 100, receipt.currency)}
          </Text>
        </View>
      ) : null}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{BUYER_CLAIM_COPY.receipt.paid}</Text>
        <Text style={styles.totalValue}>
          {money(receipt.paidCents, receipt.currency)}
        </Text>
      </View>
      <Text
        style={styles.orderRef}
        accessibilityLabel={`Order ${orderId}, full reference`}
      >
        Order {receipt.orderRef}
      </Text>
    </GlassCard>
  );
}

const styles = checkoutStyles(() => StyleSheet.create({
  card: { marginBottom: space[6] },
  header: { gap: space[1] },
  eventName: {
    color: color.text1,
    fontSize: 18,
    fontWeight: "700",
  },
  context: { color: color.text2, fontSize: 14 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.lineStrong,
    marginVertical: space[4],
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space[2],
  },
  qty: { width: 36, color: color.text2, fontSize: 14 },
  name: { flex: 1, color: color.text1, fontSize: 14 },
  amount: { color: color.text1, fontSize: 14, fontWeight: "600" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: space[2],
  },
  totalLabel: { color: color.text2, fontSize: 14 },
  totalValue: { color: color.text1, fontSize: 14, fontWeight: "700" },
  orderRef: {
    marginTop: space[2],
    color: color.text3,
    fontSize: 12,
    letterSpacing: 0.4,
  },
}));
