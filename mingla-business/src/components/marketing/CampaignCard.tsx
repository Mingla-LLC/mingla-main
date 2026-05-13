/**
 * CampaignCard — single row in the campaigns history list.
 *
 * Renders status-specific meta + actions:
 *   - scheduled: "Scheduled for X · N recipients" + [Cancel]
 *   - sent: "Sent X · N recipients" (open/click rates TBD Phase C)
 *   - draft: "Saved Xm ago" + [Resume]
 *   - failed: "Failed X" + [Delete]
 *   - sending / cancelled: status caption only
 *
 * Phase B does NOT show a "View report" action — that requires the campaign
 * report screen which is Sub-ORCH-0815-C scope (SPEC Hard Guard §13).
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
import type { MarketingCampaignRow } from "../../types/marketing";

export interface CampaignCardProps {
  campaign: MarketingCampaignRow;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  /** Navigate to the per-campaign report (Sub-ORCH-0815-C-1). */
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
  campaign,
  onResume,
  onCancel,
  onDelete,
  onOpenReport,
}) => {
  const icon = STATUS_ICON[campaign.status] ?? "•";

  const renderMeta = (): React.ReactElement => {
    switch (campaign.status) {
      case "scheduled":
        return (
          <Text style={styles.metaText}>
            Scheduled for {formatDate(campaign.scheduled_for)}
            {campaign.recipient_count !== null
              ? ` · ${campaign.recipient_count} recipients`
              : ""}
          </Text>
        );
      case "sent":
        return (
          <Text style={styles.metaText}>
            Sent {formatDate(campaign.sent_at)}
            {campaign.recipient_count !== null
              ? ` · ${campaign.recipient_count} recipients`
              : ""}
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
    if (campaign.status === "draft") {
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
    if (campaign.status === "scheduled") {
      return (
        <Pressable
          onPress={() => onCancel(campaign.id)}
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
    if (campaign.status === "failed") {
      return (
        <Pressable
          onPress={() => onDelete(campaign.id)}
          accessibilityRole="button"
          accessibilityLabel={`Delete failed campaign ${campaign.name}`}
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
  //   - draft → resume in composer
  //   - everything else (scheduled / sending / sent / failed / cancelled) → report
  const handleRowPress = (): void => {
    if (campaign.status === "draft") {
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
        campaign.status === "draft"
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
});
