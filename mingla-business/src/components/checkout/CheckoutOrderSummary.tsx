/**
 * #4304 — the checkout order summary for the three buyer-web funnels
 * (event tickets, experience spots, trip tiers).
 *
 * Narrow screens (phones, mobile web, native): the existing sticky bottom bar,
 * unchanged in position, holding the funnel's own discount row, fees, total
 * and Continue.
 *
 * Wide desktop (web >= 1024, via useResponsiveLayout — I-DESKTOP-GATE-VIA-HOOK):
 * the page becomes two columns. Tickets scroll on the left; on the right a
 * static "Order summary" card (NOT a floating overlay) lists the server-priced
 * lines, shows the struck list subtotal when a discount applies, then the
 * funnel's own discount field (open by default), fees, total and Continue.
 *
 * Every number shown here is the server quote's (Constitution #9): lines and
 * subtotals come from `cart.quote`; while it loads, lines show name and count
 * only.
 */

import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import {
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { formatCurrency } from "../../utils/currency";
import { useCart } from "./CartContext";

const SUMMARY_WIDTH = 380;
const CONTENT_MAX_WIDTH = 1180;
const SURFACE = "#14171c";
const HAIRLINE = "rgba(255, 255, 255, 0.10)";

/** True when the checkout uses the two-column desktop layout. */
export function useCheckoutWideLayout(): boolean {
  return useResponsiveLayout().isWideDesktop;
}

export interface CheckoutColumnsProps {
  wide: boolean;
  children: React.ReactNode;
}

/** Narrow: a plain flex column. Wide: tickets left, summary right. */
export const CheckoutColumns: React.FC<CheckoutColumnsProps> = ({
  wide,
  children,
}) => (
  <View
    style={wide ? styles.columnsWide : styles.columnsNarrow}
    testID={wide ? "checkout-columns-wide" : "checkout-columns-narrow"}
  >
    {children}
  </View>
);

export interface CheckoutOrderSummaryProps {
  wide: boolean;
  /** Narrow only: the safe-area bottom inset the sticky bar pads by. */
  bottomInset: number;
  children: React.ReactNode;
}

function QuoteLines(): React.ReactElement | null {
  const { lines, quote } = useCart();
  const currency = quote?.currency ?? lines[0]?.currency ?? "";
  const rows =
    quote !== null && quote.lines.length > 0
      ? quote.lines.map((line) => ({
          key: line.ticketTypeId,
          name: line.ticketName,
          quantity: line.quantity,
          listCents: line.lineListCents as number | null,
          netCents: line.lineNetCents as number | null,
        }))
      : lines
          .filter((line) => line.quantity > 0)
          .map((line) => ({
            key: line.ticketTypeId,
            name: line.ticketName,
            quantity: line.quantity,
            listCents: null,
            netCents: null,
          }));
  if (rows.length === 0) {
    return (
      <Text style={styles.emptyLine} testID="checkout-summary-empty">
        Nothing selected yet.
      </Text>
    );
  }
  const discounted =
    quote !== null && quote.discountCents > 0 && quote.listSubtotalCents > 0;
  return (
    <View style={styles.lines}>
      {rows.map((row) => (
        <View
          key={row.key}
          style={styles.lineRow}
          testID="checkout-summary-line"
        >
          <Text style={styles.lineName} numberOfLines={2}>
            {row.name} × {row.quantity}
          </Text>
          {row.netCents !== null && currency.length > 0 ? (
            <Text style={styles.lineAmount}>
              {formatCurrency(row.netCents, currency, true)}
            </Text>
          ) : null}
        </View>
      ))}
      {discounted && quote !== null ? (
        <View style={styles.lineRow} testID="checkout-summary-subtotal">
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <View style={styles.subtotalValues}>
            <Text style={styles.struck} testID="checkout-summary-old-subtotal">
              {formatCurrency(quote.listSubtotalCents, quote.currency, true)}
            </Text>
            <Text style={styles.lineAmount}>
              {formatCurrency(quote.netSubtotalCents, quote.currency, true)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export const CheckoutOrderSummary: React.FC<CheckoutOrderSummaryProps> = ({
  wide,
  bottomInset,
  children,
}) => {
  if (!wide) {
    const pad: ViewStyle = { paddingBottom: bottomInset + spacing.md };
    return (
      <View style={[styles.bottomBar, pad]} testID="checkout-bottom-bar">
        {children}
      </View>
    );
  }
  return (
    <View style={styles.summary} testID="checkout-order-summary">
      <Text style={styles.heading} accessibilityRole="header">
        Order summary
      </Text>
      <QuoteLines />
      <View style={styles.divider} />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  columnsNarrow: { flex: 1 },
  columnsWide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    alignSelf: "center",
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  summary: {
    width: SUMMARY_WIDTH,
    flexShrink: 0,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    gap: spacing.sm,
  },
  heading: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  lines: { gap: spacing.sm },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  lineName: { flex: 1, fontSize: 14, color: textTokens.secondary },
  lineAmount: { fontSize: 14, fontWeight: "600", color: textTokens.primary },
  emptyLine: { fontSize: 14, color: textTokens.tertiary },
  subtotalLabel: { fontSize: 13, color: textTokens.tertiary },
  subtotalValues: { flexDirection: "row", gap: spacing.sm },
  struck: {
    fontSize: 13,
    color: textTokens.tertiary,
    textDecorationLine: "line-through",
  },
  divider: {
    height: 1,
    backgroundColor: HAIRLINE,
    marginVertical: spacing.xs,
  },
});
