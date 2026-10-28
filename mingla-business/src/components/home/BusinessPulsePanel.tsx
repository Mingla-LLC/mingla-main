import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
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
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  trafficAnalytics,
  typography,
} from "../../constants/designSystem";
import { useBrandFollowerSummary } from "../../hooks/useBrandFollowerSummary";
import { useBrandPayoutScreen } from "../../hooks/useBrandPayoutScreen";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useBrandTrafficRollup } from "../../hooks/useTrafficAnalytics";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Trip } from "../../services/tripsService";
import type { LiveCardMetrics } from "./LiveOfferingCard";
import type { UpcomingItem } from "../../utils/upcomingBuilder";
import {
  businessPulseDesktopSpans,
  businessPulseVisibility,
  selectStartsSoon,
  startsSoonCountdown,
} from "../../utils/businessPulse";
import {
  currencyCodeOrNull,
  formatCount,
  formatCurrency,
  formatCurrencyRound,
} from "../../utils/currency";
import {
  formatTrafficDelta,
  trafficDeltaTone,
  visibleDelta,
  visitToPaidRate,
} from "../../utils/trafficAnalyticsMath";
import { tripToLiveEvent } from "../../utils/tripToLiveEvent";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface BusinessPulsePanelProps {
  brandId: string;
  defaultCurrency: string | null;
  canViewPayments: boolean;
  liveItems: UpcomingItem[];
  upcomingItems: UpcomingItem[];
  liveMetricsById: Record<string, LiveCardMetrics>;
  onScanPress: (id: string) => void;
  onOpenOffering: (item: UpcomingItem) => void;
}

const offeringName = (item: UpcomingItem): string => {
  const view = item.kind === "trip"
    ? tripToLiveEvent(item.source as Trip)
    : item.source as LiveEvent;
  return view?.name?.trim() || "Untitled";
};

const payoutDate = (value: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));

const trafficGeometry = (values: readonly number[], height: number) => {
  const max = Math.max(...values, 1);
  const divisor = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => ({
    x: (index / divisor) * 300,
    y: height - 4 - (value / max) * (height - 12),
  }));
  const line = points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${point.x},${point.y}`
  ).join(" ");
  const last = points[points.length - 1] ?? { x: 0, y: height - 4 };
  return {
    line,
    area: points.length === 0
      ? ""
      : `${line} L${last.x},${height} L0,${height} Z`,
    last,
  };
};

const TrafficSparkline: React.FC<{ values: readonly number[] }> = ({ values }) => {
  const geometry = useMemo(() => trafficGeometry(values, 64), [values]);
  return (
    <View style={styles.sparkline} accessible={false}>
      <Svg width="100%" height={64} viewBox="0 0 300 64">
        <Defs>
          <SvgLinearGradient id="pulseTrafficArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={accent.warm} stopOpacity="0.32" />
            <Stop offset="1" stopColor={accent.warm} stopOpacity="0.02" />
          </SvgLinearGradient>
        </Defs>
        <Path d={geometry.area} fill="url(#pulseTrafficArea)" />
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

const FollowerSparkline: React.FC<{ values: readonly number[] }> = ({ values }) => {
  const geometry = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const divisor = Math.max(values.length - 1, 1);
    const points = values.map((value, index) => ({
      x: (index / divisor) * 300,
      y: range === 0 ? 23 : 40 - ((value - min) / range) * 34,
    }));
    return {
      line: points.map((point, index) =>
        `${index === 0 ? "M" : "L"}${point.x},${point.y}`
      ).join(" "),
      last: points[points.length - 1] ?? { x: 0, y: 23 },
    };
  }, [values]);
  return (
    <View style={styles.followerSparkline} accessible={false}>
      <Svg width="100%" height={46} viewBox="0 0 300 46">
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
          r="3"
          fill={accent.warm}
          stroke={textTokens.primary}
          strokeWidth="2"
        />
      </Svg>
    </View>
  );
};

const Progress: React.FC<{ value: number; live?: boolean }> = ({
  value,
  live = false,
}) => (
  <View style={styles.progressTrack}>
    <View
      style={[
        styles.progressFill,
        live && styles.liveProgressFill,
        { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` },
      ]}
    />
  </View>
);

const LiveDot: React.FC<{ reduceMotion: boolean }> = ({ reduceMotion }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      style={[
        styles.liveDot,
        {
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.45],
          }),
          transform: [{
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.55],
            }),
          }],
        },
      ]}
    />
  );
};

