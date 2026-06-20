/**
 * RsvpPassSheet — ORCH-1163 [rsvp-shared-body].
 *
 * The consumer's RSVP "pass": a dark BaseBottomSheet (wrapInRNModal, z-stacked
 * above the floating tab bar) showing the venue block, the per-entity check-in QR
 * (when the host minted one), the guest's display name + Going/Pending status,
 * and a change/cancel action. RSVP is ticketless — there is NO PDF / download
 * here (unlike the ticket TicketPdfSheet it's modeled on).
 *
 * Plus-one rows (role="guest") CANNOT cancel the party — the cancel CTA is hidden
 * and replaced by an "Ask {host} to update" note (only the primary owns the RSVP).
 */

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import QRCode from "react-native-qrcode-svg";
import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "../ui/Icon";
import type { ConsumerRsvpRow } from "../../services/calendarService";
import { submitDeckRsvp } from "../../services/rsvpDeckService";
import { useAppStore } from "../../store/appStore";
import { toastManager } from "../ui/Toast";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventDateLine } from "../../utils/eventDateDisplay";

interface RsvpPassSheetProps {
  visible: boolean;
  onClose: () => void;
  row: ConsumerRsvpRow;
}

// Sheet inner padding (matches styles.card.paddingHorizontal). Used to size the
// QR to the available content width.
const SHEET_HORIZONTAL_PADDING = 20;

// Fixed tall snap (mirror TicketPdfSheet — read-only pass viewer).
const RSVP_PASS_SNAP_POINTS = ["88%"];

// Preserve the bespoke dark canvas the ticket pass shipped with (#15181f,
// topRadius 28) so the RSVP pass reads byte-consistently with it.
const RSVP_PASS_BACKGROUND_STYLE: ViewStyle = {
  backgroundColor: "#15181f",
  borderTopLeftRadius: 28,
  borderTopRightRadius: 28,
};

