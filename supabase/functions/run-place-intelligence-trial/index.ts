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
  // ORCH-0733 — computeCostUsd dropped from active import; only referenced
  // in commented-historical Anthropic helper. Re-add if Anthropic is ever
  // re-enabled (would also need DEC entry).
  computeCostUsdGemini,
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

// ORCH-0733 — Anthropic Claude Haiku 4.5 dropped from active trial pipeline per
// DEC-101. Constants preserved as commented historical reference for `git
// revert`-cheap reversal if HYBRID architecture is ever revisited. DO NOT
// re-enable without a DEC entry. Live evidence: comparison run fe15cb99
// vs Anthropic baseline 942fbddf — Gemini 2.5 Flash matched quality at
// −71% cost; HYBRID rejected, Gemini-only locked.
/*
const MODEL_ID = "claude-haiku-4-5-20251001";
const MODEL_NAME_SHORT = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
type Provider = "anthropic" | "gemini";
*/

// ORCH-0713 Gemini A/B (2026-05-05) — became sole provider per ORCH-0733.
const GEMINI_MODEL_ID = "gemini-2.5-flash";
const GEMINI_MODEL_NAME_SHORT = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;
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
//  v4 — ORCH-0733: tighter VETO discipline + contradictory-evidence weighting
//       guidance to correct Gemini drifts surfaced in run fe15cb99 vs Anthropic
//       v3 baseline 942fbddf. (1) Adds explicit anti-VETO examples (Mala Pata
//       not-a-theatre is score=1-5, NOT VETO; rubric says "structural
//       wrongness only"). (2) Adds contradictory-evidence section: places like
//       Anthony's Runway 84 are romantic anchors despite "loud" reviews; score
//       the place's POSITIONING + AMBIANCE, not review-mood swings. Operator-
//       anchored fact: Anthony's IS a nice romantic dinner spot. Also: this
//       version coincides with Anthropic provider being dropped from the trial
//       pipeline; Gemini 2.5 Flash is now the sole provider per DEC-101.
const PROMPT_VERSION = "v4";
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

// ─── Anthropic call helper with retry — DEPRECATED (ORCH-0733) ──────────────
// Preserved as commented historical reference for `git revert`-cheap reversal.
// Anthropic dropped from trial pipeline per DEC-101 after Gemini A/B comparison.
// DO NOT re-enable without a DEC entry. Constants (MODEL_ID, ANTHROPIC_VERSION,
// ANTHROPIC_MESSAGES_URL) are also commented above.
/*
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
*/

// ─── Gemini call helper with retry (ORCH-0713 A/B comparison) ───────────────

interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
}

