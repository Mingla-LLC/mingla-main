/**
 * OverviewRecentCampaignRow — compact row in the Overview tab's
 * "RECENT CAMPAIGNS" section (ORCH-0863). Per DESIGN §3.4.
 *
 * Smaller / denser than the full CampaignCard used in the Campaigns tab —
 * Overview surfaces 3 rows at a glance, not interaction-rich actions.
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon, type IconName } from "../ui/Icon";
import type {
  CampaignStatus,
  MarketingOverviewRecentCampaign,
} from "../../types/marketing";

interface StatusVisual {
  icon: IconName;
  color: string;
  label: string;
}

const STATUS_VISUAL: Record<CampaignStatus, StatusVisual> = {
  sent: { icon: "send", color: textTokens.secondary, label: "Sent" },
  scheduled: { icon: "clock", color: accent.warm, label: "Scheduled" },
  failed: { icon: "close", color: semantic.warning, label: "Failed" },
  draft: { icon: "edit", color: textTokens.tertiary, label: "Draft" },
  sending: { icon: "send", color: textTokens.secondary, label: "Sending" },
  cancelled: { icon: "close", color: textTokens.tertiary, label: "Cancelled" },
};

function formatRelative(iso: string | null, fallbackIso: string | null): string {
  const stamp = iso ?? fallbackIso;
  if (stamp === null) return "";
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export interface OverviewRecentCampaignRowProps {
  campaign: MarketingOverviewRecentCampaign;
  onPress: (id: string) => void;
  /** Hide hairline separator when this is the last row in the list. */
  isLast?: boolean;
}

export const OverviewRecentCampaignRow: React.FC<OverviewRecentCampaignRowProps> = ({
  campaign,
  onPress,
  isLast,
}) => {
  const visual = STATUS_VISUAL[campaign.status] ?? STATUS_VISUAL.draft;

  const handlePress = useCallback(() => {
    onPress(campaign.id);
  }, [campaign.id, onPress]);

  const dateIso =
    campaign.status === "scheduled" ? campaign.scheduled_for : campaign.sent_at;
  const relative = formatRelative(dateIso, campaign.created_at);

  const metaSegments: string[] = [visual.label];
  if (campaign.recipient_count !== null && campaign.recipient_count > 0) {
    metaSegments.push(
      `${campaign.recipient_count} recipient${campaign.recipient_count === 1 ? "" : "s"}`,
    );
  }
  if (relative.length > 0) metaSegments.push(relative);
  const metaText = metaSegments.join(" · ");

  return (
    <>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${campaign.name}, ${metaText}`}
        accessibilityHint="Opens the campaign report"
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      >
        <View style={styles.iconWrap}>
          <Icon name={visual.icon} size={18} color={visual.color} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {campaign.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {metaText}
          </Text>
        </View>
        <Icon name="chevR" size={16} color={textTokens.tertiary} />
      </Pressable>
      {isLast === true ? null : <View style={styles.separator} />}
    </>
  );
};

const ICON_COLUMN_WIDTH = 18;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  rowPressed: {
    opacity: 0.78,
  },
  iconWrap: {
    width: ICON_COLUMN_WIDTH,
    alignItems: "center",
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.body,
    color: textTokens.primary,
  },
  meta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
    marginLeft: spacing.md + ICON_COLUMN_WIDTH + spacing.sm,
  },
});
