/**
 * BrandTeamView — team list (J-A9 §5.3.9).
 *
 * Renders three states:
 *   - `brand === null` → Not Found GlassCard with back CTA
 *   - empty (only owner, no pending) → owner row + "Invite teammates to help
 *     run {brand}" GlassCard CTA
 *   - populated → TEAM section (owner pinned at index 0 + others) +
 *     conditional PENDING section (greyed rows with Resend / Cancel)
 *
 * FAB bottom-right opens BrandInviteSheet (mounted at View root, NOT inside
 * ScrollView).
 *
 * I-13: BrandInviteSheet portals via kit Sheet primitive.
 *
 * Inline composition (DEC-079 closure):
 *   - Avatar (kit primitive) — promoted 2026-04-30 from D-INV-A9-3 watch-point
 *     after 4-use threshold hit. See `src/components/ui/Avatar.tsx`.
 *   - formatRelativeTime / formatJoinedDate (D-INV-A9-5 watch-point — promote on 3+ uses)
 *   - FAB (D-INV-A9-6 watch-point — promote on 3+ uses)
 *
 * Per J-A9 spec §3.5.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  Brand,
  BrandInvitation,
  BrandMember,
  BrandMemberRole,
} from "../../store/currentBrandStore";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { Toast } from "../ui/Toast";
import { TopBar } from "../ui/TopBar";

import { BrandInviteSheet } from "./BrandInviteSheet";

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

// Inline relative-time formatter — minutes / hours / days / weeks / Mmm d.
// Lifts to src/utils/formatRelativeTime.ts on 3+ uses (D-INV-A9-5).
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

// Owner pinned at index 0; others sorted by joinedAt descending (newest first).
const sortMembers = (members: BrandMember[]): BrandMember[] => {
  const owner = members.find((m) => m.role === "owner");
  const others = members
    .filter((m) => m.role !== "owner")
    .slice()
    .sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1));
  return owner !== undefined ? [owner, ...others] : others;
};

// ---------------------------------------------------------------------------
// BrandTeamView
// ---------------------------------------------------------------------------

export interface BrandTeamViewProps {
  brand: Brand | null;
  onBack: () => void;
  onSendInvite: (invitation: BrandInvitation) => void;
  onCancelInvite: (invitationId: string) => void;
  onOpenMember: (memberId: string) => void;
}

export const BrandTeamView: React.FC<BrandTeamViewProps> = ({
  brand,
  onBack,
  onSendInvite,
  onCancelInvite,
  onOpenMember,
}) => {
  const insets = useSafeAreaInsets();
  const [inviteSheetVisible, setInviteSheetVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  const fireToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleOpenInvite = useCallback((): void => {
    setInviteSheetVisible(true);
  }, []);

  const handleCloseInvite = useCallback((): void => {
    setInviteSheetVisible(false);
  }, []);

  const handleSend = useCallback(
    (invitation: BrandInvitation): void => {
      onSendInvite(invitation);
      fireToast(`Invitation sent to ${invitation.email}.`);
    },
    [onSendInvite, fireToast],
  );

  // [TRANSITIONAL] Resend Toast — exit when B5 marketing infrastructure
  // wires real email sending via Resend. Until then, the resend is purely
  // UI feedback (no state mutation, no real email dispatch).
  const handleResend = useCallback(
    (invitation: BrandInvitation): void => {
      fireToast(`Invite resent to ${invitation.email}.`);
    },
    [fireToast],
  );

  const sortedMembers = useMemo<BrandMember[]>(
    () => (brand !== null ? sortMembers(brand.members ?? []) : []),
    [brand],
  );

  const pendingInvites = useMemo<BrandInvitation[]>(
    () => brand?.pendingInvitations ?? [],
    [brand],
  );

  // ----- Not Found state -----
  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar leftKind="back" title="Team" onBack={onBack} rightSlot={<View />} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to open doesn{"’"}t exist or has been removed.
              Go back to your account to pick another.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back to Account"
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

  const showEmptyCta = sortedMembers.length <= 1 && pendingInvites.length === 0;

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar leftKind="back" title="Team" onBack={onBack} rightSlot={<View />} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: 120 + Math.max(insets.bottom, spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* TEAM section */}
        <Text style={styles.sectionLabel}>TEAM</Text>
        <View style={styles.rowsCol}>
          {sortedMembers.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => onOpenMember(member.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${member.name}`}
              style={styles.memberRow}
            >
              <Avatar name={member.name} size="row" photo={member.photo} />
              <View style={styles.memberTextCol}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {member.name}
                </Text>
                <View style={styles.memberMetaRow}>
                  <Pill variant={member.role === "owner" ? "accent" : "draft"}>
                    {ROLE_LABEL[member.role]}
                  </Pill>
                  <Text style={styles.memberLastActive} numberOfLines={1}>
                    {member.lastActiveAt !== undefined
                      ? `Active ${formatRelativeTime(member.lastActiveAt)}`
                      : "Never signed in"}
                  </Text>
                </View>
              </View>
              <Icon name="chevR" size={16} color={textTokens.tertiary} />
            </Pressable>
          ))}
        </View>

        {/* Empty CTA — only when 1 member (owner) and 0 pending */}
        {showEmptyCta ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>
              Invite teammates to help run {brand.displayName}
            </Text>
            <Text style={styles.emptyBody}>
              Brand admins, event managers, finance managers, marketing
              managers, and scanners — pick the right role for each person.
            </Text>
            <View style={styles.emptyBtnRow}>
              <Button
                label="Invite teammate"
                onPress={handleOpenInvite}
                variant="primary"
                size="md"
                leadingIcon="plus"
              />
            </View>
          </GlassCard>
        ) : null}

        {/* PENDING section — only when there are pending invites */}
        {pendingInvites.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, styles.sectionLabelPending]}>
              PENDING
            </Text>
            <View style={styles.rowsCol}>
              {pendingInvites.map((invitation) => (
                <View key={invitation.id} style={styles.pendingRow}>
                  <Avatar name={invitation.email} size="row" dimmed />
                  <View style={styles.memberTextCol}>
                    <Text
                      style={[styles.memberName, styles.pendingDimmed]}
                      numberOfLines={1}
                    >
                      {invitation.email}
                    </Text>
                    <View style={styles.memberMetaRow}>
                      <Pill variant="draft">
                        {`Pending · ${ROLE_LABEL[invitation.role]}`}
                      </Pill>
                      <Text
                        style={[styles.memberLastActive, styles.pendingDimmed]}
                        numberOfLines={1}
                      >
                        {`Invited ${formatRelativeTime(invitation.invitedAt)}`}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.pendingActionsCol}>
                    <Pressable
                      onPress={() => handleResend(invitation)}
                      accessibilityRole="button"
                      accessibilityLabel={`Resend invitation to ${invitation.email}`}
                      style={styles.pendingActionBtn}
                      hitSlop={6}
                    >
                      <Text style={styles.pendingActionLabel}>Resend</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onCancelInvite(invitation.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel invitation to ${invitation.email}`}
                      style={styles.pendingActionBtn}
                      hitSlop={6}
                    >
                      <Text
                        style={[
                          styles.pendingActionLabel,
                          styles.pendingActionDestructive,
                        ]}
                      >
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* FAB — bottom-right circular plus button. Inline per DEC-079
          (D-INV-A9-6 watch-point — promote on 3+ uses). */}
      <View
        pointerEvents="box-none"
        style={[
          styles.fabWrap,
          { bottom: Math.max(insets.bottom, spacing.lg) + spacing.md },
        ]}
      >
        <Pressable
          onPress={handleOpenInvite}
          accessibilityRole="button"
          accessibilityLabel="Invite teammate"
          style={styles.fab}
        >
          <Icon name="plus" size={24} color="#ffffff" />
        </Pressable>
      </View>

      {/* Mounted at screen-View root. I-13: invite Sheet portals via RN Modal. */}
      <BrandInviteSheet
        visible={inviteSheetVisible}
        onClose={handleCloseInvite}
        brand={brand}
        onSend={handleSend}
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

  // Section labels -------------------------------------------------------
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionLabelPending: {
    paddingTop: spacing.md,
  },

  // Rows -----------------------------------------------------------------
  rowsCol: {
    gap: spacing.sm,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  memberTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  memberName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  memberMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  memberLastActive: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  pendingDimmed: {
    opacity: 0.7,
  },
  pendingActionsCol: {
    gap: 6,
    alignItems: "flex-end",
  },
  pendingActionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pendingActionLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  pendingActionDestructive: {
    color: textTokens.tertiary,
  },

  // Empty CTA ------------------------------------------------------------
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  emptyBtnRow: {
    flexDirection: "row",
    marginTop: spacing.md,
  },

  // FAB ------------------------------------------------------------------
  fabWrap: {
    position: "absolute",
    right: spacing.md,
    alignItems: "flex-end",
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: accent.warm,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
    // Hard-coded shadow for the FAB — not a kit shadow token (FAB has its
    // own elevation profile higher than glassCardElevated).
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  // Toast ----------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 96,
    paddingHorizontal: spacing.md,
  },
});

export default BrandTeamView;
