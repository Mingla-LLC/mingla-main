// ORCH-0881 — Ve5 parse-restaurant-menu
//
// SECURITY: caller JWT only (I-ARI-USER-JWT-ONLY). No service role. No menu Storage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { parseMenuWithGemini, type MenuFileInput } from "../_shared/geminiMenuParser.ts";

// I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const HUB_EXPIRY_HOURS = 24 * 7;
const RATE_LIMIT_WINDOW_MS = 86_400_000;
const RATE_LIMIT_MAX = 20;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const rateBuckets = new Map<string, number[]>();

interface RequestBody {
  brand_id?: string;
  files?: MenuFileInput[];
}

type ResponseBody =
  | {
    kind: "ok";
    pending_actions: Array<{
      id: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
      expires_at: string;
    }>;
    experiences_count: number;
  }
  | { kind: "error"; code: string; message: string };

function jsonResponse(status: number, body: ResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { kind: "error", code, message });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function checkRateLimit(userId: string, now = Date.now()): boolean {
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

function decodeBase64Size(dataBase64: string): number {
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse(401, "UNAUTHORIZED", "Missing authorization");
  }
  const jwt = authHeader.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse(500, "INTERNAL", "Supabase config missing");
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or expired session");
  }
  const userId = userData.user.id;

  if (!checkRateLimit(userId)) {
    return errorResponse(429, "RATE_LIMIT", "Daily menu parse limit reached. Try again tomorrow.");
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!isUuid(body.brand_id)) {
    return errorResponse(400, "BAD_REQUEST", "brand_id must be a uuid");
  }

  const files = body.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    return errorResponse(400, "BAD_REQUEST", `Provide 1-${MAX_FILES} menu files`);
  }

  let totalBytes = 0;
  for (const f of files) {
    if (!f || typeof f.mime_type !== "string" || typeof f.data_base64 !== "string") {
      return errorResponse(400, "BAD_REQUEST", "Each file needs mime_type and data_base64");
    }
    if (!ALLOWED_MIME.has(f.mime_type)) {
      return errorResponse(400, "INVALID_MIME", `Unsupported type: ${f.mime_type}`);
    }
    const size = decodeBase64Size(f.data_base64);
    if (size <= 0) {
      return errorResponse(400, "BAD_REQUEST", "Invalid base64 payload");
    }
    totalBytes += size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return errorResponse(400, "FILE_TOO_LARGE", "Menu upload exceeds 10 MB total");
  }

  const { data: brand, error: brandErr } = await userClient
    .from("brands")
    .select("id, name, venue_category, default_currency, account_id")
    .eq("id", body.brand_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (brandErr || !brand) {
    return errorResponse(404, "NOT_FOUND", "Brand not found");
  }
  if (brand.account_id !== userId) {
    return errorResponse(403, "FORBIDDEN", "Brand not owned by caller");
  }
  // ORCH-1146 (Phase 3 — de-GBP): pass the brand currency through; when absent
  // pass null (not "GBP"). The parser leaves currency empty and the confirm
  // executor resolves it from brand.default_currency server-side.
  const defaultCurrency = (brand.default_currency as string | null)?.trim() || undefined;
  const temporaryCategory = "restaurant" as const;
  const sourceCategory = (brand.venue_category as string | null)?.trim() || "unknown";

  let parseResult;
  try {
    parseResult = await parseMenuWithGemini({
      files,
      defaultCurrency,
      temporaryCategory,
      venueName: brand.name as string,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Menu parsing failed";
    console.error("[parse-restaurant-menu] parse error:", msg.slice(0, 200));
    return errorResponse(422, "PARSE_FAILED", "We couldn't read that menu. Try a clearer photo or PDF.");
  }

  if (parseResult.experiences.length === 0) {
    return jsonResponse(200, {
      kind: "ok",
      pending_actions: [],
      experiences_count: 0,
    });
  }

  const expiresAt = new Date(Date.now() + HUB_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const rows: Array<{
    id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
    expires_at: string;
  }> = [];

  for (const exp of parseResult.experiences) {
    const tool_args: Record<string, unknown> = {
      brand_id: body.brand_id,
      title: exp.title,
      narrative: exp.narrative,
      suggested_price_min_cents: exp.suggested_price_min_cents,
      suggested_price_max_cents: exp.suggested_price_max_cents,
      currency: exp.currency,
      temporaryCategory,
      intent_tags: exp.intent_tags,
      is_free: exp.is_free,
      suggested_time_of_day: exp.suggested_time_of_day,
      confidence: exp.confidence,
      // ORCH-1151: thread the menu-items-as-stops through to the executor so
      // the confirm writes experience_stops + a summed-price single ticket.
      stops: exp.stops,
    };

    const { data: inserted, error: insertErr } = await userClient
      .from("agent_pending_actions")
      .insert({
        user_id: userId,
        conversation_id: null,
        source: "hub_experience",
        related_brand_id: body.brand_id,
        tool_name: "create_experience",
        tool_args,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id, tool_name, tool_args, expires_at")
      .single();

    if (insertErr || !inserted) {
      console.error("[parse-restaurant-menu] pending insert failed:", insertErr?.message);
      return errorResponse(500, "INTERNAL", "Failed to save experience proposals");
    }

    rows.push({
      id: inserted.id as string,
      tool_name: inserted.tool_name as string,
      tool_args: inserted.tool_args as Record<string, unknown>,
      expires_at: inserted.expires_at as string,
    });
  }

  return jsonResponse(200, {
    kind: "ok",
    pending_actions: rows,
    experiences_count: rows.length,
  });
});
