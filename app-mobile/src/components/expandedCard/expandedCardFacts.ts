/**
 * THE CARD'S FACTS LINE — for both BRANCHES and both SURFACES. Issue #1605.
 *
 * ---------------------------------------------------------------------------
 * #1605 P1-6 — ONE PRODUCER, BECAUSE TWO PRODUCED DIFFERENT ANSWERS
 *
 * The whole wave rests on one claim: opening a card CONTINUES it. The plate's
 * geometry was proved identical by measurement — 96.00pt on both surfaces, same
 * insets, same control frames. Its CONTENTS were not, and the meta line is the
 * most-read part of the plate. One tap apart, on the same card:
 *
 *     collapsed   2 stops · 5.8 mi · 1h 23m · Free · Picnic Dates
 *     expanded    3 stops ·          1h 44m · Free · Picnic Dates
 *
 * Three changes on one tap. It was structural, not data luck: two span builders
 * that nothing compared — `CuratedExperienceSwipeCard.tsx:377-386` built up to
 * five spans from `visibleStops` (non-optional), and `curatedPlanSpans` built
 * four from `planStops` (all of them), with no distance and a different
 * duration rule. Geometry was gated; span parity was gated by nothing.
 *
 * So `curatedPlanSpans` is now THE producer and BOTH surfaces call it. Every
 * value is derived here, from the card, so the two surfaces cannot disagree
 * without the function itself changing. The callers supply only what is
 * genuinely viewer-state and cannot live in a module that must stay
 * unit-testable as arithmetic: the currency formatter, the measurement system
 * and the three i18n resolvers.
 *
 * WHICH RULES SURVIVED, AND WHY THE COLLAPSED CARD'S WON
 *
 *   stop count   `stops.filter(s => !s.optional)`, falling back to all stops.
 *                This is not a preference: `mutateCuratedCard.ts:173-178` — the
 *                canonical aggregate recalculation — computes the card's title,
 *                totalPrice and estimatedDuration over exactly that set. The
 *                card's own title is the main stops joined by ` → `, so a plate
 *                that counted optional stops disagreed with the title beside it.
 *   distance     the first visible stop's `distanceFromUserKm`. The expanded
 *                sheet simply never had it; a plan's distance is as much a fact
 *                on the sheet as on the deck.
 *   duration     the card's envelope `estimatedDurationMinutes`, which the
 *                generator computes and `mutateCuratedCard` recomputes. The
 *                sheet used to re-derive it from per-stop values to avoid
 *                summing a synthesised 60 — but `cardConverters.ts` only
 *                invents 60 in the strollData TIMELINE, never in a stop's
 *                `estimatedDurationMinutes`, so the envelope was never built
 *                from invented parts. `formatPlanDuration` still yields NO span
 *                for a non-positive total, so an absent duration stays absent.
 *   price        summed from the visible stops for a curated plan and read from
 *                the envelope for a brand experience — ORCH-0629 + ORCH-1065
 *                BUG-1, both of which are on the deck today with gates behind
 *                them. The sheet read the envelope unconditionally, which is
 *                what ORCH-0629 established is stale or zero for curated cards.
 *
 * ---------------------------------------------------------------------------
 * ORIGINAL HEADER — THE HERO'S FACTS LINE, for both branches:
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
  /**
   * The viewer's own distance to the place, in km, for cards that carry no
   * `distance` of their own.
   *
   * #1605 rework — `ExpandedCardModal` computes this for chat-mounted cards
   * (`computeViewerTravelForChatMount`) and, after the wave-4 rewrite, threw it
   * away: nothing read `viewerDistance`. A chat-mounted card is BY DEFINITION
   * one with no `card.distance` (`isChatMounted = !card.travelTime &&
   * !card.distance`), so those cards lost their distance span entirely, and the
   * value the modal had already computed sat unread. Constitution 2.
   */
  readonly viewerDistanceKm?: number | null;
}

/**
 * Everything `curatedPlanSpans` needs that is genuinely VIEWER state.
 *
 * Deliberately small. Anything that can be derived from the card is derived in
 * the producer, because a value a CALLER derives is a value two callers can
 * derive differently — which is exactly how #1605 P1-6 happened.
 */
