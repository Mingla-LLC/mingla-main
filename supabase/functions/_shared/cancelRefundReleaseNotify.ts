/**
 * cancelRefundReleaseNotify — Issue #3645 handoff item 6.
 *
 * When Mingla admin releases a held cancel-refund batch
 * (`admin_release_event_cancel_refund_batch` → pending), hosts must hear that
 * refunds are moving. Buyer money truth still arrives later via the existing
 * webhook `buyer_refund_issued` path; this module never emails buyers.
 *
 * Called from `event-cancel-refund-fanout` once the run is drainable (not
 * `awaiting_review`) and there is refund work. Idempotent per event so cron
 * re-drives collapse. Fail-open relative to refunding — a notify miss must
 * never block fan-out.
 */

// @ts-ignore — Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BRAND_PAYMENTS_VIEW_ROLES,
  dispatchNotification,
  getBrandTeamUserIdsByRolesOrThrow,
} from "./stripeEdgeAuth.ts";

export const CANCEL_REFUNDS_RELEASED_TYPE =
  "business.cancel_refunds_released" as const;

export const CANCEL_REFUNDS_RELEASED_ROLES = BRAND_PAYMENTS_VIEW_ROLES;

export type CancelRefundReleaseNotifyInput = {
  eventId: string;
  brandId: string;
  offeringTitle: string;
};

export type CancelRefundReleaseNotifyDeps = {
  notifyBrandManagers: (
    supabase: SupabaseClient,
    input: {
      brandId: string;
      type: string;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      relatedId?: string | null;
      relatedType?: string | null;
      idempotencyKey: string;
      deepLink?: string | null;
      roles?: readonly string[];
    },
  ) => Promise<void>;
};

/** Organiser-safe copy — no provider names, no refund timing promise. */
export function cancelRefundsReleasedCopy(offeringTitle: string): {
  type: typeof CANCEL_REFUNDS_RELEASED_TYPE;
  title: string;
  body: string;
} {
  const title =
    offeringTitle.trim().length > 0 ? offeringTitle.trim() : "Your listing";
  return {
    type: CANCEL_REFUNDS_RELEASED_TYPE,
    title: "Refunds are on their way",
    body: `${title}: Mingla has released the held refunds. Buyers are being refunded.`,
  };
}

export function cancelRefundsReleasedDeepLink(eventId: string): string {
  return `mingla-business://event/${eventId}`;
}

export function cancelRefundsReleasedIdempotencyKey(eventId: string): string {
  return `${CANCEL_REFUNDS_RELEASED_TYPE}:${eventId}`;
}

/**
 * True when fan-out is allowed to drain AND there is refund work — the moment
 * hosts should be told a held batch was released (or is otherwise moving).
 */
export function shouldNotifyCancelRefundRelease(prep: {
  run_status?: unknown;
  total_objects?: unknown;
  rsvp_pending_count?: unknown;
} | null): boolean {
  if (!prep) return false;
  const status = typeof prep.run_status === "string" ? prep.run_status : "";
  if (
    status !== "pending" &&
    status !== "in_progress" &&
    status !== "failed_partial"
  ) {
    return false;
  }
  const orders =
    typeof prep.total_objects === "number" && Number.isFinite(prep.total_objects)
      ? prep.total_objects
      : 0;
  const rsvps =
    typeof prep.rsvp_pending_count === "number" &&
      Number.isFinite(prep.rsvp_pending_count)
      ? prep.rsvp_pending_count
      : 0;
  return orders > 0 || rsvps > 0;
}

export async function notifyBrandManagers(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    relatedId?: string | null;
    relatedType?: string | null;
    idempotencyKey: string;
    deepLink?: string | null;
    roles?: readonly string[];
  },
): Promise<void> {
  const userIds = await getBrandTeamUserIdsByRolesOrThrow(
    supabase as never,
    input.brandId,
    input.roles ?? CANCEL_REFUNDS_RELEASED_ROLES,
  );
  for (const userId of userIds) {
    await dispatchNotification({
      userId,
      brandId: input.brandId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      relatedId: input.relatedId,
      relatedType: input.relatedType,
      idempotencyKey: `${input.idempotencyKey}:${userId}`,
      deepLink: input.deepLink,
    });
  }
}

export const defaultCancelRefundReleaseNotifyDeps: CancelRefundReleaseNotifyDeps =
  {
    notifyBrandManagers,
  };

/**
 * Load brand + title for the cancelled offering, then notify payment-view roles.
 * Throws on lookup / dispatch failure so the caller can log and continue refunding.
 */
export async function notifyCancelRefundsReleased(
  supabase: SupabaseClient,
  eventId: string,
  deps: CancelRefundReleaseNotifyDeps = defaultCancelRefundReleaseNotifyDeps,
): Promise<"notified" | "skipped_no_brand"> {
  const { data, error } = await supabase
    .from("events")
    .select("id, brand_id, title")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    throw new Error(`cancel_refund_release_event_lookup_failed:${error.message}`);
  }
  const row = data as {
    id: string;
    brand_id: string | null;
    title: string | null;
  } | null;
  if (!row?.brand_id) return "skipped_no_brand";

  const copy = cancelRefundsReleasedCopy(row.title ?? "");
  await deps.notifyBrandManagers(supabase, {
    brandId: row.brand_id,
    type: copy.type,
    title: copy.title,
    body: copy.body,
    data: { eventId: row.id, brandId: row.brand_id },
    relatedId: row.id,
    relatedType: "event",
    idempotencyKey: cancelRefundsReleasedIdempotencyKey(row.id),
    deepLink: cancelRefundsReleasedDeepLink(row.id),
    roles: CANCEL_REFUNDS_RELEASED_ROLES,
  });
  return "notified";
}
