/**
 * BrandInviteSheet — invite-teammate form (J-A9 §5.3.10).
 *
 * Sheet body:
 *   - Email Input (variant="email") with leadingIcon="mail"
 *   - Role select Pressable (opens nested RolePickerSheet)
 *   - Optional note (multi-line text input — InlineTextArea pattern duplicated
 *     from BrandEditView per DEC-079 closure; promote to shared utility on
 *     3+ uses — D-INV-A9-4 watch-point)
 *   - Send invitation Button (primary, fullWidth) + Cancel Button (secondary)
 *
 * Validation per spec §3.6:
 *   - empty / no @ → "Enter a valid email."
 *   - already a member → "{Name} is already on the team."
 *   - already invited (pending) → "Already invited. Resend?"
 *   - role missing → "Pick a role for {email}."
 *
 * I-13 invariant: this Sheet portals to OS root via the kit Sheet primitive
 * (which wraps RN Modal). Safe to mount anywhere in the tree.
 *
 * Per J-A9 spec §3.6.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  Brand,
  BrandInvitation,
  BrandMemberRole,
  InviteRole,
} from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";

import { INVITE_ROLES, RolePickerSheet } from "./RolePickerSheet";

// [TRANSITIONAL] simulated async delay — replaced by real Supabase mutation
// in B1 backend cycle. The 300ms beat creates a perceptible "Sending…"
// state so the UI feels real even though the in-memory write is sync.
const SIMULATED_SEND_DELAY_MS = 300;

const ROLE_LABEL: Record<BrandMemberRole, string> = {
  owner: "Owner",
  brand_admin: "Admin",
  event_manager: "Events",
  finance_manager: "Finance",
  marketing_manager: "Marketing",
  scanner: "Scanner",
};

const ROLE_DESCRIPTION_SHORT: Record<BrandMemberRole, string> = {
  owner: "Full access.",
  brand_admin: "Manage events, team, payments.",
  event_manager: "Create and run events.",
  finance_manager: "View payments and reports.",
  marketing_manager: "Run marketing campaigns.",
  scanner: "Scan tickets at the door.",
};

interface InviteDraft {
  email: string;
  role: InviteRole | undefined;
  note: string;
}

const EMPTY_DRAFT: InviteDraft = { email: "", role: undefined, note: "" };

export interface BrandInviteSheetProps {
  visible: boolean;
  onClose: () => void;
  brand: Brand;
  onSend: (invitation: BrandInvitation) => void;
}

export const BrandInviteSheet: React.FC<BrandInviteSheetProps> = ({
  visible,
  onClose,
  brand,
  onSend,
}) => {
  const [draft, setDraft] = useState<InviteDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [roleError, setRoleError] = useState<string | undefined>(undefined);
  const [rolePickerVisible, setRolePickerVisible] = useState<boolean>(false);

  // Reset draft + errors when sheet opens (each invite session is fresh).
  useEffect(() => {
    if (visible) {
      setDraft(EMPTY_DRAFT);
      setEmailError(undefined);
      setRoleError(undefined);
      setSubmitting(false);
    }
  }, [visible]);

  const validate = useCallback((): {
    email?: string;
    role?: string;
  } => {
    const trimmed = draft.email.trim().toLowerCase();
    if (trimmed.length === 0 || !trimmed.includes("@")) {
      return { email: "Enter a valid email." };
    }
    const memberMatch = (brand.members ?? []).find(
      (m) => m.email.toLowerCase() === trimmed,
    );
    if (memberMatch !== undefined) {
      return { email: `${memberMatch.name} is already on the team.` };
    }
    const inviteMatch = (brand.pendingInvitations ?? []).find(
      (i) => i.email.toLowerCase() === trimmed,
    );
    if (inviteMatch !== undefined) {
      return { email: "Already invited. Resend?" };
    }
    if (draft.role === undefined) {
      return { role: `Pick a role for ${draft.email.trim()}.` };
    }
    return {};
  }, [draft, brand.members, brand.pendingInvitations]);

  const handleSend = useCallback((): void => {
    if (submitting) return;
    const errors = validate();
    if (errors.email !== undefined || errors.role !== undefined) {
      setEmailError(errors.email);
      setRoleError(errors.role);
      return;
    }
    if (draft.role === undefined) return; // narrowing — validate already gates
    setSubmitting(true);
    setEmailError(undefined);
    setRoleError(undefined);
    const snapshot = draft;
    setTimeout(() => {
      onSend({
        id: `i_${Date.now().toString(36)}`,
        email: snapshot.email.trim().toLowerCase(),
        role: snapshot.role as InviteRole,
        invitedAt: new Date().toISOString(),
        note: snapshot.note.trim().length > 0 ? snapshot.note.trim() : undefined,
        status: "pending",
      });
      setSubmitting(false);
      onClose();
    }, SIMULATED_SEND_DELAY_MS);
  }, [draft, submitting, validate, onSend, onClose]);

  const handlePickRole = useCallback((role: BrandMemberRole): void => {
    setRolePickerVisible(false);
    if (role === "owner") return; // INVITE_ROLES excludes owner; defensive guard
    setDraft((prev) => ({ ...prev, role: role as InviteRole }));
    setRoleError(undefined);
  }, []);

  const roleSelectLabel = useMemo<string>(() => {
    if (draft.role === undefined) return "Pick a role";
    return ROLE_LABEL[draft.role];
  }, [draft.role]);

  const roleSelectSub = useMemo<string | undefined>(() => {
    if (draft.role === undefined) return undefined;
    return ROLE_DESCRIPTION_SHORT[draft.role];
  }, [draft.role]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Invite teammate</Text>
          <Text style={styles.subtitle}>
            Add someone to {brand.displayName}. They{"’"}ll get an email with a
            link to accept.
          </Text>

          {/* Email */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>EMAIL</Text>
            <Input
              variant="email"
              value={draft.email}
              onChangeText={(v) => {
                setDraft((prev) => ({ ...prev, email: v }));
                if (emailError !== undefined) setEmailError(undefined);
              }}
              placeholder="teammate@email.com"
              leadingIcon="mail"
              accessibilityLabel="Teammate email"
              clearable
            />
            {emailError !== undefined ? (
              <Text style={styles.errorText}>{emailError}</Text>
            ) : null}
          </View>

          {/* Role select */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>ROLE</Text>
            <Pressable
              onPress={() => setRolePickerVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Pick a role"
              style={styles.roleSelectRow}
            >
              <View style={styles.roleSelectTextCol}>
                <Text
                  style={[
                    styles.roleSelectLabel,
                    draft.role === undefined && styles.roleSelectPlaceholder,
                  ]}
                >
                  {roleSelectLabel}
                </Text>
                {roleSelectSub !== undefined ? (
                  <Text style={styles.roleSelectSub}>{roleSelectSub}</Text>
                ) : null}
              </View>
              <Icon name="chevR" size={16} color={textTokens.tertiary} />
            </Pressable>
            {roleError !== undefined ? (
              <Text style={styles.errorText}>{roleError}</Text>
            ) : null}
          </View>

          {/* Optional note */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>NOTE (OPTIONAL)</Text>
            <NoteTextArea
              value={draft.note}
              onChangeText={(v) =>
                setDraft((prev) => ({ ...prev, note: v }))
              }
              placeholder="Add a note (optional)"
              accessibilityLabel="Optional note"
            />
          </View>

          {/* Actions */}
          <View style={styles.actionsCol}>
            <Button
              label={submitting ? "Sending…" : "Send invitation"}
              onPress={handleSend}
              variant="primary"
              size="lg"
              fullWidth
              disabled={submitting}
              loading={submitting}
              accessibilityLabel="Send invitation"
            />
            <Button
              label="Cancel"
              onPress={onClose}
              variant="secondary"
              size="md"
              fullWidth
              disabled={submitting}
              accessibilityLabel="Cancel invite"
            />
          </View>

          {/* Pill preview when role selected — visual confirmation */}
          {draft.role !== undefined ? (
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Will be assigned:</Text>
              <Pill variant="draft">{ROLE_LABEL[draft.role]}</Pill>
            </View>
          ) : null}
      </ScrollView>

      {/* Nested role picker — rendered as a CHILD of the outer Sheet (not
          a Fragment sibling). On iOS, RN Modal stacking is unreliable for
          sibling Modals presented from the same parent view-controller —
          the second Modal silently fails to display. By nesting inside
          the outer Sheet's content, the RolePickerSheet's RN Modal is
          presented FROM the outer Sheet's view-controller, which iOS
          handles correctly. RN Modal is a portal so this child placement
          has zero layout impact on the ScrollView. */}
      <RolePickerSheet
        visible={rolePickerVisible}
        onClose={() => setRolePickerVisible(false)}
        options={INVITE_ROLES}
        selectedRole={draft.role}
        onPick={handlePickRole}
      />
    </Sheet>
  );
};

// Inline multi-line text-input matching the BrandEditView InlineTextArea
// pattern. DEC-079 closure: duplicated rather than shared until 3+ uses
// surface (D-INV-A9-4 watch-point).
interface NoteTextAreaProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}

const NoteTextArea: React.FC<NoteTextAreaProps> = ({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}) => {
  const [focused, setFocused] = useState<boolean>(false);
  return (
    <View
      style={[
        noteStyles.container,
        {
          borderColor: focused ? accent.warm : "rgba(255, 255, 255, 0.12)",
          borderWidth: focused ? 1.5 : 1,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.quaternary}
        accessibilityLabel={accessibilityLabel}
        multiline
        textAlignVertical="top"
        underlineColorAndroid="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          noteStyles.input,
          {
            color: textTokens.primary,
            fontSize: typography.body.fontSize,
            fontWeight: typography.body.fontWeight,
          },
        ]}
      />
    </View>
  );
};

const noteStyles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radiusTokens.sm,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 96,
  },
  input: {
    minHeight: 72,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
});

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
  },
  subtitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: -spacing.sm,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    paddingHorizontal: spacing.xs,
    marginTop: 2,
  },
  roleSelectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  roleSelectTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  roleSelectLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  roleSelectPlaceholder: {
    color: textTokens.quaternary,
    fontWeight: "400",
  },
  roleSelectSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  actionsCol: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  previewLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
});

export default BrandInviteSheet;
