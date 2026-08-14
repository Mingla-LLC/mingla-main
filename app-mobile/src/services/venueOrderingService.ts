/**
 * Issue #1793 (#1767 Phase 4) — the consumer app's guest-ordering transport.
 *
 * ANON-SAFE. Nothing here reads `useAuth`, and nothing here needs a session: the
 * whole rail is anon-capable by contract (`verify_jwt = false` on all three
 * functions, auth OPTIONAL inside `venue-order-create`). A signed-in user's
 * Bearer rides along automatically through the shared client and becomes
 * `buyer_user_id` on the row; a guest with no account gets exactly the same
 * ordering experience, which is the point — a diner has no account.
 *
 * NO MONEY MATH LIVES HERE OR ANYWHERE DOWNSTREAM OF HERE (SPEC #1788 P-20).
 * The request carries `{ menuItemId, quantity, modifierIds, notes }` and the
 * buyer, and NOTHING with a price in it. `venue-order-create` rejects a body
 * with a price key outright — it is a validation error, not a hint — and every
 * number this module returns was computed inside that function from server-read
 * menu rows.
 */

import { supabase } from "./supabase";
import type {
  VenueOrderingConfig,
  VenueOrderLiveStatus,
  VenueOrderModifierGroup,
  VenueOrderPreview,
} from "@mingla/brand-rendering/venueOrdering";
import {
  parseVenueOrderFailureBody,
  parseVenueOrderingConfig,
  parseVenueOrderModifiers,
  parseVenueOrderPreview,
  parseVenueOrderStatus,
  VENUE_ORDER_FUNCTIONS,
  VENUE_ORDER_GENERIC_FAILURE,
  VENUE_ORDERING_UNAVAILABLE,
  type VenueOrderFailure,
  type VenueOrderRequest,
  venueOrderCreateBody,
} from "@mingla/brand-rendering/venueOrdering/venueOrderingWire";

export type { VenueOrderRequest };

/**
 * The order rail answers `{ error: <machine code>, message: <the exact words a
 * guest should read> }` (SPEC #1788 P-29, whose copy has ONE owner in
 * `_shared/venueOrderPricing.ts`).
 *
 * The app's generic `extractFunctionError` prefers `body.error` over
 * `body.message`, which is right for rails whose `error` is prose and would put
 * the literal string `buyer_phone_required` in front of a guest here. So this
 * rail reads its own bodies, through the shared parser both surfaces use.
 */
async function readFailure(error: unknown): Promise<VenueOrderFailure> {
  const context = (error as { context?: unknown } | null)?.context;
  if (
    context !== null &&
    typeof context === "object" &&
    typeof (context as { text?: unknown }).text === "function"
  ) {
    try {
      // A body streams ONCE, so `.text()` first and parse from the string —
      // calling `.json()` after a `.text()` (or the reverse) throws.
      const raw = await (context as { text: () => Promise<string> }).text();
      return parseVenueOrderFailureBody(raw);
    } catch {
      return VENUE_ORDER_GENERIC_FAILURE;
    }
  }
  return VENUE_ORDER_GENERIC_FAILURE;
}

export class VenueOrderError extends Error {
  readonly code: string;
  constructor(failure: VenueOrderFailure) {
    super(failure.message);
    this.name = "VenueOrderError";
    this.code = failure.code;
  }
}

// ---------------------------------------------------------------------------
// 1. The honest public state (issue #1793's migration).
// ---------------------------------------------------------------------------

/**
 * What may this guest honestly be told about ordering here?
 *
 * A failure of this read resolves to `unavailable`, which renders NO ordering
 * affordance and NO claim — the page is exactly the page it was before Phase 4.
 * That is the correct direction to fail: a menu that quietly stays a menu is
 * honest; a menu with a dead "Add" button on it is not.
 */
