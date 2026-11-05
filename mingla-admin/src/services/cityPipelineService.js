// Issue #4276 wave 4: every server call behind the Place pool pipeline screens.
// Each throws an Error carrying the server's own message (and code, when it sends one);
// screens show it, never a zero.
import { supabase, invokeWithRefresh } from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { ACTIVE_RUN_STATUSES } from "../lib/cityPipeline";

async function invoke(fn, body, fallback) {
  const { data, error } = await invokeWithRefresh(fn, { body });
  if (error) {
    const err = new Error(await extractFunctionError(error, fallback));
    err.status = error?.context?.status ?? null;
    throw err;
  }
  if (data && typeof data === "object" && typeof data.error === "string") {
    const err = new Error(data.error);
    err.code = data.code;
    throw err;
  }
  return data;
}

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const err = new Error(error.message || "The server did not answer.");
    err.code = error.code;
    throw err;
  }
  return data;
}

/** The conductor (run-city-pipeline). */
export function pipeline(action, body = {}) {
  return invoke("run-city-pipeline", { action, ...body }, `The pipeline could not ${action.replaceAll("_", " ")}`);
}

/** Searches, boxes and completeness (admin-seed-places). */
export function seeding(action, body = {}) {
  return invoke("admin-seed-places", { action, ...body }, `Seeding could not ${action.replaceAll("_", " ")}`);
}

/** U2, U3: every stage per city and in total. */
export function fetchPipelineFunnel(cityId = null) {
  return rpc("admin_place_pipeline_funnel", { p_city_id: cityId });
}

/** U5: why places were left out, grouped by rule. */
export function fetchExcludedSummary(cityId = null) {
  return rpc("admin_place_excluded_summary", { p_city_id: cityId });
}

/** The latest pipeline run per city, active ones first. Admins can read runs directly. */
export async function fetchPipelineRuns() {
  const { data, error } = await supabase
    .from("city_pipeline_runs")
    .select("id, city_id, status, scope, current_stage, pause_reason, pause_detail, spend_limit_usd, rules_only, skip_search, last_error, created_at, started_at, completed_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const latest = {};
  for (const r of data ?? []) {
    const have = latest[r.city_id];
    if (!have || (!ACTIVE_RUN_STATUSES.includes(have.status) && ACTIVE_RUN_STATUSES.includes(r.status))) {
      latest[r.city_id] = r;
    }
  }
  return latest;
}
