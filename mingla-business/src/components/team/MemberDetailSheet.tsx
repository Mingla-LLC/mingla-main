/**
 * MemberDetailSheet — J-T2 + J-T4 brand-team member detail (Cycle 13a).
 *
 * Opens from a row tap on the team list. Renders member info + role
 * description; surfaces a single destructive action (Revoke for pending
 * entries, Remove for accepted entries) gated by `currentRank` per
 * MIN_RANK.REVOKE_INVITATION / MIN_RANK.REMOVE_TEAM_MEMBER (Const #1
 * disabled-with-caption when below threshold).
 *
 * Per Cycle 13a SPEC §4.11.
 *
 * ORCH-1384: the EXACT member row matching an accepted, non-cancelled
 * partner_brand_links row (partnerLink prop non-null) gains a "Mingla
 * Partner" badge, and — for the brand OWNER only — the destructive slot
 * becomes "Disconnect partner", wired to useDisconnectLink through this
 * component's own shipped ConfirmDialog pattern (DESIGN §2.4 —
 * minimal-diff over uniformity for a live component; custom in-app confirm,
 * never native Alert). Every OTHER member's remove stays byte-identical
 * (`handleRemove` no-op preserved — ORCH-1051 untouched, SC-9).
 */

import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { roleDescription, roleDisplayName } from "../../utils/brandRole";
import {
  canPerformAction,
  gateCaptionFor,
} from "../../utils/permissionGates";
import { type BrandTeamEntry } from "../../store/brandTeamStore";
import { formatRelativeTime } from "../../utils/relativeTime";
import { useDisconnectLink } from "../../hooks/usePartnerBrandLinkMutations";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

// ORCH-1384 web eager-bundle budget fix — INLINE error-copy copy.
//
// Mirrors partnerLinkLabels.errorCopyFor VERBATIM (the canonical, unit-tested
// source used by the lazy PartnerLinkDetailSheet). Deliberately duplicated here
// rather than imported so partnerLinkLabels is pulled ONLY by the lazy sheet,
// keeping the sheet's native-first graph out of the shared web boot `__common`
// chunk (scripts/ci/orch-1083-initial-bundle-budget.mjs). Pure spec-frozen copy
// — NOT a Const #2 data-ownership split;
// partnerLinkLabels.driftguard.orch1384.source.test.ts guards against drift.
/** §5.6 — typed service error code → user copy. */
function errorCopyFor(code: string): string {
  switch (code) {
    case "link_not_pending":
      return "This invite already changed state. Close this and check the list.";
    case "link_not_active":
      return "This connection isn't active anymore. Close this and check the list.";
    case "link_not_found":
      return "This link no longer exists. Close this and refresh.";
    case "forbidden":
      return "You don't have permission to manage this link.";
    case "email_send_failed":
      return "We couldn't send the email. Tap Resend invite to try again.";
    default:
      return "Something broke on our side. Try again.";
  }
}

/** ORCH-1384 — identifies the matched partner row (accepted, non-cancelled link). */
export interface MemberDetailPartnerLink {
  linkId: string;
  brandId: string;
}

export interface MemberDetailSheetProps {
  visible: boolean;
  entry: BrandTeamEntry | null;
  /** Current operator's rank — drives gating of destructive actions. */
  currentRank: number;
  onClose: () => void;
  onRevoke: (entry: BrandTeamEntry) => void;
  onRemove: (entry: BrandTeamEntry) => void;
  /**
   * ORCH-1384 — non-null EXACTLY when this entry is the member row whose
   * user_id matches an accepted, non-cancelled link's partner_account_id.
   */
  partnerLink?: MemberDetailPartnerLink | null;
  /** ORCH-1384 — true when the viewer is the brand_owner (gates the verb). */
  viewerIsOwner?: boolean;
  /** ORCH-1384 — fires after a successful disconnect (sheet already closed). */
  onPartnerDisconnected?: () => void;
}

