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

import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { boldFontFamily, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";

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
}

export interface RsvpSuccessPopupProps {
  visible: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  details: RsvpConfirmationDetails | null;
  /** Append the Calendar nudge for a signed-in consumer (anon web omits it). */
  showCalendarNudge: boolean;
  onClose: () => void;
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

export const RsvpSuccessPopup: React.FC<RsvpSuccessPopupProps> = ({
  visible,
  palette,
  theme,
  details,
  showCalendarNudge,
  onClose,
}) => {
  const boldFamily = boldFontFamily(theme);
  if (details === null) return null;

  const title =
    details.status === "waitlisted"
      ? "You're on the waitlist"
      : details.status === "pending"
        ? "RSVP sent for approval"
        : "You're going! 🎉";
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
          style={[styles.card, { backgroundColor: palette.page, borderColor: palette.panelBorder }]}
          onPress={() => undefined}
          testID="orch-1163-rsvp-success-popup"
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

          {showCalendarNudge ? (
            <Text style={[styles.nudge, { color: palette.secondaryText }]}>
              Find your RSVP + entry QR in your Calendar.
            </Text>
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
    padding: 22,
  },
  title: { fontSize: 22, fontWeight: "900", letterSpacing: -0.4, marginBottom: 14 },
  detailBlock: { gap: 10 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  detailLabel: { fontSize: 13, fontWeight: "700" },
  detailValue: { fontSize: 14, fontWeight: "800", flexShrink: 1, textAlign: "right" },
  nudge: { fontSize: 13, lineHeight: 19, marginTop: 14 },
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
