/**
 * Issue #1792 (#1767 Phase 3b) — WAITER MODE: the order pad (DESIGN D-11).
 *
 * New order -> pick the spot -> build from the same menu with the same modifier
 * groups a guest would see -> send to kitchen. Then settle, or leave it on a tab.
 *
 * ONE SHEET, FOUR STEPS. Every step renders INSIDE this sheet's own body — the
 * modifier picker, the cart, the settlement choice. Nothing here opens a second
 * modal over the first: a sub-sheet that is not a child of its parent is the
 * shipped failure this codebase already paid for, and at a busy pass a stack of
 * overlays is also just slower than a page that changes.
 *
 * WHAT THIS SURFACE DELIBERATELY DOES NOT DO:
 *  1. It does not add anything up. Line prices are menu FACTS read off a column;
 *     the TOTAL is a server round-trip (`mode: "preview"`), and until one lands
 *     the pad shows a dash rather than a number it invented (P-20).
 *  2. It does not keep its own table list. The spots are the `qr_spots` rows the
 *     printed codes come from, so a waiter's "Table 12" and the laminate on
 *     table 12 are the same row and cannot drift.
 *  3. It does not tell the kitchen who took the order. The ticket enters the
 *     same queue, on the same card, in the same view as a scanned one.
 *  4. It does not half-build charge-to-room. It is listed, disabled, and says
 *     why.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// ORCH-0892-B v2 sheet-consumer contract: the Sheet primitive owns NO keyboard
// logic, so a consumer with TextInputs routes its OWN body scroll through this
// wrapper (KeyboardAwareScrollView on native, plain ScrollView on web). The pad
// has five of them — the spot search, the menu search, the kitchen note, and
// the three bill fields — and the control that SENDS the order sits under all
// of them. One outer scroll, never a nested same-axis one.
import { ScrollView } from "../../../wrappers/SmartScrollView";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { formatCurrency } from "../../../utils/currency";
import {
  useCreateStaffOrder,
  useOrderPadMenu,
  usePreviewStaffOrder,
  useSettleStaffOrder,
} from "../../../hooks/useVenueOrderPad";
import { useCloseVenueTab, useOpenVenueTab } from "../../../hooks/useVenueOrderTabs";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import {
  ORDER_PAD_MAX_NOTE_CHARS,
  ORDER_PAD_SETTLEMENT_OPTIONS,
  addLineToCart,
  billContactReadiness,
  cartItemCount,
  filterMenuSections,
  filterSpotGroups,
  orderableSpotGroups,
  nextModifierPrompt,
  orderPadReadiness,
  orderPadSubmitLines,
  orderableMenuSections,
  setLineQuantity,
  settlementMethodIsSendable,
  toggleModifier,
  type OrderPadLine,
  type OrderPadMenuItem,
  type OrderPadSettlementMethod,
  type OrderPadSpot,
  type OrderPadTab,
  tabRoundsLabel,
  type OrderPadVenueRef,
} from "./venueOrderPad";

type PadStep = "where" | "build" | "sent";

export interface VenueOrderPadSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  /** The venue the pad was opened from — the default filter, not a cage. */
  venueId: string | null;
  spots: readonly OrderPadSpot[];
  venues: readonly OrderPadVenueRef[];
  /** Adding a round to an open tab: skips "where" and reuses its sitting. */
  resumeTab?: OrderPadTab | null;
  /**
   * Billing a whole tab to the guest's phone. The tab card sends it HERE rather
   * than collecting the contact triple on the card itself: the card lives in the
   * venue hub's plain ScrollView, which does not lift a focused field above the
   * keyboard, and the field a waiter is typing into must never be the one the
   * keyboard is covering.
   */
  billTab?: OrderPadTab | null;
  /** event_manager+ — a tab is credit, and credit is a manager's call. */
  canOpenTabs: boolean;
  testID?: string;
}

