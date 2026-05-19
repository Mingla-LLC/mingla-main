/**
 * TicketPdfSheet — ORCH-0842 [Fold Tickets into Active + render real
 * ticket PDF in bottom sheet with venue/QR/Save].
 *
 * Bottom sheet with three sections: venue block, per-ticket QR strip,
 * and a "Download PDF" button that fetches the emailed PDF from
 * Supabase Storage and hands it to the native share sheet so the user
 * can Save to Files (iOS) or pick a destination (Android).
 *
 * Operator feedback 2026-05-17: inline PDF rendering removed in favor
 * of the simpler download-only flow. QR codes are the primary at-door
 * artifact; the PDF is a download-on-demand convenience.
 *
 * Reuses the existing raw RN `<Modal>` pattern (see
 * BusinessEventCalendarRow:128-181) — no new sheet primitive introduced.
 *
 * Invariant compliance:
 *   I-PROPOSED-AK (server-side; the fetch endpoint enforces owner check)
 *   I-RN-SUB-SHEET-INSIDE-PARENT — the native Sharing.shareAsync call is
 *     an OS-level invocation, not a JS sibling Modal; safe per memory.
 */

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
// expo-file-system v19 split the API. The legacy entry exposes the
// `cacheDirectory` constant + `downloadAsync` helper we need.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";

import { Icon } from "../ui/Icon";
import type { BusinessEventCalendarRow } from "../../services/calendarService";
import { TicketService } from "../../services/ticketService";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventDateLine } from "../../utils/eventDateDisplay";

interface TicketPdfSheetProps {
  visible: boolean;
  onClose: () => void;
  entry: BusinessEventCalendarRow;
}

type DownloadStatus = "idle" | "downloading" | "error";

interface SheetState {
  status: DownloadStatus;
  error: string | null;
}

const initialState: SheetState = { status: "idle", error: null };

