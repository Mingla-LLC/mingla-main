/**
 * RsvpChipInPanel — ORCH-1291 [rsvp-chip-in] · the guest voluntary-gift panel.
 *
 * The reusable, self-contained chip-in block mounted in TWO places (the RSVP
 * success popup + the inline §5.5 body section), both reading ONE lifted chip-in
 * state (useRsvpOfferingState) so they never diverge or double-charge.
 *
 * THE MOMENT (DESIGN §0): the guest just went Going and is warm + generous. This
 * is the GIFT moment, NOT a checkout — light, optional, celebratory. HARD copy
 * guardrail: NO commerce words (buy/ticket/checkout/cart/purchase/order/price/
 * tax/VAT/fee/pay now). Allowed: chip in / give / contribution / gift / throw in.
 *
 * Pure-presentational, props-only, package-isolated (I-MOR-0827) — renders on
 * react-native-web AND native RN. testID: orch-1291-rsvp-chipin-panel.
 * DESIGN contract: Mingla_Artifacts/specs/DESIGN_ORCH-1291_RSVP_CHIP_IN.md.
 */

import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  boldFontFamily,
  opaqueAccentWashColor,
  opaqueSurfaceColor,
  type ThemePalette,
} from "./themePalette";
import { type ResolvedTheme } from "./designTokens";

const DANGER = "#ef4444";

// Opaque fills — mirror RsvpMomentumDecision (Android keeps raw opaque page;
// iOS/web alpha-composite the translucent token to a SOLID hex, no see-through).
const opaqueCardFill = (palette: ThemePalette): string =>
  Platform.OS === "android" ? palette.page : opaqueSurfaceColor(palette);
const opaqueAccentFill = (palette: ThemePalette): string =>
  opaqueAccentWashColor(palette);

