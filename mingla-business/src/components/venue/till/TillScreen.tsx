/**
 * #4490 spec 08 O1 — the Till (`/venue/[venueId]/till`, full screen, outside
 * the venue rail). Catalog + basket; one check at a time; one payment sheet.
 *
 * Money rules (spec 08 §4): every total on screen is the server's. Items
 * picked on this device form a draft that is priced by the server when it is
 * added to the check (Save check, Send, Pay); until then the totals read "--"
 * (rule 9). A sold-out or changed item is refused by the server in words.
 *
 * Corrections (O1 fix 1): a part payment no longer freezes a check (unpaid
 * lines can still be voided; money beyond the new total is shown to refund);
 * a paid entry line is refunded by line (its booking is cancelled); the check
 * can be moved to another table, handed over or renamed (T9).
 *
 * Layout (spec 08 §2, `floorLayoutFor`): phone < 600 shows the catalog full
 * width with a bottom bar that opens the basket; tablet and desk show the
 * basket beside the catalog at `size.sidePanel`. (The full tablet layout with
 * rotation is O3; this holds at 390, 768, 1024 and 1440.)
 *
 * O4: the pay sheet splits the bill (its split step); a Tables tab seats a
 * walk-in or a booking (a paid deposit comes off the bill); a By the hour tab
 * starts a session now, and a session on the check shows its clock with
 * "Add 30 min". Every sheet here opens from the catalog or the basket, one at
 * a time, never two native sheets from one screen (08-O3 fix 3).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { useVenueOffers } from "../../../hooks/useVenueOffers";
import { isSoldOutRefusal } from "../../../hooks/stockRefresh";
import { useTillActions, useTillCatalog, useTillChecks, useTillSale, useTillServers } from "../../../hooks/useVenueTill";
import type {
  TillCatalog,
  TillHourOffer,
  TillMenuItem,
  TillSale,
  TillServer,
  TillTable,
} from "../../../services/venueTillService";
import {
  cancelTillPayCode,
  fetchTillPayCode,
  keepTillLatePayment,
  startTillScan,
  startTillTap,
  textTillPayCode,
  TillError,
} from "../../../services/venueTillService";
import { useTapToPayBrandFacts } from "../../../hooks/useTapToPayBrandFacts";
import { useTapToPayRelease } from "../../../hooks/useTapToPayRelease";
import { currentTapToPayDevice } from "../../../services/terminal/tapToPayDevice";
import { setTapToPayScope } from "../../../services/terminal/tapToPaySession";
import { tillTapOffer } from "./tillTapAvailability";
import { closeHref } from "../close/closeRoute";
import { CLOSE_COPY } from "../close/dayCloseCopy";
import { latePayments, paidLabel, tillAttemptFor, tillAttemptKeepsId, tillAttemptKey, type TillAttempt } from "./tillPayModel";
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
import { Switch } from "../../ui/Switch";
import { Toast } from "../../ui/Toast";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { PaymentSheet } from "./PaymentSheet";
import { useStationsEntry } from "../../../hooks/useStationsEntry";
import { stationHref } from "../station/stationRoute";
import { openFloorPdf } from "../../../utils/floorPdf";
import { STATION_COPY, stationErrorCopy } from "../station/stationCopy";
import { runStationAction, StationError } from "../../../services/venueStationService";
import { ReceiptStep } from "./ReceiptStep";
import { TillStepUpHost, useStepUpSheet } from "./TillStepUp";
import type { TillPinPerson } from "../../../services/venueTillService";
import { TILL_COPY, tillErrorCopy } from "./tillCopy";
import { checkTitle } from "./checkLabel";
import { stockPill, tillSoldOutSentence } from "../stock/stockModel";
import {
  basketLaunchedAfterClose,
  basketSheetsNest,
  checkSheetGone,
  pickCheckSheet,
  refundHost,
  type TillCheckSheet,
} from "./tillSheetModel";
import {
  addToDraft,
  basketRows,
  clockTime,
  extendMinutes,
  sessionClocks,
  sessionLengths,
  floorLayoutFor,
  readyToTakeOut,
  tillDestination,
  unacceptedRound,
  handoverChoices,
  itemNeedsChoices,
  itemSellable,
  moveTargets,
  overpaidToRefund,
  rowCanVoid,
  rowRefundable,
  sendLabel,
  serverName,
  setDraftQuantity,
  coveredByCredit,
  payActionShown,
  saveCheckEnabled,
  saleTakesItems,
  tillHeaderStacked,
  depositExcessMinor,
  totalsReady,
  voidAsksRestock,
  type BasketRow,
  type DraftLine,
  type MoveTarget,
  type TillPrefill,
} from "./tillModel";

export interface TillScreenProps {
  venueId: string;
  prefill?: TillPrefill | null;
  /** Open on the Open checks list (from Orders › Open checks). */
  openChecksOnStart?: boolean;
  /** #4490 O5: on a Till device, "{name} is selling · Switch" (TillGate). */
  sellerSlot?: React.ReactNode;
  /** #4490 O5: who may approve a refund or a sent void on the spot (TillGate). */
  stepUpApprovers?: readonly TillPinPerson[];
  /**
   * #4490 08-O5 fix 2 (carried 1): guest orders waiting for a swap or a refund
   * (TillSoldOutHost: its banner, and its one sheet). A Till device login has no
   * Orders screen, so the Till carries it. Supplied by the gate.
   */
  soldOutSlot?: React.ReactNode;
}

type ToastState = { kind: "success" | "error"; message: string } | null;

const NO_APPROVERS: readonly TillPinPerson[] = [];

/** #4490 O5: where a refund or sent void asks for a fresh PIN (inside its own sheet). */
type StepUpProps = { venueId: string; approvers: readonly TillPinPerson[] };

