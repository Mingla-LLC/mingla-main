import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  accent,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { VenueOrganicInsights } from "../../services/venueOrganicInsightsService";
import { GlassCard } from "../ui/GlassCard";

interface Props {
  data: VenueOrganicInsights | null;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
}

const countLabel = (count: number, singular: string): string =>
  `${count.toLocaleString()} ${count === 1 ? singular : `${singular}s`}`;

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <View style={styles.metric} accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function VenueOrganicEngagementSection({
  data,
  isLoading,
  isError,
  isFetching,
  onRetry,
}: Props): React.ReactElement {
  if (isLoading && data === null) {
    return (
      <View accessibilityLabel="Loading organic engagement">
        {[0, 1, 2].map((key) => (
          <GlassCard key={key} variant="base" padding={spacing.lg}>
            <View style={styles.skeleton}>
              <ActivityIndicator color={accent.warm} />
            </View>
          </GlassCard>
        ))}
      </View>
    );
  }
  if (data?.authorized === false) {
    return (
      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.title}>Organic engagement unavailable</Text>
        <Text style={styles.body}>
          You don&apos;t have permission to view engagement for this venue.
        </Text>
      </GlassCard>
    );
  }
  if ((isError && data === null) || data === null) {
    return (
      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.title}>Couldn&apos;t load organic engagement</Text>
        <Text style={styles.body}>Check your connection and try again.</Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry organic engagement"
          style={styles.retry}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </GlassCard>
    );
  }

  const noActivity =
    data.pageViews === 0 &&
    data.menuOpens === 0 &&
    data.reservationStarts === 0;
  const tracking = !data.windowComplete
    ? `Tracking began ${new Date(data.captureStartedAt).toLocaleDateString()}`
    : null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Organic engagement</Text>
          <Text style={styles.body}>
            Unpaid activity on this venue&apos;s Mingla page.
          </Text>
        </View>
        {isFetching ? (
          <ActivityIndicator
            color={accent.warm}
            accessibilityLabel="Updating organic engagement"
          />
        ) : null}
      </View>
      {tracking !== null ? <Text style={styles.tracking}>{tracking}</Text> : null}
      {isError ? (
        <View style={styles.staleRow}>
          <Text style={styles.stale}>
            {`Last updated ${new Date(data.aggregatedAt).toLocaleTimeString()}`}
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry organic engagement"
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.updated}>
          {`Updated ${new Date(data.aggregatedAt).toLocaleTimeString()}`}
        </Text>
      )}

      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.title}>Venue page activity</Text>
        <Text style={styles.window}>LAST 30 DAYS</Text>
        <Text style={styles.body}>
          Event counts from unpaid visits to this venue&apos;s Mingla page. Page
          views are not unique people.
        </Text>
        {noActivity ? (
          <>
            <Text style={styles.emptyTitle}>No organic page activity yet</Text>
            <Text style={styles.body}>
              Views and actions appear after people explore this venue through an
              unpaid Mingla path.
            </Text>
          </>
        ) : null}
        <View style={styles.metrics}>
          <Metric label="Page views" value={data.pageViews.toLocaleString()} />
          <Metric
            label="Menu opens"
            value={data.menuPublished
              ? data.menuOpens.toLocaleString()
              : "Menu not published"}
          />
          <Metric
            label="Reservation starts"
            value={data.reservationsEnabled
              ? data.reservationStarts.toLocaleString()
              : "Reservations not enabled"}
          />
        </View>
      </GlassCard>

      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.title}>When people browse online</Text>
        <Text style={styles.window}>
          {`LAST 30 DAYS · TIMES IN ${data.resolvedTimezone}`}
        </Text>
        <Text style={styles.body}>
          Online venue-page views by time of day — not physical visits.
        </Text>
        {data.pageViews === 0 ? (
          <>
            <Text style={styles.emptyTitle}>No online browsing pattern yet</Text>
            <Text style={styles.body}>
              Times appear after this venue receives organic page views.
            </Text>
          </>
        ) : (
          <View style={styles.dayparts}>
            {([
              ["Morning", data.dayparts.morning],
              ["Afternoon", data.dayparts.afternoon],
              ["Evening", data.dayparts.evening],
              ["Late night", data.dayparts.lateNight],
            ] as const).map(([label, value]) => (
              <View
                key={label}
                style={styles.daypart}
                accessibilityLabel={`${label}: ${countLabel(value, "page view")}`}
              >
                <Text style={styles.metricLabel}>{label}</Text>
                <Text style={styles.metricValue}>{countLabel(value, "page view")}</Text>
              </View>
            ))}
          </View>
        )}
        {data.timezoneConfidence !== "iana" ? (
          <Text style={styles.caveat}>
            Times are approximate — set your venue timezone for precision.
          </Text>
        ) : null}
      </GlassCard>

      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.title}>Organic reservation journey</Text>
        <Text style={styles.window}>LAST 30 DAYS</Text>
        <Text style={styles.body}>
          Unpaid actions from opening reservations to making one.
        </Text>
        {!data.reservationsEnabled ? (
          <>
            <Text style={styles.emptyTitle}>Reservations not enabled</Text>
            <Text style={styles.body}>
              Turn on Reservations to start measuring this journey.
            </Text>
          </>
        ) : data.reservationStarts === 0 &&
          data.availabilityShown === 0 &&
          data.reservationsMade === 0 ? (
          <>
            <Text style={styles.emptyTitle}>
              No organic reservation activity yet
            </Text>
            <Text style={styles.body}>
              This journey appears after someone starts a reservation through an
              unpaid Mingla path.
            </Text>
          </>
        ) : (
          <View style={styles.metrics}>
            <Metric label="Reservation starts" value={data.reservationStarts.toLocaleString()} />
            <Metric label="Availability shown" value={data.availabilityShown.toLocaleString()} />
            <Metric label="Reservations made" value={data.reservationsMade.toLocaleString()} />
          </View>
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  title: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
  body: { color: textTokens.secondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  window: { color: accent.warm, fontSize: 11, fontWeight: "800", marginTop: 4 },
  tracking: { color: textTokens.secondary, fontSize: 12 },
  updated: { color: textTokens.tertiary, fontSize: 12 },
  stale: { color: semantic.warning, fontSize: 12, flex: 1 },
  staleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  skeleton: { minHeight: 132, alignItems: "center", justifyContent: "center" },
  metrics: { gap: spacing.md, marginTop: spacing.md },
  metric: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  metricLabel: { color: textTokens.secondary, fontSize: 14, flexShrink: 1 },
  metricValue: { color: textTokens.primary, fontSize: 14, fontWeight: "800", textAlign: "right" },
  emptyTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "700", marginTop: spacing.md },
  dayparts: { gap: spacing.sm, marginTop: spacing.md },
  daypart: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  caveat: { color: textTokens.secondary, fontSize: 12, lineHeight: 17, marginTop: spacing.md },
  retry: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    alignSelf: "flex-start",
  },
  retryText: { color: accent.warm, fontSize: 14, fontWeight: "800" },
});
