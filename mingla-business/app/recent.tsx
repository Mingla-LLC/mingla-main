import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../src/components/ui/EmptyState";
import { EventCoverMedia } from "../src/components/ui/EventCoverMedia";
import { Icon } from "../src/components/ui/Icon";
import { Pill } from "../src/components/ui/Pill";
import { TopBar } from "../src/components/ui/TopBar";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../src/constants/designSystem";
import { useBusinessRecent } from "../src/hooks/useBusinessRecent";
import { useCurrentBrand } from "../src/hooks/useCurrentBrand";
import { useResponsiveLayout } from "../src/hooks/useResponsiveLayout";
import type { BusinessRecentPointer } from "../src/store/businessRecentStore";
import { formatRelativeTime } from "../src/utils/relativeTime";
import { routeForBusinessRecent } from "../src/utils/routeForEventRow";
import { postHogService } from "../src/services/postHogService";

const typeLabel = (row: BusinessRecentPointer): string =>
  row.entityType === "rsvp"
    ? "RSVP"
    : row.entityType[0].toUpperCase() + row.entityType.slice(1);

const isLive = (row: BusinessRecentPointer): boolean => row.status === "live";

export function RecentRow({
  row,
  onPress,
}: {
  row: BusinessRecentPointer;
  onPress: () => void;
}): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const live = isLive(row);
  const status = live
    ? "Live"
    : row.status === "draft" || row.localDraft
      ? "Draft"
      : typeLabel(row);
  const opened = `Opened ${formatRelativeTime(row.lastOpenedAt)}`;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${typeLabel(row)}: ${row.title?.trim() || "Title unavailable"}. ${status}. ${opened}.`}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        Platform.OS === "web" && focused && styles.rowFocused,
      ]}
    >
      <EventCoverMedia
        hue={24}
        mediaUrl={row.coverUrl ?? null}
        posterUrl={row.coverPosterUrl ?? null}
        mediaType={row.coverType ?? null}
        radius={12}
        label=""
        height={56}
        width={56}
      />
      <View style={styles.rowText}>
        <View style={styles.metaRow}>
          {live ? (
            <Pill variant="live">Live</Pill>
          ) : row.status === "draft" || row.localDraft ? (
            <Pill variant="draft">Draft</Pill>
          ) : null}
          <Text style={styles.type}>{typeLabel(row)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {row.title?.trim() || "--"}
        </Text>
        <Text style={styles.opened}>{opened}</Text>
      </View>
      <Icon name="chevR" size={18} color={textTokens.tertiary} />
    </Pressable>
  );
}

export default function RecentScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const { isWideDesktop } = useResponsiveLayout();
  const [pageCount, setPageCount] = useState(1);
  const recent = useBusinessRecent({
    brandId: currentBrand?.id ?? null,
    pageCount,
  });
  const rows = useMemo(
    () => recent.rows.slice(0, pageCount * 25),
    [pageCount, recent.rows],
  );
  const openRow = useCallback(
    (row: BusinessRecentPointer): void => {
      const position = rows.findIndex(
        (candidate) =>
          candidate.entityType === row.entityType &&
          candidate.entityId === row.entityId,
      );
      postHogService.capture("business_recent_item_open", {
        entity_type: row.entityType,
        live_bucket: row.status === "live" ? "live" : "not_live",
        source: "recent",
        position_bucket:
          position < 10 ? "1_10" : position < 25 ? "11_25" : "26_plus",
        surface: "business",
      });
      const destination = routeForBusinessRecent({
        id: row.entityId,
        entityType: row.entityType,
        status: row.status === "draft" || row.localDraft ? "draft" : row.status,
      });
      if (destination !== null) router.push(destination as never);
    },
    [router, rows],
  );

  const stateNode =
    recent.state === "loading" ? (
      <View accessibilityLiveRegion="polite" style={styles.state}>
        <Text style={styles.stateTitle}>Loading Recent…</Text>
      </View>
    ) : recent.state === "offline-empty" ? (
      <EmptyState
        title="Recent is offline"
        description="Reconnect to load your recent work."
      />
    ) : recent.state === "permission" ? (
      <EmptyState
        title="Recent isn’t available for this brand"
        description="Your access may have changed. Switch brands or ask a brand owner for access."
      />
    ) : recent.state === "error-empty" ? (
      <EmptyState
        title="Couldn’t load Recent"
        description="Your work is still safe. Check your connection and try again."
        cta={{ label: "Try again", onPress: recent.retry }}
      />
    ) : recent.state === "omitted" ? (
      <EmptyState
        title="Nothing recent is available"
        description="Those items may have been removed or you may no longer have access. Open something else to start again."
      />
    ) : recent.state === "empty" ? (
      <EmptyState
        title="Nothing recent yet"
        description="Open a venue, event, experience, trip, or draft and it’ll show up here."
        cta={{
          label: "Browse your work",
          onPress: () => router.push("/(tabs)/hub" as never),
        }}
      />
    ) : null;

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top + (Platform.OS === "web" ? spacing.sm : 0) },
      ]}
    >
      <View style={styles.bar}>
        <TopBar
          leftKind="back"
          title="Recent"
          onBack={() => router.back()}
          rightSlot={null}
        />
      </View>
      {recent.state === "offline-cached" ? (
        <Text accessibilityLiveRegion="polite" style={styles.banner}>
          You’re offline — showing saved Recent.
        </Text>
      ) : null}
      {recent.state === "error-cached" ? (
        <Text accessibilityLiveRegion="polite" style={styles.banner}>
          Couldn’t refresh Recent. Showing saved work.
        </Text>
      ) : null}
      {recent.state === "refreshing" ? (
        <Text accessibilityLiveRegion="polite" style={styles.banner}>
          Updating…
        </Text>
      ) : null}
      {stateNode ?? (
        <FlatList
          testID="recent-list"
          style={isWideDesktop ? styles.desktopList : styles.mobileList}
          contentContainerStyle={[
            styles.content,
            isWideDesktop && styles.desktopGrid,
          ]}
          data={rows}
          key={isWideDesktop ? "desktop" : "mobile"}
          numColumns={isWideDesktop ? 4 : 1}
          keyExtractor={(row) => `${row.entityType}:${row.entityId}`}
          renderItem={({ item }) => (
            <View style={isWideDesktop ? styles.cell : undefined}>
              <RecentRow row={item} onPress={() => openRow(item)} />
            </View>
          )}
          ItemSeparatorComponent={
            isWideDesktop ? undefined : () => <View style={styles.separator} />
          }
          refreshControl={
            <RefreshControl
              refreshing={recent.isRefreshing}
              onRefresh={recent.refresh}
            />
          }
          onEndReached={() => {
            if (recent.hasMore) setPageCount((count) => Math.min(8, count + 1));
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            recent.hasMore ? (
              <Text style={styles.footer}>Loading more…</Text>
            ) : (
              <Text style={styles.footer}>End of Recent</Text>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  bar: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  banner: {
    color: textTokens.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    fontSize: typography.caption.fontSize,
  },
  mobileList: { flex: 1 },
  desktopList: { flex: 1, minHeight: 0 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 4 },
  desktopGrid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "25%", padding: spacing.xs },
  row: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowPressed: { opacity: 0.72 },
  rowFocused: { borderColor: accent.warm, borderWidth: 2 },
  rowText: { flex: 1, minWidth: 0 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: 2,
  },
  type: {
    color: textTokens.tertiary,
    fontSize: typography.micro.fontSize,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  opened: {
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  separator: { height: spacing.sm },
  state: { padding: spacing.xl, alignItems: "center" },
  stateTitle: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
  },
  footer: {
    color: textTokens.tertiary,
    textAlign: "center",
    padding: spacing.md,
  },
});
