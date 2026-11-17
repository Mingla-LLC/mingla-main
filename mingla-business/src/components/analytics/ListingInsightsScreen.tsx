import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";
import { color, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useEntityTrafficRollup } from "../../hooks/useTrafficAnalytics";
import { TrafficAnalyticsDashboard } from "./LazyTrafficAnalyticsDashboard";
import type { TrafficRange } from "../../services/trafficAnalyticsService";
import {
  ListingInsightsUnavailableError,
  type ListingInsightsIdentity,
  type ListingInsightsRollup,
} from "../../services/listingInsightsService";
import {
  captureBusinessListingInsightsOpened,
  captureBusinessListingInsightsRefreshed,
  type BusinessListingInsightsEntryPoint,
} from "../../analytics/businessAnalyticsEvents";
import { TopBar } from "../ui/TopBar";
import { LegacyListingInsightsScreen } from "./LegacyListingInsightsScreen";
import { listingInsightsIntro } from "./listingInsightsIntro";

interface TrafficListingInsightsScreenProps {
  identity: UseQueryResult<ListingInsightsIdentity, Error>;
  entryPoint: BusinessListingInsightsEntryPoint;
  onBack: () => void;
  onBackToListings: () => void;
  allowed: boolean;
  forceUnavailable?: boolean;
  accessError?: boolean;
  onRetryAccess?: () => void;
}

interface ListingInsightsScreenProps extends Omit<
  TrafficListingInsightsScreenProps,
  "allowed"
> {
  allowed?: boolean;
  /** Compatibility input for the pre-traffic RPC while older consumers retire. */
  rollup?: UseQueryResult<ListingInsightsRollup, Error>;
}

const TrafficListingInsightsScreen: React.FC<
  TrafficListingInsightsScreenProps
