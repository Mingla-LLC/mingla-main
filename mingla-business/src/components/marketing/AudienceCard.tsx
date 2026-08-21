/**
 * AudienceCard — row in the Audiences tab list (ORCH-0863). Per DESIGN §4.3.
 *
 * Real and virtual entries render identically — the materialization-on-tap
 * mechanism is invisible to the operator. `isCreating` swaps the chevron
 * for a small spinner during the brief async window when a virtual entry
 * is being lazy-created.
 */

import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type {
  AudienceListEntry,
  AudienceReachSummary,
  ManualGroupSummary,
} from "../../types/marketing";

function formatLastSent(iso: string | null): string {
  if (iso === null) return "Never sent";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Never sent";
  const diffMs = Date.now() - t;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `Last sent ${Math.max(diffMin, 1)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Last sent ${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `Last sent ${diffDay}d ago`;
  return `Last sent ${new Date(t).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}`;
}

export interface AudienceCardProps {
  entry: AudienceListEntry;
  /** undefined = reach not yet resolved (loading); null = resolution attempted but failed; populated = success. */
  reach: AudienceReachSummary | null | undefined;
  onPress: (entry: AudienceListEntry) => void;
  isCreating?: boolean;
  showAutomaticKind?: boolean;
}

export const AudienceCard: React.FC<AudienceCardProps> = ({
  entry,
  reach,
  onPress,
  isCreating,
  showAutomaticKind = false,
}) => {
  const handlePress = useCallback(() => {
    onPress(entry);
  }, [entry, onPress]);

  let reachLabel: string;
  if (reach === undefined) {
    reachLabel = "Loading reach…";
  } else if (reach === null) {
    reachLabel = "—";
  } else {
    const buyerWord = reach.total === 1 ? "buyer" : "buyers";
    reachLabel = `${reach.total} ${buyerWord} · ${reach.reachable_email} reachable`;
  }

  const lastSentLabel = formatLastSent(entry.last_used_at);

  const hint =
    entry.audience_id === null
      ? "Creates this audience and opens the campaign composer"
      : "Opens the campaign composer with this audience pre-filled";

  const accLabel = (() => {
    if (reach === undefined) {
      return `${entry.display_name}, ${showAutomaticKind ? "Automatic group, " : ""}loading reach count`;
    }
    if (reach === null) {
      return `${entry.display_name}, ${showAutomaticKind ? "Automatic group, " : ""}reach unavailable, ${lastSentLabel.toLowerCase()}`;
    }
    return `${entry.display_name}, ${showAutomaticKind ? "Automatic group, " : ""}${reach.total} buyers, ${reach.reachable_email} reachable, ${lastSentLabel.toLowerCase()}`;
  })();

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accLabel}
      accessibilityHint={hint}
      disabled={isCreating === true}
      style={({ pressed }) => [
        styles.host,
        pressed ? styles.hostPressed : null,
        isCreating === true ? styles.hostDisabled : null,
      ]}
    >
      <View style={styles.headerRow}>
        {showAutomaticKind ? <View style={styles.automaticTitle}><Icon name="flash" size={16} color={textTokens.secondary} /><Text style={styles.title} numberOfLines={1}>{entry.display_name}</Text><View style={styles.automaticBadge}><Text style={styles.automaticBadgeText}>Automatic</Text></View></View> : <Text style={styles.title} numberOfLines={1}>{entry.display_name}</Text>}
        {isCreating === true ? (
          <ActivityIndicator size="small" color={textTokens.secondary} />
        ) : (
          <Icon name="chevR" size={16} color={textTokens.tertiary} />
        )}
      </View>
      <Text style={styles.reach} numberOfLines={1}>
        {reachLabel}
      </Text>
      <Text style={styles.lastSent} numberOfLines={1}>
        {lastSentLabel}
      </Text>
    </Pressable>
  );
};

/** #2395 — Manual groups are organizational membership, not buyer reach. */
export function ManualGroupCard({
  group,
  onPress,
}: {
  group: ManualGroupSummary;
  onPress: (group: ManualGroupSummary) => void;
}): React.ReactElement {
  const people = `${group.memberCount} ${group.memberCount === 1 ? "person" : "people"}`;
  return <Pressable
    onPress={() => onPress(group)}
    accessibilityRole="button"
    accessibilityLabel={`${group.name}, Manual group, ${people}. Opens group details.`}
    style={({ pressed }) => [styles.host, styles.manualHost, pressed ? styles.hostPressed : null]}
  >
    <View style={styles.manualRow}>
      <View style={styles.manualGlyph}><Icon name="users" size={20} color="#ffb47d" /></View>
      <View style={styles.manualCopy}>
        <View style={styles.headerRow}><Text style={styles.title} numberOfLines={1}>{group.name}</Text><View style={styles.manualBadge}><Text style={styles.manualBadgeText}>Manual</Text></View></View>
        <Text style={styles.reach}>{people}</Text>
        {group.pendingReviewCount > 0 ? <Text style={styles.lastSent}>{group.pendingReviewCount} need review</Text> : null}
      </View>
      <Icon name="chevR" size={16} color={textTokens.tertiary} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
    minHeight: 76,
  },
  hostPressed: {
    opacity: 0.78,
  },
  hostDisabled: {
    opacity: 0.6,
  },
  manualHost: { minHeight: 80, paddingVertical: 12 },
  manualRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  manualGlyph: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235,120,37,.12)", borderWidth: 1, borderColor: "rgba(235,120,37,.32)" },
  manualCopy: { flex: 1, gap: 2 },
  manualBadge: { borderRadius: 8, paddingHorizontal: 8, minHeight: 22, justifyContent: "center", borderWidth: 1, borderColor: "rgba(235,120,37,.32)" },
  manualBadgeText: { ...typography.caption, fontWeight: "600", color: "#ffb47d" },
  automaticTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  automaticBadge: { borderRadius: 12, paddingHorizontal: 8, minHeight: 22, justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileElevated },
  automaticBadgeText: { ...typography.caption, fontWeight: "600", color: textTokens.secondary },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  title: {
    ...typography.body,
    fontWeight: "600",
    color: textTokens.primary,
    flex: 1,
  },
  reach: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  lastSent: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
});
