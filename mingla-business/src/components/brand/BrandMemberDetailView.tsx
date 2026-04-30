/**
 * BrandMemberDetailView — member profile + role/remove actions (J-A9 §5.3.11).
 *
 * Renders three states:
 *   - `brand === null` or `member === null` → Not Found GlassCard with back CTA
 *   - owner-self → identity block + helper card "You're the owner of {brand}.
 *     Owners can't be removed or change their own role. To leave, transfer
 *     ownership first." NO Change role / Remove buttons. (Transfer-ownership
 *     flow is post-MVP; copy is honest stub.)
 *   - other member → identity block + Change role + Remove buttons
 *
 * Mounting discipline:
 *   - I-13: RolePickerSheet portals via kit Sheet primitive — safe to mount
 *           anywhere, but mounted at View root for clarity.
 *   - HF-1 carry-over: ConfirmDialog wraps kit ./Modal which does NOT yet
 *           portal to OS root. Mount this dialog at the screen-View tree root
 *           (NOT inside ScrollView/FlatList/positioned ancestor) until HF-1's
 *           separate ORCH ships the portal upgrade.
 *
 * RolePickerSheet ↔ ConfirmDialog mutual exclusion: each is gated on its own
 * boolean state, neither code path can open the other simultaneously.
 *
 * Per J-A9 spec §3.7.
 */

import React, { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  Brand,
  BrandMember,
  BrandMemberRole,
} from "../../store/currentBrandStore";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { Toast } from "../ui/Toast";
import { TopBar } from "../ui/TopBar";

import { INVITE_ROLES, RolePickerSheet } from "./RolePickerSheet";

interface ToastState {
  visible: boolean;
  message: string;
}

const ROLE_LABEL: Record<BrandMemberRole, string> = {
  owner: "Owner",
  brand_admin: "Admin",
  event_manager: "Events",
  finance_manager: "Finance",
  marketing_manager: "Marketing",
  scanner: "Scanner",
};

// Inline relative-time / joined-date formatters — duplicated from
// BrandTeamView. DEC-079 closure: lift to src/utils/ on 3+ uses (D-INV-A9-5).
const formatRelativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
};

const formatJoinedDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });

// ---------------------------------------------------------------------------
// BrandMemberDetailView
// ---------------------------------------------------------------------------

export interface BrandMemberDetailViewProps {
  brand: Brand | null;
  member: BrandMember | null;
  /**
   * True when the member being viewed is the founder (current user).
   * Owner-self gets disabled actions + helper card.
   * [TRANSITIONAL] heuristic — replaced when B1 wires `auth.users.id`
   * comparison to `member.userId`. Until then: treats any `role === 'owner'`
   * as the current user (founder owns all 4 stub brands).
   */
  isCurrentUserSelf: boolean;
  onBack: () => void;
  onChangeRole: (memberId: string, nextRole: BrandMemberRole) => void;
  onRemove: (memberId: string) => void;
}

