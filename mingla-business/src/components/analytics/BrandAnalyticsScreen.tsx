import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../types/brand";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import {
  useBrandCustomerPatternsRollup,
  useBrandRegularsRollup,
} from "../../hooks/useBrandAnalytics";
import {
  useBrandTrafficRollup,
  useEntityTrafficRollup,
} from "../../hooks/useTrafficAnalytics";
import type {
  TrafficPageRow,
  TrafficRange,
} from "../../services/trafficAnalyticsService";
import { isScannerOnlyRank } from "../../utils/navTabGate";
import {
  captureBusinessAnalyticsOpened,
  captureBusinessAnalyticsRefreshed,
  type BusinessAnalyticsEntryPoint,
  type BusinessAnalyticsRefreshResult,
} from "../../analytics/businessAnalyticsEvents";
import { TopBar } from "../ui/TopBar";
import {
  AnalyticsModuleError,
  AnalyticsModuleSkeleton,
  RefreshFailureBanner,
} from "./AnalyticsModuleState";
import { TrafficAnalyticsDashboard } from "./TrafficAnalyticsDashboard";
import { RegularsSection } from "./RegularsSection";
import { CustomerPatternsSection } from "./CustomerPatternsSection";
import { LegacyBrandAnalyticsScreen } from "./LegacyBrandAnalyticsScreen";

interface BrandAnalyticsScreenProps {
  brand: Brand;
  rank: number;
  roleLoading: boolean;
  authReady?: boolean;
  entryPoint: BusinessAnalyticsEntryPoint;
  onBack: () => void;
  onBackToHome: () => void;
  onOpenListingInsights?: (id: string) => void;
}

interface TrafficBrandAnalyticsScreenProps extends BrandAnalyticsScreenProps {
  authReady: boolean;
}

const samePage = (left: TrafficPageRow, right: TrafficPageRow): boolean =>
  left.entityType === right.entityType && left.entityId === right.entityId;

const TrafficBrandAnalyticsScreen: React.FC<
  TrafficBrandAnalyticsScreenProps
