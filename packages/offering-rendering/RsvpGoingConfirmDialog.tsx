/**
 * RsvpGoingConfirmDialog — ORCH-1163 [rsvp-shared-body] · FLOW A (§G).
 *
 * The shared, shell-agnostic Going-confirmation dialog. Tapping "Going" on the
 * public RSVP page (inline box OR floating dock) opens THIS centered overlay
 * before the write commits; "Confirm I'm going" runs onSubmit, "Cancel" dismisses.
 * Maybe / Not-going DO NOT open this dialog (they record directly).
 *
 * Package-isolated (I-MOR-0827-PACKAGE-ISOLATION): built over React-Native's native
 * <Modal> (works on react-native-web AND native RN), themed via ThemePalette ONLY —
 * NO designSystem import, NO app-src import. testID: orch-1163-rsvp-going-confirm-dialog.
 */

import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { boldFontFamily, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";

export interface RsvpGoingConfirmDialogProps {
  visible: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  brandDisplayName: string;
  eventName: string;
  dateLine: string;
  plusGuests: Array<{ name: string }>;
  submitting: boolean;
  errorText: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const RsvpGoingConfirmDialog: React.FC<RsvpGoingConfirmDialogProps> = ({
  visible,
  palette,
  theme,
  brandDisplayName,
  eventName,
  dateLine,
  plusGuests,
  submitting,
  errorText,
  onConfirm,
  onCancel,
}) => {
  const boldFamily = boldFontFamily(theme);
  const bringingLine =
    plusGuests.length > 0
      ? `Bringing ${plusGuests.length}: ${plusGuests
          .map((g) => g.name)
          .filter((n) => n.trim().length > 0)
          .join(", ")}.`
      : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.scrim}
        onPress={submitting ? undefined : onCancel}
        accessibilityLabel="Dismiss"
      >
        <Pressable
          style={[
            styles.card,
            { backgroundColor: palette.page, borderColor: palette.panelBorder },
          ]}
          onPress={() => undefined}
          testID="orch-1163-rsvp-going-confirm-dialog"
        >
          <Text style={[styles.title, { color: palette.primaryText, fontFamily: boldFamily }]}>
            Confirm your RSVP
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            You're telling {brandDisplayName} you're going to {eventName} on {dateLine}.
          </Text>
          {bringingLine !== null ? (
            <Text style={[styles.body, { color: palette.secondaryText }]}>
              {bringingLine}
            </Text>
          ) : null}

          {errorText !== null && errorText.length > 0 ? (
            <Text style={styles.errorText} testID="orch-1163-rsvp-going-confirm-error">
              {errorText}
            </Text>
          ) : null}

          <Pressable
            onPress={submitting ? undefined : onConfirm}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            accessibilityLabel={submitting ? "Confirming" : "Confirm I'm going"}
            style={[styles.primaryBtn, { backgroundColor: palette.accent, opacity: submitting ? 0.7 : 1 }]}
            testID="orch-1163-rsvp-going-confirm-cta"
          >
            {submitting ? (
              <ActivityIndicator color={palette.accentText} />
            ) : null}
            <Text style={[styles.primaryBtnText, { color: palette.accentText, fontFamily: boldFamily }]}>
              {submitting ? "Confirming…" : "Confirm I'm going"}
            </Text>
          </Pressable>

          <Pressable
            onPress={submitting ? undefined : onCancel}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={styles.secondaryBtn}
          >
            <Text style={[styles.secondaryBtnText, { color: palette.secondaryText }]}>
              Cancel
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
  title: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  errorText: { color: "#e5484d", fontSize: 13, marginTop: 4, marginBottom: 4 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 14,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "900" },
  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 12, marginTop: 4 },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" },
});

export default RsvpGoingConfirmDialog;
