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
import { Image, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { radius, scrim, space } from "../../constants/designSystem";
import { activeCheckoutPalette, checkoutStyles, color, materials } from "./checkoutTheme";
import { CheckoutCoverFallback } from "./CheckoutCoverFallback";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { formatCurrency } from "../../utils/currency";
import { useCart } from "./CartContext";

// #4420 §4.1 — the desktop ticket stub is 400 wide, sticky at top 96.
const SUMMARY_WIDTH = 400;
const STUB_BAND_HEIGHT = 250;

/**
 * react-native-web passes `position: sticky`; RN's type has no name for it.
 * The union keeps RN's own positions so the widening cast below is a legal
 * comparison (the PublicVenueScreen `WebVenueViewStyle` pattern).
 */
interface WebStickyStyle {
  position: ViewStyle["position"] | "sticky";
  top: number;
}
const stickyStub = (): StyleProp<ViewStyle> => {
  const sticky: WebStickyStyle = { position: "sticky", top: 96 };
  return Platform.OS === "web" ? (sticky as StyleProp<ViewStyle>) : null;
};

/** #4420 — what the stub's flyer band shows: the offering, as on its page. */
export interface CheckoutStubIdentity {
  title: string;
  /** "Sat 19 Dec · 21:00". */
  eyebrow: string | null;
  coverUrl: string | null;
}
const CONTENT_MAX_WIDTH = 1180;

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
  /**
   * issue #4420 audit — narrow only: the sticky bar's measured height, so the
   * route pads its scroll by the real bar (a fixed 140 left the last ticket
   * tier under the bar, out of reach).
   */
  onBarHeight?: (height: number) => void;
  /** #4420 — the desktop stub's flyer band. Absent: no band (summary only). */
  stub?: CheckoutStubIdentity | null;
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
  onBarHeight,
  stub = null,
}) => {
  if (!wide) {
    const pad: ViewStyle = { paddingBottom: bottomInset + space[4] };
    return (
      <View
        style={[styles.bottomBar, pad]}
        testID="checkout-bottom-bar"
        onLayout={
          onBarHeight === undefined
            ? undefined
            : (e) => onBarHeight(Math.ceil(e.nativeEvent.layout.height))
        }
      >
        {children}
      </View>
    );
  }
  // #4420 §4.1 — the ticket stub: the flyer band with the offering's
  // identity, a perforation, then the summary and the step's CTA. It owns the
  // CTA on desktop (there is no floating bar at this width).
  return (
    <View style={[styles.summary, stickyStub()]} testID="checkout-order-summary">
      {stub !== null ? (
        <>
          <View style={styles.band} testID="checkout-stub-band">
            {stub.coverUrl !== null && stub.coverUrl.length > 0 ? (
              <Image
                source={{ uri: stub.coverUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <CheckoutCoverFallback style={StyleSheet.absoluteFill} />
            )}
            <LinearGradient
              colors={scrim.cardPhoto.colors}
              locations={scrim.cardPhoto.locations}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.bandIdentity}>
              {stub.eyebrow !== null ? (
                <Text style={styles.bandEyebrow} numberOfLines={1}>
                  {stub.eyebrow}
                </Text>
              ) : null}
              <Text style={styles.bandTitle} numberOfLines={2} accessibilityRole="header">
                {stub.title}
              </Text>
            </View>
          </View>
          <View style={styles.perforation} testID="checkout-stub-perforation">
            <View style={[styles.notch, styles.notchLeft]} />
            <View style={styles.perfRule} />
            <View style={[styles.notch, styles.notchRight]} />
          </View>
        </>
      ) : null}
      <View style={styles.summaryBody}>
        <Text style={styles.heading} accessibilityRole="header">
          Order summary
        </Text>
        <QuoteLines />
        <View style={styles.divider} />
        {children}
        <Text style={styles.allIn}>All-in price. Taxes and fees included.</Text>
      </View>
    </View>
  );
};


const styles = checkoutStyles(() => StyleSheet.create({
  columnsNarrow: { flex: 1 },
  columnsWide: {
    flex: 1,
    // #4420 — the stub sits LEFT of the step (it is the second child).
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    alignSelf: "center",
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    gap: space[7],
    paddingHorizontal: space[6],
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[4],
    paddingHorizontal: space[6],
    // issue #4420 audit — opaque: there is no blur behind this bar, and the
    // translucent glass let the ticket rows scrolling under it show through.
    // #4420 D-C1 — the host's page colour (Graphite keeps its chrome fill).
    backgroundColor:
      activeCheckoutPalette() === null ? materials.chrome.solidFill : color.canvas,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  summary: {
    width: SUMMARY_WIDTH,
    flexShrink: 0,
    marginTop: space[4],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.card,
    overflow: "hidden",
  },
  summaryBody: {
    padding: space[6],
    gap: space[2],
  },
  band: {
    height: STUB_BAND_HEIGHT,
    justifyContent: "flex-end",
  },
  bandIdentity: { padding: space[5], gap: 6 },
  bandEyebrow: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: color.textOnPhoto2,
  },
  bandTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "700",
    color: color.textOnPhoto,
    letterSpacing: -0.4,
  },
  perforation: {
    height: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  perfRule: {
    flex: 1,
    borderTopWidth: 2,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
    marginHorizontal: 4,
  },
  notch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.canvas,
  },
  notchLeft: { marginLeft: -10 },
  notchRight: { marginRight: -10 },
  allIn: { fontSize: 12.5, color: color.text3, textAlign: "center", marginTop: space[1] },

  heading: {
    fontSize: 16,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: -0.2,
  },
  lines: { gap: space[2] },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: space[2],
  },
  lineName: { flex: 1, fontSize: 14, color: color.text2 },
  lineAmount: { fontSize: 14, fontWeight: "600", color: color.text1 },
  emptyLine: { fontSize: 14, color: color.text3 },
  subtotalLabel: { fontSize: 13, color: color.text3 },
  subtotalValues: { flexDirection: "row", gap: space[2] },
  struck: {
    fontSize: 13,
    color: color.text3,
    textDecorationLine: "line-through",
  },
  divider: {
    height: 1,
    backgroundColor: color.lineStrong,
    marginVertical: space[1],
  },
}));
