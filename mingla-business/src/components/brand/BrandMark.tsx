/**
 * #3355 bug 17 — the brand's logo where a brand is picked or shown.
 *
 * Shows the profile photo Brand Edit saves (`brand.photo`, the
 * `brands.profile_photo_url` column) and falls back to the first letter of the
 * brand name when there is no photo, when the photo is a video, or when the
 * image fails to load.
 */
import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { glass, text as textTokens } from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";

export type BrandMarkBrand = Pick<
  Brand,
  "displayName" | "photo" | "profilePhotoType"
>;

/** The image URL to show for a brand, or null when initials should show. */
export function brandMarkPhotoUrl(brand: BrandMarkBrand): string | null {
  const url = typeof brand.photo === "string" ? brand.photo.trim() : "";
  if (url.length === 0) return null;
  if (brand.profilePhotoType === "video") return null;
  return url;
}

export function brandMarkInitial(brand: BrandMarkBrand): string {
  return brand.displayName.trim().charAt(0).toUpperCase();
}

export interface BrandMarkProps {
  brand: BrandMarkBrand;
  size: number;
  testID?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ brand, size, testID }) => {
  const url = brandMarkPhotoUrl(brand);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = url !== null && failedUrl !== url;
  const frame = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      style={[styles.frame, frame]}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {showPhoto ? (
        <Image
          source={{ uri: url }}
          style={[styles.photo, frame]}
          onError={() => setFailedUrl(url)}
          accessibilityIgnoresInvertColors
          testID={testID !== undefined ? `${testID}-photo` : undefined}
        />
      ) : (
        <Text
          style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}
          testID={testID !== undefined ? `${testID}-initial` : undefined}
        >
          {brandMarkInitial(brand)}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  photo: {
    resizeMode: "cover",
  },
  initial: {
    fontWeight: "700",
    color: textTokens.primary,
  },
});
