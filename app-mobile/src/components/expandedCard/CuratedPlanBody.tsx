/**
 * #4347 wave 3 — THE EXPANDED CURATED PLAN, in the approved order:
 *
 *   gallery (every stop's photos, tagged "Stop N · Name", in stop order)
 *   summary (kicker, title, tagline, Been here, Starts / Getting around /
 *            Spend / Stops, the route strip that draws in)
 *   the ONE warning card (closed at arrival first, then rain on an outdoor stop)
 *   the locked-in / reservation banners, supplies
 *   the plan: a clock arrival time beside each stop card, legs between them
 *   conditions at your stops · getting there · ends near
 *
 * The pinned bar (Save plan · Route all stops · Share · Schedule this plan) and
 * the sticky stop navigator live in the sheet's own slots (ExpandedCardModal).
 *
 * Every clock time comes from `planTimeline` → `curatedArrivalTimes`, the same
 * arrival model the schedule safety check uses. Changing the start time moves
 * every time, forecast, crowd value and the warning together.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PLAN_SHEET, SPINE } from './spineTokens';
import { PlaceGallery } from './PlaceGallery';
import { PlanSummary, type PlanTileView, type RouteStripStop } from './PlanSummary';
import { PlanStopCard, type StopChip } from './PlanStopCard';
import { PlanConditions, PlanEndsNear, PlanGettingThere, PlanWarningCard, type TableRow, type WarningFix } from './PlanSections';
import { usePlanScroll, type PlanScrollStore } from './planScroll';
import { useCountTo } from './planMotion';
import {
  arrivalOpen,
  countedStops,
  isOutdoorStop,
  legFromViewer,
  minuteOfDay,
  nextStopIndex,
  planEnd,
  planGalleryMedia,
  planMode,
  planTimeline,
  planUtcOffset,
  planWarning,
  rainLikely,
  startTimeOptions,
  stopCrowdAt,
  stopForecastAt,
  stopPhotos,
  stopSunset,
  totalTravelMinutes,
  venueDay,
  weatherGlyph,
  type PlanTimelineStop,
  type StopForecast,
  type TravelMode,
} from './curatedPlanModel';
import { formatPlanDuration } from './expandedCardFacts';
import { stopPurpose } from './stopPurpose';
import { formatClockMinute, weekdayShort } from '../deckCard/useDeckFactLabels';
import { formatTemperature } from '../utils/formatters';
import { extractWeekdayText } from '../../utils/openingHoursUtils';
import { normalizeWebsiteUrl } from '../../utils/normalizeWebsiteUrl';
import { dialablePhone } from '../../../../packages/card-identity/phone.mjs';
import { weatherService } from '../../services/weatherService';
import type { CuratedStop } from '../../types/curatedExperience';
import SuppliesList from './SuppliesList';

const ENGLISH_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface CuratedPlanBodyProps {
  readonly title: string;
  readonly kicker: string | null;
  readonly tagline?: string | null;
  readonly stops: readonly CuratedStop[];
  /** The plan as generated, to tag a swapped stop "Customised". */
  readonly originalStops?: readonly CuratedStop[] | null;
  readonly isBrandExperience: boolean;
  readonly start: Date;
  readonly onStartChange: (at: Date) => void;
  readonly now: Date;
  readonly viewer: { lat?: number | null; lng?: number | null } | null;
  readonly fallbackMode?: string | null;
  readonly measurementSystem?: 'Metric' | 'Imperial';
  readonly spend: { readonly value: string; readonly sub?: string | null } | null;
  readonly beenHere?: React.ReactNode;
  readonly banners?: React.ReactNode;
  readonly supplies: readonly string[];
  readonly suppliesPurposeLine: string | null;
  readonly reducedMotion: boolean;
  readonly active: boolean;
  readonly galleryHeader?: React.ReactNode;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly onOpenLightbox: (images: string[], initialIndex: number) => void;
  readonly onDirections: (stop: CuratedStop) => void;
  readonly onRouteAll: (nextIndex: number, mode: TravelMode) => void;
  readonly onSwap: (index: number) => void;
  readonly swapPanel: (index: number) => React.ReactNode;
  readonly onCall: (tel: string, display: string) => void;
  readonly onWebsite: (url: string) => void;
  readonly scroll: PlanScrollStore;
  readonly onJump: (index: number) => void;
  /** Test seam: the per-stop forecasts, instead of fetching them. */
  readonly forecastsOverride?: readonly (StopForecast | null)[];
}

