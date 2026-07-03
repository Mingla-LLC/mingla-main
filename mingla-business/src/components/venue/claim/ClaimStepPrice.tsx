/**
 * ClaimStepPrice (c7) — ORCH-1263 DESIGN §6.8: pre-selected price tiers.
 * The PRICE_TIERS_BIZ chip recipe verbatim (36pt-min chips + hitSlop → ≥44pt
 * effective). Selection required (parity with the deck-readiness must-have).
 *
 * The tier list mirrors VenueDeckReadinessSetup's PRICE_TIERS_BIZ (consumer
 * deck taxonomy, app-mobile priceTiers.ts) — duplicated because that file is
 * DO-NOT-TOUCH for this ORCH; ids must stay in lockstep with the edge
 * PRICE_TIER_ORDER (authoredApply.ts).
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { venueStepError } from "../venueWizardValidation";

const PRICE_TIERS_BIZ: ReadonlyArray<{
  id: string;
  label: string;
  range: string;
}> = [
  { id: "chill", label: "Chill", range: "$50 max" },
  { id: "comfy", label: "Comfy", range: "$50–$150" },
  { id: "bougie", label: "Bougie", range: "$150–$300" },
  { id: "lavish", label: "Lavish", range: "$300+" },
];

export interface ClaimStepPriceProps {
  showErrors: boolean;
}

export const ClaimStepPrice: React.FC<ClaimStepPriceProps> = ({
  showErrors,
}) => {
  const draft = useDraftVenueStore();
  const patch = useDraftVenueStore((s) => s.patch);
  const chip = provenanceFor("price", draft);
  const err = showErrors ? venueStepError("c7", draft) : null;

  const toggle = useCallback(
    (id: string): void => {
      const cur = useDraftVenueStore.getState().priceTiers;
      patch({
        priceTiers: cur.includes(id)
          ? cur.filter((p) => p !== id)
          : [...cur, id],
      });
    },
    [patch],
  );

  return (
    <View style={styles.host}>
      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>PRICE RANGE</Text>
        {chip !== null && chip !== "new" ? (
          <ProvenanceChip state={chip} />
        ) : null}
      </View>
      <Text style={styles.helper}>Pick all that fit a normal visit.</Text>
      <View style={styles.chipRow}>
        {PRICE_TIERS_BIZ.map((tier) => {
          const on = draft.priceTiers.includes(tier.id);
          return (
            <Pressable
              key={tier.id}
              onPress={() => toggle(tier.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${tier.label} ${tier.range}`}
              hitSlop={{ top: 4, bottom: 4 }}
              style={[styles.chip, on && styles.chipActive]}
            >
              <Text style={[styles.chipText, on && styles.chipTextActive]}>
                {tier.label}
              </Text>
              <Text style={[styles.priceRange, on && styles.chipTextActive]}>
                {tier.range}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {err !== null ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  labelCap: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipActive: {
    borderColor: "rgba(255,138,76,0.7)",
    backgroundColor: "rgba(255,138,76,0.16)",
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textTransform: "capitalize",
  },
  chipTextActive: {
    color: textTokens.primary,
    fontWeight: "700",
  },
  priceRange: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default ClaimStepPrice;
