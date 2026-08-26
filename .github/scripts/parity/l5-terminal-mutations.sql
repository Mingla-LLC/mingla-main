-- #2591 L-5 — the terminal-assertion RED proof. One mutation per assertion-bearing
-- suite file, applied to a THROWAWAY copy of the migrated template before the
-- UNMODIFIED suite file is run against it.
--
-- WHY THIS LEG EXISTS, AND WHY L-2 DOES NOT COVER IT
--
-- L-2 counts `DO` blocks that COMPLETED. A block completes whether or not the
-- `IF` inside it ever fired, so L-2 proves the files EXECUTED and proves nothing
-- about whether their assertions still have subjects. L-5 is the only leg that
-- asks whether a file which had silently stopped asserting anything would be
-- noticed. That is the #2438 shape and it is why this leg was in the SPEC.
--
-- NO TEST FILE IS EDITED. The mutation is applied to the DATABASE; the suite file
-- runs byte-identical to the one the real suite step runs.
--
-- EVERY MUTATION IS THE MINIMUM CHANGE THAT FALSIFIES ONLY THE TERMINAL PREDICATE.
-- The harness matches psql's stderr against the terminal message READ OUT OF THE
-- FILE AT RUN TIME, never a hardcoded string, which makes the leg self-checking in
-- three directions, all of which fail CLOSED:
--
--   * mutation trips an EARLIER assertion -> psql stops with that assertion's
--     message, the match fails, the proof is refused;
--   * mutation does not falsify anything  -> the run exits 0, and an exit 0 under
--     mutation is RED;
--   * the file stops asserting altogether  -> the unmutated control still exits 0
--     but the mutated run also exits 0, and that is RED.
--
-- Sections are delimited by `-- ===== <command-id> =====` and split at run time.
-- 17 sections: the 19 consolidated SQL files minus the two race fixtures, which
-- carry ZERO `RAISE EXCEPTION` and whose verdict is rendered by M-1173-02i.

-- RUN 8 CORRECTION — THE WITNESS ASSERTS THE POST-CONDITION, NOT THE ATTEMPT.
--
-- `nextval` used to fire on ENTRY to the trigger body, before the statement that
-- was supposed to change anything. A mutation whose effect was blocked, swallowed
-- or filtered still recorded is_called = t, so the harness could not tell "the
-- assertion has no teeth" from "my mutation did not land" — and it reported the
-- first. That would have filed a false defect against a correct test.
--
-- It is the same class this change keeps surfacing, one level up again: a witness
-- that observes the attempt rather than the outcome.
--
-- So every witness now fires ONLY when the intended STATE is true:
--   * value mutations  — an AFTER trigger whose WHEN clause is the post-condition,
--                        evaluated against the row as actually STORED;
--   * suppressions     — a statement-level AFTER trigger asserting the ABSENCE;
--   * the ghost clone  — an EXISTS check after the INSERT attempt;
--   * grants/constraints — catalog state, which was already a post-condition.
--
-- Sentinels replace increments where a post-condition could not otherwise be
-- stated: `attempt_count + 1` has no checkable end state without the prior value.
--
-- is_called therefore now MEANS "the intended state was reached", and only that
-- may drive a FINDING.

-- ===== M-1172-02a =====
-- terminal: the accepted payout was reconciled onto release …007. A non-NULL
-- wrong value, deliberately: `NULL <> 'po_issue1172'` is NULL, not TRUE.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  -- RUN 8: `ERROR: query returned no rows`. Rewriting the payout id on EVERY
  -- write broke the claim the file looks up by it, so an earlier SELECT INTO
  -- STRICT failed. Rewrite ONLY the final expected value; earlier NULL states
  -- pass through untouched.
  IF NEW.id = '11720000-0000-0000-0000-000000000007'
     AND NEW.stripe_payout_id = 'po_issue1172' THEN
    NEW.stripe_payout_id := 'po_l5_mutant';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW WHEN (NEW.id = '11720000-0000-0000-0000-000000000007' AND NEW.stripe_payout_id = 'po_l5_mutant') EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1172-02b =====
-- terminal: release …111 reopened exactly once (attempt_count = 8). A SENTINEL,
-- not an increment — an increment has no post-condition statable without the
-- prior value, and the witness must assert state.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.id = '11720000-0000-0000-0000-000000000111' THEN
    NEW.attempt_count := 999;
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW WHEN (NEW.id = '11720000-0000-0000-0000-000000000111' AND NEW.attempt_count = 999) EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1172-02c =====
-- terminal: the email idempotency RPC is not executable outside service_role.
-- Catalog state: already a post-condition.
GRANT EXECUTE ON FUNCTION public.complete_notification_email_delivery(uuid,uuid,text,text,text,timestamptz) TO anon;
-- @l5-verify: SELECT has_function_privilege('anon', 'public.complete_notification_email_delivery(uuid,uuid,text,text,text,timestamptz)', 'EXECUTE')

