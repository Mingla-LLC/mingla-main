/**
 * InviteScannerSheet — J-S7 invite-scanner UI (Cycle 11).
 *
 * I-28: UI-only in Cycle 11. recordInvitation creates a pending entry in
 * client store; NO email is sent. canAcceptPayments toggle is DISABLED
 * (always false until B-cycle scanner-payments cluster).
 *
 * [TRANSITIONAL] EXIT CONDITION: B-cycle wires:
 *   - edge function `invite-scanner` (writes to scanner_invitations + Resend)
 *   - edge function `accept-scanner-invitation` (writes to event_scanners)
 *   - `/event/[id]/scanner` route auth gate
 *
 * Mirrors AddCompGuestSheet pattern (Cycle 10).
 *
 * Per Cycle 11 SPEC §4.10/J-S7 sub-sheet.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  useScannerInvitationsStore,
  type ScannerInvitation,
} from "../../store/scannerInvitationsStore";
import type { LiveEvent } from "../../store/liveEventStore";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const PROCESSING_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

export interface InviteScannerSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (invitation: ScannerInvitation) => void;
}

export const InviteScannerSheet: React.FC<InviteScannerSheetProps> = ({
  visible,
  event,
  brandId,
  operatorAccountId,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [canManualCheckIn, setCanManualCheckIn] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset state on visible flip → true
  useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setCanManualCheckIn(false);
      setSubmitting(false);
    }
  }, [visible]);

  // Validation
  const trimmedNameLen = name.trim().length;
  const nameValid = trimmedNameLen >= 1 && trimmedNameLen <= NAME_MAX;
  const emailValid = isValidEmail(email);
  const isValid = nameValid && emailValid;
  const canSubmit = !submitting && isValid;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await sleep(PROCESSING_MS);
      const newInvitation = useScannerInvitationsStore
        .getState()
        .recordInvitation({
          eventId: event.id,
          brandId,
          inviteeEmail: email.trim().toLowerCase(),
          inviteeName: name.trim(),
          permissions: {
            canScan: true,
            canManualCheckIn,
            // ALWAYS false in Cycle 11 — gated on §6.2 B-cycle scanner-payments.
            // EXIT: B-cycle enables this toggle.
            canAcceptPayments: false,
          },
          invitedBy: operatorAccountId,
        });
      onSuccess(newInvitation);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    event.id,
    brandId,
    email,
    name,
    canManualCheckIn,
    operatorAccountId,
    onSuccess,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>Invite scanner</Text>
        <Text style={styles.subhead}>
          Door staff or backup scanners. They&apos;ll get access when emails ship in B-cycle.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Name <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                trimmedNameLen > 0 && !nameValid && styles.inputError,
              ]}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Tunde Olu"
                placeholderTextColor={textTokens.quaternary}
                maxLength={NAME_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Scanner name"
              />
            </View>
            {trimmedNameLen > 0 && !nameValid ? (
              <Text style={styles.errorText}>Enter the scanner&apos;s name.</Text>
            ) : null}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Email <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                email.length > 0 && !emailValid && styles.inputError,
              ]}
            >
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tunde@example.com"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={EMAIL_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Scanner email"
              />
            </View>
            {email.length > 0 && !emailValid ? (
              <Text style={styles.errorText}>Enter a valid email.</Text>
            ) : null}
          </View>

          {/* Can manual check-in toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleCol}>
              <Text style={styles.toggleLabel}>Allow manual check-in</Text>
              <Text style={styles.toggleSubline}>
                They can mark guests checked in without scanning a QR.
              </Text>
            </View>
            <Pressable
              onPress={() => !submitting && setCanManualCheckIn((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: canManualCheckIn }}
              accessibilityLabel="Allow manual check-in"
              disabled={submitting}
              style={[
                styles.toggleTrack,
                canManualCheckIn && styles.toggleTrackOn,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  canManualCheckIn && styles.toggleThumbOn,
                ]}
              />
            </Pressable>
          </View>

          {/* Can accept payments — DISABLED in Cycle 11 (locked decision #6) */}
          <View style={[styles.toggleRow, styles.toggleRowDisabled]}>
            <View style={styles.toggleCol}>
              <Text style={[styles.toggleLabel, styles.toggleLabelDisabled]}>
                Accept door payments
              </Text>
              <Text style={styles.toggleSubline}>
                Door payments coming in B-cycle.
              </Text>
            </View>
            <View style={[styles.toggleTrack, styles.toggleTrackDisabled]}>
              <View style={styles.toggleThumb} />
            </View>
          </View>

          {/* TRANSITIONAL footer */}
          <View style={styles.transitionalNote}>
            <Text style={styles.transitionalNoteText}>
              Note: emails will be sent when the scanner backend launches. The
              invitation is stored locally for now.
            </Text>
          </View>
        </ScrollView>

        {/* Sticky bottom CTAs */}
        <View style={styles.actions}>
          <Button
            label={submitting ? "Inviting..." : "Send invitation"}
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Send scanner invitation"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel invite scanner"
          />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  scroll: {
    flex: 1,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 6,
  },
  required: {
    color: accent.warm,
  },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputError: {
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  input: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 40,
    paddingVertical: 6,
  },
  errorText: {
    fontSize: 12,
    color: accent.warm,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  toggleRowDisabled: {
    opacity: 0.55,
  },
  toggleCol: {
    flex: 1,
    minWidth: 0,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  toggleLabelDisabled: {
    color: textTokens.tertiary,
  },
  toggleSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleTrackDisabled: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
  transitionalNote: {
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(59, 130, 246, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.24)",
  },
  transitionalNoteText: {
    fontSize: 12,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  actions: {
    paddingTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
});

export default InviteScannerSheet;