function buildMapsUrl(
  lat: number,
  lng: number,
  label: string | null,
): string {
  const q = encodeURIComponent(label ?? "");
  return Platform.OS === "ios"
    ? `maps://?q=${q}&ll=${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
}

// ORCH-0877 — formatLocalDate replaced by centralized `formatEventDateLine`
// from app-mobile/src/utils/eventDateDisplay.ts. PDF sheet has room for
// full date + time range.

// Sheet inner padding (matches styles.card.paddingHorizontal). Used to
// compute the full-width-per-page QR carousel.
const SHEET_HORIZONTAL_PADDING = 20;

export const TicketPdfSheet: React.FC<TicketPdfSheetProps> = ({
  visible,
  onClose,
  entry,
}) => {
  const [state, setState] = useState<SheetState>(initialState);
  const [carouselPage, setCarouselPage] = useState<number>(0);
  const { width: windowWidth } = useWindowDimensions();

  const localUriForOrder = `${FileSystem.cacheDirectory ?? ""}ticket-pdf-${entry.orderId}.pdf`;

  // One QR per page; page width = sheet content width.
  const pageWidth = Math.max(0, windowWidth - SHEET_HORIZONTAL_PADDING * 2);
  // QR fills the page minus a small white-card border on each side.
  const qrSize = Math.max(160, Math.min(pageWidth - 32, 360));

  const handleCarouselScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const offsetX = event.nativeEvent.contentOffset.x;
      const next = Math.round(offsetX / pageWidth);
      if (next !== carouselPage) setCarouselPage(next);
    },
    [carouselPage, pageWidth],
  );

  const handleDownload = useCallback(async (): Promise<void> => {
    setState({ status: "downloading", error: null });
    try {
      const { signedUrl } = await TicketService.fetchTicketPdfUrl(
        entry.orderId,
      );
      const downloadResult = await FileSystem.downloadAsync(
        signedUrl,
        localUriForOrder,
      );
      if (downloadResult.status >= 400) {
        throw new Error(
          `Couldn't download ticket PDF (${downloadResult.status})`,
        );
      }
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        setState({
          status: "error",
          error: "Sharing isn't available on this device.",
        });
        return;
      }
      await Sharing.shareAsync(downloadResult.uri, {
        mimeType: "application/pdf",
        dialogTitle: "Save ticket",
        UTI: "com.adobe.pdf",
      });
      setState({ status: "idle", error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", error: message });
    }
  }, [entry.orderId, localUriForOrder]);

  const handleOpenMaps = useCallback((): void => {
    const lat = entry.venue.locationGeoLat;
    const lng = entry.venue.locationGeoLng;
    if (lat == null || lng == null) return;
    const url = buildMapsUrl(lat, lng, entry.venue.locationText);
    void Linking.openURL(url).catch(() => undefined);
  }, [entry.venue]);

  const handleOpenOnlineLink = useCallback((): void => {
    if (!entry.venue.onlineUrl) return;
    void Linking.openURL(entry.venue.onlineUrl).catch(() => undefined);
  }, [entry.venue.onlineUrl]);

  const handleOpenOnWeb = useCallback((): void => {
    if (!entry.publicBuyerUrl) return;
    void WebBrowser.openBrowserAsync(entry.publicBuyerUrl).catch(
      () => undefined,
    );
  }, [entry.publicBuyerUrl]);

  const dateLine = formatEventDateLine({
    masterDateUtc: entry.masterDateUtc,
    // ORCH-0877 — calendar service uses the pre-ORCH-0853 field name
    // `masterDateEndUtc`; alias to the centralized helper's masterEndAtUtc.
    masterEndAtUtc: entry.masterDateEndUtc,
    timezone: entry.timezone,
  });

  const renderVenue = (): React.ReactNode => {
    if (entry.venue.isOnline) {
      return (
        <View style={styles.venueBlock}>
          <View style={styles.venueRow}>
            <Icon name="globe-outline" size={16} color="#eb7825" />
            <Text style={styles.venueText}>Online event</Text>
          </View>
          {entry.venue.onlineUrl ? (
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
    if (entry.venue.locationText && entry.venue.locationText.length > 0) {
      const canMap =
        entry.venue.locationGeoLat != null &&
        entry.venue.locationGeoLng != null;
      return (
        <View style={styles.venueBlock}>
          <View style={styles.venueRow}>
            <Icon name="location-outline" size={16} color="#eb7825" />
            <Text style={styles.venueText}>{entry.venue.locationText}</Text>
          </View>
          {canMap ? (
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
          ) : null}
        </View>
      );
    }
    return (
      <View style={styles.venueBlock}>
        <Text style={styles.venueFallback}>Venue details in your email</Text>
      </View>
    );
  };

  const isDownloading = state.status === "downloading";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.dragHandle} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={2}>
                {entry.eventTitle}
              </Text>
              {entry.brandName ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {entry.brandName} · {dateLine}
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
              accessibilityLabel="Close ticket viewer"
              hitSlop={12}
            >
              <Icon name="close" size={20} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>

          {renderVenue()}

          <View style={styles.qrLabelRow}>
            <Text style={styles.qrLabel}>Show at door</Text>
            {entry.tickets.length > 1 ? (
              <Text style={styles.qrCounter}>
                {carouselPage + 1} of {entry.tickets.length}
              </Text>
            ) : null}
          </View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={pageWidth}
            snapToAlignment="start"
            disableIntervalMomentum
            onScroll={handleCarouselScroll}
            scrollEventThrottle={16}
            contentContainerStyle={styles.qrCarouselContent}
          >
            {entry.tickets.map((ticket, idx) => (
              <View
                key={ticket.id}
                style={[styles.qrPage, { width: pageWidth }]}
              >
                <View style={styles.qrCodeWrap}>
                  <QRCode
                    value={ticket.qrCode}
                    size={qrSize}
                    backgroundColor="#fff"
                    color="#0c0e12"
                  />
                </View>
                <Text style={styles.qrName} numberOfLines={1}>
                  {ticket.attendeeName ?? `Guest #${idx + 1}`}
                </Text>
                <Text
                  style={[
                    styles.qrStatus,
                    ticket.status === "valid"
                      ? styles.qrStatusValid
                      : ticket.status === "used"
                        ? styles.qrStatusUsed
                        : styles.qrStatusVoid,
                  ]}
                >
                  {ticket.status === "valid"
                    ? "Valid"
                    : ticket.status === "used"
                      ? "Used"
                      : ticket.status[0].toUpperCase() + ticket.status.slice(1)}
                </Text>
              </View>
            ))}
          </ScrollView>
          {entry.tickets.length > 1 ? (
            <View style={styles.dotsRow}>
              {entry.tickets.map((ticket, idx) => (
                <View
                  key={`dot:${ticket.id}`}
                  style={[
                    styles.dot,
                    idx === carouselPage ? styles.dotActive : null,
                  ]}
                />
              ))}
            </View>
          ) : null}

          <Pressable
            style={[
              styles.downloadButton,
              isDownloading ? styles.downloadButtonBusy : null,
            ]}
            onPress={handleDownload}
            disabled={isDownloading}
            accessibilityRole="button"
            accessibilityLabel="Download ticket PDF"
            hitSlop={8}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="download-outline" size={18} color="#fff" />
            )}
            <Text style={styles.downloadButtonLabel}>
              {isDownloading ? "Preparing PDF…" : "Download PDF"}
            </Text>
          </Pressable>

          {state.status === "error" && state.error ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorLabel} numberOfLines={3}>
                {state.error}
              </Text>
              <View style={styles.errorActions}>
                <Pressable
                  style={styles.errorButton}
                  onPress={handleDownload}
                  accessibilityRole="button"
                  accessibilityLabel="Try downloading ticket PDF again"
                  hitSlop={8}
                >
                  <Text style={styles.errorButtonLabel}>Try again</Text>
                </Pressable>
                {entry.publicBuyerUrl ? (
                  <Pressable
                    style={[styles.errorButton, styles.errorButtonSecondary]}
                    onPress={handleOpenOnWeb}
                    accessibilityRole="button"
                    accessibilityLabel="View ticket on web"
                    hitSlop={8}
                  >
                    <Text style={styles.errorButtonLabel}>View on web</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    maxHeight: "88%",
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 12,
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
  qrLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  qrLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  qrCounter: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "600",
  },
  qrCarouselContent: {
    paddingBottom: 4,
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
  qrName: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "600",
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  dotActive: {
    backgroundColor: "#eb7825",
    width: 18,
  },
  qrStatus: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  qrStatusValid: {
    color: "#1ea672",
    backgroundColor: "rgba(30,166,114,0.16)",
  },
  qrStatusUsed: {
    color: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  qrStatusVoid: {
    color: "#e3543c",
    backgroundColor: "rgba(227,84,60,0.16)",
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#eb7825",
  },
  downloadButtonBusy: {
    opacity: 0.7,
  },
  downloadButtonLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  errorRow: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(227,84,60,0.08)",
    gap: 10,
  },
  errorLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    lineHeight: 17,
  },
  errorActions: {
    flexDirection: "row",
    gap: 10,
  },
  errorButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#eb7825",
  },
  errorButtonSecondary: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  errorButtonLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});

export default TicketPdfSheet;
