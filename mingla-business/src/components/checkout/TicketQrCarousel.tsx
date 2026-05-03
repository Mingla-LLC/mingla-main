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
  Dimensions,
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
  /** tkt_<orderSuffix>_<lineIdx>_<seatIdx> */
  ticketId: string;
  /** Display name from the line (FROZEN at purchase). */
  ticketName: string;
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
  const [pageWidth, setPageWidth] = useState<number>(
    Dimensions.get("window").width,
  );

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
        payload: buildQrPayload(orderId, t.ticketId),
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

  return (
    <View style={styles.host} onLayout={handleLayout}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        accessibilityLabel="Ticket QR carousel"
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

const styles = StyleSheet.create({
  host: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
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