async function callGeminiWithRetry(
  apiKey: string,
  reqBody: Record<string, unknown>,
): Promise<{ payload: any; usage: GeminiUsage }> {
  let lastErrText = "";
  let res: Response;
  // Gemini uses ?key=<API_KEY> query param auth (also supports x-goog-api-key header).
  const url = `${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    if (res.ok) break;

    const status = res.status;
    lastErrText = await res.text();
    const isRetryable = status === 429 || (status >= 500 && status < 600);
    if (!isRetryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Gemini ${status}: ${lastErrText.slice(0, 500)}`);
    }
    const retryAfter = res.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Math.min(60_000, Math.max(1_000, Number(retryAfter) * 1000)) : 0;
    const backoffMs = retryAfterMs || (BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
    console.log(`[place-intel-trial] Gemini ${status} attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  if (!res!.ok) throw new Error(`Gemini exhausted retries: ${lastErrText.slice(0, 500)}`);

  const payload = await res!.json();
  const usage: GeminiUsage = payload?.usageMetadata
    ? {
        promptTokenCount: payload.usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: payload.usageMetadata.candidatesTokenCount || 0,
      }
    : { promptTokenCount: 0, candidatesTokenCount: 0 };
  return { payload, usage };
}

// Fetch a public URL and return base64-encoded bytes for Gemini inline_data.
async function fetchAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Collage fetch failed ${res.status}: ${url.slice(0, 80)}`);
  const contentType = res.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await res.arrayBuffer());
  // Encode to base64 (Deno-native — chunk to avoid stack overflow on large arrays)
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return { base64, mimeType: contentType };
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
    // ORCH-0733 — Anthropic dropped from trial pipeline; Gemini 2.5 Flash is sole provider per DEC-101.
    // ANTHROPIC_API_KEY env var no longer required (helpers preserved as commented historical reference).
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    const serperKey = Deno.env.get("SERPER_API_KEY") ?? "";

    if (!geminiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);
    if (!serperKey) return json({ error: "SERPER_API_KEY not configured" }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));

    if (!body.action) {
      return json({
        error: "Missing 'action'. Use action='preview_run' | 'fetch_reviews' | 'compose_collage' | 'start_run' | 'run_trial_for_place' | 'run_status' | 'cancel_trial' | 'process_chunk' | 'list_active_runs'",
      }, 400);
    }

    // ORCH-0737: process_chunk is service-role-only (called by pg_cron via pg_net).
    // Skip user-auth gate; rely on service-role bearer match instead.
    if (body.action === "process_chunk") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return json({ error: "Missing authorization" }, 401);
      }
      const token = authHeader.replace("Bearer ", "");
      if (token !== supabaseServiceKey) {
        return json({ error: "process_chunk requires service-role auth" }, 403);
      }
      return await handleProcessChunk(supabaseAdmin, body, geminiKey, serperKey);
    }

    // Auth gate (admin only) for all other actions
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
        return await handlePreviewRun(supabaseAdmin, body);
      case "fetch_reviews":
        return await handleFetchReviews(supabaseAdmin, body, serperKey);
      case "compose_collage":
        return await handleComposeCollage(supabaseAdmin, body);
      case "start_run":
        return await handleStartRun(supabaseAdmin, body, adminRow.id, supabaseServiceKey);
      case "run_trial_for_place":
        return await handleRunTrialForPlace(supabaseAdmin, body, geminiKey);
      case "run_status":
        return await handleRunStatus(supabaseAdmin, body);
      case "cancel_trial":
        return await handleCancelTrial(supabaseAdmin, body, adminRow.id);
      case "list_active_runs":
        return await handleListActiveRuns(supabaseAdmin);
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error("[run-place-intelligence-trial] Unhandled error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// preview_run — ORCH-0734 city-scoped sampled-sync
// ═══════════════════════════════════════════════════════════════════════════

const PER_PLACE_COST_USD = 0.0040; // ORCH-0734 — measured on run e15f5d8f (32 anchors → $0.1292)
const SAMPLE_SIZE_DEFAULT = 200;
const SAMPLE_SIZE_MIN = 50;
const SAMPLE_SIZE_MAX = 500;

async function handlePreviewRun(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const cityId = body.city_id;
  if (!cityId || typeof cityId !== "string") {
    return json({ error: "city_id required (uuid)" }, 400);
  }

  const sampleSizeRaw = body.sample_size ?? SAMPLE_SIZE_DEFAULT;
  const sampleSize = typeof sampleSizeRaw === "number" && Number.isInteger(sampleSizeRaw)
    ? sampleSizeRaw
    : NaN;
  if (!Number.isInteger(sampleSize) || sampleSize < SAMPLE_SIZE_MIN || sampleSize > SAMPLE_SIZE_MAX) {
    return json({
      error: `sample_size must be integer ${SAMPLE_SIZE_MIN}-${SAMPLE_SIZE_MAX} (default ${SAMPLE_SIZE_DEFAULT})`,
    }, 400);
  }

  const { data: city, error: cityErr } = await db
    .from("seeding_cities")
    .select("id, name, country")
    .eq("id", cityId)
    .maybeSingle();
  if (cityErr) return json({ error: cityErr.message }, 500);
  if (!city) return json({ error: "city_id does not exist in seeding_cities" }, 400);

  const { count, error: countErr } = await db
    .from("place_pool")
    .select("id", { count: "exact", head: true })
    .eq("is_servable", true)
    .eq("city_id", cityId);
  if (countErr) return json({ error: countErr.message }, 500);
  const totalServable = count ?? 0;

  if (totalServable === 0) {
    return json({ error: "No servable places in city" }, 400);
  }

  const effectiveSampleSize = Math.min(sampleSize, totalServable);
  const estimatedCostUsd = +(effectiveSampleSize * PER_PLACE_COST_USD).toFixed(4);

  if (estimatedCostUsd > COST_GUARD_USD) {
    return json({
      error: `cost guard tripped: estimated $${estimatedCostUsd.toFixed(2)} > $${COST_GUARD_USD}`,
    }, 400);
  }

  return json({
    cityId: city.id,
    cityName: city.name,
    cityCountry: city.country,
    totalServable,
    effectiveSampleSize,
    estimatedCostUsd,
    costGuardUsd: COST_GUARD_USD,
  });
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
  body: Record<string, unknown>,
  adminId: string,
  serviceKey: string,
): Promise<Response> {
  // ORCH-0734 — city-scoped sampled-sync. Operator picks city + sample size;
  // edge fn loads servable places via stratified random sample (top half by
  // review_count + random fill of bottom half), pre-inserts pending rows.
  // Per DEC-102: Gemini 2.5 Flash sole provider. No provider param.
  //
  // ORCH-0737 — added mode='sample'|'full_city' field. full_city mode skips
  // stratified sampling (takes all servable rows), inserts parent row in
  // place_intelligence_runs, kicks first chunk via pg_net for immediate start
  // (don't wait for next pg_cron tick), and runs durably server-side.

  const cityId = body.city_id;
  if (!cityId || typeof cityId !== "string") {
    return json({ error: "city_id required (uuid)" }, 400);
  }

  // ORCH-0737: mode field; default to 'sample' for backward compat
  const mode = (body.mode as string) ?? "sample";
  if (mode !== "sample" && mode !== "full_city") {
    return json({ error: "mode must be 'sample' or 'full_city'" }, 400);
  }

  // sample_size only required for sample mode; full_city ignores it
  let sampleSize: number | null = null;
  if (mode === "sample") {
    const sampleSizeRaw = body.sample_size ?? SAMPLE_SIZE_DEFAULT;
    sampleSize = typeof sampleSizeRaw === "number" && Number.isInteger(sampleSizeRaw)
      ? sampleSizeRaw
      : NaN;
    if (!Number.isInteger(sampleSize) || sampleSize < SAMPLE_SIZE_MIN || sampleSize > SAMPLE_SIZE_MAX) {
      return json({
        error: `sample_size must be integer ${SAMPLE_SIZE_MIN}-${SAMPLE_SIZE_MAX} (default ${SAMPLE_SIZE_DEFAULT})`,
      }, 400);
    }
  }

  // Validate city exists
  const { data: city, error: cityErr } = await db
    .from("seeding_cities")
    .select("id, name, country")
    .eq("id", cityId)
    .maybeSingle();
  if (cityErr) return json({ error: cityErr.message }, 500);
  if (!city) return json({ error: "city_id does not exist in seeding_cities" }, 400);

  // Load all servable place IDs for the city, ranked by review_count desc
  const { data: pool, error: poolErr } = await db
    .from("place_pool")
    .select("id, review_count")
    .eq("is_servable", true)
    .eq("city_id", cityId)
    .order("review_count", { ascending: false, nullsFirst: false });
  if (poolErr) return json({ error: poolErr.message }, 500);
  if (!pool || pool.length === 0) {
    return json({ error: "No servable places in city" }, 400);
  }

  const totalServable = pool.length;
  const effectiveCount = mode === "full_city"
    ? totalServable
    : Math.min(sampleSize as number, totalServable);

  // ORCH-0737: full_city mode takes ALL servable rows; sample mode uses stratified random.
  let sampledIds: string[];
  if (mode === "full_city") {
    sampledIds = pool.map((p) => p.id);
  } else {
    // Stratified random: top half by review_count + random fill of bottom half.
    const topHalfCount = Math.ceil(effectiveCount / 2);
    const bottomFillCount = effectiveCount - topHalfCount;
    const topHalfIds = pool.slice(0, topHalfCount).map((p) => p.id);
    const remaining = pool.slice(topHalfCount).map((p) => p.id);
    // Fisher-Yates shuffle for the random-fill portion
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    const bottomFillIds = remaining.slice(0, bottomFillCount);
    sampledIds = [...topHalfIds, ...bottomFillIds];
  }

  const estCost = +(effectiveCount * PER_PLACE_COST_USD).toFixed(4);

  // ORCH-0737: cost guard. Sample mode: hard reject above $5.
  // full_city mode: requires confirm_high_cost=true body field for cost > $5
  // (admin UI surfaces a double-confirm dialog before sending this).
  if (estCost > COST_GUARD_USD) {
    if (mode === "sample") {
      return json({
        error: `cost guard tripped: estimated $${estCost.toFixed(2)} > $${COST_GUARD_USD}`,
      }, 400);
    }
    if (mode === "full_city" && body.confirm_high_cost !== true) {
      return json({
        error: "cost_above_guard",
        estimated_cost_usd: estCost,
        cost_guard_usd: COST_GUARD_USD,
        message: `Full-city run exceeds $${COST_GUARD_USD} cost guard. Resubmit with confirm_high_cost=true to override.`,
      }, 400);
    }
  }

  const estMinutes = Math.ceil(effectiveCount * 30 / 60);                   // 30s per place wallclock estimate

  // ORCH-0737: insert parent row FIRST so child FK can reference it.
  // Unique partial index on (city_id) WHERE status IN ('pending','running','cancelling')
  // returns 23505 if a run is already active for this city.
  const runId = crypto.randomUUID();
  const { error: parentInsertErr } = await db
    .from("place_intelligence_runs")
    .insert({
      id: runId,
      city_id: cityId,
      city_name: city.name,
      mode,
      sample_size: mode === "sample" ? effectiveCount : null,
      total_count: effectiveCount,
      estimated_cost_usd: estCost,
      estimated_minutes: estMinutes,
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL_NAME_SHORT,
      started_by: adminId,
      status: "running",
      started_at: new Date().toISOString(),
    });

  if (parentInsertErr) {
    // 23505 unique violation = one already running for this city
    if (parentInsertErr.code === "23505") {
      return json({
        error: "concurrent_run",
        message: `A run is already in progress for ${city.name}. Cancel it first or wait for it to complete.`,
      }, 409);
    }
    return json({ error: `parent insert failed: ${parentInsertErr.message}` }, 500);
  }

  console.log(
    `[place-intel-trial:start_run] mode=${mode} city=${city.name} (${cityId}) ` +
    `count=${effectiveCount}/${totalServable} run=${runId} adminId=${adminId}`,
  );

  // Pre-insert pending child rows with parent_run_id set.
  const pendingRows = sampledIds.map((ppId) => ({
    run_id: runId,
    parent_run_id: runId,                                                   // ORCH-0737 NEW
    place_pool_id: ppId,
    city_id: cityId,
    signal_id: null,
    anchor_index: null,
    input_payload: {},
    status: "pending",
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
    retry_count: 0,
  }));
  const { error: insertErr } = await db
    .from("place_intelligence_trial_runs")
    .upsert(pendingRows, { onConflict: "run_id,place_pool_id" });
  if (insertErr) {
    // Roll back parent row to keep DB consistent
    await db.from("place_intelligence_runs")
      .update({ status: "failed", error_reason: `child insert failed: ${insertErr.message}`, completed_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ error: insertErr.message }, 500);
  }

  // ORCH-0737: full_city mode kicks the first chunk immediately via pg_net
  // (don't wait for next pg_cron tick which could be up to 60s away).
  // Sample mode skips this; browser drives the loop.
  if (mode === "full_city" && serviceKey) {
    try {
      const workerUrl = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/run-place-intelligence-trial`;
      // fire-and-forget; intentional. Worker writes status to DB.
      fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ action: "process_chunk", run_id: runId }),
      }).catch((err) => {
        console.error(`[start_run] first-chunk kick failed (cron will retry): ${err.message}`);
      });
    } catch (err) {
      // Non-fatal: pg_cron tick (within 60s) will pick up the run.
      console.error(`[start_run] first-chunk kick threw: ${err}`);
    }
  }

  return json({
    runId,
    cityId: city.id,
    cityName: city.name,
    cityCountry: city.country,
    mode,                                                                   // ORCH-0737 NEW
    totalServable,
    totalPlaces: effectiveCount,
    estimatedCostUsd: estCost,
    estimatedMinutes: estMinutes,                                           // ORCH-0737 NEW
    provider: "gemini",
    model: GEMINI_MODEL_NAME_SHORT,
    // Browser-loop compat: only return anchors for sample mode (since browser
    // still drives sample loop). Full-city mode returns empty array — browser
    // becomes status viewer via polling.
    anchors: mode === "sample"
      ? sampledIds.map((ppId) => ({ place_pool_id: ppId, signal_id: null }))
      : [],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// run_trial_for_place — Q1 + Q2 Claude calls for ONE place. Browser loops
// this per anchor with throttle between calls.
// ═══════════════════════════════════════════════════════════════════════════

async function handleRunTrialForPlace(
  db: SupabaseClient,
  body: Record<string, unknown>,
  geminiKey: string,
): Promise<Response> {
  // ORCH-0733 — Anthropic dropped; provider param removed. Gemini 2.5 Flash always.
  // ORCH-0734 — signal_id and anchor_index are now optional (null for city-runs;
  // legacy 32-anchor callers may still send them but they're not required).
  const runId = body.run_id as string;
  const placePoolId = body.place_pool_id as string;
  const signalId = (body.signal_id ?? null) as string | null;
  const anchorIndex = (body.anchor_index ?? null) as number | null;

  if (!geminiKey) {
    return json({ error: "GEMINI_API_KEY not configured (operator: `supabase secrets set GEMINI_API_KEY=...`)" }, 500);
  }
  if (!runId || !placePoolId) {
    return json({ error: "run_id, place_pool_id required" }, 400);
  }

  try {
    const cost = await processOnePlace({
      db,
      geminiKey,
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
  // ORCH-0734 — signal_id + anchor_index nullable (city-runs places have no anchor metadata).
  signal_id: string | null;
  anchor_index: number | null;
}

async function processOnePlace(args: {
  db: SupabaseClient;
  geminiKey: string;
  runId: string;
  anchor: AnchorRow;
}): Promise<number> {
  // ORCH-0733 — Anthropic dropped; Gemini 2.5 Flash sole provider.
  const { db, geminiKey, runId, anchor } = args;

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

  // ORCH-0733 — Q2 only via Gemini 2.5 Flash (sole provider).
  // Q1 removed in v3 (harvested research into signal-lab/PROPOSALS.md).
  // Anthropic dropped in v4 (commented-preserved helpers above for `git revert`).
  // ORCH-0734 — `retried` field surfaces when MALFORMED_FUNCTION_CALL forced retry.
  const { aggregate: q2, totalCostUsd: q2Cost, retried } = await callGeminiQuestion({
    apiKey: geminiKey,
    systemPrompt,
    userTextBlock,
    collageUrl: pp.photo_collage_url,
    tool: Q2_TOOL,
  });

  // Persist. q1_response is nullable (verified) → write null on v3+ runs.
  // ORCH-0734 — retry_count tracks Gemini MALFORMED_FUNCTION_CALL retries (0 or 1).
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
      model: GEMINI_MODEL_NAME_SHORT,
      model_version: GEMINI_MODEL_ID,
      retry_count: retried ? 1 : 0,
      completed_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("place_pool_id", anchor.place_pool_id);

  return q2Cost;
}

// ─── Anthropic Q2 wrapper — DEPRECATED (ORCH-0733) ──────────────────────────
// Preserved as commented historical reference for `git revert`-cheap reversal.
// Anthropic dropped from trial pipeline per DEC-101 after Gemini A/B comparison.
// DO NOT re-enable without a DEC entry. Helpers (callAnthropicWithRetry,
// AnthropicUsage) are also commented above.
/*
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
*/

// ─── Gemini equivalent of callQuestion (ORCH-0713 A/B comparison) ───────────
// Same inputs (system prompt, user text block, collage URL, Q2 tool schema).
// Translates to Gemini's request format:
//   - System prompt → systemInstruction
//   - User text block → contents[0].parts[].text
//   - Collage URL → fetched + base64-encoded → contents[0].parts[].inline_data
//     (Gemini does NOT fetch URLs; we must encode bytes locally)
//   - Q2 tool input_schema → tools[0].function_declarations[0].parameters
//     (Gemini accepts standard JSON Schema verbatim)
//   - tool_choice → toolConfig.functionCallingConfig with mode=ANY +
//     allowedFunctionNames
//
// Response parsing: candidates[0].content.parts[i].functionCall.{name, args}
// where args matches the tool's input_schema (same shape as Anthropic's
// tool_use.input).

// ORCH-0734 — retry-once on MALFORMED_FUNCTION_CALL. Gemini returns HTTP 200
// with a malformed payload ~3% of the time; bit-identical retry usually
// succeeds (live evidence: Harris Teeter / flowers failed in run e15f5d8f
// but same row succeeded in v3 run fe15cb99). HTTP-level retry is handled
// upstream in callGeminiWithRetry; this layer handles the structured-output
// flake specifically.
const MAX_MALFORMED_RETRIES = 1;

async function callGeminiQuestion(args: {
  apiKey: string;
  systemPrompt: string;
  userTextBlock: string;
  collageUrl: string;
  tool: typeof Q2_TOOL;
}): Promise<{ aggregate: any; totalCostUsd: number; retried: boolean }> {
  const { apiKey, systemPrompt, userTextBlock, collageUrl, tool } = args;

  // Fetch + base64-encode collage (Gemini inline_data requires bytes; URL fetch unsupported)
  const { base64, mimeType } = await fetchAsBase64(collageUrl);

  const reqBody = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: userTextBlock },
      ],
    }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{
      function_declarations: [{
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      }],
    }],
    toolConfig: {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [tool.name],
      },
    },
    generationConfig: {
      // ORCH-0732 — bumped 2000 → 8000. The Q2 tool emits 16 evaluations
      // × ~150 tokens reasoning each ≈ 2400 tokens needed. The previous
      // 2000 cap truncated the function call mid-response, surfaced as
      // finishReason=MALFORMED_FUNCTION_CALL on every place. Live evidence:
      // run 064c6133 (5/5 attempts failed identically). 8000 gives ~3x
      // headroom; Gemini 2.5 Flash supports up to 64K output tokens.
      maxOutputTokens: 8000,
      temperature: 0.3,
    },
  };

  // ORCH-0734 — retry-once loop on MALFORMED_FUNCTION_CALL. Cost accumulates
  // across both attempts (Gemini bills for failed completions). On retry
  // success, the cost field reflects combined tokens for honest reporting.
  let totalCost = 0;
  let lastFinishReason: string | null = null;
  let attempt = 0;

  while (attempt <= MAX_MALFORMED_RETRIES) {
    attempt++;
    const { payload, usage } = await callGeminiWithRetry(apiKey, reqBody);
    totalCost += computeCostUsdGemini({
      promptTokens: usage.promptTokenCount,
      candidatesTokens: usage.candidatesTokenCount,
    });

    const candidates = payload?.candidates || [];
    if (candidates.length === 0) {
      throw new Error("Gemini returned no candidates");
    }
    const finishReason = candidates[0]?.finishReason || "unknown";
    const parts = candidates[0]?.content?.parts || [];
    const fnCallPart = parts.find(
      (p: { functionCall?: { name?: string } }) => p.functionCall?.name === tool.name,
    );

    if (fnCallPart?.functionCall?.args) {
      // Success — return aggregate. retried=true if we needed >1 attempt.
      return {
        aggregate: fnCallPart.functionCall.args,
        totalCostUsd: totalCost,
        retried: attempt > 1,
      };
    }

    lastFinishReason = finishReason;
    // Only retry on MALFORMED_FUNCTION_CALL (the known intermittent flake).
    // Other finish reasons (SAFETY, RECITATION, MAX_TOKENS, etc.) are
    // not retry-friendly with the same prompt — fail fast.
    if (finishReason !== "MALFORMED_FUNCTION_CALL" || attempt > MAX_MALFORMED_RETRIES) {
      throw new Error(`Gemini returned no function_call for ${tool.name} (finishReason=${finishReason})`);
    }
    console.log(
      `[place-intel-trial] MALFORMED_FUNCTION_CALL retry attempt ${attempt + 1}/${MAX_MALFORMED_RETRIES + 1}`,
    );
    // Loop continues for retry with same reqBody.
  }

  throw new Error(`Gemini retry exhausted (finishReason=${lastFinishReason})`);
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
    "# CRITICAL — anti-VETO examples (ORCH-0733 — fixes Gemini over-VETO drift)",
    "The following cases MUST be LOW SCORES (1-15), NOT VETO. Restaurants that aren't a particular cuisine, indoor venues that aren't outdoor, casual venues that aren't upscale — ALL are LOW SCORES, not VETOs. VETO is reserved for STRUCTURAL business-model wrongness only.",
    "  - Mala Pata Molino + Cocina / `theatre` → score 1-5, NOT VETO (it's a restaurant, not a theatre — that's a fit gap, not structural wrongness)",
    "  - Mala Pata / `play` → score 1-5, NOT VETO (restaurant, not arcade)",
    "  - Mala Pata / `groceries` → score 1-15, NOT VETO (restaurant, not grocery store)",
    "  - Mala Pata / `picnic_friendly` → score 1-10, NOT VETO (no picnic lawn)",
    "  - Mala Pata / `nature` → score 1-5, NOT VETO (commercial complex location)",
    "  - Mala Pata / `flowers` → score 1-5, NOT VETO (no floral retail; tangential decor doesn't matter)",
    "  - Wang's Kitchen / `fine_dining` → score 1-15, NOT VETO (casual cheap restaurant; not fine dining is a fit gap, not structural wrongness)",
    "  - Big Ed's City Market / `nature` → score 1-10, NOT VETO (indoor restaurant)",
    "  - Taza Grill / `creative_arts` → score 1-10, NOT VETO (restaurant; tangential art doesn't matter)",
    "  - National Gallery / `nature` → score 1-10, NOT VETO (indoor museum on a square)",
    "",
    "# WEIGHING CONTRADICTORY EVIDENCE (ORCH-0733 — fixes Gemini negative-review over-weighting)",
    "When reviews contain BOTH positive ambiance markers AND negative caveats (noise, service inconsistency, crowding), DO NOT let one negative review theme collapse the score. The signal asks: 'is this place a destination for X?' Score the place's CORE IDENTITY + STRUCTURAL OFFERING + POSITIONING — not review-mood swings.",
    "",
    "Examples of correct contradictory-evidence weighting:",
    "  - Anthony's Runway 84 / `romantic` → score 70-80. Reviews say 'loud, chaotic supper club' AND 'candle-lit, occasion-dining, anniversary destination, fine plating, wine program.' The romantic signal is about INTENT + AMBIANCE + occasion-positioning, NOT silence. Anthony's IS a nice romantic dinner spot — operator-anchored fact.",
    "  - A 'lively' venue with 'sometimes inconsistent service' reviews still scores 80-95 for `lively` if the energy + crowd + music are present. Service caveats deduct ~5-10, NOT 30.",
    "  - A 'fine dining' venue with 'expensive but uneven service' reviews still scores 75-90 for `fine_dining` if tasting menu / sommelier / formal plating exist. Bad-service reviews deduct ~5-10, NOT collapse to weak-fit.",
    "  - Restaurants with mixed reviews about wait times still score 70-90 for `casual_food` if the food is well-reviewed.",
    "",
    "Negative caveats reduce the score by 5-15 points typically; they DO NOT drop a place from 'strong fit' (70-89) to 'weak' (30-49). Use the FULL rubric range and prioritize the place's core identity + structural offering over review-mood swings.",
    "",
    "Examples to calibrate (positive anchors + edge cases):",
    "  - Bayfront Floral & Event Design / `flowers` → inappropriate_for=true, score=0 (event-only; Mingla flowers signal is grab-and-go)",
    "  - Harris Teeter / `flowers` → inappropriate_for=false, score 55-70 (real grocery flower aisle)",
    "  - Mala Pata Molino + Cocina / `groceries` → inappropriate_for=false, score 1-15 (restaurant, not grocery — low fit but not structurally wrong)",
    "  - National Gallery / `creative_arts` → inappropriate_for=false, score 95-100 (anchor-quality)",
    "  - National Gallery / `casual_food` → inappropriate_for=false, score 1-15 (museum cafe might exist; not a food destination)",
    "  - Lekki Conservation Centre / `nature` → inappropriate_for=false, score 90-100",
    "  - Lekki Conservation Centre / `fine_dining` → inappropriate_for=false, score 1-10 (no fine_dining at the preserve)",
    "  - Anthony's Runway 84 / `romantic` → inappropriate_for=false, score 70-80 (operator-anchored romantic destination; review noise is a deduction, NOT a verdict)",
    "  - Calusso / `brunch` → inappropriate_for=true, score=0 (serves_brunch=false explicit + dinner-only hours = STRUCTURAL wrongness)",
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

  // ORCH-0737: include parent run-level state alongside per-place rows.
  // Pre-ORCH-0737 runs have no parent row → parent will be null; UI handles.
  const { data: parent } = await db
    .from("place_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  const { data, error } = await db
    .from("place_intelligence_trial_runs")
    .select("place_pool_id, signal_id, anchor_index, status, cost_usd, error_message, started_at, completed_at, reviews_count")
    .eq("run_id", runId)
    .order("signal_id");
  if (error) return json({ error: error.message }, 500);
  const rows = data || [];
  return json({
    runId,
    parent,                                                                 // ORCH-0737 NEW
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

async function handleCancelTrial(
  db: SupabaseClient,
  body: Record<string, unknown>,
  adminId: string,
): Promise<Response> {
  const runId = body.run_id as string;
  if (!runId) return json({ error: "run_id required" }, 400);

  // ORCH-0737: signal cancellation at run-level. Worker checks status at
  // chunk start and finalizes 'cancelled' within next chunk boundary (~30-90s).
  // Falls back to legacy direct-update if no parent row exists (pre-ORCH-0737 runs).
  const { data: run, error: parentErr } = await db
    .from("place_intelligence_runs")
    .update({ status: "cancelling", cancelled_by: adminId })
    .eq("id", runId)
    .eq("status", "running")
    .select()
    .maybeSingle();

  if (parentErr || !run) {
    // Legacy path: parent row may not exist (pre-ORCH-0737 run) OR run already
    // terminal. Cancel per-place rows directly (existing behavior).
    const { error } = await db
      .from("place_intelligence_trial_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("run_id", runId)
      .in("status", ["pending", "running"]);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, mode: "legacy" });
  }

  // Parent successfully marked cancelling. Worker will finalize at next chunk.
  return json({ ok: true, mode: "async", run_status: "cancelling" });
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCH-0737: list_active_runs — admin UI cross-session resume on mount
// ═══════════════════════════════════════════════════════════════════════════

async function handleListActiveRuns(db: SupabaseClient): Promise<Response> {
  const { data, error } = await db
    .from("place_intelligence_runs")
    .select("*")
    .in("status", ["pending", "running", "cancelling"])
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ runs: data || [] });
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCH-0737: process_chunk — async worker driven by pg_cron + pg_net
//
// Service-role auth only. Reads next 12 pending rows for a run, processes them
// in parallel via Promise.all, persists results, updates parent counters.
// pg_cron picks up next tick if more rows pending; otherwise marks complete.
//
// v2 PATCH (Gap 1 — row-level stale recovery): pickup query reclaims rows
// stuck in 'running' status with started_at < now() - 5 min. Self-healing
// against worker-death mid-chunk.
// ═══════════════════════════════════════════════════════════════════════════

async function handleProcessChunk(
  db: SupabaseClient,
  body: Record<string, unknown>,
  geminiKey: string,
  serperKey: string,
): Promise<Response> {
  const runId = body.run_id as string;
  if (!runId) return json({ error: "run_id required" }, 400);

  // Step 1: SELECT FOR UPDATE NOWAIT to get exclusive ownership of this chunk.
  // Concurrent worker call hits 23P01/55P03 → returns 'concurrent_worker'.
  const { data: run, error: lockErr } = await db.rpc("lock_run_for_chunk", { p_run_id: runId });
  if (lockErr) {
    if (lockErr.code === "55P03" || lockErr.code === "23P01") {
      return json({ skipped: true, reason: "concurrent_worker" });
    }
    return json({ error: `lock failed: ${lockErr.message}` }, 500);
  }
  if (!run) return json({ error: "run not found" }, 404);

  // Step 2: Check status; bail on cancellation
  if (run.status === "cancelling") {
    await db.from("place_intelligence_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", runId);
    // Mark any remaining pending rows cancelled too
    await db.from("place_intelligence_trial_runs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "cancelled by operator",
      })
      .eq("parent_run_id", runId)
      .in("status", ["pending"]);
    return json({ ok: true, action: "cancelled" });
  }
  if (run.status !== "running") {
    return json({ skipped: true, reason: `status=${run.status}` });
  }
  if (run.processed_count >= run.total_count) {
    await db.from("place_intelligence_runs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ ok: true, action: "complete" });
  }

  // Step 3: Update heartbeat
  await db.from("place_intelligence_runs")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", runId);

  // ─── Step 4 (v2 PATCHED): pickup pending AND stuck-running ────────────
  //
  // v2 fix per orchestrator REVIEW 2026-05-06: a row stuck in 'running' for
  // > 5 minutes means a previous worker died mid-chunk. The 5-min threshold
  // is well above worst-case 12-row chunk wallclock (~30s steady-state, ~60s
  // with Gemini retry-once on every row), so genuine in-flight rows are
  // never falsely reclaimed mid-flight. Self-healing recovery.
  const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: pickupRows, error: pickupErr } = await db
    .from("place_intelligence_trial_runs")
    .select("id, place_pool_id, signal_id, anchor_index, status, started_at")
    .eq("parent_run_id", runId)
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
    .limit(12);

  if (pickupErr) return json({ error: `pickup failed: ${pickupErr.message}` }, 500);

  if (!pickupRows || pickupRows.length === 0) {
    await db.from("place_intelligence_runs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ ok: true, action: "complete_no_pending" });
  }

  // v2: log when stuck-running rows are reclaimed (operational visibility)
  const reclaimed = pickupRows.filter((r) => r.status === "running").length;
  if (reclaimed > 0) {
    console.warn(
      `[process_chunk] reclaimed ${reclaimed} stuck-running rows for run=${runId}`,
    );
  }

  // Step 5: Mark these rows as 'running' (refreshes started_at for stuck rows)
  const rowIds = pickupRows.map((r) => r.id);
  await db.from("place_intelligence_trial_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .in("id", rowIds);

  // Step 6: Process in parallel-12 via Promise.all.
  // Each row goes through fetch_reviews + compose_collage + run_trial_for_place
  // pipeline. fetch_reviews and compose_collage are idempotent (skip if
  // fresh-within-30-days / fingerprint-cached) so re-running on stuck rows is safe.
  const results = await Promise.all(pickupRows.map(async (row) => {
    try {
      // fetch_reviews (idempotent)
      const fetchRes = await handleFetchReviews(db, {
        place_pool_id: row.place_pool_id,
        force_refresh: false,
      }, serperKey);
      // Note: fetchRes.status is 200 even when "skipped: true" — that's success.
      // Errors throw and get caught below.

      // compose_collage (idempotent)
      const collageRes = await handleComposeCollage(db, {
        place_pool_id: row.place_pool_id,
        force: false,
      });
      const collageBody = await collageRes.json();
      if (collageBody.error) {
        throw new Error(`compose_collage failed: ${collageBody.error}`);
      }

      // run_trial_for_place — actual Gemini call + result persist
      const cost = await processOnePlace({
        db,
        geminiKey,
        runId,
        anchor: {
          place_pool_id: row.place_pool_id,
          signal_id: row.signal_id,
          anchor_index: row.anchor_index,
        },
      });

      // void unused fetchRes (call already wrote reviews to DB)
      void fetchRes;

      return { ok: true, place_pool_id: row.place_pool_id, cost };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[process_chunk] row ${row.place_pool_id} failed: ${msg}`);
      // Per-row failure: write status='failed' for this place row
      await db.from("place_intelligence_trial_runs")
        .update({
          status: "failed",
          error_message: msg.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { ok: false, place_pool_id: row.place_pool_id, error: msg, cost: 0 };
    }
  }));

  // Step 7: Aggregate and update parent counters atomically
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const chunkCost = results.reduce((s, r) => s + (r.cost || 0), 0);

  await db.rpc("increment_run_counters", {
    p_run_id: runId,
    p_processed: results.length,
    p_succeeded: succeeded,
    p_failed: failed,
    p_cost: chunkCost,
  });

  // Step 8: Check if run is complete now
  const { data: updatedRun } = await db
    .from("place_intelligence_runs")
    .select("processed_count, total_count")
    .eq("id", runId)
    .single();

  const isComplete = (updatedRun?.processed_count ?? 0) >= (updatedRun?.total_count ?? 0);
  if (isComplete) {
    await db.from("place_intelligence_runs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", runId);
  }

  return json({
    ok: true,
    chunk_size: results.length,
    succeeded,
    failed,
    chunk_cost_usd: +chunkCost.toFixed(6),
    reclaimed,                                                              // v2 ADDITION
    run_complete: isComplete,
  });
}
