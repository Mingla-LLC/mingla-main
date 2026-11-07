/**
 * CampaignCard — one blast in the campaigns history list (#4273: every method
 * of a campaign is one card, with a method chip row when there are two or
 * more).
 *
 * Renders the blast's rolled-up status + actions:
 *   - scheduled: "Scheduled for X" + [Cancel] when exactly one method waits
 *   - sent: "Sent X" (recipients when it has one method)
 *   - draft: "Saved Xm ago" + [Resume]
 *   - failed / cancelled: caption + [Delete] (#4273 extra b: deletes failed or
 *     cancelled methods; a confirmed send stays on record)
 *   - sending: status caption only
 * Tapping the card opens the composer when every method is a draft, else the
 * campaign screen on the blast's first method.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  METHOD_LABEL,
  type CampaignListGroup,
} from "../../features/marketing/sentPreviewModel";

export interface CampaignCardProps {
  group: CampaignListGroup;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  /** Ids of the failed or cancelled methods to delete. */
  onDelete: (ids: string[]) => void;
  /** Navigate to the campaign screen (Sub-ORCH-0815-C-1, #4273). */
  onOpenReport: (id: string) => void;
}

const STATUS_ICON: Record<string, string> = {
  scheduled: "⏰",
  sent: "✉",
  sending: "⚡",
  draft: "📝",
  failed: "⚠",
  cancelled: "—",
};

function timeAgo(iso: string | null): string {
  if (iso === null) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = now - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const CampaignCard: React.FC<CampaignCardProps> = ({
  group,
  onResume,
  onCancel,
  onDelete,
  onOpenReport,
}) => {
  const campaign = group.primary;
  const icon = STATUS_ICON[group.status] ?? "•";
  const single = group.members.length === 1;
  const scheduled = group.members.filter((row) => row.status === "scheduled");
  const sent = group.members.filter((row) => row.status === "sent");
  const allDraft = group.members.every((row) => row.status === "draft");
  const deletable = group.members.filter((row) => row.status === "failed" || row.status === "cancelled");
  const recipients = single && campaign.recipient_count !== null
    ? ` · ${campaign.recipient_count} recipients`
    : "";

  const renderMeta = (): React.ReactElement => {
    switch (group.status) {
      case "scheduled":
        return (
          <Text style={styles.metaText}>
            Scheduled for {formatDate(scheduled[0]?.scheduled_for ?? campaign.scheduled_for)}
            {recipients}
          </Text>
        );
      case "sent":
        return (
          <Text style={styles.metaText}>
            Sent {formatDate(sent[0]?.sent_at ?? campaign.sent_at)}
            {recipients}
          </Text>
        );
      case "sending":
        return <Text style={styles.metaText}>Sending now…</Text>;
      case "draft":
        return (
          <Text style={styles.metaText}>Saved {timeAgo(campaign.updated_at)}</Text>
        );
      case "failed":
        return (
          <Text style={[styles.metaText, styles.failedText]}>
            Failed {formatDate(campaign.updated_at)}
          </Text>
        );
      case "cancelled":
        return <Text style={styles.metaText}>Cancelled</Text>;
    }
  };

  const renderActions = (): React.ReactElement | null => {
    if (allDraft) {
      return (
        <Pressable
          onPress={() => onResume(campaign.id)}
          accessibilityRole="button"
          accessibilityLabel={`Resume draft ${campaign.name}`}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed ? styles.actionBtnPressed : null,
          ]}
        >
          <Text style={styles.actionLabel}>Resume</Text>
        </Pressable>
      );
    }
    // A blast with several scheduled methods is cancelled from its screen.
    if (group.status === "scheduled" && scheduled.length === 1) {
      const target = scheduled[0];
      return (
        <Pressable
          onPress={() => onCancel(target.id)}
          accessibilityRole="button"
          accessibilityLabel={`Cancel scheduled campaign ${campaign.name}`}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed ? styles.actionBtnPressed : null,
          ]}
        >
          <Text style={styles.actionLabel}>Cancel</Text>
        </Pressable>
      );
    }
    if ((group.status === "failed" || group.status === "cancelled") && deletable.length > 0) {
      return (
        <Pressable
          onPress={() => onDelete(deletable.map((row) => row.id))}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${group.status} campaign ${campaign.name}`}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed ? styles.actionBtnPressed : null,
          ]}
        >
          <Text style={styles.actionLabel}>Delete</Text>
        </Pressable>
      );
    }
    return null;
  };

  // Tap-on-row routing:
  //   - every method a draft → resume in composer
  //   - anything else → the campaign screen, on the blast's first method
  const handleRowPress = (): void => {
    if (allDraft) {
      onResume(campaign.id);
    } else {
      onOpenReport(campaign.id);
    }
  };

  return (
    <Pressable
      onPress={handleRowPress}
      accessibilityRole="button"
      accessibilityLabel={
        allDraft
          ? `Resume draft ${campaign.name}`
          : `Open report for ${campaign.name}`
      }
      style={({ pressed }) => [
        styles.host,
        pressed ? styles.hostPressed : null,
      ]}
    >
      <Text style={styles.statusIcon}>{icon}</Text>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{campaign.name}</Text>
        {renderMeta()}
        {group.channels.length >= 2 ? (
          <View
            style={styles.chipRow}
            accessible
            accessibilityLabel={`Sent by ${group.channels.map((channel) => METHOD_LABEL[channel]).join(", ")}`}
            testID="campaign-card-methods"
          >
            {group.channels.map((channel) => (
              <View key={channel} style={styles.chip}>
                <Text style={styles.chipLabel}>{METHOD_LABEL[channel]}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {renderActions()}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  hostPressed: {
    opacity: 0.85,
  },
  statusIcon: {
    ...typography.h3,
    color: textTokens.primary,
    width: 28,
    textAlign: "center",
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  metaText: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  failedText: {
    // semantic.warning is the solid hex (#f59e0b); semantic.warningTint is an
    // 18%-alpha background tint and would be near-invisible as a text color
    // on the card's translucent glass background (QA finding P2-2).
    color: semantic.warning,
  },
  actionBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnPressed: {
    opacity: 0.85,
  },
  actionLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  chipLabel: {
    ...typography.labelCap,
    color: textTokens.secondary,
  },
});
