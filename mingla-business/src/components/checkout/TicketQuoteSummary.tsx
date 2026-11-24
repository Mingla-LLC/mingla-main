import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  checkoutReviewReasonCopy,
  checkoutReviewTitle,
  ticketQuoteFeesAndTaxCents,
} from "@mingla/offering-rendering/ticketQuoteCopy";
import type {
  TicketCheckoutReview,
  TicketQuote,
} from "@mingla/offering-rendering/discountQuote";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type { BuyerDiscountSurface } from "./DiscountCodeField";
import { formatQuoteMoney } from "./quoteMoney";

import {
  checkoutAccentFill,
  checkoutOnAccent,
  checkoutStyles,
  color,
} from "./checkoutTheme";
import { CheckoutHero } from "./CheckoutHero";
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
  const labelStyle = styles.label;
  const valueStyle = styles.value;
  const discountLabelStyle = styles.discountLabel;
  const discountValueStyle = styles.discountValue;
  return (
    <View style={[styles.summary, compact && styles.summaryCompact]}>
      {quote.lines.map((line) => (
        <View key={line.ticketTypeId} style={styles.row}>
          <Text style={labelStyle}>
            {line.quantity} × {line.ticketName}
          </Text>
          <View style={styles.moneyPair}>
            {line.lineListCents !== line.lineNetCents ? (
              <Text style={styles.struckMoney}>
                {formatQuoteMoney(line.lineListCents, quote.currency)}
              </Text>
            ) : null}
            <Text style={valueStyle}>
              {formatQuoteMoney(line.lineNetCents, quote.currency)}
            </Text>
          </View>
        </View>
      ))}
      {/* issue #3281 — each extra the server priced, under the tickets. */}
      {(quote.extras ?? []).map((extra) => (
        <View key={extra.addOnId} style={styles.row} testID="issue-3281-quote-extra">
          <Text style={labelStyle}>
            {extra.quantity} × {extra.addOnName}
          </Text>
          <Text style={valueStyle}>
            {formatQuoteMoney(extra.totalCents, quote.currency)}
          </Text>
        </View>
      ))}
      {quote.discounts.map((discount) => (
        <View key={discount.discountId} style={styles.row}>
          <Text style={discountLabelStyle}>{discount.name}</Text>
          <Text style={discountValueStyle}>
            −{formatQuoteMoney(discount.amountMinor, quote.currency)}
          </Text>
        </View>
      ))}
      {quote.dueTodayNetCents !== quote.netSubtotalCents ? (
        <View style={styles.row}>
          <Text style={labelStyle}>Due today</Text>
          <Text style={valueStyle}>
            {formatQuoteMoney(quote.dueTodayNetCents, quote.currency)}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={labelStyle}>Fees &amp; tax</Text>
        <Text style={valueStyle}>
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

/**
 * W-REVIEW409 — no payment retry occurs until the buyer accepts this panel.
 *
 * #4420 wave 2 (spec §4.2 "Total changed") — the shared checkout hero (a
 * warning disc, "Your total changed" in the host face, the reason), then a
 * card with the old total struck, the new lines and "New total", the Pay
 * button in the host accent and "Back to tickets" as a ghost button. Copy and
 * behaviour are unchanged.
 */
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
  const backButton = (
    <Pressable
      style={styles.secondaryButton}
      disabled={accepting}
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Back to tickets"
    >
      <Text style={styles.secondaryButtonText}>Back to tickets</Text>
    </Pressable>
  );
  if (quote === null) {
    return (
      <View style={styles.review} accessibilityRole="alert">
        <CheckoutHero
          tone="warning"
          icon="swap"
          title="Your total changed"
          body="Something in your order changed. Please review it."
          testID="checkout-total-changed-hero"
        />
        {backButton}
      </View>
    );
  }
  const newTotal = formatQuoteMoney(quote.buyerTotalCents, quote.currency);
  return (
    <View style={styles.review} accessibilityRole="alert">
      <CheckoutHero
        tone="warning"
        icon="swap"
        title={checkoutReviewTitle(review)}
        body={checkoutReviewReasonCopy(review.detail)}
        testID="checkout-total-changed-hero"
      />
      <View style={styles.reviewCard}>
        {review.previousTotalCents !== null ? (
          <View style={styles.row}>
            <Text style={styles.label}>Before</Text>
            <Text style={styles.struckMoney}>
              {formatQuoteMoney(review.previousTotalCents, quote.currency)}
            </Text>
          </View>
        ) : null}
        <TicketQuoteSummary quote={quote} compact totalLabel="New total" />
      </View>
      <Pressable
        style={[styles.primaryButton, checkoutAccentFill(), accepting && styles.buttonDisabled]}
        disabled={accepting}
        onPress={onAccept}
        accessibilityRole="button"
        accessibilityLabel={accepting ? "Accepting updated total" : `Pay ${newTotal}`}
      >
        <Text style={[styles.primaryButtonText, { color: checkoutOnAccent() }]}>
          Pay {newTotal}
        </Text>
      </Pressable>
      {backButton}
    </View>
  );
};

const styles = checkoutStyles(() => StyleSheet.create({
  summary: { gap: 10 },
  summaryCompact: { paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  // #4420 journey: every caller renders this on the dark checkout card, where
  // the surface tokens (card / card3) made the amounts and total invisible.
  label: { flex: 1, color: color.text2, fontSize: 14 },
  value: { color: color.text1, fontSize: 14, fontVariant: ["tabular-nums"] },
  moneyPair: { flexDirection: "row", alignItems: "center", gap: 8 },
  struckMoney: {
    color: color.text3,
    textDecorationLine: "line-through",
    fontVariant: ["tabular-nums"],
  },
  discountLabel: { flex: 1, color: color.successText, fontSize: 14 },
  discountValue: { color: color.successText, fontSize: 14, fontWeight: "600" },
  totalRow: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.lineStrong,
  },
  totalLabel: { color: color.text1, fontSize: 16, fontWeight: "700" },
  totalValue: {
    color: color.text1,
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  review: { gap: 16 },
  reviewCard: {
    gap: 10,
    padding: 18,
    borderRadius: 20,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  primaryButtonText: { fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  secondaryButtonText: { color: color.text1, fontWeight: "700", fontSize: 15 },
  buttonDisabled: { opacity: 0.55 },
}));
