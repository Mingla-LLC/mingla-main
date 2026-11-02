/**
 * AddressMapPreview — the map preview under a Host address field.
 *
 * ORCH-1186 (salvaged from ORCH-1158 Issue 3 [wizard-map-preview]) built this
 * inline in the event "Where" step. #3355 moved it here, unchanged, so Brand
 * Edit's address field shows the SAME preview instead of a fork.
 *
 * REAL static map (via the vendor-neutral `static-map` server proxy) for the
 * picked address's coords: buildStaticMapUrl(lat,lng,accent) → plain <Image>
 * (no map SDK, works native + react-native-web). REAL-DATA-ONLY (rule 9):
 * until an address is picked (no coords) OR the proxy base URL is absent at
 * runtime, it shows the honest "pick an address" empty state — never a fake
 * tile.
 *
 * Issue #1363 — honest precision rendering: an APPROXIMATE (free-text)
 * coordinate renders at a lower zoom + an "Approximate location" caption so
 * the preview never implies a false pinpoint. Legacy exact / null renders
 * precise.
 */
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import { Icon } from "../ui/Icon";

export const ADDRESS_MAP_PREVIEW_EMPTY_COPY =
  "Pick an address to preview the map";

export interface AddressMapPreviewProps {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** True when the point came from free text (lower zoom + caption). */
  approximate?: boolean;
  /** Read out for the map image, e.g. "Map of 10 Downing Street". */
  accessibilityLabel: string;
  testID?: string;
}

export const AddressMapPreview: React.FC<AddressMapPreviewProps> = ({
  lat,
  lng,
  approximate = false,
  accessibilityLabel,
  testID,
}) => {
  const mapUrl = buildStaticMapUrl({
    lat: lat ?? null,
    lng: lng ?? null,
    accentHex: accent.warm,
    height: 160,
    zoom: approximate ? 11 : 14,
  });
  return mapUrl !== null ? (
    <View style={styles.mapWrap} testID={testID}>
      <Image
        source={{ uri: mapUrl }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityLabel={accessibilityLabel}
      />
      <View style={styles.mapPin} />
      {approximate ? (
        <View style={styles.approxBadge}>
          <Icon name="location" size={12} color={textTokens.primary} />
          <Text style={styles.approxBadgeText}>Approximate location</Text>
        </View>
      ) : null}
    </View>
  ) : (
    <View
      style={[styles.mapWrap, styles.mapEmpty]}
      testID={testID !== undefined ? `${testID}-empty` : undefined}
    >
      <Icon name="location" size={22} color={textTokens.quaternary} />
      <Text style={styles.mapEmptyText}>{ADDRESS_MAP_PREVIEW_EMPTY_COPY}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  mapWrap: {
    height: 160,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    position: "relative",
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  mapEmpty: {
    gap: spacing.xs,
  },
  mapEmptyText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  // Themed center pin overlaid on the real static map (the static URL already
  // draws a Mapbox pin; this is the consistent brand-accent dot the wizard used).
  mapPin: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: accent.warm,
    borderWidth: 3,
    borderColor: "#fff",
  },
  // Issue #1363 — "Approximate location" badge over an approximate-precision map.
  approxBadge: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  approxBadgeText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.primary,
    fontWeight: "500",
  },
});

export default AddressMapPreview;
