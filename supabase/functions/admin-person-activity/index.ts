// #4226 Phase 2 (spec D11) — one person's app activity for the admin People
// drawer, read from PostHog on the server.
//
// Admin only: the caller's own client must answer is_admin_user() = true (the
// same guard as every People read). Input: { user_id }. PostHog identifies
// app users by their Supabase id (distinct_id), so the query is scoped to that
// one id, passed as a HogQL placeholder value, never spliced into the text.
//
// Returns, over the last 30 days:
//   screens         up to 50 `$screen` events, newest first: name, app, at
//   sessions_30d    distinct sessions
//   last_event_at   the newest event of any kind (any time)
// When POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID is not set the answer is
// { configured: false } so the drawer says "Activity tracking not connected
// yet" instead of showing an empty list. POSTHOG_API_HOST defaults to
// https://us.posthog.com. The key never leaves this function.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

export const SCREEN_LIMIT = 50;
export const DEFAULT_POSTHOG_HOST = "https://us.posthog.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 10_000;

export interface PostHogConfig {
  apiKey: string;
  projectId: string;
  host: string;
}

export interface ScreenView {
  name: string;
  app: string | null;
  at: string;
}

export interface ActivityAnswer {
  configured: true;
  screens: ScreenView[];
  sessions_30d: number;
  last_event_at: string | null;
}

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface Deps {
  config: () => PostHogConfig | null;
  userClient: (authHeader: string) => RpcClient;
  fetch: (url: string, init: FetchInit) => Promise<Response>;
}

/** PostHog settings, or null when the two secrets are not both set. */
export function readConfig(env: { apiKey?: string; projectId?: string; host?: string }): PostHogConfig | null {
  const apiKey = (env.apiKey ?? "").trim();
  const projectId = (env.projectId ?? "").trim();
  if (!apiKey || !projectId) return null;
  const rawHost = (env.host ?? "").trim() || DEFAULT_POSTHOG_HOST;
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(rawHost)) return null;
  if (!/^[0-9]+$/.test(projectId)) return null;
  return { apiKey, projectId, host: rawHost.replace(/\/+$/, "") };
}

/** The two HogQL queries; the person's id is a placeholder value. */
export function buildQueries(userId: string) {
  return {
    screens: {
      kind: "HogQLQuery",
      query: "SELECT properties.$screen_name, properties.app, timestamp FROM events " +
        "WHERE distinct_id = {user_id} AND event = '$screen' AND timestamp > now() - INTERVAL 30 DAY " +
        `ORDER BY timestamp DESC LIMIT ${SCREEN_LIMIT}`,
      values: { user_id: userId },
    },
    summary: {
      kind: "HogQLQuery",
      query: "SELECT countDistinctIf(properties.$session_id, timestamp > now() - INTERVAL 30 DAY), max(timestamp) " +
        "FROM events WHERE distinct_id = {user_id}",
      values: { user_id: userId },
    },
  };
}

function rowsOf(body: unknown): unknown[][] {
  const results = (body as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? results.filter((row): row is unknown[] => Array.isArray(row)) : [];
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value.includes("T") || value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function parseScreens(body: unknown): ScreenView[] {
  return rowsOf(body).slice(0, SCREEN_LIMIT).flatMap((row) => {
    const at = iso(row[2]);
    if (!at) return [];
    const name = typeof row[0] === "string" && row[0].trim() ? row[0].trim().slice(0, 200) : "Unnamed screen";
    const app = typeof row[1] === "string" && row[1].trim() ? row[1].trim().slice(0, 40) : null;
    return [{ name, app, at }];
  });
}

export function parseSummary(body: unknown): { sessions_30d: number; last_event_at: string | null } {
  const row = rowsOf(body)[0] ?? [];
  const sessions = Number(row[0]);
  return {
    sessions_30d: Number.isFinite(sessions) && sessions > 0 ? Math.floor(sessions) : 0,
    last_event_at: iso(row[1]),
  };
}

async function runQuery(
  deps: Deps,
  config: PostHogConfig,
  query: Record<string, unknown>,
): Promise<unknown> {
  const response = await deps.fetch(`${config.host}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, name: "admin-person-activity" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    // The response body can echo request details; keep only the status.
    await response.body?.cancel();
    throw new Error(`posthog_query_failed:${response.status}`);
  }
  return await response.json();
}

export async function personActivity(deps: Deps, config: PostHogConfig, userId: string): Promise<ActivityAnswer> {
  const queries = buildQueries(userId);
  const [screens, summary] = await Promise.all([
    runQuery(deps, config, queries.screens),
    runQuery(deps, config, queries.summary),
  ]);
  return { configured: true, screens: parseScreens(screens), ...parseSummary(summary) };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const authHeader = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json(401, { error: "unauthorized" });

  const caller = deps.userClient(authHeader);
  const { data: who, error: whoError } = await caller.auth.getUser();
  if (whoError || !who?.user) return json(401, { error: "unauthorized" });
  try {
    const { data, error } = await caller.rpc("is_admin_user");
    if (error || data !== true) return json(403, { error: "forbidden" });
  } catch (_err) {
    return json(403, { error: "forbidden" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch (_err) {
    return json(400, { error: "invalid_body" });
  }
  const userId = typeof body?.user_id === "string" ? body.user_id.trim().toLowerCase() : "";
  if (!UUID.test(userId)) return json(400, { error: "user_id_invalid" });

  const config = deps.config();
  if (!config) return json(200, { configured: false });
  try {
    return json(200, await personActivity(deps, config, userId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin-person-activity] PostHog read failed", message);
    return json(502, { error: "activity_unavailable" });
  }
}

export const productionDeps: Deps = {
  config: () =>
    readConfig({
      apiKey: Deno.env.get("POSTHOG_PERSONAL_API_KEY"),
      projectId: Deno.env.get("POSTHOG_PROJECT_ID"),
      host: Deno.env.get("POSTHOG_API_HOST"),
    }),
  userClient: (authHeader) =>
    createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as RpcClient,
  fetch: (url, init) => fetch(url, init),
};

if (import.meta.main) serve((req) => handle(req, productionDeps));
