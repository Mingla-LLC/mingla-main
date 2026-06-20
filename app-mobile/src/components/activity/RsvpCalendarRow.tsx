/**
 * RsvpCalendarRow — ORCH-1163 [rsvp-shared-body].
 *
 * Renders one of the signed-in user's "Going" RSVPs inside the consumer Calendar
 * tab, alongside calendar entries + business orders + reservations. Tapping
 * "View RSVP" opens the RsvpPassSheet (venue + the per-entity QR pass + change/
 * cancel). RSVP is ticketless — there is NO PDF / payment surface here.
 *
 * Mirrors BusinessEventCalendarRow's prop/animation shape (cover thumb + "On
 * Mingla" badge + title + subtitle + a status pill + a "View" CTA) so the row
 * participates in the same staggered Active/Archive entrance and reads
 * byte-consistently with the ticket rows.
 */

import React, { useCallback, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";

import { Icon } from "../ui/Icon";
import type { ConsumerRsvpRow } from "../../services/calendarService";
import RsvpPassSheet from "./RsvpPassSheet";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventLocalRange } from "../../utils/eventDateDisplay";

interface RsvpCalendarRowProps {
  row: ConsumerRsvpRow;
  // ORCH-1163: optional animation passed by CalendarTab so the row participates
  // in the staggered Active/Archive entrance.
  animation?: {
    opacity: Animated.Value;
    slide: Animated.Value;
  };
}

const RsvpCalendarRow: React.FC<RsvpCalendarRowProps> = ({ row, animation }) => {
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);

  const handleOpenPass = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleClosePass = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const dateLine = formatEventLocalRange({
    masterDateUtc: row.masterDateUtc,
    masterEndAtUtc: row.masterDateEndUtc,
    timezone: row.timezone,
  });
  const subtitle = row.brandName
    ? `${row.brandName} · ${dateLine}`
    : dateLine;

  // Pending host approval → "Pending"; otherwise the user is going.
  const isPending = row.approvalStatus === "pending";
  const statusLabel = isPending ? "RSVP · Pending" : "RSVP · Going";

  // A plus-one row tells the user who brought them; the primary's own row may
  // surface its extras count.
  const roleHint =
    row.role === "guest" && row.invitedBy
      ? `Invited by ${row.invitedBy}`
      : row.plusGuestNames.length > 0
        ? row.plusGuestNames.length === 1
          ? "+1 guest"
          : `+${row.plusGuestNames.length} guests`
        : null;

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
        {row.coverMediaUrl ? (
          <ExpoImage
            source={{ uri: row.coverMediaUrl }}
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
          {row.eventTitle}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} allowFontScaling>
          {subtitle}
        </Text>
        {roleHint ? (
          <Text style={styles.roleHint} numberOfLines={1} allowFontScaling>
            {roleHint}
          </Text>
        ) : null}
        <View style={styles.ctaRow}>
          <View
            style={[
              styles.statusPill,
              isPending ? styles.statusPillPending : styles.statusPillGoing,
            ]}
          >
            <Icon
              name={isPending ? "time-outline" : "checkmark-circle"}
              size={12}
              color={isPending ? "#eab308" : "#1ea672"}
            />
            <Text
              style={[
                styles.statusPillLabel,
                isPending
                  ? styles.statusPillLabelPending
                  : styles.statusPillLabelGoing,
              ]}
            >
              {statusLabel}
            </Text>
          </View>
          <Pressable
            style={styles.viewCta}
            accessibilityLabel="View RSVP"
            accessibilityRole="button"
            onPress={handleOpenPass}
            hitSlop={8}
          >
            <Text style={styles.viewCtaLabel}>View RSVP</Text>
            <Icon name="chevron-forward" size={14} color="#eb7825" />
          </Pressable>
        </View>
      </View>

      <RsvpPassSheet
        visible={sheetVisible}
        onClose={handleClosePass}
        row={row}
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
  roleHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    lineHeight: 15,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusPillGoing: {
    backgroundColor: "rgba(30,166,114,0.14)",
  },
  statusPillPending: {
    backgroundColor: "rgba(234,179,8,0.14)",
  },
  statusPillLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  statusPillLabelGoing: {
    color: "#1ea672",
  },
  statusPillLabelPending: {
    color: "#eab308",
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

export { RsvpCalendarRow };
export default RsvpCalendarRow;
