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
import * as Haptics from "expo-haptics";
// ORCH-0994 — shared cover renderer (image + GIF + video). Replaces the
// image-only ExpoImage path so video covers PLAY in the Discover grid instead
// of falling through to the solid hue band. Same component the event hero uses;
// muted/looping ambient autoplay, reduce-motion aware, and renders its own
// hue-band fallback (EventCover) when there is no media or media fails to load.
import { EventCoverMedia } from "@mingla/event-rendering";

import type { BusinessEventCard as BusinessEventCardData } from "../../types/mergedDiscover";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventDateChip } from "../../utils/eventDateDisplay";

interface BusinessEventCardProps {
  data: BusinessEventCardData;
  width: number;
  height: number;
  onPress: (data: BusinessEventCardData) => void;
}

// ORCH-0994 — single source for the card corner radius, shared by the card
// container clip and the EventCoverMedia radius so the cover (and its fallback
// band) corners align with the card.
const CARD_RADIUS = 18;

// ORCH-0877 — formatDateChip replaced by centralized
// `formatEventDateChip` from app-mobile/src/utils/eventDateDisplay.ts.
// I-14 single-source; cross-midnight aware via the shared helper.
//
// ORCH-0994 — the local `heroColorFromHue` hue-band helper was removed: the
// no-media / video-fallback band is now rendered by EventCoverMedia's built-in
// EventCover (hsl(hue, 60%, 45%) base — identical to the prior local band),
// keeping a single owner for cover rendering across hero + grid.

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
      {/* Hero — image / GIF / video, with built-in hue-band fallback.
          ORCH-0994: routes through the shared EventCoverMedia so a video
          cover plays (muted, looping) instead of dropping to a solid band.
          videoContentFit="cover" fills the fixed grid cell (crop) — the
          "contain" letterbox treatment is for the full-bleed event hero only. */}
      <EventCoverMedia
        hue={data.coverHue}
        mediaUrl={data.coverMediaUrl}
        mediaType={data.coverMediaType}
        radius={CARD_RADIUS}
        videoContentFit="cover"
        label={data.title}
        style={StyleSheet.absoluteFill}
      />

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
            {formatEventDateChip({
              masterDateUtc: data.masterDateUtc,
              masterEndAtUtc: data.masterEndAtUtc,
              timezone: data.timezone,
            })}
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
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    position: "relative",
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
