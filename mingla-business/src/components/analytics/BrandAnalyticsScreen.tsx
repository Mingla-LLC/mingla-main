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
  useBrandMinglaDroveRollup,
  useBrandRegularsRollup,
} from "../../hooks/useBrandAnalytics";
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
import { CustomersMinglaDroveSection } from "./CustomersMinglaDroveSection";
import { RegularsSection } from "./RegularsSection";
import { CustomerPatternsSection } from "./CustomerPatternsSection";

interface BrandAnalyticsScreenProps {
  brand: Brand;
  rank: number;
  roleLoading: boolean;
  entryPoint: BusinessAnalyticsEntryPoint;
  onBack: () => void;
  onBackToHome: () => void;
}

export const BrandAnalyticsScreen: React.FC<BrandAnalyticsScreenProps> = ({
  brand,
  rank,
  roleLoading,
  entryPoint,
  onBack,
  onBackToHome,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const callerEnabled = !roleLoading && !isScannerOnlyRank(rank);
  const totals = useBrandMinglaDroveRollup(brand.id, callerEnabled);
  const regulars = useBrandRegularsRollup(brand.id, callerEnabled);
  const patterns = useBrandCustomerPatternsRollup(brand.id, callerEnabled);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const openedTracked = useRef(false);

  useEffect(() => {
    openedTracked.current = false;
    setRefreshFailed(false);
  }, [brand.id]);

  useEffect(() => {
    if (
      openedTracked.current ||
      roleLoading ||
      (totals.isLoading && !totals.isError && totals.data === undefined)
    ) {
      return;
    }
    openedTracked.current = true;
    captureBusinessAnalyticsOpened(
      entryPoint,
      totals.data?.authorized === true && totals.data.minglaDrove30d > 0,
    );
  }, [
    entryPoint,
    roleLoading,
    totals.data,
    totals.isError,
    totals.isLoading,
  ]);

  const refreshAll = useCallback(async (): Promise<void> => {
    if (isManualRefreshing) return;
    setIsManualRefreshing(true);
    setRefreshFailed(false);
    const settled = await Promise.allSettled([
      totals.refetch(),
      regulars.refetch(),
      patterns.refetch(),
    ]);
    const successes = settled.filter(
      (result) =>
        result.status === "fulfilled" &&
        !result.value.isError &&
        result.value.data?.authorized === true,
    ).length;
    const result: BusinessAnalyticsRefreshResult =
      successes === 3 ? "success" : successes === 0 ? "error" : "partial";
    setRefreshFailed(successes < 3);
    captureBusinessAnalyticsRefreshed(result);
    setIsManualRefreshing(false);
  }, [isManualRefreshing, patterns, regulars, totals]);

  const unauthorized =
    isScannerOnlyRank(rank) ||
    totals.data?.authorized === false ||
    regulars.data?.authorized === false ||
    patterns.data?.authorized === false;
  const hasCachedRefetchFailure =
    (totals.isError && totals.data !== undefined) ||
    (regulars.isError && regulars.data !== undefined) ||
    (patterns.isError && patterns.data !== undefined);

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
          <Text style={styles.intro} accessibilityRole="header">
            {`See how customers find and choose ${brand.displayName}.`}
          </Text>
          <View accessibilityLiveRegion="polite">
            {isManualRefreshing ? (
              <Text style={styles.updating}>Updating…</Text>
            ) : null}
          </View>
        </View>
        {isWideDesktop ? (
          <Pressable
            onPress={refreshAll}
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
        <RefreshFailureBanner onRetry={refreshAll} />
      ) : null}
      <View style={[styles.proofRow, isWideDesktop && styles.proofRowWide]}>
        <View style={styles.proofColumn}>
          {totals.data?.authorized === true ? (
            <CustomersMinglaDroveSection data={totals.data} />
          ) : totals.isError ? (
            <AnalyticsModuleError
              title="Couldn't load customer analytics"
              onRetry={() => void totals.refetch()}
            />
          ) : (
            <AnalyticsModuleSkeleton testID="analytics-totals-loading" />
          )}
        </View>
        <View style={styles.regularsColumn}>
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
      </View>
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
              onRefresh={refreshAll}
            />
          )
        }
      >
        {body}
      </ScrollView>
    </View>
  );
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
  intro: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
  },
  updating: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.xs,
  },
  proofRow: { gap: spacing.xl },
  proofRowWide: { flexDirection: "row", alignItems: "flex-start" },
  proofColumn: { flex: 2, minWidth: 0 },
  regularsColumn: { flex: 1, minWidth: 0 },
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
