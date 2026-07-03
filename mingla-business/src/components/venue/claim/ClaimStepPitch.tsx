/**
 * ClaimStepPitch (c5) — ORCH-1263 DESIGN §6.6: 41% pre-drafted / 59% honest
 * empty. Only OUR generative summary pre-fills (OQ-2 — a Google-authored
 * editorial summary rides the snapshot as AI seed only). `Start fresh` is the
 * one field where "delete the draft" is a real intent. The claim pitch may be
 * EMPTY (the AI pitch flow still exists post-submit); entered text needs ≥20
 * chars (venueStepError c5).
 */

import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { venueStepError } from "../venueWizardValidation";

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
      <Text style={styles.title}>Your pitch</Text>
      {seeded ? (
        <View style={styles.noteRow}>
          <Icon name="sparkle" size={14} color={accent.warm} />
          <Text style={styles.noteText}>
            We wrote a starting point from your listing — make it yours.
          </Text>
        </View>
      ) : null}
      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>PITCH</Text>
        {chip !== null && chip !== "new" ? (
          <ProvenanceChip state={chip} />
        ) : null}
      </View>
      <TextInput
        value={draft.description}
        onChangeText={(t) => patch({ description: t })}
        placeholder="What makes your place worth the trip?"
        placeholderTextColor={textTokens.tertiary}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Venue pitch"
        style={styles.area}
      />
      {seeded && draft.description.trim().length > 0 ? (
        <View style={styles.freshRow}>
          <Button
            label="Start fresh"
            variant="ghost"
            size="sm"
            onPress={() => patch({ description: "" })}
            testID="claim-pitch-start-fresh"
          />
        </View>
      ) : null}
      {!seeded ? (
        <Text style={styles.helper}>
          Tell people what to expect — at least 20 characters, or leave it for
          later. Our AI polishes it after review; honest beats fancy.
        </Text>
      ) : null}
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
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  noteText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.secondary,
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
  area: {
    minHeight: 150,
    padding: spacing.md,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.18)",
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  freshRow: {
    alignItems: "flex-start",
  },
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
    color: textTokens.tertiary,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default ClaimStepPitch;
