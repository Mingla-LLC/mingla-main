import { aiPlanPriceLabel, curatedDeckSpans, formatPlanDuration, planVisibleStops } from '../expandedCard/expandedCardFacts';
import { formatDisplayPrice } from '../utils/formatters';
import { isFreePrice } from '../../utils/displayPrice';
import type { CuratedExperienceCard } from '../../types/curatedExperience';
import type { MetaSpanInput, PlanPlateContent, PlanPlateTile } from '../deckCardPlate';
import { routeLine } from './deckCardModel';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * #4347 wave 1 — the curated / host-experience deck face's facts, bound to the
 * viewer. ONE function for the front face (CuratedExperienceSwipeCard) and the
 * behind face (SwipeableCards), so a promotion never changes the fact line.
 */
export function curatedFaceFacts(
  card: CuratedExperienceCard,
  options: { t: Translate; currencyCode: string | null | undefined; isBrandExperience: boolean },
): { spans: MetaSpanInput[]; fromPriceLabel: string | null } {
  const { t, currencyCode, isBrandExperience } = options;
  const spans = curatedDeckSpans(card, {
    spendLevelLabel: (level) => t(`cards:price.spend_${level}`),
    freeLabel: t('cards:swipeable.free'),
    stopCountLabel: (count) => t('cards:expanded.stop_count', { count }),
    awayLabel: (minutes) => t('cards:deck.minutes_away', { minutes }),
    isBrandExperience,
  });
  return { spans, fromPriceLabel: isBrandExperience ? experienceFromPrice(card, t, currencyCode) : null };
}

/**
 * "From ≈ $74" for a host experience, converted from the experience's OWN
 * currency by the one Explorer price formatter. "Free" for a real zero. Null
 * when there is no honest price (no currency, no amount).
 */
export function experienceFromPrice(
  card: CuratedExperienceCard,
  t: Translate,
  currencyCode: string | null | undefined,
): string | null {
  if (isFreePrice(card.totalPriceMin, card.totalPriceMax)) return t('cards:swipeable.free');
  const min = card.totalPriceMin;
  if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return null;
  const price = formatDisplayPrice({
    min,
    sourceCurrency: typeof card.currency === 'string' ? card.currency : '',
    viewerCurrency: currencyCode,
    server: card,
  });
  return price === null ? null : t('cards:price.from', { price: price.text });
}

/**
 * #4347 round 2 (Direction B) — an AI plan's collapsed plate: the route over
 * its numbered stops, then Time / Away / Spend. ONE function for the front face
 * (CuratedExperienceSwipeCard) and the behind face (SwipeableCards), so a
 * promotion never changes what the plate says. A fact with no value is left
 * out (Constitution 9); Spend is the real Google estimate ("₦100,000+") when
 * the plan honestly has one, else the spend level.
 */
export function curatedPlanPlate(
  card: CuratedExperienceCard,
  options: { t: Translate; currencyCode: string | null | undefined; photos: readonly string[] },
): PlanPlateContent {
  const { t, currencyCode, photos } = options;
  const all = Array.isArray(card.stops) ? card.stops : [];
  const visible = planVisibleStops(all);
  const tiles: PlanPlateTile[] = [];
  const duration = formatPlanDuration(card.estimatedDurationMinutes);
  if (duration !== null) tiles.push({ key: 'time', label: t('cards:deck.tile_time'), value: duration });
  const away = visible[0]?.travelTimeFromUserMin;
  if (typeof away === 'number' && Number.isFinite(away) && away > 0) {
    tiles.push({ key: 'away', label: t('cards:deck.tile_away'), value: t('cards:deck.away_value', { minutes: Math.round(away) }) });
  }
  const spend = aiPlanPriceLabel(visible, {
    formatMoney: (price) => formatDisplayPrice({ ...price, viewerCurrency: currencyCode })?.text ?? null,
    spendLevelLabel: (level) => t(`cards:price.spend_${level}`),
    freeLabel: t('cards:swipeable.free'),
    planEstimateLabel: (price) => t('cards:deck.price_plus', { price }),
  });
  if (spend !== null) tiles.push({ key: 'spend', label: t('cards:plan.tile_spend'), value: spend, accent: true });
  return { route: routeLine(visible), photos, tiles };
}