// Currency-aware formatters (DESIGN §4.3) — reuse the package's proven
// Intl.NumberFormat pattern with a try/catch fallback.
const fmtWhole = (cents: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${Math.round(cents / 100)} ${currency}`;
  }
};
const fmtExact = (cents: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

export type ChipInPanelState =
  | "idle"
  | "entering"
  | "submitting"
  | "success"
  | "error"
  | "paused";

export interface RsvpChipInPanelProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
  currency: string; // brand settlement currency
  hostShortName: string; // brand display name (fallback "the host")
  suggestedCents: number | null;
  minCents: number | null;
  state: ChipInPanelState;
  amountCents: number; // controlled by shared chip-in state
  onAmountChange: (cents: number) => void;
  onPreset: (cents: number) => void;
  onSubmit: () => void;
  onDismissSuccess?: () => void;
  errorText: string | null;
  isWeb?: boolean;
  preview?: boolean; // business preview → inert, "Preview" hint
  testID?: string;
}

// DESIGN §4.5 — deterministic preset ladder derivation.
function derivePresets(
  suggestedCents: number | null,
  minCents: number | null,
  currency: string,
): number[] {
  let presets: number[];
  if (suggestedCents !== null && suggestedCents > 0) {
    presets = [suggestedCents, suggestedCents * 2, suggestedCents * 5];
  } else if ((currency || "").toUpperCase() === "NGN") {
    presets = [1000 * 100, 2500 * 100, 5000 * 100];
  } else {
    presets = [5 * 100, 10 * 100, 25 * 100];
  }
  // Drop presets below the min floor (keep at least one).
  if (minCents !== null && minCents > 0) {
    const filtered = presets.filter((p) => p >= minCents);
    presets = filtered.length > 0 ? filtered : [minCents];
  }
  return presets;
}

export const RsvpChipInPanel: React.FC<RsvpChipInPanelProps> = ({
  palette,
  theme,
  currency,
  hostShortName,
  suggestedCents,
  minCents,
  state,
  amountCents,
  onAmountChange,
  onPreset,
  onSubmit,
  onDismissSuccess,
  errorText,
  isWeb,
  preview,
  testID,
}) => {
  const boldFamily = boldFontFamily(theme);
  const cardFill = opaqueCardFill(palette);
  const presets = useMemo(
    () => derivePresets(suggestedCents, minCents, currency),
    [suggestedCents, minCents, currency],
  );

  const belowFloor = minCents !== null && amountCents > 0 && amountCents < minCents;
  const submitting = state === "submitting";
  const canSubmit = amountCents > 0 && !belowFloor && !submitting && !preview;

  const host = hostShortName && hostShortName.trim().length > 0 ? hostShortName : "the host";

  // ── PAUSED — the money rail died (brand disabled payouts after publish). ──
  if (state === "paused") {
    return (
      <View
        style={[styles.card, { backgroundColor: cardFill, borderColor: palette.panelBorder }]}
        testID={`${testID ?? "orch-1291-rsvp-chipin-panel"}-paused`}
      >
        <Text style={[styles.pausedNote, { color: palette.secondaryText }]}>
          Chipping in is paused for this event.
        </Text>
      </View>
    );
  }

  // ── SUCCESS — the gift landed; celebratory thank-you replaces the form. ──
  if (state === "success") {
    return (
      <Pressable
        style={[styles.card, styles.successCard, { backgroundColor: cardFill, borderColor: palette.panelBorder }]}
        onPress={onDismissSuccess}
        accessibilityRole={onDismissSuccess ? "button" : undefined}
        accessibilityLabel="Thank you"
        testID={`${testID ?? "orch-1291-rsvp-chipin-panel"}-success`}
      >
        <Text style={[styles.successHeart, { color: palette.accent }]}>💛</Text>
        <Text style={[styles.successHeading, { color: palette.primaryText, fontFamily: boldFamily }]}>
          Thank you 💛
        </Text>
        <Text style={[styles.successBody, { color: palette.secondaryText }]}>
          You chipped in {fmtExact(amountCents, currency)} to {host}.
        </Text>
      </Pressable>
    );
  }

  const primaryLabel = submitting
    ? "Sending…"
    : `Chip in ${fmtWhole(amountCents > 0 ? amountCents : (presets[0] ?? 0), currency)}`;

  return (
    <View
      style={[styles.card, { backgroundColor: cardFill, borderColor: palette.panelBorder }]}
      testID={testID ?? "orch-1291-rsvp-chipin-panel"}
    >
      <Text style={[styles.heading, { color: palette.primaryText, fontFamily: boldFamily }]}>
        Chip in for {host}
      </Text>
      <Text style={[styles.sub, { color: palette.secondaryText }]}>
        Totally optional — your RSVP's already locked in.
      </Text>

      {/* Preset chips + an "Other" chip (DESIGN §4.5 / §5.1). */}
      <View style={styles.presetsRow}>
        {presets.map((preset) => {
          const selected = amountCents === preset;
          return (
            <Pressable
              key={preset}
              onPress={() => !submitting && !preview && onPreset(preset)}
              disabled={submitting || preview}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: submitting || preview }}
              accessibilityLabel={`Chip in ${fmtWhole(preset, currency)}`}
              style={[
                styles.presetChip,
                {
                  backgroundColor: selected ? palette.accent : cardFill,
                  borderColor: selected ? palette.accent : palette.panelBorder,
                  opacity: submitting ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.presetLabel,
                  { color: selected ? palette.accentText : palette.primaryText, fontFamily: boldFamily },
                ]}
              >
                {fmtWhole(preset, currency)}
              </Text>
            </Pressable>
          );
        })}
        {/* "Other" — clears the preset selection so the guest types a custom amount. */}
        <Pressable
          onPress={() => !submitting && !preview && onAmountChange(0)}
          disabled={submitting || preview}
          accessibilityRole="button"
          accessibilityLabel="Enter a custom amount"
          style={[
            styles.presetChip,
            {
              backgroundColor: cardFill,
              borderColor: palette.panelBorder,
              opacity: submitting ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[styles.presetLabel, { color: palette.primaryText, fontFamily: boldFamily }]}>
            Other
          </Text>
        </Pressable>
      </View>

      {/* Free-form amount (major units; the symbol prefix is shown). */}
      <View
        style={[
          styles.field,
          {
            backgroundColor: palette.page,
            borderColor: belowFloor ? DANGER : palette.panelBorder,
          },
        ]}
      >
        <Text style={[styles.currencyPrefix, { color: palette.primaryText, fontFamily: boldFamily }]}>
          {fmtWhole(0, currency).replace(/[\d.,\s]/g, "") || "$"}
        </Text>
        <TextInput
          value={amountCents > 0 ? String(Math.round(amountCents / 100)) : ""}
          onChangeText={(raw) => {
            const digits = raw.replace(/[^\d]/g, "");
            const major = digits.length > 0 ? parseInt(digits, 10) : 0;
            onAmountChange(major * 100);
          }}
          editable={!submitting && !preview}
          keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
          returnKeyType="done"
          placeholder="0"
          placeholderTextColor={palette.tertiaryText}
          accessibilityLabel={`Contribution amount in ${currency}`}
          style={[styles.fieldInput, { color: palette.primaryText, opacity: submitting ? 0.6 : 1 }]}
          testID="orch-1291-rsvp-chipin-input"
        />
      </View>

      {/* Floor hint (danger when below the min). */}
      <Text style={[styles.floorHint, { color: belowFloor ? DANGER : palette.tertiaryText }]}>
        {belowFloor
          ? `Add at least ${fmtWhole(minCents ?? 0, currency)}.`
          : minCents !== null
          ? `Minimum ${fmtWhole(minCents, currency)}`
          : "Any amount helps."}
      </Text>

      {/* CONFIRM_LINE — the ONE place the fee model is user-visible (DESIGN §4.4). */}
      {amountCents > 0 && !belowFloor ? (
        <Text style={[styles.confirmLine, { color: palette.secondaryText }]}>
          You'll give {fmtExact(amountCents, currency)}.
        </Text>
      ) : null}

      {/* Primary "Chip in" button. */}
      <Pressable
        onPress={() => canSubmit && onSubmit()}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        accessibilityLabel={`Chip in ${fmtWhole(amountCents > 0 ? amountCents : (presets[0] ?? 0), currency)}`}
        accessibilityHint={belowFloor ? `Add at least ${fmtWhole(minCents ?? 0, currency)}` : undefined}
        style={[
          styles.primaryBtn,
          {
            backgroundColor: canSubmit ? palette.accent : opaqueAccentFill(palette),
          },
        ]}
        testID="orch-1291-rsvp-chipin-submit"
      >
        {submitting ? (
          <View style={styles.primaryBtnRow}>
            <ActivityIndicator color={palette.accentText} />
            <Text style={[styles.primaryLabel, { color: palette.accentText, fontFamily: boldFamily }]}>
              {"  "}Sending…
            </Text>
          </View>
        ) : (
          <Text
            style={[
              styles.primaryLabel,
              { color: canSubmit ? palette.accentText : palette.tertiaryText, fontFamily: boldFamily },
            ]}
          >
            {primaryLabel}
          </Text>
        )}
      </Pressable>

      {/* Web-only secure-payment microcopy (no native sheet → a redirect). */}
      {isWeb ? (
        <Text style={[styles.webNote, { color: palette.tertiaryText }]}>
          Secure payment — you'll finish on a secure page.
        </Text>
      ) : null}

      {/* Inline error (retry; amount preserved). */}
      {state === "error" && errorText ? (
        <Text style={[styles.errorLine, { color: DANGER }]} testID="orch-1291-rsvp-chipin-error">
          {errorText}
        </Text>
      ) : null}

      {preview ? (
        <Text style={[styles.previewNote, { color: palette.tertiaryText }]}>
          Preview — guests will chip in here.
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    overflow: "hidden",
  },
  successCard: { alignItems: "center", paddingVertical: 6 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "900", letterSpacing: -0.2 },
  sub: { fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 4 },
  presetsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  presetChip: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  presetLabel: { fontSize: 15, fontWeight: "800" },
  field: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  currencyPrefix: { fontSize: 20, fontWeight: "900" },
  fieldInput: { flex: 1, fontSize: 20, fontWeight: "800", paddingVertical: 10 },
  floorHint: { fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 6 },
  confirmLine: { fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 10 },
  primaryBtn: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  primaryBtnRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 16, fontWeight: "900" },
  webNote: { fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 10, textAlign: "center" },
  errorLine: { fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 10 },
  pausedNote: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  successHeart: { fontSize: 28, marginBottom: 4 },
  successHeading: { fontSize: 18, lineHeight: 24, fontWeight: "900", marginTop: 12 },
  successBody: { fontSize: 13, lineHeight: 19, fontWeight: "700", marginTop: 6, textAlign: "center" },
  previewNote: { fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 10, textAlign: "center" },
});

export default RsvpChipInPanel;
