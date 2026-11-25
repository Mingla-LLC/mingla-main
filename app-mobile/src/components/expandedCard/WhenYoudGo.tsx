/**
 * #4347 wave 2 — "When you'd go", for a single place. Replaces the right-now
 * conditions section on this branch (removed from the curated branch in wave 3).
 *
 * Pick a time (Now · Tonight 7pm · Tomorrow 7pm · your scheduled time) and the
 * block answers for THAT time:
 *   - weather from the Open-Meteo HOURLY forecast at that hour;
 *   - the crowd, from the built-in typical curve for this kind of place, as an
 *     hour-by-hour bar chart with the chosen hour highlighted — always labelled
 *     "Usually …", never live;
 *   - the drive, which is today's estimate and says so (live traffic is a later
 *     wave, blocked on its price).
 * Then "Good to know": sunset (computed on the phone) and a "quieter at" hint
 * when a later hour is a full level quieter. Every row hides when its source
 * has nothing (Constitution 9).
 *
 * #4490 W7 — the same block on an event page (chips Now and Event, `showCrowd`
 * off, Good to know adds "Leave by"). All the maths is in `whenYoudGoModel`.
 *
 * Motion: the bars ease to their heights (Reanimated, 240ms); under Reduce
 * Motion they are drawn at their final heights.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { SPINE, WHEN_BLOCK } from './spineTokens';
import { crowdLevel, type WhenChip, type WhenKey } from './placeSheetModel';
import {
  chipLabelSpec,
  offsetClock,
  whenBlockVisible,
  whenFactsFor,
  wallDayDiff,
  wallWeekday,
  type ClockResolver,
  type LeaveBy,
} from './whenYoudGoModel';
import type { HourlyForecast } from '../../services/weatherService';
import { formatTemperature } from '../utils/formatters';
import type { WhenColors } from '../venuePage/venueExplorerModel';

export interface WhenYoudGoProps {
  readonly chips: readonly WhenChip[];
  readonly selected: WhenKey;
  readonly onSelect: (key: WhenKey) => void;
  readonly hourly: readonly HourlyForecast[] | null;
  readonly weatherUtcOffsetSeconds?: number | null;
  readonly category: string | null | undefined;
  readonly utcOffsetMinutes: number | null;
  readonly openingHours?: unknown;
  readonly driveTime?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly measurementSystem?: 'Metric' | 'Imperial';
  /** Venue-local minute of day -> "7pm". */
  readonly clock: (minuteOfDay: number) => string;
  readonly reducedMotion?: boolean;
  /**
   * #4490 W7 — false on an event page: the event sets the crowd, so the
   * venue's usual curve would mislead. No crowd tile, bars or note then.
   */
  readonly showCrowd?: boolean;
  /** The venue's clock for chip days and times; default: `utcOffsetMinutes`. */
  readonly resolveClock?: ClockResolver;
  /** Injectable clock (tests); default the current time. */
  readonly now?: Date;
  /**
   * #4347 wave 4 — the host venue page draws this block inside the host's own
   * page, as a card in that page's colours (`whenColorsFor`, contrast-checked,
   * neutral fallback). Absent: the place sheet's paper section, unchanged.
   */
  readonly colors?: WhenColors;
  /** The host's brand font for the heading (venue page only). */
  readonly fontFamily?: string;
}

