/**
 * BusinessEventCalendarRow — renders one business-event ticket purchase
 * inside the consumer Calendar tab.
 *
 * Per ORCH-0829-A spec §3.6. Data shape: `BusinessEventCalendarRow`
 * from `calendarService.ts`. Source is `useBusinessEventOrders` hook
 * (queries `orders + tickets + events + brands + event_dates` for the
 * signed-in consumer).
 */

import React, { useCallback } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import QRCode from "react-native-qrcode-svg";
import { useState } from "react";

import { Icon } from "../ui/Icon";
import type { BusinessEventCalendarRow as BusinessEventRow } from "../../services/calendarService";

interface BusinessEventCalendarRowProps {
  entry: BusinessEventRow;
}

const formatLocalDate = (
  masterDateUtc: string | null,
  timezone: string,
): string => {
  if (!masterDateUtc) return "Date to be announced";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    }).format(new Date(masterDateUtc));
  } catch {
    return masterDateUtc;
  }
};

export const BusinessEventCalendarRow: React.FC<
  BusinessEventCalendarRowProps
> = ({ entry }) => {
  const [qrSheetVisible, setQrSheetVisible] = useState<boolean>(false);

  const handleOpenTickets = useCallback((): void => {
    setQrSheetVisible(true);
  }, []);

  const handleCloseTickets = useCallback((): void => {
    setQrSheetVisible(false);
  }, []);

  const dateLine = formatLocalDate(entry.masterDateUtc, entry.timezone);
  const subtitle = entry.brandName
    ? `${entry.brandName} · ${dateLine}`
    : dateLine;

  const ticketCountLabel =
    entry.ticketCountValid === 1
      ? "1 ticket"
      : `${entry.ticketCountValid} tickets`;

  const isPending = entry.paymentStatus === "pending";

  return (
    <View style={styles.row}>
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

      <Modal
        visible={qrSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseTickets}
        statusBarTranslucent
      >
        <View style={styles.qrBackdrop}>
          <View style={styles.qrCard}>
            <View style={styles.qrHeader}>
              <Text style={styles.qrTitle} numberOfLines={2} allowFontScaling>
                {entry.eventTitle}
              </Text>
              <Pressable
                style={styles.qrClose}
                accessibilityLabel="Close ticket viewer"
                accessibilityRole="button"
                hitSlop={12}
                onPress={handleCloseTickets}
              >
                <Icon name="close" size={20} color="rgba(255,255,255,0.65)" />
              </Pressable>
            </View>
            <Text style={styles.qrSubtitle}>{subtitle}</Text>
            <ScrollView
              style={styles.qrScroll}
              contentContainerStyle={styles.qrScrollContent}
            >
              {entry.tickets.map((ticket) => (
                <View key={ticket.id} style={styles.qrTicketBlock}>
                  <View style={styles.qrCodeWrap}>
                    <QRCode
                      value={ticket.qrCode}
                      size={200}
                      backgroundColor="#fff"
                      color="#0c0e12"
                    />
                  </View>
                  <Text style={styles.qrTicketStatus}>
                    {ticket.status === "valid"
                      ? "Valid · Show at door"
                      : `Status: ${ticket.status}`}
                  </Text>
                  {ticket.attendeeName ? (
                    <Text style={styles.qrTicketAttendee} numberOfLines={1}>
                      {ticket.attendeeName}
                    </Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
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
  qrBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  qrCard: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 28,
    maxHeight: "85%",
  },
  qrHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  qrTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  qrClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  qrSubtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    marginBottom: 18,
  },
  qrScroll: {
    flexGrow: 0,
  },
  qrScrollContent: {
    alignItems: "center",
    gap: 24,
    paddingBottom: 12,
  },
  qrTicketBlock: {
    alignItems: "center",
    gap: 10,
  },
  qrCodeWrap: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#fff",
  },
  qrTicketStatus: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "600",
  },
  qrTicketAttendee: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
  },
});

export default BusinessEventCalendarRow;
