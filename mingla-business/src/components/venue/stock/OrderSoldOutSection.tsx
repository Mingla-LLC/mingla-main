/**
 * #4490 spec 08 O5 part C (T16) — "Sold out after payment" on the staff
 * order: the guest paid for a line the count could not cover. Two ways out,
 * never a silent drop: Swap item (same station, same price or less; any
 * difference goes back to the guest) or Refund (the lines and their share of
 * the service charge). The server decides rights, prices and the refund,
 * exactly once; the guest is told by text and email.
 *
 * Rendered INSIDE the order detail Sheet. The swap list is an inline panel and
 * the refund confirm a ConfirmDialog that is this sheet's JSX descendant (the
 * iOS one-modal-per-presenter rule), never a second sheet.
 *
 * On a Till device a refund needs a fresh PIN with money rights (part A's
 * refund rule): the PIN pad takes this section's place inside the same sheet
 * (TillStepUpHost), so a guest who paid is never stuck waiting for a manager's
 * own phone. Swaps need no PIN.
 */
import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../constants/designSystem";
import { formatCurrency } from "../../../utils/currency";
import { randomId } from "../../../utils/randomId";
import {
  fetchOrderSoldOut,
  resolveSoldOut,
  StockError,
  type OrderSoldOut,
  type SoldOutLine,
} from "../../../services/venueStockService";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Pill } from "../../ui/Pill";
import { Spinner } from "../../ui/Spinner";
import { useTillStaffSession } from "../../../services/tillStaffSession";
import type { TillPinStaff } from "../../../services/venueTillService";
import { TillStepUpHost } from "../till/TillStepUp";
import { approvers } from "../till/pinModel";
import { STOCK_COPY, stockErrorCopy } from "./stockCopy";
import { canRefundSoldOutLine, swapChoice } from "./stockModel";

export const orderSoldOutKey = (venueId: string, orderId: string) =>
  ["venueOrders", "soldOut", venueId, orderId] as const;

export interface OrderSoldOutSectionProps {
  venueId: string;
  orderId: string;
  currency: string;
}

/** Same key as the Till's "Who's selling" read (TillGate), so the cache is shared. */
const pinStaffKey = (venueId: string) => ["venueTill", venueId, "pinStaff"] as const;

export function OrderSoldOutSection(props: OrderSoldOutSectionProps): React.ReactElement {
  const session = useTillStaffSession(props.venueId);
  const staffQuery = useQuery<TillPinStaff>({
    queryKey: pinStaffKey(props.venueId),
    enabled: session !== null,
    staleTime: 60_000,
    // Loaded on use: a signed-in account (no PIN session) never pulls the Till transport.
    queryFn: async () => (await import("../../../services/venueTillService")).fetchTillPinStaff(props.venueId),
  });
  const body = <OrderSoldOutBody {...props} />;
  if (session === null) return body;
  return (
    <TillStepUpHost venueId={props.venueId} approvers={approvers(staffQuery.data?.people ?? [])}>
      {body}
    </TillStepUpHost>
  );
}

