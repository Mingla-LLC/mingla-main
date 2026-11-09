/**
 * #4347 wave 2 — GALLERY FIRST. The expanded single place opens on its photos.
 *
 * A full-width pager (every photo, video cover in slot 1), a "1 / N" counter,
 * and a thumbnail row under it (only with 2+ slots). Tapping a photo opens the
 * existing ImageLightbox (full screen, pinch to zoom); the video plays muted in
 * slot 1 only and pauses as soon as it is swiped away.
 *
 * It replaces BOTH the S7 hero photograph and the old 160 x 120 "Photos" strip
 * half way down the sheet. Both lists are `BottomSheetFlatList` (#1702: a plain
 * RN list nested in the gorhom sheet loses its horizontal drag to the sheet's
 * pan on Android).
 *
 * No photo: a short neutral header, so the title moves up instead of sitting
 * under a 300pt empty box.
 *
 * #4347 wave 3 — the curated plan opens on the same gallery: every stop's
 * photos in stop order, each tagged with its stop ("Stop 2 · Nike Art").
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { EventCoverMedia } from '@mingla/offering-rendering';
import { useTranslation } from 'react-i18next';
import { BottomSheetFlatList } from '../ui/BaseBottomSheet';
import { SHEET_GALLERY, SPINE } from './spineTokens';
import type { SheetMedia } from './placeSheetModel';
import { resolvePlacePhotoThumbSource } from '../../utils/placePhotoThumb';
import { Icon } from '../ui/Icon';

export interface PlaceGalleryProps {
  readonly media: readonly SheetMedia[];
  readonly title: string;
  /**
   * Opens the lightbox on this photo (stills only — the caller maps it). The
   * second argument is the media still IN the gallery (failed photos removed),
   * so the lightbox never pages to a photo the gallery dropped.
   */
  readonly onOpen: (uri: string, shown: readonly SheetMedia[]) => void;
  /** Reduce Motion: thumbnail jumps land instantly. */
  readonly reducedMotion?: boolean;
  /** False while the sheet is hidden behind a child modal: the video pauses. */
  readonly active?: boolean;
  /** Review mode ("3 of 12"), rendered above the gallery. */
  readonly header?: React.ReactNode;
  /**
   * The sheet's close control. The S7 hero drew the accessible close handle;
   * with the gallery first on a single place, the gallery carries it.
   */
  readonly onClose?: () => void;
  readonly closeLabel?: string;
}

