/**
 * ClaimStepPitch (c5) — ORCH-1263 DESIGN §6.6: 41% pre-drafted / 59% honest
 * empty. Only OUR generative summary pre-fills (OQ-2 — a Google-authored
 * editorial summary rides the snapshot as AI seed only). `Start fresh` is the
 * one field where "delete the draft" is a real intent. The claim pitch may be
 * EMPTY (the AI pitch flow still exists post-submit); entered text needs ≥20
 * chars (venueStepError c5).
 *
 * META-ORCH-1290 Leg B (D-4) — the body is now the SHARED `VenuePitchField`
 * (also the create-wizard s6 + the listing page), so the single Pitch field
 * behaves identically everywhere. No in-wizard AI generation (the venue row
 * does not exist until submit — `onGenerate` omitted); the seeded note +
 * provenance chip + "Start fresh" are preserved.
 */

import React from "react";
import { StyleSheet, View } from "react-native";

import { spacing } from "../../../constants/designSystem";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import { venueStepError } from "../venueWizardValidation";
import { VenuePitchField } from "../VenuePitchField";

export interface ClaimStepPitchProps {
  showErrors: boolean;
}

export const ClaimStepPitch: React.FC<ClaimStepPitchProps> = ({
  showErrors,
}) => {
  const draft = useDraftVenueStore();
  const patch = useDraftVenueStore((s) => s.patch);
  const chip = provenanceFor("pitch", draft);
  const seeded =
    draft.claim?.adopted.summarySource === "generative" &&
    (draft.claim?.adopted.summary ?? "").trim().length > 0;
  const err = showErrors ? venueStepError("c5", draft) : null;

  return (
    <View style={styles.host}>
      <VenuePitchField
        value={draft.description}
        onChangeText={(t) => patch({ description: t })}
        showTitle
        errorText={err}
        provenanceChip={chip === "adopted" || chip === "edited" ? chip : null}
        seededNote={seeded}
        onStartFresh={() => patch({ description: "" })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
});

export default ClaimStepPitch;
