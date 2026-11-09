/**
 * #4347 wave 2 — "When you'd go", for a single place. Replaces the right-now
 * ConditionsSection on this branch (the curated branch keeps it until wave 3).
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
 * Motion: the bars ease to their heights (Reanimated, 240ms); under Reduce
 * Motion they are drawn at their final heights.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { SPINE, WHEN_BLOCK } from './spineTokens';
import {
  crowdLevel,
  forecastAt,
  quieterHour,
  sunsetAt,
  typicalCrowdAt,
  type WhenChip,
  type WhenKey,
} from './placeSheetModel';
import type { HourlyForecast } from '../../services/weatherService';
import { formatTemperature } from '../utils/formatters';
import { extractWeekdayText, isPlaceOpenAt } from '../../utils/openingHoursUtils';

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
}

function minuteOfDay(at: Date, utcOffsetMinutes: number | null): number {
  if (utcOffsetMinutes == null) return at.getHours() * 60 + at.getMinutes();
  const shifted = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
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
  } = props;
  const chip = chips.find((c) => c.key === selected) ?? chips[0];
  if (!chip) return null;

  const weather = forecastAt(hourly, chip.at, weatherUtcOffsetSeconds ?? null);
  const crowd = typicalCrowdAt(category, chip.at, utcOffsetMinutes);
  const weekday = extractWeekdayText(openingHours as Parameters<typeof extractWeekdayText>[0]);
  const quieter = quieterHour(crowd, (hour) => {
    if (weekday === null) return null;
    const delta = (hour - crowd.hour) * 3_600_000;
    return isPlaceOpenAt(weekday, new Date(chip.at.getTime() + delta), utcOffsetMinutes);
  });
  const sunset =
    typeof lat === 'number' && typeof lng === 'number'
      ? sunsetAt(lat, lng, new Date(chip.at.getTime() + (utcOffsetMinutes ?? 0) * 60_000))
      : null;
  const drive = typeof driveTime === 'string' && driveTime.trim().length > 0 ? driveTime.trim() : null;

  const chipLabel = (c: WhenChip): string => {
    const time = clock(minuteOfDay(c.at, utcOffsetMinutes));
    switch (c.key) {
      case 'now':
        return t('cards:sheet.when_now');
      case 'tonight':
        return t('cards:sheet.when_tonight', { time });
      case 'tomorrow':
        return t('cards:sheet.when_tomorrow', { time });
      case 'scheduled':
        return t('cards:sheet.when_scheduled', { time });
      default: {
        const never: never = c.key;
        return never;
      }
    }
  };

  const goodToKnow: { key: string; label: string; value: string }[] = [];
  if (sunset) goodToKnow.push({ key: 'sunset', label: t('cards:sheet.sunset'), value: clock(minuteOfDay(sunset, utcOffsetMinutes)) });
  if (quieter !== null) goodToKnow.push({ key: 'quieter', label: t('cards:sheet.quieter_at'), value: clock(quieter * 60) });

  return (
    <View style={styles.section} testID="sheet-when">
      <Text style={styles.heading} accessibilityRole="header">
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
              style={[styles.chip, on ? styles.chipOn : null]}
            >
              <Text style={[styles.chipText, on ? styles.chipTextOn : null]} maxFontSizeMultiplier={1.3}>
                {chipLabel(c)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.facts}>
        {weather ? (
          <View style={styles.fact} testID="sheet-when-weather">
            <Text style={styles.factLabel}>{t('cards:sheet.weather')}</Text>
            <Text style={styles.factValue}>
              {`${formatTemperature(weather.temperature, measurementSystem)}${
                typeof weather.precipitationProbability === 'number' && weather.precipitationProbability >= 30
                  ? ` · ${t('cards:sheet.rain_chance', { pct: Math.round(weather.precipitationProbability) })}`
                  : ''
              }`}
            </Text>
          </View>
        ) : null}
        <View style={styles.fact} testID="sheet-when-crowd">
          <Text style={styles.factLabel}>{t('cards:sheet.crowd')}</Text>
          <Text style={styles.factValue}>{t(`cards:sheet.crowd_usually_${crowd.level}`)}</Text>
        </View>
        {drive ? (
          <View style={styles.fact} testID="sheet-when-drive">
            <Text style={styles.factLabel}>{t('cards:sheet.drive')}</Text>
            <Text style={styles.factValue}>{t('cards:sheet.drive_estimate', { time: drive })}</Text>
          </View>
        ) : null}
      </View>

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
            />
          );
        })}
      </View>
      <Text style={styles.note} testID="sheet-when-note">
        {drive ? `${t('cards:sheet.crowd_note')} ${t('cards:sheet.drive_note')}` : t('cards:sheet.crowd_note')}
      </Text>

      {goodToKnow.length > 0 ? (
        <View style={styles.goodToKnow} testID="sheet-good-to-know">
          <Text style={styles.subheading}>{t('cards:sheet.good_to_know')}</Text>
          {goodToKnow.map((row) => (
            <View key={row.key} style={styles.row} testID={`sheet-good-${row.key}`}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Exposed for tests: the crowd label for a popularity value. */
export const crowdLabelKey = (popularity: number): string => `cards:sheet.crowd_usually_${crowdLevel(popularity)}`;

function CrowdBar({ pct, active, reducedMotion }: { pct: number; active: boolean; reducedMotion: boolean }) {
  const target = (pct / 100) * WHEN_BLOCK.barsHeight;
  const style = useAnimatedStyle(() => ({
    height: reducedMotion ? target : withTiming(target, { duration: 240 }),
  }), [target, reducedMotion]);
  return (
    <View style={styles.barSlot}>
      <Reanimated.View
        testID={active ? 'sheet-when-bar-active' : 'sheet-when-bar'}
        style={[styles.bar, active ? styles.barActive : null, style]}
      />
    </View>
  );
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
    color: SPINE.factLabel,
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
