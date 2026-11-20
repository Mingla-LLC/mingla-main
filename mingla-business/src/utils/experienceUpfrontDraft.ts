/**
 * N129 (#4490) — the payload for the experience wizard's up-front draft row.
 *
 * The draft is created when the host leaves Identity (so Stops can save the
 * venue link and Cover has a row to upload against), before any price has a
 * name. biz_create_experience refuses a blank price name at every index
 * (#4490 P1-4, no forced "Standard"), so unnamed seeds made every new
 * experience's draft fail. The up-front call leaves price_options out while any
 * option is unnamed; the server then keeps its draft-only placeholder price,
 * and the host's named prices are written by the save / publish that follows.
 */
export function upfrontDraftPayload<T extends Record<string, unknown>>(payload: T): T {
  const options = payload.price_options;
  if (!Array.isArray(options)) return payload;
  const unnamed = options.some((o) => {
    const name = o !== null && typeof o === "object" ? (o as { name?: unknown }).name : undefined;
    return typeof name !== "string" || name.trim().length === 0;
  });
  if (!unnamed) return payload;
  const rest: Record<string, unknown> = { ...payload };
  delete rest.price_options;
  return rest as T;
}