export function WhenYoudGo(props: WhenYoudGoProps): React.ReactElement | null {
  const { t } = useTranslation(['cards']);
  const {
    chips,
    selected,
    onSelect,
    hourly,
    weatherUtcOffsetSeconds,
    category,
    utcOffsetMinutes,
    openingHours,
    driveTime,
    lat,
    lng,
    measurementSystem,
    clock,
    reducedMotion = false,
    showCrowd = true,
    resolveClock,
    now: nowProp,
    colors,
    fontFamily,
  } = props;
  const tone = useMemo(() => (colors ? toneStyles(colors, fontFamily) : null), [colors, fontFamily]);
  const chip = chips.find((c) => c.key === selected) ?? chips[0];
  if (!chip) return null;

  const now = nowProp ?? new Date();
  const resolve = resolveClock ?? offsetClock(utcOffsetMinutes);
  const input = {
    now,
    hourly,
    weatherUtcOffsetSeconds,
    category,
    showCrowd,
    utcOffsetMinutes,
    openingHours,
    driveTime,
    lat,
    lng,
  };
  // The block's own hide rule: with no row left on any chip it is not drawn.
  if (!whenBlockVisible(chips, input)) return null;
  const { weather, crowd, drive, sunset, quieter, leaveBy } = whenFactsFor(chip, input);
  const minuteOf = (at: Date): number => {
    const w = resolve(at);
    return w === null ? 0 : w.hour * 60 + w.minute;
  };

  const chipLabel = (c: WhenChip): string => {
    const spec = chipLabelSpec(c, now, resolve);
    switch (spec.kind) {
      case 'now':
        return t('cards:sheet.when_now');
      case 'tonight':
        return t('cards:sheet.when_tonight', { time: clock(spec.minuteOfDay) });
      case 'tomorrow':
        return t('cards:sheet.when_tomorrow', { time: clock(spec.minuteOfDay) });
      case 'scheduled':
        return t('cards:sheet.when_scheduled', { time: clock(spec.minuteOfDay) });
      case 'scheduled_day':
        return t('cards:sheet.when_scheduled_day', { day: spec.day, time: spec.time });
      case 'event':
        return t('cards:sheet.when_event', { time: spec.time });
      case 'event_day':
        return t('cards:sheet.when_event_day', { day: spec.day, time: spec.time });
      default: {
        const never: never = spec;
        return never;
      }
    }
  };

  /** "Leave by 18:30", or "Leave now"; a day is named only when it is not the start's day. */
  const leaveRow = (l: LeaveBy): { label: string; value: string } => {
    if (l.kind === 'now') return { label: t('cards:sheet.leave_now'), value: '' };
    const start = resolve(chip.at);
    const at = resolve(l.at);
    const otherDay = start !== null && at !== null && wallDayDiff(at, start) !== 0;
    const time = clock(minuteOf(l.at));
    return { label: t('cards:sheet.leave_by'), value: otherDay && at !== null ? `${wallWeekday(at)} ${time}` : time };
  };

  const goodToKnow: { key: string; label: string; value: string }[] = [];
  if (sunset) goodToKnow.push({ key: 'sunset', label: t('cards:sheet.sunset'), value: clock(minuteOf(sunset)) });
  if (quieter !== null) goodToKnow.push({ key: 'quieter', label: t('cards:sheet.quieter_at'), value: clock(quieter * 60) });
  if (leaveBy) goodToKnow.push({ key: 'leave_by', ...leaveRow(leaveBy) });

  return (
    <View style={[styles.section, tone?.section]} testID="sheet-when">
      <Text style={[styles.heading, tone?.heading]} accessibilityRole="header">
        {t('cards:sheet.when_title')}
      </Text>
      <View style={styles.chips}>
        {chips.map((c) => {
          const on = c.key === chip.key;
          return (
            <TouchableOpacity
              key={c.key}
              testID={`sheet-when-chip-${c.key}`}
              onPress={() => onSelect(c.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              // #4490 W7: 34 pt to look at, 44 pt to tap.
              hitSlop={WHEN_CHIP_HIT_SLOP}
              style={[styles.chip, tone?.chip, on ? styles.chipOn : null, on ? tone?.chipOn : null]}
            >
              <Text
                style={[styles.chipText, tone?.chipText, on ? styles.chipTextOn : null, on ? tone?.chipTextOn : null]}
                maxFontSizeMultiplier={1.3}
              >
                {chipLabel(c)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.facts}>
        {weather ? (
          <View style={[styles.fact, tone?.fact]} testID="sheet-when-weather">
            <Text style={[styles.factLabel, tone?.muted]}>{t('cards:sheet.weather')}</Text>
            <Text style={[styles.factValue, tone?.text]}>
              {`${formatTemperature(weather.temperature, measurementSystem)}${
                typeof weather.precipitationProbability === 'number' && weather.precipitationProbability >= 30
                  ? ` · ${t('cards:sheet.rain_chance', { pct: Math.round(weather.precipitationProbability) })}`
                  : ''
              }`}
            </Text>
          </View>
        ) : null}
        {crowd ? (
          <View style={[styles.fact, tone?.fact]} testID="sheet-when-crowd">
            <Text style={[styles.factLabel, tone?.muted]}>{t('cards:sheet.crowd')}</Text>
            <Text style={[styles.factValue, tone?.text]}>{t(`cards:sheet.crowd_usually_${crowd.level}`)}</Text>
          </View>
        ) : null}
        {drive ? (
          <View style={[styles.fact, tone?.fact]} testID="sheet-when-drive">
            <Text style={[styles.factLabel, tone?.muted]}>{t('cards:sheet.drive')}</Text>
            <Text style={[styles.factValue, tone?.text]}>{t('cards:sheet.drive_estimate', { time: drive })}</Text>
          </View>
        ) : null}
      </View>

      {crowd ? (
        <View
          style={styles.bars}
          accessible
          accessibilityLabel={t('cards:sheet.crowd_chart_a11y')}
          testID="sheet-when-bars"
        >
          {Array.from({ length: WHEN_BLOCK.lastHour - WHEN_BLOCK.firstHour + 1 }, (_, i) => {
            const hour = WHEN_BLOCK.firstHour + i;
            const value = crowd.hourly[hour] ?? 0;
            return (
              <CrowdBar
                key={hour}
                pct={Math.max(WHEN_BLOCK.barMinPct, value)}
                active={hour === crowd.hour}
                reducedMotion={reducedMotion}
                colors={colors}
              />
            );
          })}
        </View>
      ) : null}
      {crowd || drive ? (
        <Text style={[styles.note, tone?.muted]} testID="sheet-when-note">
          {[crowd ? t('cards:sheet.crowd_note') : null, drive ? t('cards:sheet.drive_note') : null]
            .filter((line): line is string => line !== null)
            .join(' ')}
        </Text>
      ) : null}

      {goodToKnow.length > 0 ? (
        <View style={styles.goodToKnow} testID="sheet-good-to-know">
          <Text style={[styles.subheading, tone?.text]}>{t('cards:sheet.good_to_know')}</Text>
          {goodToKnow.map((row) => (
            <View key={row.key} style={styles.row} testID={`sheet-good-${row.key}`}>
              <Text style={[styles.rowLabel, tone?.muted]}>{row.label}</Text>
              <Text style={[styles.rowValue, tone?.text]}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The chip is 34 pt tall to look at; 5 pt above and below make the 44 pt target. */
export const WHEN_CHIP_HIT_SLOP = { top: 5, bottom: 5 } as const;

/** Exposed for tests: the crowd label for a popularity value. */
export const crowdLabelKey = (popularity: number): string => `cards:sheet.crowd_usually_${crowdLevel(popularity)}`;

function CrowdBar({
  pct,
  active,
  reducedMotion,
  colors,
}: {
  pct: number;
  active: boolean;
  reducedMotion: boolean;
  colors?: WhenColors;
}) {
  const target = (pct / 100) * WHEN_BLOCK.barsHeight;
  const style = useAnimatedStyle(() => ({
    height: reducedMotion ? target : withTiming(target, { duration: 240 }),
  }), [target, reducedMotion]);
  return (
    <View style={styles.barSlot}>
      <Reanimated.View
        testID={active ? 'sheet-when-bar-active' : 'sheet-when-bar'}
        style={[
          styles.bar,
          active ? styles.barActive : null,
          colors ? { backgroundColor: active ? colors.barActiveFill : colors.barFill } : null,
          style,
        ]}
      />
    </View>
  );
}

/** #4347 wave 4 — the host-themed overrides (venue page). Built once per palette. */
function toneStyles(c: WhenColors, fontFamily?: string) {
  return StyleSheet.create({
    section: {
      backgroundColor: c.surface,
      borderTopWidth: 0,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    heading: { color: c.heading, ...(fontFamily ? { fontFamily } : null) },
    chip: { backgroundColor: c.chipFill },
    chipOn: { backgroundColor: c.chipActiveFill },
    chipText: { color: c.text },
    chipTextOn: { color: c.chipActiveText },
    fact: { backgroundColor: c.tileFill },
    text: { color: c.text },
    muted: { color: c.muted },
  });
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: SPINE.gutter,
    paddingVertical: SPINE.sectionPaddingVertical,
    borderTopWidth: 1,
    borderTopColor: SPINE.rule,
  },
  heading: {
    fontSize: SPINE.headingSize,
    letterSpacing: SPINE.headingLetterSpacing,
    fontWeight: '700',
    color: SPINE.heading,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  chips: {
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
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  fact: {
    flexGrow: 1,
    flexBasis: '30%',
    padding: 10,
    borderRadius: 12,
    backgroundColor: SPINE.chipFill,
  },
  factLabel: {
    fontSize: 12,
    // #4347 rework (P2-c) — 12pt on the #F3F4F6 tile needs 4.5:1; #6B7280
    // measured 4.39:1, SPINE.muted (#4B5563) is 6.9:1.
    color: SPINE.muted,
  },
  factValue: {
    fontSize: 15,
    fontWeight: '600',
    color: SPINE.factValue,
    marginTop: 2,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: WHEN_BLOCK.barsHeight,
    gap: WHEN_BLOCK.barGap,
    marginTop: 16,
  },
  barSlot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 3,
    backgroundColor: WHEN_BLOCK.barFill,
  },
  barActive: {
    backgroundColor: WHEN_BLOCK.barActiveFill,
  },
  note: {
    marginTop: 8,
    fontSize: 12,
    color: SPINE.muted,
  },
  goodToKnow: {
    marginTop: 16,
  },
  subheading: {
    fontSize: 14,
    fontWeight: '700',
    color: SPINE.factValue,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 14,
    color: SPINE.factLabel,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: SPINE.factValue,
  },
});
