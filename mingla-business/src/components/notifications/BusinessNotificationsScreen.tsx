/**
 * BusinessNotificationsScreen — Mingla Business notification inbox.
 *
 * META-ORCH-1074 Sub-C — built to SPEC_META-ORCH-1074_SUB-C_DESIGN.md.
 *
 * An operator triage surface (money / risk / audience / team), NOT a social
 * feed. Renders only `stripe.*` and `business.*` rows (I-PROPOSED-W; the hook
 * owns the filter). Every row is a doorway — tap marks it read + deep-links via
 * `onOpenDeepLink`; the inbox never asks the user to act inside it.
 *
 * Card grammar (§3): leading 40×40 family-tinted icon circle, bold-entity
 * title, 2-line body, relative time, unread rail + dot, family-tinted unread
 * fill. Risk `dispute_action_needed` + blocking rows get an inline "Respond"
 * button (the one labelled CTA). NO swipe-to-dismiss (§4.4 — financial records
 * have reference value).
 *
 * List (§4): date buckets (Today / Yesterday / This week / Earlier),
 * chronological newest-first, unread blocking-risk floats to the top of its
 * own bucket.
 *
 * States (§5): skeleton (NOT a spinner) / empty / populated / error+retry /
 * offline (cached + banner) / degraded / web variant.
 *
 * Tokens only (§ Completion check): the 3pt unread rail + 8px dot + 40 circle
 * are the deliberate sub-grid accents the design calls out.
 */

import React, { useCallback, useMemo } from "react";
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Icon } from "../ui/Icon";
import {
  spacing,
  radius,
  typography,
  text as textTokens,
  accent,
  semantic,
  glass,
  shadows,
  canvas,
} from "../../constants/designSystem";
import { useShimmer } from "../../hooks/useShimmer";
import { HapticFeedback } from "../../utils/hapticFeedback";
import {
  useBusinessNotificationsInbox,
  type BusinessNotification,
} from "../../hooks/useBusinessNotifications";
import {
  resolveNotificationVisual,
  type NotificationFamily,
  type NotificationSeverity,
} from "../../constants/businessNotificationTemplates";

interface BusinessNotificationsScreenProps {
  userId: string | null;
  /** Fired when the user taps a row with a non-null deep_link. */
  onOpenDeepLink?: (deepLink: string, notification: BusinessNotification) => void;
}

// ── Family accent map (SUB-C_DESIGN §2) ──────────────────────────────────────

interface FamilyStyle {
  readonly accent: string;
  readonly tint: string; // 14% fill for the icon circle
  readonly unreadFill: string; // 8% card fill when unread
  readonly unreadBorder: string; // 22% border when unread
  readonly rail: string;
}

const FAMILY_STYLE: Record<NotificationFamily, FamilyStyle> = {
  money: {
    accent: accent.warm,
    tint: "rgba(235, 120, 37, 0.14)",
    unreadFill: "rgba(235, 120, 37, 0.08)",
    unreadBorder: "rgba(235, 120, 37, 0.22)",
    rail: accent.warm,
  },
  risk: {
    accent: semantic.warning,
    tint: "rgba(245, 158, 11, 0.14)",
    unreadFill: "rgba(245, 158, 11, 0.08)",
    unreadBorder: "rgba(245, 158, 11, 0.22)",
    rail: semantic.warning,
  },
  audience: {
    accent: semantic.warning,
    tint: "rgba(245, 158, 11, 0.14)",
    unreadFill: "rgba(245, 158, 11, 0.08)",
    unreadBorder: "rgba(245, 158, 11, 0.22)",
    rail: semantic.warning,
  },
  team: {
    accent: semantic.info,
    tint: "rgba(59, 130, 246, 0.14)",
    unreadFill: "rgba(59, 130, 246, 0.08)",
    unreadBorder: "rgba(59, 130, 246, 0.22)",
    rail: semantic.info,
  },
};

