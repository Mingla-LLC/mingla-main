// Issue #4271 — terminal-connection-token. The Business app's Stripe Terminal
// SDK asks for a ConnectionToken; it is created on the brand's connected
// account (direct charges) and scoped to the brand's door Location.
//   https://docs.stripe.com/api/terminal/connection_tokens/create
//   https://docs.stripe.com/terminal/features/connect?connect-charge-type=direct
//
// verify_jwt = false at the gateway; the bearer is verified in code and the
// caller must be allowed to take door money for the event.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  canTakeBrandDoorPayment,
  canTakeDoorPayment,
  loadDoorPricing,
  tapToPayReleased,
} from "../_shared/doorPayServer.ts";
import {
  ensureBrandTerminalLocation,
  ensureTerminalLocation,
  existingTerminalLocation,
  loadBrandTapContext,
  loadTapContext,
  tapAddressRoute,
  tapContextStatus,
  terminalAddressFor,
} from "../_shared/doorTerminal.ts";
import {
  identityAddressOf,
  retrieveAccountIdentity,
} from "../_shared/stripeBlueprintClient.ts";
import { isUuid } from "../_shared/doorPay.ts";

export interface TerminalConnectionTokenDeps {
  // deno-lint-ignore no-explicit-any
  serviceClient: () => any;
  userIdFromAuthHeader: (req: Request) => Promise<string | null>;
  // deno-lint-ignore no-explicit-any
  stripe: () => any;
  /**
   * #4389 — the connected account's own (Stripe-verified) address, or null.
   * Never throws: a failed read falls through to the next address source.
   */
  accountAddress?: (stripeAccountId: string) => Promise<Record<string, unknown> | null>;
}

/** #4389 — GET /v2/core/accounts/{id}?include=identity, fail-soft. */
export async function stripeAccountAddress(
  stripeAccountId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const address = identityAddressOf(await retrieveAccountIdentity(stripeAccountId));
    return address as Record<string, unknown> | null;
  } catch (error) {
    console.warn(
      "[terminal-connection-token] account address read failed",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

const defaultDeps: TerminalConnectionTokenDeps = {
  serviceClient,
  userIdFromAuthHeader,
  stripe: stripeTicketCheckout,
  accountAddress: stripeAccountAddress,
};

/** #4389 S-i — never a dead end: name the screen that fixes it. */
function addressMissing(brandId: string): Response {
  return jsonResponse({
    error: "tap_not_available",
    reason: "address_missing",
    route: tapAddressRoute(brandId),
  }, 400);
}

export const createTerminalConnectionTokenHandler = (
  deps: TerminalConnectionTokenDeps = defaultDeps,
): (req: Request) => Promise<Response> =>
  wrapEdgeHandler("terminal-connection-token", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") return jsonResponse({ error: "invalid_request" }, 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    const actorId = await deps.userIdFromAuthHeader(req);
    if (actorId === null) return jsonResponse({ error: "door_access_denied" }, 401);
    const supabase = deps.serviceClient();
    if (!isUuid(body?.eventId) && isUuid(body?.brandId)) {
      // The root host: a brand with no event in view.
      const brandId = body.brandId as string;
      if (!(await canTakeBrandDoorPayment(supabase, brandId, actorId))) {
        return jsonResponse({ error: "door_access_denied" }, 400);
      }
      const brandTap = await loadBrandTapContext(supabase, brandId);
      if (!brandTap.ok) return jsonResponse({ error: brandTap.error }, tapContextStatus(brandTap.error));
      if (!(await tapToPayReleased(supabase, brandTap.brandId, body.platform))) {
        return jsonResponse({ error: "tap_not_available", reason: "not_released" }, 400);
      }
      const brandStripe = deps.stripe();
      const readAccountAddress = deps.accountAddress ?? stripeAccountAddress;
      const brandLocationId = await ensureBrandTerminalLocation(
        supabase,
        brandStripe,
        brandTap,
        () => readAccountAddress(brandTap.stripeAccountId),
      );
      if (brandLocationId === null) return addressMissing(brandTap.brandId);
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const brandToken = await brandStripe.terminal.connectionTokens.create(
        { location: brandLocationId },
        { stripeAccount: brandTap.stripeAccountId },
      );
      return jsonResponse({ secret: brandToken.secret, locationId: brandLocationId });
    }
    if (!isUuid(body?.eventId)) return jsonResponse({ error: "invalid_request" }, 400);
    const eventId = body.eventId as string;
    if (!(await canTakeDoorPayment(supabase, eventId, actorId))) {
      return jsonResponse({ error: "door_access_denied" }, 400);
    }
    const tap = await loadTapContext(supabase, eventId);
    if (!tap.ok) return jsonResponse({ error: tap.error }, tapContextStatus(tap.error));
    if (!(await tapToPayReleased(supabase, tap.brandId, body.platform))) {
      return jsonResponse({ error: "tap_not_available", reason: "not_released" }, 400);
    }
    const pricing = await loadDoorPricing(supabase, eventId);
    if (pricing === null || pricing.stripeAccountId === null) {
      return jsonResponse({ error: "stripe_account_not_ready" }, 400);
    }
    const stripe = deps.stripe();
    // #4389 — a stored Location needs no address (and no account read).
    const stored = await existingTerminalLocation(
      supabase,
      tap.brandId,
      tap.country,
      pricing.stripeAccountId,
    );
    if (stored !== null) {
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const storedToken = await stripe.terminal.connectionTokens.create(
        { location: stored },
        { stripeAccount: pricing.stripeAccountId },
      );
      return jsonResponse({ secret: storedToken.secret, locationId: stored });
    }
    const address = terminalAddressFor({
      accountAddress: await (deps.accountAddress ?? stripeAccountAddress)(pricing.stripeAccountId),
      tapLocationAddress: tap.tapLocationAddress,
      venueTaxAddress: pricing.venueTaxAddress,
      brandAddress: tap.brandAddress,
      brandCity: tap.brandCity,
      country: tap.country,
    });
    if (address === null) return addressMissing(tap.brandId);
    const locationId = await ensureTerminalLocation(supabase, stripe, {
      brandId: tap.brandId,
      brandName: tap.brandName,
      stripeAccountId: pricing.stripeAccountId,
      country: tap.country,
      address,
    });
    if (locationId === null) return addressMissing(tap.brandId);
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const token = await stripe.terminal.connectionTokens.create(
      { location: locationId },
      { stripeAccount: pricing.stripeAccountId },
    );
    return jsonResponse({ secret: token.secret, locationId });
  }, {
    onError: (_err, requestId) =>
      jsonResponse({ error: "server_error", requestId }, 500),
  });

if (import.meta.main) {
  serve(createTerminalConnectionTokenHandler());
}
