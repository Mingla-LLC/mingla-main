/**
 * #4238 P1-5 (I-4238-NO-PRIVATE-TOKEN-TO-PIXELS) — buyer return pages carry
 * private credentials in the address: the buyer status token (`bst`, which
 * reads the buyer's order), the checkout session ids (`csi`, `rcs`), the
 * provider return ids (`cs`, Paystack `trxref` / `reference`) and the emailed
 * manage / cancel `token`.
 *
 * The address itself is left alone: the confirm pages read these keys from
 * the live URL, and a refresh must keep the confirmation (ORCH-0928). Instead:
 *   - third-party ad pixels never boot or fire in a document whose address
 *     carried one of these keys (see webAnalytics.web.ts), and
 *   - first-party analytics (GA4, PostHog) only ever see URLs passed through
 *     `stripPrivateUrlParams`.
 *
 * Pure and RN-import-free, so it is unit-testable and never throws.
 */

export const PRIVATE_URL_QUERY_KEYS: readonly string[] = [
  "bst",
  "csi",
  "cs",
  "rcs",
  "trxref",
  "reference",
  "token",
];

const KEY_GROUP = PRIVATE_URL_QUERY_KEYS.join("|");
// `?bst=…`, `&cs=…`, `#csi=…` (raw) and `%3Fbst%3D…`, `%26cs%3D…` (one level of
// encoding, e.g. a URL carried inside another URL's query).
const RAW_PARAM = new RegExp(`([?&#])(?:${KEY_GROUP})=[^&#]*`, "g");
const ENCODED_PARAM = new RegExp(`(%3F|%26|%23)(?:${KEY_GROUP})%3D(?:(?!%26|%23)[^&#])*`, "gi");
const ANY_PARAM = new RegExp(`(?:[?&#]|%3F|%26|%23)(?:${KEY_GROUP})(?:=|%3D)`, "i");

/** True when the string carries at least one private key as a URL parameter. */
export function hasPrivateUrlToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 1 && ANY_PARAM.test(value);
}

/**
 * The same URL (absolute, relative or a bare query) without any private key.
 * Every other parameter, the path and a non-private fragment are kept.
 */
export function stripPrivateUrlParams(value: string): string {
  if (!hasPrivateUrlToken(value)) return value;
  return value
    .replace(RAW_PARAM, "$1")
    .replace(ENCODED_PARAM, "$1")
    .replace(/\?&+/g, "?")
    .replace(/#&+/g, "#")
    .replace(/&{2,}/g, "&")
    .replace(/(%3F|%26)(?:%26)+/gi, "$1")
    .replace(/[?&#]+(?=#|$)/g, "")
    .replace(/(?:%3F|%26)+(?=%23|&|#|$)/gi, "");
}

const SNAPSHOT_FULL = 2;
const SNAPSHOT_INCREMENTAL = 3;

function stripDeep(value: unknown, depth: number): unknown {
  if (typeof value === "string") return stripPrivateUrlParams(value);
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const out = stripDeep(item, depth - 1);
      if (out !== item) changed = true;
      return out;
    });
    return changed ? next : value;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const out = stripDeep(item, depth - 1);
    if (out !== item) changed = true;
    next[key] = out;
  }
  return changed ? next : value;
}

/**
 * PostHog event properties without any private key: every URL-bearing value
 * ($current_url, $referrer, $initial_*, $set / $set_once, autocapture hrefs)
 * and, for session-replay batches, the meta / custom / plugin records that
 * carry the page address. DOM snapshot and mutation records are left as they
 * are (inputs and text are already masked; their size makes a walk costly).
 */
export function stripPrivateUrlProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "$snapshot_data" && Array.isArray(value)) {
      out[key] = value.map((record) => {
        const type = (record as { type?: unknown } | null)?.type;
        return type === SNAPSHOT_FULL || type === SNAPSHOT_INCREMENTAL
          ? record
          : stripDeep(record, 6);
      });
      continue;
    }
    out[key] = stripDeep(value, 4);
  }
  return out;
}
