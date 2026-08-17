/**
 * MultiDatePricingModeField — issue #2160 amendment §6.
 *
 * The organiser's choice: charge PER DAY, or ONE PRICE FOR ALL DAYS.
 *
 * ── WHY THIS IS ITS OWN LAZY CHUNK ─────────────────────────────────────────
 * It is reachable only from the event wizard's Multiple-dates tab, on an event
 * with more than one date. Inlined into `CreatorStep2When` it sat in the EAGER
 * `__common` chunk — the payload EVERY visitor downloads, including every
 * anonymous buyer who will never open a wizard. `MultiDateDayChooser` in this
 * same directory is lazy for exactly this reason and records the same
 * measurement in its header. Measured with `scripts/ci/bundle-attribute.mjs`,
 * not guessed.
 *
 * ── THE COPY IS THE SPEC'S, VERBATIM ───────────────────────────────────────
 * Every string below is operator-approved (amendment §6). The implementor
 * invents nothing here. Do not paraphrase.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { accent, glass, text as textTokens } from "../../constants/designSystem";
import type { MultiDatePricingMode } from "../../utils/multiDatePricingMode";

/**
 * issue #2160 — SPEC amendment §6, verbatim. The implementor invents nothing
 * here: these are the operator-approved strings.
 */
const PRICING_MODE_OPTIONS: ReadonlyArray<{
  value: MultiDatePricingMode;
  label: string;
  helperPaid: string;
  helperFree: string;
}> = [
  {
    value: "per_day",
    label: "Per day",
    helperPaid:
      "A guest pays for each day they choose. Two days costs twice as much, and they get a pass for each day.",
    helperFree: "A guest gets a separate pass for each day they choose.",
  },
  {
    value: "all_days",
    label: "One price for all days",
    helperPaid:
      "A guest pays once no matter how many days they choose, and gets a single pass that works on every day they picked.",
    helperFree: "A guest gets a single pass that works on every day they picked.",
  },
];

export interface MultiDatePricingModeFieldProps {
  pricingMode: MultiDatePricingMode;
  /** Drives which helper line each option shows — a free event has no price to qualify. */
  eventHasPaidTicket: boolean;
  /**
   * TRUE once the event holds a live ticket. The database trigger
   * `events_multi_date_pricing_mode_locked` is the authority and is
   * fail-closed; this makes the organiser SEE the locked state rather than tap
   * a control that then errors.
   */
  locked: boolean;
  onChange: (next: MultiDatePricingMode) => void;
}

export const MultiDatePricingModeField: React.FC<
  MultiDatePricingModeFieldProps
> = ({ pricingMode, eventHasPaidTicket, locked, onChange }) => (
  <View style={styles.pricingModeBlock} testID="issue-2160-pricing-mode">
    <Text style={styles.fieldLabel}>How guests pay for multiple days</Text>
    {/* Sibling radio rows inside one radiogroup — never nested Pressables,
        which would flatten the accessibility subtree. The helper text is a
        SEPARATE node, not concatenated into the accessible name. */}
    <View accessibilityRole="radiogroup" style={styles.pricingModeRows}>
      {PRICING_MODE_OPTIONS.map((option) => {
        const checked = pricingMode === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={locked}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: locked }}
            accessibilityLabel={option.label}
            testID={`issue-2160-pricing-mode-${option.value}`}
            style={[
              styles.pricingModeRow,
              checked ? styles.pricingModeRowActive : null,
              locked ? styles.pricingModeRowLocked : null,
            ]}
          >
            <View
              style={[
                styles.pricingModeRadio,
                checked ? styles.pricingModeRadioActive : null,
              ]}
            >
              {checked ? <View style={styles.pricingModeDot} /> : null}
            </View>
            <View style={styles.pricingModeCopy}>
              <Text style={styles.pricingModeLabel}>{option.label}</Text>
              <Text style={styles.pricingModeHelper}>
                {eventHasPaidTicket ? option.helperPaid : option.helperFree}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
    <Text style={styles.helperHint} testID="issue-2160-pricing-mode-footnote">
      {locked
        ? "A guest already has a ticket, so this can't be changed."
        : "You can't change this once a guest has a ticket."}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.secondary,
    marginBottom: 6,
  },
  helperHint: { fontSize: 12, lineHeight: 16, color: textTokens.tertiary },
  pricingModeBlock: { marginTop: 18, gap: 8 },
  pricingModeRows: { gap: 8 },
  pricingModeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  pricingModeRowActive: { borderColor: accent.warm },
  pricingModeRowLocked: { opacity: 0.6 },
  pricingModeRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
    borderColor: glass.border.profileBase,
  },
  pricingModeRadioActive: { borderColor: accent.warm },
  pricingModeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
  },
  pricingModeCopy: { flex: 1, gap: 3 },
  pricingModeLabel: { fontSize: 14, fontWeight: "700", color: textTokens.primary },
  pricingModeHelper: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
  },
});

export default MultiDatePricingModeField;
