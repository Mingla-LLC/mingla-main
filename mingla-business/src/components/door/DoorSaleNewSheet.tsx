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
 * issue #4271 — payment methods, in order: Buyer's phone (pay code: the guest
 * scans a code and pays on their own phone), Tap to pay (only where it works,
 * see useTapToPayAvailability), Cash, Manual, and a disabled Card reader row
 * ("Card machines are coming later."). Card money rides the online payment
 * rail; cash and manual are recorded through biz_door_sale_record. The whole
 * sheet is withheld from anyone the server says may not take door payments.
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
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
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
} from "../../hooks/useEventDoorSales";
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
import { PhoneField, usePhoneEntry } from "../ui/PhoneField";
import { Sheet } from "../ui/Sheet";
import { doorTierUnitPrice } from "./doorListPrice";
import {
  buildDoorPaymentOptions,
  doorMethodCollectsBuyerDetails,
  doorSaleButtonLabel,
  DOOR_PAY_CODE_BUYER_NOTE,
  DOOR_PAYMENTS_NOT_ALLOWED,
  DOOR_SALE_SUBHEAD,
} from "./doorPaymentOptions";
import { doorTapNewSaleHref } from "./doorTapDraft";

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

/** issue #4271 — every refusal says what happened; nothing was charged yet. */
export const doorPayCodeCreateErrorCopy = (code: string): string => {
  switch (code) {
    case "door_ticket_capacity_exceeded":
      return "Not enough tickets left for this sale.";
    case "ticket_not_valid_on_chosen_days":
      return "One of these tickets isn't valid on that date.";
    case "door_access_denied":
      return DOOR_PAYMENTS_NOT_ALLOWED;
    case "stripe_account_not_ready":
      return "Card payments aren't set up for this brand yet. Take cash or manual instead.";
    case "invalid_lines":
      return "Pick at least one ticket.";
    default:
      return "Couldn't make a pay code. Check your connection and try again.";
  }
};

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
  const [moreDetailsOpen, setMoreDetailsOpen] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const clientRequestId = useRef<string>(randomUuid());
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
      setBuyerName("");
      setBuyerEmail("");
      resetBuyerPhone();
      setMoreDetailsOpen(false);
      setNotes("");
      setSubmitting(false);
      setSubmitError(null);
      clientRequestId.current = randomUuid();
    }
  }, [event.currency, resetBuyerPhone, visible]);

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
  const paymentMethodValid =
    paymentMethodOption !== undefined && !paymentMethodOption.disabled;
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

  const canSubmit =
    !submitting &&
    lines.length > 0 &&
    (!doorDateNeeded || doorDateId !== null) &&
    paymentMethodValid &&
    emailValid &&
    phoneValid &&
    notesValid &&
    permission.data === true &&
    // #962 G5 / OQ-2(a) — cannot record a paid sale without an established
    // currency; a sale must never freeze a fabricated GBP.
    eventCurrencyCode !== null;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    // #962 G5 — narrow: guaranteed non-null by canSubmit, asserted here so the
    // frozen record currency is always the event's REAL code.
    if (eventCurrencyCode === null) return;
    const saleLines = lines.map((l) => ({
      ticketTypeId: l.ticketTypeId,
      quantity: l.quantity,
    }));
    if (paymentMethod === "tap_to_pay") {
      // The Tap to Pay route owns the card read; we only hand over the basket.
      postHogService.capture("door_sale_tap_started", { ticket_count: totalQty });
      onClose();
      router.push(
        doorTapNewSaleHref(event.id, {
          lines: saleLines,
          eventDateId: doorDateId,
          buyerPhone: buyerPhone.e164,
        }) as never,
      );
      return;
    }
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

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>New door sale</Text>
        <Text style={styles.subhead}>{DOOR_SALE_SUBHEAD}</Text>
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
          {/* ───── Step 1: Pick tickets ───── */}
          <Text style={styles.sectionHeader}>1. Pick tickets</Text>
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
                  <View key={tier.id} style={styles.tierRow}>
                    <View style={styles.tierCol}>
                      <Text style={styles.tierName} numberOfLines={1}>
                        {tier.name.length > 0 ? tier.name : "Untitled tier"}
                      </Text>
                      <Text style={styles.tierSubline}>{priceLabel}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => handleStep(tier, -1)}
                        disabled={lineQty === 0 || submitting}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${tier.name} quantity`}
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
                        accessibilityLabel={`Increase ${tier.name} quantity`}
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

          {/* Cart summary (only if there are lines) */}
          {lines.length > 0 ? (
            <View style={styles.cartSummary}>
              <View style={styles.cartSummaryDivider} />
              <View style={styles.cartSummaryRow}>
                <Text style={styles.cartSummaryLabel}>
                  {totalQty} ticket{totalQty === 1 ? "" : "s"}
                </Text>
                <Text style={styles.cartSummaryValue}>
                  {fmtDoorMoney(total)}
                </Text>
              </View>
            </View>
          ) : null}

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
                doorDates.map(([id, key]) => {
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
                })
              )}
            </View>
          ) : null}

          {/* ───── Step 2: How they pay (issue #4271) ───── */}
          <Text style={styles.sectionHeader}>2. How they pay</Text>
          <View style={styles.paymentList}>
            {paymentOptions.map((opt) => {
              const active = paymentMethod === opt.id && !opt.disabled;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    if (opt.disabled || submitting) return;
                    setPaymentMethod(opt.id);
                    setSubmitError(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: active,
                    disabled: opt.disabled,
                  }}
                  accessibilityLabel={`${opt.label}. ${opt.sub}`}
                  disabled={opt.disabled || submitting}
                  testID={`door-sale-method-${opt.id}`}
                  style={[
                    styles.paymentRow,
                    active && styles.paymentRowActive,
                    opt.disabled && styles.paymentRowDisabled,
                  ]}
                >
                  <View style={styles.paymentCol}>
                    <View style={styles.paymentLabelRow}>
                      <Text
                        style={[
                          styles.paymentLabel,
                          opt.disabled && styles.paymentLabelDisabled,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {opt.isNew ? (
                        <View style={styles.newBadge}>
                          <Text style={styles.newBadgeText}>NEW</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.paymentSubline,
                        opt.disabled && styles.paymentSublineDisabled,
                      ]}
                    >
                      {opt.sub}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radioOuter,
                      active && styles.radioOuterActive,
                      opt.disabled && styles.radioOuterDisabled,
                    ]}
                  >
                    {active ? <View style={styles.radioInner} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* ───── Step 3: Buyer details (optional) ───── */}
          {!collectsBuyerDetails ? (
            <View style={styles.payCodeNote} testID="door-sale-pay-code-note">
              <Text style={styles.payCodeNoteTitle}>Buyer details</Text>
              <Text style={styles.payCodeNoteBody}>{DOOR_PAY_CODE_BUYER_NOTE}</Text>
            </View>
          ) : (
          <>
          <Text style={styles.sectionHeader}>3. Buyer details (optional)</Text>

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

          <Pressable
            onPress={() => setMoreDetailsOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreDetailsOpen }}
            accessibilityLabel={moreDetailsOpen ? "Hide more details" : "Show more details"}
            style={styles.moreDetailsToggle}
          >
            <Text style={styles.moreDetailsLabel}>More details</Text>
            <Text style={styles.moreDetailsChevron}>{moreDetailsOpen ? "−" : "+"}</Text>
          </Pressable>

          {moreDetailsOpen ? (
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
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Notes</Text>
            <View style={styles.notesWrap}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. John gave £50 cash, change £10"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={3}
                maxLength={NOTES_MAX}
                style={styles.notesInput}
                editable={!submitting}
                accessibilityLabel="Sale notes"
              />
            </View>
            <Text style={styles.helperHint}>
              {notes.length} / {NOTES_MAX} characters
            </Text>
          </View>
          </>
          )}
        </ScrollView>

        {/* Sticky bottom bar — total + Record sale CTA */}
        <View style={styles.dock}>
          <View style={styles.dockTotalRow}>
            <Text style={styles.dockTotalLabel}>
              {paymentMethod === "pay_code" ? "Tickets" : "Total"}
            </Text>
            <Text style={styles.dockTotalValue}>{fmtDoorMoney(total)}</Text>
          </View>
          {paymentMethod === "pay_code" && eventCurrencyCode !== null ? (
            <Text style={styles.currencyGateHint}>
              The pay code shows the final total, with any fees.
            </Text>
          ) : null}
          {eventCurrencyCode === null ? (
            <Text style={styles.currencyGateHint}>
              Add your bank to record paid sales.
            </Text>
          ) : null}
          {permission.isError ? (
            <Text style={styles.submitError} accessibilityRole="alert">
              Couldn't check your door access. Check your connection and try again.
            </Text>
          ) : null}
          {submitError !== null ? (
            <Text style={styles.submitError} accessibilityRole="alert">
              {submitError}
            </Text>
          ) : null}
          <Button
            label={doorSaleButtonLabel(paymentMethod, fmtDoorMoney(total))}
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel={doorSaleButtonLabel(paymentMethod, fmtDoorMoney(total))}
            testID="door-sale-submit"
          />
          <View style={styles.dockSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel door sale"
          />
        </View>
        </>
        )}
      </View>
    </Sheet>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  scroll: {
    flex: 1,
    marginBottom: spacing.sm,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
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
    marginTop: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 4,
  },
  payCodeNoteTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.primary,
  },
  payCodeNoteBody: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
  },
  paymentLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  newBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: accent.warm,
  },
  newBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: textTokens.primary,
  },

  // Section headers ---------------------------------------------------
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
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
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.sm,
  },
  tierCol: {
    flex: 1,
    minWidth: 0,
  },
  tierName: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tierSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 36,
    height: 36,
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
    minWidth: 28,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },

  // Cart summary ------------------------------------------------------
  cartSummary: {
    marginTop: spacing.sm,
  },
  cartSummaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginBottom: spacing.sm,
  },
  cartSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  cartSummaryLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  cartSummaryValue: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },

  // Payment method picker --------------------------------------------
  paymentList: {
    gap: spacing.xs,
  },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.sm,
  },
  paymentRowActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  paymentRowDisabled: {
    opacity: 0.55,
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
  paymentLabelDisabled: {
    color: textTokens.tertiary,
  },
  paymentSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  paymentSublineDisabled: {
    color: textTokens.quaternary,
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
  radioOuterDisabled: {
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: accent.warm,
  },

  // Buyer fields ------------------------------------------------------
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
    color: semantic.error,
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
    color: textTokens.quaternary,
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },
  phoneHelper: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  moreDetailsToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  moreDetailsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  moreDetailsChevron: {
    fontSize: 20,
    color: textTokens.tertiary,
  },

  // Sticky bottom dock -----------------------------------------------
  dock: {
    paddingTop: spacing.sm,
  },
  dockTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  dockTotalLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  dockTotalValue: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  dockSpacer: {
    height: spacing.sm,
  },
  // #962 G5 — pre-bank currency gate hint above the Record CTA.
  currencyGateHint: {
    fontSize: 13,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  submitError: {
    fontSize: 13,
    lineHeight: 18,
    color: semantic.error,
    marginBottom: spacing.sm,
    textAlign: "center",
  },

  // Section header reuses (deprecated)
  field: {},
});

// ---- Default export -------------------------------------------------

export default DoorSaleNewSheet;
