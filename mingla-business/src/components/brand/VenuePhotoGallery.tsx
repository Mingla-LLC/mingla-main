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



import { color, space, type, radius } from "../../constants/designSystem";
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
    gap: space[2],
    width: "100%",
  },
  title: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  row: {
    gap: space[2],
    paddingVertical: space[1],
  },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
    backgroundColor: color.fill.tabOn,
  },
});

export default VenuePhotoGallery;
