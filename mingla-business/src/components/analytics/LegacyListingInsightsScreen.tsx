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
  radius,
  space,
  color,
  type,
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
import { listingInsightsIntro } from "./listingInsightsIntro";

const SOURCE_ORDER: {
  key: ListingInsightsSource;
  label: string;
}[] = [
  { key: "mingla_app", label: "Mingla app" },
  { key: "mingla_ads", label: "Mingla ads" },
  { key: "ad", label: "Ads" },
  { key: "search", label: "Search / SEO" },
  { key: "organic", label: "Mingla discovery" },
  { key: "social", label: "Social" },
  { key: "own_links", label: "Your own links" },
  { key: "direct_unknown", label: "Direct or unknown" },
  { key: "direct", label: "Direct link" },
];

const introFor = (identity: ListingInsightsIdentity): string =>
  listingInsightsIntro(identity.listingType);

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
    <View
      style={[styles.skeleton, styles.skeletonTall]}
      testID="listing-proof-skeleton"
    />
    <View
      style={[styles.skeleton, styles.skeletonTall]}
      testID="listing-source-skeleton"
    />
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

export const LegacyListingInsightsScreen: React.FC<
  ListingInsightsScreenProps
> = ({
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
      identity.data.listingType === "venue"
        ? "event"
        : identity.data.listingType,
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
    rollup.error instanceof ListingInsightsUnavailableError ||
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

  const data = rollup.data?.authorized === true ? rollup.data : undefined;
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
          <GlassCard
            variant="elevated"
            padding={space[6]}
            style={styles.card}
          >
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Bookings through Mingla
            </Text>
            <Text style={styles.helper}>
              Bookings, RSVPs and paid booking value completed through Mingla
              for this listing.
            </Text>
            <Text style={styles.window}>ALL TIME</Text>
            <Text style={styles.heroCount}>
              {`${formatCount(data.minglaDroveCount)} ${
                data.minglaDroveCount === 1 ? "customer" : "customers"
              } booked or RSVP’d through Mingla for this listing`}
            </Text>
            {Object.keys(data.valueCents).length === 0 ? (
              <Text style={styles.empty}>No paid booking value yet</Text>
            ) : (
              <CurrencyValues values={data.valueCents} suffix="booking value" />
            )}
          </GlassCard>
          <GlassCard
            variant="elevated"
            padding={space[6]}
            style={styles.card}
          >
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Booking sources
            </Text>
            <Text style={styles.window}>All time</Text>
            <Text style={styles.helper}>
              A customer can appear in more than one source if they booked
              through different paths.
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
                  const source = data.bySource.find(
                    (row) => row.source === key,
                  );
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
              tintColor={color.accent}
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
  columns: { gap: space[4], minWidth: 0 },
  columnsWide: { flexDirection: "row", alignItems: "flex-start" },
  card: { flex: 1, minWidth: 0 },
  sectionTitle: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  helper: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[1],
  },
  window: {
    color: color.text3,
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    marginTop: space[4],
  },
  heroCount: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    marginTop: space[1],
  },
  valueLine: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    marginTop: space[1],
  },
  empty: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    marginTop: space[2],
  },
  emptyBlock: { marginTop: space[2] },
  sourceList: { gap: space[2], marginTop: space[4] },
  sourceRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: space[2],
  },
  sourceLabel: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  sourceCount: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  actionText: {
    color: color.accent,
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
  },
  refreshFailure: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space[4],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[7],
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
  skeleton: {
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  skeletonTall: { height: 280 },
});

export default LegacyListingInsightsScreen;
