/**
 * Ve1 wizard — Step 7: Review + submit.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { VenueCategory } from "../../types/brand";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Button } from "../ui/Button";

const CAT_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
};

export interface VenueStep7ReviewProps {
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}

export const VenueStep7Review: React.FC<VenueStep7ReviewProps> = ({
  submitting,
  submitError,
  onSubmit,
}) => {
  const d = useDraftVenueStore();

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Review & submit</Text>
      <Text style={styles.helper}>
        We’ll verify your venue before it appears publicly — usually within 4
        business hours.
      </Text>
      <View style={styles.card}>
        <Row k="Name" v={d.displayName.trim()} />
        <Row k="Slug" v={d.slug.trim()} />
        <Row k="Category" v={d.venueCategory ? CAT_LABEL[d.venueCategory] : "—"} />
        <Row k="Address" v={d.formattedAddress} />
        <Row k="Contact" v={[d.contactEmail, d.contactPhone].filter(Boolean).join(" · ") || "—"} />
        <Row
          k="Photos"
          v={`${d.photoUris.length} selected`}
        />
        <Row
          k="Description"
          v={
            d.description.trim().length > 120
              ? `${d.description.trim().slice(0, 120)}…`
              : d.description.trim() || "—"
          }
        />
      </View>
      {submitError !== null ? (
        <Text style={styles.err}>{submitError}</Text>
      ) : null}
      <Button
        label={submitting ? "Submitting…" : "Submit for review"}
        onPress={onSubmit}
        variant="primary"
        size="lg"
        loading={submitting}
        disabled={submitting}
      />
    </View>
  );
};

function Row({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  row: {
    gap: 2,
  },
  k: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  v: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default VenueStep7Review;
