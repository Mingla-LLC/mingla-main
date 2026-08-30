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
-- 25 sections: the 27 consolidated SQL call sites minus the two race fixtures,
-- which carry ZERO `RAISE EXCEPTION` and whose verdict is rendered by M-1173-02i.
--
-- [#2594] Five of the 25 arrived with the #1384/#1397 subjects rehomed out of the
-- class-A static-gates job. Their terminal predicates are of two shapes and the
-- distinction matters when reading the mutations below:
--
--   * RUNTIME predicates (M-1384-02a, M-1384-02c) are falsified by changing DATA
--     on the write path, exactly like the seventeen before them.
--   * DEFINITION predicates (M-1384-02b, M-1397-01, M-1397-02) assert over
--     catalog TEXT — a function body, a registered cron command. Their subject IS
--     the text, so the only falsification available is a text falsification, and
--     each is chosen to be a change a real regression would actually make (an RPC
--     that stops limiting; a cron registration that loses its authenticated
--     header; a cron command whose timeout contract is gone) rather than a
--     cosmetic respacing that would prove only that `position()` works.

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
-- ===== M-1384-02a =====
-- [#2594] terminal: an unsupported viewer currency degrades to EXACT SOURCE
-- MONEY — source_currency_code NGN, source_min_minor 100, no display leg, not
-- approximate. Falsified by moving the stored source floor off 100 on the write
-- path, which is the value the terminal assertion names and nothing earlier in
-- the file reads.
--
-- WHY THE EARLIER ASSERTIONS SURVIVE IT, stated rather than hoped: the only
-- earlier consumer of this fixture is the pre-order/pre-limit price filter,
-- which selects on the band 0..500 NGN. 101..200 still overlaps and 1000..2000
-- (the expensive fixture, deliberately untouched) still does not, so the
-- rank/limit assertion is unmoved. The first two DO blocks read catalog text and
-- FX arithmetic only.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.source_min_minor = 100
     AND NEW.source_max_minor = 200
     AND NEW.source_currency_code = 'NGN' THEN
    NEW.source_min_minor := 101;
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON public.place_discovery_price_ranges
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.place_discovery_price_ranges ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER INSERT OR UPDATE ON public.place_discovery_price_ranges
  FOR EACH ROW WHEN (NEW.source_min_minor = 101 AND NEW.source_max_minor = 200 AND NEW.source_currency_code = 'NGN') EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.place_discovery_price_ranges ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1384-02b =====
-- [#2594] terminal: the price filter lives INSIDE the serving RPC, ahead of the
-- rank and ahead of the limit — asserted as four properties of the RPC's own
-- catalog text: `p_price_filter_currency` present, `ORDER BY ps.score` present,
-- `LIMIT p_limit` present, and the filter token ahead of the ORDER BY.
--
-- The subject of a definition assertion is the definition, so the mutation is a
-- definition mutation. It is the SEMANTICALLY REAL one rather than a respacing:
-- the RPC stops limiting, which is precisely the regression "the filter is not
-- inside the pre-order/pre-limit RPC" is written against — a caller-side LIMIT
-- applied after the RPC has already ranked and truncated.
--
-- Re-emitted from pg_get_functiondef rather than retyped, so nothing else about
-- the function — its security context, its pinned search_path, its ACL — can
-- drift as a side effect of the mutation. The three earlier assertions in the
-- file read pg_policies, table privileges and FOUR OTHER functions' definitions;
-- none of them reads this one.
DO $l5$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)'::regprocedure
  );
  v_def := replace(v_def, 'LIMIT p_limit', '');
  EXECUTE v_def;
END $l5$;
-- Catalog state, which is already a post-condition: the token the terminal
-- assertion requires is gone from the live definition.
-- @l5-verify: SELECT position('LIMIT p_limit' IN pg_get_functiondef('public.issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)'::regprocedure)) = 0

-- ===== M-1384-02c =====
-- [#2594] terminal: after the Paystack brand's reconciliation RESOLVES, the
-- state RPC stops advertising a block — canAcceptPaidReservations true and
-- `reconciliation` back to JSON null.
--
-- THE HARD ONE. 1,028 lines, 45 RAISE EXCEPTION sites, and the terminal one is
-- R25's last. The mutation has to falsify it without tripping any of the 44
-- ahead of it, and the assertion immediately before it pins
-- pg_brand_can_collect(…102) TRUE, which rules out every mutation that works by
-- leaving a pending reconciliation behind — pg_brand_can_collect and the RPC
-- read the SAME `status = 'pending'` predicate, so anything that falsifies the
-- RPC's `reconciliation` leg falsifies the helper first.
--
-- What survives that constraint is exactly one lever, and it is the one term the
-- RPC reads that the helper does not:
--
--   canAcceptPaidReservations = pg_brand_can_collect(brand) AND brands.default_currency IS NOT NULL
--
-- pg_brand_can_collect reads stripe_connect_accounts, brands.paystack_subaccount_code
-- and brand_currency_reconciliations. It does NOT read brands.default_currency.
-- So nulling default_currency for …102 leaves every can_charge/can_collect
-- assertion in the file untouched and falsifies the terminal predicate alone.
--
-- TIMING is the other half. The RPC is called exactly three times in the file —
-- twice for brand …101 and once, terminally, for …102 — so a mutation scoped to
-- …102 cannot reach the other two. It is scoped in TIME as well, to the R25
-- resolution rather than the earlier $convert$ one, by the presence of R25's own
-- marker Connect account: firing during $convert$ would null the currency while
-- issue_1384_resolve_reconciliation is still converting ranges into it, and the
-- earlier `convert resolution/readiness failed` assertion would trip instead.
--
-- Nulling default_currency is SAFE against every trigger on public.brands, and
-- that is checked rather than assumed: issue_1384_reconcile_bank_currency returns
-- early on `NEW.default_currency IS NULL` (so no new pending row is created, which
-- would have tripped the assertion ahead of the terminal one), and both
-- issue_1384_bump_brand_currency_state and tg_brands_derive_pricing_from_default
-- are no-ops or column bumps on NULL. The suite itself nulls …101's currency the
-- same way earlier in R25.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.brand_id = '13840000-0000-4000-8000-000000000102'
     AND NEW.status = 'converted'
     AND EXISTS (
       SELECT 1 FROM public.stripe_connect_accounts
       WHERE stripe_account_id = 'acct_issue_1384_r25'
     ) THEN
    UPDATE public.brands
       SET default_currency = NULL
     WHERE id = '13840000-0000-4000-8000-000000000102';
  END IF;
  RETURN NULL;
END $l5$;
CREATE TRIGGER l5_mutant AFTER UPDATE ON public.brand_currency_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE public.brand_currency_reconciliations ENABLE ALWAYS TRIGGER l5_mutant;
CREATE OR REPLACE FUNCTION public.l5_witness() RETURNS trigger LANGUAGE plpgsql AS $w$
BEGIN PERFORM nextval('public.l5_fired'); RETURN NULL; END $w$;
CREATE TRIGGER l5_verify AFTER UPDATE ON public.brands
  FOR EACH ROW WHEN (NEW.id = '13840000-0000-4000-8000-000000000102' AND NEW.default_currency IS NULL AND OLD.default_currency IS NOT NULL) EXECUTE FUNCTION public.l5_witness();
ALTER TABLE public.brands ENABLE ALWAYS TRIGGER l5_verify;
-- @l5-verify: SELECT is_called FROM public.l5_fired

-- ===== M-1397-01 =====
-- @l5-apply-as: supabase_admin
-- [#2594] terminal: the FX cron this migration registers is SERVICE-ROLE
-- AUTHORIZED — its command names the function route, the Vault service-role key
-- and the Authorization header.
--
-- WHY THIS ONE NEEDS A DECLARED ROLE, and it is measured rather than argued.
-- This subject WRITES ITS OWN SUBJECT: the migration unschedules and re-registers
-- the job in the same file, so a pre-applied UPDATE is overwritten before the
-- probe reads it. The falsification must therefore sit on the WRITE PATH. Run
-- 98413780618 measured what `postgres` may do to cron.job: a plain
-- `UPDATE cron.job` was refused with `permission denied for table job`, and
-- has_table_privilege(...,'TRIGGER') was false. supabase/postgres deliberately
-- de-superusers `postgres`, so from that role this predicate has NO falsification
-- at all — not a weaker one, none.
--
-- `supabase_admin` over the container's loopback is the escape this job already
-- uses to close the template and cut every scratch copy. Same connection, new
-- caller. The declaration is visible here rather than buried in the harness.
--
-- TWO ROUTES ARE INSTALLED, because ONE UNKNOWN REMAINS after the privilege one
-- is solved: whether pg_cron's registration reaches cron.job through the executor
-- (where a trigger fires) or through a direct catalog insert (where it does not).
-- I could not settle that without booting the image, so the mutation does not
-- depend on the answer:
--
--   * the REGISTRATION WRAPPER is executor-independent — it wraps cron.schedule
--     itself and fixes the row up afterwards, whatever the original did;
--   * the WRITE-PATH TRIGGER covers the case where the wrapper cannot be
--     installed at all.
--
-- They are idempotent together: if the trigger already stripped the header, the
-- wrapper's rewrite matches nothing.
DO $l5_precheck$
DECLARE
  v_owner text;
  v_admin_bits text := 'role absent';
  v_member text := 'n/a';
  v_report text;
BEGIN
  SELECT relowner::regrole::text INTO v_owner FROM pg_class WHERE oid = 'cron.job'::regclass;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    v_admin_bits := format('SELECT=%s UPDATE=%s INSERT=%s TRIGGER=%s',
      has_table_privilege('supabase_admin', 'cron.job', 'SELECT'),
      has_table_privilege('supabase_admin', 'cron.job', 'UPDATE'),
      has_table_privilege('supabase_admin', 'cron.job', 'INSERT'),
      has_table_privilege('supabase_admin', 'cron.job', 'TRIGGER'));
    v_member := pg_has_role('postgres', 'supabase_admin', 'MEMBER')::text;
  END IF;
  v_report := format(
    'MEASURED — cron.job owner=%s; applying role=%s superuser=%s; postgres: SELECT=%s UPDATE=%s INSERT=%s TRIGGER=%s; supabase_admin: %s; postgres-in-supabase_admin=%s',
    v_owner, current_user,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
    has_table_privilege('postgres', 'cron.job', 'SELECT'),
    has_table_privilege('postgres', 'cron.job', 'UPDATE'),
    has_table_privilege('postgres', 'cron.job', 'INSERT'),
    has_table_privilege('postgres', 'cron.job', 'TRIGGER'),
    v_admin_bits, v_member);
  RAISE NOTICE '%', v_report;
  IF NOT has_table_privilege('cron.job', 'TRIGGER') THEN
    RAISE EXCEPTION 'L-5 M-1397-01: the applying role cannot install a write-path interception on cron.job, so this terminal predicate has no falsification available to it. This is a statement about the ENVIRONMENT, NOT about the assertion, and it must not be read as one. %', v_report;
  END IF;
END $l5_precheck$;
-- Route 1 — the registration wrapper. SECURITY DEFINER because the migration
-- calls cron.schedule as `postgres`, which cannot write cron.job; the definer is
-- the applying role. Installed inside a subtransaction, so a refused rename
-- leaves cron.schedule exactly as it was and route 2 still stands.
DO $l5_wrapper$
BEGIN
  ALTER FUNCTION cron.schedule(text, text, text) RENAME TO l5_schedule_original;
  EXECUTE $w$
    CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $f$
    DECLARE
      v_id bigint;
    BEGIN
      v_id := cron.l5_schedule_original(p_name, p_schedule, p_command);
      UPDATE cron.job
         SET command = replace(command, 'Authorization', 'X-L5-Mutant')
       WHERE jobid = v_id;
      RETURN v_id;
    END
    $f$
  $w$;
  RAISE NOTICE 'L-5 M-1397-01: registration wrapper installed; the falsification no longer depends on whether pg_cron writes cron.job through the executor.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'L-5 M-1397-01: registration wrapper NOT installed (%); falling back to the write-path trigger alone.', SQLERRM;
END $l5_wrapper$;
-- Route 2 — the write-path trigger.
CREATE OR REPLACE FUNCTION public.l5_mutant() RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.jobname = 'issue_1397_fx_refresh_daily' THEN
    NEW.command := replace(NEW.command, 'Authorization', 'X-L5-Mutant');
  END IF;
  RETURN NEW;
END $l5$;
CREATE TRIGGER l5_mutant BEFORE INSERT OR UPDATE ON cron.job
  FOR EACH ROW EXECUTE FUNCTION public.l5_mutant();
ALTER TABLE cron.job ENABLE ALWAYS TRIGGER l5_mutant;
-- The migration does not wrap itself in a transaction, so the registration this
-- mutation rewrites is COMMITTED before the probe runs and survives the probe's
-- own failure. The post-condition is therefore checkable directly.
-- @l5-verify: SELECT bool_and(command NOT LIKE '%Authorization%') FROM cron.job WHERE jobname = 'issue_1397_fx_refresh_daily'

-- ===== M-1397-02 =====
-- [#2594] terminal: the registered FX cron still carries its authenticated
-- Vault/pg_net contract, of which the 30 s pg_net timeout is one named term.
--
-- NO ESCALATION, and the first attempt showed why one looked necessary and is
-- not. This section used to mutate the registration with a plain
-- `UPDATE cron.job`; run 98413780618 refused it with `permission denied for
-- table job`. But the migration in M-1397-01 CONTROLS CLEAN in the same run,
-- exit 0, and it calls cron.unschedule and cron.schedule as `postgres` — so the
-- registration IS writable from that role, just never through the table. The
-- mutation goes through the same two functions the subject itself uses.
--
-- Unlike M-1397-01 this file only READS the registration (the job arrives from
-- the migration chain already applied to the template), so re-registering it
-- before the file runs is enough.
--
-- The schedule and every other token are READ BACK from the live row and passed
-- through unchanged, so the earlier assertion — exactly one job, at 15 1 * * * —
-- stays true by construction rather than by a retyped literal that could drift.
-- The timeout term is chosen deliberately: it is the ONE token of the six this
-- file names that the migration's own probe does not, so the two subjects cannot
-- prove each other by accident.
DO $l5$
DECLARE
  v_sched text;
  v_cmd text;
  v_schedule regprocedure := to_regprocedure('cron.schedule(text,text,text)');
  v_unschedule regprocedure := to_regprocedure('cron.unschedule(text)');
BEGIN
  IF v_schedule IS NULL OR v_unschedule IS NULL
     OR NOT has_function_privilege(v_schedule::oid, 'EXECUTE')
     OR NOT has_function_privilege(v_unschedule::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'L-5 M-1397-02: the applying role cannot execute cron.schedule/cron.unschedule, so the registration cannot be rewritten. This is a statement about the ENVIRONMENT, NOT about the assertion.';
  END IF;
  SELECT schedule, command INTO v_sched, v_cmd
    FROM cron.job WHERE jobname = 'issue_1397_fx_refresh_daily';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'L-5 M-1397-02: no FX cron registration exists in this database to rewrite. This is a statement about the ENVIRONMENT, NOT about the assertion.';
  END IF;
  v_cmd := replace(v_cmd, 'timeout_milliseconds := 30000', 'timeout_milliseconds := 250');
  PERFORM cron.unschedule('issue_1397_fx_refresh_daily');
  PERFORM cron.schedule('issue_1397_fx_refresh_daily', v_sched, v_cmd);
END $l5$;
-- @l5-verify: SELECT bool_and(command NOT LIKE '%timeout_milliseconds := 30000%') FROM cron.job WHERE jobname = 'issue_1397_fx_refresh_daily'

-- ===== M-2794-01 =====
REVOKE EXECUTE ON FUNCTION public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid) FROM authenticated;
-- @l5-verify: SELECT NOT has_function_privilege('authenticated', 'public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid)', 'EXECUTE')

-- ===== M-2794-02 =====
GRANT SELECT ON TABLE public.business_recent_entity_opens TO authenticated;
-- @l5-verify: SELECT has_table_privilege('authenticated', 'public.business_recent_entity_opens', 'SELECT')

-- ===== M-1772-01 =====
-- [TEST-MOD-APPROVED #1772] Preserve the real person-row wait, then falsify only
-- the terminal novel-address predicate by allowing its one deterministic fixture
-- to commit as retired after erasure. The ordinary tombstone checks stay intact.
CREATE OR REPLACE FUNCTION public.l5_issue_1772_allow_novel_writer()
RETURNS trigger LANGUAGE plpgsql AS $l5$
BEGIN
  IF NEW.id='17720000-0000-4000-8000-000000000904'::uuid THEN
    PERFORM 1 FROM public.brand_people WHERE id=NEW.brand_person_id FOR UPDATE;
    NEW.record_state:='retired';
    NEW.retired_at:=now();
  END IF;
  RETURN NEW;
END
$l5$;
CREATE TRIGGER a_l5_issue_1772_novel_writer
  BEFORE INSERT ON public.brand_person_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.l5_issue_1772_allow_novel_writer();
-- @l5-verify: SELECT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE id='17720000-0000-4000-8000-000000000904'::uuid)
