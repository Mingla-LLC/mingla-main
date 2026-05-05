# SPEC — ORCH-0712: Place Intelligence Trial Run

**Type:** Build dispatch (research/exploratory feature)
**Severity:** S2-medium
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0712_TRIAL_INTELLIGENCE.md`
**Forensics dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0712_TRIAL_INTELLIGENCE.md`

---

## 1. Plain-English summary

Build a one-shot exploratory trial: operator picks 2 anchor places per Mingla signal (32 total = 2 × 16 signals). For each anchor, fetch 100 reviews from Serper, compose all available photos into one adaptive grid image, bundle EVERYTHING (place_pool columns + reviews + collage) and send to Claude. Claude answers two questions per place — Q1 open exploration (propose vibes + new signals), Q2 closed evaluation against existing 16 signals. Output stored in a new `place_intelligence_trial_runs` table. Admin UI on a new top-level page with two tabs: Signal Anchors (picker) + Trial Results (Claude's output).

This is **research, not production**. Trial output does NOT feed card ranking. Operator reads it and decides what (if anything) changes downstream.

## 2. Scope + Non-Goals

### 2.1 Scope

- 4 new DB tables/columns (signal_anchors, place_external_reviews, place_intelligence_trial_runs, place_pool collage columns)
- 1 new edge function with action-based dispatch: `run-place-intelligence-trial` covering 5 actions (preview/fetch_reviews/compose_collage/run_trial/run_status)
- 1 new top-level admin page `Place Intelligence Trial` at `#/place-intelligence-trial`
- 2 tabs on the new page: **Signal Anchors** (picker UI) + **Trial Results** (output viewer)
- Reuse: Anthropic auth/retry/throttle pattern + `_shared/photoAestheticEnums.ts` constants/helpers
- One-shot trial: operator picks 32 anchors, clicks "Run trial", waits ~30 min, reviews output

### 2.2 Non-goals

- Wiring trial output into card ranking or signal scoring (FUTURE separate ORCH if operator decides)
- Modifying existing 16 Mingla signal definitions based on Q1 proposals (operator review post-trial)
- Productionizing reviews fetch beyond the 32 anchored places
- Updating the existing Phase 1 `score-place-photo-aesthetics` to use this richer data (separate decision)
- Migrating Phase 0 anchors/fixtures into `signal_anchors` (different concept; preserved as-is)
- Mobile or end-user-facing changes (admin-only)

### 2.3 Assumptions

- Serper API key is set as Supabase secret `SERPER_API_KEY` (verified in production)
- `ANTHROPIC_API_KEY` is set (verified in production via Phase 1)
- `place-photos` Supabase Storage bucket exists (verified)
- New `place-collages` bucket can be created via Storage admin
- Per-signal candidate pool ≥ 2 for all 16 signals (verified — minimum is `movies` with 7 candidates ≥ score 100)

## 3. Database Layer

### 3.1 Migration file naming convention

All four new migrations land in one file each, ordered chronologically:

```
supabase/migrations/20260505000001_orch_0712_signal_anchors_table.sql
supabase/migrations/20260505000002_orch_0712_place_external_reviews_table.sql
supabase/migrations/20260505000003_orch_0712_place_intelligence_trial_runs_table.sql
supabase/migrations/20260505000004_orch_0712_place_pool_photo_collage_columns.sql
```

### 3.2 Migration A — `signal_anchors`

```sql
-- ORCH-0712 — signal_anchors table
-- 2 anchor places per Mingla signal × 16 signals = 32 rows max committed.
-- Operator picks via admin UI; candidate filter = place_scores.score >= threshold.

BEGIN;

CREATE TABLE IF NOT EXISTS public.signal_anchors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     TEXT NOT NULL CHECK (signal_id IN (
    'brunch','casual_food','creative_arts','drinks','fine_dining','flowers',
    'groceries','icebreakers','lively','movies','nature','picnic_friendly',
    'play','romantic','scenic','theatre'
  )),
  anchor_index  INTEGER NOT NULL CHECK (anchor_index IN (1, 2)),
  place_pool_id UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  notes         TEXT,
  labeled_by    UUID REFERENCES auth.users(id),
  labeled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one COMMITTED anchor per (signal_id, anchor_index). Drafts are unconstrained
-- so operator can stage replacements before swapping.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_anchors_unique
  ON public.signal_anchors (signal_id, anchor_index)
  WHERE committed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_anchors_signal
  ON public.signal_anchors (signal_id);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.tg_signal_anchors_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_signal_anchors_set_updated_at ON public.signal_anchors;
CREATE TRIGGER trg_signal_anchors_set_updated_at
  BEFORE UPDATE ON public.signal_anchors
  FOR EACH ROW EXECUTE FUNCTION public.tg_signal_anchors_set_updated_at();

ALTER TABLE public.signal_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_signal_anchors" ON public.signal_anchors;
CREATE POLICY "service_role_all_signal_anchors" ON public.signal_anchors
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_all_signal_anchors" ON public.signal_anchors;
CREATE POLICY "admin_all_signal_anchors" ON public.signal_anchors
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'));

COMMENT ON TABLE public.signal_anchors IS
  'ORCH-0712 — operator-picked anchor places, 2 per Mingla signal × 16 signals = 32 max committed. Candidate filter: place_scores.score >= threshold for that signal. Used by run-place-intelligence-trial edge function as the input set for Claude trial.';

COMMIT;
```

### 3.3 Migration B — `place_external_reviews`

```sql
-- ORCH-0712 — place_external_reviews table
-- Stores reviews fetched from Serper (or future sources) for the 32 anchor places.
-- Fetched on-demand by run-place-intelligence-trial action='fetch_reviews'.

BEGIN;

CREATE TABLE IF NOT EXISTS public.place_external_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_pool_id   UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'serper' CHECK (source IN ('serper')),
  source_review_id TEXT NOT NULL,                 -- Serper's review id (for dedup)
  review_text     TEXT,                            -- snippet (may be NULL — not all reviews have text)
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  posted_at       TIMESTAMPTZ,                     -- isoDate from Serper
  posted_label    TEXT,                            -- "2 days ago" etc.
  author_name     TEXT,
  author_review_count INTEGER,
  author_photo_count INTEGER,
  has_media       BOOLEAN NOT NULL DEFAULT false,
  media           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of {imageUrl, caption?}
  raw             JSONB,                            -- full Serper review object (defensive)
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: same review from same source counts once
CREATE UNIQUE INDEX IF NOT EXISTS idx_place_external_reviews_dedup
  ON public.place_external_reviews (place_pool_id, source, source_review_id);

CREATE INDEX IF NOT EXISTS idx_place_external_reviews_recency
  ON public.place_external_reviews (place_pool_id, posted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_place_external_reviews_fetched
  ON public.place_external_reviews (place_pool_id, fetched_at DESC);

ALTER TABLE public.place_external_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_place_external_reviews" ON public.place_external_reviews;
CREATE POLICY "service_role_all_place_external_reviews" ON public.place_external_reviews
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_place_external_reviews" ON public.place_external_reviews;
CREATE POLICY "admin_read_place_external_reviews" ON public.place_external_reviews
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'));

COMMENT ON TABLE public.place_external_reviews IS
  'ORCH-0712 — third-party reviews (currently Serper Google Maps reviews) for trial-run anchor places. Dedup via (place_pool_id, source, source_review_id). Storage shape: one row per review with structured fields + raw Serper object preserved.';

COMMIT;
```

### 3.4 Migration C — `place_intelligence_trial_runs`

```sql
-- ORCH-0712 — place_intelligence_trial_runs table
-- One row per (run_id, place_pool_id) pair. Stores Claude's Q1+Q2 output.
-- run_id groups all 32 places of a single trial invocation.

BEGIN;

CREATE TABLE IF NOT EXISTS public.place_intelligence_trial_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL,                   -- groups places of one trial
  place_pool_id   UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  signal_id       TEXT NOT NULL,                   -- which signal-anchor slot this place fills
  anchor_index    INTEGER NOT NULL CHECK (anchor_index IN (1, 2)),

  -- Inputs we sent (defensive snapshot for replay/debug)
  input_payload   JSONB NOT NULL,                  -- {place_columns, reviews_summary_count, collage_url, prompt_version}
  collage_url     TEXT,                            -- URL of the composed collage we sent
  reviews_count   INTEGER NOT NULL DEFAULT 0,      -- how many reviews were fed to Claude

  -- Outputs from Claude
  q1_response     JSONB,                           -- {proposed_vibes, proposed_signals, notable_observations}
  q2_response     JSONB,                           -- {evaluations: [{signal_id, strong_match, confidence, reasoning, inappropriate_for}, ...]}

  -- Run metadata
  model           TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  model_version   TEXT,
  prompt_version  TEXT NOT NULL DEFAULT 'v1',
  cost_usd        NUMERIC(10, 6) NOT NULL DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  error_message   TEXT,

  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pit_runs_run_id ON public.place_intelligence_trial_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_pit_runs_place ON public.place_intelligence_trial_runs (place_pool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pit_runs_status ON public.place_intelligence_trial_runs (status);

ALTER TABLE public.place_intelligence_trial_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_pit_runs" ON public.place_intelligence_trial_runs;
CREATE POLICY "service_role_all_pit_runs" ON public.place_intelligence_trial_runs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_pit_runs" ON public.place_intelligence_trial_runs;
CREATE POLICY "admin_read_pit_runs" ON public.place_intelligence_trial_runs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'));

COMMENT ON TABLE public.place_intelligence_trial_runs IS
  'ORCH-0712 — Claude trial output per (run_id, place). Q1 = open exploration (proposed vibes + signals). Q2 = closed evaluation against existing 16 Mingla signals. I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING: rows MUST NOT be read by production scoring or ranking surfaces.';

COMMIT;
```

### 3.5 Migration D — `place_pool` collage columns

```sql
-- ORCH-0712 — place_pool.photo_collage_url + photo_collage_fingerprint
-- Owned EXCLUSIVELY by run-place-intelligence-trial action='compose_collage'.
-- Same I-FIELD-MASK-SINGLE-OWNER carve-out pattern as photo_aesthetic_data.

BEGIN;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS photo_collage_url TEXT DEFAULT NULL;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS photo_collage_fingerprint TEXT DEFAULT NULL;

COMMENT ON COLUMN public.place_pool.photo_collage_url IS
  'ORCH-0712 — public URL of composed photo grid for this place (in place-collages bucket). Owned EXCLUSIVELY by run-place-intelligence-trial edge function. admin-seed-places, bouncer, signal scorer MUST NOT write this column. I-COLLAGE-SOLE-OWNER.';

COMMENT ON COLUMN public.place_pool.photo_collage_fingerprint IS
  'ORCH-0712 — sha256 of the source photo URLs that built the cached collage. If photos rotate, fingerprint mismatch triggers re-compose.';

CREATE INDEX IF NOT EXISTS idx_place_pool_has_collage
  ON public.place_pool ((1)) WHERE photo_collage_url IS NOT NULL;

COMMIT;
```

### 3.6 Storage bucket

Create new public bucket `place-collages`:
- Public read (so Anthropic can fetch image URL)
- 10MB file size limit (collages are ~300KB, headroom plenty)
- No bucket policies needed beyond default

Implementor creates via Supabase dashboard OR via service-role SQL:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('place-collages', 'place-collages', true, 10485760)
ON CONFLICT (id) DO NOTHING;
```

### 3.7 admin-seed-places carve-out

In BOTH UPDATE blocks (lines ~1036 and ~1467 — already has photo_aesthetic_data carve-out from Phase 1), update the protective comment to add the new columns:

```typescript
// I-PHOTO-AESTHETIC-DATA-SOLE-OWNER (ORCH-0708): photo_aesthetic_data is INTENTIONALLY EXCLUDED from this UPDATE.
// I-COLLAGE-SOLE-OWNER (ORCH-0712): photo_collage_url + photo_collage_fingerprint are INTENTIONALLY EXCLUDED. Owned exclusively by run-place-intelligence-trial.
```

Verify via grep that none of the 3 columns appears in the actual `.update({...})` field set.

## 4. Edge Function Layer — `run-place-intelligence-trial`

### 4.1 File location

`supabase/functions/run-place-intelligence-trial/index.ts`

### 4.2 Action-based dispatch (mirrors score-place-photo-aesthetics pattern)

```
POST /functions/v1/run-place-intelligence-trial
Authorization: Bearer <admin user JWT>
Body: { action: <action>, ...args }
```

| Action | Args | Purpose |
|---|---|---|
| `preview_run` | none | Read committed `signal_anchors`, count places, estimate cost |
| `fetch_reviews` | `place_pool_id`, `force_refresh?` | Fetch up to 100 Serper reviews; persist to place_external_reviews; idempotent (skip if last fetch < 30 days unless force) |
| `compose_collage` | `place_pool_id`, `force?` | Build adaptive grid, upload to place-collages bucket, persist URL+fingerprint to place_pool; idempotent (fingerprint match → skip) |
| `prepare_all` | `force_refresh?` | For each committed anchor: fetch_reviews + compose_collage. Returns summary. |
| `run_trial` | none | Execute Claude calls (Q1 + Q2) for each committed anchor; persist to place_intelligence_trial_runs. Returns run_id + summary |
| `run_status` | `run_id` | Returns run + per-place status |
| `cancel_trial` | `run_id` | Mark in-flight runs cancelled |

### 4.3 Per-place flow (inside `run_trial`)

For each of the 32 anchored places:

1. **Verify prerequisites:**
   - `place_pool.photo_collage_url IS NOT NULL` (else fail with `prerequisites_missing` error)
   - `place_external_reviews` rows exist (else fail same)
2. **Build prompt:**
   - System prompt (cached) — describes the 16 Mingla signals + the two questions
   - User content:
     - 1 image content block (the collage URL)
     - Text block with: place_pool columns formatted as a labeled key:value list
     - Text block with: top 30 most-recent reviews with text, formatted `[5★ 2026-05-02] {snippet}\n`
     - Text block with: all reviewer photo captions concatenated
3. **Q1 call:**
   - `tool_choice: {type: "tool", name: "propose_signals_and_vibes"}`
   - Tool schema: `{proposed_vibes: string[], proposed_signals: [{name, definition, rationale, overlaps_existing[]}], notable_observations: string}`
   - Sanitize: enforce `proposed_vibes` length ≤ 20, `proposed_signals` length ≤ 10, strings ≤ 500 chars each
4. **Throttle 30 seconds** between Q1 and Q2 (rate-limit safety; prompt-cache hit reduces input tokens significantly)
5. **Q2 call:**
   - Same system prompt (cached, 10% multiplier)
   - `tool_choice: {type: "tool", name: "evaluate_against_existing_signals"}`
   - Tool schema:
     ```typescript
     {
       evaluations: Array<{
         signal_id: string,           // must be in MINGLA_SIGNAL_IDS
         strong_match: boolean,
         confidence_0_to_10: number,  // 0-10 inclusive
         reasoning: string,            // ≤500 chars
         inappropriate_for: boolean
       }>  // length must be 16
     }
     ```
   - Sanitize: enforce signal_id in MINGLA_SIGNAL_IDS, length=16, confidence ∈ [0,10]
6. **Persist** result to `place_intelligence_trial_runs` with status='completed' + cost_usd computed via `_shared/photoAestheticEnums.ts::computeCostUsd`
7. **Throttle 9 seconds** between places (same pattern as Phase 1)

### 4.4 Cost guard

`COST_GUARD_USD = 5.0` enforced in `preview_run` and `run_trial` start. Estimated total ~$1.50 for 32 places with caching, well under the guard.

### 4.5 Photo collage logic (`compose_collage` action)

```typescript
// Pseudocode — full impl in edge function
import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

async function composeCollage(placePoolRow, reviewMedia): Promise<{url, fingerprint}> {
  const marketingPhotos = (placePoolRow.stored_photo_urls || []).slice(0, 5);
  const reviewerPhotos = reviewMedia
    .sort((a, b) => /* recency desc, then likes desc */)
    .slice(0, 11)
    .map(m => m.imageUrl);
  const allPhotos = [...marketingPhotos, ...reviewerPhotos]; // up to 16

  const fingerprint = await sha256(allPhotos.join("|"));
  // Check existing fingerprint match → skip if present
  if (placePoolRow.photo_collage_fingerprint === fingerprint && !force) {
    return { url: placePoolRow.photo_collage_url, fingerprint, cached: true };
  }

  // Adaptive grid: 1 → 1×1, 2-4 → 2×2, 5-9 → 3×3, 10-16 → 4×4
  const n = allPhotos.length;
  const grid = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const tile = Math.floor(1024 / grid);

  const canvas = new Image(grid * tile, grid * tile);
  // Optional black background — using imagescript's default

  for (let i = 0; i < n; i++) {
    try {
      const res = await fetch(allPhotos[i]);
      const buf = await res.arrayBuffer();
      const img = await decode(new Uint8Array(buf));
      img.resize(tile, tile);
      const x = (i % grid) * tile;
      const y = Math.floor(i / grid) * tile;
      canvas.composite(img, x, y);
    } catch (err) {
      console.error(`[compose_collage] photo ${i} failed:`, err);
      // Continue — leave that cell blank/black
    }
  }

  const png = await canvas.encode();
  const path = `${placePoolRow.id}/${fingerprint.slice(0, 12)}.png`;
  await supabase.storage.from('place-collages').upload(path, png, {
    contentType: 'image/png',
    upsert: true,
  });
  const { data } = supabase.storage.from('place-collages').getPublicUrl(path);

  await supabase.from('place_pool').update({
    photo_collage_url: data.publicUrl,
    photo_collage_fingerprint: fingerprint,
  }).eq('id', placePoolRow.id);

  return { url: data.publicUrl, fingerprint, cached: false };
}
```

### 4.6 Reviews fetch logic (`fetch_reviews` action)

```typescript
async function fetchPlaceReviews(placePoolId, forceRefresh = false): Promise<{ count, fetched }> {
  // Idempotency check
  if (!forceRefresh) {
    const { data: latest } = await supabase
      .from('place_external_reviews')
      .select('fetched_at')
      .eq('place_pool_id', placePoolId)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && /* fetched_at within 30 days */) {
      const { count } = await supabase
        .from('place_external_reviews')
        .select('id', { count: 'exact', head: true })
        .eq('place_pool_id', placePoolId);
      return { count, fetched: false };
    }
  }

  // Get google_place_id
  const { data: pp } = await supabase.from('place_pool')
    .select('google_place_id').eq('id', placePoolId).single();
  if (!pp?.google_place_id) throw new Error('no google_place_id');

  // Page through Serper up to 5 pages (100 reviews max)
  let nextPageToken;
  let totalCollected = 0;
  for (let page = 1; page <= 5; page++) {
    const reqBody = { placeId: pp.google_place_id, sortBy: 'newest', gl: 'us', hl: 'en' };
    if (nextPageToken) reqBody.nextPageToken = nextPageToken;
    const res = await fetch('https://google.serper.dev/reviews', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Serper ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const reviews = data.reviews || [];
    // Insert (upsert on conflict to dedup)
    if (reviews.length > 0) {
      const rows = reviews.map(r => ({
        place_pool_id: placePoolId,
        source: 'serper',
        source_review_id: r.id,
        review_text: r.snippet || null,
        rating: r.rating || null,
        posted_at: r.isoDate || null,
        posted_label: r.date || null,
        author_name: r.user?.name || null,
        author_review_count: r.user?.reviews || null,
        author_photo_count: r.user?.photos || null,
        has_media: (r.media || []).length > 0,
        media: r.media || [],
        raw: r,
      }));
      await supabase.from('place_external_reviews').upsert(rows, {
        onConflict: 'place_pool_id,source,source_review_id',
      });
      totalCollected += reviews.length;
    }
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
    await new Promise((r) => setTimeout(r, 200)); // gentle Serper throttle
  }

  return { count: totalCollected, fetched: true };
}
```

### 4.7 Auth + RLS

- Edge function checks JWT + `admin_users` membership at entry (mirrors score-place-photo-aesthetics:47-64)
- Service-role client used for all DB writes (bypasses RLS)

### 4.8 Error contract

- Per-place permanent failure during run_trial: write `place_intelligence_trial_runs` row with `status='failed'` + `error_message` set. Continue with next place.
- Per-place transient failure (Serper / Anthropic 5xx, 429): retry with backoff (12s, 24s, 48s, 96s) per Phase 1 pattern. Then mark failed.
- All errors logged to `console.error` with prefix `[run-place-intelligence-trial]` for Supabase log inspection.

## 5. Frontend Layer — `PlaceIntelligenceTrialPage`

### 5.1 File location

`mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` (top-level admin page)

### 5.2 Route registration

In `mingla-admin/src/App.jsx` PAGES object: add `"place-intelligence-trial": PlaceIntelligenceTrialPage`.

In `mingla-admin/src/lib/constants.js` NAV_GROUPS: add to "Quality Gates" group:
```js
{ id: "place-intelligence-trial", label: "Place Intelligence Trial", icon: "Microscope" },
```

In `mingla-admin/src/components/layout/Sidebar.jsx` ICON_MAP: add `Microscope` from lucide-react.

### 5.3 Tab structure

Two tabs:

**Tab 1: Signal Anchors**
- 16 sections, one per Mingla signal
- Each section header: signal name + "X of 2 committed" badge
- Each section body: 2 slots (anchor_index 1, anchor_index 2)
  - Empty slot → "Pick an anchor" button → opens `SignalCandidatePicker` modal
  - Filled slot → place name + thumbnail + commit/uncommit/replace buttons

**Tab 2: Trial Results**
- Top: aggregate stats panel (total committed anchors, last run date, cost, total cost across all runs)
- Big primary button: **"Run trial"** — disabled if not all 32 anchors committed
- Below: scrollable list of trial runs (most recent first)
  - Each run: expandable summary header (run_id, status, place count, cost, started_at)
  - Expanded: per-place results (collage thumbnail + Q1 output + Q2 output side-by-side)

### 5.4 `SignalCandidatePicker` modal

- Fetches candidates: `place_scores WHERE signal_id = X AND score >= threshold ORDER BY score DESC LIMIT 30`, JOIN `place_pool` for name + photos + rating
- Default threshold: 100 (UI control to lower if needed for thin signals)
- 5 explicit states: loading / error+retry / empty (no candidates ≥ threshold) / populated (cards) / picking (button disabled when one is being saved)
- Each candidate card: name, primary_type, rating, 5-photo strip, current score, "Pick" button
- Click Pick → service writes `signal_anchors` row with `committed_at` set + closes modal

### 5.5 Trial run flow (UI)

Click "Run trial" on Tab 2:
1. Confirmation dialog: "About to run trial for 32 places. Estimated cost ~$1.50, ~30 minute wall time. Continue?"
2. On confirm: call edge function `prepare_all` first → returns when all 32 places have collage + reviews ready. Show progress.
3. Then call `run_trial` → returns run_id immediately (or continues processing). UI polls run_status every 5 seconds.
4. As each place completes, refresh the list view.
5. Final toast on completion: "Trial complete: X / 32 succeeded, Y failed, $Z cost. Open Trial Results tab to inspect."

### 5.6 State handling (per Constitution #3 + #4)

| State | UI |
|---|---|
| Loading | Spinner + descriptive text per section |
| Error | AlertCard variant=error + Retry button + actual error message |
| Empty | AlertCard variant=info with helpful copy ("Pick anchors first" / "Run a trial first") |
| Populated | Real content |
| Submitting | Disabled buttons + spinner |
| Run-in-progress | Polling animation + per-place status |

## 6. Reuse from Phase 1

- `_shared/photoAestheticEnums.ts::MINGLA_SIGNAL_IDS` — used for Q2 schema validation + signal-id checks
- `_shared/photoAestheticEnums.ts::sanitize*` helpers — for sanitizing Claude's free-form proposals (e.g., truncating long strings)
- `_shared/photoAestheticEnums.ts::computeCostUsd` — for cost tracking
- Anthropic API call pattern from `score-place-photo-aesthetics:370-450` — copy retry-on-429 + exponential backoff + Retry-After header logic verbatim
- 9-second per-place throttle from `score-place-photo-aesthetics:805-810` — copy verbatim

## 7. Success Criteria (numbered, testable)

| AC | Criterion | Verification |
|---|---|---|
| AC-1 | 4 migrations apply cleanly via `supabase db push` | Probe `\d signal_anchors`, `\d place_external_reviews`, `\d place_intelligence_trial_runs`, `\d place_pool` |
| AC-2 | New `place-collages` Storage bucket exists, public, 10MB limit | Probe `storage.buckets` |
| AC-3 | admin-seed-places UPDATE blocks have updated protective comment mentioning collage columns | grep verify |
| AC-4 | `run-place-intelligence-trial` edge function deploys without error | `supabase functions deploy` returns 0 |
| AC-5 | `preview_run` action reports correct anchor count + estimated cost | curl + assertion |
| AC-6 | `fetch_reviews` for one place fetches up to 100 reviews into `place_external_reviews` (idempotent) | Manual: run for 1 place, count rows in DB, verify dedup on second call |
| AC-7 | `compose_collage` for one place produces a valid PNG in `place-collages` bucket + writes URL to `place_pool.photo_collage_url` | Manual: run for 1 place, fetch URL, inspect image visually |
| AC-8 | Collage adaptive sizing works correctly: with 3 photos → 2×2, with 7 photos → 3×3, with 14 photos → 4×4 | Test 3 places with different photo counts |
| AC-9 | `run_trial` with all 32 anchors committed produces 32 rows in `place_intelligence_trial_runs` with `status='completed'` (allowing some failures) | Run trial, query result table |
| AC-10 | Q1 response is sanitized: `proposed_vibes` ≤ 20 strings, each ≤ 500 chars, no nulls | Validate parsed JSON |
| AC-11 | Q2 response has exactly 16 evaluations, one per Mingla signal, all confidence ∈ [0,10] | Validate parsed JSON |
| AC-12 | Cost guard at $5 trips correctly if estimated total exceeds | Test with mock high estimate |
| AC-13 | Rate-limit retry on Anthropic 429 honors Retry-After header | Inject 429 in test |
| AC-14 | Admin page `#/place-intelligence-trial` renders + Signal Anchors tab loads + each section shows 2 slots | Manual UI test |
| AC-15 | Empty / loading / error states all explicit per section (Const #3) | Manual UI test |
| AC-16 | RLS: non-admin user CANNOT read `signal_anchors`, `place_external_reviews`, or `place_intelligence_trial_runs` | curl with non-admin JWT |
| AC-17 | I-PHOTO-AESTHETIC-DATA-SOLE-OWNER preserved — trial does NOT write to `place_pool.photo_aesthetic_data` | grep verify, runtime probe |
| AC-18 | I-COLLAGE-SOLE-OWNER established — admin-seed-places carve-out comment present + grep proves no UPDATE writes the column | grep verify |
| AC-19 | I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING declared in INVARIANT_REGISTRY (DRAFT, ACTIVE on CLOSE) | Read invariant registry |
| AC-20 | Vite build EXIT=0; deno check on edge function passes | CI verify |

## 8. Invariants

### 8.1 Preserved

- I-PHOTO-AESTHETIC-DATA-SOLE-OWNER (from Phase 1) — trial does NOT touch this column
- I-FIELD-MASK-SINGLE-OWNER — admin-seed-places carve-out updated for new collage columns
- I-REFRESH-NEVER-DEGRADES — collage cached + fingerprinted; re-seed cannot clobber

### 8.2 NEW (DRAFT, flips ACTIVE on CLOSE)

- **I-COLLAGE-SOLE-OWNER** — `place_pool.photo_collage_url` + `photo_collage_fingerprint` written ONLY by `run-place-intelligence-trial` `compose_collage` action. admin-seed-places, bouncer, signal scorer MUST NOT write these columns.
- **I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING** — `place_intelligence_trial_runs` rows MUST NOT be read by any production scoring or ranking surface. Trial is research-only. Future ORCH may decide to act on findings via a NEW production pipeline; this invariant prevents accidental coupling.

## 9. Test Cases

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Pick first anchor for `brunch` | Click empty slot → modal → pick top candidate | DB row created, slot shows committed badge | UI + DB |
| T-02 | Replace anchor (collision) | Pick a 2nd `brunch` anchor with same anchor_index | UI prompts replace confirmation; old gets uncommitted; new committed | UI + DB |
| T-03 | Run trial with all 32 anchors committed | Click Run trial | 32 places processed, results visible in Tab 2 | Full stack |
| T-04 | Run trial with <32 anchors committed | Click Run trial | Button disabled OR explicit error toast | UI + edge fn |
| T-05 | Re-run trial (idempotent on collage + reviews) | Click Run trial again on same anchors | Collages reused (fingerprint match), reviews reused (last fetch < 30 days) | Edge fn |
| T-06 | Force-refresh reviews for one place | Call fetch_reviews with force_refresh=true | Reviews re-fetched from Serper, deduped on insert | Edge fn |
| T-07 | Anthropic 429 mid-trial | Inject 429 response | Retry with backoff, eventually succeeds OR marks place failed | Edge fn |
| T-08 | Serper 500 mid-fetch | Inject 500 | Retry, then mark failed; trial continues with other places | Edge fn |
| T-09 | Place with 0 stored photos | Run trial for it | Compose_collage skips OR returns "no photos" sentinel; trial fails gracefully for that place only | Edge fn |
| T-10 | Place with 50 reviewer photos | Run trial | Top 11 selected by recency × likes; collage is 4×4 (5 marketing + 11 reviewer) | Edge fn |
| T-11 | Trial Results tab shows aggregates | Open after run | Total runs, cost, success counts visible | UI |
| T-12 | Per-place expansion in Trial Results | Click expand | Collage + Q1 + Q2 visible side-by-side | UI |
| T-13 | Non-admin user attempts to read signal_anchors | curl with regular JWT | 401/403 OR empty result | Security |
| T-14 | Cost guard trips | Set guard to $0.01 | preview_run + run_trial both refuse | Edge fn |

## 10. Implementation Order

Strict sequence — each step's output gates the next:

1. **DB migrations (4 files)** + Storage bucket creation — implementor writes SQL, operator runs `supabase db push`
2. **admin-seed-places carve-out comment** — protective comment update, deploy edge function
3. **`_shared/imageCollage.ts`** helper — Deno imagescript wrapper for adaptive grid composition
4. **`run-place-intelligence-trial` edge function** with all 7 actions
5. **`place-intelligence-trial.js` constants** in admin (signal IDs, score thresholds, etc.)
6. **`PlaceIntelligenceTrialPage.jsx`** — page shell + tabs
7. **`SignalAnchorsTab.jsx`** + `SignalCandidatePicker.jsx` — anchor picker UI
8. **`TrialResultsTab.jsx`** — results viewer
9. **Wire route + nav entry** (App.jsx + constants.js + Sidebar.jsx)
10. **Verify Vite build EXIT=0**
11. **Deploy edge function** (`supabase functions deploy`)
12. **Manual operator test** — pick 1 anchor for 1 signal, verify candidate picker + commit flow works
13. **Operator commits all 32 anchors** (~1 hour)
14. **Click Run trial** — wait ~30 min, inspect output

## 11. Regression Prevention

- New invariants codified in `INVARIANT_REGISTRY.md`
- admin-seed-places grep-gate: CI test that `admin-seed-places/index.ts` UPDATE blocks contain ZERO references to `photo_collage_url` or `photo_collage_fingerprint` (mirroring photo_aesthetic_data carve-out enforcement)
- Edge function naming: `run-place-intelligence-trial` is distinct from `score-place-photo-aesthetics` to prevent operator confusion

## 12. Cost Guard

- `COST_GUARD_USD = 5.0` enforced in edge function. Estimated ~$1.50 for full trial. Aborts if pre-flight estimate exceeds.
- Anthropic Retry-After header honored on 429 (per Phase 1 pattern)
- Serper rate limit: 500/period — 32 places × 5 calls = 160, comfortable headroom

## 13. Reporting (post-CLOSE)

After the trial completes successfully, the orchestrator updates 7 owner artifacts (per Post-PASS Protocol). Operator-facing summary should highlight:

- How many "new signals" Claude proposed across all 32 places (aggregated)
- How many existing signals had ≥80% confidence Q2 evaluations
- Most-mentioned vibe tags (Q1 across all 32)
- Discrepancies: places where Claude's Q2 disagrees strongly with current `place_scores` ranking

This data informs the operator's decision on whether to launch a follow-on ORCH for signal-schema evolution.

## 14. Out-of-scope follow-ups (orchestrator registers as future ORCHs if needed)

- ORCH-0713 (potential): Migrate Phase 1 photo-aesthetic scorer to use the richer bundled input (collage + reviews context) — IF trial shows significant improvement
- ORCH-0714 (potential): Productionize reviews fetch for all R+C+D places — IF operator decides to roll out trial pipeline
- ORCH-0715 (potential): Schema evolution — add new Mingla signals based on Claude's Q1 proposals — operator-driven, post-trial

---

**Spec status:** Binding contract for implementor. No deviation permitted without orchestrator amendment. All 20 ACs must verify before close.
