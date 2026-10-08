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

const ORDER_REQUIRED: ReadonlySet<AutoFollowSource> = new Set([
  "purchase",
  "rsvp",
  "booking",
]);

function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.finally(() => {
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

export async function autoFollowBrandBestEffort(
  // deno-lint-ignore no-explicit-any
  supabase: { rpc: (...args: any[]) => Promise<{ data: unknown; error: { message: string } | null }> },
  input: {
    userId: string | null | undefined;
    brandId: string | null | undefined;
    source?: AutoFollowSource;
    /** Required for purchase/rsvp/booking so unfollow survives confirm/webhook replay. */
    orderId?: string | null | undefined;
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
  if (ORDER_REQUIRED.has(source) && orderId === null) {
    console.warn(
      "[autoFollowBrand] skipped — orderId required for",
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
      }),
      deadlineMs,
    );
    if (error) {
      console.warn(
        "[autoFollowBrand] non-fatal",
        error.message,
        userId,
        brandId,
        orderId,
      );
    }
  } catch (err) {
    console.warn(
      "[autoFollowBrand] threw (non-fatal)",
      err instanceof Error ? err.message : String(err),
      userId,
      brandId,
      orderId,
    );
  }
}
