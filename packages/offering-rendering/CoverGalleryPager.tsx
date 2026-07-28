// CoverGalleryPager — issue #868 [cover-gallery], Section M.1a (+ Pass 3/4 fixes).
//
// The pinned cover for the consumer detail screens (which hand-roll their own
// pinned cover behind a gorhom BottomSheetScrollView instead of mounting
// ParallaxCoverShell). It shows the hero sequence [cover] ++ gallery, controlled
// by a single `activeIndex` owned by the screen (shared with CoverGalleryRow).
//
// Pass 4 — DETERMINISTIC single-item render (fixes "the cover never pages"). A
// horizontal pagingEnabled ScrollView pinned BEHIND the vertical gorhom sheet
// could not lay out / scrollTo its pages (the sheet owns the scroll surface), so
// the displayed image was stuck on page 0 even though the row's tick moved. We
// now render ONLY `sequence[activeIndex]` directly: activeIndex 0 = the screen's
// EXISTING <EventCoverMedia> `coverNode` (video-capable, byte-identical); i =
// gallery[i-1] via EventCoverMedia. A chevron tap / row-card tap changes
// activeIndex → the cover RE-RENDERS the new image, deterministically. No
// horizontal scroll, so no RISK-1 gesture arbitration and no tick flicker
// (there is no intermediate scroll offset to commit). Finger-swipe on the cover
// is intentionally dropped here (secondary per the architecture); the chevrons +
// row-cards are the controls.
//
// Pure: react-native + react-native-svg + @mingla/offering-rendering only
// (I-MOR-0827). Reuses the EXISTING EventCoverMedia; adds NO new presentation resolver.

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { EventCoverMedia } from "./EventCoverMedia";
import { type OfferingGalleryImage } from "./types";

export interface CoverGalleryPagerProps {
  /** sequence index 0 — the screen's EXISTING <EventCoverMedia> (unchanged, video-capable). */
  coverNode: React.ReactNode;
  /** sequence indices 1..N — image/GIF gallery items. */
  gallery: OfferingGalleryImage[];
  /** shown item: 0 = cover, i = gallery[i-1]. Owned by the screen (shared with the row). */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  testID?: string;
}

const ChevronIcon: React.FC<{ dir: "left" | "right" }> = ({ dir }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"}
      stroke="#FFFFFF"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const CoverGalleryPager: React.FC<CoverGalleryPagerProps> = ({
  coverNode,
  gallery,
  activeIndex,
  onActiveIndexChange,
  testID,
}) => {
  const lastIndex = gallery.length; // sequence indices are 0..gallery.length
  // Clamp defensively so a stale/out-of-range index never renders a blank cover.
  const clamped =
    activeIndex < 0 ? 0 : activeIndex > lastIndex ? lastIndex : activeIndex;
  const item = clamped === 0 ? undefined : gallery[clamped - 1];

  const goPrev = (): void => {
    if (clamped > 0) onActiveIndexChange(clamped - 1);
  };
  const goNext = (): void => {
    if (clamped < lastIndex) onActiveIndexChange(clamped + 1);
  };

  return (
    <View style={styles.pager} testID={testID}>
      {/* DETERMINISTIC: render ONLY sequence[activeIndex]. Changing activeIndex
          re-renders the new image — no ScrollView to fight the vertical sheet. */}
      {item === undefined ? (
        <View
          style={styles.page}
          testID={testID !== undefined ? `${testID}-page-cover` : undefined}
        >
          {coverNode}
        </View>
      ) : (
        <View
          style={styles.page}
          testID={testID !== undefined ? `${testID}-page-${clamped}` : undefined}
        >
          <EventCoverMedia
            mediaUrl={item.url}
            mediaType={item.type ?? "image"}
            height="100%"
            width="100%"
          />
        </View>
      )}

      {/* Tap chevrons page cover↔photos (the guaranteed, gesture-free control). */}
      {clamped > 0 ? (
        <Pressable
          onPress={goPrev}
          accessibilityRole="button"
          accessibilityLabel="Previous photo"
          hitSlop={10}
          style={[styles.chevron, styles.chevronLeft]}
          testID={testID !== undefined ? `${testID}-prev` : undefined}
        >
          <ChevronIcon dir="left" />
        </Pressable>
      ) : null}
      {clamped < lastIndex ? (
        <Pressable
          onPress={goNext}
          accessibilityRole="button"
          accessibilityLabel="Next photo"
          hitSlop={10}
          style={[styles.chevron, styles.chevronRight]}
          testID={testID !== undefined ? `${testID}-next` : undefined}
        >
          <ChevronIcon dir="right" />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  pager: {
    width: "100%",
    height: "100%",
  },
  page: {
    width: "100%",
    height: "100%",
  },
  chevron: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  chevronLeft: {
    left: 12,
  },
  chevronRight: {
    right: 12,
  },
});

export default CoverGalleryPager;
