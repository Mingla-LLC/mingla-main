/**
 * ORCH-1186-B — Venue Overview → Intelligence dashboard.
 *
 * Repurposes the venue suite's Overview slot (the listing recap relocated to
 * Settings by Leg 1) into a read-only intelligence dashboard sourced ONLY from
 * real data: orders (via the owner-only venue_intelligence_overview RPC, which
 * buckets hour/day in the venue's LOCAL timezone and revenue per-currency) and
 * ai_signal_scores. No fabrication (Constitution #9): every insufficient-data
 * tile shows an honest empty state with NO numbers/$/bars; the three roadmap
 * tiles are labeled "Coming soon" and carry NO data. All money via
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
import React, { useMemo } from "react";
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
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { venueSignalLabel } from "../../constants/venueSignals";
import {
  formatCurrencyRound,
} from "../../utils/currency";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
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
import { VENUE_SCROLL_NAV_CLEARANCE } from "./venueShellScroll";

const SPARKLINE_RECENT_BAR_COUNT = 5;
const HOUR_TICKS: { hour: number; label: string }[] = [
  { hour: 0, label: "12a" },
  { hour: 6, label: "6a" },
  { hour: 12, label: "12p" },
  { hour: 18, label: "6p" },
];

export interface VenueIntelligenceModuleProps {
  brandId: string | null;
}

export function VenueIntelligenceModule({
  brandId,
}: VenueIntelligenceModuleProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = useVenueIntelligence(brandId);
  const data = query.data ?? null;

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
        void query.refetch();
      }}
      tintColor={accent.warm}
    />
  );

  // ── Loading (no tiles, no header) ──────────────────────────────────────────
  if (query.isLoading) {
    return (
      <View style={styles.host}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={accent.warm} />
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
        <GlassCard variant="base" padding={spacing.lg}>
          <Icon name="flag" size={24} color={semantic.error} />
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
        <GlassCard variant="elevated" padding={spacing.lg}>
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
      {/* Header strip */}
      <View style={styles.headerStrip}>
        <Text style={styles.headerTitle}>Venue insights</Text>
        <View
          style={styles.tzChip}
          accessibilityLabel={`Times shown in ${resolvedTimezone}`}
        >
          <Text style={styles.tzChipText} numberOfLines={1}>
            {`times in ${resolvedTimezone}`}
          </Text>
        </View>
      </View>

      <View style={styles.column}>
        {/* Tile A — Revenue */}
        <GlassCard variant="elevated" padding={spacing.lg}>
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
                            backgroundColor: isRecent ? accent.warm : BAR_INACTIVE,
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

        {/* Tile B — Slow hours */}
        <GlassCard variant="base" padding={spacing.lg}>
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
                          ? accent.warm
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
        <GlassCard variant="base" padding={spacing.lg}>
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
                          ? accent.warm
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
        <GlassCard variant="base" padding={spacing.lg}>
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
              <Text style={styles.insufficientTitle}>Not scored yet</Text>
              <Text style={styles.bodySm}>
                We haven&apos;t scored this venue yet. Add details in Settings and
                run &apos;Recommend me&apos; to see where you win.
              </Text>
            </>
          )}
        </GlassCard>

        {/* Coming-soon section divider */}
        <Text style={styles.comingSoonDivider}>Coming soon</Text>

        {/* Tile E — Busy hours (foot traffic) */}
        <ComingSoonTile
          title="Busy hours"
          description="See when people actually visit, powered by live foot-traffic data."
        />
        {/* Tile F — Page views & taps */}
        <ComingSoonTile
          title="Page views & taps"
          description="How many people viewed your venue page and tapped through."
        />
        {/* Tile G — Signal → bookings */}
        <ComingSoonTile
          title="Signal to bookings"
          description="Which moments actually turn into bookings."
        />
      </View>
    </ScrollView>
  );
}

/**
 * Roadmap tile — title + "Coming soon" pill + one-line description ONLY.
 * Renders NO numbers, NO currency, NO bars (Constitution #9 / §9 no-fab grep).
 */
function ComingSoonTile({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.ReactElement {
  return (
    <GlassCard
      variant="base"
      padding={spacing.md}
      style={styles.comingSoonCard}
    >
      <View
        style={styles.comingSoonHeader}
        accessibilityLabel={`${title}. Coming soon. ${description}`}
      >
        <Text style={styles.comingSoonTitle}>{title}</Text>
        <View style={styles.comingSoonPill}>
          <Text style={styles.comingSoonPillText}>COMING SOON</Text>
        </View>
      </View>
      <Text style={styles.comingSoonDesc}>{description}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  centerFill: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.xxl,
  },
  column: {
    gap: spacing.md,
  },

  // Header
  headerStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    flexShrink: 1,
  },
  tzChip: {
    backgroundColor: glass.tint.badge.idle,
    borderColor: glass.border.badge,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    marginLeft: spacing.sm,
    maxWidth: "55%",
  },
  tzChipText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
  },

  // Tile text
  tileTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  subtitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  bodySm: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  insufficientTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  takeaway: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  footnote: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 4,
  },
  caveatFootnote: {
    // Required honesty caveat — uses secondary (never tertiary) per D-4.
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: 4,
  },

  // Revenue metrics
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: spacing.md,
  },
  metricRight: {
    alignItems: "flex-end",
  },
  metricCap: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  statValue: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: typography.statValue.fontWeight,
    letterSpacing: typography.statValue.letterSpacing,
    color: textTokens.primary,
  },
  metricSecondary: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: typography.bodyLg.fontWeight,
    color: textTokens.primary,
  },

  // Sparkline (30-day revenue)
  sparklineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 56,
    marginTop: spacing.md,
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
    marginTop: spacing.md,
  },
  barRowDays: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    height: 72,
    marginTop: spacing.md,
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
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
    color: textTokens.tertiary,
  },

  // Score bars (signal effectiveness)
  scoreList: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  scoreLabel: {
    width: 110,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  scoreBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  scoreBarFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
  },
  scoreValue: {
    width: 28,
    textAlign: "right",
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },

  // Coming soon
  comingSoonDivider: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  comingSoonCard: {
    opacity: 0.92,
  },
  comingSoonHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  comingSoonTitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: typography.bodyLg.fontWeight,
    color: textTokens.secondary,
    flexShrink: 1,
  },
  comingSoonPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    marginLeft: spacing.sm,
  },
  comingSoonPillText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
    color: accent.warm,
  },
  comingSoonDesc: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },

  // Shared
  actionRow: {
    marginTop: spacing.md,
    flexDirection: "row",
  },
});

export default VenueIntelligenceModule;