/** One Open-Meteo forecast per ~5km cell, shared by the stops inside it. */
function usePlanForecasts(stops: readonly CuratedStop[], enabled: boolean): (StopForecast | null)[] {
  const keyOf = (s: CuratedStop): string | null =>
    typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng) && !(s.lat === 0 && s.lng === 0)
      ? `${Math.round(s.lat * 20) / 20}_${Math.round(s.lng * 20) / 20}`
      : null;
  const cells = stops.map(keyOf);
  const signature = cells.join('|');
  const [byCell, setByCell] = React.useState<Record<string, StopForecast | null>>({});
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const unique = Array.from(new Set(cells.filter((c): c is string => c !== null)));
    unique.forEach((cell) => {
      const stop = stops[cells.indexOf(cell)];
      weatherService
        .getWeatherForecast(stop.lat, stop.lng)
        .then((w) => {
          if (cancelled) return;
          setByCell((prev) => ({
            ...prev,
            [cell]: w && Array.isArray(w.hourlyForecast) && w.hourlyForecast.length > 0
              ? { hourly: w.hourlyForecast, utcOffsetSeconds: w.utcOffsetSeconds ?? null }
              : null,
          }));
        })
        .catch((error: unknown) => {
          // The weather chip hides; nothing is invented in its place.
          console.warn('[CuratedPlanBody] forecast failed:', error instanceof Error ? error.message : error);
          if (!cancelled) setByCell((prev) => ({ ...prev, [cell]: null }));
        });
    });
    return () => {
      cancelled = true;
    };
    // `signature` is the stops' cells; the stop objects themselves change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);
  return cells.map((c) => (c === null ? null : byCell[c] ?? null));
}

