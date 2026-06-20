-- META-ORCH-1161 Sub-B — marketing SMS send path.
--
-- Additive column on marketing_messages so the SMS send loop can record the
-- per-message segment count (GSM-7 160/seg vs UCS-2 70/seg) the smsAdapter
-- computes. Needed for the per-campaign cost/deliverability dashboard and the
-- segment-count discipline in SPEC §6.8/R-2. Email rows leave it NULL.
--
-- No data backfill (existing rows are email; segments is meaningless for them).
-- Idempotent — safe to re-run.

ALTER TABLE public.marketing_messages
  ADD COLUMN IF NOT EXISTS segments integer;

COMMENT ON COLUMN public.marketing_messages.segments IS
  'META-ORCH-1161 Sub-B — SMS segment count recorded by smsAdapter at send '
  '(GSM-7 160/153, UCS-2 70/67). NULL for email rows. Cost observability only, '
  'not billing-precise (SPEC §6.8, R-2).';
