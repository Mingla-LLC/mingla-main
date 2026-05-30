/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — <RefundPolicyEditor />.
 *
 * Per SPEC_ORCH-0875 §3.5.1 + DESIGN_ORCH-0875 §2.3 + §5.1.
 *
 * UI:
 *   - 3 template pill chips (Flexible / Standard / Strict) + a Custom chip
 *     that appears as selected when the planner enters custom mode (via
 *     "Build custom tiers" link OR by editing a template's tiers).
 *   - Preview-as-text under chips when a template is selected (no custom).
 *   - Custom mode: tier rows with days_before_start + refund_pct numeric
 *     inputs + trash icon per row. "+ Add tier" button below (max 8).
 *   - Live monotonicity validation on refund_pct + descending days_before_start.
 *   - Inline error text per offending row using semantic.error.
 *
 * I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY (DRAFT) — client-side validation
 * here mirrors the DB CHECK constraint. DB CHECK is authoritative; this is UX
 * shortcut so the planner sees errors immediately rather than on Continue.
 *
 * Toggle ON/OFF lives on the parent (Step 5 Cancellation & deadline section);
 * this component only renders when value !== undefined (parent passes value=null
 * for "no policy yet" and the editor surfaces template chips).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  FLEXIBLE_POLICY,
  STANDARD_POLICY,
  STRICT_POLICY,
  type RefundPolicy,
  type RefundPolicyKind,
  type RefundPolicyTier,
} from "../../services/refundPolicyService";
import { RefundPolicyDisplay } from "./RefundPolicyDisplay";

const MAX_TIERS = 8 as const;

export interface RefundPolicyEditorProps {
  value: RefundPolicy | null;
  onChange: (next: RefundPolicy | null) => void;
}

interface TemplateChip {
  kind: RefundPolicyKind;
  label: string;
  policy: RefundPolicy;
}

const TEMPLATE_CHIPS: TemplateChip[] = [
  { kind: "flexible", label: "Flexible", policy: FLEXIBLE_POLICY },
  { kind: "standard", label: "Standard", policy: STANDARD_POLICY },
  { kind: "strict", label: "Strict", policy: STRICT_POLICY },
];

interface TierValidationError {
  message: string;
  isDaysError: boolean;
  isPctError: boolean;
}

/** Returns inline error per tier (index in same order as policy.tiers). */
function validateTiers(tiers: RefundPolicyTier[]): Array<TierValidationError | null> {
  return tiers.map((tier, idx) => {
    if (
      !Number.isInteger(tier.days_before_start) ||
      tier.days_before_start < 0
    ) {
      return { message: "Days must be 0 or higher.", isDaysError: true, isPctError: false };
    }
    if (
      !Number.isInteger(tier.refund_pct) ||
      tier.refund_pct < 0 ||
      tier.refund_pct > 100
    ) {
      return { message: "Refund % must be between 0 and 100.", isDaysError: false, isPctError: true };
    }
    if (idx > 0) {
      const prev = tiers[idx - 1];
      if (tier.days_before_start >= prev.days_before_start) {
        return {
          message: `Days must count down. Previous tier is ${prev.days_before_start}.`,
          isDaysError: true,
          isPctError: false,
        };
      }
      if (tier.refund_pct > prev.refund_pct) {
        return {
          message: `Refund % must be ≤ ${prev.refund_pct}% (previous tier).`,
          isDaysError: false,
          isPctError: true,
        };
      }
    }
    return null;
  });
}