function OrderSoldOutBody({ venueId, orderId, currency }: OrderSoldOutSectionProps): React.ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery<OrderSoldOut>({
    queryKey: orderSoldOutKey(venueId, orderId),
    queryFn: () => fetchOrderSoldOut(venueId, orderId),
    staleTime: 5_000,
  });
  const [swapFor, setSwapFor] = useState<SoldOutLine | null>(null);
  const [refundFor, setRefundFor] = useState<SoldOutLine | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // One request id per decision: a retry of the same decision replays it.
  const requestIds = useRef<Map<string, string>>(new Map());
  const money = (minor: number): string => formatCurrency(minor, currency, true);

  const data = query.data;

  const run = async (line: SoldOutLine, resolution: "swap" | "refund", swapId: string | null): Promise<void> => {
    if (busy) return;
    const decision = `${line.orderItemId}:${resolution}:${swapId ?? ""}`;
    let requestId = requestIds.current.get(decision);
    if (requestId === undefined) {
      requestId = randomId();
      requestIds.current.set(decision, requestId);
    }
    setBusy(true);
    setError(null);
    try {
      await resolveSoldOut({
        venueId,
        orderId,
        orderItemIds: [line.orderItemId],
        resolution,
        swapMenuItemId: swapId,
        requestId,
      });
      setSwapFor(null);
      setRefundFor(null);
      await queryClient.invalidateQueries({ queryKey: ["venueOrders"] });
    } catch (err) {
      // Cancelling the PIN prompt is not an error: the line stays waiting.
      if (!(err instanceof StockError && err.code === "pin_step_up_cancelled")) {
        setError(stockErrorCopy(err instanceof StockError ? err.code : "stock_failed"));
      }
      // A refusal the server explained is final for this decision; a new tap
      // is a new decision. A lost answer (network) keeps the id for the retry.
      if (!(err instanceof StockError) || err.code !== "network") requestIds.current.delete(decision);
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending) {
    return <View style={styles.wrap}><Spinner /></View>;
  }
  if (query.isError || data === undefined) {
    return (
      <View style={styles.wrap} testID="order-sold-out-error">
        <Text style={styles.error} accessibilityRole="alert">
          {stockErrorCopy(query.error instanceof StockError ? query.error.code : "stock_failed")}
        </Text>
        <Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="order-sold-out">
      <View style={styles.head}>
        <Pill variant="error">{STOCK_COPY.afterPayment}</Pill>
      </View>
      {data.lines.map((line) => (
        <View key={line.orderItemId} style={styles.line} testID={`order-sold-out-line-${line.orderItemId}`}>
          <Text style={styles.lineName}>{`${line.quantity} × ${line.name} · ${money(line.lineTotalMinor)}`}</Text>
          {line.resolution === "swap" ? (
            <Text style={styles.done}>{STOCK_COPY.swapped(line.swappedToName ?? "")}
              {line.refundedMinor !== null && line.refundedMinor > 0 ? ` · ${STOCK_COPY.refunded(money(line.refundedMinor))}` : ""}
            </Text>
          ) : line.resolution === "refund" ? (
            <Text style={styles.done}>{STOCK_COPY.refunded(money(line.refundedMinor ?? line.lineTotalMinor))}</Text>
          ) : (
            <>
              <Text style={styles.body}>{STOCK_COPY.afterPaymentBody}</Text>
              <View style={styles.actions}>
                {data.canSwap ? (
                  <Button label={STOCK_COPY.swapItem} variant="secondary" size="md" style={styles.flex}
                    disabled={busy} onPress={() => setSwapFor(swapFor?.orderItemId === line.orderItemId ? null : line)}
                    testID={`order-sold-out-swap-${line.orderItemId}`} />
                ) : null}
                {canRefundSoldOutLine(data, line) ? (
                  <Button label={STOCK_COPY.refundAmount(money(line.refundPreviewMinor))} variant="secondary" size="md"
                    style={styles.flex} disabled={busy} onPress={() => setRefundFor(line)}
                    testID={`order-sold-out-refund-${line.orderItemId}`} />
                ) : null}
              </View>
              {swapFor?.orderItemId === line.orderItemId ? (
                <View style={styles.panel} testID="order-sold-out-swap-panel">
                  <Text style={styles.panelTitle}>{STOCK_COPY.swapTitle(line.name)}</Text>
                  <Text style={styles.body}>{STOCK_COPY.swapSub}</Text>
                  {data.swapOptions.filter((o) => o.menuItemId !== line.menuItemId).length === 0 ? (
                    <Text style={styles.body}>{STOCK_COPY.swapNone}</Text>
                  ) : data.swapOptions.filter((o) => o.menuItemId !== line.menuItemId).map((option) => {
                    const choice = swapChoice(line, option);
                    const price = money(option.priceMinor * line.quantity);
                    const pickable = choice.kind === "cheaper" || choice.kind === "same";
                    const sub = choice.kind === "cheaper"
                      ? STOCK_COPY.swapCheaper(price, money(choice.backMinor))
                      : choice.kind === "same"
                      ? STOCK_COPY.swapSame(price)
                      : choice.kind === "dearer"
                      ? STOCK_COPY.swapDearer(price)
                      : STOCK_COPY.swapOtherStation(price);
                    return (
                      <Pressable
                        key={option.menuItemId}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !pickable || busy }}
                        accessibilityLabel={pickable ? STOCK_COPY.swapTo(option.name) : `${option.name}. ${sub}`}
                        disabled={!pickable || busy}
                        onPress={() => void run(line, "swap", option.menuItemId)}
                        style={({ pressed }) => [styles.option, !pickable && styles.optionOff, pressed && styles.pressed]}
                        testID={`order-sold-out-swap-option-${option.menuItemId}`}
                      >
                        <Text style={styles.optionName}>{option.name}</Text>
                        <Text style={styles.optionSub}>{sub}</Text>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.caption}>{STOCK_COPY.swapRule}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      ))}
      {error !== null ? (
        <Text style={styles.error} accessibilityRole="alert" testID="order-sold-out-error-text">{error}</Text>
      ) : null}
      <ConfirmDialog
        visible={refundFor !== null}
        title={STOCK_COPY.refundConfirmTitle(money(refundFor?.refundPreviewMinor ?? 0))}
        description={STOCK_COPY.refundConfirmBody}
        confirmLabel={STOCK_COPY.refundAmount(money(refundFor?.refundPreviewMinor ?? 0))}
        cancelLabel="Keep it"
        destructive
        onConfirm={() => {
          // Close the confirm first: on a Till device the PIN pad shows next.
          const line = refundFor;
          setRefundFor(null);
          if (line !== null) void run(line, "refund", null);
        }}
        onClose={() => setRefundFor(null)}
        testID="order-sold-out-refund-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2], paddingTop: space[3] },
  head: { flexDirection: "row" },
  line: { gap: space[2], paddingVertical: space[2] },
  lineName: { ...type.row, color: color.text1 },
  body: { ...type.small, color: color.text2 },
  caption: { ...type.caption, color: color.text3 },
  done: { ...type.small, color: color.successText },
  error: { ...type.small, color: color.errorText },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  flex: { flexGrow: 1, flexBasis: 140 },
  panel: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.card2,
  },
  panelTitle: { ...type.row, color: color.text1 },
  option: {
    minHeight: 44,
    justifyContent: "center",
    gap: space[1],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    backgroundColor: color.card,
  },
  optionOff: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
  optionName: { ...type.row, color: color.text1 },
  optionSub: { ...type.caption, color: color.text2 },
});
