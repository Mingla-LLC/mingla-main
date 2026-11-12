// Issue #4271 — Stripe Terminal (Tap to Pay) for door sales.
//
// Direct charges: every Terminal object lives on the brand's connected
// account, so each call carries the Stripe-Account header (`stripeAccount`).
//   https://docs.stripe.com/terminal/features/connect?connect-charge-type=direct
// Tap to Pay connects with a Location, so each brand gets one Location per
// country, created once and stored in public.brand_terminal_locations.
//   https://docs.stripe.com/api/terminal/locations/create
// Tap to Pay is offered where Stripe supports it for this integration; Nigeria
// (Paystack) never reaches Stripe Terminal.

/** Countries this build offers Tap to Pay in (issue #4271 F5: UK and US). */
export const TAP_TO_PAY_COUNTRIES = ["GB", "US"] as const;

export function tapToPayCountrySupported(country: string | null | undefined): boolean {
  const c = (country ?? "").trim().toUpperCase();
  return (TAP_TO_PAY_COUNTRIES as readonly string[]).includes(c);
}

export interface TerminalAddress {
  line1: string;
  city: string;
  country: string;
  postal_code?: string;
  state?: string;
}

/**
 * Address fields Stripe requires for a Terminal Location, per country
 * (https://docs.stripe.com/terminal/fleet/locations-and-zones, "Required
 * address properties"): United States line1, city, state, postal_code and
 * country; United Kingdom line1, city, postal_code and country. A Location is
 * never created with less: Stripe refuses it ("Missing required address field
 * for a Location in US: address[state]").
 */
export function terminalAddressComplete(a: TerminalAddress): boolean {
  if (!a.line1.trim() || !a.city.trim() || !a.country.trim()) return false;
  const country = a.country.trim().toUpperCase();
  if (country === "US") return Boolean(a.state?.trim()) && Boolean(a.postal_code?.trim());
  if (country === "GB") return Boolean(a.postal_code?.trim());
  return true;
}

const US_STATES: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

/** "line1, [line2,] [City]" → line1 and city, using the brand's own city when it has one. */
function splitStreetAndCity(
  head: string,
  brandCity: string,
): { line1: string; city: string } | null {
  const parts = head.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const city = brandCity.trim();
  if (city) {
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.toLowerCase() === city.toLowerCase()) parts.pop();
    else if (last.toLowerCase().endsWith(` ${city.toLowerCase()}`)) {
      // "700 Corporate Center Dr Raleigh": the city written without a comma.
      parts[parts.length - 1] = last.slice(0, last.length - city.length).trim();
    }
    const line1 = parts.join(", ").trim();
    if (!line1 || line1.toLowerCase() === city.toLowerCase()) return null;
    return { line1, city };
  }
  if (parts.length < 2) return null;
  const derived = parts.pop() as string;
  return { line1: parts.join(", "), city: derived };
}

/**
 * Brands keep their address as one line ("700 Corporate Center Dr, Raleigh, NC
 * 27607") plus an optional city. Reads the state and ZIP (US) or the postcode
 * (UK) out of it. Null when they can't be found: never a partial address.
 */
