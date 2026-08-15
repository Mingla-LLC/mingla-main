import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { VenueOrderMetrics } from "../../../services/venueOrderMetricsService";
import { formatCurrencyRound } from "../../../utils/currency";
import { GlassCard } from "../../ui/GlassCard";

export interface OrderInsightsInstrumentProps {
  query: UseQueryResult<VenueOrderMetrics, Error>;
  offline: boolean;
  onRetry: () => void;
}

const moneyRows = (money: Record<string, number>): React.ReactElement[] =>
  Object.entries(money).map(([currency, cents]) => (
    <Text key={currency} style={styles.metricValue}>
      {`${currency} ${formatCurrencyRound(cents, currency, true)}`}
    </Text>
  ));

const labeledMoneyRows = (
  label: string,
  money: Record<string, number>,
): React.ReactElement[] =>
  Object.entries(money).map(([currency, cents]) => (
    <Text key={`${label}-${currency}`} style={styles.body}>
      {`${currency} ${label}: ${formatCurrencyRound(cents, currency, true)}`}
    </Text>
  ));

const moneyAccessibility = (
  label: string,
  money: Record<string, number>,
): string =>
  Object.entries(money)
    .map(([currency, cents]) => `${currency} ${label} ${formatCurrencyRound(cents, currency, true)}`)
    .join(", ");

