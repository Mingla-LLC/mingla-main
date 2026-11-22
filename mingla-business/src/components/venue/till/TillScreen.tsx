/**
 * #4490 spec 08 O1 — the Till (`/venue/[venueId]/till`, full screen, outside
 * the venue rail). Catalog + basket; one check at a time; one payment sheet.
 *
 * Money rules (spec 08 §4): every total on screen is the server's. Items
 * picked on this device form a draft that is priced by the server when it is
 * added to the check (Save check, Send, Pay); until then the totals read "--"
 * (rule 9). A sold-out or changed item is refused by the server in words.
 *
 * Layout (spec 08 §2, `floorLayoutFor`): phone < 600 shows the catalog full
 * width with a bottom bar that opens the basket; tablet and desk show the
 * basket beside the catalog at `size.sidePanel`. (The full tablet layout with
 * rotation is O3; this holds at 390, 768, 1024 and 1440.)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { useVenueOffers } from "../../../hooks/useVenueOffers";
import { useTillActions, useTillCatalog, useTillChecks, useTillSale } from "../../../hooks/useVenueTill";
import type { TillCatalog, TillMenuItem, TillSale } from "../../../services/venueTillService";
import { TillError } from "../../../services/venueTillService";
import type { VenueOffer } from "../../../types/venueOffers";
import { formatCurrency } from "../../../utils/currency";
import { randomId } from "../../../utils/randomId";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Input } from "../../ui/Input";
import { ListRow } from "../../ui/ListRow";
import { MoneyField } from "../../ui/MoneyField";
import { NumberStepper } from "../../ui/NumberStepper";
import { Chip, Pill, Segmented } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { Skeleton } from "../../ui/Skeleton";
import { Toast } from "../../ui/Toast";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { PaymentSheet } from "./PaymentSheet";
import { ReceiptStep } from "./ReceiptStep";
import { TILL_COPY, tillErrorCopy } from "./tillCopy";
import {
  addToDraft,
  basketRows,
  floorLayoutFor,
  itemNeedsChoices,
  itemSellable,
  sendLabel,
  setDraftQuantity,
  totalsReady,
  type BasketRow,
  type DraftLine,
  type TillPrefill,
} from "./tillModel";

export interface TillScreenProps {
  venueId: string;
  prefill?: TillPrefill | null;
  /** Open on the Open checks list (from Orders › Open checks). */
  openChecksOnStart?: boolean;
}

type ToastState = { kind: "success" | "error"; message: string } | null;