export function TillScreen({
  venueId,
  prefill = null,
  openChecksOnStart = false,
  sellerSlot = null,
  stepUpApprovers = NO_APPROVERS,
  soldOutSlot = null,
}: TillScreenProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const layout = floorLayoutFor(width);
  const stepUpProps = useMemo<StepUpProps>(() => ({ venueId, approvers: stepUpApprovers }), [venueId, stepUpApprovers]);
  const catalogQuery = useTillCatalog(venueId);
  const catalog = catalogQuery.data ?? null;
  // #4490 spec 08 O3: the kitchen and bar screens, for those who may work them.
  const stationsEntry = useStationsEntry(catalog?.brandId ?? null, venueId);
  const offersQuery = useVenueOffers(catalog?.brandId ?? null, venueId);
  const [saleId, setSaleId] = useState<string | null>(null);
  const saleQuery = useTillSale(venueId, saleId);
  const sale = saleId !== null ? saleQuery.data ?? null : null;
  const [checksOpen, setChecksOpen] = useState(openChecksOnStart);

  const checksQuery = useTillChecks(venueId, true);
  const actions = useTillActions(venueId);

  const [tab, setTab] = useState<"menu" | "entry" | "hour" | "tables">(prefill?.tab ?? "menu");
  // 08-O4: start a by-the-hour session; seat a table.
  const [sessionFor, setSessionFor] = useState<TillHourOffer | null>(null);
  const [seatFor, setSeatFor] = useState<TillTable | null>(null);
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
  const [checkSheet, setCheckSheet] = useState<TillCheckSheet | null>(null);
  // #4490 O3-S1: Move / Hand over / Rename open once the actions sheet has gone (iOS).
  const queuedCheckSheet = useRef<TillCheckSheet | null>(null);
  const openCheckSheet = useCallback((next: TillCheckSheet): void => {
    const step = pickCheckSheet(next, Platform.OS);
    queuedCheckSheet.current = step.queued;
    setCheckSheet(step.shown);
  }, []);
  const closeCheckSheet = useCallback((): void => {
    queuedCheckSheet.current = null;
    setCheckSheet(null);
  }, []);
  const checkActionsGone = useCallback((): void => {
    const step = checkSheetGone({ shown: null, queued: queuedCheckSheet.current });
    queuedCheckSheet.current = null;
    if (step.shown !== null) setCheckSheet(step.shown);
  }, []);
  const [lineRefund, setLineRefund] = useState<BasketRow | null>(null);
  // 08-O3 fix 5: one request id per refund attempt (same payment or line,
  // amount and tip): an unclear failure keeps it so "Try again" refunds once;
  // a server answer (done or refused) ends the attempt.
  const refundAttempt = useRef<TillAttempt | null>(null);
  const serversQuery = useTillServers(venueId, checkSheet === "actions" || checkSheet === "handover");

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
      const refresh = ["till_check_changed", "till_hold_lapsed", "till_tab_settled_on_pad", "till_round_settled_elsewhere",
        "till_line_not_paid", "till_refund_line_invalid", "till_share_paid", "till_share_paying", "till_close_not_covered"];
      if (refresh.includes(code) && saleId !== null) actions.refreshSale(saleId);
      // T13: "The next booking for {unit} is at {time}."
      if (code === "offer_space_taken" && err instanceof TillError && err.nextAt !== null && err.unitName !== null) {
        setToast({ kind: "error", message: TILL_COPY.nextBookingAt(err.unitName, clockTime(err.nextAt)) });
        return;
      }
      // 08-O4 fix 1 (O4-T4): the unit is still in use; when it frees up.
      if (code === "offer_space_taken" && err instanceof TillError && err.freeAt !== null && err.unitName !== null) {
        setToast({ kind: "error", message: TILL_COPY.inUseUntil(err.unitName, clockTime(err.freeAt)) });
        return;
      }
      // #4490 O5 part C: "{item} sold out. Take it off before sending." / "Only {n} left."
      if (code === "item_sold_out" && err instanceof TillError) {
        setToast({ kind: "error", message: tillSoldOutSentence("send", err.item, err.stockLeft) });
        if (saleId !== null) actions.refreshSale(saleId);
        return;
      }
      setToast({ kind: "error", message: tillErrorCopy(code, item) });
    },
    [actions, saleId],
  );

  /** The check this sale lives on: opened on the first add. */
  const ensureSale = useCallback(async (): Promise<TillSale> => {
    // #4490 08-O5 fix 5: never add to a paid check; a new one opens instead.
    if (sale !== null && saleTakesItems(sale)) return sale;
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

  // #4490 08-O5 fix 5: an item picked while a paid check is on screen starts
  // a new sale (the paid check leaves the screen) instead of joining it.
  const addLine = (line: Omit<DraftLine, "key">): void => {
    if (!saleTakesItems(sale)) {
      setPayOpen(false);
      setSaleId(null);
      setDraft(addToDraft([], line));
      return;
    }
    setDraft((d) => addToDraft(d, line));
  };

  const onTile = (item: TillMenuItem): void => {
    if (!itemSellable(item)) return;
    if (itemNeedsChoices(item)) {
      setChoicesFor(item);
      return;
    }
    addLine({ menuItemId: item.id, name: item.name, quantity: 1, modifierIds: [], modifierNames: [], notes: null, station: item.station });
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

  // #4490 O3-S1: on an iPhone the basket is a native modal, so every sheet it
  // opens renders INSIDE it (see tillSheetModel). Closing the basket closes
  // them with it, so no state says a sheet is open that is not on screen.
  const nestInBasket = basketSheetsNest(layout, Platform.OS);
  const closeBasket = (): void => {
    setBasketSheet(false);
    const left = basketLaunchedAfterClose(
      { pay: payOpen, name: nameSheet, voidRow: voidRow !== null, lineRefund: lineRefund !== null, check: checkSheet, refund: refundFor !== null },
      nestInBasket,
    );
    if (!left.pay) setPayOpen(false);
    if (!left.name) setNameSheet(false);
    if (!left.voidRow) setVoidRow(null);
    if (!left.lineRefund) setLineRefund(null);
    if (left.check === null) closeCheckSheet();
    if (!left.refund) setRefundFor(null);
  };

  // #4490 O3 A2: a 15 s clock for "Not accepted · {n} min" (the server's times).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const rows = basketRows(sale, nowMs);
  const clocks = sessionClocks(sale, nowMs);
  const overSession = clocks.find((c) => c.overBy !== null && c.overBy > 0) ?? null;
  const extend = (lineId: string, stepMinutes: number): void =>
    void run(async () => {
      if (sale === null) return;
      try {
        await actions.extendSession.mutateAsync({
          saleId: sale.id,
          lineId,
          minutes: extendMinutes(stepMinutes),
          idempotencyKey: `extend:${randomId()}`,
          expectedVersion: sale.version,
        });
      } catch (err) {
        fail(err);
      }
    });
  const ready = totalsReady(sale, draft);
  const send = sendLabel(sale, draft, catalog);
  const sendText = send === "bar" ? TILL_COPY.sendToBar : send === "kitchen" ? TILL_COPY.sendToKitchen : TILL_COPY.send;
  const itemCount = rows.filter((r) => !r.voided).reduce((n, r) => n + r.quantity, 0) + draft.reduce((n, d) => n + d.quantity, 0);
  // 08-O4 fix 1 (O4-T2): the deposit pays the whole bill; the primary action closes the check.
  const covered = ready && coveredByCredit(sale);
  const payLabel = covered
    ? TILL_COPY.closeCheck
    : ready && sale !== null ? TILL_COPY.pay(money(sale.remainingMinor)) : TILL_COPY.payPending;
  const nothingOnCheck = rows.length === 0 && draft.length === 0;
  // #4490 O5: on a Till device a manager with money rights can approve on the spot.
  const canManageMoney = catalog?.canManageMoney === true || stepUpApprovers.length > 0;
  // #4490 O2: Tap to pay where this phone, this build, the brand and the
  // release all allow it (the matrix in tillTapAvailability).
  const tapBrand = useTapToPayBrandFacts(catalog?.brandId ?? null);
  const tapRelease = useTapToPayRelease(catalog?.brandId ?? null);
  const tapOffer = useMemo(
    () =>
      tillTapOffer({
        brand: tapBrand,
        release: { iphone: tapRelease.live, android: tapRelease.live },
        device: currentTapToPayDevice(),
        canSell: catalog !== null,
        serverAllows: catalog?.tapAvailable === true,
      }),
    [tapBrand, tapRelease.live, catalog],
  );
  // The app's one Terminal session works for this venue while the Till is open.
  useEffect(() => {
    if (tapOffer.kind !== "ready" || catalog === null) return undefined;
    setTapToPayScope({ brandId: catalog.brandId, eventId: null, venueId, merchantDisplayName: catalog.venueName ?? null });
    return () => setTapToPayScope(null);
  }, [tapOffer.kind, catalog, venueId]);
  const scanApi = useMemo(
    () => ({
      fetchStatus: (code: string) => fetchTillPayCode({ venueId, code }),
      cancelCode: async (code: string) => {
        await cancelTillPayCode({ venueId, code });
      },
      textLink: (input: { code: string; phone: string; phoneCountryIso: string | null }) =>
        textTillPayCode({ venueId, ...input }),
    }),
    [venueId],
  );
  const overpaid = overpaidToRefund(sale);
  // O2 late money: refund it, or keep it towards what is still due.
  const late = latePayments(sale);
  const [keeping, setKeeping] = useState<string | null>(null);
  const keepLate = async (paymentId: string): Promise<void> => {
    if (sale === null || keeping !== null) return;
    setKeeping(paymentId);
    try {
      await keepTillLatePayment({ venueId, paymentId, expectedVersion: sale.version });
      setToast({ kind: "success", message: TILL_COPY.lateKept });
    } catch (err) {
      setToast({ kind: "error", message: tillErrorCopy(err instanceof TillError ? err.code : "till_failed") });
    } finally {
      setKeeping(null);
      actions.refreshSale(sale.id);
    }
  };
  // #4490 spec 08 §11 T5 / T7: the kitchen's word on this check.
  const destination = tillDestination(sale, TILL_COPY.thisCheck);
  const onThePass = readyToTakeOut(sale);
  const waitingRound = unacceptedRound(sale, nowMs);
  const [kitchenBusy, setKitchenBusy] = useState<"pickup" | "print" | null>(null);
  const pickUp = async (): Promise<void> => {
    if (sale === null || kitchenBusy !== null) return;
    setKitchenBusy("pickup");
    try {
      for (const round of onThePass) {
        for (const station of round.stations) await runStationAction("picked_up", round.orderId, station);
      }
    } catch (err) {
      setToast({ kind: "error", message: stationErrorCopy(err instanceof StationError ? err.code : "station_failed") });
    } finally {
      setKitchenBusy(null);
      actions.refreshSale(sale.id);
    }
  };
  const printWaiting = async (): Promise<void> => {
    if (waitingRound === null || kitchenBusy !== null) return;
    setKitchenBusy("print");
    try {
      await openFloorPdf({ kind: "kitchen_ticket", venueId, orderId: waitingRound.orderId, station: waitingRound.station });
    } catch (err) {
      setToast({ kind: "error", message: stationErrorCopy(err instanceof StationError ? err.code : "floor_pdf_failed") });
    } finally {
      setKitchenBusy(null);
    }
  };
  // #4490 08-O5 fix 5: one name per check on every list ("Check #<ref>" when unnamed).
  const checkName = sale === null ? TILL_COPY.newCheck : checkTitle({ id: sale.id, label: sale.checkLabel, spotLabel: sale.spotLabel });
  const servers = serversQuery.data ?? [];
  const currentServer = serverName(servers, sale?.serverUserId ?? null, TILL_COPY.teamMember);
  const canMoveCheck = sale !== null && sale.state === "open" && !sale.pendingPayment;

  // ---------------------------------------------------------------- catalog
  const menus = catalog?.menus ?? [];
  const menu = menus[Math.min(menuIndex, Math.max(0, menus.length - 1))] ?? null;
  const hourOffers = catalog?.hourOffers ?? [];
  const tables = catalog?.tables ?? [];
  const tabs = [
    ...(menus.length > 0 ? [{ key: "menu" as const, label: TILL_COPY.menu }] : []),
    ...(entryOffers.length > 0 ? [{ key: "entry" as const, label: TILL_COPY.entry }] : []),
    ...(hourOffers.length > 0 ? [{ key: "hour" as const, label: TILL_COPY.byTheHour }] : []),
    ...(tables.length > 0 ? [{ key: "tables" as const, label: TILL_COPY.tables }] : []),
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
  } else if (activeTab === "hour") {
    catalogBody = (
      <View style={styles.grid}>
        {hourOffers.map((offer) => (
          <Pressable
            key={offer.id}
            accessibilityRole="button"
            accessibilityLabel={TILL_COPY.tileLabel(
              TILL_COPY.startHourLabel(offer.name),
              offer.pricePerHourMinor === null ? null : TILL_COPY.perHour(money(offer.pricePerHourMinor)),
              null,
            )}
            onPress={() => setSessionFor(offer)}
            style={({ pressed }) => [styles.tile, layout === "phone" && styles.tilePhone, pressed && styles.tilePressed]}
            testID={`till-hour-${offer.id}`}
          >
            <Text style={styles.tileName} numberOfLines={2}>{offer.name}</Text>
            <Text style={styles.tilePrice}>
              {offer.pricePerHourMinor === null ? "--" : TILL_COPY.perHour(money(offer.pricePerHourMinor))}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  } else if (activeTab === "tables") {
    catalogBody = (
      <View style={styles.grid}>
        {tables.map((table) => (
          <Pressable
            key={table.spotId}
            accessibilityRole="button"
            accessibilityLabel={TILL_COPY.tileLabel(
              TILL_COPY.seatTableLabel(table.name),
              TILL_COPY.tableTileDetail(table.minSpendMinor === null ? null : money(table.minSpendMinor), table.capacity),
              table.hasCheck ? TILL_COPY.tableBusy : table.bookings.length > 0 ? TILL_COPY.seatBooking : null,
            )}
            accessibilityState={{ disabled: table.hasCheck }}
            disabled={table.hasCheck}
            onPress={() => setSeatFor(table)}
            style={({ pressed }) => [styles.tile, layout === "phone" && styles.tilePhone, table.hasCheck && styles.tileOff,
              pressed && styles.tilePressed]}
            testID={`till-table-${table.spotId}`}
          >
            <Text style={styles.tileName} numberOfLines={2}>{table.name}</Text>
            <View style={styles.tileFoot}>
              <Text style={styles.tilePrice}>
                {table.minSpendMinor !== null ? TILL_COPY.minSpendTable(money(table.minSpendMinor)) : `${table.capacity}`}
              </Text>
              {table.hasCheck ? <Pill variant="info">{TILL_COPY.tableBusy}</Pill> : table.bookings.length > 0 ? (
                <Pill variant="accent">{TILL_COPY.seatBooking}</Pill>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
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
              accessibilityLabel={TILL_COPY.tileLabel(
                TILL_COPY.sellEntryLabel(offer.name),
                Number.isFinite(from) ? money(from) : null,
                null,
              )}
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
            const stock = sellable ? stockPill(item.stockLeft, item.stockWarnAt) : null;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={TILL_COPY.tileLabel(
                  TILL_COPY.addItemLabel(item.name),
                  item.priceMinor === null ? null : money(item.priceMinor),
                  TILL_COPY.itemTileState(sellable, stock === null ? null : stock.label),
                )}
                accessibilityState={{ disabled: !sellable }}
                disabled={!sellable}
                onPress={() => onTile(item)}
                style={({ pressed }) => [styles.tile, layout === "phone" && styles.tilePhone, !sellable && styles.tileOff, pressed && styles.tilePressed]}
                testID={`till-item-${item.id}`}
              >
                <Text style={styles.tileName} numberOfLines={2}>{item.name}</Text>
                <View style={styles.tileFoot}>
                  <Text style={styles.tilePrice}>{item.priceMinor === null ? "--" : money(item.priceMinor)}</Text>
                  {!sellable ? <Pill variant="draft" style={styles.tilePill} testID={`till-item-sold-out-${item.id}`}>{TILL_COPY.soldOut}</Pill> : stock === null ? null : (
                    // #4490 O5 part C: "{n} left" while counted (warning tone at "Warn me at").
                    <Pill variant={stock.tone === "warn" ? "warn" : "muted"} style={styles.tilePill} testID={`till-item-stock-${item.id}`}>{stock.label}</Pill>
                  )}
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
        <Text style={styles.h3} numberOfLines={1}>{checkName}</Text>
        {sale !== null && sale.settledOutside !== null ? <Pill variant="info">{TILL_COPY.settledOnPad}</Pill> : null}
        {sale !== null && sale.state === "open" && sale.paidMinor > 0 ? <Pill variant="info">{TILL_COPY.leftToPay}</Pill> : null}
        {canMoveCheck ? (
          <Button label={TILL_COPY.checkActions} variant="ghost" size="sm" onPress={() => setCheckSheet("actions")}
            testID="till-check-actions" />
        ) : null}
      </View>
      {late.length > 0 ? (
        <View style={styles.lateBox} testID="till-late-money">
          {late.map(({ payment, canKeep }) => (
            <View key={payment.id} style={styles.lateRow}>
              <Banner tone="warning" title={TILL_COPY.latePaid} body={`${money(payment.amountMinor + payment.tipMinor)} · ${paidLabel(payment)}`} />
              <View style={styles.lateActions}>
                {canManageMoney ? (
                  <Button label={TILL_COPY.refundIt} variant="secondary" size="sm" onPress={() => setRefundFor(payment.id)} testID="till-late-refund" />
                ) : null}
                {canKeep ? (
                  <Button label={TILL_COPY.keepAsPayment} variant="primary" size="sm" loading={keeping === payment.id}
                    onPress={() => void keepLate(payment.id)} testID="till-late-keep" />
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : overpaid > 0 ? (
        <Banner tone="warning" title={TILL_COPY.overpaid(money(overpaid))} testID="till-overpaid" />
      ) : null}
      {onThePass.length > 0 ? (
        <Banner
          tone="ok"
          title={TILL_COPY.readyToTakeOut(destination)}
          body={TILL_COPY.stationNames(Array.from(new Set(onThePass.flatMap((r) => r.stations))))}
          action={{ label: TILL_COPY.pickedUp, onPress: () => void pickUp(), testID: "till-picked-up" }}
          testID="till-ready-banner"
        />
      ) : waitingRound !== null ? (
        <Banner
          tone="warning"
          title={TILL_COPY.nobodyAccepted(destination)}
          body={`${TILL_COPY.notAccepted(waitingRound.minutes)}. ${TILL_COPY.nobodyAcceptedBody}`}
          action={{ label: TILL_COPY.printTicket, onPress: () => void printWaiting(), testID: "till-print-ticket" }}
          testID="till-unaccepted-banner"
        />
      ) : null}
      {overSession !== null ? (
        <Banner
          tone="warning"
          title={TILL_COPY.unitOver(overSession.unitName, overSession.overBy ?? 0)}
          action={{
            label: TILL_COPY.addMinutes(extendMinutes(overSession.stepMinutes)),
            onPress: () => extend(overSession.rootLineId, overSession.stepMinutes),
            testID: "till-session-over-add",
          }}
          testID="till-session-over"
        />
      ) : null}
      <ScrollView style={styles.grow} contentContainerStyle={styles.basketList}>
        {rows.map((row) => {
          const clock = row.kind === "session" ? clocks.find((c) => c.rootLineId === row.lineId) ?? null : null;
          return (
          <ListRow
            key={row.key}
            title={`${row.quantity > 1 ? `${row.quantity} × ` : ""}${row.label}`}
            subtitle={
              row.voided
                ? TILL_COPY.void
                : row.lineState === "refunded"
                ? TILL_COPY.refunded
                : row.kind === "deposit"
                ? TILL_COPY.depositComesOff
                : clock !== null
                ? clock.overBy !== null && clock.overBy > 0
                  ? TILL_COPY.overBy(clock.overBy)
                  : clock.minutesLeft !== null
                  ? TILL_COPY.minutesLeft(clock.minutesLeft)
                  : undefined
                : kitchenSubtitle(row) ?? undefined
            }
            trailing={
              clock !== null && row.lineState === "held" && !row.voided && sale !== null && sale.state === "open" ? (
                <Button
                  label={TILL_COPY.addMinutes(extendMinutes(clock.stepMinutes))}
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onPress={() => extend(clock.rootLineId, clock.stepMinutes)}
                  testID={`till-session-add-${row.lineId}`}
                />
              ) : undefined
            }
            value={money(row.amountMinor)}
            disabled={row.voided || row.lineState === "refunded"}
            chevron={false}
            onPress={
              rowCanVoid(sale, row)
                ? () => setVoidRow(row)
                : rowRefundable(row, canManageMoney)
                  ? () => setLineRefund(row)
                  : undefined
            }
            testID={`till-row-${row.key}`}
          />
          );
        })}
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
        {sale !== null && (sale.creditUsedMinor ?? 0) > 0 ? (
          <Row label={TILL_COPY.depositPaidOnline} value={ready ? money(-(sale.creditUsedMinor ?? 0)) : "--"} />
        ) : null}
        {/* 08-O4 fix 3 (spec 08 §15): what of a larger deposit goes back to the guest. */}
        {ready && sale !== null && sale.state === "open" && depositExcessMinor(sale) > 0 ? (
          <Text style={styles.muted} testID="till-deposit-excess">{TILL_COPY.depositExcessOnClose(money(depositExcessMinor(sale)))}</Text>
        ) : null}
        {sale !== null && sale.state !== "open" && (sale.depositRefundMinor ?? 0) > 0 ? (
          <Text style={styles.muted} testID="till-deposit-refunded">
            {TILL_COPY.depositUsedRefunded(money(sale.creditUsedMinor ?? 0), money(sale.depositRefundMinor ?? 0))}
          </Text>
        ) : null}
        {sale !== null && sale.minimumSpend != null ? (
          <Text style={sale.minimumSpend.shortMinor > 0 ? styles.warnText : styles.muted} testID="till-min-spend">
            {sale.minimumSpend.shortMinor > 0
              ? TILL_COPY.minSpendLeft(money(sale.minimumSpend.shortMinor))
              : TILL_COPY.minSpendMet}
          </Text>
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
          disabled={busy || nothingOnCheck || !saveCheckEnabled(sale, draft)}
          onPress={() => setNameSheet(true)}
          style={styles.grow}
          testID="till-save"
        />
      </View>
      {/* #4490 08-O5 fix 5: a paid check is read-only; New sale starts the next one. */}
      {sale !== null && !saleTakesItems(sale) && draft.length === 0 ? (
        <Button label={TILL_COPY.newSale} variant="primary" size="lg" fullWidth onPress={() => { setBasketSheet(false); newSale(); }}
          testID="till-basket-new-sale" />
      ) : null}
      {/* #4490 08-O5 fix 4: nothing due on a paid check, so no "Pay 0.00". */}
      {payActionShown(sale, draft) ? <Button
        label={payLabel}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={nothingOnCheck}
        onPress={() =>
          void run(async () => {
            const priced = draft.length > 0 ? await commitDraft(false) : sale;
            if (priced === null) return;
            if (coveredByCredit(priced)) {
              // No money moves: the server closes it with no payment (version-checked).
              let closed: TillSale;
              try {
                closed = await actions.closeCovered.mutateAsync({ saleId: priced.id, expectedVersion: priced.version });
              } catch (err) {
                fail(err);
                return;
              }
              const refunded = closed.depositRefundMinor ?? 0;
              setToast({ kind: "success", message: refunded > 0 ? TILL_COPY.checkClosedRefund(money(refunded)) : TILL_COPY.checkClosed });
              setBasketSheet(false);
              newSale();
              return;
            }
            setPayOpen(true);
          })
        }
        testID="till-pay"
      /> : null}
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

  // #4490 O3-S1: the sheets the basket opens (Pay, Save check, Void, line refund,
  // the check's actions). On an iPhone they render inside the basket's Sheet.
  const basketLaunchedSheets = (
    <>
      <PaymentSheet
        visible={payOpen}
        sale={sale}
        tipsEnabled={catalog?.tipsEnabled ?? false}
        tipBpsOptions={catalog?.tipBpsOptions ?? []}
        onClose={() => setPayOpen(false)}
        onPay={(input) => actions.pay.mutateAsync({ saleId: sale?.id as string, ...input })}
        onSetSplit={(split) =>
          actions.setSplit.mutateAsync({ saleId: sale?.id as string, split, expectedVersion: sale?.version ?? 0 })}
        onNewSale={newSale}
        onRefreshSale={() => {
          if (saleId !== null) actions.refreshSale(saleId);
        }}
        onSendReceipt={({ channel: _channel, ...input }) => sendReceipt(input)}
        venueId={venueId}
        tapOffer={tapOffer}
        onStartCard={async ({ method, ...input }) => {
          // T8: starting a card or scan payment sends what is still held, so the
          // count moves (or, refused, the count on screen was stale): read it again.
          try {
            const started = await (method === "tap"
              ? startTillTap({ venueId, saleId: sale?.id as string, platform: Platform.OS, ...input })
              : startTillScan({ venueId, saleId: sale?.id as string, ...input }));
            actions.refreshStock();
            return started;
          } catch (err) {
            if (isSoldOutRefusal(err)) actions.refreshStock();
            throw err;
          }
        }}
        scanApi={scanApi}
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
        stepUp={stepUpProps}
        row={voidRow}
        currency={currency}
        busy={busy}
        asksRestock={voidAsksRestock(voidRow, catalog)}
        onClose={() => setVoidRow(null)}
        onVoid={(reason, restock) =>
          void run(async () => {
            if (sale === null || voidRow === null) return;
            try {
              await actions.voidLine.mutateAsync({
                saleId: sale.id,
                lineId: voidRow.lineId,
                orderItemId: voidRow.orderItemId,
                reason,
                // #4490 08-O5 fix 1 (O5-T4): the sheet's "Put it back in stock"
                // (on unless turned off). The server gives back only what this
                // line took, and at a station with a kitchen screen only if the
                // screen never started it.
                restock,
                expectedVersion: sale.version,
              });
              setVoidRow(null);
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <CheckActionsSheet
        visible={checkSheet === "actions"}
        title={checkName}
        subtitle={sale !== null ? `${TILL_COPY.servingNow(currentServer)} · ${money(sale.totalDueMinor)}` : ""}
        hasTables={(catalog?.spots.length ?? 0) > 0}
        onClose={closeCheckSheet}
        onPick={openCheckSheet}
        onDismissed={checkActionsGone}
      />

      <MoveSheet
        visible={checkSheet === "move"}
        title={TILL_COPY.moveTitle(checkName)}
        targets={moveTargets(catalog?.spots ?? [], sale)}
        busy={busy}
        onClose={() => setCheckSheet(null)}
        onMove={(target) =>
          void run(async () => {
            if (sale === null) return;
            try {
              await actions.relabel.mutateAsync({
                saleId: sale.id,
                spotId: target.id,
                label: sale.checkLabel,
                expectedVersion: sale.version,
              });
              setCheckSheet(null);
              setToast({ kind: "success", message: TILL_COPY.movedTo(target.label) });
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <HandoverSheet
        visible={checkSheet === "handover"}
        title={TILL_COPY.handoverTitle(checkName)}
        currentName={currentServer}
        choices={handoverChoices(servers, sale?.serverUserId ?? null)}
        loading={serversQuery.isLoading}
        failed={serversQuery.isError}
        onRetry={() => void serversQuery.refetch()}
        busy={busy}
        onClose={() => setCheckSheet(null)}
        onHandOver={(server) =>
          void run(async () => {
            if (sale === null) return;
            try {
              await actions.setServer.mutateAsync({ saleId: sale.id, serverUserId: server.userId, expectedVersion: sale.version });
              setCheckSheet(null);
              setToast({ kind: "success", message: TILL_COPY.handedOver(server.name ?? TILL_COPY.teamMember) });
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <NameSheet
        visible={checkSheet === "rename"}
        busy={busy}
        title={TILL_COPY.changeName}
        initial={sale?.checkLabel ?? ""}
        onClose={() => setCheckSheet(null)}
        onSave={(label) =>
          void run(async () => {
            if (sale === null) return;
            try {
              await actions.relabel.mutateAsync({ saleId: sale.id, spotId: sale.spotId, label, expectedVersion: sale.version });
              setCheckSheet(null);
              setToast({ kind: "success", message: TILL_COPY.nameSaved });
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <LineRefundSheet
        stepUp={stepUpProps}
        row={lineRefund}
        currency={currency}
        busy={busy}
        onClose={() => setLineRefund(null)}
        onRefund={(reason) =>
          void run(async () => {
            if (lineRefund === null || lineRefund.lineId === null) return;
            const current = tillAttemptFor(refundAttempt.current, tillAttemptKey({ kind: "line", lineId: lineRefund.lineId }));
            refundAttempt.current = current;
            try {
              await actions.refundLine.mutateAsync({ lineId: lineRefund.lineId, reason, clientRequestId: current.id });
              refundAttempt.current = null;
              setLineRefund(null);
              setToast({ kind: "success", message: TILL_COPY.refunded });
            } catch (err) {
              if (!tillAttemptKeepsId(err instanceof TillError ? err.code : "till_failed")) refundAttempt.current = null;
              fail(err);
            }
          })
        }
      />
    </>
  );

  const refundIn = refundHost(layout, Platform.OS, basketSheet);
  const refundSheet = (
    <RefundSheet
      stepUp={stepUpProps}
      payment={paidPayments.find((p) => p.id === refundFor) ?? null}
      currency={currency}
      busy={busy}
      onClose={() => setRefundFor(null)}
      onRefund={(amountMinor, reason) =>
        void run(async () => {
          const payment = paidPayments.find((p) => p.id === refundFor);
          if (payment === undefined) return;
          const left = payment.amountMinor - Math.min(payment.refundedMinor, payment.amountMinor);
          const refundMinor = Math.min(amountMinor, left);
          const refundTipMinor = amountMinor > left ? amountMinor - left : 0;
          const current = tillAttemptFor(
            refundAttempt.current,
            tillAttemptKey({ kind: "payment", paymentId: payment.id, amountMinor: refundMinor, tipMinor: refundTipMinor }),
          );
          refundAttempt.current = current;
          try {
            await actions.refund.mutateAsync({
              paymentId: payment.id,
              amountMinor: refundMinor,
              tipMinor: refundTipMinor,
              reason,
              restock: false,
              clientRequestId: current.id,
            });
            refundAttempt.current = null;
            setRefundFor(null);
            setToast({ kind: "success", message: TILL_COPY.refunded });
          } catch (err) {
            if (!tillAttemptKeepsId(err instanceof TillError ? err.code : "till_failed")) refundAttempt.current = null;
            fail(err);
          }
        })
      }
    />
  );

  const phoneHeader = tillHeaderStacked(layout);
  const headerActions = (
    <View style={[styles.headerActions, !phoneHeader && styles.headerActionsWide]} testID="till-header-actions">
      {sellerSlot}
      {stationsEntry ? (
        <Button
          label={STATION_COPY.openStations}
          variant="secondary"
          size="sm"
          onPress={() => router.push(stationHref(venueId) as never)}
          testID="till-open-stations"
        />
      ) : null}
      {/* #4490 spec 08 O5 part B — Close the day (money rights; the floor design's Till rail). */}
      {catalog?.canManageMoney === true ? (
        <Button
          label={CLOSE_COPY.title}
          variant="secondary"
          size="sm"
          onPress={() => router.push(closeHref(venueId) as never)}
          testID="till-open-close"
        />
      ) : null}
      <Button
        label={`${TILL_COPY.checks} · ${checksQuery.data?.open.length ?? 0}`}
        variant="secondary"
        size="sm"
        onPress={() => setChecksOpen(true)}
        testID="till-checks-open"
      />
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="till-screen">
      {/* #4490 08-O5 fix 5: on a phone the header is two rows: Close and the
          venue, then every action in a row that wraps (the seller, Kitchen
          and bar, Close the day, Checks), so none is ever pushed off screen
          and the page never scrolls sideways. Wider screens keep one row,
          the actions still wrapping if they run out of room. */}
      <View style={[styles.header, phoneHeader && styles.headerPhone]} testID="till-header">
        <View style={styles.headerTop}>
          <Button label={TILL_COPY.close} variant="ghost" size="sm" onPress={requestClose} testID="till-back" />
          <Text style={styles.title} numberOfLines={1}>{catalog?.venueName ?? TILL_COPY.title}</Text>
          {phoneHeader ? null : headerActions}
        </View>
        {phoneHeader ? headerActions : null}
      </View>
      {soldOutSlot}
      {tabs.length > 1 ? (
        <Segmented options={tabs} value={activeTab} onChange={(k) => setTab(k)} style={styles.tabs} />
      ) : null}
      <View style={[styles.main, layout !== "phone" && styles.mainWide]}>
        <ScrollView style={styles.grow} contentContainerStyle={styles.catalogScroll}>
          {catalogBody}
          {paidPayments.length > 0 ? (
            <View style={styles.paidList}>
              {/* #4490 08-O5 fix 6: the amount has its own unshrinkable text
                  beside the method, so a long method ("Card machine (yours)")
                  is what gets shortened, never the amount ("₦4,0…"); Send
                  receipt and Refund sit underneath. */}
              {paidPayments.map((p) => {
                const method = p.method === "cash" ? TILL_COPY.cash : p.method === "own_machine" ? TILL_COPY.ownMachine : paidLabel(p);
                const amount = money(p.amountMinor + p.tipMinor);
                return (
                  <View key={p.id} style={styles.paidRow} testID={`till-paid-row-${p.id}`}>
                    <View style={styles.paidLine} accessible accessibilityLabel={`${method}, ${amount}, ${p.reference}`}>
                      <Text style={styles.paidMethod} numberOfLines={1} testID={`till-paid-method-${p.id}`}>{method}</Text>
                      <Text style={styles.paidAmount} numberOfLines={1} testID={`till-paid-amount-${p.id}`}>{amount}</Text>
                    </View>
                    <Text style={styles.paidRef} numberOfLines={1}>{p.reference}</Text>
                    <View style={styles.paidActions}>
                      <Button label={TILL_COPY.sendReceipt} variant="secondary" size="sm" onPress={() => setReceiptFor(p.id)}
                        testID={`till-receipt-open-${p.id}`} />
                      {canManageMoney && p.state !== "refunded" ? (
                        <Button label={TILL_COPY.refund} variant="secondary" size="sm" onPress={() => setRefundFor(p.id)} />
                      ) : null}
                    </View>
                  </View>
                );
              })}
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
          {/* #4490 08-O5 fix 4: a paid check opens as "View check", never "Pay 0.00". */}
          <Button label={payActionShown(sale, draft) ? payLabel : TILL_COPY.viewCheck} variant="primary" size="md" disabled={nothingOnCheck || busy}
            onPress={() => setBasketSheet(true)} testID="till-bar-pay" />
        </View>
      ) : null}

      {layout === "phone" ? (
        <Sheet visible={basketSheet} onClose={closeBasket} snapPoint={0.9} testID="till-basket-sheet">
          <View style={styles.sheetPad}>{basket}</View>
          {/* #4490 O3-S1 (I-SUB-SHEET-INSIDE-PARENT): on an iPhone the sheets the
              basket opens are JSX descendants of this Sheet, so each presents
              from the basket's own modal (iOS stacks it) instead of beside it
              on the screen, which UIKit refuses. Do not move them back out. */}
          {nestInBasket ? basketLaunchedSheets : null}
          {refundIn === "basket" ? refundSheet : null}
        </Sheet>
      ) : null}
      {nestInBasket ? null : basketLaunchedSheets}
      {refundIn === "screen" ? refundSheet : null}

      <ChoicesSheet item={choicesFor} currency={currency} onClose={() => setChoicesFor(null)}
        onAdd={(line) => {
          addLine(line);
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

      <SessionSheet
        offer={sessionFor}
        currency={currency}
        busy={busy}
        onClose={() => setSessionFor(null)}
        onStart={(choice) =>
          void run(async () => {
            if (sessionFor === null) return;
            try {
              const current = await ensureSale();
              await actions.startSession.mutateAsync({
                saleId: current.id,
                offeringId: sessionFor.id,
                spaceId: choice.spaceId,
                minutes: choice.minutes,
                guests: choice.guests,
                idempotencyKey: `session:${randomId()}`,
                expectedVersion: current.version,
              });
              setSessionFor(null);
            } catch (err) {
              fail(err);
            }
          })
        }
      />

      <SeatSheet
        table={seatFor}
        currency={currency}
        busy={busy}
        onClose={() => setSeatFor(null)}
        onSeat={(choice) =>
          void run(async () => {
            if (seatFor === null) return;
            try {
              const seated = await actions.seat.mutateAsync({
                spotId: seatFor.spotId,
                partySize: choice.partySize,
                reservationId: choice.reservationId,
                label: null,
                idempotencyKey: `seat:${randomId()}`,
              });
              setSaleId(seated.id);
              setSeatFor(null);
              void catalogQuery.refetch();
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
                onPrint={async () => {
                  await openFloorPdf({ kind: "receipt", venueId, paymentId: receiptPayment.id });
                }}
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

/** 08-O4: "Start a session now" for a by-the-hour offer staff can start. */
function SessionSheet({
  offer,
  currency,
  busy,
  onClose,
  onStart,
}: {
  offer: TillHourOffer | null;
  currency: string;
  busy: boolean;
  onClose: () => void;
  onStart: (choice: { spaceId: string | null; minutes: number; guests: number }) => void;
}): React.ReactElement {
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [guests, setGuests] = useState(1);
  useEffect(() => {
    setSpaceId(null);
    setMinutes(offer?.minMinutes ?? null);
    setGuests(offer?.guestMin ?? 1);
  }, [offer]);
  const lengths = offer !== null ? sessionLengths(offer.minMinutes, offer.maxMinutes, offer.stepMinutes) : [];
  const price = offer?.pricePerHourMinor ?? null;
  return (
    <Sheet visible={offer !== null} onClose={onClose} snapPoint={0.85} dismissDisabled={busy} testID="till-session-sheet">
      <View style={styles.grow}>
        <SheetHead title={offer?.name ?? ""} onClose={onClose} disabled={busy} />
        <SheetScrollLayout
          contentStyle={styles.sheetScroll}
          footer={
            <Button
              label={TILL_COPY.startSessionNow}
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              disabled={offer === null || minutes === null}
              onPress={() => {
                if (minutes !== null) onStart({ spaceId, minutes, guests });
              }}
              testID="till-session-start"
            />
          }
        >
          {price !== null ? (
            <Text style={styles.muted}>{TILL_COPY.perHour(formatCurrency(price, currency, true))}</Text>
          ) : null}
          {offer !== null && offer.allocation === "any_one" && offer.units.length > 1 ? (
            <View style={styles.sheetSection}>
              <Text style={styles.h3}>{TILL_COPY.whichOne}</Text>
              <View style={styles.chips}>
                <Chip label={TILL_COPY.anyFreeOne} selected={spaceId === null} onPress={() => setSpaceId(null)}
                  testID="till-session-unit-any" />
                {offer.units.map((u) => (
                  <Chip
                    key={u.spaceId}
                    label={u.busy ? `${u.name} · ${TILL_COPY.inUse}` : u.name}
                    selected={spaceId === u.spaceId}
                    disabled={u.busy}
                    onPress={() => setSpaceId(u.spaceId)}
                    testID={`till-session-unit-${u.spaceId}`}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <View style={styles.sheetSection}>
            <Text style={styles.h3}>{TILL_COPY.howLong}</Text>
            <View style={styles.chips}>
              {lengths.map((m) => (
                <Chip key={m} label={TILL_COPY.minutes(m)} selected={minutes === m} onPress={() => setMinutes(m)}
                  testID={`till-session-len-${m}`} />
              ))}
            </View>
          </View>
          {offer !== null && offer.guestMax > offer.guestMin ? (
            <NumberStepper label={TILL_COPY.partySize} value={guests} min={offer.guestMin} max={offer.guestMax}
              onChange={setGuests} testID="till-session-guests" />
          ) : null}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

/** 08-O4: seat a table: a booking for about now (its deposit comes off), or a walk-in. */
function SeatSheet({
  table,
  currency,
  busy,
  onClose,
  onSeat,
}: {
  table: TillTable | null;
  currency: string;
  busy: boolean;
  onClose: () => void;
  onSeat: (choice: { reservationId: string | null; partySize: number | null }) => void;
}): React.ReactElement {
  const [party, setParty] = useState(2);
  useEffect(() => {
    setParty(Math.min(2, table?.capacity ?? 2));
  }, [table]);
  return (
    <Sheet visible={table !== null} onClose={onClose} snapPoint={0.8} dismissDisabled={busy} testID="till-seat-sheet">
      <View style={styles.grow}>
        <SheetHead title={table?.name ?? ""} onClose={onClose} disabled={busy} />
        <SheetScrollLayout
          contentStyle={styles.sheetScroll}
          footer={
            <Button
              label={TILL_COPY.seatWalkIn}
              variant={table !== null && table.bookings.length > 0 ? "secondary" : "primary"}
              size="lg"
              fullWidth
              loading={busy}
              disabled={table === null}
              onPress={() => onSeat({ reservationId: null, partySize: party })}
              testID="till-seat-walkin"
            />
          }
        >
          {table !== null && table.minSpendMinor !== null ? (
            <Text style={styles.muted}>{TILL_COPY.minSpendTable(formatCurrency(table.minSpendMinor, currency, true))}</Text>
          ) : null}
          {(table?.bookings ?? []).map((b) => (
            <View key={b.reservationId} style={styles.sheetSection} testID={`till-seat-booking-${b.reservationId}`}>
              <Text style={styles.h3}>{`${TILL_COPY.seatBooking} · ${b.name ?? ""}`}</Text>
              <Text style={styles.muted}>
                {TILL_COPY.bookedFor(b.reservedFor !== null ? clockTime(b.reservedFor) : "--:--", b.partySize)}
              </Text>
              {b.note !== null ? <Text style={styles.muted}>{b.note}</Text> : null}
              {b.depositMinor !== null ? (
                <Text style={styles.muted}>
                  {`${TILL_COPY.depositPaidOnline} · ${formatCurrency(b.depositMinor, currency, true)}. ${TILL_COPY.depositComesOff}`}
                </Text>
              ) : b.depositUsed ? (
                <Text style={styles.muted}>{TILL_COPY.depositUsed}</Text>
              ) : null}
              <Button
                label={TILL_COPY.seatAndOpen}
                variant="primary"
                size="md"
                loading={busy}
                onPress={() => onSeat({ reservationId: b.reservationId, partySize: null })}
                testID={`till-seat-open-${b.reservationId}`}
              />
            </View>
          ))}
          <NumberStepper label={TILL_COPY.partySize} value={party} min={1} max={Math.max(1, table?.capacity ?? 1) * 2}
            onChange={setParty} testID="till-seat-party" />
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
              title={checkTitle({ id: c.id, label: c.checkLabel, spotLabel: c.spotLabel })}
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

function NameSheet({
  visible,
  busy,
  onClose,
  onSave,
  title = TILL_COPY.saveCheck,
  initial = "",
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (label: string | null) => void;
  title?: string;
  initial?: string;
}): React.ReactElement {
  const [label, setLabel] = useState(initial);
  useEffect(() => {
    if (visible) setLabel(initial);
  }, [visible, initial]);
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.6} dismissDisabled={busy} testID="till-name">
      <View style={styles.grow}>
        <SheetHead title={title} onClose={onClose} disabled={busy} />
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

function VoidSheet({ row, currency, busy, asksRestock, onClose, onVoid, stepUp }: { row: BasketRow | null; currency: string; busy: boolean; asksRestock: boolean; onClose: () => void; onVoid: (reason: string, restock: boolean) => void; stepUp: StepUpProps }): React.ReactElement {
  const [reason, setReason] = useState<string>(TILL_COPY.voidReasons[0].label);
  // #4490 08-O5 fix 1 (O5-T4): "Put it back in stock" starts on for every void.
  const [putBack, setPutBack] = useState<boolean>(true);
  // #4490 08-O5 fix 5: the tallest sheet while the PIN pad shows, so OK fits.
  // Fix 6: while it shows, swipe, back and Close cancel it like Cancel.
  const stepUpSheet = useStepUpSheet(stepUp.venueId, 0.6, busy, onClose);
  useEffect(() => {
    setReason(TILL_COPY.voidReasons[0].label);
    setPutBack(true);
  }, [row?.key]);
  return (
    <Sheet visible={row !== null} onClose={onClose} {...stepUpSheet.sheet} testID="till-void">
      <View style={styles.grow}>
        <SheetHead title={row !== null ? TILL_COPY.voidItem(row.label) : TILL_COPY.void} onClose={stepUpSheet.close} disabled={stepUpSheet.closeDisabled} />
        <TillStepUpHost venueId={stepUp.venueId} approvers={stepUp.approvers}>
          <SheetScrollLayout contentStyle={styles.sheetScroll}
          footer={<Button label={row !== null ? `${TILL_COPY.void} · ${formatCurrency(row.amountMinor, currency, true)}` : TILL_COPY.void}
            variant="destructive" size="lg" fullWidth loading={busy} onPress={() => onVoid(reason, asksRestock ? putBack : true)} testID="till-void-confirm" />}>
          <Text style={styles.label}>{TILL_COPY.why}</Text>
          <View style={styles.chips}>
            {TILL_COPY.voidReasons.map((r) => (
              <Chip key={r.key} label={r.label} selected={reason === r.label} onPress={() => setReason(r.label)} testID={`till-void-${r.key}`} />
            ))}
          </View>
          {asksRestock ? (
            <View style={styles.voidRestockRow} testID="till-void-restock">
              <View style={styles.voidRestockText}>
                <Text style={styles.voidRestockTitle}>{TILL_COPY.putBackInStock}</Text>
                <Text style={styles.muted}>{TILL_COPY.putBackInStockHint}</Text>
              </View>
              <Switch value={putBack} onValueChange={setPutBack} disabled={busy}
                accessibilityLabel={TILL_COPY.putBackInStock} testID="till-void-restock-switch" />
            </View>
          ) : null}
        </SheetScrollLayout>
        </TillStepUpHost>
      </View>
    </Sheet>
  );
}

function CheckActionsSheet({
  visible,
  title,
  subtitle,
  hasTables,
  onClose,
  onPick,
  onDismissed,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  hasTables: boolean;
  onClose: () => void;
  onPick: (next: "move" | "handover" | "rename") => void;
  /** #4490 O3-S1: the sheet has really gone; the picked sheet opens then (iOS). */
  onDismissed: () => void;
}): React.ReactElement {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.6} onDismissed={onDismissed} testID="till-check-actions-sheet">
      <View style={styles.grow}>
        <SheetHead title={title} onClose={onClose} />
        <SheetScrollLayout contentStyle={styles.sheetScroll}>
          <Text style={styles.muted}>{subtitle}</Text>
          {hasTables ? (
            <ListRow title={TILL_COPY.moveToTable} subtitle={TILL_COPY.moveToTableSub} onPress={() => onPick("move")}
              testID="till-check-move" />
          ) : null}
          <ListRow title={TILL_COPY.handOver} subtitle={TILL_COPY.handOverSub} onPress={() => onPick("handover")}
            testID="till-check-handover" />
          <ListRow title={TILL_COPY.changeName} onPress={() => onPick("rename")} testID="till-check-rename" />
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function MoveSheet({
  visible,
  title,
  targets,
  busy,
  onClose,
  onMove,
}: {
  visible: boolean;
  title: string;
  targets: MoveTarget[];
  busy: boolean;
  onClose: () => void;
  onMove: (target: MoveTarget) => void;
}): React.ReactElement {
  const [picked, setPicked] = useState<MoveTarget | null>(null);
  useEffect(() => {
    if (visible) setPicked(null);
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.86} dismissDisabled={busy} testID="till-move">
      <View style={styles.grow}>
        <SheetHead title={title} onClose={onClose} disabled={busy} />
        <SheetScrollLayout
          contentStyle={styles.sheetScroll}
          footer={
            <Button
              label={picked !== null ? TILL_COPY.moveTo(picked.label) : TILL_COPY.moveToTable}
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              disabled={picked === null}
              onPress={() => {
                if (picked !== null) onMove(picked);
              }}
              testID="till-move-confirm"
            />
          }
        >
          {targets.length === 0 ? <Text style={styles.muted}>{TILL_COPY.noTables}</Text> : null}
          <View style={styles.chips}>
            {targets.map((t) => (
              <Chip
                key={t.id}
                label={t.label}
                selected={picked?.id === t.id || (picked === null && t.current)}
                disabled={t.busy || t.current}
                onPress={() => setPicked(t)}
                testID={`till-move-${t.id}`}
              />
            ))}
          </View>
          <Text style={styles.muted}>{TILL_COPY.moveCaption}</Text>
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function HandoverSheet({
  visible,
  title,
  currentName,
  choices,
  loading,
  failed,
  onRetry,
  busy,
  onClose,
  onHandOver,
}: {
  visible: boolean;
  title: string;
  currentName: string;
  choices: TillServer[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  busy: boolean;
  onClose: () => void;
  onHandOver: (server: TillServer) => void;
}): React.ReactElement {
  const [picked, setPicked] = useState<TillServer | null>(null);
  useEffect(() => {
    if (visible) setPicked(null);
  }, [visible]);
  const pickedName = picked?.name ?? TILL_COPY.teamMember;
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.8} dismissDisabled={busy} testID="till-handover">
      <View style={styles.grow}>
        <SheetHead title={title} onClose={onClose} disabled={busy} />
        <SheetScrollLayout
          contentStyle={styles.sheetScroll}
          footer={
            <Button
              label={picked !== null ? TILL_COPY.handoverTo(pickedName) : TILL_COPY.handOver}
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              disabled={picked === null}
              onPress={() => {
                if (picked !== null) onHandOver(picked);
              }}
              testID="till-handover-confirm"
            />
          }
        >
          <Text style={styles.muted}>{TILL_COPY.servingNow(currentName)}</Text>
          {loading ? <Skeleton height={56} /> : null}
          {failed ? (
            <Banner tone="danger" title={tillErrorCopy("till_failed")} action={{ label: TILL_COPY.retry, onPress: onRetry }} />
          ) : null}
          {!loading && !failed && choices.length === 0 ? <Text style={styles.muted}>{TILL_COPY.nobodyElse}</Text> : null}
          {choices.map((c) => (
            <ListRow
              key={c.userId}
              title={c.name ?? TILL_COPY.teamMember}
              subtitle={TILL_COPY.openChecksOf(c.openChecks)}
              chevron={false}
              trailing={picked?.userId === c.userId ? <Pill variant="info">{TILL_COPY.handOver}</Pill> : undefined}
              onPress={() => setPicked(c)}
              testID={`till-handover-${c.userId}`}
            />
          ))}
          {picked !== null ? <Text style={styles.muted}>{TILL_COPY.handoverCaption(pickedName, currentName)}</Text> : null}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

function LineRefundSheet({
  row,
  currency,
  busy,
  onClose,
  onRefund,
  stepUp,
}: {
  row: BasketRow | null;
  currency: string;
  busy: boolean;
  onClose: () => void;
  onRefund: (reason: string) => void;
  stepUp: StepUpProps;
}): React.ReactElement {
  const [reason, setReason] = useState<string>(TILL_COPY.refundReasons[0].label);
  useEffect(() => {
    setReason(TILL_COPY.refundReasons[0].label);
  }, [row?.key]);
  // #4490 08-O5 fix 5: the tallest sheet while the PIN pad shows, so OK fits.
  // Fix 6: while it shows, swipe, back and Close cancel it like Cancel.
  const stepUpSheet = useStepUpSheet(stepUp.venueId, 0.6, busy, onClose);
  return (
    <Sheet visible={row !== null} onClose={onClose} {...stepUpSheet.sheet} testID="till-line-refund">
      <View style={styles.grow}>
        <SheetHead title={row !== null ? TILL_COPY.refundLineTitle(row.label) : TILL_COPY.refund} onClose={stepUpSheet.close} disabled={stepUpSheet.closeDisabled} />
        <TillStepUpHost venueId={stepUp.venueId} approvers={stepUp.approvers}>
          <SheetScrollLayout contentStyle={styles.sheetScroll}
          footer={<Button label={TILL_COPY.refundAmount(formatCurrency(row?.amountMinor ?? 0, currency, true))} variant="destructive"
            size="lg" fullWidth loading={busy} onPress={() => onRefund(reason)} testID="till-line-refund-confirm" />}>
          <Text style={styles.muted}>{TILL_COPY.refundLineBody}</Text>
          <Text style={styles.label}>{TILL_COPY.reason}</Text>
          <View style={styles.chips}>
            {TILL_COPY.refundReasons.map((r) => (
              <Chip key={r.key} label={r.label} selected={reason === r.label} onPress={() => setReason(r.label)} />
            ))}
          </View>
        </SheetScrollLayout>
        </TillStepUpHost>
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
  stepUp,
}: {
  payment: { id: string; amountMinor: number; tipMinor: number; refundedMinor: number } | null;
  currency: string;
  busy: boolean;
  onClose: () => void;
  onRefund: (amountMinor: number, reason: string) => void;
  stepUp: StepUpProps;
}): React.ReactElement {
  const max = payment === null ? 0 : payment.amountMinor + payment.tipMinor - payment.refundedMinor;
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState<string>(TILL_COPY.refundReasons[0].label);
  useEffect(() => {
    setAmount(null);
    setReason(TILL_COPY.refundReasons[0].label);
  }, [payment?.id]);
  const value = amount ?? max;
  // #4490 08-O5 fix 5: the tallest sheet while the PIN pad shows, so OK fits.
  // Fix 6: while it shows, swipe, back and Close cancel it like Cancel.
  const stepUpSheet = useStepUpSheet(stepUp.venueId, 0.7, busy, onClose);
  return (
    <Sheet visible={payment !== null} onClose={onClose} {...stepUpSheet.sheet} testID="till-refund">
      <View style={styles.grow}>
        <SheetHead title={TILL_COPY.refund} onClose={stepUpSheet.close} disabled={stepUpSheet.closeDisabled} />
        <TillStepUpHost venueId={stepUp.venueId} approvers={stepUp.approvers}>
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
        </TillStepUpHost>
      </View>
    </Sheet>
  );
}

/** A sent row's detail plus what the kitchen says ("Ready 21:12", "Not accepted · 4 min"). */
function kitchenSubtitle(row: BasketRow): string | null {
  const k = row.kitchen;
  const state = k === null ? null
    : k.kind === "ready" ? TILL_COPY.readyAt(clockTime(k.readyAt))
    : k.kind === "not_accepted" ? TILL_COPY.notAccepted(k.minutes)
    : null;
  return [row.detail, state].filter((x): x is string => typeof x === "string" && x.length > 0).join(" · ") || null;
}

const styles = StyleSheet.create({
  lateBox: { gap: space[2] },
  lateRow: { gap: space[2] },
  lateActions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2] },
  headerPhone: { paddingBottom: space[3] },
  headerTop: { flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0 },
  // #4490 08-O5 fix 5: the actions wrap; nothing in the header is wider than the screen.
  headerActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], maxWidth: "100%" },
  headerActionsWide: { flexShrink: 1, justifyContent: "flex-end" },
  title: { ...type.h2, color: color.text1, flex: 1, minWidth: 0, textAlign: "center" },
  tabs: { marginHorizontal: space[4], marginBottom: space[2] },
  main: { flex: 1 },
  mainWide: { flexDirection: "row" },
  side: { width: size.sidePanel, borderLeftWidth: 1, borderLeftColor: color.line, padding: space[3] },
  grow: { flex: 1 },
  catalogScroll: { padding: space[4], gap: space[3] },
  catalogCol: { gap: space[3] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { width: 160, minHeight: 88, padding: space[3], borderRadius: radius.lg, backgroundColor: color.card, borderWidth: 1, borderColor: color.line, justifyContent: "space-between", gap: space[2], overflow: "hidden" },
  tilePhone: { width: "47%" },
  tilePressed: { backgroundColor: color.card2 },
  tileOff: { opacity: 0.5 },
  tileName: { ...type.body, color: color.text1 },
  // #4490 08-O5 fix 4: the price and its chip wrap onto two lines when the
  // tile is too narrow for both, so "Sold out" never runs into the next tile.
  tileFoot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space[1] },
  tilePill: { flexShrink: 1, maxWidth: "100%" },
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
  paidRow: { gap: space[1], paddingHorizontal: space[4], paddingVertical: space[2] },
  paidLine: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  paidMethod: { ...type.row, color: color.text1, flexShrink: 1, minWidth: 0 },
  paidAmount: { ...type.row, fontWeight: "600", color: color.text1, flexShrink: 0 },
  paidRef: { ...type.caption, color: color.text3 },
  paidActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
  h2: { ...type.h2, color: color.text1, flexShrink: 1 },
  h3: { ...type.row, color: color.text1, flexShrink: 1 },
  label: { ...type.small, color: color.text2 },
  muted: { ...type.small, color: color.text2 },
  voidRestockRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[3] },
  voidRestockText: { flex: 1, minWidth: 0, gap: space[1] },
  voidRestockTitle: { ...type.row, color: color.text1 },
  warnText: { ...type.small, color: color.warningText },
  sheetSection: { gap: space[2] },
});