export function CuratedPlanBody(props: CuratedPlanBodyProps): React.ReactElement {
  const {
    title,
    kicker,
    tagline,
    stops,
    originalStops,
    isBrandExperience,
    start,
    onStartChange,
    now,
    viewer,
    fallbackMode,
    measurementSystem,
    spend,
    beenHere,
    banners,
    supplies,
    suppliesPurposeLine,
    reducedMotion,
    active,
    galleryHeader,
    onClose,
    closeLabel,
    onOpenLightbox,
    onDirections,
    onRouteAll,
    onSwap,
    swapPanel,
    onCall,
    onWebsite,
    scroll,
    onJump,
    forecastsOverride,
  } = props;
  const { t, i18n } = useTranslation(['cards', 'expanded_details']);
  const language = i18n?.language ?? 'en';
  const fetched = usePlanForecasts(stops, active && forecastsOverride === undefined);
  const forecasts = forecastsOverride ? stops.map((_, i) => forecastsOverride[i] ?? null) : fetched;
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const snap = usePlanScroll(scroll);

  // Which card just replaced a swapped-out stop (it slides in; the rest stay).
  const prevIds = React.useRef<string[]>(stops.map((s) => s.placeId));
  const ids = stops.map((s) => s.placeId);
  const swappedIn = ids.map((id, i) => prevIds.current.length === ids.length && prevIds.current[i] !== id);
  React.useEffect(() => {
    prevIds.current = ids;
  });

  const offset = planUtcOffset(stops);
  const clock = (at: Date, off: number | null = offset): string => formatClockMinute(minuteOfDay(at, off), language);
  const dayLabel = (at: Date): string => {
    const diff = venueDay(at, offset) - venueDay(now, offset);
    if (diff === 0) return clock(at);
    if (diff === 1) return t('cards:plan.start_tomorrow', { time: clock(at) });
    return `${weekdayShort(now, diff, language)} ${clock(at)}`;
  };

  const timeline = planTimeline(stops, start, fallbackMode);
  const end = planEnd(timeline);
  const mode = planMode(timeline, fallbackMode);
  const fromViewer = legFromViewer(viewer, stops[0] ?? null, mode);
  const travel = totalTravelMinutes(timeline, fromViewer);
  const modeWord = (m: TravelMode): string => t(`cards:plan.mode_${m}`);
  const minutesMode = (minutes: number, m: TravelMode): string => t('cards:plan.minutes_mode', { minutes, mode: modeWord(m) });
  const estimated = t('cards:expanded.estimated');
  const numberOf = (i: number): number => timeline[i]?.ordinal ?? i + 1;

  // ── Tiles ──────────────────────────────────────────────────────────────────
  const tiles: PlanTileView[] = [];
  tiles.push({
    key: 'starts',
    label: t('cards:plan.tile_starts'),
    value: end ? t('cards:plan.starts_value', { start: dayLabel(start), end: clock(end) }) : dayLabel(start),
    onPress: () => setPickerOpen((v) => !v),
    a11yHint: t('cards:plan.start_picker_title'),
  });
  if (travel > 0) {
    tiles.push({ key: 'travel', label: t('cards:plan.tile_getting_around'), value: minutesMode(travel, mode), sub: estimated });
  }
  if (spend) tiles.push({ key: 'spend', label: t('cards:plan.tile_spend'), value: spend.value, sub: spend.sub ?? null });
  const counted = countedStops(stops);
  const duration = end ? formatPlanDuration(Math.round((end.getTime() - start.getTime()) / 60_000)) : null;
  if (counted > 0) {
    tiles.push({
      key: 'stops',
      label: t('cards:plan.tile_stops'),
      value: duration ? t('cards:plan.stops_value', { count: counted, duration }) : String(counted),
    });
  }

  const route: RouteStripStop[] = stops.map((s, i) => ({
    key: `${s.placeId}_${i}`,
    ordinal: timeline[i]?.ordinal ?? null,
    name: s.placeName,
    photo: stopPhotos(s)[0] ?? null,
    legMinutes: timeline[i]?.leg?.minutes ?? null,
  }));

  // ── Gallery ────────────────────────────────────────────────────────────────
  const gallery = React.useMemo(() => planGalleryMedia(stops), [stops]);
  const galleryMedia = gallery.map((m) => ({
    ...m,
    tag:
      timeline[m.stopIndex]?.ordinal != null
        ? t('cards:deck.stop_label', { number: timeline[m.stopIndex].ordinal, name: stops[m.stopIndex].placeName })
        : stops[m.stopIndex]?.placeName ?? null,
  }));

  // ── The ONE warning ────────────────────────────────────────────────────────
  const warning = planWarning({ stops, start, now, forecasts, fallbackMode, canSwap: !isBrandExperience });
  let warningText: string | null = null;
  const fixes: WarningFix[] = [];
  if (warning) {
    const stop = stops[warning.index];
    if (warning.kind === 'closed') {
      warningText =
        warning.minutesLeft !== null && warning.closesAtMinute !== null
          ? t('cards:plan.warn_closes', {
              name: stop.placeName,
              close: formatClockMinute(warning.closesAtMinute, language),
              time: clock(warning.arrival),
              minutes: warning.minutesLeft,
            })
          : t('cards:plan.warn_closed', { name: stop.placeName, time: clock(warning.arrival) });
    } else {
      warningText = t('cards:plan.warn_rain', {
        time: clock(warning.arrival),
        number: numberOf(warning.index),
        name: stop.placeName,
      });
    }
    if (warning.canSwap) {
      fixes.push({
        key: 'swap',
        label: t('cards:plan.swap_title', { number: numberOf(warning.index) }),
        onPress: () => {
          onSwap(warning.index);
          onJump(warning.index);
        },
      });
    }
    if (warning.fixStart) {
      const fixAt = warning.fixStart;
      fixes.push({ key: 'start', label: t('cards:plan.fix_start', { time: dayLabel(fixAt) }), onPress: () => onStartChange(fixAt) });
    }
  }

  // ── Per stop ───────────────────────────────────────────────────────────────
  const chipsFor = (stop: CuratedStop, tl: PlanTimelineStop, i: number): StopChip[] => {
    const chips: StopChip[] = [];
    const stopOffset = stop.utcOffsetMinutes ?? offset;
    const open = arrivalOpen(tl.open);
    if (open) {
      if (open.kind === 'closed') chips.push({ key: 'open', label: t('cards:plan.chip_closed_at', { time: clock(tl.arrival, stopOffset) }), tone: 'closed' });
      else if (open.kind === 'closes') chips.push({ key: 'open', label: t('cards:plan.chip_closes', { time: formatClockMinute(open.closesAtMinute, language) }), tone: 'warn' });
      else if (open.kind === 'open') chips.push({ key: 'open', label: t('cards:deck.open_until', { time: formatClockMinute(open.closesAtMinute, language) }), tone: 'open' });
      else chips.push({ key: 'open', label: t('cards:deck.open_24h'), tone: 'open' });
    }
    const f = stopForecastAt(forecasts[i] ?? null, tl.arrival);
    if (f) {
      const rain = isOutdoorStop(stop) && rainLikely(f);
      const temp = `${weatherGlyph(f.icon)} ${formatTemperature(f.temperature, measurementSystem)}`.trim();
      const label = t('cards:plan.chip_weather', { temp, time: clock(tl.arrival, stopOffset) });
      chips.push({ key: 'weather', label: rain ? `${label} · ${t('cards:plan.rain_likely')}` : label, tone: rain ? 'warn' : 'neutral' });
    }
    chips.push({ key: 'crowd', label: t(`cards:plan.crowd_then_${stopCrowdAt(stop, tl.arrival)}`), tone: 'neutral' });
    const sunset = stopSunset(stop, tl.arrival);
    if (sunset) chips.push({ key: 'sunset', label: t('cards:plan.chip_sunset', { time: clock(sunset, stopOffset) }), tone: 'neutral' });
    return chips;
  };

  const tagsFor = (stop: CuratedStop, i: number): string[] => {
    const tags: string[] = [];
    if (timeline[i]?.ordinal === null) tags.push(t('cards:expanded.optional'));
    if (stopPurpose(stop)?.key === 'expanded.purpose_groceries') tags.push(t('cards:expanded.shop_chip'));
    const original = originalStops?.[i];
    if (original && original.placeId !== stop.placeId) tags.push(t('cards:expanded.customized'));
    return tags;
  };

  // ── Conditions, getting there, ends near ───────────────────────────────────
  const conditionRows: TableRow[] = timeline.map((tl, i) => {
    const stop = stops[i];
    const f = stopForecastAt(forecasts[i] ?? null, tl.arrival);
    const crowd = t(`cards:plan.crowd_${stopCrowdAt(stop, tl.arrival)}`);
    const weather = f ? `${weatherGlyph(f.icon)} ${formatTemperature(f.temperature, measurementSystem)}`.trim() : null;
    return {
      key: String(i),
      label: t('cards:plan.conditions_row', { number: tl.ordinal ?? '–', name: stop.placeName, time: clock(tl.arrival) }),
      value: weather ? `${weather} · ${crowd}` : crowd,
      warn: f !== null && isOutdoorStop(stop) && rainLikely(f),
    };
  });

  const legRows: TableRow[] = [];
  if (fromViewer !== null && stops[0]) {
    legRows.push({ key: 'you', label: t('cards:plan.you_to', { name: stops[0].placeName }), value: `${minutesMode(fromViewer, mode)} · ${estimated}` });
  }
  timeline.forEach((tl, i) => {
    if (i === 0 || tl.leg === null) return;
    legRows.push({
      key: String(i),
      label: t('cards:plan.leg_row', { from: stops[i - 1].placeName, to: stops[i].placeName }),
      value: `${minutesMode(tl.leg.minutes, tl.leg.mode)} · ${estimated}`,
    });
  });

  const last = stops[stops.length - 1];
  const endsNear =
    last && end
      ? t('cards:plan.ends_near_value', {
          place: last.address ? `${last.placeName}, ${last.address}` : last.placeName,
          time: clock(end),
        })
      : null;

  // ── Layout reporting for the sticky navigator ──────────────────────────────
  const summaryY = React.useRef(0);
  const routeBottomLocal = React.useRef<number | null>(null);
  React.useEffect(() => {
    scroll.setStopCount(stops.length);
  }, [scroll, stops.length]);
  const reportRoute = (): void => {
    if (routeBottomLocal.current !== null) scroll.setRouteBottom(summaryY.current + routeBottomLocal.current);
  };

  const optionLabel = (at: Date): string => dayLabel(at);

  return (
    <View testID="plan-body" onLayout={(e) => scroll.setBodyY(e.nativeEvent.layout.y)}>
      <PlaceGallery
        media={galleryMedia}
        title={title}
        reducedMotion={reducedMotion}
        active={active}
        header={galleryHeader}
        onClose={onClose}
        closeLabel={closeLabel}
        onOpen={(uri, shown) => {
          // The photos still in the gallery (a failed one is never paged to).
          const images = shown.map((m) => m.uri);
          const at = images.indexOf(uri);
          if (images.length > 0) onOpenLightbox(images, Math.max(0, at));
        }}
      />
      <View
        onLayout={(e) => {
          summaryY.current = e.nativeEvent.layout.y;
          reportRoute();
        }}
      >
        <PlanSummary
          kicker={kicker}
          title={title}
          tagline={tagline}
          beenHere={beenHere}
          tiles={tiles}
          route={route}
          onRouteStop={onJump}
          reducedMotion={reducedMotion}
          onRouteBottom={(y) => {
            routeBottomLocal.current = y;
            reportRoute();
          }}
          startPicker={{
            open: pickerOpen,
            title: t('cards:plan.start_picker_title'),
            note: t('cards:plan.start_picker_note'),
            options: startTimeOptions(now, start).map((at) => ({ at, label: optionLabel(at) })),
            selected: start,
            onPick: (at) => {
              setPickerOpen(false);
              onStartChange(at);
            },
          }}
        />
      </View>

      {warning && warningText ? <PlanWarningCard text={warningText} fixes={fixes} reducedMotion={reducedMotion} /> : null}

      {banners}

      <SuppliesList items={supplies as string[]} purposeLine={suppliesPurposeLine} />

      <View style={styles.planSection} onLayout={(e) => scroll.setPlanY(e.nativeEvent.layout.y)} testID="plan-stops">
        <Text style={styles.heading} accessibilityRole="header">
          {t('cards:expanded.the_plan')}
        </Text>
        {timeline.map((tl, i) => {
          const stop = stops[i];
          const purpose = stopPurpose(stop);
          const weekday = extractWeekdayText(stop.openingHours as Parameters<typeof extractWeekdayText>[0]) ?? [];
          const local = stop.utcOffsetMinutes ?? offset;
          const dayIndex =
            local == null ? tl.arrival.getDay() : new Date(tl.arrival.getTime() + local * 60_000).getUTCDay();
          const dial = dialablePhone(stop.phone ?? null, stop.countryCode ?? null) as { display: string; tel: string } | null;
          const website = normalizeWebsiteUrl(stop.website ?? undefined);
          const photos = stopPhotos(stop);
          return (
            <View key={`${stop.placeId}_${i}`} onLayout={(e) => scroll.setStopY(i, e.nativeEvent.layout.y)}>
              {tl.leg ? (
                <View style={styles.legRow} testID={`plan-leg-between-${i}`}>
                  <View style={styles.timeCol} />
                  <View style={styles.leg}>
                    <View style={styles.legDash} />
                    <Text style={styles.legText} maxFontSizeMultiplier={1.4}>
                      {`${minutesMode(tl.leg.minutes, tl.leg.mode)} · ${estimated}`}
                    </Text>
                  </View>
                </View>
              ) : null}
              <View style={styles.stopRow}>
                <ArrivalTime at={tl.arrival} offset={local} language={language} reducedMotion={reducedMotion} index={i} />
                <View style={styles.cardCol}>
                  <PlanStopCard
                    key={stop.placeId}
                    index={i}
                    ordinal={tl.ordinal}
                    name={stop.placeName}
                    purpose={purpose ? t(`cards:${purpose.key}`, { defaultValue: purpose.defaultValue }) : null}
                    dwell={tl.dwellMinutes > 0 ? t('cards:expanded.minutes_here', { count: tl.dwellMinutes }) : null}
                    photos={photos}
                    tags={tagsFor(stop, i)}
                    chips={chipsFor(stop, tl, i)}
                    more={{
                      address: stop.address || null,
                      hours: weekday,
                      todayPrefix: ENGLISH_DAYS[dayIndex] ?? null,
                      description: stop.aiDescription || null,
                      phone: dial ? { display: dial.display } : null,
                      website,
                    }}
                    onDirections={() => onDirections(stop)}
                    onSwap={!isBrandExperience && tl.ordinal !== null ? () => onSwap(i) : null}
                    onCall={dial ? () => onCall(dial.tel, dial.display) : undefined}
                    onWebsite={website ? () => onWebsite(website) : undefined}
                    onOpenPhotos={(at) => onOpenLightbox(photos, Math.max(0, at))}
                    swapPanel={swapPanel(i)}
                    reducedMotion={reducedMotion}
                    swappedIn={swappedIn[i]}
                    pulseSeq={snap.pulse && snap.pulse.index === i ? snap.pulse.seq : null}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <PlanConditions title={t('cards:plan.conditions_title')} rows={conditionRows} note={t('cards:plan.conditions_note')} />
      <PlanGettingThere
        title={t('cards:plan.getting_there')}
        rows={legRows}
        routeLabel={Platform.OS === 'ios' ? t('cards:plan.route_next') : t('cards:plan.route_all')}
        onRoute={stops.length > 0 ? () => onRouteAll(nextStopIndex(timeline, now), mode) : null}
      />
      <PlanEndsNear title={t('cards:expanded.ends_near')} text={endsNear} />
    </View>
  );
}

/** The clock time in the column beside a stop card; it counts to a new value. */
function ArrivalTime({
  at,
  offset,
  language,
  reducedMotion,
  index,
}: {
  at: Date;
  offset: number | null;
  language: string;
  reducedMotion: boolean;
  index: number;
}): React.ReactElement {
  const minute = useCountTo(Math.round(at.getTime() / 60_000), reducedMotion);
  const text = formatClockMinute(minuteOfDay(new Date(minute * 60_000), offset), language);
  const m = /^(.*?)(\s?[ap]m)$/i.exec(text);
  return (
    <View style={styles.timeCol} testID={`plan-stop-${index}-time`}>
      <Text style={styles.time} maxFontSizeMultiplier={1.3}>
        {m ? m[1] : text}
      </Text>
      {m ? (
        <Text style={styles.timeSuffix} maxFontSizeMultiplier={1.3}>
          {m[2].trim()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  planSection: {
    paddingTop: SPINE.sectionPaddingVertical,
    paddingBottom: SPINE.sectionPaddingVertical,
    paddingRight: SPINE.gutter,
    paddingLeft: 8,
    borderTopWidth: 1,
    borderTopColor: SPINE.rule,
  },
  heading: {
    marginLeft: SPINE.gutter - 8,
    fontSize: SPINE.headingSize,
    letterSpacing: SPINE.headingLetterSpacing,
    fontWeight: '700',
    color: SPINE.heading,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  stopRow: {
    flexDirection: 'row',
    marginTop: PLAN_SHEET.cardGap,
  },
  timeCol: {
    width: PLAN_SHEET.timeColumn,
    paddingRight: 8,
    paddingTop: 12,
    alignItems: 'flex-end',
  },
  time: {
    fontSize: PLAN_SHEET.timeSize,
    fontWeight: '700',
    color: SPINE.factValue,
  },
  timeSuffix: {
    fontSize: PLAN_SHEET.timeSuffixSize,
    fontWeight: '500',
    color: SPINE.muted,
  },
  cardCol: {
    flex: 1,
  },
  legRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  leg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
  },
  legDash: {
    width: 2,
    height: 18,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: PLAN_SHEET.legDash,
  },
  legText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
    color: SPINE.muted,
  },
});
