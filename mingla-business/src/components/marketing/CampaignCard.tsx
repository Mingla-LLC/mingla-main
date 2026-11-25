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

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon, type IconName } from "../ui/Icon";
import { campaignFailureCopy } from "../../features/marketing/campaignFailureCopy";
import {
  LIST_METHOD_LABEL,
  type CampaignListGroup,
} from "../../features/marketing/campaignListGroups";

export interface CampaignCardProps {
  group: CampaignListGroup;
  /** #4420: a row inside the grouped list card (no card of its own). */
  inList?: boolean;
  /** #4420: draws the hairline above every row but the first. */
  divided?: boolean;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  /** Ids of the failed or cancelled methods to delete. */
  onDelete: (ids: string[]) => void;
  /** Navigate to the campaign screen (Sub-ORCH-0815-C-1, #4273). */
  onOpenReport: (id: string) => void;
}

// #4420 kit (marketing-campaigns__list): a line icon in a 36 tile, never an
// emoji (emoji render in each platform's colour font, off the Graphite look).
const STATUS_ICON: Record<string, IconName> = {
  scheduled: "clock",
  sent: "mail",
  sending: "flash",
  draft: "edit",
  failed: "flag",
  cancelled: "close",
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
  inList = false,
  divided = false,
}) => {
  const campaign = group.primary;
  const icon: IconName = STATUS_ICON[group.status] ?? "send";
  const single = group.members.length === 1;
  const scheduled = group.members.filter((row) => row.status === "scheduled");
  const sent = group.members.filter((row) => row.status === "sent");
  const allDraft = group.members.every((row) => row.status === "draft");
  const deletable = group.members.filter((row) => row.status === "failed" || row.status === "cancelled");
  // #4273 — a send the server counted as reaching people stays on record:
  // no Delete for it (the server refuses it anyway).
  const reachedSomeone = deletable.some((row) => (row.recipient_count ?? 0) > 0);
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
      case "failed": {
        // #4541 R4.3: a scheduled Blast whose form closed first sent nothing.
        if (group.members.some((row) => row.failure_reason === "form_closed")) {
          return (
            <Text style={[styles.metaText, styles.failedText]} testID="campaign-not-sent-form-closed">
              Not sent: form closed
            </Text>
          );
        }
        // #4596: any other reason on record is said in words, never as a code.
        const reasonCopy = campaignFailureCopy(
          group.members.find((row) => row.status === "failed" && (row.failure_reason ?? null) !== null)
            ?.failure_reason,
        );
        return reasonCopy !== null ? (
          <Text style={[styles.metaText, styles.failedText]} testID="campaign-not-sent-reason">
            {reasonCopy}
          </Text>
        ) : (
          <Text style={[styles.metaText, styles.failedText]}>
            Failed {formatDate(campaign.updated_at)}
          </Text>
        );
      }
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
    if ((group.status === "failed" || group.status === "cancelled") && deletable.length > 0 && !reachedSomeone) {
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
        inList ? styles.hostInList : null,
        divided ? styles.hostDivided : null,
        pressed ? styles.hostPressed : null,
      ]}
    >
      <View style={styles.statusIcon}>
        <Icon name={icon} size={18} color={group.status === "failed" ? color.warning : color.text1} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{campaign.name}</Text>
        {renderMeta()}
        {group.channels.length >= 2 ? (
          <View
            style={styles.chipRow}
            accessible
            accessibilityLabel={`Sent by ${group.channels.map((channel) => LIST_METHOD_LABEL[channel]).join(", ")}`}
            testID="campaign-card-methods"
          >
            {group.channels.map((channel) => (
              <View key={channel} style={styles.chip}>
                <Text style={styles.chipLabel}>{LIST_METHOD_LABEL[channel]}</Text>
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
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 64,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  hostInList: {
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  hostDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  hostPressed: {
    opacity: 0.85,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    ...type.body,
    color: color.text1,
    fontWeight: "600",
  },
  metaText: {
    ...type.small,
    color: color.text2,
  },
  failedText: {
    // semantic.warning is the solid hex (#f59e0b); semantic.warningTint is an
    // 18%-alpha background tint and would be near-invisible as a text color
    // on the card's translucent glass background (QA finding P2-2).
    color: color.warning,
  },
  actionBtn: {
    minHeight: 36,
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnPressed: {
    opacity: 0.85,
  },
  actionLabel: {
    ...type.small,
    fontWeight: "600",
    color: color.text1,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginTop: space[1],
  },
  chip: {
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  chipLabel: {
    ...type.label,
    color: color.text2,
  },
});
