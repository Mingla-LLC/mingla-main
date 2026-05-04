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
const PROMPT_VERSION = "v1";
const COST_GUARD_USD = 5.0;

// Anthropic rate-limit throttle (per Phase 1 pattern + bigger payloads)
const PER_PLACE_THROTTLE_MS = 9_000;
const PER_QUESTION_THROTTLE_MS = 30_000; // Q1 -> Q2 inside same place
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

const Q1_TOOL = {
  name: "propose_signals_and_vibes",
  description: "Propose vibe tags + new/refined Mingla signals based on what the data shows about this place.",
  input_schema: {
    type: "object",
    required: ["proposed_vibes", "proposed_signals", "notable_observations"],
    properties: {
      proposed_vibes: {
        type: "array",
        items: { type: "string" },
        description: "Short tags describing this place's vibe (1-5 most descriptive). Free-form vocabulary.",
      },
      proposed_signals: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "definition", "rationale", "overlaps_existing"],
          properties: {
            name: { type: "string", description: "snake_case proposed signal id" },
            definition: { type: "string", description: "1-sentence what this signal captures" },
            rationale: { type: "string", description: "Why this place's data demands this signal beyond Mingla's existing 16" },
            overlaps_existing: {
              type: "array",
              items: { type: "string" },
              description: "Existing signals this proposal overlaps (use 0-3 from the 16 listed)",
            },
          },
        },
        description: "Up to 10 NEW signals that the data demands beyond the existing 16. Empty array if existing 16 cover this place fully.",
      },
      notable_observations: {
        type: "string",
        description: "1-3 sentence narrative observations about what's notable here that operator should know.",
      },
    },
  },
} as const;

