/**
 * #4389 Door mode — the door sale as ONE full-screen route,
 * /event/[id]/door/sell (design screen "DM" + the doorJourney table, approved
 * 2026-11-11). It replaces the old door sale sheet.
 *
 * - Tickets are tiles: a tap adds one, the minus takes one off (I-30 door tier
 *   filter, per-tier max 99). The last sale's tickets stay selected, so "same
 *   again" is one tap on the button. A failure never clears them.
 * - How they pay is a row of chips, always visible, in buildDoorPaymentOptions
 *   order: Tap to Pay (useTapToPayAvailability, never on the web), Buyer's
 *   phone (pay code), Cash. Manual is under the header menu. The choice is
 *   remembered for this event on this phone (doorModeMethodMemory), read before
 *   anything is picked; the first time it is Tap to Pay where it works, else
 *   Buyer's phone.
 * - The button says what happens: Charge / Show code / Cash taken, with the
 *   total. Cash asks once ("Cash taken: {total}?").
 * - Tap to Pay runs here (useDoorModeTapSale, Apple's own sheet over this
 *   screen). Scan to pay is a sheet on this screen that moves on by itself.
 *   Success shows a green Paid confirmation for 2 seconds, then the screen is
 *   ready again; a tap anywhere skips the wait.
 * - Offline: card and phone payments are off; Cash still works.
 * - I-29: every sale is a real server order (biz_door_sale_record, door-tap-intent,
 *   door-pay-code). One clientRequestId per attempt (DoorAttemptGate); a double
 *   tap never makes two orders.
 *
 * Undo is not offered on the Paid confirmation: a door refund never undoes the
 * check-in (DoorRefundSheet OBS-1), card door sales refund through the order's
 * own finance-manager flow, and cash refunds need a written reason, so there is
 * no clean one-tap undo. Recent sales (header menu) opens the sale to refund it.
 *
 * MINGLA-INVARIANT: I-4389-DOOR-MODE-FULL-SCREEN | issue #4389 | The door sale cart is a full-screen route (app/event/[id]/door/sell.tsx), never inside a Sheet or Modal; at most one sheet (cash confirm, pay code, menu, add buyer, which event) is open at a time over it; pinned by issue_4389_door_mode.implementor.test.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { HELP_AND_SUPPORT_ROUTE } from "../../constants/supportHostFacing";
import {
  TAP_CARD_NEEDS_INSERT_COPY,
  TAP_PROCESSING_TEXT,
  TAP_TIMED_OUT_COPY,
  TAP_UNKNOWN_RESULT_COPY,
  tapReaderProblemCopy,
  tapReaderProblemTitle,
  tapToPayName,
} from "../../constants/tapToPayCopy";
import { useAuth } from "../../context/AuthContext";
import { useBusinessEventsForBrand } from "../../hooks/useBusinessEvents";
import { useEventDateKeys } from "../../hooks/useEventDateKeys";
import {
  useCanTakeDoorPayment,
  useCreateDoorPayCode,
  useDoorPayCodeQuote,
  useEventDoorSales,
  useRecordDoorSale,
} from "../../hooks/useEventDoorSales";
import { useManagedEventRoute } from "../../hooks/useManagedEventRoute";
import { useTapToPayAvailability } from "../../hooks/useTapToPayAvailability";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { DoorPayCodeError } from "../../services/doorPayCodeService";
import { DoorSaleError } from "../../services/doorSalesService";
import { postHogService } from "../../services/postHogService";
import { buildTapReceiptText } from "../../services/terminal/tapReceipt";
import { parseTapToPayDraft, type TapToPayDraft } from "../../services/terminal/tapToPayDraft";
import { setTapToPayScope, useTapToPayTerminal } from "../../services/terminal/tapToPaySession";
import type { TicketStub } from "../../store/draftEventStore";
import { currencyCodeOrNull, formatCurrency } from "../../utils/currency";
import { formatMultiDateList } from "../../utils/eventDateDisplay";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { phoneStartCountryForCurrency } from "../../utils/phoneStartCountryForCurrency";
import { randomUuid } from "../../utils/randomId";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import { trackBrandSetup } from "../brand/brandSetupAnalytics";
import { Button } from "../ui/Button";
import { CenteredState } from "../ui/CenteredState";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { usePhoneEntry } from "../ui/PhoneField";
import { Sheet } from "../ui/Sheet";
import { DoorModeBuyerSheet, isValidDoorEmail } from "./DoorModeBuyerSheet";
import { DoorModePayCodeSheet } from "./DoorModePayCodeSheet";
import { DoorStatusPill } from "./DoorStatusPill";
import { doorTierUnitPrice } from "./doorListPrice";
import { DOOR_MODE_COPY, doorModeChipLabel } from "./doorModeCopy";
import { readDoorMethodMemory, writeDoorMethodMemory } from "./doorModeMethodMemory";
import {
  addOneTicket,
  cartQuantity,
  cartTicketCount,
  DOOR_MODE_PAID_MS,
  DoorAttemptGate,
  doorBasketKeyOf,
  doorModeChips,
  doorModeTiers,
  doorSaleCandidates,
  doorTicketsSoldTonight,
  isDoorCardMethod,
  removeOneTicket,
  resolveDoorMethod,
  seedDoorCart,
  type DoorCartLine,
  type DoorMethodMemory,
  type DoorModeChipMethod,
  type DoorModeMethod,
} from "./doorModeState";
import {
  buildDoorPaymentOptions,
  doorPayCodeCreateErrorCopy,
  doorTapBlockReason,
  DOOR_CARD_TAX_REFUSAL,
  DOOR_PAYMENTS_NOT_ALLOWED,
} from "./doorPaymentOptions";
import { doorTapNewSaleHref } from "./doorTapDraftHref";
import { TapStatusView } from "./tap/TapStatusView";
import { TapToPayIcon } from "./tap/TapToPayIcon";
import { tapSaleTone } from "./tap/tapSaleTone";
import { formatTapAmount, useDoorModeTapSale } from "./useDoorModeTapSale";

export interface DoorModeScreenProps {
  eventId: string;
  /** Where the host came from, for door_mode_opened. */
  source: string | null;
  /** "Which event?" first (openDoorSale found two or more tonight). */
  pick: boolean;
  /** Tickets to start with (Ari, "Sell another"). */
  rawDraft: string | null;
  /** A method to start with ("Take cash instead", "Sell another" from a code). */
  methodParam: string | null;
}

