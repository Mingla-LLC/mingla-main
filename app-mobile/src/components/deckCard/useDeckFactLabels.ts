import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { joinKicker, type DeckFactLabels } from './deckCardModel';
import { getReadableCategoryName } from '../../utils/categoryUtils';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Venue-local minute of day -> a short clock in the viewer's language:
 * "11pm" / "9:30am" in English, "23:00" in German. The minute is already
 * venue-local, so it is formatted as UTC (no second time-zone shift).
 */
export function formatClockMinute(minuteOfDay: number, language: string): string {
  const minutes = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const date = new Date(Date.UTC(2024, 0, 1, Math.floor(minutes / 60), minutes % 60));
  try {
    const text = new Intl.DateTimeFormat(language, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(date);
    // A 12-hour English clock reads "11pm" / "9:30am" on the deck (the approved
    // design); a 24-hour clock ("18:00") is left exactly as the locale writes it.
    if (!/^en\b/i.test(language) || !/[AaPp]\.?\s?[Mm]\.?$/.test(text)) return text;
    return text
      .replace(/:00(?=\s?[AaPp])/, '')
      .replace(/\s?([AaPp])\.?\s?[Mm]\.?$/, (_m, p: string) => `${p.toLowerCase()}m`);
  } catch (error) {
    console.warn('[deckCard] clock format failed:', error instanceof Error ? error.message : error);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }
}

/** Short weekday name `dayOffset` days from `now`, in the viewer's language. */
export function weekdayShort(now: Date, dayOffset: number, language: string): string {
  const date = new Date(now.getTime() + dayOffset * 86_400_000);
  try {
    return new Intl.DateTimeFormat(language, { weekday: 'short' }).format(date);
  } catch (error) {
    console.warn('[deckCard] weekday format failed:', error instanceof Error ? error.message : error);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  }
}

/** The fact-line labels, bound to the current language. */
export function useDeckFactLabels(now: Date): DeckFactLabels {
  const { t, i18n } = useTranslation(['cards']);
  const language = i18n?.language ?? 'en';
  const nowKey = Math.floor(now.getTime() / 60_000);
  return useMemo<DeckFactLabels>(
    () => ({
      openUntil: (time) => t('cards:deck.open_until', { time }),
      closesIn: (minutes) => t('cards:deck.closes_in', { minutes }),
      opensAt: (time) => t('cards:deck.opens_at', { time }),
      opensTomorrow: (time) => t('cards:deck.opens_tomorrow', { time }),
      opensOn: (dayOffset, time) =>
        t('cards:deck.opens_on', { day: weekdayShort(new Date(nowKey * 60_000), dayOffset, language), time }),
      open24h: t('cards:deck.open_24h'),
      clock: (minute) => formatClockMinute(minute, language),
    }),
    [t, language, nowKey],
  );
}

/**
 * A host experience's date for the kicker, in the EVENT's time zone:
 * "Sat 15 Nov, 6pm". Null when there is no parseable start (nothing invented).
 */
export function formatExperienceWhen(
  startsAt: string | null | undefined,
  timeZone: string | null | undefined,
  language: string,
): string | null {
  if (typeof startsAt !== 'string' || startsAt.length === 0) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  const zone = typeof timeZone === 'string' && timeZone.length > 0 ? timeZone : 'UTC';
  try {
    const day = new Intl.DateTimeFormat(language, {
      timeZone: zone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return day;
    return `${day}, ${formatClockMinute((hour % 24) * 60 + minute, language)}`;
  } catch (error) {
    // An unknown time zone: say nothing rather than print the wrong day.
    console.warn('[deckCard] experience date format failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** The first start an experience card carries: its next occurrence, else its master date. */
export function experienceStartsAt(card: {
  upcomingOccurrences?: readonly ({ startAt?: string | null })[] | null;
  masterDateUtc?: string | null;
}): string | null {
  const next = Array.isArray(card.upcomingOccurrences)
    ? card.upcomingOccurrences.find((o) => typeof o?.startAt === 'string' && o.startAt.length > 0)?.startAt ?? null
    : null;
  return next ?? (typeof card.masterDateUtc === 'string' && card.masterDateUtc.length > 0 ? card.masterDateUtc : null);
}

/**
 * The kicker above any deck card's title, one owner for the front AND behind
 * faces so promotion never changes it:
 *   place       "RESTAURANT"
 *   curated     "CURATED PLAN · ROMANTIC"
 *   experience  "SAT 15 NOV, 6PM · EXPERIENCE"   (date first)
 */
export function deckKickerFor(
  card: {
    cardType?: string;
    category?: string | null;
    experienceType?: string | null;
    timezone?: string | null;
    upcomingOccurrences?: readonly ({ startAt?: string | null })[] | null;
    masterDateUtc?: string | null;
  },
  t: Translate,
  language: string,
): string | null {
  if (card.cardType === 'experience') {
    return joinKicker([
      formatExperienceWhen(experienceStartsAt(card), card.timezone ?? null, language),
      t('cards:deck.experience_kicker'),
    ]);
  }
  if (card.cardType === 'curated') {
    const slug = (typeof card.experienceType === 'string' && card.experienceType.trim().length > 0
      ? card.experienceType.trim()
      : '').replace(/-/g, '_');
    const vibe = slug.length > 0 ? t(`common:intent_${slug}`, { defaultValue: '' }) : '';
    return joinKicker([t('cards:deck.curated_kicker'), vibe]);
  }
  return joinKicker([card.category ? getReadableCategoryName(card.category) : null]);
}