const LivePill: React.FC<{
  reduceMotion: boolean;
  startsSoon: boolean;
  label: string;
}> = ({ reduceMotion, startsSoon, label }) => (
  <View style={[styles.livePill, startsSoon && styles.soonPill]}>
    {startsSoon ? <View style={styles.soonDot} /> : (
      <LiveDot reduceMotion={reduceMotion} />
    )}
    <Text style={[styles.livePillText, startsSoon && styles.soonPillText]}>
      {label}
    </Text>
  </View>
);

const LiveBandCard: React.FC<{
  item: UpcomingItem;
  metrics: LiveCardMetrics;
  reduceMotion: boolean;
  startsSoon: boolean;
  isWideDesktop: boolean;
  showIdentity?: boolean;
  pageCount?: string;
  onScanPress: (id: string) => void;
  onOpenOffering: (item: UpcomingItem) => void;
}> = ({
  item,
  metrics,
  reduceMotion,
  startsSoon,
  isWideDesktop,
  showIdentity = true,
  pageCount,
  onScanPress,
  onOpenOffering,
}) => {
  const rsvp = metrics.mode === "rsvp" && !startsSoon;
  const label = startsSoon && item.startAtUtc !== null
    ? `STARTS IN ${startsSoonCountdown(item.startAtUtc)}`
    : "LIVE NOW";
  const action = (
    <Pressable
      onPress={() => startsSoon ? onOpenOffering(item) : onScanPress(item.id)}
      accessibilityRole="button"
      accessibilityLabel={startsSoon
        ? `Open ${offeringName(item)}`
        : `${rsvp ? "Scan guests" : "Scan tickets"} for ${offeringName(item)}`}
      style={[
        styles.liveAction,
        startsSoon && styles.soonAction,
        !isWideDesktop && styles.liveActionNarrow,
      ]}
    >
      <Text style={[styles.liveActionText, startsSoon && styles.soonActionText]}>
        {startsSoon ? "Open event" : rsvp ? "Scan guests" : "Scan tickets"}
      </Text>
    </Pressable>
  );
  return (
    <View style={[styles.liveBandCard, isWideDesktop && styles.liveBandCardWide]}>
      {showIdentity ? (
        <View style={[
          styles.liveBandTop,
          isWideDesktop && styles.liveBandTopWide,
          startsSoon && !isWideDesktop && styles.soonBandTopNarrow,
        ]}>
          <LivePill
            reduceMotion={reduceMotion}
            startsSoon={startsSoon}
            label={label}
          />
          <Text style={styles.offeringName} numberOfLines={1}>
            {offeringName(item)}
          </Text>
        </View>
      ) : null}
      {pageCount === undefined ? null : (
        <Text style={styles.pageCount}>{pageCount}</Text>
      )}
      <View
        style={[
          styles.liveStats,
          isWideDesktop ? styles.liveStatsWide : styles.liveStatsNarrow,
          startsSoon && !isWideDesktop && styles.soonStatsNarrow,
        ]}
      >
        {!startsSoon && !rsvp ? (
          <View style={styles.liveStat}>
            <Text style={styles.liveStatValue}>{metrics.revenueLabel}</Text>
            <Text style={styles.liveStatLabel}>Tonight</Text>
          </View>
        ) : null}
        {rsvp ? (
          <Text style={styles.rsvpLine}>
            {`${metrics.soldValue} going · ${metrics.checkedInValue ?? "—"} checked in`}
          </Text>
        ) : (
          <View
            style={[
              styles.soldStat,
              isWideDesktop && styles.soldStatWide,
              startsSoon && !isWideDesktop && styles.soldStatSoonNarrow,
            ]}
          >
            <Text style={styles.liveStatValue}>
              {`${metrics.soldValue} of ${metrics.capacityLabel} sold`}
            </Text>
            {metrics.capacity === null ? null : (
              <Progress value={metrics.progress} live={!startsSoon} />
            )}
          </View>
        )}
        {!startsSoon && !rsvp ? (
          <View style={styles.liveStat}>
            <Text style={styles.liveStatValue}>
              {metrics.scannedValue ?? "—"}
            </Text>
            <Text style={styles.liveStatLabel}>Scanned</Text>
          </View>
        ) : null}
        {isWideDesktop ? action : null}
      </View>
      {isWideDesktop ? null : action}
      {metrics.refreshErrorLabel === undefined ? null : (
        <Text style={styles.refreshError}>{metrics.refreshErrorLabel}</Text>
      )}
    </View>
  );
};

