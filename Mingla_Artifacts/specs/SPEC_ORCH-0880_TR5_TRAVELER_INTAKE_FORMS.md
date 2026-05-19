# SPEC — ORCH-0880 [Tr5 Traveler Intake Forms]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

> **SPEC AMENDMENT 2026-05-19 (post-orchestrator REVIEW)** — operator decisions locked via AskUserQuestion:
> - **Q11 locked to PER-TIER schema** (override default; rejected per-trip). Tr5 ships per-tier intake forms — Standard tier and VIP tier can have different question sets. See §15 for full scope deltas across §3 / §4 / §5 / §6 / §7 / §8 / §9 / §13.
> - **Design routing = standalone `/ui-ux-pro-max` pass first** (override default; rejected implementor pre-flight invoke). Designer produces `Mingla_Artifacts/design/DESIGN_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` BEFORE implementor dispatches. Implementor follows the design artifact verbatim.
> - Q1 (drag-drop library) and Q12 (CSV export) accepted defaults: `react-native-draggable-flatlist` + CSV export out of scope. Implementor verifies library in package.json pre-Step-1.
>
> All §1–§14 below remain authoritative; §15 documents the per-tier deltas the designer + implementor must apply.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md`
**Dispatch (lock-source):** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` (3 operator decisions LOCKED at INTAKE)
**Author confidence:** H — investigation grounded, every contract maps to a six-field finding, 12 of 15 SPEC questions resolved by investigation defaults, 3 open questions surfaced for operator decision pre-implementor.

---

## 1. Layman summary

- **What ships:** Trip planners build custom traveler intake forms in a new wizard Step 6 (drag-drop question builder with live buyer-view preview). Buyers fill the form at checkout in a new `/checkout-trip/[tripEventId]/intake` route between the buyer-details step and the payment step. Planners see all answers per traveler in the trip-dashboard Travelers tab. Schema is editable post-publish via the EditPublishedTripScreen accordion with the same ChangeSummaryModal + reason + buyer-notification pattern ORCH-0876 V2 built; buyers whose answers are affected get a re-answer notification.
- **What's NEW vs prior:** 7 question types (short_text, long_text, single_choice, multi_choice, date, number, file_upload with images + PDFs + docs), drag-drop schema builder, `trip_intake_files` storage bucket with anon-write + planner-read RLS, schema-version snapshot per order, 30-day GDPR-style purge of canceled-order intake data + file uploads.
- **What's REUSED (architecturally critical):** `biz_update_live_trip` unified RPC from ORCH-0876 V2 is EXTENDED, not parallel-built. Schema edits flow through the same RPC + audit log + ChangeSummaryModal infrastructure. This is the single most important spec decision — see §4 D1 finding.
- **Migration count:** 1 (`supabase/migrations/20260618000000_orch_0880_tr5_traveler_intake_forms.sql`).
- **Edge functions:** 2 new (`trip-intake-upload-signed-url`, `cron-purge-canceled-intake-data`) + 1 modified (`ticket-checkout-create` adds 400 gate).
- **File count:** ~35-45 in a single PR. Estimated 1.5-week scope per §6.2 brief.
- **EAS OTA eligible:** YES. Pure JS UI + edge fns; uses existing `expo-document-picker` + `expo-image-picker` (no new native modules). Migration must apply BEFORE OTA per `feedback_orchestrator_deploys_edge_functions.md`.

---

## 2. Scope + non-goals

### IN SCOPE

- `events.trip_intake_schema jsonb` column + `events_trip_intake_schema_valid` CHECK constraint + `validate_trip_intake_schema(jsonb)` IMMUTABLE function
- `orders.intake_form_data jsonb` column (stores `{ schema_version_id: uuid, answers: { question_id: value } }`)
- `trip_intake_files` storage bucket + RLS policies (anon INSERT/SELECT own paths via signed URL; planner SELECT under owned brands at event_manager+ rank; service role full access)
- `biz_update_live_trip` RPC extension — new Section 4f refund-gate logic + Section 5e update logic for `intake_schema` patch key. NO new RPC.
- 7 question types: `short_text`, `long_text`, `single_choice`, `multi_choice`, `date`, `number`, `file_upload`
- Trip wizard Step 6 (Intake form) — drag-drop schema-builder + live preview + per-question type editor; Review becomes Step 7
- EditPublishedTripScreen Intake Form accordion section — schema edits trigger ChangeSummaryModal + re-answer notification dispatch
- Buyer-fill route `/checkout-trip/[tripEventId]/intake.tsx` (anon-tolerant, no useAuth) — rendered ONLY when trip has intake schema with ≥1 question; bypassed otherwise
- Required-field hard-block at checkout — `ticket-checkout-create` rejects with 400 `intake_form_required` when missing
- Travelers-tab per-traveler card extension — collapsible intake answer section + file thumbnails + tap-to-enlarge modal
- localStorage/AsyncStorage abandonment recovery — partial fill persists across reload (7-day TTL, keyed by trip event ID + buyer email)
- 30-day post-cancel data purge cron — `cron-purge-canceled-intake-data` edge function on hourly schedule (filter rows older than 30d, null `orders.intake_form_data`, purge storage bucket paths)
- 2 new audit slugs: `trip_intake_schema_edited` (emitted by `biz_update_live_trip` extension) + `intake_form_data_purged` (emitted by cron)
- 1 new buyer notification kind: `buyer_intake_form_re_answer_required`
- 3 new strict-grep CI gates: schema-valid-at-write, required-blocks-checkout, file-rls-anon-write-planner-read
- ORCH_0880_BACKEND_ALLOWLIST added to ORCH-0863 C7 gate

### EXPLICITLY OUT OF SCOPE (defer to follow-up ORCH)

- **Consumer-app intake-fill** (app-mobile) — register as ORCH-#### at Tr5 CLOSE, ships AFTER C1 [Consumer Discover Trips Tab] lands
- **CSV/PDF export of answers** (Q12) — operator views inline only in v1; export deferred
- **Per-tier schema** (Q11) — per-trip only in v1; per-tier deferred until operator demand surfaces
- **Admin dashboard view of answers** — operators self-serve via trip Travelers tab
- **Signature question type** (drawn signature) — adds canvas dep; deferred
- **Conditional questions** ("show question B only if answer to A = X") — non-MVP
- **Schema templates / question library** ("save this form as a template", "import question from past trip") — non-MVP
- **Buyer edit-own-answer after submission** — answers are immutable post-submit in v1; re-answer only fires when planner forces it

### ASSUMPTIONS

