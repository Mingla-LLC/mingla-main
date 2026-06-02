/**
 * InviteBrandMemberSheet — brand-team invite (ORCH-1050).
 *
 * Sends invites through the `invite-brand-member` edge function. The function
 * writes to `public.brand_invitations` and ships a Resend invite email. The
 * legacy [TRANSITIONAL] zustand-only path is gone — invitations are real
 * canonical rows from the moment "Send invitation" returns success.
 *
 * Role picker still uses the Cycle 11 sub-sheet pattern (RolePickerSheet).
 *
 * Status: ACTIVE post-ORCH-1050.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

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
import { useInviteBrandMember } from "../../hooks/useBrandInvitations";
import { BrandInvitationServiceError } from "../../services/brandInvitationsService";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";

import { RolePickerSheet } from "./RolePickerSheet";

const NAME_MAX = 100;
const EMAIL_MAX = 200;

const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

export interface InviteBrandMemberSheetProps {
  visible: boolean;
  brandId: string;
  brandName: string;
  /** Retained for prop compatibility with the call site (`team.tsx`); the
   * canonical invited_by is auth.uid() inside the edge fn. */
  operatorAccountId: string;
  onClose: () => void;
  /** Fires after a successful invite + email send. The detail param is
   * intentionally minimal — the team list refetches from the canonical
   * source via React Query invalidation. */
  onSuccess: (details: { invitationId: string }) => void;
}

interface ToastState {
  kind: "error" | "success";
  message: string;
}

export const InviteBrandMemberSheet: React.FC<InviteBrandMemberSheetProps> = ({
  visible,
  brandId,
  brandName,
  operatorAccountId: _operatorAccountId,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<BrandRole>("event_manager");
  const [rolePickerVisible, setRolePickerVisible] = useState<boolean>(false);
  const [rolePickerReadOnly, setRolePickerReadOnly] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const { mutateAsync: inviteAsync, isPending: submitting } =
    useInviteBrandMember();

  // Reset state on visible flip → true.
  useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setRole("event_manager");
      setRolePickerVisible(false);
      setRolePickerReadOnly(false);
      setToast(null);
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
    setToast(null);
    try {
      const result = await inviteAsync({
        brandId,
        inviteeEmail: email.trim().toLowerCase(),
        inviteeName: name.trim(),
        role,
      });
      onSuccess({ invitationId: result.invitationId });
    } catch (err) {
      const message = errorMessageFor(err);
      setToast({ kind: "error", message });
    }
  }, [canSubmit, email, name, role, brandId, inviteAsync, onSuccess]);

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
            {brandName} team. We&apos;ll email them an invite link that
            expires in 7 days.
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
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

      {toast !== null ? (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast
            visible
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </View>
      ) : null}
    </Sheet>
  );
};

function errorMessageFor(err: unknown): string {
  if (err instanceof BrandInvitationServiceError) {
    switch (err.code) {
      case "validation":
        return "Check the name and email.";
      case "unauthenticated":
        return "Please sign in again and try.";
      case "forbidden":
        return "You don't have permission to invite for this brand.";
      case "brand_not_found":
        return "This brand wasn't found.";
      case "already_invited":
        return "There's already a pending invite for that email.";
      case "email_send_failed":
        return "Couldn't send the email. Try again in a moment.";
      default:
        return "Something went wrong. Try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

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
    overflow: "hidden",
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
    overflow: "hidden",
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
  actions: {
    paddingTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
  toastWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    alignItems: "center",
    padding: spacing.lg,
  },
});

export default InviteBrandMemberSheet;