const ICON_CIRCLE = 40;
const UNREAD_RAIL_WIDTH = 3;
const UNREAD_DOT = 8;
const WEB_MAX_WIDTH = 640;

const isWeb = Platform.OS === "web";

// ── Date bucketing (SUB-C_DESIGN §4.1) ───────────────────────────────────────

type BucketKey = "today" | "yesterday" | "week" | "earlier";

const BUCKET_LABEL: Record<BucketKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};

const BUCKET_ORDER: readonly BucketKey[] = [
  "today",
  "yesterday",
  "week",
  "earlier",
];

function bucketFor(iso: string, now: Date): BucketKey {
  const created = new Date(iso);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const ms = created.getTime();
  if (ms >= startOfToday) return "today";
  if (ms >= startOfToday - 86400000) return "yesterday";
  if (ms >= startOfToday - 7 * 86400000) return "week";
  return "earlier";
}

function isBlockingRisk(
  family: NotificationFamily,
  severity: NotificationSeverity,
): boolean {
  return family === "risk" && severity === "blocking";
}

interface GroupedSection {
  readonly key: BucketKey;
  readonly label: string;
  readonly rows: readonly BusinessNotification[];
}

function groupByDate(
  notifications: readonly BusinessNotification[],
): readonly GroupedSection[] {
  const now = new Date();
  const buckets: Record<BucketKey, BusinessNotification[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const n of notifications) {
    buckets[bucketFor(n.created_at, now)].push(n);
  }
  return BUCKET_ORDER.map((key) => {
    const rows = buckets[key].slice();
    // Severity float (§4.2): an UNREAD blocking-risk row floats to the top of
    // its OWN bucket (not the whole list). Stable otherwise (chronological).
    rows.sort((a, b) => {
      const va = resolveNotificationVisual(a.type);
      const vb = resolveNotificationVisual(b.type);
      const fa = a.read_at === null && isBlockingRisk(va.family, va.severity) ? 1 : 0;
      const fb = b.read_at === null && isBlockingRisk(vb.family, vb.severity) ? 1 : 0;
      if (fa !== fb) return fb - fa; // floated first
      // chronological newest-first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return { key, label: BUCKET_LABEL[key], rows };
  }).filter((s) => s.rows.length > 0);
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
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

/** Resolve the bold entity span from `data.boldToken` (SUB-C_DESIGN §3.3). */
function boldTokenFor(n: BusinessNotification): string | null {
  const data = n.data ?? {};
  const token = (data as Record<string, unknown>).boldToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

// ── Row card ─────────────────────────────────────────────────────────────────

interface RowProps {
  notification: BusinessNotification;
  onPress: (n: BusinessNotification) => void;
}

const NotificationRow: React.FC<RowProps> = ({ notification, onPress }) => {
  const visual = resolveNotificationVisual(notification.type);
  const fam = FAMILY_STYLE[visual.family];
  const unread = notification.read_at === null;
  const blockingRisk = isBlockingRisk(visual.family, visual.severity);
  const bold = boldTokenFor(notification);

  const handlePress = useCallback(() => {
    if (Platform.OS !== "web") HapticFeedback.buttonPress();
    onPress(notification);
  }, [notification, onPress]);

  const a11yLabel = `${notification.title}. ${notification.body}. ${unread ? "Unread" : "Read"}. ${formatRelative(notification.created_at)} ago.`;

  // Title with the bold entity span emboldened (port of consumer
  // renderTitleWithBoldActor, generalised to data.boldToken).
  const renderTitle = (): React.ReactNode => {
    if (blockingRisk) {
      // Risk blocking rows render the whole title at 700 (§3.3).
      return (
        <Text style={[styles.title, styles.titleBold]} numberOfLines={1}>
          {notification.title}
        </Text>
      );
    }
    if (bold && notification.title.includes(bold)) {
      const idx = notification.title.indexOf(bold);
      const before = notification.title.slice(0, idx);
      const after = notification.title.slice(idx + bold.length);
      return (
        <Text style={styles.title} numberOfLines={1}>
          {before}
          <Text style={styles.titleBold}>{bold}</Text>
          {after}
        </Text>
      );
    }
    return (
      <Text style={styles.title} numberOfLines={1}>
        {notification.title}
      </Text>
    );
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: unread ? fam.unreadFill : glass.tint.profileBase,
          borderColor: unread ? fam.unreadBorder : glass.border.profileBase,
        },
        !isWeb && !unread ? shadows.glassCardBase : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      {/* unread rail */}
      {unread ? (
        <View
          style={[styles.rail, { backgroundColor: fam.rail }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}

      {/* icon circle */}
      <View style={[styles.iconCircle, { backgroundColor: fam.tint }]}>
        <Icon name={visual.icon} size={20} color={fam.accent} />
      </View>

      {/* content */}
      <View style={styles.content}>
        <View style={styles.titleRow}>
          {renderTitle()}
          <Text style={styles.time} numberOfLines={1}>
            {formatRelative(notification.created_at)}
          </Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>
          {notification.body}
        </Text>

        {blockingRisk ? (
          <View style={styles.respondRow}>
            <Text
              style={[styles.respondBtn, { color: semantic.warning }]}
              accessibilityRole="button"
              accessibilityLabel="Respond to dispute"
            >
              Respond
            </Text>
          </View>
        ) : null}
      </View>

      {/* trailing affordance + unread dot */}
      {!blockingRisk ? (
        <Icon
          name="chevR"
          size={16}
          color={textTokens.quaternary}
          style={styles.chev}
        />
      ) : null}
      {unread ? (
        <View
          style={[styles.dot, { backgroundColor: fam.rail }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </Pressable>
  );
};

// ── Skeleton (SUB-C_DESIGN §5 state 1) ───────────────────────────────────────

const SkeletonRow: React.FC<{ opacity: Animated.Value }> = ({ opacity }) => (
  <Animated.View style={[styles.card, styles.skeletonCard, { opacity }]}>
    <View style={[styles.iconCircle, styles.skeletonBlock]} />
    <View style={styles.content}>
      <View style={[styles.skeletonBar, { width: "70%" }]} />
      <View style={[styles.skeletonBar, { width: "90%", marginTop: spacing.sm }]} />
    </View>
  </Animated.View>
);

const SkeletonList: React.FC = () => {
  const { value } = useShimmer();
  return (
    <View style={styles.scrollContent}>
      {[0, 1, 2, 3].map((i) => (
        <SkeletonRow key={i} opacity={value} />
      ))}
    </View>
  );
};

// ── Empty / error states ─────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <View style={styles.centerState}>
    <View style={styles.emptyCircle}>
      <Icon name="bell" size={40} color={textTokens.tertiary} />
    </View>
    <Text style={styles.stateTitle}>{"You're all caught up"}</Text>
    <Text style={styles.stateBody}>
      {"We'll ping you when there's something to act on — a sale, a payout, a dispute, a new review."}
    </Text>
  </View>
);

const ErrorState: React.FC<{ onRetry: () => void; offline: boolean }> = ({
  onRetry,
  offline,
}) => (
  <View style={styles.centerState}>
    <View style={[styles.emptyCircle, styles.errorCircle]}>
      <Icon name="flag" size={40} color={semantic.error} />
    </View>
    <Text style={styles.stateTitle}>{"Couldn't load your notifications"}</Text>
    <Text style={styles.stateBody}>
      {offline
        ? "You're offline. Reconnect to load notifications."
        : "Pull down to try again, or tap retry."}
    </Text>
    {!offline ? (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry loading notifications"
        style={({ pressed }) => [
          styles.retryBtn,
          pressed ? styles.cardPressed : null,
        ]}
      >
        <Text style={styles.retryLabel}>Retry</Text>
      </Pressable>
    ) : null}
  </View>
);

const OfflineBanner: React.FC = () => (
  <View style={styles.offlineBanner}>
    <Icon name="globe" size={14} color={textTokens.secondary} />
    <Text style={styles.offlineText}>
      Showing your latest saved notifications.
    </Text>
  </View>
);

// ── Screen ───────────────────────────────────────────────────────────────────

export function BusinessNotificationsScreen({
  userId,
  onOpenDeepLink,
}: BusinessNotificationsScreenProps): React.ReactElement {
  const { query, notifications, markAsRead } =
    useBusinessNotificationsInbox(userId);

  const handlePress = useCallback(
    (n: BusinessNotification): void => {
      void markAsRead(n.id);
      if (n.deep_link && onOpenDeepLink) {
        onOpenDeepLink(n.deep_link, n);
      }
    },
    [markAsRead, onOpenDeepLink],
  );

  const sections = useMemo(() => groupByDate(notifications), [notifications]);

  // Loading (first load, no cache): skeleton.
  if (query.isLoading) {
    return <SkeletonList />;
  }

  // Error: if we have cached rows, show them with an offline-style banner
  // (degraded/offline); otherwise the error+retry state. (NetInfo is not a
  // dependency in this app — a fetch failure with cache stands in for offline.)
  if (query.isError && notifications.length === 0) {
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch();
        }}
        offline={false}
      />
    );
  }

  if (notifications.length === 0) {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.emptyScroll}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => {
              void query.refetch();
            }}
            tintColor={accent.warm}
          />
        }
      >
        <EmptyState />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.scrollContent,
        isWeb ? styles.webColumn : null,
      ]}
      refreshControl={
        <RefreshControl
          refreshing={query.isFetching}
          onRefresh={() => {
            void query.refetch();
          }}
          tintColor={accent.warm}
        />
      }
    >
      {query.isError ? <OfflineBanner /> : null}
      {sections.map((section, sIdx) => (
        <View key={section.key}>
          <Text
            style={[
              styles.sectionHeader,
              sIdx === 0 ? styles.sectionHeaderFirst : null,
            ]}
            accessibilityRole="header"
          >
            {section.label.toUpperCase()}
          </Text>
          {section.rows.map((n) => (
            <NotificationRow key={n.id} notification={n} onPress={handlePress} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  webColumn: {
    maxWidth: WEB_MAX_WIDTH,
    width: "100%",
    alignSelf: "center",
  },
  emptyScroll: {
    flexGrow: 1,
  },

  // Section header
  sectionHeader: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
    marginLeft: spacing.xs,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionHeaderFirst: {
    marginTop: spacing.md,
  },

  // Card
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md + UNREAD_RAIL_WIDTH,
    paddingRight: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden", // Android glass clip — mandatory (SUB-C_DESIGN §7)
    minHeight: 72,
    marginBottom: spacing.sm,
  },
  cardPressed: {
    opacity: 0.85,
  },
  rail: {
    position: "absolute",
    left: 0,
    top: spacing.sm,
    bottom: spacing.sm,
    width: UNREAD_RAIL_WIDTH,
    borderRadius: 2,
  },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
  titleBold: {
    fontWeight: "700",
  },
  time: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  body: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "400",
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  respondRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.sm,
  },
  respondBtn: {
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  chev: {
    alignSelf: "center",
    marginLeft: spacing.sm,
  },
  dot: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: UNREAD_DOT,
    height: UNREAD_DOT,
    borderRadius: UNREAD_DOT / 2,
  },

  // Skeleton
  skeletonCard: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  skeletonBlock: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  skeletonBar: {
    height: 12,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },

  // Center states
  centerState: {
    flexGrow: 1,
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    backgroundColor: canvas.discover,
  },
  emptyCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorCircle: {
    backgroundColor: semantic.errorTint,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "center",
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 20,
    color: textTokens.secondary,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: spacing.sm,
    backgroundColor: accent.warm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  retryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.inverse,
  },

  // Offline banner
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  offlineText: {
    fontSize: 13,
    color: textTokens.secondary,
    flexShrink: 1,
  },
});

export default BusinessNotificationsScreen;
