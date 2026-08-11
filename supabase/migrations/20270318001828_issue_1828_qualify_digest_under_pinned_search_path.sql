-- ===========================================================================
-- Issue #1828 — resolve digest() under pinned search_paths, and ship the
-- catalog probe that reds on the whole CLASS.
--
-- THE BUG (proven on production, non-mutating):
--   pgcrypto is installed `WITH SCHEMA extensions`, so `digest()` exists ONLY
--   in `extensions`. Three shipped functions call it UNQUALIFIED under a
--   pinned `search_path` that does not contain `extensions`, so the call
--   cannot resolve at run time and the statement dies at parse-analysis:
--
--     do $$ begin
--       perform set_config('search_path','public, pg_temp', true);
--       perform digest('x'::bytea,'sha256');
--     end $$;
--     -- ERROR 42883: function digest(bytea, unknown) does not exist
--
--   | function                                   | pinned path      | calls |
--   |--------------------------------------------|------------------|-------|
--   | pg_prepare_guest_venue_cancellation_refund  | public, pg_temp  |   2   |
--   | pg_guest_venue_refund_summary               | public, pg_temp  |   1   |
--   | anonymize_user_audit_log                    | public, pg_temp  |   1   |
--
--   User-facing: a guest CANNOT self-cancel a venue reservation. The call
--   fails closed (no money moves) but the guest is stuck, which converts into
--   support load and no-shows.
--
-- THE FIX — schema-qualify the call sites as `extensions.digest(...)`, which
--   is the pattern the 14 HEALTHY digest callers already use
--   (biz_ticket_checkout_token_hash, biz_ticket_checkout_qr_payload,
--   biz_rsvp_qr_payload, the issue_1388/1389 stay-payment family, ...).
--   Chosen over widening each pinned `search_path` to include `extensions`
--   because the pinned path is a SECURITY DEFINER hardening control: every
--   schema added to it is another namespace an attacker could shadow. The
--   qualification is local to the call, the path stays tight, and the repo
--   ends with ONE convention instead of two.
--
--   The three bodies below are BYTE-FOR-BYTE the shipped ones (md5 of
--   pg_proc.prosrc on production matched the repo text before the edit) with
--   the ONLY change being `digest(` -> `extensions.digest(`. No behavioural
--   drift is possible.
--
-- THE CLASS — this is not three bugs, it is one bug class: a function with a
--   pinned `search_path` lacking `extensions` (or with no pinned path at all)
--   that calls an `extensions`-resident routine unqualified. On production
--   that exposure covers 79 routine names -- digest, crypt, hmac, gen_salt,
--   gen_random_bytes, the uuid_generate_* family, unaccent, similarity,
--   show_trgm, the pgp_* family, url_encode/url_decode, verify, ... .
--   `public.audit_unqualified_extension_calls()` below is the live catalog
--   probe for exactly that class. It reads pg_proc, so it sees the LAST
--   definition of every function regardless of which migration wrote it --
--   something no amount of text-matching over migration files can do.
--
-- WHY THE OLD TESTS DID NOT CATCH IT — every existing assertion about these
--   functions read `pg_get_functiondef()` and matched SOURCE TEXT. Source
--   text is identical before and after the bug. The suite added with this
--   migration CALLS the functions instead.
-- ===========================================================================

-- pgcrypto must be resolvable under its qualified name before anything below
-- references it. Fail LOUD here rather than shipping three functions that
-- point at a routine that is not there.
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA "extensions";

DO $issue_1828_precondition$
BEGIN
  IF to_regprocedure('extensions.digest(text, text)') IS NULL
     OR to_regprocedure('extensions.digest(bytea, text)') IS NULL THEN
    RAISE EXCEPTION 'issue_1828_extensions_digest_missing';
  END IF;
END $issue_1828_precondition$;

