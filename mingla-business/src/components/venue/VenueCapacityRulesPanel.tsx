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

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import {
  CAPACITY_RULE_CATALOG,
  CAPACITY_RULE_MVP_KINDS,
  depositThresholdMinParty,
} from "./capacityRules";
import {
  useUpsertCapacityRule,
  useVenueCapacityRules,
} from "../../hooks/useVenueCapacityRules";
import type { VenueCapacityRule } from "../../types/venueReservation";

export interface VenueCapacityRulesPanelProps {
  brandId: string | null;
  canMutate: boolean;
  testID?: string;
}

export function VenueCapacityRulesPanel({
  brandId,
  canMutate,
  testID,
}: VenueCapacityRulesPanelProps): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const rulesQuery = useVenueCapacityRules(brandId);
  const upsert = useUpsertCapacityRule(brandId);

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
    const n = parseInt(depositInput, 10);
    if (!Number.isFinite(n) || n < 1) return;
    upsert.mutate({
      id: deposit?.id,
      kind: "deposit_threshold",
      params: { min_party_for_fee: n },
      isActive: true,
    });
    setDepositDraft("");
  }, [canMutate, depositInput, upsert, deposit]);

  return (
    <View style={styles.host} testID={testID ?? "venue-capacity-rules-panel"}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Smart capacity rules"
        style={styles.header}
        testID="venue-capacity-rules-toggle"
      >
        <Text style={styles.headerTitle}>Smart capacity rules</Text>
        <Icon name={open ? "chevU" : "chevD"} size={18} color={textTokens.secondary} />
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
            <Switch
              value={partyFit?.isActive ?? true}
              onValueChange={togglePartyFit}
              disabled={!canMutate || upsert.isPending}
              trackColor={{ false: "rgba(255,255,255,0.16)", true: accent.warm }}
              thumbColor="#ffffff"
              ios_backgroundColor="rgba(255,255,255,0.16)"
              accessibilityLabel="Party fit rule toggle"
              testID="venue-rule-party-fit-toggle"
            />
          </View>

          {/* deposit_threshold — party-size param. */}
          <View style={styles.ruleColumn}>
            <Text style={styles.ruleTitle}>
              {CAPACITY_RULE_CATALOG.deposit_threshold.label}
            </Text>
            <Text style={styles.ruleSummary}>
              {CAPACITY_RULE_CATALOG.deposit_threshold.summary}
            </Text>
            <View style={styles.depositRow}>
              <View style={styles.depositInput}>
                <Input
                  value={depositInput}
                  onChangeText={setDepositDraft}
                  variant="number"
                  placeholder="e.g. 8"
                  accessibilityLabel="Party size that needs a deposit"
                  testID="venue-rule-deposit-input"
                />
              </View>
              <Pressable
                onPress={saveDeposit}
                disabled={!canMutate || upsert.isPending}
                accessibilityRole="button"
                accessibilityLabel="Save deposit threshold"
                style={[
                  styles.depositSave,
                  !canMutate ? styles.depositSaveDisabled : null,
                ]}
                testID="venue-rule-deposit-save"
              >
                <Text style={styles.depositSaveLabel}>Save</Text>
              </Pressable>
            </View>
          </View>

          {/* blackout_scope — informational. */}
          <View style={styles.ruleColumn}>
            <Text style={styles.ruleTitle}>
              {CAPACITY_RULE_CATALOG.blackout_scope.label}
            </Text>
            <Text style={styles.ruleSummary}>
              {CAPACITY_RULE_CATALOG.blackout_scope.summary} Set the scope when you
              add a blackout in Availability.
            </Text>
          </View>

          <Text style={styles.footnote}>
            More rules are coming. These are the {CAPACITY_RULE_MVP_KINDS.length}{" "}
            we honour today.
          </Text>
        </View>
      ) : null}
    </View>
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
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  bodyOpen: {
    gap: spacing.md,
    paddingTop: spacing.xs,
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
  footnote: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});

export default VenueCapacityRulesPanel;
