// CountAwareGallery — ORCH-1138 A2.
//
// The count-aware media gallery: 1 item = full-width, 2 = full-width split,
// 3+ = horizontal scroll-snap slider. Matches DIRECTION_A_V2's `.day-media`
// (.media-one / .media-two / .media-slider). Used by per-day media (trip) and
// later per-stop media (experience).
//
// Constitution: empty `items` ⇒ renders NOTHING (zero nodes — no empty frame,
// rule 9). `type:'video'` is EXPLICIT (never auto-detected — ORCH-1069/0978),
// reuses EventCoverMedia (autoplay-muted) with a one-playing guard so only the
// first/tapped video tile plays.
//
// Pure: react-native + react-native-svg + @mingla/offering-rendering only.

import React, { useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { EventCoverMedia } from "./EventCoverMedia";
import { type ThemePalette } from "./themePalette";

import { pickGalleryLayout } from "./galleryLayout";

export interface CountAwareGalleryItem {
  url: string;
  type: "image" | "video";
}

export interface CountAwareGalleryProps {
  items: CountAwareGalleryItem[];
  palette: ThemePalette;
  variant?: "phone" | "desktop";
  accessibilityLabelPrefix?: string;
  testID?: string;
}

const PlayBadge: React.FC = () => (
  <View style={styles.playBadge} pointerEvents="none">
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5v14l11-7z" fill="#FFFFFF" />
    </Svg>
  </View>
);

// Per-mockup tile sizing deltas.
const SIZES = {
  phone: { one: 200, two: 140, slider: 150, sliderH: 104 },
  desktop: { one: 300, two: 190, slider: 220, sliderH: 146 },
} as const;

const opaqueTileBg = (palette: ThemePalette): string =>
  Platform.select({ android: "#1A1A1C", default: palette.card }) ??
  palette.card;

export const CountAwareGallery: React.FC<CountAwareGalleryProps> = ({
  items,
  palette,
  variant = "phone",
  accessibilityLabelPrefix = "Media",
  testID,
}) => {
  // One-playing guard: the first video tile plays by default; tapping any video
  // tile switches play to it (mirrors the legacy TripPreview activeVideoKey).
  const [activeVideoKey, setActiveVideoKey] = useState<string | null>(null);

  const layout = pickGalleryLayout(items.length);
  if (layout === "none") return null;

  const sizes = SIZES[variant];
  const firstVideoIndex = items.findIndex((m) => m.type === "video");
  const defaultKey = firstVideoIndex >= 0 ? `v-${firstVideoIndex}` : null;

  const renderTile = (
    item: CountAwareGalleryItem,
    index: number,
    tileStyle: { width: DimensionValue; height: number },
  ): React.ReactNode => {
    const a11y = `${accessibilityLabelPrefix} ${index + 1}, ${item.type}`;
    const tileBase = [
      styles.tile,
      tileStyle,
      { backgroundColor: opaqueTileBg(palette), borderColor: palette.panelBorder },
    ];
    if (item.type === "video") {
      const key = `v-${index}`;
      const isActive =
        activeVideoKey === null ? key === defaultKey : activeVideoKey === key;
      return (
        <Pressable
          key={`item-${index}`}
          onPress={() =>
            setActiveVideoKey((cur) => (cur === key ? null : key))
          }
          accessibilityRole="imagebutton"
          accessibilityLabel={a11y}
          style={tileBase}
        >
          <EventCoverMedia
            mediaUrl={item.url}
            mediaType="video"
            autoplay
            playbackActive={isActive}
            muted
            loop
            radius={10}
            height="100%"
            width="100%"
          />
          {!isActive ? <PlayBadge /> : null}
        </Pressable>
      );
    }
    return (
      <Image
        key={`item-${index}`}
        source={{ uri: item.url }}
        style={tileBase}
        resizeMode="cover"
        accessibilityRole="image"
        accessibilityLabel={a11y}
      />
    );
  };

  // 1 item → full width.
  if (layout === "one") {
    return (
      <View style={styles.block} testID={testID}>
        {renderTile(items[0], 0, { width: "100%", height: sizes.one })}
      </View>
    );
  }

  // 2 items → two equal columns.
  if (layout === "two") {
    return (
      <View style={[styles.block, styles.splitRow]} testID={testID}>
        {items.map((item, index) => (
          <View key={`col-${index}`} style={styles.splitCol}>
            {renderTile(item, index, { width: "100%", height: sizes.two })}
          </View>
        ))}
      </View>
    );
  }

  // 3+ items → horizontal slider.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sliderContent}
      style={styles.block}
      accessibilityLabel={`${accessibilityLabelPrefix} gallery`}
      testID={testID}
    >
      {items.map((item, index) =>
        renderTile(item, index, {
          width: sizes.slider,
          height: sizes.sliderH,
        }),
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  block: {
    marginTop: 12,
  },
  tile: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  splitRow: {
    flexDirection: "row",
    gap: 8,
  },
  splitCol: {
    flex: 1,
  },
  sliderContent: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 2,
  },
  playBadge: {
    position: "absolute",
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
});

export default CountAwareGallery;
