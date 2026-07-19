/**
 * metaCapi.ts — ISSUE-865 WP-B · Meta Conversions API sender.
 *
 * Sends ONE server-side conversion to the Meta Conversions API, deduplicated
 * with the browser Pixel via the SHARED event_id (A2-5):
 *   • browser Pixel `fbq('track','Purchase', {…}, {eventID})`  and
 *   • this CAPI send `{ event_name:'Purchase', event_id }`
 *   MUST carry the IDENTICAL event_id AND the IDENTICAL event name — Meta
 *   dedups the exact (eventID==event_id) + (event==event_name) pair within a
 *   48h window. The event_id is the Mingla order id (deterministic per
 *   real-world conversion — see adConversionFire.ts).
 *
 * HARD CONTRACT:
 *   • FAIL-OPEN. Never throws. Any missing config / non-2xx / timeout / network
 *     error returns a { status } result; the caller records it and moves on —
 *     a CAPI failure can NEVER block, delay, or reverse a purchase (RT-1).
 *   • Token resolved from the env-var NAME on the connection (A3-2) —
 *     Deno.env.get(conn.tokenEnvVar). NO hardcoded secret, no token VALUE in code.
 *   • PII is SHA-256 HASHED (em/ph) by the caller (SC-9). fbc/fbp are passed
 *     UNHASHED (A2-5). No raw email/phone is ever sent.
 *   • Meta API version pinned v25.0 (A2-6). This endpoint carries NO
 *     action_attribution_windows — it is /events, not /insights — so the
 *     deprecated-view-window rule (RT-4) is satisfied by construction.
 */

import type {
  ConversionSendInput,
  SenderConnection,
  SenderDeps,
  SenderResult,
} from "./adConversionFire.ts";
import { resolveCapiToken } from "./capiTokens.ts";

// Pinned per A2-6 (v25.0 shipped 2026-02-18; v21.0 is stale). Overridable by the
// same META_API_VERSION env the ad-engine adapter (meta.ts) already reads.
const META_DEFAULT_API_VERSION = "v25.0";
const META_GRAPH_BASE = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 8_000;

function metaApiVersion(getToken: (n: string) => string | undefined): string {
  const v = getToken("META_API_VERSION");
  return v && v.trim() ? v.trim() : META_DEFAULT_API_VERSION;
}

/** cents → Meta decimal major units (e.g. 2000 -> 20.00). */
function valueMajor(valueCents: number | null): number | undefined {
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

export async function sendMetaConversion(
  input: ConversionSendInput,
  conn: SenderConnection,
  deps: SenderDeps = {},
): Promise<SenderResult> {
  const getToken = deps.getToken ?? ((n: string) => resolveCapiToken(n));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const pixelId = conn.pixelId?.trim();
  if (!pixelId) return { channel: "meta", status: "skipped", reason: "no_pixel" };

  const tokenName = conn.tokenEnvVar?.trim();
  if (!tokenName) return { channel: "meta", status: "skipped", reason: "no_token_name" };
  const token = getToken(tokenName);
  if (!token || !token.trim()) {
    return { channel: "meta", status: "skipped", reason: "no_token" };
  }

  const userData = definedOnly({
    em: input.hashedEmail ? [input.hashedEmail] : undefined,
    ph: input.hashedPhone ? [input.hashedPhone] : undefined,
    // fbc/fbp UNHASHED (A2-5) — exact formats minted browser-side / reconstructed.
    fbc: input.fbc ?? undefined,
    fbp: input.fbp ?? undefined,
    client_ip_address: input.clientIpAddress ?? undefined,
    client_user_agent: input.clientUserAgent ?? undefined,
  } as Record<string, unknown>);

  const customData = definedOnly({
    value: valueMajor(input.valueCents),
    currency: input.currency ?? undefined,
  } as Record<string, unknown>);

  const event = definedOnly({
    event_name: input.eventName,
    event_time: Math.floor(input.eventTimeMs / 1000),
    event_id: input.eventId, // dedup key — MUST equal the browser Pixel eventID
    action_source: "website",
    event_source_url: input.eventSourceUrl ?? undefined,
    user_data: userData,
    custom_data: Object.keys(customData).length > 0 ? customData : undefined,
  } as Record<string, unknown>);

  const bodyPayload = definedOnly({
    data: [event],
    // access_token in the JSON body (not the URL) so it never lands in a log line.
    access_token: token,
    test_event_code: input.testEventCode ?? undefined,
  } as Record<string, unknown>);

  const version = metaApiVersion(getToken);
  const url = `${META_GRAPH_BASE}/${version}/${pixelId}/events`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      return { channel: "meta", status: "sent", httpStatus: res.status };
    }
    return { channel: "meta", status: "failed", reason: `http_${res.status}`, httpStatus: res.status };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    return { channel: "meta", status: "failed", reason };
  } finally {
    clearTimeout(timer);
  }
}
