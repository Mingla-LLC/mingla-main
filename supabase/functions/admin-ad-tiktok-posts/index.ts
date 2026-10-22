/** Issue #3697 — read @usemingla organic posts eligible for TikTok Spark Pull. */

// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AdConnectionRow } from "../_shared/adChannel.ts";
import {
  resolveTikTokClient,
  tiktokFetchSparkPosts,
} from "../_shared/tiktok.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// deno-lint-ignore no-explicit-any
async function isActiveAdmin(db: any, req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const { data: { user }, error } = await db.auth.getUser(
    header.slice(7).trim(),
  );
  if (error || !user?.email) return false;
  const { data } = await db.from("admin_users").select("id")
    .eq("email", user.email).eq("status", "active").maybeSingle();
  return !!data;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!await isActiveAdmin(db, req)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = record(await req.json());
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const cursor = typeof body.cursor === "string" ? body.cursor.trim() : "";

  const { data, error } = await db.from("ad_connections").select("*")
    .eq("platform", "tiktok")
    .eq("lane", "consumer")
    .eq("connected", true)
    .eq("status", "connected")
    .maybeSingle();
  if (error) return json({ error: "connection_read_failed" }, 500);
  if (!data) return json({ error: "tiktok_not_connected" }, 424);

  const connection = data as AdConnectionRow;
  const extra = record(connection.extra);
  const identityType = typeof extra.identity_type === "string"
    ? extra.identity_type
    : "";
  const identityId = typeof extra.identity_id === "string"
    ? extra.identity_id.trim()
    : "";
  if (identityType !== "TT_USER" || !identityId) {
    return json({
      error: "tiktok_identity_missing",
      detail:
        "The connected consumer lane must be the linked @usemingla TT_USER identity.",
    }, 424);
  }

  try {
    const result = await tiktokFetchSparkPosts(
      resolveTikTokClient(connection),
      {
        identityId,
        cursor: cursor || undefined,
        count: 20,
      },
    );
    return json({
      identity: {
        type: "TT_USER",
        username: typeof extra.identity_username === "string"
          ? extra.identity_username
          : "usemingla",
      },
      ...result,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return json({ error: "tiktok_posts_read_failed", detail: message }, 502);
  }
});
