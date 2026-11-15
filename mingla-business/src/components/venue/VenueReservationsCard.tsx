import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { formatCount, formatCurrency } from "../../utils/currency";
import {
  ReservationMetricsUnavailableError,
  type ReservationSource,
  type VenueReservationMetrics,
} from "../../services/reservationMetricsService";
import { GlassCard } from "../ui/GlassCard";
import { venueTimezoneLabel } from "./venueTimezoneLabel";

const SOURCE_LABELS: Record<ReservationSource, string> = {
  mingla: "Mingla",
  website: "Website",
  instagram: "Instagram",
  phone: "Phone",
  walk_in: "Walk-in",
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
  </View>
);

const FeeValues: React.FC<{ values: Record<string, number> }> = ({ values }) => {
  if (Object.keys(values).length === 0) {
    return <Text style={styles.body}>No paid reservation fees yet</Text>;
  }
  return (
    <>
      {Object.entries(values).map(([currency, cents]) => (
        <Text key={currency} style={styles.bodyStrong}>
          {`${formatCurrency(cents, currency, true)} paid fees`}
        </Text>
      ))}
    </>
  );
};

interface VenueReservationsCardProps {
  query: UseQueryResult<VenueReservationMetrics, Error>;
  onRetry: () => void;
}

export type VenueReservationRefreshStatus =
  | "updating"
  | "success"
  | "error"
  | null;

const REFRESH_STATUS_COPY: Record<
  Exclude<VenueReservationRefreshStatus, null>,
  string
> = {
  updating: "Updating reservations…",
  success: "Reservations updated",
  error: "Couldn't refresh reservations",
};

export const VenueReservationRefreshAnnouncement: React.FC<{
  status: VenueReservationRefreshStatus;
}> = ({ status }) =>
  status === null ? null : (
    <View accessibilityLiveRegion="polite">
      <Text style={styles.refreshAnnouncement}>{REFRESH_STATUS_COPY[status]}</Text>
    </View>
  );

export const VenueReservationsCard: React.FC<VenueReservationsCardProps> = ({
  query,
  onRetry,
}) => {
  if (query.isLoading && query.data === undefined) {
    return (
      <GlassCard variant="elevated" padding={space[6]}>
        <View
          style={styles.skeleton}
          testID="venue-reservations-skeleton"
          accessibilityElementsHidden
        />
      </GlassCard>
    );
  }
  const unavailable =
    query.error instanceof ReservationMetricsUnavailableError ||
    query.data?.authorized === false;
  if (unavailable) {
    return (
      <GlassCard variant="elevated" padding={space[6]}>
        <Text style={styles.title} accessibilityRole="header">
          Reservations unavailable
        </Text>
        <Text style={styles.body}>
          You don&apos;t have permission to view reservation performance for this
          venue.
        </Text>
      </GlassCard>
    );
  }
  if (query.isError && query.data === undefined) {
    return (
      <GlassCard variant="elevated" padding={space[6]}>
        <Text style={styles.title} accessibilityRole="header">
          Couldn&apos;t load reservation performance
        </Text>
        <Text style={styles.body}>Check your connection and try again.</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.action}>
          <Text style={styles.actionText}>Retry</Text>
        </Pressable>
      </GlassCard>
    );
  }
  const data = query.data;
  if (data === undefined) return null;
  const hasReservations = data.bySource.some((source) => source.reservations > 0);
  const showNoShowRate = data.coversLifetime > 0 || data.noShowRate > 0;
  return (
    <GlassCard variant="elevated" padding={space[6]}>
      <Text style={styles.title} accessibilityRole="header">
        Reservations
      </Text>
      <Text style={styles.body}>Performance for this venue.</Text>
      {!hasReservations ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.bodyStrong}>No reservation performance yet</Text>
          <Text style={styles.body}>
            Metrics appear after this venue receives reservations.
          </Text>
        </View>
      ) : null}
      <View style={styles.metricGrid}>
        <Metric
          label="LAST 30 DAYS"
          value={`${formatCount(data.covers30d)} ${
            data.covers30d === 1 ? "cover" : "covers"
          }`}
        />
        <Metric
          label="ALL TIME"
          value={`${formatCount(data.coversLifetime)} ${
            data.coversLifetime === 1 ? "cover" : "covers"
          }`}
        />
        <Metric
          label="Average party size"
          value={data.averagePartySize.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
        />
        <Metric
          label="No-show rate"
          value={
            showNoShowRate
              ? data.noShowRate.toLocaleString(undefined, {
                  style: "percent",
                  maximumFractionDigits: 1,
                })
              : hasReservations
                ? "Not enough completed visits yet"
                : "—"
          }
        />
      </View>
      <Text style={styles.definition}>
        Covers count people on seated or completed reservations.
      </Text>
      <Text style={styles.definition}>
        No-show rate uses seated, completed and no-show outcomes only.
      </Text>
      <View style={styles.section}>
        <Text style={styles.subtitle} accessibilityRole="header">
          Paid reservation fees
        </Text>
        <Text style={styles.metricLabel}>LAST 30 DAYS</Text>
        <FeeValues values={data.valueCents30d} />
        <Text style={styles.metricLabel}>ALL TIME</Text>
        <FeeValues values={data.valueCentsLifetime} />
      </View>
      <View style={styles.section}>
        <Text style={styles.subtitle} accessibilityRole="header">
          Where reservations came from
        </Text>
        {data.bySource.map((source) => (
          <View key={source.source} style={styles.sourceRow}>
            <Text style={styles.bodyStrong}>{SOURCE_LABELS[source.source]}</Text>
            <Text style={styles.body}>
              {`${formatCount(source.reservations)} ${
                source.reservations === 1 ? "reservation" : "reservations"
              } · ${formatCount(source.covers)} ${
                source.covers === 1 ? "cover" : "covers"
              }`}
            </Text>
          </View>
        ))}
      </View>
      {data.resolvedTimezone === null ? null : (
        <Text style={styles.definition}>
          {`Last 30 days · ${venueTimezoneLabel(data.resolvedTimezone)}`}
        </Text>
      )}
      {query.isError && query.data !== undefined ? (
        <View style={styles.refreshFailure}>
          <Text style={styles.bodyStrong}>Couldn&apos;t refresh reservation performance</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.action}>
            <Text style={styles.actionText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  title: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  subtitle: {
    color: color.text1,
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: type.row.fontWeight,
  },
  body: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[1],
  },
  bodyStrong: {
    color: color.text1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    marginTop: space[1],
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[4],
    marginTop: space[4],
  },
  metric: { minWidth: 130, flexGrow: 1, flexBasis: "45%" },
  metricLabel: {
    color: color.text3,
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    marginTop: space[2],
  },
  metricValue: {
    color: color.text1,
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: type.row.fontWeight,
    marginTop: space[1],
  },
  definition: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    marginTop: space[1],
  },
  emptyBlock: { marginTop: space[2] },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    marginTop: space[4],
    paddingTop: space[4],
  },
  sourceRow: { marginTop: space[2] },
  action: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    marginTop: space[2],
  },
  actionText: {
    color: color.accent,
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
  },
  skeleton: {
    height: 320,
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  refreshFailure: {
    marginTop: space[4],
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  refreshAnnouncement: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginBottom: space[2],
  },
});

export default VenueReservationsCard;
