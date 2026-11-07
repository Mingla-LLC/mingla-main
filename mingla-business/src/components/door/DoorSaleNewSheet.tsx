/**
 * DoorSaleNewSheet — J-D3 multi-line door sale flow (Cycle 12).
 *
 * Operator picks tickets + payment method + (optional) buyer details +
 * (optional) notes → confirms through the atomic door-sale RPC. The server
 * creates the order, ledger, tickets, and already-used attendance state.
 *
 * Operator-locked decisions (SPEC §2):
 *   #1 multi-line cart  · #2 tier source = both per availableAt
 *   #3 reconciliation grain unaffected by this sheet
 *   #4 unrelated (scanner permission)
 *   #5 server-minted tickets are born used; no device-only scan fan-out.
 *
 * I-29 — door sales are real server orders, never device-only phantom rows.
 *
 * I-30 — door tier filter: `t.visibility !== "hidden" && t.availableAt !== "online"`.
 *
 * issue #4271 — payment methods, in order: Tap to Pay (only where it works,
 * see useTapToPayAvailability; first and picked by default), Buyer's phone (pay
 * code: the guest scans a code and pays on their own phone), Cash and Manual.
 * Card money rides the online payment rail; cash and manual are recorded
 * through biz_door_sale_record. The whole sheet is withheld from anyone the
 * server says may not take door payments.
 *
 * Door polish (#4271): a 44pt header close replaces the dock's Cancel; the dock
 * is ONE row (total left, one button right that follows the picked payment
 * row) with at most one message line above it (doorDockMessage priority);
 * ticket rows wrap names to two lines, keep the stepper in a fixed 44pt
 * column and tint rows that are in the basket; unpicked payment rows are one
 * line; buyer details sit behind one "Add buyer details" row.
 *
 * Memory rules:
 *   - feedback_keyboard_never_blocks_input — ScrollView honors
 *     keyboardShouldPersistTaps="handled" + keyboardDismissMode="on-drag"
 *     + automaticallyAdjustKeyboardInsets (mirror Cycle 11 InviteScannerSheet).
 *   - feedback_rn_color_formats — only hex/rgb/rgba/hsl colors used.
 *
 * Per Cycle 12 SPEC §4.9 / §5/J-D3.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  durations,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useReduceMotion } from "../../hooks/useMotionPreferences";
import type { DoorPaymentMethod } from "../../types/doorSales";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Brand } from "../../types/brand";
import type { TicketStub } from "../../store/draftEventStore";
import { formatCurrency, currencyCodeOrNull } from "../../utils/currency";
import { phoneStartCountryForCurrency } from "../../utils/phoneStartCountryForCurrency";
import { randomUuid } from "../../utils/randomId";
import { useRouter } from "expo-router";
import { useRecordDoorSale } from "../../hooks/useEventDoorSales";
import {
  useCanTakeDoorPayment,
  useCreateDoorPayCode,
  useDoorPayCodeQuote,
} from "../../hooks/useEventDoorSales";
import { tapToPayName } from "../../constants/tapToPayName";
import { TapToPayIcon } from "./tap/TapToPayIcon";
import { getTapToPaySession } from "../../services/terminal/tapToPaySession";
import { markDoorTapPress } from "../../services/terminal/tapTiming";
import { useTapToPayAvailability } from "../../hooks/useTapToPayAvailability";
import { DoorPayCodeError } from "../../services/doorPayCodeService";
import { useEventDateKeys } from "../../hooks/useEventDateKeys";
import { formatMultiDateList } from "../../utils/eventDateDisplay";
import {
  DoorSaleError,
  type RecordDoorSaleResult,
} from "../../services/doorSalesService";
import { postHogService } from "../../services/postHogService";

import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { PhoneField, usePhoneEntry } from "../ui/PhoneField";
import { Sheet } from "../ui/Sheet";
import { doorTierUnitPrice } from "./doorListPrice";
import {
  buildDoorPaymentOptions,
  doorDockMessage,
  doorMethodCollectsBuyerDetails,
  doorNotesCounter,
  doorPayCodeDockTotal,
  doorSaleButtonLabel,
  doorTapBlockReason,
  doorTapDockTotal,
  doorTicketCountLabel,
  doorPayCodeCreateErrorCopy,
  DOOR_BUYER_DETAILS_ROW,
  DOOR_CARD_TAX_REFUSAL,
  DOOR_NOTES_PLACEHOLDER,
  DOOR_PAY_CODE_BUYER_NOTE,
  DOOR_PAYMENTS_NOT_ALLOWED,
  DOOR_SALE_SUBHEAD,
} from "./doorPaymentOptions";
import { doorTapNewSaleHref } from "./doorTapDraftHref";

// ---- Constants ------------------------------------------------------

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const NOTES_MAX = 500;
const MAX_QTY_PER_TIER = 99;

const isValidEmailOrEmpty = (s: string): boolean => {
  const t = s.trim();
  if (t.length === 0) return true;
  return t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

// ---- Cart line type (local — mirrors Cycle 8 CartLine shape) -------

interface DoorCartLine {
  ticketTypeId: string;
  ticketName: string;
  unitPrice: number;
  currency: string;
  isFree: boolean;
  quantity: number;
}

const makeDoorCartLine = (
  tier: TicketStub,
  quantity: number,
  eventCurrency: string | null | undefined,
): DoorCartLine => ({
  ticketTypeId: tier.id,
  ticketName: tier.name.length > 0 ? tier.name : "Untitled tier",
  unitPrice: doorTierUnitPrice(tier),
  // #962 G5 — never freeze a fabricated GBP. This local line currency is
  // vestigial (the recorded sale uses the event's real currency at submit);
  // empty when unset.
  currency: currencyCodeOrNull(tier.currency ?? eventCurrency) ?? "",
  isFree: tier.isFree,
  quantity,
});

// ---- Props ----------------------------------------------------------

export interface DoorSaleNewSheetProps {
  visible: boolean;
  event: LiveEvent;
  onClose: () => void;
  onSuccess: (result: RecordDoorSaleResult, phoneLast4: string | null) => void;
  /** issue #4271 — "Sell another" / "Take cash instead" reopen with these. */
  initialLines?: { ticketTypeId: string; quantity: number }[];
  initialMethod?: DoorPaymentMethod;
  /** The event's brand: Tap to Pay needs a Stripe brand that can charge. */
  brand: Brand | null;
}

