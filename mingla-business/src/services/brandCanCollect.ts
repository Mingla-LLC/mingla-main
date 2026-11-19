/**
 * brandCanCollect — #4518: the ONE reader of "can this brand take payments?"
 * for buyer pages (events, trips, experiences).
 *
 * THE DEFECT THIS OWNS. Three copies of this read turned ANY error into
 * `false`. A buyer whose phone could not reach the database for a moment was
 * told "Booking unavailable. The organizer is finishing payment setup." about
 * a brand whose setup was complete. A failed read is not an answer.
 *
 * THREE ANSWERS, NOT TWO.
 *   "yes"      the server said the brand can collect
 *   "no"       the server said it cannot, or the server answered with an
 *              error of its own (it was reached; we cannot vouch for the
 *              brand, so paid supply stays closed exactly as before)
 *   "unknown"  the request never got an answer (offline, blocked host, DNS,
 *              timeout). Retried first; never rendered as "no".
 *
 * "unknown" resolves to BOOKABLE. That is the contract `resolveOfferingCta`
 * already documents ("callers that cannot resolve `bookable` pass `true`; the
 * checkout 409 remains the terminal backstop"): the server re-checks the
 * brand when the buyer pays, so nothing is sold that should not be.
 */
import { supabase } from "./supabase";

export type BrandCanCollect = "yes" | "no" | "unknown";

/** Waits between attempts. Three tries in about 1.6 s worst case. */
const RETRY_DELAYS_MS = [400, 1200] as const;

type RpcError = { code?: string | null; message?: string | null } | null;

/**
 * A request that never reached the server carries no Postgres / PostgREST
 * code: supabase-js reports a thrown fetch as `{ code: "", message: "TypeError:
 * Failed to fetch" }`. Anything with a code is the server's own answer.
 */
export const isTransportFailure = (error: RpcError): boolean =>
  error !== null && (error.code === undefined || error.code === null || error.code === "");

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const readBrandCanCollect = async (
  brandId: string,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<BrandCanCollect> => {
  for (let attempt = 0; ; attempt += 1) {
    const { data, error } = await supabase.rpc("pg_brand_can_collect", {
      p_brand_id: brandId,
    });
    if (error === null) return data === true ? "yes" : "no";
    if (!isTransportFailure(error)) return "no";
    // Reported by the fetch layer (`resilientFetch` "unreachable" event).
    if (attempt >= delays.length) return "unknown";
    await wait(delays[attempt]);
  }
};

/** Bookable unless the server SAID the brand cannot collect. */
export const bookableFromCanCollect = (answer: BrandCanCollect): boolean =>
  answer !== "no";

/**
 * FREE ⇒ always bookable (never reaches the RPC). PAID ⇒ the brand read above.
 * `known` is the answer the same-origin page bundle already carried, when it
 * did: then no second request is made at all.
 */
export const resolveOfferingBookable = async (
  brandId: string,
  isPaid: boolean,
  known?: boolean,
): Promise<boolean> => {
  if (!isPaid) return true;
  if (typeof known === "boolean") return known;
  return bookableFromCanCollect(await readBrandCanCollect(brandId));
};
