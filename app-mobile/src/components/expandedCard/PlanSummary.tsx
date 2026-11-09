/**
 * #4347 wave 3 — the top of the expanded curated plan, under the gallery:
 * kicker, title, tagline, Been here, the four tiles and the route strip.
 *
 * Tiles: "Starts · tap to change" (opens the start-time choices inline, so the
 * sheet never stacks a second modal), Getting around (total travel minutes),
 * Spend (the spend level; a host experience's converted "≈" price plus what the
 * host charges), and Stops (count · total duration). At large text the 2 x 2
 * grid stacks to one column.
 *
 * The route strip draws in on open — stops pop from 0.4 to 1 (260ms each), legs
 * draw left to right (320ms, ease-out), the whole draw under 1.2s — and never
 * blocks a tap or the scroll: every stop is tappable from the first frame and
 * scrolls to that stop's card.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { BASICS, PLAN_SHEET, SPINE, WHEN_BLOCK } from './spineTokens';
import { PLATE } from '../../../../packages/card-identity/index.js';
import { routeStaggerMs } from './motionTokens';
import { useRouteLegStyle, useRouteStopStyle } from './planMotion';
import { resolvePlacePhotoThumbSource } from '../../utils/placePhotoThumb';

export interface PlanTileView {
  readonly key: 'starts' | 'travel' | 'spend' | 'stops';
  readonly label: string;
  readonly value: string;
  /** A second line (the host's own price, "₦100,000 · charged in naira"). */
  readonly sub?: string | null;
  readonly onPress?: () => void;
  readonly a11yHint?: string;
}

export interface RouteStripStop {
  readonly key: string;
  readonly ordinal: number | null;
  readonly name: string;
  readonly photo: string | null;
  /** Minutes of the leg INTO this stop; null = no leg drawn label. */
  readonly legMinutes: number | null;
}

export interface StartOption {
  readonly at: Date;
  readonly label: string;
}

export interface PlanSummaryProps {
  readonly kicker: string | null;
  readonly title: string;
  readonly tagline?: string | null;
  readonly beenHere?: React.ReactNode;
  readonly tiles: readonly PlanTileView[];
  readonly route: readonly RouteStripStop[];
  readonly onRouteStop: (index: number) => void;
  readonly startPicker: {
    readonly open: boolean;
    readonly title: string;
    readonly note: string;
    readonly options: readonly StartOption[];
    readonly selected: Date;
    readonly onPick: (at: Date) => void;
  } | null;
  readonly reducedMotion: boolean;
  /** Bottom edge of the route strip, relative to this block (the navigator pins past it). */
  readonly onRouteBottom?: (y: number) => void;
}