export function parseBrandAddress(
  address: string | null,
  brandCity: string | null,
  country: string,
): TerminalAddress | null {
  const c = country.trim().toUpperCase();
  let s = (address ?? "").replace(/\s+/g, " ").trim();
  const city = (brandCity ?? "").trim();
  if (!s) return null;
  if (c === "US") {
    s = s.replace(/[,\s]+(U\.?S\.?A\.?|U\.?S\.?|United States(?: of America)?)\.?$/i, "").trim();
    const zip = s.match(/[,\s]+(\d{5}(?:-\d{4})?)$/);
    if (!zip) return null;
    let rest = s.slice(0, zip.index).trim().replace(/,$/, "").trim();
    let state: string | null = null;
    const code = rest.match(/(?:^|[,\s])([A-Za-z]{2})\.?$/);
    if (code && US_STATE_CODES.has(code[1].toUpperCase())) {
      state = code[1].toUpperCase();
      rest = rest.slice(0, code.index).trim();
    } else {
      const lower = rest.toLowerCase();
      for (const [name, abbr] of Object.entries(US_STATES)) {
        if (lower === name || lower.endsWith(` ${name}`) || lower.endsWith(`,${name}`)) {
          state = abbr;
          rest = rest.slice(0, rest.length - name.length).trim();
          break;
        }
      }
    }
    if (state === null) return null;
    const street = splitStreetAndCity(rest.replace(/,$/, "").trim(), city);
    if (street === null) return null;
    return { line1: street.line1, city: street.city, state, postal_code: zip[1], country: "US" };
  }
  if (c === "GB") {
    s = s.replace(/[,\s]+(UK|U\.K\.|United Kingdom|Great Britain|England|Scotland|Wales|Northern Ireland)\.?$/i, "")
      .trim();
    const pc = s.match(/(?:^|[,\s])([A-Za-z]{1,2}\d[A-Za-z\d]?)\s*(\d[A-Za-z]{2})$/);
    if (!pc) return null;
    const postal = `${pc[1]} ${pc[2]}`.toUpperCase();
    const rest = s.slice(0, pc.index).trim().replace(/,$/, "").trim();
    const street = splitStreetAndCity(rest, city);
    if (street === null) return null;
    return { line1: street.line1, city: street.city, postal_code: postal, country: "GB" };
  }
  return null;
}

/** A structured address object as a complete Terminal address in `country`, or null. */
export function structuredTerminalAddress(
  raw: Record<string, unknown> | null | undefined,
  country: string,
): TerminalAddress | null {
  const v = raw ?? {};
  const str = (k: string): string =>
    typeof v[k] === "string" ? (v[k] as string).trim() : "";
  if (!str("line1") || !str("city")) return null;
  const c = country.trim().toUpperCase();
  const own = (str("country") || c).toUpperCase();
  // #4389: an address in another country can never be this brand's Location.
  if (c && own !== c) return null;
  const line2 = str("line2");
  const out: TerminalAddress = {
    line1: line2 ? `${str("line1")}, ${line2}` : str("line1"),
    city: str("city"),
    country: own,
  };
  if (str("postal_code")) out.postal_code = str("postal_code");
  if (str("state")) out.state = str("state");
  return terminalAddressComplete(out) ? out : null;
}

/**
 * The Location's address, in this order (#4389 §4.2):
 *   1. the connected account's own address (Stripe already collected and
 *      verified it in onboarding: identity.business_details / individual);
 *   2. `brands.tap_location_address` (the T1 fallback screen);
 *   3. the event's structured tax address (the one Stripe Tax uses);
 *   4. the brand's own address line read for its state and ZIP / postcode.
 * Null means "address_missing": nothing partial is ever sent to Stripe.
 */
export function terminalAddressFor(input: {
  accountAddress?: Record<string, unknown> | null;
  tapLocationAddress?: Record<string, unknown> | null;
  venueTaxAddress: Record<string, unknown> | null;
  brandAddress: string | null;
  brandCity: string | null;
  country: string;
}): TerminalAddress | null {
  const country = input.country.trim().toUpperCase();
  for (const source of [input.accountAddress, input.tapLocationAddress, input.venueTaxAddress]) {
    const out = structuredTerminalAddress(source ?? null, country);
    if (out !== null) return out;
  }
  const parsed = parseBrandAddress(input.brandAddress, input.brandCity, country);
  return parsed !== null && terminalAddressComplete(parsed) ? parsed : null;
}

/** Stripe refused the Location's address (a 400 about address[...]): the host must fix it. */
export function isStripeAddressError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { type?: unknown; rawType?: unknown; param?: unknown; message?: unknown };
  const invalid = e.type === "StripeInvalidRequestError" || e.rawType === "invalid_request_error";
  if (!invalid) return false;
  return String(e.param ?? "").startsWith("address") || /address/i.test(String(e.message ?? ""));
}

/**
 * ISO-2 country each supported Tap to Pay currency settles in (the app's own map).
 * [TRANSITIONAL] #4389 — only for a brand with no payout_country; the
 * migration backfills it for every GBP/USD brand. Exit: delete once a
 * production probe shows no live Stripe brand with a NULL payout_country.
 */
