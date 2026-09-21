-- issue #3526 [Gemini repin] — migration B of three. M-1, the highest-value
-- monitoring fix in the spec.
--
-- WHY. `tool_leads` outlived the function logs. It is how we established that
-- Gemini last succeeded on 2026-09-15 10:19:25 and failed six times after. But
-- every failed row carries `status = 'failed'` and `report = NULL`: the table
-- records THAT a run failed and never WHY. Google's actual error — "this model
-- models/gemini-2.5-flash is no longer available to new users" — WAS written
-- to `function_logs` (the instrumentation existed) and then expired with log
-- retention. So a four-day-old failure had no retrievable cause while the row
-- proving it failed was still sitting there.
--
-- Logs expire. Rows do not. One column would have answered #3526 on day one.
--
-- SHAPE. `{ "stage": text, "http_status": int, "detail": text }`.
--   stage       — which pass failed: config / research / synthesis / generate /
--                 timeout / budget_exhausted. Safe to surface to the owning
--                 authenticated caller.
--   http_status — the provider's HTTP status, or null for a non-HTTP failure
--                 (missing key, timeout, budget exhaustion).
--   detail      — the provider's own message, truncated to 500 chars and
--                 scrubbed of anything key-shaped by
--                 _shared/toolLeadFailure.ts scrubFailureDetail().
-- NEVER the request body, NEVER PII, NEVER a credential.
--
-- ACCESS. `tool_leads` is RLS ENABLED with ZERO policies — deny-all for anon
-- AND authenticated (I-1045-ANON-NO-SELECT, set at table creation in
-- 20260721012341). A new column inherits exactly that posture: the table-level
-- anon SELECT grant recorded in the #1856 grant-class baseline is not a row
-- grant, and with no policy there are no visible rows. Grants are deliberately
-- NOT changed here — revoking would break the #1856 grant-class guard's
-- baseline.
--
-- `growth-tools-report` does NOT read this column. Surfacing even the stage
-- means widening its APP_READ_COLUMNS security allowlist, which is a decision
-- for Seth and the tester; the deferral is raised on issue #3526 and pinned by
-- a test. (An earlier draft of this comment described a stage-only filter that
-- was never written.)
--
-- SAFE-MIGRATION: purely additive (one nullable column + one comment),
-- idempotent (IF NOT EXISTS), no backfill, no lock beyond a catalog-only
-- ADD COLUMN of a nullable column with no default. Reversible (ROLLBACK below).

ALTER TABLE public.tool_leads
    ADD COLUMN IF NOT EXISTS failure_reason jsonb;

COMMENT ON COLUMN public.tool_leads.failure_reason IS
    'issue #3526: WHY this run failed, written at failure time alongside '
    'status=''failed''. Shape {stage, http_status, detail} — the provider''s '
    'status line and its own message truncated to 500 chars and scrubbed of '
    'key-shaped strings. NEVER the request body, NEVER PII, NEVER a credential. '
    'Exists because function_logs held the cause and expired, leaving a '
    'four-day-old failure unexplainable while the row proving it failed '
    'survived. Written by _shared/toolLeadFailure.ts markToolLeadFailed().';

-- ROLLBACK (manual, forward-only pipeline — documented per safe-migration
-- protocol):
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS failure_reason;
