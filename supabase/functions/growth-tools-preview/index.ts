// ISSUE-1003 [Venue Website Grader] — public render-data read for the "after"
// homepage preview (the template engine's visual redesign).
//
// PUBLIC edge function (verify_jwt=false). The preview page
// (/tools/venues/preview?run_id=…) fetches ONLY the safe presentation fields of
// a saved run so it can render a premium redesigned homepage — which is then
// screenshotted as the report's before/after "after". No email, no ip_hash, no
// scores/fixes/competition: this endpoint returns the storefront-render subset
// only. All DB access is service-role (tool_leads is RLS deny-all for clients).
//
// HTTP contract:
//   GET  ?run_id=<uuid>        → 200 {render:{…}}
//   POST {run_id}             → 200 {render:{…}}
//   → 400 {error:"validation"} | 404 {error:"not_found"}
//   → 409 {error:"report_not_ready"} | 500 {error:"server"}
//   OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      // Short cache: ScreenshotOne may hit this a couple of times per render.
      "Cache-Control": "public, max-age=120",
    },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStringArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, max)
    : [];
}

// The storefront-render subset — everything the template homepage needs, and
// nothing sensitive.
function buildRender(report: Record<string, unknown>) {
  const venue = asRecord(report.venue);
  const vibe = asRecord(report.vibe_card);
  const match = asRecord(report.match);
  const photos = asStringArray(match.photo_urls, 4).filter((u) =>
    /^https?:\/\//i.test(u)
  );
  return {
    name: asString(venue.name).slice(0, 120) || "Your venue",
    city: asString(venue.city).slice(0, 80),
    tagline: asString(asRecord(report.rewritten_hero).after_copy).slice(0, 400),
    vibes: asStringArray(vibe.vibes, 3).map((s) => s.slice(0, 40)),
    occasions: asStringArray(vibe.occasions, 4).map((s) => s.slice(0, 60)),
    signature: asString(vibe.signature_mention).slice(0, 200),
    ai_read: asString(report.ai_read).slice(0, 300),
    photos,
  };
}

// ISSUE-1004 — the Event Turnout Predictor's "as a Mingla listing" render.
// Subset of the event report used by /event-preview to render a polished
// listing card. Nothing sensitive (no budget, no forecast internals).
function buildEventRender(report: Record<string, unknown>) {
  const event = asRecord(report.event);
  const lp = asRecord(report.listing_preview);
  return {
    kind: "event" as const,
    title: (asString(lp.title) || asString(event.title)).slice(0, 120) ||
      "Your event",
    tagline: asString(lp.tagline).slice(0, 200),
    city: asString(event.city).slice(0, 80),
    venue_name: asString(event.venue_name).slice(0, 120),
    category: asString(event.category).slice(0, 60),
    date: asString(event.date).slice(0, 10),
    start_time: asString(event.start_time).slice(0, 5),
    vibe_tags: asStringArray(lp.vibe_tags, 5).map((s) => s.slice(0, 30)),
    why_go: asStringArray(lp.why_go, 4).map((s) => s.slice(0, 160)),
    best_for: asStringArray(lp.best_for, 3).map((s) => s.slice(0, 40)),
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let runId: unknown;
  if (req.method === "GET") {
    runId = new URL(req.url).searchParams.get("run_id");
  } else if (req.method === "POST") {
    try {
      runId = (asRecord(await req.json())).run_id;
    } catch {
      return json({ error: "validation" }, 400);
    }
  } else {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!isUuid(runId)) return json({ error: "validation" }, 400);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: lead, error } = await supabase
      .from("tool_leads")
      .select("tool, status, report")
      .eq("id", runId as string)
      .maybeSingle();
    if (error) {
      console.error("[growth-tools-preview] lookup failed", error.message);
      return json({ error: "server" }, 500);
    }
    if (!lead) return json({ error: "not_found" }, 404);
    const report = (lead as { report: unknown }).report;
    if (report === null || typeof report !== "object") {
      return json({ error: "report_not_ready" }, 409);
    }
    const isEvent = (lead as { tool?: unknown }).tool === "events";
    const render = isEvent
      ? buildEventRender(report as Record<string, unknown>)
      : buildRender(report as Record<string, unknown>);
    return json({ render });
  } catch (err) {
    console.error(
      "[growth-tools-preview] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
