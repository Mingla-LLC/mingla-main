// ORCH-0708 Phase 1 — score-place-photo-aesthetics edge function
//
// Action-based dispatch (mirrors backfill-place-photos pattern). Calls Claude
// Haiku 4.5 vision with N photos per place + a system prompt built from the
// operator's committed anchors in `photo_aesthetic_labels`. Persists structured
// scoring data to `place_pool.photo_aesthetic_data`.
//
// Spec: Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md §4
// Dispatch: Mingla_Artifacts/prompts/IMPL_ORCH-0708_PHASE_1_PHOTO_AESTHETIC_SCORER.md
//
// I-PHOTO-AESTHETIC-DATA-SOLE-OWNER: this is the ONLY writer of place_pool.photo_aesthetic_data.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MINGLA_SIGNAL_IDS,
  LIGHTING_OPTIONS,
  COMPOSITION_OPTIONS,
  SUBJECT_CLARITY_OPTIONS,
  PRIMARY_SUBJECT_OPTIONS,
  VIBE_TAG_OPTIONS,
  SAFETY_FLAG_OPTIONS,
  PHOTO_AESTHETIC_TOOL,
  sanitizeEnum,
  sanitizeScalarEnum,
  sanitizeAestheticScore,
  sanitizePhotoQualityNotes,
  computeCostUsd,
} from "../_shared/photoAestheticEnums.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_ID = "claude-haiku-4-5-20251001";
const MODEL_NAME_SHORT = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MAX_PHOTOS_PER_PLACE = 5;
// Tier-1 rate-limit math: 50K input tokens/min ÷ ~7.5K per call = ~6.6 calls/min.
// 9s per-place throttle × 5 places = 45s throttle + ~25s call latency = ~70s/batch.
// Comfortably under the Supabase edge function 150s default timeout.
// Larger batches require Batch API mode (which doesn't tick the per-minute limit).
const DEFAULT_BATCH_SIZE = 5;
const ESTIMATED_COST_PER_PLACE_SYNC = 0.008; // ~$0.008/place (sync, no batch discount, no caching benefit on first call)
const ESTIMATED_COST_PER_PLACE_BATCH = 0.004; // ~$0.004/place (batch API 50% off + caching)
const COST_GUARD_USD = 7.0;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── SHA256 fingerprint (Deno-native, no extra deps) ─────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function photoFingerprint(stored_photo_urls: string[] | null | undefined): Promise<string> {
  const photos = (stored_photo_urls || []).slice(0, MAX_PHOTOS_PER_PLACE);
  return sha256Hex(photos.join("|"));
}

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

    if (!anthropicKey) {
      return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));

    if (!body.action) {
      return json(
        {
          error:
            "Missing 'action'. Use action='preview_run', 'create_run', 'run_next_batch', 'run_status', 'cancel_run', 'pause_run', 'resume_run', or 'retry_batch'.",
        },
        400,
      );
    }

    // ── Auth: require admin (mirrors backfill-place-photos lines 47-64) ─────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: "Invalid token" }, 401);
    }
    const { data: adminRow } = await supabaseAdmin
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();
    if (!adminRow) {
      return json({ error: "Admin access required" }, 403);
    }

    switch (body.action) {
      case "preview_run":
        return await handlePreviewRun(supabaseAdmin, body);
      case "create_run":
        return await handleCreateRun(supabaseAdmin, body, user.id);
      case "run_next_batch":
        return await handleRunNextBatch(supabaseAdmin, body, anthropicKey);
      case "run_status":
        return await handleRunStatus(supabaseAdmin, body);
      case "active_runs":
        return await handleActiveRuns(supabaseAdmin);
      case "cancel_run":
        return await handleCancelRun(supabaseAdmin, body);
      case "pause_run":
        return await handlePauseRun(supabaseAdmin, body);
      case "resume_run":
        return await handleResumeRun(supabaseAdmin, body);
      case "retry_batch":
        return await handleRetryBatch(supabaseAdmin, body, anthropicKey);
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error("[score-place-photo-aesthetics] Unhandled error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Eligibility query (per spec §4.2)
// ═══════════════════════════════════════════════════════════════════════════

interface ScorablePlace {
  id: string;
  name: string;
  primary_type: string | null;
  stored_photo_urls: string[] | null;
  photo_aesthetic_data: Record<string, unknown> | null;
}

interface RunScope {
  scope_type: "city" | "place_ids" | "all";
  city?: string;
  country?: string;
  place_ids?: string[];
  force_rescore: boolean;
}

async function loadEligiblePlaces(
  db: SupabaseClient,
  scope: RunScope,
): Promise<{ eligible: ScorablePlace[]; total_seen: number }> {
  let q = db
    .from("place_pool")
    .select("id, name, primary_type, stored_photo_urls, photo_aesthetic_data, city")
    .eq("is_active", true)
    .eq("is_servable", true)
    .not("stored_photo_urls", "is", null);

  if (scope.scope_type === "city") {
    if (!scope.city) throw new Error("city scope requires city name");
    q = q.eq("city", scope.city);
  } else if (scope.scope_type === "place_ids") {
    if (!scope.place_ids || scope.place_ids.length === 0) {
      throw new Error("place_ids scope requires non-empty place_ids array");
    }
    q = q.in("id", scope.place_ids);
  }

  const { data, error } = await q.order("id");
  if (error) throw error;

  const allPlaces: ScorablePlace[] = (data || []) as ScorablePlace[];
  const total_seen = allPlaces.length;

  // Filter B2/B3: photos exist + not failed sentinel
  const withPhotos = allPlaces.filter((p) => {
    const urls = p.stored_photo_urls || [];
    if (urls.length === 0) return false;
    if (urls.length === 1 && urls[0] === "__backfill_failed__") return false;
    return true;
  });

  if (scope.force_rescore) {
    return { eligible: withPhotos, total_seen };
  }

  // Filter B4: photo_aesthetic_data IS NULL OR fingerprint mismatch
  const eligible: ScorablePlace[] = [];
  for (const p of withPhotos) {
    const existing = p.photo_aesthetic_data;
    if (!existing) {
      eligible.push(p);
      continue;
    }
    const existingFp = (existing as { photos_fingerprint?: string })?.photos_fingerprint;
    if (!existingFp) {
      eligible.push(p);
      continue;
    }
    const currentFp = await photoFingerprint(p.stored_photo_urls);
    if (existingFp !== currentFp) {
      eligible.push(p);
    }
    // else: already scored with same photo set → skip
  }

  return { eligible, total_seen };
}

// ═══════════════════════════════════════════════════════════════════════════
// Anchors → system prompt builder
// ═══════════════════════════════════════════════════════════════════════════

const ANCHOR_CATEGORY_LABELS: Record<string, string> = {
  upscale_steakhouse: "Upscale Steakhouse",
  sunny_brunch_cafe: "Sunny Brunch Café",
  neon_dive_bar: "Neon Dive Bar",
  adult_venue: "Adult Venue",
  average_storefront: "Average Storefront",
  cozy_coffee_shop: "Cozy Coffee Shop",
};

interface AnchorRow {
  label_category: string;
  expected_aggregate: Record<string, unknown>;
  notes: string | null;
  place_pool_id: string;
}

async function loadCommittedAnchors(db: SupabaseClient): Promise<Array<AnchorRow & { place_name: string; primary_type: string | null }>> {
  const { data, error } = await db
    .from("photo_aesthetic_labels")
    .select("label_category, expected_aggregate, notes, place_pool_id, place:place_pool!place_pool_id(name, primary_type)")
    .eq("role", "anchor")
    .not("committed_at", "is", null)
    .order("label_category");

  if (error) throw error;
  return (data || []).map((row: any) => ({
    label_category: row.label_category,
    expected_aggregate: row.expected_aggregate,
    notes: row.notes,
    place_pool_id: row.place_pool_id,
    place_name: row.place?.name || "(unknown)",
    primary_type: row.place?.primary_type || null,
  }));
}

function buildSystemPrompt(anchors: Array<AnchorRow & { place_name: string; primary_type: string | null }>): string {
  const lines: string[] = [];
  lines.push(
    'You are Mingla\'s place-photo aesthetic analyzer. You receive 1-5 photos of a place plus its name and Google primary type. You return ONE structured score using the photo_aesthetic_score tool.',
  );
  lines.push("");
  lines.push("# Mingla's 16 signal categories (signal IDs — these are the values you must use in `appropriate_for` and `inappropriate_for` arrays below)");
  lines.push("fine_dining: upscale restaurants, occasion dining, tasting menus, refined ambience");
  lines.push("brunch: breakfast/brunch venues, daytime food, bright/airy");
  lines.push("casual_food: everyday restaurants, lunch/dinner, all cuisines");
  lines.push("drinks: bars, cocktail lounges, nightlife, beer, wine, late-night");
  lines.push("romantic: intimate, candle-lit, date-night, occasion-appropriate");
  lines.push("icebreakers: light & fun first-meet venues — cafes, dessert, casual day spots");
  lines.push("lively: high-energy, social, music, dancing, nightclubs");
  lines.push("movies: cinemas, drive-ins");
  lines.push("theatre: performing arts, concert halls, opera");
  lines.push("creative_arts: galleries, museums, art studios");
  lines.push("play: amusement, bowling, mini golf, arcades, escape rooms");
  lines.push("nature: parks, gardens, trails, outdoor scenic spots");
  lines.push("scenic: viewpoints, observation decks, photogenic outdoor places");
  lines.push("picnic_friendly: parks/lawns suitable for picnics");
  lines.push("groceries: grocery stores, supermarkets");
  lines.push("flowers: florists, flower markets");
  lines.push("");
  lines.push("# Your task");
  lines.push("Look at all photos. Score the place holistically. Return one JSON object.");
  lines.push("");
  lines.push("# Field definitions");
  lines.push("");
  lines.push("aesthetic_score: 1.0-10.0 (numeric, one decimal). Holistic photo quality + composition + lighting. 1=poor amateur snapshot, 5=acceptable Google business photo, 7=well-composed professional, 9-10=stunning editorial-quality.");
  lines.push("");
  lines.push(`lighting: ONE of: ${LIGHTING_OPTIONS.join(", ")}`);
  lines.push(`composition: ONE of: ${COMPOSITION_OPTIONS.join(", ")}`);
  lines.push(`subject_clarity: ONE of: ${SUBJECT_CLARITY_OPTIONS.join(", ")} (is the subject of each photo clearly visible?)`);
  lines.push(`primary_subject: ONE of: ${PRIMARY_SUBJECT_OPTIONS.join(", ")} (what dominates the photo set?)`);
  lines.push("");
  lines.push(`vibe_tags: ARRAY of any-applicable from: ${VIBE_TAG_OPTIONS.join(", ")}. Pick 1-5 most applicable.`);
  lines.push("");
  lines.push("appropriate_for: ARRAY of Mingla category ids (from list above) where this place's photos suggest it would be a strong recommendation. Be generous but accurate (typical 1-3 categories).");
  lines.push("");
  lines.push("inappropriate_for: ARRAY of Mingla category ids where this place would be a poor recommendation despite Google's classification. Use sparingly — only when photos clearly contradict a category fit. Typical 0-3 categories.");
  lines.push("");
  lines.push(`safety_flags: ARRAY from: ${SAFETY_FLAG_OPTIONS.join(", ")}. Default empty.`);
  lines.push("");
  lines.push("photo_quality_notes: 1-2 sentence string. Plain English notes for human review (e.g., \"Warm intimate lighting, food-forward shots, strong composition\").");
  lines.push("");
  lines.push("# Critical rules");
  lines.push("- Be HONEST about poor photos. Don't inflate aesthetic_score for venues with weak photos.");
  lines.push("- inappropriate_for is the strongest signal — use it when Google's classification is misleading the consumer.");
  lines.push("- safety_flags catches adult/inappropriate content even when Google tagged the place blandly.");
  lines.push("- vibe_tags must come from the enum. If a venue's vibe doesn't match any tag, leave the array empty rather than inventing.");

  if (anchors.length > 0) {
    lines.push("");
    lines.push("# Calibration anchors (operator-labeled examples — match this style of judgment)");
    for (const a of anchors) {
      const catLabel = ANCHOR_CATEGORY_LABELS[a.label_category] || a.label_category;
      lines.push("");
      lines.push(`## ${catLabel}`);
      lines.push(`Reference place: "${a.place_name}" (${a.primary_type || "unknown type"})`);
      lines.push("Expected output:");
      lines.push("```json");
      lines.push(JSON.stringify(a.expected_aggregate, null, 2));
      lines.push("```");
      if (a.notes) {
        lines.push(`Operator notes: ${a.notes}`);
      }
    }
    lines.push("");
    lines.push("Use these anchors to calibrate your scoring scale. Apply the same level of decisiveness — don't middle-of-the-road every score.");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Anthropic vision call (per place)
// ═══════════════════════════════════════════════════════════════════════════

interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ScoredAggregate {
  aesthetic_score: number;
  lighting: string;
  composition: string;
  subject_clarity: string;
  primary_subject: string;
  vibe_tags: string[];
  appropriate_for: string[];
  inappropriate_for: string[];
  safety_flags: string[];
  photo_quality_notes: string;
}

async function callClaudeVisionForPlace(args: {
  apiKey: string;
  systemPrompt: string;
  place: ScorablePlace;
  useCache: boolean;
}): Promise<{ aggregate: ScoredAggregate; usage: ClaudeUsage }> {
  const { apiKey, systemPrompt, place, useCache } = args;
  const photos = (place.stored_photo_urls || []).slice(0, MAX_PHOTOS_PER_PLACE);
  if (photos.length === 0) {
    throw new Error("no photos to score");
  }

  const userContent: Array<Record<string, unknown>> = photos.map((url) => ({
    type: "image",
    source: { type: "url", url },
  }));
  userContent.push({
    type: "text",
    text: `Place: "${place.name}" (Google primary_type: ${place.primary_type ?? "unknown"}). ${photos.length} photo${photos.length === 1 ? "" : "s"} above. Score per the system prompt.`,
  });

  const systemBlock: Array<Record<string, unknown>> = [
    useCache
      ? { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
      : { type: "text", text: systemPrompt },
  ];

  const reqBody = {
    model: MODEL_ID,
    max_tokens: 800,
    system: systemBlock,
    messages: [{ role: "user", content: userContent }],
    tool_choice: { type: "tool", name: PHOTO_AESTHETIC_TOOL.name },
    tools: [PHOTO_AESTHETIC_TOOL],
  };

  // Retry on 429 (rate limit) and 5xx with exponential backoff.
  // Anthropic tier-1 limit is 50K input tokens/minute = ~7 requests/min at our
  // ~7.5K-token-per-call size. The per-place throttle in handleRunNextBatch
  // keeps us under that, but bursts at session start can still hit the wall.
  const MAX_ATTEMPTS = 4;
  const BASE_BACKOFF_MS = 12_000; // 12s — enough to clear a per-minute rate window
  let res: Response;
  let lastErrText = "";
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

    // Honor Retry-After header if present (429s often include it in seconds)
    const retryAfter = res.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Math.min(60_000, Math.max(1_000, Number(retryAfter) * 1000)) : 0;
    const backoffMs = retryAfterMs || (BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
    console.log(`[score-place-photo-aesthetics] ${status} on attempt ${attempt}/${MAX_ATTEMPTS}, sleeping ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  // TypeScript can't tell that `res` is definitely assigned after the loop's
  // success path, but the throw above guarantees we either break with res.ok
  // or throw. Reassert for the type checker:
  if (!res!.ok) {
    throw new Error(`Anthropic exhausted retries: ${lastErrText.slice(0, 500)}`);
  }

  const payload = await res!.json();
  const toolUseBlock = (payload?.content || []).find(
    (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === PHOTO_AESTHETIC_TOOL.name,
  );
  if (!toolUseBlock) {
    throw new Error(`Claude returned no tool_use block. Payload: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const raw = (toolUseBlock as { input: Record<string, unknown> }).input || {};

  const aggregate: ScoredAggregate = {
    aesthetic_score: sanitizeAestheticScore(raw.aesthetic_score),
    lighting: sanitizeScalarEnum(raw.lighting, LIGHTING_OPTIONS, "unclear"),
    composition: sanitizeScalarEnum(raw.composition, COMPOSITION_OPTIONS, "average"),
    subject_clarity: sanitizeScalarEnum(raw.subject_clarity, SUBJECT_CLARITY_OPTIONS, "clear"),
    primary_subject: sanitizeScalarEnum(raw.primary_subject, PRIMARY_SUBJECT_OPTIONS, "mixed"),
    vibe_tags: sanitizeEnum(raw.vibe_tags, VIBE_TAG_OPTIONS),
    appropriate_for: sanitizeEnum(raw.appropriate_for, MINGLA_SIGNAL_IDS),
    inappropriate_for: sanitizeEnum(raw.inappropriate_for, MINGLA_SIGNAL_IDS),
    safety_flags: sanitizeEnum(raw.safety_flags, SAFETY_FLAG_OPTIONS),
    photo_quality_notes: sanitizePhotoQualityNotes(raw.photo_quality_notes),
  };

  const usage: ClaudeUsage = payload?.usage || {
    input_tokens: 0,
    output_tokens: 0,
  };

  return { aggregate, usage };
}

// ═══════════════════════════════════════════════════════════════════════════
// Persist result (per spec §4.5)
// ═══════════════════════════════════════════════════════════════════════════

async function persistScoringResult(args: {
  db: SupabaseClient;
  place: ScorablePlace;
  aggregate: ScoredAggregate;
  usage: ClaudeUsage;
  useBatchApi: boolean;
}): Promise<{ cost_usd: number }> {
  const { db, place, aggregate, usage, useBatchApi } = args;
  const fingerprint = await photoFingerprint(place.stored_photo_urls);
  const cost_usd = computeCostUsd({
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
    useBatchApi,
  });

  const final = {
    photos_fingerprint: fingerprint,
    scored_at: new Date().toISOString(),
    model: MODEL_NAME_SHORT,
    model_version: MODEL_ID,
    aggregate,
    cost_usd,
  };

  const { error } = await db
    .from("place_pool")
    .update({ photo_aesthetic_data: final })
    .eq("id", place.id);

  if (error) throw error;
  return { cost_usd };
}

async function persistFailureSentinel(args: {
  db: SupabaseClient;
  place: ScorablePlace;
  errorMessage: string;
}): Promise<void> {
  const { db, place, errorMessage } = args;
  const fingerprint = await photoFingerprint(place.stored_photo_urls);
  const sentinel = {
    photos_fingerprint: fingerprint,
    scored_at: new Date().toISOString(),
    model: MODEL_NAME_SHORT,
    error: errorMessage.slice(0, 500),
    __scoring_failed__: true,
  };
  await db
    .from("place_pool")
    .update({ photo_aesthetic_data: sentinel })
    .eq("id", place.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Action handlers
// ═══════════════════════════════════════════════════════════════════════════

function parseScope(body: Record<string, unknown>): RunScope {
  const scope_type = (body.scope_type as string) || "city";
  if (!["city", "place_ids", "all"].includes(scope_type)) {
    throw new Error(`Invalid scope_type: ${scope_type}`);
  }
  return {
    scope_type: scope_type as "city" | "place_ids" | "all",
    city: body.city as string | undefined,
    country: body.country as string | undefined,
    place_ids: body.place_ids as string[] | undefined,
    force_rescore: !!body.force_rescore,
  };
}

async function handlePreviewRun(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const scope = parseScope(body);
  const useBatchApi = !!body.use_batch_api;
  const batchSize = Math.max(1, Math.min(Number(body.batch_size) || DEFAULT_BATCH_SIZE, 100));

  let eligible: ScorablePlace[];
  let total_seen: number;
  try {
    const result = await loadEligiblePlaces(db, scope);
    eligible = result.eligible;
    total_seen = result.total_seen;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to preview" }, 500);
  }

  const totalPlaces = eligible.length;
  const totalBatches = Math.ceil(totalPlaces / batchSize);
  const perPlaceCost = useBatchApi ? ESTIMATED_COST_PER_PLACE_BATCH : ESTIMATED_COST_PER_PLACE_SYNC;
  const estimatedCostUsd = +(totalPlaces * perPlaceCost).toFixed(4);

  return json({
    totalPlaces,
    totalBatches,
    batchSize,
    estimatedCostUsd,
    totalSeen: total_seen,
    skipped: total_seen - totalPlaces,
    useBatchApi,
  });
}

async function handleCreateRun(
  db: SupabaseClient,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const scope = parseScope(body);
  const useBatchApi = !!body.use_batch_api;
  const useCache = body.use_cache !== false; // default true
  const batchSize = Math.max(1, Math.min(Number(body.batch_size) || DEFAULT_BATCH_SIZE, 100));

  // Block duplicate active run for same scope
  let activeQ = db
    .from("photo_aesthetic_runs")
    .select("id")
    .in("status", ["ready", "running", "paused"]);
  if (scope.scope_type === "city" && scope.city) {
    activeQ = activeQ.eq("city", scope.city);
  }
  const { data: existing } = await activeQ.limit(1).maybeSingle();
  if (existing) {
    return json({ status: "already_active", runId: (existing as { id: string }).id });
  }

  let eligible: ScorablePlace[];
  try {
    const result = await loadEligiblePlaces(db, scope);
    eligible = result.eligible;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to load eligible places" }, 500);
  }

  if (eligible.length === 0) {
    return json({
      status: "nothing_to_do",
      reason: scope.force_rescore
        ? "No active+servable places with photos in this scope."
        : "All places in this scope already have photo_aesthetic_data with matching photo fingerprints. Use force_rescore=true to re-run.",
    });
  }

  const totalPlaces = eligible.length;
  const totalBatches = Math.ceil(totalPlaces / batchSize);
  const perPlaceCost = useBatchApi ? ESTIMATED_COST_PER_PLACE_BATCH : ESTIMATED_COST_PER_PLACE_SYNC;
  const estimatedCostUsd = +(totalPlaces * perPlaceCost).toFixed(4);

  if (estimatedCostUsd > COST_GUARD_USD) {
    return json(
      {
        error: `Cost guard tripped: estimated $${estimatedCostUsd} exceeds $${COST_GUARD_USD}. Narrow the scope or raise the guard.`,
      },
      400,
    );
  }

  const { data: run, error: runErr } = await db
    .from("photo_aesthetic_runs")
    .insert({
      city: scope.city || null,
      country: scope.country || null,
      scope_type: scope.scope_type,
      scope_place_ids: scope.scope_type === "place_ids" ? scope.place_ids : null,
      total_places: totalPlaces,
      total_batches: totalBatches,
      batch_size: batchSize,
      estimated_cost_usd: estimatedCostUsd,
      model: MODEL_NAME_SHORT,
      use_batch_api: useBatchApi,
      use_cache: useCache,
      force_rescore: scope.force_rescore,
      triggered_by: userId,
      status: "ready",
    })
    .select("id")
    .single();

  if (runErr || !run) {
    console.error("[score-place-photo-aesthetics] create_run insert error:", runErr);
    return json({ error: runErr?.message ?? "Failed to create run" }, 500);
  }

  const batchRows = [];
  for (let i = 0; i < totalBatches; i++) {
    const chunk = eligible.slice(i * batchSize, (i + 1) * batchSize);
    batchRows.push({
      run_id: (run as { id: string }).id,
      batch_index: i,
      place_pool_ids: chunk.map((p) => p.id),
      place_count: chunk.length,
      status: "pending",
    });
  }

  const { error: batchErr } = await db
    .from("photo_aesthetic_batches")
    .insert(batchRows);

  if (batchErr) {
    await db.from("photo_aesthetic_runs").delete().eq("id", (run as { id: string }).id);
    return json({ error: batchErr.message }, 500);
  }

  return json({
    runId: (run as { id: string }).id,
    totalPlaces,
    totalBatches,
    batchSize,
    estimatedCostUsd,
    useBatchApi,
    status: "ready",
  });
}

async function handleRunNextBatch(
  db: SupabaseClient,
  body: Record<string, unknown>,
  anthropicKey: string,
): Promise<Response> {
  const runId = body.run_id as string || body.runId as string;
  if (!runId) return json({ error: "run_id required" }, 400);

  // Fetch run
  const { data: run, error: runErr } = await db
    .from("photo_aesthetic_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (runErr || !run) return json({ error: "run not found" }, 404);

  const runRow = run as Record<string, unknown>;
  const status = runRow.status as string;
  if (!["ready", "running"].includes(status)) {
    return json({ error: `run is ${status}, cannot process batch` }, 400);
  }

  // Pick next pending batch
  const { data: batch, error: batchErr } = await db
    .from("photo_aesthetic_batches")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("batch_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (batchErr) return json({ error: batchErr.message }, 500);
  if (!batch) {
    // No more pending batches — finalize run
    await db
      .from("photo_aesthetic_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ done: true, runProgress: await readRunProgress(db, runId) });
  }

  // Mark run running + batch running
  if (status === "ready") {
    await db
      .from("photo_aesthetic_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId);
  }
  await db
    .from("photo_aesthetic_batches")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", (batch as { id: string }).id);

  // Process batch (sync mode for now; Batch API path is a future toggle)
  const useBatchApi = !!runRow.use_batch_api;
  const useCache = runRow.use_cache !== false;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let batchCostUsd = 0;
  const failedPlaces: Array<{ place_pool_id: string; error: string }> = [];

  // Load anchors once per batch (not per place)
  let anchors: Array<AnchorRow & { place_name: string; primary_type: string | null }>;
  try {
    anchors = await loadCommittedAnchors(db);
  } catch (err) {
    await db
      .from("photo_aesthetic_batches")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: `Failed to load anchors: ${err instanceof Error ? err.message : err}`,
      })
      .eq("id", (batch as { id: string }).id);
    return json({ error: "Failed to load anchors" }, 500);
  }
  const systemPrompt = buildSystemPrompt(anchors);

  // Load places in this batch
  const { data: places, error: placesErr } = await db
    .from("place_pool")
    .select("id, name, primary_type, stored_photo_urls, photo_aesthetic_data")
    .in("id", (batch as { place_pool_ids: string[] }).place_pool_ids);

  if (placesErr || !places) {
    await db
      .from("photo_aesthetic_batches")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: `Failed to load places: ${placesErr?.message ?? "unknown"}`,
      })
      .eq("id", (batch as { id: string }).id);
    return json({ error: "Failed to load batch places" }, 500);
  }

  // Per-place throttle to stay under Anthropic tier-1 rate limit (50K input
  // tokens/minute). Each call is ~7.5K tokens raw → max ~6.6 calls/min before
  // hitting 429. After the first cached call, subsequent system prompts cost
  // only ~10% toward the rate limit, so a 9-second delay leaves headroom for
  // retries.
  const PER_PLACE_THROTTLE_MS = 9_000;
  let placeIdx = 0;
  for (const placeRow of places as ScorablePlace[]) {
    // Idempotency double-check (in case fingerprint changed since create_run)
    if (!runRow.force_rescore && placeRow.photo_aesthetic_data) {
      const existingFp = (placeRow.photo_aesthetic_data as { photos_fingerprint?: string })?.photos_fingerprint;
      const currentFp = await photoFingerprint(placeRow.stored_photo_urls);
      if (existingFp && existingFp === currentFp) {
        skipped++;
        placeIdx++;
        continue;
      }
    }

    // Throttle BEFORE the call (skip first place — it goes immediately).
    if (placeIdx > 0) {
      await new Promise((r) => setTimeout(r, PER_PLACE_THROTTLE_MS));
    }

    try {
      const { aggregate, usage } = await callClaudeVisionForPlace({
        apiKey: anthropicKey,
        systemPrompt,
        place: placeRow,
        useCache,
      });
      const { cost_usd } = await persistScoringResult({
        db,
        place: placeRow,
        aggregate,
        usage,
        useBatchApi,
      });
      batchCostUsd += cost_usd;
      succeeded++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[score-place-photo-aesthetics] place ${placeRow.id} failed:`, errorMessage);
      failedPlaces.push({ place_pool_id: placeRow.id, error: errorMessage });
      try {
        await persistFailureSentinel({ db, place: placeRow, errorMessage });
      } catch (sentinelErr) {
        console.error("[score-place-photo-aesthetics] sentinel write failed:", sentinelErr);
      }
      failed++;
    }
    placeIdx++;
  }

  // Mark batch completed
  await db
    .from("photo_aesthetic_batches")
    .update({
      status: "completed",
      succeeded,
      failed,
      skipped,
      cost_usd: +batchCostUsd.toFixed(6),
      failed_places: failedPlaces,
      completed_at: new Date().toISOString(),
    })
    .eq("id", (batch as { id: string }).id);

  // Increment run counters via RPC-style atomic update (read-modify-write since
  // we don't have a tailored RPC; ok because only one batch runs at a time)
  const { data: runFresh } = await db
    .from("photo_aesthetic_runs")
    .select("completed_batches, total_succeeded, total_failed, total_skipped, actual_cost_usd")
    .eq("id", runId)
    .single();
  if (runFresh) {
    const r = runFresh as Record<string, number>;
    await db
      .from("photo_aesthetic_runs")
      .update({
        completed_batches: (r.completed_batches || 0) + 1,
        total_succeeded: (r.total_succeeded || 0) + succeeded,
        total_failed: (r.total_failed || 0) + failed,
        total_skipped: (r.total_skipped || 0) + skipped,
        actual_cost_usd: +((r.actual_cost_usd || 0) + batchCostUsd).toFixed(6),
      })
      .eq("id", runId);
  }

  // Check if more batches remain
  const { data: nextBatch } = await db
    .from("photo_aesthetic_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  const done = !nextBatch;
  if (done) {
    await db
      .from("photo_aesthetic_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId);
  }

  return json({
    done,
    batch: {
      id: (batch as { id: string }).id,
      succeeded,
      failed,
      skipped,
      cost_usd: +batchCostUsd.toFixed(6),
    },
    runProgress: await readRunProgress(db, runId),
  });
}

async function readRunProgress(db: SupabaseClient, runId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("photo_aesthetic_runs")
    .select("status, total_places, total_batches, completed_batches, total_succeeded, total_failed, total_skipped, actual_cost_usd, estimated_cost_usd")
    .eq("id", runId)
    .maybeSingle();
  return data;
}

async function handleRunStatus(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = (body.run_id as string) || (body.runId as string);
  if (!runId) return json({ error: "run_id required" }, 400);

  const { data: run } = await db
    .from("photo_aesthetic_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return json({ error: "run not found" }, 404);

  const { data: batches } = await db
    .from("photo_aesthetic_batches")
    .select("id, batch_index, status, succeeded, failed, skipped, cost_usd, error_message, place_count")
    .eq("run_id", runId)
    .order("batch_index", { ascending: true });

  return json({ run, batches: batches || [] });
}

async function handleActiveRuns(db: SupabaseClient): Promise<Response> {
  const { data, error } = await db
    .from("photo_aesthetic_runs")
    .select("id, city, country, scope_type, status, total_places, total_batches, completed_batches, total_succeeded, total_failed, actual_cost_usd, estimated_cost_usd, created_at")
    .in("status", ["ready", "running", "paused"])
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ runs: data || [] });
}

async function handleCancelRun(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = (body.run_id as string) || (body.runId as string);
  if (!runId) return json({ error: "run_id required" }, 400);
  await db
    .from("photo_aesthetic_runs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["ready", "running", "paused"]);
  await db
    .from("photo_aesthetic_batches")
    .update({ status: "skipped" })
    .eq("run_id", runId)
    .eq("status", "pending");
  return json({ ok: true });
}

async function handlePauseRun(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = (body.run_id as string) || (body.runId as string);
  if (!runId) return json({ error: "run_id required" }, 400);
  const { error } = await db
    .from("photo_aesthetic_runs")
    .update({ status: "paused" })
    .eq("id", runId)
    .in("status", ["ready", "running"]);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function handleResumeRun(
  db: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const runId = (body.run_id as string) || (body.runId as string);
  if (!runId) return json({ error: "run_id required" }, 400);
  const { error } = await db
    .from("photo_aesthetic_runs")
    .update({ status: "ready" })
    .eq("id", runId)
    .eq("status", "paused");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function handleRetryBatch(
  db: SupabaseClient,
  body: Record<string, unknown>,
  _anthropicKey: string,
): Promise<Response> {
  const batchId = (body.batch_id as string) || (body.batchId as string);
  if (!batchId) return json({ error: "batch_id required" }, 400);
  const { error } = await db
    .from("photo_aesthetic_batches")
    .update({
      status: "pending",
      succeeded: 0,
      failed: 0,
      skipped: 0,
      error_message: null,
      failed_places: [],
      started_at: null,
      completed_at: null,
    })
    .eq("id", batchId)
    .in("status", ["failed", "skipped"]);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
