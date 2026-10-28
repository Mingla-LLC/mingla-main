import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Line,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  trafficAnalytics,
  typography,
} from "../../constants/designSystem";
import {
  TRAFFIC_RANGES,
  TRAFFIC_SOURCES,
} from "../../constants/trafficAnalyticsContract";
// Types only: a value import would hoist the service into the boot chunk.
import type {
  BrandTrafficRollup,
  EntityTrafficRollup,
  TrafficCtaType,
  TrafficPageRow,
  TrafficRange,
  TrafficRollupBase,
  TrafficSource,
} from "../../services/trafficAnalyticsService";
import { formatCurrencyRound } from "../../utils/currency";
import {
  analyticsGridModules,
  packAnalyticsGrid,
  type AnalyticsGridModuleId,
} from "../../utils/analyticsGridPacking";
import {
  formatTrafficDelta,
  trafficDeltaAccessibilityLabel,
  trafficDeltaTone,
  visibleDelta,
  visitToPaidRate,
} from "../../utils/trafficAnalyticsMath";
import { visibleFunnelSteps } from "./trafficFunnel";
import {
  AnalyticsModuleError,
  AnalyticsModuleSkeleton,
} from "./AnalyticsModuleState";
import { GlassCard } from "../ui/GlassCard";

const RANGE_LABELS: Record<TrafficRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

const SOURCE_LABELS: Record<TrafficSource, string> = {
  mingla_app: "Mingla app",
  mingla_ads: "Mingla ads",
  search: "Search",
  social: "Social",
  own_links: "Your own links",
  direct_unknown: "Direct or unknown",
};

const PAGE_TYPE_LABELS: Record<TrafficPageRow["entityType"], string> = {
  event: "Event",
  brand: "Brand",
  trip: "Trip",
  experience: "Experience",
  venue: "Venue",
};

const CTA_GROUPS: readonly {
  label: string;
  keys: readonly TrafficCtaType[];
}[] = [
  { label: "Buy or book", keys: ["buy", "book", "rsvp"] },
  { label: "Share", keys: ["share"] },
  { label: "Save", keys: ["save"] },
  { label: "Directions", keys: ["directions"] },
  { label: "Website or call", keys: ["website", "call"] },
  // Decision 5 (#4037): opening the brand, a venue or an offering is a tap too.
  {
    label: "Opened another page",
    keys: ["view_brand", "view_venue", "view_offering"],
  },
];

const MINGLA_SOURCES = new Set<TrafficSource>([
  "mingla_app",
  "mingla_ads",
  "search",
]);

const count = (value: number): string => value.toLocaleString("en-GB");

const percentage = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;

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

const collectingCopy = (value: string | null): string => {
  const date = captureDate(value);
  return date === null
    ? "Collecting visits. Visits show here as people open your pages."
    : `Collecting since ${date}. Visits show here as people open your pages.`;
};

