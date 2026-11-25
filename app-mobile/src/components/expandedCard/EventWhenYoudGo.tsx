/**
 * #4490 W7 (b) — "When you'd go" on the event page of an event at a hosted
 * venue, opened from a What's on row. Chips Now and Event (the event's own
 * start, preselected), no crowd, "Leave by" in Good to know. Draws nothing for
 * any other way into the page (hostedEventContext), and nothing when the
 * venue's clock cannot be read (it never shows the phone's clock for a
 * venue's day).
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'react-native-reanimated';
import type { ThemePalette } from '@mingla/offering-rendering/themePalette';

import { WhenYoudGo } from './WhenYoudGo';
import { hostedEventContextFor } from './hostedEventContext';
import { eventWhenChips, initialWhenKey, offsetClock, offsetMinutesAt, zoneClock } from './whenYoudGoModel';
import type { WhenKey } from './placeSheetModel';
import { whenColorsFor } from '../venuePage/venueExplorerModel';
import { formatClockMinute } from '../deckCard/useDeckFactLabels';
import { useVenueForecast } from '../../hooks/useVenueForecast';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useLocalePreferences } from '../../hooks/useLocalePreferences';
import { spacing } from '../../constants/designSystem';
import { useAppStore } from '../../store/appStore';
import { estimateTravelMinutes, haversineKm } from '../../utils/mutateCuratedCard';

export interface EventWhenYoudGoProps {
  readonly brandSlug: string;
  readonly eventSlug: string;
  /** The page's own palette: the block wears it when it stays legible (measured). */
  readonly palette?: ThemePalette | null;
  /** Injectable clock, for tests. */
  readonly now?: Date;
}

export function EventWhenYoudGo({ brandSlug, eventSlug, palette, now: nowProp }: EventWhenYoudGoProps): React.ReactElement | null {
  const { i18n } = useTranslation(['cards']);
  const reducedMotion = useReducedMotion();
  const { measurementSystem } = useLocalePreferences();
  const userId = useAppStore((s) => s.user?.id);
  const ctx = hostedEventContextFor(brandSlug, eventSlug);
  const forecast = useVenueForecast(ctx?.lat, ctx?.lng);
  const viewer = useUserLocation(userId, 'solo').data ?? null;
  const language = i18n?.language ?? 'en';

  const start = useMemo(() => (ctx ? new Date(ctx.startsAt) : null), [ctx]);
  const [now] = useState<Date>(() => nowProp ?? new Date());
  const chips = useMemo(() => eventWhenChips(now, start), [now, start]);
  const [selected, setSelected] = useState<WhenKey>(() => initialWhenKey(chips));
  const when = useMemo(() => whenColorsFor(palette), [palette]);

  if (ctx === null || start === null || Number.isNaN(start.getTime())) return null;

  const forecastOffsetMin =
    typeof forecast.data?.utcOffsetSeconds === 'number' ? Math.round(forecast.data.utcOffsetSeconds / 60) : null;
  // The venue's zone first, then the forecast's own offset (Open-Meteo's
  // timezone=auto is the venue's); with neither the clock is unreadable and
  // the block hides.
  const resolve = ctx.timeZone !== null
    ? zoneClock(ctx.timeZone, forecastOffsetMin === null ? undefined : forecastOffsetMin)
    : forecastOffsetMin !== null
      ? offsetClock(forecastOffsetMin)
      : () => null;
  const startWall = resolve(start);
  if (startWall === null) return null;

  // Drive: today's one estimate. The card's own label when it came with one,
  // else the straight-line estimate from where the viewer is.
  const driveTime =
    ctx.driveTime ??
    (viewer !== null && ctx.lat !== null && ctx.lng !== null
      ? `${estimateTravelMinutes(haversineKm(viewer.lat, viewer.lng, ctx.lat, ctx.lng), 'driving')} min`
      : null);

  return (
    <View style={styles.slot} testID="event-when-you-go">
      <WhenYoudGo
        chips={chips}
        selected={selected}
        onSelect={setSelected}
        hourly={forecast.data?.hourlyForecast ?? null}
        weatherUtcOffsetSeconds={forecast.data?.utcOffsetSeconds ?? null}
        category={null}
        showCrowd={false}
        utcOffsetMinutes={offsetMinutesAt(resolve, start)}
        resolveClock={resolve}
        now={now}
        driveTime={driveTime}
        lat={ctx.lat}
        lng={ctx.lng}
        measurementSystem={measurementSystem}
        clock={(minute) => formatClockMinute(minute, language)}
        reducedMotion={reducedMotion}
        colors={when.colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { marginTop: spacing.lg },
});
