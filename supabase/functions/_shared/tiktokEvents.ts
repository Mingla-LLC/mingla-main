/**
 * tiktokEvents.ts — ISSUE-865 WP-B · TikTok Events API sender.
 *
 * Sends ONE server-side conversion to the TikTok Events API v1.3, deduplicated
 * with the browser Pixel (`ttq.track('CompletePayment', …, { event_id })`) via
 * the SHARED event_id (the Mingla order id). Same-shared-event_id discipline as
 * Meta (A2-5): browser + server carry the identical event_id.
 *
 * HARD CONTRACT (identical to metaCapi.ts):
 *   • FAIL-OPEN — never throws; missing config / non-2xx / timeout → a result.
 *   • Token resolved from the connection's env-var NAME (A3-2) via
 *     Deno.env.get(conn.tokenEnvVar) — default TIKTOK_EVENTS_ACCESS_TOKEN
 *     (the `events_env_var` stored on the tiktok connection). NO token VALUE here.
 *   • PII (email/phone) SHA-256 HASHED by the caller (SC-9); ttclid is the raw
 *     click id (TikTok's documented field). No raw email/phone sent.
 */

import type {
  ConversionSendInput,
  SenderConnection,
  SenderDeps,
  SenderResult,
} from "./adConversionFire.ts";
import { resolveCapiToken } from "./capiTokens.ts";

const TIKTOK_EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const DEFAULT_TIMEOUT_MS = 8_000;

function valueNumber(valueCents: number | null): number | undefined {
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

export async function sendTikTokConversion(
  input: ConversionSendInput,
  conn: SenderConnection,
  deps: SenderDeps = {},
): Promise<SenderResult> {
  const getToken = deps.getToken ?? ((n: string) => resolveCapiToken(n));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const pixelCode = conn.pixelId?.trim();
  if (!pixelCode) return { channel: "tiktok", status: "skipped", reason: "no_pixel" };

  const tokenName = conn.tokenEnvVar?.trim();
  if (!tokenName) return { channel: "tiktok", status: "skipped", reason: "no_token_name" };
  const token = getToken(tokenName);
  if (!token || !token.trim()) {
    return { channel: "tiktok", status: "skipped", reason: "no_token" };
  }

  const user = definedOnly({
    email: input.hashedEmail ?? undefined, // SHA-256 hex (hashed by caller)
    phone: input.hashedPhone ?? undefined, // SHA-256 hex
    ttclid: input.externalClickId ?? undefined, // raw TikTok click id
    ip: input.clientIpAddress ?? undefined,
    user_agent: input.clientUserAgent ?? undefined,
  } as Record<string, unknown>);

  const properties = definedOnly({
    value: valueNumber(input.valueCents),
    currency: input.currency ?? undefined,
  } as Record<string, unknown>);

  const event = definedOnly({
    event: input.eventName, // "CompletePayment"
    event_time: Math.floor(input.eventTimeMs / 1000),
    event_id: input.eventId, // dedup key — MUST equal the browser ttq event_id
    user,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    page: input.eventSourceUrl ? { url: input.eventSourceUrl } : undefined,
  } as Record<string, unknown>);

  const bodyPayload = definedOnly({
    event_source: "web",
    event_source_id: pixelCode,
    data: [event],
    test_event_code: input.testEventCode ?? undefined,
  } as Record<string, unknown>);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(TIKTOK_EVENTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // TikTok authenticates via the Access-Token header (never a URL param).
        "Access-Token": token,
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      // TikTok returns 200 with a body { code, message } — code !== 0 is a soft
      // failure. Parse best-effort; a parse error still counts as sent (HTTP ok).
      try {
        const parsed = await res.json() as { code?: number };
        if (typeof parsed.code === "number" && parsed.code !== 0) {
          return { channel: "tiktok", status: "failed", reason: `code_${parsed.code}`, httpStatus: res.status };
        }
      } catch {
        // non-JSON 2xx — treat as sent.
      }
      return { channel: "tiktok", status: "sent", httpStatus: res.status };
    }
    return { channel: "tiktok", status: "failed", reason: `http_${res.status}`, httpStatus: res.status };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    return { channel: "tiktok", status: "failed", reason };
  } finally {
    clearTimeout(timer);
  }
}
