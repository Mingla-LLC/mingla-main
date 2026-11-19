/**
 * #4514 — the brand header every guest-facing form view opens with: the
 * brand's cover, a round logo in an accent ring, and the name over a dark
 * fade. Read live from the brand (never stored on the form), so changing the
 * brand cover changes every form header with no form edit.
 *
 * Fallbacks, as on the public brand page: no cover gives an accent gradient
 * (the brand's hue); no logo gives the first letter of the name in white on
 * the ring. A video or GIF cover shows its poster. `compact` is the 60 px
 * strip used inside a flow.
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import type { Brand } from "../../types/brand";
import { EventCoverMedia } from "../ui/EventCoverMedia";

export interface BrandFormHeaderData {
  displayName: string;
  photo: string | null;
  /** Cover image URL (the poster for a video or GIF cover); null = no cover. */
  coverUrl: string | null;
  coverHue: number;
}

export function brandFormHeaderData(brand: Brand | null): BrandFormHeaderData {
  if (brand === null) {
    return { displayName: "", photo: null, coverUrl: null, coverHue: 25 };
  }
  const coverUrl =
    brand.coverMediaType === "video" || brand.coverMediaType === "gif"
      ? brand.coverMediaPosterUrl ?? null
      : brand.coverMediaUrl ?? null;
  return {
    displayName: brand.displayName,
    photo: brand.photo ?? null,
    coverUrl,
    coverHue: brand.coverHue,
  };
}

export const brandInitial = (name: string): string => {
  const t = name.trim();
  return t.length === 0 ? "•" : t.charAt(0).toUpperCase();
};

export interface BrandFormHeaderProps {
  brand: BrandFormHeaderData;
  compact?: boolean;
  /** "Questions from {brand}" style caption under the name, compact only. */
  caption?: string;
  testID?: string;
}

export const BrandFormHeader: React.FC<BrandFormHeaderProps> = ({
  brand,
  compact = false,
  caption,
  testID = "brand-form-header",
}) => {
  const logoSize = compact ? 36 : 56;
  const height = compact ? 60 : 132;
  return (
    <View
      style={[styles.root, { height }]}
      testID={testID}
      accessibilityRole="header"
      accessibilityLabel={brand.displayName.length > 0 ? `From ${brand.displayName}` : "From the host"}
    >
      <EventCoverMedia
        hue={brand.coverHue}
        mediaUrl={brand.coverUrl}
        mediaType={brand.coverUrl === null ? null : "image"}
        radius={0}
        label=""
        height={height}
      />
      <View style={styles.fade} pointerEvents="none" />
      <View style={styles.identity}>
        <View
          style={[
            styles.ring,
            { width: logoSize, height: logoSize, borderRadius: logoSize / 2 },
          ]}
          testID={`${testID}-logo`}
        >
          {brand.photo !== null && brand.photo.length > 0 ? (
            <Image
              source={{ uri: brand.photo }}
              style={[styles.logo, { borderRadius: (logoSize - 6) / 2 }]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={[styles.initial, compact && styles.initialCompact]}>{brandInitial(brand.displayName)}</Text>
          )}
        </View>
        <View style={styles.names}>
          <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>
            {brand.displayName.length > 0 ? brand.displayName : "Your brand"}
          </Text>
          {compact && caption !== undefined ? (
            <Text style={styles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    width: "100%",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  fade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  identity: {
    position: "absolute",
    left: space[4],
    right: space[4],
    bottom: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  ring: {
    borderWidth: 3,
    borderColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    overflow: "hidden",
  },
  logo: { width: "100%", height: "100%" },
  initial: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  initialCompact: { fontSize: 15 },
  names: { flex: 1, minWidth: 0 },
  name: {
    ...type.title,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 6,
  },
  nameCompact: { ...type.row, color: "#FFFFFF" },
  caption: {
    ...type.caption,
    color: "rgba(255,255,255,0.86)",
  },
});