-- ===== M-1174-04 =====
-- terminal: the no-partner sale was not underpaid (net_release_cents = 890000).
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.net_release_cents = 890000 THEN
    NEW.net_release_cents := 890001;
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW WHEN (NEW.net_release_cents = 890001) EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1174-05 =====
-- terminal: the canonical RPC wrote BOTH rows. `status = 'held'` is read ONLY by
-- the terminal EXISTS, so moving it leaves every earlier read intact.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.order_id = '1174a000-0000-4000-8000-000000000035' THEN
    -- RUN 8: violated partner_splits_status_check. Allowed values are
    -- 'held','pending','transferred'; 'pending' is valid and is not 'held',
    -- which is the only value the terminal EXISTS accepts.
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.partner_splits
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.partner_splits ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.partner_splits
  FOR EACH ROW WHEN (NEW.order_id = '1174a000-0000-4000-8000-000000000035' AND NEW.status = 'pending') EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.partner_splits ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1174-06 =====
-- terminal: leg-less split C stayed 'pending'.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.id = '1174c000-0000-4000-8000-0000000000c1' THEN
    NEW.status := 'transferred';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.partner_splits
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.partner_splits ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.partner_splits
  FOR EACH ROW WHEN (NEW.id = '1174c000-0000-4000-8000-0000000000c1' AND NEW.status = 'transferred') EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.partner_splits ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1612-02 =====
-- terminal: the event-kind CHECK still rejects unknown kinds. Catalog state.
ALTER TABLE public.engagement_metrics DROP CONSTRAINT engagement_metrics_event_kind_check;
-- @l5-verify: SELECT to_regclass('public.engagement_metrics') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_metrics_event_kind_check')

-- ===== M-1217A-02 =====
-- terminal: the reversal-unreconciled alert was drainable. The effect is an
-- ABSENCE, so the witness asserts the absence.
-- RUN 8: suppressing the row reached too far back — an EARLIER assertion
-- counts the outbox row itself and reported 0. The terminal counts what
-- the DRAIN returns, and claim_payout_release_alerts requires
-- status='pending' (or a stale 'dispatching'). So the row is left in
-- place and only its status is moved: 'raised' still holds, 'drainable'
-- does not. That is exactly the gap between the two assertions.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.release_id = '12170000-0000-0000-0000-000000000001'
     AND NEW.alert_kind = 'paystack_reversal_unreconciled' THEN
    NEW.status := 'manual_review';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.payout_release_alert_outbox
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.payout_release_alert_outbox
  FOR EACH ROW WHEN (NEW.release_id = '12170000-0000-0000-0000-000000000001'
                     AND NEW.alert_kind = 'paystack_reversal_unreconciled'
                     AND NEW.status = 'manual_review')
  EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1217T-02 =====
-- terminal (:170): the park-idempotency path did not move delivered cash.
--
-- V-2. An earlier ruling classified this a DUPLICATE of :114 because the two
-- share a predicate. That was a misreading. They sit in DIFFERENT `DO` blocks
-- separated by Test 3, and :170 asserts something :114 structurally CANNOT — that
-- the park-idempotency path left the column alone — because :114 had already run
-- before that path executed. Test 3's siblings do not cover it either: :144
-- counts alerts, :149 counts adjustments, :167 guards a different column. A write
-- to organiser_cash_delivered_cents with no adjustment row passes all three and
-- is caught ONLY by :170. Calling it a duplicate would have invited someone to
-- delete a live guard.
--
-- So the mutation moves to the park path itself: fire on the reversal-unreconciled
-- alert row for this release (Test 3's leg is …00a1; Test 2's is …00a0), AFTER
-- :114 has already passed, and move the delivered-cash column then. That leaves
-- :114, :144, :149 and :167 untouched and falsifies only :170.
--
-- UNVERIFIED as to timing: the chain cannot be replayed locally, so whether this
-- fires strictly after :114 is decided by the run. If it trips anything earlier
-- the harness refuses it and says which — and the honest redeclaration would then
-- be `unreachable-by-write-time-mutation`, a property of L-5's mutation model,
-- NEVER `duplicate-of-earlier-assertion`.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.alert_kind = 'paystack_reversal_unreconciled'
     AND NEW.release_id = 'ad170000-0000-0000-0000-000000000001' THEN
    UPDATE public.brand_payout_releases
       SET organiser_cash_delivered_cents = organiser_cash_delivered_cents + 1
     WHERE id = 'ad170000-0000-0000-0000-000000000001';
    -- POST-CONDITION, not the attempt: the column actually moved off 999000.
    IF (SELECT organiser_cash_delivered_cents FROM public.brand_payout_releases
         WHERE id = 'ad170000-0000-0000-0000-000000000001') <> 999000 THEN
      PERFORM nextval('public.l5_fired');
    END IF;
  END IF;
  RETURN NULL;