-- ---------------------------------------------------------------------------
-- 1  pg_guest_venue_refund_summary — the guest's refund read.
--    1 call site qualified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_guest_venue_refund_summary(
  p_reservation_id uuid,p_guest_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_summary jsonb;
BEGIN
  SELECT public.issue_1221_source_refund_summary(sr) INTO v_summary
  FROM public.reservation_checkout_sessions s
  JOIN public.source_refunds sr ON sr.source_id=s.id AND sr.source_type='venue_reservation'
  WHERE s.reservation_id=p_reservation_id
    AND s.guest_cancel_token_hash =
      'v1:' || encode(extensions.digest(COALESCE(p_guest_token,''),'sha256'),'hex');
  IF v_summary IS NULL THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  RETURN v_summary;
END $$;

-- ---------------------------------------------------------------------------
-- 2  pg_prepare_guest_venue_cancellation_refund — the guest self-cancel path.
--    2 call sites qualified. This is the P1: without it the guest's cancel
--    request dies at the first statement, before the advisory lock, before
--    the reservation is touched, before any refund row exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_prepare_guest_venue_cancellation_refund(
  p_reservation_id uuid,p_guest_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_r public.reservations%ROWTYPE; v_s public.reservation_checkout_sessions%ROWTYPE;
DECLARE v_refund public.source_refunds%ROWTYPE; v_provider text; v_fee integer;
DECLARE v_cutoff integer; v_refundable boolean; v_eligible boolean;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT s.* INTO v_s FROM public.reservation_checkout_sessions s
  WHERE s.reservation_id=p_reservation_id
    AND s.guest_cancel_token_hash =
      'v1:'||encode(extensions.digest(COALESCE(p_guest_token,''),'sha256'),'hex')
  ORDER BY s.created_at DESC,s.id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('venue_reservation:'||v_s.id::text,0)
  );
  SELECT s.* INTO v_s FROM public.reservation_checkout_sessions s
  WHERE s.id=v_s.id
    AND s.guest_cancel_token_hash =
      'v1:'||encode(extensions.digest(COALESCE(p_guest_token,''),'sha256'),'hex')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  SELECT * INTO v_r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  SELECT sr.* INTO v_refund FROM public.source_refunds sr
  WHERE sr.source_type='venue_reservation' AND sr.source_id=v_s.id
    AND sr.refund_kind='venue_eligible_cancel';
  IF FOUND THEN
    RETURN jsonb_build_object('cancelled',true,'refund',public.issue_1221_source_refund_summary(v_refund));
  END IF;
  IF NOT public.pg_reservation_transition_is_legal(v_r.status,'cancelled_by_guest') THEN
    RAISE EXCEPTION 'cancel_not_allowed';
  END IF;
  SELECT cancel_cutoff_hours,fee_refundable INTO v_cutoff,v_refundable
  FROM public.venue_reservation_settings WHERE venue_id=v_r.venue_id;
  v_eligible:=v_r.payment_status='paid' AND COALESCE(v_refundable,false)
    AND public.pg_reservation_before_cancel_cutoff(v_r.reserved_for,COALESCE(v_cutoff,0));
  UPDATE public.reservations SET status='cancelled_by_guest',updated_at=now()
  WHERE id=v_r.id;
  IF NOT v_eligible THEN
    RETURN jsonb_build_object('cancelled',true,'refund',NULL);
  END IF;
  SELECT CASE WHEN b.payment_provider='paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id=v_s.brand_id;
  v_fee:=v_s.application_fee_amount_cents;
  INSERT INTO public.source_refunds(
    source_type,source_id,subject_id,brand_id,venue_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,
    buyer_refund_requested_cents,original_application_fee_cents,
    fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,
    provider_payment_reference,provider_account_reference,idempotency_key
  ) VALUES(
    'venue_reservation',v_s.id,v_r.id,v_s.brand_id,v_s.venue_id,
    'venue_eligible_cancel','guest','Eligible guest venue reservation cancellation',
    v_provider,upper(v_s.currency),v_s.amount_cents,v_s.amount_cents,v_fee,
    COALESCE(v_fee,0),
    CASE WHEN v_fee IS NULL THEN 'needs_attention' WHEN v_fee=0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN v_provider='stripe'
      THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    CASE WHEN v_fee IS NULL THEN 'needs_attention' ELSE 'pending' END,
    v_s.amount_cents-COALESCE(v_fee,0),COALESCE(v_fee,0),
    COALESCE(v_s.stripe_payment_intent_id,v_s.paystack_reference),
    v_s.stripe_account_id,'venue_eligible_cancel:'||v_s.id
  ) RETURNING * INTO v_refund;
  INSERT INTO public.source_refund_ledger_allocations(
    refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
  ) VALUES(v_refund.id,'buyer_refund',v_refund.buyer_refund_requested_cents,
    v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:buyer:'||v_refund.id);
  IF v_refund.organizer_refund_liability_cents>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(v_refund.id,'organizer_refund_liability',v_refund.organizer_refund_liability_cents,
      v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:organizer:'||v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents>0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key
    ) VALUES(v_refund.id,'platform_application_fee_reversal',v_refund.platform_fee_absorption_cents,
      v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:platform:'||v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(refund_id,event_key,event_type,to_state,actor_type,safe_reason_code)
  VALUES(v_refund.id,'requested:'||v_refund.id,'requested','queued','guest','eligible_venue_cancel');
  RETURN jsonb_build_object('cancelled',true,'refund',public.issue_1221_source_refund_summary(v_refund));
END $$;

-- ---------------------------------------------------------------------------
-- 3  anonymize_user_audit_log — GDPR erasure. 1 call site qualified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."anonymize_user_audit_log"(
  "p_user_id" uuid,
  "p_salt" text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hashed_user_id text;
  v_rows_affected integer;
  v_pii_pattern text := '(email|phone|first_name|last_name|dob|ssn_last_4|id_number_provided|address|verification|document)';
BEGIN
  -- 1. Compute deterministic hash
  v_hashed_user_id := encode(extensions.digest(p_salt || p_user_id::text, 'sha256'), 'hex');

  -- 2. Anonymize audit_log rows
  UPDATE public.audit_log
  SET
    -- user_id stays NULL after this UPDATE; the hash is stored in gdpr_erasure_log mapping
    user_id = NULL,
    -- ip_address: truncate to /24 (IPv4) or /48 (IPv6) if column exists; otherwise nullify
    ip = NULL,
    user_agent = NULL,
    -- before/after JSONB: recursively replace PII string values with [REDACTED-GDPR]
    -- Postgres JSONB doesn't have a built-in regex-key recursive replace; we use a
    -- pragmatic approach: any top-level or one-level-nested key matching the PII pattern
    -- is replaced. Deeper nesting requires programmatic recursion (deferred to caller).
    before = COALESCE(
      (
        SELECT jsonb_object_agg(
          key,
          CASE
            WHEN key ~* v_pii_pattern THEN to_jsonb('[REDACTED-GDPR]'::text)
            ELSE value
          END
        )
        FROM jsonb_each(before)
      ),
      before
    ),
    after = COALESCE(
      (
        SELECT jsonb_object_agg(
          key,
          CASE
            WHEN key ~* v_pii_pattern THEN to_jsonb('[REDACTED-GDPR]'::text)
            ELSE value
          END
        )
        FROM jsonb_each(after)
      ),
      after
    )
  WHERE user_id = p_user_id;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN v_rows_affected;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. CREATE OR REPLACE preserves an existing ACL, so these are a
-- re-assertion of the ORCH-1392 / issue-1221 contracts rather than a change:
-- all three stay service_role-only, unreachable from anon and authenticated.
-- Re-asserting keeps this migration correct even if it is ever replayed onto
-- a database where the function did not previously exist.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.pg_guest_venue_refund_summary(uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_guest_venue_refund_summary(uuid,text)
TO service_role;

REVOKE EXECUTE ON FUNCTION public.pg_prepare_guest_venue_cancellation_refund(uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_prepare_guest_venue_cancellation_refund(uuid,text)
TO service_role;

REVOKE EXECUTE ON FUNCTION public.anonymize_user_audit_log(p_user_id uuid, p_salt text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_audit_log(p_user_id uuid, p_salt text)
TO service_role;

-- ===========================================================================
-- THE CLASS GUARD — a live catalog probe, not a text scan.
--
-- Returns one row per (function, extensions-only routine) pair where a
-- function in `public` calls that routine WITHOUT the `extensions.` qualifier
-- while its own effective search_path does not guarantee `extensions`:
--
--   * `search_path` pinned and missing `extensions`  -> the #1828 bug exactly;
--   * no pinned `search_path` at all                 -> resolution is left to
--     whatever the caller happens to have, which is the same defect one step
--     removed. Production currently has ZERO of these, so enforcing it costs
--     nothing today and closes the next variant of the class.
--
-- The candidate routine set is DERIVED, never hard-coded: every routine that
-- lives in `extensions` and has NO same-named sibling in `pg_catalog` or
-- `public`. A same-named sibling means the unqualified call resolves anyway
-- (this is why `sign(` and `gen_random_uuid(` are correctly ignored -- both
-- exist in pg_catalog).
--
-- Reading pg_proc rather than migration text is the point:
--   * the LAST `CREATE OR REPLACE` wins, and this sees only that one;
--   * it covers functions created by ANY migration, including the baseline
--     squash and anything hot-patched straight onto the database;
--   * it cannot be fooled by a call spelled across a line break, built by
--     string concatenation of the schema name, or hidden in a migration the
--     scanner's glob missed.
--
-- Remediation is always the same and never harmful: qualify the call as
-- `extensions.<routine>(...)`.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.audit_unqualified_extension_calls()
RETURNS TABLE (
  function_signature  text,
  pinned_search_path  text,
  unqualified_routine text
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $issue_1828_probe$
  WITH ext_only AS (
    SELECT DISTINCT p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'extensions'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p2
        JOIN pg_catalog.pg_namespace n2 ON n2.oid = p2.pronamespace
        WHERE p2.proname = p.proname
          AND n2.nspname IN ('pg_catalog', 'public')
      )
  ),
  candidates AS (
    SELECT
      p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
        AS sig,
      p.prosrc AS body,
      (
        SELECT cfg
        FROM pg_catalog.unnest(COALESCE(p.proconfig, '{}'::text[])) AS cfg
        WHERE cfg LIKE 'search\_path=%'
        LIMIT 1
      ) AS sp
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
  )
  SELECT
    c.sig,
    COALESCE(c.sp, '(unpinned - inherits the caller''s search_path)'),
    e.proname
  FROM candidates c
  JOIN ext_only e
    ON c.body ~ ('(^|[^a-zA-Z0-9_.])' || e.proname || '[[:space:]]*\(')
  WHERE c.sp IS NULL
     OR c.sp !~ '[=,][[:space:]]*"?extensions"?[[:space:]]*($|,)'
  ORDER BY 1, 3;
$issue_1828_probe$;

REVOKE EXECUTE ON FUNCTION public.audit_unqualified_extension_calls()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_unqualified_extension_calls()
TO service_role;

COMMENT ON FUNCTION public.audit_unqualified_extension_calls() IS
  'Issue #1828 class guard. Lists every function in `public` that calls an '
  '`extensions`-only routine unqualified while its own search_path does not '
  'guarantee `extensions` (pinned without it, or unpinned). MUST return zero '
  'rows. Remediation: qualify the call as extensions.<routine>(...). '
  'Read-only; reads pg_proc/pg_namespace only.';

-- ===========================================================================
-- SELF-CHECK — this migration proves its own fix by CALLING the functions.
--
-- Not by reading their source: source text is identical before and after the
-- bug, which is exactly how this reached production behind green tests.
--
-- All three calls are non-mutating by construction: they are handed ids that
-- do not exist, so each dies on its `not found` branch or updates zero rows
-- AFTER the digest expression has already had to resolve.
-- ===========================================================================
DO $issue_1828_selfcheck$
DECLARE
  v_landing text;
  v_rows    integer;
  v_missing text;
BEGIN
  -- 1  pg_guest_venue_refund_summary has no caller gate, so it ALWAYS reaches
  --    the digest expression. The only acceptable landing is the not-found
  --    branch, which lives strictly after it. `v_landing` is captured rather
  --    than raised from inside the block so that this check's own failure
  --    cannot be swallowed by its own handler.
  v_landing := '<no error raised>';
  BEGIN
    PERFORM public.pg_guest_venue_refund_summary(
      '00000000-1828-4000-8000-000000000001'::uuid, 'issue-1828-selfcheck');
  EXCEPTION WHEN OTHERS THEN
    v_landing := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_landing <> 'P0001:reservation_not_found' THEN
    RAISE EXCEPTION
      'issue_1828_summary_digest_unresolved (expected P0001:reservation_not_found, got %)',
      v_landing;
  END IF;

  -- 2  pg_prepare_guest_venue_cancellation_refund gates on current_user FIRST.
  --    Migrations apply as `postgres`, so the expected landing is the
  --    not-found branch after the digest; `not_authorized` is tolerated so a
  --    replay under a different applying role cannot brick the apply. 42883 is
  --    never tolerated -- that is the bug itself.
  v_landing := '<no error raised>';
  BEGIN
    PERFORM public.pg_prepare_guest_venue_cancellation_refund(
      '00000000-1828-4000-8000-000000000002'::uuid, 'issue-1828-selfcheck');
  EXCEPTION WHEN OTHERS THEN
    v_landing := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_landing NOT IN ('P0001:reservation_not_found', 'P0001:not_authorized') THEN
    RAISE EXCEPTION
      'issue_1828_prepare_digest_unresolved (expected P0001:reservation_not_found, got %)',
      v_landing;
  END IF;

  -- 3  anonymize_user_audit_log hashes FIRST and only then updates. A user id
  --    that cannot exist means the UPDATE matches nothing, so returning a
  --    value at all is the proof that the hash resolved.
  v_rows := NULL;
  BEGIN
    SELECT public.anonymize_user_audit_log(
      '00000000-1828-4000-8000-000000000003'::uuid, 'issue-1828-selfcheck')
      INTO v_rows;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'issue_1828_anonymize_digest_unresolved (%: %)', SQLSTATE, SQLERRM;
  END;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'issue_1828_anonymize_touched_rows: %', v_rows;
  END IF;

  -- 4  The class sweep, reported as a WARNING rather than an EXCEPTION.
  --    CI is the hard gate (issue_1828_extension_call_qualification.test.sql
  --    RAISEs on any offender). Here a pre-existing, unrelated offender must
  --    not be able to abort the apply and leave guest cancellation broken --
  --    landing this fix always beats failing loudly about someone else's.
  SELECT string_agg(
           function_signature || ' -> ' || unqualified_routine ||
           ' [' || pinned_search_path || ']', E'\n  ' ORDER BY function_signature)
    INTO v_missing
  FROM public.audit_unqualified_extension_calls();

  IF v_missing IS NOT NULL THEN
    RAISE WARNING 'issue_1828_unqualified_extension_calls_remain:%',
      E'\n  ' || v_missing;
  END IF;
END $issue_1828_selfcheck$;
