/**
 * #4522 — the live public-page preview of the 4-step builder.
 *
 * `TripLivePreview` draws the existing TripPreview (the renderer the public
 * /t page uses, through its lazy owner) read-only from the unsaved draft. It
 * follows the draft within 300ms. Empty fields render the way the public page
 * renders them: hidden, never sample text.
 *
 * `TripPreviewPeek` is the phone and narrow-web form: an 88px bar showing the
 * cover, title and price; a tap, or a drag up, opens the full preview, and Close
 * (or the hardware back the wizard already owns) returns to the form.
 */

import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ThemeInput } from "@mingla/offering-rendering";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { color, radius, space, type } from "../../constants/designSystem";
import { useBrand } from "../../hooks/useBrands";
import type { Trip } from "../../services/tripsService";
import { formatCurrency } from "../../utils/currency";
import { TripPreview } from "../offering/LazyPublicParts";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { TripPreviewBrand } from "./TripPreview";
import {
  PREVIEW_PEEK_COLLAPSED_HEIGHT,
  PREVIEW_UPDATE_DELAY_MS,
} from "./tripBuilderV2Model";

/** The value, `delayMs` after it last changed. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return (): void => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export interface TripLivePreviewProps {
  trip: Trip;
  brand: TripPreviewBrand;
  themeOverrides: ThemeInput | null;
  testID?: string;
}

export const TripLivePreview: React.FC<TripLivePreviewProps> = ({
  trip,
  brand,
  themeOverrides,
  testID = "trip-live-preview",
}) => {
  const shown = useDebouncedValue(trip, PREVIEW_UPDATE_DELAY_MS);
  const brandQuery = useBrand(shown.brandId ?? null);
  const brandTheme = brandQuery.data?.theme ?? null;
  return (
    <ScrollView
      style={styles.previewScroll}
      contentContainerStyle={styles.previewContent}
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      {/* Read-only: nothing in the preview is tappable. */}
      <View pointerEvents="none">
        <TripPreview
          trip={shown}
          brand={brand}
          showCta={false}
          contentPadding={0}
          theme={resolveTheme(brandTheme, themeOverrides ?? null)}
        />
      </View>
    </ScrollView>
  );
};

/** The right-hand pane on wide web (>= 1180px). */
export const TripPreviewPane: React.FC<TripLivePreviewProps> = (props) => (
  <GlassCard variant="base" padding={space[3]} radius="xl" style={styles.pane} testID="trip-preview-pane">
    <Text accessibilityRole="header" style={styles.paneTitle}>
      What travelers see
    </Text>
    <TripLivePreview {...props} />
  </GlassCard>
);

export interface TripPreviewPeekProps extends TripLivePreviewProps {
  /** Lowest package price, minor units; null = no price yet (the bar shows none). */
  fromPriceMinor: number | null;
  currency: string;
}

const SWIPE_UP_PX = 24;

export const TripPreviewPeek: React.FC<TripPreviewPeekProps> = ({
  fromPriceMinor,
  currency,
  ...preview
}) => {
  const [open, setOpen] = useState<boolean>(false);
  const touchStartY = useRef<number | null>(null);
  const cover =
    preview.trip.coverMediaType === "video"
      ? (preview.trip.coverMediaPosterUrl ?? null)
      : (preview.trip.coverMediaUrl ?? null);
  const title = preview.trip.title.trim();
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        onTouchStart={(e) => {
          touchStartY.current = e.nativeEvent.pageY;
        }}
        onTouchEnd={(e) => {
          const start = touchStartY.current;
          touchStartY.current = null;
          if (start !== null && start - e.nativeEvent.pageY > SWIPE_UP_PX) setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Open the trip preview"
        accessibilityHint="Shows the trip page the way travelers will see it"
        style={styles.peekBar}
        testID="trip-preview-peek"
      >
        <View style={styles.peekGrabber} />
        <View style={styles.peekRow}>
          {cover !== null ? (
            <Image source={{ uri: cover }} style={styles.peekCover} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.peekCover, styles.peekCoverEmpty]} />
          )}
          <View style={styles.peekText}>
            <Text style={styles.peekTitle} numberOfLines={1}>
              {title.length > 0 ? title : "Preview"}
            </Text>
            <Text style={styles.peekSub} numberOfLines={1}>
              {fromPriceMinor !== null && fromPriceMinor > 0
                ? `From ${formatCurrency(fromPriceMinor, currency, true)}`
                : "See the trip page as travelers will"}
            </Text>
          </View>
          <Icon name="chevU" size={20} color={color.text2} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.peekFull} testID="trip-preview-peek-open">
          <View style={styles.peekFullHeader}>
            <Text accessibilityRole="header" style={styles.paneTitle}>
              What travelers see
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close the preview"
              hitSlop={8}
              style={styles.peekClose}
              testID="trip-preview-peek-close"
            >
              <Icon name="close" size={20} color={color.text1} />
            </Pressable>
          </View>
          <TripLivePreview {...preview} testID="trip-preview-peek-body" />
        </View>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  previewScroll: { flex: 1 },
  previewContent: { paddingBottom: space[6] },
  pane: { flex: 1 },
  paneTitle: {
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginBottom: space[2],
  },
  peekBar: {
    height: PREVIEW_PEEK_COLLAPSED_HEIGHT,
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    borderRadius: radius.xl,
    backgroundColor: color.card2,
    borderWidth: 1,
    borderColor: color.line,
    justifyContent: "center",
  },
  peekGrabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: color.lineStrong,
    marginBottom: space[2],
  },
  peekRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  peekCover: { width: 44, height: 44, borderRadius: radius.sm, overflow: "hidden" },
  peekCoverEmpty: { backgroundColor: color.fill.inset },
  peekText: { flex: 1, gap: 2 },
  peekTitle: {
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  peekSub: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 },
  peekFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.canvas,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    zIndex: 30,
    elevation: 30,
  },
  peekFullHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  peekClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