export function TillScreen({ venueId, prefill = null, openChecksOnStart = false }: TillScreenProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const layout = floorLayoutFor(width);
  const catalogQuery = useTillCatalog(venueId);
  const catalog = catalogQuery.data ?? null;
  const offersQuery = useVenueOffers(catalog?.brandId ?? null, venueId);
  const [saleId, setSaleId] = useState<string | null>(null);
  const saleQuery = useTillSale(venueId, saleId);
  const sale = saleId !== null ? saleQuery.data ?? null : null;
  const [checksOpen, setChecksOpen] = useState(openChecksOnStart);
  const checksQuery = useTillChecks(venueId, true);
  const actions = useTillActions(venueId);

  const [tab, setTab] = useState<"menu" | "entry">(prefill?.tab ?? "menu");
  const [menuIndex, setMenuIndex] = useState(0);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [choicesFor, setChoicesFor] = useState<TillMenuItem | null>(null);
  const [offerSheet, setOfferSheet] = useState<{ offer: VenueOffer; counts: Record<string, number>; guestListEntryId: string | null } | null>(null);
  const [voidRow, setVoidRow] = useState<BasketRow | null>(null);
  const [nameSheet, setNameSheet] = useState(false);
  const [basketSheet, setBasketSheet] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [busy, setBusy] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);

  const currency = sale?.currency ?? catalog?.currency ?? "NGN";
  const money = useCallback((minor: number): string => formatCurrency(minor, currency, true), [currency]);
  const entryOffers = useMemo(
    () => (offersQuery.data?.offers ?? []).filter((o) => o.status === "live" && (o.kind === "entry" || o.kind === "group_package")),
    [offersQuery.data?.offers],
  );

  // Guest-list reduced price (spec 07 §11 B3): open the Entry tab prefilled.
  useEffect(() => {
    if (prefill === null || prefill.offerId === null || offerSheet !== null) return;
    const offer = entryOffers.find((o) => o.id === prefill.offerId);
    if (offer === undefined) return;
    setTab("entry");
    setOfferSheet({
      offer,
      counts: prefill.priceOptionId !== null ? { [prefill.priceOptionId]: Math.max(1, prefill.count ?? 1) } : {},
      guestListEntryId: prefill.guestListEntryId,
    });
    // Run once when the offers arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryOffers.length]);

  const fail = useCallback(
    (err: unknown): void => {
      const code = err instanceof TillError ? err.code : "till_failed";
      const item = err instanceof TillError ? err.item : null;
      if (code === "till_check_changed" && saleId !== null) actions.refreshSale(saleId);
      setToast({ kind: "error", message: tillErrorCopy(code, item) });
    },
    [actions, saleId],
  );

  /** The check this sale lives on: opened on the first add. */
  const ensureSale = useCallback(async (): Promise<TillSale> => {
    if (sale !== null) return sale;
    const opened = await actions.open.mutateAsync({ label: null, spotId: null, idempotencyKey: `open:${randomId()}` });
    setSaleId(opened.id);
    return opened;
  }, [actions.open, sale]);

  /** Price the draft on the server as one round (held unless sent). */
  const commitDraft = useCallback(
    async (send: boolean): Promise<TillSale | null> => {
      try {
        const current = await ensureSale();
        if (draft.length === 0) {
          if (send) return await actions.send.mutateAsync({ saleId: current.id });
          return current;
        }
        const next = await actions.addMenu.mutateAsync({
          saleId: current.id,
          lines: draft.map((d) => ({ menuItemId: d.menuItemId, quantity: d.quantity, modifierIds: d.modifierIds, notes: d.notes })),
          send,
          idempotencyKey: `round:${randomId()}`,
          expectedVersion: current.version,
        });
        setDraft([]);
        return next;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [actions.addMenu, actions.send, draft, ensureSale, fail],
  );

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const onTile = (item: TillMenuItem): void => {
    if (!itemSellable(item)) return;
    if (itemNeedsChoices(item)) {
      setChoicesFor(item);
      return;
    }
    setDraft((d) => addToDraft(d, { menuItemId: item.id, name: item.name, quantity: 1, modifierIds: [], modifierNames: [], notes: null, station: item.station }));
  };

  // Leaving the Till: back to the workspace, or to the venue when the Till was
  // opened straight from a link or a reload (nothing to go back to).
  const leaveTill = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace(`/venue/${venueId}` as never);
  }, [router, venueId]);
  // Items picked but not yet on the check live only on this device: leaving
  // asks first (the check itself, its rounds and payments are saved).
  const requestClose = useCallback((): void => {
    if (draft.length > 0) setLeaveAsk(true);
    else leaveTill();
  }, [draft.length, leaveTill]);
  useUnsavedChangesGuard({ dirty: draft.length > 0, onRequestLeave: requestClose });

  const newSale = (): void => {
    setPayOpen(false);
    setSaleId(null);
    setDraft([]);
  };

  const rows = basketRows(sale);
  const ready = totalsReady(sale, draft);
  const send = sendLabel(sale, draft, catalog);
  const sendText = send === "bar" ? TILL_COPY.sendToBar : send === "kitchen" ? TILL_COPY.sendToKitchen : TILL_COPY.send;
  const itemCount = rows.filter((r) => !r.voided).reduce((n, r) => n + r.quantity, 0) + draft.reduce((n, d) => n + d.quantity, 0);
  const payLabel = ready && sale !== null ? TILL_COPY.pay(money(sale.remainingMinor)) : TILL_COPY.payPending;
  const nothingOnCheck = rows.length === 0 && draft.length === 0;

  // ---------------------------------------------------------------- catalog
  const menus = catalog?.menus ?? [];
  const menu = menus[Math.min(menuIndex, Math.max(0, menus.length - 1))] ?? null;
  const tabs = [
    ...(menus.length > 0 ? [{ key: "menu" as const, label: TILL_COPY.menu }] : []),
    ...(entryOffers.length > 0 ? [{ key: "entry" as const, label: TILL_COPY.entry }] : []),
  ];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key ?? "menu";

  let catalogBody: React.ReactNode;
  if (catalogQuery.isLoading) {
    catalogBody = (
      <View style={styles.grid}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} width={layout === "phone" ? "47%" : 160} height={88} radius="lg" />
        ))}
      </View>
    );
  } else if (catalogQuery.isError) {
    const code = catalogQuery.error instanceof TillError ? catalogQuery.error.code : "till_failed";
    catalogBody = (
      <Banner tone="danger" title={code === "network" ? TILL_COPY.offline : tillErrorCopy(code)} body={code === "network" ? TILL_COPY.offlineBody : undefined}
        action={{ label: TILL_COPY.retry, onPress: () => void catalogQuery.refetch() }} />
    );
  } else if (tabs.length === 0) {
    catalogBody = (
      <EmptyState
        illustration="list"
        title={TILL_COPY.nothingToSell}
        cta={{ label: TILL_COPY.openMenu, onPress: () => router.push(`/venue/${venueId}?module=menu`) }}
        testID="till-empty"
      />
    );
  } else if (activeTab === "entry") {
    catalogBody = (
      <View style={styles.grid}>
        {entryOffers.map((offer) => {
          const from = Math.min(...offer.options.filter((o) => o.status === "active").map((o) => o.priceMinor));
          return (
            <Pressable
              key={offer.id}
              accessibilityRole="button"
              onPress={() => setOfferSheet({ offer, counts: {}, guestListEntryId: null })}
              style={({ pressed }) => [styles.tile, layout === "phone" && styles.tilePhone, pressed && styles.tilePressed]}
              testID={`till-offer-${offer.id}`}
            >
              <Text style={styles.tileName} numberOfLines={2}>{offer.name}</Text>
              <Text style={styles.tilePrice}>{Number.isFinite(from) ? money(from) : "--"}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  } else {
    catalogBody = (
      <View style={styles.catalogCol}>
        {menus.length > 1 ? (
          <View style={styles.chips}>
            {menus.map((m, i) => (
              <Chip key={m.id} label={m.name} selected={i === menuIndex} onPress={() => setMenuIndex(i)} />
            ))}
          </View>
        ) : null}
        <View style={styles.grid}>
          {(menu?.items ?? []).map((item) => {
            const sellable = itemSellable(item);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: !sellable }}
                disabled={!sellable}
                onPress={() => onTile(item)}
                style={({ pressed }) => [styles.tile, layout === "phone" && styles.tilePhone, !sellable && styles.tileOff, pressed && styles.tilePressed]}
                testID={`till-item-${item.id}`}
              >
                <Text style={styles.tileName} numberOfLines={2}>{item.name}</Text>
                <View style={styles.tileFoot}>
                  <Text style={styles.tilePrice}>{item.priceMinor === null ? "--" : money(item.priceMinor)}</Text>
                  {!sellable ? <Pill variant="draft">{TILL_COPY.soldOut}</Pill> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  // ----------------------------------------------------------------- basket
  const basket = (
    <View style={styles.basket} testID="till-basket">
      <View style={styles.basketHead}>
        <Text style={styles.h3} numberOfLines={1}>{sale?.checkLabel ?? sale?.spotLabel ?? TILL_COPY.newCheck}</Text>
        {sale !== null && sale.paidMinor > 0 ? <Pill variant="info">{TILL_COPY.leftToPay}</Pill> : null}
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.basketList}>
        {rows.map((row) => (
          <ListRow
            key={row.key}
            title={`${row.quantity > 1 ? `${row.quantity} × ` : ""}${row.label}`}
            subtitle={row.voided ? TILL_COPY.void : row.detail ?? undefined}
            value={money(row.amountMinor)}
            disabled={row.voided}
            chevron={false}
            onPress={row.voided || sale === null || sale.paidMinor > 0 ? undefined : () => setVoidRow(row)}
            testID={`till-row-${row.key}`}
          />
        ))}
        {draft.map((d) => (
          <View key={d.key} style={styles.draftRow}>
            <NumberStepper
              label={[d.name, ...d.modifierNames, d.notes].filter(Boolean).join(" · ")}
              value={d.quantity}
              min={0}
              max={99}
              onChange={(n) => setDraft((all) => setDraftQuantity(all, d.key, n))}
              testID={`till-draft-${d.menuItemId}`}
            />
          </View>
        ))}
      </ScrollView>
      <View style={styles.totals}>
        <Row label={TILL_COPY.subtotal} value={ready && sale !== null ? money(sale.subtotalMinor) : "--"} />
        {sale !== null && sale.serviceChargeMinor > 0 ? (
          <Row label={TILL_COPY.serviceCharge} value={ready ? money(sale.serviceChargeMinor) : "--"} />
        ) : null}
        <Row label={TILL_COPY.total} value={ready && sale !== null ? money(sale.totalDueMinor) : "--"} strong />
      </View>
      <View style={styles.actionsRow}>
        {send !== null ? (
          <Button label={sendText} variant="secondary" size="md" disabled={busy} onPress={() => void run(() => commitDraft(true))} style={styles.grow} testID="till-send" />
        ) : null}
        <Button
          label={TILL_COPY.saveCheck}
          variant="secondary"
          size="md"
          disabled={busy || nothingOnCheck}
          onPress={() => setNameSheet(true)}
          style={styles.grow}
          testID="till-save"
        />
      </View>
      <Button
        label={payLabel}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={nothingOnCheck}
        onPress={() =>
          void run(async () => {
            const priced = draft.length > 0 ? await commitDraft(false) : sale;
            if (priced !== null) setPayOpen(true);
          })
        }
        testID="till-pay"
      />
    </View>
  );

  const paidPayments = (sale?.payments ?? []).filter(
    (p) => p.state === "paid" || p.state === "partially_refunded" || p.state === "refunded",
  );
  const receiptPayment = paidPayments.find((p) => p.id === receiptFor) ?? null;
  const sendReceipt = (input: {
    paymentId: string;
    phone: string | null;
    phoneCountryIso: string | null;
    email: string | null;
  }): Promise<{ sendsLeft: number }> => actions.receipt.mutateAsync({ saleId, ...input });

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="till-screen">
      <View style={styles.header}>
        <Button label={TILL_COPY.close} variant="ghost" size="sm" onPress={requestClose} testID="till-back" />
        <Text style={styles.title} numberOfLines={1}>{catalog?.venueName ?? TILL_COPY.title}</Text>
        <Button
          label={`${TILL_COPY.checks} · ${checksQuery.data?.open.length ?? 0}`}
          variant="secondary"
          size="sm"
          onPress={() => setChecksOpen(true)}
          testID="till-checks-open"
        />
      </View>
      {tabs.length > 1 ? (
        <Segmented options={tabs} value={activeTab} onChange={(k) => setTab(k)} style={styles.tabs} />
      ) : null}
      <View style={[styles.main, layout !== "phone" && styles.mainWide]}>
        <ScrollView style={styles.grow} contentContainerStyle={styles.catalogScroll}>
          {catalogBody}
          {paidPayments.length > 0 ? (
            <View style={styles.paidList}>
              {paidPayments.map((p) => (
                <ListRow
                  key={p.id}
                  title={`${p.method === "cash" ? TILL_COPY.cash : TILL_COPY.ownMachine} · ${money(p.amountMinor + p.tipMinor)}`}
                  subtitle={p.reference}
                  trailing={
                    <View style={styles.paidActions}>
                      <Button label={TILL_COPY.sendReceipt} variant="secondary" size="sm" onPress={() => setReceiptFor(p.id)}
                        testID={`till-receipt-open-${p.id}`} />
                      {catalog?.canManageMoney === true && p.state !== "refunded" ? (
                        <Button label={TILL_COPY.refund} variant="secondary" size="sm" onPress={() => setRefundFor(p.id)} />
                      ) : null}
                    </View>
                  }
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
        {layout !== "phone" ? <View style={styles.side}>{basket}</View> : null}
      </View>
      {layout === "phone" ? (
        <View style={styles.bottomBar}>
          <Pressable accessibilityRole="button" onPress={() => setBasketSheet(true)} style={styles.bottomInfo} testID="till-basket-open">
            <Text style={styles.h3}>{`${itemCount} · ${ready && sale !== null ? money(sale.remainingMinor) : "--"}`}</Text>
          </Pressable>
          <Button label={payLabel} variant="primary" size="md" disabled={nothingOnCheck || busy}
            onPress={() => setBasketSheet(true)} testID="till-bar-pay" />
        </View>
      ) : null}

      {layout === "phone" ? (
        <Sheet visible={basketSheet} onClose={() => setBasketSheet(false)} snapPoint={0.9} testID="till-basket-sheet">
          <View style={styles.sheetPad}>{basket}</View>
        </Sheet>
      ) : null}

      <ChoicesSheet item={choicesFor} currency={currency} onClose={() => setChoicesFor(null)}
        onAdd={(line) => {
          setDraft((d) => addToDraft(d, line));
          setChoicesFor(null);
        }} />

      <OfferSheet
        state={offerSheet}
        currency={currency}
        busy={busy}
        onChange={setOfferSheet}
        onClose={() => setOfferSheet(null)}
        onAdd={(lines, guestListEntryId) =>
          void run(async () => {
            if (offerSheet === null) return;
            try {
              const current = await ensureSale();
              await actions.addOffer.mutateAsync({
                saleId: current.id,
                offeringId: offerSheet.offer.id,
                lines,
                guestListEntryId,
                idempotencyKey: `offer:${randomId()}`,
                expectedVersion: current.version,
              });
              setOfferSheet(null);
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <ChecksSheet
        visible={checksOpen}
        checks={checksQuery.data ?? null}
        loading={checksQuery.isLoading}
        currency={currency}
        onClose={() => setChecksOpen(false)}
        onPick={(id) => {
          setSaleId(id);
          setDraft([]);
          setChecksOpen(false);
        }}
        onNew={() => {
          newSale();
          setChecksOpen(false);
        }}
      />

      <NameSheet
        visible={nameSheet}
        busy={busy}
        onClose={() => setNameSheet(false)}
        onSave={(label) =>
          void run(async () => {
            try {
              if (sale === null) {
                const opened = await actions.open.mutateAsync({ label, spotId: null, idempotencyKey: `open:${randomId()}` });
                setSaleId(opened.id);
                if (draft.length > 0) {
                  await actions.addMenu.mutateAsync({
                    saleId: opened.id,
                    lines: draft.map((d) => ({ menuItemId: d.menuItemId, quantity: d.quantity, modifierIds: d.modifierIds, notes: d.notes })),
                    send: false,
                    idempotencyKey: `round:${randomId()}`,
                    expectedVersion: opened.version,
                  });
                  setDraft([]);
                }
              } else {
                await commitDraft(false);
              }
              setNameSheet(false);
              newSale();
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <VoidSheet
        row={voidRow}
        currency={currency}
        busy={busy}
        onClose={() => setVoidRow(null)}
        onVoid={(reason) =>
          void run(async () => {
            if (sale === null || voidRow === null) return;
            try {
              await actions.voidLine.mutateAsync({
                saleId: sale.id,
                lineId: voidRow.lineId,
                orderItemId: voidRow.orderItemId,
                reason,
                restock: !voidRow.sent,
                expectedVersion: sale.version,
              });
              setVoidRow(null);
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <RefundSheet
        payment={paidPayments.find((p) => p.id === refundFor) ?? null}
        currency={currency}
        busy={busy}
        onClose={() => setRefundFor(null)}
        onRefund={(amountMinor, reason) =>
          void run(async () => {
            const payment = paidPayments.find((p) => p.id === refundFor);
            if (payment === undefined) return;
            try {
              const left = payment.amountMinor - Math.min(payment.refundedMinor, payment.amountMinor);
              await actions.refund.mutateAsync({
                paymentId: payment.id,
                amountMinor: Math.min(amountMinor, left),
                tipMinor: amountMinor > left ? amountMinor - left : 0,
                reason,
                restock: false,
                clientRequestId: randomId(),
              });
              setRefundFor(null);
              setToast({ kind: "success", message: TILL_COPY.refunded });
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <PaymentSheet
        visible={payOpen}
        sale={sale}
        tipsEnabled={catalog?.tipsEnabled ?? false}
        tipBpsOptions={catalog?.tipBpsOptions ?? []}
        onClose={() => setPayOpen(false)}
        onPay={(input) => actions.pay.mutateAsync({ saleId: sale?.id as string, ...input })}
        onNewSale={newSale}
        onRefreshSale={() => {
          if (saleId !== null) actions.refreshSale(saleId);
        }}
        onSendReceipt={({ channel: _channel, ...input }) => sendReceipt(input)}
      />

      {/* Re-send a paid payment's receipt (any seller; three sends at most). */}
      <Sheet visible={receiptPayment !== null} onClose={() => setReceiptFor(null)} snapPoint={0.7} testID="till-receipt-sheet">
        <View style={styles.grow}>
          <SheetHead
            title={receiptPayment !== null ? `${TILL_COPY.sendReceipt} · ${receiptPayment.reference}` : TILL_COPY.sendReceipt}
            onClose={() => setReceiptFor(null)}
          />
          <SheetScrollLayout keyboardAware contentStyle={styles.sheetScroll}>
            {receiptPayment !== null ? (
              <ReceiptStep
                key={receiptPayment.id}
                currency={currency}
                sendsUsed={receiptPayment.receiptSends}
                onSend={({ channel: _channel, ...input }) => sendReceipt({ paymentId: receiptPayment.id, ...input })}
                testID="till-receipt-resend"
              />
            ) : null}
          </SheetScrollLayout>
        </View>
      </Sheet>

      <ConfirmDialog
        visible={leaveAsk}
        onClose={() => setLeaveAsk(false)}
        onConfirm={() => {
          setLeaveAsk(false);
          setDraft([]);
          leaveTill();
        }}
        title={TILL_COPY.leaveTitle}
        description={TILL_COPY.leaveBody}
        confirmLabel={TILL_COPY.leaveConfirm}
        cancelLabel={TILL_COPY.leaveKeep}
        destructive
        testID="till-leave"
      />

      <Toast visible={toast !== null} kind={toast?.kind ?? "info"} message={toast?.message ?? ""} onDismiss={() => setToast(null)} testID="till-toast" />
    </View>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): React.ReactElement {
  return (
    <View style={styles.totalRow}>
      <Text style={strong ? styles.totalStrong : styles.muted}>{label}</Text>
      <Text style={strong ? styles.totalStrong : styles.value}>{value}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ sheets

function SheetHead({ title, onClose, disabled = false }: { title: string; onClose: () => void; disabled?: boolean }): React.ReactElement {
  return (
    <View style={styles.sheetHead}>
      <Text style={styles.h2} accessibilityRole="header" numberOfLines={2}>{title}</Text>
      <Button label={TILL_COPY.close} variant="ghost" size="sm" disabled={disabled} onPress={onClose} />
    </View>
  );
}

function ChoicesSheet({
  item,
  currency,
  onClose,
  onAdd,
}: {
  item: TillMenuItem | null;
  currency: string;
  onClose: () => void;
  onAdd: (line: Omit<DraftLine, "key">) => void;
}): React.ReactElement {
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  useEffect(() => {
    setPicked([]);
    setQty(1);
    setNote("");
  }, [item?.id]);
  const groups = item?.modifierGroups ?? [];
  const valid = groups.every((g) => {
    const n = g.modifiers.filter((m) => picked.includes(m.id)).length;
    return n >= g.minSelect && (g.maxSelect <= 0 || n <= g.maxSelect);
  });
  const toggle = (groupId: string, modifierId: string): void => {
    const group = groups.find((g) => g.id === groupId);
    if (group === undefined) return;
    setPicked((p) => {
      if (p.includes(modifierId)) return p.filter((x) => x !== modifierId);
      const inGroup = group.modifiers.map((m) => m.id);
      const single = group.maxSelect === 1;
      return single ? [...p.filter((x) => !inGroup.includes(x)), modifierId] : [...p, modifierId];
    });
  };
  const names = groups.flatMap((g) => g.modifiers.filter((m) => picked.includes(m.id)).map((m) => m.name));
  // Display only, so staff can read the price back; the server prices the line.
  const estimate =
    ((item?.priceMinor ?? 0) +
      groups.flatMap((g) => g.modifiers).filter((m) => picked.includes(m.id)).reduce((n, m) => n + m.priceDeltaMinor, 0)) *
    qty;
  return (
    <Sheet visible={item !== null} onClose={onClose} snapPoint={0.85} testID="till-choices">
      <View style={styles.grow}>
        <SheetHead title={item?.name ?? ""} onClose={onClose} />
        <SheetScrollLayout
          keyboardAware
          contentStyle={styles.sheetScroll}
          footer={
            <Button
              label={TILL_COPY.add(qty, formatCurrency(estimate, currency, true))}
              variant="primary"
              size="lg"
              fullWidth
              disabled={!valid}
              onPress={() => {
                if (item === null) return;
                onAdd({
                  menuItemId: item.id,
                  name: item.name,
                  quantity: qty,
                  modifierIds: picked,
                  modifierNames: names,
                  notes: note.trim().length > 0 ? note.trim().slice(0, 140) : null,
                  station: item.station,
                });
              }}
              testID="till-choices-add"
            />
          }
        >
          {groups.map((g) => (
            <View key={g.id} style={styles.group}>
              <Text style={styles.label}>{g.name}</Text>
              <View style={styles.chips}>
                {g.modifiers.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.priceDeltaMinor !== 0 ? `${m.name} · ${formatCurrency(m.priceDeltaMinor, currency, true)}` : m.name}
                    selected={picked.includes(m.id)}
                    disabled={!m.available}
                    onPress={() => toggle(g.id, m.id)}
                  />
                ))}
              </View>
            </View>
          ))}
          <NumberStepper label={TILL_COPY.quantity} value={qty} min={1} max={99} onChange={setQty} />
          {item?.allowsNotes !== false ? (
            <Input value={note} onChangeText={(t) => setNote(t.slice(0, 140))} placeholder={TILL_COPY.noteForKitchen} accessibilityLabel={TILL_COPY.noteForKitchen} />
          ) : null}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function OfferSheet({
  state,
  currency,
  busy,
  onChange,
  onClose,
  onAdd,
}: {
  state: { offer: VenueOffer; counts: Record<string, number>; guestListEntryId: string | null } | null;
  currency: string;
  busy: boolean;
  onChange: (next: { offer: VenueOffer; counts: Record<string, number>; guestListEntryId: string | null }) => void;
  onClose: () => void;
  onAdd: (lines: Array<{ priceOptionId: string; guests: number }>, guestListEntryId: string | null) => void;
}): React.ReactElement {
  const options = (state?.offer.options ?? []).filter(
    (o) => o.status === "active" && (state?.guestListEntryId == null || (state.counts[o.id] ?? 0) > 0),
  );
  const lines = options.filter((o) => (state?.counts[o.id] ?? 0) > 0).map((o) => ({ priceOptionId: o.id, guests: state?.counts[o.id] ?? 0 }));
  const guests = lines.reduce((n, l) => n + l.guests, 0);
  // Display only; the server quotes the day's price when the line is added.
  const estimate = options.reduce((n, o) => n + o.priceMinor * (state?.counts[o.id] ?? 0), 0);
  return (
    <Sheet visible={state !== null} onClose={onClose} snapPoint={0.85} dismissDisabled={busy} testID="till-offer-sheet">
      <View style={styles.grow}>
        <SheetHead title={state?.offer.name ?? ""} onClose={onClose} disabled={busy} />
        <SheetScrollLayout
          contentStyle={styles.sheetScroll}
          footer={
            <Button label={TILL_COPY.add(guests, formatCurrency(estimate, currency, true))} variant="primary" size="lg" fullWidth loading={busy} disabled={lines.length === 0}
              onPress={() => onAdd(lines, state?.guestListEntryId ?? null)} testID="till-offer-add" />
          }
        >
          {options.map((o) => (
            <NumberStepper
              key={o.id}
              label={`${o.name} · ${formatCurrency(o.priceMinor, currency, true)}`}
              value={state?.counts[o.id] ?? 0}
              min={0}
              max={Math.max(1, o.guestMax)}
              onChange={(n) => state !== null && onChange({ ...state, counts: { ...state.counts, [o.id]: n } })}
              testID={`till-offer-option-${o.id}`}
            />
          ))}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function ChecksSheet({
  visible,
  checks,
  loading,
  currency,
  onClose,
  onPick,
  onNew,
}: {
  visible: boolean;
  checks: { open: Array<{ id: string; checkLabel: string | null; spotLabel: string | null; totalDueMinor: number; paidMinor: number; waitingForPayment: boolean }>; paid: Array<{ id: string; checkLabel: string | null; spotLabel: string | null; totalDueMinor: number }> } | null;
  loading: boolean;
  currency: string;
  onClose: () => void;
  onPick: (id: string) => void;
  onNew: () => void;
}): React.ReactElement {
  const [view, setView] = useState<"open" | "paid">("open");
  const list = view === "open" ? checks?.open ?? [] : checks?.paid ?? [];
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.85} testID="till-checks">
      <View style={styles.grow}>
        <SheetHead title={TILL_COPY.checks} onClose={onClose} />
        <Segmented
          options={[
            { key: "open", label: TILL_COPY.openCount(checks?.open.length ?? 0) },
            { key: "paid", label: TILL_COPY.paidTodayCount(checks?.paid.length ?? 0) },
          ]}
          value={view}
          onChange={setView}
          style={styles.tabs}
        />
        <SheetScrollLayout contentStyle={styles.sheetScroll}
          footer={<Button label={TILL_COPY.newCheck} variant="secondary" size="md" fullWidth onPress={onNew} testID="till-new-check" />}>
          {loading ? <Skeleton height={56} /> : null}
          {list.map((c) => (
            <ListRow
              key={c.id}
              title={c.checkLabel ?? c.spotLabel ?? TILL_COPY.newCheck}
              value={formatCurrency(c.totalDueMinor, currency, true)}
              trailing={"waitingForPayment" in c && c.waitingForPayment ? <Pill variant="warn">{TILL_COPY.waitingForPayment}</Pill> : undefined}
              onPress={() => onPick(c.id)}
              testID={`till-check-${c.id}`}
            />
          ))}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function NameSheet({ visible, busy, onClose, onSave }: { visible: boolean; busy: boolean; onClose: () => void; onSave: (label: string | null) => void }): React.ReactElement {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (visible) setLabel("");
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.6} dismissDisabled={busy} testID="till-name">
      <View style={styles.grow}>
        <SheetHead title={TILL_COPY.saveCheck} onClose={onClose} disabled={busy} />
        <SheetScrollLayout keyboardAware contentStyle={styles.sheetScroll}
          footer={<Button label={TILL_COPY.saveCheck} variant="primary" size="lg" fullWidth loading={busy}
            onPress={() => onSave(label.trim().length > 0 ? label.trim().slice(0, 40) : null)} testID="till-name-save" />}>
          <Input value={label} onChangeText={(t) => setLabel(t.slice(0, 40))} placeholder={TILL_COPY.nameOnCheck}
            accessibilityLabel={TILL_COPY.nameOnCheck} testID="till-name-input" />
          <Text style={styles.muted}>{TILL_COPY.nameOnCheckHint}</Text>
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function VoidSheet({ row, currency, busy, onClose, onVoid }: { row: BasketRow | null; currency: string; busy: boolean; onClose: () => void; onVoid: (reason: string) => void }): React.ReactElement {
  const [reason, setReason] = useState<string>(TILL_COPY.voidReasons[0].label);
  useEffect(() => {
    setReason(TILL_COPY.voidReasons[0].label);
  }, [row?.key]);
  return (
    <Sheet visible={row !== null} onClose={onClose} snapPoint={0.6} dismissDisabled={busy} testID="till-void">
      <View style={styles.grow}>
        <SheetHead title={row !== null ? TILL_COPY.voidItem(row.label) : TILL_COPY.void} onClose={onClose} disabled={busy} />
        <SheetScrollLayout contentStyle={styles.sheetScroll}
          footer={<Button label={row !== null ? `${TILL_COPY.void} · ${formatCurrency(row.amountMinor, currency, true)}` : TILL_COPY.void}
            variant="destructive" size="lg" fullWidth loading={busy} onPress={() => onVoid(reason)} testID="till-void-confirm" />}>
          <Text style={styles.label}>{TILL_COPY.why}</Text>
          <View style={styles.chips}>
            {TILL_COPY.voidReasons.map((r) => (
              <Chip key={r.key} label={r.label} selected={reason === r.label} onPress={() => setReason(r.label)} testID={`till-void-${r.key}`} />
            ))}
          </View>
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function RefundSheet({
  payment,
  currency,
  busy,
  onClose,
  onRefund,
}: {
  payment: { id: string; amountMinor: number; tipMinor: number; refundedMinor: number } | null;
  currency: string;
  busy: boolean;
  onClose: () => void;
  onRefund: (amountMinor: number, reason: string) => void;
}): React.ReactElement {
  const max = payment === null ? 0 : payment.amountMinor + payment.tipMinor - payment.refundedMinor;
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState<string>(TILL_COPY.refundReasons[0].label);
  useEffect(() => {
    setAmount(null);
    setReason(TILL_COPY.refundReasons[0].label);
  }, [payment?.id]);
  const value = amount ?? max;
  return (
    <Sheet visible={payment !== null} onClose={onClose} snapPoint={0.7} dismissDisabled={busy} testID="till-refund">
      <View style={styles.grow}>
        <SheetHead title={TILL_COPY.refund} onClose={onClose} disabled={busy} />
        <SheetScrollLayout keyboardAware contentStyle={styles.sheetScroll}
          footer={<Button label={TILL_COPY.refundAmount(formatCurrency(value, currency, true))} variant="primary" size="lg" fullWidth
            loading={busy} disabled={value <= 0 || value > max} onPress={() => onRefund(value, reason)} testID="till-refund-confirm" />}>
          <MoneyField label={TILL_COPY.amountToRefund} valueMinor={value} onChangeMinor={setAmount} currency={currency} testID="till-refund-amount" />
          <Text style={styles.label}>{TILL_COPY.reason}</Text>
          <View style={styles.chips}>
            {TILL_COPY.refundReasons.map((r) => (
              <Chip key={r.key} label={r.label} selected={reason === r.label} onPress={() => setReason(r.label)} />
            ))}
          </View>
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2] },
  title: { ...type.h2, color: color.text1, flex: 1, textAlign: "center" },
  tabs: { marginHorizontal: space[4], marginBottom: space[2] },
  main: { flex: 1 },
  mainWide: { flexDirection: "row" },
  side: { width: size.sidePanel, borderLeftWidth: 1, borderLeftColor: color.line, padding: space[3] },
  grow: { flex: 1 },
  catalogScroll: { padding: space[4], gap: space[3] },
  catalogCol: { gap: space[3] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { width: 160, minHeight: 88, padding: space[3], borderRadius: radius.lg, backgroundColor: color.card, borderWidth: 1, borderColor: color.line, justifyContent: "space-between", gap: space[2] },
  tilePhone: { width: "47%" },
  tilePressed: { backgroundColor: color.card2 },
  tileOff: { opacity: 0.5 },
  tileName: { ...type.body, color: color.text1 },
  tileFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[1] },
  tilePrice: { ...type.small, color: color.text2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  basket: { flex: 1, gap: space[3] },
  basketHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  basketList: { gap: space[1], paddingBottom: space[2] },
  draftRow: { paddingVertical: space[1] },
  totals: { gap: space[1], paddingTop: space[2], borderTopWidth: 1, borderTopColor: color.line },
  totalRow: { flexDirection: "row", justifyContent: "space-between", gap: space[2] },
  totalStrong: { ...type.row, color: color.text1 },
  value: { ...type.body, color: color.text1 },
  actionsRow: { flexDirection: "row", gap: space[2] },
  bottomBar: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.card },
  bottomInfo: { flex: 1, minHeight: size.btn.md, justifyContent: "center" },
  sheetPad: { flex: 1, paddingHorizontal: space[4], paddingBottom: space[4] },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2] },
  sheetScroll: { gap: space[3], paddingBottom: space[4], paddingHorizontal: space[1] },
  group: { gap: space[2] },
  paidList: { gap: space[1] },
  paidActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] },
  h2: { ...type.h2, color: color.text1, flexShrink: 1 },
  h3: { ...type.row, color: color.text1, flexShrink: 1 },
  label: { ...type.small, color: color.text2 },
  muted: { ...type.small, color: color.text2 },
});
