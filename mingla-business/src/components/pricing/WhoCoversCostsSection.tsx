/**
 * ORCH-1006 [Universal all-in pricing engine] — Surface 1 + 3 + 4.
 *
 * The "Who covers the costs?" authoring section. ONE shared component mounted
 * into every format's pricing step (event / trip / experience) — universal
 * authoring, never brand-kind-conditional.
 *
 * The brand makes a money-policy decision (who eats each cost), not a styling
 * one. The hero of the section is the live "Buyer pays" preview that turns an
 * abstract toggle into a real decision.
 *
 * Surfaces folded in here:
 *   - Surface 1: the three pass/absorb segmented rows + live preview chip.
 *   - Surface 3: `locked` → read-only resolved values + lock chip + reason
 *     (mirrors the server `pricing_switches_locked` post-sale guard).
 *   - Surface 4: VAT row swaps to a "Set up VAT" nudge when the brand has no
 *     active tax registration (`vatRegistered !== true`) — fail-closed to
 *     absorb, never offers a VAT it can't collect.
 *
 * Money math: the preview "Buyer pays" is EXACT for GB inclusive VAT (no tax
 * round-trip needed). See `utils/pricingPreview.ts` for the honest-limit on the
 * "You keep" figure (flat-absorb floor, labelled "before VAT").
 *
 * Tokens: business is a DARK system — `text.*` (white-alpha), `accent.warm`,
 * `semantic.*`, `glass.*` from `constants/designSystem`. No light-mode palette.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { computePreview } from "../../utils/pricingPreview";
import type {
  BrandPricingDefaults,
  PricingSwitchOverrides,
} from "../../services/pricingSwitchesService";
import { resolveSwitches } from "../../services/pricingSwitchesService";
import { Icon, type IconName } from "../ui/Icon";

export type OfferingFormat = "event" | "trip" | "experience";

type SwitchKey = "passTax" | "passMinglaFee" | "passServiceFee";

interface SwitchRowDef {
  key: SwitchKey;
  label: string;
  icon: IconName;
  /** Segment labels: [passed, absorbed]. */
  passLabel: string;
  absorbLabel: string;
  /** Sub-label shown for each resolved state. */
  subPassed: string;
  subAbsorbed: string;
  /** Read-only value text shown when locked (Surface 3). */
  lockedPassed: string;
  lockedAbsorbed: string;
}

// Final lexicon (design §1.8 / §2.2 / §5). VAT never implies a buyer price
// change in GB — "Included in price" vs "I'll cover it" (NOT pass/absorb).
const ROWS: SwitchRowDef[] = [
  {
    key: "passTax",
    label: "VAT",
    icon: "receipt",
    passLabel: "Included in price",
    absorbLabel: "I'll cover it",
    subPassed: "VAT sits inside the price buyers see.",
    subAbsorbed: "You account for the VAT yourself.",
    lockedPassed: "Included in price",
    lockedAbsorbed: "You cover it",
  },
  {
    key: "passMinglaFee",
    label: "Mingla fee",
    icon: "sparkle",
    passLabel: "Add to price",
    absorbLabel: "I'll cover it",
    subPassed: "Buyers cover the Mingla fee.",
    subAbsorbed: "You cover the Mingla fee.",
    lockedPassed: "Added to price",
    lockedAbsorbed: "You cover it",
  },
  {
    key: "passServiceFee",
    label: "Service fee",
    icon: "tap",
    passLabel: "Add to price",
    absorbLabel: "I'll cover it",
    subPassed: "Buyers cover the service fee.",
    subAbsorbed: "You cover the service fee.",
    lockedPassed: "Added to price",
    lockedAbsorbed: "You cover it",
  },
];

export interface WhoCoversCostsSectionProps {
  /** Per-offering raw switches; NULL = inherit the brand default. */
  overrides: PricingSwitchOverrides;
  /** Brand-level defaults (resolved at read sites; default false = absorb). */
  defaults: BrandPricingDefaults;
  /** Emits the next override set on toggle. */
  onChange: (next: PricingSwitchOverrides) => void;
  /** Representative single-ticket price in CENTS for the live preview. */
  previewBaseCents: number;
  /** ISO 4217 currency (drives the money helper — never hardcode £). */
  currency: string;
  /** Mingla take-rate in bps (brand override or platform default). */
  effectiveTakeRateBps: number;
  /** Surface 3 — sold a ticket → read-only. */
  locked?: boolean;
  /**
   * Surface 4 — `true` = registered (VAT row interactive); `false`/`undefined`
   * = no active registration (nudge, VAT fail-closed to absorb).
   */
  vatRegistered?: boolean;
  /** Deep-link to the embedded tax-registrations page (Surface 4 nudge). */
  onSetupVat?: () => void;
  /** Deep-link to Surface 2 (brand pricing defaults). */
  onEditDefaults?: () => void;
  /** Which format this is mounted in (drives the "{event}" copy). */
  format: OfferingFormat;
  testID?: string;
}

