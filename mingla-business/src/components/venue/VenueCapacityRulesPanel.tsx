/**
 * META-ORCH-1148 sub-ORCH 2.1a — Smart Capacity Rules panel (MVP).
 *
 * A collapsible panel rendering ONLY the 3 MVP rule kinds (party_fit /
 * deposit_threshold / blackout_scope — capacityRules.ts is the single source).
 * party_fit is enforced server-side (display-only here); deposit_threshold takes
 * a party-size param (in the brand's default currency context); blackout_scope
 * is informational (the scope is chosen per-blackout in the Availability sheet).
 *
 * All Pressables carry a11y labels (I-39). No dead taps.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

import { useRouter } from "expo-router";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { ChevronDown, ChevronUp, LayoutGrid } from "lucide-react-native";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useVenueReservationSettings } from "../../hooks/useVenueReservationSettings";
import {
  formatCurrency,
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "../../utils/currency";
import {
  brandStripeOnboardingRoute,
  paidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
import { BrandSwitch } from "../ui/BrandSwitch";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import {
  CAPACITY_RULE_CATALOG,
  depositRuleBlocksGuests,
  depositThresholdFeeCents,
  depositThresholdMinParty,
  validateDepositRule,
  type DepositRuleProblem,
} from "./capacityRules";
import {
  brandPayoutReadiness,
  canEnablePaidReservationFee,
  paidFeeIsActive,
} from "./venueFeeGate";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import {
  useUpsertCapacityRule,
  useVenueCapacityRules,
} from "../../hooks/useVenueCapacityRules";
import type { VenueCapacityRule } from "../../types/venueReservation";

export interface VenueCapacityRulesPanelProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue this panel is scoped to. */
  venueId?: string | null;
  canMutate: boolean;
  testID?: string;
}

