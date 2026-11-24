/**
 * #4490 08-O5 fix 2 (carried 1) — "Sold out after payment" on the Till.
 *
 * A Till DEVICE login has no Orders screen (Today, Till, Check-in), so the
 * swap-or-refund card the order sheet shows was out of reach there. The Till
 * shows a banner while any guest order waits for a swap or a refund; it opens
 * ONE sheet listing them, and a tap on a row opens that order's own card
 * (OrderSoldOutSection: Swap item / Refund, the PIN asked again for a refund
 * on a Till device) in place, one order at a time.
 *
 * One native sheet: the card's swap list is an inline panel, its refund
 * confirm is nested in this sheet and the PIN pad takes the card's place inside
 * it (the iOS one-modal-per-presenter rule). The Till opens this sheet only
 * from its own screen, never from inside the basket's sheet.
 *
 * Reads: the venue's orders (useVenueOrders, the Orders screen's own key) and
 * order_sold_out per flagged order (orderSoldOutKey, the card's own key), so a
 * resolve in the card refreshes the banner. The server decides who may read
 * or resolve; a person without the right sees no banner.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQueries } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useTillCatalog } from "../../../hooks/useVenueTill";
import { useVenueOrders } from "../../../hooks/useVenueOrders";
import { fetchOrderSoldOut, type OrderSoldOut } from "../../../services/venueStockService";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { OrderSoldOutSection, orderSoldOutKey } from "../stock/OrderSoldOutSection";
import { STOCK_COPY } from "../stock/stockCopy";
import { TILL_COPY } from "./tillCopy";
import { useStepUpSheet } from "./TillStepUp";
import { flaggedOrders, listedOrders, waitingOrders, type TillSoldOutWaiting } from "./tillSoldOutModel";

/** The orders waiting for a swap or a refund at this venue (empty while loading). */
export function useTillSoldOutWaiting(brandId: string | null, venueId: string): TillSoldOutWaiting[] {
  const orders = useVenueOrders(brandId, venueId).data;
  const flagged = useMemo(() => flaggedOrders(orders ?? []), [orders]);
  const details = useQueries({
    queries: flagged.map((order) => ({
      queryKey: orderSoldOutKey(venueId, order.id),
      queryFn: (): Promise<OrderSoldOut> => fetchOrderSoldOut(venueId, order.id),
      staleTime: 5_000,
      retry: false,
    })),
  });
  const data = details.map((d) => d.data);
  // The list of results changes identity every render; key the memo on content.
  const signature = flagged.map((o, i) => `${o.id}:${data[i]?.lines.map((l) => l.resolution ?? "w").join("") ?? "?"}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => waitingOrders(flagged, data), [signature]);
}

/** The Till's slot: the banner while anything waits, and the one sheet it opens. */
export function TillSoldOutHost({ venueId }: { venueId: string }): React.ReactElement {
  const catalog = useTillCatalog(venueId);
  const waiting = useTillSoldOutWaiting(catalog.data?.brandId ?? null, venueId);
  const [open, setOpen] = useState(false);
  return (
    <>
      <TillSoldOutBanner count={waiting.length} onOpen={() => setOpen(true)} />
      <TillSoldOutSheet visible={open} venueId={venueId} waiting={waiting} onClose={() => setOpen(false)} />
    </>
  );
}

export function TillSoldOutBanner({ count, onOpen }: { count: number; onOpen: () => void }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <View style={styles.bannerWrap}>
      <Banner
        tone="warning"
        title={STOCK_COPY.waitingCount(count)}
        body={STOCK_COPY.afterPaymentBody}
        action={{ label: TILL_COPY.swapOrRefund, onPress: onOpen, testID: "till-sold-out-open" }}
        testID="till-sold-out-banner"
      />
    </View>
  );
}

export interface TillSoldOutSheetProps {
  visible: boolean;
  venueId: string;
  waiting: readonly TillSoldOutWaiting[];
  onClose: () => void;
}

export function TillSoldOutSheet({ visible, venueId, waiting, onClose }: TillSoldOutSheetProps): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  // The order being read stays listed after its last line is resolved, so
  // "Swapped for ..." / "Refunded ..." can be read before it leaves the list.
  const [lastOpen, setLastOpen] = useState<TillSoldOutWaiting | null>(null);
  const rows = useMemo(() => listedOrders(waiting, openId, lastOpen), [waiting, openId, lastOpen]);
  const close = (): void => {
    setOpenId(null);
    setLastOpen(null);
    onClose();
  };
  // #4490 08-O5 fix 5: the tallest sheet while a refund's PIN pad shows.
  // Fix 6: while it shows, swipe, back and Close cancel it like Cancel.
  const stepUpSheet = useStepUpSheet(venueId, 0.85, false, close);
  // Nothing left to swap or refund and nothing open to read: the sheet has done its job.
  useEffect(() => {
    if (visible && rows.length === 0) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rows.length]);
  return (
    <Sheet visible={visible} onClose={close} {...stepUpSheet.sheet} testID="till-sold-out-sheet">
      <View style={styles.grow}>
        <View style={styles.head}>
          <Text style={styles.h2} accessibilityRole="header" numberOfLines={2}>{STOCK_COPY.afterPayment}</Text>
          <Button label={TILL_COPY.close} variant="ghost" size="sm" onPress={stepUpSheet.close} testID="till-sold-out-close" />
        </View>
        <SheetScrollLayout contentStyle={styles.scroll}>
          {rows.map((row) => {
            const open = openId === row.orderId;
            return (
              <View key={row.orderId} style={styles.card} testID={`till-sold-out-order-${row.orderId}`}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${row.destination}: ${row.items.join(", ")}`}
                  accessibilityHint={STOCK_COPY.afterPayment}
                  accessibilityState={{ expanded: open }}
                  onPress={() => {
                    setOpenId(open ? null : row.orderId);
                    setLastOpen(open ? null : row);
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  testID={`till-sold-out-row-${row.orderId}`}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>{row.destination}</Text>
                  <Text style={styles.rowSub} numberOfLines={2}>{row.items.join(", ")}</Text>
                </Pressable>
                {open ? (
                  <OrderSoldOutSection venueId={venueId} orderId={row.orderId} currency={row.currency} />
                ) : null}
              </View>
            );
          })}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  bannerWrap: { paddingHorizontal: space[4], paddingTop: space[2] },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], paddingBottom: space[2] },
  h2: { ...type.h2, color: color.text1, flexShrink: 1 },
  scroll: { gap: space[3], paddingBottom: space[4], paddingHorizontal: space[1] },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, backgroundColor: color.card, padding: space[3] },
  row: { minHeight: 44, justifyContent: "center", gap: space[1] },
  pressed: { opacity: 0.8 },
  rowTitle: { ...type.row, color: color.text1 },
  rowSub: { ...type.caption, color: color.text2 },
});
