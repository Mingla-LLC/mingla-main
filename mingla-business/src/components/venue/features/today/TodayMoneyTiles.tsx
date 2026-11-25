/**
 * #4490 07-E — Today's two money tiles and their detail sheet.
 *
 * "Paid in today" (money received that service day, for any date) and "For
 * today's bookings" (paid so far for bookings dated that day). Both numbers and
 * every part come from issue_4490_venue_money_day; the client only formats.
 * Tap a tile for its parts. Food and drink takings are not in these numbers.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import type { VenueDayMoney } from "../../../../types/venueOffers";
import { Button } from "../../../ui/Button";
import { KpiTile } from "../../../ui/KpiTile";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Sheet } from "../../../ui/Sheet";
import { money } from "../offers/offersModel";
import { todayMoneyCopy, todayMoneyRows, type TodayMoneyTile } from "./todayModel";

export interface TodayMoneyTilesProps {
  money: VenueDayMoney | null;
  /** True while the day is loading or refetching with nothing to show. */
  loading?: boolean;
  isToday: boolean;
  currency: string | null;
  /** Sheet subtitle, e.g. "Sat 21 Nov · CLUB MERIDIAN". */
  dateLine: string;
  onRetry: () => void;
  /** Food and drink takings live in Orders until spec 08's Close the day ships. */
  onOpenOrders?: () => void;
  tileStyle?: StyleProp<ViewStyle>;
}

export function TodayMoneyTiles({
  money: m,
  loading = false,
  isToday,
  currency: currencyProp,
  dateLine,
  onRetry,
  onOpenOrders,
  tileStyle,
}: TodayMoneyTilesProps): React.ReactElement {
  const [open, setOpen] = useState<TodayMoneyTile | null>(null);
  const failed = !loading && m === null;
  // N128: every sum is in the venue's currency, as the server reports it.
  const currency = m?.currencyCode ?? currencyProp;

  const tile = (kind: TodayMoneyTile): React.ReactElement => {
    const copy = todayMoneyCopy(kind, isToday);
    const value =
      loading || m === null ? "--" : money(kind === "paidIn" ? m.paidInMinor : m.forTodayPaidMinor, currency);
    return (
      <Pressable
        key={kind}
        accessibilityRole="button"
        accessibilityLabel={`${copy.label}, ${value}. Show the parts`}
        disabled={m === null}
        onPress={() => setOpen(kind)}
        style={({ pressed }) => [tileStyle, styles.moneyTile, pressed ? styles.pressed : null]}
        testID={`venue-today-money-${kind}`}
      >
        <KpiTile label={copy.label} value={value} sub={copy.sub} />
      </Pressable>
    );
  };

  const parts = open === null || m === null ? null : open === "paidIn" ? m.paidIn : m.forToday;
  const total = open === null || m === null ? 0 : open === "paidIn" ? m.paidInMinor : m.forTodayPaidMinor;

  return (
    <>
      {failed ? (
        <View style={styles.error} accessibilityLiveRegion="polite" testID="venue-today-money-error">
          <Text style={styles.errorText}>Couldn&apos;t load today&apos;s money. Try again</Text>
          <Button label="Retry" variant="secondary" size="sm" onPress={onRetry} testID="venue-today-money-retry" />
        </View>
      ) : null}
      {tile("paidIn")}
      {tile("forToday")}
      <Sheet visible={open !== null} onClose={() => setOpen(null)} snapPoint={0.62} testID="venue-today-money-sheet">
        {open !== null && parts !== null ? (
          <View style={styles.body}>
            <PickerSheetHead title={todayMoneyCopy(open, isToday).label} onClose={() => setOpen(null)} />
            <Text style={styles.sub}>{dateLine}</Text>
            <View style={styles.card}>
              {todayMoneyRows(parts, open).map((row) => (
                <View key={row.key} style={styles.row}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue}>
                    {row.negative && row.minor > 0 ? `−${money(row.minor, currency)}` : money(row.minor, currency)}
                  </Text>
                </View>
              ))}
              <View style={[styles.row, styles.totalRow]}>
                <Text style={styles.totalLabel}>{todayMoneyCopy(open, isToday).label}</Text>
                <Text style={styles.totalLabel}>{money(total, currency)}</Text>
              </View>
            </View>
            {m !== null && m.otherCurrency ? (
              <Text style={styles.sub} testID="venue-today-money-other-currency">
                Some money that day was in another currency and isn&apos;t in these numbers.
              </Text>
            ) : null}
            {/* [TRANSITIONAL] #4490 spec 07 §12.4: food and drink takings are in Orders; exits when spec 08 O-close ships Close the day (this line and button then point there). */}
            <Text style={styles.sub}>Food and drink sales aren&apos;t in this number. See them in Orders.</Text>
            {onOpenOrders !== undefined ? (
              <Button
                label="Open Orders"
                variant="secondary"
                size="md"
                fullWidth
                onPress={() => {
                  setOpen(null);
                  onOpenOrders();
                }}
                testID="venue-today-money-open-orders"
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  // The subs are two short sentences; give them room so they never clip.
  moneyTile: { flexBasis: 220, minWidth: 200 },
  pressed: { opacity: 0.85 },
  error: { flexBasis: "100%", gap: space[2], alignItems: "flex-start" },
  errorText: { ...type.small, color: color.errorText },
  body: { gap: space[3], paddingBottom: space[4] },
  sub: { ...type.small, color: color.text2 },
  card: { gap: space[2], padding: space[4], borderRadius: radius.md, backgroundColor: color.card2 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  rowLabel: { ...type.small, color: color.text2 },
  rowValue: { ...type.small, color: color.text1 },
  totalRow: { borderTopWidth: 1, borderTopColor: color.line, paddingTop: space[2] },
  totalLabel: { ...type.body, color: color.text1, fontWeight: "700" },
});
