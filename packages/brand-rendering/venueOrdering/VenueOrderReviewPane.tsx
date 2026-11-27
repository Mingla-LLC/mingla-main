// ===========================================================================
// Issue #1793 — the review step: what the guest is about to pay, and to whom.
//
// SET-B (SPEC #1788 P-61): may sell, may never touch money. THIS IS THE FILE
// THAT RULE EXISTS FOR, so it is worth being exact about what it does.
//
// It renders FOUR money lines and a total, and it computes NONE of them:
//
//     Items                       preview.subtotalCents
//     {venue's own label}         preview.serviceChargeCents      (D-9 / P-19)
//     Fees & tax                  preview.feesAndTaxCents
//     Tip                         preview.tipCents                (D-2 / P-18)
//     ─────────────────────────────────────────────────────────
//     Total                       preview.totalCents
//
// Every one of those five integers arrives from `venue-order-create`, which
// priced the basket from server-read menu rows. This file does not add them up
// to check, does not derive one from the others, and does not hold a fallback
// for when they are missing. WHEN THERE IS NO SERVER PRICE THERE IS NO TOTAL ON
// SCREEN AND NO WAY TO PAY — a made-up number next to a Pay button is the one
// failure this surface must never have.
//
// The service charge is the VENUE's revenue and is its own labelled line, using
// the venue's own words, never folded into "Fees & tax" (which stays Mingla's).
// The tip is NOT inside the fee basis: Mingla takes nothing from it, by the
// arithmetic the server does, and this surface shows it as its own line so the
// guest can see exactly that. (I-PROPOSED-1767-EVERY-CHARGE-IS-VISIBLE.)
// ===========================================================================

// The package-local React bridge (see PublicVenueTabs.tsx): files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would emit unresolved-peer diagnostics in both apps'
// isolated typecheck sandboxes. One bridge, reused by every shared renderer.
import { BrandRenderingReact as React } from "../PublicVenueTabs";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import type {
  offeringSurfaceStyles,
  ThemePalette,
} from "@mingla/offering-rendering";
import { type DiscountCodeReason } from "@mingla/offering-rendering/discountQuote";
import { venueCodeLimitedNotices } from "@mingla/offering-rendering/venueCodeLimitedCopy";

import { formatMenuPrice } from "../PublicMenuSections";
import type {
  VenueOrderBuyerDraft,
  VenueOrderPhoneFieldArgs,
  VenueOrderCartLine,
  VenueOrderingConfig,
  VenueOrderPreview,
  VenueOrderTipChoice,
} from "./venueOrderingTypes";

const DiscountReasonText = React.lazy(() =>
  import("@mingla/offering-rendering/DiscountReasonText").then((module) => ({
    default: module.DiscountReasonText,
  })),
);
import {
  VENUE_ORDER_PARTY_SIZE_HELP,
  VENUE_ORDER_PARTY_SIZE_MAX,
  VENUE_ORDER_PARTY_SIZE_PROMPT,
  venueOrderBuyerFailure,
  venueOrderHandoverChip,
  venueOrderLineRenderKeys,
  venueOrderTipPresets,
  venueOrderingFulfilmentLine,
  venueOrderingIsCounterPickup,
  venueOrderingOffersPickup,
  venueOrderingReviewConfig,
} from "./venueOrderingRules";
import { accentEdgeOnFill, accentFill } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingStepper } from "@mingla/offering-rendering/OfferingDecideParts";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export type VenueOrderPreviewStatus = "idle" | "loading" | "ready" | "error";

