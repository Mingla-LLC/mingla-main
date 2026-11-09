import { curatedDeckSpans } from '../expandedCard/expandedCardFacts';
import { formatDisplayPrice } from '../utils/formatters';
import { isFreePrice } from '../../utils/displayPrice';
import type { CuratedExperienceCard } from '../../types/curatedExperience';
import type { MetaSpanInput } from '../deckCardPlate';

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
