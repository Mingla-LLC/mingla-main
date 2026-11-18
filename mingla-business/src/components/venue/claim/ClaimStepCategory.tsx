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
  color,
  space,
  type,
} from "../../../constants/designSystem";
import type { VenueCategory } from "../../../types/brand";
import {
  provenanceFor,
  useDraftVenueStore,
} from "../../../store/draftVenueStore";
import { VenueCategoryPicker } from "../../brand/VenueCategoryPicker";
import { useFeatureFlag } from "../../../hooks/useFeatureFlag";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { VENUE_TYPES } from "../../../types/venueFeatures";

// #4490 click-test D10/D12 — one label per type, everywhere a host reads it
// ("Play and games", never "Play"): the nine types' own labels.
const CAT_LABEL: Record<VenueCategory, string> = Object.fromEntries(
  VENUE_TYPES.map((t) => [t.key, t.label]),
) as Record<VenueCategory, string>;

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
        // #4420 (round-3 item 11) — Stay is always listed; the server flag
        // still decides whether it can be picked.
        includeStay
        stayDisabled={stayAuthoringFlag.data !== true}
        // #4490 — show which features each of the nine types starts with.
        showPreset
        testID="claim-category-picker"
      />
      {err !== null ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[4],
    paddingHorizontal: space[6],
    paddingBottom: space[7],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  helperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  helper: {
    flexShrink: 1,
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  err: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
  },
});

export default ClaimStepCategory;