export interface VenueOrderReviewPaneProps {
  palette: ThemePalette;
  surface: Surface;
  config: VenueOrderingConfig;
  cart: VenueOrderCartLine[];
  notesAllowedByItemId: Record<string, boolean | undefined>;
  preview: VenueOrderPreview | null;
  previewStatus: VenueOrderPreviewStatus;
  previewError: string | null;
  discountCode?: string;
  onDiscountCodeChange?: (code: string) => void;
  tip: VenueOrderTipChoice;
  /** OQ-2 — true once the sitting has an answer. Changes the heading, not the row. */
  tipRemembered: boolean;
  onTipChange: (choice: VenueOrderTipChoice) => void;
  /** Null once the sitting has already answered — the question is asked ONCE. */
  partySize: number | null;
  askPartySize: boolean;
  onPartySizeChange: (value: number | null) => void;
  buyer: VenueOrderBuyerDraft;
  onBuyerChange: (patch: Partial<VenueOrderBuyerDraft>) => void;
  onSetQuantity: (key: string, quantity: number) => void;
  onSetNotes: (key: string, notes: string | null) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onBack: () => void;
  /**
   * The host's keyboard-safe input. The consumer app raises this pane inside a
   * bottom sheet and passes that sheet's own `TextInput`, because a plain one
   * inside a sheet's scroll view is the classic "keyboard covers the field the
   * guest is typing in" bug. Buyer web renders the pane inline and needs no
   * substitution, so the default is the ordinary control.
   */
  TextInputComponent?: React.ComponentType<TextInputProps>;
  /**
   * issue #3380 — the host's country-aware phone field (flag, dial code,
   * search). When present it REPLACES the plain "Phone, with country code" box,
   * which asked a Lagos guest to know to type +234. The pane stays
   * host-agnostic: the host owns the picker, its icons and its rules.
   */
  renderPhoneField?: (args: VenueOrderPhoneFieldArgs) => React.ReactNode;
  /**
   * issue #3380 — the host's verdict on the number, in words ("Nigerian mobile
   * numbers have 10 digits after the 0 — you entered 8."), or null. Holds the
   * Pay button exactly like a missing name or email does.
   */
  phoneFailure?: string | null;
  /**
   * issue #4420 — how the host frames the pane. Without it the Pay button
   * follows the body in one column (the pane as it always was). With it the
   * host places the body and the Pay button itself: buyer web puts the body in
   * a bottom sheet (a 560 dialog on desktop) and pins "Pay {total}" in its
   * footer. The contents, the rules and the button are the same either way.
   */
  layout?: (body: React.ReactNode, payButton: React.ReactNode) => React.ReactNode;
  /** #4490 07-D — "I'll collect it" at a scanned spot in Both. */
  pickup?: boolean;
  onPickupChange?: (pickup: boolean) => void;
}

/**
 * 1000 → "10%", 1250 → "12.5%". A RATE label, not a money computation.
 *
 * The presets carry no money on them ON PURPOSE. "10% · £2.40" would mean this
 * file multiplying a subtotal by a rate, which is exactly the arithmetic P-20
 * keeps off this surface. The guest picks a percentage, the server re-prices,
 * and the TIP LINE below shows the amount it computed. `tipFlatCents` is
 * plumbed end-to-end for a typed-in amount but has no control in v1 — a
 * seam, not a dead affordance, because nothing on screen offers it.
 */
const tipPresetLabel = (bps: number): string => {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
};