const Q2_TOOL = {
  name: "evaluate_against_existing_signals",
  description: "Evaluate this place against each of Mingla's 16 existing signals.",
  input_schema: {
    type: "object",
    required: ["evaluations"],
    properties: {
      evaluations: {
        type: "array",
        items: {
          type: "object",
          required: ["signal_id", "strong_match", "confidence_0_to_10", "reasoning", "inappropriate_for"],
          properties: {
            signal_id: { type: "string", enum: MINGLA_SIGNAL_IDS },
            strong_match: { type: "boolean" },
            confidence_0_to_10: { type: "number", minimum: 0, maximum: 10 },
            reasoning: { type: "string", description: "1-2 sentence rationale, max 500 chars" },
            inappropriate_for: { type: "boolean", description: "True if this place would be a poor recommendation for this signal" },
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
        error: "Missing 'action'. Use action='preview_run' | 'fetch_reviews' | 'compose_collage' | 'prepare_all' | 'run_trial' | 'run_status' | 'cancel_trial'",
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
      case "prepare_all":
        return await handlePrepareAll(supabaseAdmin, body, serperKey);
      case "run_trial":
        return await handleRunTrial(supabaseAdmin, body, anthropicKey, user.id);
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
// prepare_all — fetch_reviews + compose_collage for every committed anchor
// ═══════════════════════════════════════════════════════════════════════════

async function handlePrepareAll(
  db: SupabaseClient,
  body: Record<string, unknown>,
  serperKey: string,
): Promise<Response> {
  const force = !!body.force_refresh;
  const { data: anchors, error: anchErr } = await db
    .from("signal_anchors")
    .select("place_pool_id, signal_id")
    .not("committed_at", "is", null);
  if (anchErr) return json({ error: anchErr.message }, 500);

  const places = (anchors || []).map((a) => ({ place_pool_id: a.place_pool_id, signal_id: a.signal_id }));
  if (places.length === 0) return json({ status: "nothing_to_do", reason: "No committed anchors yet." });

  const results: Array<Record<string, unknown>> = [];
  for (const p of places) {
    // Reviews
    const reviewsRes = await handleFetchReviews(db, { place_pool_id: p.place_pool_id, force_refresh: force }, serperKey);
    const reviewsBody = await reviewsRes.json();
    // Collage
    const collageRes = await handleComposeCollage(db, { place_pool_id: p.place_pool_id, force });
    const collageBody = await collageRes.json();
    results.push({
      place_pool_id: p.place_pool_id,
      signal_id: p.signal_id,
      reviews: reviewsBody,
      collage: collageBody,
    });
  }

  return json({
    totalPlaces: places.length,
    results,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// run_trial — Q1 + Q2 Claude calls per place
// ═══════════════════════════════════════════════════════════════════════════

async function handleRunTrial(
  db: SupabaseClient,
  body: Record<string, unknown>,
  anthropicKey: string,
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

  // Cost guard
  const estCost = anchors.length * 0.045;
  if (estCost > COST_GUARD_USD) {
    return json({
      error: `cost guard tripped: estimated $${estCost.toFixed(2)} > $${COST_GUARD_USD}`,
    }, 400);
  }

  const runId = crypto.randomUUID();
  console.log(`[place-intel-trial:run_trial] starting run ${runId} for ${anchors.length} places`);

  // Pre-create pending rows so the UI sees them
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

  // Process each place sequentially (rate-limit safety)
  let placeIdx = 0;
  let succeeded = 0;
  let failed = 0;
  let totalCost = 0;

  for (const a of anchors) {
    if (placeIdx > 0) {
      await new Promise((r) => setTimeout(r, PER_PLACE_THROTTLE_MS));
    }
    placeIdx++;

    try {
      const cost = await processOnePlace({
        db,
        anthropicKey,
        runId,
        anchor: a,
        userId,
      });
      totalCost += cost;
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[place-intel-trial:run_trial] place ${a.place_pool_id} failed:`, msg);
      await db
        .from("place_intelligence_trial_runs")
        .update({
          status: "failed",
          error_message: msg.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("run_id", runId)
        .eq("place_pool_id", a.place_pool_id);
      failed++;
    }
  }

  return json({
    runId,
    totalPlaces: anchors.length,
    succeeded,
    failed,
    totalCostUsd: +totalCost.toFixed(6),
  });
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
  userId: string;
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
    throw new Error("prerequisites_missing: photo_collage_url is null — call prepare_all first");
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

  // Q1 call
  const { aggregate: q1, totalCostUsd: q1Cost } = await callQuestion({
    apiKey: anthropicKey,
    systemPrompt,
    userTextBlock,
    collageUrl: pp.photo_collage_url,
    tool: Q1_TOOL,
    cacheSystem: true,
  });

  // Throttle between Q1 and Q2
  await new Promise((r) => setTimeout(r, PER_QUESTION_THROTTLE_MS));

  // Q2 call (system prompt cached → cheap)
  const { aggregate: q2, totalCostUsd: q2Cost } = await callQuestion({
    apiKey: anthropicKey,
    systemPrompt,
    userTextBlock,
    collageUrl: pp.photo_collage_url,
    tool: Q2_TOOL,
    cacheSystem: true,
  });

  const totalCost = q1Cost + q2Cost;

  // Persist
  await db
    .from("place_intelligence_trial_runs")
    .update({
      input_payload: inputPayload,
      collage_url: pp.photo_collage_url,
      reviews_count: reviewsWithText.length,
      q1_response: q1,
      q2_response: q2,
      cost_usd: +totalCost.toFixed(6),
      status: "completed",
      model: MODEL_NAME_SHORT,
      model_version: MODEL_ID,
      completed_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("place_pool_id", anchor.place_pool_id);

  return totalCost;
}

async function callQuestion(args: {
  apiKey: string;
  systemPrompt: string;
  userTextBlock: string;
  collageUrl: string;
  tool: typeof Q1_TOOL | typeof Q2_TOOL;
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
    "- Use ALL provided context: photos in the collage, place metadata booleans, full review text, reviewer photo captions",
    "- Be HONEST. If photos are weak, say so. If reviews suggest something photos hide, surface it.",
    "- For Q1 (propose_signals_and_vibes): vibes are 1-5 most descriptive. Proposed signals: only if the data DEMANDS something the existing 16 don't cover. Empty array is fine if the 16 cover this place.",
    "- For Q2 (evaluate_against_existing_signals): EXACTLY 16 evaluations, one per signal in the order listed. confidence_0_to_10 is your honest confidence in the strong_match verdict.",
    "- Reasoning fields: 1-2 sentences max, ≤500 chars.",
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
  if (pp.editorial_summary) lines.push(`editorial_summary: ${pp.editorial_summary}`);
  if (pp.generative_summary) lines.push(`generative_summary: ${pp.generative_summary}`);

  // Booleans (compact)
  const bools: string[] = [];
  for (const k of [
    "serves_brunch","serves_lunch","serves_dinner","serves_breakfast","serves_beer",
    "serves_wine","serves_cocktails","serves_coffee","serves_dessert","serves_vegetarian_food",
    "outdoor_seating","live_music","good_for_groups","good_for_children","good_for_watching_sports",
    "allows_dogs","has_restroom","reservable","menu_for_children","dine_in","takeout","delivery","curbside_pickup",
  ]) {
    if (pp[k] === true) bools.push(k);
  }
  if (bools.length > 0) lines.push(`google_booleans_true: ${bools.join(", ")}`);

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
