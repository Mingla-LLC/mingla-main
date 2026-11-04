// #3682 wave 3 (#1779 / #1781) — how a received brand invite or campaign push
// reads in Explorer's notifications list. The server already wrote the true
// reason into the body ("…. You follow X."); here it is shown on its own line.
// The reason comes only from the server's reason code — never guessed — and
// never names a person (#876).

export const BRAND_REACH_TYPES = new Set([
  "brand_offering_invite",
  "brand_campaign_push",
]);

export type BrandReachReason = "follower" | "extended" | "book";

export function isBrandReachType(type: string): boolean {
  return BRAND_REACH_TYPES.has(type);
}

/** Must match supabase/functions/_shared/brandReachMessages.ts exactly. */
export function brandReachReasonLine(reason: unknown, brand: string): string {
  if (reason === "extended") return `A friend of yours follows ${brand}.`;
  if (reason === "book") return `You're on ${brand}'s guest list.`;
  return `You follow ${brand}.`;
}

function reasonCode(value: unknown): BrandReachReason | null {
  return value === "follower" || value === "extended" || value === "book"
    ? value
    : null;
}

export interface BrandReachRowCopy {
  body: string;
  reason: string | null;
  reasonCode: BrandReachReason | null;
}

/**
 * Split the server body into the message and its reason line. A row without
 * a known reason code (older rows, malformed data) shows the body unchanged
 * and no reason line: missing is hidden, never invented.
 */
export function brandReachRowCopy(
  body: string,
  data: Record<string, unknown>,
): BrandReachRowCopy {
  const code = reasonCode(data.reason);
  const brand = typeof data.brand_name === "string" ? data.brand_name.trim() : "";
  if (code === null || brand.length === 0) {
    return { body, reason: null, reasonCode: null };
  }
  const reason = brandReachReasonLine(code, brand);
  const trimmed = body.trim();
  // The body already carries the reason the server rendered; if it does not
  // end with exactly this line (brand name was trimmed server side), keep the
  // body as written rather than show the reason twice.
  if (!trimmed.endsWith(reason)) {
    return { body, reason: null, reasonCode: null };
  }
  const message = trimmed.slice(0, trimmed.length - reason.length).trim();
  return { body: message, reason, reasonCode: code };
}
