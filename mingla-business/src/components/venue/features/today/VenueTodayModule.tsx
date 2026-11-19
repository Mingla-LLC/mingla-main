/**
 * #4490 P2-5 — Today (`td`, `ph-today`): the run-sheet for the venue's day
 * from `issue_4490_venue_day`. Head line with Open check-in, four tiles, what
 * is on sale today and today's bookings (online and at the gate) with their
 * state. Phone: rows plus a pinned Scan a pass. Refreshes every 30 seconds.
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { color, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import type { VenueModule } from "../../../../types/venueReservation";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { KpiTile } from "../../../ui/KpiTile";
import { Pill } from "../../../ui/Pill";
import { Skeleton } from "../../../ui/Skeleton";
import { entryStyleLabel, money } from "../offers/offersModel";
import { bookingSourceLabel, bookingStateLabel, dayHeadline, dayNumbers } from "./todayModel";

export interface VenueTodayModuleProps {
  brandId: string | null;
  venueId: string | null;
  onOpenModule?: (module: VenueModule) => void;
}

export function VenueTodayModule({ brandId, venueId, onOpenModule }: VenueTodayModuleProps): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const currency = useBrandCurrency(brandId);
  const dayQuery = useVenueDay(brandId, venueId, null, { live: true });

  const openScan = (): void => {
    if (Platform.OS !== "web" && venueId !== null) {
      router.push(`/venue/${venueId}/check-in/scan` as never);
      return;
    }
    onOpenModule?.("checkin");
  };

  if (dayQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-today-loading" accessibilityLabel="Loading today">
        <Skeleton height={28} width="30%" />
        <View style={styles.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={84} radius="md" />
          ))}
        </View>
        <Skeleton height={56} radius="md" />
      </View>
    );
  }
  if (dayQuery.isError || dayQuery.data === undefined) {
    return (
      <CenteredState title="Couldn't load today" body="Your bookings are safe. Check your connection and try again." tone="error" testID="venue-today-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void dayQuery.refetch()} />
      </CenteredState>
    );
  }

  const day = dayQuery.data;
  const n = dayNumbers(day);
  const cur = n.currencyCode ?? currency;
  const onSale = day.offers.filter((o) => o.status === "live" || o.status === "paused");
  const bookings = [...day.bookings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <View style={styles.host} testID="venue-today-module">
      <View style={styles.header}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header">Today</Text>
          <Text style={styles.meta}>{dayHeadline(day)}</Text>
        </View>
        {isWideDesktop ? (
          <Button label="Open check-in" variant="primary" size="sm" leadingIcon="scan" onPress={() => onOpenModule?.("checkin")} testID="venue-today-open-checkin" />
        ) : null}
      </View>

      {day.closed ? <Text style={styles.closed}>The venue is closed today. Nothing is on sale.</Text> : null}

      <View style={styles.tiles}>
        <View style={styles.tile}>
          <KpiTile
            label="In the venue"
            value={n.inNow}
            sub={n.dailyLimit !== null ? `of ${n.dailyLimit.toLocaleString("en-GB")} today` : undefined}
            testID="venue-today-tile-in"
          />
        </View>
        <KpiTile label="Still to arrive" value={n.toArrive} sub={`${n.soldToday} sold for today`} style={styles.tile} />
        <KpiTile
          label="Kept for walk-ins"
          value={n.walkInLeft ?? 0}
          sub={n.keptForWalkIns !== null ? `of ${n.keptForWalkIns} left at the gate` : "No day limit set"}
          style={styles.tile}
          testID="venue-today-tile-walkins"
        />
        <KpiTile
          label="Taken today"
          value={money(n.takenMinor, cur)}
          sub={n.takenAtGateMinor > 0 ? `${money(n.takenAtGateMinor, cur)} at the gate` : "Online and at the gate"}
          style={styles.tile}
        />
      </View>

      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-today-on-sale">
        <Text style={styles.sectionLabel}>On sale today</Text>
        {onSale.length === 0 ? (
          <Text style={[styles.meta, styles.pad]}>Nothing on sale today. Publish an offer in Offers.</Text>
        ) : (
          onSale.map((o) => (
            <View key={o.offerId} style={[styles.row, styles.rowBorder]}>
              <View style={styles.cellText}>
                <Text style={styles.rowTitle}>{o.name}</Text>
                <Text style={styles.meta}>
                  {o.kind === "entry" ? entryStyleLabel(o.entryStyle) : "Offer"} · {o.sold} sold
                  {o.held > 0 ? ` · ${o.held} paying now` : ""}
                </Text>
              </View>
              <Pill variant={o.status === "live" ? "ok" : "warn"}>{o.status === "live" ? "On sale" : "Paused"}</Pill>
            </View>
          ))
        )}
      </GlassCard>

      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-today-bookings">
        <Text style={styles.sectionLabel}>Bookings for today</Text>
        {bookings.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing booked today</Text>
            <Text style={styles.meta}>Online bookings and gate sales for today show here.</Text>
          </View>
        ) : (
          bookings.map((b) => {
            const st = bookingStateLabel(b);
            return (
              <View key={b.groupId} style={[styles.row, styles.rowBorder]}>
                <View style={styles.cellText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{b.guestName}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {b.reference} · {bookingSourceLabel(b)} · {money(b.totalMinor, b.currencyCode ?? cur)}
                  </Text>
                </View>
                <Text style={styles.guests}>{b.guests}</Text>
                <Pill variant={st.variant}>{st.label}</Pill>
              </View>
            );
          })
        )}
      </GlassCard>

      {!isWideDesktop ? (
        <View style={styles.pinned}>
          <Button label="Scan a pass" variant="primary" size="lg" fullWidth leadingIcon="scan" onPress={openScan} testID="venue-today-scan" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  headText: { gap: 2, flexShrink: 1 },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  closed: { ...type.small, color: color.warning },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { flexGrow: 1, flexBasis: 160, minWidth: 150, gap: space[1] },
  meter: { marginTop: space[1] },
  listCard: { overflow: "hidden" },
  sectionLabel: { ...type.label, color: color.text3, paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2] },
  pad: { paddingHorizontal: space[4], paddingBottom: space[3] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: 56 },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  cellText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  guests: { ...type.small, color: color.text2, minWidth: 32, textAlign: "right" },
  empty: { gap: space[1], paddingHorizontal: space[4], paddingBottom: space[4] },
  emptyTitle: { ...type.row, color: color.text1 },
  pinned: { paddingTop: space[2] },
});
