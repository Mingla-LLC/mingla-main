/**
 * #4347 wave 1 — the redesigned deck card's chrome: photo segment bars, the
 * stop label, the one-time tap hint, the smart chip, the kicker + title column,
 * the curated stop stack + route line, and the host chip.
 *
 * Leaf module, like deckCardPlate: it imports react-native, expo-image and the
 * package, and NOTHING from either card tree, so both SwipeableCards and
 * CuratedExperienceSwipeCard can render it without reopening the require cycle.
 *
 * NONE of these views owns a gesture. Every one is `pointerEvents="none"`: the
 * deck's single tap path (SwipeableCards' card Touchable -> classifyDeckTap ->
 * flip or requestTapExpand) is the only owner, so nothing here can fight the
 * pan (I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  HOST_CHIP,
  KICKER,
  MAX_FONT_SCALE,
  NO_PHOTO,
  PHOTO_PAGER,
  SMART_CHIP,
  STOP_STACK,
  SURFACES,
} from '../../../../packages/card-identity/index.js';
import { DECK_CHROME_BAND_BOTTOM_PT } from '../deckHeroConstants';
import { resolvePlacePhotoThumbSource } from '../../utils/placePhotoThumb';

const S1 = SURFACES.s1Single;

/** Card-local y of the segment bars: just below the deck chrome band. */
export function photoBarsTop(safeTopInset: number): number {
  return Math.max(0, safeTopInset) + DECK_CHROME_BAND_BOTTOM_PT - 2 + PHOTO_PAGER.bar.belowChrome;
}

/** Card-local y of the stop label / tap hint row, under the bars. */
export function photoLabelTop(safeTopInset: number): number {
  return photoBarsTop(safeTopInset) + PHOTO_PAGER.bar.height + PHOTO_PAGER.label.belowBars;
}

/**
 * Card-local y below which a tap always opens: the top of the text column
 * (smart chip, stack, kicker, title). Computed from the same anchor the column
 * is placed with, so the zones can never overlap the words.
 */
export function tapZoneBottomY(
  cardHeight: number,
  titleBottom: number,
  extras: { smartChip?: boolean; stack?: boolean; fontScale?: number } = {},
): number {
  // #4347 rework (Z-3) — the column is measured at the ACTIVE text size, capped
  // where the text itself is capped (title 1.4x, kicker / chip 1.3x). Without a
  // known scale the caps are used, so a zone can never reach into the title at
  // any text size (at 1.0x the middle "open" area is simply a little taller).
  const scale = typeof extras.fontScale === 'number' && extras.fontScale > 0 ? extras.fontScale : Infinity;
  const titleScale = Math.max(1, Math.min(scale, MAX_FONT_SCALE.title));
  const metaScale = Math.max(1, Math.min(scale, MAX_FONT_SCALE.meta));
  let column = S1.titleLines * S1.titleLH * titleScale + KICKER.gap + KICKER.lineHeight * metaScale;
  if (extras.stack) column += STOP_STACK.size + STOP_STACK.marginBottom;
  if (extras.smartChip) column += SMART_CHIP.lineHeight * metaScale + 2 * SMART_CHIP.paddingV + SMART_CHIP.marginBottom;
  // Floored: a fractional point is never handed to a flip zone.
  return Math.max(0, Math.floor(cardHeight - titleBottom - column));
}

export function PhotoPagerBars({
  count,
  index,
  top,
}: {
  count: number;
  index: number;
  top: number;
}): React.ReactElement | null {
  if (count < 2) return null;
  return (
    <View
      testID="deck-photo-bars"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.bars, { top }]}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={`bar_${i}`}
          testID={i === index ? 'deck-photo-bar-on' : 'deck-photo-bar'}
          style={[styles.bar, { backgroundColor: i === index ? PHOTO_PAGER.bar.on : PHOTO_PAGER.bar.off }]}
        />
      ))}
    </View>
  );
}

/** A small dark capsule on the photograph: the stop label and the tap hint. */
export function PhotoCapsule({
  text,
  top,
  align = 'left',
  testID,
}: {
  text: string | null;
  top: number;
  align?: 'left' | 'center';
  testID?: string;
}): React.ReactElement | null {
  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      testID={testID}
      style={[styles.capsuleRow, { top }, align === 'center' ? styles.capsuleRowCenter : null]}
    >
      <View style={styles.capsule}>
        <Text style={styles.capsuleText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.meta}>
          {text}
        </Text>
      </View>
    </View>
  );
}