export function VenueOrderPadSheet({
  visible,
  onClose,
  brandId,
  venueId,
  spots,
  venues,
  resumeTab = null,
  billTab = null,
  canOpenTabs,
  testID,
}: VenueOrderPadSheetProps): React.ReactElement {
  const resumingTab = resumeTab !== null;
  const billingTab = billTab !== null;
  const [step, setStep] = useState<PadStep>(resumingTab ? "build" : "where");
  const [spotId, setSpotId] = useState<string | null>(resumeTab?.qrSpotId ?? null);
  const [counterPickup, setCounterPickup] = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [spotQuery, setSpotQuery] = useState("");
  const [menuQuery, setMenuQuery] = useState("");
  const [lines, setLines] = useState<OrderPadLine[]>([]);
  const [openItem, setOpenItem] = useState<OrderPadMenuItem | null>(null);
  const [openModifierIds, setOpenModifierIds] = useState<string[]>([]);
  const [openNote, setOpenNote] = useState("");
  const [sentOrderId, setSentOrderId] = useState<string | null>(null);
  const [sentPickupCode, setSentPickupCode] = useState<string | null>(null);
  const [sentSessionId, setSentSessionId] = useState<string | null>(null);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [billContactOpen, setBillContactOpen] = useState(false);
  const [billName, setBillName] = useState("");
  const [billEmail, setBillEmail] = useState("");
  const [billPhone, setBillPhone] = useState("");
  const billContact = billContactReadiness({
    name: billName,
    email: billEmail,
    phone: billPhone,
  });
  // ONE key per SEND gesture. Re-minted only when the pad is reset, so a retry
  // after a dropped response resolves to the ticket that already exists.
  const [submitKey, setSubmitKey] = useState<string>(() => newSubmitKey());

  const spotById = useMemo(
    () => new Map(spots.map((s) => [s.id, s])),
    [spots],
  );
  const selectedSpot = spotId === null ? null : (spotById.get(spotId) ?? null);
  // D-3b — the menu comes from the SERVING venue, which for Room 204 is the
  // Brasserie, not the hotel. With no spot (counter pickup) it is the venue the
  // pad was opened from.
  const servingVenueId = selectedSpot?.servingVenueId ?? venueId;

  const menuQueryResult = useOrderPadMenu(brandId, servingVenueId);
  const preview = usePreviewStaffOrder();
  const createOrder = useCreateStaffOrder(brandId);
  const settle = useSettleStaffOrder(brandId);
  const openTab = useOpenVenueTab(brandId);
  const closeTab = useCloseVenueTab(brandId);

  const spotGroups = useMemo(
    () => filterSpotGroups(orderableSpotGroups(spots, venues), spotQuery),
    [spots, venues, spotQuery],
  );
  const sections = useMemo(
    () =>
      filterMenuSections(
        orderableMenuSections(menuQueryResult.data?.items ?? []),
        menuQuery,
      ),
    [menuQueryResult.data, menuQuery],
  );
  const groupsByItemId = useMemo(
    () => menuQueryResult.data?.groupsByItemId ?? {},
    [menuQueryResult.data],
  );
  const openGroups = useMemo(
    () => (openItem === null ? [] : (groupsByItemId[openItem.id] ?? [])),
    [openItem, groupsByItemId],
  );
  const openPrompt = nextModifierPrompt(openGroups, openModifierIds);

  const readiness = orderPadReadiness({
    spotId,
    counterPickup,
    buyerName,
    lines,
  });

  // THE RUNNING TOTAL. Asked for on every cart change, never computed here. A
  // failed preview leaves the last good number on screen rather than a guess.
  const previewMutate = preview.mutate;
  const submitLines = useMemo(() => orderPadSubmitLines(lines), [lines]);
  const spotCode = selectedSpot?.code ?? null;
  useEffect(() => {
    if (!visible || step !== "build" || submitLines.length === 0) return;
    if (spotCode === null && servingVenueId === null) return;
    previewMutate({
      spotCode,
      venueId: spotCode === null ? servingVenueId : null,
      lines: submitLines,
    });
  }, [visible, step, submitLines, spotCode, servingVenueId, previewMutate]);

  const reset = useCallback((): void => {
    setStep(resumingTab ? "build" : "where");
    setSpotId(resumeTab?.qrSpotId ?? null);
    setCounterPickup(false);
    setBuyerName("");
    setSpotQuery("");
    setMenuQuery("");
    setLines([]);
    setOpenItem(null);
    setOpenModifierIds([]);
    setOpenNote("");
    setSentOrderId(null);
    setSentPickupCode(null);
    setSentSessionId(null);
    setPayLink(null);
    setBillContactOpen(false);
    setBillName("");
    setBillEmail("");
    setBillPhone("");
    setSubmitKey(newSubmitKey());
  }, [resumeTab, resumingTab]);

  const handleClose = useCallback((): void => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleAddOpenItem = useCallback((): void => {
    if (openItem === null || openItem.priceCents === null) return;
    if (openPrompt !== null) return;
    const chosen = openGroups
      .flatMap((g) => g.modifiers)
      .filter((m) => openModifierIds.includes(m.id));
    setLines((current) =>
      addLineToCart(current, {
        menuItemId: openItem.id,
        name: openItem.name,
        unitPriceCents: openItem.priceCents ?? 0,
        currency: openItem.currency,
        quantity: 1,
        modifierIds: chosen.map((m) => m.id),
        modifierNames: chosen.map((m) => m.name),
        notes: openNote.trim().length > 0 ? openNote : null,
      })
    );
    setOpenItem(null);
    setOpenModifierIds([]);
    setOpenNote("");
  }, [openItem, openGroups, openModifierIds, openNote, openPrompt]);

  const handleTapItem = useCallback(
    (item: OrderPadMenuItem): void => {
      const groups = groupsByItemId[item.id] ?? [];
      const needsChoice = groups.some((g) => g.isActive && g.minSelect > 0) ||
        groups.some((g) => g.isActive && g.modifiers.length > 0) ||
        item.allowsNotes;
      if (!needsChoice) {
        setLines((current) =>
          addLineToCart(current, {
            menuItemId: item.id,
            name: item.name,
            unitPriceCents: item.priceCents ?? 0,
            currency: item.currency,
            quantity: 1,
            modifierIds: [],
            modifierNames: [],
            notes: null,
          })
        );
        return;
      }
      setOpenItem(item);
      setOpenModifierIds([]);
      setOpenNote("");
    },
    [groupsByItemId],
  );

  const handleSend = useCallback((): void => {
    if (!readiness.ready) return;
    createOrder.mutate(
      {
        spotCode,
        venueId: spotCode === null ? servingVenueId : null,
        sessionId: resumeTab?.sessionId ?? null,
        buyerName: counterPickup ? buyerName.trim() : null,
        lines: submitLines,
        idempotencyKey: submitKey,
      },
      {
        onSuccess: (created) => {
          setSentOrderId(created.orderId);
          setSentPickupCode(created.pickupCode);
          setSentSessionId(created.sessionId);
          setStep("sent");
        },
      },
    );
  }, [
    readiness.ready,
    createOrder,
    spotCode,
    servingVenueId,
    resumeTab,
    counterPickup,
    buyerName,
    submitLines,
    submitKey,
  ]);

  const handleSettle = useCallback(
    (method: OrderPadSettlementMethod): void => {
      if (sentOrderId === null) return;
      if (!settlementMethodIsSendable(method)) return;
      if (method === "bill_to_phone") {
        // The rail cannot mark a Mingla order paid without the contact triple
        // (`venue_orders_paid_needs_contact`), and the guest needs a receipt and
        // a status card anyway. So the pad asks, inline, rather than sending a
        // bill that would bounce at the database.
        setBillContactOpen(true);
        return;
      }
      settle.mutate(
        { orderId: sentOrderId, method },
        { onSuccess: () => handleClose() },
      );
    },
    [sentOrderId, settle, handleClose],
  );

  const handleSendBill = useCallback((): void => {
    if (sentOrderId === null || !billContact.ready) return;
    settle.mutate(
      {
        orderId: sentOrderId,
        method: "bill_to_phone",
        buyer: {
          name: billName.trim(),
          email: billEmail.trim(),
          phone: billPhone.trim(),
        },
      },
      {
        onSuccess: (result) => {
          if (result.authorizationUrl !== null) {
            setPayLink(result.authorizationUrl);
            return;
          }
          // A Stripe PaymentIntent comes back without a URL: the guest completes
          // it on their own device from the status link, and the pad says the
          // bill has gone rather than pretending there is something to hand over.
          setPayLink("");
        },
      },
    );
  }, [sentOrderId, billContact.ready, billName, billEmail, billPhone, settle]);

  const handleSendTabBill = useCallback((): void => {
    if (billTab === null || !billContact.ready) return;
    closeTab.mutate(
      {
        sessionId: billTab.sessionId,
        method: "bill_to_phone",
        buyer: {
          name: billName.trim(),
          email: billEmail.trim(),
          phone: billPhone.trim(),
        },
      },
      { onSuccess: (result) => setPayLink(result.authorizationUrl ?? "") },
    );
  }, [billTab, billContact.ready, billName, billEmail, billPhone, closeTab]);

  const handleStartTab = useCallback((): void => {
    if (sentSessionId === null) return;
    openTab.mutate({ sessionId: sentSessionId }, { onSuccess: handleClose });
  }, [sentSessionId, openTab, handleClose]);

  const totalCents = preview.data?.totalCents ?? null;
  const previewCurrency = preview.data?.currency ?? lines[0]?.currency ?? "GBP";

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      snapPoint={0.92}
      testID={testID ?? "venue-order-pad-sheet"}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="venue-order-pad-scroll"
      >
        <Text style={styles.title}>
          {billingTab
            ? `The bill · ${billTab?.spotLabel ?? "this tab"}`
            : step === "sent"
            ? "Sent to the kitchen"
            : resumingTab
            ? `Another round · ${resumeTab?.spotLabel ?? "this tab"}`
            : "New order"}
        </Text>

        {/* ---------------- CLOSE A TAB, BILLED TO THE PHONE ---------------- */}
        {billingTab && billTab !== null ? (
          <View style={styles.stepWrap} testID="venue-order-pad-step-bill-tab">
            {payLink !== null ? (
              <View style={styles.payBlock} testID="venue-order-pad-tab-pay-link">
                <Text style={styles.payTitle}>The bill has gone</Text>
                <Text style={styles.payBody}>
                  {payLink.length > 0
                    ? "Hand them this link and they pay on their own phone. The tab closes when it lands."
                    : "They pay on their own phone. The tab closes when it lands."}
                </Text>
                {payLink.length > 0 ? (
                  <Text selectable style={styles.payLink}>
                    {payLink}
                  </Text>
                ) : null}
                <Button
                  label="Done"
                  onPress={handleClose}
                  variant="primary"
                  size="md"
                  fullWidth
                  testID="venue-order-pad-tab-pay-done"
                />
              </View>
            ) : (
              <>
                <View style={styles.moneyRow}>
                  <Text style={styles.moneyLabel}>
                    {tabRoundsLabel(billTab)}
                  </Text>
                  <Text style={styles.moneyValue} testID="venue-order-pad-tab-total">
                    {formatCurrency(
                      billTab.outstandingTotalCents,
                      billTab.currency,
                      true,
                    )}
                  </Text>
                </View>
                {billTab.outstandingTipCents > 0 ? (
                  <Text style={styles.helper}>
                    Includes{" "}
                    {formatCurrency(
                      billTab.outstandingTipCents,
                      billTab.currency,
                      true,
                    )}{" "}
                    tip — yours, untouched.
                  </Text>
                ) : null}
                <Text style={styles.helper}>
                  Where should it go? They&apos;ll get a receipt and a live
                  status too.
                </Text>
                <TextInput
                  value={billName}
                  onChangeText={setBillName}
                  placeholder="Name"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  accessibilityLabel="Guest's name"
                  testID="venue-order-pad-tab-bill-name"
                />
                <TextInput
                  value={billEmail}
                  onChangeText={setBillEmail}
                  placeholder="Email"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  accessibilityLabel="Guest's email"
                  testID="venue-order-pad-tab-bill-email"
                />
                <TextInput
                  value={billPhone}
                  onChangeText={setBillPhone}
                  placeholder="Phone"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  keyboardType="phone-pad"
                  accessibilityLabel="Guest's phone number"
                  testID="venue-order-pad-tab-bill-phone"
                />
                {billContact.blocker !== null ? (
                  <Text style={styles.blocker}>{billContact.blocker}</Text>
                ) : null}
                {closeTab.isError ? (
                  <Text style={styles.blocker} testID="venue-order-pad-tab-bill-error">
                    That didn&apos;t go through. Nothing has been charged — try it
                    again.
                  </Text>
                ) : null}
                <Button
                  label="Send the bill"
                  onPress={handleSendTabBill}
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={!billContact.ready}
                  loading={closeTab.isPending}
                  testID="venue-order-pad-tab-bill-send"
                />
              </>
            )}
          </View>
        ) : null}

        {/* ---------------- STEP 1 — WHERE IS IT GOING? ---------------- */}
        {!billingTab && step === "where" ? (
          <View style={styles.stepWrap} testID="venue-order-pad-step-where">
            <Text style={styles.helper}>
              The same codes you printed. Pick where the food is going.
            </Text>
            <TextInput
              value={spotQuery}
              onChangeText={setSpotQuery}
              placeholder="Find a table or room"
              placeholderTextColor={textTokens.quaternary}
              style={styles.input}
              accessibilityLabel="Find a table or room"
              testID="venue-order-pad-spot-search"
            />
            <View style={styles.pane}>
              {spotGroups.length === 0 ? (
                <Text style={styles.helper}>
                  No spots yet. Add tables or rooms and we&apos;ll print their
                  codes.
                </Text>
              ) : null}
              {spotGroups.map((group) => (
                <View key={group.venueId} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.venueName}</Text>
                  <View style={styles.chipWrap}>
                    {group.spots.map((spot) => (
                      <Pressable
                        key={spot.id}
                        onPress={() => {
                          setSpotId(spot.id);
                          setCounterPickup(false);
                          setStep("build");
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Order for ${spot.label}`}
                        style={[
                          styles.chip,
                          spotId === spot.id ? styles.chipActive : null,
                        ]}
                        testID={`venue-order-pad-spot-${spot.id}`}
                      >
                        <Text style={styles.chipLabel}>{spot.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
              {/* D-3a — no spot is a first-class honest state, never a guess. */}
              <Pressable
                onPress={() => {
                  setSpotId(null);
                  setCounterPickup(true);
                  setStep("build");
                }}
                accessibilityRole="button"
                accessibilityLabel="No table, collecting at the counter"
                style={[
                  styles.counterRow,
                  counterPickup ? styles.chipActive : null,
                ]}
                testID="venue-order-pad-counter-pickup"
              >
                <Text style={styles.counterTitle}>
                  No table — collecting at the counter
                </Text>
                <Text style={styles.counterBody}>
                  We&apos;ll give it a number and put the guest&apos;s name on the
                  ticket.
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* ---------------- STEP 2 — BUILD IT ---------------- */}
        {!billingTab && step === "build" ? (
          <View style={styles.stepWrap} testID="venue-order-pad-step-build">
            <View style={styles.destinationRow}>
              <Text style={styles.destination}>
                {counterPickup
                  ? "Counter pickup"
                  : (selectedSpot?.label ?? resumeTab?.spotLabel ?? "No table")}
              </Text>
              {!resumingTab ? (
                <Pressable
                  onPress={() => setStep("where")}
                  accessibilityRole="button"
                  accessibilityLabel="Change where this order is going"
                  style={styles.linkBtn}
                  testID="venue-order-pad-change-spot"
                >
                  <Text style={styles.linkLabel}>Change</Text>
                </Pressable>
              ) : null}
            </View>

            {counterPickup ? (
              <TextInput
                value={buyerName}
                onChangeText={setBuyerName}
                placeholder="Guest's name"
                placeholderTextColor={textTokens.quaternary}
                style={styles.input}
                accessibilityLabel="Guest's name for the collection"
                testID="venue-order-pad-buyer-name"
              />
            ) : null}

            {/* The modifier panel renders INSIDE this sheet, replacing the menu
                list — never as a second overlay. */}
            {openItem !== null ? (
              <View style={styles.optionPane} testID="venue-order-pad-options">
                <Text style={styles.optionTitle}>{openItem.name}</Text>
                <View style={styles.pane}>
                  {openGroups
                    .filter((g) => g.isActive)
                    .map((group) => (
                      <View key={group.id} style={styles.group}>
                        <Text style={styles.groupTitle}>
                          {group.name}
                          {group.minSelect > 0 ? " · required" : ""}
                        </Text>
                        <View style={styles.chipWrap}>
                          {group.modifiers.map((modifier) => {
                            const chosen = openModifierIds.includes(modifier.id);
                            return (
                              <Pressable
                                key={modifier.id}
                                onPress={() =>
                                  setOpenModifierIds((current) =>
                                    toggleModifier(group, current, modifier.id)
                                  )}
                                disabled={!modifier.isAvailable}
                                accessibilityRole="button"
                                accessibilityState={{ selected: chosen }}
                                accessibilityLabel={modifier.name}
                                style={[
                                  styles.chip,
                                  chosen ? styles.chipActive : null,
                                  !modifier.isAvailable ? styles.chipOff : null,
                                ]}
                                testID={`venue-order-pad-modifier-${modifier.id}`}
                              >
                                <Text style={styles.chipLabel}>
                                  {modifier.name}
                                  {modifier.priceDeltaCents !== 0
                                    ? ` · ${
                                      formatCurrency(
                                        modifier.priceDeltaCents,
                                        modifier.currency,
                                        true,
                                      )
                                    }`
                                    : ""}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  {openItem.allowsNotes ? (
                    <TextInput
                      value={openNote}
                      onChangeText={setOpenNote}
                      placeholder="Anything for the kitchen?"
                      placeholderTextColor={textTokens.quaternary}
                      style={styles.input}
                      maxLength={ORDER_PAD_MAX_NOTE_CHARS}
                      accessibilityLabel="Note for the kitchen"
                      testID="venue-order-pad-note"
                    />
                  ) : null}
                </View>
                <View style={styles.optionActions}>
                  <Pressable
                    onPress={() => setOpenItem(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Back to the menu"
                    style={styles.linkBtn}
                    testID="venue-order-pad-options-back"
                  >
                    <Text style={styles.linkLabel}>Back</Text>
                  </Pressable>
                  <Button
                    label={openPrompt ?? "Add to the order"}
                    onPress={handleAddOpenItem}
                    variant="primary"
                    size="md"
                    disabled={openPrompt !== null}
                    testID="venue-order-pad-options-add"
                  />
                </View>
              </View>
            ) : (
              <>
                <TextInput
                  value={menuQuery}
                  onChangeText={setMenuQuery}
                  placeholder="Find something on the menu"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  accessibilityLabel="Find something on the menu"
                  testID="venue-order-pad-menu-search"
                />
                <View style={styles.pane}>
                  {menuQueryResult.isLoading ? (
                    <ActivityIndicator />
                  ) : sections.length === 0 ? (
                    <Text style={styles.helper}>
                      Nothing orderable on this menu right now.
                    </Text>
                  ) : null}
                  {sections.map((section) => (
                    <View key={section.menuId} style={styles.group}>
                      <Text style={styles.groupTitle}>{section.menuName}</Text>
                      {section.items.map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => handleTapItem(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${item.name}`}
                          style={styles.itemRow}
                          testID={`venue-order-pad-item-${item.id}`}
                        >
                          <Text style={styles.itemName}>{item.name}</Text>
                          <Text style={styles.itemPrice}>
                            {formatCurrency(
                              item.priceCents ?? 0,
                              item.currency,
                              true,
                            )}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* The docket, and the ONE number that came from the server. */}
            <View style={styles.cart} testID="venue-order-pad-cart">
              {lines.map((line) => (
                <View key={line.key} style={styles.cartLine}>
                  <Text style={styles.cartQty}>{line.quantity}×</Text>
                  <View style={styles.cartText}>
                    <Text style={styles.cartName}>{line.name}</Text>
                    {line.modifierNames.length > 0 ? (
                      <Text style={styles.cartMods}>
                        {line.modifierNames.join(" · ")}
                      </Text>
                    ) : null}
                    {line.notes !== null ? (
                      <Text style={styles.cartNote}>“{line.notes}”</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() =>
                      setLines((current) =>
                        setLineQuantity(current, line.key, line.quantity - 1)
                      )}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove one ${line.name}`}
                    style={styles.stepBtn}
                    testID={`venue-order-pad-line-minus-${line.menuItemId}`}
                  >
                    <Text style={styles.stepLabel}>−</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setLines((current) =>
                        setLineQuantity(current, line.key, line.quantity + 1)
                      )}
                    accessibilityRole="button"
                    accessibilityLabel={`Add one more ${line.name}`}
                    style={styles.stepBtn}
                    testID={`venue-order-pad-line-plus-${line.menuItemId}`}
                  >
                    <Text style={styles.stepLabel}>+</Text>
                  </Pressable>
                </View>
              ))}
              {preview.data !== undefined && preview.data.serviceChargeCents > 0
                ? (
                  // D-9 — the venue's own charge is ALWAYS its own visible line,
                  // under the venue's own label. Never folded into a total.
                  <View style={styles.moneyRow}>
                    <Text style={styles.moneyLabel}>
                      {preview.data.serviceChargeLabel}
                    </Text>
                    <Text style={styles.moneyValue}>
                      {formatCurrency(
                        preview.data.serviceChargeCents,
                        previewCurrency,
                        true,
                      )}
                    </Text>
                  </View>
                )
                : null}
              <View style={styles.moneyRow}>
                <Text style={styles.moneyLabel}>
                  {cartItemCount(lines)} item{cartItemCount(lines) === 1 ? "" : "s"}
                </Text>
                <Text style={styles.moneyValue} testID="venue-order-pad-total">
                  {totalCents === null || preview.isPending
                    ? "—"
                    : formatCurrency(totalCents, previewCurrency, true)}
                </Text>
              </View>
              {readiness.blocker !== null ? (
                <Text style={styles.blocker} testID="venue-order-pad-blocker">
                  {readiness.blocker}
                </Text>
              ) : null}
              {createOrder.isError ? (
                <Text style={styles.blocker} testID="venue-order-pad-send-error">
                  That didn&apos;t send. Nothing has reached the kitchen — try it
                  again.
                </Text>
              ) : null}
              <Button
                label="Send to kitchen"
                onPress={handleSend}
                variant="primary"
                size="lg"
                fullWidth
                disabled={!readiness.ready}
                loading={createOrder.isPending}
                testID="venue-order-pad-send"
              />
            </View>
          </View>
        ) : null}

        {/* ---------------- STEP 3 — SETTLE (D-11) ---------------- */}
        {!billingTab && step === "sent" ? (
          <View style={styles.stepWrap} testID="venue-order-pad-step-sent">
            <Text style={styles.helper}>
              {sentPickupCode !== null
                ? `It's on. Collection number ${sentPickupCode}.`
                : "It's on. How is this one being paid for?"}
            </Text>

            {payLink !== null ? (
              <View style={styles.payBlock} testID="venue-order-pad-pay-link">
                <Text style={styles.payTitle}>The bill has gone</Text>
                <Text style={styles.payBody}>
                  {payLink.length > 0
                    ? "Hand them this link and they pay on their own phone."
                    : "They pay on their own phone. You'll see it land on the order."}
                </Text>
                {payLink.length > 0 ? (
                  <Text selectable style={styles.payLink}>
                    {payLink}
                  </Text>
                ) : null}
                <Button
                  label="Done"
                  onPress={handleClose}
                  variant="primary"
                  size="md"
                  fullWidth
                  testID="venue-order-pad-pay-done"
                />
              </View>
            ) : billContactOpen ? (
              <View style={styles.stepWrap} testID="venue-order-pad-bill-contact">
                <Text style={styles.helper}>
                  Where should the bill go? They&apos;ll get a receipt and a live
                  status for the order too.
                </Text>
                <TextInput
                  value={billName}
                  onChangeText={setBillName}
                  placeholder="Name"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  accessibilityLabel="Guest's name"
                  testID="venue-order-pad-bill-name"
                />
                <TextInput
                  value={billEmail}
                  onChangeText={setBillEmail}
                  placeholder="Email"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  accessibilityLabel="Guest's email"
                  testID="venue-order-pad-bill-email"
                />
                <TextInput
                  value={billPhone}
                  onChangeText={setBillPhone}
                  placeholder="Phone"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.input}
                  keyboardType="phone-pad"
                  accessibilityLabel="Guest's phone number"
                  testID="venue-order-pad-bill-phone"
                />
                {billContact.blocker !== null ? (
                  <Text style={styles.blocker} testID="venue-order-pad-bill-blocker">
                    {billContact.blocker}
                  </Text>
                ) : null}
                {settle.isError ? (
                  <Text style={styles.blocker} testID="venue-order-pad-bill-error">
                    That didn&apos;t go through. Nothing has been charged — try it
                    again.
                  </Text>
                ) : null}
                <Button
                  label="Send the bill"
                  onPress={handleSendBill}
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={!billContact.ready}
                  loading={settle.isPending}
                  testID="venue-order-pad-bill-send"
                />
                <Pressable
                  onPress={() => setBillContactOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to the payment options"
                  style={styles.linkBtn}
                  testID="venue-order-pad-bill-back"
                >
                  <Text style={styles.linkLabel}>Back</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {ORDER_PAD_SETTLEMENT_OPTIONS.map((option) => (
                  <Pressable
                    key={option.method}
                    onPress={() => handleSettle(option.method)}
                    disabled={!option.available || settle.isPending}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !option.available }}
                    accessibilityLabel={option.label}
                    style={[
                      styles.settleRow,
                      !option.available ? styles.settleRowOff : null,
                    ]}
                    testID={`venue-order-pad-settle-${option.method}`}
                  >
                    <Text style={styles.settleTitle}>{option.label}</Text>
                    <Text style={styles.settleBody}>{option.body}</Text>
                    {option.unavailableReason !== null ? (
                      <Text style={styles.settleOffNote}>
                        {option.unavailableReason}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}

                {/* D-2 AMENDED — a waiter may open a tab and keep serving. */}
                {canOpenTabs && !resumingTab ? (
                  <Pressable
                    onPress={handleStartTab}
                    disabled={openTab.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Start a tab on this table"
                    style={styles.settleRow}
                    testID="venue-order-pad-start-tab"
                  >
                    <Text style={styles.settleTitle}>Start a tab</Text>
                    <Text style={styles.settleBody}>
                      Keep adding rounds and settle the lot at the end. Same as
                      your paper docket — your call, your table.
                    </Text>
                  </Pressable>
                ) : null}

                {resumingTab ? (
                  <Pressable
                    onPress={handleClose}
                    accessibilityRole="button"
                    accessibilityLabel="Leave it on the tab"
                    style={styles.settleRow}
                    testID="venue-order-pad-keep-on-tab"
                  >
                    <Text style={styles.settleTitle}>Leave it on the tab</Text>
                    <Text style={styles.settleBody}>
                      This round joins the rest. Settle the whole tab when they
                      go.
                    </Text>
                  </Pressable>
                ) : null}

                {settle.isError ? (
                  <Text style={styles.blocker} testID="venue-order-pad-settle-error">
                    That didn&apos;t go through. Nothing has been charged — try it
                    again.
                  </Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/**
 * One key per SEND gesture. `crypto.randomUUID` is not present on every RN
 * runtime this app boots on, so the fallback is a real one rather than a
 * throw — a pad that cannot mint a key is a pad that cannot take an order.
 */
function newSubmitKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID !== undefined) return `pad:${c.randomUUID()}`;
  return `pad:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
  },
  stepWrap: {
    gap: spacing.sm,
  },
  helper: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  input: {
    ...typography.body,
    color: textTokens.primary,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // A plain View, deliberately: this used to be a second ScrollView, and two
  // same-axis scrollables inside one sheet compete for the gesture. The ONE
  // scroll is the SmartScrollView above, which is also what lifts a focused
  // field above the keyboard.
  pane: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  group: {
    gap: spacing.xs,
  },
  groupTitle: {
    ...typography.caption,
    color: textTokens.tertiary,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  chipOff: {
    opacity: 0.4,
  },
  chipLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  counterRow: {
    gap: spacing.xxs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    minHeight: 44,
  },
  counterTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  counterBody: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  destination: {
    ...typography.h3,
    color: textTokens.primary,
    flex: 1,
  },
  linkBtn: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  linkLabel: {
    ...typography.bodySm,
    color: accent.warm,
    fontWeight: "700",
  },
  optionPane: {
    gap: spacing.sm,
  },
  optionTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  optionActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
  itemName: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
  },
  itemPrice: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  cart: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
  cartLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cartQty: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
    minWidth: 28,
  },
  cartText: {
    flex: 1,
    gap: spacing.xxs,
  },
  cartName: {
    ...typography.body,
    color: textTokens.primary,
  },
  cartMods: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  cartNote: {
    ...typography.caption,
    color: accent.warm,
  },
  stepBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  stepLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  moneyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moneyLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  moneyValue: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  blocker: {
    ...typography.bodySm,
    color: semantic.warning,
  },
  settleRow: {
    gap: spacing.xxs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    minHeight: 44,
  },
  settleRowOff: {
    opacity: 0.45,
  },
  settleTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  settleBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  settleOffNote: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  payBlock: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  payTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  payBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  payLink: {
    ...typography.caption,
    color: accent.warm,
  },
});

export default VenueOrderPadSheet;
