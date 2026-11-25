/**
 * #4490 P2-5 — Today (`td`, `ph-today`): the run-sheet for the venue's day
 * from `issue_4490_venue_day`. Head line with Open check-in, four tiles, what
 * is on sale today and today's bookings (online and at the gate) with their
 * state. Phone: rows plus a pinned Scan a pass. Refreshes every 30 seconds.
 */
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { color, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useVenueDay } from "../../../../hooks/useVenueDay";
import { useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import type { VenueModule } from "../../../../types/venueReservation";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { GlassCard } from "../../../ui/GlassCard";
import { KpiTile } from "../../../ui/KpiTile";
import { Pill } from "../../../ui/Pill";
import { Skeleton } from "../../../ui/Skeleton";
import { dayDateLabel } from "../../../ui/fieldModels";
import { IconChrome } from "../../../ui/IconChrome";
import { VenueBookingSheet } from "../bookings/VenueBookingSheet";
import { RequestsWaitingCard } from "../requests/RequestsWaitingCard";
import { clockIn } from "../bookings/bookingModel";
import { entryStyleLabel, money } from "../offers/offersModel";
import { TodayMoneyTiles } from "./TodayMoneyTiles";
import { bookingSourceLabel, bookingStateLabel, dayBalances, dayHeadline, dayNumbers, shiftDay } from "./todayModel";
import { shortBookingReference } from "../../../../utils/venueBookingReference";

export interface VenueTodayModuleProps {
  brandId: string | null;
  venueId: string | null;
  onOpenModule?: (module: VenueModule) => void;
  /** #4490 P4 — show requests waiting on the host (Requests is in the nav). */
  showRequests?: boolean;
}

export function VenueTodayModule({ brandId, venueId, onOpenModule, showRequests = false }: VenueTodayModuleProps): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const currency = useBrandCurrency(brandId);
  // #4490 P3 — any day, not only today: a Saturday's group bookings and balances.
  const [date, setDate] = useState<string | null>(null);
  const dayQuery = useVenueDay(brandId, venueId, date, { live: date === null });
  // #4490 P6 — members who came in today (one visit a day).
  const features = useVenueFeatures(brandId, venueId).data?.features;
  const membersOn = features?.memberships.enabled === true;
  const guestListOn = features?.guest_list.enabled === true;
  const [openGroup, setOpenGroup] = useState<string | null>(null);

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
  const bookings = [...day.bookings].sort((a, b) =>
    (a.startsAt ?? a.createdAt).localeCompare(b.startsAt ?? b.createdAt),
  );
  const isToday = date === null;
  const balances = dayBalances(day);
  const dayNav = (
    <View style={styles.dayNav}>
      <IconChrome
        icon="chevL"
        size={36}
        accessibilityLabel="Day before"
        onPress={() => setDate(shiftDay(day.localDate, -1))}
        testID="venue-today-prev"
      />
      <Text style={styles.dayNavLabel}>{isToday ? "Today" : dayDateLabel(day.localDate)}</Text>
      <IconChrome
        icon="chevR"
        size={36}
        accessibilityLabel="Next day"
        onPress={() => setDate(shiftDay(day.localDate, 1))}
        testID="venue-today-next"
      />
      {!isToday ? (
        <Button label="Back to today" variant="ghost" size="sm" onPress={() => setDate(null)} testID="venue-today-reset" />
      ) : null}
    </View>
  );

  return (
    <View style={styles.host} testID="venue-today-module">
      <View style={styles.header}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header">{isToday ? "Today" : dayDateLabel(day.localDate)}</Text>
          <Text style={styles.meta}>{dayHeadline(day)}</Text>
        </View>
        {dayNav}
        {isWideDesktop ? (
          <Button label="Open check-in" variant="primary" size="sm" leadingIcon="scan" onPress={() => onOpenModule?.("checkin")} testID="venue-today-open-checkin" />
        ) : null}
      </View>

      {day.closed ? <Text style={styles.closed}>The venue is closed today. Nothing is on sale.</Text> : null}
      {showRequests && isToday ? (
        <RequestsWaitingCard brandId={brandId} venueId={venueId} onOpenRequests={() => onOpenModule?.("requests")} />
      ) : null}

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
        {/* #4490 07-E: two honest money numbers, both the server's. */}
        <TodayMoneyTiles
          money={day.money}
          loading={dayQuery.isFetching && day.money === null}
          isToday={isToday}
          currency={cur}
          dateLine={day.localDate.length > 0 ? dayDateLabel(day.localDate) : "Today"}
          onRetry={() => void dayQuery.refetch()}
          onOpenOrders={onOpenModule !== undefined ? () => onOpenModule("orders") : undefined}
          tileStyle={styles.tile}
        />
        {membersOn ? (
          <KpiTile
            label="Members in"
            value={day.membersIn ?? 0}
            sub={isToday ? "Checked in today" : "Checked in that day"}
            style={styles.tile}
            testID="venue-today-tile-members"
          />
        ) : null}
        {guestListOn ? (
          <KpiTile
            label="On the list"
            value={day.guestList?.names ?? 0}
            sub={`${day.guestList?.in ?? 0} in`}
            style={styles.tile}
            testID="venue-today-tile-guest-list"
          />
        ) : null}
        {balances.count > 0 ? (
          <KpiTile
            label="Balances to collect"
            value={money(balances.owedMinor, cur)}
            sub={`${balances.count} ${balances.count === 1 ? "group" : "groups"}${balances.overdue > 0 ? ` · ${balances.overdue} overdue` : ""}`}
            style={styles.tile}
            testID="venue-today-tile-balances"
          />
        ) : null}
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
                  {o.kind === "entry" ? entryStyleLabel(o.entryStyle) : o.kind === "group_package" ? "Group package" : o.kind === "private_hire" ? "Private hire" : o.kind === "by_the_hour" ? "By the hour" : "Offer"} · {o.sold} sold
                  {o.held > 0 ? ` · ${o.held} paying now` : ""}
                </Text>
              </View>
              <Pill variant={o.status === "live" ? "ok" : "warn"}>{o.status === "live" ? "On sale" : "Paused"}</Pill>
            </View>
          ))
        )}
      </GlassCard>

      <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-today-bookings">
        <Text style={styles.sectionLabel}>{isToday ? "Bookings for today" : `Bookings for ${dayDateLabel(day.localDate)}`}</Text>
        {bookings.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{isToday ? "Nothing booked today" : "Nothing booked that day"}</Text>
            <Text style={styles.meta}>Online bookings, group packages and gate sales show here.</Text>
          </View>
        ) : (
          bookings.map((b) => {
            const st = bookingStateLabel(b);
            const start = clockIn(b.startsAt ?? null, day.timezone);
            const owed = (b.balanceDueMinor ?? 0) > 0 && b.state === "confirmed";
            const overdue = owed && b.balanceDueAt != null && Date.parse(b.balanceDueAt) < Date.now();
            return (
              <Pressable
                key={b.groupId}
                onPress={() => setOpenGroup(b.groupId)}
                accessibilityRole="button"
                accessibilityLabel={`${b.guestName}, ${b.guests} guests, ${st.label}${owed ? `, ${money(b.balanceDueMinor ?? 0, b.currencyCode ?? cur)} still to pay` : ""}. Open booking`}
                style={({ pressed }) => [styles.row, styles.rowBorder, pressed ? styles.pressed : null]}
                testID={`venue-today-booking-${b.groupId}`}
              >
                {start !== null && b.offerKind === "group_package" ? <Text style={styles.time}>{start}</Text> : null}
                <View style={styles.cellText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{b.guestName}</Text>
                  <Text style={styles.meta} numberOfLines={2}>
                    {b.offerName ? `${b.offerName} · ` : ""}
                    {shortBookingReference(b.reference)} · {bookingSourceLabel(b)} · {money(b.totalMinor, b.currencyCode ?? cur)}
                    {owed ? ` · ${money(b.balanceDueMinor ?? 0, b.currencyCode ?? cur)} to pay` : ""}
                  </Text>
                </View>
                <Text style={styles.guests}>{b.guests}</Text>
                {owed ? <Pill variant={overdue ? "error" : "warn"}>{overdue ? "Overdue" : "Balance due"}</Pill> : <Pill variant={st.variant}>{st.label}</Pill>}
              </Pressable>
            );
          })
        )}
      </GlassCard>

      <VenueBookingSheet brandId={brandId} venueId={venueId} groupId={openGroup} onClose={() => setOpenGroup(null)} />
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
  pressed: { backgroundColor: color.fill.pressed },
  time: { ...type.row, color: color.text1, fontVariant: ["tabular-nums"], minWidth: 48 },
  dayNav: { flexDirection: "row", alignItems: "center", gap: space[1] },
  dayNavLabel: { ...type.small, color: color.text1, minWidth: 96, textAlign: "center" },
});
