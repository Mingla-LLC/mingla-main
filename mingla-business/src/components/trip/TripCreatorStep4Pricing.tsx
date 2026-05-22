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

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { PaymentPlanEditor, type TripInstallmentSchedule } from "./PaymentPlanEditor";

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
  /**
   * ORCH-0873 [Tr3 Stage 2 UI] — payment plan schedule (Tr3). Null when
   * the trip is single-payment. Persisted to
   * trip_pricing_tiers.tier_metadata.installments via updateTripPricing.
   */
  paymentPlan: TripInstallmentSchedule | null;
  /**
   * ORCH-0873 — true when at least one installment-plan booking has been
   * made on this trip; locks the editor into read-only banner v3 (Q6).
   */
  paymentPlanLocked: boolean;
}

export interface TripCreatorStep4PricingProps {
  draft: Step4Draft;
  onChange: (patch: Partial<Step4Draft>) => void;
  disabled?: boolean;
  /**
   * ORCH-0876 — present when the operator is editing a published trip.
   * `soldCountForTier` is the confirmed-order count against the single
   * default tier. When > 0, price is rendered read-only with a
   * "Refund first" hint because the server's refund-gate rejects
   * `tier_price_change_with_sales`. Tier-name and payment-plan toggles
   * remain editable (additive). Mirrors the event-side
   * `editMode.soldCountByTier` pattern.
   */
  editMode?: {
    soldCountForTier: number;
  };
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

export const TripCreatorStep4Pricing: React.FC<TripCreatorStep4PricingProps> = ({
  draft,
  onChange,
  disabled,
  editMode,
}) => {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const priceCents = Math.round((parseFloat(draft.priceMajor) || 0) * 100);
  const planEnabled = draft.paymentPlan !== null;
  // ORCH-0876 — read-only price when at least one confirmed booking exists
  // for this tier. Server-side `tier_price_change_with_sales` blocks any
  // attempt; this just removes the editable affordance for clarity.
  const priceLocked = (editMode?.soldCountForTier ?? 0) > 0;

  // ORCH-0873 default schedule when toggle flips on: 25% deposit + 2 future
  // installments at 50%/25% pct at 30/60 days (matches DESIGN §3 Mockup A
  // initial state).
  const handleTogglePlan = useCallback(
    (next: boolean) => {
      if (next === planEnabled) return;
      if (next) {
        onChange({
          paymentPlan: {
            deposit_pct: 25,
            installments: [
              { ordinal: 1, pct: 50, days_after_booking: 30 },
              { ordinal: 2, pct: 25, days_after_booking: 60 },
            ],
          },
        });
        return;
      }
      // Toggle-off requires confirm — destroying a configured plan is
      // destructive (the planner loses their schedule). Per DESIGN §3.
      setConfirmRemoveOpen(true);
    },
    [onChange, planEnabled],
  );

  const handleConfirmRemovePlan = useCallback(() => {
    setConfirmRemoveOpen(false);
    onChange({ paymentPlan: null });
  }, [onChange]);

  return (
    <View style={styles.host}>
      <Text style={styles.helper}>
        Single full-price tier in this milestone. Optional payment plan below.
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
          {priceLocked ? (
            <View style={styles.readonlyField} testID="trip-step4-price-readonly">
              <Text style={styles.readonlyValue}>{draft.priceMajor || "—"}</Text>
            </View>
          ) : (
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
          )}
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

      {priceLocked ? (
        <Text style={styles.lockedHint} testID="trip-step4-price-locked-hint">
          Existing travelers are protected at the price they paid. Refund
          all {editMode?.soldCountForTier ?? 0} buyer
          {(editMode?.soldCountForTier ?? 0) === 1 ? "" : "s"} before changing
          this price (or add a new tier at the new price).
        </Text>
      ) : null}

      {/* ORCH-0873 [Tr3 Stage 2 UI] — Payment plan toggle + editor */}
      <View style={styles.paymentPlanSection}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Payment plan toggle"
          accessibilityState={{
            checked: planEnabled,
            disabled: disabled === true || draft.paymentPlanLocked,
          }}
          onPress={() => {
            if (disabled === true || draft.paymentPlanLocked) return;
            handleTogglePlan(!planEnabled);
          }}
          style={styles.paymentPlanToggleRow}
        >
          <View style={styles.paymentPlanToggleLeft}>
            <Text style={styles.paymentPlanTitle}>Payment plan</Text>
            <Text style={styles.paymentPlanSubtitle}>
              {draft.paymentPlanLocked
                ? "Locked — at least one buyer has booked under this schedule."
                : planEnabled
                  ? "Buyer pays a deposit at booking; remaining installments auto-charge on schedule."
                  : "Collect a deposit at booking, then auto-charge installments on a schedule you set."}
            </Text>
          </View>
          <Switch
            value={planEnabled}
            onValueChange={handleTogglePlan}
            disabled={disabled === true || draft.paymentPlanLocked}
            trackColor={{ false: "rgba(255,255,255,0.16)", true: accent.warm }}
            thumbColor="#ffffff"
            ios_backgroundColor="rgba(255,255,255,0.16)"
            accessibilityLabel="Payment plan toggle switch"
          />
        </Pressable>
        {planEnabled || draft.paymentPlanLocked ? (
          <PaymentPlanEditor
            value={draft.paymentPlan}
            onChange={(next) => onChange({ paymentPlan: next })}
            totalAmountCents={priceCents}
            currency={draft.currency}
            locked={draft.paymentPlanLocked}
          />
        ) : null}
      </View>

      <ConfirmDialog
        visible={confirmRemoveOpen}
        title="Remove payment plan?"
        description="This trip will revert to single payment. Your current schedule will be discarded."
        confirmLabel="Remove plan"
        variant="simple"
        destructive
        onConfirm={handleConfirmRemovePlan}
        onClose={() => setConfirmRemoveOpen(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
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
  lockedHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.32)",
  },
  // ORCH-0873 [Tr3 Stage 2 UI] payment plan section styles
  paymentPlanSection: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  paymentPlanToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    minHeight: 56,
  },
  paymentPlanToggleLeft: {
    flex: 1,
    paddingRight: spacing.md,
  },
  paymentPlanTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  paymentPlanSubtitle: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});

// Reference the imported semantic token to keep tree-shaking honest in case
// of future styling additions.
void semantic;

export default TripCreatorStep4Pricing;
