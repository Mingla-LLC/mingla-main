// Pure: no imports, safe for every Google caller (proxy, server geocode,
// static map, refresh job, health probes).

/**
 * #4334 (tester F-6) — Google answers an invalid, expired or restricted API key
 * on Places API (New) with HTTP **400** (`INVALID_ARGUMENT`), not 403:
 *   {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.",
 *    "status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo",
 *    "reason":"API_KEY_INVALID","domain":"googleapis.com",...}]}}
 * That is a denied key, not a bad request: it must read `provider_denied` (and
 * stop the refresh run), never `provider_invalid_request`.
 * https://cloud.google.com/apis/design/errors#error_info
 */
export function isApiKeyRejection(body: unknown): boolean {
  const error = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  if (error === undefined || error === null || typeof error !== "object") return false;
  const details = Array.isArray(error.details) ? error.details : [];
  if (details.some((d) => typeof (d as { reason?: unknown })?.reason === "string" &&
    /^API_KEY_/.test((d as { reason: string }).reason))) {
    return true;
  }
  return typeof error.message === "string" && /\bAPI key\b.*\b(not valid|invalid|expired)\b/i.test(error.message);
}

/** Static Maps answers a bad key in plain text, not JSON. */
export function isApiKeyRejectionText(text: string): boolean {
  return /\bAPI key\b.*\b(not valid|invalid|expired)\b/i.test(text) ||
    /\bprovided API key is invalid\b/i.test(text);
}
