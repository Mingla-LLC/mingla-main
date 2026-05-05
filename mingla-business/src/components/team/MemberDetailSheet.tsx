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

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Sheet } from "../ui/Sheet";

export interface MemberDetailSheetProps {
  visible: boolean;
  entry: BrandTeamEntry | null;
  /** Current operator's rank — drives gating of destructive actions. */
  currentRank: number;
  onClose: () => void;
  onRevoke: (entry: BrandTeamEntry) => void;
  onRemove: (entry: BrandTeamEntry) => void;
}

export const MemberDetailSheet: React.FC<MemberDetailSheetProps> = ({
  visible,
  entry,
  currentRank,
  onClose,
  onRevoke,
  onRemove,
}) => {
  const [confirmVisible, setConfirmVisible] = useState<boolean>(false);

  const handleConfirm = useCallback((): void => {
    if (entry === null) return;
    if (entry.status === "pending") {
      onRevoke(entry);
    } else if (entry.status === "accepted") {
      onRemove(entry);
    }
    setConfirmVisible(false);
  }, [entry, onRevoke, onRemove]);

  if (entry === null) {
    return null;
  }

  const isPending = entry.status === "pending";
  const isAccepted = entry.status === "accepted";

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
          </View>

          <Text style={styles.statusText}>{statusText}</Text>

          <View style={styles.descriptionCard}>
            <Text style={styles.descriptionLabel}>What this role does</Text>
            <Text style={styles.descriptionText}>
              {roleDescription(entry.role)}
            </Text>
          </View>

          {(isPending || isAccepted) ? (
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
  statusText: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  descriptionCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
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