const LiveBand: React.FC<{
  liveItems: UpcomingItem[];
  startsSoon: UpcomingItem | null;
  metricsById: Record<string, LiveCardMetrics>;
  reduceMotion: boolean;
  isWideDesktop: boolean;
  onScanPress: (id: string) => void;
  onOpenOffering: (item: UpcomingItem) => void;
}> = ({
  liveItems,
  startsSoon,
  metricsById,
  reduceMotion,
  isWideDesktop,
  onScanPress,
  onOpenOffering,
}) => {
  const items = liveItems.length > 0
    ? liveItems
    : startsSoon === null
      ? []
      : [startsSoon];
  const [selected, setSelected] = useState(0);
  const [width, setWidth] = useState(0);
  const firstItemId = items[0]?.id ?? null;
  useEffect(() => setSelected(0), [items.length, firstItemId]);
  if (items.length === 0) return null;
  const active = items[Math.min(selected, items.length - 1)]!;
  const wideMultiple = isWideDesktop && liveItems.length > 1;
  const metrics = metricsById[active.id] ?? {
    revenueLabel: "—",
    soldValue: "Loading…",
    capacityLabel: "—",
    capacity: null,
    progress: 0,
  };
  const onLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };
  const onScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): void => {
    const pageWidth = event.nativeEvent.layoutMeasurement.width;
    if (pageWidth <= 0) return;
    setSelected(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
  };
  return (
    <View
      style={[
        styles.liveBand,
        isWideDesktop && styles.liveBandWide,
        liveItems.length > 0 && styles.liveBandActive,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.liveBandTint,
          liveItems.length === 0 && styles.soonBandTint,
        ]}
      />
      {wideMultiple ? (
        <LivePill
          reduceMotion={reduceMotion}
          startsSoon={false}
          label="LIVE NOW"
        />
      ) : null}
      {wideMultiple ? (
        <View style={styles.liveTabs}>
          {liveItems.map((item, index) => (
            <Pressable
              key={item.key}
              onPress={() => setSelected(index)}
              accessibilityRole="tab"
              accessibilityLabel={offeringName(item)}
              accessibilityState={{ selected: selected === index }}
              style={[styles.liveTab, selected === index && styles.liveTabSelected]}
            >
              <Text
                style={[
                  styles.liveTabText,
                  selected === index && styles.liveTabTextSelected,
                ]}
                numberOfLines={1}
              >
                {offeringName(item)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!isWideDesktop && liveItems.length > 1 ? (
        <>
          <ScrollView
            onLayout={onLayout}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            decelerationRate="fast"
          >
            {liveItems.map((item, index) => (
              <View key={item.key} style={{ width: Math.max(width, 1) }}>
                <LiveBandCard
                  item={item}
                  metrics={metricsById[item.id] ?? metrics}
                  reduceMotion={reduceMotion}
                  startsSoon={false}
                  isWideDesktop={false}
                  pageCount={`${index + 1} of ${items.length}`}
                  onScanPress={onScanPress}
                  onOpenOffering={onOpenOffering}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.pagerRow}>
            <View style={styles.dots}>
              {liveItems.map((item, index) => (
                <View
                  key={item.key}
                  style={[styles.dot, index === selected && styles.dotActive]}
                />
              ))}
            </View>
          </View>
        </>
      ) : (
        <LiveBandCard
          item={active}
          metrics={metrics}
          reduceMotion={reduceMotion}
          startsSoon={liveItems.length === 0}
          isWideDesktop={isWideDesktop}
          showIdentity={!wideMultiple}
          onScanPress={onScanPress}
          onOpenOffering={onOpenOffering}
        />
      )}
    </View>
  );
};

export const BusinessPulsePanel: React.FC<BusinessPulsePanelProps> = ({
  brandId,
  defaultCurrency,
  canViewPayments,
  liveItems,
  upcomingItems,
  liveMetricsById,
  onScanPress,
  onOpenOffering,
}) => {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const reduceMotion = useReducedMotionNative();
  const payout = useBrandPayoutScreen(canViewPayments ? brandId : null);
  const traffic30d = useBrandTrafficRollup(brandId, "30d", true);
  const trafficAll = useBrandTrafficRollup(brandId, "all", canViewPayments);
  const followers = useBrandFollowerSummary(brandId);
  const startsSoon = liveItems.length === 0
    ? selectStartsSoon(upcomingItems)
    : null;
  const trafficValid = traffic30d.data?.authorized === true;
  const followerTotal = followers.data?.total ?? 0;
  const visibility = businessPulseVisibility({
    canViewMoney: canViewPayments,
    captureStartedAt: trafficValid
      ? traffic30d.data?.captureStartedAt ?? null
      : null,
    pageViews: trafficValid ? traffic30d.data?.totals.pageViews ?? 0 : 0,
    followerTotal,
  });
  const spans = businessPulseDesktopSpans(visibility);
  const hasBand = liveItems.length > 0 || startsSoon !== null;
  const hasZones = visibility.money || visibility.visits || visibility.followers;
  const visibilityKey = `${visibility.money}:${visibility.visits}:${visibility.followers}:${hasBand}`;
  const previousVisibility = useRef(visibilityKey);
  useEffect(() => {
    if (previousVisibility.current !== visibilityKey && !reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          durations.normal,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
    }
    previousVisibility.current = visibilityKey;
  }, [reduceMotion, visibilityKey]);
  const visitFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visibility.visits) {
      visitFade.setValue(0);
      return;
    }
    if (reduceMotion) {
      visitFade.setValue(1);
      return;
    }
    Animated.timing(visitFade, {
      toValue: 1,
      duration: durations.normal,
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, visibility.visits, visitFade]);

  if (!hasBand && !hasZones) return null;

  const payoutData = payout.data ?? undefined;
  const currency = currencyCodeOrNull(payoutData?.currency) ??
    currencyCodeOrNull(defaultCurrency) ?? "GBP";
  const lifetime = payoutData?.lifetimeSalesCents[currency] ?? 0;
  const exactLifetime = formatCurrency(lifetime, currency, true);
  const nextPayout = [...(payoutData?.releases ?? [])]
    .filter((release) =>
      release.hostState !== "paid" && release.hostState !== "cancelled"
    )
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))[0] ?? null;
  const warning = payoutData?.payoutsPaused === true || [
    "waiting_for_bank",
    "late_on_us",
    "needs_you",
    "couldnt_send",
  ].includes(nextPayout?.hostState ?? "");
  const payoutStatus = payoutData?.payoutsPaused
    ? "Payouts paused"
    : nextPayout?.hostState === "waiting_for_bank"
      ? "Add a bank to get paid"
      : nextPayout?.hostState === "late_on_us"
        ? `Late, on us · was due ${payoutDate(nextPayout.dueAt)}`
        : nextPayout?.hostState === "sending_today"
          ? "Sending today"
          : nextPayout?.hostState === "on_its_way"
            ? "On its way to your bank"
            : nextPayout?.hostState === "needs_you"
              ? "Needs you · finish verification"
              : nextPayout?.hostState === "couldnt_send"
                ? "Couldn’t send · check bank details"
                : nextPayout === null
                  ? ""
                  : `Next payout ${payoutDate(nextPayout.dueAt)}`;
  const coming = payoutData?.comingToYouCents ?? 0;
  const paidMonth = payoutData?.paidThisMonthCents ?? 0;
  const showComing = coming > 0 || warning;
  const showMoneyRows = payout.isLoading || showComing || payout.isError || paidMonth > 0;
  const otherCurrencies = Object.entries(payoutData?.lifetimeSalesCents ?? {})
    .filter(([code, amount]) => code !== currency && amount > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  const minglaLifetime = trafficAll.data?.authorized === true
    ? trafficAll.data.totals.valueMinglaBrought[currency] ?? 0
    : 0;
  const minglaCustomers = trafficAll.data?.authorized === true
    ? trafficAll.data.totals.minglaCustomers
    : 0;
  const moneyA11y = `Total lifetime revenue ${exactLifetime}. Coming to you ${formatCurrency(coming, currency, true)}. ${payoutStatus}. Open Payments`;
  const dataError =
    (canViewPayments && (payout.isError || payout.data === null)) ||
    traffic30d.isError || followers.isError ||
    (canViewPayments && trafficAll.isError) ||
    traffic30d.data?.authorized === false ||
    (canViewPayments && trafficAll.data?.authorized === false);
  const retryAll = (): void => {
    void Promise.all([
      ...(canViewPayments ? [payout.refetch()] : []),
      traffic30d.refetch(),
      ...(canViewPayments ? [trafficAll.refetch()] : []),
      followers.refetch(),
    ]);
  };

  const moneyZone = visibility.money ? (
    <Pressable
      onPress={() => router.push(`/brand/${brandId}/payments` as never)}
      accessibilityRole="button"
      accessibilityLabel={moneyA11y}
      style={({ pressed }) => [
        styles.zone,
        styles.fillZone,
        styles.moneyZone,
        !isWideDesktop && styles.moneyZonePhone,
        !showMoneyRows && styles.moneyZoneCompact,
        !showMoneyRows && !isWideDesktop && styles.moneyZoneCompactPhone,
        isWideDesktop && spans.money === 12 && showMoneyRows && styles.moneyZoneOnly,
        pressed && styles.pressed,
      ]}
      testID="business-pulse-money"
    >
      <View style={styles.moneyHeadline}>
        <View style={styles.zoneHeading}>
          <Text style={styles.eyebrow}>TOTAL LIFETIME REVENUE</Text>
          <Text style={styles.zoneChevron}>›</Text>
        </View>
        {payout.isLoading ? (
          <View style={styles.moneySkeleton}>
            <Skeleton width="60%" height={44} />
          </View>
        ) : payout.isError || payoutData === undefined ? (
          <Text style={[styles.moneyAmount, !isWideDesktop && styles.moneyAmountPhone]}>—</Text>
        ) : (
          <>
            <Text style={[styles.moneyAmount, !isWideDesktop && styles.moneyAmountPhone]}>
              {formatCurrencyRound(lifetime, currency, true)}
            </Text>
            {lifetime === 0 ? (
              <Text style={styles.subline}>Your first sale will show here</Text>
            ) : null}
            {minglaLifetime > 0 ? (
              <View style={styles.minglaLine}>
                <View style={styles.minglaMarker} />
                <Text style={styles.minglaCopy}>
                  <Text style={styles.minglaAmount}>
                    {formatCurrencyRound(minglaLifetime, currency, true)}
                  </Text>
                  {` came through Mingla · ${formatCount(minglaCustomers)} ${minglaCustomers === 1 ? "customer" : "customers"}`}
                </Text>
              </View>
            ) : null}
            {otherCurrencies.map(([code, amount]) => (
              <Text key={code} style={styles.subline}>
                {`+ ${formatCurrencyRound(amount, code, true)} in ${code}`}
              </Text>
            ))}
          </>
        )}
      </View>
      {showMoneyRows ? <View
        style={[
          styles.moneyRows,
          isWideDesktop && spans.money === 12 && styles.moneyRowsOnly,
        ]}
      >
        {payout.isLoading ? (
          <Skeleton width="100%" height={44} />
        ) : (
          <>
            {showComing || payout.isError ? (
              <View style={[styles.moneyRow, !isWideDesktop && styles.moneyRowPhone]}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel}>Coming to you</Text>
                  {payoutStatus.length > 0 ? (
                    <Text style={[styles.rowStatus, warning && styles.warningText]}>
                      {payoutStatus}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.rowValue}>
                  {payout.isError ? "—" : formatCurrencyRound(coming, currency, true)}
                </Text>
              </View>
            ) : null}
            {paidMonth > 0 ? (
              <View style={[styles.moneyRow, !isWideDesktop && styles.moneyRowPhone]}>
                <Text style={styles.rowLabel}>Paid to your bank this month</Text>
                <Text style={styles.rowValue}>
                  {formatCurrencyRound(paidMonth, currency, true)}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View> : null}
    </Pressable>
  ) : null;

  const trafficData = trafficValid ? traffic30d.data : undefined;
  const delta = trafficData === undefined ? null : visibleDelta(
    trafficData.totals.pageViews,
    trafficData.prior.pageViews,
    trafficData.totals.pageViews,
    trafficData.prior.pageViews,
    5,
  );
  const rate = trafficData === undefined ? null : visitToPaidRate(
    trafficData.totals.bookings,
    trafficData.totals.pageViews,
  );
  const visitsZone = visibility.visits && trafficData !== undefined ? (
    <Animated.View
      style={[
        styles.zoneWrap,
        isWideDesktop && { flex: spans.visits },
        !isWideDesktop && { flex: 1 },
        isWideDesktop && visibility.money && styles.zoneDivider,
        { opacity: visitFade },
      ]}
    >
      <Pressable
        onPress={() => router.push("/analytics?entry=home_tile" as never)}
        accessibilityRole="button"
        accessibilityLabel={`${formatCount(trafficData.totals.pageViews)} visits in 30 days. ${rate === null ? "" : `${rate.toFixed(1)} percent became sales.`} Open analytics`}
        style={({ pressed }) => [
          styles.zone,
          styles.fillZone,
          !isWideDesktop && styles.metricZonePhone,
          pressed && styles.pressed,
        ]}
        testID="business-pulse-visits"
      >
        <View style={styles.zoneHeading}>
          <Text style={styles.eyebrow}>VISITS · 30 DAYS</Text>
          <Text style={styles.zoneChevron}>›</Text>
        </View>
        <View style={styles.miniValueRow}>
          <Text style={[styles.miniValue, !isWideDesktop && styles.miniValuePhone]}>
            {formatCount(trafficData.totals.pageViews)}
          </Text>
          {delta === null ? null : (
            <View
              style={[
                styles.deltaPill,
                trafficDeltaTone(delta) === "neutral" && styles.deltaPillNeutral,
              ]}
            >
              <Text
                style={[
                  styles.deltaText,
                  trafficDeltaTone(delta) === "neutral" && styles.deltaTextNeutral,
                ]}
              >
                {formatTrafficDelta(delta)}
              </Text>
            </View>
          )}
        </View>
        <TrafficSparkline values={trafficData.daily.map((point) => point.pageViews)} />
        <View style={styles.footerRow}>
          <Text style={[styles.footer, styles.footerRowText]}>
            {`${rate === null ? "—" : rate.toFixed(1)}% became sales`}
          </Text>
          {isWideDesktop ? (
            <Text style={styles.footerLink}>Open analytics ›</Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  ) : null;

  const followerData = followers.data;
  const brandPageFollowers = followerData?.sourcesThisWeek.brandPage ?? 0;
  const followerFooter = brandPageFollowers > 0
    ? `${formatCount(brandPageFollowers)} from your brand page`
    : "";
  const followersZone = visibility.followers && followerData !== undefined ? (
    <View
      style={[
        styles.zoneWrap,
        isWideDesktop && { flex: spans.followers },
        !isWideDesktop && { flex: 1 },
        ((isWideDesktop && (visibility.money || visibility.visits)) ||
          (!isWideDesktop && visibility.visits)) && styles.zoneDivider,
      ]}
    >
      <Pressable
        onPress={() => router.push("/(tabs)/marketing/people" as never)}
        accessibilityRole="button"
        accessibilityLabel={`Followers, ${formatCount(followerData.total)} total${followerData.newThisWeek > 0 ? `, plus ${formatCount(followerData.newThisWeek)} this week` : ""}. Open followers`}
        style={({ pressed }) => [
          styles.zone,
          styles.fillZone,
          !isWideDesktop && styles.metricZonePhone,
          pressed && styles.pressed,
        ]}
        testID="business-pulse-followers"
      >
        <View style={styles.zoneHeading}>
          <Text style={styles.eyebrow}>FOLLOWERS</Text>
          <Text style={styles.zoneChevron}>›</Text>
        </View>
        <View style={styles.miniValueRow}>
          <Text style={[styles.miniValue, !isWideDesktop && styles.miniValuePhone]}>
            {formatCount(followerData.total)}
          </Text>
          {followerData.newThisWeek > 0 ? (
            <View style={styles.followerPill}>
              <Text style={styles.followerPillText}>
                +{formatCount(followerData.newThisWeek)} this week
              </Text>
            </View>
          ) : null}
        </View>
        <FollowerSparkline values={followerData.trend} />
        {followerFooter.length === 0 ? null : (
          <Text style={styles.footer}>{followerFooter}</Text>
        )}
      </Pressable>
    </View>
  ) : null;

  return (
    <View style={[styles.root, !isWideDesktop && styles.rootNarrow]}>
      <GlassCard
        variant="elevated"
        radius="xl"
        padding={0}
        style={liveItems.length > 0 ? styles.liveCardGlow : undefined}
        testID="business-pulse-panel"
      >
        {liveItems.length > 0 ? <View pointerEvents="none" style={styles.liveBorder} /> : null}
        {hasBand ? (
          <LiveBand
            liveItems={liveItems}
            startsSoon={startsSoon}
            metricsById={liveMetricsById}
            reduceMotion={reduceMotion}
            isWideDesktop={isWideDesktop}
            onScanPress={onScanPress}
            onOpenOffering={onOpenOffering}
          />
        ) : null}
        {hasZones ? (
          isWideDesktop ? (
            <View style={[styles.zones, hasBand && styles.zonesAfterBand]}>
              {moneyZone === null ? null : (
                <View style={[styles.zoneWrap, { flex: spans.money }]}>
                  {moneyZone}
                </View>
              )}
              {visitsZone}
              {followersZone}
            </View>
          ) : (
            <View style={hasBand && styles.zonesAfterBand}>
              {moneyZone}
              {visibility.visits || visibility.followers ? (
                <View style={styles.phoneStrip}>
                  {visitsZone}
                  {followersZone}
                </View>
              ) : null}
            </View>
          )
        ) : null}
        {dataError ? (
          <View style={styles.errorLine}>
            <Text style={styles.errorText}>Couldn&apos;t load your numbers</Text>
            <Pressable onPress={retryAll} accessibilityRole="button" style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  rootNarrow: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: spacing.sm + spacing.xs,
  },
  liveCardGlow: {
    shadowColor: semantic.liveGlow,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
  },
  liveBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderRadius: radius.xl,
    borderColor: semantic.live,
    opacity: 0.38,
  },
  zones: { flexDirection: "row", alignItems: "stretch" },
  zonesAfterBand: { borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  zoneWrap: { minWidth: 0 },
  zoneDivider: { borderLeftWidth: 1, borderLeftColor: glass.border.profileBase },
  zone: { minHeight: 196, padding: spacing.lg, minWidth: 0 },
  fillZone: { flex: 1 },
  moneyZone: { minWidth: 0, paddingBottom: 0 },
  moneyZonePhone: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  moneyZoneCompact: { minHeight: 147 },
  moneyZoneCompactPhone: { minHeight: 130 },
  metricZonePhone: {
    minHeight: 222,
    padding: spacing.md,
  },
  moneyZoneOnly: { flexDirection: "row", alignItems: "stretch", gap: spacing.lg },
  moneyHeadline: { flex: 1, minWidth: 0 },
  moneyRows: {
    marginTop: spacing.md,
    paddingBottom: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  moneyRowsOnly: { flex: 1, marginTop: 0, paddingLeft: spacing.lg, borderTopWidth: 0, borderLeftWidth: 1 },
  eyebrow: { ...typography.labelCap, color: textTokens.tertiary },
  zoneHeading: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  zoneChevron: {
    color: textTokens.tertiary,
    fontSize: 20,
    lineHeight: 20,
    fontWeight: "700",
  },
  moneyAmount: {
    color: textTokens.primary,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "800",
    letterSpacing: -0.88,
    fontVariant: ["tabular-nums"],
    marginTop: spacing.sm,
  },
  moneyAmountPhone: { fontSize: 38, lineHeight: 44, letterSpacing: -0.76 },
  moneySkeleton: { marginTop: spacing.sm },
  subline: { ...typography.bodySm, color: textTokens.secondary, marginTop: spacing.xs },
  minglaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  minglaMarker: {
    width: 8,
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: accent.warm,
  },
  minglaCopy: { ...typography.bodySm, color: textTokens.secondary, flexShrink: 1 },
  minglaAmount: { color: textTokens.primary, fontWeight: "600" },
  moneyRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  moneyRowPhone: { minHeight: 44 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { ...typography.caption, color: textTokens.secondary, flex: 1 },
  rowStatus: { ...typography.micro, color: textTokens.secondary, marginTop: spacing.xxs },
  warningText: { color: semantic.warning },
  rowValue: { color: textTokens.primary, fontSize: 15, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  miniValueRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  miniValue: { color: textTokens.primary, fontSize: 30, lineHeight: 36, fontWeight: "800", fontVariant: ["tabular-nums"] },
  miniValuePhone: { fontSize: 24, lineHeight: 30 },
  deltaPill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.full, backgroundColor: trafficAnalytics.positiveDeltaTint },
  deltaPillNeutral: { backgroundColor: trafficAnalytics.neutralDeltaTint },
  deltaText: { ...typography.caption, color: trafficAnalytics.positiveDelta, fontWeight: "700" },
  deltaTextNeutral: { color: trafficAnalytics.neutralDelta },
  followerPill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.full, backgroundColor: trafficAnalytics.positiveDeltaTint },
  followerPillText: { ...typography.caption, color: trafficAnalytics.positiveDelta, fontWeight: "700" },
  sparkline: { flex: 1, minHeight: 64, marginTop: spacing.sm },
  followerSparkline: { flex: 1, minHeight: 46, marginTop: spacing.md },
  footer: { ...typography.caption, color: textTokens.secondary, marginTop: "auto", paddingTop: spacing.sm },
  footerRow: {
    marginTop: "auto",
    paddingTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  footerRowText: { marginTop: 0, paddingTop: 0 },
  footerLink: { ...typography.caption, color: accent.warm, fontWeight: "600" },
  phoneStrip: { flexDirection: "row", alignItems: "stretch", borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  pressed: { opacity: 0.72 },
  liveBand: { padding: spacing.md, position: "relative", overflow: "hidden" },
  liveBandWide: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  liveBandActive: {},
  liveBandTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: semantic.liveGlow,
    opacity: 0.32,
  },
  soonBandTint: { backgroundColor: semantic.warningTint, opacity: 1 },
  liveBandCard: { gap: spacing.md },
  liveBandCardWide: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  liveBandTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  liveBandTopWide: { minWidth: 0, flexShrink: 1 },
  soonBandTopNarrow: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  livePill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: semantic.live },
  soonPill: { backgroundColor: glass.tint.profileBase, borderWidth: 1, borderColor: semantic.warning },
  livePillText: { ...typography.micro, color: textTokens.inverse, fontWeight: "800" },
  soonPillText: { color: semantic.warning },
  liveDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: textTokens.inverse },
  soonDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: semantic.warning },
  offeringName: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700", flex: 1 },
  liveStats: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  liveStatsWide: { flex: 1, justifyContent: "flex-end" },
  liveStatsNarrow: { justifyContent: "space-between" },
  soonStatsNarrow: { flexDirection: "column", alignItems: "stretch" },
  liveStat: { minWidth: 80 },
  soldStat: { flex: 1, minWidth: 150 },
  soldStatWide: { flex: 0, width: 150 },
  soldStatSoonNarrow: { width: 112, flex: 0 },
  liveStatValue: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  liveStatLabel: { ...typography.micro, color: textTokens.tertiary, marginTop: spacing.xxs },
  rsvpLine: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700", flex: 1 },
  progressTrack: { height: 5, borderRadius: radius.full, overflow: "hidden", backgroundColor: glass.border.profileElevated, marginTop: spacing.xs },
  progressFill: { height: "100%", borderRadius: radius.full, backgroundColor: semantic.warning },
  liveProgressFill: { backgroundColor: semantic.live },
  liveAction: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: accent.warm },
  liveActionNarrow: { width: "100%" },
  soonAction: { backgroundColor: glass.tint.profileElevated, borderWidth: 1, borderColor: semantic.warning },
  liveActionText: { ...typography.buttonMd, color: textTokens.inverse },
  soonActionText: { color: semantic.warning },
  refreshError: { ...typography.caption, color: textTokens.secondary },
  liveTabs: { flexDirection: "row", gap: spacing.xs, minWidth: 0, flexShrink: 1 },
  liveTab: { minHeight: 32, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: glass.tint.profileBase },
  liveTabSelected: { backgroundColor: semantic.liveGlow },
  liveTabText: { ...typography.caption, color: textTokens.secondary },
  liveTabTextSelected: { color: textTokens.primary, fontWeight: "700" },
  pagerRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  dots: { flexDirection: "row", gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: textTokens.quaternary },
  dotActive: { backgroundColor: semantic.live },
  pageCount: { ...typography.micro, color: textTokens.tertiary, alignSelf: "flex-end" },
  errorLine: { minHeight: 52, borderTopWidth: 1, borderTopColor: glass.border.profileBase, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  errorText: { ...typography.bodySm, color: textTokens.primary },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryText: { ...typography.bodySm, color: accent.warm, fontWeight: "700" },
});

export default BusinessPulsePanel;