export function PlanSummary(props: PlanSummaryProps): React.ReactElement {
  const { kicker, title, tagline, beenHere = null, tiles, route, onRouteStop, startPicker, reducedMotion, onRouteBottom } = props;
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= BASICS.stackAtFontScale;

  return (
    <View style={styles.block} testID="plan-summary">
      {kicker ? (
        <Text testID="plan-kicker" style={styles.kicker} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {kicker.toLocaleUpperCase()}
        </Text>
      ) : null}
      <Text testID="plan-title" style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {title}
      </Text>
      {tagline ? (
        <Text testID="plan-tagline" style={styles.tagline} maxFontSizeMultiplier={1.4}>
          {tagline}
        </Text>
      ) : null}
      {beenHere ? <View style={styles.beenHere}>{beenHere}</View> : null}

      {tiles.length > 0 ? (
        <View style={[styles.grid, stacked ? styles.gridStacked : null]} testID={stacked ? 'plan-tiles-stacked' : 'plan-tiles'}>
          {tiles.map((tile) => {
            const body = (
              <>
                <Text style={styles.tileLabel} maxFontSizeMultiplier={1.3}>
                  {tile.label}
                </Text>
                <Text style={styles.tileValue} maxFontSizeMultiplier={1.3} testID={`plan-tile-${tile.key}-value`}>
                  {tile.value}
                </Text>
                {tile.sub ? (
                  <Text style={styles.tileSub} maxFontSizeMultiplier={1.3}>
                    {tile.sub}
                  </Text>
                ) : null}
              </>
            );
            return tile.onPress ? (
              <Pressable
                key={tile.key}
                testID={`plan-tile-${tile.key}`}
                onPress={tile.onPress}
                accessibilityRole="button"
                accessibilityLabel={`${tile.label}: ${tile.value}`}
                accessibilityHint={tile.a11yHint}
                accessibilityState={{ expanded: startPicker?.open === true }}
                style={({ pressed }) => [styles.tile, styles.tilePressable, stacked ? styles.tileStacked : null, pressed ? styles.tilePressed : null]}
              >
                {body}
              </Pressable>
            ) : (
              <View
                key={tile.key}
                testID={`plan-tile-${tile.key}`}
                accessible
                accessibilityLabel={`${tile.label}: ${tile.value}${tile.sub ? `, ${tile.sub}` : ''}`}
                style={[styles.tile, stacked ? styles.tileStacked : null]}
              >
                {body}
              </View>
            );
          })}
        </View>
      ) : null}

      {startPicker?.open ? (
        <View style={styles.picker} testID="plan-start-picker">
          <Text style={styles.pickerTitle}>{startPicker.title}</Text>
          <Text style={styles.pickerNote}>{startPicker.note}</Text>
          <View style={styles.pickerChips}>
            {startPicker.options.map((o) => {
              const on = o.at.getTime() === startPicker.selected.getTime();
              return (
                <Pressable
                  key={o.at.getTime()}
                  testID={`plan-start-option-${o.at.getTime()}`}
                  onPress={() => startPicker.onPick(o.at)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, on ? styles.chipOn : null]}
                >
                  <Text style={[styles.chipText, on ? styles.chipTextOn : null]} maxFontSizeMultiplier={1.3}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {route.length > 1 ? (
        <View
          style={styles.route}
          testID="plan-route"
          onLayout={(e) => onRouteBottom?.(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
        >
          {route.map((stop, i) => (
            <React.Fragment key={stop.key}>
              {i > 0 ? (
                <RouteLeg
                  minutes={stop.legMinutes}
                  delayMs={i * routeStaggerMs(route.length)}
                  reducedMotion={reducedMotion}
                />
              ) : null}
              <RouteStop
                stop={stop}
                index={i}
                delayMs={i * routeStaggerMs(route.length)}
                reducedMotion={reducedMotion}
                onPress={() => onRouteStop(i)}
              />
            </React.Fragment>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RouteStop({
  stop,
  index,
  delayMs,
  reducedMotion,
  onPress,
}: {
  stop: RouteStripStop;
  index: number;
  delayMs: number;
  reducedMotion: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { t } = useTranslation(['cards']);
  const pop = useRouteStopStyle(delayMs, reducedMotion);
  const thumb = React.useMemo(() => (stop.photo ? resolvePlacePhotoThumbSource(stop.photo) : null), [stop.photo]);
  const [useOriginal, setUseOriginal] = React.useState(false);
  const uri = thumb === null ? null : useOriginal ? thumb.fallbackUri ?? thumb.uri : thumb.uri;
  return (
    // The press target is a plain view and is tappable from the first frame;
    // only its contents animate, so the draw never blocks a tap.
    <Pressable
      testID={`plan-route-stop-${index}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        stop.ordinal !== null
          ? t('cards:plan.route_stop_a11y', { number: stop.ordinal, name: stop.name })
          : stop.name
      }
      style={styles.routeSlot}
      hitSlop={6}
    >
      <Reanimated.View style={[styles.routeInner, pop]}>
        <View style={styles.routeThumb}>
          {uri ? (
            <ExpoImage
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              onError={() => {
                if (!useOriginal && thumb?.fallbackUri) setUseOriginal(true);
              }}
            />
          ) : null}
          {stop.ordinal !== null ? (
            <View style={styles.routeBadge}>
              <Text style={styles.routeBadgeText} maxFontSizeMultiplier={1}>
                {stop.ordinal}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.routeName} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {stop.name}
        </Text>
      </Reanimated.View>
    </Pressable>
  );
}

function RouteLeg({
  minutes,
  delayMs,
  reducedMotion,
}: {
  minutes: number | null;
  delayMs: number;
  reducedMotion: boolean;
}): React.ReactElement {
  const { t } = useTranslation(['cards']);
  const draw = useRouteLegStyle(delayMs, reducedMotion);
  return (
    <View style={styles.routeLeg} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {minutes !== null ? (
        <Text style={styles.routeLegLabel} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {t('cards:expanded.minutes_short', { count: minutes })}
        </Text>
      ) : null}
      <View style={styles.routeLegTrack}>
        <Reanimated.View testID="plan-route-leg-fill" style={[styles.routeLegFill, draw]} />
      </View>
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
  tagline: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 22,
    color: SPINE.prose,
  },
  beenHere: {
    marginTop: 10,
    alignSelf: 'flex-start',
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
  tilePressable: {
    borderWidth: 1,
    borderColor: SPINE.hairline,
  },
  tilePressed: {
    opacity: 0.7,
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
    color: SPINE.factValue,
  },
  tileSub: {
    marginTop: 2,
    fontSize: 12,
    color: SPINE.muted,
  },
  picker: {
    marginTop: 12,
    padding: 12,
    borderRadius: BASICS.tileRadius,
    borderWidth: 1,
    borderColor: SPINE.rule,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: SPINE.factValue,
  },
  pickerNote: {
    marginTop: 2,
    fontSize: 13,
    color: SPINE.muted,
  },
  pickerChips: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: WHEN_BLOCK.chipGap,
  },
  chip: {
    minHeight: WHEN_BLOCK.chipHeight,
    borderRadius: WHEN_BLOCK.chipRadius,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: WHEN_BLOCK.chipFill,
  },
  chipOn: {
    backgroundColor: WHEN_BLOCK.chipActiveFill,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: SPINE.factValue,
  },
  chipTextOn: {
    color: WHEN_BLOCK.chipActiveText,
  },
  route: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  routeSlot: {
    width: PLAN_SHEET.routeSlot,
    alignItems: 'center',
  },
  routeInner: {
    alignItems: 'center',
    gap: 3,
  },
  routeThumb: {
    width: PLAN_SHEET.routeThumb,
    height: PLAN_SHEET.routeThumb,
    borderRadius: PLAN_SHEET.routeThumbRadius,
    backgroundColor: SPINE.chipFill,
  },
  routeBadge: {
    position: 'absolute',
    top: -5,
    left: -5,
    width: PLAN_SHEET.routeBadge,
    height: PLAN_SHEET.routeBadge,
    borderRadius: PLAN_SHEET.routeBadge / 2,
    backgroundColor: PLAN_SHEET.routeBadgeFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: PLAN_SHEET.routeBadgeText,
  },
  routeName: {
    maxWidth: PLAN_SHEET.routeSlot,
    fontSize: PLAN_SHEET.routeLabelSize,
    fontWeight: '500',
    color: SPINE.muted,
  },
  routeLeg: {
    flex: 1,
    minWidth: 10,
    height: PLAN_SHEET.routeThumb,
    justifyContent: 'center',
  },
  routeLegLabel: {
    position: 'absolute',
    top: 2,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: PLAN_SHEET.routeLegLabelSize,
    fontWeight: '500',
    color: SPINE.muted,
  },
  routeLegTrack: {
    height: PLAN_SHEET.routeLegHeight,
    backgroundColor: PLAN_SHEET.routeLegTrack,
    overflow: 'hidden',
  },
  routeLegFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PLAN_SHEET.routeLegFill,
  },
});
