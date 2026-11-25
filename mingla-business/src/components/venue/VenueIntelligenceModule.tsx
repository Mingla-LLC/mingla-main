/**
 * ORCH-1186-B — Venue Overview → Intelligence dashboard.
 *
 * Repurposes the venue suite's Overview slot (the listing recap relocated to
 * Settings by Leg 1) into a read-only intelligence dashboard sourced ONLY from
 * real data: orders (via the owner-only venue_intelligence_overview RPC, which
 * buckets hour/day in the venue's LOCAL timezone and revenue per-currency) and
 * ai_signal_scores. No fabrication (Constitution #9): every insufficient-data
 * tile shows an honest empty state with NO numbers/$/bars. Organic engagement
 * is forward-only, exact-venue data with independent states. All money via
 * utils/currency (Constitution #10).
 *
 * Self-scroll contract (SPEC §4.5): owns its own ScrollView with the shared
 * bottom-nav clearance — the shell does NOT wrap it (moduleSelfScrolls).
 *
 * Design: GLASS-ON-DARK GlassCard tiles (Android opaque fallback is automatic
 * via GlassChrome — no hand-rolled translucent Android fills). CSS-<View> bars
 * only, NO charting library (SPEC NG-6). See SPEC §4.5 + the DESIGN section.
 */
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  radius,
  color,
  space,
  type,
  materials,
} from "../../constants/designSystem";
import { venueSignalLabel } from "../../constants/venueSignals";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useVenueReservationMetrics } from "../../hooks/useVenueReservationMetrics";
import { useVenueOrganicInsights } from "../../hooks/useVenueOrganicInsights";
import { useVenueOrderMetrics } from "../../hooks/useVenueOrderMetrics";
import { useAuth } from "../../context/AuthContext";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { buildComposeAudienceHref } from "../../utils/composeAudienceHref";
import {
  formatCurrencyRound,
} from "../../utils/currency";
import { Flag } from "lucide-react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { useShareNetworkState } from "../ui/useShareNetworkState";
import {
  BAR_CONTEXT,
  BAR_INACTIVE,
  BARROW_FLOOR_PCT,
  hourLabel,
  INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS,
  joinLabels,
  minBucketIndices,
  normalizeBars,
  SPARKLINE_FLOOR_PCT,
  weekdayLabel,
  WEEKDAY_TICKS,
} from "./venueIntelligence";
import { useVenueIntelligence } from "../../hooks/useVenueIntelligence";
// Issue #1735 G-14 — the ONE additive Site-check cross-link tile (renders
// nothing until a persisted site report exists; no existing tile modified).
import { SiteCheckOverviewTile } from "./insights/SiteCheckOverviewTile";
import { VENUE_SCROLL_NAV_CLEARANCE } from "./venueShellScroll";
import {
  VenueReservationRefreshAnnouncement,
  VenueReservationsCard,
  type VenueReservationRefreshStatus,
} from "./VenueReservationsCard";
import {
  captureBusinessVenueOrganicInsightsRefreshed,
  captureBusinessVenueOrganicInsightsViewed,
  captureBusinessVenueReservationsRefreshed,
  captureBusinessVenueReservationsViewed,
} from "../../analytics/businessAnalyticsEvents";
import { VenueOrganicEngagementSection } from "./VenueOrganicEngagementSection";
import { venueTimezoneLabel } from "./venueTimezoneLabel";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

const SPARKLINE_RECENT_BAR_COUNT = 5;
const HOUR_TICKS: { hour: number; label: string }[] = [
  { hour: 0, label: "12a" },
  { hour: 6, label: "6a" },
  { hour: 12, label: "12p" },
  { hour: 18, label: "6p" },
];

export interface VenueIntelligenceModuleProps {
  brandId: string | null;
  /**
   * META-ORCH-1255(C) D-D — the venue_listings row in scope. When present the
   * RPC resolves THIS venue's place signals + availability-config timezone
   * (the legacy brands.place_pool_id is inert for new venues). Optional
   * (default null) so pinned render tests compile/behave unchanged; the
   * server then falls back to single-venue resolution.
   */
  venueId?: string | null;
  /**
   * #4420 B8 — content that scrolls WITH the dashboard, above it (the venue
   * page's Local reviews panel and the reservations invitation). It used to sit
   * in the page's fixed header stack, where a long reviews list took the whole
   * screen and nothing below it could be reached.
   */
  header?: React.ReactNode;
  /**
   * #4490 click-test D12 — reservation metrics (covers, no-show rate) show
   * only when the venue takes table reservations. Default true keeps every
   * existing caller unchanged.
   */
  showReservationMetrics?: boolean;
}

