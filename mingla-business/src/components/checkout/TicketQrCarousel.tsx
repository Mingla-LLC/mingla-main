/**
 * TicketQrCarousel — N-QR horizontal swipe carousel for multi-ticket orders.
 *
 * Cycle 11 J-S8 — replaces single-QR rendering on /checkout/{eventId}/confirm
 * and /o/{orderId}. One QR per seat (per-ticket QR), mirrors Apple Wallet's
 * passes-as-cards UX so buyers + door staff understand the gesture instinctively.
 *
 * Single-ticket case: renders ONE QR with NO dots indicator + NO swipe affordance —
 * visual parity with pre-Cycle-11 single-QR UX preserved.
 *
 * Per Cycle 11 SPEC §4.9 (J-S8).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import {
  accent,
  spacing,
  text as textTokens,
  radius as radiusTokens,
} from "../../constants/designSystem";
import { buildQrPayload } from "../../utils/stubOrderId";

export interface CarouselTicket {
  ticketId: string;
  ticketName: string;
  /** Server-issued QR payload. Older local previews fall back to buildQrPayload. */
  qrPayload?: string;
}

export interface TicketQrCarouselProps {
  orderId: string;
  tickets: CarouselTicket[];
  /** QR pixel size; defaults to 200. */
  qrSize?: number;
}

const DEFAULT_QR_SIZE = 200;

export const TicketQrCarousel: React.FC<TicketQrCarouselProps> = ({
  orderId,
  tickets,
  qrSize = DEFAULT_QR_SIZE,
}) => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  // ORCH-0852: pageWidth must come from the carousel container's onLayout, NOT
  // from Dimensions.get("window").width. On web (RNW), the carousel sits inside
  // a padded GlassCard whose inner width is narrower than the window; using the
  // window width seeded the initial render with oversized pages that triggered
  // an overflow-y: hidden clip on the QR. Initial state is now 0 and the
  // multi-page render is gated on pageWidth > 0 so the first paint always uses
  // a measured width.
  const [pageWidth, setPageWidth] = useState<number>(0);

  const total = tickets.length;
  const isMulti = total > 1;

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }): void => {
      setPageWidth(e.nativeEvent.layout.width);
    },
    [],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      if (pageWidth <= 0) return;
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / pageWidth);
      if (idx !== activeIndex && idx >= 0 && idx < total) {
        setActiveIndex(idx);
      }
    },
    [pageWidth, activeIndex, total],
  );

  const pages = useMemo(
    () =>
      tickets.map((t, i) => ({
        ...t,
        payload: t.qrPayload ?? buildQrPayload(orderId, t.ticketId),
        index: i,
      })),
    [orderId, tickets],
  );

  if (total === 0) return null;

  // Single-ticket case — render bare QR + caption, NO swipe, NO dots.
  if (!isMulti) {
    const single = pages[0];
    return (
      <View style={styles.singleWrap}>
        <View style={styles.qrInner}>
          <QRCode
            value={single.payload}
            size={qrSize}
            color="#000000"
            backgroundColor="#ffffff"
          />
        </View>
        <Text style={styles.caption}>Show this at the door</Text>
      </View>
    );
  }

  // ORCH-0852: before the host's onLayout fires we have no measured width; the
  // first paint of the multi-page render needs that width to size each page.
  // Render a bare host (which still publishes onLayout) until pageWidth > 0.
  if (pageWidth === 0) {
    return <View style={styles.host} onLayout={handleLayout} />;
  }

  return (
    <View style={styles.host} onLayout={handleLayout}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        accessibilityLabel="Ticket QR carousel"
        // ORCH-0852: explicit web height. RNW renders <ScrollView horizontal>
        // as overflow-x: auto; overflow-y: hidden which clipped the QR
        // vertically when the carousel had no measured height. Native lays
        // out from intrinsic content fine, so the explicit height is
        // web-only to avoid changing native behavior.
        style={Platform.OS === "web" ? styles.scrollWeb : undefined}
      >
        {pages.map((p) => (
          <View
            key={p.ticketId}
            style={[styles.page, { width: pageWidth }]}
          >
            <View style={styles.qrInner}>
              <QRCode
                value={p.payload}
                size={qrSize}
                color="#000000"
                backgroundColor="#ffffff"
              />
            </View>
            <Text style={styles.label} numberOfLines={2}>
              Ticket {p.index + 1} of {total} — {p.ticketName}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dotsRow}>
        {pages.map((p) => (
          <View
            key={p.ticketId}
            style={[
              styles.dot,
              p.index === activeIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>

      <Text style={styles.swipeHint}>Swipe to see next ticket</Text>
    </View>
  );
};

// ORCH-0852: explicit min-heights for the multi-ticket carousel on web.
// Computed = QR (200) + qrInner padding (16) + label (~40) + dots (12) +
// swipeHint (20) + paddingVertical (16) + small buffer. Native sizes from
// intrinsic content correctly; minHeight is a no-op there because the
// content already exceeds it.
const HOST_MIN_HEIGHT = 320;
const PAGE_MIN_HEIGHT = 260;

const styles = StyleSheet.create({
  host: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    minHeight: HOST_MIN_HEIGHT,
  },
  scrollWeb: {
    height: HOST_MIN_HEIGHT - 32, // host minHeight minus paddingY + dots/swipeHint room
  },
  singleWrap: {
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  page: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: PAGE_MIN_HEIGHT,
  },
  qrInner: {
    padding: spacing.sm,
    backgroundColor: "#ffffff",
    borderRadius: radiusTokens.md,
  },
  caption: {
    fontSize: 13,
    color: textTokens.secondary,
    fontWeight: "500",
  },
  label: {
    fontSize: 13,
    color: textTokens.secondary,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: 280,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    paddingTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },
  dotActive: {
    backgroundColor: accent.warm,
  },
  swipeHint: {
    fontSize: 11,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
});
