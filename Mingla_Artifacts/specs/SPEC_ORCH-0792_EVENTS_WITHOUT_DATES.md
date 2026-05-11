# SPEC — ORCH-0792 — Restore `event_dates` as the canonical event-timing store

**Status:** SPEC COMPLETE — ready for orchestrator REVIEW and implementor dispatch
**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-11
**Severity:** S1
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Inputs ingested:**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0792_EVENTS_WITHOUT_DATES.md` (full, including ADDENDUM verification probes)
- `Mingla_Artifacts/prompts/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md` (the dispatch)
- `supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql:117-442` (current publish RPC)
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7792-7823, 8209-8222` (schema baselines)
- `mingla-business/src/utils/serverDraftEventMapper.ts:242-286` (`buildBusinessDraftPayload`)
- `mingla-business/src/services/businessEvents.ts:282-294` (organiser-app date reader)
- `mingla-business/src/services/publicEventsService.ts:303` (public page date reader)
- `supabase/functions/ticket-confirmation-dispatch/index.ts:305-310` (dispatch date reader)
- `supabase/functions/ticket-checkout-create/index.ts` (full file — no date validation)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (ID-collision probe completed; AQ/AR taken; AW/AX free)
- Additional SPEC-mode probes: admin dashboard has zero date readers (not affected); `updateLiveEventFields` in `liveEventStore.ts:375` is client-side-only Zustand with no server write (Discovery — not in ORCH-0792 scope)

---

## §1 Plain-English summary

Today Mingla Business event dates live in a JSON scratchpad inside the event row, not in the canonical `event_dates` table that downstream consumers expect. The publish action silently drops the date on the floor — it validates title and tickets, then promotes the event to "scheduled" without ever writing a row to `event_dates`. ORCH-0792 makes the publish RPC actually write `event_dates`, backfills the 17 dateless events already in production from their JSON scratchpads, adds a database constraint so this can never silently regress, blocks checkout against any event without a future date, and migrates the two consumers that read from the JSON over to the canonical table — so every downstream surface (buyer email, PDF, calendar block, .ics, future refund/cancel emails, future scanner time-window enforcement) sees one consistent truth.

---

## §2 Scope and non-goals