END $l5$;
CREATE TRIGGER l5_mutant AFTER INSERT ON public.payout_release_alert_outbox
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_mutant;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1840-03 =====
-- terminal: past the ₦1,000 floor a materially worse shortfall surfaces. Holding
-- the release below the floor keeps it silent; the assertion before it EXPECTS
-- silence, so only the terminal one flips.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.id = '18400000-0000-0000-0000-0000000000c2'
     AND NEW.net_release_cents = 200000 THEN
    NEW.net_release_cents := 1;
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.brand_payout_releases
  FOR EACH ROW WHEN (NEW.id = '18400000-0000-0000-0000-0000000000c2' AND NEW.net_release_cents = 1) EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.brand_payout_releases ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1840-04 =====
-- terminal: the multi-chunk blocked_balance alert reached the drain.
-- RUN 8: suppressing the row reached too far back — an EARLIER assertion
-- counts the outbox row itself and reported 0. The terminal counts what
-- the DRAIN returns, and claim_payout_release_alerts requires
-- status='pending' (or a stale 'dispatching'). So the row is left in
-- place and only its status is moved: 'raised' still holds, 'drainable'
-- does not. That is exactly the gap between the two assertions.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.release_id = '18401840-0012-0000-0000-000000000001'
     AND NEW.alert_kind = 'paystack_balance_blocked' THEN
    NEW.status := 'manual_review';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.payout_release_alert_outbox
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.payout_release_alert_outbox
  FOR EACH ROW WHEN (NEW.release_id = '18401840-0012-0000-0000-000000000001'
                     AND NEW.alert_kind = 'paystack_balance_blocked'
                     AND NEW.status = 'manual_review')
  EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1840-05 =====
-- terminal: the once-ever backstop key gained no revision suffix.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  -- RUN 8: `C2 a revision suffix leaked onto a kind whose payload is a fixed
  -- fact`. C2 checks the SAME position(':r') predicate on the SAME alert kind,
  -- earlier. It is not subsumption though: C2 reads release …0002-…001 and C8
  -- reads …0008-…001, and C8's own preceding assertion proves exactly one row
  -- of this kind exists by then. Scoping the suffix to C8's release leaves
  -- C2's row untouched, so C2 passes and only C8 flips.
  IF NEW.alert_kind = 'paystack_balance_blocked'
     AND NEW.release_id = '18401841-0008-0000-0000-000000000001' THEN
    NEW.idempotency_key := NEW.idempotency_key || ':r9';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT ON public.payout_release_alert_outbox
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT ON public.payout_release_alert_outbox
  FOR EACH ROW WHEN (NEW.alert_kind = 'paystack_balance_blocked'
        AND NEW.release_id = '18401841-0008-0000-0000-000000000001'
        AND NEW.idempotency_key LIKE '%:r9') EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.payout_release_alert_outbox ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1173-02a =====
-- terminal: exactly one 'rolled_back' ledger row. `result` carries a CHECK, so the
-- lever is `cutover_after IS NULL`, also part of the terminal predicate.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.direction = 'rollback' AND NEW.result = 'rolled_back' THEN
    NEW.cutover_after := '2027-01-01 00:00:00+00';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT ON public.payout_hold_cutover_migrations
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.payout_hold_cutover_migrations ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT ON public.payout_hold_cutover_migrations
  FOR EACH ROW WHEN (NEW.direction = 'rollback' AND NEW.result = 'rolled_back' AND NEW.cutover_after IS NOT NULL) EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.payout_hold_cutover_migrations ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1173-02b =====
