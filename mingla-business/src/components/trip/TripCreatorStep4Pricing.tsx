/**
 * TripCreatorStep4Pricing — Step 4 of TripCreatorWizard. Single tier:
 * tier name + price (major units). Currency is auto-derived from the
 * event (which was set at create time from brand.default_currency) and
 * shown read-only. Capacity is also read-only, mirrored from Step 1.
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8 Step 4 — single tier only; installments
 * are Tr3 [Installment Payments].
 *
 * ORCH-0859 REWORK 2 (operator smoke #6/#7): removed the editable
 * Currency text input. The `tg_enforce_event_ticket_currency` trigger
 * (supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:159)
 * rejects any ticket_types.currency that doesn't match the parent
 * events.currency. Allowing operators to type a free-form currency
 * here let them mismatch the event currency and produce
 * `ticket_currency_must_match_event_currency`. Currency is now a
 * read-only display of `currency` already on the trip; the wizard
 * passes through `currency` for display purposes but never sends a
 * user-typed value to the service.
 */

import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface Step4Draft {
  tierName: string;
  priceMajor: string; // displayed string (decimal, e.g. "50.00")
  /**
   * Read-only currency mirror of the event currency (set at create time
   * from brand.default_currency). NOT editable by the operator — the
   * trigger requires ticket_types.currency to match events.currency, and
   * events.currency is locked at create time.
   */
  currency: string;
  capacity: number | null; // read-only mirror from Step 1
}

export interface TripCreatorStep4PricingProps {
  draft: Step4Draft;
  onChange: (patch: Partial<Step4Draft>) => void;
  disabled?: boolean;
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

export const TripCreatorStep4Pricing: React.FC<TripCreatorStep4PricingProps> = ({
  draft,
  onChange,
  disabled,
}) => {
  return (
    <View style={styles.host}>
      <Text style={styles.helper}>
        Single full-price tier in this milestone. Installment plans + multi-tier
        pricing arrive in the next milestone.
      </Text>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Tier name</Text>
        <TextInput
          value={draft.tierName}
          onChangeText={(v) => onChange({ tierName: v })}
          placeholder="e.g. Double occupancy"
          placeholderTextColor={textTokens.tertiary}
          editable={!disabled}
          accessibilityLabel="Tier name"
          style={styles.textInput}
          testID="trip-step4-tier-name"
        />
      </View>

      <View style={styles.priceRow}>
        <View style={[styles.fieldGroup, { flex: 2 }]}>
          <Text style={styles.fieldLabel}>Price per spot</Text>
          <TextInput
            value={draft.priceMajor}
            onChangeText={(v) => {
              // Allow digits + single decimal point only
              const clean = v.replace(/[^0-9.]/g, "");
              const parts = clean.split(".");
              const normalized =
                parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : clean;
              onChange({ priceMajor: normalized });
            }}
            placeholder="50.00"
            placeholderTextColor={textTokens.tertiary}
            keyboardType="decimal-pad"
            editable={!disabled}
            accessibilityLabel="Price per spot"
            style={styles.textInput}
            testID="trip-step4-price"
          />
        </View>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Currency</Text>
          <View style={styles.readonlyField} testID="trip-step4-currency-readonly">
            <Text style={styles.readonlyValue}>{draft.currency.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <View style={styles.capacityCard}>
        <Text style={styles.capacityLabel}>Capacity (from Step 1)</Text>
        <Text style={styles.capacityValue}>
          {draft.capacity === null
            ? "Set in Step 1"
            : `${draft.capacity} traveler${draft.capacity === 1 ? "" : "s"}`}
        </Text>
      </View>

      <Text style={styles.footnote}>
        Currency comes from your brand setup and can&apos;t be changed here.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  textInput: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  readonlyField: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
  },
  readonlyValue: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  priceRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  capacityCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  capacityLabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  capacityValue: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
  },
  footnote: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
});

export default TripCreatorStep4Pricing;
