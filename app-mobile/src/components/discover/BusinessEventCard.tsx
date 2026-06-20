/**
 * ORCH-0824 — Discover grid card for first-party Mingla business events.
 *
 * Sibling to the Ticketmaster grid card in DiscoverScreen. Same cell
 * dimensions (GRID_CARD_WIDTH × GRID_CARD_HEIGHT, passed in via props
 * so the layout token stays single-owned by DiscoverScreen) but with a
 * Mingla-native hero treatment:
 *   - Hero: rendered by the SHARED `EventCoverMedia` (@mingla/offering-rendering)
 *     so image covers get error/recycling fallback, VIDEO covers show a static
 *     first-frame poster (autoplay disabled for the grid), and a null/errored
 *     cover falls back to the shared `coverHue` band — all owned by the shared
 *     package per COMMS-0007 (META-ORCH-0991 Bug 3b).
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
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
// ORCH-0994 + META-ORCH-0991 Bug 3b — shared cover renderer (image + GIF +
// video). Replaces the image-only ExpoImage path: video covers PLAY in the
// Discover grid (muted/looping ambient autoplay, reduce-motion aware) instead of
// falling through to a solid hue band, and image covers inherit the shared
// onError → hue-band fallback + per-mediaUrl error/recycling reset (COMMS-0007;
// the Android robustness the bare ExpoImage lacked). Same component the event
// hero uses; renders its own hue-band fallback (EventCover) on missing/failed media.
import { EventCoverMedia } from "@mingla/offering-rendering";
// META-ORCH-0991 Bug 3a (intermittent card tap): the card lives inside the
// Discover screen-level RN <ScrollView>. A plain <Pressable onPress> is cancelled
// the instant the parent scroll claims the touch — a tap with a few px of finger
// drift opens nothing. An RNGH Tap gesture with a generous `maxDistance` keeps
// firing for small drift while a clear drag still scrolls, so a normal tap
// reliably opens the event. RNGH is already a dependency (v2.28.0).
import { Gesture, GestureDetector } from "react-native-gesture-handler";

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
// ORCH-0994 + META-ORCH-0991 Bug 3b — the local `heroColorFromHue` hue-band
// helper was removed: the no-media / failed-media fallback band is now rendered
// by EventCoverMedia's built-in EventCover (hsl(hue, 60%, 45%) base — identical
// to the prior local band), keeping a single owner for cover rendering across
// hero + grid (@mingla/offering-rendering).

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

  // META-ORCH-0991 Bug 3a: a Tap gesture tolerant of ~16px of finger drift.
  // `maxDistance(16)` is the slop a tap may move before RNGH cancels it; a clear
  // scroll drag exceeds it and the parent ScrollView wins. `runOnJS(true)` so the
  // handler (haptics + onPress) runs on the JS thread. `maxDuration(500)` keeps it
  // a genuine tap (not a held press). Memoized on `handlePress` so the gesture
  // object is stable across renders (gesture re-creation can drop in-flight taps).
  const tapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(16)
        .maxDuration(500)
        .runOnJS(true)
        .onEnd(() => {
          handlePress();
        }),
    [handlePress],
  );

  const venueLine =
    data.venueName ?? data.city ?? "";

  return (
    <GestureDetector gesture={tapGesture}>
    <View
      accessibilityRole="button"
      accessibilityLabel={`${data.title} on Mingla`}
      style={[
        styles.card,
        { width, height },
      ]}
    >
      {/* Hero — image / GIF / video, with built-in hue-band fallback.
          ORCH-0994: routes through the shared EventCoverMedia so a video
          cover PLAYS (muted, looping ambient) instead of dropping to a solid
          band; videoContentFit="cover" fills the fixed grid cell (crop) — the
          "contain" letterbox treatment is for the full-bleed event hero only.
          Image covers also inherit the shared onError → hue-band fallback +
          per-mediaUrl error/recycling reset (the Android-robustness the bare
          ExpoImage lacked — the second half of META-ORCH-0991 Bug 3b).

          META-ORCH-0991 Bug 3a wrapper — pointerEvents="none": the cover (incl.
          the native VideoView for playing video covers) is decorative. Without
          this it captures the touch and the card's tap GestureDetector never
          fires, so video-cover cards wouldn't open. The image-cover Discover/TM
          cards have no VideoView and opened fine, which is how this surfaced only
          on the "On Mingla" video cards. The wrapper keeps ORCH-0994's playing
          behavior AND lets every card open on tap. */}
      <View style={styles.heroFill} pointerEvents="none">
        <EventCoverMedia
          hue={data.coverHue}
          mediaUrl={data.coverMediaUrl}
          mediaType={data.coverMediaType}
          radius={CARD_RADIUS}
          videoContentFit="cover"
          label={data.title}
          style={StyleSheet.absoluteFill}
        />
      </View>

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
    </View>
    </GestureDetector>
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
  heroFill: {
    ...StyleSheet.absoluteFillObject,
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