export function PlaceGallery({
  media: allMedia,
  title,
  onOpen,
  reducedMotion = false,
  active = true,
  header = null,
  onClose,
  closeLabel,
}: PlaceGalleryProps): React.ReactElement {
  const { t } = useTranslation(['cards']);
  const { width } = useWindowDimensions();
  const [index, setIndex] = React.useState(0);
  // #4347 retest P4 — the video slot plays muted; the person can turn sound on
  // (the deleted hero offered this). Back to muted for every new gallery.
  const [muted, setMuted] = React.useState(true);
  const pagerRef = React.useRef<{ scrollToIndex?: (p: { index: number; animated: boolean }) => void } | null>(null);
  // A photo that fails to load leaves the gallery (the next one takes its
  // slot); when every one fails the gallery is the short neutral header.
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(() => new Set());
  // #4347 rework (P2-a) — keyed on CONTENT, not array identity. Callers rebuild
  // the media array every render (the sheet re-renders for unrelated reasons),
  // and an identity reset threw the viewer back to photo 1 and re-admitted a
  // photo that had already failed.
  const contentKey = allMedia.map((m) => `${m.isVideo ? 'v' : 'p'}:${m.uri}`).join('|');
  const stableMedia = React.useMemo(() => allMedia, [contentKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const media = React.useMemo(() => stableMedia.filter((m) => !failed.has(m.uri)), [stableMedia, failed]);
  const markFailed = React.useCallback((uri: string) => {
    setFailed((prev) => (prev.has(uri) ? prev : new Set([...prev, uri])));
  }, []);

  const firstKey = React.useRef(contentKey);
  React.useEffect(() => {
    if (firstKey.current === contentKey) return;
    firstKey.current = contentKey;
    setIndex(0);
    setFailed(new Set());
    setMuted(true);
  }, [contentKey]);

  const close = onClose ? (
    <TouchableOpacity
      testID="sheet-gallery-close"
      onPress={onClose}
      accessibilityRole="button"
      accessibilityLabel={closeLabel}
      hitSlop={8}
      style={styles.close}
    >
      <Icon name="close" size={20} color={SHEET_GALLERY.counterText} />
    </TouchableOpacity>
  ) : null;

  if (media.length === 0) {
    return (
      <View>
        {header}
        <View testID="sheet-gallery-empty" style={styles.empty} accessibilityElementsHidden />
        {close}
      </View>
    );
  }

  const goTo = (next: number): void => {
    setIndex(next);
    pagerRef.current?.scrollToIndex?.({ index: next, animated: !reducedMotion });
  };

  return (
    <View testID="sheet-gallery">
      {header}
      <View style={{ height: SHEET_GALLERY.height }}>
        <BottomSheetFlatList
          ref={pagerRef as never}
          data={media as SheetMedia[]}
          keyExtractor={(item: SheetMedia, i: number) => `${item.uri}_${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_: unknown, i: number) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e: { nativeEvent: { contentOffset: { x: number } } }) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
            if (next !== index) setIndex(Math.max(0, Math.min(media.length - 1, next)));
          }}
          renderItem={({ item, index: i }: { item: SheetMedia; index: number }) => (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => onOpen(item.uri, media)}
              disabled={item.isVideo}
              accessibilityRole={item.isVideo ? 'image' : 'button'}
              // #4347 rework (P3) — the page announces its position.
              accessibilityLabel={t('cards:deck.photo_position', { index: i + 1, count: media.length }) + ` · ${title}`}
              style={{ width, height: SHEET_GALLERY.height }}
            >
              {item.isVideo ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <EventCoverMedia
                    mediaUrl={item.uri}
                    mediaType="video"
                    radius={0}
                    label={title}
                    videoContentFit="cover"
                    autoplay={active && index === 0}
                    playbackActive={active && index === 0}
                    muted={muted}
                    loop
                    // The control is drawn by this gallery (translated, and
                    // outside the pointerEvents="none" media wrapper).
                    showAudioControl={false}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              ) : (
                <ExpoImage
                  source={{ uri: item.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="disk"
                  transition={reducedMotion ? 0 : SHEET_GALLERY.settleMs}
                  onError={() => markFailed(item.uri)}
                />
              )}
            </TouchableOpacity>
          )}
        />
        {media[index]?.tag ? (
          <View style={styles.tag} pointerEvents="none" testID="sheet-gallery-tag">
            <Text style={styles.counterText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {media[index]?.tag}
            </Text>
          </View>
        ) : null}
        {media.length > 1 ? (
          <View style={styles.counter} pointerEvents="none" testID="sheet-gallery-counter">
            <Text style={styles.counterText} accessibilityLiveRegion="polite">
              {`${Math.min(index, media.length - 1) + 1} / ${media.length}`}
            </Text>
          </View>
        ) : null}
        {media[index]?.isVideo ? (
          <TouchableOpacity
            testID="sheet-gallery-sound"
            style={styles.sound}
            onPress={() => setMuted((m) => !m)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ checked: !muted }}
            accessibilityLabel={muted ? t('cards:sheet.sound_on_a11y') : t('cards:sheet.sound_off_a11y')}
          >
            <Icon name={muted ? 'volume-mute' : 'volume-high'} size={16} color={SHEET_GALLERY.counterText} />
            <Text style={styles.counterText} maxFontSizeMultiplier={1.3}>
              {muted ? t('cards:sheet.sound') : t('cards:sheet.mute')}
            </Text>
          </TouchableOpacity>
        ) : null}
        {close}
      </View>

      {media.length > 1 ? (
        <BottomSheetFlatList
          testID="sheet-gallery-thumbs"
          data={media as SheetMedia[]}
          keyExtractor={(item: SheetMedia, i: number) => `thumb_${item.uri}_${i}`}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbs}
          renderItem={({ item, index: i }: { item: SheetMedia; index: number }) => (
            <GalleryThumb
              uri={item.uri}
              isVideo={item.isVideo}
              active={i === index}
              label={t('cards:expanded.photo_a11y', { n: i + 1 })}
              onPress={() => goTo(i)}
            />
          )}
        />
      ) : null}
    </View>
  );
}

/** A thumbnail: the existing `_thumb.jpg` first (never an image transform), then the original. */
function GalleryThumb({
  uri,
  isVideo,
  active,
  label,
  onPress,
}: {
  uri: string;
  isVideo: boolean;
  active: boolean;
  label: string;
  onPress: () => void;
}): React.ReactElement {
  const source = React.useMemo(() => (isVideo ? null : resolvePlacePhotoThumbSource(uri)), [isVideo, uri]);
  const [useOriginal, setUseOriginal] = React.useState(false);
  const shown = source === null ? null : useOriginal ? source.fallbackUri ?? source.uri : source.uri;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.thumb, active ? styles.thumbActive : null]}
    >
      {shown ? (
        <ExpoImage
          source={{ uri: shown }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
          onError={() => {
            if (!useOriginal && source?.fallbackUri) setUseOriginal(true);
          }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.thumbVideo]} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  empty: {
    height: SHEET_GALLERY.emptyHeight,
    backgroundColor: SHEET_GALLERY.emptyFill,
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SHEET_GALLERY.counterFill,
  },
  // #4347 wave 3 — the stop a plan's photo belongs to, bottom-left.
  tag: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    maxWidth: '70%',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: SHEET_GALLERY.counterFill,
  },
  // #4347 retest P4 — the video's sound toggle, top-left (Close is top-right,
  // the counter bottom-right).
  sound: {
    position: 'absolute',
    left: 12,
    top: 12,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: SHEET_GALLERY.counterFill,
  },
  counter: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: SHEET_GALLERY.counterFill,
  },
  counterText: {
    color: SHEET_GALLERY.counterText,
    fontSize: SHEET_GALLERY.counterSize,
    fontWeight: '600',
  },
  thumbs: {
    paddingHorizontal: SPINE.gutter,
    paddingTop: 10,
    gap: SHEET_GALLERY.thumbGap,
  },
  thumb: {
    width: SHEET_GALLERY.thumb,
    height: SHEET_GALLERY.thumb,
    borderRadius: SHEET_GALLERY.thumbRadius,
    overflow: 'hidden',
    backgroundColor: SPINE.chipFill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbActive: {
    borderColor: SHEET_GALLERY.thumbActiveRing,
  },
  thumbVideo: {
    backgroundColor: SPINE.hairline,
  },
});