const TAP_COUNTRY_BY_CURRENCY: Readonly<Record<string, string>> = { GBP: "GB", USD: "US" };

// deno-lint-ignore no-explicit-any
type Client = any;
// deno-lint-ignore no-explicit-any
type StripeLike = any;

export async function ensureTerminalLocation(
  supabase: Client,
  stripe: StripeLike,
  input: {
    brandId: string;
    brandName: string;
    stripeAccountId: string;
    country: string;
    address: TerminalAddress;
  },
): Promise<string | null> {
  const country = input.country.trim().toUpperCase();
  const { data: existing, error } = await supabase
    .from("brand_terminal_locations")
    .select("stripe_location_id")
    .eq("brand_id", input.brandId)
    .eq("country_code", country)
    .eq("stripe_account_id", input.stripeAccountId)
    .maybeSingle();
  if (error) throw new Error(`terminal_location_lookup_failed:${error.message}`);
  if (existing?.stripe_location_id) return existing.stripe_location_id;
  if (!terminalAddressComplete(input.address)) return null;

  let location: { id: string };
  try {
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    location = await stripe.terminal.locations.create(
      {
        display_name: input.brandName.slice(0, 100) || "Door",
        address: input.address,
        metadata: { mingla_brand_id: input.brandId },
      },
      {
        stripeAccount: input.stripeAccountId,
        // The address is in the key: a corrected address is a new request,
        // never a replay of Stripe's earlier refusal.
        idempotencyKey: `door_location:${input.brandId}:${country}:${addressKey(input.address)}`,
      },
    );
  } catch (error) {
    if (isStripeAddressError(error)) {
      console.warn(
        "[door-terminal] Stripe refused the Location address",
        (error as { message?: string }).message ?? "",
      );
      return null;
    }
    throw error;
  }
  const { error: insertError } = await supabase
    .from("brand_terminal_locations")
    .upsert({
      brand_id: input.brandId,
      country_code: country,
      stripe_account_id: input.stripeAccountId,
      stripe_location_id: location.id,
    }, { onConflict: "brand_id,country_code,stripe_account_id", ignoreDuplicates: true });
  if (insertError) {
    throw new Error(`terminal_location_store_failed:${insertError.message}`);
  }
  return location.id;
}