export const VenueOrderReviewPane: React.FC<VenueOrderReviewPaneProps> = ({
  palette,
  surface,
  config,
  cart,
  notesAllowedByItemId,
  preview,
  previewStatus,
  previewError,
  discountCode = "",
  onDiscountCodeChange = () => undefined,
  tip,
  tipRemembered,
  onTipChange,
  partySize,
  askPartySize,
  onPartySizeChange,
  buyer,
  onBuyerChange,
  onSetQuantity,
  onSetNotes,
  submitting,
  submitError,
  onSubmit,
  onBack,
  TextInputComponent,
  renderPhoneField,
  phoneFailure = null,
  layout,
  pickup = false,
  onPickupChange,
}) => {
  // N126: the server's current mode (from the preview) wins over the mode
  // the basket was built with.
  // While a re-price is in flight (the open review re-reads the mode, and a
  // mode change re-prices), the fresh config is shown, never an older preview.
  const shown = previewStatus === "ready" ? venueOrderingReviewConfig(config, preview) : config;
  const counterPickup = venueOrderingIsCounterPickup(shown, pickup);
  const offersPickup = venueOrderingOffersPickup(shown) && onPickupChange !== undefined;
  const Input = TextInputComponent ?? TextInput;
  const rowKeys = venueOrderLineRenderKeys(cart);
  const priced = previewStatus === "ready" && preview !== null;
  const money = (cents: number): string =>
    formatMenuPrice(cents, preview?.currency ?? "") ?? "—";
  const baseBuyerFailure = venueOrderBuyerFailure(buyer);
  // A host's specific phone verdict outranks the generic phone line, never a
  // missing name or email (those still come first, in the order a guest fills).
  const buyerFailure =
    phoneFailure !== null &&
    phoneFailure !== "" &&
    (baseBuyerFailure === null || baseBuyerFailure.field === "phone")
      ? { field: "phone" as const, message: phoneFailure }
      : baseBuyerFailure;
  // The Pay button is live only when the SERVER has priced this exact basket.
  // A stale price behind a live button is how a guest is charged a number they
  // never saw.
  const canPay = priced && !submitting && buyerFailure === null &&
    cart.length > 0;
  const tipDropped =
    preview?.notices?.some(
      (notice) =>
        notice !== null &&
        typeof notice === "object" &&
        (notice as { type?: unknown }).type === "tip_dropped_free_order",
    ) === true;
  const knownCodeReasons = new Set<DiscountCodeReason>([
    "not_found",
    "paused",
    "not_started",
    "ended",
    "used_up",
    "buyer_limit",
    "queue",
    "not_applicable",
    "min_subtotal",
    "incompatible_better_automatic",
  ]);
  // #4624 follow-up 3: a ticket-capped code with fewer left than a line holds
  // leaves that line at full price; say so on the line (the server's notice).
  const codeLimitedByLineNo = new Map(
    (priced && preview !== null ? venueCodeLimitedNotices(preview) : []).map(
      (notice) => [notice.lineNo, notice],
    ),
  );
  const codeReason = preview?.codeOutcome?.reason ?? null;
  const hasKnownCodeReason =
    codeReason !== null &&
    knownCodeReasons.has(codeReason as DiscountCodeReason);
  const codeDiscount =
    preview?.discounts?.find(
      (discount) => discount.id === preview.codeOutcome?.discountId,
    ) ?? null;

  const payButton = (
    <Pressable
      onPress={onSubmit}
      disabled={!canPay}
      accessibilityRole="button"
      accessibilityState={{ disabled: !canPay }}
      accessibilityLabel={
        priced && preview !== null
          ? `Pay ${money(preview.totalCents)}`
          : "Pay — waiting for the total"
      }
      style={[
        styles.payBtn,
        (canPay ? accentFill(palette) : { backgroundColor: palette.panelBorder }),
      ]}
    >
      <Text
        style={[
          styles.payLabel,
          { color: canPay ? palette.accentText : palette.tertiaryText },
        ]}
      >
        {submitting
          ? "One moment…"
          : priced && preview !== null
            ? `Pay ${money(preview.totalCents)}`
            : "Pay"}
      </Text>
    </Pressable>
  );
  const body = (
    <>
      {/* #4490 fix 2 (N94): the order has a title, a proper Back to menu
          button and a Close, like every other sheet. */}
      <View style={styles.headRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to the menu"
          style={[styles.backBtn, { borderColor: palette.panelBorder }]}
          testID="venue-order-back"
        >
          <Text style={[styles.backLabel, { color: palette.primaryText }]}>
            ‹ Menu
          </Text>
        </Pressable>
        <Text
          style={[styles.headTitle, { color: palette.primaryText }]}
          accessibilityRole="header"
        >
          Your order
        </Text>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Close your order"
          style={[styles.backBtn, { borderColor: palette.panelBorder }]}
          testID="venue-order-close"
        >
          <Text style={[styles.backLabel, { color: palette.primaryText }]}>
            Close
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.headChip, { color: palette.tertiaryText }]}>
        {venueOrderHandoverChip(shown, pickup)}
      </Text>

      {/* ── the basket ──────────────────────────────────────────────────── */}
      <View style={[styles.card, surface.card]}>
        {cart.map((line, index) => {
          // W3-N40: a note edit re-keys the LINE (its identity includes the
          // note) but never the ROW, so the note field keeps focus.
          const rowKey = rowKeys[index];
          const pricedLine =
            preview?.lines.find(
              (candidate) => candidate.lineNo === index + 1,
            ) ?? null;
          return (
            <View
              key={rowKey}
              style={[
                styles.lineRow,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: palette.panelBorder,
                },
              ]}
            >
              <View style={styles.lineTop}>
                <View style={styles.lineLeft}>
                  <Text
                    style={[styles.lineName, { color: palette.primaryText }]}
                  >
                    {line.itemName}
                  </Text>
                  {line.modifierNames.length > 0 ? (
                    <Text
                      style={[styles.lineMods, { color: palette.tertiaryText }]}
                    >
                      {line.modifierNames.join(" · ")}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.lineRight}>
                  {/* The line's own money, when the server has stated it. */}
                  {pricedLine === null ? null : (
                    <View style={styles.linePricePair}>
                      {pricedLine.discountCents > 0 ? (
                        <Text
                          style={[
                            styles.lineListTotal,
                            { color: palette.tertiaryText },
                          ]}
                        >
                          {money(pricedLine.lineTotalCents)}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.lineTotal,
                          { color: palette.primaryText },
                        ]}
                      >
                        {money(pricedLine.netLineTotalCents)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => onSetQuantity(line.key, line.quantity - 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`One fewer ${line.itemName}`}
                      style={[
                        styles.stepBtn,
                        { borderColor: palette.panelBorder },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepGlyph,
                          { color: palette.primaryText },
                        ]}
                      >
                        −
                      </Text>
                    </Pressable>
                    <Text
                      style={[styles.stepCount, { color: palette.primaryText }]}
                    >
                      {line.quantity}
                    </Text>
                    <Pressable
                      onPress={() => onSetQuantity(line.key, line.quantity + 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`One more ${line.itemName}`}
                      style={[
                        styles.stepBtn,
                        { borderColor: palette.panelBorder },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepGlyph,
                          { color: palette.primaryText },
                        ]}
                      >
                        +
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
              {codeLimitedByLineNo.has(index + 1) ? (
                <Text
                  style={[styles.codeLimited, { color: palette.secondaryText }]}
                  accessibilityRole="alert"
                  testID={`venue-order-code-limited-${
                    codeLimitedByLineNo.get(index + 1)?.lineRef ?? ""
                  }`}
                >
                  {codeLimitedByLineNo.get(index + 1)?.text}
                </Text>
              ) : null}
              {notesAllowedByItemId[line.menuItemId] === true ? (
                <Input
                  value={line.notes ?? ""}
                  onChangeText={(value: string) =>
                    onSetNotes(line.key, value.trim() === "" ? null : value)
                  }
                  placeholder="Anything they should know? (optional)"
                  placeholderTextColor={palette.tertiaryText}
                  accessibilityLabel={`A note for ${line.itemName}`}
                  maxLength={140}
                  style={[
                    styles.input,
                    {
                      borderColor: palette.panelBorder,
                      color: palette.primaryText,
                    },
                  ]}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {/* ── the optional party-size question (D-10 / DESIGN §5.2) ───────── */}
      {askPartySize ? (
        <View style={[styles.card, surface.card, styles.block]}>
          <Text style={[styles.blockTitle, { color: palette.primaryText }]}>
            {VENUE_ORDER_PARTY_SIZE_PROMPT}
          </Text>
          <Text style={[styles.blockHelp, { color: palette.tertiaryText }]}>
            {VENUE_ORDER_PARTY_SIZE_HELP}
          </Text>
          <OfferingStepper
            palette={palette}
            value={partySize ?? 0}
            min={0}
            max={VENUE_ORDER_PARTY_SIZE_MAX}
            onChange={(next: number) => onPartySizeChange(next === 0 ? null : next)}
            decrementLabel="One fewer"
            incrementLabel="One more"
            valueLabel={partySize === null ? "Not said" : `${partySize} ${partySize === 1 ? "person" : "people"}`}
            typeable
            testID="venue-order-party-size"
          />
        </View>
      ) : null}

      {/* ── the tip row (D-2 / P-18 / OQ-2) ─────────────────────────────── */}
      {config.tipsEnabled && !tipDropped ? (
        <View style={[styles.card, surface.card, styles.block]}>
          <Text style={[styles.blockTitle, { color: palette.primaryText }]}>
            {tipRemembered ? "Tip — you can change it" : "Add a tip?"}
          </Text>
          {config.serviceChargeBps > 0 ? (
            <Text style={[styles.blockHelp, { color: palette.tertiaryText }]}>
              {`${config.serviceChargeLabel} is already on this order, so the tip starts at nothing. Add one if you'd like to.`}
            </Text>
          ) : null}
          <View style={styles.tipRow}>
            <TipChip
              label="None"
              selected={tip.bps === 0 && tip.flatCents === null}
              palette={palette}
              onPress={() => onTipChange({ bps: 0, flatCents: null })}
            />
            {venueOrderTipPresets(config).map((bps) => (
              <TipChip
                key={bps}
                label={tipPresetLabel(bps)}
                selected={tip.bps === bps && tip.flatCents === null}
                palette={palette}
                onPress={() => onTipChange({ bps, flatCents: null })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {tipDropped ? (
        <Text style={[styles.freeTipMessage, { color: palette.secondaryText }]}>
          Your order is free, so no tip is added.
        </Text>
      ) : null}

      {/* ── #4490 07-D: where the order goes ─────────────────────────────── */}
      <View style={[styles.card, surface.card, styles.block]}>
        <Text
          style={[styles.blockHelp, { color: palette.primaryText }]}
          testID="venue-order-fulfilment-line"
        >
          {venueOrderingFulfilmentLine(shown, pickup)}
        </Text>
        {offersPickup ? (
          <View style={styles.pickupRow}>
            <Text style={[styles.blockHelp, styles.pickupLabel, { color: palette.primaryText }]}>
              I'll collect it
            </Text>
            <Switch
              value={pickup}
              onValueChange={(value: boolean) => onPickupChange?.(value)}
              disabled={submitting}
              accessibilityLabel="I'll collect it"
              testID="venue-order-pickup-switch"
            />
          </View>
        ) : null}
      </View>

      {/* ── who this order belongs to (P-22 gate 8) ─────────────────────── */}
      <View style={[styles.card, surface.card, styles.block]}>
        <Text style={[styles.blockTitle, { color: palette.primaryText }]}>
          {counterPickup ? "Who's collecting?" : "Who's ordering?"}
        </Text>
        <Input
          value={buyer.name}
          onChangeText={(value: string) => onBuyerChange({ name: value })}
          placeholder="Your name"
          placeholderTextColor={palette.tertiaryText}
          accessibilityLabel="Your name"
          autoCapitalize="words"
          maxLength={80}
          style={[
            styles.input,
            { borderColor: palette.panelBorder, color: palette.primaryText },
          ]}
        />
        <Input
          value={buyer.email}
          onChangeText={(value: string) => onBuyerChange({ email: value })}
          placeholder="Email for your receipt"
          placeholderTextColor={palette.tertiaryText}
          accessibilityLabel="Email for your receipt"
          autoCapitalize="none"
          keyboardType="email-address"
          maxLength={160}
          style={[
            styles.input,
            { borderColor: palette.panelBorder, color: palette.primaryText },
          ]}
        />
        {renderPhoneField !== undefined ? (
          renderPhoneField({
            phone: buyer.phone,
            phoneCountryIso: buyer.phoneCountryIso ?? null,
            onChange: onBuyerChange,
            disabled: submitting,
          })
        ) : (
          <Input
            value={buyer.phone}
            onChangeText={(value: string) => onBuyerChange({ phone: value })}
            placeholder="Phone, with country code"
            placeholderTextColor={palette.tertiaryText}
            accessibilityLabel="Phone number, with country code"
            keyboardType="phone-pad"
            maxLength={24}
            style={[
              styles.input,
              { borderColor: palette.panelBorder, color: palette.primaryText },
            ]}
          />
        )}
      </View>

      {/* ── the money. All five numbers are the server's. ───────────────── */}
      <View style={[styles.card, surface.card, styles.block]}>
        <Text style={[styles.blockTitle, { color: palette.primaryText }]}>
          Discount code
        </Text>
        {preview?.codeOutcome?.applied === true && codeDiscount !== null ? (
          <View style={styles.codeAppliedRow}>
            <View style={styles.codeAppliedCopy}>
              <Text
                style={[styles.codeAppliedName, { color: palette.primaryText }]}
              >
                {codeDiscount.name}
              </Text>
              <Text
                style={[styles.blockHelp, { color: palette.secondaryText }]}
              >
                Saving {money(codeDiscount.amountCents)}
              </Text>
            </View>
            <Pressable
              onPress={() => onDiscountCodeChange("")}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Remove discount code"
            >
              <Text style={[styles.codeRemove, { color: palette.accent }]}>
                Remove
              </Text>
            </Pressable>
          </View>
        ) : (
          <Input
            value={discountCode}
            onChangeText={onDiscountCodeChange}
            placeholder="Enter a code"
            placeholderTextColor={palette.tertiaryText}
            accessibilityLabel="Discount code"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!submitting}
            maxLength={32}
            style={[
              styles.input,
              { borderColor: palette.panelBorder, color: palette.primaryText },
            ]}
          />
        )}
        {previewStatus === "loading" && discountCode.trim().length > 0 ? (
          <Text style={[styles.blockHelp, { color: palette.secondaryText }]}>
            Checking code…
          </Text>
        ) : hasKnownCodeReason ? (
          <React.Suspense fallback={null}>
            <DiscountReasonText
              style={[styles.codeError, { color: palette.secondaryText }]}
              input={{
                reason: codeReason as DiscountCodeReason,
                code: discountCode.trim().toUpperCase(),
              }}
            />
          </React.Suspense>
        ) : null}
        {priced && preview !== null ? (
          <View style={styles.totals}>
            <MoneyLine
              label="Items"
              value={money(preview.listSubtotalCents ?? preview.subtotalCents)}
              palette={palette}
            />
            {(preview.discounts ?? []).map((discount) => (
              <MoneyLine
                key={discount.id}
                label={discount.name}
                value={`−${money(discount.amountCents)}`}
                palette={palette}
              />
            ))}
            {preview.serviceChargeCents > 0 ? (
              <MoneyLine
                label={preview.serviceChargeLabel}
                value={money(preview.serviceChargeCents)}
                palette={palette}
              />
            ) : null}
            <MoneyLine
              label="Fees & tax"
              value={money(preview.feesAndTaxCents)}
              palette={palette}
            />
            {preview.tipCents > 0 ? (
              <MoneyLine
                label="Tip"
                value={money(preview.tipCents)}
                palette={palette}
              />
            ) : null}
            <View
              style={[
                styles.totalRule,
                { backgroundColor: palette.panelBorder },
              ]}
            />
            <MoneyLine
              label="Total"
              value={money(preview.totalCents)}
              palette={palette}
              strong
            />
          </View>
        ) : (
          <Text style={[styles.blockHelp, { color: palette.secondaryText }]}>
            {previewStatus === "error"
              ? (previewError ??
                "We couldn't price that order. Nothing has been charged.")
              : "Working out the total…"}
          </Text>
        )}
      </View>

      {submitError === null ? null : (
        <Text style={[styles.error, { color: palette.secondaryText }]}>
          {submitError}
        </Text>
      )}
      {buyerFailure === null || cart.length === 0 ? null : (
        <Text style={[styles.error, { color: palette.secondaryText }]}>
          {buyerFailure.message}
        </Text>
      )}

    </>
  );
  if (layout !== undefined) return <>{layout(body, payButton)}</>;
  return (
    <View style={styles.wrap}>
      {body}
      {payButton}
    </View>
  );
};

const TipChip: React.FC<{
  label: string;
  selected: boolean;
  palette: ThemePalette;
  onPress: () => void;
}> = ({ label, selected, palette, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ selected }}
    accessibilityLabel={`Tip ${label}`}
    style={[
      styles.tipChip,
      {
        borderColor: selected ? accentEdgeOnFill(palette) : palette.panelBorder,
        ...(selected ? accentFill(palette) : { backgroundColor: "rgba(0,0,0,0)" }),
      },
    ]}
  >
    <Text
      style={[
        styles.tipChipLabel,
        { color: selected ? palette.accentText : palette.primaryText },
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

const MoneyLine: React.FC<{
  label: string;
  value: string;
  palette: ThemePalette;
  strong?: boolean;
}> = ({ label, value, palette, strong = false }) => (
  <View style={styles.moneyRow} accessibilityLabel={`${label} ${value}`}>
    <Text
      style={[
        strong ? styles.moneyLabelStrong : styles.moneyLabel,
        { color: strong ? palette.primaryText : palette.secondaryText },
      ]}
    >
      {label}
    </Text>
    <Text
      style={[
        strong ? styles.moneyValueStrong : styles.moneyValue,
        { color: palette.primaryText },
      ]}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  backBtn: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
  backLabel: { fontSize: 15, fontWeight: "800" },
  headTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800" },
  headChip: { fontSize: 13, fontWeight: "700" },
  card: { borderRadius: 16, padding: 14 },
  block: { gap: 10 },
  blockTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  blockHelp: { fontSize: 13, lineHeight: 18 },
  pickupRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pickupLabel: { flex: 1, fontWeight: "700" },
  lineRow: { paddingVertical: 10, gap: 8 },
  lineTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  lineLeft: { flex: 1, minWidth: 0, gap: 2 },
  lineRight: { alignItems: "flex-end", gap: 8 },
  lineName: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  lineMods: { fontSize: 13, lineHeight: 18 },
  linePricePair: { alignItems: "flex-end" },
  lineListTotal: {
    fontSize: 12,
    lineHeight: 16,
    textDecorationLine: "line-through",
  },
  lineTotal: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontSize: 17, lineHeight: 21, fontWeight: "800" },
  stepCount: {
    fontSize: 15,
    fontWeight: "800",
    minWidth: 16,
    textAlign: "center",
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  tipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tipChip: {
    minHeight: 38,
    minWidth: 64,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  tipChipLabel: { fontSize: 14, fontWeight: "800" },
  freeTipMessage: { fontSize: 13, lineHeight: 18 },
  codeAppliedRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  codeAppliedCopy: { flex: 1 },
  codeAppliedName: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
  codeRemove: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  codeError: { fontSize: 13, lineHeight: 18 },
  codeLimited: { fontSize: 13, lineHeight: 18 },
  totals: { gap: 8 },
  moneyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  moneyLabel: { fontSize: 14, lineHeight: 19 },
  moneyLabelStrong: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  moneyValue: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  moneyValueStrong: { fontSize: 18, lineHeight: 23, fontWeight: "900" },
  totalRule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  error: { fontSize: 13, lineHeight: 18 },
  payBtn: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  payLabel: { fontSize: 16, fontWeight: "900" },
});
