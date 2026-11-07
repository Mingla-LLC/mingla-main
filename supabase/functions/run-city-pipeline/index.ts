// Issue #4276 C1: the conductor. pg_cron posts action=tick with the service key once a
// minute, and only while a person's run is waiting. Every other action is a signed-in,
// active admin. A service-key call can't start, approve or resume anything: spending
// starts with a person.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkStorageHeadroom } from "../_shared/storageHeadroomGuard.ts";
import { unhealthyProviders } from "./gates.ts";
import {
  approve,
  type CallResult,
  cancel,
  chooseRulesOnly,
  type Deps,
  pause,
  preview,
  Refusal,
  resume,
  setSettings,
  start,
  status,
  tick,
} from "./conductor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A sub-call is cut off after this, so one slow call can't outlive the tick's lease. */
export const SUB_CALL_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * #4276: the edge runtime throws Deno.errors.RateLimitError from fetch() when one
 * function calls another too fast ("Rate limit exceeded for function. Retry after
 * <n>ms."). It is a wait, not a failure, so it comes back as a 429 with the hint.
 */
export function rateLimitRetryAfterMs(err: unknown): number | null {
  // deno-lint-ignore no-explicit-any
  const RateLimitError = (Deno as any).errors?.RateLimitError;
  const message = err instanceof Error ? err.message : String(err ?? "");
  const isRateLimit = (typeof RateLimitError === "function" && err instanceof RateLimitError) ||
    /Rate limit exceeded for function/.test(message);
  if (!isRateLimit) return null;
  // deno-lint-ignore no-explicit-any
  const prop = (err as any)?.retryAfterMs;
  if (typeof prop === "number" && Number.isFinite(prop) && prop >= 0) return prop;
  const parsed = /Retry after (\d+)\s*ms/i.exec(message);
  return parsed ? Number(parsed[1]) : DEFAULT_RETRY_AFTER_MS;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Calls another edge function with the service key. Exported for tests. */
export function makeCall(
  supabaseUrl: string,
  serviceKey: string,
  doFetch: typeof fetch = fetch,
  timeoutMs = SUB_CALL_TIMEOUT_MS,
) {
  return async (fn: string, body: Record<string, unknown>): Promise<CallResult> => {
    let res: Response;
    let text: string;
    try {
      res = await doFetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const retryAfterMs = rateLimitRetryAfterMs(err);
      if (retryAfterMs !== null) {
        return { status: 429, body: { error: "function_rate_limited", retry_after_ms: retryAfterMs } };
      }
      if (isTimeout(err)) return { status: 504, body: { error: "sub_call_timeout" } };
      throw err;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: text.slice(0, 500) };
    }
    return { status: res.status, body: parsed };
  };
}

function buildDeps(supabaseUrl: string, serviceKey: string): Deps {
  const db = createClient(supabaseUrl, serviceKey);
  return {
    db,
    call: makeCall(supabaseUrl, serviceKey),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    measureStorage: async () => {
      const v = await checkStorageHeadroom(db, "run-city-pipeline tick");
      return v.ok
        ? { ok: true, totalBytes: v.totalBytes, message: null }
        : { ok: false, totalBytes: v.totalBytes, message: v.message };
    },
  };
}

export const httpHandler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const body = await req.json().catch(() => ({}));
    const deps = buildDeps(supabaseUrl, serviceKey);

    if (body.action === "tick") {
      if (!serviceKey || token !== serviceKey) {
        return json({ error: "tick requires service-role auth" }, 403);
      }
      return json(await tick(deps));
    }

    // Everything else acts for a person.
    const { data: { user }, error: authErr } = await createClient(supabaseUrl, anonKey).auth.getUser(token);
    if (authErr || !user) return json({ error: "Invalid token" }, 401);
    const { data: admin } = await deps.db
      .from("admin_users").select("id").eq("email", user.email).eq("status", "active").maybeSingle();
    if (!admin) return json({ error: "Admin access required" }, 403);

    switch (body.action) {
      case "preview":
        return json(await preview(deps, body, admin.id));
      case "start":
        return json(await start(deps, body, admin.id));
      case "status":
        return json(await status(deps, body));
      case "approve":
        return json(await approve(deps, body, admin.id));
      case "pause":
        return json(await pause(deps, body));
      case "resume":
        return json(await resume(deps, body));
      case "cancel":
        return json(await cancel(deps, body));
      case "rules_only":
        return json(await chooseRulesOnly(deps, body, admin.id));
      case "settings":
        return json(await setSettings(deps, body, admin.id));
      case "blockers":
        return json(await rpcOrThrow(deps, "city_pipeline_blockers", { p_city_id: body.cityId }));
      case "spend":
        return json(await rpcOrThrow(deps, "city_pipeline_spend_ledger", { p_city_id: body.cityId, p_run_id: body.runId ?? null }));
      case "health":
        return json(await health(deps));
      case "gemini_cost_sample":
        return json(await rpcOrThrow(deps, "city_pipeline_gemini_cost_sample", {}));
      case "no_city_report":
        return json(await rpcOrThrow(deps, "city_pipeline_no_city_report", {}));
      case "assign_no_city":
        return json({ assigned: await rpcOrThrow(deps, "city_pipeline_assign_no_city", {}) });
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    if (err instanceof Refusal) {
      return json({ error: err.message, code: err.code, ...err.detail }, err.status);
    }
    console.error("[run-city-pipeline]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
};

/** U1: the Pipeline header. Providers, database, cached storage, the Serper rate and the
 * materialized view refresh, read without starting anything. */
async function health(deps: Deps) {
  const gates = await rpcOrThrow(deps, "city_pipeline_gate_inputs", {});
  const s = gates.settings ?? {};
  return {
    db_bytes: gates.db_bytes,
    db_pause_bytes: s.db_pause_bytes,
    storage_total_bytes: s.storage_total_bytes,
    storage_ok: s.storage_ok,
    storage_message: s.storage_message,
    storage_measured_at: s.storage_measured_at,
    serper_usd_per_request: s.serper_usd_per_request ?? null,
    providers: gates.providers,
    unhealthy: unhealthyProviders(gates, ["google_places", "gemini", "serper"], (deps.now ?? Date.now)()),
    mv_refresh: await rpcOrThrow(deps, "city_pipeline_mv_refresh_health", {}),
  };
}

async function rpcOrThrow(deps: Deps, name: string, args: Record<string, unknown>) {
  const { data, error } = await deps.db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

if (import.meta.main) {
  serve(httpHandler);
}
