/**
 * redditCapi.ts — ISSUE-865 WP-B · Reddit Conversions API sender (account-scoped v2.0).
 *
 * Sends ONE server-side conversion to the Reddit Conversions API (v3 direct
 * integration, A2-7), deduplicated with the browser Reddit Pixel via the shared
 * conversion id (`event_metadata.conversion_id` = the Mingla order id). Reddit
 * dedup applies WITHIN a channel only (A2-7).
 *
 * PENDING-CONFIG (SC-12, hard requirement): the Reddit conversion access token
 * `REDDIT_ADS_CAPI_TOKEN` is name-reserved but its VALUE is NOT provisioned yet
 * (a human must generate it once in Reddit Events Manager). Until then this
 * sender FAIL-CLOSES SOFT — it returns { status:'skipped', reason:'pending_config' }
 * and NEVER errors, so the conversion pipeline runs green for the other three
 * channels. The moment the env var exists it starts sending — no code change.
 *
 * HARD CONTRACT (identical to metaCapi.ts): FAIL-OPEN, never throws; token from
 * the connection's env-var NAME via Deno.env.get(); PII SHA-256 HASHED by the
 * caller (SC-9); Reddit pixel id == ad-account id (A2-3), passed in conn.pixelId.
 * Reddit CAPI v3 field values differ from v2 (tracking_type) — built to v3.
 */

import type {
  ConversionSendInput,
  SenderConnection,
  SenderDeps,
  SenderResult,
} from "./adConversionFire.ts";
import { resolveCapiToken } from "./capiTokens.ts";

// Reddit Conversions API — the account-scoped v2.0 endpoint (ORCH-1405).
// The v3 `/pixels/{id}/conversion_events` path is REJECTED by Reddit
// (400 "unknown field events"); the working endpoint is v2.0
// `/conversions/events/{account_id}` — proven by live test-mode fire.
// conn.pixelId doubles as the ad-account id (A2-3), so it is the path param.
const REDDIT_CAPI_BASE = "https://ads-api.reddit.com/api/v2.0/conversions/events";
const DEFAULT_TIMEOUT_MS = 8_000;

function valueDecimal(valueCents: number | null): number | undefined {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents) || valueCents < 0) {
    return undefined;
  }
  return Math.round(valueCents) / 100;
}

function definedOnly<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") delete obj[k];
  }
  return obj;
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
  if (!pixelId) return { channel: "reddit", status: "skipped", reason: "no_pixel" };

  const tokenName = conn.tokenEnvVar?.trim();
  if (!tokenName) return { channel: "reddit", status: "skipped", reason: "no_token_name" };
  const token = getToken(tokenName);
  if (!token || !token.trim()) {
    // PENDING-CONFIG (SC-12): token not generated yet — skip softly, NEVER error.
    return { channel: "reddit", status: "skipped", reason: "pending_config" };
  }

  const user = definedOnly({
    email: input.hashedEmail ?? undefined, // SHA-256 hex (hashed by caller)
    phone_number: input.hashedPhone ?? undefined,
    ip_address: input.clientIpAddress ?? undefined,
    user_agent: input.clientUserAgent ?? undefined,
  } as Record<string, unknown>);

  const eventMetadata = definedOnly({
    currency: input.currency ?? undefined,
    value_decimal: valueDecimal(input.valueCents),
    conversion_id: input.eventId, // dedup key — shared with the browser pixel
  } as Record<string, unknown>);

  const event = definedOnly({
    event_at: new Date(input.eventTimeMs).toISOString(),
    // v3 shape: event_type.tracking_type (NOT the v2 snippet fields).
    event_type: { tracking_type: input.eventName }, // "Purchase"
    click_id: input.externalClickId ?? undefined, // raw rdt click id
    user: Object.keys(user).length > 0 ? user : undefined,
    event_metadata: Object.keys(eventMetadata).length > 0 ? eventMetadata : undefined,
  } as Record<string, unknown>);

  const url = `${REDDIT_CAPI_BASE}/${pixelId}`;

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
      body: JSON.stringify({ events: [event], test_mode: false }),
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
