/**
 * Issue #1793 (#1767 Phase 4) — buyer web's guest-ordering transport.
 *
 * ANON-SAFE. No `useAuth`, no `isAuthReady`, no session. `/b/{brand}/v/{venue}`
 * is on the public buyer-route allowlist and a diner has no account; the whole
 * rail is anon-capable by contract (`verify_jwt = false`, auth OPTIONAL inside
 * `venue-order-create`).
 *
 * NO MONEY MATH (SPEC #1788 P-20). The body carries item ids, counts, option ids
 * and notes; every number that comes back was computed by the edge function from
 * server-read menu rows. The wire contract itself has ONE owner — the shared
 * `venueOrderingWire` module both surfaces import — so buyer web and the
 * consumer app cannot drift into sending two different requests or showing two
 * different sentences for one failure.
 *
 * The only thing that differs from the consumer's copy is the payment shape:
 * `surface: "web"` earns a hosted redirect instead of a native payment sheet,
 * and that arm is parsed here rather than in the shared package.
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

async function readFailure(error: unknown): Promise<VenueOrderFailure> {
  const context = (error as { context?: unknown } | null)?.context;
  if (
    context !== null && typeof context === "object" &&
    typeof (context as { text?: unknown }).text === "function"
  ) {
    try {
      // A body streams once. `.text()` first, parse from the string.
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

/**
 * What may this guest honestly be told about ordering here?
 *
 * Failure resolves to `unavailable`: no ordering affordance, and NO claim. The
 * page is exactly the page it was before Phase 4. A menu that quietly stays a
 * menu is honest; a menu with a dead "Add" button on it is not.
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

/** Price this exact basket. No row written, no provider called, nothing charged. */
export async function previewVenueOrder(
  request: VenueOrderRequest,
): Promise<VenueOrderPreview> {
  const { data, error } = await supabase.functions.invoke<
    Record<string, unknown>
  >(VENUE_ORDER_FUNCTIONS.create, {
    body: venueOrderCreateBody({ request, mode: "preview", surface: "web" }),
  });
  if (error !== null) throw new VenueOrderError(await readFailure(error));
  if (data === null) throw new VenueOrderError(VENUE_ORDER_GENERIC_FAILURE);
  return parseVenueOrderPreview(data);
}

/**
 * Buyer web's three arms.
 *
 * `hostedUrl` deliberately flattens the two provider redirects into ONE field:
 * from this surface's point of view they are the same act — send the guest away
 * to pay and get them back on the order's own page — and a caller that had to
 * branch on which provider it was would be a caller that could forget one. The
 * response's own kind is kept so the difference is still legible.
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
    kind: "requires_web_redirect" | "requires_paystack_redirect";
    orderId: string;
    sessionId: string;
    buyerStatusToken: string;
    guestCancelToken: string;
    hostedUrl: string;
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
    body: venueOrderCreateBody({
      request,
      mode: "create",
      surface: "web",
      idempotencyKey,
    }),
  });
  if (error !== null) throw new VenueOrderError(await readFailure(error));
  if (data === null) throw new VenueOrderError(VENUE_ORDER_GENERIC_FAILURE);
  const kind = String(data.kind ?? "");
  const common = {
    orderId: String(data.orderId ?? ""),
    sessionId: String(data.sessionId ?? ""),
    buyerStatusToken: String(data.buyerStatusToken ?? ""),
    guestCancelToken: String(data.guestCancelToken ?? ""),
  };
  if (kind === "free_completed") {
    return {
      kind,
      ...common,
      pickupCode: typeof data.pickupCode === "string" ? data.pickupCode : null,
    };
  }
  if (kind === "requires_web_redirect") {
    return { kind, ...common, hostedUrl: String(data.url ?? "") };
  }
  if (kind === "requires_paystack_redirect") {
    return {
      kind,
      ...common,
      hostedUrl: String(data.authorizationUrl ?? ""),
    };
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

/**
 * D-7a — the guest's way out. `cancel` while nobody has picked the order up is
 * an instant, automatic, FULL refund. Afterwards the same intent becomes
 * `request_refund`, which moves NO money and lands on the venue's ticket as a
 * decision a person makes.
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