export async function fetchVenueOrderingState(input: {
  brandSlug: string;
  venueSlug: string;
  spotCode: string | null;
}): Promise<VenueOrderingConfig> {
  const { data, error } = await supabase.rpc("pg_public_venue_ordering_state", {
    p_brand_slug: input.brandSlug,
    p_venue_slug: input.venueSlug,
    p_spot_code: input.spotCode,
  });
  if (error !== null) return VENUE_ORDERING_UNAVAILABLE;
  return parseVenueOrderingConfig(data);
}

// ---------------------------------------------------------------------------
// 2. Option groups for the visible items (P-14's second definer function).
// ---------------------------------------------------------------------------

export async function fetchVenueMenuModifiers(
  menuItemIds: string[],
): Promise<Record<string, VenueOrderModifierGroup[]>> {
  if (menuItemIds.length === 0) return {};
  const { data, error } = await supabase.rpc("pg_public_menu_modifiers", {
    p_menu_item_ids: menuItemIds,
  });
  if (error !== null) return {};
  return parseVenueOrderModifiers(data);
}

// ---------------------------------------------------------------------------
// 3. Pricing and creating. ONE function, two modes.
// ---------------------------------------------------------------------------

/**
 * Price this exact basket, WITHOUT writing a row or calling a provider.
 *
 * This is where every number the guest reads comes from. It is deliberately the
 * same function, the same gates and the same engine that will charge them — so
 * the total on the button and the amount on the card cannot be two different
 * calculations.
 */
export async function previewVenueOrder(
  request: VenueOrderRequest,
): Promise<VenueOrderPreview> {
  const { data, error } = await supabase.functions.invoke<
    Record<string, unknown>
  >(VENUE_ORDER_FUNCTIONS.create, {
    body: venueOrderCreateBody({ request, mode: "preview", surface: "native" }),
  });
  if (error !== null) throw new VenueOrderError(await readFailure(error));
  if (data === null) throw new VenueOrderError(VENUE_ORDER_GENERIC_FAILURE);
  return parseVenueOrderPreview(data);
}

/**
 * The create response's arms.
 *
 * The provider-shaped fields are parsed HERE rather than in the shared package,
 * because a renderer package has no business holding a payment provider's field
 * names — SPEC #1788 P-61 SET-B, and the reason the payment step lives in
 * host-owned files the gate never scans.
 */
export type VenueOrderCreated =
  | {
      kind: "free_completed";
      orderId: string;
      sessionId: string;
      buyerStatusToken: string;
      guestCancelToken: string;
      pickupCode: string | null;
    }
  | {
      kind: "requires_payment";
      resumed: boolean;
      paymentIntentId: string;
      orderId: string;
      sessionId: string;
      buyerStatusToken: string;
      guestCancelToken: string;
      clientSecret: string;
      publishableKey: string;
      connectedAccountId: string | null;
      totalCents: number;
      currency: string;
    }
  | {
      kind: "requires_paystack_redirect";
      resumed: boolean;
      orderId: string;
      sessionId: string;
      buyerStatusToken: string;
      guestCancelToken: string;
      authorizationUrl: string;
    }
  | {
      kind: "requires_web_redirect";
      resumed: boolean;
      orderId: string;
      sessionId: string;
      buyerStatusToken: string;
      guestCancelToken: string;
      url: string;
    }
  | {
      /** P-23 — a replayed submit returns the EXISTING order, never a second one. */
      kind: "already_created";
      orderId: string;
      totalCents: number;
      currency: string;
      paymentStatus: string;
    };

