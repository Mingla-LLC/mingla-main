/**
 * Ve4 — structured address + OpenStreetMap link for public venue pages.
 */

import React, { useCallback } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export interface VenueLocationPreviewProps {
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

const buildOsmUrl = (lat: number, lng: number): string =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

export const VenueLocationPreview: React.FC<VenueLocationPreviewProps> = ({
  address,
  city,
  lat,
  lng,
}) => {
  const lines = [address, city].filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
  const hasCoords =
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng);

  const handleMapPress = useCallback(async (): Promise<void> => {
    if (!hasCoords) return;
    const url = buildOsmUrl(lat, lng);
    try {
      if (Platform.OS === "web") {
        const win = (
          globalThis as unknown as {
            window?: { open?: (u: string, t: string) => unknown };
          }
        ).window;
        if (win?.open !== undefined) {
          win.open(url, "_blank");
          return;
        }
      }
      await Linking.openURL(url);
    } catch {
      // user-cancelled
    }
  }, [hasCoords, lat, lng]);

  if (lines.length === 0 && !hasCoords) return null;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Location</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.address}>
          {line}
        </Text>
      ))}
      {hasCoords ? (
        <Pressable
          onPress={() => void handleMapPress()}
          accessibilityRole="link"
          accessibilityLabel="Open map in OpenStreetMap"
          style={styles.mapLink}
        >
          <Icon name="location" size={16} color={accent.warm} />
          <Text style={styles.mapLabel}>View on map</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.xs,
    width: "100%",
  },
  title: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  address: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  mapLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  mapLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});

export default VenueLocationPreview;
