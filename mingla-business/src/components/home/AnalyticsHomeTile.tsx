import React, { useCallback, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from "react-native-svg";
import {
  accent,
  durations,
  radius,
  spacing,
  text as textTokens,
  trafficAnalytics,
  typography,
} from "../../constants/designSystem";
import { formatCurrencyRound } from "../../utils/currency";
import type { BrandTrafficRollup } from "../../services/trafficAnalyticsService";
import {
  formatTrafficDelta,
  trafficDeltaAccessibilityLabel,
  trafficDeltaTone,
  visibleDelta,
  visitToPaidRate,
} from "../../utils/trafficAnalyticsMath";
import type { BrandMinglaDroveRollup } from "../../services/brandAnalyticsService";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { LegacyAnalyticsHomeTile } from "./LegacyAnalyticsHomeTile";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AnalyticsHomeTileProps {
  data: BrandTrafficRollup | BrandMinglaDroveRollup | undefined;
  isLoading: boolean;
  isError: boolean;
  onPress: () => void;
  onRetry?: () => void;
  /** Marks the new #4037 contract while the RPC is still loading. */
  contract?: "traffic";
}

interface TrafficAnalyticsHomeTileProps extends Omit<
  AnalyticsHomeTileProps,
  "data"
> {
  data: BrandTrafficRollup | undefined;
}

const isTrafficRollup = (
  data: AnalyticsHomeTileProps["data"],
): data is BrandTrafficRollup =>
  data !== undefined && "totals" in data && "captureStartedAt" in data;

const captureDate = (value: string | null): string | null => {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
};

const customers = (value: number): string =>
  `${value.toLocaleString("en-GB")} ${value === 1 ? "customer" : "customers"}`;

const amountFor = (
  values: Record<string, number>,
  primaryCurrency: string | null,
): { currency: string | null; cents: number } => {
  if (primaryCurrency !== null) {
    return { currency: primaryCurrency, cents: values[primaryCurrency] ?? 0 };
  }
  const first = Object.entries(values)[0];
  return first === undefined
    ? { currency: null, cents: 0 }
    : { currency: first[0], cents: first[1] };
};

const money = (currency: string | null, cents: number): string =>
  currency === null
    ? "No paid booking value yet"
    : formatCurrencyRound(cents, currency, true);

const CompactSparkline: React.FC<{
  points: BrandTrafficRollup["daily"];
  total: number;
}> = ({ points, total }) => {
  const geometry = useMemo(() => {
    const values = points.map((point) => point.pageViews);
    const max = Math.max(...values, 1);
    const divisor = Math.max(values.length - 1, 1);
    const chart = values.map((value, index) => ({
      x: (index / divisor) * 300,
      y: 58 - (value / max) * 50,
    }));
    const line = chart
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
      .join(" ");
    const last = chart[chart.length - 1] ?? { x: 0, y: 58 };
    const highestIndex = values.indexOf(max);
    const highestDay = points[highestIndex]?.day;
    return {
      line,
      area: chart.length === 0 ? "" : `${line} L${last.x},62 L0,62 Z`,
      last,
      max,
      highestDay,
    };
  }, [points]);
  const highestDate =
    geometry.highestDay === undefined
      ? null
      : new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${geometry.highestDay}T00:00:00Z`));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Visits per day, 30 days, ${total.toLocaleString("en-GB")} total, highest ${geometry.max.toLocaleString("en-GB")}${highestDate === null ? "" : ` on ${highestDate}`}`}
      style={styles.sparkline}
    >
      <Svg width="100%" height={64} viewBox="0 0 300 64">
        <Defs>
          <SvgLinearGradient id="homeTraffic" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={accent.warm} stopOpacity="0.32" />
            <Stop offset="1" stopColor={accent.warm} stopOpacity="0.02" />
          </SvgLinearGradient>
        </Defs>
        <Path d={geometry.area} fill="url(#homeTraffic)" />
        <Path
          d={geometry.line}
          fill="none"
          stroke={accent.warm}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle
          cx={geometry.last.x}
          cy={geometry.last.y}
          r="4"
          fill={accent.warm}
          stroke={textTokens.primary}
          strokeWidth="2"
        />
      </Svg>
    </View>
  );
};

