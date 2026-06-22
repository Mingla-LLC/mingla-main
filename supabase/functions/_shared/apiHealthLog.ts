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

export async function recordApiCall(
  serviceKey: string,
  ok: boolean,
  latencyMs: number,
  httpStatus?: number,
): Promise<void> {
  // 1) always log — synchronous, cheap, Sentry-visible.
  try {
    structuredLog("info", "api_call", {
      service: serviceKey,
      ok,
      latencyMs: Math.round(latencyMs),
      httpStatus: httpStatus ?? null,
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
    });
  } catch (_e) {
    /* swallow — host call must never break */
  }
}
