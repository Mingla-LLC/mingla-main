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
 *
 * issue #3284 [refund terms on events and experiences] — one editor, three hosts.
 * `offeringType` (default "trip") picks:
 *   - the preset chips: trips keep Flexible/Standard/Strict in months; events and
 *     experiences get the day-scaled presets plus a "No refunds" chip (E2/E3);
 *   - the empty helper (E4) and the noun in the tier accessibility strings (E5).
 * Fixes that apply to every type (trip output otherwise byte-identical): chip gap
 * + split hitSlop so neighbouring chips no longer overlap (E6), 44pt tier inputs
 * and link rows (E7/E11), wrapping tier rows (E8), an AA placeholder (E9), AA
 * error text via semantic.errorText (E10) and a web focus ring (E12).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
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
  EVENT_FLEXIBLE_POLICY,
  EVENT_STANDARD_POLICY,
  EVENT_STRICT_POLICY,
  FLEXIBLE_POLICY,
  NO_REFUNDS_POLICY,
  STANDARD_POLICY,
  STRICT_POLICY,
  type RefundPolicy,
} from "../../services/refundPolicyModel";
import {
  REFUND_POLICY_MAX_TIERS,
  isNoRefundsPolicy,
  validateRefundPolicyTiers,
} from "../../utils/refundPolicyTerms";
import { RefundPolicyDisplay } from "./RefundPolicyDisplay";

const MAX_TIERS = REFUND_POLICY_MAX_TIERS;

/** issue #3284 — which offering the terms belong to (default "trip"). */
export type RefundPolicyOfferingType = "trip" | "event" | "experience";

export interface RefundPolicyEditorProps {
  value: RefundPolicy | null;
  onChange: (next: RefundPolicy | null) => void;
  /** issue #3284 E1 — defaults to "trip", which keeps the shipped trip editor. */
  offeringType?: RefundPolicyOfferingType;
}

interface TemplateChip {
  /** Stable React key + the focus-ring key. */
  key: "flexible" | "standard" | "strict" | "no_refunds";
  label: string;
  policy: RefundPolicy;
}

const TRIP_TEMPLATE_CHIPS: TemplateChip[] = [
  { key: "flexible", label: "Flexible", policy: FLEXIBLE_POLICY },
  { key: "standard", label: "Standard", policy: STANDARD_POLICY },
  { key: "strict", label: "Strict", policy: STRICT_POLICY },
];

// issue #3284 E2 — events and experiences are bought days to weeks ahead, so their
// presets count in days, plus a first-class "No refunds" (most → least generous).
const OFFERING_TEMPLATE_CHIPS: TemplateChip[] = [
  { key: "flexible", label: "Flexible", policy: EVENT_FLEXIBLE_POLICY },
  { key: "standard", label: "Standard", policy: EVENT_STANDARD_POLICY },
  { key: "strict", label: "Strict", policy: EVENT_STRICT_POLICY },
  { key: "no_refunds", label: "No refunds", policy: NO_REFUNDS_POLICY },
];

// issue #3284 E4 — trip copy unchanged; the event/experience copy is true for a
// free offering and a paid one alike.
const EMPTY_HELPER: Record<RefundPolicyOfferingType, string> = {
  trip: "Pick a template or build custom tiers. Set to none for no refunds.",
  event:
    "Pick a template or build your own. If you leave this empty, paid guests are told no policy is set.",
  experience:
    "Pick a template or build your own. If you leave this empty, paid guests are told no policy is set.",
};

/** issue #3284 E3 — the body shown while the "No refunds" chip is selected. */
const NO_REFUNDS_BODY = "Guests can't get a refund after they buy.";

// issue #3284 E6 — the horizontal slop is half the 8pt chip gap, so neighbouring
// chips' hit areas meet in the middle of the gap instead of overlapping.
const CHIP_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 } as const;

// issue #3284 E12 — react-native-web passes `hovered` / `focused` to the style
// callback at runtime; the installed RN types declare only `pressed`.
type WebPressableState = PressableStateCallbackType & {
  hovered?: boolean;
  focused?: boolean;
};
const IS_WEB = Platform.OS === "web";

