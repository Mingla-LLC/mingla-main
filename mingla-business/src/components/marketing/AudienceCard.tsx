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
}

export const AudienceCard: React.FC<AudienceCardProps> = ({
  entry,
  reach,
  onPress,
  isCreating,
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
      return `${entry.display_name}, loading reach count`;
    }
    if (reach === null) {
      return `${entry.display_name}, reach unavailable, ${lastSentLabel.toLowerCase()}`;
    }
    return `${entry.display_name}, ${reach.total} buyers, ${reach.reachable_email} reachable, ${lastSentLabel.toLowerCase()}`;
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
        <Text style={styles.title} numberOfLines={1}>
          {entry.display_name}
        </Text>
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
