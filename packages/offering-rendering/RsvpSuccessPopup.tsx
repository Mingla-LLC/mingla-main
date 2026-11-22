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
import { accentFill, themeFontFace } from "./themeAccentStyle";
import type { GuestInviteMessageInput, RsvpSubmittedGuest } from "./rsvpGuestParty";
import { rsvpPassChipLabel, rsvpPassLabel } from "./rsvpPassLabels";
// issue #4508 1.15 — only a reply that brought someone pays for this card.
const RsvpGuestInvitesCard = React.lazy(() => import("./RsvpGuestInvitesCard"));

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
  /** issue #4508 1.15 — each person brought, with the link their text carries. */
  invites?: RsvpSubmittedGuest[];
  /** issue #4508 1.15 — the message parts; each guest's link completes it. */
  inviteMessage?: Omit<GuestInviteMessageInput, "link">;
  /** issue #3281 S6 — the add-ons the guest picked with this RSVP. */
  addOns?: ReadonlyArray<{ name: string; quantity: number }>;
}

/** issue #3281 S6 — "Reserved seat × 1 · Tote bag × 2", or null for none. */
export const rsvpAddOnsLine = (
  addOns: RsvpConfirmationDetails["addOns"],
): string | null =>
  addOns === undefined || addOns.length === 0
    ? null
    : addOns.map((item) => `${item.name} × ${item.quantity}`).join(" · ");

export interface RsvpSuccessPopupProps {
  visible: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  details: RsvpConfirmationDetails | null;
  /** Append the Calendar nudge for a signed-in consumer (anon web omits it). */
  showCalendarNudge: boolean;
  onClose: () => void;
  /** Explorer keeps the credential view; public Business surfaces use claim. */
  passPresentation?: "qr" | "claim";
  claim?: {
    email: string | null;
    phoneLast4: string | null;
    shortUrl: string | null;
    onOpen: (url: string | null) => void;
  };
  /** Business desktop may supply its host-owned scan-to-phone card. */
  renderClaimBody?: () => React.ReactNode;
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
  /** issue #4508 1.15 — host copy / share for "Send it yourself too". */
  onCopyText?: (text: string) => void | Promise<void>;
  onShareText?: (text: string) => void | Promise<void>;
}

