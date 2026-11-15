/**
 * redditCapi.ts — ISSUE-865 WP-B · Reddit Conversions API sender (CAPI v3).
 *
 * Sends ONE server-side conversion to the Reddit Conversions API, deduplicated
 * with the browser Reddit Pixel via the shared conversion id
 * (`metadata.conversion_id` = the Mingla order id; the pixel sends the same
 * value as `conversionId`, #4238 W2-3). Reddit dedup applies WITHIN a channel
 * only (A2-7).
 *
 * #4238 (Step 0 Z5, read from ads-api.reddit.com/docs/v3 on 14 Nov 2026): v2.0
 * is deprecated. v3 is `POST /api/v3/pixels/{pixel_id}/conversion_events` with
 * body `{ data: { test_id?, events: [...] } }`. Each event needs `event_at`
 * (Unix milliseconds), `action_source` (`WEBSITE`) and
 * `type.tracking_type` (upper case: PURCHASE, SIGN_UP, LEAD, …, or CUSTOM with
 * `custom_event_name`). Revenue rides `metadata.value` + `metadata.currency`.
 * `test_id` is the Events Testing id: events sent with it are test events
 * (the daily key check uses it). The earlier 400 "unknown field events" on the
 * v3 path came from posting the v2 body (no `data` wrapper) to it.
 *
 * MISSING CONFIG (SC-12): `REDDIT_ADS_CAPI_TOKEN` unset → { status:'failed',
 * reason:'pending_config' } (#4238 W1-2: loud and retried for 72 h, never a
 * silent skip). It NEVER throws, so the other channels run.
 *
 * HARD CONTRACT (identical to metaCapi.ts): FAIL-OPEN, never throws; token from
 * the connection's env-var NAME via Deno.env.get(); PII SHA-256 HASHED by the
 * caller (SC-9); the Reddit pixel id (== the ad-account id, A2-3) is
 * conn.pixelId and the path param.
 */

import type {
  ConversionSendInput,
  SenderConnection,
  SenderDeps,
  SenderResult,
} from "./adConversionFire.ts";
import { resolveCapiToken } from "./capiTokens.ts";

// Reddit Conversions API v3 (#4238 Step 0 Z5). The pixel id is the path param.
const REDDIT_CAPI_BASE = "https://ads-api.reddit.com/api/v3/pixels";
const DEFAULT_TIMEOUT_MS = 8_000;

function valueDecimal(valueCents: number | null): number | undefined {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents) || valueCents <= 0) {
    return undefined;
  }
  return Math.round(valueCents) / 100;
}

/** v3 standard tracking types (upper case), keyed by the pixel's event name. */
const REDDIT_STANDARD_TRACKING_TYPE: Readonly<Record<string, string>> = {
  PageVisit: "PAGE_VISIT",
  ViewContent: "VIEW_CONTENT",
  Search: "SEARCH",
  AddToCart: "ADD_TO_CART",
  AddToWishlist: "ADD_TO_WISHLIST",
  Purchase: "PURCHASE",
  Lead: "LEAD",
  SignUp: "SIGN_UP",
};
const REDDIT_V3_TRACKING_TYPES = new Set(
  Object.values(REDDIT_STANDARD_TRACKING_TYPE),
);

/**
 * #4238 Step 0 Z5: the v3 `type` object. A standard name maps to its upper-case
 * tracking type; any other name is a custom event (`CUSTOM` + its name, at
 * most 64 characters, case kept). The pixel's matching name is the same
 * string, so browser and server pair.
 */
export function redditEventType(
  eventName: string,
): { tracking_type: string; custom_event_name?: string } {
  const standard = REDDIT_STANDARD_TRACKING_TYPE[eventName];
  if (standard) return { tracking_type: standard };
  if (REDDIT_V3_TRACKING_TYPES.has(eventName)) {
    return { tracking_type: eventName };
  }
  return { tracking_type: "CUSTOM", custom_event_name: eventName.slice(0, 64) };
}

function definedOnly<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") delete obj[k];
  }
  return obj;
}

/** #4238: the v3 request body for one event. Pure, so the shape is testable. */
export function buildRedditConversionBody(
  input: ConversionSendInput,
): Record<string, unknown> {
  const user = definedOnly({
    email: input.hashedEmail ?? undefined, // SHA-256 hex (hashed by caller)
    // #4238 P2-1 (Step 0 Z5/Z6): Reddit's phone_number is E.164 (with `+`).
    phone_number: input.hashedPhoneE164 ?? undefined,
    ip_address: input.clientIpAddress ?? undefined,
    user_agent: input.clientUserAgent ?? undefined,
  } as Record<string, unknown>);
  const value = valueDecimal(input.valueCents);
  const metadata = definedOnly({
    conversion_id: input.eventId, // dedup key — shared with the browser pixel
    value,
    currency: value !== undefined ? input.currency ?? undefined : undefined,
  } as Record<string, unknown>);
  const event = definedOnly({
    event_at: Math.round(input.eventTimeMs), // Unix milliseconds (v3)
    action_source: "WEBSITE",
    type: redditEventType(input.eventName),
    click_id: input.externalClickId ?? undefined, // raw rdt_cid
    event_source_url: input.eventSourceUrl ?? undefined,
    user: Object.keys(user).length > 0 ? user : undefined,
    metadata,
  } as Record<string, unknown>);
  const testId = input.testEventCode?.trim();
  return {
    data: testId ? { test_id: testId, events: [event] } : { events: [event] },
  };
}

export async function sendRedditConversion(
  input: ConversionSendInput,
  conn: SenderConnection,
  deps: SenderDeps = {},
): Promise<SenderResult> {
  const getToken = deps.getToken ?? ((n: string) => resolveCapiToken(n));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const pixelId = conn.pixelId?.trim();
  if (!pixelId) return { channel: "reddit", status: "failed", reason: "no_pixel" };

  const tokenName = conn.tokenEnvVar?.trim();
  if (!tokenName) return { channel: "reddit", status: "failed", reason: "no_token_name" };
  const token = getToken(tokenName);
  if (!token || !token.trim()) {
    // PENDING-CONFIG (SC-12): token not set. #4238 W1-2: failed (retried and
    // alerted by ad-conversion-retry), never a silent skip. Never throws.
    return { channel: "reddit", status: "failed", reason: "pending_config" };
  }

  const url = `${REDDIT_CAPI_BASE}/${encodeURIComponent(pixelId)}/conversion_events`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Reddit CAPI authenticates with the conversion access token as Bearer.
        Authorization: `Bearer ${token}`,
        "User-Agent": "Mingla-Server/1.0",
      },
      body: JSON.stringify(buildRedditConversionBody(input)),
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      return { channel: "reddit", status: "sent", httpStatus: res.status };
    }
    return { channel: "reddit", status: "failed", reason: `http_${res.status}`, httpStatus: res.status };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    return { channel: "reddit", status: "failed", reason };
  } finally {
    clearTimeout(timer);
  }
}