export async function createVenueOrder(
  request: VenueOrderRequest,
  idempotencyKey: string,
): Promise<VenueOrderCreated> {
  const { data, error } = await supabase.functions.invoke<
    Record<string, unknown>
  >(VENUE_ORDER_FUNCTIONS.create, {
    // P-23 layer 1 — the client MUST send a per-tap key. The server's derived
    // composite is the crash-safety floor beneath it, not the mechanism: two
    // identical rounds inside one sitting are exactly why.
    body: {
      ...venueOrderCreateBody({
        request,
        mode: "create",
        surface: "native",
        idempotencyKey,
      }),
      returnContract: "host_v1",
    },
  });
  if (error !== null) throw new VenueOrderError(await readFailure(error));
  if (data === null) throw new VenueOrderError(VENUE_ORDER_GENERIC_FAILURE);
  const kind = String(data.kind ?? "");
  const common = {
    orderId: String(data.orderId ?? ""),
    sessionId: String(data.sessionId ?? ""),
    buyerStatusToken: String(data.buyerStatusToken ?? ""),
    guestCancelToken: String(data.guestCancelToken ?? ""),
    resumed: data.resumed === true,
  };
  if (kind === "free_completed") {
    return {
      kind,
      ...common,
      pickupCode: typeof data.pickupCode === "string" ? data.pickupCode : null,
    };
  }
  if (kind === "requires_payment") {
    return {
      kind,
      ...common,
      paymentIntentId: String(data.paymentIntentId ?? ""),
      clientSecret: String(data.clientSecret ?? ""),
      publishableKey: String(data.publishableKey ?? ""),
      connectedAccountId:
        typeof data.stripeAccountId === "string" ? data.stripeAccountId : null,
      totalCents: Number(data.totalCents ?? 0),
      currency: String(data.currency ?? ""),
    };
  }
  if (kind === "requires_paystack_redirect") {
    return {
      kind,
      ...common,
      authorizationUrl: String(data.authorizationUrl ?? ""),
    };
  }
  if (kind === "requires_web_redirect") {
    return { kind, ...common, url: String(data.url ?? "") };
  }
  if (kind === "already_created") {
    return {
      kind,
      orderId: String(data.orderId ?? ""),
      totalCents: Number(data.totalCents ?? 0),
      currency: String(data.currency ?? ""),
      paymentStatus: String(data.paymentStatus ?? ""),
    };
  }
  throw new VenueOrderError(VENUE_ORDER_GENERIC_FAILURE);
}

// ---------------------------------------------------------------------------
// 4. Watching, and getting out (P-24, P-25).
// ---------------------------------------------------------------------------

export async function fetchVenueOrderStatus(
  orderId: string,
  buyerStatusToken: string,
): Promise<VenueOrderLiveStatus | null> {
  const { data, error } = await supabase.functions.invoke<
    Record<string, unknown>
  >(VENUE_ORDER_FUNCTIONS.status, { body: { orderId, buyerStatusToken } });
  if (error !== null || data === null) return null;
  return parseVenueOrderStatus(data, orderId);
}

/** Resume the SAME Paystack transaction after its hosted browser was closed. */
export async function resumeVenueOrderPayment(
  orderId: string,
  buyerStatusToken: string,
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<
    Record<string, unknown>
  >(VENUE_ORDER_FUNCTIONS.status, {
    body: { orderId, buyerStatusToken, includePaymentContinuation: true },
  });
  if (error !== null || data === null) return null;
  const continuation = data.paymentContinuation;
  if (continuation === null || typeof continuation !== "object") return null;
  const value = continuation as Record<string, unknown>;
  return value.kind === "requires_paystack_redirect" &&
    typeof value.authorizationUrl === "string"
    ? value.authorizationUrl
    : null;
}

/**
 * D-7a — the guest's way out. `cancel` while nobody has picked the order up is
 * an instant, automatic, FULL refund with no venue involvement. Afterwards the
 * same intent becomes `request_refund`, which moves NO money and lands on the
 * venue's ticket as a decision a person makes.
 */
export async function venueOrderGuestAction(input: {
  orderId: string;
  guestCancelToken: string;
  action: "cancel" | "request_refund";
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke(
    VENUE_ORDER_FUNCTIONS.guestAction,
    {
      body: {
        orderId: input.orderId,
        guestCancelToken: input.guestCancelToken,
        action: input.action,
        reason: input.reason ?? null,
      },
    },
  );
  if (error !== null) throw new VenueOrderError(await readFailure(error));
}