function buildMapsQueryUrl(label: string): string {
  const q = encodeURIComponent(label);
  return Platform.OS === "ios"
    ? `maps://?q=${q}`
    : Platform.OS === "android"
      ? `geo:0,0?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export const RsvpPassSheet: React.FC<RsvpPassSheetProps> = ({
  visible,
  onClose,
  row,
}) => {
  const user = useAppStore((s) => s.user);
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();
  const [cancelling, setCancelling] = useState<boolean>(false);

  const pageWidth = Math.max(0, windowWidth - SHEET_HORIZONTAL_PADDING * 2);
  const qrSize = Math.max(160, Math.min(pageWidth - 32, 360));

  const isPending = row.approvalStatus === "pending";
  const isGuest = row.role === "guest";

  const dateLine = formatEventDateLine({
    masterDateUtc: row.masterDateUtc,
    masterEndAtUtc: row.masterDateEndUtc,
    timezone: row.timezone,
  });

  const handleOpenMaps = useCallback((): void => {
    const label = row.venue.locationText;
    if (!label || label.length === 0) return;
    void Linking.openURL(buildMapsQueryUrl(label)).catch(() => undefined);
  }, [row.venue.locationText]);

  const handleOpenOnlineLink = useCallback((): void => {
    if (!row.venue.onlineUrl) return;
    void Linking.openURL(row.venue.onlineUrl).catch(() => undefined);
  }, [row.venue.onlineUrl]);

  // Change/cancel: the primary submits not_going (drops the whole party) via the
  // same public-submit-rsvp path, then we refresh the consumer Calendar.
  const handleCancel = useCallback((): void => {
    if (cancelling || isGuest) return;
    void (async () => {
      setCancelling(true);
      try {
        await submitDeckRsvp(row.eventId, "not_going");
        if (user?.id) {
          await queryClient.invalidateQueries({
            queryKey: ["myGoingRsvps", user.id],
          });
        }
        toastManager.show("You're no longer going.", "success");
        onClose();
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        toastManager.show(
          code.includes("rsvp_not_open")
            ? "RSVPs are closed for this event."
            : "Couldn't update your RSVP. Try again.",
          "warning",
        );
      } finally {
        setCancelling(false);
      }
    })();
  }, [cancelling, isGuest, row.eventId, user?.id, queryClient, onClose]);

  const renderVenue = (): React.ReactNode => {
    if (row.venue.isOnline) {
      return (
        <View style={styles.venueBlock}>
          <View style={styles.venueRow}>
            <Icon name="globe-outline" size={16} color="#eb7825" />
            <Text style={styles.venueText}>Online event</Text>
          </View>
          {row.venue.onlineUrl ? (
            <Pressable
              style={styles.venueAction}
              onPress={handleOpenOnlineLink}
              accessibilityRole="button"
              accessibilityLabel="Open online event link"
              hitSlop={8}
            >
              <Icon name="open-outline" size={14} color="#eb7825" />
              <Text style={styles.venueActionLabel}>Open link</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }
    if (row.venue.locationText && row.venue.locationText.length > 0) {
      return (
        <View style={styles.venueBlock}>
          <View style={styles.venueRow}>
            <Icon name="location-outline" size={16} color="#eb7825" />
            <Text style={styles.venueText}>{row.venue.locationText}</Text>
          </View>
          <Pressable
            style={styles.venueAction}
            onPress={handleOpenMaps}
            accessibilityRole="button"
            accessibilityLabel="Open venue in Maps"
            hitSlop={8}
          >
            <Icon name="map-outline" size={14} color="#eb7825" />
            <Text style={styles.venueActionLabel}>Open in Maps</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.venueBlock}>
        <Text style={styles.venueFallback}>Location shared by the host</Text>
      </View>
    );
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      theme="dark"
      snapPoints={RSVP_PASS_SNAP_POINTS}
      wrapInRNModal
      backgroundStyle={RSVP_PASS_BACKGROUND_STYLE}
      scrollMode="view"
      accessibilityLabel={`RSVP pass for ${row.eventTitle}`}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={2}>
              {row.eventTitle}
            </Text>
            {row.brandName ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {row.brandName} · {dateLine}
              </Text>
            ) : (
              <Text style={styles.subtitle} numberOfLines={1}>
                {dateLine}
              </Text>
            )}
          </View>
          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close RSVP pass"
            hitSlop={12}
          >
            <Icon name="close" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        {renderVenue()}

        {row.qrCode ? (
          <>
            <Text style={styles.qrLabel}>Show at door</Text>
            <View style={styles.qrPage}>
              <View style={styles.qrCodeWrap}>
                <QRCode
                  value={row.qrCode}
                  size={qrSize}
                  backgroundColor="#fff"
                  color="#0c0e12"
                />
              </View>
            </View>
          </>
        ) : null}

        <View style={styles.passRow}>
          <Text style={styles.passName} numberOfLines={1}>
            {row.displayName ?? "You"}
          </Text>
          <Text
            style={[
              styles.passStatus,
              isPending ? styles.passStatusPending : styles.passStatusGoing,
            ]}
          >
            {isPending ? "Pending" : "Going"}
          </Text>
        </View>

        {isGuest ? (
          <Text style={styles.guestNote}>
            {row.invitedBy
              ? `Ask ${row.invitedBy} to update this RSVP.`
              : "Ask the host to update this RSVP."}
          </Text>
        ) : (
          <Pressable
            style={[
              styles.cancelButton,
              cancelling ? styles.cancelButtonBusy : null,
            ]}
            onPress={handleCancel}
            disabled={cancelling}
            accessibilityRole="button"
            accessibilityLabel="Change or cancel this RSVP"
            hitSlop={8}
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="close-circle-outline" size={18} color="#fff" />
            )}
            <Text style={styles.cancelButtonLabel}>
              {cancelling ? "Updating…" : "Can't go anymore"}
            </Text>
          </Pressable>
        )}
      </View>
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 23,
  },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 16,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  venueBlock: {
    marginBottom: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    gap: 8,
  },
  venueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  venueText: {
    flex: 1,
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    lineHeight: 18,
  },
  venueAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  venueActionLabel: {
    color: "#eb7825",
    fontSize: 12,
    fontWeight: "700",
  },
  venueFallback: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontStyle: "italic",
  },
  qrLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  qrPage: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  qrCodeWrap: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#fff",
  },
  passRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    gap: 12,
  },
  passName: {
    flex: 1,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
  },
  passStatus: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  passStatusGoing: {
    color: "#1ea672",
    backgroundColor: "rgba(30,166,114,0.16)",
  },
  passStatusPending: {
    color: "#eab308",
    backgroundColor: "rgba(234,179,8,0.16)",
  },
  guestNote: {
    marginTop: 16,
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 18,
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "rgba(227,84,60,0.9)",
  },
  cancelButtonBusy: {
    opacity: 0.7,
  },
  cancelButtonLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});

export default RsvpPassSheet;