### In scope
- Database: publish RPC writes `event_dates` rows; backfill migration for the 17 dateless events; partial unique index enforcing ≤1 master row per event; constraint trigger enforcing master-date-exists at publish-time.
- Edge functions: `ticket-checkout-create` validates event has a future `event_dates` row before accepting an order; `ticket-confirmation-dispatch` remains a `event_dates` reader (no change to that surface — investigation confirmed it's the only currently-broken consumer because it's the only `event_dates` reader, and it's actually doing the right thing — it just had no data).
- Service layer: migrate `businessEvents.ts:282-294` and `publicEventsService.ts:303` from `theme.business_event.when` JSON to a new view (`events_with_master_date_view`) that joins `event_dates` cleanly.
- Invariants: promote I-PROPOSED-AX (EVENT_HAS_MASTER_DATE) and I-PROPOSED-AY (EVENT_DATES_SOLE_DATE_AUTHORITY) to DRAFT; both flip ACTIVE on CLOSE.
- CI gates: one strict-grep gate verifying the publish RPC body INSERTs `event_dates`; one Deno unit test on the publish RPC end-to-end behavior using a Supabase test client.

### Out of scope (explicit non-goals)
- **`biz_ticket_scan` time-window enforcement** — ORCH-0793 owns scanner-side date checks. This SPEC does not modify scan-ticket or biz_ticket_scan.
- **ORCH-0788 refund/cancel notification dispatcher** — will plug into the same `event_dates` reads but is its own ORCH.
- **Branded email rendering** — ORCH-0785 closed; its defensive null handling is correct as-is and stays. Once ORCH-0792 ships, the data flows through and the email renders dates naturally — no change needed in `_shared/email/`.
- **`updateLiveEventFields` post-publish persistence** — discovered during SPEC probe to be client-side-only Zustand with zero server writes. This is a separate hidden flaw far larger than ORCH-0792's scope; registered as Discovery D-1 below for orchestrator to file as a new ORCH.
- **Theme JSON cleanup** — `theme.business_event.when` continues to be the draft-side scratchpad. We do NOT drop it; we just stop reading from it post-publish.
- **Pre-expansion of recurring events** — recurring events get ONE master `event_dates` row for the first occurrence. The `events.recurrence_rules` JSON column remains the authority for the recurrence pattern. Expanding to N occurrence rows is deferred to a follow-up ORCH if/when consumers need per-occurrence granularity for recurring events.
- **Admin dashboard date display** — admin has no date readers today; not affected and not added.
- **Public consumer mobile app** — `app-mobile/` doesn't consume business events; not affected.

### Assumptions
- Operator will apply the migration via `supabase db push --linked` before the orchestrator deploys edge functions (standard split per current orchestrator skill).
- The 17 existing events in production have parseable `theme.business_event.when.date` for backfill (single mode) or `theme.business_draft.when` plus `theme.business_draft.multiDates` etc. (multi-date mode); a pre-flight verification SQL must be in the backfill migration that counts truly-uncoverable events and aborts if any are found (these would need manual operator action).
- Recurrence rules already store occurrence rules separately in `events.recurrence_rules`; they don't need to migrate.

---

## §3 Architectural decision — Option A (commit)

### Decision

**Option A: keep `event_dates` as the canonical event-timing store. Migrate readers off theme JSON. Fix the publish RPC to write it. Backfill the 17 dateless events.**

### Why Option A over Option B

Six concrete reasons:

1. **ORCH-0793 (scanner time-window) is the next pipeline item.** With Option A, the scanner does `JOIN event_dates ON event_dates.event_id = tickets.event_id` — clean, indexable, type-safe. With Option B, the scanner has to `SELECT theme->'business_event'->'when'->>'date' FROM events`, parse a string, handle malformed values, and lose every JOIN optimisation. The cost differential compounds with every future timing-dependent feature.

2. **ORCH-0788 (refund/cancel dispatcher) is also a date consumer.** With Option A, ORCH-0788 reads `event_dates` cleanly. With Option B, every new dispatcher inherits JSON parsing forever. We'd be locking in technical debt at the moment we're trying to remove it.

3. **Multi-date and recurring events are first-class Mingla concepts.** The `event_dates` schema is purpose-built for them — one row per occurrence with `is_master=true` on the canonical row. The JSON path collapses multi-date into a `multiDates[]` array that consumers must `jsonb_array_elements` to scan. The relational shape matches Mingla's product reality; the JSON shape fights it.

4. **Schema-level type safety matters.** `event_dates.start_at TIMESTAMPTZ NOT NULL` plus `CHECK (end_at > start_at)` makes "the date is malformed" an impossible state. JSON storage gives you `text` and crosses fingers.

5. **The "more consumers read theme JSON" verification result is a snapshot, not destiny.** Two of three current theme readers (organiser app, public event page) exist BECAUSE the relational table was broken. They are workarounds, not preferences. Future readers — analytics, admin dashboards, ORCH-0788, ORCH-0793, calendar APIs, ticketing exports — will all prefer the relational structure if it works. The right read of the data: today's reader count is the wrong axis to optimise on; future-reader cost is.

6. **Constitution #2 is preserved correctly.** Option A makes `event_dates` the canonical single source; theme JSON survives as a draft-only mirror that simply isn't read post-publish. Option B would mean enshrining a JSON blob as canonical, which is the inverse of how every other Mingla domain works (orders, tickets, refunds, etc. all live in relational tables with `theme`-style JSON used only for draft state). Option A keeps the architecture coherent.

### Honest tradeoffs (in case implementor hits unforeseen blockers)

- **Cost:** Option A requires changing 3 files (publish RPC migration, plus 2 service-layer readers) vs Option B's 1 file (dispatch reader). The implementor must touch more surface area.
- **Backfill complexity:** Option A's backfill migration must handle 3 whenMode variants (single / multi_date / recurring). Option B has no backfill needed.
- **Risk:** Option A's constraint trigger could reject legitimate publishes if the implementor mis-orders the INSERT vs UPDATE. Option B has no constraint to misalign.
- **If implementor blocks on recurrence-expansion ambiguity:** fall back to "insert 1 master row from first occurrence; defer multi-row recurring expansion to a follow-up ORCH." This SPEC §4.2 already locks in that decision.

If implementor hits a blocker that can't be resolved within the constraints below, the orchestrator should be informed before pivoting to Option B — Option B's tradeoffs compound across every future ORCH and should not be a fall-back without explicit re-decision.

---

## §4 Database layer

### §4.1 New migration: `20260525000000_orch_0792_publish_writes_event_dates.sql`

**Order of operations (critical — implementor must follow exactly):**

1. **Step 1: Partial unique index.** Add `event_dates_master_unique` partial unique index on `event_dates(event_id) WHERE is_master = true`. This guards against multiple master rows per event. Apply BEFORE the backfill — backfill must produce exactly one master row per event, and we want the constraint enforced as we insert.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS event_dates_master_unique
  ON public.event_dates (event_id)
  WHERE is_master = true;

COMMENT ON INDEX public.event_dates_master_unique IS
  'ORCH-0792: enforces ≤1 master event_date row per event. Promotes invariant I-PROPOSED-AX EVENT_HAS_MASTER_DATE.';
```

2. **Step 2: Replace `business_publish_event_draft` RPC.** New `CREATE OR REPLACE FUNCTION` that supersedes the ORCH-0783 definition (`20260515000018:117-442`). Preserve every existing validation. ADD payload-date extraction + `event_dates` insertion BEFORE the `UPDATE public.events SET status='scheduled'` step. Order matters for the constraint trigger in §4.3.

   The RPC body must contain a block that:
   - Reads `v_business_draft->>'whenMode'` to determine mode.
   - For `'single'` mode: reads `v_business_draft->'when'` object, extracts `date` (YYYY-MM-DD), `doorsOpen` (HH:MM), `endsAt` (HH:MM), `timezone` (IANA string). If `date` is null, raise `event_date_required`. Compose `start_at` as `(date || ' ' || (doorsOpen ?? '00:00') || ':00')::timestamp AT TIME ZONE timezone`. Compose `end_at` similarly; if `endsAt < doorsOpen` (e.g., 23:00 → 02:00), add `INTERVAL '1 day'` to end. INSERT one row with `is_master = true`.
   - For `'multi_date'` mode: reads `v_business_draft->'multiDates'` array. If null or empty, raise `event_date_required`. For each element, compose `start_at` / `end_at` using element's `date` + `startTime` + `endTime` + draft `timezone`. Sort the array chronologically by `start_at`. INSERT all rows; mark the chronologically-first row with `is_master = true`, all others `false`.
   - For `'recurring'` mode: reads `v_business_draft->'when'` for first occurrence (same composition as single mode). INSERT ONE row with `is_master = true`. The `v_business_draft->'recurrenceRule'` payload is already persisted on `events.recurrence_rules` (existing behavior); no per-occurrence expansion in this SPEC.
   - For any other `whenMode` value or null `whenMode`: raise `event_date_required`.
   - INSERT timestamp source: `now()` (preserve existing pattern).
   - Failure mode: if any INSERT fails (e.g., master-unique violation because constraint trigger fires twice on retry), the whole transaction rolls back — `events.status` stays draft.

   Pseudocode block to be inserted between line 308 (`PERFORM set_config('mingla.business_publish_event_draft', 'on', true);`) and line 311 (`UPDATE public.events SET ...`):

```sql
-- ORCH-0792: write event_dates BEFORE flipping events.status
DECLARE
  v_when_mode text := v_business_draft->>'whenMode';
  v_when jsonb := v_business_draft->'when';
  v_multi_dates jsonb := v_business_draft->'multiDates';
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_date_entry jsonb;
  v_idx integer := 0;
  v_master_idx integer := 0;
  v_min_start timestamptz;
BEGIN
  IF v_when_mode IS NULL OR v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, true);

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL OR jsonb_array_length(v_multi_dates) = 0 THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    -- Find chronologically first entry for master flag
    SELECT min((entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone)
      INTO v_min_start
      FROM jsonb_array_elements(v_multi_dates) entry;
    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
    END LOOP;
  END IF;
END;
```

   Note: the inline DECLARE/BEGIN block must be inlined into the surrounding RPC body, not wrapped in a sub-function. Existing variable declarations at lines 126-153 must absorb these new vars.

3. **Step 3: Replace `UPDATE public.events SET status='scheduled' ...` block** unchanged (lines 311-343). Order: event_dates INSERT (Step 2) → events UPDATE (Step 3).

### §4.2 New migration: `20260525000001_orch_0792_backfill_event_dates_from_theme.sql`

Idempotent. For every `events` row where no `event_dates` row exists, read `theme->'business_event'` (post-publish location) or `theme->'business_draft'` (pre-publish, surfaces for any never-published rows with theme drafts) and insert the corresponding `event_dates` row(s).

```sql
-- ORCH-0792 backfill — derive event_dates rows from theme JSON for legacy events.
-- Idempotent: skips events that already have event_dates rows.
-- Aborts if any event would be uncoverable (no parseable date in theme).

DO $$
DECLARE
  v_uncoverable_count integer;
  v_event record;
  v_theme jsonb;
  v_when jsonb;
  v_multi jsonb;
  v_when_mode text;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_entry jsonb;
  v_min_start timestamptz;
  v_inserted integer := 0;
BEGIN
  -- Pre-flight: count uncoverable rows. Abort if any.
  SELECT count(*) INTO v_uncoverable_count
  FROM public.events e
  WHERE NOT EXISTS (SELECT 1 FROM public.event_dates ed WHERE ed.event_id = e.id)
    AND e.deleted_at IS NULL
    AND (
      (COALESCE(e.theme->'business_event'->'when'->>'date', e.theme->'business_draft'->'when'->>'date')) IS NULL
      AND COALESCE(e.theme->'business_event'->'multiDates', e.theme->'business_draft'->'multiDates') IS NULL
    );
  IF v_uncoverable_count > 0 THEN
    RAISE EXCEPTION 'orch_0792_backfill_aborted: % events lack parseable date in theme. Operator must manually populate event_dates for these events before re-running.', v_uncoverable_count;
  END IF;

  FOR v_event IN
    SELECT id, theme, timezone
    FROM public.events e
    WHERE NOT EXISTS (SELECT 1 FROM public.event_dates ed WHERE ed.event_id = e.id)
      AND e.deleted_at IS NULL
  LOOP
    v_theme := COALESCE(v_event.theme, '{}'::jsonb);
    -- Prefer business_event (post-publish); fall back to business_draft (drafts).
    v_when := COALESCE(v_theme->'business_event'->'when', v_theme->'business_draft'->'when');
    v_multi := COALESCE(v_theme->'business_event'->'multiDates', v_theme->'business_draft'->'multiDates');
    v_when_mode := COALESCE(v_theme->'business_event'->>'whenMode', v_theme->'business_draft'->>'whenMode', 'single');
    v_timezone := COALESCE(NULLIF(v_when->>'timezone', ''), v_event.timezone, 'UTC');

    IF v_when_mode = 'multi_date' AND v_multi IS NOT NULL AND jsonb_array_length(v_multi) > 0 THEN
      SELECT min((entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone)
        INTO v_min_start
        FROM jsonb_array_elements(v_multi) entry;
      FOR v_entry IN SELECT value FROM jsonb_array_elements(v_multi)
      LOOP
        v_date_iso := NULLIF(v_entry->>'date', '');
        IF v_date_iso IS NULL THEN CONTINUE; END IF;
        v_doors := COALESCE(NULLIF(v_entry->>'startTime', ''), '00:00');
        v_ends := COALESCE(NULLIF(v_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN v_end := v_end + INTERVAL '1 day'; END IF;
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (v_event.id, v_start, v_end, v_timezone, v_start = v_min_start);
        v_inserted := v_inserted + 1;
      END LOOP;
    ELSE
      -- single or recurring: one master row
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NULL THEN CONTINUE; END IF;
      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN v_end := v_end + INTERVAL '1 day'; END IF;
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_event.id, v_start, v_end, v_timezone, true);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'ORCH-0792 backfill: inserted % event_dates rows', v_inserted;
END $$;

COMMENT ON SCHEMA public IS 'ORCH-0792 backfill executed (see migration 20260525000001).';
```

Implementor note: the COMMENT ON SCHEMA line is a marker; if the implementor prefers a separate audit table (`Mingla_Artifacts/migrations_archive_orch_0792/` parallel to ORCH-0729's pattern), that's acceptable but not required.

### §4.3 New migration: `20260525000002_orch_0792_event_master_date_required.sql`

Constraint trigger on `events` that rejects status transitions to `scheduled` / `live` unless a master `event_dates` row exists. Applied AFTER the backfill (Step 4.2) so existing rows pass.

```sql
CREATE OR REPLACE FUNCTION public.biz_enforce_event_has_master_date() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only enforce on status transitions into scheduled/live, not on every UPDATE
  IF TG_OP = 'UPDATE'
    AND NEW.status IN ('scheduled', 'live')
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.status IN ('draft'))
    AND NEW.deleted_at IS NULL
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_dates ed
      WHERE ed.event_id = NEW.id AND ed.is_master = true
    ) THEN
      RAISE EXCEPTION 'event_must_have_master_date'
        USING HINT = 'Insert at least one event_dates row with is_master=true before promoting events.status to scheduled/live (ORCH-0792).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_events_enforce_master_date
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_enforce_event_has_master_date();

COMMENT ON FUNCTION public.biz_enforce_event_has_master_date IS
  'ORCH-0792: enforces I-PROPOSED-AX EVENT_HAS_MASTER_DATE. Blocks events.status transitions to scheduled/live unless a master event_dates row exists.';
```

### §4.4 New view (optional but recommended): `events_with_master_date_view`

To make service-layer migration (§6) trivial, create a view that joins events with their master date:

```sql
CREATE OR REPLACE VIEW public.events_with_master_date_view
WITH (security_invoker = true) AS
SELECT
  e.*,
  ed.start_at AS master_start_at,
  ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,
  ed.id AS master_event_date_id
FROM public.events e
LEFT JOIN public.event_dates ed
  ON ed.event_id = e.id AND ed.is_master = true;

COMMENT ON VIEW public.events_with_master_date_view IS
  'ORCH-0792: ergonomic read surface joining events with their master event_dates row. RLS via security_invoker.';
```

Use `LEFT JOIN` so the view also returns drafts that don't yet have a master date.

### §4.5 RLS implications

- `event_dates` already has existing RLS policies from baseline. No new policies needed; the publish RPC runs SECURITY DEFINER and has implicit access. The backfill DO block also runs at deploy time as service role.
- The new view inherits RLS via `security_invoker = true`.
- The constraint trigger runs in the same security context as the calling statement.

---

## §5 Edge function layer

### §5.1 `ticket-checkout-create` — new validation gate

**File:** `supabase/functions/ticket-checkout-create/index.ts`

Before accepting a checkout request, query for at least one `event_dates` row with `end_at > now()` for the requested event. If none, return HTTP 422 with error code `event_no_active_dates`.

Insertion point: right after the event-lookup query and ticket-type validation, before the Stripe Checkout Session create. Exact insertion:

```typescript
// ORCH-0792: reject checkout against events with no current/future date.
const { count: futureDateCount, error: futureDateErr } = await supabase
  .from("event_dates")
  .select("id", { count: "exact", head: true })
  .eq("event_id", eventId)
  .gt("end_at", new Date().toISOString());

if (futureDateErr !== null) {
  return jsonResponse({ error: "event_date_lookup_failed", detail: futureDateErr.message }, 500);
}
if ((futureDateCount ?? 0) === 0) {
  return jsonResponse({ error: "event_no_active_dates" }, 422);
}
```

Error contract: 422 status, body `{ "error": "event_no_active_dates" }`. Frontend buyer-side handles this as "This event isn't currently scheduled. Please check back later or contact the organiser."

### §5.2 `ticket-confirmation-dispatch` — no change

Already reads from `event_dates` correctly (`index.ts:305-310`). Once the publish RPC starts writing event_dates, the dispatch will naturally render dates. **Zero code changes here.**

### §5.3 No other edge functions affected

Probed: `notify-dispatch`, `admin-send-email`, `stripe-webhook`, `scan-ticket`, `refund-order`, `cancel-order` — none read event dates today. ORCH-0788 will plug into `event_dates` cleanly when it ships.

---

## §6 Service / hook layer (mingla-business)

### §6.1 `businessEvents.ts:282-294` — migrate organiser-app date reader

**File:** `mingla-business/src/services/businessEvents.ts`

Current behavior (line 282-294): reads `whenMode`, `date`, `doorsOpen`, `endsAt`, `timezone` from `theme.business_event.when` JSON.

Target behavior: query the new `events_with_master_date_view` and read `master_start_at`, `master_end_at`, `master_timezone` columns. Map back to the `LiveEvent.date` / `doorsOpen` / `endsAt` shape the consumers expect (extract date/time-of-day from the timestamp).

Implementation pattern:
- Update the `EVENT_DRAFT_SELECT` constant (or its sibling for live events) to use `events_with_master_date_view` instead of `events`.
- In `rowToLiveEvent` mapper, replace the `theme.business_event.when` reads with derivations from the new `master_*` columns. Use a small helper:

```typescript
const splitTimestamp = (ts: string | null, tz: string): {
  date: string | null;
  time: string | null;
} => {
  if (ts === null) return { date: null, time: null };
  // Convert UTC ISO to event-local YYYY-MM-DD + HH:mm
  const dt = new Date(ts);
  // Use Intl.DateTimeFormat to extract in the event's IANA timezone
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(dt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};
```

Field mappings:
- `date` ← splitTimestamp(master_start_at, master_timezone).date
- `doorsOpen` ← splitTimestamp(master_start_at, master_timezone).time
- `endsAt` ← splitTimestamp(master_end_at, master_timezone).time
- `timezone` ← master_timezone (fall back to events.timezone if view returns null because no master row)
- For multi-date events: query `event_dates` separately for the full list when `events.is_multi_date = true`. Helper: `fetchEventDatesForEvent(eventId: string): Promise<MultiDateEntry[]>` that selects all rows and maps to the existing `MultiDateEntry` shape.

Keep the existing `whenMode` read from `theme.business_event.whenMode` — that's a UI-shape signal, not date data, and stays in theme JSON.

### §6.2 `publicEventsService.ts:303` — migrate public-page date reader

**File:** `mingla-business/src/services/publicEventsService.ts`

Same pattern as §6.1. Use `events_with_master_date_view` and derive date/time-of-day from the timestamp. Migration is structurally identical.

### §6.3 No other service-layer changes

`eventDrafts.ts` writers stay as-is — they write `events.theme` for draft state, which is still where the wizard's edits live during composition. Publish promotes draft → event_dates via the RPC. Clean separation: drafts in theme, live events in event_dates.

### §6.4 Hooks layer

No new hooks needed. Existing `useEvents`, `usePublicEventBySlug`, `useDraftEvents` all consume the service-layer outputs unchanged. The view change is invisible to React Query keys.

---

## §7 Component layer

No component changes. The migration is transparent to UI — components consume `LiveEvent.date` / `doorsOpen` / `endsAt` / `timezone` as before; the only difference is where those values come from inside the service layer.

---

## §8 Success criteria

| ID | Criterion | Observable how |
|---|---|---|
| **SC-1** | After successful publish, the resulting event has a queryable canonical date via `event_dates` with `is_master = true`. | `SELECT * FROM event_dates WHERE event_id = <id> AND is_master = true` returns exactly one row. |
| **SC-2** | A new free or paid ticket purchase against a freshly-published event produces a buyer email with the event date in the body, the date in the PDF, the calendar block populated, and the .ics attached. | Operator-driven live-fire — Option C from ORCH-0785 launch. |
| **SC-3** | Backfill migration covers all 17 existing events with no errors. | Migration RAISE NOTICE shows `inserted N` where N ≥ 17 (multi-date events insert >1 row). Post-migration DB query: `SELECT count(DISTINCT event_id) FROM event_dates` = 17. |
| **SC-4** | Backfill migration is idempotent. | Running the migration's DO block twice inserts zero rows on the second run. |
| **SC-5** | `ticket-checkout-create` rejects orders against any event with no future `event_dates` row, returning HTTP 422 with `event_no_active_dates`. | Curl test against a freshly-created draft event (no event_dates yet); response is `{"error":"event_no_active_dates"}`. |
| **SC-6** | `business_publish_event_draft` raises `event_date_required` when the payload has no resolvable date in any whenMode. | Deno unit test invoking the RPC with `theme.business_draft.when = {}` and `multiDates = null`. |
| **SC-7** | The constraint trigger `trg_events_enforce_master_date` rejects manual `UPDATE events SET status='scheduled'` if no master event_dates row exists. | SQL test: `INSERT INTO events ... status='draft'; UPDATE events SET status='scheduled' WHERE id=...;` raises `event_must_have_master_date`. |
| **SC-8** | Partial unique index `event_dates_master_unique` rejects a second `is_master = true` row for the same event. | SQL test: two consecutive `INSERT INTO event_dates (event_id, ..., is_master=true)` for the same event; second raises unique violation. |
| **SC-9** | Organiser app event-detail and edit screens render the correct date for both pre-fix events (backfilled) and post-fix events (RPC-written). | Operator opens an existing event in business app + creates a new event end-to-end; dates match across both. |
| **SC-10** | Public event page `/e/{brandSlug}/{eventSlug}` renders the correct date sourced from `event_dates`. | Operator opens a public URL; date visible. |
| **SC-11** | Multi-date events produce exactly one master row chronologically (first occurrence) and N-1 non-master rows. | Multi-date publish test: 3 dates in wizard → 3 event_dates rows → exactly 1 with `is_master = true`, and it's the earliest. |
| **SC-12** | Recurring events produce exactly one master row from the first occurrence. The `events.recurrence_rules` JSON remains the authority for the pattern. | Recurring publish test: wizard creates "weekly on Fridays starting May 17"; one event_dates row at May 17 7pm with `is_master = true`; `events.recurrence_rules` populated. |
| **SC-13** | CI strict-grep gate `orch-0792-publish-writes-event-dates.mjs` passes when the publish RPC body contains `INSERT INTO public.event_dates`. | `node .github/scripts/strict-grep/orch-0792-publish-writes-event-dates.mjs` exits 0. |
| **SC-14** | Deno unit test on publish RPC verifies the three whenMode branches each produce the expected event_dates rows. | `deno test supabase/functions/_shared/__tests__/orch_0792_publish_writes_dates.test.ts` exits 0. |

---

## §9 Invariants

### Promoted to DRAFT (flips ACTIVE on CLOSE)

#### I-PROPOSED-AX EVENT_HAS_MASTER_DATE
**Statement:** Every `events` row with `status IN ('scheduled', 'live')` AND `deleted_at IS NULL` MUST have exactly one `event_dates` row with `is_master = true` and non-null `start_at`.
**Enforcement:**
- DB constraint trigger `trg_events_enforce_master_date` (§4.3) rejects status transitions that would violate.
- Partial unique index `event_dates_master_unique` (§4.1) enforces the ≤1 cardinality.
- CI gate (§12) verifies publish RPC body INSERTs event_dates.
**Tests:** SC-1, SC-7, SC-8, SC-11, SC-12.
**Why:** Without this, every downstream date-dependent consumer (buyer email, PDF, .ics, scanner, refund/cancel emails, analytics) silently fails.

#### I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY
**Statement:** Post-publish event timing reads MUST go through `event_dates` (directly or via `events_with_master_date_view`). The `events.theme.business_event.when` / `multiDates` / `recurrenceRule` JSON paths are draft-only mirrors and MUST NOT be the source for production read paths.
**Enforcement:**
- Service-layer migrations in §6 remove the JSON reads.
- CI gate `.github/scripts/strict-grep/orch-0792-no-published-event-theme-reads.mjs` flags any new `theme.business_event.when` read in post-publish service or edge paths (exempts draft-side wizard code).
**Tests:** SC-9, SC-10.
**Why:** Without this, the Constitution #2 violation that caused ORCH-0792 in the first place can recur silently.

### Preserved (must not regress)

- **I-PROPOSED-AM EMAIL_BRAND_SHELL_SINGLETON** — ORCH-0792 does not touch `_shared/email/`; preserved.
- **I-PROPOSED-AN RESEND_NO_SANDBOX_SENDER** — preserved.
- **I-PROPOSED-AO BUYER_INPUT_HTML_ESCAPED** — preserved.
- **I-PROPOSED-AP TICKET_PDF_PRIVACY** — preserved.
- **Constitution #2 (One owner per truth)** — restored by this ORCH; previously violated by the split-brain JSON / event_dates storage.
- **Constitution #9 (No fabricated data)** — preserved; backfill aborts rather than fabricate for events with truly missing dates.

### Renumbering note

The investigation report named these invariants `I-PROPOSED-AQ` and `I-PROPOSED-AR`. ID-collision probe found those taken by ORCH-0786 avatar work (`AQ = RN-FILE-UPLOAD-VIA-EXPO-FILE-SYSTEM`, `AR = STORAGE-URL-PERSISTED-WITHOUT-CACHE-BUSTER`). Runtime IDs are `AW` and `AX`. This SPEC text is binding; the rename matches the ORCH-0785/0786 precedent of registry-level corrections.

---

## §10 Test matrix

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** | Single-mode publish, valid date | Wizard whenMode=single, date=2026-06-12, doorsOpen=18:00, endsAt=23:00, timezone=Europe/London | 1 event_dates row with is_master=true, correct UTC timestamps | RPC + DB |
| **T-02** | Single-mode publish, time crosses midnight | doorsOpen=22:00, endsAt=02:00 | end_at = start_at + 1 day exactly | RPC + DB |
| **T-03** | Multi-date publish, 3 dates | multiDates=[{date:2026-06-12,...},{date:2026-06-19,...},{date:2026-06-26,...}] | 3 event_dates rows; only the 2026-06-12 row has is_master=true | RPC + DB |
| **T-04** | Recurring publish | whenMode=recurring, date=2026-06-12, recurrenceRule={freq:weekly,...} | 1 event_dates row at 2026-06-12 (master); events.recurrence_rules populated | RPC + DB |
| **T-05** | Publish missing date | whenMode=single, when.date=null | RPC raises `event_date_required`; events.status stays draft | RPC |
| **T-06** | Publish multi_date with empty array | whenMode=multi_date, multiDates=[] | RPC raises `event_date_required` | RPC |
| **T-07** | Publish multi_date with one entry missing date | multiDates=[{date:null,...},{date:2026-06-12,...}] | RPC raises `event_date_required` mid-loop, rolls back | RPC + DB |
| **T-08** | Constraint trigger blocks manual status promotion | INSERT events (status=draft), then UPDATE status=scheduled with no event_dates | trigger raises `event_must_have_master_date` | DB trigger |
| **T-09** | Partial unique index blocks second master | INSERT two event_dates rows for same event_id both with is_master=true | second INSERT violates `event_dates_master_unique` | DB |
| **T-10** | Backfill migration on the 17 existing events | Apply migration against current DB state | All 17 events get ≥1 event_dates row; RAISE NOTICE confirms count | Migration |
| **T-11** | Backfill is idempotent | Re-run the DO block | Zero rows inserted second time; no errors | Migration |
| **T-12** | Backfill aborts on uncoverable events | Pre-flight finds events with neither when.date nor multiDates | Migration raises `orch_0792_backfill_aborted: N events ...` | Migration |
| **T-13** | Checkout against future-dated event | event_dates has row with end_at > now() | Stripe checkout session created normally | Edge fn |
| **T-14** | Checkout against past-dated event | All event_dates rows have end_at < now() | 422 `event_no_active_dates` | Edge fn |
| **T-15** | Checkout against dateless event | No event_dates rows | 422 `event_no_active_dates` | Edge fn |
| **T-16** | Buyer email + PDF + calendar block full live-fire (ORCH-0785 SC-2) | Real free/paid purchase end-to-end | Date visible in email body, PDF date line, calendar block populated, .ics attached | Full stack |
| **T-17** | Organiser app reads from view | Open existing backfilled event in business app | Date renders correctly from master_start_at | Service |
| **T-18** | Public event page reads from view | Visit /e/{brandSlug}/{eventSlug} | Date renders correctly | Service |
| **T-19** | View returns NULL master_* for events without master | Insert events row, no event_dates, query view | master_start_at = NULL (LEFT JOIN behavior) | DB view |
| **T-20** | Multi-date event list fetch | events.is_multi_date = true, business app opens detail | Helper `fetchEventDatesForEvent` returns N rows; UI lists all dates | Service |
| **T-21** | CI gate publish-writes-event-dates | grep on latest publish RPC migration | Gate finds `INSERT INTO public.event_dates`; exits 0 | CI |
| **T-22** | CI gate no-published-event-theme-reads | grep mingla-business/src + edge fns for forbidden theme reads | Gate finds zero non-exempt matches; exits 0 | CI |
| **T-23** | Deno unit test on publish RPC | three whenMode branches | Each branch produces expected rows | Edge unit |

---

## §11 Implementation order

Numbered. Implementor MUST follow this order.

1. **Migration §4.1** — `20260525000000_orch_0792_publish_writes_event_dates.sql` — partial unique index + new publish RPC.
2. **Migration §4.2** — `20260525000001_orch_0792_backfill_event_dates_from_theme.sql` — backfill DO block.
3. **Migration §4.3** — `20260525000002_orch_0792_event_master_date_required.sql` — constraint trigger.
4. **Migration §4.4** — same file or separate; view creation. Recommended separate: `20260525000003_orch_0792_events_with_master_date_view.sql`.
5. **Edge function** §5.1 — `ticket-checkout-create/index.ts` validation gate.
6. **Service layer** §6.1 — `businessEvents.ts` migration to view.
7. **Service layer** §6.2 — `publicEventsService.ts` migration to view.
8. **CI gate scripts** — `.github/scripts/strict-grep/orch-0792-publish-writes-event-dates.mjs` and `.github/scripts/strict-grep/orch-0792-no-published-event-theme-reads.mjs`. Wire into `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern memory.
9. **Deno unit tests** — `supabase/functions/_shared/__tests__/orch_0792_publish_writes_dates.test.ts` covering the three whenMode branches and the error path.
10. **Jest tests** (mingla-business) — `mingla-business/src/services/__tests__/businessEvents_master_date.test.ts` and `publicEventsService_master_date.test.ts` verifying the view-based reads with mocked rows.
11. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0792_EVENTS_WITHOUT_DATES.md` with old→new receipts for every file, migration timestamps, test outputs, and CI gate exit codes.

---

## §12 Regression prevention

### CI gates (mandatory, both new)

#### Gate A — `.github/scripts/strict-grep/orch-0792-publish-writes-event-dates.mjs`
Asserts: the **latest** migration defining `business_publish_event_draft` contains the string `INSERT INTO public.event_dates`. Resolution: glob `supabase/migrations/*.sql`, sort descending by filename timestamp, find the first file containing `CREATE OR REPLACE FUNCTION public.business_publish_event_draft`, grep that file for `INSERT INTO public.event_dates`. Exit 0 if found, exit 1 with message if not.

#### Gate B — `.github/scripts/strict-grep/orch-0792-no-published-event-theme-reads.mjs`
Asserts: no service-layer or edge-function code reads `theme->'business_event'->'when'` / `business_event.when` / `multiDates` after the event is published. Grep `mingla-business/src/services/`, `supabase/functions/` (excluding `_shared/email/__tests__/`, drafts, and the wizard surface area). Exempt allowlist: `mingla-business/src/utils/serverDraftEventMapper.ts` (draft mapper), `mingla-business/src/store/draftEventStore.ts` (draft store), `mingla-business/src/components/event/CreatorStep2When.tsx` (wizard UI), `mingla-business/src/components/event/EditPublishedScreen.tsx` (still uses theme for unrelated reads — phase out in follow-up ORCH if needed). Exit 0 if no non-exempt matches; exit 1 listing offending file:line otherwise.

### Wire-in to `strict-grep-mingla-business.yml`
Per the memory rule `feedback_strict_grep_registry_pattern.md`: register both new gates as additional steps in the existing strict-grep workflow file. Do NOT create a parallel workflow file.

### Protective comments
- In the new publish RPC migration header: `-- ORCH-0792: this RPC MUST insert event_dates rows before flipping events.status. The constraint trigger trg_events_enforce_master_date will reject the status flip otherwise. See SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md §4.`
- In the new view migration: `-- ORCH-0792: post-publish reads MUST come through this view, not through theme.business_event.when JSON. See I-PROPOSED-AY.`
- In `businessEvents.ts` and `publicEventsService.ts` mapper functions, replace the existing `business_event.when` read with a `// ORCH-0792: dates sourced from event_dates via events_with_master_date_view (I-PROPOSED-AY)` comment.

### Deno unit test
`supabase/functions/_shared/__tests__/orch_0792_publish_writes_dates.test.ts` — uses a local test Supabase client to invoke the RPC against an in-memory test DB. Covers single / multi_date / recurring / missing-date paths.

### Jest tests
Two new files in `mingla-business/src/services/__tests__/`. Mock the view query result and assert the mapper produces correct `date` / `doorsOpen` / `endsAt` strings via the timezone-aware splitter helper.

---

## §13 Hard guards (carries through to implementor)

- Do NOT run `supabase db push` — operator owns migration apply.
- Do NOT modify `biz_ticket_scan` or `supabase/functions/scan-ticket/` — ORCH-0793 scope.
- Do NOT modify branded email rendering in `_shared/email/` — ORCH-0785 defensive null handling is correct and stays.
- Do NOT modify `ticket_order_notifications` rollup logic — ORCH-0788 scope.
- Do NOT delete or destructively modify `events.theme.business_event.when` JSON — it remains the draft-only mirror.
- Do NOT pre-expand recurring events into N event_dates rows — single master row only; follow-up ORCH if needed.
- Do NOT modify the wizard UI (`CreatorStep2When.tsx`, `EventCreatorWizard.tsx`) — date data flow into theme JSON is correct on the draft side.
- Do NOT modify `updateLiveEventFields` in `liveEventStore.ts` — it's client-side-only by design today; its server-persistence gap is Discovery D-1 below, not ORCH-0792 scope.
- Do NOT modify `app-mobile/` — consumer mobile app doesn't consume business events.
- Do NOT modify `mingla-admin/` — admin has no event date readers.
- Do NOT alter the `event_dates` table schema beyond adding the partial unique index in §4.1.
- Do NOT use `mcp__supabase__apply_migration` — implementor writes migration files only; operator runs `supabase db push`.

---

## §14 Open questions for orchestrator

None. All architectural decisions are locked in this SPEC:
- Option A committed in §3.
- Recurring expansion strategy: single master row + existing `recurrence_rules` JSON (§2 non-goals, §4.1 step 2).
- Backfill failure mode: abort with diagnostic if any event is uncoverable (§4.2 pre-flight).
- Schema constraint: trigger on `events` (rejected: CHECK can't query other tables) (§4.3).
- ID renumbering: AQ→AW, AR→AX (§9).
- View vs raw JOIN in service layer: view, for clean RLS via `security_invoker` (§4.4).

---

## §15 Deployment notes

### Migration sequencing
Operator applies migrations via `supabase db push --linked` in this order (filenames are timestamp-ordered so `db push` handles it):
1. `20260525000000_orch_0792_publish_writes_event_dates.sql`
2. `20260525000001_orch_0792_backfill_event_dates_from_theme.sql`
3. `20260525000002_orch_0792_event_master_date_required.sql`
4. `20260525000003_orch_0792_events_with_master_date_view.sql`

If any migration fails, the transaction aborts and operator can investigate. The backfill is the most likely failure point (if pre-flight finds uncoverable events) — operator must manually populate `event_dates` for those events before re-running.

### Edge function deploys (orchestrator-owned after operator's db push)
- `ticket-checkout-create` (validation gate added)

That's the only edge function touched. `ticket-confirmation-dispatch` does NOT need redeploy — it was already correct.

### EAS OTA (orchestrator-owned after edge deploy)
- Business app: yes — `eas update --branch production --platform ios --message "ORCH-0792: events now have canonical dates"`. Service layer changes are pure JS, ship via OTA.
- Mobile consumer app: no — not touched.

### Operator-assisted live-fire
- Create a new event end-to-end via wizard. Confirm post-publish that `event_dates` has a row.
- Buy a ticket. Confirm email/PDF/calendar block + .ics all populate with the date (this is also ORCH-0785 SC-2 live-fire).
- Open an existing (backfilled) event in business app. Confirm date renders correctly.
- Visit public event page. Confirm date renders.

---

## §16 CLOSE protocol routing

Standard CLOSE. No deprecation extension triggered — `event_dates` is being promoted, not deprecated; the theme JSON path remains for draft mirroring.

Standard CLOSE artifact updates apply: WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS. Plus invariant promotion (AW + AX flip DRAFT → ACTIVE on PASS).

After CLOSE, the orchestrator dispatches:
1. **ORCH-0785 Option C live-fire** (unblocked by this ORCH).
2. **ORCH-0788** (refund/cancel dispatcher) — now has clean event_dates to read from.
3. **ORCH-0793** (scanner time-window enforcement) — now has clean event_dates to JOIN against.

---

## §17 Discoveries for orchestrator (side issues surfaced during SPEC)

### D-1 — `updateLiveEventFields` (mingla-business) is client-side-only Zustand with zero server persistence
**File:** `mingla-business/src/store/liveEventStore.ts:375-450+`
**Finding:** The Zustand mutator only updates local React state (line 384-388: `set((s) => ({...}))`). It records an edit log (line 413-421: `recordEdit`) and fires a notification (line 431: `notifyEventChanged`), but never writes to the server. There is no `business_update_live_event` RPC anywhere in `supabase/migrations/`.
**Severity:** S1 — if an organiser edits a live event's date in `EditPublishedScreen`, the change appears locally, the edit log records it, the notification fires — but the database is unchanged. After app reload, the edit is gone.
**Violation:** Constitution #5 (server state stays server-side). Constitution #2 (one owner per truth — local Zustand becomes a competing authority).
**Why not folded into ORCH-0792:** Out of scope. Fixing this requires a new RPC `business_update_live_event_fields`, RLS audit, conflict handling for concurrent edits, edit-history table, and integration with the existing notification stack. ORCH-0792 is already tight; adding this would balloon scope and miss the launch-unblock window.
**Recommendation to orchestrator:** Register as ORCH-0791 (S1, P1 after ORCH-0792 closes). The two ORCHs share a root cause class (event mutations not persisting properly) but distinct surface areas.

### D-2 — Recurring events have no per-occurrence event_dates row strategy
**Observation:** This SPEC defers recurring-event expansion to a follow-up ORCH. Recurring events get one master row plus `recurrence_rules`. If/when a consumer needs per-occurrence granularity (e.g., per-night scanner check for a 5-night festival), a new ORCH must expand the model.
**Recommendation:** Watch for this as ORCH-0788 (refund/cancel) and ORCH-0793 (scanner) come online. If those ORCHs need per-occurrence rows, file as ORCH-0792.

### D-3 — `events.is_multi_date` / `is_recurring` / `recurrence_rules` columns have no enforced consistency with `event_dates` count
**Observation:** A row with `is_multi_date = true` and 1 event_dates row is technically valid in the schema. Same for `is_recurring = true` with N pre-expanded rows. Spec §4 doesn't add a constraint linking the columns. Future hidden flaw.
**Recommendation:** Register as a P3 polish ORCH after ORCH-0792 closes if it becomes a real source of bugs.

---

## §18 Confidence

**HIGH.** Spec author has read every input file. Architectural decision committed with six concrete reasons. Three migration files specified to compileable detail. Two service files specified with exact patterns. Test matrix covers happy / error / edge / backfill / idempotency. Open questions resolved internally rather than punted to implementor. CI gates and unit tests defined. Hard guards explicit.

The only residual risk is the backfill migration's behavior against real production data — if any of the 17 events has malformed theme JSON beyond what the pre-flight checks for, the implementor will need to either improve the pre-flight or manually patch the event. The migration's `RAISE EXCEPTION 'orch_0792_backfill_aborted'` ensures this fails loudly rather than silently corrupting data.

---

**Spec file:** `Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md`
**Status:** SPEC COMPLETE. Ready for orchestrator REVIEW and implementor dispatch.