export const RefundPolicyEditor: React.FC<RefundPolicyEditorProps> = ({
  value,
  onChange,
}) => {
  // Per-tier text drafts so the operator can transiently hold empty/in-progress
  // input (e.g., backspacing "12" → "1" → "") without snapping to "0" mid-type.
  // Drafts are COMMITTED ON EVERY KEYSTROKE (not on blur) to eliminate the
  // draft-vs-value race that caused tier rows to appear erased when the
  // operator tapped elsewhere before blur fired.
  const [tierDrafts, setTierDrafts] = useState<Array<{ days: string; pct: string }>>(
    () =>
      value === null
        ? []
        : value.tiers.map((t) => ({
            days: String(t.days_before_start),
            pct: String(t.refund_pct),
          })),
  );

  // Re-sync drafts when value changes from outside the editor (template-chip
  // tap, add/remove tier). Internal edits already keep drafts and value in
  // lockstep, so this useEffect is a no-op for in-tier typing.
  useEffect(() => {
    setTierDrafts(
      value === null
        ? []
        : value.tiers.map((t) => ({
            days: String(t.days_before_start),
            pct: String(t.refund_pct),
          })),
    );
  }, [value]);

  // Confirm-before-clear state. A single tap arms the confirm; a second tap
  // within the same render commits the clear. Prevents accidental wipe.
  const [clearConfirmArmed, setClearConfirmArmed] = useState<boolean>(false);

  const activeKind: RefundPolicyKind | null = value === null ? null : value.kind;
  const isCustomMode = activeKind === "custom";
  const errors = useMemo(
    () => (value === null ? [] : validateTiers(value.tiers)),
    [value],
  );

  const handleTemplateTap = useCallback(
    (chip: TemplateChip) => {
      onChange({ ...chip.policy });
      setClearConfirmArmed(false);
    },
    [onChange],
  );

  const handleEnterCustom = useCallback(() => {
    // Seed custom tiers from current template OR standard default.
    const seed = value ?? STANDARD_POLICY;
    onChange({ kind: "custom", tiers: [...seed.tiers] });
    setClearConfirmArmed(false);
  }, [onChange, value]);

  const handleClearTap = useCallback(() => {
    if (!clearConfirmArmed) {
      setClearConfirmArmed(true);
      return;
    }
    onChange(null);
    setClearConfirmArmed(false);
  }, [clearConfirmArmed, onChange]);

  const handleClearCancel = useCallback(() => {
    setClearConfirmArmed(false);
  }, []);

  const handleTierFieldChange = useCallback(
    (idx: number, field: "days" | "pct", raw: string) => {
      if (value === null) return;
      // Allow only digits in the draft so the input never holds nonsense.
      const sanitised = raw.replace(/[^0-9]/g, "");
      // 1) Update local text draft so the input visually mirrors what the
      //    operator typed (including transient empties during backspacing).
      setTierDrafts((prev) => {
        const next = [...prev];
        const existing = next[idx] ?? {
          days: String(value.tiers[idx]?.days_before_start ?? 0),
          pct: String(value.tiers[idx]?.refund_pct ?? 0),
        };
        next[idx] = { ...existing, [field]: sanitised };
        return next;
      });
      // 2) ALSO commit to value immediately. Empty string coerces to 0 in the
      //    committed value; the draft preserves "" for display so the operator
      //    can keep typing without seeing a "0" pop in mid-edit.
      const parsed = sanitised === "" ? 0 : Number.parseInt(sanitised, 10);
      const nextTiers = value.tiers.map((t, i) => {
        if (i !== idx) return t;
        return field === "days"
          ? { ...t, days_before_start: parsed }
          : { ...t, refund_pct: parsed };
      });
      onChange({ kind: "custom", tiers: nextTiers });
    },
    [onChange, value],
  );

  const handleAddTier = useCallback(() => {
    if (value === null) return;
    if (value.tiers.length >= MAX_TIERS) return;
    const lowest = value.tiers[value.tiers.length - 1];
    const newDays = Math.max(0, (lowest?.days_before_start ?? 7) - 7);
    const newPct = lowest?.refund_pct ?? 0;
    onChange({
      kind: "custom",
      tiers: [...value.tiers, { days_before_start: newDays, refund_pct: newPct }],
    });
  }, [onChange, value]);

  const handleRemoveTier = useCallback(
    (idx: number) => {
      if (value === null) return;
      if (value.tiers.length <= 1) return;
      onChange({
        kind: "custom",
        tiers: value.tiers.filter((_, i) => i !== idx),
      });
    },
    [onChange, value],
  );

  // --- Render ---
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>REFUND POLICY</Text>

      {/* Template chip row */}
      <View
        style={styles.chipRow}
        accessibilityRole="radiogroup"
        accessibilityLabel="Refund policy template"
      >
        {TEMPLATE_CHIPS.map((chip) => {
          const active = activeKind === chip.kind;
          return (
            <Pressable
              key={chip.kind}
              accessibilityRole="radio"
              accessibilityLabel={`${chip.label} refund policy template`}
              accessibilityState={{ selected: active }}
              accessibilityHint={`Applies the ${chip.label} preset`}
              hitSlop={8}
              onPress={() => handleTemplateTap(chip)}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                pressed && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
        {isCustomMode && (
          <View
            style={[styles.chip, styles.chipActive]}
            accessibilityRole="radio"
            accessibilityLabel="Custom refund policy"
            accessibilityState={{ selected: true }}
          >
            <Text style={[styles.chipLabel, styles.chipLabelActive]}>Custom</Text>
          </View>
        )}
      </View>

      {/* Body — depends on state */}
      {value === null && (
        <Text style={styles.helper}>
          Pick a template or build custom tiers. Set to none for no refunds.
        </Text>
      )}

      {value !== null && !isCustomMode && (
        <View style={styles.previewWrap}>
          <RefundPolicyDisplay policy={value} />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Build custom tiers"
            hitSlop={8}
            onPress={handleEnterCustom}
            style={({ pressed }) => [
              styles.linkRow,
              pressed && styles.linkRowPressed,
            ]}
          >
            <Text style={styles.linkText}>→ Build custom tiers</Text>
          </Pressable>
          <ClearPolicyControl
            armed={clearConfirmArmed}
            onTap={handleClearTap}
            onCancel={handleClearCancel}
          />
        </View>
      )}

      {value !== null && isCustomMode && (
        <View style={styles.tierEditor}>
          <Text style={styles.tierEditorHeader}>If they cancel:</Text>
          {value.tiers.map((tier, idx) => {
            const draft = tierDrafts[idx] ?? {
              days: String(tier.days_before_start),
              pct: String(tier.refund_pct),
            };
            const error = errors[idx];
            const canRemove = value.tiers.length > 1;
            return (
              <View key={`tier-${idx}`} style={styles.tierRow}>
                <View style={styles.tierFields}>
                  <TextInput
                    style={[
                      styles.tierInput,
                      error?.isDaysError && styles.tierInputError,
                    ]}
                    value={draft.days}
                    onChangeText={(t) => handleTierFieldChange(idx, "days", t)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={textTokens.quaternary}
                    accessibilityLabel={`Tier ${idx + 1} days before trip start`}
                    accessibilityHint="Number of days before the trip when this tier applies"
                  />
                  <Text style={styles.tierLabel}>days before →</Text>
                  <TextInput
                    style={[
                      styles.tierInput,
                      error?.isPctError && styles.tierInputError,
                    ]}
                    value={draft.pct}
                    onChangeText={(t) => handleTierFieldChange(idx, "pct", t)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={textTokens.quaternary}
                    accessibilityLabel={`Tier ${idx + 1} refund percentage`}
                    accessibilityHint="Percent refund at this tier"
                  />
                  <Text style={styles.tierLabel}>% refund</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove tier ${idx + 1}`}
                    accessibilityState={{ disabled: !canRemove }}
                    hitSlop={8}
                    onPress={() => handleRemoveTier(idx)}
                    disabled={!canRemove}
                    style={({ pressed }) => [
                      styles.trashButton,
                      !canRemove && styles.trashButtonDisabled,
                      pressed && styles.trashButtonPressed,
                    ]}
                  >
                    <Text style={styles.trashIcon}>×</Text>
                  </Pressable>
                </View>
                {error !== null && error !== undefined && (
                  <Text
                    style={styles.errorText}
                    accessibilityLiveRegion="polite"
                  >
                    {error.message}
                  </Text>
                )}
              </View>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add another refund tier"
            accessibilityState={{ disabled: value.tiers.length >= MAX_TIERS }}
            hitSlop={8}
            onPress={handleAddTier}
            disabled={value.tiers.length >= MAX_TIERS}
            style={({ pressed }) => [
              styles.addTierButton,
              value.tiers.length >= MAX_TIERS && styles.addTierButtonDisabled,
              pressed && styles.addTierButtonPressed,
            ]}
          >
            <Text style={styles.addTierLabel}>
              {value.tiers.length >= MAX_TIERS
                ? `Maximum ${MAX_TIERS} tiers`
                : "+ Add tier"}
            </Text>
          </Pressable>
          <ClearPolicyControl
            armed={clearConfirmArmed}
            onTap={handleClearTap}
            onCancel={handleClearCancel}
          />
        </View>
      )}
    </View>
  );
};

interface ClearPolicyControlProps {
  armed: boolean;
  onTap: () => void;
  onCancel: () => void;
}

const ClearPolicyControl: React.FC<ClearPolicyControlProps> = ({
  armed,
  onTap,
  onCancel,
}) => {
  if (!armed) {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Clear refund policy"
        hitSlop={8}
        onPress={onTap}
        style={({ pressed }) => [
          styles.linkRow,
          pressed && styles.linkRowPressed,
        ]}
      >
        <Text style={styles.linkTextMuted}>Clear policy (no refunds)</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.clearConfirmRow}>
      <Text style={styles.clearConfirmText}>
        Clear refund policy? Buyers will get no refund.
      </Text>
      <View style={styles.clearConfirmButtons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep refund policy"
          hitSlop={8}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.clearKeepButton,
            pressed && styles.clearKeepButtonPressed,
          ]}
        >
          <Text style={styles.clearKeepLabel}>Keep</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Confirm clear refund policy"
          hitSlop={8}
          onPress={onTap}
          style={({ pressed }) => [
            styles.clearConfirmButton,
            pressed && styles.clearConfirmButtonPressed,
          ]}
        >
          <Text style={styles.clearConfirmLabel}>Yes, clear</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 34,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    justifyContent: "center",
  },
  chipActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  chipLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  helper: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  previewWrap: {
    marginTop: spacing.xs,
  },
  linkRow: {
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  linkRowPressed: {
    opacity: 0.7,
  },
  linkText: {
    fontSize: 14,
    color: accent.warm,
    fontWeight: "500",
  },
  linkTextMuted: {
    fontSize: 13,
    color: textTokens.tertiary,
  },
  tierEditor: {
    marginTop: spacing.xs,
  },
  tierEditorHeader: {
    fontSize: 13,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  tierRow: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  tierFields: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  tierInput: {
    minWidth: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: 14,
    textAlign: "center",
  },
  tierInputError: {
    borderColor: semantic.error,
  },
  tierLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  trashButton: {
    marginLeft: "auto",
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  trashButtonDisabled: {
    opacity: 0.3,
  },
  trashButtonPressed: {
    opacity: 0.7,
  },
  trashIcon: {
    fontSize: 18,
    color: textTokens.secondary,
    fontWeight: "300",
  },
  errorText: {
    fontSize: 12,
    color: semantic.error,
    marginTop: spacing.xs,
    paddingLeft: spacing.xs,
  },
  addTierButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: "transparent",
    alignSelf: "flex-start",
    minHeight: 34,
    justifyContent: "center",
  },
  addTierButtonDisabled: {
    opacity: 0.4,
    borderColor: glass.border.profileBase,
  },
  addTierButtonPressed: {
    opacity: 0.7,
  },
  addTierLabel: {
    fontSize: 13,
    color: accent.warm,
    fontWeight: "500",
  },
  clearConfirmRow: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: glass.tint.profileBase,
  },
  clearConfirmText: {
    fontSize: 13,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  clearConfirmButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  clearKeepButton: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    minHeight: 36,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  clearKeepButtonPressed: {
    opacity: 0.7,
  },
  clearKeepLabel: {
    fontSize: 13,
    color: textTokens.secondary,
    fontWeight: "500",
  },
  clearConfirmButton: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.error,
    minHeight: 36,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  clearConfirmButtonPressed: {
    opacity: 0.85,
  },
  clearConfirmLabel: {
    fontSize: 13,
    color: textTokens.primary,
    fontWeight: "600",
  },
});
