/**
 * ClaimStepCategory (c0) — ORCH-1263 DESIGN §6.1: confirm, never fabricate.
 *
 * R-8 is a design kill: 97% of places would silently land "restaurant".
 * Preselect ONLY on a confident mapping (server-computed flag, OQ-D7:
 * drinks_and_music bars are NOT confident); everything else arrives
 * UNSELECTED with honest copy. Both variants force the explicit confirm D-F
 * requires — the wizard cannot pass c0 without a selection.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { VenueCategory } from "../../../types/brand";
import {
  provenanceFor,
  useDraftVenueStore,
} from "../../../store/draftVenueStore";
import { VenueCategoryPicker } from "../../brand/VenueCategoryPicker";
import { useFeatureFlag } from "../../../hooks/useFeatureFlag";
import { ProvenanceChip } from "../../ui/ProvenanceChip";

const CAT_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
  stay: "Stay",
};

export interface ClaimStepCategoryProps {
  showErrors: boolean;
}

export const ClaimStepCategory: React.FC<ClaimStepCategoryProps> = ({
  showErrors,
}) => {
  const stayAuthoringFlag = useFeatureFlag("STAY_VENUE_AUTHORING");
  const draft = useDraftVenueStore();
  const patch = useDraftVenueStore((s) => s.patch);
  const confident = draft.claim?.adopted.categoryConfident === true;
  const adoptedLabel =
    draft.claim !== null && confident
      ? CAT_LABEL[draft.claim.adopted.category]
      : null;
  const chip = provenanceFor("category", draft);
  const err =
    showErrors && draft.venueCategory === null
      ? "Pick a category to continue."
      : null;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>What kind of place is it?</Text>
      <View style={styles.helperRow}>
        <Text style={styles.helper}>
          {confident && adoptedLabel !== null
            ? `Our directory says ${adoptedLabel} — change it if that's not right.`
            : "Pick what fits best — our directory wasn't sure."}
        </Text>
        {chip !== null ? <ProvenanceChip state={chip} /> : null}
      </View>
      <VenueCategoryPicker
        value={draft.venueCategory}
        onChange={(v: VenueCategory) => patch({ venueCategory: v })}
        includeStay={
          stayAuthoringFlag.data === true || draft.venueCategory === "stay"
        }
        stayDisabled={stayAuthoringFlag.data !== true}
        testID="claim-category-picker"
      />
      {err !== null ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  helper: {
    flexShrink: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default ClaimStepCategory;