const primaryValue = (
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

const money = (cents: number, currency: string | null): string =>
  currency === null ? "—" : formatCurrencyRound(cents, currency, true);

const DeltaPill: React.FC<{ value: number | null }> = ({ value }) => {
  if (value === null) return null;
  const neutral = trafficDeltaTone(value) === "neutral";
  return (
    <View
      style={[styles.deltaPill, neutral && styles.deltaPillNeutral]}
      accessibilityLabel={trafficDeltaAccessibilityLabel(value)}
      testID={neutral ? "traffic-delta-neutral" : "traffic-delta-positive"}
    >
      <Text style={[styles.deltaText, neutral && styles.deltaTextNeutral]}>
        {formatTrafficDelta(value)}
      </Text>
    </View>
  );
};

export const TrafficRangeControl: React.FC<{
  value: TrafficRange;
  onChange: (range: TrafficRange) => void;
}> = ({ value, onChange }) => (
  <View style={styles.rangeControl} accessibilityRole="tablist">
    {TRAFFIC_RANGES.map((range) => {
      const selected = range === value;
      return (
        <Pressable
          key={range}
          onPress={() => onChange(range)}
          accessibilityRole="tab"
          accessibilityLabel={`Show ${RANGE_LABELS[range]}`}
          accessibilityState={{ selected }}
          style={({ pressed }) => [
            styles.rangeButton,
            selected && styles.rangeButtonSelected,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[styles.rangeLabel, selected && styles.rangeLabelSelected]}
          >
            {RANGE_LABELS[range]}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

const TrafficCoverageNote: React.FC<{
  data: TrafficRollupBase;
}> = ({ data }) => {
  const date = captureDate(data.captureStartedAt);
  if (date === null || (data.range !== "all" && data.windowComplete))
    return null;
  return (
    <Text style={styles.coverageNote}>
      {data.range === "all"
        ? `Since tracking started ${date}`
        : `Tracking began ${date}; this range is partial.`}
    </Text>
  );
};

const MiniStat: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View style={styles.miniStat}>
    <Text style={styles.miniValue}>{value}</Text>
    <Text style={styles.miniLabel}>{label}</Text>
  </View>
);

const HeroCard: React.FC<{ data: TrafficRollupBase }> = ({ data }) => {
  const current = primaryValue(
    data.totals.valueMinglaBrought,
    data.totals.primaryCurrency,
  );
  const prior = primaryValue(data.prior.valueMinglaBrought, current.currency);
  const delta = visibleDelta(
    current.cents,
    prior.cents,
    data.totals.bookings,
    data.prior.bookings,
    5,
  );
  const minglaBookings = data.sources
    .filter((row) => MINGLA_SOURCES.has(row.source))
    .reduce((sum, row) => sum + row.bookings, 0);
  const minglaPercent = percentage(minglaBookings, data.totals.bookings);
  const others = Object.entries(data.totals.valueMinglaBrought).filter(
    ([currency]) => currency !== current.currency,
  );
  return (
    <LinearGradient
      colors={trafficAnalytics.heroGradient}
      style={styles.heroCard}
      testID="traffic-hero-card"
    >
      <Text style={styles.eyebrow}>VALUE MINGLA BROUGHT</Text>
      <View style={styles.heroValueRow}>
        <Text style={styles.heroValue}>
          {money(current.cents, current.currency)}
        </Text>
        <DeltaPill value={delta} />
      </View>
      {others.map(([currency, cents]) => (
        <Text key={currency} style={styles.otherCurrency}>
          {`+ ${formatCurrencyRound(cents, currency, true)} in ${currency}`}
        </Text>
      ))}
      <Text style={styles.heroSentence}>
        {`${minglaPercent}% of your bookings came from people Mingla sent: the Mingla app, Mingla ads and search.`}
      </Text>
      <View style={[styles.miniRow, styles.heroFooter]}>
        <MiniStat
          label="Customers from Mingla"
          value={count(data.totals.minglaCustomers)}
        />
        <MiniStat label="Bookings" value={count(data.totals.bookings)} />
      </View>
    </LinearGradient>
  );
};

const chartPath = (
  values: number[],
  width: number,
  height: number,
): {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
  max: number;
} => {
  const max = Math.max(...values, 1);
  const divisor = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => ({
    x: (index / divisor) * width,
    y: height - (value / max) * (height - 12),
  }));
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const last = points[points.length - 1] ?? { x: 0, y: height };
  const area =
    points.length === 0 ? "" : `${line} L${last.x},${height} L0,${height} Z`;
  return { line, area, lastX: last.x, lastY: last.y, max };
};

const shortDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
};

const TrendCard: React.FC<{ data: TrafficRollupBase }> = ({ data }) => {
  const hasTraffic =
    data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const values = data.daily.map((point) => point.pageViews);
  const path = chartPath(values, 300, 110);
  const highest = Math.max(...values, 0);
  const highestIndex = values.indexOf(highest);
  const highestDay = data.daily[highestIndex]?.day;
  const accessibilityLabel = `Visits per day, ${RANGE_LABELS[data.range]}, ${count(data.totals.pageViews)} total${highestDay === undefined ? "" : `, highest ${count(highest)} on ${shortDay(highestDay)}`}`;
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <View style={styles.titleRow}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          Visits per day
        </Text>
        <Text style={styles.totalAtRight}>{count(data.totals.pageViews)}</Text>
      </View>
      {!hasTraffic ? (
        <Text style={styles.collecting}>
          {collectingCopy(data.captureStartedAt)}
        </Text>
      ) : (
        <View
          style={styles.chartFill}
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
        >
          <Svg width="100%" height={132} viewBox="0 0 340 132">
            <Defs>
              <SvgLinearGradient id="trafficArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={accent.warm} stopOpacity="0.34" />
                <Stop offset="1" stopColor={accent.warm} stopOpacity="0.02" />
              </SvgLinearGradient>
            </Defs>
            {[36, 76].map((y, index) => (
              <React.Fragment key={y}>
                <Line
                  x1="0"
                  x2="300"
                  y1={y}
                  y2={y}
                  stroke={glass.border.profileElevated}
                  strokeDasharray="4 5"
                />
                <SvgText
                  x="308"
                  y={y + 4}
                  fill={textTokens.tertiary}
                  fontSize="10"
                >
                  {Math.round(path.max * (index === 0 ? 0.67 : 0.33))}
                </SvgText>
              </React.Fragment>
            ))}
            <Path d={path.area} fill="url(#trafficArea)" />
            <Path
              d={path.line}
              fill="none"
              stroke={accent.warm}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Circle
              cx={path.lastX}
              cy={path.lastY}
              r="5"
              fill={accent.warm}
              stroke={textTokens.primary}
              strokeWidth="2"
            />
          </Svg>
          <View style={styles.axisRow}>
            <Text style={styles.axisText}>{shortDay(data.daily[0]!.day)}</Text>
            <Text style={styles.axisText}>
              {shortDay(data.daily[data.daily.length - 1]!.day)}
            </Text>
          </View>
        </View>
      )}
    </GlassCard>
  );
};

const FunnelCard: React.FC<{ data: TrafficRollupBase }> = ({ data }) => {
  const hasTraffic =
    data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const visible = visibleFunnelSteps(data.totals, hasTraffic);
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        From visit to sale
      </Text>
      <View
        style={styles.funnel}
        accessibilityRole="image"
        accessibilityLabel={`From visit to sale, ${visible
          .map((step) => `${step.label} ${count(step.value)}`)
          .join(", ")}`}
      >
        {visible.map((step, index) => {
          const previous = index === 0 ? null : visible[index - 1]!;
          return (
            <View
              key={step.label}
              testID={`traffic-funnel-${step.label.toLowerCase().replaceAll(" ", "-")}`}
            >
              {previous === null || previous.value === 0 ? null : (
                <Text
                  style={styles.continueText}
                >{`${percentage(step.value, previous.value)}% continue`}</Text>
              )}
              <View style={styles.funnelLabelRow}>
                <Text style={styles.funnelLabel}>{step.label}</Text>
                <Text style={styles.funnelCount}>{count(step.value)}</Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.funnelFill,
                    { width: `${step.widthPercent}%` },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );
};

const SourceCard: React.FC<{ data: TrafficRollupBase; scoped?: boolean }> = ({
  data,
  scoped = false,
}) => {
  const hasTraffic =
    data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const total = data.sources.reduce((sum, row) => sum + row.visitors, 0);
  const mingla = data.sources
    .filter((row) => MINGLA_SOURCES.has(row.source))
    .reduce((sum, row) => sum + row.visitors, 0);
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        Where visitors came from
      </Text>
      {!hasTraffic ? (
        <Text style={styles.collecting}>
          {collectingCopy(data.captureStartedAt)}
        </Text>
      ) : (
        <>
          <View
            style={styles.sourceBar}
            accessibilityRole="image"
            accessibilityLabel={`${percentage(mingla, total)} percent of visitors came from Mingla`}
          >
            {data.sources.map((row) => (
              <View
                key={row.source}
                style={{
                  backgroundColor: trafficAnalytics.sources[row.source],
                  flexGrow: row.visitors,
                  flexBasis: row.visitors === 0 ? 0 : 1,
                }}
              />
            ))}
          </View>
          <View
            testID="traffic-mingla-source-bracket"
            style={[
              styles.bracketLine,
              { width: `${percentage(mingla, total)}%` },
            ]}
          />
          <Text style={styles.broughtLine}>
            {scoped
              ? `${percentage(mingla, total)}% of this page's visitors came from Mingla`
              : `Brought by Mingla: ${percentage(mingla, total)}% of visitors`}
          </Text>
          <View style={styles.sourceRows}>
            {TRAFFIC_SOURCES.map((source) => {
              const row = data.sources.find(
                (candidate) => candidate.source === source,
              )!;
              return (
                <View key={source} style={styles.sourceRow}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: trafficAnalytics.sources[source] },
                    ]}
                  />
                  <Text
                    style={[
                      styles.sourceName,
                      MINGLA_SOURCES.has(source) && styles.sourceNameMingla,
                    ]}
                  >
                    {SOURCE_LABELS[source]}
                  </Text>
                  <Text
                    style={styles.sourceNumber}
                  >{`${count(row.visitors)} · ${percentage(row.visitors, total)}%`}</Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </GlassCard>
  );
};

const PageListCard: React.FC<{
  pages: TrafficPageRow[];
  selected: TrafficPageRow | null;
  onSelect: (page: TrafficPageRow) => void;
  captureStartedAt: string | null;
  enoughTraffic: boolean;
}> = ({ pages, selected, onSelect, captureStartedAt, enoughTraffic }) => {
  const max = Math.max(...pages.map((page) => page.pageViews), 1);
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        Your pages
      </Text>
      {!enoughTraffic ? (
        <Text style={styles.collecting}>
          {collectingCopy(captureStartedAt)}
        </Text>
      ) : (
        <View style={styles.pageRows}>
          {pages.map((page) => {
            const rate = visitToPaidRate(page.bookings, page.pageViews);
            const active =
              selected?.entityType === page.entityType &&
              selected.entityId === page.entityId;
            return (
              <Pressable
                key={`${page.entityType}:${page.entityId ?? "brand"}`}
                onPress={() => onSelect(page)}
                accessibilityRole="button"
                accessibilityLabel={`${page.title}, ${count(page.pageViews)} visits, ${count(page.bookings)} sold`}
                style={({ pressed }) => [
                  styles.pageRow,
                  active && styles.pageRowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.pageCopy}>
                  <Text style={styles.pageTitle} numberOfLines={1}>
                    {page.title}
                  </Text>
                  <Text
                    style={styles.pageMeta}
                  >{`${PAGE_TYPE_LABELS[page.entityType]} · ${rate === null ? "—" : `${rate.toFixed(1)}%`} visit → paid`}</Text>
                </View>
                <View style={styles.pageRight}>
                  <Text style={styles.pageVisits}>{count(page.pageViews)}</Text>
                  <Text
                    style={styles.pageSold}
                  >{`${count(page.bookings)} sold`}</Text>
                </View>
                <View style={styles.pageMeterTrack}>
                  <View
                    style={[
                      styles.pageMeterFill,
                      { width: `${(page.pageViews / max) * 100}%` },
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </GlassCard>
  );
};

const PageDetailCard: React.FC<{
  page: TrafficPageRow | null;
  data: EntityTrafficRollup | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenListing?: () => void;
}> = ({ page, data, isLoading, isError, onRetry, onOpenListing }) => {
  if (page === null) return null;
  if (isError)
    return (
      <AnalyticsModuleError
        title="Couldn't load page analytics"
        onRetry={onRetry}
      />
    );
  if (isLoading || data === undefined) {
    return <AnalyticsModuleSkeleton testID="analytics-page-detail-loading" />;
  }
  const current = primaryValue(
    page.valueByCurrency,
    data.totals.primaryCurrency,
  );
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={styles.card}
      contentStyle={styles.cardContent}
    >
      <Text style={styles.eyebrow}>
        {PAGE_TYPE_LABELS[page.entityType].toUpperCase()}
      </Text>
      <Text style={styles.detailTitle} numberOfLines={2}>
        {page.title}
      </Text>
      <Text style={styles.detailValue}>
        {money(current.cents, current.currency)}
      </Text>
      <View style={styles.miniRow}>
        <MiniStat label="Visitors" value={count(data.totals.visitors)} />
        <MiniStat label="Button taps" value={count(data.totals.buttonTaps)} />
        <MiniStat
          label="Checkouts started"
          value={count(data.totals.checkoutStarts)}
        />
      </View>
      {onOpenListing === undefined ? null : (
        <Pressable
          onPress={onOpenListing}
          accessibilityRole="link"
          style={styles.detailLink}
        >
          <Text style={styles.detailLinkText}>Open listing insights ›</Text>
        </Pressable>
      )}
    </GlassCard>
  );
};

const ButtonTapsCard: React.FC<{ data: TrafficRollupBase }> = ({ data }) => {
  const values = CTA_GROUPS.map((group) => ({
    label: group.label,
    count: group.keys.reduce(
      (sum, key) =>
        sum + (data.ctas.find((row) => row.type === key)?.count ?? 0),
      0,
    ),
  }));
  const max = Math.max(...values.map((row) => row.count), 1);
  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={styles.card}
      contentStyle={styles.cardContent}
      testID="traffic-button-taps-card"
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        Button taps
      </Text>
      <View
        style={styles.tapGrid}
        accessibilityRole="image"
        accessibilityLabel={`Button taps, ${values
          .map((row) => `${row.label} ${count(row.count)}`)
          .join(", ")}`}
      >
        {values.map((row) => (
          <View key={row.label} style={styles.tapTile}>
            <Text style={styles.tapCount}>{count(row.count)}</Text>
            <Text style={styles.tapLabel}>{row.label}</Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.tapFill,
                  { width: `${Math.max(3, (row.count / max) * 100)}%` },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    </GlassCard>
  );
};

export const visibleButtonTapTypeCount = (data: TrafficRollupBase): number =>
  CTA_GROUPS.filter((group) =>
    group.keys.reduce(
      (sum, key) =>
        sum + (data.ctas.find((row) => row.type === key)?.count ?? 0),
      0,
    ) > 0
  ).length;

export interface TrafficAnalyticsDashboardProps {
  data: BrandTrafficRollup | EntityTrafficRollup | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  range: TrafficRange;
  onRangeChange: (range: TrafficRange) => void;
  isWideDesktop: boolean;
  pages?: TrafficPageRow[];
  selectedPage?: TrafficPageRow | null;
  onSelectPage?: (page: TrafficPageRow) => void;
  selectedPageData?: EntityTrafficRollup;
  selectedPageLoading?: boolean;
  selectedPageError?: boolean;
  onRetrySelectedPage?: () => void;
  onOpenSelectedListing?: () => void;
  onClearSelectedPage?: () => void;
  regularsModule?: React.ReactNode;
  customerPatternsModule?: React.ReactNode;
  regularsCollecting?: boolean;
  customerPatternsCollecting?: boolean;
}

export const TrafficAnalyticsDashboard: React.FC<
  TrafficAnalyticsDashboardProps
> = ({
  data,
  isLoading,
  isError,
  onRetry,
  range,
  onRangeChange,
  isWideDesktop,
  pages,
  selectedPage = null,
  onSelectPage,
  selectedPageData,
  selectedPageLoading = false,
  selectedPageError = false,
  onRetrySelectedPage = onRetry,
  onOpenSelectedListing,
  onClearSelectedPage,
  regularsModule,
  customerPatternsModule,
  regularsCollecting = false,
  customerPatternsCollecting = false,
}) => {
  if (isError) {
    return (
      <View style={styles.errorBanner}>
        <Text style={styles.errorBannerText}>
          Couldn&apos;t load traffic analytics
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={styles.errorRetry}
        >
          <Text style={styles.errorRetryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (isLoading || data === undefined) {
    return (
      <View style={[styles.loadingGrid, isWideDesktop && styles.loadingGridWide]}>
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={isWideDesktop ? styles.loadingCell : undefined}>
            <AnalyticsModuleSkeleton
              testID={`traffic-analytics-loading-${index}`}
            />
          </View>
        ))}
      </View>
    );
  }
  const enoughTraffic =
    data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const brandPages = pages ?? [];
  const hero = <HeroCard data={data} />;
  const trend = <TrendCard data={data} />;
  const funnel = <FunnelCard data={data} />;
  const sources = <SourceCard data={data} scoped={pages === undefined} />;
  const taps = <ButtonTapsCard data={data} />;
  const pageList =
    !enoughTraffic || pages === undefined || onSelectPage === undefined
      ? null
      : (
      <PageListCard
        pages={brandPages}
        selected={selectedPage}
        onSelect={onSelectPage}
        captureStartedAt={data.captureStartedAt}
        enoughTraffic={enoughTraffic}
      />
    );
  const pageDetail =
    pages === undefined || selectedPage === null ? null : (
      <PageDetailCard
        page={selectedPage}
        data={selectedPageData}
        isLoading={selectedPageLoading}
        isError={selectedPageError}
        onRetry={onRetrySelectedPage}
        onOpenListing={onOpenSelectedListing}
      />
    );
  const showTaps = visibleButtonTapTypeCount(data) >= 2;
  const nodes: Partial<Record<AnalyticsGridModuleId, React.ReactNode>> = {
    hero,
    visits: trend,
    funnel,
    sources,
    pages: pageList,
    selectedPage: pageDetail,
    buttonTaps: taps,
    regulars: regularsModule,
    customerPatterns: customerPatternsModule,
  };
  const modules = analyticsGridModules({
    showVisits: enoughTraffic,
    showPages: pageList !== null,
    showSelectedPage: isWideDesktop && pageDetail !== null,
    showButtonTaps: showTaps,
    showRegulars: regularsModule !== undefined && regularsModule !== null,
    showCustomerPatterns:
      customerPatternsModule !== undefined && customerPatternsModule !== null,
  });
  const collecting = [
    ...(!enoughTraffic
      ? [`visits${captureDate(data.captureStartedAt) === null ? "" : ` (since ${captureDate(data.captureStartedAt)})`}`]
      : []),
    ...(regularsCollecting ? ["regulars"] : []),
    ...(customerPatternsCollecting ? ["booking patterns"] : []),
  ];
  return (
    <View style={styles.dashboard}>
      <TrafficRangeControl value={range} onChange={onRangeChange} />
      <TrafficCoverageNote data={data} />
      {collecting.length === 0 ? null : (
        <Text style={styles.collectingLine}>
          {`Still collecting: ${collecting.join(", ")}`}
        </Text>
      )}
      {isWideDesktop ? packAnalyticsGrid(modules).map((row, rowIndex) => (
        <View key={rowIndex} style={styles.gridRow}>
          {row.map((module) => (
            <View key={module.id} style={[styles.gridCell, { flex: module.width }]}>
              {nodes[module.id]}
            </View>
          ))}
        </View>
      )) : modules
        .filter((module) => module.id !== "selectedPage")
        .map((module) => (
          <View key={module.id}>{nodes[module.id]}</View>
        ))}
      {!isWideDesktop && pageDetail !== null ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={onClearSelectedPage}
        >
          <Pressable
            style={styles.sheetBackdrop}
            onPress={onClearSelectedPage}
            accessibilityRole="button"
            accessibilityLabel="Close selected page details"
          >
            {/* orch-strict-grep-allow pressable-no-label — event containment only; the sheet content owns accessibility */}
            <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
              <View style={styles.sheetHandle} />
              {pageDetail}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  dashboard: { gap: spacing.lg },
  loadingGrid: { gap: spacing.md },
  loadingGridWide: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  loadingCell: { flexGrow: 1, flexBasis: "46%", minWidth: 0 },
  errorBanner: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  errorBannerText: {
    ...typography.bodySm,
    color: textTokens.primary,
    flex: 1,
  },
  errorRetry: { minHeight: 44, justifyContent: "center" },
  errorRetryText: {
    ...typography.buttonMd,
    color: accent.warm,
  },
  rangeControl: {
    flexDirection: "row",
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  rangeButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
  rangeButtonSelected: { backgroundColor: accent.tint },
  rangeLabel: {
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
  },
  rangeLabelSelected: { color: textTokens.primary, fontWeight: "700" },
  coverageNote: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    marginTop: -spacing.sm,
  },
  pressed: { opacity: 0.68 },
  card: { minWidth: 0, flex: 1 },
  cardContent: { flex: 1 },
  heroCard: {
    minWidth: 0,
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: accent.border,
    padding: spacing.lg,
  },
  eyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  heroValueRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  heroValue: {
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
  otherCurrency: {
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  heroSentence: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    marginTop: spacing.md,
  },
  miniRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  heroFooter: { marginTop: "auto", paddingTop: spacing.lg },
  miniStat: { flexGrow: 1, flexBasis: 112, minWidth: 0 },
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
    marginTop: spacing.xs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  totalAtRight: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  collecting: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.md,
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  chartFill: { flex: 1, justifyContent: "center" },
  axisText: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  funnel: { gap: spacing.xs, marginTop: spacing.md },
  continueText: {
    color: textTokens.tertiary,
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    marginVertical: spacing.xs,
  },
  funnelLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  funnelLabel: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  funnelCount: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 5,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: glass.border.profileElevated,
    marginTop: spacing.xs,
  },
  funnelFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  sourceBar: {
    height: 14,
    borderRadius: radius.full,
    overflow: "hidden",
    flexDirection: "row",
    marginTop: spacing.lg,
  },
  bracketLine: {
    height: 8,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: accent.border,
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  broughtLine: {
    color: accent.warm,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  sourceRows: { marginTop: spacing.md },
  sourceRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  swatch: { width: 10, height: 10, borderRadius: radius.full },
  sourceName: {
    flex: 1,
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  sourceNameMingla: { color: textTokens.primary, fontWeight: "600" },
  sourceNumber: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontVariant: ["tabular-nums"],
  },
  pageRows: { marginTop: spacing.sm },
  pageRow: {
    minHeight: 64,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pageRowSelected: { backgroundColor: trafficAnalytics.selectedPageTint },
  pageCopy: { flex: 1, minWidth: 0, paddingBottom: spacing.sm },
  pageTitle: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  pageMeta: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  pageRight: { alignItems: "flex-end", paddingBottom: spacing.sm },
  pageVisits: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  pageSold: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  pageMeterTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xs,
    height: 2,
    backgroundColor: glass.border.profileBase,
    overflow: "hidden",
  },
  pageMeterFill: { height: "100%", backgroundColor: accent.warm },
  detailTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    marginTop: spacing.xs,
  },
  detailValue: {
    color: textTokens.primary,
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: typography.statValue.fontWeight,
    fontVariant: ["tabular-nums"],
    marginTop: spacing.sm,
  },
  detailLink: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: "auto",
    paddingTop: spacing.md,
  },
  detailLinkText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
  tapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tapTile: {
    flexGrow: 1,
    flexBasis: 138,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  tapCount: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    fontVariant: ["tabular-nums"],
  },
  tapLabel: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  tapFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: trafficAnalytics.tapMeter,
  },
  collectingLine: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: -spacing.sm,
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.lg,
  },
  gridCell: { minWidth: 0 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: canvas.depth,
  },
  sheet: {
    maxHeight: "88%",
    padding: spacing.md,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: canvas.profile,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: textTokens.quaternary,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
});

export default TrafficAnalyticsDashboard;