> = ({
  brand,
  rank,
  roleLoading,
  authReady,
  entryPoint,
  onBack,
  onBackToHome,
  onOpenListingInsights,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const callerEnabled = authReady && !roleLoading && !isScannerOnlyRank(rank);
  const [range, setRange] = useState<TrafficRange>("30d");
  const traffic = useBrandTrafficRollup(brand.id, range, callerEnabled);
  const regulars = useBrandRegularsRollup(brand.id, callerEnabled);
  const patterns = useBrandCustomerPatternsRollup(brand.id, callerEnabled);
  const [selectedPage, setSelectedPage] = useState<TrafficPageRow | null>(null);
  const selectedTraffic = useEntityTrafficRollup(
    selectedPage?.entityType ?? null,
    selectedPage?.entityId ?? null,
    range,
    callerEnabled && selectedPage !== null,
  );
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshAnnouncement, setRefreshAnnouncement] = useState<
    string | null
  >(null);
  const openedTracked = useRef(false);

  useEffect(() => {
    openedTracked.current = false;
    setSelectedPage(null);
    setRefreshFailed(false);
    setRefreshAnnouncement(null);
  }, [brand.id]);

  useEffect(() => {
    const pages = traffic.data?.pages ?? [];
    if (pages.length === 0) {
      setSelectedPage(null);
      return;
    }
    setSelectedPage((current) =>
      current !== null && pages.some((page) => samePage(page, current))
        ? current
        : pages[0]!,
    );
  }, [traffic.data?.pages]);

  useEffect(() => {
    if (
      openedTracked.current ||
      roleLoading ||
      (traffic.isLoading && !traffic.isError && traffic.data === undefined)
    ) {
      return;
    }
    openedTracked.current = true;
    captureBusinessAnalyticsOpened(
      entryPoint,
      traffic.data?.authorized === true &&
        traffic.data.totals.minglaCustomers > 0,
    );
  }, [
    entryPoint,
    roleLoading,
    traffic.data,
    traffic.isError,
    traffic.isLoading,
  ]);

  const refreshAll = useCallback(async (): Promise<void> => {
    if (isManualRefreshing) return;
    setIsManualRefreshing(true);
    setRefreshFailed(false);
    setRefreshAnnouncement("Updating analytics");
    const jobs: Promise<unknown>[] = [
      traffic.refetch(),
      regulars.refetch(),
      patterns.refetch(),
    ];
    if (selectedPage !== null) jobs.push(selectedTraffic.refetch());
    const settled = await Promise.allSettled(jobs);
    const successes = settled.filter(
      (result) =>
        result.status === "fulfilled" &&
        typeof result.value === "object" &&
        result.value !== null &&
        "isError" in result.value &&
        result.value.isError === false &&
        "data" in result.value &&
        typeof result.value.data === "object" &&
        result.value.data !== null &&
        "authorized" in result.value.data &&
        result.value.data.authorized === true,
    ).length;
    const result: BusinessAnalyticsRefreshResult =
      successes === jobs.length
        ? "success"
        : successes === 0
          ? "error"
          : "partial";
    setRefreshFailed(successes < jobs.length);
    captureBusinessAnalyticsRefreshed(result);
    setRefreshAnnouncement(
      result === "success"
        ? "Analytics updated"
        : result === "partial"
          ? "Analytics partly updated"
          : "Analytics couldn't be updated",
    );
    setIsManualRefreshing(false);
  }, [
    isManualRefreshing,
    patterns,
    regulars,
    selectedPage,
    selectedTraffic,
    traffic,
  ]);

  const unauthorized =
    isScannerOnlyRank(rank) ||
    traffic.data?.authorized === false ||
    regulars.data?.authorized === false ||
    patterns.data?.authorized === false;
  const hasCachedRefetchFailure =
    (traffic.isError && traffic.data !== undefined) ||
    (regulars.isError && regulars.data !== undefined) ||
    (patterns.isError && patterns.data !== undefined) ||
    (selectedTraffic.isError && selectedTraffic.data !== undefined);

  const topBar = (
    <View style={styles.topBarWrap}>
      <TopBar
        leftKind="back"
        title="Analytics"
        onBack={onBack}
        rightSlot={null}
      />
    </View>
  );

  if (unauthorized) {
    return (
      <View style={styles.host}>
        {topBar}
        <View style={styles.authorization} testID="analytics-unauthorized">
          <Text style={styles.authorizationTitle} accessibilityRole="header">
            Analytics unavailable
          </Text>
          <Text style={styles.authorizationBody}>
            You don&apos;t have permission to view analytics for this brand.
          </Text>
          <Pressable
            onPress={onBackToHome}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.authorizationAction,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.authorizationActionText}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const body = (
    <View style={styles.content} testID="brand-analytics-content">
      <View style={styles.introRow}>
        <View style={styles.introCopy}>
          <Text style={styles.screenTitle} accessibilityRole="header">
            Analytics
          </Text>
          <Text
            style={styles.intro}
          >{`How people find and choose ${brand.displayName}.`}</Text>
          <View
            accessibilityLiveRegion="polite"
            testID="analytics-refresh-announcement"
          >
            {refreshAnnouncement === null ? null : (
              <Text style={styles.updating}>{refreshAnnouncement}</Text>
            )}
          </View>
        </View>
        {isWideDesktop ? (
          <Pressable
            onPress={() => void refreshAll()}
            disabled={isManualRefreshing}
            accessibilityRole="button"
            accessibilityLabel={
              isManualRefreshing ? "Updating analytics" : "Refresh analytics"
            }
            style={({ pressed }) => [
              styles.refreshButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.refreshText}>
              {isManualRefreshing ? "Updating…" : "Refresh"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {refreshFailed || hasCachedRefetchFailure ? (
        <RefreshFailureBanner onRetry={() => void refreshAll()} />
      ) : null}
      <TrafficAnalyticsDashboard
        data={traffic.data}
        isLoading={traffic.isLoading}
        isError={traffic.isError && traffic.data === undefined}
        onRetry={() => void traffic.refetch()}
        range={range}
        onRangeChange={setRange}
        isWideDesktop={isWideDesktop}
        pages={traffic.data?.pages}
        selectedPage={selectedPage}
        onSelectPage={setSelectedPage}
        selectedPageData={selectedTraffic.data}
        selectedPageLoading={selectedTraffic.isLoading}
        selectedPageError={
          selectedTraffic.isError && selectedTraffic.data === undefined
        }
        onRetrySelectedPage={() => void selectedTraffic.refetch()}
        onOpenSelectedListing={
          selectedPage?.entityId === null ||
          selectedPage === null ||
          onOpenListingInsights === undefined
            ? undefined
            : () => onOpenListingInsights(selectedPage.entityId!)
        }
      />
      <View
        style={[styles.existingRow, isWideDesktop && styles.existingRowWide]}
      >
        <View style={styles.existingColumn}>
          {regulars.data?.authorized === true ? (
            <RegularsSection data={regulars.data} />
          ) : regulars.isError ? (
            <AnalyticsModuleError
              title="Couldn't load regulars"
              onRetry={() => void regulars.refetch()}
            />
          ) : (
            <AnalyticsModuleSkeleton testID="analytics-regulars-loading" />
          )}
        </View>
        <View style={styles.patternsColumn}>
          {patterns.data?.authorized === true ? (
            <CustomerPatternsSection
              data={patterns.data}
              isWideDesktop={isWideDesktop}
            />
          ) : patterns.isError ? (
            <AnalyticsModuleError
              title="Couldn't load customer patterns"
              onRetry={() => void patterns.refetch()}
            />
          ) : (
            <AnalyticsModuleSkeleton testID="analytics-patterns-loading" />
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.host}>
      {topBar}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        horizontal={false}
        refreshControl={
          isWideDesktop ? undefined : (
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={() => void refreshAll()}
            />
          )
        }
      >
        {body}
      </ScrollView>
    </View>
  );
};

export const BrandAnalyticsScreen: React.FC<BrandAnalyticsScreenProps> = (
  props,
) => {
  if (props.authReady === undefined) {
    return <LegacyBrandAnalyticsScreen {...props} />;
  }
  return <TrafficBrandAnalyticsScreen {...props} authReady={props.authReady} />;
};

const styles = StyleSheet.create({
  host: { flex: 1, minWidth: 0 },
  topBarWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  scroll: { flex: 1, minWidth: 0 },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl * 4,
  },
  content: { width: "100%", maxWidth: 1320, alignSelf: "center", gap: spacing.xl },
  introRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  introCopy: { flex: 1, minWidth: 0 },
  screenTitle: {
    color: textTokens.primary,
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
  },
  intro: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    marginTop: spacing.xs,
  },
  updating: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.xs,
  },
  existingRow: { gap: spacing.xl },
  existingRowWide: { flexDirection: "row", alignItems: "flex-start" },
  existingColumn: { flex: 1, minWidth: 0 },
  patternsColumn: { flex: 2, minWidth: 0 },
  refreshButton: {
    minHeight: 44,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
  pressed: { opacity: 0.65 },
  authorization: {
    flex: 1,
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  authorizationTitle: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    textAlign: "center",
  },
  authorizationBody: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  authorizationAction: {
    minHeight: 44,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  authorizationActionText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
});

export default BrandAnalyticsScreen;
