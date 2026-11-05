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
 * The Location's address: the event's structured tax address first (the same
 * one Stripe Tax uses), else the brand's own address line.
 */
export function terminalAddressFor(input: {
  venueTaxAddress: Record<string, unknown> | null;
  brandAddress: string | null;
  brandCity: string | null;
  country: string;
}): TerminalAddress | null {
  const country = input.country.trim().toUpperCase();
  const v = input.venueTaxAddress ?? {};
  const str = (k: string): string =>
    typeof v[k] === "string" ? (v[k] as string).trim() : "";
  if (str("line1") && str("city")) {
    const out: TerminalAddress = {
      line1: str("line1"),
      city: str("city"),
      country: (str("country") || country).toUpperCase(),
    };
    if (str("postal_code")) out.postal_code = str("postal_code");
    if (str("state")) out.state = str("state");
    return out;
  }
  const line1 = (input.brandAddress ?? "").trim();
  const city = (input.brandCity ?? "").trim();
  if (line1 && city) return { line1, city, country };
  return null;
}

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
): Promise<string> {
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

  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const location = await stripe.terminal.locations.create(
    {
      display_name: input.brandName.slice(0, 100) || "Door",
      address: input.address,
      metadata: { mingla_brand_id: input.brandId },
    },
    {
      stripeAccount: input.stripeAccountId,
      idempotencyKey: `door_location:${input.brandId}:${country}`,
    },
  );
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

export type TapContext =
  | {
    ok: true;
    brandId: string;
    brandName: string;
    brandAddress: string | null;
    brandCity: string | null;
    country: string;
    stripeAccountId: string;
  }
  | { ok: false; error: "tap_not_available" | "stripe_account_not_ready" };

const TAP_BRAND_COLUMNS =
  "id, name, address, city, country_code, payment_country, payment_provider, stripe_connect_id, stripe_charges_enabled";

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
  if (error || !data) return { ok: false, error: "tap_not_available" };
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
  if (error || !data) return { ok: false, error: "tap_not_available" };
  return tapContextFromBrand(data as Record<string, unknown>);
}

function tapContextFromBrand(brand: Record<string, unknown>): TapContext {
  if (String(brand?.payment_provider ?? "stripe").toLowerCase() === "paystack") {
    return { ok: false, error: "tap_not_available" };
  }
  const country = String(brand?.payment_country ?? brand?.country_code ?? "")
    .trim().toUpperCase();
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
