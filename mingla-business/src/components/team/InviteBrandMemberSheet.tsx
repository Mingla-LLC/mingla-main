/**
 * InviteBrandMemberSheet — J-T3 brand-team invite (Cycle 13a).
 *
 * I-31: UI-only in Cycle 13a. recordInvitation creates a pending entry in the
 * client-side brandTeamStore; NO email is sent, NO acceptance flow exists.
 * The TRANSITIONAL banner makes this honest to the operator.
 *
 * [TRANSITIONAL] EXIT CONDITION: B-cycle wires:
 *   - edge function `invite-brand-member` (writes to brand_invitations + Resend)
 *   - edge function `accept-brand-invitation` (writes to brand_team_members)
 *
 * Generalizes the Cycle 11 InviteScannerSheet pattern: 2 boolean permission
 * toggles → role picker (sub-sheet).
 *
 * Per Cycle 13a SPEC §4.9.
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
  type BrandRole,
  roleDisplayName,
} from "../../utils/brandRole";
import {
  useBrandTeamStore,
  type BrandTeamEntry,
} from "../../store/brandTeamStore";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

import { RolePickerSheet } from "./RolePickerSheet";

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const PROCESSING_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

export interface InviteBrandMemberSheetProps {
  visible: boolean;
  brandId: string;
  brandName: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (entry: BrandTeamEntry) => void;
}

export const InviteBrandMemberSheet: React.FC<InviteBrandMemberSheetProps> = ({
  visible,
  brandId,
  brandName,
  operatorAccountId,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<BrandRole>("event_manager");
  const [rolePickerVisible, setRolePickerVisible] = useState<boolean>(false);
  const [rolePickerReadOnly, setRolePickerReadOnly] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset state on visible flip → true.
  useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setRole("event_manager");
      setRolePickerVisible(false);
      setRolePickerReadOnly(false);
      setSubmitting(false);
    }
  }, [visible]);

  // Validation.
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
      const newEntry = useBrandTeamStore.getState().recordInvitation({
        brandId,
        inviteeEmail: email.trim().toLowerCase(),
        inviteeName: name.trim(),
        role,
        invitedBy: operatorAccountId,
      });
      onSuccess(newEntry);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, email, name, role, brandId, operatorAccountId, onSuccess]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const openPicker = useCallback((): void => {
    if (submitting) return;
    setRolePickerReadOnly(false);
    setRolePickerVisible(true);
  }, [submitting]);

  const openRolesExplained = useCallback((): void => {
    if (submitting) return;
    setRolePickerReadOnly(true);
    setRolePickerVisible(true);
  }, [submitting]);

  const handlePickerSelect = useCallback((next: BrandRole): void => {
    setRole(next);
    setRolePickerVisible(false);
  }, []);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
          <Text style={styles.title}>Invite team member</Text>
          <Text style={styles.subhead}>
            {brandName} team. They&apos;ll get access when emails ship in B-cycle.
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
          >
            {/* TRANSITIONAL banner */}
            <View style={styles.transitionalNote}>
              <Text style={styles.transitionalNoteText}>
                Testing mode — invitations are stored locally for now. Emails
                ship in B-cycle.
              </Text>
            </View>

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
                  accessibilityLabel="Member name"
                />
              </View>
              {trimmedNameLen > 0 && !nameValid ? (
                <Text style={styles.errorText}>Enter the member&apos;s name.</Text>
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
                  accessibilityLabel="Member email"
                />
              </View>
              {email.length > 0 && !emailValid ? (
                <Text style={styles.errorText}>Enter a valid email.</Text>
              ) : null}
            </View>

            {/* Role picker row */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Role</Text>
              <Pressable
                onPress={openPicker}
                accessibilityRole="button"
                accessibilityLabel={`Pick role, currently ${roleDisplayName(role)}`}
                style={styles.rolePickerRow}
                disabled={submitting}
              >
                <Text style={styles.rolePickerValue}>
                  {roleDisplayName(role)}
                </Text>
                <Icon name="chevD" size={16} color={textTokens.tertiary} />
              </Pressable>
              <Pressable
                onPress={openRolesExplained}
                accessibilityRole="button"
                accessibilityLabel="Open roles explained"
                disabled={submitting}
                style={styles.rolesExplainedLink}
              >
                <Text style={styles.rolesExplainedText}>Roles explained</Text>
              </Pressable>
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
            accessibilityLabel="Send team invitation"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel invite team member"
          />
        </View>
      </View>

      {/*
        Cycle 13a Rework v3 (D-CYCLE13-IMPL-5 / RN Modal nesting fix):
        RolePickerSheet MUST render INSIDE the parent <Sheet>, not as a
        Fragment sibling. Mirrors Cycle 12 verbatim pattern in
        CreatorStep5Tickets.tsx (VisibilitySheet/AvailableAtSheet at lines
        1368-1386). When rendered as a sibling, the sub-sheet's native
        <Modal> mounts at the OS root level alongside the parent's <Modal>
        and gets visually blocked by it.
      */}
      <RolePickerSheet
        visible={rolePickerVisible}
        current={role}
        readOnly={rolePickerReadOnly}
        onClose={() => setRolePickerVisible(false)}
        onSelect={handlePickerSelect}
      />
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
  rolePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    minHeight: 48,
  },
  rolePickerValue: {
    fontSize: 15,
    color: textTokens.primary,
    fontWeight: "500",
  },
  rolesExplainedLink: {
    paddingTop: spacing.xs + 2,
    alignSelf: "flex-start",
  },
  rolesExplainedText: {
    fontSize: 13,
    color: accent.warm,
    fontWeight: "500",
  },
  transitionalNote: {
    marginBottom: spacing.md,
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

export default InviteBrandMemberSheet;
