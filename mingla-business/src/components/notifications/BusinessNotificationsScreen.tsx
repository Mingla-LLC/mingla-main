/**
 * BusinessNotificationsScreen — Mingla Business notification inbox.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-W (notifications app-type-prefix).
 *
 * Renders only `stripe.*` and `business.*` notification types — consumer
 * notifications never appear here even though the underlying table is
 * shared. Per-row severity from notification template metadata; tap →
 * deep-link navigation.
 *
 * States: loading | error | empty | populated.
 *
 * Wired into the main Mingla Business nav as a bell icon entry point;
 * caller (a screen wrapper or modal) provides `onClose` and optionally
 * `onOpenDeepLink`.
 */

import React, { useCallback } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { GlassCard } from "../ui/GlassCard";
import { Spinner } from "../ui/Spinner";
import {
  spacing,
  radius,
  typography,
  text as textTokens,
  accent,
  semantic,
  glass,
} from "../../constants/designSystem";
import {
  useBusinessNotifications,
  type BusinessNotification,
} from "../../hooks/useBusinessNotifications";

interface BusinessNotificationsScreenProps {
  userId: string | null;
  /** Fired when the user taps a notification with a non-null deep_link */
  onOpenDeepLink?: (deepLink: string, notification: BusinessNotification) => void;
}

export function BusinessNotificationsScreen({
  userId,
  onOpenDeepLink,
}: BusinessNotificationsScreenProps): React.ReactElement {
  const notificationsQuery = useBusinessNotifications(userId);

  const handlePress = useCallback(
    (n: BusinessNotification): void => {
      if (n.deep_link && onOpenDeepLink) {
        onOpenDeepLink(n.deep_link, n);
      }
    },
    [onOpenDeepLink],
  );

  if (notificationsQuery.isLoading) {
    return (
      <View style={styles.statusContainer}>
        <Spinner size={36} color={accent.warm} />
        <Text style={styles.statusText}>Loading notifications…</Text>
      </View>
    );
  }

  if (notificationsQuery.isError) {
    return (
      <View style={styles.statusContainer}>
        <Text style={styles.errorText}>
          Couldn't load your notifications. Pull down to try again.
        </Text>
      </View>
    );
  }

  const notifications = notificationsQuery.data ?? [];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={notificationsQuery.isFetching}
          onRefresh={(): void => {
            void notificationsQuery.refetch();
          }}
          tintColor={accent.warm}
        />
      }
    >
      <Text style={styles.heading}>Notifications</Text>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptyBody}>
            We'll let you know when there's something to act on — payouts,
            verification deadlines, refund updates.
          </Text>
        </View>
      ) : null}

      {notifications.map((n) => (
        <Pressable
          key={n.id}
          onPress={(): void => handlePress(n)}
          accessibilityRole="button"
          accessibilityLabel={`${n.title}. ${n.body}`}
          style={({ pressed }) => [
            styles.row,
            n.read_at === null ? styles.rowUnread : null,
            pressed ? styles.rowPressed : null,
          ]}
        >
          <View style={styles.rowDotCol}>
            {n.read_at === null ? <View style={styles.unreadDot} /> : null}
          </View>
          <View style={styles.rowMain}>
            <View style={styles.rowHeaderRow}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {n.title}
              </Text>
              <Text style={styles.rowTimestamp}>{formatRelative(n.created_at)}</Text>
            </View>
            <Text style={styles.rowBody} numberOfLines={2}>
              {n.body}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  heading: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
    paddingBottom: spacing.sm,
  },
  statusContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  statusText: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
  },
  errorText: {
    fontSize: typography.body.fontSize,
    color: semantic.error,
    textAlign: "center",
  },
  empty: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: typography.bodySm.lineHeight,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minHeight: 56,
  },
  rowUnread: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowDotCol: {
    width: 12,
    paddingTop: 6,
    alignItems: "center",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowTimestamp: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  rowBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: typography.bodySm.lineHeight,
  },
});

export default BusinessNotificationsScreen;
