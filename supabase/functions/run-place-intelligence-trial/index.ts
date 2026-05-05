// ORCH-0712 — run-place-intelligence-trial edge function
//
// Action-based dispatch. Bundles place_pool data + Serper reviews + photo collage
// per place, sends to Claude Haiku 4.5 vision in TWO calls (Q1 open exploration +
// Q2 closed evaluation against existing 16 Mingla signals), persists output to
// place_intelligence_trial_runs.
//
// I-PHOTO-AESTHETIC-DATA-SOLE-OWNER: this function does NOT write photo_aesthetic_data.
// I-COLLAGE-SOLE-OWNER: this function is the SOLE writer of photo_collage_url + fingerprint.
// I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING: place_intelligence_trial_runs rows are research-only.
//
// Spec: Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md §4

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MINGLA_SIGNAL_IDS,
  computeCostUsd,
} from "../_shared/photoAestheticEnums.ts";
import {
  composeCollage,
  fingerprintPhotos,
  MAX_PHOTOS,
} from "../_shared/imageCollage.ts";

// ── Config ──────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_ID = "claude-haiku-4-5-20251001";
const MODEL_NAME_SHORT = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const SERPER_REVIEWS_URL = "https://google.serper.dev/reviews";
const COLLAGE_BUCKET = "place-collages";
// PROMPT_VERSION:
//  v1 — initial Q2 shape (strong_match + confidence_0_to_10 + inappropriate_for)
//  v2 — ORCH-0713 Phase 0.5: gap-filled inputs (price_range_cents + negative booleans),
//       single score_0_to_100 (continuous quality), inappropriate_for (hard veto only),
//       scoring rubric in system prompt.
//  v3 — ORCH-0713 cost reduction: Q1 removed (research-only, already harvested into
//       Mingla_Artifacts/signal-lab/PROPOSALS.md); Q2-only path; ~55% cost reduction.
//       Trial pipeline runs only structured evaluation. If Phase 2 needs open
//       exploration, re-add Q1 as a separate one-shot fn rather than reintroducing
//       the dual-call pattern here. Collage TARGET_SIZE shrunk 1024→768 in
//       _shared/imageCollage.ts (companion change).
const PROMPT_VERSION = "v3";
const COST_GUARD_USD = 5.0;

// Anthropic rate-limit throttle (per Phase 1 pattern + bigger payloads)
const PER_PLACE_THROTTLE_MS = 9_000;
// PER_QUESTION_THROTTLE_MS removed at v3 — Q1 dropped; only one Anthropic call per place now.
const REVIEWS_FETCH_THROTTLE_MS = 200;   // gentle Serper throttle

// Reviews fetch
const REVIEWS_PAGES_MAX = 5;             // ~100 reviews
const REVIEWS_FRESHNESS_DAYS = 30;
const TOP_REVIEWS_FOR_PROMPT = 30;       // top-N most-recent with text fed to Claude

// Retry config (mirrors score-place-photo-aesthetics)
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 12_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Anthropic call helper with retry ───────────────────────────────────────

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

