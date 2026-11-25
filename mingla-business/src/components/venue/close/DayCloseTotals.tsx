/**
 * #4490 spec 08 O5 part B — the day's totals on Close the day (close-day) and
 * Day closed (close-done): takings by payment type and by person, tips by who
 * served, service charge, refunds and voids, deposits used and refunded, the
 * door, online orders at the venue (not in the drawer), Mingla fees and card
 * money to the bank. Display only: every number is the server's.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import type { DaySummary } from "../../../services/venueDayCloseService";
import { formatCurrency } from "../../../utils/currency";
import { GlassCard } from "../../ui/GlassCard";
import { KpiTile } from "../../ui/KpiTile";
import { ListRow } from "../../ui/ListRow";
import { CLOSE_COPY } from "./dayCloseCopy";
import { methodLabel, personName } from "./dayCloseModel";

export interface DayCloseTotalsProps {
  summary: DaySummary;
  /** Phone < 600: one tile a row, fewer columns in the person rows. */
  wide: boolean;
}

export function DayCloseTotals({ summary, wide }: DayCloseTotalsProps): React.ReactElement {
  const t = summary.totals;
  const money = (minor: number): string => formatCurrency(minor, summary.currency, true);
  const sellers = t.people.filter((p) => p.salesCount > 0 || p.refundCount > 0 || p.voidCount > 0);
  return (
    <View style={styles.root} testID="day-close-totals">
      <View style={styles.tiles}>
        <KpiTile style={[styles.tile, wide && styles.tileWide]} wrapValue label={CLOSE_COPY.takings} value={money(t.takings.amountMinor)}
          sub={CLOSE_COPY.payments(t.takings.count)} testID="day-close-takings" />
        <KpiTile style={[styles.tile, wide && styles.tileWide]} wrapValue label={CLOSE_COPY.cash} value={money(t.cash.expectedMinor)}
          sub={CLOSE_COPY.inDrawer} testID="day-close-cash" />
        <KpiTile style={[styles.tile, wide && styles.tileWide]} wrapValue label={CLOSE_COPY.tips} value={money(t.takings.tipMinor)}
          sub={CLOSE_COPY.byWhoServed} testID="day-close-tips" />
        <KpiTile style={[styles.tile, wide && styles.tileWide]} wrapValue label={CLOSE_COPY.serviceCharge} value={money(t.serviceChargeMinor)}
          sub={CLOSE_COPY.insideTakings} />
        <KpiTile style={[styles.tile, wide && styles.tileWide]} wrapValue label={CLOSE_COPY.refunds} value={money(t.refunds.amountMinor)}
          sub={CLOSE_COPY.payments(t.refunds.count)} testID="day-close-refunds" />
        <KpiTile style={[styles.tile, wide && styles.tileWide]} wrapValue label={CLOSE_COPY.voids} value={money(t.voids.amountMinor)}
          sub={`${t.voids.count} · ${CLOSE_COPY.beforePayment}`} />
      </View>

      <GlassCard padding={0} testID="day-close-by-method">
        <Text style={styles.cardTitle}>{CLOSE_COPY.byPaymentType}</Text>
        {t.byMethod.length === 0 ? (
          <ListRow title={CLOSE_COPY.payments(0)} />
        ) : t.byMethod.map((m, i) => (
          <ListRow key={m.method} divider={i > 0} title={methodLabel(m.method)}
            subtitle={m.tipMinor > 0 ? `${CLOSE_COPY.payments(m.count)} · ${CLOSE_COPY.tips} ${money(m.tipMinor)}` : CLOSE_COPY.payments(m.count)}
            value={money(m.amountMinor)} testID={`day-close-method-${m.method}`} />
        ))}
      </GlassCard>

      <GlassCard padding={0} testID="day-close-by-person">
        <Text style={styles.cardTitle}>{CLOSE_COPY.byPerson}</Text>
        {sellers.length === 0 ? <ListRow title={CLOSE_COPY.payments(0)} /> : sellers.map((p, i) => {
          const parts = [
            CLOSE_COPY.payments(p.salesCount),
            p.tipsTakenMinor > 0 ? `${CLOSE_COPY.tips} ${money(p.tipsTakenMinor)}` : null,
            wide && p.cashTakenMinor > 0 ? `${CLOSE_COPY.cashTaken} ${money(p.cashTakenMinor)}` : null,
            p.refundCount > 0 ? `${CLOSE_COPY.refunds} ${money(p.refundMinor)}` : null,
            p.voidCount > 0 ? `${CLOSE_COPY.voids} ${p.voidCount}` : null,
          ].filter((x): x is string => x !== null);
          return (
            <ListRow key={`${p.kind}:${p.userId ?? "none"}`} divider={i > 0} title={personName(p)}
              subtitle={parts.join(" · ")} value={money(p.salesMinor)} testID={`day-close-person-${p.userId ?? p.kind}`} />
          );
        })}
      </GlassCard>

      {t.tipsByServer.length > 0 || t.tipsOtherMinor > 0 ? (
        <GlassCard padding={0} testID="day-close-tips-by-server">
          <Text style={styles.cardTitle}>{CLOSE_COPY.tipsByServer}</Text>
          {t.tipsByServer.map((p, i) => (
            <ListRow key={p.userId ?? `${i}`} divider={i > 0} title={personName(p)} value={money(p.tipsServedMinor)} />
          ))}
          {t.tipsOtherMinor > 0 ? (
            <ListRow divider={t.tipsByServer.length > 0} title={CLOSE_COPY.tipsNotStaff} value={money(t.tipsOtherMinor)} />
          ) : null}
        </GlassCard>
      ) : null}

      <GlassCard padding={0} testID="day-close-lines">
        <ListRow title={CLOSE_COPY.foodAndDrink} value={money(t.categories.foodAndDrinkMinor)} />
        <ListRow divider title={CLOSE_COPY.bookings} subtitle={CLOSE_COPY.bookingsHint} value={money(t.categories.bookingsMinor)} />
        {t.categories.onOpenChecksMinor > 0 ? (
          <ListRow divider title={CLOSE_COPY.onOpenChecks} value={money(t.categories.onOpenChecksMinor)} />
        ) : null}
        <ListRow divider title={CLOSE_COPY.net} value={money(t.net.takingsMinor)} />
        <ListRow divider title={CLOSE_COPY.depositsUsed} subtitle={CLOSE_COPY.depositsUsedHint} value={money(t.depositsUsed.amountMinor)}
          testID="day-close-deposits-used" />
        <ListRow divider title={CLOSE_COPY.depositRefunded} subtitle={CLOSE_COPY.depositRefundedHint}
          value={money(t.depositRefunded.amountMinor)} testID="day-close-deposit-refunded" />
        <ListRow divider title={CLOSE_COPY.door} subtitle={CLOSE_COPY.doorHint} value={money(t.door.amountMinor)} testID="day-close-door" />
        <ListRow divider title={CLOSE_COPY.orderedOnline} subtitle={CLOSE_COPY.notInDrawer} value={money(t.orderedOnline.amountMinor)}
          testID="day-close-online" />
        <ListRow divider title={CLOSE_COPY.guestFees} value={money(t.takings.guestFeesMinor)} />
        <ListRow divider title={CLOSE_COPY.minglaFees} value={money(t.card.minglaFeesMinor)} />
        <ListRow divider title={CLOSE_COPY.toBank} value={money(t.card.toBankMinor)} testID="day-close-to-bank" />
        {t.paidInToday !== null ? (
          <ListRow divider title={CLOSE_COPY.paidInToday} subtitle={CLOSE_COPY.paidInTodayHint} value={money(t.paidInToday.paidInMinor)}
            testID="day-close-paid-in-today" />
        ) : null}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4] },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  // #4490 08-O5 fix 6: on a phone each tile takes the full width, so an amount
  // like ₦78,000.00 has room on one line at 320 and 375 (two a row broke it
  // inside the number as "₦78,000. / 00"). Amounts are never shrunk.
  tile: { flexBasis: "100%", flexGrow: 1 },
  tileWide: { flexBasis: "30%" },
  cardTitle: { ...type.label, color: color.text3, paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[1] },
});
