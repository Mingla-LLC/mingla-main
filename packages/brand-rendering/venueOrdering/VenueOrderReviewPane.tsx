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
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import type {
  offeringSurfaceStyles,
  ThemePalette,
} from "@mingla/offering-rendering";

import { formatMenuPrice } from "../PublicMenuSections";
import type {
  VenueOrderBuyerDraft,
  VenueOrderCartLine,
  VenueOrderingConfig,
  VenueOrderPreview,
  VenueOrderTipChoice,
} from "./venueOrderingTypes";
import {
  VENUE_ORDER_PARTY_SIZE_HELP,
  VENUE_ORDER_PARTY_SIZE_MAX,
  VENUE_ORDER_PARTY_SIZE_PROMPT,
  venueOrderBuyerFailure,
  venueOrderHandoverChip,
  venueOrderTipPresets,
} from "./venueOrderingRules";

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
}

/** 1000 → "10%", 1250 → "12.5%". A RATE label, not a money computation. */
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
}) => {
  const Input = TextInputComponent ?? TextInput;
  const priced = previewStatus === "ready" && preview !== null;
  const money = (cents: number): string =>
    formatMenuPrice(cents, preview?.currency ?? "") ?? "—";
  const buyerFailure = venueOrderBuyerFailure(buyer);
  // The Pay button is live only when the SERVER has priced this exact basket.
  // A stale price behind a live button is how a guest is charged a number they
  // never saw.
  const canPay = priced && !submitting && buyerFailure === null &&
    cart.length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to the menu"
          style={styles.backBtn}
        >
          <Text style={[styles.backLabel, { color: palette.accent }]}>
            ‹ Menu
          </Text>
        </Pressable>
        <Text style={[styles.headChip, { color: palette.tertiaryText }]}>
          {venueOrderHandoverChip(config)}
        </Text>
      </View>

      {/* ── the basket ──────────────────────────────────────────────────── */}
      <View style={[styles.card, surface.card]}>
        {cart.map((line, index) => {
          const pricedLine = preview?.lines.find(
            (candidate) => candidate.lineNo === index + 1,
          ) ?? null;
          return (
            <View
              key={line.key}
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
                  <Text style={[styles.lineName, { color: palette.primaryText }]}>
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
                    <Text
                      style={[styles.lineTotal, { color: palette.primaryText }]}
                    >
                      {money(pricedLine.lineTotalCents)}
                    </Text>
                  )}
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => onSetQuantity(line.key, line.quantity - 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`One fewer ${line.itemName}`}
                      style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
                    >
                      <Text
                        style={[styles.stepGlyph, { color: palette.primaryText }]}
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
                      style={[styles.stepBtn, { borderColor: palette.panelBorder }]}
                    >
                      <Text
                        style={[styles.stepGlyph, { color: palette.primaryText }]}
                      >
                        +
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
              {notesAllowedByItemId[line.menuItemId] === true ? (
                <Input
                  value={line.notes ?? ""}
                  onChangeText={(value: string) =>
                    onSetNotes(line.key, value.trim() === "" ? null : value)}
                  placeholder="Anything they should know? (optional)"
                  placeholderTextColor={palette.tertiaryText}
                  accessibilityLabel={`A note for ${line.itemName}`}
                  maxLength={140}
                  style={[
                    styles.input,
                    { borderColor: palette.panelBorder, color: palette.primaryText },
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
          <Input
            value={partySize === null ? "" : String(partySize)}
            onChangeText={(value: string) => {
              const digits = value.replace(/\D/g, "");
              if (digits === "") {
                onPartySizeChange(null);
                return;
              }
              const parsed = Number(digits);
              onPartySizeChange(
                parsed >= 1 && parsed <= VENUE_ORDER_PARTY_SIZE_MAX
                  ? parsed
                  : null,
              );
            }}
            keyboardType="number-pad"
            placeholder="e.g. 4"
            placeholderTextColor={palette.tertiaryText}
            accessibilityLabel={VENUE_ORDER_PARTY_SIZE_PROMPT}
            maxLength={3}
            style={[
              styles.input,
              { borderColor: palette.panelBorder, color: palette.primaryText },
            ]}
          />
        </View>
      ) : null}

      {/* ── the tip row (D-2 / P-18 / OQ-2) ─────────────────────────────── */}
      {config.tipsEnabled ? (
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

      {/* ── who this order belongs to (P-22 gate 8) ─────────────────────── */}
      <View style={[styles.card, surface.card, styles.block]}>
        <Text style={[styles.blockTitle, { color: palette.primaryText }]}>
          {config.spotState === "ok"
            ? "Who's ordering?"
            : "Who's collecting?"}
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
      </View>

      {/* ── the money. All five numbers are the server's. ───────────────── */}
      <View style={[styles.card, surface.card, styles.block]}>
        {priced && preview !== null ? (
          <View style={styles.totals}>
            <MoneyLine
              label="Items"
              value={money(preview.subtotalCents)}
              palette={palette}
            />
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
              style={[styles.totalRule, { backgroundColor: palette.panelBorder }]}
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
          { backgroundColor: canPay ? palette.accent : palette.panelBorder },
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
        borderColor: selected ? palette.accent : palette.panelBorder,
        backgroundColor: selected ? palette.accent : "rgba(0,0,0,0)",
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
  backBtn: { minHeight: 34, justifyContent: "center" },
  backLabel: { fontSize: 15, fontWeight: "800" },
  headChip: { fontSize: 13, fontWeight: "700" },
  card: { borderRadius: 16, padding: 14 },
  block: { gap: 10 },
  blockTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  blockHelp: { fontSize: 13, lineHeight: 18 },
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
  stepCount: { fontSize: 15, fontWeight: "800", minWidth: 16, textAlign: "center" },
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
