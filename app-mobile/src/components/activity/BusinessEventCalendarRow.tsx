/**
 * BusinessEventCalendarRow — renders one business-event ticket purchase
 * inside the consumer Calendar tab.
 *
 * ORCH-0842: tap on "View ticket" opens the new TicketPdfSheet (venue +
 * QR strip + real emailed PDF + Save/Share). The previous inline QR-only
 * Modal block is deleted — TicketPdfSheet supersedes it. Pending-payment
 * guard preserved: tapping "Finalizing…" rows does nothing.
 *
 * Per ORCH-0829-A spec §3.6. Data shape: `BusinessEventCalendarRow`
 * from `calendarService.ts`. Source is `useBusinessEventOrders` hook.
 */

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";

import { Icon } from "../ui/Icon";
import type { BusinessEventCalendarRow as BusinessEventRow } from "../../services/calendarService";
import TicketPdfSheet from "./TicketPdfSheet";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventLocalRange } from "../../utils/eventDateDisplay";

interface BusinessEventCalendarRowProps {
  entry: BusinessEventRow;
  // ORCH-0842: optional animation passed by CalendarTab so the row
  // participates in the staggered Active/Archive entrance.
  animation?: {
    opacity: Animated.Value;
    slide: Animated.Value;
  };
}

// ORCH-0877 — formatLocalDate replaced by centralized `formatEventLocalRange`
// from app-mobile/src/utils/eventDateDisplay.ts. Compact range with arrow
// when end is present; degrades to start-only otherwise.

const BusinessEventCalendarRow: React.FC<BusinessEventCalendarRowProps> = ({
  entry,
  animation,
}) => {
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);

  const handleOpenTickets = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleCloseTickets = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const dateLine = formatEventLocalRange({
    masterDateUtc: entry.masterDateUtc,
    // ORCH-0877 — calendar service uses the pre-ORCH-0853 field name
    // `masterDateEndUtc`; alias to the centralized helper's masterEndAtUtc.
    masterEndAtUtc: entry.masterDateEndUtc,
    timezone: entry.timezone,
  });
  const subtitle = entry.brandName
    ? `${entry.brandName} · ${dateLine}`
    : dateLine;

  const ticketCountLabel =
    entry.ticketCountValid === 1
      ? "1 ticket"
      : `${entry.ticketCountValid} tickets`;

  const isPending = entry.paymentStatus === "pending";

  const RowContainer = animation ? Animated.View : View;
  const animatedStyle = animation
    ? {
        opacity: animation.opacity,
        transform: [{ translateY: animation.slide }],
      }
    : undefined;

  return (
    <RowContainer style={[styles.row, animatedStyle]}>
      <View style={styles.thumbWrapper}>
        {entry.coverMediaUrl ? (
          <ExpoImage
            source={{ uri: entry.coverMediaUrl }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Icon name="calendar" size={24} color="rgba(255,255,255,0.55)" />
          </View>
        )}
        <View style={styles.minglaBadge}>
          <Text style={styles.minglaBadgeText}>On Mingla</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2} allowFontScaling>
          {entry.eventTitle}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} allowFontScaling>
          {subtitle}
        </Text>
        <View style={styles.ctaRow}>
          <View style={styles.ticketPill}>
            <Icon name="qr-code-outline" size={12} color="#eb7825" />
            <Text style={styles.ticketPillLabel}>{ticketCountLabel}</Text>
          </View>
          {isPending ? (
            <View style={styles.pendingPill}>
              <ActivityIndicator size="small" color="rgba(255,255,255,0.55)" />
              <Text style={styles.pendingLabel}>Finalizing…</Text>
            </View>
          ) : (
            <Pressable
              style={styles.viewCta}
              accessibilityLabel="View ticket"
              accessibilityRole="button"
              onPress={handleOpenTickets}
              hitSlop={8}
            >
              <Text style={styles.viewCtaLabel}>View ticket</Text>
              <Icon name="chevron-forward" size={14} color="#eb7825" />
            </Pressable>
          )}
        </View>
      </View>

      <TicketPdfSheet
        visible={sheetVisible}
        onClose={handleCloseTickets}
        entry={entry}
      />
    </RowContainer>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  thumbWrapper: {
    width: 72,
    height: 72,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  thumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  minglaBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(235,120,37,0.92)",
  },
  minglaBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  title: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 19,
  },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 16,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  ticketPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(235,120,37,0.14)",
  },
  ticketPillLabel: {
    color: "#eb7825",
    fontSize: 11,
    fontWeight: "700",
  },
  pendingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pendingLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontWeight: "600",
  },
  viewCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
  },
  viewCtaLabel: {
    color: "#eb7825",
    fontSize: 12,
    fontWeight: "700",
  },
});

export { BusinessEventCalendarRow };
export default BusinessEventCalendarRow;
