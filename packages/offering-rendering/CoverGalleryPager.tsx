// CoverGalleryPager — issue #868 [cover-gallery], Section M.1a.
//
// A pinned horizontal pager over the hero sequence [cover] ++ gallery, for the
// consumer detail screens (which hand-roll their own pinned cover instead of
// mounting ParallaxCoverShell). Page 0 is the screen's EXISTING <EventCoverMedia>
// passed in verbatim as `coverNode` (video-capable, byte-identical — the screen
// keeps owning the cover props + mute state); pages 1..N are the ADDITIONAL
// image/GIF gallery items. A single `activeIndex` (owned by the screen and shared
// with CoverGalleryRow) is the source of truth; swipe → onActiveIndexChange, and
// the row's tap → scrollRef.scrollTo drive the same state.
//
// Paging pattern copied VERBATIM from the proven consumer precedent
// app-mobile/src/components/expandedCard/ImageGallery.tsx:100-146 / :54-59
// (horizontal pagingEnabled + onScroll → Math.round(offsetX / width)).
//
// Pure: react-native + @mingla/offering-rendering only (I-MOR-0827). Reuses the
// EXISTING EventCoverMedia for gallery pages; adds NO new presentation resolver.

import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

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
  /** so the row's onSelect can scrollTo a page. */
  scrollRef?: React.Ref<ScrollView>;
  /** measured cover-box width for paging math (page = one screen width). */
  width: number;
  testID?: string;
}

export const CoverGalleryPager: React.FC<CoverGalleryPagerProps> = ({
  coverNode,
  gallery,
  activeIndex,
  onActiveIndexChange,
  scrollRef,
  width,
  testID,
}) => {
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const w = event.nativeEvent.layoutMeasurement.width || width;
    if (w <= 0) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / w);
    if (next !== activeIndex) onActiveIndexChange(next);
  };

  const pageStyle = { width, height: "100%" as const };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={handleScroll}
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
  );
};

const styles = StyleSheet.create({
  pager: {
    width: "100%",
    height: "100%",
  },
});

export default CoverGalleryPager;