export const MemberDetailSheet: React.FC<MemberDetailSheetProps> = ({
  visible,
  entry,
  currentRank,
  onClose,
  onRevoke,
  onRemove,
  partnerLink = null,
  viewerIsOwner = false,
  onPartnerDisconnected,
}) => {
  const [confirmVisible, setConfirmVisible] = useState<boolean>(false);
  const [disconnectConfirmVisible, setDisconnectConfirmVisible] =
    useState<boolean>(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const disconnectMutation = useDisconnectLink();

  const handleConfirm = useCallback((): void => {
    if (entry === null) return;
    if (entry.status === "pending") {
      onRevoke(entry);
    } else if (entry.status === "accepted") {
      onRemove(entry);
    }
    setConfirmVisible(false);
  }, [entry, onRevoke, onRemove]);

  const handleDisconnectConfirm = useCallback(async (): Promise<void> => {
    if (partnerLink === null) return;
    setDisconnectError(null);
    try {
      await disconnectMutation.mutateAsync({
        linkId: partnerLink.linkId,
        brandId: partnerLink.brandId,
      });
      setDisconnectConfirmVisible(false);
      onClose();
      onPartnerDisconnected?.();
    } catch (error) {
      setDisconnectError(
        errorCopyFor(error instanceof Error ? error.message : "server"),
      );
    }
  }, [partnerLink, disconnectMutation, onClose, onPartnerDisconnected]);

  if (entry === null) {
    return null;
  }

  const isPending = entry.status === "pending";
  const isAccepted = entry.status === "accepted";

  // ORCH-1384 — the matched partner row (badge always; verb owner-only).
  const isPartnerRow = isAccepted && partnerLink !== null;
  const showPartnerDisconnect = isPartnerRow && viewerIsOwner === true;

  const action = isPending ? "REVOKE_INVITATION" : "REMOVE_TEAM_MEMBER";
  const canAct = canPerformAction(currentRank, action);

  const statusText = isPending
    ? `Invitation sent ${formatRelativeTime(entry.invitedAt)}`
    : isAccepted && entry.acceptedAt !== null
      ? `Joined ${formatRelativeTime(entry.acceptedAt)}`
      : `Status: ${entry.status}`;

  const actionLabel = isPending ? "Revoke invitation" : "Remove from team";

  const confirmTitle = isPending
    ? "Revoke this invitation?"
    : "Remove from team?";
  const confirmDescription = isPending
    ? `${entry.inviteeName} won't be able to accept this invitation.`
    : `${entry.inviteeName} will lose access to this brand. They can be re-invited later.`;

  return (
    <>
      <Sheet visible={visible} onClose={onClose} snapPoint="half">
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{entry.inviteeName}</Text>
          <Text style={styles.email}>{entry.inviteeEmail}</Text>

          <View style={styles.rolePillRow}>
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>
                {roleDisplayName(entry.role)}
              </Text>
            </View>
            {isPartnerRow ? (
              <View style={styles.partnerBadge}>
                <Icon name="award" size={10} color={accent.warm} />
                <Text style={styles.partnerBadgeText}>Mingla Partner</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.statusText}>{statusText}</Text>

          <View style={styles.descriptionCard}>
            <Text style={styles.descriptionLabel}>What this role does</Text>
            <Text style={styles.descriptionText}>
              {roleDescription(entry.role)}
            </Text>
          </View>

          {showPartnerDisconnect ? (
            <View style={styles.actions}>
              <Button
                label="Disconnect partner"
                onPress={() => {
                  setDisconnectError(null);
                  setDisconnectConfirmVisible(true);
                }}
                variant="destructive"
                size="lg"
                fullWidth
                testID="member-detail-disconnect-partner"
                accessibilityLabel="Disconnect partner"
              />
              <View style={styles.actionSpacer} />
              <Button
                label="Cancel"
                onPress={onClose}
                variant="ghost"
                size="md"
                fullWidth
                accessibilityLabel="Close member detail"
              />
            </View>
          ) : (isPending || isAccepted) ? (
            <View style={styles.actions}>
              <Button
                label={actionLabel}
                onPress={() => setConfirmVisible(true)}
                variant="destructive"
                size="lg"
                fullWidth
                disabled={!canAct}
                accessibilityLabel={actionLabel}
              />
              {!canAct ? (
                <Text style={styles.gateCaption}>
                  {gateCaptionFor(action)}
                </Text>
              ) : null}
              <View style={styles.actionSpacer} />
              <Button
                label="Cancel"
                onPress={onClose}
                variant="ghost"
                size="md"
                fullWidth
                accessibilityLabel="Close member detail"
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <Button
                label="Close"
                onPress={onClose}
                variant="ghost"
                size="md"
                fullWidth
                accessibilityLabel="Close member detail"
              />
            </View>
          )}
        </ScrollView>
      </Sheet>

      <ConfirmDialog
        visible={confirmVisible}
        onClose={() => setConfirmVisible(false)}
        onConfirm={handleConfirm}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={isPending ? "Revoke" : "Remove"}
        destructive
      />

      {/* ORCH-1384 — owner-only partner disconnect (dual stamp: link
          cancelled_at + team removed_at in ONE RPC transaction). The money
          truth rides the description verbatim (DESIGN §9.2). Scrim/close
          disable while the mutation is in flight (§5.5). */}
      <ConfirmDialog
        visible={disconnectConfirmVisible}
        onClose={() => {
          if (disconnectMutation.isPending) return;
          setDisconnectConfirmVisible(false);
          setDisconnectError(null);
        }}
        onConfirm={handleDisconnectConfirm}
        title="Disconnect this partner?"
        description="They'll lose team access and stop earning from future sales for this brand. Money already earned still pays out."
        confirmLabel="Disconnect"
        destructive
        confirmLoading={disconnectMutation.isPending}
        closeDisabled={disconnectMutation.isPending}
        errorMessage={disconnectError}
        confirmTestID="member-detail-disconnect-confirm"
      />
    </>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  email: {
    fontSize: 14,
    color: textTokens.secondary,
    marginTop: 2,
  },
  rolePillRow: {
    flexDirection: "row",
    alignItems: "center",
    // ORCH-1384 — chips wrap on narrow screens (badge appended after the
    // role pill; DESIGN §2.4).
    flexWrap: "wrap",
    rowGap: 4,
    marginTop: spacing.sm + 2,
  },
  rolePill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.32)",
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "600",
    color: accent.warm,
  },
  // ORCH-1384 — "Mingla Partner" badge. Text is text.primary on accent.tint
  // (10.66:1/9.41:1 measured, DESIGN §4.3) — deliberately NOT the role pill's
  // warm-on-tint (4.27:1 marginal): two different facts, two treatments.
  partnerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    marginLeft: spacing.xs + 2,
  },
  partnerBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: textTokens.primary,
  },
  statusText: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  descriptionCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  descriptionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  descriptionText: {
    fontSize: 14,
    color: textTokens.primary,
    lineHeight: 20,
  },
  actions: {
    paddingTop: spacing.lg,
  },
  actionSpacer: {
    height: spacing.sm,
  },
  gateCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 6,
    textAlign: "center",
  },
});

export default MemberDetailSheet;
