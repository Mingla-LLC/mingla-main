/**
 * ClaimStepPlace (c1) — ORCH-1263 DESIGN §6.2: name + address, confirm not
 * re-enter. Two collapsed cards that EXPAND IN PLACE to the EXISTING editors
 * (VenueStep2NameSlug / VenueStep1Address — those files are NOT modified;
 * slug availability + the ORCH-1079 googlePlaceId lock ride along untouched;
 * the design never exposes the pool link to editing).
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import { Icon } from "../../ui/Icon";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { VenueStep1Address } from "../VenueStep1Address";
import { VenueStep2NameSlug } from "../VenueStep2NameSlug";

export interface ClaimStepPlaceProps {
  showErrors: boolean;
  slugError: string | null;
  brandId: string | null;
  brandSlug: string | null;
}

export const ClaimStepPlace: React.FC<ClaimStepPlaceProps> = ({
  showErrors,
  slugError,
  brandId,
  brandSlug,
}) => {
  const draft = useDraftVenueStore();
  const [openCard, setOpenCard] = useState<"name" | "address" | null>(null);
  const nameChip = provenanceFor("name", draft);
  const addressChip = provenanceFor("address", draft);
  const slugLine = `usemingla.com/b/${brandSlug ?? "your-brand"}/v/${draft.slug.trim() || "your-venue"}`;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Is this right?</Text>
      <Text style={styles.helper}>
        This is what we have on file — tap a card to change it.
      </Text>

      {/* Name & link card */}
      <View
        style={[styles.card, openCard === "name" && styles.cardOpen]}
      >
        <Pressable
          onPress={() =>
            setOpenCard((c) => (c === "name" ? null : "name"))
          }
          accessibilityRole="button"
          accessibilityLabel={`Name and link: ${draft.displayName}, from your existing listing. Tap to edit.`}
          style={styles.cardHead}
          testID="claim-place-name-card"
        >
          <View style={styles.labelRow}>
            <Text style={styles.labelCap}>NAME &amp; LINK</Text>
            {nameChip !== null ? <ProvenanceChip state={nameChip} /> : null}
          </View>
          <View style={styles.valueRow}>
            <View style={styles.valueCol}>
              <Text style={styles.value} numberOfLines={2}>
                {draft.displayName}
              </Text>
              <Text style={styles.slugLine} numberOfLines={1}>
                {slugLine}
              </Text>
            </View>
            <Icon name="edit" size={18} color={textTokens.secondary} />
          </View>
        </Pressable>
        {openCard === "name" ? (
          <View style={styles.editorHost}>
            <VenueStep2NameSlug
              showErrors={showErrors}
              slugError={slugError}
              brandId={brandId}
              brandSlug={brandSlug}
            />
          </View>
        ) : null}
      </View>

      {/* Address card */}
      <View
        style={[styles.card, openCard === "address" && styles.cardOpen]}
      >
        <Pressable
          onPress={() =>
            setOpenCard((c) => (c === "address" ? null : "address"))
          }
          accessibilityRole="button"
          accessibilityLabel={`Address: ${draft.formattedAddress}, from your existing listing. Tap to edit.`}
          style={styles.cardHead}
          testID="claim-place-address-card"
        >
          <View style={styles.labelRow}>
            <Text style={styles.labelCap}>ADDRESS</Text>
            {addressChip !== null ? (
              <ProvenanceChip state={addressChip} />
            ) : null}
          </View>
          <View style={styles.valueRow}>
            <Text style={[styles.value, styles.valueCol]} numberOfLines={2}>
              {draft.formattedAddress}
            </Text>
            <Icon name="edit" size={18} color={textTokens.secondary} />
          </View>
        </Pressable>
        {openCard === "address" ? (
          <View style={styles.editorHost}>
            <VenueStep1Address showErrors={showErrors} />
          </View>
        ) : null}
      </View>
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
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  card: {
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0)",
  },
  cardOpen: {
    borderColor: glass.border.profileElevated,
  },
  cardHead: {
    minHeight: 64,
    justifyContent: "center",
    gap: spacing.sm,
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
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  valueCol: {
    flex: 1,
    gap: spacing.xxs,
  },
  value: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  slugLine: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  // The wrapped editors carry the step-host padH themselves — pull it back so
  // they align inside the card.
  editorHost: {
    marginHorizontal: -spacing.lg,
  },
});

export default ClaimStepPlace;
