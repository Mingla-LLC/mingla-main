/**
 * #4347 — THE ONE RULE FOR SHOWING AN EXPLORER PRICE.
 *
 * Pure (no imports) so the Deno unit lane can load it. The React Native
 * binding (`formatDisplayPrice` in components/utils/formatters.ts) supplies the
 * symbol table and the servable client rates; everything that decides what the
 * viewer reads lives here.
 *
 * Every amount enters WITH the currency it is in. A price that has no source
 * currency is not a price this module will print (Constitution 9).
 *
 * Rules (spec on #4347, approved 2026-11-08):
 *   - Same currency as the viewer: the exact amount, no mark.
 *   - Converted: prefixed "≈", rounded — under 100 to whole units, under 1,000
 *     to the nearest 5, under 10,000 to the nearest 10, and 10,000 or more in
 *     compact form ("≈ ₦1.2M"). A range keeps both ends.
 *   - Conversion source, in order: the server's display fields when they are in
 *     the viewer's currency (the daily FX snapshot), then a servable client
 *     rate, then NONE — the source amount with the source currency's OWN
 *     symbol. A viewer's symbol is never written next to an unconverted number.
 *   - When converted, `sourceText` carries the exact original so the expanded
 *     surfaces can say "₦100,000 · charged in naira".
 */

export interface ServerDisplayPrice {
  readonly displayPriceMin?: number | null;
  readonly displayPriceMax?: number | null;
  readonly displayCurrency?: string | null;
  readonly priceIsApprox?: boolean | null;
}

export interface DisplayPriceInput {
  /** Lowest amount, in MAJOR units of `sourceCurrency`. */
  readonly min: number;
  /** Highest amount; null/undefined/equal to min = a single price. */
  readonly max?: number | null;
  /** The ceiling is unknown — print "from" ("₦5,000+"). */
  readonly openEnded?: boolean | null;
  /** ISO 4217 code the amounts are in. Required: no default, ever. */
  readonly sourceCurrency: string;
  /** The viewer's currency (profile). Absent = show the source as-is. */
  readonly viewerCurrency: string | null | undefined;
  /** The server's conversion for this card, when it sent one. */
  readonly server?: ServerDisplayPrice | null;
}

export interface DisplayPriceDeps {
  /** The glyph for a code ("₦"), or null when the app has none. */
  readonly symbolFor: (code: string) => string | null;
  /**
   * 1 USD = rate units of `code`, from a SERVABLE rate table. null when there
   * is no servable rate — never a guessed 1:1.
   */
  readonly rateFor: (code: string) => number | null;
  readonly locale?: string;
}

export interface DisplayPrice {
  /** What the viewer reads: "≈ $74", "₦100,000", "≈ ₦135K–₦270K". */
  readonly text: string;
  readonly isApprox: boolean;
  /** The currency `text` is written in. */
  readonly currency: string;
  /** The exact source amount when `text` is converted; otherwise null. */
  readonly sourceText: string | null;
  readonly sourceCurrency: string;
}

const CODE = /^[A-Z]{3}$/;

function normCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function group(value: number, locale: string | undefined, fractionDigits: number): string {
  try {
    return value.toLocaleString(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toFixed(fractionDigits);
  }
}

function prefix(code: string, deps: DisplayPriceDeps): string {
  const symbol = deps.symbolFor(code);
  return typeof symbol === 'string' && symbol.length > 0 ? symbol : `${code} `;
}

/** "≈"-side rounding. Exported for the spec's rounding table test. */
export function roundApproxAmount(amount: number): number {
  if (amount < 100) return Math.round(amount);
  if (amount < 1_000) return Math.round(amount / 5) * 5;
  if (amount < 10_000) return Math.round(amount / 10) * 10;
  return amount;
}

function compact(amount: number): string {
  const units: Array<[number, string]> = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (amount >= size) {
      const scaled = amount / size;
      const digits = scaled < 100 ? 1 : 0;
      const text = scaled.toFixed(digits).replace(/\.0$/, '');
      return `${text}${suffix}`;
    }
  }
  return String(Math.round(amount));
}

