/**
 * Issue #1705 — what each stop in a plan is FOR.
 *
 * Seth: "Same with a plan that shows where to get flowers first. It should
 * indicate get 'flowers here'."
 *
 * A plan's rows are a name, a rating and a photo, so a supermarket and a park
 * read identically and the user has to infer why the supermarket is stop 1. The
 * plan already knows: every stop carries `comboCategory` (the slot's role, set
 * when the plan was composed) and `placeType` (Google's own type). The real
 * picnic plan Seth reviewed on carries `comboCategory: 'groceries'` on stop 1
 * and `'nature'` on stop 2.
 *
 * ---------------------------------------------------------------------------
 * IT RETURNS NULL RATHER THAN GUESSING, AND THAT IS THE WHOLE DESIGN.
 *
 * A wrong purpose is worse than no purpose: "Pick up supplies here" on a
 * cocktail bar is a plan that reads as broken. Only slots whose role is
 * unambiguous get a line. Anything else — an unmapped category, an empty string,
 * a type we have never seen — gets nothing, and the row renders exactly as it
 * does today.
 *
 * The keys are matched against BOTH `comboCategory` and `placeType` because the
 * two vocabularies overlap and neither is guaranteed present: `comboCategory` is
 * ours and authoritative when set, `placeType` is Google's and is the fallback.
 */

/** i18n keys under the `cards` namespace, with English defaults. */
export interface StopPurpose {
  readonly key: string;
  readonly defaultValue: string;
  /** Leading glyph. Decorative — the sentence carries the meaning. */
  readonly icon: string;
}

const PURPOSES: Readonly<Record<string, StopPurpose>> = {
  groceries: { key: 'expanded.purpose_groceries', defaultValue: 'Pick up supplies here', icon: 'cart-outline' },
  grocery_store: { key: 'expanded.purpose_groceries', defaultValue: 'Pick up supplies here', icon: 'cart-outline' },
  supermarket: { key: 'expanded.purpose_groceries', defaultValue: 'Pick up supplies here', icon: 'cart-outline' },
  convenience_store: { key: 'expanded.purpose_groceries', defaultValue: 'Pick up supplies here', icon: 'cart-outline' },

  florist: { key: 'expanded.purpose_flowers', defaultValue: 'Get flowers here', icon: 'flower-outline' },
  flowers: { key: 'expanded.purpose_flowers', defaultValue: 'Get flowers here', icon: 'flower-outline' },

  bakery: { key: 'expanded.purpose_bakery', defaultValue: 'Grab something fresh here', icon: 'cafe-outline' },
  liquor_store: { key: 'expanded.purpose_drinks_togo', defaultValue: 'Pick up drinks here', icon: 'wine-outline' },
  wine_store: { key: 'expanded.purpose_drinks_togo', defaultValue: 'Pick up drinks here', icon: 'wine-outline' },

  nature: { key: 'expanded.purpose_nature', defaultValue: 'Settle in here', icon: 'leaf-outline' },
  park: { key: 'expanded.purpose_nature', defaultValue: 'Settle in here', icon: 'leaf-outline' },

  cafe: { key: 'expanded.purpose_coffee', defaultValue: 'Coffee here', icon: 'cafe-outline' },
  coffee_shop: { key: 'expanded.purpose_coffee', defaultValue: 'Coffee here', icon: 'cafe-outline' },

  casual_food: { key: 'expanded.purpose_eat', defaultValue: 'Eat here', icon: 'restaurant-outline' },
  restaurant: { key: 'expanded.purpose_eat', defaultValue: 'Eat here', icon: 'restaurant-outline' },
  dinner: { key: 'expanded.purpose_eat', defaultValue: 'Eat here', icon: 'restaurant-outline' },

  bar: { key: 'expanded.purpose_drinks', defaultValue: 'Drinks here', icon: 'beer-outline' },
  cocktail_bar: { key: 'expanded.purpose_drinks', defaultValue: 'Drinks here', icon: 'beer-outline' },
  night_club: { key: 'expanded.purpose_dance', defaultValue: 'Dance here', icon: 'musical-notes-outline' },

  dessert: { key: 'expanded.purpose_dessert', defaultValue: 'Dessert here', icon: 'ice-cream-outline' },
  ice_cream_shop: { key: 'expanded.purpose_dessert', defaultValue: 'Dessert here', icon: 'ice-cream-outline' },
};

/**
 * The purpose for a stop, or null when we cannot say.
 *
 * `comboCategory` wins over `placeType`: it is the slot's role in THIS plan,
 * which is a stronger statement than what the venue happens to be.
 */
export function stopPurpose(stop: {
  comboCategory?: string | null;
  placeType?: string | null;
}): StopPurpose | null {
  const norm = (v: unknown): string =>
    (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '');
  return PURPOSES[norm(stop?.comboCategory)] ?? PURPOSES[norm(stop?.placeType)] ?? null;
}

/** Every purpose key, for the locale-coverage guard. */
export function allStopPurposeKeys(): string[] {
  return [...new Set(Object.values(PURPOSES).map((p) => p.key))].sort();
}

/**
 * #1705 — the plan's OCCASION, for the supplies list's line.
 *
 * From the plan's own `category`, which is set when the plan is composed
 * ("Picnic Dates", "Take a Stroll"). Returns null for any category whose
 * occasion cannot be named naturally in a sentence, and the line is then not
 * rendered at all — "Get these for your Gregg Museum of Art & Design" is worse
 * than no line.
 */
export function occasionFromCategory(
  category: string | null | undefined,
): { key: string; defaultValue: string } | null {
  const c = typeof category === 'string' ? category.trim().toLowerCase() : '';
  if (c === '') return null;
  if (c.includes('picnic')) return { key: 'expanded.occasion_picnic', defaultValue: 'your picnic' };
  if (c.includes('stroll')) return { key: 'expanded.occasion_stroll', defaultValue: 'your walk' };
  if (c.includes('beach')) return { key: 'expanded.occasion_beach', defaultValue: 'the beach' };
  if (c.includes('camp')) return { key: 'expanded.occasion_camping', defaultValue: 'your camping trip' };
  if (c.includes('road trip') || c.includes('roadtrip')) {
    return { key: 'expanded.occasion_roadtrip', defaultValue: 'the drive' };
  }
  return null;
}

/** Every occasion key, for the locale-coverage guard. */
export function allOccasionKeys(): string[] {
  return [
    'expanded.occasion_picnic',
    'expanded.occasion_stroll',
    'expanded.occasion_beach',
    'expanded.occasion_camping',
    'expanded.occasion_roadtrip',
  ];
}