export function VenueCapacityRulesPanel({
  brandId,
  venueId = null,
  canMutate,
  testID,
}: VenueCapacityRulesPanelProps): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const rulesQuery = useVenueCapacityRules(brandId, venueId);
  const upsert = useUpsertCapacityRule(brandId, venueId);

  const byKind = useMemo<Record<string, VenueCapacityRule | undefined>>(() => {
    const map: Record<string, VenueCapacityRule | undefined> = {};
    for (const r of rulesQuery.data ?? []) map[r.kind] = r;
    return map;
  }, [rulesQuery.data]);

  const partyFit = byKind["party_fit"];
  const deposit = byKind["deposit_threshold"];
  const depositValue = depositThresholdMinParty(deposit?.params);
  const [depositDraft, setDepositDraft] = useState<string>("");

  // Keep the deposit input synced to the persisted value when not editing.
  const depositInput = depositDraft || (depositValue != null ? String(depositValue) : "");

  // #3387 — the deposit rule used to save ONLY a party size, always active,
  // with no amount and no off switch. When the reservation fee was off, every
  // party at that size was refused at booking (`deposit_amount_unconfigured`)
  // and the guest saw a generic error. The rule now has its own switch and
  // amount, and can't be switched on in a state that refuses guests.
  const router = useRouter();
  const brand = useCurrentBrand();
  const currency = normalizeCurrency(brand?.defaultCurrency);
  const settingsQuery = useVenueReservationSettings(brandId, venueId);
  const reservationFeeCents = settingsQuery.data?.feeAmountCents ?? null;
  const reservationFeeActive = paidFeeIsActive(
    settingsQuery.data?.feeEnabled ?? false,
    reservationFeeCents,
  );
  const payoutReady = canEnablePaidReservationFee(
    brandPayoutReadiness({
      stripeStatus: brand?.stripeStatus,
      paystackSubaccountCode: brand?.paystackSubaccountCode ?? null,
    }),
  );
  const savedDepositActive = deposit?.isActive === true;
  const savedDepositCents = depositThresholdFeeCents(deposit?.params);
  const [depositPendingOn, setDepositPendingOn] = useState<boolean>(false);
  const [depositProblem, setDepositProblem] =
    useState<DepositRuleProblem | null>(null);
  const [amountDraft, setAmountDraft] = useState<string>("");
  useEffect(() => {
    setAmountDraft(
      savedDepositCents !== null
        ? String(majorFromMinor(savedDepositCents, currency))
        : "",
    );
  }, [savedDepositCents, currency]);
  const amountCents = useMemo<number>(() => {
    const major = Number.parseFloat(amountDraft.replace(/,/g, ""));
    if (!Number.isFinite(major) || major <= 0) return 0;
    return minorFromMajor(major, currency);
  }, [amountDraft, currency]);
  const depositOn = savedDepositActive || depositPendingOn;
  const depositBlocking = depositRuleBlocksGuests({
    isActive: savedDepositActive,
    params: deposit?.params,
    reservationFeeActive,
  });
  const payoutGuard = paidPublishGuardCopy("stripe_charges_disabled");

  const togglePartyFit = useCallback(
    (next: boolean): void => {
      if (!canMutate) return;
      upsert.mutate({
        id: partyFit?.id,
        kind: "party_fit",
        params: {},
        isActive: next,
      });
    },
    [canMutate, upsert, partyFit],
  );

  const saveDeposit = useCallback((): void => {
    if (!canMutate) return;
    const verdict = validateDepositRule({
      partySizeInput: depositInput,
      amountCents,
      reservationFeeActive,
      payoutReady,
    });
    if (!verdict.ok) {
      setDepositProblem(verdict.problem);
      return;
    }
    setDepositProblem(null);
    upsert.mutate(
      {
        id: deposit?.id,
        kind: "deposit_threshold",
        params: verdict.params,
        isActive: true,
      },
      {
        onSuccess: () => {
          setDepositPendingOn(false);
          setDepositDraft("");
        },
      },
    );
  }, [
    amountCents,
    canMutate,
    deposit,
    depositInput,
    payoutReady,
    reservationFeeActive,
    upsert,
  ]);

  // #3387 — OFF always works (and keeps the saved party size/amount for next
  // time). ON only writes when the draft is valid; otherwise the form opens
  // with the reason, and nothing that would refuse guests is saved.
  const toggleDeposit = useCallback(
    (next: boolean): void => {
      if (!canMutate) return;
      if (!next) {
        setDepositPendingOn(false);
        setDepositProblem(null);
        if (savedDepositActive && deposit !== undefined) {
          upsert.mutate({
            id: deposit.id,
            kind: "deposit_threshold",
            params: deposit.params ?? {},
            isActive: false,
          });
        }
        return;
      }
      setDepositPendingOn(true);
      saveDeposit();
    },
    [canMutate, deposit, saveDeposit, savedDepositActive, upsert],
  );

  // ORCH-1190 #4 — clearly-affordanced accordion matching the Home To-do toggle
  // (GlassCard wrapper + icon + bold title + chevron, LayoutAnimation on toggle).
  const toggleOpen = useCallback((): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  }, []);

  return (
    <GlassCard
      variant="base"
      padding={spacing.md}
      style={styles.host}
      testID={testID ?? "venue-capacity-rules-panel"}
    >
      <Pressable
        onPress={toggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Smart capacity rules, ${open ? "tap to collapse" : "tap to expand"}`}
        style={styles.header}
        testID="venue-capacity-rules-toggle"
      >
        <View style={styles.headerLeft}>
          <LayoutGrid size={16} color={accent.warm} />
          <Text style={styles.headerTitle}>Smart capacity rules</Text>
        </View>
        {open ? (
          <ChevronUp size={18} color={textTokens.secondary} />
        ) : (
          <ChevronDown size={18} color={textTokens.secondary} />
        )}
      </Pressable>

      {open ? (
        <View style={styles.bodyOpen}>
          {/* party_fit — enforced server-side; toggle only. */}
          <View style={styles.rule}>
            <View style={styles.ruleText}>
              <Text style={styles.ruleTitle}>
                {CAPACITY_RULE_CATALOG.party_fit.label}
              </Text>
              <Text style={styles.ruleSummary}>
                {CAPACITY_RULE_CATALOG.party_fit.summary}
              </Text>
            </View>
            <BrandSwitch
              value={partyFit?.isActive ?? true}
              onValueChange={togglePartyFit}
              disabled={!canMutate || upsert.isPending}
              accessibilityLabel="Party fit rule toggle"
              testID="venue-rule-party-fit-toggle"
            />
          </View>

          {/* deposit_threshold — #3387: own switch + party size + amount. */}
          <View style={styles.ruleColumn}>
            <View style={styles.rule}>
              <View style={styles.ruleText}>
                <Text style={styles.ruleTitle}>
                  {CAPACITY_RULE_CATALOG.deposit_threshold.label}
                </Text>
                <Text style={styles.ruleSummary}>
                  {CAPACITY_RULE_CATALOG.deposit_threshold.summary}
                </Text>
              </View>
              <BrandSwitch
                value={depositOn}
                onValueChange={toggleDeposit}
                disabled={!canMutate || upsert.isPending}
                accessibilityLabel="Deposit for large parties toggle"
                testID="venue-rule-deposit-toggle"
              />
            </View>
            {depositBlocking ? (
              <Text
                style={styles.ruleWarn}
                testID="venue-rule-deposit-blocking"
              >
                {depositValue !== null
                  ? `Guests booking for ${depositValue} or more can't book until you set a deposit amount or switch this off.`
                  : "Large parties can't book until you set a deposit amount or switch this off."}
              </Text>
            ) : null}
            {depositOn ? (
              <>
                <Text style={styles.fieldLabel}>
                  {CAPACITY_RULE_CATALOG.deposit_threshold.paramLabel}
                </Text>
                <View style={styles.depositInput}>
                  <Input
                    value={depositInput}
                    onChangeText={(next) => {
                      setDepositDraft(next);
                      setDepositProblem(null);
                    }}
                    variant="number"
                    placeholder="e.g. 8"
                    accessibilityLabel="Party size that needs a deposit"
                    testID="venue-rule-deposit-input"
                  />
                </View>
                <Text style={styles.fieldLabel}>
                  Deposit amount ({currency})
                </Text>
                <View style={styles.depositRow}>
                  <View style={styles.depositInput}>
                    <Input
                      value={amountDraft}
                      onChangeText={(next) => {
                        setAmountDraft(next);
                        setDepositProblem(null);
                      }}
                      variant="number"
                      placeholder="0.00"
                      accessibilityLabel="Deposit amount"
                      testID="venue-rule-deposit-amount"
                    />
                  </View>
                  <Pressable
                    onPress={saveDeposit}
                    disabled={!canMutate || upsert.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Save deposit rule"
                    style={[
                      styles.depositSave,
                      !canMutate ? styles.depositSaveDisabled : null,
                    ]}
                    testID="venue-rule-deposit-save"
                  >
                    <Text style={styles.depositSaveLabel}>Save</Text>
                  </Pressable>
                </View>
                {reservationFeeActive && reservationFeeCents !== null ? (
                  <Text style={styles.ruleSummary}>
                    Leave the amount blank to use your{" "}
                    {formatCurrency(reservationFeeCents, currency, true)}{" "}
                    reservation fee.
                  </Text>
                ) : null}
                {depositProblem !== null ? (
                  <Text
                    style={styles.ruleWarn}
                    testID="venue-rule-deposit-problem"
                  >
                    {depositProblem === "party_size_required"
                      ? "Enter the party size, from 1 to 100, that needs a deposit."
                      : depositProblem === "amount_required"
                      ? "Set a deposit amount above 0. Without one, large parties can't book."
                      : payoutGuard.body}
                  </Text>
                ) : null}
                {depositProblem === "payouts_not_ready" && brandId !== null ? (
                  <Pressable
                    onPress={() =>
                      router.push(brandStripeOnboardingRoute(brandId) as never)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={payoutGuard.actionLabel}
                    style={styles.depositSave}
                    testID="venue-rule-deposit-payout-cta"
                  >
                    <Text style={styles.depositSaveLabel}>
                      {payoutGuard.actionLabel}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>

          {/* ORCH-1190 #6 — the standalone blackout_scope informational block was
              REMOVED. Scope (whole venue / zone / single table) is chosen IN the
              add-blackout flow (Availability → Blackout dates → "Applies to"),
              its single home. ORCH-1190 #5 — the "More rules are coming…"
              footnote was removed. */}
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  host: {
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  // ORCH-1190 #4 — icon + bold title cluster (To-do toggle affordance).
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  bodyOpen: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  rule: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  ruleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  ruleColumn: {
    gap: spacing.xxs,
  },
  ruleTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  ruleSummary: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  depositRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  depositInput: {
    flex: 1,
  },
  depositSave: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  depositSaveDisabled: {
    opacity: 0.4,
  },
  depositSaveLabel: {
    ...typography.bodySm,
    color: "#0c0e12",
    fontWeight: "700",
  },
  // #3387 — deposit rule field labels + warnings.
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.sm,
  },
  ruleWarn: {
    ...typography.bodySm,
    color: semantic.warning,
    marginTop: spacing.xs,
  },
});

export default VenueCapacityRulesPanel;