export const RefundPolicyEditor: React.FC<RefundPolicyEditorProps> = ({
  value,
  onChange,
  offeringType = "trip",
}) => {
  const isTrip = offeringType === "trip";
  const templateChips = isTrip ? TRIP_TEMPLATE_CHIPS : OFFERING_TEMPLATE_CHIPS;
  const standardSeed = isTrip ? STANDARD_POLICY : EVENT_STANDARD_POLICY;
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

  // issue #3284 E12 — which tier input has keyboard focus (web border cue).
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // issue #3284 E3 — on events and experiences, the exact "No refunds" shape is
  // its own selected state (its kind is "custom", but it is not the tier builder).
  const isNoRefundsSelected = !isTrip && isNoRefundsPolicy(value);
  const isCustomMode = value !== null && value.kind === "custom" && !isNoRefundsSelected;
  const errors = useMemo(
    () => (value === null ? [] : validateRefundPolicyTiers(value.tiers)),
    [value],
  );

  const isChipActive = (chip: TemplateChip): boolean => {
    if (value === null) return false;
    if (chip.key === "no_refunds") return isNoRefundsSelected;
    return value.kind === chip.policy.kind;
  };

  const handleTemplateTap = useCallback(
    (chip: TemplateChip) => {
      onChange({ ...chip.policy, tiers: [...chip.policy.tiers] });
      setClearConfirmArmed(false);
    },
    [onChange],
  );

  const handleEnterCustom = useCallback(() => {
    // Seed custom tiers from current template OR standard default. issue #3284 —
    // "No refunds" seeds from Standard instead: a custom copy of its single 0/0
    // tier IS the No-refunds shape, so the builder would never open.
    const seed =
      value !== null && !isNoRefundsSelected ? value : standardSeed;
    onChange({ kind: "custom", tiers: [...seed.tiers] });
    setClearConfirmArmed(false);
  }, [isNoRefundsSelected, onChange, standardSeed, value]);

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
        {templateChips.map((chip) => {
          const active = isChipActive(chip);
          return (
            <Pressable
              key={chip.key}
              testID={`refund-policy-chip-${chip.key}`}
              accessibilityRole="radio"
              accessibilityLabel={`${chip.label} refund policy template`}
              accessibilityState={{ selected: active }}
              accessibilityHint={`Applies the ${chip.label} preset`}
              hitSlop={CHIP_HIT_SLOP}
              onPress={() => handleTemplateTap(chip)}
              style={(state: WebPressableState) => [
                styles.chip,
                active && styles.chipActive,
                IS_WEB && state.hovered === true && !active && styles.chipHovered,
                state.pressed && styles.chipPressed,
                IS_WEB && state.focused === true && styles.focusRing,
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
        <Text style={styles.helper}>{EMPTY_HELPER[offeringType]}</Text>
      )}

      {value !== null && !isCustomMode && (
        <View style={styles.previewWrap}>
          {isNoRefundsSelected ? (
            <Text style={styles.noRefundsBody} testID="refund-policy-no-refunds-body">
              {NO_REFUNDS_BODY}
            </Text>
          ) : (
            <RefundPolicyDisplay policy={value} />
          )}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Build custom tiers"
            hitSlop={8}
            onPress={handleEnterCustom}
            style={(state: WebPressableState) => [
              styles.linkRow,
              state.pressed && styles.linkRowPressed,
              IS_WEB && state.focused === true && styles.focusRing,
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
            const daysKey = `days-${idx}`;
            const pctKey = `pct-${idx}`;
            return (
              <View key={`tier-${idx}`} style={styles.tierRow}>
                <View style={styles.tierFields}>
                  <TextInput
                    style={[
                      styles.tierInput,
                      IS_WEB && focusedInput === daysKey && styles.tierInputFocused,
                      error?.isDaysError && styles.tierInputError,
                    ]}
                    value={draft.days}
                    onChangeText={(t) => handleTierFieldChange(idx, "days", t)}
                    onFocus={() => setFocusedInput(daysKey)}
                    onBlur={() =>
                      setFocusedInput((prev) => (prev === daysKey ? null : prev))
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={textTokens.tertiary}
                    accessibilityLabel={`Tier ${idx + 1} days before ${offeringType} start`}
                    accessibilityHint={`Number of days before the ${offeringType} when this tier applies`}
                  />
                  <Text style={styles.tierLabel}>days before →</Text>
                  <TextInput
                    style={[
                      styles.tierInput,
                      IS_WEB && focusedInput === pctKey && styles.tierInputFocused,
                      error?.isPctError && styles.tierInputError,
                    ]}
                    value={draft.pct}
                    onChangeText={(t) => handleTierFieldChange(idx, "pct", t)}
                    onFocus={() => setFocusedInput(pctKey)}
                    onBlur={() =>
                      setFocusedInput((prev) => (prev === pctKey ? null : prev))
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={textTokens.tertiary}
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
                    style={(state: WebPressableState) => [
                      styles.trashButton,
                      !canRemove && styles.trashButtonDisabled,
                      state.pressed && styles.trashButtonPressed,
                      IS_WEB && state.focused === true && styles.focusRing,
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
            style={(state: WebPressableState) => [
              styles.addTierButton,
              value.tiers.length >= MAX_TIERS && styles.addTierButtonDisabled,
              state.pressed && styles.addTierButtonPressed,
              IS_WEB && state.focused === true && styles.focusRing,
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
        style={(state: WebPressableState) => [
          styles.linkRow,
          state.pressed && styles.linkRowPressed,
          IS_WEB && state.focused === true && styles.focusRing,
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
          style={(state: WebPressableState) => [
            styles.clearKeepButton,
            state.pressed && styles.clearKeepButtonPressed,
            IS_WEB && state.focused === true && styles.focusRing,
          ]}
        >
          <Text style={styles.clearKeepLabel}>Keep</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Confirm clear refund policy"
          hitSlop={8}
          onPress={onTap}
          style={(state: WebPressableState) => [
            styles.clearConfirmButton,
            state.pressed && styles.clearConfirmButtonPressed,
            IS_WEB && state.focused === true && styles.focusRing,
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
    // issue #3284 E6 — was spacing.xs (4) with an 8pt slop: the next chip's slop
    // covered the right edge of the previous chip.
    gap: spacing.sm,
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
  // issue #3284 E12 — web hover on an unselected chip.
  chipHovered: {
    backgroundColor: glass.tint.profileElevated,
  },
  // issue #3284 E12 — web keyboard focus ring (same values as the kit Button).
  focusRing: {
    outlineColor: accent.warm,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
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
  // issue #3284 E3 — the "No refunds" body (13 / text.secondary).
  noRefundsBody: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  linkRow: {
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
    // issue #3284 E11 — a 44pt target (was ≈41pt with its slop).
    minHeight: 44,
    justifyContent: "center",
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
    // issue #3284 E8 — the five-part row overflows a 375pt phone at the largest
    // Dynamic Type sizes; let it wrap.
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  tierInput: {
    minWidth: 56,
    // issue #3284 E7 — a 44pt target (was ≈30pt tall).
    minHeight: 44,
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
  // issue #3284 E12 — web focus cue on a tier input.
  tierInputFocused: {
    borderColor: accent.border,
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
    // issue #3284 E10 — AA error text on the Android opaque card (borders keep
    // semantic.error).
    color: semantic.errorText,
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
