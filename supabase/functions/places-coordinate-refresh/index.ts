/**
 * places-coordinate-refresh — #4334, spec v2 §6.
 *
 * Daily (pg_cron `places-coordinate-refresh-daily`, 03:20 UTC) and on demand.
 * verify_jwt = false; the caller must present the vault service-role bearer
 * (or CRON_SECRET) — the #3200 rule in _shared/cronCallerAuth.ts.
 *
 *   POST {} → 200 RefreshSummary | 401 { error: "unauthorized" }
 *        | 500 { error: "provider_key_missing" | "refresh_failed" }
 *
 * The run itself lives in refresh.ts.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recordApiCall } from "../_shared/apiHealthLog.ts";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { captureEdgeException } from "../_shared/sentryEdge.ts";
import {
  type AlertSummary,
  type DuePin,
  type RecordArgs,
  runRefresh,
} from "./refresh.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handler(
  req: Request,
  authorize: (h: string | null) => Promise<boolean> = isAuthorizedCronCaller,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorize(req.headers.get("authorization")))) {
    return json({ error: "unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!apiKey) {
    captureEdgeException(new Error("GOOGLE_MAPS_API_KEY not configured"), {
      fn: "places-coordinate-refresh",
      tags: { issue: "4334", code: "provider_key_missing" },
    });
    return json({ error: "provider_key_missing" }, 500);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };

  try {
    const summary = await runRefresh({
      apiKey,
      fetch: (url, init) => fetch(url, init),
      duePins: (limit) => rpc<DuePin[]>("places_refresh_due_pins", { p_limit: limit }),
      record: (args: RecordArgs) => rpc<boolean>("places_refresh_record", { ...args }),
      expirePast: () => rpc<number>("places_refresh_expire_past"),
      alertSummary: () => rpc<AlertSummary>("places_refresh_alert_summary"),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      captureException: (error, context) =>
        captureEdgeException(error, { fn: "places-coordinate-refresh", ...context }),
      recordApiCall: (ok, ms, status, err) =>
        void recordApiCall("google_place_refresh", ok, ms, status, err),
    });
    console.log(JSON.stringify({ fn: "places-coordinate-refresh", ...summary }));
    return json(summary);
  } catch (e) {
    captureEdgeException(e, {
      fn: "places-coordinate-refresh",
      tags: { issue: "4334", code: "refresh_failed" },
    });
    void recordApiCall("google_place_refresh", false, 0, undefined, {
      code: "refresh_failed",
      text: String(e).slice(0, 200),
    });
    return json({ error: "refresh_failed" }, 500);
  }
}

if (import.meta.main) {
  serve((req) => handler(req));
}