export interface CuratedFactsOptions {
  readonly measurementSystem?: 'Metric' | 'Imperial';
  /** `formatCurrency` already bound to the viewer's currency code. */
  readonly formatMoney: (amount: number) => string;
  /** i18n'd "Free". */
  readonly freeLabel: string;
  /** i18n'd "{{count}} stops". */
  readonly stopCountLabel: (count: number) => string;
  /** i18n'd `common:intent_<slug>`. */
  readonly intentLabel: (slug: string) => string;
  /**
   * ORCH-1065 BUG-1 — a brand experience carries its all-in price as the
   * ENVELOPE total and its stops carry `price_cents: 0` each, so summing them
   * yields "Free" for a genuinely priced experience.
   */
  readonly isBrandExperience?: boolean;
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * "2h 15m" / "45m" / "2h" — and NEVER "0m", which would be a fabricated
 * duration on a plan whose stops carry no real timing.
 */
export function formatPlanDuration(totalMinutes: number | null | undefined): string | null {
  if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return null;
  }
  const mins = Math.round(totalMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The stops a plan's identity is computed over. See the header. */
interface PlanStopLike {
  readonly optional?: boolean;
  readonly priceMin?: number;
  readonly priceMax?: number;
  readonly distanceFromUserKm?: number;
}

export function planVisibleStops<T extends PlanStopLike>(stops: readonly T[] | undefined): T[] {
  const all = Array.isArray(stops) ? stops : [];
  const main = all.filter((stop) => stop.optional !== true);
  return main.length > 0 ? main : all;
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

  // The card's own distance first; the viewer-computed one when the card has
  // none. A chat-mounted card only ever has the second (#1605 rework).
  const distanceSource =
    trimmed(card.distance) ??
    (typeof options.viewerDistanceKm === 'number' && options.viewerDistanceKm > 0
      ? `${options.viewerDistanceKm.toFixed(1)} km`
      : null);
  if (distanceSource !== null) {
    const formatted = trimmed(parseAndFormatDistance(distanceSource, options.measurementSystem));
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
 * THE SPANS FOR A CURATED PLAN — the ONE producer, called by BOTH surfaces.
 *
 *     3 stops  ·  6.7 mi  ·  2h 15m  ·  £28–£54  ·  Adventurous
 *     └─700──┘  └────────── 500 @1.0 ──────────┘  └─500 @0.72─┘
 *
 * The stop COUNT takes the 700 slot the rating takes on a place card, because
 * it is the fact that characterises a plan. A SINGLE-stop plan has no count
 * worth stating, so its leading slot falls back to distance — the only
 * positional fact it has. A plan with NO stops states neither, rather than
 * "0 stops".
 *
 * Every span is omitted when its value is absent, and `CardMetaLine` renders
 * separators between PRESENT SPANS ONLY, so a plan with no price begins at
 * duration with no orphaned "·" (Constitution 9).
 *
 * Callers: `CuratedExperienceSwipeCard` (collapsed deck card) and
 * `ExpandedCardModal` (expanded sheet). There must never be a third
 * implementation — `A-4` in the tester suite and `S-5` in this wave's gate
 * assert that both call THIS function and that neither assembles spans itself.
 */
export function curatedPlanSpans(
  card: CuratedExperienceCard,
  options: CuratedFactsOptions,
): MetaSpanInput[] {
  const visibleStops = planVisibleStops(card.stops);
  const spans: MetaSpanInput[] = [];

  // The first VISIBLE stop's distance — the plan starts where it starts.
  const distanceKm = visibleStops[0]?.distanceFromUserKm;
  const formattedDistance =
    typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0
      ? trimmed(parseAndFormatDistance(`${distanceKm.toFixed(1)} km`, options.measurementSystem))
      : null;

  if (visibleStops.length > 1) {
    const count = trimmed(options.stopCountLabel(visibleStops.length));
    if (count !== null) spans.push({ kind: 'rating', text: count });
  } else if (formattedDistance !== null) {
    spans.push({ kind: 'rating', text: formattedDistance });
  }

  if (visibleStops.length > 1 && formattedDistance !== null) {
    spans.push({ kind: 'fact', text: formattedDistance });
  }

  const duration = formatPlanDuration(card.estimatedDurationMinutes);
  if (duration !== null) spans.push({ kind: 'fact', text: duration });

  const price = curatedPriceLabel(card, visibleStops, options);
  if (price !== null) spans.push({ kind: 'fact', text: price });

  // The plan's vibe. `experienceType` is the generator's own slug and the i18n
  // resolver owns turning it into a word; `categoryLabel` is the card's own
  // override when the generator supplied one.
  const slug = (trimmed(card.experienceType) ?? 'adventurous').replace(/-/g, '_');
  const vibe = trimmed(options.intentLabel(slug)) ?? trimmed(card.categoryLabel);
  if (vibe !== null) spans.push({ kind: 'tail', text: vibe });

  return spans;
}

/**
 * The plan's price, by the rule the deck has shipped since ORCH-0629.
 *
 * A CURATED card's per-stop prices are the source of truth — its card-level
 * totals go stale or are left at 0 by the generator. A BRAND EXPERIENCE is the
 * exact inverse (ORCH-1065 BUG-1): the all-in price is the envelope total and
 * every stop carries `price_cents: 0`, so summing the stops would print "Free"
 * over a paid experience. A 0 envelope total on an experience still prints
 * "Free" honestly, because that is what the brand set.
 */
function curatedPriceLabel(
  card: CuratedExperienceCard,
  visibleStops: readonly PlanStopLike[],
  options: CuratedFactsOptions,
): string | null {
  const min =
    options.isBrandExperience === true
      ? finite(card.totalPriceMin)
      : visibleStops.reduce((sum, stop) => sum + finite(stop.priceMin), 0);
  const max =
    options.isBrandExperience === true
      ? finite(card.totalPriceMax)
      : visibleStops.reduce((sum, stop) => sum + finite(stop.priceMax), 0);

  if (min === 0 && max === 0) return trimmed(options.freeLabel);
  if (min === max) return trimmed(options.formatMoney(min));
  // U+2013 en-dash (not hyphen) — typographic convention for ranges.
  const lo = trimmed(options.formatMoney(min));
  const hi = trimmed(options.formatMoney(max));
  if (lo === null || hi === null) return lo ?? hi;
  return `${lo}–${hi}`;
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
  /*
    A SYNTHESISED DURATION IS NOT A FACT — and this guard is only honest because
    the synthesis was removed. #1605 P2-4.

    The previous comment here said "`cardConverters` invents 60 minutes a stop",
    and the tester's complaint was exactly right: `> 0` cannot tell an invented
    60 from a real 60, so the guard did not do what its comment claimed. Both
    halves of that were wrong, and the enumeration is worth writing down because
    the guard is only as good as this list:

      cardConverters.ts:132   `duration: 60` — the strollData TIMELINE step, a
                              different field on a different object. It has never
                              reached a stop's `estimatedDurationMinutes`, so the
                              comment named the wrong producer.
      curatedToTimeline.ts    `|| 45` — timeline again, same story.
      curatedStopsAvailability `?? DEFAULT_STOP_DURATION_MIN` — a LOCAL cumulative
                              used to decide whether a stop is open when you get
                              there. Never written back onto the stop.
      mutateCuratedCard.ts    `|| 45` in the CARD total; the stop it writes
                              carries the alternative's own real value.
      deckService.ts:388      `0` for a brand-experience stop — which this guard
                              correctly renders as nothing.
      messagingService.ts     `Number(s.…) || 45` — THE ONE REAL INVENTION, and
                              the only one that landed on the field this function
                              reads. A chat-shared plan's stops arrived carrying a
                              45 nobody estimated. It is deleted (see that file);
                              the key is now omitted when there is no real value.

    With that gone, every producer of `stop.estimatedDurationMinutes` writes
    either a real estimate or nothing, so `> 0` IS the complete test — not a
    proxy for one. `S-9` pins the removal so the invention cannot come back and
    quietly re-open the gap.

    The connector between rows is gated the same way.
  */
  if (typeof minutes === 'number' && minutes > 0) parts.push(minutesLabel(minutes));

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * A COMPANION STOP'S OWN LINE — `Coffee Shop · ★ 4.4 (128 reviews)`.
 *
 * #1605 wave 4 rework. A stroll's companion stops and a picnic's grocery store
 * render through `StopList` like a plan's stops do, and the first cut gave them
 * a meta of `★ 4.4` and nothing else. Three field-level things went with the
 * deleted `CompanionStopsSection` and two of them are restored here:
 *
 *   type LABEL   the row's only subtitle, backed by the 20-entry map below,
 *                which is reproduced from that component verbatim. `type` is
 *                still written by `cardConverters.ts:116` (`s.placeType`) and
 *                `stopReplacementService`, so it was a live field with no
 *                reader — the exact shape of the bug this rework exists for.
 *   reviewCount  a rating with no sample size is the weakest number on the
 *                sheet. Restored through the SAME i18n key the deleted
 *                component used (`companion_stops.reviews_count`), which is
 *                translated in all 29 locales.
 *
 * The type ICON is NOT restored, and that is a decision rather than an
 * oversight: it was a 40pt circle with a 2pt #EB7825 border carrying a
 * category glyph that said the same thing as the label beside it. The wave
 * removed exactly that ornament everywhere else — the 26pt icon badges in
 * `ConditionsSection`, the `conditionBadge` chips, the `iconBadge` in the
 * details rows — and re-adding one here for a secondary list would make the
 * companion row the loudest thing in the body. The information is the word.
 *
 * The map is English-only, exactly as `CompanionStopsSection` shipped it. That
 * is a pre-existing i18n gap carried forward, not a new one; it is registered
 * rather than silently widened by inventing 20 untranslated keys.
 */
const COMPANION_TYPE_LABEL: Readonly<Record<string, string>> = {
  cafe: 'Café',
  coffee_shop: 'Coffee Shop',
  bakery: 'Bakery',
  ice_cream_shop: 'Ice Cream',
  gelato_shop: 'Gelato',
  food_truck: 'Food Truck',
  restaurant: 'Restaurant',
  bistro: 'Bistro',
  bar: 'Bar',
  wine_bar: 'Wine Bar',
  juice_bar: 'Juice Bar',
  smoothie_shop: 'Smoothie',
  tea_house: 'Tea House',
  donut_shop: 'Donuts',
  pastry_shop: 'Pastry',
  deli: 'Deli',
  sandwich_shop: 'Sandwich',
  pizza_restaurant: 'Pizza',
  fast_food_restaurant: 'Fast Food',
  meal_takeaway: 'Takeaway',
};

/** The fallback the deleted component used. A type we cannot name is still food. */
export const COMPANION_TYPE_FALLBACK = 'Food & Drink';

/** `'coffee_shop'` → `'Coffee Shop'`; anything unmapped → `'Food & Drink'`. */
export function companionTypeLabel(type: unknown): string {
  const key = trimmed(type);
  if (key === null) return COMPANION_TYPE_FALLBACK;
  return COMPANION_TYPE_LABEL[key] ?? COMPANION_TYPE_FALLBACK;
}

export function companionStopMeta(
  stop: {
    type?: unknown;
    rating?: unknown;
    reviewCount?: unknown;
  },
  reviewsLabel: (count: number) => string,
): string | null {
  const parts: string[] = [companionTypeLabel(stop.type)];

  // Same guard as everywhere else on this sheet: a rating of 0 or null yields
  // NO star, never `★ 0.0` (Constitution 9, #1669).
  const rating = stop.rating;
  if (typeof rating === 'number' && Number.isFinite(rating) && rating > 0) {
    const count = stop.reviewCount;
    const reviews =
      typeof count === 'number' && Number.isFinite(count) && count > 0
        ? trimmed(reviewsLabel(Math.round(count)))
        : null;
    parts.push(reviews === null ? `★ ${rating.toFixed(1)}` : `★ ${rating.toFixed(1)} ${reviews}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