async function callAnthropicWithRetry(
  apiKey: string,
  reqBody: Record<string, unknown>,
): Promise<{ payload: any; usage: AnthropicUsage }> {
  let lastErrText = "";
  let res: Response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(reqBody),
    });

    if (res.ok) break;

    const status = res.status;
    lastErrText = await res.text();
    const isRetryable = status === 429 || (status >= 500 && status < 600);
    if (!isRetryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Anthropic ${status}: ${lastErrText.slice(0, 500)}`);
    }
    const retryAfter = res.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Math.min(60_000, Math.max(1_000, Number(retryAfter) * 1000)) : 0;
    const backoffMs = retryAfterMs || (BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
    console.log(`[place-intel-trial] Anthropic ${status} attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  if (!res!.ok) throw new Error(`Anthropic exhausted retries: ${lastErrText.slice(0, 500)}`);

  const payload = await res!.json();
  const usage: AnthropicUsage = payload?.usage || { input_tokens: 0, output_tokens: 0 };
  return { payload, usage };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool schemas
// ═══════════════════════════════════════════════════════════════════════════

// ORCH-0713 v3 — Q1_TOOL removed.
// Q1 (`propose_signals_and_vibes`) was the open-exploration call that produced
// proposed new signals + free-form vibe tags + narrative observations. Used
// during v1/v2 to harvest taxonomy candidates. Output preserved in
// Mingla_Artifacts/signal-lab/PROPOSALS.md (~50 proposals across 32 places ×
// 2 runs). No need to re-run Q1 every trial. If Phase 2 signal expansion
// needs fresh open exploration, re-introduce Q1 as a separate one-shot edge
// function rather than back into this pipeline.

// ORCH-0713 Phase 0.5 — Q2 schema v2.
//   - score_0_to_100 (continuous quality, like a scorer would emit)
//   - inappropriate_for (HARD VETO — used ONLY when 100% sure place is structurally
//     wrong for this signal; sets score_0_to_100 to 0)
//   - reasoning (≤500 chars, evidence-grounded)
// Drop strong_match + confidence_0_to_10 — replaced by single continuous score.
const Q2_TOOL = {
  name: "evaluate_against_existing_signals",
  description: "Score this place against each of Mingla's 16 existing signals on a 0-100 quality scale, with inappropriate_for as a hard veto for structural wrongness.",
  input_schema: {
    type: "object",
    required: ["evaluations"],
    properties: {
      evaluations: {
        type: "array",
        items: {
          type: "object",
          required: ["signal_id", "score_0_to_100", "inappropriate_for", "reasoning"],
          properties: {
            signal_id: { type: "string", enum: MINGLA_SIGNAL_IDS },
            score_0_to_100: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description: "Continuous quality of fit on 0-100 scale per the scoring rubric in the system prompt. Set to 0 when inappropriate_for=true.",
            },
            inappropriate_for: {
              type: "boolean",
              description: "TRUE only when 100% sure place is STRUCTURALLY wrong for this signal (e.g., event-only-by-appointment florist for `flowers`; gym for any food signal). Use sparingly. When TRUE, score_0_to_100 must be 0.",
            },
            reasoning: { type: "string", description: "1-2 sentence rationale grounded in evidence (reviews, photos, place_pool fields). Max 500 chars." },
          },
        },
        description: "EXACTLY 16 evaluations, one per Mingla signal in the order provided.",
      },
    },
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// HTTP entry
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";

    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    if (!serperKey) return json({ error: "SERPER_API_KEY not configured" }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));

    if (!body.action) {
      return json({
        error: "Missing 'action'. Use action='preview_run' | 'fetch_reviews' | 'compose_collage' | 'start_run' | 'run_trial_for_place' | 'run_status' | 'cancel_trial'",
      }, 400);
    }

    // Auth gate (admin only)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Invalid token" }, 401);
    const { data: adminRow } = await supabaseAdmin
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();
    if (!adminRow) return json({ error: "Admin access required" }, 403);

    switch (body.action) {
      case "preview_run":
        return await handlePreviewRun(supabaseAdmin);
      case "fetch_reviews":
        return await handleFetchReviews(supabaseAdmin, body, serperKey);
      case "compose_collage":
        return await handleComposeCollage(supabaseAdmin, body);
      case "start_run":
        return await handleStartRun(supabaseAdmin, body, user.id);
      case "run_trial_for_place":
        return await handleRunTrialForPlace(supabaseAdmin, body, anthropicKey);
      case "run_status":
        return await handleRunStatus(supabaseAdmin, body);
      case "cancel_trial":
        return await handleCancelTrial(supabaseAdmin, body);
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error("[run-place-intelligence-trial] Unhandled error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// preview_run
// ═══════════════════════════════════════════════════════════════════════════

async function handlePreviewRun(db: SupabaseClient): Promise<Response> {
  const { data, error } = await db
    .from("signal_anchors")
    .select("id, signal_id, anchor_index, place_pool_id, committed_at")
    .not("committed_at", "is", null);
  if (error) return json({ error: error.message }, 500);

  const committed = data || [];
  const totalPlaces = committed.length;
  const expectedPlaces = MINGLA_SIGNAL_IDS.length * 2;
  // ~$0.045 per place (Q1 + Q2 combined); see spec §F10
  const estimatedCostUsd = +(totalPlaces * 0.045).toFixed(4);

  return json({
    totalPlaces,
    expectedPlaces,
    fullyCommitted: totalPlaces === expectedPlaces,
    estimatedCostUsd,
    costGuardUsd: COST_GUARD_USD,
    perSignal: aggregateBySignal(committed),
  });
}

function aggregateBySignal(rows: Array<{ signal_id: string; anchor_index: number }>) {
  const out: Record<string, { committed: number; missing: number[] }> = {};
  for (const sid of MINGLA_SIGNAL_IDS) {
    out[sid] = { committed: 0, missing: [1, 2] };
  }
  for (const r of rows) {
    if (!out[r.signal_id]) continue;
    out[r.signal_id].committed++;
    out[r.signal_id].missing = out[r.signal_id].missing.filter((i) => i !== r.anchor_index);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// fetch_reviews
// ═══════════════════════════════════════════════════════════════════════════

async function handleFetchReviews(
  db: SupabaseClient,
  body: Record<string, unknown>,
  serperKey: string,
): Promise<Response> {
  const placePoolId = body.place_pool_id as string;
  const forceRefresh = !!body.force_refresh;
  if (!placePoolId) return json({ error: "place_pool_id required" }, 400);

  // Idempotency check
  if (!forceRefresh) {
    const cutoff = new Date(Date.now() - REVIEWS_FRESHNESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await db
      .from("place_external_reviews")
      .select("id", { count: "exact", head: false })
      .eq("place_pool_id", placePoolId)
      .gte("fetched_at", cutoff)
      .limit(1);
    if (existing && existing.length > 0) {
      const { count } = await db
        .from("place_external_reviews")
        .select("id", { count: "exact", head: true })
        .eq("place_pool_id", placePoolId);
      return json({ skipped: true, reason: "fresh_within_30_days", count });
    }
  }

  // Get google_place_id
  const { data: pp, error: ppErr } = await db
    .from("place_pool")
    .select("google_place_id, name")
    .eq("id", placePoolId)
    .maybeSingle();
  if (ppErr) return json({ error: ppErr.message }, 500);
  if (!pp?.google_place_id) return json({ error: "place has no google_place_id" }, 400);

  // Page through Serper
  let nextPageToken: string | undefined;
  let totalCollected = 0;
  let lastErr: string | null = null;

  for (let page = 1; page <= REVIEWS_PAGES_MAX; page++) {
    const reqBody: Record<string, unknown> = {
      placeId: pp.google_place_id,
      sortBy: "newest",
      gl: "us",
      hl: "en",
    };
    if (nextPageToken) reqBody.nextPageToken = nextPageToken;

    let serperRes: Response;
    try {
      serperRes = await fetch(SERPER_REVIEWS_URL, {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error(`[place-intel-trial:fetch_reviews] page ${page} fetch error:`, lastErr);
      break;
    }

    if (!serperRes.ok) {
      const text = await serperRes.text();
      lastErr = `Serper ${serperRes.status}: ${text.slice(0, 300)}`;
      console.error(`[place-intel-trial:fetch_reviews] ${lastErr}`);
      break;
    }

    const data = await serperRes.json();
    const reviews: any[] = data.reviews || [];
    if (reviews.length > 0) {
      const rows = reviews.map((r) => ({
        place_pool_id: placePoolId,
        source: "serper",
        source_review_id: r.id || `${pp.google_place_id}-${page}-${Math.random()}`,
        review_text: r.snippet || null,
        rating: typeof r.rating === "number" ? r.rating : null,
        posted_at: r.isoDate || null,
        posted_label: r.date || null,
        author_name: r.user?.name || null,
        author_review_count: r.user?.reviews ?? null,
        author_photo_count: r.user?.photos ?? null,
        has_media: Array.isArray(r.media) && r.media.length > 0,
        media: r.media || [],
        raw: r,
      }));
      const { error: upsertErr } = await db
        .from("place_external_reviews")
        .upsert(rows, { onConflict: "place_pool_id,source,source_review_id" });
      if (upsertErr) {
        lastErr = `upsert failed: ${upsertErr.message}`;
        console.error(`[place-intel-trial:fetch_reviews] ${lastErr}`);
        break;
      }
      totalCollected += reviews.length;
    }

    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
    await new Promise((r) => setTimeout(r, REVIEWS_FETCH_THROTTLE_MS));
  }

  return json({
    placePoolId,
    placeName: pp.name,
    fetched: totalCollected,
    error: lastErr,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// compose_collage
// ═══════════════════════════════════════════════════════════════════════════

async function handleComposeCollage(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const placePoolId = body.place_pool_id as string;
  const force = !!body.force;
  if (!placePoolId) return json({ error: "place_pool_id required" }, 400);

  // Load place + reviewer photos
  const { data: pp, error: ppErr } = await db
    .from("place_pool")
    .select("id, stored_photo_urls, photo_collage_url, photo_collage_fingerprint")
    .eq("id", placePoolId)
    .maybeSingle();
  if (ppErr) return json({ error: ppErr.message }, 500);
  if (!pp) return json({ error: "place not found" }, 404);

  const marketingPhotos = (pp.stored_photo_urls || []).slice(0, 5);

  // Get reviewer media (top 11 by recency)
  const { data: reviewRows } = await db
    .from("place_external_reviews")
    .select("media, posted_at")
    .eq("place_pool_id", placePoolId)
    .eq("has_media", true)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(60);

  const reviewerPhotos: string[] = [];
  for (const row of (reviewRows || []) as Array<{ media: any[] }>) {
    for (const m of (row.media || [])) {
      if (m?.imageUrl && reviewerPhotos.length < (MAX_PHOTOS - marketingPhotos.length)) {
        reviewerPhotos.push(m.imageUrl);
      }
    }
    if (reviewerPhotos.length >= MAX_PHOTOS - marketingPhotos.length) break;
  }

  const allPhotos = [...marketingPhotos, ...reviewerPhotos];
  if (allPhotos.length === 0) {
    return json({ error: "no photos available for this place" }, 400);
  }

  const fingerprint = await fingerprintPhotos(allPhotos);

  // Idempotency: skip if cached fingerprint matches
  if (!force && pp.photo_collage_fingerprint === fingerprint && pp.photo_collage_url) {
    return json({
      placePoolId,
      cached: true,
      url: pp.photo_collage_url,
      fingerprint,
      photoCount: allPhotos.length,
    });
  }

  // Compose
  let result;
  try {
    result = await composeCollage(allPhotos);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "compose failed" }, 500);
  }

  // Upload to Storage
  const path = `${placePoolId}/${fingerprint.slice(0, 12)}.png`;
  const { error: uploadErr } = await db.storage
    .from(COLLAGE_BUCKET)
    .upload(path, result.pngBytes, {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadErr) return json({ error: `Storage upload failed: ${uploadErr.message}` }, 500);

  const { data: urlData } = db.storage.from(COLLAGE_BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  // Persist to place_pool (single-owner write)
  const { error: updateErr } = await db
    .from("place_pool")
    .update({
      photo_collage_url: publicUrl,
      photo_collage_fingerprint: fingerprint,
    })
    .eq("id", placePoolId);
  if (updateErr) return json({ error: `place_pool update failed: ${updateErr.message}` }, 500);

  return json({
    placePoolId,
    cached: false,
    url: publicUrl,
    fingerprint,
    photoCount: allPhotos.length,
    placedCount: result.placedCount,
    failedCount: result.failedCount,
    grid: result.grid,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// start_run — create run_id + pre-insert pending rows; returns immediately.
// Browser then loops calling run_trial_for_place per anchor.
//
// IMPORTANT: this replaces the old "run_trial" bulk handler. Bulk processing
// of 32 places in one edge function invocation hit the Supabase 150s wall-time
// limit. Per-place architecture mirrors PhotoScorerPage's batch loop pattern.
// ═══════════════════════════════════════════════════════════════════════════

async function handleStartRun(
  db: SupabaseClient,
  _body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const { data: anchors, error: anchErr } = await db
    .from("signal_anchors")
    .select("place_pool_id, signal_id, anchor_index")
    .not("committed_at", "is", null)
    .order("signal_id");
  if (anchErr) return json({ error: anchErr.message }, 500);
  if (!anchors || anchors.length === 0) {
    return json({ error: "no committed anchors — pick anchors first" }, 400);
  }

  // Cost guard (estimate only; actual usage tracked per-place)
  const estCost = anchors.length * 0.045;
  if (estCost > COST_GUARD_USD) {
    return json({
      error: `cost guard tripped: estimated $${estCost.toFixed(2)} > $${COST_GUARD_USD}`,
    }, 400);
  }

  const runId = crypto.randomUUID();
  console.log(`[place-intel-trial:start_run] creating run ${runId} for ${anchors.length} places (userId=${userId})`);

  const pendingRows = anchors.map((a) => ({
    run_id: runId,
    place_pool_id: a.place_pool_id,
    signal_id: a.signal_id,
    anchor_index: a.anchor_index,
    input_payload: {},
    status: "pending",
    prompt_version: PROMPT_VERSION,
    model: MODEL_NAME_SHORT,
  }));
  const { error: insertErr } = await db
    .from("place_intelligence_trial_runs")
    .insert(pendingRows);
  if (insertErr) return json({ error: insertErr.message }, 500);

  return json({
    runId,
    totalPlaces: anchors.length,
    estimatedCostUsd: +estCost.toFixed(4),
    anchors: anchors.map((a) => ({
      place_pool_id: a.place_pool_id,
      signal_id: a.signal_id,
      anchor_index: a.anchor_index,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// run_trial_for_place — Q1 + Q2 Claude calls for ONE place. Browser loops
// this per anchor with throttle between calls.
// ═══════════════════════════════════════════════════════════════════════════

async function handleRunTrialForPlace(
  db: SupabaseClient,
  body: Record<string, unknown>,
  anthropicKey: string,
): Promise<Response> {
  const runId = body.run_id as string;
  const placePoolId = body.place_pool_id as string;
  const signalId = body.signal_id as string;
  const anchorIndex = body.anchor_index as number;

  if (!runId || !placePoolId || !signalId || anchorIndex == null) {
    return json({ error: "run_id, place_pool_id, signal_id, anchor_index all required" }, 400);
  }

  try {
    const cost = await processOnePlace({
      db,
      anthropicKey,
      runId,
      anchor: { place_pool_id: placePoolId, signal_id: signalId, anchor_index: anchorIndex },
    });
    return json({
      ok: true,
      place_pool_id: placePoolId,
      cost_usd: +cost.toFixed(6),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[place-intel-trial:run_trial_for_place] ${placePoolId} failed:`, msg);
    await db
      .from("place_intelligence_trial_runs")
      .update({
        status: "failed",
        error_message: msg.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("place_pool_id", placePoolId);
    return json({ error: msg, place_pool_id: placePoolId }, 500);
  }
}

interface AnchorRow {
  place_pool_id: string;
  signal_id: string;
  anchor_index: number;
}

async function processOnePlace(args: {
  db: SupabaseClient;
  anthropicKey: string;
  runId: string;
  anchor: AnchorRow;
}): Promise<number> {
  const { db, anthropicKey, runId, anchor } = args;

  // Mark running
  await db
    .from("place_intelligence_trial_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("run_id", runId)
    .eq("place_pool_id", anchor.place_pool_id);

  // Load place
  const { data: pp, error: ppErr } = await db
    .from("place_pool")
    .select("*")
    .eq("id", anchor.place_pool_id)
    .single();
  if (ppErr || !pp) throw new Error(`place_pool fetch failed: ${ppErr?.message ?? "not found"}`);

  if (!pp.photo_collage_url) {
    throw new Error("prerequisites_missing: photo_collage_url is null — fetch_reviews + compose_collage must run before run_trial_for_place");
  }

  // Load reviews
  const { data: reviews } = await db
    .from("place_external_reviews")
    .select("review_text, rating, posted_at, posted_label, has_media, media")
    .eq("place_pool_id", anchor.place_pool_id)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(100);
  const reviewsList = reviews || [];

  // Build text bundle
  const reviewsWithText = reviewsList
    .filter((r) => r.review_text && r.review_text.trim().length > 0)
    .slice(0, TOP_REVIEWS_FOR_PROMPT);

  const captions: string[] = [];
  for (const r of reviewsList) {
    const media = (r as { media?: any[] }).media || [];
    for (const m of media) {
      if (m?.caption && typeof m.caption === "string") captions.push(m.caption.trim());
    }
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userTextBlock = buildUserTextBlock(pp, reviewsWithText, captions);

  const inputPayload = {
    place_id: pp.id,
    place_name: pp.name,
    primary_type: pp.primary_type,
    rating: pp.rating,
    review_count: pp.review_count,
    reviews_in_prompt_count: reviewsWithText.length,
    captions_in_prompt_count: captions.length,
    collage_url: pp.photo_collage_url,
    prompt_version: PROMPT_VERSION,
  };

  // ORCH-0713 v3 — Q2 only. Q1 removed (research-only, harvested into signal-lab/PROPOSALS.md).
  const { aggregate: q2, totalCostUsd: q2Cost } = await callQuestion({
    apiKey: anthropicKey,
    systemPrompt,
    userTextBlock,
    collageUrl: pp.photo_collage_url,
    tool: Q2_TOOL,
    cacheSystem: true,
  });

  // Persist. q1_response is nullable (verified) → write null on v3 runs.
  await db
    .from("place_intelligence_trial_runs")
    .update({
      input_payload: inputPayload,
      collage_url: pp.photo_collage_url,
      reviews_count: reviewsWithText.length,
      q1_response: null,
      q2_response: q2,
      cost_usd: +q2Cost.toFixed(6),
      status: "completed",
      model: MODEL_NAME_SHORT,
      model_version: MODEL_ID,
      completed_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("place_pool_id", anchor.place_pool_id);

  return q2Cost;
}

async function callQuestion(args: {
  apiKey: string;
  systemPrompt: string;
  userTextBlock: string;
  collageUrl: string;
  tool: typeof Q2_TOOL;
  cacheSystem: boolean;
}): Promise<{ aggregate: any; totalCostUsd: number }> {
  const { apiKey, systemPrompt, userTextBlock, collageUrl, tool, cacheSystem } = args;

  const systemBlock = [
    cacheSystem
      ? { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
      : { type: "text", text: systemPrompt },
  ];

  const reqBody = {
    model: MODEL_ID,
    max_tokens: 2000,
    system: systemBlock,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: collageUrl } },
        { type: "text", text: userTextBlock },
      ],
    }],
    tool_choice: { type: "tool", name: tool.name },
    tools: [tool],
  };

  const { payload, usage } = await callAnthropicWithRetry(apiKey, reqBody);
  const toolUseBlock = (payload?.content || []).find(
    (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === tool.name,
  );
  if (!toolUseBlock) {
    throw new Error(`Claude returned no tool_use block for ${tool.name}`);
  }
  const aggregate = (toolUseBlock as { input: any }).input;

  const cost = computeCostUsd({
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
    useBatchApi: false,
  });

  return { aggregate, totalCostUsd: cost };
}

function buildSystemPrompt(): string {
  return [
    "You are Mingla's place intelligence analyst. You receive a single image (a photo collage of marketing + customer photos for one place), structured place metadata, and recent customer reviews. You answer ONE structured question per call about the place.",
    "",
    "# Mingla's 16 existing signal categories (signal IDs)",
    "fine_dining: upscale restaurants, occasion dining",
    "brunch: breakfast/brunch venues, daytime food",
    "casual_food: everyday restaurants, lunch/dinner",
    "drinks: bars, cocktail lounges, nightlife, coffee/cafes too",
    "romantic: intimate, candle-lit, date-night",
    "icebreakers: light & fun first-meet venues — cafes, dessert, casual day",
    "lively: high-energy, social, music, dancing",
    "movies: cinemas, drive-ins",
    "theatre: performing arts, concert halls, opera",
    "creative_arts: galleries, museums, art studios",
    "play: amusement, bowling, mini golf, arcades, escape rooms",
    "nature: parks, gardens, trails, outdoor scenic",
    "scenic: viewpoints, observation decks, photogenic outdoor",
    "picnic_friendly: parks/lawns suitable for picnics",
    "groceries: grocery stores, supermarkets",
    "flowers: florists, flower markets",
    "",
    "# Critical rules",
    "- Use ALL provided context: photos in the collage, place metadata booleans (BOTH true AND false lists), price range, full review text, reviewer photo captions, opening hours.",
    "- Be HONEST. If photos are weak, say so. If reviews suggest something photos hide, surface it. Negative booleans (in google_booleans_false) are real signal — `serves_wine: false` on a fine_dining candidate is a real downsignal.",
    "- Output EXACTLY 16 evaluations via the evaluate_against_existing_signals tool, one per signal in the order listed.",
    "- Reasoning fields: 1-2 sentences max, ≤500 chars.",
    "",
    "# Q2 SCORING RUBRIC (for score_0_to_100)",
    "Use the FULL 0-100 range. Do not bunch around the middle. Most places fall 20-70 for most signals; only the place's primary signal(s) hit 80-100.",
    "  90-100 = anchor-quality / world-class destination for this signal (would be a top-3 result in the city for this signal)",
    "  70-89  = strong fit; clearly serves the signal at a high quality bar",
    "  50-69  = ok / acceptable fit; place serves the signal but isn't a destination for it",
    "  30-49  = weak / borderline; place CAN serve the signal but rarely the right pick",
    "   1-29  = very weak; place tangentially fits but you would rarely recommend it for this signal",
    "      0  = reserved for inappropriate_for=true (see below)",
    "",
    "# Q2 INAPPROPRIATE_FOR RULES (hard veto — STRUCTURAL wrongness only)",
    "Set inappropriate_for=TRUE ONLY when 100% sure the place is STRUCTURALLY wrong for this signal. When inappropriate_for=true, score_0_to_100 MUST be 0.",
    "Examples of STRUCTURAL wrongness:",
    "  - Event-only-by-appointment florist (e.g., wedding/event design studio) for `flowers` — Mingla's `flowers` signal expects grab-and-go ready bouquets you can buy in 5 minutes; an event florist requiring weeks-ahead consultation is structurally wrong.",
    "  - Gym for any food signal (no food service)",
    "  - Closed-permanent business for any signal",
    "  - Hospital / medical clinic for `romantic`, `lively`, `play`, etc. (not a date venue)",
    "  - Funeral home for any signal",
    "DO NOT use inappropriate_for for 'low quality' or 'weak fit' — that's what low scores (1-49) are for.",
    "DO NOT use inappropriate_for for 'place is mostly a different category' — e.g., Harris Teeter / grocery store flower aisle scores 50-70 for `flowers` (legitimate sub-feature; ranks below dedicated florists), it is NOT inappropriate_for.",
    "DO NOT use inappropriate_for for 'place is not a destination for this signal' — that's a low score (1-29).",
    "When in doubt, prefer a low score over inappropriate_for.",
    "",
    "Examples to calibrate:",
    "  - Bayfront Floral & Event Design / `flowers` → inappropriate_for=true, score=0 (event-only; Mingla flowers signal is grab-and-go)",
    "  - Harris Teeter / `flowers` → inappropriate_for=false, score 55-70 (real grocery flower aisle)",
    "  - Mala Pata Molino + Cocina / `groceries` → inappropriate_for=false, score 1-15 (restaurant, not grocery — low fit but not structurally wrong)",
    "  - National Gallery / `creative_arts` → inappropriate_for=false, score 95-100 (anchor-quality)",
    "  - National Gallery / `casual_food` → inappropriate_for=false, score 1-15 (museum cafe might exist; not a food destination)",
    "  - Lekki Conservation Centre / `nature` → inappropriate_for=false, score 90-100",
    "  - Lekki Conservation Centre / `fine_dining` → inappropriate_for=false, score 1-10 (no fine_dining at the preserve)",
  ].join("\n");
}

function buildUserTextBlock(
  pp: any,
  reviewsWithText: any[],
  captions: string[],
): string {
  const lines: string[] = [];
  lines.push(`# Place metadata`);
  lines.push(`name: ${pp.name}`);
  lines.push(`primary_type: ${pp.primary_type ?? "unknown"}`);
  if (pp.types) lines.push(`types: ${(pp.types as string[]).join(", ")}`);
  if (pp.address) lines.push(`address: ${pp.address}`);
  if (pp.rating != null) lines.push(`rating: ${pp.rating}`);
  if (pp.review_count != null) lines.push(`review_count: ${pp.review_count}`);
  if (pp.price_level != null) lines.push(`price_level: ${pp.price_level}`);

  // ORCH-0713 Phase 0.5 — numeric price range (in cents). SQL signal scorer uses these
  // for `price_range_start_above_<X>` / `price_range_end_above_<X>` field-weight matchers
  // (notably fine_dining tier detection). Render in dollars for legibility.
  if (pp.price_range_start_cents != null && pp.price_range_end_cents != null) {
    const startUsd = (pp.price_range_start_cents / 100).toFixed(0);
    const endUsd = (pp.price_range_end_cents / 100).toFixed(0);
    const currency = pp.price_range_currency || "USD";
    lines.push(`price_range: $${startUsd}-$${endUsd} ${currency}`);
  } else if (pp.price_range_start_cents != null) {
    lines.push(`price_range_start: $${(pp.price_range_start_cents / 100).toFixed(0)}`);
  } else if (pp.price_range_end_cents != null) {
    lines.push(`price_range_end: $${(pp.price_range_end_cents / 100).toFixed(0)}`);
  }

  if (pp.editorial_summary) lines.push(`editorial_summary: ${pp.editorial_summary}`);
  if (pp.generative_summary) lines.push(`generative_summary: ${pp.generative_summary}`);

  // ORCH-0713 Phase 0.5 — Google booleans, BOTH true AND false lists.
  // Why split: SQL signal scorer treats null = no contribution (correct), but only
  // applies field weights when value === true. v1 trial pipeline showed Claude only
  // the true list, so Claude couldn't distinguish "explicitly false" from "unknown".
  // Negative booleans are real signal (e.g., `serves_wine: false` is a real downsignal
  // for fine_dining candidates).
  const allBooleanFields = [
    "serves_brunch","serves_lunch","serves_dinner","serves_breakfast","serves_beer",
    "serves_wine","serves_cocktails","serves_coffee","serves_dessert","serves_vegetarian_food",
    "outdoor_seating","live_music","good_for_groups","good_for_children","good_for_watching_sports",
    "allows_dogs","has_restroom","reservable","menu_for_children","dine_in","takeout","delivery","curbside_pickup",
  ];
  const truthy: string[] = [];
  const falsy: string[] = [];
  for (const k of allBooleanFields) {
    if (pp[k] === true) truthy.push(k);
    else if (pp[k] === false) falsy.push(k);
    // null = unknown, omitted from both lists
  }
  if (truthy.length > 0) lines.push(`google_booleans_true: ${truthy.join(", ")}`);
  if (falsy.length > 0) lines.push(`google_booleans_false: ${falsy.join(", ")}`);

  if (pp.opening_hours) {
    const oh = pp.opening_hours;
    const weekdayText = oh?.weekdayDescriptions || oh?.weekday_text;
    if (weekdayText && Array.isArray(weekdayText)) {
      lines.push(`opening_hours:`);
      for (const t of weekdayText) lines.push(`  ${t}`);
    }
  }

  lines.push(``);
  lines.push(`# ${reviewsWithText.length} most-recent customer reviews (full text)`);
  for (const r of reviewsWithText) {
    const star = r.rating ? `${r.rating}★ ` : "";
    const date = r.posted_label || r.posted_at || "";
    lines.push(`[${star}${date}] ${r.review_text.slice(0, 1500)}`);
  }

  if (captions.length > 0) {
    lines.push(``);
    lines.push(`# Reviewer photo captions (${captions.length})`);
    for (const c of captions.slice(0, 50)) lines.push(`- ${c.slice(0, 200)}`);
  }

  lines.push(``);
  lines.push(`The image above is a ${reviewsWithText.length}-review-supplemented photo grid combining marketing photos and customer-uploaded reviewer photos.`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// run_status / cancel_trial
// ═══════════════════════════════════════════════════════════════════════════

async function handleRunStatus(db: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const runId = body.run_id as string;
  if (!runId) return json({ error: "run_id required" }, 400);
  const { data, error } = await db
    .from("place_intelligence_trial_runs")
    .select("place_pool_id, signal_id, anchor_index, status, cost_usd, error_message, started_at, completed_at, reviews_count")
    .eq("run_id", runId)
    .order("signal_id");
  if (error) return json({ error: error.message }, 500);
  const rows = data || [];
  return json({
    runId,
    totalPlaces: rows.length,
    statusCounts: {
      pending: rows.filter((r) => r.status === "pending").length,
      running: rows.filter((r) => r.status === "running").length,
      completed: rows.filter((r) => r.status === "completed").length,
      failed: rows.filter((r) => r.status === "failed").length,
      cancelled: rows.filter((r) => r.status === "cancelled").length,
    },
    totalCostUsd: rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0),
    rows,
  });
}

async function handleCancelTrial(db: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const runId = body.run_id as string;
  if (!runId) return json({ error: "run_id required" }, 400);
  const { error } = await db
    .from("place_intelligence_trial_runs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("run_id", runId)
    .in("status", ["pending", "running"]);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
