/**
 * AddressMapPreview — the map preview under a Host address field.
 *
 * ORCH-1186 (salvaged from ORCH-1158 Issue 3 [wizard-map-preview]) built this
 * inline in the event "Where" step. #3355 moved it here, unchanged, so Brand
 * Edit's address field shows the SAME preview instead of a fork.
 *
 * REAL static map (via the vendor-neutral `static-map` server proxy) for the
 * picked address's coords: buildStaticMapUrl(lat,lng,accent) → StaticMapImage
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
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
  scrim,
} from "../../constants/designSystem";
import { buildStaticMapUrl, StaticMapImage } from "../../utils/staticMapImage";
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
    accentHex: color.accent,
    height: 160,
    zoom: approximate ? 11 : 14,
  });
  return mapUrl !== null ? (
    // #4334 F-1 — sized to the box so Google's logo and attribution survive;
    // F-10 — one pin only: Google's own marker (drawn by the proxy).
    <StaticMapImage
      uri={mapUrl}
      style={styles.mapWrap}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {approximate ? (
        <View style={styles.approxBadge}>
          <Icon name="location" size={12} color={color.text1} />
          <Text style={styles.approxBadgeText}>Approximate location</Text>
        </View>
      ) : null}
    </StaticMapImage>
  ) : (
    <View
      style={[styles.mapWrap, styles.mapEmpty]}
      testID={testID !== undefined ? `${testID}-empty` : undefined}
    >
      <Icon name="location" size={22} color={color.text4} />
      <Text style={styles.mapEmptyText}>{ADDRESS_MAP_PREVIEW_EMPTY_COPY}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  mapWrap: {
    height: 160,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    overflow: "hidden",
    position: "relative",
    marginBottom: space[4],
    alignItems: "center",
    justifyContent: "center",
  },
  mapEmpty: {
    gap: space[1],
  },
  mapEmptyText: {
    fontSize: type.caption.fontSize,
    color: color.text4,
  },
  // Issue #1363 — "Approximate location" badge over an approximate-precision map.
  approxBadge: {
    position: "absolute",
    top: space[1],
    left: space[1],
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: radiusTokens.full,
    backgroundColor: scrim.modal,
  },
  approxBadgeText: {
    fontSize: type.caption.fontSize,
    color: color.text1,
    fontWeight: "500",
  },
});

export default AddressMapPreview;
