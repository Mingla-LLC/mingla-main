/**
 * #4347 — a brand experience's price in the VIEWER's currency.
 *
 * An experience's envelope total (`totalPriceMin` / `totalPriceMax`) is in the
 * host's currency (`events.currency`, e.g. NGN). The app used to format it as
 * if it were the viewer's currency, so ₦100,000 read "$100,000". This attaches
 * the converted figure the deck shows, from the SAME daily FX snapshot the
 * place prices use (`fx_latest_servable_snapshot` → `fx_convert_minor`, #1384).
 *
 * Fields (camelCase, like every other field on the deck card envelope):
 *   displayPriceMin / displayPriceMax — MAJOR units of `displayCurrency`
 *   displayCurrency                   — the viewer's currency, or null
 *   priceIsApprox                     — true when converted
 *
 * Honest absence (Constitution 9): no viewer currency, no servable snapshot,
 * or a currency the snapshot does not carry → all display fields null and
 * priceIsApprox false. The app then shows the SOURCE money with its own
 * symbol. Same currency → the source amounts, not approximate.
 *
 * Collab: the converted figure is per-request. The app prefers it only when
 * `displayCurrency` equals the viewer's own currency, so a card built for one
 * member never shows another member's currency.
 */

export interface ExperienceDisplayPrice {
  displayPriceMin: number | null;
  displayPriceMax: number | null;
  displayCurrency: string | null;
  priceIsApprox: boolean;
}

export interface PricedExperience {
  totalPriceMin: number;
  totalPriceMax: number;
  currency: string;
}

/** Converts MINOR units; null when it cannot (never a guessed rate). */
export type MinorConverter = (
  amountMinor: number,
  source: string,
  target: string,
) => Promise<number | null>;

const CODE = /^[A-Z]{3}$/;
// The fallback only. The real exponent comes from
// supported_brand_currencies.minor_unit_exponent (loadCurrencyExponents, read
// once per request), so a 0- or 3-exponent currency is never mis-scaled.
const DEFAULT_EXPONENT = 2;

export type ExponentLookup = (code: string) => number;

/**
 * #4347 — `supported_brand_currencies.minor_unit_exponent` for every
 * supported code, via the existing `issue_1384_supported_currencies` RPC.
 * Unknown codes (or a failed read) fall back to 2.
 */
// deno-lint-ignore no-explicit-any
export async function loadCurrencyExponents(client: any): Promise<ExponentLookup> {
  const exponents = new Map<string, number>();
  try {
    const { data, error } = await client.rpc('issue_1384_supported_currencies');
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const exponent = row?.minor_unit_exponent;
        if (
          typeof row?.code === 'string' &&
          Number.isInteger(exponent) && exponent >= 0 && exponent <= 3
        ) {
          exponents.set(row.code.toUpperCase(), exponent);
        }
      }
    }
  } catch {
    // fall through to the default
  }
  return (code) => exponents.get(code) ?? DEFAULT_EXPONENT;
}

export function normalizeViewerCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

const NONE: ExperienceDisplayPrice = {
  displayPriceMin: null,
  displayPriceMax: null,
  displayCurrency: null,
  priceIsApprox: false,
};

/**
 * `fx_convert_minor` over one snapshot, memoised per (amount, source, target)
 * so a deck of 30 experiences with repeating prices makes few round trips.
 */
// deno-lint-ignore no-explicit-any
export function dbMinorConverter(client: any, snapshotId: string): MinorConverter {
  const memo = new Map<string, Promise<number | null>>();
  return (amountMinor, source, target) => {
    const key = `${amountMinor}:${source}:${target}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const pending = (async (): Promise<number | null> => {
      try {
        const { data, error } = await client.rpc('fx_convert_minor', {
          p_amount: amountMinor,
          p_source: source,
          p_target: target,
          p_snapshot: snapshotId,
        });
        const raw = typeof data === 'string' ? Number(data) : data;
        if (error || typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
          return null;
        }
        return raw;
      } catch {
        return null;
      }
    })();
    memo.set(key, pending);
    return pending;
  };
}

/** The latest servable snapshot id, or null (stale/expired/missing). */
// deno-lint-ignore no-explicit-any
export async function latestServableSnapshotId(client: any, at: Date): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('fx_latest_servable_snapshot', {
      p_at: at.toISOString(),
    });
    if (error || !Array.isArray(data)) return null;
    const id = data[0]?.snapshot_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function experienceDisplayPrice(
  card: PricedExperience,
  viewerCurrency: string | null,
  convert: MinorConverter | null,
  exponentFor: (code: string) => number = () => DEFAULT_EXPONENT,
): Promise<ExperienceDisplayPrice> {
  const source = normalizeViewerCurrency(card.currency);
  if (viewerCurrency === null || source === null) return NONE;
  const min = Number.isFinite(card.totalPriceMin) ? card.totalPriceMin : null;
  const max = Number.isFinite(card.totalPriceMax) ? card.totalPriceMax : null;
  if (min === null || max === null || min < 0 || max < 0) return NONE;
  if (source === viewerCurrency) {
    return {
      displayPriceMin: min,
      displayPriceMax: max,
      displayCurrency: viewerCurrency,
      priceIsApprox: false,
    };
  }
  if (convert === null) return NONE;
  const sourceScale = 10 ** exponentFor(source);
  const targetScale = 10 ** exponentFor(viewerCurrency);
  const [lo, hi] = await Promise.all([
    convert(Math.round(min * sourceScale), source, viewerCurrency),
    max === min
      ? Promise.resolve<number | null>(null)
      : convert(Math.round(max * sourceScale), source, viewerCurrency),
  ]);
  if (lo === null || (max !== min && hi === null)) return NONE;
  const displayMin = lo / targetScale;
  return {
    displayPriceMin: displayMin,
    displayPriceMax: max === min ? displayMin : (hi as number) / targetScale,
    displayCurrency: viewerCurrency,
    priceIsApprox: true,
  };
}

/** Attach the display fields to every experience card; never throws. */
export async function attachExperienceDisplayPrices<T extends PricedExperience>(
  cards: T[],
  viewerCurrency: string | null,
  convert: MinorConverter | null,
  exponentFor?: ExponentLookup,
): Promise<Array<T & ExperienceDisplayPrice>> {
  return await Promise.all(
    cards.map(async (card) => {
      try {
        return { ...card, ...(await experienceDisplayPrice(card, viewerCurrency, convert, exponentFor)) };
      } catch {
        return { ...card, ...NONE };
      }
    }),
  );
}
