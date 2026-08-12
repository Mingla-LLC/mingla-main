/**
 * RsvpSuccessPopup — ORCH-1163 [rsvp-shared-body] · FLOW A (§G).
 *
 * The shared, shell-agnostic success popup shown after a GOING RSVP resolves. It
 * surfaces the reservation DETAILS (event / when / where / guest / plus-ones /
 * status). Maybe / Not-going show NO popup. The title flips for a resolved
 * waitlisted / pending state (read from the onSubmit RESULT, not the request).
 *
 * Package-isolated (I-MOR-0827-PACKAGE-ISOLATION): React-Native <Modal> +
 * ThemePalette only — NO designSystem / app-src import. testID:
 * orch-1163-rsvp-success-popup.
 */

import React, { Suspense, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { boldFontFamily, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";

// Keep the sizeable SVG QR renderer out of the initial buyer-web bundle.
// @ts-expect-error -- the host apps provide this workspace peer dependency.
const QrCode = React.lazy(() => import("react-native-qrcode-svg"));

export interface RsvpPassCredential {
  entityType: "primary" | "guest";
  entityId: string;
  displayName: string;
  qrCode: string | null;
  pdfFetchRef: string;
}

export interface RsvpAnonymousRecovery {
  entityType: "primary" | "guest";
  entityId: string;
  recoveryToken: string | null;
  recoveryUrl: string | null;
}

/** Shared confirmation-details type (exported from the barrel). */
export interface RsvpConfirmationDetails {
  eventName: string;
  dateLine: string;
  venueLine: string;
  guestName: string;
  /** The success popup is GOING-only; the resolved server status drives the title. */
  status: "going" | "waitlisted" | "pending";
  plusGuests: Array<{ name: string }>;
  confirmationToken: string | null;
  credentials: RsvpPassCredential[];
  anonymousRecovery: RsvpAnonymousRecovery[];
}

export interface RsvpSuccessPopupProps {
  visible: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  details: RsvpConfirmationDetails | null;
  /** Append the Calendar nudge for a signed-in consumer (anon web omits it). */
  showCalendarNudge: boolean;
  onClose: () => void;
  /**
   * ORCH-1291 [rsvp-chip-in] — an OPTIONAL voluntary chip-in panel rendered
   * between the detail block and the Done button (the high-intent "you're in —
   * want to chip in?" moment). Provided by the body ONLY for a going/pending
   * guest on a chip-in-enabled event (SC-2); absent otherwise → no change.
   */
  chipInPanel?: React.ReactNode;
  onDownloadPass?: (
    credential: RsvpPassCredential,
    recovery: RsvpAnonymousRecovery | null,
  ) => Promise<void>;
}

const Row: React.FC<{
  label: string;
  value: string;
  palette: ThemePalette;
  bold: string;
}> = ({ label, value, palette, bold }) => (
  <View style={styles.detailRow}>
    <Text style={[styles.detailLabel, { color: palette.tertiaryText }]}>{label}</Text>
    <Text style={[styles.detailValue, { color: palette.primaryText, fontFamily: bold }]}>
      {value}
    </Text>
  </View>
);

export const RsvpSuccessPopup: React.FC<RsvpSuccessPopupProps> = (
  props: RsvpSuccessPopupProps,
) => {
  const {
    visible,
    palette,
    theme,
    details,
    showCalendarNudge,
    onClose,
    chipInPanel,
    onDownloadPass,
  } = props;
  const boldFamily = boldFontFamily(theme);
  const { height: windowHeight } = useWindowDimensions();
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  if (details === null) return null;

  const eligibleCredentials = details.credentials.filter(
    (item: RsvpPassCredential) => item.qrCode !== null,
  );
  const selected = eligibleCredentials.find(
    (item: RsvpPassCredential) => item.entityId === selectedEntityId,
  ) ??
    eligibleCredentials[0] ?? null;
  const selectedRecovery = selected === null ? null :
    details.anonymousRecovery.find(
      (item: RsvpAnonymousRecovery) => item.entityId === selected.entityId,
    ) ?? null;

  const title =
    details.status === "waitlisted"
      ? "You're on the waitlist"
      : details.status === "pending"
        ? "RSVP sent for approval"
        : "You’re on the list";
  const statusWord =
    details.status === "waitlisted"
      ? "Waitlisted"
      : details.status === "pending"
        ? "Pending approval"
        : "Going";
  const plusNames = details.plusGuests
    .map((g) => g.name)
    .filter((n) => n.trim().length > 0)
    .join(", ");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: palette.page,
              borderColor: palette.panelBorder,
              maxHeight: Math.min(650, Math.max(320, windowHeight - 48)),
            },
          ]}
          onPress={() => undefined}
          testID="orch-1163-rsvp-success-popup"
        >
          <ScrollView
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
          <Text style={[styles.title, { color: palette.primaryText, fontFamily: boldFamily }]}>
            {title}
          </Text>

          <View style={styles.detailBlock}>
            <Row label="Event" value={details.eventName} palette={palette} bold={boldFamily} />
            <Row label="When" value={details.dateLine} palette={palette} bold={boldFamily} />
            <Row label="Where" value={details.venueLine} palette={palette} bold={boldFamily} />
            <Row label="Guest" value={details.guestName} palette={palette} bold={boldFamily} />
            {plusNames.length > 0 ? (
              <Row label="Plus-ones" value={plusNames} palette={palette} bold={boldFamily} />
            ) : null}
            <Row label="Status" value={statusWord} palette={palette} bold={boldFamily} />
          </View>

          {selected !== null ? (
            <View style={styles.passBlock} testID="issue-1447-rsvp-pass-block">
              {eligibleCredentials.length > 1 ? (
                <View style={styles.partyTabs}>
                  {eligibleCredentials.map((credential: RsvpPassCredential) => (
                    <Pressable
                      key={credential.entityId}
                      onPress={() => setSelectedEntityId(credential.entityId)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: credential.entityId === selected.entityId }}
                      style={[
                        styles.partyTab,
                        { borderColor: palette.panelBorder },
                        credential.entityId === selected.entityId && { backgroundColor: palette.card },
                      ]}
                    >
                      <Text style={[styles.partyTabText, { color: palette.primaryText }]} numberOfLines={1}>
                        {credential.entityType === "primary" ? "You" : credential.displayName}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View
                style={[styles.qrCard, { backgroundColor: "#FFFFFF" }]}
                accessible
                accessibilityRole="image"
                accessibilityLabel={`RSVP QR code for ${selected.displayName}`}
              >
                <Suspense fallback={<View style={styles.qrFallback} />}>
                  <QrCode value={selected.qrCode as string} size={184} />
                </Suspense>
              </View>
              <Text style={[styles.passName, { color: palette.primaryText, fontFamily: boldFamily }]}>
                {selected.displayName}
              </Text>
              {onDownloadPass ? (
                <Pressable
                  onPress={() => {
                    if (downloading) return;
                    setDownloadError(null);
                    setDownloading(true);
                    void onDownloadPass(selected, selectedRecovery)
                      .catch(() => setDownloadError("Couldn't download the invite. Try again."))
                      .finally(() => setDownloading(false));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Download RSVP invite PDF"
                  style={[styles.downloadBtn, { borderColor: palette.panelBorder }]}
                  testID="issue-1447-rsvp-download-pdf"
                >
                  <Text style={[styles.downloadText, { color: palette.primaryText, fontFamily: boldFamily }]}>
                    {downloading ? "Preparing PDF…" : "Download RSVP invite PDF"}
                  </Text>
                </Pressable>
              ) : null}
              {downloadError ? <Text style={styles.downloadError}>{downloadError}</Text> : null}
            </View>
          ) : null}

          {showCalendarNudge ? (
            <Text style={[styles.nudge, { color: palette.secondaryText }]}>
              Find your RSVP + entry QR in your Calendar.
            </Text>
          ) : null}

          {/* ORCH-1291 [rsvp-chip-in] — the voluntary gift moment, above Done. */}
          {chipInPanel !== undefined && chipInPanel !== null ? (
            <View style={styles.chipInWrap}>{chipInPanel}</View>
          ) : null}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={[styles.doneBtn, { backgroundColor: palette.accent }]}
            testID="orch-1163-rsvp-success-done"
          >
            <Text style={[styles.doneBtnText, { color: palette.accentText, fontFamily: boldFamily }]}>
              Done
            </Text>
          </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
  },
  cardContent: { padding: 22 },
  title: { fontSize: 22, fontWeight: "900", letterSpacing: -0.4, marginBottom: 14 },
  detailBlock: { gap: 10 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailLabel: { fontSize: 13, fontWeight: "700" },
  detailValue: { fontSize: 14, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  nudge: { fontSize: 13, lineHeight: 19, marginTop: 14 },
  passBlock: { alignItems: "center", marginTop: 18, gap: 10 },
  partyTabs: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  partyTab: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 150 },
  partyTabText: { fontSize: 12, fontWeight: "800" },
  qrCard: { borderRadius: 16, padding: 14 },
  qrFallback: { width: 184, height: 184 },
  passName: { fontSize: 14, fontWeight: "800" },
  downloadBtn: { width: "100%", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingVertical: 12 },
  downloadText: { fontSize: 14, fontWeight: "800" },
  downloadError: { color: "#d14343", fontSize: 12, textAlign: "center" },
  chipInWrap: { marginTop: 16 },
  doneBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 18,
  },
  doneBtnText: { fontSize: 16, fontWeight: "900" },
});

export default RsvpSuccessPopup;
