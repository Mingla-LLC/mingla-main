import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { formatCount, formatCurrency } from "../../utils/currency";
import {
  ListingInsightsUnavailableError,
  type ListingInsightsIdentity,
  type ListingInsightsRollup,
  type ListingInsightsSource,
} from "../../services/listingInsightsService";
import {
  captureBusinessListingInsightsOpened,
  captureBusinessListingInsightsRefreshed,
  type BusinessListingInsightsEntryPoint,
} from "../../analytics/businessAnalyticsEvents";
import { GlassCard } from "../ui/GlassCard";
import { TopBar } from "../ui/TopBar";

const SOURCE_ORDER: {
  key: ListingInsightsSource;
  label: string;
}[] = [
  { key: "ad", label: "Ads" },
  { key: "search", label: "Search / SEO" },
  { key: "organic", label: "Mingla discovery" },
  { key: "social", label: "Social" },
  { key: "direct", label: "Direct link" },
];

const introFor = (identity: ListingInsightsIdentity): string =>
  `See how customers found and chose this ${identity.listingType}.`;

const CurrencyValues: React.FC<{
  values: Record<string, number>;
  suffix: string;
}> = ({ values, suffix }) => (
  <>
    {Object.entries(values).map(([currency, cents]) => (
      <Text key={currency} style={styles.valueLine}>
        {`${formatCurrency(cents, currency, true)} ${suffix}`}
      </Text>
    ))}
  </>
);

const Skeleton = (): React.ReactElement => (
  <View style={styles.columns} accessibilityElementsHidden>
    <View style={[styles.skeleton, styles.skeletonTall]} testID="listing-proof-skeleton" />
    <View style={[styles.skeleton, styles.skeletonTall]} testID="listing-source-skeleton" />
  </View>
);

interface ListingInsightsScreenProps {
  identity: UseQueryResult<ListingInsightsIdentity, Error>;
  rollup: UseQueryResult<ListingInsightsRollup, Error>;
  entryPoint: BusinessListingInsightsEntryPoint;
  onBack: () => void;
  onBackToListings: () => void;
  forceUnavailable?: boolean;
  accessError?: boolean;
  onRetryAccess?: () => void;
}

