/**
 * DoorSaleNewSheet — J-D3 multi-line door sale flow (Cycle 12).
 *
 * Operator picks tickets + payment method + (optional) buyer details +
 * (optional) notes → confirms → useDoorSalesStore.recordSale fires + N
 * scan records (via=manual, scanResult=success) per Decision #5
 * auto-check-in.
 *
 * Operator-locked decisions (SPEC §2):
 *   #1 multi-line cart  · #2 tier source = both per availableAt
 *   #3 reconciliation grain unaffected by this sheet
 *   #4 unrelated (scanner permission)
 *   #5 auto-check-in fires N scan records here.
 *
 * I-29 — door sales NEVER as phantom OrderRecord rows (this sheet writes
 * to useDoorSalesStore ONLY; CheckoutPaymentMethod door values stay door-side).
 *
 * I-30 — door tier filter: `t.visibility !== "hidden" && t.availableAt !== "online"`.
 *
 * HIDDEN-1 contract — recordSale-then-scan order: scan records are fired
 * AFTER recordSale returns the new DoorSaleRecord (so orderId resolves to
 * the persisted ds_xxx ID, never an empty string).
 *
 * [TRANSITIONAL] Card reader + NFC payment options are visible but
 * DISABLED with copy "Coming when backend ships" per Cycle 11 J-S1 banner
 * pattern. EXIT CONDITION: B-cycle wires Stripe Terminal SDK + platform NFC.
 *
 * Memory rules:
 *   - feedback_keyboard_never_blocks_input — ScrollView honors
 *     keyboardShouldPersistTaps="handled" + keyboardDismissMode="on-drag"
 *     + automaticallyAdjustKeyboardInsets (mirror Cycle 11 InviteScannerSheet).
 *   - feedback_rn_color_formats — only hex/rgb/rgba/hsl colors used.
 *
 * Per Cycle 12 SPEC §4.9 / §5/J-D3.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  useDoorSalesStore,
  type DoorPaymentMethod,
  type DoorSaleRecord,
} from "../../store/doorSalesStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import { useScanStore } from "../../store/scanStore";
import { expandDoorTickets } from "../../utils/expandDoorTickets";
import { formatGbp } from "../../utils/currency";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

// ---- Constants ------------------------------------------------------

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const PHONE_MAX = 50;
const NOTES_MAX = 500;
const MAX_QTY_PER_TIER = 99;
const PROCESSING_MS = 400;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isValidEmailOrEmpty = (s: string): boolean => {
  const t = s.trim();
  if (t.length === 0) return true;
  return t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

// ---- Cart line type (local — mirrors Cycle 8 CartLine shape) -------

interface DoorCartLine {
  ticketTypeId: string;
  ticketName: string;
  unitPriceGbp: number;
  isFree: boolean;
  quantity: number;
}

// ---- Payment method picker config ----------------------------------

interface PaymentMethodOption {
  id: DoorPaymentMethod;
  label: string;
  sub: string;
  /** Disabled today; ENABLED in B-cycle when backend ships. */
  disabled: boolean;
}

const PAYMENT_METHODS: ReadonlyArray<PaymentMethodOption> = [
  {
    id: "cash",
    label: "Cash",
    sub: "Operator collects cash at the door.",
    disabled: false,
  },
  {
    id: "card_reader",
    label: "Card reader",
    sub: "Coming when backend ships",
    disabled: true,
  },
  {
    id: "nfc",
    label: "NFC tap",
    sub: "Coming when backend ships",
    disabled: true,
  },
  {
    id: "manual",
    label: "Manual",
    sub: "Bank transfer pre-paid; comp converted to paid; etc.",
    disabled: false,
  },
];

// ---- Props ----------------------------------------------------------

export interface DoorSaleNewSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (sale: DoorSaleRecord) => void;
}

// ---- Component ------------------------------------------------------