function addressKey(a: TerminalAddress): string {
  const raw = [a.line1, a.city, a.state ?? "", a.postal_code ?? "", a.country].join("|").toLowerCase();
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (Math.imul(h, 31) + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type TapContext =
  | {
    ok: true;
    brandId: string;
    brandName: string;
    brandAddress: string | null;
    brandCity: string | null;
    /** #4389 — the T1 fallback address, when the host gave one. */
    tapLocationAddress: Record<string, unknown> | null;
    country: string;
    stripeAccountId: string;
  }
  | { ok: false; error: "tap_not_available" | "stripe_account_not_ready" | "server_error" };

/** HTTP status for a refusal: a database read that failed is retryable (500), not a "no". */
export function tapContextStatus(error: "tap_not_available" | "stripe_account_not_ready" | "server_error"): number {
  return error === "server_error" ? 500 : 400;
}

const TAP_BRAND_COLUMNS =
  "id, name, address, city, country_code, payment_country, payout_country, tap_location_address, default_currency, payment_provider, stripe_connect_id, stripe_charges_enabled";

/** Brand row + readiness for a Tap to Pay door sale, or the refusal. */
export async function loadTapContext(
  supabase: Client,
  eventId: string,
): Promise<TapContext> {
  const { data, error } = await supabase
    .from("events")
    .select(
      `brand_id, brands!inner(${TAP_BRAND_COLUMNS})`,
    )
    .eq("id", eventId)
    .maybeSingle();
  // A failed read is a transient server error the app retries (its clock keeps
  // running), never "Tap to Pay isn't available" (#4271 retest 4 P3-D).
  if (error) return { ok: false, error: "server_error" };
  if (!data) return { ok: false, error: "tap_not_available" };
  const rel = (data as { brands?: unknown }).brands;
  const brand = (Array.isArray(rel) ? rel[0] : rel) as Record<string, unknown>;
  return tapContextFromBrand(brand);
}

/** The same, for the root Terminal host: a brand with no event in view. */
export async function loadBrandTapContext(
  supabase: Client,
  brandId: string,
): Promise<TapContext> {
  const { data, error } = await supabase
    .from("brands")
    .select(TAP_BRAND_COLUMNS)
    .eq("id", brandId)
    .maybeSingle();
  if (error) return { ok: false, error: "server_error" };
  if (!data) return { ok: false, error: "tap_not_available" };
  return tapContextFromBrand(data as Record<string, unknown>);
}

function tapContextFromBrand(brand: Record<string, unknown>): TapContext {
  if (String(brand?.payment_provider ?? "stripe").toLowerCase() === "paystack") {
    return { ok: false, error: "tap_not_available" };
  }
  // No country on the brand: its currency, which is synced from the Stripe
  // connected account (brands.default_currency, see tg_sync_brand_stripe_cache),
  // decides, the same way the app reads USD as US and GBP as GB.
  // #4389 I-4389-COUNTRY-ONE-TRUTH: the bank country decides.
  const named = String(
    brand?.payout_country ?? brand?.payment_country ?? brand?.country_code ?? "",
  ).trim().toUpperCase();
  const country = named ||
    (TAP_COUNTRY_BY_CURRENCY[String(brand?.default_currency ?? "").trim().toUpperCase()] ?? "");
  if (!tapToPayCountrySupported(country)) {
    return { ok: false, error: "tap_not_available" };
  }
  if (!brand?.stripe_connect_id || brand?.stripe_charges_enabled !== true) {
    return { ok: false, error: "stripe_account_not_ready" };
  }
  return {
    ok: true,
    brandId: String(brand.id),
    brandName: String(brand.name ?? ""),
    brandAddress: typeof brand.address === "string" ? brand.address : null,
    brandCity: typeof brand.city === "string" ? brand.city : null,
    tapLocationAddress: brand.tap_location_address !== null &&
        typeof brand.tap_location_address === "object"
      ? brand.tap_location_address as Record<string, unknown>
      : null,
    country,
    stripeAccountId: String(brand.stripe_connect_id),
  };
}

/**
 * The brand's Terminal Location with no event in view. An existing Location is
 * reused first, so a brand that took a door sale needs no address of its own;
 * otherwise only the brand's own address can make one.
 */
export async function ensureBrandTerminalLocation(
  supabase: Client,
  stripe: StripeLike,
  tap: Extract<TapContext, { ok: true }>,
  accountAddress: () => Promise<Record<string, unknown> | null> = () => Promise.resolve(null),
): Promise<string | null> {
  const { data: existing, error } = await supabase
    .from("brand_terminal_locations")
    .select("stripe_location_id")
    .eq("brand_id", tap.brandId)
    .eq("country_code", tap.country)
    .eq("stripe_account_id", tap.stripeAccountId)
    .maybeSingle();
  if (error) throw new Error(`terminal_location_lookup_failed:${error.message}`);
  if (existing?.stripe_location_id) return existing.stripe_location_id;
  const address = terminalAddressFor({
    accountAddress: await accountAddress(),
    tapLocationAddress: tap.tapLocationAddress,
    venueTaxAddress: null,
    brandAddress: tap.brandAddress,
    brandCity: tap.brandCity,
    country: tap.country,
  });
  if (address === null) return null;
  return await ensureTerminalLocation(supabase, stripe, {
    brandId: tap.brandId,
    brandName: tap.brandName,
    stripeAccountId: tap.stripeAccountId,
    country: tap.country,
    address,
  });
}

/** #4389 — where the host adds the Tap to Pay address when none is usable (T1). */
export function tapAddressRoute(brandId: string): string {
  return `/brand/${brandId}/tap-to-pay/address`;
}

/** Looks up a stored Location without creating one (skips the account read). */
export async function existingTerminalLocation(
  supabase: Client,
  brandId: string,
  country: string,
  stripeAccountId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("brand_terminal_locations")
    .select("stripe_location_id")
    .eq("brand_id", brandId)
    .eq("country_code", country.trim().toUpperCase())
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (error) throw new Error(`terminal_location_lookup_failed:${error.message}`);
  return data?.stripe_location_id ?? null;
}
