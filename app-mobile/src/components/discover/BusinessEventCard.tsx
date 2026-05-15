/**
 * ORCH-0824 — Discover grid card for first-party Mingla business events.
 *
 * Sibling to the Ticketmaster grid card in DiscoverScreen. Same cell
 * dimensions (GRID_CARD_WIDTH × GRID_CARD_HEIGHT, passed in via props
 * so the layout token stays single-owned by DiscoverScreen) but with a
 * Mingla-native hero treatment:
 *   - Hero: `coverMediaUrl` (image) OR a solid colored band using
 *     `coverHue` when null. Matches the EventCover pattern in
 *     mingla-business.
 *   - Bottom glass info chip: title + formatted date + venue/city.
 *   - Small "On Mingla" pill in the top-right corner to differentiate
 *     from Ticketmaster cards without making them visually heavier.
 *
 * No price overlay on the card — pricing lives in the expanded sheet,
 * matching the Ticketmaster card behavior.
 *
 * Tap → opens ExpandedCardModal with `kind: 'business_event'` (wired in
 * DiscoverScreen step 18; this component only exposes the `onPress`
 * callback).
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md §3.7.5
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";

import type { BusinessEventCard as BusinessEventCardData } from "../../types/mergedDiscover";

interface BusinessEventCardProps {
  data: BusinessEventCardData;
  width: number;
  height: number;
  onPress: (data: BusinessEventCardData) => void;
}

const formatDateChip = (
  masterDateUtc: string | null,
  timezone: string,
): string => {
  if (!masterDateUtc) return "Soon";
  try {
    const d = new Date(masterDateUtc);
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timezone || "UTC",
    }).format(d);
  } catch {
    return "Soon";
  }
};

const heroColorFromHue = (hue: number): string => {
  // Hue-driven band; matches the EventCover.tsx pattern from mingla-business.
  // hsl() format is RN-safe (oklch is not — see feedback_rn_color_formats.md).
  const h = Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 25;
  return `hsl(${h}, 60%, 45%)`;
};

const BusinessEventCardImpl: React.FC<BusinessEventCardProps> = ({
  data,
  width,
  height,
  onPress,
}) => {
  const handlePress = React.useCallback((): void => {
    Haptics.selectionAsync().catch(() => {
      // Haptics may be unavailable in dev simulators; swallow silently.
    });
    onPress(data);
  }, [data, onPress]);

  const venueLine =
    data.venueName ?? data.city ?? "";

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${data.title} on Mingla`}
      style={[
        styles.card,
        { width, height },
      ]}
    >
      {/* Hero — image or hue band */}
      {data.coverMediaUrl !== null && data.coverMediaType !== "video" ? (
        <ExpoImage
          source={{ uri: data.coverMediaUrl }}
          style={styles.heroImage}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View
          style={[
            styles.heroBand,
            { backgroundColor: heroColorFromHue(data.coverHue) },
          ]}
        />
      )}

      {/* Subtle "On Mingla" pill (top-right) */}
      <View style={styles.minglaPill}>
        <Text style={styles.minglaPillText}>On Mingla</Text>
      </View>

      {/* Bottom glass info chip */}
      <View style={styles.infoChip}>
        <Text style={styles.infoChipTitle} numberOfLines={1}>
          {data.title}
        </Text>
        <View style={styles.infoChipMeta}>
          <Text style={styles.infoChipDate} numberOfLines={1}>
            {formatDateChip(data.masterDateUtc, data.timezone)}
          </Text>
          {venueLine.length > 0 ? (
            <>
              <Text style={styles.infoChipSep}> · </Text>
              <Text style={styles.infoChipVenue} numberOfLines={1}>
                {venueLine}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

export const BusinessEventCard = React.memo(BusinessEventCardImpl);

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    position: "relative",
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroBand: {
    width: "100%",
    height: "100%",
  },
  minglaPill: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  minglaPillText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: 0.3,
  },
  infoChip: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  infoChipTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  infoChipMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  infoChipDate: {
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
    flexShrink: 0,
  },
  infoChipSep: {
    fontSize: 11,
    color: "rgba(255,255,255,0.55)",
  },
  infoChipVenue: {
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
    flexShrink: 1,
  },
});