-- terminal [CASE D], the ONE labelled terminal assertion of the seventeen:
-- stamping a non-existent brand must raise brand_not_found.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
DECLARE ghost public.brands%ROWTYPE;
BEGIN
  IF NEW.id <> '11730000-0000-0000-0000-0000dead0000' THEN
    ghost := NEW;
    ghost.id := '11730000-0000-0000-0000-0000dead0000';
    ghost.payout_hold_cutover_at := NULL;
    -- RUN 9, via the post-condition witness: the clone never landed. The blocker
    -- is `idx_brands_slug_active`, a UNIQUE index on lower(slug) WHERE
    -- deleted_at IS NULL — a wholesale %ROWTYPE copy carries the source row's
    -- slug verbatim and collides with it. Exactly the shape this comment
    -- predicted before the witness could see it.
    ghost.slug := ghost.slug || '-l5ghost';
    BEGIN
      INSERT INTO public.brands VALUES (ghost.*);
    EXCEPTION WHEN OTHERS THEN
      -- Instrumented rather than swallowed: if a DIFFERENT constraint blocks it
      -- next time, the error is in the log instead of costing another round trip.
      RAISE WARNING 'L5 M-1173-02b: ghost clone refused: % (%)', SQLERRM, SQLSTATE;
    END;
    -- POST-CONDITION, not the attempt. Run 8 reported FINDING here on the
    -- strength of a witness that fired on ENTRY: a clone blocked by a unique
    -- constraint still recorded is_called = t, and the harness read that as a
    -- toothless assertion. Tracing CASE D shows the opposite — with the ghost
    -- really present the stamp does not raise, the `did not raise` message is
    -- caught by the block's own handler, v_err is then that message, and the
    -- terminal `expected brand_not_found, got %` fires uncaught. The assertion
    -- HAS teeth. So the witness now fires only if the ghost is really there.
    IF EXISTS (SELECT 1 FROM public.brands WHERE id = '11730000-0000-0000-0000-0000dead0000') THEN
      PERFORM nextval('public.l5_fired');
    END IF;
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant AFTER INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brands ENABLE ALWAYS TRIGGER l5_mutant;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1173-02c =====
-- terminal (f): service_role is REFUSED UPDATE on the append-only cutover ledger.
--
-- V-1. An earlier ruling here declared (f) SUBSUMED by (e) on the grounds that
-- has_table_privilege resolves inherited and superuser privileges, so any route
-- letting (f) fail would make (e) true first. That reasoning OMITTED COLUMN-LEVEL
-- GRANTS — which is precisely where a table-granularity catalog check and runtime
-- behaviour diverge, and precisely the divergence (f) exists to catch.
--
-- MEASURED on PostgreSQL 17.10:
--   GRANT UPDATE (reason) ON public.ledger TO service_role;
--   has_table_privilege ('service_role','public.ledger','UPDATE')          = false
--   has_column_privilege('service_role','public.ledger','reason','UPDATE') = true
--   and the runtime `UPDATE … WHERE false` SUCCEEDS.
-- So (e) passes and (f) fails, from one grant. (f) is INDEPENDENTLY FALSIFIABLE,
-- the subsumption was unnecessary, and it is retired.
--
-- This mattered beyond one row: left standing, the repo would have carried a
-- guard-enforced written claim that has_table_privilege subsumes runtime UPDATE
-- refusal. It does not, and someone would have cited it.
--
-- No assertion in this file inspects column ACLs (has_column_privilege, relacl,
-- aclexplode, attacl, column_privileges — none appear), so the column grant
-- cannot trip anything earlier. If it does anyway, the harness refuses it.
GRANT UPDATE (reason) ON TABLE public.payout_hold_cutover_migrations TO service_role;
-- @l5-verify: SELECT has_column_privilege('service_role', 'public.payout_hold_cutover_migrations', 'reason', 'UPDATE')

-- ===== M-1173-02d =====
-- terminal: no race brand started out already stamped. The assertion before it
-- counts the three fixtures, which this leaves alone.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.id IN ('18079999-0000-4000-8000-000000000011',
                '18079999-0000-4000-8000-000000000012') THEN
    NEW.payout_hold_cutover_at := '2027-01-01 00:00:00+00';
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brands ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT ON public.brands
  FOR EACH ROW WHEN (NEW.id IN ('18079999-0000-4000-8000-000000000011',
                                '18079999-0000-4000-8000-000000000012')
                     AND NEW.payout_hold_cutover_at IS NOT NULL)
  EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.brands ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1173-02i =====
-- terminal: the adversarial fixtures did not leak. Refusing the cleanup DELETE
-- for one fixture brand is exactly the leak the assertion is written against.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF OLD.id = '18079999-0000-4000-8000-000000000011' THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE DELETE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brands ENABLE ALWAYS TRIGGER l5_mutant;
-- The effect is the SURVIVAL of a row a DELETE tried to remove, and this file
-- COMMITs its cleanup, so the post-condition is checkable directly after the run
-- rather than through a witness. That is the strongest form available here.
-- @l5-verify: SELECT EXISTS (SELECT 1 FROM public.brands WHERE id = '18079999-0000-4000-8000-000000000011')
