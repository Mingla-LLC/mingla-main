import React, { useCallback, useMemo } from "react";
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

import { TopBar } from "../ui/TopBar";
import { RecentRow } from "./RecentRow";
import { RecentStatePanel } from "./RecentStatePanel";
import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { useBusinessRecent } from "../../hooks/useBusinessRecentReader";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import type { BusinessRecentPointer } from "../../store/businessRecentStore";
import {
  businessRecentDestination,
  routeForBusinessRecent,
} from "../../utils/routeForEventRow";
import { postHogService } from "../../services/postHogService";

export function RecentFullScreen(props: {
  recent: ReturnType<typeof useBusinessRecent>;
  pageCount: number;
  onRequestNextPage: () => void;
  onBack: () => void;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const { recent, pageCount } = props;
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
        destination:
          row.destination ??
          businessRecentDestination(
            row.entityType,
            row.localDraft ? "draft" : row.status,
          ),
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
      <RecentStatePanel
        title="Recent is offline"
        description="Reconnect to load your recent work."
      />
    ) : recent.state === "permission" ? (
      <RecentStatePanel
        title="Recent isn’t available for this brand"
        description="Your access may have changed. Switch brands or ask a brand owner for access."
      />
    ) : recent.state === "error-empty" ? (
      <RecentStatePanel
        title="Couldn’t load Recent"
        description="Your work is still safe. Check your connection and try again."
        cta={{ label: "Try again", onPress: recent.retry }}
      />
    ) : recent.state === "omitted" ? (
      <RecentStatePanel
        title="Nothing recent is available"
        description="Those items may have been removed or you may no longer have access. Open something else to start again."
      />
    ) : recent.state === "empty" ? (
      <RecentStatePanel
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
          onBack={props.onBack}
          rightSlot={null}
        />
      </View>
      {recent.state === "offline-cached" ? (
        <Text accessibilityLiveRegion="polite" style={styles.banner}>
          You’re offline — showing saved Recent.
        </Text>
      ) : null}
      {recent.state === "error-cached" ? (
        <View style={styles.bannerRow}>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.banner, styles.bannerMessage]}
          >
            Couldn’t refresh Recent. Showing saved work.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading Recent"
            onPress={() => void recent.retry()}
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
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
            if (recent.hasMore) props.onRequestNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            recent.isLoadingMore ? (
              <Text style={styles.footer}>Loading more…</Text>
            ) : recent.hasPageError ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading more Recent"
                onPress={() => void recent.retry()}
                style={styles.footerRetry}
              >
                <Text style={styles.retryLabel}>
                  Couldn’t load more — Retry
                </Text>
              </Pressable>
            ) : !recent.hasMore && rows.length > 0 ? (
              <Text style={styles.footer}>End of Recent</Text>
            ) : null
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
  bannerMessage: { flex: 1 },
  bannerRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: spacing.md,
  },
  retryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  retryLabel: { color: accent.warm, fontWeight: "700" },
  footerRetry: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  mobileList: { flex: 1 },
  desktopList: { flex: 1, minHeight: 0 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 4 },
  desktopGrid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "25%", padding: spacing.xs },
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