export function VenueIntelligenceModule({
  brandId,
  venueId = null,
  header = null,
  showReservationMetrics = true,
}: VenueIntelligenceModuleProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthReady } = useAuth();
  const online = useShareNetworkState();
  const query = useVenueIntelligence(brandId, venueId);
  const data = query.data ?? null;
  const reservationsQuery = useVenueReservationMetrics(
    brandId,
    venueId,
    isAuthReady,
  );
  const organicQuery = useVenueOrganicInsights(brandId, venueId, isAuthReady);
  const orderMetricsQuery = useVenueOrderMetrics(brandId, venueId, isAuthReady);
  const trackedReservationScope = useRef<string | null>(null);
  const trackedOrganicScope = useRef<string | null>(null);
  const [reservationRefreshStatus, setReservationRefreshStatus] =
    useState<VenueReservationRefreshStatus>(null);
  const [organicRefreshStatus, setOrganicRefreshStatus] = useState<
    "updating" | "success" | "error" | null
  >(null);

  useEffect(() => {
    const scope =
      brandId !== null && venueId !== null ? `${brandId}:${venueId}` : null;
    if (
      scope === null ||
      trackedReservationScope.current === scope ||
      reservationsQuery.data?.authorized !== true
    ) {
      return;
    }
    trackedReservationScope.current = scope;
    captureBusinessVenueReservationsViewed(
      reservationsQuery.data.bySource.some((source) => source.reservations > 0),
    );
  }, [
    brandId,
    reservationsQuery.data,
    venueId,
  ]);

  useEffect(() => {
    const scope =
      brandId !== null && venueId !== null ? `${brandId}:${venueId}` : null;
    const organic = organicQuery.data;
    if (
      scope === null ||
      trackedOrganicScope.current === scope ||
      organic?.authorized !== true
    ) {
      return;
    }
    trackedOrganicScope.current = scope;
    captureBusinessVenueOrganicInsightsViewed(
      organic.pageViews > 0 ||
        organic.menuOpens > 0 ||
        organic.reservationStarts > 0,
      organic.windowComplete,
    );
  }, [brandId, organicQuery.data, venueId]);

  // ORCH-1190 #7 — "Message your guests" blast entry, RELOCATED from Settings
  // (ORCH-1186-D) to a top-of-Overview button. REUSE ONLY: deep-link into the
  // EXISTING marketing composer with this venue's brand audience pre-selected
  // (`?audience=brand:{brandId}`) — no new composer / send path / audience kind
  // (I-PROPOSED-1186-D-BLAST-REUSE-ONLY). Build via buildComposeAudienceHref so
  // the `?audience={kind}:{id}` contract stays guarded (I-PROPOSED-BU). Manager-
  // plus gated for parity with the other venue-suite action affordances.
  const { rank } = useCurrentBrandRole(brandId);
  const canBlast = rank >= MANAGER_PLUS_RANK;
  const handleBlast = useCallback((): void => {
    if (brandId === null) return;
    router.push(buildComposeAudienceHref("brand", brandId) as never);
  }, [brandId, router]);

  const contentContainerStyle = useMemo(
    () => [
      styles.scroll,
      { paddingBottom: insets.bottom + VENUE_SCROLL_NAV_CLEARANCE },
    ],
    [insets.bottom],
  );

  const refreshControl = (
    <RefreshControl
      refreshing={query.isFetching && !query.isLoading}
      onRefresh={() => {
        setReservationRefreshStatus("updating");
        setOrganicRefreshStatus("updating");
        void Promise.allSettled([
          query.refetch(),
          reservationsQuery.refetch(),
          organicQuery.refetch(),
          orderMetricsQuery.refetch(),
        ]).then((results) => {
          const reservationResult = results[1];
          const succeeded =
            reservationResult.status === "fulfilled" &&
            !reservationResult.value.isError &&
            reservationResult.value.data?.authorized === true;
          captureBusinessVenueReservationsRefreshed(
            succeeded ? "success" : "error",
          );
          setReservationRefreshStatus(succeeded ? "success" : "error");
          const organicResult = results[2];
          const organicSucceeded =
            organicResult.status === "fulfilled" &&
            !organicResult.value.isError &&
            organicResult.value.data?.authorized === true;
          const organicPartial =
            organicResult.status === "fulfilled" &&
            organicResult.value.data?.authorized === true;
          const organicStatus = organicSucceeded
            ? "success"
            : organicPartial
              ? "partial"
              : "error";
          captureBusinessVenueOrganicInsightsRefreshed(organicStatus);
          setOrganicRefreshStatus(
            organicStatus === "success" ? "success" : "error",
          );
        });
      }}
      tintColor={color.accent}
    />
  );

  // ── Loading (no tiles, no header) ──────────────────────────────────────────
  if (query.isLoading) {
    return (
      <View style={styles.host}>
        {header}
        <View style={styles.centerFill}>
          <ActivityIndicator color={color.accent} />
        </View>
      </View>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <ScrollView
        style={styles.host}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {header}
        <VenueReservationRefreshAnnouncement status={reservationRefreshStatus} />
        <GlassCard variant="base" padding={space[6]}>
          <Flag size={24} color={color.danger} />
          <Text style={styles.tileTitle}>Couldn&apos;t load your insights</Text>
          <Text style={styles.bodySm}>Pull to refresh or try again.</Text>
          <View style={styles.actionRow}>
            <Button
              label="Try again"
              variant="secondary"
              size="md"
              onPress={() => {
                void query.refetch();
              }}
            />
          </View>
        </GlassCard>
      </ScrollView>
    );
  }

  // ── E-0: not a venue (no brand / no place_pool intelligence) ───────────────
  // The RPC returns order_count 0 + empty signals for a brand with no place_pool;
  // the dedicated E-0 card is shown only when there is no brand at all (the suite
  // mounts this only for claimed brands, so place_pool absence still gets the
  // full dashboard with honest empties).
  if (brandId === null || data === null) {
    return (
      <ScrollView
        style={styles.host}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {header}
        <VenueReservationRefreshAnnouncement status={reservationRefreshStatus} />
        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.tileTitle}>No venue insights yet</Text>
          <Text style={styles.bodySm}>
            Add your venue to start seeing how it performs on Mingla.
          </Text>
          <View style={styles.actionRow}>
            <Button
              label="Add your venue"
              variant="primary"
              size="md"
              leadingIcon="sparkle"
              onPress={() => router.push("/venue/create" as never)}
            />
          </View>
        </GlassCard>
      </ScrollView>
    );
  }

  const {
    orderCount,
    resolvedTimezone,
    tzConfidence,
    brandDefaultCurrency,
    revenueByCurrency,
    rev7dByCurrency,
    revenueTrend,
    hours,
    days,
    signalScores,
  } = data;

  const enoughForTimeBuckets =
    orderCount >= INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS;
  const remaining = INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS - orderCount;
  const remainingLabel = `${remaining} more ${remaining === 1 ? "order" : "orders"}`;

  // Revenue
  const lifetimeNet = revenueByCurrency[brandDefaultCurrency] ?? 0;
  const sevenDayNet = rev7dByCurrency[brandDefaultCurrency] ?? 0;
  const otherCurrencies = Object.keys(revenueByCurrency).filter(
    (k) => k !== brandDefaultCurrency && (revenueByCurrency[k] ?? 0) > 0,
  );
  const hasMixedCurrency = otherCurrencies.length > 0;

  // Derived bar data — plain (pure, cheap) computations, NOT hooks: this code
  // runs after the early returns above, so hooks here would violate the Rules of
  // Hooks. normalizeBars/minBucketIndices are O(n) over <=24 elements.
  // 30-day sparkline heights
  const trendBars = normalizeBars(revenueTrend.days.map((d) => d.netCents));

  // Slow hours
  const hourCounts = hours.map((h) => h.orders);
  const hourBars = normalizeBars(hourCounts);
  const slowHourIdx = minBucketIndices(hourCounts);
  const slowHourLabel = joinLabels(slowHourIdx.map((i) => hourLabel(i)));

  // Slow days
  const dayCounts = days.map((d) => d.orders);
  const dayBars = normalizeBars(dayCounts);
  const slowDayIdx = minBucketIndices(dayCounts);
  const slowDayLabel = joinLabels(slowDayIdx.map((i) => weekdayLabel(i)));

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {header}
      <VenueReservationRefreshAnnouncement status={reservationRefreshStatus} />
      <Text style={styles.srOnly} accessibilityLiveRegion="polite">
        {organicRefreshStatus === "updating"
          ? "Updating organic engagement…"
          : organicRefreshStatus === "success"
            ? "Organic engagement updated"
            : organicRefreshStatus === "error"
              ? "Couldn't refresh organic engagement"
              : ""}
      </Text>
      {/* ORCH-1190 #7 — Message your guests (relocated from Settings). Top of
          Overview, manager-plus gated, reuse-only composer deep-link. */}
      {canBlast && brandId !== null ? (
        <View style={styles.blastRow}>
          {/* #4420 (round-3 item 13) — a compact secondary action with
              breathing room, not a full-width primary block. */}
          <Button
            label="Message your guests"
            onPress={handleBlast}
            variant="secondary"
            size="sm"
            leadingIcon="send"
            accessibilityLabel="Message your guests"
            testID="venue-overview-message-guests"
          />
        </View>
      ) : null}

      {/* Header strip */}
      <View style={styles.headerStrip}>
        <Text style={styles.headerTitle}>Venue insights</Text>
        <View
          style={styles.tzChip}
          accessibilityLabel={`Times shown in ${venueTimezoneLabel(resolvedTimezone)}`}
        >
          <Text style={styles.tzChipText} numberOfLines={1}>
            {`times in ${venueTimezoneLabel(resolvedTimezone)}`}
          </Text>
        </View>
      </View>

      <View style={styles.column}>
        {/* Tile A — Revenue */}
        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.tileTitle}>Revenue</Text>
          {orderCount === 0 ? (
            <Text style={styles.bodySm}>
              When people book or buy on Mingla, your revenue and trends show up
              here.
            </Text>
          ) : (
            <>
              <View style={styles.metricRow}>
                <View>
                  <Text style={styles.metricCap}>LIFETIME</Text>
                  <Text style={styles.statValue}>
                    {formatCurrencyRound(lifetimeNet, brandDefaultCurrency, true)}
                  </Text>
                </View>
                <View style={styles.metricRight}>
                  <Text style={styles.metricCap}>LAST 7 DAYS</Text>
                  <Text style={styles.metricSecondary}>
                    {formatCurrencyRound(sevenDayNet, brandDefaultCurrency, true)}
                  </Text>
                </View>
              </View>
              {trendBars.length > 0 ? (
                <View
                  style={styles.sparklineRow}
                  accessibilityRole="image"
                  accessibilityLabel="30-day revenue trend."
                >
                  {trendBars.map((heightPct, i) => {
                    const isRecent =
                      i >= trendBars.length - SPARKLINE_RECENT_BAR_COUNT;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.sparklineBar,
                          {
                            height: `${Math.max(heightPct, SPARKLINE_FLOOR_PCT)}%`,
                            backgroundColor: isRecent ? color.accent : BAR_INACTIVE,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              ) : null}
              {hasMixedCurrency ? (
                <Text style={styles.footnote}>
                  {`Showing ${brandDefaultCurrency} only — you also have sales in ${otherCurrencies.join(", ")}.`}
                </Text>
              ) : null}
            </>
          )}
        </GlassCard>

        {showReservationMetrics ? (
          <VenueReservationsCard
            query={reservationsQuery}
            onRetry={() => {
              void reservationsQuery.refetch();
            }}
          />
        ) : null}

        {orderMetricsQuery.data?.authorized === false ? null : (
          <GlassCard
            variant="elevated"
            padding={space[6]}
            testID="venue-orders-overview-card"
          >
            <Text style={styles.tileTitle}>Venue orders</Text>
            {orderMetricsQuery.data !== undefined ? (
              <>
                <Text style={styles.statValue}>
                  {orderMetricsQuery.data.orders30d}
                </Text>
                <Text style={styles.bodySm}>orders in the last 30 days</Text>
                {orderMetricsQuery.data.window.thinLabel !== null ? (
                  <Text style={styles.footnote}>
                    {orderMetricsQuery.data.window.thinLabel}
                  </Text>
                ) : null}
                {Object.entries(orderMetricsQuery.data.salesCents30d).map(
                  ([currency, cents]) => (
                    <Text key={`sales:${currency}`} style={styles.metricSecondary}>
                      {`${currency} sales ${formatCurrencyRound(cents, currency, true)}`}
                    </Text>
                  ),
                )}
                {Object.entries(orderMetricsQuery.data.tipsCents30d).map(
                  ([currency, cents]) => (
                    <Text key={`tips:${currency}`} style={styles.bodySm}>
                      {`${currency} tips ${formatCurrencyRound(cents, currency, true)}`}
                    </Text>
                  ),
                )}
                {Object.values(orderMetricsQuery.data.moneyStateByCurrency).some(
                  (state) => state === "partial_refund_unallocated",
                ) ? (
                  <Text style={styles.caveatFootnote}>
                    Some money is hidden because a partial refund has no recorded
                    split. Order counts remain exact.
                  </Text>
                ) : null}
                {!online ? (
                  <Text style={styles.footnote}>Offline — showing saved order numbers.</Text>
                ) : orderMetricsQuery.isFetching ? (
                  <Text style={styles.footnote}>Updating order numbers…</Text>
                ) : null}
                <View style={styles.actionRow}>
                  <Button
                    label="See order insights"
                    variant="secondary"
                    size="md"
                    onPress={() => {
                      if (venueId === null) return;
                      router.push(
                        `/venue/${venueId}?module=insights&instrument=orders` as never,
                      );
                    }}
                    accessibilityLabel="See venue order insights"
                  />
                </View>
              </>
            ) : orderMetricsQuery.isLoading ? (
              <View style={styles.orderStatusRow} accessibilityRole="progressbar">
                <ActivityIndicator color={color.accent} />
                <Text style={styles.bodySm}>Loading venue orders…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.bodySm}>
                  {!online
                    ? "Reconnect to load venue order numbers."
                    : "Couldn't load venue order numbers. Your orders are safe."}
                </Text>
                <View style={styles.actionRow}>
                  <Button
                    label="Try again"
                    variant="secondary"
                    size="md"
                    onPress={() => {
                      void orderMetricsQuery.refetch();
                    }}
                  />
                </View>
              </>
            )}
          </GlassCard>
        )}

        <VenueOrganicEngagementSection
          data={organicQuery.data ?? null}
          isLoading={organicQuery.isLoading}
          isError={organicQuery.isError}
          isFetching={organicQuery.isFetching}
          onRetry={() => {
            void organicQuery.refetch();
          }}
        />

        {/* Tile B — Slow hours */}
        <GlassCard variant="base" padding={space[6]}>
          <Text style={styles.tileTitle}>Slow hours</Text>
          {enoughForTimeBuckets ? (
            <>
              <View
                style={styles.barRow}
                accessibilityRole="image"
                accessibilityLabel={`Orders by hour. Quietest around ${slowHourLabel}.`}
              >
                {hourBars.map((heightPct, i) => (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      {
                        height: `${Math.max(heightPct, BARROW_FLOOR_PCT)}%`,
                        backgroundColor: slowHourIdx.includes(i)
                          ? color.accent
                          : BAR_CONTEXT,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.tickRow}>
                {HOUR_TICKS.map((t) => (
                  <Text key={t.hour} style={styles.tick}>
                    {t.label}
                  </Text>
                ))}
              </View>
              <Text style={styles.takeaway}>{`Quietest around ${slowHourLabel}.`}</Text>
              {tzConfidence !== "iana" ? (
                <Text style={styles.caveatFootnote}>
                  Times approximate — set your venue timezone for precision.
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.insufficientTitle}>Not enough data yet</Text>
              <Text style={styles.bodySm}>
                {`We'll show your slow hours once you've had a bit more activity — about ${remainingLabel} to go.`}
              </Text>
            </>
          )}
        </GlassCard>

        {/* Tile C — Slow days */}
        <GlassCard variant="base" padding={space[6]}>
          <Text style={styles.tileTitle}>Slow days</Text>
          {enoughForTimeBuckets ? (
            <>
              <View
                style={styles.barRowDays}
                accessibilityRole="image"
                accessibilityLabel={`Orders by day. Slowest day ${slowDayLabel}.`}
              >
                {dayBars.map((heightPct, i) => (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      {
                        height: `${Math.max(heightPct, BARROW_FLOOR_PCT)}%`,
                        backgroundColor: slowDayIdx.includes(i)
                          ? color.accent
                          : BAR_CONTEXT,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.tickRow}>
                {WEEKDAY_TICKS.map((t, i) => (
                  <Text key={i} style={styles.tick}>
                    {t}
                  </Text>
                ))}
              </View>
              <Text style={styles.takeaway}>{`Slowest day: ${slowDayLabel}.`}</Text>
            </>
          ) : (
            <>
              <Text style={styles.insufficientTitle}>Not enough data yet</Text>
              <Text style={styles.bodySm}>
                {`We'll show your slow days once you've had a bit more activity — about ${remainingLabel} to go.`}
              </Text>
            </>
          )}
        </GlassCard>

        {/* Tile D — Which moments you win */}
        <GlassCard variant="base" padding={space[6]}>
          <Text style={styles.tileTitle}>Which moments you win</Text>
          {signalScores.length > 0 ? (
            <>
              <Text style={styles.subtitle}>
                Where Mingla recommends you most. Improve these in Settings.
              </Text>
              <View style={styles.scoreList}>
                {signalScores.map((s) => (
                  <View
                    key={s.id}
                    style={styles.scoreRow}
                    accessibilityLabel={`${venueSignalLabel(s.id)}: ${s.score} out of 100`}
                  >
                    <Text style={styles.scoreLabel} numberOfLines={1}>
                      {venueSignalLabel(s.id)}
                    </Text>
                    <View style={styles.scoreBarTrack}>
                      <View
                        style={[
                          styles.scoreBarFill,
                          { width: `${Math.max(0, Math.min(100, s.score))}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.scoreValue}>{s.score}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              {/* META-ORCH-1290 D-5 — the "Recommend me" self-run is retired;
                  scores are admin-approval-gated now. Honest locked copy. */}
              <Text style={styles.insufficientTitle}>Not scored yet</Text>
              <Text style={styles.bodySm}>
                Your vibe scores appear once an admin approves your listing — they
                decide which explorer feeds you show up in.
              </Text>
            </>
          )}
        </GlassCard>

        {/* Issue #1735 G-14 — Site check cross-link tile (additive; renders
            ONLY when a persisted report exists — never an empty nudge). */}
        <SiteCheckOverviewTile brandId={brandId} venueId={venueId} />

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  centerFill: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: space[9],
  },
  column: {
    gap: space[4],
  },
  srOnly: {
    width: 1,
    height: 1,
    opacity: 0,
    position: "absolute",
  },

  // Header
  headerStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space[4],
  },
  headerTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    flexShrink: 1,
  },
  tzChip: {
    backgroundColor: materials.onPhoto.solidFill,
    borderColor: color.lineStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: space[2],
    marginLeft: space[2],
    maxWidth: "55%",
  },
  tzChipText: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "500",
    color: color.text2,
  },

  // Tile text
  tileTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  subtitle: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginTop: space[1],
  },
  bodySm: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginTop: space[1],
  },
  insufficientTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
    marginTop: space[2],
  },
  takeaway: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginTop: space[2],
  },
  footnote: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: 4,
  },
  caveatFootnote: {
    // Required honesty caveat — uses secondary (never tertiary) per D-4.
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginTop: 4,
  },

  // Revenue metrics
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: space[4],
  },
  metricRight: {
    alignItems: "flex-end",
  },
  metricCap: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },
  statValue: {
    fontSize: type.stat.fontSize,
    lineHeight: type.stat.lineHeight,
    fontWeight: type.stat.fontWeight,
    letterSpacing: type.stat.letterSpacing,
    color: color.text1,
  },
  metricSecondary: {
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: type.row.fontWeight,
    color: color.text1,
  },

  // Sparkline (30-day revenue)
  sparklineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 56,
    marginTop: space[4],
  },
  sparklineBar: {
    flex: 1,
    borderRadius: 2,
  },

  // Bar rows (slow hours 24 / slow days 7)
  barRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 72,
    marginTop: space[4],
  },
  barRowDays: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    height: 72,
    marginTop: space[4],
  },
  bar: {
    flex: 1,
    borderRadius: 2,
  },
  tickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  tick: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },

  // Score bars (signal effectiveness)
  scoreList: {
    marginTop: space[2],
    gap: space[2],
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  scoreLabel: {
    width: 110,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
  scoreBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.fill.tabOn,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: color.accent,
  },
  scoreValue: {
    width: 28,
    textAlign: "right",
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },

  // Shared
  actionRow: {
    marginTop: space[4],
    flexDirection: "row",
  },
  orderStatusRow: {
    minHeight: 44,
    marginTop: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  // ORCH-1190 #7 — top-of-Overview blast button row.
  blastRow: {
    flexDirection: "row",
    marginBottom: space[5],
  },
});

export default VenueIntelligenceModule;
