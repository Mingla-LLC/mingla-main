// CoverGalleryPager — issue #868 [cover-gallery], Section M.1a (+ Pass 3 fixes).
//
// A pinned horizontal pager over the hero sequence [cover] ++ gallery, for the
// consumer detail screens (which hand-roll their own pinned cover instead of
// mounting ParallaxCoverShell). Page 0 is the screen's EXISTING <EventCoverMedia>
// passed in verbatim as `coverNode` (video-capable, byte-identical — the screen
// keeps owning the cover props + mute state); pages 1..N are the ADDITIONAL
// image/GIF gallery items. A single `activeIndex` (owned by the screen and shared
// with CoverGalleryRow) is the source of truth.
//
// Pass 3 — BUG 1 (active-tick flicker): the shown index COMMITS ONLY ON SETTLE
// (onMomentumScrollEnd), NEVER on intermediate onScroll frames (those bounced the
// ring through every page during an animated scrollTo). The pager DRIVES the
// scroll from the controlled `activeIndex` (useEffect) and sets a
// `programmaticRef` guard so a tap/chevron scroll's settle is suppressed — only a
// user SWIPE settle commits, exactly once.
//
// Pass 3 — BUG 2 (native swipe captured by the gorhom BottomSheetScrollView): tap
// CHEVRONS are added as the guaranteed paging control (SPEC §M.1c fallback) so the
// cover pages cover↔photos even where the horizontal swipe is intercepted by the
// vertical scroll responder. Row-tap remains a control too; web swipe still works.
//
// Pure: react-native + react-native-svg + @mingla/offering-rendering only
// (I-MOR-0827). Reuses the EXISTING EventCoverMedia for gallery pages; adds NO new
// presentation resolver.

import React, { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { EventCoverMedia } from "./EventCoverMedia";
import { type OfferingGalleryImage } from "./types";

export interface CoverGalleryPagerProps {
  /** page 0 — the screen's EXISTING <EventCoverMedia> (unchanged, video-capable). */
  coverNode: React.ReactNode;
  /** pages 1..N — image/GIF gallery items. */
  gallery: OfferingGalleryImage[];
  /** shown page: 0 = cover, i = gallery[i-1]. Owned by the screen (shared with the row). */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** measured cover-box width for paging math (page = one screen width). */
  width: number;
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
  width,
  testID,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  // BUG 1 guard: true while the pager itself is animating to a tap/chevron target,
  // so the resulting settle does NOT re-commit (no ring bounce).
  const programmaticRef = useRef(false);
  // The last index the pager scrolled to (so the useEffect no-ops on a swipe-driven
  // activeIndex change and does not double-scroll / re-arm the guard).
  const lastIndexRef = useRef(activeIndex);
  const activeRef = useRef(activeIndex);
  activeRef.current = activeIndex;

  // Drive the scroll to the controlled activeIndex (tap/chevron). This is the ONLY
  // place a programmatic scroll starts, so the guard is exact.
  useEffect(() => {
    if (width <= 0) return;
    if (activeIndex === lastIndexRef.current) return;
    lastIndexRef.current = activeIndex;
    programmaticRef.current = true;
    scrollViewRef.current?.scrollTo({ x: activeIndex * width, animated: true });
  }, [activeIndex, width]);

  // BUG 1: commit the shown index ONLY on settle. A programmatic (tap/chevron)
  // settle is suppressed by the guard; a user SWIPE settle commits ONCE.
  const handleSettle = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ): void => {
    if (programmaticRef.current) {
      programmaticRef.current = false;
      return;
    }
    const w = event.nativeEvent.layoutMeasurement.width || width;
    if (w <= 0) return;
    const settled = Math.round(event.nativeEvent.contentOffset.x / w);
    if (settled !== activeRef.current) {
      lastIndexRef.current = settled;
      onActiveIndexChange(settled);
    }
  };

  const lastIndex = gallery.length; // pages are 0..gallery.length
  const goPrev = (): void => {
    if (activeIndex > 0) onActiveIndexChange(activeIndex - 1);
  };
  const goNext = (): void => {
    if (activeIndex < lastIndex) onActiveIndexChange(activeIndex + 1);
  };

  const pageStyle = { width, height: "100%" as const };

  return (
    <View style={styles.pager}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // BUG 1 — commit on settle only (never intermediate onScroll frames).
        onMomentumScrollEnd={handleSettle}
        scrollEventThrottle={16}
        style={styles.pager}
        testID={testID}
      >
        {/* page 0 — the EXISTING cover, untouched (video autoplays as today). */}
        <View style={pageStyle}>{coverNode}</View>
        {/* pages 1..N — the additional image/GIF items. */}
        {gallery.map((item, i) => (
          <View key={`cover-page-${i + 1}`} style={pageStyle}>
            <EventCoverMedia
              mediaUrl={item.url}
              mediaType={item.type ?? "image"}
              height="100%"
              width="100%"
            />
          </View>
        ))}
      </ScrollView>

      {/* BUG 2 fallback (SPEC §M.1c) — tap chevrons page cover↔photos even where a
          native horizontal swipe is captured by the pinned-behind gorhom scroll. */}
      {activeIndex > 0 ? (
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
      {activeIndex < lastIndex ? (
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