const Row: React.FC<{
  label: string;
  value: string;
  palette: ThemePalette;
  bold: string;
}> = ({ label, value, palette, bold }) => (
  <View style={styles.detailRow}>
    <Text style={[styles.detailLabel, { color: palette.tertiaryText }]}>
      {label}
    </Text>
    <Text
      style={[
        styles.detailValue,
        { color: palette.primaryText, ...themeFontFace(bold) },
      ]}
    >
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
    passPresentation = "qr",
    claim,
    renderClaimBody,
    onCopyText,
    onShareText,
  } = props;
  const boldFamily = boldFontFamily(theme);
  const boldFace = themeFontFace(boldFamily);
  const { height: windowHeight } = useWindowDimensions();
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  if (details === null) return null;

  const eligibleCredentials = details.credentials.filter(
    (item: RsvpPassCredential) => item.qrCode !== null,
  );
  // #4508 round 9: a guest's pass reads as their row does (rsvpPassLabel).
  const passLabel = (credential: RsvpPassCredential): string =>
    rsvpPassLabel(credential, details.invites);
  const selected =
    eligibleCredentials.find(
      (item: RsvpPassCredential) => item.entityId === selectedEntityId,
    ) ??
    eligibleCredentials[0] ??
    null;
  const selectedRecovery =
    selected === null
      ? null
      : (details.anonymousRecovery.find(
          (item: RsvpAnonymousRecovery) => item.entityId === selected.entityId,
        ) ?? null);

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
  const addOnsLine = rsvpAddOnsLine(details.addOns);

  const claimSignIn = (() => {
    const email = claim?.email?.trim() || null;
    const last4 = claim?.phoneLast4?.trim() || null;
    if (email && last4)
      return `Sign in with ${email} or the number ending ${last4}`;
    if (email) return `Sign in with ${email}`;
    if (last4) return `Sign in with the number ending ${last4}`;
    return "Sign in with the email or mobile number you used.";
  })();
  const claimStatusLine =
    details.status === "pending"
      ? "Needs approval? We'll text and email you when the host says yes."
      : details.status === "waitlisted"
        ? "A spot opened? We'll text and email you automatically."
        : null;
  const invites = details.invites ?? [];
  const invitesCard =
    invites.length > 0 && details.inviteMessage !== undefined ? (
      <Suspense fallback={null}>
        <RsvpGuestInvitesCard
          palette={palette}
          boldFamily={boldFamily}
          invites={invites}
          rsvpStatus={details.status}
          message={details.inviteMessage}
          onCopyText={onCopyText}
          onShareText={onShareText}
        />
      </Suspense>
    ) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* issue #4508 R4 — the backdrop is a sibling behind the card, not
          its parent: a parent Pressable made the whole card one "Dismiss"
          element for VoiceOver and swallowed the card's own buttons. It is
          hidden from screen readers; the card's Done / Close end the popup. */}
      <View style={styles.scrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          testID="issue-4508-rsvp-success-backdrop"
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.page,
              borderColor: palette.panelBorder,
              maxHeight: Math.min(650, Math.max(320, windowHeight - 48)),
            },
          ]}
          testID="orch-1163-rsvp-success-popup"
        >
          {passPresentation === "claim" ? (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={styles.closeButton}
              testID="issue-4063-rsvp-claim-close"
            >
              <Text style={[styles.closeText, { color: palette.primaryText }]}>
                ×
              </Text>
            </Pressable>
          ) : null}
          {/* R4: the content scrolls inside the card's max height (flexShrink),
              so later invite rows stay reachable on a small phone. */}
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            testID="issue-4508-rsvp-success-scroll"
          >
            <Text
              style={[
                styles.title,
                { color: palette.primaryText, ...boldFace },
              ]}
            >
              {title}
            </Text>

            {passPresentation === "claim" ? (
              renderClaimBody !== undefined ? (
                renderClaimBody()
              ) : (
                <View
                  style={styles.claimBody}
                  testID="issue-4063-rsvp-claim-body"
                >
                  <Text
                    style={[
                      styles.claimWaiting,
                      { color: palette.primaryText, ...boldFace },
                    ]}
                  >
                    Your pass is waiting in the Mingla app.
                  </Text>
                  <Text
                    style={[
                      styles.claimSignIn,
                      { color: palette.secondaryText },
                    ]}
                  >
                    {claimSignIn}
                  </Text>
                  <Pressable
                    onPress={() => claim?.onOpen(claim.shortUrl ?? null)}
                    accessibilityRole="button"
                    accessibilityLabel="Get my pass"
                    style={[
                      styles.claimButton,
                      accentFill(palette),
                    ]}
                    testID="issue-4063-rsvp-claim-primary"
                  >
                    <Text
                      style={[
                        styles.claimButtonText,
                        { color: palette.accentText, ...boldFace },
                      ]}
                    >
                      Get my pass
                    </Text>
                  </Pressable>
                  {claimStatusLine !== null ? (
                    <Text
                      style={[
                        styles.claimStatus,
                        { color: palette.secondaryText },
                      ]}
                    >
                      {claimStatusLine}
                    </Text>
                  ) : null}
                  {addOnsLine !== null ? (
                    <View style={styles.detailBlock} testID="issue-3281-rsvp-success-add-ons">
                      <Row label="Add-ons" value={addOnsLine} palette={palette} bold={boldFamily} />
                    </View>
                  ) : null}
                  {invitesCard}
                </View>
              )
            ) : (
              <>
                <View style={styles.detailBlock}>
                  <Row
                    label="Event"
                    value={details.eventName}
                    palette={palette}
                    bold={boldFamily}
                  />
                  <Row
                    label="When"
                    value={details.dateLine}
                    palette={palette}
                    bold={boldFamily}
                  />
                  <Row
                    label="Where"
                    value={details.venueLine}
                    palette={palette}
                    bold={boldFamily}
                  />
                  <Row
                    label="Guest"
                    value={details.guestName}
                    palette={palette}
                    bold={boldFamily}
                  />
                  {plusNames.length > 0 ? (
                    <Row
                      label="Plus-ones"
                      value={plusNames}
                      palette={palette}
                      bold={boldFamily}
                    />
                  ) : null}
                  {addOnsLine !== null ? (
                    <Row label="Add-ons" value={addOnsLine} palette={palette} bold={boldFamily} />
                  ) : null}
                  <Row
                    label="Status"
                    value={statusWord}
                    palette={palette}
                    bold={boldFamily}
                  />
                </View>

                {selected !== null ? (
                  <View
                    style={styles.passBlock}
                    testID="issue-1447-rsvp-pass-block"
                  >
                    {eligibleCredentials.length > 1 ? (
                      <View style={styles.partyTabs}>
                        {eligibleCredentials.map(
                          (credential: RsvpPassCredential) => (
                            <Pressable
                              key={credential.entityId}
                              onPress={() =>
                                setSelectedEntityId(credential.entityId)
                              }
                              accessibilityRole="tab"
                              // #4508 round 10: the full label for screen
                              // readers; the chip shows the short one.
                              accessibilityLabel={
                                credential.entityType === "primary"
                                  ? "You"
                                  : passLabel(credential)
                              }
                              accessibilityState={{
                                selected:
                                  credential.entityId === selected.entityId,
                              }}
                              style={[
                                styles.partyTab,
                                { borderColor: palette.panelBorder },
                                credential.entityId === selected.entityId && {
                                  backgroundColor: palette.card,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.partyTabText,
                                  { color: palette.primaryText },
                                ]}
                                numberOfLines={1}
                              >
                                {credential.entityType === "primary"
                                  ? "You"
                                  : rsvpPassChipLabel(credential, details.invites)}
                              </Text>
                            </Pressable>
                          ),
                        )}
                      </View>
                    ) : null}
                    <View
                      style={[styles.qrCard, { backgroundColor: "#FFFFFF" }]}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={`RSVP QR code for ${passLabel(selected)}`}
                    >
                      <Suspense fallback={<View style={styles.qrFallback} />}>
                        <QrCode value={selected.qrCode as string} size={184} />
                      </Suspense>
                    </View>
                    <Text
                      style={[
                        styles.passName,
                        { color: palette.primaryText, ...boldFace },
                      ]}
                    >
                      {passLabel(selected)}
                    </Text>
                    {onDownloadPass ? (
                      <Pressable
                        onPress={() => {
                          if (downloading) return;
                          setDownloadError(null);
                          setDownloading(true);
                          void onDownloadPass(selected, selectedRecovery)
                            .catch(() =>
                              setDownloadError(
                                "Couldn't download the invite. Try again.",
                              ),
                            )
                            .finally(() => setDownloading(false));
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Download RSVP invite PDF"
                        style={[
                          styles.downloadBtn,
                          { borderColor: palette.panelBorder },
                        ]}
                        testID="issue-1447-rsvp-download-pdf"
                      >
                        <Text
                          style={[
                            styles.downloadText,
                            {
                              color: palette.primaryText,
                              ...boldFace,
                            },
                          ]}
                        >
                          {downloading
                            ? "Preparing PDF…"
                            : "Download RSVP invite PDF"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {downloadError ? (
                      <Text style={styles.downloadError}>{downloadError}</Text>
                    ) : null}
                  </View>
                ) : null}

                {invitesCard}

                {showCalendarNudge ? (
                  <Text
                    style={[styles.nudge, { color: palette.secondaryText }]}
                  >
                    Find your RSVP + entry QR in your Calendar.
                  </Text>
                ) : null}

                {/* ORCH-1291 [rsvp-chip-in] — the voluntary gift moment, above Done. */}
                {chipInPanel !== undefined && chipInPanel !== null ? (
                  <View style={styles.chipInWrap}>{chipInPanel}</View>
                ) : null}
              </>
            )}
          </ScrollView>
          {passPresentation === "claim" ? null : (
            // R4: Done is pinned under the scrolling content, always reachable.
            <View
              style={[styles.footer, { borderColor: palette.panelBorder }]}
              testID="issue-4508-rsvp-success-footer"
            >
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={[styles.doneBtn, accentFill(palette)]}
                testID="orch-1163-rsvp-success-done"
              >
                <Text
                  style={[
                    styles.doneBtnText,
                    { color: palette.accentText, ...boldFace },
                  ]}
                >
                  Done
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
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
    position: "relative",
    overflow: "hidden",
  },
  cardContent: { padding: 22 },
  // R4: shrink to the card's max height instead of growing past it.
  cardScroll: { flexGrow: 0, flexShrink: 1 },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginBottom: 14,
  },
  detailBlock: { gap: 10 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailLabel: { fontSize: 13, fontWeight: "700" },
  detailValue: {
    fontSize: 14,
    fontWeight: "800",
    flexShrink: 1,
    textAlign: "right",
  },
  nudge: { fontSize: 13, lineHeight: 19, marginTop: 14 },
  passBlock: { alignItems: "center", marginTop: 18, gap: 10 },
  partyTabs: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  partyTab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 150,
  },
  partyTabText: { fontSize: 12, fontWeight: "800" },
  qrCard: { borderRadius: 16, padding: 14 },
  qrFallback: { width: 184, height: 184 },
  passName: { fontSize: 14, fontWeight: "800" },
  downloadBtn: {
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
  },
  downloadText: { fontSize: 14, fontWeight: "800" },
  downloadError: { color: "#d14343", fontSize: 12, textAlign: "center" },
  chipInWrap: { marginTop: 16 },
  doneBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 15,
  },
  doneBtnText: { fontSize: 16, fontWeight: "900" },
  closeButton: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 2,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontSize: 28, lineHeight: 30 },
  claimBody: { gap: 14 },
  claimWaiting: { fontSize: 17, lineHeight: 24, fontWeight: "800" },
  claimSignIn: { fontSize: 14, lineHeight: 21 },
  claimButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingHorizontal: 18,
  },
  claimButtonText: { fontSize: 15, fontWeight: "900" },
  claimStatus: { fontSize: 13, lineHeight: 19 },
});

export default RsvpSuccessPopup;
