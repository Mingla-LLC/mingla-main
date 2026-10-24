-- #3281 Round 2 (toward #3281): checkout stays server-only after signature
-- re-emits. PostgreSQL 17 replay target, run by the #1929 hidden-direct-checkout
-- lane right before its anonymous SECURITY DEFINER allowlist step.
--
-- 20271121003281 dropped and recreated the two checkout session functions with a
-- new signature (which resets their ACL to the database default) and granted the
-- booking quote to anon. 20271122003281 restored the earlier posture: postgres
-- and service_role only, as 20271109003281 set for the 13-argument signatures.
-- [TEST-MOD-APPROVED #3872] R1 adds code and quote-digest inputs to checkout.
-- This file pins that posture per signature so a removed REVOKE fails here by
-- name, not only as an anonymous-allowlist diff. Read-only: no rows are written.
\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_sig text;
  v_role text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.pg_experience_booking_quote(uuid,uuid,integer,integer)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'issue_3281_r2_grants: % is missing after replay', v_sig;
    END IF;

    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)) THEN
      RAISE EXCEPTION 'issue_3281_r2_grants: % is no longer SECURITY DEFINER; re-check this pin', v_sig;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, to_regprocedure(v_sig), 'EXECUTE') THEN
        RAISE EXCEPTION 'issue_3281_r2_grants: % can EXECUTE %', v_role, v_sig;
      END IF;
    END LOOP;

    IF NOT has_function_privilege('service_role', to_regprocedure(v_sig), 'EXECUTE') THEN
      RAISE EXCEPTION 'issue_3281_r2_grants: service_role cannot EXECUTE % (ticket-checkout-create needs it)', v_sig;
    END IF;
  END LOOP;

  -- Retired overloads cannot remain reachable beside the current one.
  IF to_regprocedure('public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz)') IS NOT NULL
     OR to_regprocedure('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3281_r2_grants: a 13-argument checkout session overload still exists';
  END IF;

  IF to_regprocedure('public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL
     OR to_regprocedure('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3281_r2_grants: a 15-argument checkout session overload still exists';
  END IF;

  RAISE NOTICE 'issue_3281_r2_grants: OK (3 signatures server-only)';
END
$test$;
