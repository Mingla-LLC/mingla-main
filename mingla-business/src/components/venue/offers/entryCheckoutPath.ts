/**
 * #4490 P2 — the checkout address for an entry choice, and its reverse.
 *
 * `/b/{brand}/v/{venue}/book/{offerId}?date=YYYY-MM-DD&q=<optionId>:<n>,…`
 * carries the day and the counts only: nothing personal and never a token.
 * The reverse is strict: anything malformed is dropped (the page then starts
 * from the first open day).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function entryCheckoutPath(input: {
  brandSlug: string;
  venueSlug: string;
  offerId: string;
  date: string;
  counts: Readonly<Record<string, number>>;
  /** #4490 fix 2 (N85) — the timed session picked (its window id). */
  windowId?: string | null;
}): string {
  const q = Object.entries(input.counts)
    .filter(([id, n]) => UUID.test(id) && Number.isInteger(n) && n > 0)
    .map(([id, n]) => `${id}:${n}`)
    .join(",");
  const params = new URLSearchParams();
  if (DATE.test(input.date)) params.set("date", input.date);
  if (q.length > 0) params.set("q", q);
  if (typeof input.windowId === "string" && UUID.test(input.windowId)) params.set("t", input.windowId);
  const query = params.toString();
  return `/b/${encodeURIComponent(input.brandSlug)}/v/${encodeURIComponent(input.venueSlug)}/book/${encodeURIComponent(
    input.offerId,
  )}${query.length > 0 ? `?${query}` : ""}`;
}

export function parseEntryCheckoutParams(params: {
  date?: string | string[] | null;
  q?: string | string[] | null;
  t?: string | string[] | null;
}): { date: string | null; counts: Record<string, number>; windowId: string | null } {
  const first = (v: string | string[] | null | undefined): string | null =>
    Array.isArray(v) ? (v[0] ?? null) : typeof v === "string" ? v : null;
  const rawDate = first(params.date);
  const rawQ = first(params.q);
  const counts: Record<string, number> = {};
  if (rawQ !== null) {
    for (const part of rawQ.split(",").slice(0, 10)) {
      const [id, n] = part.split(":");
      const count = Number(n);
      if (UUID.test(id ?? "") && Number.isInteger(count) && count > 0 && count <= 1000) {
        counts[(id as string).toLowerCase()] = count;
      }
    }
  }
  const rawS = first(params.t);
  return {
    date: rawDate !== null && DATE.test(rawDate) ? rawDate : null,
    counts,
    windowId: rawS !== null && UUID.test(rawS) ? rawS.toLowerCase() : null,
  };
}
