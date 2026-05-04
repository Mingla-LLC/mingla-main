# SPEC — ORCH-0708: Photo-Aesthetic Scoring Integration (Wave 2 Phase 1)

**Mode:** SPEC (forensics — Arm 2 of 2)
**Companion investigation:** [INVESTIGATION_ORCH-0708_SCORING_SYSTEM_AUDIT.md](INVESTIGATION_ORCH-0708_SCORING_SYSTEM_AUDIT.md)
**Dispatch:** [prompts/FORENSICS_ORCH-0708_PHOTO_AESTHETIC_SCORING_AUDIT_AND_SPEC.md](Mingla_Artifacts/prompts/FORENSICS_ORCH-0708_PHOTO_AESTHETIC_SCORING_AUDIT_AND_SPEC.md)
**Date:** 2026-05-01
**Confidence:** HIGH on architecture; MEDIUM on weight magnitudes (refine after first re-score in Raleigh/Cary/Durham)

---

## 1. Plain-English Summary

Add Claude Haiku 4.5 vision-derived photo aesthetic data to `place_pool` as a new JSONB column. A new edge function (`score-place-photo-aesthetics`) reads each place's top 5 stored photos, sends them to Claude in a single batched call, and persists a structured aggregate. The signal scorer is extended with 7 new JSONB-aware field-weight matchers that consume the aggregate. Seven signal configs (`fine_dining, brunch, romantic, lively, casual_food, drinks, icebreakers`) get v_next versions with photo-derived weights and `cap` raised from 200 → 1000. Operator runs the new edge function once, then `run-signal-scorer` once per affected signal. Done.

**Phase 0 prerequisite (added 2026-05-03 per operator):** a new admin labeling tool ships FIRST so the operator can manually label 6 calibration anchors + 30 golden fixtures using REAL photos from existing pool places. The labeled set is exported as JSON, hardcoded into Claude's system prompt (anchors) and the test fixture file (fixtures), THEN the rest of the spec ships. Includes a "Compare with Claude" tab that activates after backfill — side-by-side per-field diff between operator's expected outputs and Claude's actual outputs, with pass/fail badges and prompt-iteration workflow. See §24 for full design.

**Cost for Raleigh + Cary + Durham (3,234 places):** ~$11 with Haiku 4.5 batch + cache (well under the $200 escalation threshold).

The change preserves every existing invariant: bouncer untouched, admin-seed-places FieldMask untouched, RLS unchanged, two-gate serving unchanged. The new column has a single owner (the new edge function); no other writer touches it.

---

## 2. Scope + Non-Goals

### In scope
- New `place_pool.photo_aesthetic_data jsonb` column + indexes
- New `photo_aesthetic_runs` + `photo_aesthetic_batches` tables (mirror existing `photo_backfill_*` shape)
- New `score-place-photo-aesthetics` edge function (action-based dispatch matching `backfill-place-photos`)
- Prompt + structured-output schema for Claude vision call
- 7 new field-weight prefix matchers in `signalScorer.ts`
- 7 new `signal_definition_versions` rows: `fine_dining v1.3.0`, `brunch v1.5.0`, `romantic v1.1.0`, `lively v1.1.0`, `casual_food v1.1.0`, **`drinks v1.5.0`**, **`icebreakers v1.1.0`** — all with `cap: 1000` + photo field weights. **Scope expanded 2026-05-01 from 5 → 7 signals after orchestrator review challenge: drinks (3.5% cap-compression) and icebreakers (2.7%) had more cap compression than fine_dining (0.6%) and romantic (0.6%) — original scope was inconsistent with Thread B-1 evidence.**
- `run-signal-scorer` SELECT_FIELDS extension to include `photo_aesthetic_data`
- Test plan + rollback plan + operator runbook

### Non-goals (explicit)
- **OSM cross-reference / Foursquare OSP / Yelp / editorial labels** (Wave 2 Phase 1 Track 2+, separate dispatches)
- **Per-city percentile serving (Option c from cap decision)** — deferred to Wave 2 Phase 2 (filed as ORCH-0709 candidate via D-INV-1)
- **Live-trigger photo scoring on Mingla Business event upload** — Wave 2 Phase 2
- **Bouncer changes** — explicit non-goal
- **Mobile or admin code changes** — none required
- **Weight tuning to perfection on first ship** — first re-score is the calibration baseline; magnitudes can be tuned in v_next+1 after Raleigh/Cary/Durham smoke

### Assumptions
- Anthropic Haiku 4.5 vision model is available via standard Messages API + Batch API in the `us-east-2` region (confirmed via pricing page).
- `place-photos` storage bucket public URL is reachable from Anthropic's servers (no IP allowlist).
- `ANTHROPIC_API_KEY` is configured (or will be added) as a Supabase Edge Function secret on Mingla-dev (project `gqnoajqerqhnvulmnyvv`).
- Operator has admin login to invoke the edge function via admin UI (or will use `curl` + service role key directly).

---

## 3. Database Layer

### 3.1 New column on `place_pool`

```sql
-- Migration: 20260501000006_orch_0704_place_pool_photo_aesthetic_data.sql
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS photo_aesthetic_data jsonb DEFAULT NULL;

COMMENT ON COLUMN public.place_pool.photo_aesthetic_data IS
  'ORCH-0708 (Wave 2 Phase 1): structured photo-aesthetic data from Claude vision. ' ||
  'Owned EXCLUSIVELY by score-place-photo-aesthetics edge function. ' ||
  'Bouncer, signal scorer, admin-seed-places, backfill-place-photos MUST NOT write this column. ' ||
  'I-PHOTO-AESTHETIC-DATA-SOLE-OWNER. ' ||
  'Schema: { photos_fingerprint: text, scored_at: timestamptz, model: text, model_version: text, ' ||
  'per_photo: [...], aggregate: { aesthetic_score, lighting, composition, subject_clarity, primary_subject, ' ||
  'vibe_tags[], appropriate_for[], inappropriate_for[], safety_flags[], photo_quality_notes }, cost_usd: numeric }.';

-- No index needed — scorer reads via JSONB operators on per-row basis (PK lookup already indexed).
```

### 3.2 `photo_aesthetic_runs` table (mirrors `photo_backfill_runs`)

```sql
-- Migration: 20260501000007_orch_0704_photo_aesthetic_runs_table.sql
CREATE TABLE IF NOT EXISTS public.photo_aesthetic_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city            TEXT,                  -- nullable: a run can be city-scoped or place-id-list-scoped
  country         TEXT,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('city','place_ids','all')),
  scope_place_ids UUID[],                -- populated when scope_type='place_ids'
  total_places    INTEGER NOT NULL,
  total_batches   INTEGER NOT NULL,
  batch_size      INTEGER NOT NULL DEFAULT 25,    -- 25 places per batch (each place = 1 Claude call)

  -- Progress
  completed_batches  INTEGER NOT NULL DEFAULT 0,
  failed_batches     INTEGER NOT NULL DEFAULT 0,
  skipped_batches    INTEGER NOT NULL DEFAULT 0,
  total_succeeded    INTEGER NOT NULL DEFAULT 0,
  total_failed       INTEGER NOT NULL DEFAULT 0,
  total_skipped      INTEGER NOT NULL DEFAULT 0,

  -- Cost tracking
  estimated_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  actual_cost_usd     NUMERIC(10,6) NOT NULL DEFAULT 0,

  -- Config snapshot
  model              TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  use_batch_api      BOOLEAN NOT NULL DEFAULT true,
  use_cache          BOOLEAN NOT NULL DEFAULT true,
  force_rescore      BOOLEAN NOT NULL DEFAULT false,

  status  TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready','running','paused','completed','cancelled','failed')),
  triggered_by  UUID REFERENCES auth.users(id),    -- nullable: edge function may run via cron later
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_runs_status ON photo_aesthetic_runs(status);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_runs_city ON photo_aesthetic_runs(city, country);

ALTER TABLE public.photo_aesthetic_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_photo_aesthetic_runs" ON public.photo_aesthetic_runs
  FOR ALL USING (auth.role() = 'service_role');
```

### 3.3 `photo_aesthetic_batches` table

```sql
CREATE TABLE IF NOT EXISTS public.photo_aesthetic_batches (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id    UUID NOT NULL REFERENCES photo_aesthetic_runs(id) ON DELETE CASCADE,
  batch_index    INTEGER NOT NULL,
  place_pool_ids UUID[] NOT NULL,
  place_count    INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','skipped')),

  succeeded INTEGER NOT NULL DEFAULT 0,
  failed    INTEGER NOT NULL DEFAULT 0,
  skipped   INTEGER NOT NULL DEFAULT 0,

  -- Anthropic Batch API integration
  anthropic_batch_id TEXT,                          -- the message_batch.id from Anthropic
  anthropic_status   TEXT,                          -- in_progress | ended | etc.

  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,

  error_message  TEXT,
  failed_places  JSONB DEFAULT '[]'::jsonb,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_batches_run ON photo_aesthetic_batches(run_id);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_batches_status ON photo_aesthetic_batches(run_id, status);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_batches_anthropic ON photo_aesthetic_batches(anthropic_batch_id) WHERE anthropic_batch_id IS NOT NULL;

ALTER TABLE public.photo_aesthetic_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_photo_aesthetic_batches" ON public.photo_aesthetic_batches
  FOR ALL USING (auth.role() = 'service_role');
```

### 3.4 Carve-outs (CRITICAL — preserves invariants)