export const ListingInsightsScreen: React.FC<ListingInsightsScreenProps> = ({
  identity,
  rollup,
  entryPoint,
  onBack,
  onBackToListings,
  forceUnavailable = false,
  accessError = false,
  onRetryAccess,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
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
      identity.data.listingType,
      entryPoint,
      rollup.data.minglaDroveCount > 0,
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
      identity.data.listingType,
      succeeded ? "success" : "error",
    );
    setRefreshFailure(!succeeded);
    setAnnouncement(succeeded ? "Insights updated" : "Couldn't refresh insights");
    setIsRefreshing(false);
  }, [identity.data, isRefreshing, rollup]);

  const unavailable =
    forceUnavailable ||
    identity.error instanceof ListingInsightsUnavailableError ||
    rollup.error instanceof ListingInsightsUnavailableError ||
    rollup.data?.authorized === false;
  const title = identity.data?.title ?? "Listing insights";

  const topBar = (
    <View style={styles.topBar}>
      <TopBar leftKind="back" title="Insights" onBack={onBack} rightSlot={null} />
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
    (rollup.isError && rollup.data === undefined && identity.data !== undefined);
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
          <Text style={styles.stateBody}>Check your connection and try again.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (accessError) {
                onRetryAccess?.();
              } else if (identity.isError) {
                void identity.refetch();
              } else {
                void rollup.refetch();
              }
            }}
            style={styles.action}
          >
            <Text style={styles.actionText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const data =
    rollup.data?.authorized === true ? rollup.data : undefined;
  const hasSources =
    data?.bySource.some(
      (source) =>
        source.customers > 0 || Object.keys(source.valueCents).length > 0,
    ) ?? false;

  const body = (
    <View style={styles.content}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>LISTING INSIGHTS</Text>
          <Text style={styles.listingTitle} accessibilityRole="header">
            {title}
          </Text>
          {identity.data === undefined ? null : (
            <Text style={styles.intro}>{introFor(identity.data)}</Text>
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
            accessibilityLabel={isRefreshing ? "Updating insights" : "Refresh insights"}
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
      {refreshFailure || (rollup.isError && data !== undefined) ? (
        <View style={styles.refreshFailure}>
          <Text style={styles.stateTitle}>Couldn&apos;t refresh insights</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refresh()}
            style={styles.action}
          >
            <Text style={styles.actionText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {data === undefined ? (
        <Skeleton />
      ) : (
        <View style={[styles.columns, isWideDesktop && styles.columnsWide]}>
          <GlassCard variant="elevated" padding={spacing.lg} style={styles.card}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Customers Mingla drove
            </Text>
            <Text style={styles.helper}>
              Bookings, RSVPs and paid booking value completed through Mingla for
              this listing.
            </Text>
            <Text style={styles.window}>ALL TIME</Text>
            <Text style={styles.heroCount}>
              {`Mingla drove ${formatCount(data.minglaDroveCount)} ${
                data.minglaDroveCount === 1 ? "customer" : "customers"
              } for this listing`}
            </Text>
            {Object.keys(data.valueCents).length === 0 ? (
              <Text style={styles.empty}>No paid booking value yet</Text>
            ) : (
              <CurrencyValues values={data.valueCents} suffix="booking value" />
            )}
          </GlassCard>
          <GlassCard variant="elevated" padding={spacing.lg} style={styles.card}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Where customers came from
            </Text>
            <Text style={styles.window}>All time</Text>
            <Text style={styles.helper}>
              A customer can appear in more than one source if they booked through
              different paths.
            </Text>
            {!hasSources ? (
              <View style={styles.emptyBlock}>
                <Text style={styles.empty}>No source mix yet</Text>
                <Text style={styles.helper}>
                  Sources appear after customers book or RSVP for this listing
                  through Mingla.
                </Text>
              </View>
            ) : (
              <View style={styles.sourceList}>
                {SOURCE_ORDER.map(({ key, label }) => {
                  const source = data.bySource.find((row) => row.source === key);
                  if (source === undefined) return null;
                  return (
                    <View key={key} style={styles.sourceRow}>
                      <Text style={styles.sourceLabel}>{label}</Text>
                      <Text style={styles.sourceCount}>
                        {`${formatCount(source.customers)} ${
                          source.customers === 1 ? "customer" : "customers"
                        }`}
                      </Text>
                      <CurrencyValues
                        values={source.valueCents}
                        suffix="booking value"
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </GlassCard>
        </View>
      )}
    </View>
  );

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
              tintColor={accent.warm}
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
  topBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  scroll: { flex: 1, minWidth: 0 },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl * 4,
  },
  content: { width: "100%", maxWidth: 1320, alignSelf: "center", gap: spacing.lg },
  headingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  listingTitle: {
    color: textTokens.primary,
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    marginTop: spacing.xs,
  },
  intro: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    marginTop: spacing.xs,
  },
  status: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.xs,
  },
  columns: { gap: spacing.md, minWidth: 0 },
  columnsWide: { flexDirection: "row", alignItems: "flex-start" },
  card: { flex: 1, minWidth: 0 },
  sectionTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  helper: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.xs,
  },
  window: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    marginTop: spacing.md,
  },
  heroCount: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    marginTop: spacing.xs,
  },
  valueLine: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    marginTop: spacing.xs,
  },
  empty: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  emptyBlock: { marginTop: spacing.sm },
  sourceList: { gap: spacing.sm, marginTop: spacing.md },
  sourceRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    paddingTop: spacing.sm,
  },
  sourceLabel: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  sourceCount: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  actionText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
  refreshFailure: {
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  stateTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  stateBody: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  skeleton: {
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  skeletonTall: { height: 280 },
});

export default ListingInsightsScreen;