const FORMAT_NOUN: Record<OfferingFormat, string> = {
  event: "event",
  trip: "trip",
  experience: "experience",
};

export const WhoCoversCostsSection: React.FC<WhoCoversCostsSectionProps> = ({
  overrides,
  defaults,
  onChange,
  previewBaseCents,
  currency,
  effectiveTakeRateBps,
  locked = false,
  vatRegistered,
  onSetupVat,
  onEditDefaults,
  format,
  testID,
}) => {
  const resolved = resolveSwitches(overrides, defaults);
  const hasPrice = Number.isFinite(previewBaseCents) && previewBaseCents > 0;
  const vatUnregistered = vatRegistered !== true;

  // Surface 4: a brand can't pass a VAT it can't collect. Force the resolved
  // VAT switch to absorbed for the preview when unregistered (fail-closed).
  const previewSwitches = {
    passTax: vatUnregistered ? false : resolved.passTax,
    passMinglaFee: resolved.passMinglaFee,
    passServiceFee: resolved.passServiceFee,
  };

  const preview = useMemo(
    () =>
      computePreview({
        baseCents: previewBaseCents,
        switches: previewSwitches,
        effectiveTakeRateBps,
      }),
    [
      previewBaseCents,
      previewSwitches.passTax,
      previewSwitches.passMinglaFee,
      previewSwitches.passServiceFee,
      effectiveTakeRateBps,
    ],
  );

  const isOverridden =
    overrides.passTax !== null ||
    overrides.passMinglaFee !== null ||
    overrides.passServiceFee !== null;

  const handleToggle = (key: SwitchKey, pass: boolean): void => {
    onChange({ ...overrides, [key]: pass });
  };

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title}>Who covers the costs?</Text>
      <Text style={styles.frame}>Buyers always see one all-in price.</Text>

      <View style={styles.rows}>
        {ROWS.map((row, i) => {
          const resolvedPass = resolved[row.key];
          const isLast = i === ROWS.length - 1;
          const isVatNudge = row.key === "passTax" && vatUnregistered && !locked;

          return (
            <View
              key={row.key}
              style={[styles.row, isLast ? null : styles.rowDivider]}
            >
              <View style={styles.rowIconWrap}>
                <Icon
                  name={row.icon}
                  size={20}
                  color={locked ? textTokens.tertiary : textTokens.secondary}
                />
              </View>

              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, locked ? styles.lockedText : null]}
                >
                  {row.label}
                </Text>
                <Text style={styles.rowSub}>
                  {isVatNudge
                    ? "Add VAT once you're registered."
                    : resolvedPass
                      ? row.subPassed
                      : row.subAbsorbed}
                </Text>
              </View>

              {locked ? (
                <Text style={styles.lockedValue}>
                  {resolvedPass ? row.lockedPassed : row.lockedAbsorbed}
                </Text>
              ) : isVatNudge ? (
                <Pressable
                  onPress={onSetupVat}
                  accessibilityRole="button"
                  accessibilityLabel="Set up VAT registration"
                  style={styles.nudgeBtn}
                >
                  <Text style={styles.nudgeLabel}>Set up VAT</Text>
                  <Icon name="chevR" size={14} color={semantic.info} />
                </Pressable>
              ) : (
                <SegmentedToggle
                  passLabel={row.passLabel}
                  absorbLabel={row.absorbLabel}
                  passed={resolvedPass}
                  inherited={overrides[row.key] === null}
                  onSelect={(pass) => handleToggle(row.key, pass)}
                  accessibilityLabelPassed={`${row.label} ${row.subPassed}`}
                  accessibilityLabelAbsorbed={`${row.label} ${row.subAbsorbed}`}
                />
              )}
            </View>
          );
        })}
      </View>

      {/* Preview chip (the hero) — Surface 1 §2.3 */}
      {hasPrice ? (
        <View
          style={styles.previewChip}
          accessibilityRole="summary"
          accessibilityLabel={`Buyer pays ${formatCurrency(
            preview.buyerPaysCents,
            currency,
            true,
          )} all in. You keep ${formatCurrency(
            preview.youKeepFloorCents,
            currency,
            true,
          )} before VAT.`}
        >
          <View style={styles.previewCol}>
            <Text style={styles.previewHead}>Buyer pays</Text>
            <Text style={styles.previewBuyer}>
              {formatCurrency(preview.buyerPaysCents, currency, true)}
            </Text>
            <Text style={styles.previewCaption}>all-in, one tap</Text>
          </View>
          <View style={styles.previewDivider} />
          <View style={styles.previewCol}>
            <Text style={styles.previewHead}>You keep</Text>
            <Text style={styles.previewKeep}>
              {formatCurrency(preview.youKeepFloorCents, currency, true)}
            </Text>
            <Text style={styles.previewCaption}>before VAT</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.emptyHint}>
          Set a price to choose who covers costs.
        </Text>
      )}

      {/* Footer: lock reason (Surface 3) or inherit indicator (§2.4) */}
      {locked ? (
        <View style={styles.lockFooter}>
          <Icon name="shield" size={14} color={textTokens.tertiary} />
          <Text style={styles.lockReason}>
            Pricing locks once your first ticket sells, so every buyer pays on
            the same terms.
          </Text>
        </View>
      ) : (
        <View style={styles.inheritFooter}>
          <Text style={styles.inheritText}>
            {isOverridden
              ? `Customised for this ${FORMAT_NOUN[format]}`
              : "Using your brand defaults"}
          </Text>
          {onEditDefaults ? (
            <Pressable
              onPress={onEditDefaults}
              accessibilityRole="button"
              accessibilityLabel="Edit brand pricing defaults"
              hitSlop={8}
            >
              <Text style={styles.editDefaults}>Edit defaults →</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
};

// ---- Segmented two-option control -----------------------------------

interface SegmentedToggleProps {
  passLabel: string;
  absorbLabel: string;
  passed: boolean;
  /** True when the value is inherited (NULL) — shown with a hairline ring. */
  inherited: boolean;
  onSelect: (pass: boolean) => void;
  accessibilityLabelPassed: string;
  accessibilityLabelAbsorbed: string;
}

const SegmentedToggle: React.FC<SegmentedToggleProps> = ({
  passLabel,
  absorbLabel,
  passed,
  inherited,
  onSelect,
  accessibilityLabelPassed,
  accessibilityLabelAbsorbed,
}) => {
  return (
    <View
      style={[styles.segTrack, inherited ? styles.segTrackInherited : null]}
      accessibilityRole="radiogroup"
    >
      <Pressable
        onPress={() => onSelect(true)}
        accessibilityRole="radio"
        accessibilityState={{ selected: passed }}
        accessibilityLabel={accessibilityLabelPassed}
        style={[styles.seg, passed ? styles.segSelected : null]}
      >
        <Text style={[styles.segLabel, passed ? styles.segLabelSelected : null]}>
          {passLabel}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onSelect(false)}
        accessibilityRole="radio"
        accessibilityState={{ selected: !passed }}
        accessibilityLabel={accessibilityLabelAbsorbed}
        style={[styles.seg, !passed ? styles.segSelected : null]}
      >
        <Text
          style={[styles.segLabel, !passed ? styles.segLabelSelected : null]}
        >
          {absorbLabel}
        </Text>
      </Pressable>
    </View>
  );
};

// ---- Styles (dark token system) -------------------------------------

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  frame: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  rows: {
    borderRadius: radiusTokens.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  rowIconWrap: {
    width: 28,
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  rowLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  lockedText: {
    color: textTokens.tertiary,
  },
  rowSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 1,
  },
  lockedValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
  // Segmented control
  segTrack: {
    flexDirection: "row",
    backgroundColor: glass.tint.backdrop,
    borderRadius: radiusTokens.full,
    padding: 2,
  },
  segTrackInherited: {
    borderWidth: 1,
    borderColor: glass.border.pending,
  },
  seg: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radiusTokens.full,
    minHeight: 32,
    justifyContent: "center",
  },
  segSelected: {
    backgroundColor: accent.warm,
  },
  segLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  segLabelSelected: {
    color: "#ffffff",
  },
  // Surface 4 nudge
  nudgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minHeight: 32,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: semantic.info,
    backgroundColor: semantic.infoTint,
  },
  nudgeLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: "600",
    color: semantic.info,
  },
  // Preview chip
  previewChip: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.backdrop,
  },
  previewCol: {
    flex: 1,
  },
  previewDivider: {
    width: 1,
    backgroundColor: glass.border.profileBase,
    marginHorizontal: spacing.md,
  },
  previewHead: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  previewBuyer: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  previewKeep: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: "700",
    color: semantic.success,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  previewCaption: {
    fontSize: typography.micro.fontSize,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: spacing.md,
  },
  // Footers
  lockFooter: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  lockReason: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  inheritFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  inheritText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  editDefaults: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});

export default WhoCoversCostsSection;
