/**
 * RsvpPassSheet — ORCH-1163 [rsvp-shared-body].
 *
 * The consumer's RSVP "pass": a dark BaseBottomSheet (wrapInRNModal, z-stacked
 * above the floating tab bar) showing the venue block, the per-entity check-in QR
 * (when the host minted one), the guest's display name + Going/Pending status,
 * PDF download/share actions, and a change/cancel action. RSVP remains
 * ticketless; every pass comes from the canonical RSVP credential rows.
 *
 * Plus-one rows (role="guest") CANNOT cancel the party — the cancel CTA is hidden
 * and replaced by an "Ask {host} to update" note (only the primary owns the RSVP).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { Icon } from "../ui/Icon";
import type { ConsumerRsvpRow } from "../../services/calendarService";
import {
  fetchRsvpPartyPasses,
  fetchRsvpPassPdf,
  submitDeckRsvp,
} from "../../services/rsvpDeckService";
import type { RsvpPassCredential } from "@mingla/offering-rendering";
import { useAppStore } from "../../store/appStore";
import { toastManager } from "../ui/Toast";
// issue #2468 — the ONE host effect that opens a maps deep link.
import { openMapsTarget } from "../../utils/openMapsTarget";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventDateLine } from "../../utils/eventDateDisplay";
import { postHogService } from "../../services/postHogService";

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

export const RsvpPassSheet: React.FC<RsvpPassSheetProps> = ({
  visible,
  onClose,
  row,
}) => {
  const user = useAppStore((s) => s.user);
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [sharing, setSharing] = useState<boolean>(false);
  const [partyLoading, setPartyLoading] = useState<boolean>(false);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string>(
    row.guestId ?? row.rsvpId,
  );
  const fallbackCredential = useMemo<RsvpPassCredential | null>(() =>
    row.qrCode
      ? {
          entityType: row.guestId ? "guest" : "primary",
          entityId: row.guestId ?? row.rsvpId,
          displayName: row.displayName ?? "You",
          qrCode: row.qrCode,
          pdfFetchRef: row.guestId ?? row.rsvpId,
        }
      : null, [row.displayName, row.guestId, row.qrCode, row.rsvpId]);
  const [credentials, setCredentials] = useState<RsvpPassCredential[]>([]);

  const pageWidth = Math.max(0, windowWidth - SHEET_HORIZONTAL_PADDING * 2);
  const qrSize = Math.max(160, Math.min(pageWidth - 32, 360));

  const isPending = row.approvalStatus === "pending";
  const isGuest = row.role === "guest";
  const selectedCredential = credentials.find(
    (item) => item.entityId === selectedEntityId,
  ) ?? credentials[0] ?? null;

  const loadParty = useCallback((): void => {
    if (!visible || !fallbackCredential || isPending) return;
    setPartyLoading(true);
    setPartyError(null);
    void fetchRsvpPartyPasses(row.rsvpId)
      .then((party) => {
        setCredentials(party);
        if (party.length === 0) {
          setPartyError("This RSVP pass is no longer active.");
          return;
        }
        setSelectedEntityId((current) =>
          party.some((item) => item.entityId === current) ? current : party[0].entityId
        );
      })
      .catch(() => {
        setCredentials([]);
        setPartyError("Couldn't verify this RSVP pass.");
      })
      .finally(() => setPartyLoading(false));
  }, [fallbackCredential, isPending, row.rsvpId, visible]);

  useEffect(() => {
    if (!visible) return;
    setCredentials([]);
    setSelectedEntityId(row.guestId ?? row.rsvpId);
    loadParty();
  }, [fallbackCredential, loadParty, row.guestId, row.rsvpId, visible]);

  const dateLine = formatEventDateLine({
    masterDateUtc: row.masterDateUtc,
    masterEndAtUtc: row.masterDateEndUtc,
    timezone: row.timezone,
  });

  /*
    #2468 — the local `buildMapsQueryUrl` is DELETED; this now goes through the
    ONE builder, which also adds the canOpenURL pre-flight and the https
    fallback this sheet never had.

    NO COORDINATE IS AVAILABLE HERE, honestly: `ConsumerRsvpRow.venue` carries
    only `{ locationText, isOnline, onlineUrl }` because the
    `fetch_user_going_rsvps` RPC does not select `location_geo`. So this surface
    keeps the text path rather than fabricating a pin (Constitution #9).
    Threading the geo through that RPC is a backend change — filed as a
    discovery on #2468, not smuggled in here.
  */
  const handleOpenMaps = useCallback((): void => {
    openMapsTarget(
      { label: row.venue.locationText, geo: null },
      { onUnavailable: () => toastManager.show("Couldn't open maps", "error") },
    );
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

  const preparePdf = useCallback(async (
    pass: RsvpPassCredential,
  ): Promise<string> => {
    const result = await fetchRsvpPassPdf(pass.entityId, null, pass.entityType);
    const filename = result.pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const uri = `${FileSystem.cacheDirectory ?? ""}${filename}`;
    await FileSystem.writeAsStringAsync(uri, result.pdf.contentBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return uri;
  }, []);

  const handleDownload = useCallback((): void => {
    if (downloading || !selectedCredential?.qrCode) return;
    void (async () => {
      setDownloading(true);
      const surface = "explorer_calendar";
      postHogService.capture("rsvp_pass_pdf_requested", { surface });
      try {
        const uri = await preparePdf(selectedCredential);
        if (!(await Sharing.isAvailableAsync())) throw new Error("sharing_unavailable");
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf", dialogTitle: "Save RSVP invite", UTI: "com.adobe.pdf",
        });
        postHogService.capture("rsvp_pass_pdf_result", { surface, outcome: "success" });
      } catch {
        postHogService.capture("rsvp_pass_pdf_result", { surface, outcome: "failure" });
        toastManager.show("Couldn't download the RSVP invite. Try again.", "warning");
      } finally {
        setDownloading(false);
      }
    })();
  }, [downloading, preparePdf, selectedCredential]);

  const handleShare = useCallback((): void => {
    if (sharing || !selectedCredential?.qrCode) return;
    void (async () => {
      setSharing(true);
      try {
        const uri = await preparePdf(selectedCredential);
        if (!(await Sharing.isAvailableAsync())) throw new Error("sharing_unavailable");
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Share RSVP invite",
          UTI: "com.adobe.pdf",
        });
      } catch {
        toastManager.show("Couldn't share the RSVP invite. Try again.", "warning");
      } finally {
        setSharing(false);
      }
    })();
  }, [preparePdf, selectedCredential, sharing]);

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
      scrollMode="scroll"
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

        {partyLoading ? <ActivityIndicator size="small" color="#eb7825" /> : null}
        {partyError ? (
          <View style={styles.partyErrorRow}>
            <Text style={styles.partyError}>{partyError}</Text>
            <Pressable onPress={loadParty} accessibilityRole="button">
              <Text style={styles.partyRetry}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedCredential?.qrCode ? (
          <>
            {credentials.length > 1 ? (
              <View style={styles.partyTabs} testID="issue-1447-calendar-party-tabs">
                {credentials.map((pass) => {
                  const selected = pass.entityId === selectedCredential.entityId;
                  return (
                    <Pressable
                      key={pass.entityId}
                      onPress={() => setSelectedEntityId(pass.entityId)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${pass.displayName}, ${pass.entityType}`}
                      style={[styles.partyTab, selected && styles.partyTabSelected]}
                    >
                      <Text style={[styles.partyTabText, selected && styles.partyTabTextSelected]}>
                        {pass.displayName} · {pass.entityType === "primary" ? "Primary" : "Guest"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Text style={styles.qrLabel}>Show at door</Text>
            <View style={styles.qrPage}>
              <View style={styles.qrCodeWrap}>
                <QRCode
                  value={selectedCredential.qrCode}
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
            {selectedCredential?.displayName ?? row.displayName ?? "You"}
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

        {selectedCredential?.qrCode ? (
          <View style={styles.passActions}>
            <Pressable
              style={[styles.downloadButton, downloading && styles.cancelButtonBusy]}
              onPress={handleDownload}
              disabled={downloading || sharing}
              accessibilityRole="button"
              accessibilityLabel="Download RSVP pass PDF"
              testID="issue-1447-calendar-rsvp-download"
            >
              {downloading ? <ActivityIndicator size="small" color="#fff" /> :
                <Icon name="download-outline" size={18} color="#fff" />}
              <Text style={styles.cancelButtonLabel}>
                {downloading ? "Preparing…" : "Download PDF"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.downloadButton, sharing && styles.cancelButtonBusy]}
              onPress={handleShare}
              disabled={sharing || downloading}
              accessibilityRole="button"
              accessibilityLabel="Share RSVP pass"
              testID="issue-1447-calendar-rsvp-share"
            >
              {sharing ? <ActivityIndicator size="small" color="#fff" /> :
                <Icon name="share-outline" size={18} color="#fff" />}
              <Text style={styles.cancelButtonLabel}>{sharing ? "Preparing…" : "Share"}</Text>
            </Pressable>
          </View>
        ) : null}

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
  partyTabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  partyTab: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 12,
  },
  partyTabSelected: { backgroundColor: "rgba(235,120,37,0.18)", borderColor: "#eb7825" },
  partyTabText: { color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "700" },
  partyTabTextSelected: { color: "#fff" },
  partyErrorRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  partyError: { flex: 1, color: "rgba(255,255,255,0.62)", fontSize: 12 },
  partyRetry: { color: "#eb7825", fontSize: 12, fontWeight: "800" },
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
  downloadButton: {
    flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingHorizontal: 10, paddingVertical: 12, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  passActions: { flexDirection: "row", gap: 10, marginTop: 16 },
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