/** One approximate amount, without the "≈": "$74", "₦135K". */
export function formatApproxAmount(
  amount: number,
  code: string,
  deps: DisplayPriceDeps,
): string {
  const body = amount >= 10_000
    ? compact(amount)
    : group(roundApproxAmount(amount), deps.locale, 0);
  return `${prefix(code, deps)}${body}`;
}

/** One exact amount: "₦100,000", "$12.50". Decimals only when there are some. */
export function formatExactAmount(
  amount: number,
  code: string,
  deps: DisplayPriceDeps,
): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  return `${prefix(code, deps)}${group(whole ? Math.round(amount) : amount, deps.locale, whole ? 0 : 2)}`;
}

function rangeText(
  min: number,
  max: number | null,
  openEnded: boolean,
  one: (amount: number) => string,
): string {
  const lo = one(min);
  if (openEnded) return `${lo}+`;
  if (max === null) return lo;
  const hi = one(max);
  // Rounding can collapse a narrow range into one figure; say it once.
  return hi === lo ? lo : `${lo}–${hi}`;
}

/**
 * The one producer. Returns null when the input cannot honestly be a price
 * (no valid source currency, or no finite amount) — the caller then hides it.
 * Free (0–0) is the CALLER's word to say; this returns the amounts as given.
 */
export function buildDisplayPrice(
  input: DisplayPriceInput,
  deps: DisplayPriceDeps,
): DisplayPrice | null {
  const source = normCode(input.sourceCurrency);
  const min = finiteNonNegative(input.min);
  if (source === null || min === null) return null;
  const rawMax = finiteNonNegative(input.max);
  const openEnded = input.openEnded === true || (rawMax !== null && rawMax < min);
  const max = openEnded || rawMax === null || rawMax === min ? null : rawMax;

  const exact = (code: string, lo: number, hi: number | null): string =>
    rangeText(lo, hi, openEnded, (amount) => formatExactAmount(amount, code, deps));
  const sourceText = exact(source, min, max);

  const viewer = normCode(input.viewerCurrency);
  if (viewer === null || viewer === source) {
    return { text: sourceText, isApprox: false, currency: source, sourceText: null, sourceCurrency: source };
  }

  const approx = (lo: number, hi: number | null): DisplayPrice => ({
    text: `≈ ${rangeText(lo, hi, openEnded, (amount) => formatApproxAmount(amount, viewer, deps))}`,
    isApprox: true,
    currency: viewer,
    sourceText,
    sourceCurrency: source,
  });

  // 1. The server's conversion (the daily FX snapshot), when it is in the
  //    viewer's currency — a collab deck built for someone else is not.
  const server = input.server ?? null;
  const serverMin = finiteNonNegative(server?.displayPriceMin);
  if (server !== null && normCode(server.displayCurrency) === viewer && serverMin !== null) {
    const serverMax = finiteNonNegative(server.displayPriceMax);
    return approx(serverMin, max === null || serverMax === null || serverMax === serverMin ? null : serverMax);
  }

  // 2. A servable client rate.
  const sourceRate = deps.rateFor(source);
  const viewerRate = deps.rateFor(viewer);
  if (
    typeof sourceRate === 'number' && Number.isFinite(sourceRate) && sourceRate > 0 &&
    typeof viewerRate === 'number' && Number.isFinite(viewerRate) && viewerRate > 0
  ) {
    const factor = viewerRate / sourceRate;
    return approx(min * factor, max === null ? null : max * factor);
  }

  // 3. No servable rate: the source amount in its OWN currency.
  return { text: sourceText, isApprox: false, currency: source, sourceText: null, sourceCurrency: source };
}

/** True for an explicit zero-to-zero price — the caller's "Free". */
export function isFreePrice(min: unknown, max: unknown): boolean {
  return finiteNonNegative(min) === 0 && (max === null || max === undefined || finiteNonNegative(max) === 0);
}