const TrafficAnalyticsHomeTile: React.FC<TrafficAnalyticsHomeTileProps> = ({
  data,
  isLoading,
  isError,
  onPress,
  onRetry,
}) => {
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotionNative();
  const toggleExpanded = useCallback((): void => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          durations.normal,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
    }
    setExpanded((value) => !value);
  }, [reduceMotion]);

  const valid = data?.authorized === true && !isError;
  const hasTraffic =
    valid && data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const value = valid
    ? amountFor(data.totals.valueMinglaBrought, data.totals.primaryCurrency)
    : { currency: null, cents: 0 };
  const priorValue = valid
    ? amountFor(data.prior.valueMinglaBrought, value.currency)
    : { currency: null, cents: 0 };
  const delta = valid
    ? visibleDelta(
        value.cents,
        priorValue.cents,
        data.totals.bookings,
        data.prior.bookings,
        5,
      )
    : null;
  const visitRate = valid
    ? visitToPaidRate(data.totals.bookings, data.totals.pageViews)
    : null;
  const date = valid ? captureDate(data.captureStartedAt) : null;
  const summary = valid
    ? hasTraffic
      ? `${money(value.currency, value.cents)} · ${customers(data.totals.minglaCustomers)} · ${data.totals.pageViews.toLocaleString("en-GB")} visits · 30 days`
      : `${customers(data.totals.minglaCustomers)} · collecting visits${date === null ? "" : ` since ${date}`}`
    : "Analytics unavailable";
  const accessibilityLabel = expanded
    ? `Open Analytics, ${summary}`
    : "Expand analytics, Bookings through Mingla";

  return (
    <View style={styles.root} testID="analytics-home-tile-root">
      <Pressable
        onPress={expanded ? onPress : toggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={expanded ? undefined : { expanded: false }}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        testID="analytics-home-tile"
      >
        <GlassCard
          variant="base"
          style={[styles.card, expanded && styles.cardExpanded]}
        >
          <View style={styles.header}>
            <View style={styles.iconWrap} accessible={false}>
              <Icon name="chart" size={20} color={accent.warm} />
            </View>
            <Text style={styles.headerEyebrow}>ANALYTICS</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Bookings through Mingla
          </Text>
          {isLoading ? (
            <View
              style={styles.collapsedSkeleton}
              testID="analytics-home-loading"
            >
              <Skeleton width="78%" height={18} />
            </View>
          ) : (
            <Text style={styles.summary} numberOfLines={2}>
              {summary}
            </Text>
          )}

          {expanded ? (
            isLoading ? (
              <View style={styles.skeletons}>
                <Skeleton width="46%" height={36} />
                <Skeleton width="100%" height={64} />
              </View>
            ) : valid ? (
              <View style={styles.expandedBody}>
                <Text style={styles.eyebrow}>
                  BOOKINGS THROUGH MINGLA · 30 DAYS
                </Text>
                <View style={styles.valueRow}>
                  <Text style={styles.bigValue}>
                    {money(value.currency, value.cents)}
                  </Text>
                  {delta === null ? null : (
                    <View
                      style={[
                        styles.deltaPill,
                        trafficDeltaTone(delta) === "neutral" &&
                          styles.deltaPillNeutral,
                      ]}
                      accessibilityLabel={trafficDeltaAccessibilityLabel(delta)}
                      testID={
                        trafficDeltaTone(delta) === "neutral"
                          ? "home-traffic-delta-neutral"
                          : "home-traffic-delta-positive"
                      }
                    >
                      <Text
                        style={[
                          styles.deltaText,
                          trafficDeltaTone(delta) === "neutral" &&
                            styles.deltaTextNeutral,
                        ]}
                      >
                        {formatTrafficDelta(delta)}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.sentence}>
                  <Text style={styles.sentenceStrong}>
                    {customers(data.totals.minglaCustomers)}
                  </Text>
                  {` found you through Mingla, out of ${data.totals.customers.toLocaleString("en-GB")} who booked.`}
                </Text>
                {hasTraffic ? (
                  <CompactSparkline
                    points={data.daily}
                    total={data.totals.pageViews}
                  />
                ) : (
                  <Text style={styles.collecting}>
                    {`Collecting${date === null ? "" : ` since ${date}`}. Visits show here as people open your pages.`}
                  </Text>
                )}
                <View style={styles.miniRow}>
                  <View style={styles.miniStat}>
                    <Text style={styles.miniValue}>
                      {hasTraffic
                        ? data.totals.pageViews.toLocaleString("en-GB")
                        : "Collecting"}
                    </Text>
                    <Text style={styles.miniLabel}>Page visits</Text>
                  </View>
                  <View style={styles.miniStat}>
                    <Text style={styles.miniValue}>
                      {hasTraffic
                        ? data.totals.buttonTaps.toLocaleString("en-GB")
                        : "—"}
                    </Text>
                    <Text style={styles.miniLabel}>Button taps</Text>
                  </View>
                  <View style={styles.miniStat}>
                    <Text style={styles.miniValue}>
                      {hasTraffic && visitRate !== null
                        ? `${visitRate.toFixed(1)}%`
                        : "—"}
                    </Text>
                    <Text style={styles.miniLabel}>Visit → paid</Text>
                  </View>
                </View>
                <View style={styles.footer}>
                  <Text style={styles.topPage} numberOfLines={1}>
                    {data.pages[0] === undefined
                      ? "Top page: Collecting"
                      : `Top page: ${data.pages[0].title}`}
                  </Text>
                  <Text style={styles.open}>Open analytics ›</Text>
                </View>
              </View>
            ) : (
              <View style={styles.errorWrap}>
                <Text style={styles.error}>
                  Couldn&apos;t load your 30-day snapshot
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry analytics"
                  onPress={(event) => {
                    event?.stopPropagation?.();
                    onRetry?.();
                  }}
                  style={({ pressed }) => [
                    styles.retry,
                    pressed && styles.pressed,
                  ]}
                  testID="analytics-home-retry"
                >
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            )
          ) : null}
        </GlassCard>

        {expanded ? null : (
          <View
            style={styles.chevronSlot}
            accessible={false}
            pointerEvents="none"
          >
            <Icon name="chevD" size={18} color={textTokens.secondary} />
          </View>
        )}
      </Pressable>

      {expanded ? (
        <Pressable
          onPress={toggleExpanded}
          hitSlop={{ top: 13, right: 13, bottom: 13, left: 13 }}
          accessibilityRole="button"
          accessibilityLabel="Collapse analytics"
          accessibilityState={{ expanded: true }}
          style={styles.chevronSlot}
          testID="analytics-home-tile-chevron"
        >
          <Icon name="chevU" size={18} color={textTokens.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { position: "relative" },
  pressable: { minHeight: 44 },
  pressed: { opacity: 0.72 },
  card: {},
  cardExpanded: { minHeight: 420 },
  chevronSlot: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  headerEyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  summary: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.xs,
    paddingRight: spacing.lg,
    fontVariant: ["tabular-nums"],
  },
  collapsedSkeleton: { marginTop: spacing.sm },
  skeletons: { gap: spacing.md, marginTop: spacing.lg },
  expandedBody: { marginTop: spacing.lg },
  eyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  bigValue: {
    color: textTokens.primary,
    fontSize: typography.display.fontSize,
    lineHeight: typography.display.lineHeight,
    fontWeight: typography.display.fontWeight,
    fontVariant: ["tabular-nums"],
  },
  deltaPill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: trafficAnalytics.positiveDeltaTint,
  },
  deltaText: {
    color: trafficAnalytics.positiveDelta,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
  },
  deltaPillNeutral: {
    backgroundColor: trafficAnalytics.neutralDeltaTint,
  },
  deltaTextNeutral: {
    color: trafficAnalytics.neutralDelta,
  },
  sentence: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    marginTop: spacing.sm,
  },
  sentenceStrong: { color: textTokens.primary, fontWeight: "700" },
  sparkline: { height: 64, marginTop: spacing.md },
  collecting: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.md,
  },
  miniRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  miniStat: { flex: 1, minWidth: 90 },
  miniValue: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  miniLabel: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  topPage: {
    flex: 1,
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  open: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
  error: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  errorWrap: { alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.md },
  retry: {
    minHeight: 44,
    minWidth: 72,
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: accent.border,
    paddingHorizontal: spacing.md,
  },
  retryText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
});

export const AnalyticsHomeTile: React.FC<AnalyticsHomeTileProps> = (props) => {
  if (props.contract !== "traffic" && !isTrafficRollup(props.data)) {
    return (
      <LegacyAnalyticsHomeTile
        data={props.data as BrandMinglaDroveRollup | undefined}
        isLoading={props.isLoading}
        isError={props.isError}
        onPress={props.onPress}
      />
    );
  }
  return (
    <TrafficAnalyticsHomeTile
      {...props}
      data={isTrafficRollup(props.data) ? props.data : undefined}
    />
  );
};

export default AnalyticsHomeTile;
