import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SourceRefundSummary } from "../../types/venueReservation";

const COPY = {
  queued: "Queued",
  provider_pending: "Processing",
  needs_attention: "Needs attention",
  processed: "Processed",
  failed_retryable: "Delayed",
  failed_terminal: "Support review",
} as const;

export function SourceRefundStatusChip({
  refund,
  amountLabel,
}: {
  refund: SourceRefundSummary;
  /**
   * #3391 — a pre-formatted amount (e.g. "₦25,000.00") for surfaces that show
   * the currency glyph. Omitted, the chip keeps #1221's exact "123.45 NGN".
   */
  amountLabel?: string;
}) {
  const amount =
    amountLabel ?? `${(refund.amountCents / 100).toFixed(2)} ${refund.currency}`;
  const label = `${COPY[refund.buyerState]} · ${amount}`;
  return (
    <View style={styles.chip} accessibilityRole="text" accessibilityLabel={`Refund ${label}`}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  chip: { alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fef3c7" },
  text: { color: "#1f2937", fontWeight: "600", fontSize: 12 },
});
