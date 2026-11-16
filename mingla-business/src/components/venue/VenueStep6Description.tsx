/**
 * Ve1 wizard — Step 6: Description + tagline.
 */

import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Input } from "../ui/Input";

const INPUT_BG = color.fill.tile;
const INPUT_BORDER = color.lineStrong;

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
        placeholderTextColor={color.text3}
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
    gap: space[2],
    paddingHorizontal: space[6],
  },
  title: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  lbl: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginTop: space[1],
  },
  area: {
    minHeight: 140,
    padding: space[4],
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    backgroundColor: INPUT_BG,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  err: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
  },
});

export default VenueStep6Description;
