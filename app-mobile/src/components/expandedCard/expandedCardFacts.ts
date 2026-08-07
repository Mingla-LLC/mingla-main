/**
 * THE HERO'S FACTS LINE, for both branches. Issue #1605 wave 4.
 *
 * `isCurated` appears in EXACTLY TWO expressions in the whole expanded-card
 * design, and this file is the first of them: which facts the meta line's four
 * spans are drawn from. (The second is whether the sliver stack and the Plan
 * section render.) It appears in no geometry expression, no colour expression,
 * no section-order expression and no gate on any other section — which is the
 * same rule the collapsed card already obeys, where `s1Single` and `s1Curated`
 * are byte-identical descriptors apart from `curated: true`.
 *
 *     ★ 4.4      ·  6.7 mi   ·  ££        ·  Whiskey Bar      (a single place)
 *     3 stops    ·  2h 15m   ·  £28–£54   ·  Adventurous      (a curated plan)
 *     └─700─┘       └────500 @ #FFFFFF────┘  └─500 @ 0.72─┘
 *
 * ORDER IS TRUNCATION PRIORITY — tail-ellipsis eats the last span first, so the
 * least valuable fact sits last on purpose, and the separators render BETWEEN
 * PRESENT SPANS ONLY.
 *
 * ---------------------------------------------------------------------------
 * ADDRESS AND HOURS ARE NOT ON THIS LINE, AND NEVER WERE
 *
 * The obvious question for a plan — what does the facts line say when the stops
 * have different addresses and different hours — dissolves once you notice that
 * neither is a fact about a PLAN. A plan has no address and no opening hours;
 * its stops do. So the plan's practical details carry `Starts at` / `Ends near`
 * and the hours live on the stop rows, where they are unambiguous.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE INVENTS A VALUE (Constitution 9)
 *
 * A rating of 0 or null yields NO span, not `★ 0.0`. #1669 fixed exactly this:
 * three producers carried `rating || 4.5`, the first fix replaced it with an
 * invented `0`, and `0` rendered as a real-looking terrible score. The guard is
 * `!= null && > 0`, the same one the stop list and the alternates row use.
 */
import type { ExpandedCardData } from '../../types/expandedCardTypes';
import type { CuratedExperienceCard } from '../../types/curatedExperience';
import type { MetaSpanInput } from '../deckCardPlate';
import { parseAndFormatDistance } from '../utils/formatters';
import { tierLabel, TIER_BY_SLUG, type PriceTierSlug } from '../../constants/priceTiers';
import { getReadableCategoryName } from '../../utils/categoryUtils';

export interface FactsOptions {
  readonly measurementSystem?: 'Metric' | 'Imperial';
  /** Already-resolved, viewer-currency plan price, e.g. "£28–£54". */
  readonly planPriceLabel?: string | null;
  /** Already-resolved plan duration, e.g. "2h 15m". */
  readonly planDurationLabel?: string | null;
  /** i18n'd "{{count}} stops". */
  readonly stopCountLabel?: string | null;
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The four spans for a SINGLE PLACE.
 *
 * Span 3 is the price TIER (`££`), not the FX-converted money. The tier is what
 * ranks places against each other at a glance and it is what the collapsed card
 * already shows, so the plate reads identically on both surfaces. The converted
 * figure keeps its own fact row in the body, where it has room for the rate date
 * and the attribution a two-character span could never carry.
 */
export function singlePlaceSpans(
  card: ExpandedCardData,
  options: FactsOptions,
): MetaSpanInput[] {
  const spans: MetaSpanInput[] = [];

  const rating = card.rating;
  if (rating != null && rating > 0) {
    spans.push({ kind: 'rating', text: `★ ${rating.toFixed(1)}` });
  }

  const distance = trimmed(card.distance);
  if (distance !== null) {
    const formatted = trimmed(parseAndFormatDistance(distance, options.measurementSystem));
    if (formatted !== null) spans.push({ kind: 'fact', text: formatted });
  }

  const tier = (card as { priceTier?: string }).priceTier as PriceTierSlug | undefined;
  if (tier != null && TIER_BY_SLUG[tier] !== undefined) {
    spans.push({ kind: 'fact', text: tierLabel(tier) });
  }

  const category = trimmed(card.category);
  if (category !== null) {
    const readable = trimmed(getReadableCategoryName(card.category));
    if (readable !== null) spans.push({ kind: 'tail', text: readable });
  }

  return spans;
}

/**
 * The four spans for a CURATED PLAN. Every one of them is single-valued for a
 * plan, which is why the plate can carry them without deciding anything.
 *
 * The price and the duration are passed in already resolved, because both need
 * the viewer's account preferences (currency) and i18n, and this module is
 * deliberately free of both so it can be unit-tested as arithmetic.
 */
export function curatedPlanSpans(
  card: CuratedExperienceCard,
  options: FactsOptions,
): MetaSpanInput[] {
  const spans: MetaSpanInput[] = [];

  const stops = trimmed(options.stopCountLabel);
  if (stops !== null) spans.push({ kind: 'rating', text: stops });

  const duration = trimmed(options.planDurationLabel);
  if (duration !== null) spans.push({ kind: 'fact', text: duration });

  const price = trimmed(options.planPriceLabel);
  if (price !== null) spans.push({ kind: 'fact', text: price });

  // The plan's vibe. `experienceType` is the generator's own slug; the label is
  // preferred when the card carries one.
  const vibe =
    trimmed(card.categoryLabel) ??
    trimmed(card.experienceType);
  if (vibe !== null) spans.push({ kind: 'tail', text: vibe });

  return spans;
}

/**
 * The stop row's own weighted line: `★ 4.4 · ££ · 20 min here`.
 *
 * Separated from the plate's spans on purpose — a stop's facts are a stop's, and
 * folding them into the plate is what made a plan's identity depend on which
 * stop happened to be first.
 */
export function stopMetaText(
  stop: {
    rating?: number;
    priceTier?: string | null;
    priceLevelLabel?: string | null;
    estimatedDurationMinutes?: number | null;
  },
  minutesLabel: (minutes: number) => string,
): string | null {
  const parts: string[] = [];
  if (stop.rating != null && stop.rating > 0) parts.push(`★ ${stop.rating.toFixed(1)}`);

  const tier = stop.priceTier as PriceTierSlug | undefined | null;
  if (tier != null && TIER_BY_SLUG[tier] !== undefined) {
    parts.push(tierLabel(tier));
  } else {
    const label = trimmed(stop.priceLevelLabel);
    if (label !== null) parts.push(label);
  }

  const minutes = stop.estimatedDurationMinutes;
  // A synthesised duration is NOT a fact. `cardConverters.ts` invents 60 minutes
  // per stop for a curated card, so only a positive, real value renders — and
  // the connector between rows is gated the same way.
  if (typeof minutes === 'number' && minutes > 0) parts.push(minutesLabel(minutes));

  return parts.length > 0 ? parts.join(' · ') : null;
}
