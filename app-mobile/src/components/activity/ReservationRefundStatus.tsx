import React from "react";
import { StyleSheet, Text, View } from "react-native";

export type ReservationRefundState =
  | "queued"
  | "provider_pending"
  | "needs_attention"
  | "processed"
  | "failed_retryable"
  | "failed_terminal";

export interface ReservationRefundSummary {
  refund_id: string;
  subject_id: string;
  buyer_state: ReservationRefundState;
  fee_state: string;
  financial_state: string;
  amount_cents: number;
  currency: string;
  updated_at: string;
}

const COPY: Record<ReservationRefundState, string> = {
  queued: "Refund queued",
  provider_pending: "Refund processing",
  needs_attention: "Refund needs attention",
  processed: "Refund processed",
  failed_retryable: "Refund delayed — retrying",
  failed_terminal: "Refund needs support review",
};

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function ReservationRefundStatus({
  refund,
}: {
  refund: ReservationRefundSummary;
}) {
  const label = `${COPY[refund.buyer_state]} · ${money(
    refund.amount_cents,
    refund.currency,
  )}`;
  return (
    <View
      style={[
        styles.pill,
        refund.buyer_state === "processed" && styles.processed,
        refund.buyer_state === "needs_attention" && styles.attention,
      ]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    minHeight: 28,
    justifyContent: "center",
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: "#fef3c7",
  },
  processed: { backgroundColor: "#dcfce7" },
  attention: { backgroundColor: "#fee2e2" },
  text: { color: "#1f2937", fontSize: 12, fontWeight: "600" },
});
