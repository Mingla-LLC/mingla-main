/**
 * #3682 — auto-follow after purchase / RSVP / booking (signed-in buyers).
 * Fail-open: never block checkout confirmation on follow failures.
 * Bounded: RPC is raced against a short deadline so a stalled PostgREST
 * call cannot hang a buyer-facing confirm/status poll that awaits a parent.
 */

export type AutoFollowSource =
  | "purchase"
  | "rsvp"
  | "booking"
  | "brand_page"
  | "web_email";

/** Max wait for the follow RPC; confirm/status paths must not hang longer. */
export const AUTO_FOLLOW_RPC_DEADLINE_MS = 1500;

/**
 * Generic claim key (#3682 closeout, migration 20280401003682): the row that
 * caused the follow. 'order' is implied by orderId.
 */
export type AutoFollowSourceKind = "order" | "rsvp" | "reservation";

const CLAIM_REQUIRED: ReadonlySet<AutoFollowSource> = new Set([
  "purchase",
  "rsvp",
  "booking",
]);

/** Stable log tag so a broken auto-follow is visible in edge logs. */
export const AUTO_FOLLOW_FAILURE_TAG = "[autoFollowBrand][ISSUE-3682-AUTO-FOLLOW-FAILED]";

/**
 * Race `work` against a deadline. `work` is typed PromiseLike on purpose:
 * supabase-js query/RPC builders are thenables only (no `.finally`), and the
 * HTTP request is sent from `then()`. Converting with Promise.resolve() first
 * calls `then()` (sending the request) and gives us a real Promise.
 */
function withDeadline<T>(work: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("auto_follow_deadline")),
        timeoutMs,
      );
    }),
  ]);
}

/**
 * Standalone RSVP auto-follow rule: a signed-in guest who said anything other
 * than "not going" (going, maybe, waitlisted, pending approval) follows the
 * brand. "Not going" is not interest and never follows.
 */
export function rsvpStatusAutoFollows(status: unknown): boolean {
  return typeof status === "string" && status.length > 0 &&
    status !== "not_going";
}

export async function autoFollowBrandBestEffort(
  // deno-lint-ignore no-explicit-any
  supabase: { rpc: (...args: any[]) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  input: {
    userId: string | null | undefined;
    brandId: string | null | undefined;
    source?: AutoFollowSource;
    /**
     * Purchase/rsvp/booking need a claim key so unfollow survives
     * confirm/webhook replay: either orderId, or sourceKind + sourceId.
     */
    orderId?: string | null | undefined;
    /** Non-order claim key kind ('rsvp' = event_rsvps.id, 'reservation' = reservations.id). */
    sourceKind?: Exclude<AutoFollowSourceKind, "order">;
    sourceId?: string | null | undefined;
    /** Override deadline (tests); default AUTO_FOLLOW_RPC_DEADLINE_MS. */
    deadlineMs?: number;
  },
): Promise<void> {
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  const brandId = typeof input.brandId === "string" ? input.brandId.trim() : "";
  if (userId.length === 0 || brandId.length === 0) {
    return;
  }
  const source: AutoFollowSource = input.source ?? "purchase";
  const orderId = typeof input.orderId === "string" && input.orderId.trim().length > 0
    ? input.orderId.trim()
    : null;
  const sourceId = typeof input.sourceId === "string" && input.sourceId.trim().length > 0
    ? input.sourceId.trim()
    : null;
  const sourceKind = orderId === null && sourceId !== null && input.sourceKind
    ? input.sourceKind
    : null;
  if (CLAIM_REQUIRED.has(source) && orderId === null && sourceKind === null) {
    console.warn(
      "[autoFollowBrand] skipped — orderId or sourceKind+sourceId required for",
      source,
      userId,
      brandId,
    );
    return;
  }
  const deadlineMs = typeof input.deadlineMs === "number" && input.deadlineMs > 0
    ? input.deadlineMs
    : AUTO_FOLLOW_RPC_DEADLINE_MS;
  try {
    const { error } = await withDeadline(
      supabase.rpc("biz_auto_follow_brand", {
        p_user_id: userId,
        p_brand_id: brandId,
        p_source: source,
        p_order_id: orderId,
        // Only sent for the generic key, so order calls keep the exact
        // pre-20280401003682 argument shape.
        ...(sourceKind !== null
          ? { p_source_kind: sourceKind, p_source_id: sourceId }
          : {}),
      }),
      deadlineMs,
    );
    if (error) {
      console.error(
        AUTO_FOLLOW_FAILURE_TAG,
        "rpc_error",
        error.message,
        userId,
        brandId,
        orderId ?? `${sourceKind}:${sourceId}`,
      );
    }
  } catch (err) {
    console.error(
      AUTO_FOLLOW_FAILURE_TAG,
      "threw",
      err instanceof Error ? err.message : String(err),
      userId,
      brandId,
      orderId ?? `${sourceKind}:${sourceId}`,
    );
  }
}

/**
 * #3682 — venue booking auto-follow. Reads the person and brand from the
 * minted reservations row itself (persisted truth, not the request), and only
 * for a signed-in booker (consumer_user_id). Claimed by
 * (reservation, reservations.id), so every finalize path (free create, Stripe
 * confirm, Paystack confirm/webhook) can call it and a replay is a no-op.
 */
export async function autoFollowReservationBestEffort(
  // deno-lint-ignore no-explicit-any
  supabase: { rpc: (...args: any[]) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  reservation: Record<string, unknown> | null | undefined,
  options: { deadlineMs?: number } = {},
): Promise<void> {
  if (!reservation) return;
  const id = typeof reservation.id === "string" ? reservation.id : null;
  const userId = typeof reservation.consumer_user_id === "string"
    ? reservation.consumer_user_id
    : null;
  const brandId = typeof reservation.brand_id === "string"
    ? reservation.brand_id
    : null;
  if (id === null || userId === null || brandId === null) return;
  await autoFollowBrandBestEffort(supabase, {
    userId,
    brandId,
    source: "booking",
    sourceKind: "reservation",
    sourceId: id,
    deadlineMs: options.deadlineMs,
  });
}
