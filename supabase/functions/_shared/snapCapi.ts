/**
 * snapCapi.ts — ISSUE-865 WP-B · Snapchat Conversions API sender.
 *
 * Sends ONE server-side conversion to the Snap Conversions API v3, deduplicated
 * with the browser Snap Pixel via the shared id — Snap's dedup field is
 * `client_dedup_id`, set to our shared event_id (the Mingla order id, A2-5).
 *
 * HARD CONTRACT (identical to metaCapi.ts): FAIL-OPEN, never throws; token from
 * the connection's env-var NAME (default SNAPCHAT_CAPI_TOKEN) via
 * Deno.env.get(); PII SHA-256 HASHED (em/ph) by the caller (SC-9); no raw
 * email/phone sent.
 */

import type {
  ConversionSendInput,
  SenderConnection,
  SenderDeps,
  SenderResult,
} from "./adConversionFire.ts";

const SNAP_CAPI_BASE = "https://tr.snapchat.com/v3";
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

export async function sendSnapConversion(
  input: ConversionSendInput,
  conn: SenderConnection,
  deps: SenderDeps = {},
): Promise<SenderResult> {
  const getToken = deps.getToken ?? ((n: string) => Deno.env.get(n));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const pixelId = conn.pixelId?.trim();
  if (!pixelId) return { channel: "snap", status: "skipped", reason: "no_pixel" };

  const tokenName = conn.tokenEnvVar?.trim();
  if (!tokenName) return { channel: "snap", status: "skipped", reason: "no_token_name" };
  const token = getToken(tokenName);
  if (!token || !token.trim()) {
    return { channel: "snap", status: "skipped", reason: "no_token" };
  }

  const userData = definedOnly({
    em: input.hashedEmail ? [input.hashedEmail] : undefined, // SHA-256 hex
    ph: input.hashedPhone ? [input.hashedPhone] : undefined,
    sc_click_id: input.externalClickId ?? undefined, // raw Snap click id (sccid)
    client_ip_address: input.clientIpAddress ?? undefined,
    client_user_agent: input.clientUserAgent ?? undefined,
  } as Record<string, unknown>);

  const customData = definedOnly({
    value: valueNumber(input.valueCents),
    currency: input.currency ?? undefined,
  } as Record<string, unknown>);

  const event = definedOnly({
    event_name: input.eventName, // "PURCHASE"
    event_conversion_type: "WEB",
    event_time: input.eventTimeMs, // Snap wants milliseconds
    client_dedup_id: input.eventId, // dedup key — shared with the browser pixel
    user_data: userData,
    custom_data: Object.keys(customData).length > 0 ? customData : undefined,
    event_source_url: input.eventSourceUrl ?? undefined,
  } as Record<string, unknown>);

  // Snap authenticates the CAPI with the access token as a query param (its
  // documented method for the long-lived Conversions token).
  const url = `${SNAP_CAPI_BASE}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      return { channel: "snap", status: "sent", httpStatus: res.status };
    }
    return { channel: "snap", status: "failed", reason: `http_${res.status}`, httpStatus: res.status };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
    return { channel: "snap", status: "failed", reason };
  } finally {
    clearTimeout(timer);
  }
}
