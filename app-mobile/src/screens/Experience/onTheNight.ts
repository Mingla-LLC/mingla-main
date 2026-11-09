/**
 * #4347 wave 3 — the host experience page's "On the night" facts (pure, so a
 * test can drive it). The shared ExperienceOfferingBody renders whatever this
 * returns in its existing "Right now" slot; the web page passes nothing new and
 * is unchanged.
 *
 *   at known  -> "On the night": the hourly forecast AT the experience time
 *                (hidden when the forecast does not reach it), the estimated
 *                drive, and "Leave by …" (start - drive - 5 min, to the 5 min).
 *   at null   -> today's "Right now": current conditions and the drive.
 *
 * The typical-crowd row is not produced: a host stop carries no category, and
 * the generic curve would be a guess (Constitution 9).
 */
import type { RightNowFacts } from "@mingla/offering-rendering";
import type { WeatherData } from "../../services/weatherService";
import { forecastAt } from "../../components/expandedCard/placeSheetModel";
import { weatherGlyph } from "../../components/expandedCard/curatedPlanModel";
import { formatClockMinute } from "../../components/deckCard/useDeckFactLabels";
import { estimateTravelMinutes, haversineKm } from "../../utils/mutateCuratedCard";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const LEAVE_BUFFER_MINUTES = 5;

/** Minute of the day of `at` in an IANA zone, else in the forecast's offset, else device-local. */
export function minuteInZone(at: Date, timeZone: string | null, utcOffsetSeconds: number | null): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(at);
      const h = Number(parts.find((p) => p.type === "hour")?.value);
      const m = Number(parts.find((p) => p.type === "minute")?.value);
      if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + m;
    } catch (error) {
      console.warn("[onTheNight] time zone format failed:", error instanceof Error ? error.message : error);
    }
  }
  if (typeof utcOffsetSeconds === "number") {
    const shifted = new Date(at.getTime() + utcOffsetSeconds * 1000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  }
  return at.getHours() * 60 + at.getMinutes();
}

export function onTheNightFacts(input: {
  at: Date | null;
  now: Date;
  forecast: WeatherData | null;
  timeZone: string | null;
  viewer: { lat?: number | null; lng?: number | null } | null;
  place: { lat: number; lng: number } | null;
  language: string;
  t: Translate;
}): RightNowFacts | null {
  const { at, forecast, timeZone, viewer, place, language, t } = input;
  let driveMinutes: number | null = null;
  if (viewer && typeof viewer.lat === "number" && typeof viewer.lng === "number" && place) {
    driveMinutes = estimateTravelMinutes(haversineKm(viewer.lat, viewer.lng, place.lat, place.lng), "driving");
  }
  const travel = driveMinutes === null ? null : t("cards:sheet.drive_estimate", { time: `${driveMinutes} min` });

  // No time: today's "Right now", worded as before.
  if (at === null || at.getTime() < input.now.getTime()) {
    const weather = forecast ? `${forecast.condition}, ${Math.round(forecast.temperature)}°` : null;
    if (!weather && driveMinutes === null) return null;
    return { weather, travel: driveMinutes === null ? null : `${driveMinutes} min`, estimated: driveMinutes !== null };
  }

  const offset = forecast?.utcOffsetSeconds ?? null;
  const clock = (d: Date): string => formatClockMinute(minuteInZone(d, timeZone, offset), language);
  const hour = forecast ? forecastAt(forecast.hourlyForecast ?? [], at, offset) : null;
  const weather = hour ? `${weatherGlyph(hour.icon)} ${Math.round(hour.temperature)}°`.trim() : null;
  if (!weather && driveMinutes === null) return null;

  // #4347 wave 3 rework: no crowd sentence (there is no crowd row), and a
  // leave-by time that has already passed reads "Leave now", never a past time.
  const notes: string[] = [];
  if (driveMinutes !== null) {
    const leave = new Date(at.getTime() - (driveMinutes + LEAVE_BUFFER_MINUTES) * 60_000);
    const rounded = new Date(Math.floor(leave.getTime() / (5 * 60_000)) * 5 * 60_000);
    notes.push(
      rounded.getTime() <= input.now.getTime()
        ? t("cards:exp.leave_now")
        : t("cards:exp.leave_by", { time: clock(rounded) }),
    );
    notes.push(t("cards:exp.note"));
  }
  return {
    title: t("cards:exp.on_the_night"),
    weatherLabel: t("cards:exp.weather_at", { time: clock(at) }),
    travelLabel: t("cards:sheet.drive"),
    weather,
    travel,
    estimated: driveMinutes !== null,
    footnote: notes.length > 0 ? notes.join(" ") : null,
  };
}