const withMoneyAccessibility = (
  prefix: string,
  label: string,
  money: Record<string, number>,
): string => {
  const values = moneyAccessibility(label, money);
  return values.length > 0 ? `${prefix}, ${values}` : prefix;
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement => (
  <GlassCard variant="base" padding={spacing.lg}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </GlassCard>
);

export function OrderInsightsInstrument({
  query,
  offline,
  onRetry,
}: OrderInsightsInstrumentProps): React.ReactElement | null {
  const data = query.data;

  if (query.isLoading && data === undefined) {
    return (
      <GlassCard variant="base" padding={spacing.lg}>
        <View style={styles.statusRow} accessibilityRole="progressbar" accessibilityLabel="Loading venue order insights">
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.body}>Loading venue orders…</Text>
        </View>
      </GlassCard>
    );
  }
  if ((query.isError || (offline && data === undefined)) && data === undefined) {
    return (
      <GlassCard variant="base" padding={spacing.lg}>
        <Text style={styles.sectionTitle}>{offline ? "You're offline" : "Couldn't load venue orders"}</Text>
        <Text style={styles.body}>{offline ? "Reconnect, then try again." : "Your order data is safe. Try the read again."}</Text>
        <Pressable
          style={styles.retry}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry venue order insights"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </GlassCard>
    );
  }
  if (data === undefined || !data.authorized) return null;

  const incompleteCurrencies = Object.entries(data.moneyStateByCurrency)
    .filter(([, state]) => state === "partial_refund_unallocated")
    .map(([currency]) => currency);
  const emptySpendPerOrderMessage = incompleteCurrencies.length > 0
    ? "Unavailable while a partial refund is unallocated."
    : data.orders30d === 0
      ? "Your order numbers will appear after your first completed order."
      : "No spend-per-order number is available.";
  const refreshing = query.isFetching && !query.isLoading;
  const status = offline ? "Offline — showing saved order numbers." : refreshing ? "Updating order numbers." : "";

  return (
    <View style={styles.root} testID="order-insights-instrument">
      <Text style={styles.srOnly} accessibilityLiveRegion="polite">
        {status}
      </Text>
      {status.length > 0 ? <Text style={styles.statusText}>{status}</Text> : null}
      {data.window.thinLabel !== null ? (
        <Text style={styles.thinLabel}>{data.window.thinLabel}</Text>
      ) : null}
      {incompleteCurrencies.length > 0 ? (
        <View style={styles.warning} accessibilityRole="alert">
          <Text style={styles.warningText}>
            {`Money is withheld for ${incompleteCurrencies.join(", ")} because a partial refund has no recorded split across sales, tips, tax, and fees. Counts remain exact.`}
          </Text>
        </View>
      ) : null}

      <Section title="Orders and sales">
        <Text style={styles.metricValue}>{`${data.orders30d} orders in 30 days`}</Text>
        {moneyRows(data.salesCents30d)}
        {Object.keys(data.salesCents30d).length === 0 ? <Text style={styles.body}>No complete-currency sales total is available.</Text> : null}
        {Object.entries(data.tipsCents30d).map(([currency, cents]) => (
          <Text key={currency} style={styles.body}>{`${currency} tips: ${formatCurrencyRound(cents, currency, true)}`}</Text>
        ))}
      </Section>

      <Section title="Spend per order">
        {Object.entries(data.spendPerOrder).map(([currency, row]) => (
          <Text key={currency} style={styles.body}>
            {`${currency} ${formatCurrencyRound(row.averageCents, currency, true)} across ${row.orders} orders`}
          </Text>
        ))}
        {Object.keys(data.spendPerOrder).length === 0 ? (
          <Text style={styles.body}>{emptySpendPerOrderMessage}</Text>
        ) : null}
      </Section>

      <Section title="Measured spend per cover">
        {Object.entries(data.spendPerCoverTierA).map(([currency, row]) => (
          <View key={currency} style={styles.stack}>
            <Text style={styles.metricValue}>
              {row.averageCents === null ? `${currency} — no measured covers` : `${currency} ${formatCurrencyRound(row.averageCents, currency, true)}`}
            </Text>
            <Text style={styles.body}>{row.label}</Text>
          </View>
        ))}
        {Object.keys(data.spendPerCoverTierA).length === 0 ? <Text style={styles.body}>No exact reservation-linked covers yet.</Text> : null}
      </Section>

      <Section title="Reservation attach">
        <Text style={styles.body}>
          {data.attachCounts.state === "not_applicable"
            ? "Reservations are off for this venue."
            : `${data.attachCounts.orderedReservations} of ${data.attachCounts.seatedReservations} seated or completed reservations had an order.`}
        </Text>
      </Section>

      <Section title="Item velocity">
        {data.itemsByVelocity.map((item) => (
          <View key={item.menuItemId} style={styles.tableRow} accessibilityLabel={withMoneyAccessibility(`${item.itemNameSnapshot}, ${item.quantity} sold across ${item.orders} orders`, "item sales", item.salesCents)}>
            <Text style={styles.rowLabel}>{item.itemNameSnapshot}</Text>
            <View style={styles.stack}>
              <Text style={styles.rowValue}>{`${item.quantity} sold · ${item.unitsPerServiceDay}/service day`}</Text>
              {labeledMoneyRows("item sales", item.salesCents)}
            </View>
          </View>
        ))}
        {data.itemsByVelocity.length === 0 ? <Text style={styles.body}>Sold items will appear here.</Text> : null}
      </Section>

      <Section title="Zones and current seats">
        {data.revenueByZone.map((zone) => (
          <View key={zone.zone} style={styles.stack} accessibilityLabel={withMoneyAccessibility(`${zone.zone}, ${zone.orders} orders, ${zone.sessions} sessions`, "sales per current seat", zone.salesPerCurrentSeatCents)}>
            <Text style={styles.rowLabel}>{zone.zone}</Text>
            <Text style={styles.body}>{`${zone.orders} orders · ${zone.sessions} sessions`}</Text>
            <Text style={styles.body}>{zone.currentSeatCapacity === null ? "Current seats unavailable" : `${zone.currentSeatCapacity} current active seats`}</Text>
            {moneyRows(zone.salesCents)}
            {labeledMoneyRows("sales per current seat", zone.salesPerCurrentSeatCents)}
          </View>
        ))}
        {data.revenueByZone.length === 0 ? <Text style={styles.body}>Zone performance appears after orders.</Text> : null}
      </Section>

      <Section title="Rooms">
        {data.revenueByRoom.map((room) => (
          <View key={room.stayUnitId} style={styles.tableRow} accessibilityLabel={withMoneyAccessibility(`${room.spotLabelSnapshot}, ${room.orders} orders`, "room sales", room.salesCents)}>
            <Text style={styles.rowLabel}>{room.spotLabelSnapshot}</Text>
            <View style={styles.stack}>
              <Text style={styles.rowValue}>{`${room.orders} orders · ${room.sessions} sessions`}</Text>
              {labeledMoneyRows("room sales", room.salesCents)}
            </View>
          </View>
        ))}
        {data.revenueByRoom.length === 0 ? <Text style={styles.body}>Room orders will appear here.</Text> : null}
      </Section>

      <Section title="When orders arrive">
        {data.placedAtByDaypart.map((row) => <Text key={row.daypart} style={styles.body}>{`${row.daypart.replace("_", " ")}: ${row.orders}`}</Text>)}
        {data.placedAtByIsoWeekday.map((row) => <Text key={row.isoWeekday} style={styles.body}>{`ISO weekday ${row.isoWeekday}: ${row.orders}`}</Text>)}
        <Text style={styles.caption}>The daily table includes every venue-local date in the last 30 days, including zero-order dates.</Text>
        {data.daily30d.map((row) => (
          <View key={row.localDate} style={styles.stack}>
            <Text style={styles.body}>{`${row.localDate}: ${row.orders} orders`}</Text>
            {labeledMoneyRows("sales", row.salesCents)}
            {labeledMoneyRows("tips", row.tipsCents)}
          </View>
        ))}
      </Section>

      <Section title="Channels">
        <Text style={styles.body}>{`QR ${data.channelSplit.qr} · page ${data.channelSplit.page} · counter pickup ${data.channelSplit.counter_pickup} · staff ${data.channelSplit.staff}`}</Text>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  sectionBody: { marginTop: spacing.sm, gap: spacing.xs },
  sectionTitle: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.bodySm, color: textTokens.secondary },
  metricValue: { ...typography.bodyLg, fontWeight: "700", color: textTokens.primary },
  caption: { ...typography.caption, color: textTokens.tertiary },
  thinLabel: { ...typography.bodySm, color: textTokens.secondary },
  statusText: { ...typography.caption, color: textTokens.secondary },
  statusRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stack: { gap: 4 },
  tableRow: { minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  rowLabel: { ...typography.bodySm, fontWeight: "600", color: textTokens.primary, flexShrink: 1 },
  rowValue: { ...typography.caption, color: textTokens.secondary },
  warning: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: semantic.warning, backgroundColor: glass.tint.badge.idle, padding: spacing.md },
  warningText: { ...typography.bodySm, color: textTokens.primary },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.badge },
  retryText: { ...typography.bodySm, fontWeight: "600", color: textTokens.primary },
  srOnly: { width: 1, height: 1, opacity: 0, position: "absolute" },
});

export default OrderInsightsInstrument;
