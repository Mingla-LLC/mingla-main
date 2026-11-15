import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
  radius,
  trafficAnalytics,
  space,
  color,
  type,
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
  TrafficListingType,
  TrafficPageRow,
  TrafficRange,
  TrafficRollupBase,
  TrafficSource,
} from "../../services/trafficAnalyticsService";
import {
  analyticsGridModules,
  packAnalyticsGrid,
  type AnalyticsGridModuleId,
} from "../../utils/analyticsGridPacking";
import { visitToPaidRate } from "../../utils/trafficAnalyticsMath";
import {
  AnalyticsModuleError,
  AnalyticsModuleSkeleton,
} from "./AnalyticsModuleState";
import { GlassCard } from "../ui/GlassCard";
import { primaryActionCount, trafficOutcomeCopy } from "./trafficOutcomeCopy";

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

const SECONDARY_CTA_GROUPS: readonly {
  label: string;
  keys: readonly TrafficCtaType[];
}[] = [
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

const TrendCard: React.FC<{
  data: TrafficRollupBase;
  fillHeight: boolean;
}> = ({ data, fillHeight }) => {
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
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-visits-card"
    >
      <View style={styles.titleRow}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          Visits per day
        </Text>
        <Text style={styles.totalAtRight}>{count(data.totals.pageViews)}</Text>
      </View>
      <Text style={styles.cardNote}>Page opens in the selected period</Text>
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
                <Stop offset="0" stopColor={color.accent} stopOpacity="0.34" />
                <Stop offset="1" stopColor={color.accent} stopOpacity="0.02" />
              </SvgLinearGradient>
            </Defs>
            {[36, 76].map((y, index) => (
              <React.Fragment key={y}>
                <Line
                  x1="0"
                  x2="300"
                  y1={y}
                  y2={y}
                  stroke={color.lineStrong}
                  strokeDasharray="4 5"
                />
                <SvgText
                  x="308"
                  y={y + 4}
                  fill={color.text3}
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
              stroke={color.accent}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Circle
              cx={path.lastX}
              cy={path.lastY}
              r="5"
              fill={color.accent}
              stroke={color.text1}
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

const ActivityCard: React.FC<{
  data: TrafficRollupBase;
  listingType: TrafficListingType;
  fillHeight: boolean;
}> = ({ data, listingType, fillHeight }) => {
  const copy = trafficOutcomeCopy(listingType);
  const rows = [
    { label: "Page visits", value: data.totals.pageViews },
    {
      label: copy.actionLabel,
      value: primaryActionCount(data.ctas, listingType),
    },
    ...(copy.showsCheckout
      ? [
          {
            label:
              listingType === "brand"
                ? "Checkouts started · paid only"
                : "Checkouts started",
            value: data.totals.checkoutStarts,
          },
        ]
      : []),
    { label: copy.outcomeLabel, value: data.totals.bookings },
  ];
  const basis = Math.max(rows[0]?.value ?? 0, 1);
  return (
    <GlassCard
      variant="elevated"
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-activity-card"
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        {copy.pathTitle}
      </Text>
      <Text style={styles.cardNote}>
        {listingType === "brand"
          ? "Counts are separate facts, not one universal funnel."
          : "Only the primary action appears in this path."}
      </Text>
      <View
        style={styles.funnel}
        accessibilityRole="image"
        accessibilityLabel={`${copy.pathTitle}, ${rows
          .map((row) => `${row.label} ${count(row.value)}`)
          .join(", ")}`}
      >
        {rows.map((row) => (
          <View
            key={row.label}
            testID={`traffic-activity-${row.label.toLowerCase().replaceAll(" ", "-")}`}
          >
            <View style={styles.funnelLabelRow}>
              <Text style={styles.funnelLabel}>{row.label}</Text>
              <Text style={styles.funnelCount}>{count(row.value)}</Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.funnelFill,
                  {
                    width: `${Math.min(100, Math.max(4, (row.value / basis) * 100))}%`,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    </GlassCard>
  );
};

const SourceCard: React.FC<{
  data: TrafficRollupBase;
  fillHeight: boolean;
}> = ({ data, fillHeight }) => {
  const hasTraffic =
    data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const total = data.sources.reduce((sum, row) => sum + row.visitors, 0);
  const mingla = data.sources
    .filter((row) => MINGLA_SOURCES.has(row.source))
    .reduce((sum, row) => sum + row.visitors, 0);
  return (
    <GlassCard
      variant="elevated"
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-sources-card"
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        Where visitors came from
      </Text>
      <Text style={styles.cardNote}>
        Visitors are counted once per day under their first source.
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
            accessibilityLabel={`Mingla sources, ${percentage(mingla, total)} percent of visitors`}
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
            {`Mingla sources · ${percentage(mingla, total)}% of visitors`}
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

const CompletedCard: React.FC<{
  bookings: number;
  listingType: TrafficListingType;
  fillHeight: boolean;
}> = ({ bookings, listingType, fillHeight }) => {
  const copy = trafficOutcomeCopy(listingType);
  return (
    <GlassCard
      variant="elevated"
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-completed-so-far"
    >
      <Text style={styles.eyebrow}>COMPLETED SO FAR</Text>
      <Text style={styles.completedValue}>
        {`${count(bookings)} ${copy.outcomeLower}`}
      </Text>
      <Text style={styles.cardNote}>
        This outcome is already known. A conversion rate will appear only after
        the visit window is comparable.
      </Text>
    </GlassCard>
  );
};

const PageListCard: React.FC<{
  pages: TrafficPageRow[];
  selected: TrafficPageRow | null;
  onSelect: (page: TrafficPageRow) => void;
  captureStartedAt: string | null;
  enoughTraffic: boolean;
  windowComplete: boolean;
  fillHeight: boolean;
}> = ({
  pages,
  selected,
  onSelect,
  captureStartedAt,
  enoughTraffic,
  windowComplete,
  fillHeight,
}) => {
  const max = Math.max(...pages.map((page) => page.pageViews), 1);
  return (
    <GlassCard
      variant="elevated"
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-pages-card"
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        Your pages
      </Text>
      <Text style={styles.cardNote}>
        Each page uses its real completed outcome.
      </Text>
      {!enoughTraffic ? (
        <Text style={styles.collecting}>
          {collectingCopy(captureStartedAt)}
        </Text>
      ) : (
        <View style={styles.pageRows}>
          {pages.map((page) => {
            const rate = visitToPaidRate(page.bookings, page.pageViews);
            const copy = trafficOutcomeCopy(page.listingType);
            const isBrandPage = page.listingType === "brand";
            const active =
              selected?.entityType === page.entityType &&
              selected.entityId === page.entityId;
            return (
              <Pressable
                key={`${page.entityType}:${page.entityId ?? "brand"}`}
                onPress={() => onSelect(page)}
                accessibilityRole="button"
                accessibilityLabel={[
                  page.title,
                  `${count(page.pageViews)} visits`,
                  ...(!isBrandPage
                    ? [`${count(page.bookings)} ${copy.outcomeLower}`]
                    : []),
                ].join(", ")}
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
                  <Text style={styles.pageMeta}>
                    {isBrandPage
                      ? "Brand page"
                      : !windowComplete
                        ? `${copy.pageTypeLabel} · Tracking window is partial`
                        : `${copy.pageTypeLabel} · ${rate === null ? "—" : `${rate.toFixed(1)}%`} visit → ${copy.outcomeSingular}`}
                  </Text>
                </View>
                <View style={styles.pageRight}>
                  <Text style={styles.pageVisits}>
                    {`${count(page.pageViews)} visits`}
                  </Text>
                  {isBrandPage ? null : (
                    <Text style={styles.pageSold}>
                      {`${count(page.bookings)} ${copy.outcomeLower}`}
                    </Text>
                  )}
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
  fillHeight: boolean;
}> = ({
  page,
  data,
  isLoading,
  isError,
  onRetry,
  onOpenListing,
  fillHeight,
}) => {
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
  const copy = trafficOutcomeCopy(page.listingType);
  return (
    <GlassCard
      variant="elevated"
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-page-detail-card"
    >
      <Text style={styles.eyebrow}>{copy.pageTypeLabel.toUpperCase()}</Text>
      <Text style={styles.detailTitle} numberOfLines={2}>
        {page.title}
      </Text>
      <View style={styles.miniRow}>
        <MiniStat label="Visitors" value={count(data.totals.visitors)} />
        <MiniStat
          label={copy.actionLabel}
          value={count(primaryActionCount(data.ctas, page.listingType))}
        />
        <MiniStat
          label={copy.outcomeLabel}
          value={count(data.totals.bookings)}
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

const ButtonTapsCard: React.FC<{
  data: TrafficRollupBase;
  listingType: TrafficListingType;
  fillHeight: boolean;
}> = ({ data, listingType, fillHeight }) => {
  const copy = trafficOutcomeCopy(listingType);
  const groups = [
    {
      label: listingType === "brand" ? "Primary actions" : copy.actionLabel,
      keys: copy.primaryCtas,
    },
    ...SECONDARY_CTA_GROUPS,
  ];
  const values = groups.map((group) => ({
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
      padding={space[6]}
      style={styles.card}
      contentStyle={styles.cardContent}
      fillHeight={fillHeight}
      testID="traffic-button-taps-card"
    >
      <Text style={styles.cardTitle} accessibilityRole="header">
        Button taps
      </Text>
      <Text style={styles.cardNote}>
        Actions are grouped by intent; they are not treated as funnel steps.
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
                  {
                    width: `${Math.min(100, Math.max(3, (row.count / max) * 100))}%`,
                  },
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
  data.ctas.filter((row) => row.count > 0).length;

export interface TrafficAnalyticsDashboardProps {
  data: BrandTrafficRollup | EntityTrafficRollup | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  range: TrafficRange;
  onRangeChange: (range: TrafficRange) => void;
  isWideDesktop: boolean;
  /** Omit for brand analytics; listing insights must pass the real listing kind. */
  listingType?: TrafficListingType;
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
  listingType,
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
    const loadingModules = [6, 6, 12] as const;
    return (
      <View style={styles.dashboard}>
        <TrafficRangeControl value={range} onChange={onRangeChange} />
        <View
          style={[styles.loadingGrid, isWideDesktop && styles.loadingGridWide]}
        >
          {loadingModules.map((width, index) => (
            <View
              key={index}
              style={
                isWideDesktop
                  ? [styles.loadingCell, width === 12 && styles.loadingCellFull]
                  : undefined
              }
            >
              <AnalyticsModuleSkeleton
                testID={`traffic-analytics-loading-${index}`}
              />
            </View>
          ))}
        </View>
      </View>
    );
  }
  const enoughTraffic =
    data.captureStartedAt !== null && data.totals.pageViews >= 30;
  const resolvedListingType = listingType ?? "brand";
  const showCompleteWindow = enoughTraffic && data.windowComplete;
  const brandPages = pages ?? [];
  const trend = <TrendCard data={data} fillHeight={isWideDesktop} />;
  const activity = (
    <ActivityCard
      data={data}
      listingType={resolvedListingType}
      fillHeight={isWideDesktop}
    />
  );
  const sources = <SourceCard data={data} fillHeight={isWideDesktop} />;
  const completed =
    data.totals.bookings > 0 ? (
      <CompletedCard
        bookings={data.totals.bookings}
        listingType={resolvedListingType}
        fillHeight={isWideDesktop}
      />
    ) : null;
  const taps = (
    <ButtonTapsCard
      data={data}
      listingType={resolvedListingType}
      fillHeight={isWideDesktop}
    />
  );
  const pageList =
    !enoughTraffic ||
    pages === undefined ||
    onSelectPage === undefined ? null : (
      <PageListCard
        pages={brandPages}
        selected={selectedPage}
        onSelect={onSelectPage}
        captureStartedAt={data.captureStartedAt}
        enoughTraffic={enoughTraffic}
        windowComplete={data.windowComplete}
        fillHeight={isWideDesktop}
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
        fillHeight={isWideDesktop}
      />
    );
  const showTaps = visibleButtonTapTypeCount(data) >= 2;
  const nodes: Partial<Record<AnalyticsGridModuleId, React.ReactNode>> = {
    visits: trend,
    activity,
    sources,
    completed,
    pages: pageList,
    selectedPage: pageDetail,
    buttonTaps: taps,
    regulars: regularsModule,
    customerPatterns: customerPatternsModule,
  };
  const modules = analyticsGridModules({
    showVisits: enoughTraffic,
    showActivity: showCompleteWindow,
    showSources: enoughTraffic,
    showCompleted: !enoughTraffic && completed !== null,
    showPages: enoughTraffic && pageList !== null,
    showSelectedPage: enoughTraffic && isWideDesktop && pageDetail !== null,
    showButtonTaps: enoughTraffic && showTaps,
    showRegulars:
      enoughTraffic && regularsModule !== undefined && regularsModule !== null,
    showCustomerPatterns:
      enoughTraffic &&
      customerPatternsModule !== undefined &&
      customerPatternsModule !== null,
  });
  const collecting = [
    ...(!enoughTraffic
      ? ["visit trend", "source mix", "conversion path"]
      : !data.windowComplete
        ? ["conversion path"]
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
      {isWideDesktop
        ? packAnalyticsGrid(modules).map((row, rowIndex) => (
            <View
              key={rowIndex}
              style={styles.gridRow}
              testID={`traffic-grid-row-${rowIndex}`}
            >
              {row.map((module) => (
                <View
                  key={module.id}
                  style={[styles.gridCell, { flex: module.width }]}
                >
                  {nodes[module.id]}
                </View>
              ))}
            </View>
          ))
        : modules
            .filter((module) => module.id !== "selectedPage")
            .map((module) => <View key={module.id}>{nodes[module.id]}</View>)}
      {!isWideDesktop && enoughTraffic && pageDetail !== null ? (
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
            <Pressable
              style={styles.sheet}
              onPress={(event) => event.stopPropagation()}
            >
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
  dashboard: { gap: space[6] },
  loadingGrid: { gap: space[4] },
  loadingGridWide: { flexDirection: "row", flexWrap: "wrap", gap: space[6] },
  loadingCell: { flexGrow: 1, flexBasis: "46%", minWidth: 0 },
  loadingCellFull: { flexBasis: "100%" },
  errorBanner: {
    minHeight: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.danger,
    backgroundColor: color.errorTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  errorBannerText: {
    ...type.small,
    color: color.text1,
    flex: 1,
  },
  errorRetry: { minHeight: 44, justifyContent: "center" },
  errorRetryText: {
    ...type.btnSm,
    color: color.accent,
  },
  rangeControl: {
    flexDirection: "row",
    padding: space[1],
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  rangeButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: space[1],
  },
  rangeButtonSelected: { backgroundColor: color.accentLine },
  rangeLabel: {
    color: color.text2,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.fontWeight,
  },
  rangeLabelSelected: { color: color.text1, fontWeight: "700" },
  coverageNote: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    marginTop: -space[2],
  },
  pressed: { opacity: 0.68 },
  card: { minWidth: 0, flex: 1 },
  cardContent: { flex: 1 },
  eyebrow: {
    color: color.text3,
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
  },
  miniRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[4],
    marginTop: space[6],
  },
  miniStat: { flexGrow: 1, flexBasis: 112, minWidth: 0 },
  miniValue: {
    color: color.text1,
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  miniLabel: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    marginTop: space[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[2],
  },
  cardTitle: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  cardNote: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[1],
  },
  completedValue: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    marginTop: space[2],
    fontVariant: ["tabular-nums"],
  },
  totalAtRight: {
    color: color.text1,
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  collecting: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[4],
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space[1],
  },
  chartFill: { flex: 1, justifyContent: "center" },
  axisText: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  funnel: { gap: space[1], marginTop: space[4] },
  funnelLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space[2],
  },
  funnelLabel: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  funnelCount: {
    color: color.text1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 5,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.lineStrong,
    marginTop: space[1],
  },
  funnelFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  sourceBar: {
    height: 14,
    borderRadius: radius.full,
    overflow: "hidden",
    flexDirection: "row",
    marginTop: space[6],
  },
  bracketLine: {
    height: 8,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: color.accentLine,
    alignSelf: "flex-start",
    marginTop: space[1],
  },
  broughtLine: {
    color: color.accent,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    marginTop: space[1],
  },
  sourceRows: { marginTop: space[4] },
  sourceRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  swatch: { width: 10, height: 10, borderRadius: radius.full },
  sourceName: {
    flex: 1,
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  sourceNameMingla: { color: color.text1, fontWeight: "600" },
  sourceNumber: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontVariant: ["tabular-nums"],
  },
  pageRows: { marginTop: space[2] },
  pageRow: {
    minHeight: 64,
    paddingVertical: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  pageRowSelected: { backgroundColor: trafficAnalytics.selectedPageTint },
  pageCopy: { flex: 1, minWidth: 0, paddingBottom: space[2] },
  pageTitle: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  pageMeta: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  pageRight: { alignItems: "flex-end", paddingBottom: space[2] },
  pageVisits: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  pageSold: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  pageMeterTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: space[1],
    height: 2,
    backgroundColor: color.line,
    overflow: "hidden",
  },
  pageMeterFill: { height: "100%", backgroundColor: color.accent },
  detailTitle: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    marginTop: space[1],
  },
  detailValue: {
    color: color.text1,
    fontSize: type.stat.fontSize,
    lineHeight: type.stat.lineHeight,
    fontWeight: type.stat.fontWeight,
    fontVariant: ["tabular-nums"],
    marginTop: space[2],
  },
  detailLink: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: "auto",
    paddingTop: space[4],
  },
  detailLinkText: {
    color: color.accent,
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
  },
  tapGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[4],
  },
  tapTile: {
    flexGrow: 1,
    flexBasis: 138,
    minWidth: 0,
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  tapCount: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    fontVariant: ["tabular-nums"],
  },
  tapLabel: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  tapFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: trafficAnalytics.tapMeter,
  },
  collectingLine: {
    ...type.small,
    color: color.text2,
    marginTop: -space[2],
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space[6],
  },
  gridCell: { minWidth: 0 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: color.canvas,
  },
  sheet: {
    maxHeight: "88%",
    padding: space[4],
    paddingBottom: space[7],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.canvas,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: color.text4,
    alignSelf: "center",
    marginBottom: space[4],
  },
});

export default TrafficAnalyticsDashboard;