**`admin-seed-places` MUST NOT touch `photo_aesthetic_data`:**
- Implementor verifies via grep that `photo_aesthetic_data` does NOT appear in [admin-seed-places/index.ts](supabase/functions/admin-seed-places/index.ts) FIELD_MASK string (line 45-119) AND does NOT appear in the per-row UPDATE block ([admin-seed-places/index.ts:1023-1099](supabase/functions/admin-seed-places/index.ts#L1023-L1099)). This preserves `I-FIELD-MASK-SINGLE-OWNER` + `I-REFRESH-NEVER-DEGRADES`.
- Add a **protective comment** at the top of the per-row UPDATE block: `// I-PHOTO-AESTHETIC-DATA-SOLE-OWNER (ORCH-0708): photo_aesthetic_data is INTENTIONALLY EXCLUDED from this UPDATE. It is owned exclusively by score-place-photo-aesthetics. A re-seed must NOT clobber it.`

**Bouncer MUST NOT read or write `photo_aesthetic_data`:**
- [_shared/bouncer.ts](supabase/functions/_shared/bouncer.ts) and [run-bouncer/index.ts](supabase/functions/run-bouncer/index.ts) + [run-pre-photo-bouncer/index.ts](supabase/functions/run-pre-photo-bouncer/index.ts) — none touched.
- The dispatch's deterministic-by-design philosophy is preserved.

---

## 4. Edge Function Layer — `score-place-photo-aesthetics`

### 4.1 Action-based dispatch (mirrors `backfill-place-photos`)

```
POST /functions/v1/score-place-photo-aesthetics
Content-Type: application/json
Authorization: Bearer <SERVICE_ROLE or admin user JWT>

Body: { action: <action>, ...args }
```

| Action | Args | Purpose |
|---|---|---|
| `preview_run` | `city?, place_ids?, scope_type, batch_size, force_rescore` | Compute total_places + total_batches + estimated_cost; no writes |
| `create_run` | same as preview | Insert `photo_aesthetic_runs` row + N `photo_aesthetic_batches` rows; status='ready' |
| `run_next_batch` | `run_id` | Pick next pending batch, set status='running', call Anthropic Batch API (or sync if `use_batch_api=false`), poll for completion, persist `photo_aesthetic_data` for each place, mark batch done |
| `submit_batch` | `run_id, batch_id` | Submit one batch to Anthropic Batch API, store returned `anthropic_batch_id`. Returns immediately; doesn't wait |
| `poll_batch` | `run_id, batch_id` | Check Anthropic Batch API status, persist results if `ended`, advance run counters |
| `run_status` | `run_id` | Returns full run + batches summary for admin UI hydration |
| `cancel_run` | `run_id` | Mark remaining pending batches skipped; status='cancelled' |
| `pause_run` | `run_id` | status='paused'; in-flight batch finishes naturally |
| `resume_run` | `run_id` | status='ready'; resume from next pending |
| `retry_batch` | `run_id, batch_id` | Re-execute failed batch |

### 4.2 Place selection (per `create_run`)

```sql
-- pseudocode for the eligibility query
SELECT pp.id, pp.name, pp.primary_type, pp.stored_photo_urls
FROM place_pool pp
JOIN seeding_cities sc ON sc.id = pp.city_id
WHERE pp.is_active = true
  AND pp.is_servable = true                                              -- B1: bouncer-approved
  AND pp.stored_photo_urls IS NOT NULL                                   -- B2: photos exist
  AND array_length(pp.stored_photo_urls, 1) > 0
  AND NOT (array_length(pp.stored_photo_urls, 1) = 1
           AND pp.stored_photo_urls[1] = '__backfill_failed__')          -- B3: not failed sentinel
  AND (
    {force_rescore_param} = true
    OR pp.photo_aesthetic_data IS NULL                                   -- B4a: never scored
    OR (pp.photo_aesthetic_data ->> 'photos_fingerprint')
       != encode(digest(array_to_string(pp.stored_photo_urls[1:5], '|'), 'sha256'), 'hex')  -- B4b: photos rotated
  )
  AND (
    {scope_type} = 'all'
    OR ({scope_type} = 'city' AND sc.name = {city_param})
    OR ({scope_type} = 'place_ids' AND pp.id = ANY({place_ids_param}::uuid[]))
  )
ORDER BY pp.id;
```

### 4.3 Single-place call to Anthropic vision (per place in a batch)

For each place, build one Claude API request:

```typescript
// Pseudocode — full implementation in edge function
const photos = stored_photo_urls.slice(0, 5);
const request = {
  model: 'claude-haiku-4-5',
  max_tokens: 800,
  system: [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }   // 5-min cache
  ],
  messages: [
    {
      role: 'user',
      content: [
        ...photos.map(url => ({ type: 'image', source: { type: 'url', url } })),
        { type: 'text', text: `Place: "${place.name}" (Google primary_type: ${place.primary_type ?? 'unknown'}). ${photos.length} photos above. Score per the system prompt.` }
      ]
    }
  ],
  tool_choice: { type: 'tool', name: 'photo_aesthetic_score' },
  tools: [PHOTO_AESTHETIC_TOOL]
};
```

### 4.4 Anthropic Batch API integration

For `submit_batch`:
- POST `https://api.anthropic.com/v1/messages/batches` with `requests[]` (one per place in this batch, custom_id = `place_pool_id`).
- Persist returned `id` as `photo_aesthetic_batches.anthropic_batch_id`.
- Set batch status='running', anthropic_status='in_progress'.

For `poll_batch`:
- GET `https://api.anthropic.com/v1/messages/batches/{id}` → check `processing_status`.
- When `ended`: GET `results_url`, stream JSONL, parse each result, validate against tool schema, persist to `place_pool.photo_aesthetic_data` per place.
- Sum input + output tokens × Batch pricing → write to batch.cost_usd.
- Update run counters.

### 4.5 Aggregation logic (per place, after parsing Claude response)

Claude returns one structured object per call (the call covers all 5 photos at once). Edge function persists with these derived fields:

```typescript
const photos_fingerprint = sha256(stored_photo_urls.slice(0,5).join('|'));
const final = {
  photos_fingerprint,
  scored_at: new Date().toISOString(),
  model: 'claude-haiku-4-5',
  model_version: '20251001',
  per_photo: [],   // one entry per photo if Claude returns per-photo breakdown; else single aggregate-only
  aggregate: {
    aesthetic_score: claude.aesthetic_score,
    lighting: claude.lighting,
    composition: claude.composition,
    subject_clarity: claude.subject_clarity,
    primary_subject: claude.primary_subject,
    vibe_tags: sanitize_enum(claude.vibe_tags, ALLOWED_VIBE_TAGS),
    appropriate_for: sanitize_enum(claude.appropriate_for, MINGLA_SIGNAL_IDS),
    inappropriate_for: sanitize_enum(claude.inappropriate_for, MINGLA_SIGNAL_IDS),
    safety_flags: sanitize_enum(claude.safety_flags, ALLOWED_SAFETY_FLAGS),
    photo_quality_notes: claude.photo_quality_notes
  },
  cost_usd: input_tokens * 0.00000050 + cached_tokens * 0.00000010 + output_tokens * 0.00000250
};
await supabase.from('place_pool').update({ photo_aesthetic_data: final }).eq('id', place.id);
```

The `sanitize_enum` step (per D-INV-3): drop any tag not in the documented enum, log it for prompt evolution.

### 4.6 Error contract

- Per-place permanent failure (Claude returned malformed JSON, network 4xx, refused content): write sentinel `{ photos_fingerprint, scored_at, model, error: 'reason', __scoring_failed__: true }` to `place_pool.photo_aesthetic_data`. Skip on next run unless `force_rescore=true`.
- Per-batch transient failure (Anthropic 500, rate limit): exponential backoff 3 retries within `run_next_batch`, then mark batch `failed`. Operator retries via `retry_batch`.

### 4.7 Auth + RLS

- Edge function checks JWT + `admin_users` membership (mirrors `backfill-place-photos` lines 47-64).
- `place_pool` write via service_role client (bypasses RLS — same as bouncer + signal scorer).
- New tables: service_role-only RLS policies (already in §3 SQL).

---

## 5. Prompt Design

### 5.1 System prompt (CACHED — single source of truth)

```
You are Mingla's place-photo aesthetic analyzer. You receive 1-5 photos of a place plus its name and Google primary type. You return ONE structured score using the photo_aesthetic_score tool.

# Mingla's 16 signal categories (signal IDs — these are the values you must use in `appropriate_for` and `inappropriate_for` arrays below)
fine_dining: upscale restaurants, occasion dining, tasting menus, refined ambience
brunch: breakfast/brunch venues, daytime food, bright/airy
casual_food: everyday restaurants, lunch/dinner, all cuisines
drinks: bars, cocktail lounges, nightlife, beer, wine, late-night
romantic: intimate, candle-lit, date-night, occasion-appropriate
icebreakers: light & fun first-meet venues — cafes, dessert, casual day spots
lively: high-energy, social, music, dancing, nightclubs
movies: cinemas, drive-ins
theatre: performing arts, concert halls, opera
creative_arts: galleries, museums, art studios
play: amusement, bowling, mini golf, arcades, escape rooms
nature: parks, gardens, trails, outdoor scenic spots
scenic: viewpoints, observation decks, photogenic outdoor places
picnic_friendly: parks/lawns suitable for picnics
groceries: grocery stores, supermarkets
flowers: florists, flower markets

# Your task
Look at all photos. Score the place holistically. Return one JSON object.

# Field definitions

aesthetic_score: 1.0-10.0 (numeric, one decimal). Holistic photo quality + composition + lighting. 1=poor amateur snapshot, 5=acceptable Google business photo, 7=well-composed professional, 9-10=stunning editorial-quality.

lighting: ONE of: bright_daylight, warm_intimate, dim_moody, candle_lit, neon_party, fluorescent_clinical, natural_outdoor, mixed, unclear

composition: ONE of: strong, average, weak

subject_clarity: ONE of: clear, partial, unclear (is the subject of each photo clearly visible?)

primary_subject: ONE of: food, drinks, ambience, exterior, people, art, nature, products, mixed (what dominates the photo set?)

vibe_tags: ARRAY of any-applicable from: fine_dining, casual, intimate, lively, party, family_friendly, romantic, candle_lit, brunchy, food_forward, cocktail_focused, outdoor, scenic, artsy, cozy, modern, rustic, upscale, divey, bright, dim, professional, amateur, photogenic. Pick 1-5 most applicable.

appropriate_for: ARRAY of Mingla category ids (from list above) where this place's photos suggest it would be a strong recommendation. Be generous but accurate (typical 1-3 categories).

inappropriate_for: ARRAY of Mingla category ids where this place would be a poor recommendation despite Google's classification. Use sparingly — only when photos clearly contradict a category fit (e.g., a sex club's photos clearly inappropriate_for fine_dining + brunch + family contexts even though Google may tag it night_club). Typical 0-3 categories.

safety_flags: ARRAY from: adult_content, explicit_imagery, weapons, drugs, none. Default empty.

photo_quality_notes: 1-2 sentence string. Plain English notes for human review (e.g., "Warm intimate lighting, food-forward shots, strong composition").

# Critical rules
- Be HONEST about poor photos. Don't inflate aesthetic_score for venues with weak photos.
- inappropriate_for is the strongest signal — use it when Google's classification is misleading the consumer.
- safety_flags catches adult/inappropriate content even when Google tagged the place blandly.
- vibe_tags must come from the enum. If a venue's vibe doesn't match any tag, leave the array empty rather than inventing.
```

### 5.2 Tool schema (structured output — Claude's `tool_use` pattern)

```typescript
const PHOTO_AESTHETIC_TOOL = {
  name: 'photo_aesthetic_score',
  description: 'Return the structured photo aesthetic score for the place.',
  input_schema: {
    type: 'object',
    required: ['aesthetic_score','lighting','composition','subject_clarity','primary_subject','vibe_tags','appropriate_for','inappropriate_for','safety_flags','photo_quality_notes'],
    properties: {
      aesthetic_score:    { type: 'number', minimum: 1, maximum: 10 },
      lighting:           { type: 'string', enum: ['bright_daylight','warm_intimate','dim_moody','candle_lit','neon_party','fluorescent_clinical','natural_outdoor','mixed','unclear'] },
      composition:        { type: 'string', enum: ['strong','average','weak'] },
      subject_clarity:    { type: 'string', enum: ['clear','partial','unclear'] },
      primary_subject:    { type: 'string', enum: ['food','drinks','ambience','exterior','people','art','nature','products','mixed'] },
      vibe_tags:          { type: 'array', items: { type: 'string' } },           // sanitized server-side
      appropriate_for:    { type: 'array', items: { type: 'string' } },           // sanitized server-side
      inappropriate_for:  { type: 'array', items: { type: 'string' } },
      safety_flags:       { type: 'array', items: { type: 'string', enum: ['adult_content','explicit_imagery','weapons','drugs','none'] } },
      photo_quality_notes:{ type: 'string', maxLength: 300 }
    }
  }
};
```

### 5.3 User prompt (per place)

```
Place: "{place_name}" (Google primary_type: {primary_type}). {N} photos above. Score per the system prompt.
```

(Image content blocks precede the text in the same user message — see §4.3.)

---

## 6. Scorer Extension Layer

### 6.1 Update `signalScorer.ts` — add 7 new prefix matchers

Insert after the existing `price_range_end_above_*` block ([signalScorer.ts:117-128](supabase/functions/_shared/signalScorer.ts#L117-L128)):

```typescript
// ORCH-0708 (Wave 2 Phase 1) — JSONB-aware photo aesthetic matchers.
// All read from place.photo_aesthetic_data.aggregate (NULL = no contribution).
const aesthetic = (place as any).photo_aesthetic_data?.aggregate;

// photo_aesthetic_above_<threshold>: numeric threshold
if (field.startsWith('photo_aesthetic_above_')) {
  const threshold = parseFloat(field.slice('photo_aesthetic_above_'.length));
  if (Number.isFinite(threshold) && aesthetic?.aesthetic_score != null && aesthetic.aesthetic_score > threshold) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_lighting_<value>: scalar enum match
if (field.startsWith('photo_lighting_')) {
  const target = field.slice('photo_lighting_'.length);
  if (aesthetic?.lighting === target) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_composition_<value>
if (field.startsWith('photo_composition_')) {
  const target = field.slice('photo_composition_'.length);
  if (aesthetic?.composition === target) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_subject_<value>
if (field.startsWith('photo_subject_')) {
  const target = field.slice('photo_subject_'.length);
  if (aesthetic?.primary_subject === target) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_vibe_includes_<tag>: array membership
if (field.startsWith('photo_vibe_includes_')) {
  const target = field.slice('photo_vibe_includes_'.length);
  if (Array.isArray(aesthetic?.vibe_tags) && aesthetic.vibe_tags.includes(target)) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_appropriate_for_includes_<signal>: array membership
if (field.startsWith('photo_appropriate_for_includes_')) {
  const target = field.slice('photo_appropriate_for_includes_'.length);
  if (Array.isArray(aesthetic?.appropriate_for) && aesthetic.appropriate_for.includes(target)) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_inappropriate_for_includes_<signal>
if (field.startsWith('photo_inappropriate_for_includes_')) {
  const target = field.slice('photo_inappropriate_for_includes_'.length);
  if (Array.isArray(aesthetic?.inappropriate_for) && aesthetic.inappropriate_for.includes(target)) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
// photo_safety_includes_<flag>
if (field.startsWith('photo_safety_includes_')) {
  const target = field.slice('photo_safety_includes_'.length);
  if (Array.isArray(aesthetic?.safety_flags) && aesthetic.safety_flags.includes(target)) {
    contribs[field] = weight;
    score += weight;
  }
  continue;
}
```

Total LOC delta: ~70 lines. Backward compatible — places without `photo_aesthetic_data` (NULL) get zero contribution from all new patterns, consistent with existing NULL semantics.

### 6.2 Update `PlaceForScoring` interface

Add at the end of [signalScorer.ts:34-63](supabase/functions/_shared/signalScorer.ts#L34-L63):

```typescript
photo_aesthetic_data?: {
  aggregate?: {
    aesthetic_score?: number;
    lighting?: string;
    composition?: string;
    subject_clarity?: string;
    primary_subject?: string;
    vibe_tags?: string[];
    appropriate_for?: string[];
    inappropriate_for?: string[];
    safety_flags?: string[];
  };
} | null;
```

### 6.3 Update `run-signal-scorer` SELECT_FIELDS

[run-signal-scorer/index.ts:21-27](supabase/functions/run-signal-scorer/index.ts#L21-L27) — append `photo_aesthetic_data` to the SELECT_FIELDS string:

```typescript
const SELECT_FIELDS =
  'id, rating, review_count, types, price_level, price_range_start_cents, price_range_end_cents,' +
  ' editorial_summary, generative_summary, reviews,' +
  ' serves_dinner, serves_lunch, serves_breakfast, serves_brunch,' +
  ' serves_wine, serves_cocktails, serves_dessert, serves_vegetarian_food,' +
  ' reservable, dine_in, delivery, takeout,' +
  ' allows_dogs, good_for_groups, good_for_children, outdoor_seating, live_music,' +
  ' photo_aesthetic_data';   // ORCH-0708: Wave 2 Phase 1
```

### 6.4 Test fixture (Deno test addition)

`supabase/functions/_shared/__tests__/scorer.test.ts` — add a fixture place with full `photo_aesthetic_data` and verify new matchers fire:

```typescript
Deno.test('ORCH-0708 photo_aesthetic_above_<threshold> fires when score exceeds threshold', () => {
  const place = { rating: 4.5, review_count: 100, photo_aesthetic_data: { aggregate: { aesthetic_score: 8.2 } } };
  const config = { ...minConfig, field_weights: { photo_aesthetic_above_7: 25 } };
  const result = computeScore(place, config);
  assertEquals(result.contributions.photo_aesthetic_above_7, 25);
});
// + similar tests for each of the 7 new prefixes
// + NULL test: photo_aesthetic_data = null → no contributions
```

---

## 7. Signal Config Updates (5 v_next migrations)

For each of these signals, write a v_next migration that follows the **ORCH-0702 pattern** (read live config, merge new field_weights, raise cap, insert new version row, flip current_version_id, idempotent guard):

### 7.1 `fine_dining v1.3.0` (current: v1.2.0)

New field weights (added to existing):
```
photo_aesthetic_above_7:                    +30
photo_aesthetic_above_8:                    +20    (stacks with above_7 → 50 total at score 8+)
photo_lighting_warm_intimate:               +20
photo_lighting_candle_lit:                  +25
photo_lighting_dim_moody:                   +10
photo_lighting_fluorescent_clinical:        -30
photo_subject_food:                         +15
photo_composition_strong:                   +20
photo_appropriate_for_includes_fine_dining: +40
photo_inappropriate_for_includes_fine_dining: -150
photo_vibe_includes_upscale:                +20
photo_vibe_includes_divey:                  -30
photo_safety_includes_adult_content:        -200
photo_safety_includes_explicit_imagery:     -200
```

**Cap:** raise to 1000.

### 7.2 `brunch v1.5.0` (current: v1.4.0)

```
photo_aesthetic_above_7:                    +25
photo_lighting_bright_daylight:             +20
photo_lighting_natural_outdoor:             +15
photo_lighting_dim_moody:                   -15
photo_lighting_neon_party:                  -30
photo_subject_food:                         +20
photo_appropriate_for_includes_brunch:      +35
photo_inappropriate_for_includes_brunch:    -100
photo_vibe_includes_brunchy:                +25
photo_vibe_includes_bright:                 +15
photo_safety_includes_adult_content:        -200
```

**Cap:** raise to 1000.

### 7.3 `romantic v1.1.0` (current: v1.0.0)

```
photo_aesthetic_above_7:                    +25
photo_lighting_candle_lit:                  +35
photo_lighting_warm_intimate:               +30
photo_lighting_dim_moody:                   +10
photo_lighting_bright_daylight:             -15
photo_lighting_neon_party:                  -50
photo_appropriate_for_includes_romantic:    +40
photo_inappropriate_for_includes_romantic:  -150
photo_vibe_includes_intimate:               +25
photo_vibe_includes_candle_lit:             +20
photo_vibe_includes_party:                  -30
photo_safety_includes_adult_content:        -200
```

**Cap:** raise to 1000.

### 7.4 `lively v1.1.0` (current: v1.0.0)

```
photo_aesthetic_above_6:                    +15
photo_lighting_neon_party:                  +25
photo_lighting_dim_moody:                   +15
photo_lighting_warm_intimate:               +10
photo_lighting_candle_lit:                  -10
photo_subject_people:                       +15
photo_appropriate_for_includes_lively:      +30
photo_inappropriate_for_includes_lively:    -100
photo_vibe_includes_lively:                 +25
photo_vibe_includes_party:                  +20
photo_vibe_includes_intimate:               -10
```

**Cap:** raise to 1000.

### 7.5 `casual_food v1.1.0` (current: v1.0.0)

```
photo_aesthetic_above_5:                    +10
photo_aesthetic_above_7:                    +15    (stacks with above_5)
photo_subject_food:                         +20
photo_composition_strong:                   +10
photo_lighting_fluorescent_clinical:        -10
photo_appropriate_for_includes_casual_food: +25
photo_inappropriate_for_includes_casual_food: -80
photo_safety_includes_adult_content:        -150
```

**Cap:** raise to 1000.

### 7.6 `drinks v1.5.0` (current: v1.4.0) — added to scope per orchestrator review

Drinks has 508 places at exactly cap=200 (3.5% — more than fine_dining or romantic). Photo aesthetic data adds value via lighting (dim/moody, neon_party, warm_intimate) and primary subject (drinks, ambience, people). Note: drinks INTENTIONALLY admits night_club venues per ORCH-0702 operator decision ("right place wrong context"); photo weights here don't change that policy.

```
photo_aesthetic_above_6:                    +15
photo_lighting_dim_moody:                   +20
photo_lighting_neon_party:                  +20
photo_lighting_warm_intimate:               +15
photo_lighting_fluorescent_clinical:        -25
photo_lighting_bright_daylight:             -15  (drinks is rarely a daytime activity)
photo_subject_drinks:                       +20
photo_subject_people:                       +10
photo_appropriate_for_includes_drinks:      +30
photo_inappropriate_for_includes_drinks:    -100
photo_vibe_includes_cocktail_focused:       +15
photo_vibe_includes_lively:                 +10
photo_vibe_includes_dim:                    +10
photo_safety_includes_adult_content:         0   (drinks admits adult venues — operator decision)
```

**Cap:** raise to 1000.

### 7.7 `icebreakers v1.1.0` (current: v1.0.0) — added to scope per orchestrator review

Icebreakers has 384 places at cap=200 (2.7% — more than fine_dining or romantic). Photos extremely relevant for the icebreakers vibe: bright cafes, cozy dessert spots, photogenic settings. Cocktail-bar / nightclub venues correctly excluded by existing config (`types_includes_night_club: -80`).

```
photo_aesthetic_above_6:                    +15
photo_aesthetic_above_8:                    +15  (stacks)
photo_lighting_bright_daylight:             +20
photo_lighting_warm_intimate:               +15
photo_lighting_natural_outdoor:             +10
photo_lighting_dim_moody:                   -20
photo_lighting_neon_party:                  -40
photo_subject_food:                         +10
photo_subject_drinks:                       +10
photo_subject_ambience:                     +15
photo_composition_strong:                   +15
photo_appropriate_for_includes_icebreakers: +30
photo_inappropriate_for_includes_icebreakers: -100
photo_vibe_includes_cozy:                   +20
photo_vibe_includes_photogenic:             +15
photo_vibe_includes_party:                  -30
photo_safety_includes_adult_content:        -200
```

**Cap:** raise to 1000.

### 7.6 Migration template (each of the 5 follows this shape, with appropriate values)

```sql
-- Migration: 20260501000008_orch_0704_fine_dining_v1_3_0_photo_aesthetic_weights.sql
BEGIN;
DO $$
DECLARE
  v_current_version_id uuid;
  v_current_config     jsonb;
  v_new_config         jsonb;
  v_new_version_id     uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.signal_definition_versions
    WHERE signal_id = 'fine_dining' AND version_label = 'v1.3.0'
  ) THEN
    RAISE NOTICE 'ORCH-0708: fine_dining v1.3.0 already exists; skipping.';
    RETURN;
  END IF;

  SELECT sd.current_version_id, sdv.config
    INTO v_current_version_id, v_current_config
  FROM public.signal_definitions sd
  JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
  WHERE sd.id = 'fine_dining';

  IF v_current_version_id IS NULL OR v_current_config IS NULL THEN
    RAISE EXCEPTION 'ORCH-0708: fine_dining live config not found';
  END IF;

  v_new_config := jsonb_set(
    jsonb_set(v_current_config, '{cap}', to_jsonb(1000::int)),
    '{field_weights}',
    (v_current_config -> 'field_weights') || jsonb_build_object(
      'photo_aesthetic_above_7', 30,
      'photo_aesthetic_above_8', 20,
      'photo_lighting_warm_intimate', 20,
      'photo_lighting_candle_lit', 25,
      'photo_lighting_dim_moody', 10,
      'photo_lighting_fluorescent_clinical', -30,
      'photo_subject_food', 15,
      'photo_composition_strong', 20,
      'photo_appropriate_for_includes_fine_dining', 40,
      'photo_inappropriate_for_includes_fine_dining', -150,
      'photo_vibe_includes_upscale', 20,
      'photo_vibe_includes_divey', -30,
      'photo_safety_includes_adult_content', -200,
      'photo_safety_includes_explicit_imagery', -200
    )
  );

  -- Assertion: cap correctly set
  IF (v_new_config ->> 'cap')::numeric != 1000 THEN
    RAISE EXCEPTION 'ORCH-0708: cap merge failed';
  END IF;

  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'fine_dining', 'v1.3.0', v_new_config,
    'ORCH-0708 (Wave 2 Phase 1): photo_aesthetic_data field weights added; cap raised 200→1000. ' ||
    'Prior version_id=' || v_current_version_id::text || '. ' ||
    'Photo data populated by score-place-photo-aesthetics; NULL = no contribution.'
  )
  RETURNING id INTO v_new_version_id;

  UPDATE public.signal_definitions
  SET current_version_id = v_new_version_id, updated_at = now()
  WHERE id = 'fine_dining';

  RAISE NOTICE 'ORCH-0708: fine_dining v1.3.0 inserted id=%', v_new_version_id;
END $$;
COMMIT;
```

---

## 8. Cap Decision (locked = Option B)

Per investigation §6: **raise `cap` from 200 → 1000 on the 7 signals receiving photo weights** (`fine_dining, brunch, romantic, lively, casual_food, drinks, icebreakers`). Other 9 signals stay at cap=200 (their cap compression is ≤0.4% — no current need).

`clamp_min` stays 0 across all signals. `min_rating`, `min_reviews`, `bypass_rating` unchanged.

filter_min thresholds at the serving layer (`120` for most chips) STAY ABSOLUTE. Re-evaluate after first re-score in Raleigh/Cary/Durham.

---

## 9. Test Plan — Raleigh + Cary + Durham

### 9.1 Pre-state snapshot (orchestrator-driven, before deploy)

```sql
-- Save to: outputs/ORCH-0708_PRE_STATE_SNAPSHOT.json
SELECT
  sc.name AS city, ps.signal_id, pp.id AS place_id, pp.name, pp.rating, pp.review_count,
  ps.score, ps.signal_version_id, ps.contributions
FROM place_scores ps
JOIN place_pool pp ON pp.id = ps.place_id
JOIN seeding_cities sc ON sc.id = pp.city_id
JOIN signal_definitions sd ON sd.id = ps.signal_id
WHERE sc.name ILIKE ANY (ARRAY['raleigh','cary','durham'])
  AND ps.signal_id IN ('fine_dining','brunch','romantic','lively','casual_food')
  AND ps.signal_version_id = sd.current_version_id
  AND pp.is_servable = true AND pp.is_active = true
ORDER BY sc.name, ps.signal_id, ps.score DESC
LIMIT 300;  -- ~ top 20 per city per signal
```

### 9.2 Photo-scoring backfill

```bash
# 1. Operator/orchestrator invokes preview to confirm scope + cost
curl -X POST {url}/functions/v1/score-place-photo-aesthetics \
  -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" \
  -d '{"action":"preview_run","scope_type":"city","city":"Raleigh","batch_size":25}'
# Repeat for Cary + Durham

# Expected: total_places ≈ 1715 + 820 + 699 = 3234, total_batches ≈ 130, estimated_cost_usd ≈ 11

# 2. Create runs (one per city for traceability)
curl ... -d '{"action":"create_run","scope_type":"city","city":"Raleigh","batch_size":25}'
# Repeat for Cary + Durham

# 3. Run all batches (loop in admin UI or shell script)
for run_id in $RUN_IDS; do
  while true; do
    STATUS=$(curl ... -d "{\"action\":\"run_next_batch\",\"run_id\":\"$run_id\"}")
    echo "$STATUS"
    [ "$(echo "$STATUS" | jq -r '.run.status')" = "completed" ] && break
    sleep 2
  done
done
```

### 9.3 Audit (orchestrator + operator)

Random sample 20 scored places per city (60 total):
```sql
SELECT id, name, primary_type, photo_aesthetic_data
FROM place_pool pp
JOIN seeding_cities sc ON sc.id = pp.city_id
WHERE sc.name ILIKE ANY (ARRAY['raleigh','cary','durham'])
  AND photo_aesthetic_data IS NOT NULL
ORDER BY random()
LIMIT 60;
```
Spot-check: do `aesthetic_score`, `lighting`, `vibe_tags`, `appropriate_for`, `inappropriate_for` look reasonable for the actual venue + photos? Any safety flags fired correctly? Any obvious miscategorizations?

### 9.4 Signal config v_next migrations + re-score

Apply the 5 migrations from §7. Then:
```bash
for sig in fine_dining brunch romantic lively casual_food; do
  curl ... -d "{\"signal_id\":\"$sig\",\"all_cities\":true}"
done
```

### 9.5 Post-state snapshot

Same query as §9.1 → `outputs/ORCH-0708_POST_STATE_SNAPSHOT.json`.

### 9.6 Diff analysis

```sql
-- Find places that moved >30 points up or down
WITH pre AS (...load pre_state...), post AS (...load post_state...)
SELECT pre.city, pre.signal_id, pre.name, pre.score AS pre_score, post.score AS post_score,
       (post.score - pre.score) AS delta
FROM pre JOIN post USING (place_id, signal_id)
WHERE ABS(post.score - pre.score) > 30
ORDER BY pre.signal_id, delta DESC;
```

### 9.7 Operator smoke

Operator pulls the Discover deck for `fine_dining` in Raleigh (mobile or admin preview). Gut-checks the top 10. PASS = top 10 are real fine-dining venues, no obvious miscategorizations, no Trapeze-class leaks.

---

## 10. Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| AC-1 | `place_pool.photo_aesthetic_data jsonb` column exists with documented schema | `\d place_pool` includes column |
| AC-2 | `photo_aesthetic_runs` + `photo_aesthetic_batches` tables created with RLS | `\dt + \d` |
| AC-3 | `score-place-photo-aesthetics` edge function deployed and responds to `preview_run` | curl returns expected shape |
| AC-4 | `signalScorer.ts` has 7 new prefix matchers; existing tests pass; new fixture tests pass | `deno test` PASS |
| AC-5 | `run-signal-scorer` SELECT_FIELDS includes `photo_aesthetic_data`; redeployed | grep + edge-function endpoint test |
| AC-6 | All 5 signal v_next migrations applied; `current_version_id` flipped on all 5 | live DB query |
| AC-7 | Photo-aesthetic backfill completes for Raleigh + Cary + Durham; ≥99% of eligible places have non-null `photo_aesthetic_data` | live DB count |
| AC-8 | Re-score completes for all 5 signals; `place_scores.signal_version_id` matches new v_next | live DB query |
| AC-9 | Diff analysis: top-20 fine_dining cards in Raleigh shift meaningfully (≥5 places change rank); operator smoke PASS | manual review |
| AC-10 | No Trapeze-class regression: any sex-club / strip-club venue in Raleigh/Cary/Durham (if any exist) has `photo_inappropriate_for_includes_fine_dining` flag and scores <30 on fine_dining | spot-check |
| AC-11 | Cost actuals come in under $50 (≤4× projected ~$11) | sum(actual_cost_usd) from photo_aesthetic_runs |
| AC-12 | tsc EXIT=0 across signalScorer.ts and run-signal-scorer changes | tsc |
| AC-13 | Idempotency: re-running `create_run` with same scope skips already-scored places (unless `force_rescore=true`) | manual test |
| AC-14 | Bouncer untouched (grep verifies); admin-seed-places FieldMask + UPDATE block do NOT include `photo_aesthetic_data` | grep |
| AC-15 | I-PHOTO-AESTHETIC-DATA-SOLE-OWNER codified: only `score-place-photo-aesthetics` writes to the column | grep |

---

## 11. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Migration is idempotent | Re-run all 8 migrations | NOTICE: skipping; no duplicate rows | DB |
| T-02 | New scorer matcher fires | Place with `aesthetic_score: 8.2`, signal config has `photo_aesthetic_above_7: 25` | `contributions.photo_aesthetic_above_7 = 25` | Scorer |
| T-03 | NULL photo_aesthetic_data is silent | Place with `photo_aesthetic_data: null`, photo weights in config | All photo weights contribute zero | Scorer |
| T-04 | Idempotent backfill | Run same scope twice, no `force_rescore` | Second run skips all places (already scored) | Edge fn |
| T-05 | Rotation triggers re-score | Manually update `stored_photo_urls`, run backfill | Place re-enters scoring queue (fingerprint mismatch) | Edge fn |
| T-06 | Trapeze class blocked from fine_dining via photo signal | (No Trapeze in test cities, but) any `inappropriate_for` includes 'fine_dining' → -150 | Score drops below filter_min | Scorer + DB |
| T-07 | Anthropic Batch API integration | Submit 25-place batch | Returns `anthropic_batch_id`; poll → `ended`; results parsed; place_pool updated | Edge fn |
| T-08 | Sanitization drops unknown vibe_tags | Claude returns `vibe_tags: ['fine_dining', 'kawaii']` | Persisted as `['fine_dining']`; 'kawaii' logged for prompt evolution | Edge fn |
| T-09 | Per-place permanent failure persists sentinel | Force a Claude refusal | `photo_aesthetic_data = { __scoring_failed__: true, error: ..., photos_fingerprint: ... }`; skipped on subsequent runs | Edge fn |
| T-10 | Cap raise preserves existing scores ≤200 | Trapeze fine_dining was 21.09 (post-ORCH-0702); after re-score with v1.3.0 + photo data | Score may shift modestly if photos contribute, but cap=1000 doesn't artificially boost it | Scorer |
| T-11 | run-signal-scorer reads new column | Invoke for fine_dining; check returned scored_count | Reads `photo_aesthetic_data` for every place; non-null places get photo contributions | Edge fn |
| T-12 | Admin-seed-places does NOT touch photo_aesthetic_data | Re-seed Raleigh from admin | After re-seed, sample place still has `photo_aesthetic_data` populated | Carve-out test |
| T-13 | Bouncer does NOT read photo_aesthetic_data | Re-run bouncer for Raleigh | No grep matches in bouncer.ts; bouncer SELECT fields don't include photo_aesthetic_data | Carve-out test |
| T-14 | Cost projection accuracy | After Raleigh+Cary+Durham complete | Sum(`actual_cost_usd`) within ±50% of estimate (~$11) | DB |
| T-15 | Non-blocking 404 on missing photo bucket | Manually corrupt one stored_photo_url | Place fails gracefully; sentinel persisted; run continues | Edge fn |

---

## 12. Invariant Preservation

| Invariant | Status | How preserved |
|---|---|---|
| `I-SIGNAL-CONTINUOUS` | PRESERVED | Score remains 0-cap numeric (cap raised to 1000 on 5 signals) |
| `I-SCORE-NON-NEGATIVE` | PRESERVED | clamp_min stays 0 |
| `I-BOUNCER-DETERMINISTIC` | PRESERVED | Bouncer not modified |
| `I-FIELD-MASK-SINGLE-OWNER` | PRESERVED | New column NOT in admin-seed-places FIELD_MASK |
| `I-REFRESH-NEVER-DEGRADES` | PRESERVED | New column NOT in admin-seed-places per-row UPDATE — protective comment added |
| `I-PLACE-POOL-ADMIN-WRITE-ONLY` | PRESERVED | New column written by service_role only (via new edge function) |
| `I-DINING-SIGNAL-NIGHTLIFE-PENALTY` (ORCH-0702) | PRESERVED | All v_next migrations preserve existing nightlife penalties |
| `I-SERVING-TWO-GATE` (ORCH-0598.11) | PRESERVED | Serving RPCs unchanged |
| **NEW: `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER`** | NEW | `place_pool.photo_aesthetic_data` is written ONLY by `score-place-photo-aesthetics` edge function. CI gate via grep on PR. Codified in INVARIANT_REGISTRY.md by orchestrator at CLOSE. |
| **NEW: `I-PHOTO-AESTHETIC-CACHE-FINGERPRINT`** | NEW | Edge function MUST write `photo_aesthetic_data.photos_fingerprint` derived from `sha256(stored_photo_urls.slice(0,5).join('\|'))`. Skip on re-run when fingerprint matches. Codified at CLOSE. |

---

## 13. Implementation Order

1. **Migration 1** (`20260501000006`): add `place_pool.photo_aesthetic_data` column.
2. **Migration 2** (`20260501000007`): create `photo_aesthetic_runs` + `photo_aesthetic_batches` tables.
3. **Edge function:** new `supabase/functions/score-place-photo-aesthetics/index.ts` + shared helper. Deploy.
4. **Scorer extension:** modify [signalScorer.ts](supabase/functions/_shared/signalScorer.ts) (+~70 LOC). Update Deno tests.
5. **run-signal-scorer SELECT_FIELDS** extension: modify [run-signal-scorer/index.ts](supabase/functions/run-signal-scorer/index.ts). Redeploy.
6. **Migrations 3-7** (`20260501000008` through `20260501000012`): 5 signal v_next configs.
7. **Operator deploys all migrations** via `supabase db push`.
8. **Operator runs photo-aesthetic backfill** for Raleigh / Cary / Durham (preview + create_run + batch loop).
9. **Operator audits** sample 60 places + cost.
10. **Operator re-runs signal scorer** for the 5 signals.
11. **Orchestrator runs diff analysis** + smoke.
12. **Orchestrator runs CLOSE protocol** if PASS.

---

## 14. Rollback Plan

### Photo aesthetic data
```sql
-- Drop the column (if needed)
ALTER TABLE public.place_pool DROP COLUMN IF EXISTS photo_aesthetic_data;
-- OR: keep the column, just clear the data
UPDATE public.place_pool SET photo_aesthetic_data = NULL WHERE photo_aesthetic_data IS NOT NULL;
-- Drop the run-tracking tables
DROP TABLE IF EXISTS public.photo_aesthetic_batches CASCADE;
DROP TABLE IF EXISTS public.photo_aesthetic_runs CASCADE;
```

### Signal configs
For each of the 5 signals, revert via the standard pattern (mirrors ORCH-0702 rollback):
```sql
-- 1. Find the prior version_id
SELECT id FROM public.signal_definition_versions
WHERE signal_id = 'fine_dining' AND version_label != 'v1.3.0'
ORDER BY created_at DESC LIMIT 1;
-- 2. Revert
BEGIN;
UPDATE public.signal_definitions
SET current_version_id = '<PRIOR_ID>'::uuid, updated_at = now()
WHERE id = 'fine_dining';
DELETE FROM public.signal_definition_versions
WHERE signal_id = 'fine_dining' AND version_label = 'v1.3.0';
COMMIT;
-- 3. Re-run signal scorer to restore prior scores
```

### Edge function + scorer extension
Standard `supabase functions deploy` rollback (redeploy prior commit). Or remove the new prefix matchers from `signalScorer.ts` (backward compatible — places with `photo_aesthetic_data` populated will simply not get those weights).

---

## 15. Cost Projection Lock

| Scenario | Per-place | Total (3,234 places) |
|---|---|---|
| **Recommended: Haiku 4.5 batch + 5min cache** | $0.0035 | **~$11** |
| Haiku 4.5 batch (no cache) | $0.005 | $16 |
| Haiku 4.5 base (sync, no batch, no cache) | $0.0066 | $21 |
| Sonnet 4.6 batch + cache (alternative for quality) | $0.011 | $36 |

**Operator approval threshold ($200) is not crossed.** Implementor proceeds without escalation.

If cost actuals come in materially higher than projection (e.g., >$30 for the 3 cities), implementor pauses + reports to orchestrator before continuing.

---

## 16. Open Questions (with default-yes/default-no recommendations)

| OQ | Question | Recommendation |
|---|---|---|
| OQ-1 | Should photo backfill run synchronously per-place or use Anthropic Batch API? | **Default-yes Batch API.** 50% cost savings; 1-6 hour SLA acceptable for a 3-city test. Implementor MAY support sync mode via `use_batch_api: false` parameter for ad-hoc single-place re-scoring during testing. |
| OQ-2 | Should we score all 5 photos in one Claude call OR one photo per call (5 calls per place)? | **Default-yes one call per place with all 5 images.** Better aggregation reasoning (Claude compares across photos), fewer API calls (less rate limit pressure), similar cost. The structured aggregate is what the scorer reads. |
| OQ-3 | Should sanitize_enum log unknown tags to a separate `photo_aesthetic_unknown_tags` table for prompt evolution? | **Default-yes.** Trivial table, valuable signal for prompt iteration. Add as Migration 1.5. |
| OQ-4 | Should the spec ship safety_flags weights on the 5 signals (e.g., fine_dining `photo_safety_includes_adult_content: -200`)? | **Default-yes** (already in §7.1, §7.2, §7.3, §7.5). Belt-and-suspenders against future adult-venue surprises that the bouncer's deterministic rules would miss (operator's "right place wrong context" still holds — drinks doesn't have this penalty). |
| OQ-5 | Should we keep the existing `min_rating` + `min_reviews` hard gates? | **Default-yes.** They keep ineligible places from accumulating photo-driven scores. Photo data does not replace popularity gating. |
| OQ-6 | Should `score-place-photo-aesthetics` invoke `run-signal-scorer` automatically when a run completes? | **Default-no.** Keep them separate to give the operator manual control over re-score timing. May revisit in a later cycle once the pattern is proven. |
| OQ-7 | Should the spec include a Sonnet 4.6 spot-check sample (100 random places) as a quality benchmark? | **Default-no this cycle.** Adds complexity. Trust Haiku 4.5 vision for v1; if quality looks weak in the §9.7 operator smoke, revisit in v2. |

---

## 17. Regression Prevention

- **CI grep gate** (codify in CONTRIBUTING.md or pre-commit hook): any PR that touches `signalScorer.ts` field-weight matchers must include test fixtures for the new pattern. Any PR that touches `place_pool` SELECTs must include `photo_aesthetic_data` if the consumer is `run-signal-scorer`. Any PR that adds a new writer of `photo_aesthetic_data` outside the new edge function must explicitly justify it in the PR description (violates `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER`).
- **Protective comment** in `admin-seed-places/index.ts` per-row UPDATE block (per §3.4).
- **Protective comment** in `signalScorer.ts` near the new matchers explaining the JSONB read pattern.
- **Decision Log entry**: orchestrator codifies the cap-raise decision (Option B) in DECISION_LOG.md so future weight-tuning passes know the budget.

---

## 18. Path-to-CLOSE

CONDITIONAL pattern (matches ORCH-0702): backend-only, mechanical verification via SQL probes + operator smoke, no formal tester needed.

On operator smoke PASS:
1. Orchestrator runs full 7-doc CLOSE protocol.
2. Codify `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` + `I-PHOTO-AESTHETIC-CACHE-FINGERPRINT` invariants in INVARIANT_REGISTRY.md.
3. Codify cap-raise decision in DECISION_LOG.md.
4. Provide commit message.
5. **EAS update SKIP** — pure backend, no mobile bundle change.
6. Announce next: extend photo-aesthetic backfill to remaining cities (DC, Baltimore, FL, Lagos, Charlotte, etc.) — pure operator-driven runs, no new code. After full-pool coverage, file ORCH-0709 (per-city percentile serving) as the next Wave 2 design cycle.

If smoke FAIL or quality is weaker than expected:
- Diff analysis identifies which weights need adjustment → file v_next+1 migration with tuned magnitudes (no new schema/code; pure config).
- If photos themselves are problematic (Claude scoring weird) → revisit prompt OR escalate to Sonnet 4.6 for a sample.
- If the architectural shape is wrong (rare) → REJECT verdict, re-spec.

---

## 19. Asymmetric Per-Signal Weight Design Rationale

This is the mental model the implementor MUST internalize before writing the v_next migrations: **photo data is captured ONCE per place, scored DIFFERENTLY by each signal**. Same JSONB blob in `place_pool.photo_aesthetic_data.aggregate`; each signal's `field_weights` decides what those features are worth FOR THAT SIGNAL'S CONTEXT.

### The principle
Identical pattern to how `serves_brunch: true` gives +65 to brunch and 0 to fine_dining today — data is shared, interpretation is per-signal. This must hold for photo data too. **Do NOT define a single "photo_score" weight that's reused identically across all signals.** That would collapse the design into a single popularity-style proxy and erase the differentiation gain.

### Required asymmetry — concrete examples

The same lighting value contributes very differently across signals (these are the magnitudes already locked in §7):

| Lighting | fine_dining | brunch | romantic | lively | drinks | icebreakers | casual_food |
|---|---|---|---|---|---|---|---|
| `warm_intimate` | **+20** | 0 | **+30** | +10 | +15 | +15 | 0 |
| `candle_lit` | **+25** | 0 | **+35** | **-10** | 0 | 0 | 0 |
| `bright_daylight` | 0 | **+20** | **-15** | 0 | **-15** | **+20** | 0 |
| `dim_moody` | +10 | **-15** | +10 | +15 | **+20** | **-20** | 0 |
| `neon_party` | 0 | **-30** | **-50** | **+25** | **+20** | **-40** | 0 |
| `fluorescent_clinical` | **-30** | 0 | 0 | 0 | **-25** | 0 | **-10** |
| `natural_outdoor` | 0 | +15 | 0 | 0 | 0 | +10 | 0 |

Same `appropriate_for` value contributes only to that signal:
- `appropriate_for: ['fine_dining']` fires `+40` in fine_dining ONLY (zero everywhere else)
- `appropriate_for: ['drinks']` fires `+30` in drinks ONLY
- A place tagged `appropriate_for: ['fine_dining', 'romantic']` gets `+40 fine_dining` AND `+40 romantic` from one Claude call — double benefit, but only in those two signals

Same `inappropriate_for` value:
- `inappropriate_for: ['fine_dining']` fires `-150` in fine_dining ONLY
- `inappropriate_for: ['brunch', 'icebreakers']` fires `-100` in brunch AND `-100` in icebreakers (separately)

### Worked end-to-end example (proves the design)

Place X: upscale steakhouse with candle-lit, food-forward, intimate photos. Claude returns aggregate `{ aesthetic_score: 8.5, lighting: "candle_lit", primary_subject: "food", vibe_tags: ["upscale","intimate"], appropriate_for: ["fine_dining","romantic"], inappropriate_for: ["icebreakers"] }`.

Photo contribution per signal (computed by reading §7 weight tables):

| Signal | Total photo Δ | Breakdown |
|---|---|---|
| fine_dining | **+170** | aesthetic_above_7(+30) + aesthetic_above_8(+20) + candle_lit(+25) + subject_food(+15) + composition_strong(+20) + appropriate_for_fine_dining(+40) + vibe_upscale(+20) |
| romantic | **+155** | aesthetic_above_7(+25) + candle_lit(+35) + appropriate_for_romantic(+40) + vibe_intimate(+25) + vibe_candle_lit(+20) + dim_moody-bonus(+10) |
| brunch | 0 | no candle/upscale weights apply |
| lively | -10 | candle_lit(-10) penalty |
| icebreakers | **-100** | inappropriate_for_icebreakers(-100) |
| drinks | +15 | warm_intimate-adjacent contributions only |
| casual_food | +25 | aesthetic_above_7(+15) + composition_strong(+10) |

Same Claude output. **+170 in fine_dining, -100 in icebreakers, 0 in brunch.** The asymmetry IS the design.

### Implementor enforcement
1. The 7 v_next migrations in §7 are written as 7 INDEPENDENT weight tables — no shared constants, no copy-paste of magnitudes across signals without intentional choice.
2. Implementor MUST verify in their report that no weight is identical across all 7 signals (test: any photo-pattern weight key that has the same value in 7+ signal configs is a bug).
3. Test fixture T-02 in §11 should be ELABORATED to score the same fixture place across 4+ signals and assert different total photo contributions per signal.

---

## 20. Prompt Quality Safeguards (7 enforcement layers)

Beyond the spec's existing structured-output protections (tool schema, enum constraints, server-side sanitization, cached system prompt), the implementor MUST ship these 7 enforcement layers:

### 20.1 Calibration examples baked into the system prompt

Append to the system prompt (§5.1) BEFORE the "Critical rules" section:

```
# Calibrated examples (anchors for your scoring)

EXAMPLE A — Upscale steakhouse, 5 photos: dim warm interior, plated entree close-ups, leather booth seating, dark wood, candle lit table.
RETURN: aesthetic_score: 8.5, lighting: warm_intimate, composition: strong, subject_clarity: clear, primary_subject: food, vibe_tags: [fine_dining, upscale, intimate], appropriate_for: [fine_dining, romantic], inappropriate_for: [icebreakers, family_friendly], safety_flags: [].

EXAMPLE B — Sunny brunch cafe, 5 photos: bright daylight, avocado toast and mimosas, white walls, plants, outdoor patio shot.
RETURN: aesthetic_score: 7.8, lighting: bright_daylight, composition: strong, subject_clarity: clear, primary_subject: food, vibe_tags: [brunchy, bright, casual, photogenic], appropriate_for: [brunch, casual_food, icebreakers], inappropriate_for: [romantic], safety_flags: [].

EXAMPLE C — Neon-lit bar, 5 photos: people dancing, strobe lights, cocktails being made, dim crowd shots.
RETURN: aesthetic_score: 6.5, lighting: neon_party, composition: average, subject_clarity: partial, primary_subject: people, vibe_tags: [lively, party, divey], appropriate_for: [drinks, lively], inappropriate_for: [fine_dining, brunch, romantic, icebreakers], safety_flags: [].

EXAMPLE D — Average Google business storefront, 5 photos: exterior daytime shot, generic interior, no people, no food close-ups.
RETURN: aesthetic_score: 4.5, lighting: bright_daylight, composition: weak, subject_clarity: partial, primary_subject: exterior, vibe_tags: [], appropriate_for: [], inappropriate_for: [], safety_flags: [].

EXAMPLE E — Strip club / adult venue: dim red lighting, suggestive poses, no food, alcohol-only signage.
RETURN: aesthetic_score: 5.0, lighting: dim_moody, composition: average, subject_clarity: partial, primary_subject: people, vibe_tags: [divey, lively], appropriate_for: [drinks], inappropriate_for: [fine_dining, brunch, romantic, icebreakers, casual_food], safety_flags: [adult_content].

EXAMPLE F — Generic coffee shop with table photos and lattes: warm wood interior, clear latte art shots, daytime light.
RETURN: aesthetic_score: 6.5, lighting: warm_intimate, composition: average, subject_clarity: clear, primary_subject: drinks, vibe_tags: [cozy, casual, photogenic], appropriate_for: [icebreakers, casual_food], inappropriate_for: [fine_dining], safety_flags: [].
```

### 20.2 Anti-hedging instruction

Append to "Critical rules" in §5.1:

```
- DO NOT hedge. If you can reasonably commit to a value, commit. Choosing "unclear" or "mixed" or empty arrays when a directional answer is reasonably knowable is treated as no contribution downstream — directionally-correct guesses serve users better than safe abstentions.
- However, if the photos genuinely don't support a verdict (e.g., 5 exterior shots, no interior or food visible), then "unclear" is the honest answer. Don't invent.
```

### 20.3 Honest-grading rule

Append:

```
- DO NOT inflate aesthetic_score to be polite. Score honestly:
   1.0–3.0 = poor amateur snapshot, blurry, dark, off-center.
   3.0–5.0 = acceptable Google business photo, functional but not aesthetic.
   5.0–7.0 = well-composed semi-professional shot.
   7.0–9.0 = professional editorial-quality.
   9.0–10.0 = stunning, publication-grade.
   Most Google business photos cluster at 4–6. A score of 8+ should be rare and earned.
```

### 20.4 inappropriate_for discipline rule

Append:

```
- USE inappropriate_for SPARINGLY. Only when photos clearly contradict the venue's purpose for that category. Do NOT apply it lukewarmly to every place. Each entry triggers a -100 to -150 penalty downstream and should be reserved for real mismatches (e.g., a strip club's photos are inappropriate_for fine_dining + brunch + family contexts; a bright cafe's photos are inappropriate_for romantic only).
- A typical place has 0-3 entries in inappropriate_for. A place with 5+ entries is suspicious and should be reconsidered.
```

### 20.5 Dry-run sample audit BEFORE full backfill

Add a new edge function action `dry_run_sample`:
- Inputs: `{ city: string, sample_size: int = 30 }`.
- Picks N random eligible places, scores them with Claude, writes results to a NEW staging table `photo_aesthetic_dry_runs (place_pool_id, aggregate jsonb, model, scored_at, run_label text)` instead of `place_pool.photo_aesthetic_data`.
- Returns: full sample with name + primary_type + photo URLs + Claude verdict so operator can manually review.

Operator workflow before committing to full Raleigh+Cary+Durham backfill:
1. Run `dry_run_sample` for Raleigh, sample_size=30. Cost: ~$0.10.
2. Manually review all 30 outputs in admin or via SQL pull. Spot-check at least 10 against the actual photos.
3. If any output looks wrong (wrong lighting label, wrong vibe, wrong appropriate_for): iterate on the system prompt, re-run `dry_run_sample` with same sample. Cost: ~$0.10 per iteration.
4. Only when 30/30 pass operator gut-check → commit to full backfill via `create_run`.

This pattern catches prompt issues at $0.10 instead of $11+. Time cost: 10–20 minutes per iteration.

### 20.6 Golden test fixtures

The implementor creates `supabase/functions/_shared/__tests__/photo_aesthetic_golden_fixtures.json` with the 10 fixtures defined in §22 below. Every prompt change must re-run these fixtures and produce expected outputs (within tolerance: aesthetic_score ±1.0, lighting exact match, appropriate_for + inappropriate_for set-equality, safety_flags exact match). CI gate enforced via Deno test runner.

### 20.7 Disagreement logging table

Add migration creating:

```sql
CREATE TABLE public.photo_aesthetic_unknown_outputs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id    UUID REFERENCES place_pool(id) ON DELETE CASCADE,
  run_id      UUID REFERENCES photo_aesthetic_runs(id) ON DELETE CASCADE,
  unknown_field text NOT NULL,    -- 'vibe_tag' | 'appropriate_for' | 'inappropriate_for' | 'safety_flag'
  unknown_value text NOT NULL,    -- the actual value Claude returned that wasn't in our enum
  raw_response  jsonb NOT NULL,   -- full Claude output for debugging
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photo_unknown_field ON public.photo_aesthetic_unknown_outputs(unknown_field);
ALTER TABLE public.photo_aesthetic_unknown_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_unknown_outputs" ON public.photo_aesthetic_unknown_outputs
  FOR ALL USING (auth.role() = 'service_role');
```

Edge function logs to this table whenever sanitize_enum drops a value. Lets us evolve prompts based on actual Claude tendencies. Resolves OQ-3 default-yes.

---

## 21. Sonnet 4.6 Escalation Hatch (optional, behind a flag)

Implementor adds an optional escalation path:
- Per-place: if Haiku response triggers `safety_flags: [adult_content]` OR `safety_flags: [explicit_imagery]`, AND the run was started with `enable_safety_escalation: true` flag (default false), re-score with Sonnet 4.6 as a verifier.
- Sonnet's verdict overrides Haiku if there's disagreement on safety flags.
- Total cost: ~5% of places trigger this. At 3,234 places × 5% × $0.011/place ≈ $1.78 added. Negligible.
- Edge function tracks both `model: 'claude-haiku-4-5'` AND `verifier_model: 'claude-sonnet-4-6'` in the persisted JSONB when escalation fired.

This is OPTIONAL for first run. Default the flag to `false`. If the §9.7 operator smoke shows safety misses, flip to `true` for next run.

---

## 22. 10 Concrete Golden Test Fixtures

The implementor seeds these 10 fixtures into `photo_aesthetic_golden_fixtures.json`. Each fixture pairs a place description (proxy for actual photos) + expected Claude output (within tolerance). Every prompt change re-runs these via a Deno test that calls Anthropic vision OR (cheaper) compares stored Claude responses cached from earlier runs.

```json
[
  {
    "fixture_id": "GF-01_upscale_steakhouse",
    "test_place_name": "The Ritz Steakhouse",
    "primary_type": "fine_dining_restaurant",
    "photo_description": "5 photos: warm dim interior, candle-lit tables, plated wagyu close-up, leather booth seating, sommelier pouring wine",
    "expected_aggregate": {
      "aesthetic_score_min": 7.5,
      "aesthetic_score_max": 9.5,
      "lighting": ["warm_intimate", "candle_lit"],
      "primary_subject": ["food", "ambience"],
      "vibe_tags_must_include": ["fine_dining", "upscale", "intimate"],
      "appropriate_for_must_include": ["fine_dining"],
      "appropriate_for_may_include": ["romantic"],
      "inappropriate_for_must_not_include": ["fine_dining"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-02_sunny_brunch_cafe",
    "test_place_name": "The Bright Cafe",
    "primary_type": "brunch_restaurant",
    "photo_description": "5 photos: bright sunny patio, avocado toast on white plate, mimosas in flutes, white walls with plants, food-forward overhead shots",
    "expected_aggregate": {
      "aesthetic_score_min": 6.5,
      "aesthetic_score_max": 9.0,
      "lighting": ["bright_daylight", "natural_outdoor"],
      "primary_subject": ["food"],
      "vibe_tags_must_include": ["brunchy", "bright"],
      "appropriate_for_must_include": ["brunch"],
      "inappropriate_for_must_not_include": ["brunch"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-03_neon_dive_bar",
    "test_place_name": "The Underground",
    "primary_type": "night_club",
    "photo_description": "5 photos: neon signs, dancing crowd, strobe lights, dark dance floor, cocktails being shaken",
    "expected_aggregate": {
      "aesthetic_score_min": 5.0,
      "aesthetic_score_max": 8.0,
      "lighting": ["neon_party", "dim_moody"],
      "primary_subject": ["people", "drinks"],
      "vibe_tags_must_include": ["lively", "party"],
      "appropriate_for_must_include": ["drinks", "lively"],
      "inappropriate_for_must_include": ["fine_dining", "romantic", "icebreakers"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-04_strip_club",
    "test_place_name": "Trapeze",
    "primary_type": "night_club",
    "photo_description": "5 photos: dim red lighting, suggestive performance poses, alcohol bar, no food visible",
    "expected_aggregate": {
      "aesthetic_score_min": 4.0,
      "aesthetic_score_max": 7.0,
      "lighting": ["dim_moody", "neon_party"],
      "primary_subject": ["people"],
      "appropriate_for_must_include": ["drinks"],
      "inappropriate_for_must_include": ["fine_dining", "brunch", "romantic", "icebreakers", "casual_food"],
      "safety_flags_must_include": ["adult_content"]
    }
  },
  {
    "fixture_id": "GF-05_average_google_storefront",
    "test_place_name": "Random Pizza Place",
    "primary_type": "pizza_restaurant",
    "photo_description": "5 photos: exterior daytime, generic interior, no people, no food close-ups, harsh fluorescent lighting",
    "expected_aggregate": {
      "aesthetic_score_min": 3.0,
      "aesthetic_score_max": 5.5,
      "primary_subject": ["exterior", "ambience"],
      "appropriate_for_must_not_include": ["fine_dining"],
      "inappropriate_for_must_not_include": ["fine_dining"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-06_cozy_coffee_shop",
    "test_place_name": "Smooth Joe Coffee",
    "primary_type": "coffee_shop",
    "photo_description": "5 photos: warm wood interior, latte art close-up, pastries on counter, daytime windows, comfy chairs",
    "expected_aggregate": {
      "aesthetic_score_min": 5.5,
      "aesthetic_score_max": 8.0,
      "lighting": ["warm_intimate", "bright_daylight"],
      "primary_subject": ["drinks", "ambience", "food"],
      "vibe_tags_must_include": ["cozy"],
      "appropriate_for_must_include": ["icebreakers"],
      "appropriate_for_may_include": ["casual_food"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-07_park_outdoor",
    "test_place_name": "Pullen Park",
    "primary_type": "park",
    "photo_description": "5 photos: sunny grass field, people picnicking, trees, lake view, walking path",
    "expected_aggregate": {
      "aesthetic_score_min": 5.5,
      "aesthetic_score_max": 9.0,
      "lighting": ["natural_outdoor", "bright_daylight"],
      "primary_subject": ["nature", "exterior", "ambience"],
      "appropriate_for_must_not_include": ["drinks", "fine_dining"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-08_aquarium_false_positive_guard",
    "test_place_name": "Exotic Aquatic, Inc.",
    "primary_type": "aquarium",
    "photo_description": "5 photos: fish tanks, colorful exotic fish, retail interior of pet store, family-friendly aisles",
    "expected_aggregate": {
      "aesthetic_score_min": 4.0,
      "aesthetic_score_max": 7.5,
      "primary_subject": ["products", "ambience"],
      "safety_flags_must_be": [],
      "must_not_be_misclassified_as": "adult_content"
    }
  },
  {
    "fixture_id": "GF-09_walmart_storefront",
    "test_place_name": "Walmart Supercenter",
    "primary_type": "supermarket",
    "photo_description": "5 photos: store exterior with sign, parking lot, big-box retail interior, grocery aisles, no food close-ups",
    "expected_aggregate": {
      "aesthetic_score_min": 2.5,
      "aesthetic_score_max": 5.0,
      "primary_subject": ["exterior", "products"],
      "appropriate_for_must_not_include": ["fine_dining", "brunch", "romantic", "drinks", "lively"],
      "safety_flags_must_be": []
    }
  },
  {
    "fixture_id": "GF-10_romantic_rooftop_bar",
    "test_place_name": "Skyline Lounge",
    "primary_type": "cocktail_bar",
    "photo_description": "5 photos: city skyline at sunset, candle-lit tables, intimate couples, signature cocktails close-up, warm string lights",
    "expected_aggregate": {
      "aesthetic_score_min": 7.5,
      "aesthetic_score_max": 9.5,
      "lighting": ["warm_intimate", "candle_lit"],
      "primary_subject": ["drinks", "ambience"],
      "vibe_tags_must_include": ["romantic", "intimate"],
      "appropriate_for_must_include": ["drinks", "romantic"],
      "appropriate_for_may_include": ["fine_dining"],
      "safety_flags_must_be": []
    }
  }
]
```

### Test runner contract
- Every prompt change runs all 10 fixtures via Anthropic vision API (one-shot cost ~$0.05).
- Each fixture has a deno test asserting expected_aggregate constraints (range checks, set membership, exact match where specified).
- `_must_include` = the array must be a superset of the listed values.
- `_must_not_include` = the array must NOT contain any of the listed values.
- `_must_be` = exact array equality.
- `_may_include` = either empty or contains the listed values (acceptable in either case).
- A fixture failure BLOCKS the prompt change PR.

### Why these 10 specifically
- GF-01 + GF-02 + GF-06 + GF-10: positive examples covering 4 of the 7 in-scope signals
- GF-03: drinks/lively positive (no fine_dining bleed)
- GF-04: critical safety guard (the Trapeze class)
- GF-05 + GF-09: photo-weak places that should NOT spuriously rank high anywhere
- GF-07: outdoor positive case (forward-compatible with future outdoor-signal dispatch — ORCH-0711 candidate)
- GF-08: false-positive guard mirroring the actual Q2-A row from ORCH-0702 — Exotic Aquatic must NOT trigger adult_content based on the word "exotic" in the name

The 10 cover: 7 in-scope signal positives + 1 safety-positive + 2 photo-weak-negatives + 1 false-positive-guard. Every signal touched in this dispatch has at least one fixture asserting expected behavior.

**ORCH-0708 update — fixture count revised to 30** (10 per test city: Raleigh / Cary / Durham). The 10 templates above remain canonical category coverage; operator labels actual real-world places matching each template via the new admin labeling tool (§24) and the resulting set is exported as `photo_aesthetic_golden_fixtures.json`.

---

## 23. RAG with Vector DB — Wave 2 Phase 2 (deferred)

The "1000+ examples" intuition is correct for retrieval-augmented generation (RAG), not for in-prompt few-shot. Filed as **ORCH-0710 candidate** (Wave 2 Phase 2 follow-up after this dispatch ships and we know the photo-aesthetic baseline works).

**Scope of the future RAG dispatch:**
- Build a vector database of 500–1,000 manually-labeled places (operator labels via the same admin tool from §24, optionally augmented by a paid labeling vendor).
- For each new place being scored, find the 3-5 most semantically-similar already-labeled places (cosine similarity on text-embedding-3-small embeddings of name + types + summary).
- Inject those 3-5 places as **dynamic per-call anchors** instead of the same 6 static anchors.
- Each scoring call gets anchors relevant to THAT place — a steakhouse gets compared to other steakhouses, a coffee shop to other coffee shops.

**Why deferred to Phase 2:** RAG is the architecturally correct way to scale anchor breadth, but it's worth nothing if we haven't first proven that photo-aesthetic data lifts ranking AT ALL. Phase 1 (this dispatch) proves the baseline. If Phase 1 quality plateaus or surfaces edge cases the static-6 anchors miss, Phase 2 RAG is the next layer. Estimated Phase 2 effort: 2-3 days implementor + ~$50 one-time labeling cost (or operator weekend) for 500 places.

---

## 24. Admin Labeling Tool — NEW Phase 0 (operator-locked decisions 2026-05-03)

A dedicated admin tool that lets the operator (single user) label the 6 anchors + 30 fixtures with expected outputs, then later compare those expected outputs against Claude's actual outputs after the photo backfill runs. Ships BEFORE the rest of the photo-scoring pipeline so the operator can label, then implementor hardcodes the labeled set into the system prompt + fixture file.

### 24.1 Operator-locked decisions

| Decision | Choice |
|---|---|
| Where in admin nav | **NEW top-level page** (separate from Place Pool admin). Route: `/admin/photo-labeling`. Nav entry: "Photo Labeling." |
| Multi-operator | **Single operator only.** `labeled_by` field tracks who, but no multi-user collaboration UI. |
| Compare-with-Claude mode | **YES, included in v1.** Adds a third tab that appears after the photo-backfill run completes; shows side-by-side `expected vs actual` per labeled fixture with pass/fail per field. |

### 24.2 Database — `photo_aesthetic_labels` table

```sql
-- Migration: 20260501000005_orch_0708_photo_aesthetic_labels.sql (Phase 0)
CREATE TABLE public.photo_aesthetic_labels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_pool_id   UUID NOT NULL REFERENCES place_pool(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('anchor', 'fixture')),
  label_category  TEXT,    -- For role='anchor': one of 'upscale_steakhouse', 'sunny_brunch_cafe',
                           -- 'neon_dive_bar', 'adult_venue', 'average_storefront', 'cozy_coffee_shop'.
                           -- NULL for role='fixture'.
  city            TEXT,    -- 'Raleigh' | 'Cary' | 'Durham' for fixtures (10 per city).
                           -- NULL or city-of-anchor-place for anchors (informational).
  expected_aggregate jsonb NOT NULL,   -- The answer key — same shape as photo_aesthetic_data.aggregate
  notes           TEXT,                 -- Operator's free-text notes
  labeled_by      UUID REFERENCES auth.users(id),
  labeled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at    TIMESTAMPTZ,          -- NULL = draft; non-null = committed to ground truth
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one anchor per category at any time (operator can swap by un-committing the old one)
CREATE UNIQUE INDEX idx_photo_aesthetic_labels_anchor_category_unique
  ON photo_aesthetic_labels (label_category)
  WHERE role = 'anchor' AND committed_at IS NOT NULL;

-- Lookup index for comparison view
CREATE INDEX idx_photo_aesthetic_labels_role_committed
  ON photo_aesthetic_labels (role, committed_at)
  WHERE committed_at IS NOT NULL;

ALTER TABLE public.photo_aesthetic_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_photo_aesthetic_labels" ON public.photo_aesthetic_labels
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "admin_read_photo_aesthetic_labels" ON public.photo_aesthetic_labels
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active')
  );

COMMENT ON TABLE public.photo_aesthetic_labels IS
  'ORCH-0708 (Wave 2 Phase 1): operator-labeled answer keys for photo-aesthetic scoring. Anchors (6) feed into Claude system prompt. Fixtures (30) used as regression tests in Compare-with-Claude view + golden_fixtures.json export.';
```

### 24.3 Admin page architecture (`mingla-admin/src/pages/PhotoLabelingPage.jsx`)

**Top-level route:** `/admin/photo-labeling`. Add nav entry "Photo Labeling" alongside existing top-level admin pages.

**Three tabs:**

1. **Anchors (6)** — six placeholder slots, one per category (upscale_steakhouse / sunny_brunch_cafe / neon_dive_bar / adult_venue / average_storefront / cozy_coffee_shop). Each slot shows current committed anchor (if any) and a "change anchor" button.
2. **Fixtures (30)** — 10-per-city grid (Raleigh / Cary / Durham). Empty slots show "Pick + label." Filled slots show the chosen place + commit status.
3. **Compare with Claude** — appears post-backfill (when `place_pool.photo_aesthetic_data IS NOT NULL` for committed-fixture places). Side-by-side diff.

**Common form (used in both Anchors and Fixtures tabs):**
- Header strip: place name + primary_type + rating + review_count + address.
- Photo strip: 5 thumbnails (each clickable to enlarge in a modal lightbox) loaded from `place_pool.stored_photo_urls[0..4]`.
- Form fields (matching the structured-output schema):
  - `aesthetic_score` — number slider 1.0 to 10.0, step 0.1
  - `lighting` — dropdown (9 enum values)
  - `composition` — dropdown (3 enum values)
  - `subject_clarity` — dropdown (3 enum values)
  - `primary_subject` — dropdown (9 enum values)
  - `vibe_tags` — multiselect chips (full enum)
  - `appropriate_for` — multiselect chips (**16 SIGNAL IDS** from live `signal_definitions`: `brunch, casual_food, creative_arts, drinks, fine_dining, flowers, groceries, icebreakers, lively, movies, nature, picnic_friendly, play, romantic, scenic, theatre`). NOT the 10 canonical chip slugs from `categoryPlaceTypes.DISPLAY_TO_SLUG` — different abstraction layer. The scorer reads `photo_appropriate_for_includes_<signal_id>`, so signal IDs are the correct values. Implementor MUST hardcode the 16-element list as a constant in the page (e.g., `const MINGLA_SIGNAL_IDS = [...]` with `// SOURCE OF TRUTH: live signal_definitions table — refresh manually if signals are added/removed via DB`).
  - `inappropriate_for` — multiselect chips (same 16 signal IDs)
  - `safety_flags` — multiselect chips (5 enum values)
  - `photo_quality_notes` — textarea (max 300 chars)
  - `notes` — textarea (operator's free-text rationale, optional)
- Buttons: "Save Draft" (writes `committed_at = NULL`); "Commit" (writes `committed_at = now()`); "Cancel."

### 24.4 Candidate-picker queries (per anchor category)

For each anchor slot, the page shows a shortlist of 5–10 candidate places matching that category's signature. Operator picks one, labels it, commits. SQL queries scoped to Raleigh / Cary / Durham only.

| Anchor category | Candidate query |
|---|---|
| upscale_steakhouse | `primary_type IN ('fine_dining_restaurant','steak_house') AND rating >= 4.5 AND review_count >= 100 AND city ILIKE ANY(...)` |
| sunny_brunch_cafe | `(primary_type = 'brunch_restaurant' OR 'breakfast_restaurant' = ANY(types)) AND rating >= 4.4 AND review_count >= 50` |
| neon_dive_bar | `(primary_type = 'night_club' OR 'bar' = ANY(types)) AND rating >= 4.0 AND review_count >= 80` |
| adult_venue | manual entry (no automatic filter — operator pastes `place_pool.id` directly OR uses search-by-name) |
| average_storefront | `rating BETWEEN 3.5 AND 4.2 AND review_count BETWEEN 30 AND 200 AND primary_type IN ('pizza_restaurant','sandwich_shop','convenience_store')` |
| cozy_coffee_shop | `primary_type IN ('cafe','coffee_shop') AND rating >= 4.5 AND review_count >= 80` |

For Fixtures (per city, 10 each), the candidate query is broader: `is_servable=true AND is_active=true AND city='Raleigh' ORDER BY review_count DESC LIMIT 50` — operator picks any 10 covering a healthy spread of categories (typically: 4 dining-positive + 2 mid-range + 1 photo-weak + 1 safety-related + 2 false-positive guards).

### 24.5 Compare-with-Claude view

Activates automatically when at least one committed-fixture place has `place_pool.photo_aesthetic_data IS NOT NULL` (i.e., the photo-aesthetic backfill has been run). Pre-backfill, the tab is empty with placeholder copy "Run the photo-aesthetic backfill to compare."

**View shape (per fixture):**
- Card header: place name + city + commit status
- Two-column body:
  - Left: operator's `expected_aggregate` (from `photo_aesthetic_labels`)
  - Right: Claude's actual `place_pool.photo_aesthetic_data.aggregate`
- Per-field pass/fail badges:
  - `aesthetic_score`: PASS if abs(actual - expected) ≤ 1.0; otherwise FAIL with delta shown
  - `lighting`: PASS if exact match; otherwise FAIL with "expected X, got Y"
  - `composition`, `subject_clarity`, `primary_subject`: PASS if exact match
  - `vibe_tags`: PASS if expected is a subset of actual (Claude allowed to add tags); otherwise FAIL with missing tags
  - `appropriate_for`: PASS if expected is a subset of actual; otherwise FAIL
  - `inappropriate_for`: PASS if expected is a subset of actual; otherwise FAIL
  - `safety_flags`: PASS if exact match; otherwise FAIL (safety is binary)
- Overall fixture verdict: PASS if all fields PASS; otherwise FAIL with per-field breakdown

**Aggregate stats panel (top of tab):**
- "X / 30 fixtures pass overall"
- Per-field PASS-rate: "aesthetic_score: 27/30 PASS · lighting: 28/30 PASS · ..."
- Filter: "Show only failing fixtures" toggle for quick triage

**Re-iterate workflow:** when fixtures fail at unacceptable rate, operator clicks "Iterate Prompt" → opens a textarea showing the current system prompt → operator edits → saves a new version → triggers a 30-place re-score on just the fixture set (~$0.10) → Compare view refreshes.

### 24.6 Export buttons

Two export buttons live in the page header:

- **"Export Anchors JSON"** — pulls all 6 committed anchor rows, formats as the system-prompt-injection block. Operator copies the output, hands it to the implementor, who pastes into `score-place-photo-aesthetics/index.ts` system prompt template.
- **"Export Fixtures JSON"** — pulls all 30 committed fixture rows, formats as `photo_aesthetic_golden_fixtures.json`. Implementor saves to `supabase/functions/_shared/__tests__/photo_aesthetic_golden_fixtures.json` (overwriting the placeholder generated from §22 templates).

### 24.7 Updated implementation order (replaces §13 phasing)

| Phase | What ships | Who | Wall time |
|---|---|---|---|
| **0a — Labeling tool migration** | Migration creating `photo_aesthetic_labels` table | Implementor | ~30 min |
| **0b — Admin page (Anchors + Fixtures tabs)** | Top-level admin page, candidate pickers, label form, save/commit, export buttons | Implementor | ~1 day |
| **0c — Compare-with-Claude tab** | Diff view (initially empty until Phase 4 runs); per-field pass/fail logic; aggregate stats; iterate-prompt workflow | Implementor | ~4-6 hours |
| **0.5 — Operator labels** | Operator picks + labels 6 anchors + 30 fixtures via the page | Operator | ~1.5 hours |
| **1 — Hardcode labeled set** | Operator clicks Export. Implementor pastes anchor JSON into system prompt template + saves fixtures JSON to test file | Implementor | ~30 min |
| **2 — Photo scoring system** | `place_pool.photo_aesthetic_data` column + `photo_aesthetic_runs` + `photo_aesthetic_batches` + `photo_aesthetic_unknown_outputs` tables + `score-place-photo-aesthetics` edge function + scorer extension + `run-signal-scorer` SELECT extension + 7 signal v_next migrations | Implementor | ~1-1.5 days |
| **3 — Operator deploys** | `supabase db push`; functions deploy | Operator | ~10 min |
| **4 — Operator runs backfill + compare** | Photo-aesthetic backfill for Raleigh/Cary/Durham (~$11). Operator opens Compare-with-Claude tab. If <90% fixtures pass: iterate prompt + re-run dry sample (~$0.10) until acceptable. | Operator | ~30 min + iteration cycles |
| **5 — Operator runs signal re-score** | `run-signal-scorer` for the 7 signals | Operator | ~5 min |
| **6 — Orchestrator diff + CLOSE** | Top-20 cards before/after analysis. CLOSE protocol if PASS. | Orchestrator | ~30 min |

**Total implementor effort:** ~2-3 days (Phase 0 + Phase 2 combined, +30 min Phase 1).
**Total operator effort:** ~2.5 hours active + iteration cycles in Phase 4.
**Total Anthropic spend:** ~$11 + iteration cost (typically <$2 in iterations).

### 24.8 New success criteria (extends §10)

| ID | Criterion | Verification |
|---|---|---|
| AC-16 | `photo_aesthetic_labels` table exists with documented schema + RLS policies | `\d photo_aesthetic_labels` |
| AC-17 | `/admin/photo-labeling` route renders and shows Anchors + Fixtures + Compare tabs | manual smoke |
| AC-18 | Anchors tab: candidate-picker SQL returns ≥5 candidates per category in Raleigh/Cary/Durham scope | manual smoke |
| AC-19 | Label form: all fields render with correct enum constraints; save/commit persist correctly | manual smoke |
| AC-20 | Export Anchors JSON: produces a valid `expected_aggregate` block for each of 6 committed anchors | manual smoke |
| AC-21 | Export Fixtures JSON: produces 30-row JSON file matching the `photo_aesthetic_golden_fixtures.json` schema | file-format check |
| AC-22 | Compare tab post-backfill: displays per-field pass/fail badges + aggregate stats; iteration workflow functional | manual smoke after Phase 4 |
| AC-23 | RLS: non-admin authenticated users CANNOT read `photo_aesthetic_labels` (admin-users gated) | direct API probe |

### 24.9 Test cases (extends §11)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-16 | Anchor label commits | Operator selects place, fills form, clicks Commit | Row in `photo_aesthetic_labels` with `committed_at IS NOT NULL` and matching `expected_aggregate` | DB |
| T-17 | Anchor uniqueness | Operator commits two places to same `label_category` | Second commit fails (unique-index violation); first place auto-uncommitted before second commits OR error surfaces | DB |
| T-18 | Compare diff: aesthetic tolerance | Expected score 7.5, actual 8.4 | PASS (within ±1.0 tolerance) | Compare logic |
| T-19 | Compare diff: aesthetic out of tolerance | Expected score 7.5, actual 9.5 | FAIL with delta=+2.0 surfaced | Compare logic |
| T-20 | Compare diff: vibe_tags subset | Expected `[brunchy, bright]`, actual `[brunchy, bright, photogenic]` | PASS (Claude allowed to add) | Compare logic |
| T-21 | Compare diff: vibe_tags missing | Expected `[brunchy, bright]`, actual `[brunchy]` | FAIL, missing `[bright]` shown | Compare logic |
| T-22 | Compare diff: safety_flags exact | Expected `[adult_content]`, actual `[]` | FAIL — safety is binary | Compare logic |
| T-23 | Export Anchors JSON shape | Click Export Anchors after 6 committed | Returns array of 6 objects with category + expected_aggregate keys, suitable for prompt injection | Export |
| T-24 | Export Fixtures JSON matches §22 template shape | Click Export Fixtures after 30 committed | Output passes JSON schema validation against `photo_aesthetic_golden_fixtures.json` schema | Export |
| T-25 | RLS gate for non-admin | curl with non-admin JWT to `photo_aesthetic_labels` | 403 / empty result | Security |

### 24.10 Carve-outs and out-of-scope

- **No multi-user collaboration UI** — single operator only per locked decision §24.1. If team expands later, file as separate ORCH.
- **No vendor labeling integration** — Surge AI / Scale AI integration deferred to Phase 2 RAG scope (§23).
- **No bulk-label-import** — operator labels manually via UI, one place at a time. Bulk CSV import is Phase 2 territory.
- **No automated re-scoring on prompt change** — when operator iterates the prompt in §24.5, the dry-sample re-run is invoked manually via a new edge function action (`dry_run_sample` from §20.5), not auto-triggered.
- **No diff history** — Compare-with-Claude shows current state only; if photo-aesthetic-data is re-scored, the previous comparison is overwritten. Audit trail lives in `photo_aesthetic_runs.completed_at` timestamps.