> = ({
  identity,
  entryPoint,
  onBack,
  onBackToListings,
  allowed,
  forceUnavailable = false,
  accessError = false,
  onRetryAccess,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const [range, setRange] = useState<TrafficRange>("30d");
  const trafficEntityType =
    identity.data?.listingType === "rsvp"
      ? "event"
      : (identity.data?.listingType ?? null);
  const rollup = useEntityTrafficRollup(
    identity.data?.brandId ?? null,
    trafficEntityType,
    identity.data?.id ?? null,
    range,
    allowed,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const trackedId = useRef<string | null>(null);

  useEffect(() => {
    setRefreshFailure(false);
    setAnnouncement(null);
    trackedId.current = null;
  }, [identity.data?.id]);

  useEffect(() => {
    if (
      identity.data === undefined ||
      rollup.data?.authorized !== true ||
      trackedId.current === identity.data.id
    ) {
      return;
    }
    trackedId.current = identity.data.id;
    captureBusinessListingInsightsOpened(
      identity.data.listingType === "venue"
        ? "event"
        : identity.data.listingType,
      entryPoint,
      rollup.data.totals.minglaCustomers > 0,
    );
  }, [entryPoint, identity.data, rollup.data]);

  const refresh = useCallback(async (): Promise<void> => {
    if (isRefreshing || identity.data === undefined) return;
    setIsRefreshing(true);
    setRefreshFailure(false);
    setAnnouncement("Updating…");
    const result = await rollup.refetch();
    const succeeded = !result.isError && result.data?.authorized === true;
    captureBusinessListingInsightsRefreshed(
      identity.data.listingType === "venue"
        ? "event"
        : identity.data.listingType,
      succeeded ? "success" : "error",
    );
    setRefreshFailure(!succeeded);
    setAnnouncement(
      succeeded ? "Insights updated" : "Couldn't refresh insights",
    );
    setIsRefreshing(false);
  }, [identity.data, isRefreshing, rollup]);

  const unavailable =
    forceUnavailable ||
    identity.error instanceof ListingInsightsUnavailableError ||
    rollup.data?.authorized === false;
  const title = identity.data?.title ?? "Listing insights";
  const topBar = (
    <View style={styles.topBar}>
      <TopBar
        leftKind="back"
        title="Insights"
        onBack={onBack}
        rightSlot={null}
      />
    </View>
  );

  if (unavailable) {
    return (
      <View style={styles.host}>
        {topBar}
        <View style={styles.centerState}>
          <Text style={styles.stateTitle} accessibilityRole="header">
            Insights unavailable
          </Text>
          <Text style={styles.stateBody}>
            You don&apos;t have permission to view insights for this listing.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onBackToListings}
            style={styles.action}
          >
            <Text style={styles.actionText}>Back to listings</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const initialRequestError =
    accessError ||
    identity.isError ||
    (rollup.isError &&
      rollup.data === undefined &&
      identity.data !== undefined);
  if (initialRequestError) {
    return (
      <View style={styles.host}>
        {topBar}
        <View style={styles.centerState}>
          <Text style={styles.eyebrow}>LISTING INSIGHTS</Text>
          <Text style={styles.listingTitle} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.stateTitle} accessibilityRole="header">
            Couldn&apos;t load listing insights
          </Text>
          <Text style={styles.stateBody}>
            Check your connection and try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (accessError) onRetryAccess?.();
              else if (identity.isError) void identity.refetch();
              else void rollup.refetch();
            }}
            style={styles.action}
          >
            <Text style={styles.actionText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      {topBar}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        horizontal={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          isWideDesktop ? undefined : (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refresh()}
              tintColor={color.accent}
            />
          )
        }
      >
        <View style={styles.content}>
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>LISTING INSIGHTS</Text>
              <Text style={styles.listingTitle} accessibilityRole="header">
                {title}
              </Text>
              {identity.data === undefined ? null : (
                <Text style={styles.intro}>
                  {listingInsightsIntro(identity.data.listingType)}
                </Text>
              )}
              <View accessibilityLiveRegion="polite">
                {announcement === null ? null : (
                  <Text style={styles.status}>{announcement}</Text>
                )}
              </View>
            </View>
            {isWideDesktop ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isRefreshing ? "Updating insights" : "Refresh insights"
                }
                disabled={isRefreshing}
                onPress={() => void refresh()}
                style={styles.action}
              >
                <Text style={styles.actionText}>
                  {isRefreshing ? "Updating…" : "Refresh"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {refreshFailure || (rollup.isError && rollup.data !== undefined) ? (
            <View style={styles.refreshFailure}>
              <Text style={styles.stateTitle}>
                Couldn&apos;t refresh insights
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refresh()}
                style={styles.action}
              >
                <Text style={styles.actionText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          <TrafficAnalyticsDashboard
            loadingFallback={
              <View
                style={styles.dashboardLoading}
                testID="traffic-dashboard-loading"
                accessibilityLabel="Loading insights"
              >
                <ActivityIndicator color={color.accent} />
              </View>
            }
            renderLoadError={(retry) => (
              <View style={styles.refreshFailure}>
                <Text style={styles.stateTitle} accessibilityRole="header">
                  Couldn&apos;t load insights
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={retry}
                  style={styles.action}
                >
                  <Text style={styles.actionText}>Try again</Text>
                </Pressable>
              </View>
            )}
            data={rollup.data}
            isLoading={rollup.isLoading || identity.data === undefined}
            isError={rollup.isError && rollup.data === undefined}
            onRetry={() => void rollup.refetch()}
            range={range}
            onRangeChange={setRange}
            isWideDesktop={isWideDesktop}
            listingType={identity.data?.listingType}
          />
        </View>
      </ScrollView>
    </View>
  );
};

export const ListingInsightsScreen: React.FC<ListingInsightsScreenProps> = ({
  rollup,
  allowed = false,
  ...props
}) => {
  if (rollup !== undefined) {
    return (
      <LegacyListingInsightsScreen
        {...props}
        identity={props.identity}
        rollup={rollup}
      />
    );
  }
  return <TrafficListingInsightsScreen {...props} allowed={allowed} />;
};

const styles = StyleSheet.create({
  host: { flex: 1, minWidth: 0 },
  topBar: { paddingHorizontal: space[4], paddingTop: space[2] },
  scroll: { flex: 1, minWidth: 0 },
  scrollContent: {
    paddingHorizontal: space[4],
    paddingTop: space[6],
    paddingBottom: space[7] * 4,
  },
  content: {
    width: "100%",
    maxWidth: 1320,
    alignSelf: "center",
    gap: space[6],
  },
  headingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: space[4],
  },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: color.text3,
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
  },
  listingTitle: {
    color: color.text1,
    fontSize: type.title.fontSize,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.fontWeight,
    marginTop: space[1],
  },
  intro: {
    color: color.text2,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    marginTop: space[1],
  },
  status: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[1],
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space[2],
  },
  actionText: {
    color: color.accent,
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
  },
  refreshFailure: {
    borderWidth: 1,
    borderColor: color.lineStrong,
    padding: space[4],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[7],
  },
  dashboardLoading: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    textAlign: "center",
    marginTop: space[2],
  },
  stateBody: {
    color: color.text2,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    textAlign: "center",
    marginTop: space[1],
  },
});

export default ListingInsightsScreen;