export const BrandMemberDetailView: React.FC<BrandMemberDetailViewProps> = ({
  brand,
  member,
  isCurrentUserSelf,
  onBack,
  onChangeRole,
  onRemove,
}) => {
  const insets = useSafeAreaInsets();
  const [rolePickerVisible, setRolePickerVisible] = useState<boolean>(false);
  const [removeDialogVisible, setRemoveDialogVisible] =
    useState<boolean>(false);
  // Role-change confirmation dialog. When user picks a NEW role from the
  // RolePickerSheet, we stash it in `pendingRole` and open this dialog.
  // Per founder feedback (2026-04-30 smoke): role changes are non-trivial
  // and must confirm before applying. Same destructive-discipline as
  // remove, but ConfirmDialog uses non-destructive variant since changing
  // role isn't destructive (the member keeps access).
  const [roleChangeDialogVisible, setRoleChangeDialogVisible] =
    useState<boolean>(false);
  const [pendingRole, setPendingRole] = useState<BrandMemberRole | undefined>(
    undefined,
  );
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: "",
  });

  const fireToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleOpenRolePicker = useCallback((): void => {
    setRolePickerVisible(true);
  }, []);

  const handleCloseRolePicker = useCallback((): void => {
    setRolePickerVisible(false);
  }, []);

  const handlePickRole = useCallback(
    (nextRole: BrandMemberRole): void => {
      setRolePickerVisible(false);
      if (member === null) return;
      // Same role picked — no-op (no dialog, no mutation).
      if (nextRole === member.role) return;
      // Different role — stash for confirmation. Apply only on confirm.
      setPendingRole(nextRole);
      setRoleChangeDialogVisible(true);
    },
    [member],
  );

  const handleConfirmRoleChange = useCallback((): void => {
    setRoleChangeDialogVisible(false);
    if (member === null || pendingRole === undefined) return;
    onChangeRole(member.id, pendingRole);
    setPendingRole(undefined);
  }, [member, pendingRole, onChangeRole]);

  const handleCancelRoleChange = useCallback((): void => {
    setRoleChangeDialogVisible(false);
    setPendingRole(undefined);
  }, []);

  const handleOpenRemoveDialog = useCallback((): void => {
    setRemoveDialogVisible(true);
  }, []);

  const handleCloseRemoveDialog = useCallback((): void => {
    setRemoveDialogVisible(false);
  }, []);

  const handleConfirmRemove = useCallback((): void => {
    setRemoveDialogVisible(false);
    if (member === null) return;
    onRemove(member.id);
  }, [member, onRemove]);

  // [TRANSITIONAL] email-tap-to-copy — exit when clipboard utility lands
  // (Cycle 14 settings or earlier polish dispatch). For J-A9 the Toast is
  // honest UI feedback that the gesture was registered.
  const handleEmailTap = useCallback((): void => {
    if (member === null) return;
    fireToast(`Copy not yet wired — email is ${member.email}`);
  }, [member, fireToast]);

  // ----- Not Found state -----
  if (brand === null || member === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Member"
            onBack={onBack}
            rightSlot={<View />}
          />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>
              {brand === null ? "Brand not found" : "Member not found"}
            </Text>
            <Text style={styles.notFoundBody}>
              {brand === null
                ? "The brand you tried to open doesn’t exist or has been removed."
                : "This teammate isn’t on the team anymore. They may have been removed."}
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label={brand === null ? "Back to Account" : "Back to team"}
                onPress={onBack}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  // ----- Populated state -----

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title="Member"
          onBack={onBack}
          rightSlot={<View />}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity block */}
        <GlassCard variant="elevated" padding={spacing.lg}>
          <View style={styles.identityCol}>
            <Avatar name={member.name} size="hero" photo={member.photo} />
            <Text style={styles.identityName}>{member.name}</Text>
            <View style={styles.identityPillRow}>
              <Pill variant={member.role === "owner" ? "accent" : "draft"}>
                {ROLE_LABEL[member.role]}
              </Pill>
            </View>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Joined</Text>
              <Text style={styles.statValue}>
                {formatJoinedDate(member.joinedAt)}
              </Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Last active</Text>
              <Text style={styles.statValue}>
                {member.lastActiveAt !== undefined
                  ? formatRelativeTime(member.lastActiveAt)
                  : "Never"}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Email row */}
        <GlassCard variant="base" padding={0}>
          <Pressable
            onPress={handleEmailTap}
            accessibilityRole="button"
            accessibilityLabel={`Email ${member.email}`}
            style={styles.contactRow}
          >
            <View style={styles.contactIconWrap}>
              <Icon name="mail" size={18} color={textTokens.primary} />
            </View>
            <View style={styles.contactTextCol}>
              <Text style={styles.contactLabel}>EMAIL</Text>
              <Text style={styles.contactValue} numberOfLines={1}>
                {member.email}
              </Text>
            </View>
            <Icon name="chevR" size={16} color={textTokens.tertiary} />
          </Pressable>
        </GlassCard>

        {/* Actions OR owner-self helper card */}
        {isCurrentUserSelf ? (
          <GlassCard variant="base" padding={spacing.md}>
            <Text style={styles.ownerHelperTitle}>You{"’"}re the owner</Text>
            <Text style={styles.ownerHelperBody}>
              Owners of {brand.displayName} can{"’"}t be removed or change
              their own role. To leave, transfer ownership first.
            </Text>
          </GlassCard>
        ) : (
          <View style={styles.actionsCol}>
            <Button
              label="Change role"
              onPress={handleOpenRolePicker}
              variant="secondary"
              size="md"
              leadingIcon="users"
              fullWidth
            />
            <Button
              label={`Remove from ${brand.displayName}`}
              onPress={handleOpenRemoveDialog}
              variant="destructive"
              size="md"
              leadingIcon="trash"
              fullWidth
            />
          </View>
        )}
      </ScrollView>

      {/* RolePickerSheet — mounted at View root. I-13: portals via kit Sheet. */}
      <RolePickerSheet
        visible={rolePickerVisible}
        onClose={handleCloseRolePicker}
        options={INVITE_ROLES}
        selectedRole={member.role}
        onPick={handlePickRole}
      />

      {/* ConfirmDialog (Remove) — mounted at screen-View tree root
          (HF-1 mitigation: ConfirmDialog wraps kit ./Modal which does NOT
          yet portal to OS root). */}
      <ConfirmDialog
        visible={removeDialogVisible}
        onClose={handleCloseRemoveDialog}
        onConfirm={handleConfirmRemove}
        variant="simple"
        destructive
        title={`Remove ${member.name}?`}
        description={`Remove ${member.name} from ${brand.displayName}? They'll lose access immediately.`}
        confirmLabel="Remove"
        cancelLabel="Keep on team"
      />

      {/* ConfirmDialog (Change role) — mounted at screen-View tree root.
          Mutually exclusive with removeDialog and rolePickerSheet (each
          gated on its own boolean state). NOT destructive — role change
          isn't destructive (member keeps access, just different perms). */}
      <ConfirmDialog
        visible={roleChangeDialogVisible}
        onClose={handleCancelRoleChange}
        onConfirm={handleConfirmRoleChange}
        variant="simple"
        title="Change role?"
        description={
          pendingRole !== undefined
            ? `Change ${member.name}'s role from ${ROLE_LABEL[member.role]} to ${ROLE_LABEL[pendingRole]}? Their permissions will update immediately.`
            : ""
        }
        confirmLabel="Change role"
        cancelLabel="Cancel"
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // Not Found state ------------------------------------------------------
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },

  // Identity block -------------------------------------------------------
  identityCol: {
    alignItems: "center",
    gap: spacing.sm,
  },
  identityName: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  identityPillRow: {
    flexDirection: "row",
  },

  // Stats row ------------------------------------------------------------
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileElevated,
  },
  statCell: {
    flex: 1,
  },
  statLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },

  // Email row ------------------------------------------------------------
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  contactIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  contactTextCol: {
    flex: 1,
    minWidth: 0,
  },
  contactLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: 2,
  },
  contactValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },

  // Actions --------------------------------------------------------------
  actionsCol: {
    gap: spacing.sm,
  },

  // Owner-self helper ----------------------------------------------------
  ownerHelperTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 4,
  },
  ownerHelperBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },

  // Toast ----------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});

export default BrandMemberDetailView;