export interface DeckTextColumnProps {
  readonly title: string;
  readonly kicker: string | null;
  /** Points up from the card's bottom edge: `platePresentation(...).titleBottom`. */
  readonly bottom: number;
  /** No photo: neutral fill behind, dark type. */
  readonly dark?: boolean;
  readonly smartChip?: { text: string; tone: 'warn' | 'info' } | null;
  /** Curated plan: the stop thumbnails and the route line, above the kicker. */
  readonly stack?: { photos: readonly string[]; route: string | null } | null;
}

/**
 * The column above the plate, bottom-anchored on the title's existing anchor so
 * the title never moves: [smart chip] [stop stack + route] [kicker] [title].
 */
export function DeckTextColumn({
  title,
  kicker,
  bottom,
  dark = false,
  smartChip = null,
  stack = null,
}: DeckTextColumnProps): React.ReactElement {
  return (
    <View pointerEvents="none" style={[styles.column, { bottom }]} testID="deck-text-column">
      {smartChip ? (
        <View
          testID="deck-smart-chip"
          style={[styles.smartChip, { backgroundColor: smartChip.tone === 'warn' ? SMART_CHIP.warnFill : SMART_CHIP.fill }]}
        >
          <Text style={styles.smartChipText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.meta}>
            {smartChip.text}
          </Text>
        </View>
      ) : null}
      {stack && (stack.photos.length > 0 || stack.route) ? (
        <View style={styles.stackRow} testID="deck-stop-stack">
          {stack.photos.slice(0, STOP_STACK.max).map((uri, i) => (
            <StackThumb key={`stack_${i}`} uri={uri} overlap={i > 0} />
          ))}
          {stack.route ? (
            <View style={styles.routeCapsule}>
              <Text
                testID="deck-route-line"
                style={styles.routeText}
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={MAX_FONT_SCALE.meta}
              >
                {stack.route}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {kicker ? (
        <Text
          testID="deck-kicker"
          style={[styles.kicker, dark ? styles.kickerDark : null]}
          numberOfLines={KICKER.lines}
          maxFontSizeMultiplier={MAX_FONT_SCALE.meta}
        >
          {kicker.toLocaleUpperCase()}
        </Text>
      ) : null}
      <Text
        testID="deck-title"
        style={[styles.title, dark ? styles.titleDark : null]}
        numberOfLines={S1.titleLines}
        maxFontSizeMultiplier={MAX_FONT_SCALE.title}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * One stop thumbnail. Small images use the existing `_thumb.jpg` objects (never
 * Supabase image transforms — the spend cap is armed); a missing thumb falls
 * back to the original once, then to the neutral fill.
 */
function StackThumb({ uri, overlap }: { uri: string; overlap: boolean }): React.ReactElement {
  const source = React.useMemo(() => resolvePlacePhotoThumbSource(uri), [uri]);
  const [stage, setStage] = React.useState<'thumb' | 'original' | 'failed'>('thumb');
  React.useEffect(() => setStage('thumb'), [uri]);
  const current =
    source === null ? null : stage === 'thumb' ? source.uri : stage === 'original' ? source.fallbackUri ?? null : null;
  const style = [styles.stackThumb, overlap ? styles.stackThumbOverlap : null];
  if (current === null) return <View style={[style, styles.stackThumbEmpty]} />;
  return (
    <ExpoImage
      source={{ uri: current }}
      style={style}
      contentFit="cover"
      cachePolicy="disk"
      onError={() => setStage((prev) => (prev === 'thumb' && source?.fallbackUri ? 'original' : 'failed'))}
    />
  );
}

/** The host chip, top-left, on a claimed venue. Initials disc + host name. */
export function HostChip({
  name,
  top,
  label,
}: {
  name: string;
  top: number;
  label: string;
}): React.ReactElement | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const initials = trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('');
  return (
    <View
      testID="deck-host-chip"
      pointerEvents="none"
      accessible
      accessibilityLabel={label}
      style={[styles.hostChip, { top }]}
    >
      <View style={styles.hostDisc}>
        <Text style={styles.hostDiscText} maxFontSizeMultiplier={MAX_FONT_SCALE.controlLabel}>
          {initials}
        </Text>
      </View>
      <Text style={styles.hostName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.controlLabel}>
        {trimmed}
      </Text>
    </View>
  );
}

/** No photo at all, or every photo failed: the warm neutral fill. */
export function NoPhotoFill(): React.ReactElement {
  return <View testID="deck-no-photo-fill" pointerEvents="none" style={styles.noPhoto} />;
}

const styles = StyleSheet.create({
  bars: {
    position: 'absolute',
    left: PHOTO_PAGER.bar.side,
    right: PHOTO_PAGER.bar.side,
    flexDirection: 'row',
    gap: PHOTO_PAGER.bar.gap,
    zIndex: 3,
  },
  bar: {
    flex: 1,
    height: PHOTO_PAGER.bar.height,
    borderRadius: PHOTO_PAGER.bar.radius,
  },
  capsuleRow: {
    position: 'absolute',
    left: PHOTO_PAGER.bar.side,
    right: PHOTO_PAGER.bar.side,
    flexDirection: 'row',
    zIndex: 3,
  },
  capsuleRowCenter: {
    justifyContent: 'center',
  },
  capsule: {
    paddingHorizontal: PHOTO_PAGER.label.paddingH,
    paddingVertical: PHOTO_PAGER.label.paddingV,
    borderRadius: PHOTO_PAGER.label.radius,
    backgroundColor: PHOTO_PAGER.label.fill,
    maxWidth: '100%',
  },
  capsuleText: {
    fontSize: PHOTO_PAGER.label.size,
    lineHeight: PHOTO_PAGER.label.lineHeight,
    fontWeight: PHOTO_PAGER.label.weight as '600',
    color: PHOTO_PAGER.label.color,
  },
  column: {
    position: 'absolute',
    left: S1.titleInset,
    right: S1.titleInset,
    alignItems: 'flex-start',
    zIndex: 2,
  },
  smartChip: {
    paddingHorizontal: SMART_CHIP.paddingH,
    paddingVertical: SMART_CHIP.paddingV,
    borderRadius: SMART_CHIP.radius,
    marginBottom: SMART_CHIP.marginBottom,
    maxWidth: '100%',
  },
  smartChipText: {
    fontSize: SMART_CHIP.size,
    lineHeight: SMART_CHIP.lineHeight,
    fontWeight: SMART_CHIP.weight as '600',
    color: SMART_CHIP.color,
  },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: STOP_STACK.marginBottom,
    maxWidth: '100%',
  },
  stackThumb: {
    width: STOP_STACK.size,
    height: STOP_STACK.size,
    borderRadius: STOP_STACK.radius,
    borderWidth: STOP_STACK.borderWidth,
    borderColor: STOP_STACK.border,
  },
  stackThumbOverlap: {
    marginLeft: -STOP_STACK.overlap,
  },
  stackThumbEmpty: {
    backgroundColor: NO_PHOTO.fill,
  },
  routeCapsule: {
    flexShrink: 1,
    marginLeft: STOP_STACK.gapToRoute,
    paddingHorizontal: PHOTO_PAGER.label.paddingH,
    paddingVertical: PHOTO_PAGER.label.paddingV,
    borderRadius: PHOTO_PAGER.label.radius,
    // The route sits higher than the kicker clause measures, so it carries its
    // own backing rather than relying on the scrim for its contrast.
    backgroundColor: PHOTO_PAGER.label.fill,
  },
  routeText: {
    fontSize: STOP_STACK.routeSize,
    fontWeight: STOP_STACK.routeWeight as '500',
    color: STOP_STACK.routeColor,
  },
  kicker: {
    fontSize: KICKER.size,
    lineHeight: KICKER.lineHeight,
    fontWeight: KICKER.weight as '700',
    letterSpacing: KICKER.letterSpacing,
    color: KICKER.color,
    marginBottom: KICKER.gap,
  },
  kickerDark: {
    color: KICKER.darkColor,
  },
  title: {
    color: '#FFFFFF',
    fontSize: S1.titleSize,
    fontWeight: S1.titleWeight as '700',
    lineHeight: S1.titleLH,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  titleDark: {
    color: NO_PHOTO.titleColor,
    textShadowColor: 'transparent',
    textShadowRadius: 0,
  },
  hostChip: {
    position: 'absolute',
    left: PHOTO_PAGER.bar.side,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: HOST_CHIP.gap,
    paddingLeft: HOST_CHIP.paddingL,
    paddingRight: HOST_CHIP.paddingR,
    paddingVertical: HOST_CHIP.paddingV,
    borderRadius: HOST_CHIP.radius,
    backgroundColor: HOST_CHIP.fill,
    maxWidth: '70%',
  },
  hostDisc: {
    width: HOST_CHIP.discSize,
    height: HOST_CHIP.discSize,
    borderRadius: HOST_CHIP.discSize / 2,
    backgroundColor: HOST_CHIP.discFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostDiscText: {
    fontSize: HOST_CHIP.discTextSize,
    fontWeight: '700',
    color: HOST_CHIP.discTextColor,
  },
  hostName: {
    fontSize: HOST_CHIP.size,
    fontWeight: HOST_CHIP.weight as '600',
    color: HOST_CHIP.color,
    flexShrink: 1,
  },
  noPhoto: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: NO_PHOTO.fill,
  },
});