- `react-native-draggable-flatlist` is already in `mingla-business` deps (implementor verifies via `package.json` grep pre-Step-1; if missing, implementor adds and notes it as a deviation requiring native build NOT EAS OTA)
- `expo-document-picker` and `expo-image-picker` are in `mingla-business` deps (high confidence — they're standard Expo modules and were used by ORCH-0876 V2 cover picker)
- ORCH-0876 V2 EditPublishedTripScreen accordion infrastructure follows the event-side ChangeSummaryModal pattern from ORCH-0704
- Tr6 [Discussion Board / Group Chat] will not collide on `trip_intake_files` bucket name or `intake_schema` column name

---

## 3. Cross-Surface Impact

### Surfaces COVERED

| # | Surface | What changes for end user | Files touched | Parity |
|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/`) | NOTHING. No changes to consumer app. Intake-fill on consumer app deferred until C1 ships. | None | N/A (skipped — surface not in scope) |
| 2 | **Consumer Android** | NOTHING. Same as #1. | None | N/A (skipped — surface not in scope) |
| 3 | **Buyer/anonymous Web** (`mingla-business/`) | New `/checkout-trip/[tripEventId]/intake` step between buyer and payment when trip has schema. Buyer fills form, uploads files, taps Continue. localStorage partial-fill recovery. Required questions block submission with inline errors. | `app/checkout-trip/[tripEventId]/{intake.tsx,_layout.tsx,buyer.tsx}`, `src/components/checkout/IntakeFormRenderer.tsx` + 7 question renderers, `src/services/intakeSchemaService.ts`, `src/hooks/useIntakeSchema.ts` | Automatic (shared RN-Web bundle with #4/#5) |
| 4 | **Business iOS** (`mingla-business/`) | New wizard Step 6 (Intake form) with drag-drop builder + live preview; EditPublishedTripScreen Intake accordion; Travelers tab per-traveler card extension with collapsible answers + file thumbnails | `src/components/trip/TripCreatorStep6Intake.tsx` + builder primitives, `TripCreatorWizard.tsx` extension, `EditPublishedTripScreen.tsx` accordion section, `app/trip/[id]/index.tsx` Travelers tab extension | Automatic (shared with #5 via RN bundle) |
| 5 | **Business Android** | Same as #4. | Same as #4. | Automatic (shared with #4) |
| 6 | **Admin Web** (`mingla-admin/`) | NOTHING. No admin intake view planned. Planners self-serve via trip Travelers tab. | None | N/A (skipped — admin doesn't render trip dashboards) |
| 7 | **Business Web preview** | Same as #4/#5 via RN-Web bundle. Schema-builder + Travelers tab work in business-web-preview for live-fire QA. | Same as #4 | Automatic |

### Surfaces NOT COVERED (with reason)

- **Consumer iOS/Android:** No consumer trip-purchase exists yet. C1 builds the Discover Trips tab; a future parity ORCH wires intake-fill into the consumer-app checkout chain after C1 ships.
- **Admin Web:** No admin Travelers view planned per dispatch; planners self-serve.

### Per-surface success criteria

Where parity is automatic (RN bundle shared), one SC covers all platforms. Where divergent paths exist (e.g., file-upload on iOS vs web), separate per-platform SCs are issued in §9.

---

## 4. Database layer

### 4.1 Migration `20260618000000_orch_0880_tr5_traveler_intake_forms.sql`

#### 4.1.A — Columns

```sql
BEGIN;

-- Trip intake schema (operator-defined form structure)
ALTER TABLE public.events
  ADD COLUMN trip_intake_schema jsonb DEFAULT NULL;

COMMENT ON COLUMN public.events.trip_intake_schema IS
  'ORCH-0880 Tr5: planner-defined intake form schema for trips. Shape: { schema_version_id: uuid, questions: [{ id: uuid, type: text, label: text, required: boolean, position: int, ... type-specific fields }] }. NULL = no intake form on this trip. Trip-only; events have no intake forms. Validated by events_trip_intake_schema_valid CHECK constraint via validate_trip_intake_schema(jsonb) IMMUTABLE function.';

-- Buyer intake form answers (per-order snapshot)
ALTER TABLE public.orders
  ADD COLUMN intake_form_data jsonb DEFAULT NULL;

COMMENT ON COLUMN public.orders.intake_form_data IS
  'ORCH-0880 Tr5: buyer-submitted answers + schema version snapshot. Shape: { schema_version_id: uuid, answers: { question_id: value } }. NULL = no answers (either trip has no intake schema OR order created before Tr5 OR data purged after 30d post-cancel per cron-purge-canceled-intake-data).';
```

#### 4.1.B — Schema validator function

```sql
CREATE OR REPLACE FUNCTION public.validate_trip_intake_schema(p_schema jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_question jsonb;
  v_question_ids text[] := '{}'::text[];
  v_positions int[] := '{}'::int[];
  v_type text;
  v_id text;
  v_position int;
  v_required boolean;
  v_label text;
  v_options jsonb;
  v_question_count int;
BEGIN
  -- NULL allowed (no schema)
  IF p_schema IS NULL THEN
    RETURN true;
  END IF;

  -- Must be object with schema_version_id + questions
  IF jsonb_typeof(p_schema) <> 'object' THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: schema must be a jsonb object';
  END IF;

  IF NOT (p_schema ? 'schema_version_id' AND p_schema ? 'questions') THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: schema must contain schema_version_id and questions';
  END IF;

  -- schema_version_id must be uuid-shaped (36 chars)
  IF char_length(p_schema->>'schema_version_id') <> 36 THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: schema_version_id must be uuid';
  END IF;

  -- questions must be array
  IF jsonb_typeof(p_schema->'questions') <> 'array' THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: questions must be array';
  END IF;

  v_question_count := jsonb_array_length(p_schema->'questions');

  -- 0 questions allowed (schema present but empty — planner is mid-build)
  -- Max 20 questions (UX guard)
  IF v_question_count > 20 THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: max 20 questions per schema';
  END IF;

  -- Per-question validation
  FOR v_question IN SELECT * FROM jsonb_array_elements(p_schema->'questions')
  LOOP
    v_type := v_question->>'type';
    v_id := v_question->>'id';
    v_position := (v_question->>'position')::int;
    v_required := (v_question->>'required')::boolean;
    v_label := v_question->>'label';

    -- Type allowlist
    IF v_type NOT IN ('short_text', 'long_text', 'single_choice', 'multi_choice', 'date', 'number', 'file_upload') THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question type must be one of short_text, long_text, single_choice, multi_choice, date, number, file_upload (got %)', v_type;
    END IF;

    -- ID required, uuid-shaped, unique
    IF v_id IS NULL OR char_length(v_id) <> 36 THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question id must be uuid';
    END IF;

    IF v_id = ANY (v_question_ids) THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: duplicate question id %', v_id;
    END IF;
    v_question_ids := array_append(v_question_ids, v_id);

    -- Position required, integer, unique
    IF v_position IS NULL OR v_position < 0 THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question position must be int >= 0';
    END IF;

    IF v_position = ANY (v_positions) THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: duplicate question position %', v_position;
    END IF;
    v_positions := array_append(v_positions, v_position);

    -- Required must be boolean
    IF v_required IS NULL THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question required must be boolean';
    END IF;

    -- Label non-empty, max 200 chars
    IF v_label IS NULL OR char_length(v_label) = 0 OR char_length(v_label) > 200 THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question label must be 1-200 chars';
    END IF;

    -- Type-specific validation
    CASE v_type
      WHEN 'single_choice', 'multi_choice' THEN
        v_options := v_question->'options';
        IF v_options IS NULL OR jsonb_typeof(v_options) <> 'array' THEN
          RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: choice questions must have options array';
        END IF;
        IF jsonb_array_length(v_options) < 2 OR jsonb_array_length(v_options) > 10 THEN
          RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: choice questions must have 2-10 options';
        END IF;
      WHEN 'file_upload' THEN
        -- max_files default 1, max 5
        IF v_question ? 'max_files' AND ((v_question->>'max_files')::int < 1 OR (v_question->>'max_files')::int > 5) THEN
          RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: file_upload max_files must be 1-5';
        END IF;
      ELSE
        -- text/date/number have no required type-specific fields beyond base
        NULL;
    END CASE;
  END LOOP;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_trip_intake_schema(jsonb) TO authenticated, anon, service_role;
```

#### 4.1.C — CHECK constraint

```sql
ALTER TABLE public.events
  ADD CONSTRAINT events_trip_intake_schema_valid
    CHECK (
      trip_intake_schema IS NULL
      OR (event_type = 'trip' AND public.validate_trip_intake_schema(trip_intake_schema))
    );
```

#### 4.1.D — `biz_update_live_trip` EXTENSION (CREATE OR REPLACE)

Mirror current shape; add Section 4f + Section 5e + audit log support for `intake_schema` patch key. Full SQL omitted here (implementor follows existing RPC source verbatim + adds two blocks); critical snippets:

```sql
-- Section 4f. intake_schema refund-gate (between current 4e and 5a)
-- Per D2 LOCKED operator decision: schema edits ALLOWED on published trips with sales,
-- BUT system enqueues re-answer notification per I-PROPOSED-TR5-RE-ANSWER-NOTIFICATION-DISPATCH.
-- No hard block; only the audit + notification fan-out side-effect.
IF p_patch ? 'intake_schema' THEN
  -- Validate via CHECK constraint helper before write attempt
  IF NOT public.validate_trip_intake_schema(p_patch->'intake_schema') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schema');
  END IF;
  -- (Detection of question shape changes + re-answer notification dispatch
  --  handled by trigger tg_orders_intake_re_answer_required defined below
  --  in §4.1.F. Refund-gate here is intentionally permissive.)
END IF;
```

```sql
-- Section 5e. intake_schema update (between current 5d and 6)
IF p_patch ? 'intake_schema' THEN
  UPDATE public.events SET
    trip_intake_schema = p_patch->'intake_schema',
    updated_at = now()
  WHERE id = p_event_id;
END IF;
```

```sql
-- Section 6 changed_keys: ensure 'intake_schema' included via existing
-- `v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_patch));` (automatic).

-- Section 6 severity: intake_schema = 'additive' (default). Override to
-- 'material' if questions structure changed (re-answer required) — detected
-- at trigger level in §4.1.F.
```

#### 4.1.E — Storage bucket + RLS

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip_intake_files', 'trip_intake_files', false)
ON CONFLICT (id) DO NOTHING;

-- Anon buyer can INSERT to their own path (signed URL pattern)
CREATE POLICY "trip_intake_files_anon_buyer_insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'trip_intake_files'
    -- Path: {event_id}/{order_id}/{question_id}/{filename}
    AND (storage.foldername(name))[1] IS NOT NULL  -- event_id
    AND (storage.foldername(name))[2] IS NOT NULL  -- order_id
  );

-- Anon buyer can SELECT only their own path (signed URL pattern; signed URLs scoped per object)
CREATE POLICY "trip_intake_files_anon_buyer_select"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'trip_intake_files');
-- Note: anon SELECT is broad-policy; protection is at signed-URL layer
-- (URL contains event_id + order_id; only buyer who created the file has the URL).
-- See I-PROPOSED-TR5-FILE-RLS-ANON-WRITE-PLANNER-READ for adversarial test
-- requirements (signed URL expiry + scope).

-- Planner reads under owned brand at event_manager+ rank
CREATE POLICY "trip_intake_files_planner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip_intake_files'
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ((storage.foldername(name))[1])::uuid
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Service role full access (cron purge)
CREATE POLICY "trip_intake_files_service_role_all"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'trip_intake_files');
```

#### 4.1.F — Re-answer notification trigger

```sql
CREATE OR REPLACE FUNCTION public.tg_intake_schema_re_answer_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_question_ids text[];
  v_new_question_ids text[];
  v_affected_order record;
BEGIN
  IF NEW.trip_intake_schema IS NULL OR OLD.trip_intake_schema IS NULL THEN
    RETURN NEW;
  END IF;

  -- Compare question ids + shapes; if any question with existing answers changed,
  -- enqueue re-answer notification for affected orders.
  SELECT array_agg((q->>'id'))
    INTO v_old_question_ids
    FROM jsonb_array_elements(OLD.trip_intake_schema->'questions') q;
  SELECT array_agg((q->>'id'))
    INTO v_new_question_ids
    FROM jsonb_array_elements(NEW.trip_intake_schema->'questions') q;

  -- For each affected order, write a notification row (handled by
  -- ticket-confirmation-dispatch fan-out)
  FOR v_affected_order IN
    SELECT id, buyer_email FROM public.orders
    WHERE event_id = NEW.id
      AND intake_form_data IS NOT NULL
      AND payment_status NOT IN ('failed', 'cancelled')
  LOOP
    -- Enqueue notification (insert into a notifications outbox table per
    -- ticket-confirmation-dispatch pattern; exact mechanism per existing
    -- ORCH-0788 buyerLifecycleAdapters)
    INSERT INTO public.notifications_outbox
      (kind, order_id, buyer_email, payload, enqueued_at)
    VALUES (
      'buyer_intake_form_re_answer_required',
      v_affected_order.id,
      v_affected_order.buyer_email,
      jsonb_build_object(
        'event_id', NEW.id,
        'changed_question_ids', v_new_question_ids,
        'schema_version_id', NEW.trip_intake_schema->>'schema_version_id'
      ),
      now()
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_events_intake_schema_re_answer
  AFTER UPDATE OF trip_intake_schema ON public.events
  FOR EACH ROW
  WHEN (OLD.trip_intake_schema IS DISTINCT FROM NEW.trip_intake_schema)
  EXECUTE FUNCTION public.tg_intake_schema_re_answer_dispatch();
```

(Note: `notifications_outbox` table existence verification deferred to implementor — if it doesn't exist, implementor surfaces as deviation and uses the actual ORCH-0788 notification dispatch mechanism.)

#### 4.1.G — Indexes

```sql
CREATE INDEX events_trip_intake_schema_idx
  ON public.events ((trip_intake_schema IS NOT NULL))
  WHERE event_type = 'trip' AND deleted_at IS NULL;

CREATE INDEX orders_intake_form_data_idx
  ON public.orders ((intake_form_data IS NOT NULL))
  WHERE payment_status NOT IN ('failed', 'cancelled');
```

#### 4.1.H — Self-verification DO-block (end of migration)

Mirrors ORCH-0875 pattern: assert column exists, CHECK constraint exists, function exists, bucket exists, RLS policies exist, trigger exists. Implementor follows ORCH-0875 migration end-of-file DO-block as template.

COMMIT;

---

## 5. Edge function layer

### 5.1 `supabase/functions/trip-intake-upload-signed-url/index.ts` (NEW)

**Auth:** anon-tolerant (matches `feedback_anon_buyer_routes.md`). No JWT required.

**Request shape (POST):**
```json
{
  "event_id": "uuid",
  "order_id": "uuid",
  "question_id": "uuid",
  "filename": "passport.pdf",
  "mime_type": "application/pdf",
  "file_size_bytes": 1234567
}
```

**Validation:**
- `event_id` exists, `event_type='trip'`, `trip_intake_schema` non-null
- `question_id` exists in schema, `type='file_upload'`
- `mime_type` in allowlist (image/jpeg, image/png, image/heic, image/webp, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document)
- `file_size_bytes` <= 10_485_760 (10 MB)
- `order_id` either matches existing draft order OR a UUID the buyer minted client-side (for pre-checkout uploads; rare path)
- `filename` sanitized per `feedback_supabase_storage_path_sanitization` pattern

**Response shape (200):**
```json
{
  "signed_url": "https://...",
  "path": "trip_intake_files/{event_id}/{order_id}/{question_id}/{sanitized_filename}",
  "expires_at": "ISO-8601 timestamp 1h from now"
}
```

**Error shapes:**
- 400 `invalid_event_id` / `event_not_trip` / `schema_not_present` / `question_not_found` / `question_not_file_upload`
- 400 `mime_type_not_allowed` / `file_too_large`
- 500 `signed_url_generation_failed`

**Audit slug:** none (uploads are high-frequency; per-upload audit too noisy)

### 5.2 `supabase/functions/cron-purge-canceled-intake-data/index.ts` (NEW)

**Auth:** service-role only (cron). Verify `SUPABASE_SERVICE_ROLE_KEY` bearer.

**Schedule:** hourly via pg_cron (mirror ORCH-0875 `process-booking-deadlines` pattern)

**Behavior:**
1. Find orders with `payment_status = 'cancelled'` AND `cancelled_at < now() - INTERVAL '30 days'` AND `intake_form_data IS NOT NULL`
2. For each:
   a. List storage objects under `trip_intake_files/{event_id}/{order_id}/*`
   b. Delete each storage object
   c. NULL `intake_form_data` on the order
3. Write audit row per batch: `intake_form_data_purged` with count

**Idempotent:** the WHERE filter naturally skips already-purged orders.

**Audit slug:** `intake_form_data_purged` (NEW; register in `auditActionLabels.ts`)

### 5.3 `supabase/functions/ticket-checkout-create/index.ts` (MODIFIED)

Add `intake_form_required` 400 gate. Insertion point: after existing event lookup, before payment intent creation.

```ts
// ORCH-0880 — Tr5 intake form gate per I-PROPOSED-TR5-REQUIRED-BLOCKS-CHECKOUT
if (event.event_type === 'trip' && event.trip_intake_schema !== null) {
  const requiredQuestions = (event.trip_intake_schema.questions as IntakeQuestion[])
    .filter(q => q.required);
  if (requiredQuestions.length > 0) {
    const provided = body.intake_form_data?.answers ?? {};
    const missingIds = requiredQuestions
      .filter(q => isAnswerEmpty(q.type, provided[q.id]))
      .map(q => q.id);
    if (missingIds.length > 0) {
      return jsonResponse(
        { error: 'intake_form_required', missing_question_ids: missingIds },
        400,
      );
    }
  }
  // Validate schema_version_id matches current
  const submittedVersion = body.intake_form_data?.schema_version_id;
  const currentVersion = event.trip_intake_schema.schema_version_id;
  if (submittedVersion !== currentVersion) {
    return jsonResponse(
      {
        error: 'intake_schema_stale',
        current_schema_version_id: currentVersion,
        submitted_schema_version_id: submittedVersion,
      },
      409,
    );
  }
}
```

### 5.4 `supabase/functions/_shared/email/buyerLifecycleAdapters.ts` (MODIFIED)

Add `buyer_intake_form_re_answer_required` template (subject + body). Reuse existing kind structure.

### 5.5 `supabase/functions/ticket-confirmation-dispatch/index.ts` (MODIFIED)

Extend kind switch for `buyer_intake_form_re_answer_required`. Fan-out to email + push (D10).

---

## 6. Service layer

### `mingla-business/src/services/intakeSchemaService.ts` (~250 lines)

```ts
// Public API
export interface IntakeQuestion {
  id: string; // uuid
  type: 'short_text' | 'long_text' | 'single_choice' | 'multi_choice' | 'date' | 'number' | 'file_upload';
  label: string;
  required: boolean;
  position: number;
  // Type-specific
  options?: string[]; // single_choice, multi_choice (2-10 items)
  max_files?: number; // file_upload (1-5)
  min?: number; // number
  max?: number; // number
}

export interface IntakeSchema {
  schema_version_id: string; // uuid
  questions: IntakeQuestion[]; // max 20
}

export interface IntakeAnswer {
  // For text/date/number: string
  // For single_choice: string (option value)
  // For multi_choice: string[] (option values)
  // For file_upload: { path: string, filename: string, mime_type: string, size_bytes: number }[]
}

export interface IntakeFormData {
  schema_version_id: string;
  answers: { [question_id: string]: IntakeAnswer };
}

// CRUD
export async function getTripIntakeSchema(eventId: string): Promise<IntakeSchema | null>;
export async function updateTripIntakeSchema(eventId: string, schema: IntakeSchema | null, reason?: string): Promise<void>;
// reason required when called from EditPublishedTripScreen; optional during draft wizard

// Validation
export function validateIntakeSchemaClient(schema: IntakeSchema): IntakeSchemaValidationError | null;
export function isAnswerEmpty(type: IntakeQuestion['type'], answer: unknown): boolean;
export function validateAnswerAgainstSchema(schema: IntakeSchema, answers: IntakeFormData['answers']): { question_id: string; error: string }[];

// Upload
export async function uploadIntakeFile(args: {
  eventId: string;
  orderId: string;
  questionId: string;
  file: File | Asset;
}): Promise<{ path: string; filename: string; mime_type: string; size_bytes: number }>;
```

Error contract: mirror ORCH-0875 `refundPolicyService` 5-pattern error discrimination.

Direct supabase `.update()` chains for draft writes MUST chain `.eq("event_type", "trip").select("id").maybeSingle()` per I-PROPOSED-I + I-PROPOSED-TR2-EVENTS-TYPE-FILTER. Published-trip writes route through `biz_update_live_trip` RPC instead.

---

## 7. Hook layer

### `mingla-business/src/hooks/useIntakeSchema.ts` (~150 lines)

```ts
export function useTripIntakeSchema(eventId: string): UseQueryResult<IntakeSchema | null>;
export function useUpdateTripIntakeSchema(): UseMutationResult<void, IntakeSchemaServiceError, { eventId: string; schema: IntakeSchema | null; reason?: string }>;
export function useUploadIntakeFile(): UseMutationResult<UploadResult, UploadError, UploadArgs>;
```

Query keys via `intakeSchemaKeys` factory. Mutation `onSuccess` invalidates `businessEvents` + `trip` trees.

---

## 8. Component layer

Full file list in INVESTIGATION §7 blast radius. Key contracts:

### Wizard side
- **IntakeSchemaBuilder** — drag-drop question list; props = `{ schema, onSchemaChange, disabled }`. Internal state for new-question type picker. Uses `react-native-draggable-flatlist`. Live commits to parent on every change (per ORCH-0875 RefundPolicyEditor live-commit pattern — eliminates blur-race).
- **IntakeQuestionEditor** — modal/sheet per question (label, required toggle, type-specific config). Mirror `RefundPolicyEditor` structure.
- **IntakeQuestionPreview** — read-only renderer of a single question in buyer's-view style. Shared with buyer-fill renderers.
- **TripCreatorStep6Intake** — host for IntakeSchemaBuilder + IntakeQuestionPreview side-by-side (or stacked on narrow screens). Lives between Step 5 (Cancellation & deadline) and Step 7 (Review) in TripCreatorWizard.

### Buyer-fill side
- **`/checkout-trip/[tripEventId]/intake.tsx`** — route. NO useAuth. Reads schema from `usePublicTripById`. Renders `IntakeFormRenderer`. Continue button: validates all required answered; if pass, persists to cart context + advances to `/payment`. Otherwise inline error per missing question.
- **IntakeFormRenderer** — props `{ schema, partialData, onSubmit, validationErrors }`. Renders 7 question types via switch. Handles localStorage partial-fill persistence (key = `tr5_intake_draft_${eventId}_${buyer_email}`).
- **IntakeQuestionShortText/LongText/etc.** — one per type. Common props `{ question, value, onChange, error }`. Honor `feedback_keyboard_never_blocks_input.md`.
- **IntakeQuestionFileUpload** — `expo-document-picker` for PDF/doc; `expo-image-picker` for image. Tap → picker → upload via `useUploadIntakeFile` → display filename + thumbnail (for images) + remove button. Multi-file support up to `question.max_files`.

### Travelers tab side
- **TravelerIntakeAnswerCard** — collapsible inside existing Traveler card. Renders each question label + answer. File answers via `IntakeAnswerFileThumbnail` (lazy-loaded signed URL).
- **IntakeAnswerFileThumbnail** — image: inline thumbnail + tap → modal. PDF/doc: filename + download icon.
- **IntakeAnswerFilePreview** — full-screen modal for image enlarge.

### EditPublishedTripScreen side
- **EditPublishedTripIntakeAccordion** — accordion section. Mirror existing ORCH-0876 V2 accordion shape. Schema edits trigger `biz_update_live_trip` with `intake_schema` patch key + reason via ChangeSummaryModal.

---

## 9. Success criteria (29 SCs)

### Schema layer
- **SC-01** — `events.trip_intake_schema jsonb` column exists; NULL default; CHECK constraint `events_trip_intake_schema_valid` rejects invalid shape with `I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE` message
- **SC-02** — `orders.intake_form_data jsonb` column exists; NULL default
- **SC-03** — `validate_trip_intake_schema(jsonb)` IMMUTABLE function returns true for null/valid schemas, raises on invalid
- **SC-04** — `trip_intake_files` storage bucket exists, public=false, 4 RLS policies live (anon insert, anon select, planner read, service role all)
- **SC-05** — `biz_update_live_trip` RPC accepts `intake_schema` patch key, runs schema validation, updates `events.trip_intake_schema`, writes audit log
- **SC-06** — `tg_events_intake_schema_re_answer` trigger fires on schema UPDATE, enqueues `buyer_intake_form_re_answer_required` notifications for affected orders

### Edge function layer
- **SC-07** — `trip-intake-upload-signed-url` returns signed URL on valid request, 400 on invalid event/question/mime/size
- **SC-08** — `cron-purge-canceled-intake-data` purges files + nulls `intake_form_data` for canceled orders older than 30d
- **SC-09** — `ticket-checkout-create` returns 400 `intake_form_required` with `missing_question_ids` when required questions unanswered
- **SC-10** — `ticket-checkout-create` returns 409 `intake_schema_stale` when submitted `schema_version_id` doesn't match current
- **SC-11** — `ticket-confirmation-dispatch` handles `buyer_intake_form_re_answer_required` kind via email + push

### Service layer
- **SC-12** — `intakeSchemaService.updateTripIntakeSchema` writes via direct supabase for draft trips, via `biz_update_live_trip` RPC for published trips
- **SC-13** — `intakeSchemaService.uploadIntakeFile` calls signed-URL endpoint, uploads to bucket, returns path + metadata
- **SC-14** — `validateAnswerAgainstSchema` returns per-question errors for missing required + type-mismatch + out-of-bounds

### Wizard (business iOS/Android/web-preview — automatic parity)
- **SC-15** — TripCreatorWizard renders 7 steps (Step 6 = Intake form, Step 7 = Review); stepper shows 7/7 progress
- **SC-16** — Step 6 renders IntakeSchemaBuilder + live IntakeQuestionPreview side-by-side
- **SC-17** — Drag-drop reorders questions; positions update; preview reflects new order
- **SC-18** — Add Question chip shows type picker; selecting a type opens IntakeQuestionEditor; saving adds question to schema
- **SC-19** — Required toggle, label edit, type-specific config (options for choice, max_files for upload) all persist
- **SC-20** — Schema autosave fires on Continue from Step 6 (mirror existing autosaveStep5 pattern)

### EditPublishedTripScreen
- **SC-21** — Intake Form accordion section renders below existing sections; tap → expands with schema-builder UI; Save changes button enabled when dirty
- **SC-22** — Save triggers ChangeSummaryModal with reason input; submit calls `biz_update_live_trip` with `intake_schema` patch; success closes modal + refetches

### Buyer-fill (buyer-anon-web — automatic parity with business RN-Web)
- **SC-23** — `/checkout-trip/[tripEventId]/intake.tsx` renders when trip has schema with ≥1 question; bypassed when schema null/empty
- **SC-24** — Progress pill shows "3 of 4" (or higher) when intake step present
- **SC-25** — Required questions block Continue with inline error per missing question
- **SC-26** — Partial fill persists in localStorage; restored on page reload within 7-day TTL
- **SC-27** — File upload: tap → picker → upload → thumbnail + filename + remove button; multi-file up to max_files

### Travelers tab (business iOS/Android — automatic parity)
- **SC-28** — Per-traveler card has collapsible Intake form answers section; tap → expands with each question + answer; file answers show thumbnail (images) or download link (PDFs/docs)

### Cross-cutting
- **SC-29** — All 14 Constitution principles preserved (no dead taps in builder/fill, no silent failures on upload/validation errors, no fabricated answer placeholders, etc.)

---

## 10. NEW DRAFT invariants

6 invariants per INVESTIGATION §8. CI gates enforce 3; runtime trigger + RPC validation enforce 3.

| # | Invariant | Enforcement |
|---|---|---|
| I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE | DB CHECK + IMMUTABLE function + client validator + CI gate `i-proposed-tr5-schema-valid-at-write` |
| I-PROPOSED-TR5-INTAKE-ANSWER-MATCHES-SCHEMA | `ticket-checkout-create` 409 gate + `validateAnswerAgainstSchema` client-side |
| I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB | `biz_update_live_trip` RPC is the only path; trigger ensures audit log |
| I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ | 4 RLS policies + signed-URL endpoint + CI gate `i-proposed-tr5-file-rls-anon-write-planner-read` |
| I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT | `ticket-checkout-create` 400 gate + CI gate `i-proposed-tr5-required-blocks-checkout` |
| I-PROPOSED-TR5-INTAKE-RE-ANSWER-NOTIFICATION-DISPATCH | `tg_events_intake_schema_re_answer` trigger + email + push fan-out in `ticket-confirmation-dispatch` |

---

## 11. Hard guards

Per dispatch + INVESTIGATION §8. Implementor MUST honor:

- Trips only (`event_type='trip'` filter on every events query/mutation)
- Preserve ORCH-0876 V2 invariants (extend `biz_update_live_trip`, don't parallel)
- Preserve ORCH-0875 5 invariants (refund/booking unchanged)
- Preserve ORCH-0869 Tr3 4 invariants (installments unchanged)
- Preserve ORCH-0806 audit-action-labels (register 2 new slugs: `trip_intake_schema_edited`, `intake_form_data_purged`)
- Preserve ORCH-0863 C7 (add ORCH_0880_BACKEND_ALLOWLIST entries: 1 migration + 2 new edge fns + 3 modified edge fns)
- I-PROPOSED-I (every `.update()` chains `.select("id").maybeSingle()`)
- I-PROPOSED-TR2-EVENTS-TYPE-FILTER (every `.from("events")` includes `.eq("event_type","trip")`)
- `feedback_anon_buyer_routes.md` — NO useAuth in `app/checkout-trip/[tripEventId]/intake.tsx`
- `feedback_keyboard_never_blocks_input.md`, `feedback_toast_needs_absolute_wrap.md`, `feedback_rn_color_formats.md`, `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md`
- Constitution #3 + #9 + #12 + #13
- One PR per CLOSE
- Step 0.5 regression-test gate + Step 1.5 DIAG-marker reap
- Per `feedback_implementor_uses_ui_ux_pro_max.md`: implementor pre-flight invokes `/ui-ux-pro-max` for schema-builder + buyer-fill + Travelers-card visible-UI work
- NO `mcp__supabase__apply_migration` — operator runs `supabase db push --linked`
- NO `npx expo run:ios` — use `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` if dev build needed
- NO osascript keystrokes — Maestro for sim drive

---

## 12. Implementation order (20 steps)

1. **Verify deps:** `package.json` grep for `react-native-draggable-flatlist` + `expo-document-picker` + `expo-image-picker`. If missing, install AND note as deviation requiring native build (loses EAS-OTA eligibility).
2. **Migration:** Write `20260618000000_orch_0880_*.sql` per §4.1.A–H. Self-verify DO-block at end. Hand to operator for `supabase db push --linked`. Wait for confirmation.
3. **Audit slugs:** Add `trip_intake_schema_edited` + `intake_form_data_purged` + `buyer_intake_form_re_answer_required` to `auditActionLabels.ts` KNOWN_STATIC_SLUGS + cases in `resolveAuditActionLabel`.
4. **CI gates:** Add 3 strict-grep gates + wire into `strict-grep-mingla-business.yml` as 3 jobs. Add ORCH_0880_BACKEND_ALLOWLIST to `orch-0863-marketing-hub-phase-b.mjs`.
5. **Service:** `intakeSchemaService.ts` with CRUD + validation + upload helpers.
6. **Hooks:** `useIntakeSchema.ts` with query + mutation hooks.
7. **Edge fn — signed URL:** `trip-intake-upload-signed-url/index.ts` with validation + signing logic. Deploy via `supabase functions deploy trip-intake-upload-signed-url`.
8. **Edge fn — checkout gate:** Modify `ticket-checkout-create/index.ts` to add 400/409 gates per §5.3. Deploy.
9. **Edge fn — cron purge:** `cron-purge-canceled-intake-data/index.ts` per §5.2. Deploy.
10. **Edge fn — notification:** Extend `buyerLifecycleAdapters.ts` + `ticket-confirmation-dispatch/index.ts` for re-answer kind. Deploy.
11. **Wizard primitives:** `IntakeSchemaBuilder.tsx`, `IntakeQuestionEditor.tsx`, `IntakeQuestionPreview.tsx`, `IntakeQuestionTypePill.tsx`, `IntakeRequiredToggle.tsx` (live-commit pattern from ORCH-0875 RefundPolicyEditor).
12. **Wizard step:** `TripCreatorStep6Intake.tsx` composing the above. Extend `TripCreatorWizard.tsx` 6→7 steps. Add `autosaveStep6` callback.
13. **Buyer-fill renderers:** 7 question-type renderer components in `src/components/checkout/IntakeQuestion*.tsx`. Honor keyboard pattern.
14. **Buyer-fill form:** `IntakeFormRenderer.tsx` (dynamic switch on question.type) with localStorage partial-fill persistence.
15. **Buyer-fill route:** `app/checkout-trip/[tripEventId]/intake.tsx` route. Wire `_layout.tsx` + extend `buyer.tsx` Continue handler.
16. **Travelers tab:** `TravelerIntakeAnswerCard.tsx`, `IntakeAnswerFileThumbnail.tsx`, `IntakeAnswerFilePreview.tsx`. Extend `app/trip/[id]/index.tsx` Travelers tab.
17. **EditPublishedTripScreen:** Add `EditPublishedTripIntakeAccordion.tsx` section. Wire ChangeSummaryModal + `biz_update_live_trip` call with `intake_schema` patch.
18. **Implementor happy-path tests:** 3 test files per §13. Write each. Run each. Verify fails-on-revert at HEAD.
19. **`/ui-ux-pro-max` pre-flight:** Invoke for schema-builder + buyer-fill renderer + Travelers card visible-UI work. Apply pixel-precision design output.
20. **Implementor report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` with old→new receipts per file, spec-traceability table mapping each SC, deviations list, regression-test paths + fails-on-revert hashes.

---

## 13. Regression test requirements

### Implementor happy-path tests (REQUIRED — Step 0.5 gate)

| Path | Coverage | Fails-on-revert verification |
|---|---|---|
| `mingla-business/src/services/__tests__/intakeSchemaService.test.ts` | Happy path: valid schema accepted, valid answers validated, file upload returns signed URL + path | Revert `validateAnswerAgainstSchema` to noop → required-missing test FAILS → restore → PASS |
| `mingla-business/src/services/__tests__/intakeSchemaService_validation.test.ts` | Type allowlist (7 types accepted, 'phone'/'signature' rejected), required + duplicate + position validation | Revert type allowlist guard → 'phone' acceptance test FAILS → restore → PASS |
| `supabase/functions/trip-intake-upload-signed-url/__tests__/contract_invariants.test.ts` | MIME allowlist, file size limit, event/question lookup, signed URL shape | Revert MIME check → application/javascript acceptance test FAILS → restore → PASS |

### Tester adversarial tests (REQUIRED — Step 0.5 gate)

| Path | Attack angle | Cases |
|---|---|---|
| `supabase/functions/trip-intake-upload-signed-url/__tests__/adversarial_security.test.ts` | (1) anon-cross-buyer-read-attempt via path manipulation, (2) MIME-spoof via Content-Type vs actual file content, (3) file-size-bypass via chunked upload, (4) signed-URL expiry boundary, (5) event_type='event' rejection, (6) question_type mismatch (text question receives file upload), (7) schema_version_id stale during upload race | 7+ different angles |
| `mingla-business/src/components/checkout/__tests__/IntakeFormRenderer_required_blocks.test.ts` | UI required-field enforcement on submit; reload with localStorage restore preserves required-error state; abandoned 8-day-old draft purged | ≥5 angles |

**Both test sets ship in the same PR as the implementation per ORCH-0840 [Regression-test enforcement + append-only CI]. Each test cites `fails-on-revert verified at HEAD <commit>` in the implementation report.**

---

## 14. Open SPEC questions for operator decision

Investigation locked 12 of 15. These 3 remain for operator pre-implementor:

| Q | Topic | Recommended | Alternative |
|---|---|---|---|
| Q1 | Drag-drop primitive | `react-native-draggable-flatlist` (verify in deps; falls back to custom press-and-hold if missing) | Custom impl using PanGestureHandler — slower to build, more control |
| Q11 | Per-tier vs per-trip schema | Per-trip (one schema regardless of which tier the buyer picks) | Per-tier (Standard tier has 3 questions, VIP tier has 5) — deferred but operator should confirm acceptance of per-trip default |
| Q12 | CSV/PDF export of answers | Out of scope; deferred to follow-up ORCH | In scope (~+3 days; adds CSV/PDF generation utility + planner-side download button) |

Recommend defaulting to recommended column unless operator overrides. If operator overrides any, SPEC amendment required before implementor dispatch.

---

## Layman summary of the report

- **Tr5 builds custom traveler intake forms** — drag-drop builder for planner, dynamic form for buyer, per-traveler card with answers for planner dashboard.
- **Critical architectural pivot from dispatch:** the dispatch assumed Tr5 would create a NEW per-concern RPC `business_patch_trip_intake_schema`. Investigation found ORCH-0876 V2 already shipped a UNIFIED `biz_update_live_trip` RPC that handles every published-trip edit through a single jsonb patch. Tr5 EXTENDS that RPC (adds a new "intake_schema" patch key) instead of creating a parallel one. This is consistent with the V2 architectural intent, eliminates ~200 lines of redundant SQL, and inherits the audit log + ChangeSummaryModal + severity computation for free.
- **Wizard grows from 6 steps to 7** — Intake form lands at Step 6, Review moves to Step 7.
- **Buyer-fill grows from 4 routes to 5** — new `intake` route between `buyer` and `payment`, conditional (only renders when trip has schema).
- **All 6 NEW invariants** flip ACTIVE at CLOSE (schema-valid-at-write, answer-matches-schema, schema-edit-persists-to-DB, file-rls-anon-write-planner-read, required-blocks-checkout, re-answer-notification-dispatch).
- **3 open operator questions** (drag-drop library, per-tier vs per-trip, CSV export) — recommended defaults documented, operator can override or accept.
- **Estimated 1.5-week scope** per §6.2 brief. ~35-45 files single PR Seth→main. EAS OTA eligible. 1 migration (operator applies via `supabase db push --linked`), 2 new edge functions (orchestrator deploys), 1 modified edge function.
- **Live data context:** 1 published trip ("The DC Adventure"), 0 confirmed orders. Tr5 buyer-fill testable via direct URL post-OTA; full organic-buyer reach blocked until C1 ships.
- **Dispatch had stale ORCH-0877 migration filename** (claimed `20260613000000`, actual `20260615000000`). Minor — investigation located the right file and noted it as DISC-INV-0880-1.
- **Dispatch RPC-shape assumption flagged as DISC-INV-0880-2** for orchestrator awareness on future Tr-series dispatches (Tr6/Tr7/Tr8 should also extend `biz_update_live_trip`, not fork).

---

## 15. Operator decisions post-SPEC return (2026-05-19) — per-tier schema + standalone design pass

Two decisions locked by operator via orchestrator REVIEW + AskUserQuestion. The header banner at the top of this SPEC summarizes; this section enumerates the per-tier scope deltas the designer (`/ui-ux-pro-max`) and implementor must apply on top of §1–§14.

### 15.1 Per-tier schema — what changes

The §1–§14 spec described a per-trip schema (`events.trip_intake_schema jsonb`). Per-tier means each `trip_pricing_tier` row gets its own schema. Standard tier and VIP tier can have different question sets. Buyer answers are tier-bound (recorded against the tier they purchased).

### 15.2 Database delta (§4 amendment)

**REJECT** the §4.1.A column `events.trip_intake_schema jsonb` on `events`. Instead, ADD a sidecar table:

```sql
CREATE TABLE public.trip_intake_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  schema jsonb NOT NULL,
  schema_version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_intake_schemas_valid CHECK (public.validate_trip_intake_schema(schema)),
  UNIQUE (event_id, ticket_type_id)
);

CREATE INDEX trip_intake_schemas_event_id_idx ON public.trip_intake_schemas (event_id);
CREATE INDEX trip_intake_schemas_ticket_type_id_idx ON public.trip_intake_schemas (ticket_type_id);

ALTER TABLE public.trip_intake_schemas ENABLE ROW LEVEL SECURITY;

-- Planner reads/writes own brand's schemas
CREATE POLICY "trip_intake_schemas_planner_all"
  ON public.trip_intake_schemas FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_intake_schemas.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Anon can SELECT (buyer needs to read the schema to render the form)
CREATE POLICY "trip_intake_schemas_anon_select"
  ON public.trip_intake_schemas FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_intake_schemas.event_id
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
    )
  );

-- Service role full access
CREATE POLICY "trip_intake_schemas_service_role_all"
  ON public.trip_intake_schemas FOR ALL TO service_role
  USING (true);
```

The `orders.intake_form_data jsonb` column stays per §4.1.A but the shape changes:

```jsonc
// orders.intake_form_data per-tier shape (UPDATED from §4.1.A)
{
  "ticket_type_id": "uuid", // NEW — which tier's schema this answers
  "schema_version_id": "uuid",
  "answers": { "question_id": value }
}
```

The CHECK constraint `events_trip_intake_schema_valid` on `events` from §4.1.C is DROPPED (no column to constrain). The CHECK lives on `trip_intake_schemas.schema` per `trip_intake_schemas_valid` instead.

### 15.3 RPC delta (§4.1.D amendment)

`biz_update_live_trip` Section 5e and Section 4f change. Instead of `IF p_patch ? 'intake_schema' THEN UPDATE events SET trip_intake_schema = ...`, the RPC accepts `p_patch.intake_schemas` as an array:

```jsonc
// p_patch.intake_schemas (NEW shape)
[
  { "ticket_type_id": "uuid", "schema": { ... } },
  { "ticket_type_id": "uuid", "schema": { ... } }
]
```

RPC iterates and UPSERTs into `trip_intake_schemas` per row. Re-answer trigger `tg_events_intake_schema_re_answer_dispatch` moves to `trip_intake_schemas` table — fires AFTER UPDATE OF schema, scans `orders` filtered by both `event_id` AND `ticket_type_id` matching the changed schema's tier.

### 15.4 Edge function delta (§5.3 amendment)

`ticket-checkout-create` schema lookup changes:

```ts
// ORCH-0880 per-tier intake form gate
if (event.event_type === 'trip') {
  // Look up schema for the ticket_type the buyer is purchasing
  const lineItems = body.line_items as Array<{ ticket_type_id: string, quantity: number }>;
  for (const lineItem of lineItems) {
    const { data: schemaRow } = await supabaseAdmin
      .from('trip_intake_schemas')
      .select('schema, schema_version_id')
      .eq('event_id', event.id)
      .eq('ticket_type_id', lineItem.ticket_type_id)
      .maybeSingle();

    if (schemaRow !== null) {
      // Validate per-tier intake_form_data presence + completeness
      const tierIntakeData = body.intake_form_data?.find(
        (d: any) => d.ticket_type_id === lineItem.ticket_type_id,
      );
      const requiredQuestions = (schemaRow.schema.questions as IntakeQuestion[])
        .filter(q => q.required);
      if (requiredQuestions.length > 0) {
        const provided = tierIntakeData?.answers ?? {};
        const missingIds = requiredQuestions
          .filter(q => isAnswerEmpty(q.type, provided[q.id]))
          .map(q => q.id);
        if (missingIds.length > 0) {
          return jsonResponse(
            {
              error: 'intake_form_required',
              ticket_type_id: lineItem.ticket_type_id,
              missing_question_ids: missingIds,
            },
            400,
          );
        }
      }
      // schema_version_id check per-tier
      if (tierIntakeData?.schema_version_id !== schemaRow.schema_version_id) {
        return jsonResponse(
          {
            error: 'intake_schema_stale',
            ticket_type_id: lineItem.ticket_type_id,
            current_schema_version_id: schemaRow.schema_version_id,
          },
          409,
        );
      }
    }
  }
}
```

Per-tier means buyer who purchases 2 different tiers in one order (rare but possible) gets 2 intake forms to fill, one per tier.

### 15.5 Service + hook delta (§6 + §7 amendment)

`intakeSchemaService.ts` interface changes:

```ts
// Per-tier API
export async function getTripIntakeSchemasByEvent(eventId: string): Promise<Map<string /* ticket_type_id */, IntakeSchema>>;
export async function getTripIntakeSchemaByTier(eventId: string, ticketTypeId: string): Promise<IntakeSchema | null>;
export async function upsertTripIntakeSchema(eventId: string, ticketTypeId: string, schema: IntakeSchema | null, reason?: string): Promise<void>;
export async function deleteTripIntakeSchema(eventId: string, ticketTypeId: string, reason?: string): Promise<void>;
```

`useIntakeSchema.ts` query keys include `ticketTypeId`:

```ts
export const intakeSchemaKeys = {
  byEvent: (eventId: string) => ['intake_schemas', 'by_event', eventId] as const,
  byTier: (eventId: string, ticketTypeId: string) => ['intake_schemas', 'by_tier', eventId, ticketTypeId] as const,
};
```

### 15.6 Wizard delta (§8 amendment)

`TripCreatorStep6Intake` gets a tier-picker tab row at the top. Each tier is a tab; tapping a tab loads that tier's schema (or shows "No intake form for this tier — Add one" CTA). Schema-builder operates on the active tier's schema. Live preview pane shows the active tier's buyer-view.

If trip has only 1 tier (most common case for v1 trips), the tier tabs collapse to a single non-clickable tier label so the UX matches per-trip in the simple case.

### 15.7 Buyer-fill delta (§8 amendment)

`/checkout-trip/[tripEventId]/intake.tsx` becomes per-tier. Buyer who purchases Standard sees Standard's questions; buyer who purchases VIP sees VIP's questions. Buyer who purchases BOTH (multi-tier cart) sees a stepped flow: "Standard ticket form (1 of 2)" → fill → "VIP ticket form (2 of 2)" → fill → Continue.

localStorage partial-fill key changes from `tr5_intake_draft_${eventId}_${buyer_email}` to `tr5_intake_draft_${eventId}_${ticketTypeId}_${buyer_email}` to avoid cross-tier collision.

### 15.8 Travelers tab delta (§8 amendment)

Per-traveler card now shows the tier the traveler purchased PLUS their tier-specific answers. Tier label renders as a chip (e.g., "VIP traveler · 5 intake answers") above the collapsible answers section.

### 15.9 Success criteria delta (§9 amendment)

29 SCs in §9 stay; ADD 5 per-tier SCs:

- **SC-30** — `trip_intake_schemas` table exists with proper FKs + UNIQUE constraint on (event_id, ticket_type_id) + 3 RLS policies + 2 indexes
- **SC-31** — Schema-builder tier-picker tabs render when trip has ≥2 tiers; collapse to single non-clickable label when 1 tier
- **SC-32** — Buyer at checkout with multi-tier cart sees stepped intake flow ("Form 1 of 2" → "Form 2 of 2")
- **SC-33** — `ticket-checkout-create` rejects with per-tier `intake_form_required` carrying `ticket_type_id` when any tier's required questions missing
- **SC-34** — Travelers tab shows tier chip per traveler card + tier-specific answers

### 15.10 Regression test delta (§13 amendment)

Implementor happy-path test list expands by 1:
- `mingla-business/src/services/__tests__/intakeSchemaService_per_tier.test.ts` — per-tier CRUD + multi-tier-cart validation + cross-tier-isolation

Tester adversarial test list expands by 1 attack angle in `IntakeFormRenderer_required_blocks.test.ts`:
- "buyer-with-VIP-ticket-submitting-Standard-schema attack" — buyer tries to bypass VIP's stricter required questions by submitting Standard's schema_version_id; server rejects with 409 `intake_schema_stale`

### 15.11 Estimated scope adjustment

§1 said "1.5-week scope, ~35-45 files." Per-tier extends:
- Migration: +1 table + 3 RLS policies + 2 indexes (~50 SQL lines)
- RPC: extension instead of column update (no net file count change)
- Service: 4 functions instead of 2 (~50 LOC)
- Wizard: +tier-picker tab row primitive (~150 LOC)
- Buyer-fill: stepped multi-tier flow (~100 LOC)
- Travelers: +tier chip rendering (~30 LOC)
- 5 new SCs + 2 new tests

**Revised scope: ~2-week scope (was 1.5), ~40-50 files (was 35-45).** Still single PR Seth→main; still EAS OTA eligible.

### 15.12 Design routing decision (locked)

Standalone `/ui-ux-pro-max` design pass FIRST. Designer produces `Mingla_Artifacts/design/DESIGN_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` covering:
- Schema-builder drag-drop chrome with tier-picker tab row (per-tier per §15.1)
- 7 question-type editor UIs (per-question type config sheet)
- Live preview pane layout (split-view on wide, stacked on narrow)
- Buyer-fill question renderers (1 per type, mobile-first)
- File upload UI (picker → thumbnail + filename + remove pattern)
- Multi-tier stepped flow ("Form 1 of 2" progress indicator)
- Travelers tab per-traveler card extension with tier chip + collapsible answers
- EditPublishedTripScreen intake accordion section with tier tabs
- 0%-tier semantic.warning patterns + required-field inline error patterns + abandonment recovery toast
- Accessibility labels for every interactive element per I-39

Designer artifact = implementor's pixel-precision reference. Implementor follows verbatim; no design decisions made at implement time.

### 15.13 Pipeline next (post-§15 amendment)

1. `/ui-ux-pro-max` standalone design pass — output `Mingla_Artifacts/design/DESIGN_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md`
2. Implementor (Claude or Codex per operator routing) implements per SPEC + DESIGN — output `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` + commit on Seth
3. Operator runs `supabase db push --linked` for the new migration
4. Orchestrator deploys 2 new edge functions + 3 modified ones
5. Tester THREE-SURFACE PARITY mode — output `Mingla_Artifacts/reports/QA_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS_REPORT.md`
6. Orchestrator CLOSE protocol (Step 0.5 gate + Step 1.5 DIAG reap + Step 1 SYNC + Step 2 commit + PR + pre-merge gate + merge)
7. EAS OTA via `cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0880: Tr5 Traveler Intake Forms"`
