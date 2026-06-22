// ORCH-1201 — Layer-C passive recorder for the Admin API-Health Hub.
//
// `recordApiCall` is FIRE-AND-FORGET and BEST-EFFORT. It:
//   1) emits a structured log line (Sentry-visible via structuredLog), and
//   2) inserts ONE api_health_observations row.
// It NEVER throws into the host call, NEVER changes the host return value/shape,
// and NEVER adds a blocking await to the host path. Wrap call sites as
// `void recordApiCall(...)` so the host return is unaffected.
//
// Invariant I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS: a forced insert error
// here must be swallowed and the host call must still return its value.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { structuredLog } from "./structuredLog.ts";

// ORCH-1201-R2: optional 5th arg `err` carries the vendor depletion fingerprint
// (Class-B services: OpenAI insufficient_quota, Gemini RESOURCE_EXHAUSTED, Serper
// "Not enough credits", Resend *_quota_exceeded). OPTIONAL so all pre-existing
// 4-arg call sites compile unchanged. Persisted to the additive nullable
// error_code/error_text columns; the probe's matchClassBDepletion reads them to
// disambiguate true depletion from transient rate-limits.
export interface ApiCallError {
  code?: string; // vendor machine code/type, e.g. 'insufficient_quota'
  text?: string; // short raw snippet (truncated to 300 chars on insert)
}

export async function recordApiCall(
  serviceKey: string,
  ok: boolean,
  latencyMs: number,
  httpStatus?: number,
  err?: ApiCallError,
): Promise<void> {
  // 1) always log — synchronous, cheap, Sentry-visible.
  try {
    structuredLog("info", "api_call", {
      service: serviceKey,
      ok,
      latencyMs: Math.round(latencyMs),
      httpStatus: httpStatus ?? null,
      errorCode: err?.code ?? null,
    });
  } catch (_e) {
    /* swallow — logging must never break the host */
  }

  // 2) best-effort DB insert; swallow ALL errors.
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const c = createClient(url, key);
    await c.from("api_health_observations").insert({
      service_key: serviceKey,
      ok,
      latency_ms: Math.round(latencyMs),
      http_status: httpStatus ?? null,
      error_code: err?.code ?? null,
      error_text: err?.text ? err.text.slice(0, 300) : null,
    });
  } catch (_e) {
    /* swallow — host call must never break */
  }
}
