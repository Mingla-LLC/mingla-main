// #4490 spec 08 O2 — the Terminal Location a Till's Tap to Pay uses. One
// function for door-tap-intent (scope till) and terminal-connection-token
// (scope till), so the reader connects to the same Location the sale names.
// Address order: the brand's T1 address, the venue's address, the brand's own.

import { jsonResponse } from "./ticketCheckout.ts";
import {
  ensureTerminalLocation,
  loadBrandTapContext,
  tapContextStatus,
  terminalAddressFor,
} from "./doorTerminal.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export async function canSellAtVenue(
  supabase: Client,
  venueId: string,
  actorId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_4490_can_sell", {
    p_venue_id: venueId,
    p_user_id: actorId,
  });
  if (error) throw new Error(`till_permission_lookup_failed:${error.message}`);
  return data === true;
}

/**
 * #4490 O2 fix 1 (O2-T1): the Till release switch (VENUE_TILL and the venue's
 * `till` feature, issue_4490_till_enabled). Starting a Till card read and
 * connecting a Till reader need it; recording, cancelling and seeing money
 * that already moved never do (T19). A failed read refuses (throws).
 */
export async function tillEnabledAtVenue(
  supabase: Client,
  venueId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_4490_till_enabled", {
    p_venue_id: venueId,
  });
  if (error) throw new Error(`till_enabled_lookup_failed:${error.message}`);
  return data === true;
}

/** The answer when the Till is switched off: the same for every role. */
export function tillNotEnabledResponse(): Response {
  return jsonResponse({ error: "till_not_enabled" }, 422);
}

/** The Terminal Location for a venue: the brand's T1 address, the venue's, the brand's. */
export async function tillLocation(
  supabase: Client,
  // deno-lint-ignore no-explicit-any
  stripe: any,
  brandId: string,
  venueId: string,
  stripeAccountId: string,
): Promise<
  { ok: true; locationId: string } | { ok: false; response: Response }
> {
  const tap = await loadBrandTapContext(supabase, brandId);
  if (!tap.ok) {
    return {
      ok: false,
      response: jsonResponse({ error: tap.error }, tapContextStatus(tap.error)),
    };
  }
  const { data: venue } = await supabase.from("venue_listings")
    .select("address, city, country_code").eq("id", venueId).maybeSingle();
  const address = terminalAddressFor({
    tapLocationAddress: tap.tapLocationAddress,
    venueTaxAddress: venue
      ? {
        line1: venue.address ?? "",
        city: venue.city ?? "",
        country: venue.country_code ?? "",
      }
      : null,
    brandAddress: tap.brandAddress,
    brandCity: tap.brandCity,
    country: tap.country,
  });
  if (address === null) {
    return {
      ok: false,
      response: jsonResponse({
        error: "tap_not_available",
        reason: "address_missing",
      }, 400),
    };
  }
  const locationId = await ensureTerminalLocation(supabase, stripe, {
    brandId: tap.brandId,
    brandName: tap.brandName,
    stripeAccountId,
    country: tap.country,
    address,
  });
  if (locationId === null) {
    return {
      ok: false,
      response: jsonResponse({
        error: "tap_not_available",
        reason: "address_missing",
      }, 400),
    };
  }
  return { ok: true, locationId };
}