// ---- Component ------------------------------------------------------

export const DoorSaleNewSheet: React.FC<DoorSaleNewSheetProps> = ({
  visible,
  event,
  onClose,
  onSuccess,
  initialLines,
  initialMethod,
  brand,
}) => {
  const router = useRouter();
  const [lines, setLines] = useState<DoorCartLine[]>([]);
  const [paymentMethod, setPaymentMethod] =
    useState<DoorPaymentMethod>("pay_code");
  const [buyerName, setBuyerName] = useState<string>("");
  const [buyerEmail, setBuyerEmail] = useState<string>("");
  const [buyerDetailsOpen, setBuyerDetailsOpen] = useState<boolean>(false);
  const reduceMotion = useReduceMotion();
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const clientRequestId = useRef<string>(randomUuid());
  // Tap to Pay is the default once it's known to be available, until the host
  // has chosen. Availability can resolve after the sheet opens.
  const hostChoseMethodRef = useRef<boolean>(false);
  const recordSale = useRecordDoorSale(event.id);
  const createPayCode = useCreateDoorPayCode(event.id);
  const permission = useCanTakeDoorPayment(visible ? event.id : null);
  const tapToPay = useTapToPayAvailability({ brand, currency: event.currency });

  // #962 G5 / OQ-2(a) — a door sale freezes its currency onto the record
  // (DoorSaleRecord.currency is NOT NULL). Pre-condition the record path behind
  // a set currency so a sale is NEVER frozen with a fabricated GBP. A pre-bank
  // brand (no established currency) sees "Add your bank to record paid sales".
  const eventCurrencyCode = currencyCodeOrNull(event.currency);
  const buyerPhone = usePhoneEntry({
    startCountries: [phoneStartCountryForCurrency(eventCurrencyCode)],
  });
  const resetBuyerPhone = buyerPhone.reset;
  const fmtDoorMoney = (v: number): string =>
    eventCurrencyCode === null ? "—" : formatCurrency(v, eventCurrencyCode);

  // I-30 tier filter: surfaces "door" + "both" tiers, hides hidden + online-only
  const pickableTiers = useMemo<TicketStub[]>(
    () =>
      event.tickets
        .filter((t) => t.visibility !== "hidden" && t.availableAt !== "online")
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [event.tickets],
  );

  // issue #4271 — "Sell another" and "Take cash instead" reopen the sheet with
  // the last tickets kept. Read through refs so a re-render of the parent does
  // not reseed an open sheet.
  const initialLinesRef = useRef(initialLines);
  initialLinesRef.current = initialLines;
  const initialMethodRef = useRef(initialMethod);
  initialMethodRef.current = initialMethod;
  const pickableTiersRef = useRef(pickableTiers);
  pickableTiersRef.current = pickableTiers;

  // Reset on visible flip → true
  useEffect(() => {
    if (visible) {
      const seeded = (initialLinesRef.current ?? []).flatMap((seed) => {
        const tier = pickableTiersRef.current.find((t) => t.id === seed.ticketTypeId);
        if (tier === undefined || seed.quantity <= 0) return [];
        return [makeDoorCartLine(tier, Math.min(MAX_QTY_PER_TIER, seed.quantity), event.currency)];
      });
      setLines(seeded);
      setPaymentMethod(initialMethodRef.current ?? "pay_code");
      hostChoseMethodRef.current = initialMethodRef.current !== undefined;
      setBuyerName("");
      setBuyerEmail("");
      resetBuyerPhone();
      setBuyerDetailsOpen(false);
      setNotes("");
      setSubmitting(false);
      setSubmitError(null);
      clientRequestId.current = randomUuid();
    }
  }, [event.currency, resetBuyerPhone, visible]);

  useEffect(() => {
    if (!visible || !tapToPay.available || hostChoseMethodRef.current) return;
    hostChoseMethodRef.current = true;
    setPaymentMethod("tap_to_pay");
  }, [visible, tapToPay.available]);

  const total = useMemo<number>(
    () => lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    [lines],
  );

  const totalQty = useMemo<number>(
    () => lines.reduce((sum, l) => sum + l.quantity, 0),
    [lines],
  );

  const setLineQuantity = useCallback(
    (tier: TicketStub, nextQty: number): void => {
      const safeQty = Math.max(0, Math.min(MAX_QTY_PER_TIER, nextQty));
      setLines((prev) => {
        const existing = prev.find((l) => l.ticketTypeId === tier.id);
        if (safeQty === 0) {
          if (existing === undefined) return prev;
          return prev.filter((l) => l.ticketTypeId !== tier.id);
        }
        if (existing === undefined) {
          return [...prev, makeDoorCartLine(tier, safeQty, event.currency)];
        }
        return prev.map((l) =>
          l.ticketTypeId === tier.id ? { ...l, quantity: safeQty } : l,
        );
      });
    },
    [event.currency],
  );

  const handleStep = useCallback(
    (tier: TicketStub, delta: number): void => {
      const current =
        lines.find((l) => l.ticketTypeId === tier.id)?.quantity ?? 0;
      setLineQuantity(tier, current + delta);
    },
    [lines, setLineQuantity],
  );

  // Validation
  // issue #4271 — the method list, in the approved order.
  const paymentOptions = useMemo(
    () =>
      buildDoorPaymentOptions({
        eventCurrency: eventCurrencyCode,
        tapToPay,
        platform: Platform.OS,
      }),
    [eventCurrencyCode, tapToPay],
  );
  const collectsBuyerDetails = doorMethodCollectsBuyerDetails(paymentMethod);
  const emailValid = !collectsBuyerDetails || isValidEmailOrEmpty(buyerEmail);
  const phoneValid =
    !collectsBuyerDetails || buyerPhone.isEmpty || buyerPhone.e164 !== null;
  const notesValid = notes.length <= NOTES_MAX;
  const paymentMethodOption = paymentOptions.find(
    (p) => p.id === paymentMethod,
  );
  const paymentMethodValid = paymentMethodOption !== undefined;
  // The server checks again on every money method; this only keeps a person
  // without permission from filling in a sale that would be refused.
  const permissionDenied = permission.data === false;

  // issue #3281 — a listed ticket's pass needs a date, and one sale has one.
  const [doorDateId, setDoorDateId] = useState<string | null>(null);
  const listedLines = lines
    .map((line) => pickableTiers.find((t) => t.id === line.ticketTypeId))
    .filter((t): t is TicketStub => t?.validDayIds != null);
  const doorDateKeys = useEventDateKeys(event.id, listedLines.length > 0);
  const doorDates = useMemo(
    () =>
      (doorDateKeys.data ?? [])
        .filter(
          (row) =>
            row.occurrence_key !== null &&
            row.cancelled_at === null &&
            new Date(row.end_at).getTime() > Date.now() &&
            listedLines.every((t) => t.validDayIds?.includes(row.occurrence_key!)),
        )
        .map((row): [string, string] => [row.id, row.occurrence_key!]),
    [doorDateKeys.data, listedLines],
  );
  const doorDateNeeded = listedLines.length > 0;
  useEffect(() => {
    if (!doorDateNeeded) setDoorDateId(null);
    else if (doorDates.length === 1) setDoorDateId(doorDates[0][0]);
    else if (!doorDates.some(([id]) => id === doorDateId)) setDoorDateId(null);
  }, [doorDateId, doorDateNeeded, doorDates]);

  // issue #4271 — the card total comes from the server, the same pricing a pay
  // code or a tap is created with. Never estimated on the phone.
  const quotesServerTotal = paymentMethod === "pay_code" || paymentMethod === "tap_to_pay";
  const payCodeQuote = useDoorPayCodeQuote({
    eventId: event.id,
    eventDateId: doorDateId,
    lines,
    enabled:
      visible &&
      quotesServerTotal &&
      permission.data === true &&
      (!doorDateNeeded || doorDateId !== null),
  });
  const formatQuoted = (cents: number, currency: string): string => formatCurrency(cents, currency, true);
  const quotedDock =
    paymentMethod === "tap_to_pay"
      ? doorTapDockTotal(payCodeQuote.data, fmtDoorMoney(total), formatQuoted)
      : doorPayCodeDockTotal(payCodeQuote.data, fmtDoorMoney(total), formatQuoted);
  // Tax added at checkout: the server refuses door card money, so no amount shows.
  const taxRefused =
    quotesServerTotal &&
    (payCodeQuote.error as { code?: unknown } | null | undefined)?.code === "door_tax_added_at_checkout";
  const [tapBlockedMessage, setTapBlockedMessage] = useState<string | null>(null);
  // A blocked tap's reason is about the sale as it was. Any change to the
  // tickets, the date or the buyer's details makes it stale, so it goes.
  useEffect(() => {
    setTapBlockedMessage(null);
  }, [lines, doorDateId, buyerName, buyerEmail, buyerPhone.text, buyerPhone.countryIso, notes]);

  const canSubmit =
    !submitting &&
    lines.length > 0 &&
    (!doorDateNeeded || doorDateId !== null) &&
    paymentMethodValid &&
    emailValid &&
    phoneValid &&
    notesValid &&
    permission.data === true &&
    // #4271 — tax added at checkout: the refusal is already on screen, so the
    // card buttons are off rather than printing it a second time.
    !taxRefused &&
    // #962 G5 / OQ-2(a) — cannot record a paid sale without an established
    // currency; a sale must never freeze a fabricated GBP.
    eventCurrencyCode !== null;

  // Two presses in one frame (the slim button and the dock button, or a double
  // tap) must open the Tap to Pay screen once. Set only when the push happens;
  // a blocked press keeps the sheet open and leaves it clear. Cleared whenever
  // the sheet is shown or hidden.
  const tapStartedRef = useRef(false);
  useEffect(() => {
    tapStartedRef.current = false;
  }, [visible]);

  const startTapSale = useCallback((): void => {
    if (tapStartedRef.current) return;
    // The tax refusal already shows in the dock; never print it twice.
    if (taxRefused) return;
    const blocked = doorTapBlockReason({
      hasLines: lines.length > 0,
      dateMissing: doorDateNeeded && doorDateId === null,
      currencyMissing: eventCurrencyCode === null,
      permissionLoading: permission.data !== true,
      emailInvalid: !isValidEmailOrEmpty(buyerEmail),
      phoneInvalid: !buyerPhone.isEmpty && buyerPhone.e164 === null,
      notesInvalid: !notesValid,
    });
    setTapBlockedMessage(blocked);
    if (blocked !== null) return;
    // The Tap to Pay route owns the card read; we only hand over the basket.
    tapStartedRef.current = true;
    postHogService.capture("door_sale_tap_started", { ticket_count: totalQty });
    markDoorTapPress(getTapToPaySession().readerReady);
    onClose();
    router.push(
      doorTapNewSaleHref(event.id, {
        lines: lines.map((l) => ({ ticketTypeId: l.ticketTypeId, quantity: l.quantity })),
        eventDateId: doorDateId,
        buyerPhone: buyerPhone.e164,
        // Shown on the paid screen's Guest row only when the host typed one.
        buyerName: buyerName.trim().length > 0 ? buyerName.trim() : null,
      }) as never,
    );
  }, [
    taxRefused,
    lines,
    doorDateNeeded,
    doorDateId,
    eventCurrencyCode,
    permission.data,
    buyerEmail,
    buyerName,
    buyerPhone,
    notesValid,
    totalQty,
    onClose,
    router,
    event.id,
  ]);

  // Apple B8 (Seth's "slim second button"): with another method picked, Tap to
  // Pay stays one press away under the dock. The press picks Tap to Pay and
  // starts it; a press that can't start says why in the dock message line.
  const showTapDock =
    pickableTiers.length > 0 &&
    paymentMethod !== "tap_to_pay" &&
    paymentOptions.some((opt) => opt.id === "tap_to_pay");
  const handleTapDock = useCallback((): void => {
    if (submitting) return;
    hostChoseMethodRef.current = true;
    setPaymentMethod("tap_to_pay");
    setSubmitError(null);
    startTapSale();
  }, [submitting, startTapSale]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (paymentMethod === "tap_to_pay") {
      startTapSale();
      return;
    }
    if (!canSubmit) return;
    // #962 G5 — narrow: guaranteed non-null by canSubmit, asserted here so the
    // frozen record currency is always the event's REAL code.
    if (eventCurrencyCode === null) return;
    const saleLines = lines.map((l) => ({
      ticketTypeId: l.ticketTypeId,
      quantity: l.quantity,
    }));
    setSubmitting(true);
    setSubmitError(null);
    if (paymentMethod === "pay_code") {
      try {
        const created = await createPayCode.mutateAsync({
          eventId: event.id,
          eventDateId: doorDateId,
          lines: saleLines,
        });
        postHogService.capture("door_pay_code_created", { ticket_count: totalQty });
        onClose();
        router.push(`/event/${event.id}/door/pay/${created.codeId}` as never);
      } catch (error) {
        const code = error instanceof DoorPayCodeError ? error.code : "unknown";
        postHogService.capture("door_pay_code_failed", { reason: code });
        setSubmitError(doorPayCodeCreateErrorCopy(code));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    try {
      const result = await recordSale.mutateAsync({
        eventId: event.id,
        eventDateId: doorDateId,
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim().toLowerCase(),
        buyerPhoneE164: buyerPhone.e164,
        paymentMethod,
        lines: saleLines,
        notes: notes.trim(),
        clientRequestId: clientRequestId.current,
      });
      const digits = buyerPhone.e164?.replace(/\D/g, "") ?? "";
      postHogService.capture("door_sale_recorded", {
        method: paymentMethod,
        has_phone: buyerPhone.e164 !== null,
        ticket_count: totalQty,
      });
      onSuccess(result, digits.length >= 4 ? digits.slice(-4) : null);
    } catch (error) {
      postHogService.capture("door_sale_failed", {
        reason: error instanceof DoorSaleError ? error.code : "unknown",
      });
      if (error instanceof DoorSaleError) {
        if (error.code === "door_ticket_capacity_exceeded") {
          setSubmitError("Not enough tickets left for this sale.");
        } else if (
          error.code === "ticket_not_valid_on_chosen_days" ||
          error.code === "door_event_date_invalid"
        ) {
          setSubmitError("One of these tickets isn't valid on that date.");
        } else if (error.code === "door_access_denied" || error.code === "42501") {
          setSubmitError(DOOR_PAYMENTS_NOT_ALLOWED);
        } else {
          setSubmitError("Couldn't record the sale. Check your connection and try again.");
        }
      } else {
        setSubmitError("Couldn't record the sale. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    startTapSale,
    doorDateId,
    event.id,
    eventCurrencyCode,
    buyerName,
    buyerEmail,
    buyerPhone,
    paymentMethod,
    lines,
    totalQty,
    notes,
    onSuccess,
    recordSale,
    createPayCode,
    onClose,
    router,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const toggleBuyerDetails = useCallback((): void => {
    // A 200ms reveal; instant under reduced motion.
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(durations.normal, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      );
    }
    setBuyerDetailsOpen((open) => !open);
  }, [reduceMotion]);

  // Door polish: the dock says at most one thing, highest priority first.
  const dockMessage = doorDockMessage(
    {
      taxRefused,
      accessCheckFailed: permission.isError,
      error: submitError ?? tapBlockedMessage,
      bankMissing: eventCurrencyCode === null,
      cardQuotePending:
        quotesServerTotal && !taxRefused && eventCurrencyCode !== null && !quotedDock.quoted
          ? paymentMethod === "tap_to_pay"
            ? "tap_to_pay"
            : "pay_code"
          : null,
    },
    DOOR_CARD_TAX_REFUSAL,
  );
  const dockMessageTestID = taxRefused
    ? "door-sale-tax-refusal"
    : dockMessage !== null && submitError === null && tapBlockedMessage !== null && dockMessage.text === tapBlockedMessage
      ? "door-sale-tap-blocked"
      : "door-sale-dock-message";
  const dockLabel = quotesServerTotal ? quotedDock.label : doorTicketCountLabel(totalQty);
  const dockAmount = quotesServerTotal ? quotedDock.amount : fmtDoorMoney(total);
  const notesCounter = doorNotesCounter(notes.length, NOTES_MAX);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              New door sale
            </Text>
            <Text style={styles.subhead}>{DOOR_SALE_SUBHEAD}</Text>
          </View>
          <IconChrome
            icon="close"
            size={44}
            onPress={handleClose}
            disabled={submitting}
            accessibilityLabel="Close door sale"
            testID="door-sale-close"
          />
        </View>
        {permissionDenied ? (
          <View style={styles.blockedWrap} testID="door-sale-not-allowed">
            <Text style={styles.blockedTitle}>{DOOR_PAYMENTS_NOT_ALLOWED}</Text>
            <Button
              label="Close"
              onPress={handleClose}
              variant="secondary"
              size="md"
              fullWidth
              accessibilityLabel="Close door sale"
            />
          </View>
        ) : (
        <>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionHeader}>Tickets</Text>
          {pickableTiers.length === 0 ? (
            <View style={styles.emptyTiersWrap}>
              <Text style={styles.emptyTiersTitle}>
                No tiers available for door sales
              </Text>
              <Text style={styles.emptyTiersBody}>
                Edit the event and mark at least one tier as available at the
                door.
              </Text>
            </View>
          ) : (
            <View style={styles.tiersList}>
              {pickableTiers.map((tier) => {
                const lineQty =
                  lines.find((l) => l.ticketTypeId === tier.id)?.quantity ?? 0;
                const tierName = tier.name.length > 0 ? tier.name : "Untitled tier";
                // #962 G5 — hide the tier price ("—") when neither the tier nor
                // the event has an established currency; never a fabricated £.
                const tierCode = currencyCodeOrNull(
                  tier.currency ?? event.currency,
                );
                const priceLabel = tier.isFree
                  ? "Free"
                  : tier.priceGbp !== null && tierCode !== null
                    ? formatCurrency(tier.priceGbp, tierCode)
                    : "—";
                return (
                  <View
                    key={tier.id}
                    style={[styles.tierRow, lineQty > 0 && styles.tierRowPicked]}
                    testID={`door-sale-tier-${tier.id}`}
                  >
                    <View style={styles.tierCol}>
                      <Text
                        style={styles.tierName}
                        numberOfLines={2}
                        accessibilityLabel={tierName}
                      >
                        {tierName}
                      </Text>
                      <Text style={styles.tierSubline}>{priceLabel}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => handleStep(tier, -1)}
                        disabled={lineQty === 0 || submitting}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${tierName}`}
                        style={[
                          styles.stepperBtn,
                          (lineQty === 0 || submitting) &&
                            styles.stepperBtnDisabled,
                        ]}
                      >
                        <Text style={styles.stepperBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.stepperValue}>{lineQty}</Text>
                      <Pressable
                        onPress={() => handleStep(tier, 1)}
                        disabled={lineQty >= MAX_QTY_PER_TIER || submitting}
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${tierName}`}
                        style={[
                          styles.stepperBtn,
                          (lineQty >= MAX_QTY_PER_TIER || submitting) &&
                            styles.stepperBtnDisabled,
                        ]}
                      >
                        <Text style={styles.stepperBtnText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {doorDateNeeded ? (
            <View testID="issue-3281-door-date">
              <Text style={styles.sectionHeader}>Date</Text>
              {doorDates.length === 0 ? (
                <Text style={styles.paymentLabel}>
                  {doorDateKeys.isLoading
                    ? "Checking dates…"
                    : "These tickets share no date. Sell them separately."}
                </Text>
              ) : (
                <View style={styles.paymentList}>
                  {doorDates.map(([id, key]) => {
                    const active = id === doorDateId;
                    // The time too: two entries can share a calendar day.
                    const entry = event.multiDates?.find((e) => e.id === key);
                    const label =
                      entry !== undefined ? formatMultiDateList([entry])[0] : key;
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setDoorDateId(id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={label}
                        style={[styles.paymentRow, active && styles.paymentRowActive]}
                      >
                        <Text style={styles.paymentLabel}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* issue #4271 — Tap to Pay first and picked by default when it works here. */}
          <Text style={styles.sectionHeader}>How they pay</Text>
          <View style={styles.paymentList}>
            {paymentOptions.map((opt) => {
              const active = paymentMethod === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    if (submitting) return;
                    hostChoseMethodRef.current = true;
                    setPaymentMethod(opt.id);
                    setSubmitError(null);
                    setTapBlockedMessage(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${opt.label}. ${opt.sub}`}
                  disabled={submitting}
                  testID={`door-sale-method-${opt.id}`}
                  style={[
                    styles.paymentRow,
                    active && styles.paymentRowActive,
                  ]}
                >
                  <View style={styles.paymentCol}>
                    <View style={styles.paymentLabelRow}>
                      {opt.id === "tap_to_pay" ? <TapToPayIcon size={18} /> : null}
                      <Text style={styles.paymentLabel}>{opt.label}</Text>
                    </View>
                    {/* Only the picked row explains itself; the rest stay one line. */}
                    {active ? (
                      <Text style={styles.paymentSubline}>{opt.sub}</Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.radioOuter,
                      active && styles.radioOuterActive,
                    ]}
                  >
                    {active ? <View style={styles.radioInner} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Buyer details: the guest types their own for a pay code. */}
          {!collectsBuyerDetails ? (
            <Text style={styles.payCodeNote} testID="door-sale-pay-code-note">
              {DOOR_PAY_CODE_BUYER_NOTE}
            </Text>
          ) : (
          <>
          <Pressable
            onPress={toggleBuyerDetails}
            accessibilityRole="button"
            accessibilityState={{ expanded: buyerDetailsOpen }}
            accessibilityLabel={`${DOOR_BUYER_DETAILS_ROW.title}. ${DOOR_BUYER_DETAILS_ROW.sub}`}
            style={styles.buyerDetailsRow}
            testID="door-sale-buyer-details-toggle"
          >
            <View style={styles.paymentCol}>
              <Text style={styles.buyerDetailsTitle}>{DOOR_BUYER_DETAILS_ROW.title}</Text>
              <Text style={styles.paymentSubline}>{DOOR_BUYER_DETAILS_ROW.sub}</Text>
            </View>
            <Text style={styles.buyerDetailsChevron}>{buyerDetailsOpen ? "−" : "+"}</Text>
          </Pressable>

          {buyerDetailsOpen ? (
          <View testID="door-sale-buyer-details">
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Name</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={buyerName}
                onChangeText={setBuyerName}
                placeholder="Walk-up"
                placeholderTextColor={textTokens.quaternary}
                maxLength={NAME_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Buyer name"
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Buyer&apos;s mobile (for their receipt)</Text>
            <PhoneField
              entry={buyerPhone}
              accessibilityLabel="Buyer's mobile number, optional, for their receipt"
              disabled={submitting}
              placeholder="Mobile number"
              testID="door-sale-buyer-phone"
            />
            <Text style={styles.phoneHelper}>
              We&apos;ll text them a receipt they can open in the Mingla app.
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <View
              style={[
                styles.inputWrap,
                buyerEmail.length > 0 && !emailValid && styles.inputError,
              ]}
            >
              <TextInput
                value={buyerEmail}
                onChangeText={setBuyerEmail}
                placeholder="optional"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={EMAIL_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Buyer email"
              />
            </View>
            {buyerEmail.length > 0 && !emailValid ? (
              <Text style={styles.errorText}>Enter a valid email or leave blank.</Text>
            ) : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Notes</Text>
            <View style={styles.notesWrap}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={DOOR_NOTES_PLACEHOLDER}
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={3}
                maxLength={NOTES_MAX}
                style={styles.notesInput}
                editable={!submitting}
                accessibilityLabel="Sale notes"
              />
            </View>
            {notesCounter !== null ? (
              <Text style={styles.helperHint}>{notesCounter}</Text>
            ) : null}
          </View>
          </View>
          ) : null}
          </>
          )}
        </ScrollView>

        {/* Door polish: one row, about 76pt. Total left, one button right. */}
        <View style={styles.dock}>
          <View style={styles.dockMessageSlot} accessibilityLiveRegion="polite">
            {dockMessage !== null ? (
              <Text
                style={dockMessage.tone === "error" ? styles.dockMessageError : styles.dockMessageHint}
                accessibilityRole={dockMessage.tone === "error" ? "alert" : undefined}
                numberOfLines={2}
                testID={dockMessageTestID}
              >
                {dockMessage.text}
              </Text>
            ) : null}
          </View>
          <View style={styles.dockRow}>
            {taxRefused ? null : (
              <View style={styles.dockTotal} testID="door-sale-dock-total-row">
                <Text style={styles.dockTotalLabel} numberOfLines={1}>
                  {dockLabel}
                </Text>
                <Text style={styles.dockTotalValue} numberOfLines={1} testID="door-sale-dock-total">
                  {dockAmount}
                </Text>
              </View>
            )}
            {pickableTiers.length === 0 ? null : (
              <View style={styles.dockButtonRow}>
                {paymentMethod === "tap_to_pay" ? <TapToPayIcon size={22} /> : null}
                <View style={styles.dockButton}>
                  <Button
                    label={doorSaleButtonLabel(paymentMethod, Platform.OS)}
                    onPress={handleConfirm}
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={submitting}
                    // Apple: the Tap to Pay button is never greyed; a press that
                    // can't start says why in the message line instead.
                    disabled={paymentMethod === "tap_to_pay" ? submitting || taxRefused : !canSubmit}
                    accessibilityLabel={doorSaleButtonLabel(paymentMethod, Platform.OS)}
                    testID="door-sale-submit"
                  />
                </View>
              </View>
            )}
          </View>
          {showTapDock ? (
            <Pressable
              onPress={handleTapDock}
              disabled={submitting || taxRefused}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting || taxRefused }}
              accessibilityLabel={tapToPayName(Platform.OS)}
              testID="door-sale-tap-dock"
              style={({ pressed }) => [
                styles.tapDock,
                pressed && styles.tapDockPressed,
                (submitting || taxRefused) && styles.tapDockDisabled,
              ]}
            >
              <TapToPayIcon size={18} />
              <Text style={styles.tapDockLabel} numberOfLines={1}>
                {tapToPayName(Platform.OS)}
              </Text>
            </Pressable>
          ) : null}
        </View>
        </>
        )}
      </View>
    </Sheet>
  );
};

// ---- Styles ---------------------------------------------------------

const STEPPER_BUTTON = 44;

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.h3,
    fontWeight: "700",
    color: textTokens.primary,
  },
  subhead: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.md,
  },

  // issue #4271 — shown instead of the sale to people without permission.
  blockedWrap: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  blockedTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    color: textTokens.primary,
  },
  payCodeNote: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.md,
  },
  paymentLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },

  // Section headers ---------------------------------------------------
  sectionHeader: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },

  // Tier rows ---------------------------------------------------------
  emptyTiersWrap: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  emptyTiersTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 4,
  },
  emptyTiersBody: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.tertiary,
  },
  tiersList: {
    gap: spacing.xs,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.sm,
  },
  // In the basket: a soft accent wash so the picks show while scrolling.
  tierRowPicked: {
    borderColor: accent.border,
    backgroundColor: accent.faint,
  },
  tierCol: {
    flex: 1,
    minWidth: 0,
  },
  tierName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tierSubline: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  // A fixed right column (44 + value + 44) so every row lines up.
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: STEPPER_BUTTON * 2 + 22 + spacing.sm * 2,
  },
  stepperBtn: {
    width: STEPPER_BUTTON,
    height: STEPPER_BUTTON,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperBtnText: {
    fontSize: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    width: 22,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },

  // Payment method picker --------------------------------------------
  paymentList: {
    gap: spacing.xs,
  },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.sm,
  },
  paymentRowActive: {
    minHeight: 56,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  paymentCol: {
    flex: 1,
    minWidth: 0,
  },
  paymentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  paymentSubline: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: textTokens.quaternary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterActive: {
    borderColor: accent.warm,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: accent.warm,
  },

  // Buyer fields ------------------------------------------------------
  buyerDetailsRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: glass.border.profileElevated,
  },
  buyerDetailsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  buyerDetailsChevron: {
    fontSize: 20,
    color: textTokens.tertiary,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 6,
  },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputError: {
    borderColor: semantic.error,
  },
  input: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 40,
    paddingVertical: 6,
    ...(Platform.OS === "web"
      ? ({ outlineWidth: 0 } as Record<string, number>)
      : null),
  },
  errorText: {
    fontSize: 12,
    color: semantic.errorText,
    marginTop: 4,
  },
  notesWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    minHeight: 80,
  },
  notesInput: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 64,
    textAlignVertical: "top",
    ...(Platform.OS === "web"
      ? ({ outlineWidth: 0 } as Record<string, number>)
      : null),
  },
  helperHint: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 4,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  phoneHelper: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },

  // Sticky bottom dock: one row ---------------------------------------
  // The Sheet already pads its body by spacing.lg plus the bottom safe area,
  // which is the dock's bottom padding; no second gap here.
  dock: {
    marginHorizontal: -spacing.lg,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  dockMessageSlot: {
    marginBottom: spacing.xs,
  },
  dockMessageHint: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
  },
  dockMessageError: {
    fontSize: 12,
    lineHeight: 16,
    color: semantic.errorText,
  },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  dockTotal: {
    minWidth: 84,
  },
  dockTotalLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  dockTotalValue: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  dockButtonRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dockButton: {
    flex: 1,
  },
  // The slim second button: Tap to Pay one press away when another method is picked.
  tapDock: {
    height: 44,
    marginTop: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  tapDockPressed: {
    opacity: 0.8,
  },
  tapDockDisabled: {
    opacity: 0.5,
  },
  tapDockLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
});

// ---- Default export -------------------------------------------------

export default DoorSaleNewSheet;
