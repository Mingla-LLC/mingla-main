// CoverGalleryPager — issue #868 [cover-gallery], Section M.1a (+ Pass 4 fixes).
//
// The pinned cover for the consumer detail screens (which hand-roll their own
// pinned cover behind a gorhom BottomSheetScrollView instead of mounting
// ParallaxCoverShell). It shows the hero sequence [cover] ++ gallery, controlled
// by a single `activeIndex` owned by the screen (shared with CoverGalleryRow).
//
// Pass 4 — DETERMINISTIC single-item render (fixes "the cover never pages"). A
// horizontal paging ScrollView pinned BEHIND the vertical gorhom sheet could not
// lay out / scroll its pages (the sheet owns the scroll surface), so the shown
// image was stuck on page 0 even though the row's tick moved. We now render ONLY
// `sequence[activeIndex]` directly: index 0 = the screen's EXISTING
// <EventCoverMedia> `coverNode` (video-capable, byte-identical); i = gallery[i-1]
// via EventCoverMedia. Changing activeIndex re-renders the new image,
// DETERMINISTICALLY.
//
// Pass 4 — ON-DEVICE FINDING (Samsung, FIFA event): NO control ON the pinned
// cover is reachable — a horizontal swipe AND on-cover chevron taps are all
// swallowed by the gorhom sheet's scroll responder (verified: 3 chevron taps did
// nothing while a row-card tap flipped the cover). Only the CoverGalleryRow (which
// lives in the body, ON TOP of the sheet) receives taps, so the ROW-CARDS are the
// paging control: tapping a card sets activeIndex → this pager re-renders that
// item. No dead on-cover chevrons are drawn (they would mislead).
//
// Pure: react-native + @mingla/offering-rendering only (I-MOR-0827). Reuses the
// EXISTING EventCoverMedia; adds NO new presentation resolver.

import React from "react";
import { StyleSheet, View } from "react-native";

import { EventCoverMedia } from "./EventCoverMedia";
import { type OfferingGalleryImage } from "./types";

export interface CoverGalleryPagerProps {
  /** sequence index 0 — the screen's EXISTING <EventCoverMedia> (unchanged, video-capable). */
  coverNode: React.ReactNode;
  /** sequence indices 1..N — image/GIF gallery items. */
  gallery: OfferingGalleryImage[];
  /** shown item: 0 = cover, i = gallery[i-1]. Owned by the screen (driven by the row). */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  testID?: string;
}

export const CoverGalleryPager: React.FC<CoverGalleryPagerProps> = ({
  coverNode,
  gallery,
  activeIndex,
  // onActiveIndexChange is part of the controlled contract (the CoverGalleryRow
  // drives activeIndex); this deterministic renderer only READS activeIndex.
  onActiveIndexChange: _onActiveIndexChange,
  testID,
}) => {
  const lastIndex = gallery.length; // sequence indices are 0..gallery.length
  // Clamp defensively so a stale/out-of-range index never renders a blank cover.
  const clamped =
    activeIndex < 0 ? 0 : activeIndex > lastIndex ? lastIndex : activeIndex;
  const item = clamped === 0 ? undefined : gallery[clamped - 1];

  return (
    <View style={styles.pager} testID={testID}>
      {/* DETERMINISTIC: render ONLY sequence[activeIndex]. Changing activeIndex
          (via the row-card tap) re-renders the new image — no ScrollView to fight
          the vertical sheet. */}
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
});

export default CoverGalleryPager;
