/**
 * Ve1 wizard — Step 6: Description + tagline.
 */

import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Input } from "../ui/Input";

const INPUT_BG = "rgba(255,255,255,0.06)";
const INPUT_BORDER = "rgba(255,255,255,0.12)";

export interface VenueStep6DescriptionProps {
  showErrors: boolean;
}

export const VenueStep6Description: React.FC<VenueStep6DescriptionProps> = ({
  showErrors,
}) => {
  const description = useDraftVenueStore((s) => s.description);
  const tagline = useDraftVenueStore((s) => s.tagline);
  const patch = useDraftVenueStore((s) => s.patch);

  const err =
    showErrors && description.trim().length < 20
      ? "Description must be at least 20 characters."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Tell guests what to expect</Text>
      <Input
        variant="text"
        value={tagline}
        onChangeText={(t) => patch({ tagline: t })}
        placeholder="Short tagline (optional)"
        accessibilityLabel="Venue tagline"
      />
      <Text style={styles.lbl}>Description</Text>
      <TextInput
        value={description}
        onChangeText={(t) => patch({ description: t })}
        placeholder="What makes this venue special?"
        placeholderTextColor={textTokens.tertiary}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Venue description"
        style={styles.area}
      />
      {err !== undefined ? <Text style={styles.err}>{err}</Text> : null}
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
  lbl: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  area: {
    minHeight: 140,
    padding: spacing.md,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    backgroundColor: INPUT_BG,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default VenueStep6Description;
