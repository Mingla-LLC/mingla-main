/**
 * #4347 wave 2 — the basics block, straight under the gallery: the category
 * kicker, the title, the Been-here control (the ONE state machine, passed in),
 * and up to four tiles — Hours, Per person, From you, Rating.
 *
 * Every tile is omitted when its fact is missing and the grid closes up (a
 * 2 x 2 grid with three tiles is two rows: two, then one). At large text sizes
 * the tiles stack to one column so no value is cut.
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BASICS, SPINE } from './spineTokens';
import { PLATE } from '../../../../packages/card-identity/index.js';
import type { BasicsTile } from './placeSheetModel';

export interface PlaceBasicsProps {
  readonly kicker: string | null;
  readonly title: string;
  readonly tiles: readonly BasicsTile[];
  readonly beenHere?: React.ReactNode;
}

const TONE_COLOR: Record<BasicsTile['tone'], string> = {
  open: SPINE.openText,
  closing: '#92400E',
  closed: SPINE.muted,
  neutral: SPINE.factValue,
};

export function PlaceBasics({ kicker, title, tiles, beenHere = null }: PlaceBasicsProps): React.ReactElement {
  const { t } = useTranslation(['cards']);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= BASICS.stackAtFontScale;
  const label = (key: BasicsTile['key']): string => t(`cards:sheet.tile_${key}`);

  return (
    <View style={styles.block} testID="sheet-basics">
      {kicker ? (
        <Text testID="sheet-kicker" style={styles.kicker} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {kicker.toLocaleUpperCase()}
        </Text>
      ) : null}
      <Text testID="sheet-title" style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {title}
      </Text>
      {beenHere ? <View style={styles.beenHere}>{beenHere}</View> : null}
      {tiles.length > 0 ? (
        <View style={[styles.grid, stacked ? styles.gridStacked : null]} testID={stacked ? 'sheet-tiles-stacked' : 'sheet-tiles'}>
          {tiles.map((tile) => (
            <View
              key={tile.key}
              testID={`sheet-tile-${tile.key}`}
              style={[styles.tile, stacked ? styles.tileStacked : null]}
              accessible
              accessibilityLabel={`${label(tile.key)}: ${tile.value}`}
            >
              <Text style={styles.tileLabel} maxFontSizeMultiplier={1.3}>
                {label(tile.key)}
              </Text>
              <Text style={[styles.tileValue, { color: TONE_COLOR[tile.tone] }]} maxFontSizeMultiplier={1.3}>
                {tile.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: SPINE.gutter,
    paddingTop: 16,
    paddingBottom: 8,
  },
  kicker: {
    fontSize: BASICS.kickerSize,
    letterSpacing: BASICS.kickerLetterSpacing,
    fontWeight: '700',
    color: SPINE.heading,
    marginBottom: 4,
  },
  title: {
    fontSize: BASICS.titleSize,
    lineHeight: BASICS.titleLineHeight,
    fontWeight: '700',
    color: SPINE.factValue,
  },
  // The Been-here control is the deck plate's control (one state machine, its
  // fills derived for the plate's L* 23.5). It keeps that exact backdrop here —
  // the plate's measured opaque solid — so its five states read the same.
  beenHere: {
    marginTop: 10,
    alignSelf: 'flex-start',
    // No padding: when the control renders nothing (signed out, or the visited
    // state still loading) this backdrop collapses to nothing with it.
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: PLATE.fallbackSolid,
  },
  grid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BASICS.tileGap,
  },
  gridStacked: {
    flexDirection: 'column',
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: BASICS.tilePadding,
    borderRadius: BASICS.tileRadius,
    backgroundColor: BASICS.tileFill,
  },
  tileStacked: {
    flexBasis: 'auto',
  },
  tileLabel: {
    fontSize: BASICS.tileLabelSize,
    color: SPINE.factLabel,
    marginBottom: 2,
  },
  tileValue: {
    fontSize: BASICS.tileValueSize,
    fontWeight: '600',
  },
});
