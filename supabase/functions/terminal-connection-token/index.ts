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
  canTakeDoorPayment,
  loadDoorPricing,
  tapToPayReleased,
} from "../_shared/doorPayServer.ts";
import {
  ensureTerminalLocation,
  loadTapContext,
  terminalAddressFor,
} from "../_shared/doorTerminal.ts";
import { isUuid } from "../_shared/doorPay.ts";

export interface TerminalConnectionTokenDeps {
  // deno-lint-ignore no-explicit-any
  serviceClient: () => any;
  userIdFromAuthHeader: (req: Request) => Promise<string | null>;
  // deno-lint-ignore no-explicit-any
  stripe: () => any;
}

const defaultDeps: TerminalConnectionTokenDeps = {
  serviceClient,
  userIdFromAuthHeader,
  stripe: stripeTicketCheckout,
};

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
    if (!isUuid(body?.eventId)) return jsonResponse({ error: "invalid_request" }, 400);
    const eventId = body.eventId as string;
    const supabase = deps.serviceClient();
    if (!(await canTakeDoorPayment(supabase, eventId, actorId))) {
      return jsonResponse({ error: "door_access_denied" }, 400);
    }
    const tap = await loadTapContext(supabase, eventId);
    if (!tap.ok) return jsonResponse({ error: tap.error }, 400);
    if (!(await tapToPayReleased(supabase, tap.brandId, body.platform))) {
      return jsonResponse({ error: "tap_not_available", reason: "not_released" }, 400);
    }
    const pricing = await loadDoorPricing(supabase, eventId);
    if (pricing === null || pricing.stripeAccountId === null) {
      return jsonResponse({ error: "stripe_account_not_ready" }, 400);
    }
    const address = terminalAddressFor({
      venueTaxAddress: pricing.venueTaxAddress,
      brandAddress: tap.brandAddress,
      brandCity: tap.brandCity,
      country: tap.country,
    });
    if (address === null) {
      return jsonResponse({ error: "tap_not_available", reason: "address_missing" }, 400);
    }
    const stripe = deps.stripe();
    const locationId = await ensureTerminalLocation(supabase, stripe, {
      brandId: tap.brandId,
      brandName: tap.brandName,
      stripeAccountId: pricing.stripeAccountId,
      country: tap.country,
      address,
    });
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
