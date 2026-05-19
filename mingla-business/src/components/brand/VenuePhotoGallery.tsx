/**
 * Ve4 — horizontal photo gallery for verified public venue pages.
 */

import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface VenuePhotoGalleryProps {
  photoUrls: string[];
}

export const VenuePhotoGallery: React.FC<VenuePhotoGalleryProps> = ({
  photoUrls,
}) => {
  if (photoUrls.length === 0) return null;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Photos</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {photoUrls.map((uri) => (
          <Image
            key={uri}
            source={{ uri }}
            style={styles.thumb}
            accessibilityLabel="Venue photo"
          />
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    width: "100%",
  },
  title: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
  },
});

export default VenuePhotoGallery;
