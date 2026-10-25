import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  checkoutReviewReasonCopy,
  ticketQuoteFeesAndTaxCents,
} from "@mingla/offering-rendering/ticketQuoteCopy";
import type {
  TicketCheckoutReview,
  TicketQuote,
} from "@mingla/offering-rendering/discountQuote";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type { BuyerDiscountSurface } from "./DiscountCodeField";
import { formatQuoteMoney } from "./quoteMoney";

export interface TicketQuoteSummaryProps {
  quote: TicketQuote;
  compact?: boolean;
  totalLabel?: string;
  totalValue?: string;
}

/** W-SUMMARY — display-only rendering of the server quote. */
export const TicketQuoteSummary: React.FC<TicketQuoteSummaryProps> = ({
  quote,
  compact = false,
  totalLabel = "Total",
  totalValue,
}) => {
  const feesAndTaxCents = ticketQuoteFeesAndTaxCents(quote);
  return (
    <View style={[styles.summary, compact && styles.summaryCompact]}>
      {quote.lines.map((line) => (
        <View key={line.ticketTypeId} style={styles.row}>
          <Text style={styles.label}>
            {line.quantity} × {line.ticketName}
          </Text>
          <View style={styles.moneyPair}>
            {line.lineListCents !== line.lineNetCents ? (
              <Text style={styles.struckMoney}>
                {formatQuoteMoney(line.lineListCents, quote.currency)}
              </Text>
            ) : null}
            <Text style={styles.value}>
              {formatQuoteMoney(line.lineNetCents, quote.currency)}
            </Text>
          </View>
        </View>
      ))}
      {quote.discounts.map((discount) => (
        <View key={discount.discountId} style={styles.row}>
          <Text style={styles.discountLabel}>{discount.name}</Text>
          <Text style={styles.discountValue}>
            −{formatQuoteMoney(discount.amountMinor, quote.currency)}
          </Text>
        </View>
      ))}
      {quote.dueTodayNetCents !== quote.netSubtotalCents ? (
        <View style={styles.row}>
          <Text style={styles.label}>Due today</Text>
          <Text style={styles.value}>
            {formatQuoteMoney(quote.dueTodayNetCents, quote.currency)}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.label}>Fees &amp; tax</Text>
        <Text style={styles.value}>
          {formatQuoteMoney(feesAndTaxCents, quote.currency)}
        </Text>
      </View>
      <View style={[styles.row, styles.totalRow]}>
        <Text style={styles.totalLabel}>{totalLabel}</Text>
        <Text style={styles.totalValue}>
          {totalValue ??
            formatQuoteMoney(quote.buyerTotalCents, quote.currency)}
        </Text>
      </View>
    </View>
  );
};

export interface TicketCheckoutReviewPanelProps {
  review: TicketCheckoutReview;
  onAccept: () => void;
  onBack: () => void;
  accepting?: boolean;
  surface?: BuyerDiscountSurface;
}

/** W-REVIEW409 — no payment retry occurs until the buyer accepts this panel. */
export const TicketCheckoutReviewPanel: React.FC<
  TicketCheckoutReviewPanelProps
> = ({
  review,
  onAccept,
  onBack,
  accepting = false,
  surface = "web_event",
}) => {
  useEffect(() => {
    captureDiscountEvent("checkout_review_required", {
      detail: review.detail,
      surface,
    });
  }, [review.detail, surface]);
  const quote = review.quote;
  if (quote === null) {
    return (
      <View style={styles.review} accessibilityRole="alert">
        <Text style={styles.reviewTitle}>Your total changed</Text>
        <Text style={styles.reviewReason}>
          Something in your order changed. Please review it.
        </Text>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back to tickets</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.review} accessibilityRole="alert">
      <Text style={styles.reviewTitle}>Your total changed</Text>
      <View style={styles.reviewTotals}>
        {review.previousTotalCents !== null ? (
          <Text style={styles.struckMoney}>
            {formatQuoteMoney(review.previousTotalCents, quote.currency)}
          </Text>
        ) : null}
        <Text style={styles.reviewNewTotal}>
          {formatQuoteMoney(quote.buyerTotalCents, quote.currency)}
        </Text>
      </View>
      <Text style={styles.reviewReason}>
        {checkoutReviewReasonCopy(review.detail)}
      </Text>
      <TicketQuoteSummary quote={quote} compact />
      <Pressable
        style={[styles.primaryButton, accepting && styles.buttonDisabled]}
        disabled={accepting}
        onPress={onAccept}
        accessibilityLabel={
          accepting
            ? "Accepting updated total"
            : `Pay ${formatQuoteMoney(quote.buyerTotalCents, quote.currency)}`
        }
      >
        <Text style={styles.primaryButtonText}>
          Pay {formatQuoteMoney(quote.buyerTotalCents, quote.currency)}
        </Text>
      </Pressable>
      <Pressable
        style={styles.secondaryButton}
        disabled={accepting}
        onPress={onBack}
      >
        <Text style={styles.secondaryButtonText}>Back to tickets</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  summary: { gap: 10 },
  summaryCompact: { paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: { flex: 1, color: "#5f6572", fontSize: 14 },
  value: { color: "#252936", fontSize: 14, fontVariant: ["tabular-nums"] },
  moneyPair: { flexDirection: "row", alignItems: "center", gap: 8 },
  struckMoney: {
    color: "#8a909d",
    textDecorationLine: "line-through",
    fontVariant: ["tabular-nums"],
  },
  discountLabel: { flex: 1, color: "#28724a", fontSize: 14 },
  discountValue: { color: "#28724a", fontSize: 14, fontWeight: "600" },
  totalRow: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#dfe2e8",
  },
  totalLabel: { color: "#15181f", fontSize: 16, fontWeight: "700" },
  totalValue: {
    color: "#15181f",
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  review: {
    gap: 14,
    padding: 18,
    borderRadius: 14,
    backgroundColor: "#fff8ed",
    borderWidth: 1,
    borderColor: "#f3c98b",
  },
  reviewTitle: { color: "#6d3908", fontSize: 21, fontWeight: "800" },
  reviewTotals: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  reviewNewTotal: { color: "#15181f", fontSize: 24, fontWeight: "800" },
  reviewReason: { color: "#6d4b2a", lineHeight: 20 },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#eb7825",
  },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { color: "#7a3a11", fontWeight: "700" },
  buttonDisabled: { opacity: 0.55 },
});