export const DoorSaleNewSheet: React.FC<DoorSaleNewSheetProps> = ({
  visible,
  event,
  brandId,
  operatorAccountId,
  onClose,
  onSuccess,
}) => {
  const [lines, setLines] = useState<DoorCartLine[]>([]);
  const [paymentMethod, setPaymentMethod] =
    useState<DoorPaymentMethod>("cash");
  const [buyerName, setBuyerName] = useState<string>("");
  const [buyerEmail, setBuyerEmail] = useState<string>("");
  const [buyerPhone, setBuyerPhone] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset on visible flip → true
  useEffect(() => {
    if (visible) {
      setLines([]);
      setPaymentMethod("cash");
      setBuyerName("");
      setBuyerEmail("");
      setBuyerPhone("");
      setNotes("");
      setSubmitting(false);
    }
  }, [visible]);

  // I-30 tier filter: surfaces "door" + "both" tiers, hides hidden + online-only
  const pickableTiers = useMemo<TicketStub[]>(
    () =>
      event.tickets
        .filter((t) => t.visibility !== "hidden" && t.availableAt !== "online")
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [event.tickets],
  );

  const totalGbp = useMemo<number>(
    () => lines.reduce((sum, l) => sum + l.unitPriceGbp * l.quantity, 0),
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
        const unit = tier.isFree ? 0 : (tier.priceGbp ?? 0);
        if (existing === undefined) {
          return [
            ...prev,
            {
              ticketTypeId: tier.id,
              ticketName: tier.name.length > 0 ? tier.name : "Untitled tier",
              unitPriceGbp: unit,
              isFree: tier.isFree,
              quantity: safeQty,
            },
          ];
        }
        return prev.map((l) =>
          l.ticketTypeId === tier.id ? { ...l, quantity: safeQty } : l,
        );
      });
    },
    [],
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
  const emailValid = isValidEmailOrEmpty(buyerEmail);
  const phoneValid = buyerPhone.length <= PHONE_MAX;
  const notesValid = notes.length <= NOTES_MAX;
  const paymentMethodOption = PAYMENT_METHODS.find(
    (p) => p.id === paymentMethod,
  );
  const paymentMethodValid =
    paymentMethodOption !== undefined && !paymentMethodOption.disabled;

  const canSubmit =
    !submitting &&
    lines.length > 0 &&
    paymentMethodValid &&
    emailValid &&
    phoneValid &&
    notesValid;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await sleep(PROCESSING_MS);
      const newSale = useDoorSalesStore.getState().recordSale({
        eventId: event.id,
        brandId,
        recordedBy: operatorAccountId,
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim().toLowerCase(),
        buyerPhone: buyerPhone.trim(),
        paymentMethod,
        lines: lines.map((l) => ({
          ticketTypeId: l.ticketTypeId,
          ticketNameAtSale: l.ticketName,
          unitPriceGbpAtSale: l.unitPriceGbp,
          isFreeAtSale: l.isFree,
          quantity: l.quantity,
          refundedQuantity: 0,
          refundedAmountGbp: 0,
        })),
        totalGbpAtSale: totalGbp,
        currency: "GBP",
        notes: notes.trim(),
      });
      // Decision #5 + HIDDEN-1 contract — fire N scan records AFTER recordSale
      // returns the persisted DoorSaleRecord. orderId is the ds_xxx ID (NOT
      // empty string — comp scans use empty orderId by convention; door
      // scans always carry the door sale ID for cross-store joins).
      const expanded = expandDoorTickets(newSale.id, newSale.lines);
      const buyerNameForScan =
        newSale.buyerName.length > 0 ? newSale.buyerName : "Walk-up";
      expanded.forEach((t) => {
        useScanStore.getState().recordScan({
          ticketId: t.ticketId,
          orderId: newSale.id,
          eventId: newSale.eventId,
          brandId: newSale.brandId,
          scannerUserId: newSale.recordedBy,
          scanResult: "success",
          via: "manual",
          offlineQueued: true,
          buyerNameAtScan: buyerNameForScan,
          ticketNameAtScan: t.ticketName,
        });
      });
      onSuccess(newSale);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    event.id,
    brandId,
    operatorAccountId,
    buyerName,
    buyerEmail,
    buyerPhone,
    paymentMethod,
    lines,
    totalGbp,
    notes,
    onSuccess,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>New door sale</Text>
        <Text style={styles.subhead}>
          Record a sale at the door. Buyer is auto-checked-in.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {/* TESTING MODE banner (mirror Cycle 11 ORCH-0711 pattern) */}
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>TESTING MODE</Text>
            <Text style={styles.bannerBody}>
              Only Cash and Manual payments work today. Card reader and NFC
              tap-to-pay land when the backend ships in B-cycle.
            </Text>
          </View>

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
                const priceLabel = tier.isFree
                  ? "Free"
                  : tier.priceGbp !== null
                    ? formatGbp(tier.priceGbp)
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
                  {formatGbp(totalGbp)}
                </Text>
              </View>
            </View>
          ) : null}

          {/* ───── Step 2: Payment method ───── */}
          <Text style={styles.sectionHeader}>2. Payment method</Text>
          <View style={styles.paymentList}>
            {PAYMENT_METHODS.map((opt) => {
              const active = paymentMethod === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    if (opt.disabled || submitting) return;
                    setPaymentMethod(opt.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: active,
                    disabled: opt.disabled,
                  }}
                  accessibilityLabel={opt.label}
                  disabled={opt.disabled || submitting}
                  style={[
                    styles.paymentRow,
                    active && !opt.disabled && styles.paymentRowActive,
                    opt.disabled && styles.paymentRowDisabled,
                  ]}
                >
                  <View style={styles.paymentCol}>
                    <Text
                      style={[
                        styles.paymentLabel,
                        opt.disabled && styles.paymentLabelDisabled,
                      ]}
                    >
                      {opt.label}
                    </Text>
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
                      active && !opt.disabled && styles.radioOuterActive,
                      opt.disabled && styles.radioOuterDisabled,
                    ]}
                  >
                    {active && !opt.disabled ? (
                      <View style={styles.radioInner} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* ───── Step 3: Buyer details (optional) ───── */}
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
            <Text style={styles.label}>Phone</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={buyerPhone}
                onChangeText={setBuyerPhone}
                placeholder="optional"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="phone-pad"
                maxLength={PHONE_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Buyer phone"
              />
            </View>
          </View>

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
        </ScrollView>

        {/* Sticky bottom bar — total + Record sale CTA */}
        <View style={styles.dock}>
          <View style={styles.dockTotalRow}>
            <Text style={styles.dockTotalLabel}>Total</Text>
            <Text style={styles.dockTotalValue}>{formatGbp(totalGbp)}</Text>
          </View>
          <Button
            label={submitting ? "Recording..." : "Record sale"}
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Record door sale"
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

  // Banner ------------------------------------------------------------
  banner: {
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.30)",
    marginBottom: spacing.md,
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
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

  // Section header reuses (deprecated)
  field: {},
});

// ---- Default export -------------------------------------------------

export default DoorSaleNewSheet;
