/**
 * Ve2 — authenticated place_pool name search for venue claim comparison.
 * Returns public-safe fields only (no scoring / bouncer / AI columns).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNoForbiddenKeys,
  rowToPoolMatch,
  type PoolMatchRow,
} from "../_shared/poolMatchResponse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_QUERY_LENGTH = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

const rateBuckets = new Map<string, number[]>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function normalizeSearchBody(
  body: unknown,
):
  | { ok: true; query: string; limit: number | null; fetchAll: boolean }
  | { ok: false; error: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "invalid_json" };
  }
  const b = body as Record<string, unknown>;
  const query = typeof b.query === "string" ? b.query.trim() : "";
  if (query.length < MIN_QUERY_LENGTH) {
    return { ok: false, error: "query_too_short" };
  }
  const fetchAll = b.fetch_all === true;
  let limit: number | null = null;
  if (typeof b.limit === "number" && Number.isFinite(b.limit)) {
    limit = Math.max(1, Math.floor(b.limit));
  }
  return { ok: true, query, limit: fetchAll ? null : limit, fetchAll };
}

export function checkRateLimit(userId: string, now = Date.now()): boolean {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateBuckets.get(userId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(userId, hits);
    return false;
  }
  hits.push(now);
  rateBuckets.set(userId, hits);
  return true;
}

export async function requireUser(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse({ error: "auth_required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(tokenMatch[1]);
  if (error !== null || data.user === null) {
    return jsonResponse({ error: "auth_invalid" }, 401);
  }
  return { userId: data.user.id };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userResult = await requireUser(req);
  if (userResult instanceof Response) return userResult;

  if (!checkRateLimit(userResult.userId)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const normalized = normalizeSearchBody(body);
  if (!normalized.ok) {
    return jsonResponse({ error: normalized.error }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await client.rpc("biz_search_place_pool_for_claim", {
    p_query: normalized.query,
    p_limit: normalized.limit,
  });

  if (error !== null) {
    console.error("[claim-search-pool]", error.message);
    return jsonResponse({ error: "search_failed" }, 500);
  }

  const rows = (data ?? []) as PoolMatchRow[];
  const matches = rows.map((row) => {
    const match = rowToPoolMatch(row);
    assertNoForbiddenKeys(match as unknown as Record<string, unknown>);
    return match;
  });

  return jsonResponse({ matches, exhausted: true });
});
