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
  color,
  space,
  type,
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
            <Icon name="edit" size={18} color={color.text2} />
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
            <Icon name="edit" size={18} color={color.text2} />
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
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  card: {
    borderRadius: 12,
    padding: space[4],
    backgroundColor: color.fill.tile,
    gap: space[2],
    borderWidth: 1,
    borderColor: color.line,
  },
  cardOpen: {
    borderColor: color.lineStrong,
  },
  cardHead: {
    minHeight: 64,
    justifyContent: "center",
    gap: space[2],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  labelCap: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  valueCol: {
    flex: 1,
    gap: 2,
  },
  value: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  slugLine: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  // The wrapped editors carry the step-host padH themselves — pull it back so
  // they align inside the card.
  editorHost: {
    marginHorizontal: -space[6],
  },
});

export default ClaimStepPlace;