type Overlay = "cash" | "code" | "menu" | "buyer" | "pick";

interface Banner {
  tone: "error" | "warn" | "hint";
  text: string;
}

interface PaidState {
  total: string;
  count: number;
  how: string;
  receipt: "tap" | "cash" | null;
  /** Tap only: what the receipt needs. */
  tap?: { totalCents: number; currency: string; cardLabel: string | null; paymentIntentId: string | null; feeCents: number | null };
}

const CHIP_ICON: Record<"pay_code" | "cash", "qr" | "cash"> = { pay_code: "qr", cash: "cash" };

const decodeDraftLines = (raw: string | null): DoorCartLine[] =>
  (parseTapToPayDraft(raw)?.lines ?? []).map((line) => ({ ticketTypeId: line.ticketTypeId, quantity: line.quantity }));

export const DoorModeScreen = ({
  eventId,
  source,
  pick,
  rawDraft,
  methodParam,
}: DoorModeScreenProps): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const routeEvent = useManagedEventRoute(eventId);
  const event = routeEvent.event;
  const brand = routeEvent.brand;
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;
  const [isFocused, setIsFocused] = useState<boolean>(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // ---- Tap to Pay scope: this route serves the event's brand while it is open.
  const brandId = brand?.id ?? event?.brandId ?? null;
  const merchantDisplayName = brand?.displayName ?? null;
  const session = useTapToPayTerminal();
  useEffect(() => {
    if (!isFocused) return undefined;
    setTapToPayScope({ brandId, eventId, merchantDisplayName });
    return undefined;
  }, [brandId, eventId, merchantDisplayName, isFocused]);
  // Coming back from the Tap to Pay route, its layout clears the scope as it closes.
  useEffect(() => {
    if (isFocused && session.scope === null) setTapToPayScope({ brandId, eventId, merchantDisplayName });
  }, [isFocused, session.scope, brandId, eventId, merchantDisplayName]);
  useEffect(() => () => setTapToPayScope(null), []);

  // ---- Data
  const doorSalesQuery = useEventDoorSales(eventId);
  const permission = useCanTakeDoorPayment(eventId);
  const tapToPay = useTapToPayAvailability({ brand, currency: event?.currency ?? null });
  const recordSale = useRecordDoorSale(eventId);
  const createPayCode = useCreateDoorPayCode(eventId);
  const brandEvents = useBusinessEventsForBrand(pick ? brandId : null);

  const eventCurrencyCode = currencyCodeOrNull(event?.currency);
  const tiers = useMemo<TicketStub[]>(() => doorModeTiers(event?.tickets ?? []), [event?.tickets]);
  const fmtMoney = useCallback(
    (major: number): string => (eventCurrencyCode === null ? "—" : formatCurrency(major, eventCurrencyCode)),
    [eventCurrencyCode],
  );

  // ---- Analytics: opened, and time to a completed sale.
  const openedAtRef = useRef<number>(Date.now());
  useEffect(() => {
    trackBrandSetup("door_mode_opened", { source: source ?? "door" });
  }, [source]);

  // ---- Cart. Seeded once from a draft when the tiers are known; kept after sales.
  const [cart, setCart] = useState<DoorCartLine[]>([]);
  const seededRef = useRef<boolean>(false);
  useEffect(() => {
    if (seededRef.current || tiers.length === 0) return;
    seededRef.current = true;
    setCart(seedDoorCart(decodeDraftLines(rawDraft), tiers));
  }, [rawDraft, tiers]);
  const ticketCount = cartTicketCount(cart);
  const subtotal = useMemo(
    () =>
      cart.reduce((sum, line) => {
        const tier = tiers.find((t) => t.id === line.ticketTypeId);
        return tier === undefined ? sum : sum + doorTierUnitPrice(tier) * line.quantity;
      }, 0),
    [cart, tiers],
  );

  // ---- Date (a listed ticket's pass needs one; #3281).
  const listedTiers = cart
    .map((line) => tiers.find((t) => t.id === line.ticketTypeId))
    .filter((t): t is TicketStub => t?.validDayIds != null);
  const dateNeeded = listedTiers.length > 0;
  const dateKeys = useEventDateKeys(eventId, dateNeeded);
  const dates = useMemo(
    () =>
      (dateKeys.data ?? [])
        .filter(
          (row) =>
            row.occurrence_key !== null &&
            row.cancelled_at === null &&
            new Date(row.end_at).getTime() > Date.now() &&
            listedTiers.every((t) => t.validDayIds?.includes(row.occurrence_key as string)),
        )
        .map((row): [string, string] => [row.id, row.occurrence_key as string]),
    [dateKeys.data, listedTiers],
  );
  const [eventDateId, setEventDateId] = useState<string | null>(null);
  useEffect(() => {
    if (!dateNeeded) setEventDateId(null);
    else if (dates.length === 1) setEventDateId(dates[0][0]);
    else if (!dates.some(([id]) => id === eventDateId)) setEventDateId(null);
  }, [dateNeeded, dates, eventDateId]);
  const basketKey = doorBasketKeyOf(cart, eventDateId);

  // ---- How they pay.
  const paymentOptions = useMemo(
    () => buildDoorPaymentOptions({ eventCurrency: eventCurrencyCode, tapToPay, platform: Platform.OS }),
    [eventCurrencyCode, tapToPay],
  );
  const chips = useMemo(() => doorModeChips(paymentOptions, Platform.OS), [paymentOptions]);
  const [memory, setMemory] = useState<DoorMethodMemory | null>(null);
  useEffect(() => {
    if (userId === null) return undefined;
    let alive = true;
    void readDoorMethodMemory(userId, eventId).then((value) => {
      if (alive) setMemory(value);
    });
    return () => {
      alive = false;
    };
  }, [userId, eventId]);
  const [chosen, setChosen] = useState<DoorModeMethod | null>(
    methodParam === "cash" || methodParam === "pay_code" ? methodParam : null,
  );
  const memoryReady = memory !== null;
  const method: DoorModeMethod | null = memoryReady
    ? resolveDoorMethod({ chosen, remembered: memory.method, chips })
    : null;
  const [rememberedNote, setRememberedNote] = useState<string | null>(null);

  // ---- Buyer (optional, behind the menu; used on the next sale, then cleared).
  const [buyerName, setBuyerName] = useState<string>("");
  const [buyerEmail, setBuyerEmail] = useState<string>("");
  const buyerPhone = usePhoneEntry({ startCountries: [phoneStartCountryForCurrency(eventCurrencyCode)] });
  const resetBuyerPhone = buyerPhone.reset;
  const clearBuyer = useCallback((): void => {
    setBuyerName("");
    setBuyerEmail("");
    resetBuyerPhone();
  }, [resetBuyerPhone]);
  const buyerLabel = [buyerName.trim(), buyerPhone.e164 ?? "", buyerEmail.trim()].filter((p) => p.length > 0).join(" · ");

  // ---- Server total for card methods (the same quote a code or a tap is made with).
  const cardMethod = method !== null && isDoorCardMethod(method);
  const quote = useDoorPayCodeQuote({
    eventId,
    eventDateId,
    lines: cart,
    enabled:
      cardMethod &&
      eventCurrencyCode !== null &&
      !offline &&
      permission.data === true &&
      (!dateNeeded || eventDateId !== null),
  });
  const taxRefused =
    cardMethod && (quote.error as { code?: unknown } | null | undefined)?.code === "door_tax_added_at_checkout";
  const quotedTotal = quote.data != null ? formatCurrency(quote.data.totalCents, quote.data.currency, true) : null;

  // ---- One overlay at a time; the next one opens once the last has gone (iOS).
  const [overlay, setOverlay] = useState<Overlay | null>(pick ? "pick" : null);
  const nextOverlayRef = useRef<Overlay | null>(null);
  const afterSheet = useCallback((): void => {
    const next = nextOverlayRef.current;
    nextOverlayRef.current = null;
    if (next !== null) setOverlay(next);
  }, []);
  const switchOverlay = useCallback((next: Overlay): void => {
    nextOverlayRef.current = next;
    setOverlay(null);
  }, []);

  const [banner, setBanner] = useState<Banner | null>(null);
  const tapDiscardRef = useRef<() => void>(() => undefined);
  const [codeId, setCodeId] = useState<string | null>(null);
  const [paid, setPaid] = useState<PaidState | null>(null);
  const gateRef = useRef<DoorAttemptGate>(new DoorAttemptGate(randomUuid));
  const [submitting, setSubmitting] = useState<boolean>(false);

  // A change to the basket makes an old message stale.
  // A changed basket also closes a tap that ended without a charge (its intent was for the old total).
  useEffect(() => {
    setBanner(null);
    tapDiscardRef.current();
  }, [basketKey]);

  // ---- Tap to Pay, run from here.
  const handOff = useCallback(
    (draft: TapToPayDraft): void => {
      // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
      router.push(doorTapNewSaleHref(eventId, draft) as never);
    },
    [eventId, router],
  );
  const tap = useDoorModeTapSale({ eventId, handOff });
  const { state: tapState, charge: tapCharge, discard: tapDiscard, reset: tapReset, receiptFacts: tapReceiptFacts } = tap;
  tapDiscardRef.current = tapDiscard;
  const busy = submitting || tap.busy || overlay === "code";

  const finishSale = useCallback(
    (done: { method: DoorModeMethod; paid: PaidState }): void => {
      gateRef.current.completed();
      HapticFeedback.success();
      setBanner(null);
      setRememberedNote(null);
      setPaid(done.paid);
      clearBuyer();
      trackBrandSetup("door_sale_completed", {
        method: done.method,
        seconds_from_open: Math.round((Date.now() - openedAtRef.current) / 1000),
      });
    },
    [clearBuyer],
  );

  // Tap approved: the green Paid confirmation.
  const approvedFor = useRef<object | null>(null);
  useEffect(() => {
    const state = tapState;
    if (state.kind !== "approved" || approvedFor.current === state) return;
    approvedFor.current = state;
    const facts = tapReceiptFacts();
    finishSale({
      method: "tap_to_pay",
      paid: {
        total: formatTapAmount(state.amount),
        count: state.result.ticketIds.length > 0 ? state.result.ticketIds.length : ticketCount,
        how: state.cardLabel ?? tapToPayName(Platform.OS),
        receipt: "tap",
        tap: {
          totalCents: state.amount.totalCents,
          currency: state.amount.currency,
          cardLabel: state.cardLabel,
          paymentIntentId: facts.paymentIntentId,
          feeCents: facts.feeCents,
        },
      },
    });
  }, [tapState, tapReceiptFacts, finishSale, ticketCount]);

  // ---- The Paid confirmation: 2 seconds, or a tap anywhere.
  const paidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissPaid = useCallback((): void => {
    if (paidTimerRef.current !== null) clearTimeout(paidTimerRef.current);
    paidTimerRef.current = null;
    setPaid(null);
    tapReset();
  }, [tapReset]);
  useEffect(() => {
    if (paid === null) return undefined;
    paidTimerRef.current = setTimeout(dismissPaid, DOOR_MODE_PAID_MS);
    return () => {
      if (paidTimerRef.current !== null) clearTimeout(paidTimerRef.current);
      paidTimerRef.current = null;
    };
  }, [paid, dismissPaid]);

  const sendReceipt = useCallback(async (): Promise<void> => {
    if (paidTimerRef.current !== null) clearTimeout(paidTimerRef.current);
    paidTimerRef.current = null;
    const current = paid;
    if (current === null) return;
    const when = new Date().toISOString();
    const message =
      current.receipt === "tap" && current.tap !== undefined
        ? buildTapReceiptText({
            eventName: event?.name ?? null,
            brandName: brand?.displayName ?? null,
            outcome: "approved",
            totalCents: current.tap.totalCents,
            feeCents: current.tap.feeCents,
            currency: current.tap.currency,
            cardLabel: current.tap.cardLabel,
            whenIso: when,
            paymentIntentId: current.tap.paymentIntentId,
          })
        : DOOR_MODE_COPY.cashReceipt({
            brand: brand?.displayName ?? null,
            event: event?.name ?? null,
            total: current.total,
            tickets: current.count,
            when: new Date(when).toUTCString(),
          });
    try {
      // SHARE-NON-CONTENT:receipt
      await Share.share({ message });
    } catch (error) {
      reportNonFatal("door-mode.receipt", error);
    } finally {
      dismissPaid();
    }
  }, [paid, event?.name, brand?.displayName, dismissPaid]);

  // ---- Method chips.
  const pickMethod = useCallback(
    (next: DoorModeMethod): void => {
      if (busy || userId === null) return;
      if (next !== "tap_to_pay") tapDiscard();
      setChosen(next);
      setBanner(null);
      trackBrandSetup("take_payment_method_chosen", { method: next });
      if (next === "manual") return;
      const chipMethod: DoorModeChipMethod = next;
      const firstChange = memory !== null && !memory.noted;
      if (firstChange) setRememberedNote(DOOR_MODE_COPY.remembered(doorModeChipLabel(chipMethod, Platform.OS)));
      const saved = { method: chipMethod, noted: true };
      setMemory(saved);
      void writeDoorMethodMemory(userId, eventId, saved);
    },
    [busy, userId, tapDiscard, memory, eventId],
  );

  // ---- Charge.
  const recordOffline = useCallback(
    async (paymentMethod: "cash" | "manual"): Promise<void> => {
      if (eventCurrencyCode === null) return;
      const gate = gateRef.current;
      const clientRequestId = gate.idFor(basketKey);
      setSubmitting(true);
      try {
        const outcome = await gate.run(() =>
          recordSale.mutateAsync({
            eventId,
            eventDateId,
            buyerName: buyerName.trim(),
            buyerEmail: buyerEmail.trim().toLowerCase(),
            buyerPhoneE164: buyerPhone.e164,
            paymentMethod,
            lines: cart.map((line) => ({ ticketTypeId: line.ticketTypeId, quantity: line.quantity })),
            notes: "",
            clientRequestId,
          }),
        );
        if (!outcome.ran) return;
        postHogService.capture("door_sale_recorded", {
          method: paymentMethod,
          has_phone: buyerPhone.e164 !== null,
          ticket_count: ticketCount,
        });
        finishSale({
          method: paymentMethod,
          paid: {
            total: fmtMoney(subtotal),
            count: ticketCount,
            how: paymentMethod === "cash" ? DOOR_MODE_COPY.paidByCash : DOOR_MODE_COPY.paidManual,
            receipt: "cash",
          },
        });
      } catch (error) {
        const code = error instanceof DoorSaleError ? error.code : "unknown";
        postHogService.capture("door_sale_failed", { reason: code });
        // The basket stays exactly as it was; the same id retries the same order.
        setBanner({
          tone: "error",
          text:
            code === "door_ticket_capacity_exceeded"
              ? DOOR_MODE_COPY.capacity
              : code === "ticket_not_valid_on_chosen_days" || code === "door_event_date_invalid"
                ? DOOR_MODE_COPY.wrongDate
                : code === "door_access_denied" || code === "42501"
                  ? DOOR_PAYMENTS_NOT_ALLOWED
                  : DOOR_MODE_COPY.saleFailed,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [
      eventCurrencyCode,
      basketKey,
      recordSale,
      eventId,
      eventDateId,
      buyerName,
      buyerEmail,
      buyerPhone.e164,
      cart,
      ticketCount,
      finishSale,
      fmtMoney,
      subtotal,
    ],
  );

  const showCode = useCallback(async (): Promise<void> => {
    const gate = gateRef.current;
    setSubmitting(true);
    try {
      const outcome = await gate.run(() =>
        createPayCode.mutateAsync({
          eventId,
          eventDateId,
          lines: cart.map((line) => ({ ticketTypeId: line.ticketTypeId, quantity: line.quantity })),
        }),
      );
      if (!outcome.ran) return;
      postHogService.capture("door_pay_code_created", { ticket_count: ticketCount });
      setCodeId(outcome.value.codeId);
      setOverlay("code");
    } catch (error) {
      const code = error instanceof DoorPayCodeError ? error.code : "unknown";
      postHogService.capture("door_pay_code_failed", { reason: code });
      setBanner({ tone: "error", text: doorPayCodeCreateErrorCopy(code) });
    } finally {
      setSubmitting(false);
    }
  }, [createPayCode, eventId, eventDateId, cart, ticketCount]);

  const handleCharge = useCallback((): void => {
    if (method === null || busy || paid !== null) return;
    if (offline && isDoorCardMethod(method)) {
      setBanner({ tone: "warn", text: DOOR_MODE_COPY.offline });
      return;
    }
    // Apple: the button is never greyed for something missing; it says what's missing.
    const blocked = doorTapBlockReason({
      hasLines: cart.length > 0,
      dateMissing: dateNeeded && eventDateId === null,
      currencyMissing: eventCurrencyCode === null,
      permissionLoading: permission.data !== true,
      emailInvalid: !isValidDoorEmail(buyerEmail),
      phoneInvalid: !buyerPhone.isEmpty && buyerPhone.e164 === null,
      notesInvalid: false,
    });
    if (blocked !== null) {
      setBanner({ tone: "hint", text: blocked });
      return;
    }
    if (taxRefused && isDoorCardMethod(method)) {
      setBanner({ tone: "error", text: DOOR_CARD_TAX_REFUSAL });
      return;
    }
    setBanner(null);
    switch (method) {
      case "tap_to_pay": {
        const draft: TapToPayDraft = {
          lines: cart.map((line) => ({ ticketTypeId: line.ticketTypeId, quantity: line.quantity })),
          eventDateId,
          buyerPhone: buyerPhone.e164,
          phoneCountryIso: buyerPhone.e164 !== null ? buyerPhone.countryIso : null,
          ...(buyerName.trim().length > 0 ? { buyerName: buyerName.trim() } : {}),
        };
        postHogService.capture("door_sale_tap_started", { ticket_count: ticketCount });
        // Setup and an iOS update are the Tap to Pay route's screens.
        if (tapToPay.needsSetup || tapToPay.reason === "ios_update_required") handOff(draft);
        else tapCharge(draft, basketKey);
        return;
      }
      case "pay_code":
        void showCode();
        return;
      case "cash":
        setOverlay("cash");
        return;
      case "manual":
        void recordOffline("manual");
        return;
      default: {
        const exhaustive: never = method;
        return exhaustive;
      }
    }
  }, [
    method,
    busy,
    paid,
    offline,
    cart,
    dateNeeded,
    eventDateId,
    eventCurrencyCode,
    permission.data,
    buyerEmail,
    buyerPhone.isEmpty,
    buyerPhone.e164,
    buyerPhone.countryIso,
    buyerName,
    taxRefused,
    ticketCount,
    tapToPay.needsSetup,
    tapToPay.reason,
    handOff,
    tapCharge,
    basketKey,
    showCode,
    recordOffline,
  ]);

  const confirmCash = useCallback((): void => {
    setOverlay(null);
    void recordOffline("cash");
  }, [recordOffline]);

  const onCodePaid = useCallback(
    (done: { total: string; ticketCount: number }): void => {
      setOverlay(null);
      setCodeId(null);
      finishSale({
        method: "pay_code",
        paid: { total: done.total, count: done.ticketCount, how: DOOR_MODE_COPY.paidByPhone, receipt: null },
      });
    },
    [finishSale],
  );
  const onCodeDone = useCallback((): void => {
    setOverlay(null);
    setCodeId(null);
  }, []);

  // ---- Tiles.
  const addTicket = useCallback(
    (tier: TicketStub): void => {
      if (busy) return;
      setCart((prev) => addOneTicket(prev, tier.id));
    },
    [busy],
  );
  const removeTicket = useCallback(
    (tier: TicketStub): void => {
      if (busy) return;
      setCart((prev) => removeOneTicket(prev, tier.id));
    },
    [busy],
  );

  // ---- Navigation.
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) router.back();
    // orch-strict-grep-allow route-by-event-type — door routes exist only under /event/[id]/door.
    else router.replace(`/event/${eventId}/door` as never);
  }, [router, eventId]);
  const openSale = useCallback(
    (saleId: string): void => {
      setOverlay(null);
      // orch-strict-grep-allow route-by-event-type — door routes exist only under /event/[id]/door.
      router.push(`/event/${eventId}/door/${saleId}` as never);
    },
    [router, eventId],
  );
  const openAllSales = useCallback((): void => {
    setOverlay(null);
    // orch-strict-grep-allow route-by-event-type — door routes exist only under /event/[id]/door.
    router.push(`/event/${eventId}/door` as never);
  }, [router, eventId]);
  const choosePickedEvent = useCallback(
    (pickedId: string): void => {
      setOverlay(null);
      if (pickedId === eventId) return;
      // orch-strict-grep-allow route-by-event-type — the door sale route exists only under /event/[id]/door.
      router.replace(`/event/${pickedId}/door/sell?source=${encodeURIComponent(source ?? "picker")}` as never);
    },
    [eventId, router, source],
  );

  // ---- Derived view.
  const sales = useMemo(
    () => [...(doorSalesQuery.data ?? [])].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)),
    [doorSalesQuery.data],
  );
  const soldTonight = doorTicketsSoldTonight(sales, Date.now());
  const candidates = useMemo(() => doorSaleCandidates(brandEvents.data ?? [], Date.now()), [brandEvents.data]);

  const subtotalLabel = fmtMoney(subtotal);
  const buttonLabel = (() => {
    if (tap.busy) return DOOR_MODE_COPY.charging;
    switch (method) {
      case null:
        return DOOR_MODE_COPY.charge(null);
      case "tap_to_pay":
        return DOOR_MODE_COPY.charge(quotedTotal);
      case "pay_code":
        return DOOR_MODE_COPY.showCode(quotedTotal);
      case "cash":
        return DOOR_MODE_COPY.cashTaken(subtotalLabel);
      case "manual":
        return DOOR_MODE_COPY.manualTaken(subtotalLabel);
      default: {
        const exhaustive: never = method;
        return exhaustive;
      }
    }
  })();
  const dockTotal = cardMethod ? (quotedTotal ?? subtotalLabel) : subtotalLabel;

  // Tap failures say what happened with the existing copy; the tickets stay.
  const tapBanner = ((): { title: string; body: string; tone: ReturnType<typeof tapSaleTone> } | null => {
    const state = tap.state;
    switch (state.kind) {
      case "declined":
        return { title: "Card declined", body: "Their bank said no. Nothing was charged.", tone: tapSaleTone("declined") };
      case "needs_pin":
        return { ...TAP_CARD_NEEDS_INSERT_COPY, tone: tapSaleTone("needs_pin") };
      case "timed_out":
        return { ...TAP_TIMED_OUT_COPY, tone: tapSaleTone("timed_out") };
      case "cancelled":
        return { title: "Tap cancelled", body: "Nothing was charged.", tone: tapSaleTone("cancelled") };
      case "failed":
        return { title: "Payment didn't start", body: state.message, tone: tapSaleTone("failed") };
      case "reader_problem":
        return {
          title: tapReaderProblemTitle(Platform.OS),
          body: tapReaderProblemCopy(state.problem, Platform.OS),
          tone: tapSaleTone("reader_problem", state.problem),
        };
      default:
        return null;
    }
  })();
  const tapStatusText =
    tap.state.kind === "ready"
      ? Platform.OS === "ios"
        ? "Hold the card near the top of the iPhone."
        : "Hold the card on the back of the phone."
      : tap.state.kind === "reading"
        ? TAP_PROCESSING_TEXT
        : tap.state.kind === "saving"
          ? "Saving the sale…"
          : tap.state.kind === "starting"
            ? `Getting ${tapToPayName(Platform.OS)} ready…`
            : null;

  // ---- Shells.
  const header = (
    <View style={styles.header}>
      <IconChrome icon="close" size={44} onPress={handleClose} accessibilityLabel={DOOR_MODE_COPY.closeLabel} testID="door-mode-close" />
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {event?.name ?? ""}
        </Text>
        <Text style={styles.headerSub} numberOfLines={1} testID="door-mode-sold-tonight">
          {DOOR_MODE_COPY.soldTonight(soldTonight)}
        </Text>
      </View>
      <IconChrome
        icon="moreH"
        size={44}
        onPress={() => setOverlay("menu")}
        disabled={busy}
        accessibilityLabel={DOOR_MODE_COPY.menuLabel}
        testID="door-mode-menu"
      />
    </View>
  );

  if (event === null) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        {header}
        <CenteredState
          fill
          title={routeEvent.isLoading ? DOOR_MODE_COPY.loading : DOOR_MODE_COPY.notFound}
          body={routeEvent.isLoading ? null : DOOR_MODE_COPY.notFoundBody}
          testID="door-mode-not-found"
        />
      </View>
    );
  }

  const permissionDenied = permission.data === false;
  const unknownOrSaveFailed = tap.state.kind === "unknown_result" || tap.state.kind === "save_failed";

  return (
    <View style={[styles.host, { paddingTop: insets.top }]} testID="door-mode-screen">
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {offline ? (
          <BannerRow tone="warn" icon="wifiOff" text={DOOR_MODE_COPY.offline} testID="door-mode-offline" />
        ) : null}
        {permissionDenied ? <BannerRow tone="error" text={DOOR_PAYMENTS_NOT_ALLOWED} testID="door-mode-not-allowed" /> : null}
        {taxRefused ? <BannerRow tone="error" text={DOOR_CARD_TAX_REFUSAL} testID="door-mode-tax-refusal" /> : null}
        {tapBanner !== null ? (
          <BannerRow
            tone={tapBanner.tone === "bad" ? "error" : "warn"}
            text={`${tapBanner.title}. ${tapBanner.body}`}
            testID={`door-mode-tap-${tap.state.kind}`}
          />
        ) : null}
        {banner !== null ? <BannerRow tone={banner.tone} text={banner.text} testID="door-mode-banner" /> : null}
        {tapStatusText !== null ? (
          <View style={styles.pillRow}>
            <DoorStatusPill
              variant={tap.state.kind === "ready" ? "waiting" : "busy"}
              text={tapStatusText}
              stateLabel={tapStatusText}
              testID="door-mode-tap-status"
            />
          </View>
        ) : null}
        {rememberedNote !== null ? (
          <Text style={styles.help} testID="door-mode-remembered">
            {rememberedNote}
          </Text>
        ) : null}

        {tiers.length === 0 ? (
          <CenteredState
            fill
            icon={<Icon name="ticket" size={24} color={textTokens.tertiary} />}
            title={DOOR_MODE_COPY.noTiers}
            testID="door-mode-no-tiers"
          />
        ) : (
          <View style={styles.tiles} testID="door-mode-tiles">
            {tiers.map((tier) => {
              const qty = cartQuantity(cart, tier.id);
              const name = tier.name.length > 0 ? tier.name : "Untitled tier";
              const price = tier.isFree ? "Free" : fmtMoney(doorTierUnitPrice(tier));
              return (
                <Pressable
                  key={tier.id}
                  onPress={() => addTicket(tier)}
                  disabled={busy || qty >= 99}
                  accessibilityRole="button"
                  accessibilityLabel={DOOR_MODE_COPY.tileLabel(name, price, qty)}
                  style={({ pressed }) => [styles.tile, qty > 0 && styles.tileOn, pressed && styles.pressed]}
                  testID={`door-mode-tile-${tier.id}`}
                >
                  <Text style={styles.tileName} numberOfLines={2}>
                    {name}
                  </Text>
                  <Text style={styles.tilePrice}>{price}</Text>
                  {qty > 0 ? (
                    <>
                      <View style={styles.qtyBadge}>
                        <Text style={styles.qtyText}>{qty}</Text>
                      </View>
                      <Pressable
                        onPress={() => removeTicket(tier)}
                        disabled={busy}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={DOOR_MODE_COPY.removeOne(name)}
                        style={styles.minus}
                        testID={`door-mode-minus-${tier.id}`}
                      >
                        <Text style={styles.minusText}>−</Text>
                      </Pressable>
                    </>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {dateNeeded ? (
          <View style={styles.dates} testID="door-mode-dates">
            <Text style={styles.sectionLabel}>{DOOR_MODE_COPY.dateHeading}</Text>
            {dates.length === 0 ? (
              <Text style={styles.muted}>{dateKeys.isLoading ? DOOR_MODE_COPY.checkingDates : DOOR_MODE_COPY.noSharedDate}</Text>
            ) : (
              dates.map(([id, key]) => {
                const entry = event.multiDates?.find((e) => e.id === key);
                const label = entry !== undefined ? formatMultiDateList([entry])[0] : key;
                const active = id === eventDateId;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setEventDateId(id)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                    style={[styles.dateRow, active && styles.chipOn]}
                  >
                    <Text style={styles.chipText}>{label}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>{DOOR_MODE_COPY.howTheyPay}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={DOOR_MODE_COPY.howTheyPay} testID="door-mode-chips">
          {chips.map((chip) => {
            const on = method === chip;
            const label = doorModeChipLabel(chip, Platform.OS);
            const off = offline && chip !== "cash";
            return (
              <Pressable
                key={chip}
                onPress={() => pickMethod(chip)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, disabled: busy }}
                accessibilityLabel={label}
                style={[styles.chip, on && styles.chipOn, off && styles.chipOff]}
                testID={`door-mode-chip-${chip}`}
              >
                {chip === "tap_to_pay" ? (
                  <TapToPayIcon size={20} />
                ) : (
                  <Icon name={CHIP_ICON[chip]} size={20} color={on ? textTokens.primary : textTokens.secondary} />
                )}
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={2}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {method === "manual" ? <Text style={styles.help}>{DOOR_MODE_COPY.manualPicked}</Text> : null}
        {buyerLabel.length > 0 ? (
          <Text style={styles.help} testID="door-mode-buyer-set">
            {DOOR_MODE_COPY.buyerSet(buyerLabel)}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.totalRow}>
          <Text style={styles.muted}>{DOOR_MODE_COPY.ticketCount(ticketCount)}</Text>
          <Text style={styles.total} testID="door-mode-total">
            {dockTotal}
          </Text>
        </View>
        {cardMethod && quotedTotal === null && ticketCount > 0 && !offline ? (
          <Text style={styles.faint}>{DOOR_MODE_COPY.finalTotalHint}</Text>
        ) : null}
        <Button
          label={buttonLabel}
          onPress={handleCharge}
          variant={method === "tap_to_pay" ? "primary" : "step"}
          size="lg"
          fullWidth
          loading={submitting || tap.busy}
          disabled={method === null || busy || paid !== null || (offline && method !== null && isDoorCardMethod(method))}
          accessibilityLabel={buttonLabel}
          testID="door-mode-charge"
        />
      </View>

      {/* Money that may be real: the existing Tap to Pay copy, nothing else on screen. */}
      {unknownOrSaveFailed ? (
        <View style={[styles.blocking, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="door-mode-tap-blocking">
          {tap.state.kind === "unknown_result" ? (
            <TapStatusView
              tone={tapSaleTone("unknown_result")}
              title={TAP_UNKNOWN_RESULT_COPY.title}
              body={TAP_UNKNOWN_RESULT_COPY.body}
              primary={{ label: "Check again", onPress: () => void tap.checkAgain(), testID: "door-mode-check-again" }}
              testID="door-mode-tap-unknown"
            />
          ) : (
            <TapStatusView
              tone={tapSaleTone("save_failed")}
              title="Paid, still saving"
              body={tap.state.kind === "save_failed" ? tap.state.message : null}
              primary={{ label: "Save again", onPress: () => void tap.saveAgain(), testID: "door-mode-save-again" }}
              onHelp={() => router.push(HELP_AND_SUPPORT_ROUTE as never)}
              testID="door-mode-tap-save-failed"
            />
          )}
        </View>
      ) : null}

      {paid !== null ? (
        <Pressable
          style={styles.paid}
          onPress={dismissPaid}
          accessibilityRole="button"
          accessibilityLabel={`${DOOR_MODE_COPY.paid(paid.total)}. ${DOOR_MODE_COPY.nextSaleHint}`}
          testID="door-mode-paid"
        >
          <View style={styles.paidTick}>
            <Icon name="check" size={44} color="#063d1c" />
          </View>
          <Text style={styles.paidTitle} accessibilityRole="header">
            {DOOR_MODE_COPY.paid(paid.total)}
          </Text>
          <Text style={styles.paidLine}>{DOOR_MODE_COPY.paidLine(paid.count, paid.how)}</Text>
          {paid.receipt !== null ? (
            <Pressable
              onPress={() => void sendReceipt()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={DOOR_MODE_COPY.sendReceipt}
              testID="door-mode-send-receipt"
            >
              <Text style={styles.paidLink}>{DOOR_MODE_COPY.sendReceipt}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.paidHint}>{DOOR_MODE_COPY.nextSaleHint}</Text>
        </Pressable>
      ) : null}

      {/* One sheet at a time over the sale; never a sheet over a sheet. */}
      <Sheet visible={overlay === "cash"} onClose={() => setOverlay(null)} snapPoint="half" testID="door-mode-cash-confirm">
        <SheetScrollLayout
          testID="door-mode-cash-confirm-body"
          footer={
            <>
              <Button label={DOOR_MODE_COPY.confirmCash} onPress={confirmCash} variant="primary" size="lg" fullWidth testID="door-mode-confirm-cash" />
              <Button label={DOOR_MODE_COPY.back} onPress={() => setOverlay(null)} variant="secondary" size="md" fullWidth />
            </>
          }
        >
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {DOOR_MODE_COPY.cashConfirmTitle(subtotalLabel)}
          </Text>
          <Text style={styles.muted}>{DOOR_MODE_COPY.cashConfirmBody}</Text>
        </SheetScrollLayout>
      </Sheet>

      <DoorModePayCodeSheet visible={overlay === "code"} codeId={codeId} onPaid={onCodePaid} onDone={onCodeDone} />

      <Sheet visible={overlay === "menu"} onClose={() => setOverlay(null)} snapPoint="half" onDismissed={afterSheet} testID="door-mode-menu-sheet">
        <ScrollView style={styles.scroll} contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>{DOOR_MODE_COPY.recentSales}</Text>
          {sales.length === 0 ? (
            <CenteredState compact title={DOOR_MODE_COPY.noRecentSales} testID="door-mode-no-recent-sales" />
          ) : (
            sales.slice(0, 5).map((sale) => {
              const qty = sale.lines.reduce((s, l) => s + l.quantity, 0);
              const money = currencyCodeOrNull(sale.currency) !== null ? formatCurrency(sale.totalGbpAtSale, sale.currency) : "—";
              const label = `${DOOR_MODE_COPY.ticketCount(qty)} · ${money}${sale.buyerName.length > 0 ? ` · ${sale.buyerName}` : ""}`;
              return (
                <Pressable
                  key={sale.id}
                  onPress={() => openSale(sale.id)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                >
                  <Text style={styles.menuRowText} numberOfLines={1}>
                    {label}
                  </Text>
                  <Icon name="chevR" size={16} color={textTokens.tertiary} />
                </Pressable>
              );
            })
          )}
          <Pressable onPress={openAllSales} accessibilityRole="button" accessibilityLabel={DOOR_MODE_COPY.allSales} style={styles.menuRow}>
            <Text style={styles.menuRowText}>{DOOR_MODE_COPY.allSales}</Text>
            <Icon name="chevR" size={16} color={textTokens.tertiary} />
          </Pressable>
          <Pressable
            onPress={() => switchOverlay("buyer")}
            accessibilityRole="button"
            accessibilityLabel={`${DOOR_MODE_COPY.addBuyer}. ${DOOR_MODE_COPY.addBuyerSub}`}
            style={styles.menuRow}
            testID="door-mode-add-buyer"
          >
            <View style={styles.menuRowCol}>
              <Text style={styles.menuRowText}>{DOOR_MODE_COPY.addBuyer}</Text>
              <Text style={styles.faint}>{DOOR_MODE_COPY.addBuyerSub}</Text>
            </View>
            <Icon name="user" size={16} color={textTokens.tertiary} />
          </Pressable>
          <Pressable
            onPress={() => {
              pickMethod("manual");
              setOverlay(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${DOOR_MODE_COPY.manual}. ${DOOR_MODE_COPY.manualSub}`}
            style={styles.menuRow}
            testID="door-mode-manual"
          >
            <View style={styles.menuRowCol}>
              <Text style={styles.menuRowText}>{DOOR_MODE_COPY.manual}</Text>
              <Text style={styles.faint}>{DOOR_MODE_COPY.manualSub}</Text>
            </View>
            <Icon name="receipt" size={16} color={textTokens.tertiary} />
          </Pressable>
        </ScrollView>
      </Sheet>

      <DoorModeBuyerSheet
        visible={overlay === "buyer"}
        name={buyerName}
        email={buyerEmail}
        phone={buyerPhone}
        onChangeName={setBuyerName}
        onChangeEmail={setBuyerEmail}
        onClear={clearBuyer}
        onClose={() => setOverlay(null)}
      />

      <Sheet visible={overlay === "pick"} onClose={() => setOverlay(null)} snapPoint="half" testID="door-mode-pick-sheet">
        <ScrollView style={styles.scroll} contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {DOOR_MODE_COPY.whichEvent}
          </Text>
          {(candidates.length > 0 ? candidates : [{ eventId, name: event.name, live: true, startAtUtc: null }]).map((c) => (
            <Pressable
              key={c.eventId}
              onPress={() => choosePickedEvent(c.eventId)}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${c.live ? DOOR_MODE_COPY.liveNow : DOOR_MODE_COPY.today}`}
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
              testID={`door-mode-pick-${c.eventId}`}
            >
              <View style={styles.menuRowCol}>
                <Text style={styles.menuRowText} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.faint}>{c.live ? DOOR_MODE_COPY.liveNow : DOOR_MODE_COPY.today}</Text>
              </View>
              <Icon name="chevR" size={16} color={textTokens.tertiary} />
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
};

const BannerRow = ({
  tone,
  text,
  icon,
  testID,
}: {
  tone: Banner["tone"];
  text: string;
  icon?: "wifiOff";
  testID?: string;
}): React.ReactElement => (
  <View
    style={[styles.banner, tone === "error" ? styles.bannerError : tone === "warn" ? styles.bannerWarn : styles.bannerHint]}
    accessibilityRole={tone === "error" ? "alert" : undefined}
    accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
    testID={testID}
  >
    {icon !== undefined ? <Icon name={icon} size={18} color={textTokens.primary} /> : null}
    <Text style={styles.bannerText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: textTokens.primary },
  headerSub: { fontSize: 13, lineHeight: 17, color: textTokens.secondary },
  scroll: { flex: 1 },
  // flexGrow: an empty state centres in the space left (#4389).
  scrollContent: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  muted: { fontSize: 14, lineHeight: 20, color: textTokens.secondary },
  faint: { fontSize: 12, lineHeight: 16, color: textTokens.tertiary },
  help: { fontSize: 13, lineHeight: 18, color: textTokens.secondary },
  pillRow: { alignItems: "flex-start" },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    marginTop: spacing.sm,
  },
  banner: {
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
  },
  bannerError: { borderColor: semantic.error, backgroundColor: semantic.errorTint },
  bannerWarn: { borderColor: semantic.warning, backgroundColor: semantic.warningTint },
  bannerHint: { borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: textTokens.primary },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  tile: {
    overflow: "hidden",
    width: "48.5%",
    minHeight: 76,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    justifyContent: "space-between",
  },
  tileOn: { borderColor: accent.border, backgroundColor: accent.faint },
  pressed: { opacity: 0.8 },
  tileName: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: textTokens.primary, paddingRight: 28 },
  tilePrice: { fontSize: 13, lineHeight: 17, color: textTokens.secondary },
  qtyBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.warm,
  },
  qtyText: { fontSize: 13, fontWeight: "700", color: "#ffffff", fontVariant: ["tabular-nums"] },
  minus: {
    overflow: "hidden",
    position: "absolute",
    bottom: 6,
    right: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
  },
  minusText: { fontSize: 18, lineHeight: 20, fontWeight: "700", color: textTokens.primary },
  dates: { gap: spacing.xs },
  dateRow: {
    overflow: "hidden",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  chips: { flexDirection: "row", gap: 6 },
  chip: {
    overflow: "hidden",
    flex: 1,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  chipOn: { borderColor: accent.border, backgroundColor: accent.faint },
  chipOff: { opacity: 0.5 },
  chipText: { fontSize: 12, lineHeight: 15, fontWeight: "600", color: textTokens.secondary, textAlign: "center" },
  chipTextOn: { color: textTokens.primary },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  totalRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  total: { fontSize: 30, lineHeight: 36, fontWeight: "700", color: textTokens.primary, fontVariant: ["tabular-nums"] },
  blocking: { ...StyleSheet.absoluteFillObject, backgroundColor: canvas.discover, zIndex: 4 },
  paid: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: spacing.lg,
    backgroundColor: "rgba(10, 40, 24, 0.96)",
  },
  paidTick: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semantic.success,
  },
  paidTitle: { fontSize: 26, lineHeight: 32, fontWeight: "700", color: "#ffffff", textAlign: "center" },
  paidLine: { fontSize: 14, lineHeight: 20, color: "rgba(255, 255, 255, 0.82)", textAlign: "center" },
  paidLink: { fontSize: 14, lineHeight: 20, color: "#ffffff", textDecorationLine: "underline", paddingVertical: 12 },
  paidHint: { fontSize: 12, lineHeight: 16, color: "rgba(255, 255, 255, 0.72)", textAlign: "center" },
  sheetBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  sheetTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: textTokens.primary },
  menuRow: {
    overflow: "hidden",
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  menuRowCol: { flex: 1, minWidth: 0, paddingVertical: spacing.xs },
  menuRowText: { flex: 1, fontSize: 15, fontWeight: "600", color: textTokens.primary },
});

export default DoorModeScreen;
