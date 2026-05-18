/**
 * Ve1 wizard — Step 2: Display name + slug.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Input } from "../ui/Input";
import { slugifyBrandSlug } from "../../utils/brandSlugify";

export interface VenueStep2NameSlugProps {
  showErrors: boolean;
  slugError: string | null;
}

export const VenueStep2NameSlug: React.FC<VenueStep2NameSlugProps> = ({
  showErrors,
  slugError,
}) => {
  const displayName = useDraftVenueStore((s) => s.displayName);
  const slug = useDraftVenueStore((s) => s.slug);
  const patch = useDraftVenueStore((s) => s.patch);

  const nameErr =
    showErrors && displayName.trim().length === 0
      ? "Venue name is required."
      : undefined;
  const slugFieldErr =
    slugError ??
    (showErrors && slug.trim().length === 0 ? "Slug is required." : undefined);

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Venue name & web address</Text>
      <Text style={styles.helper}>
        Your public page will use the slug in the URL.
      </Text>
      <Input
        variant="text"
        value={displayName}
        onChangeText={(t) => {
          patch({ displayName: t });
        }}
        placeholder="Venue name"
        accessibilityLabel="Venue display name"
      />
      {nameErr !== undefined ? (
        <Text style={styles.err}>{nameErr}</Text>
      ) : null}
      <Input
        variant="text"
        value={slug}
        onChangeText={(t) => patch({ slug: slugifyBrandSlug(t) })}
        placeholder="your-venue-slug"
        accessibilityLabel="Venue URL slug"
      />
      {slugFieldErr !== undefined ? (
        <Text style={styles.err}>{slugFieldErr}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
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
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default VenueStep2NameSlug;
