// CoverGalleryRow — issue #868 [cover-gallery].
//
// The body's FIRST row: a horizontally-scrolling strip of rounded cards over the
// FULL hero sequence [cover] ++ gallery. Card 0 = the primary COVER (its poster
// when the cover is a video, via the existing deriveCoverPosterUrl — no edit to
// that helper); cards 1..N = the ADDITIONAL image/GIF gallery items. Tapping a
// card swaps the shown hero item (onSelect); the active card is ringed AND badged
// (WCAG: state via ≥2 signals, never color alone). Lives inside the scrolling
// body so it scrolls away over the pinned pager (parallax unchanged).
//
// Constitution #9: gallery.length < 1 ⇒ renders NOTHING (no additional photos =
// no row; the single cover renders exactly as today).
//
// Pure: react-native + react-native-svg + @mingla/offering-rendering only
// (I-MOR-0827-PACKAGE-ISOLATION). Reuses deriveCoverPosterUrl; adds NO new
// presentation resolver.

import React from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { deriveCoverPosterUrl } from "./coverMediaPresentation";
import { type ThemePalette } from "./themePalette";
import { type OfferingGalleryImage } from "./types";

export interface CoverGalleryRowProps {
  /** Hero sequence index 0 — the primary cover (image OR video OR gif). */
  cover: { url: string | null; type: "image" | "video" | "gif" | null };
  /** ADDITIONAL image/GIF items, hero sequence indices 1..N. */
  gallery: OfferingGalleryImage[];
  /** The shown hero item: 0 = cover, i = gallery[i-1]. Single-owner state. */
  activeIndex: number;
  /** Tap a card → swap the shown item. */
  onSelect: (index: number) => void;
  palette: ThemePalette;
  variant?: "phone" | "desktop";
  testID?: string;
}

const CARD = {
  phone: { width: 64, height: 48 },
  desktop: { width: 88, height: 56 },
} as const;

const opaqueTileBg = (palette: ThemePalette): string =>
  Platform.select({ android: "#1A1A1C", default: palette.card }) ?? palette.card;

const PlayBadge: React.FC = () => (
  <View style={styles.playBadge} pointerEvents="none">
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5v14l11-7z" fill="#FFFFFF" />
    </Svg>
  </View>
);

// Active-card SECOND signal (ring is the first): a small check dot, so the
// selected state is never color-alone (WCAG). Mirrors CoverPicker's selectedBadge.
const CheckBadge: React.FC<{ palette: ThemePalette }> = ({ palette }) => (
  <View
    style={[styles.checkBadge, { backgroundColor: palette.accent }]}
    pointerEvents="none"
  >
    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 13l4 4L19 7"
        stroke={palette.accentText}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  </View>
);

export const CoverGalleryRow: React.FC<CoverGalleryRowProps> = ({
  cover,
  gallery,
  activeIndex,
  onSelect,
  palette,
  variant = "phone",
  testID,
}) => {
  // Constitution #9 — no ADDITIONAL images ⇒ zero nodes (no empty frame).
  if (gallery.length < 1) return null;

  const size = CARD[variant];
  const isCoverVideo = cover.type === "video";
  // Card 0 thumbnail: video → derived poster (no eager video); image/gif → the url.
  const coverThumbUrl = isCoverVideo
    ? deriveCoverPosterUrl(cover.url)
    : cover.url;

  const renderCard = (
    index: number,
    thumbUrl: string | null,
    a11yLabel: string,
    showPlay: boolean,
  ): React.ReactNode => {
    const active = index === activeIndex;
    return (
      <Pressable
        key={`cover-gallery-card-${index}`}
        onPress={() => onSelect(index)}
        accessibilityRole="imagebutton"
        accessibilityState={{ selected: active }}
        accessibilityLabel={a11yLabel + (active ? ", selected" : "")}
        testID={testID !== undefined ? `${testID}-card-${index}` : undefined}
        style={[
          styles.card,
          {
            width: size.width,
            height: size.height,
            backgroundColor: opaqueTileBg(palette),
            borderColor: active ? palette.accent : palette.panelBorder,
            borderWidth: active ? 2 : 1,
          },
        ]}
      >
        {thumbUrl !== null ? (
          <Image
            source={{ uri: thumbUrl }}
            style={styles.cardImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {showPlay ? <PlayBadge /> : null}
        {active ? <CheckBadge palette={palette} /> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rowContent}
      style={styles.row}
      accessibilityLabel="Cover photos"
      testID={testID}
    >
      {/* Card 0 — the primary cover (▶ only when it is a video). */}
      {renderCard(
        0,
        coverThumbUrl,
        isCoverVideo ? "Cover, video" : "Cover",
        isCoverVideo,
      )}
      {/* Cards 1..N — the additional image/GIF gallery items. */}
      {gallery.map((item, i) =>
        renderCard(
          i + 1,
          typeof item.url === "string" && item.url.length > 0 ? item.url : null,
          `Photo ${i + 1} of ${gallery.length}`,
          false,
        ),
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: {
    marginBottom: 16,
  },
  rowContent: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  playBadge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  checkBadge: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
});

export default CoverGalleryRow;
