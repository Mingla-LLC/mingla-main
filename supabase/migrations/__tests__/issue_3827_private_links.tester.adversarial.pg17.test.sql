-- issue #3827 — private links independent adversarial contract (pg17 post-replay).
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827a_assert(p_ok boolean,p_label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF NOT COALESCE(p_ok,false) THEN RAISE EXCEPTION 'issue #3827 links adversarial FAIL: %',p_label; END IF;
  RAISE NOTICE 'PASS  %',p_label;
END $$;

DO $acl$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.biz_ticket_link_create(uuid,uuid,uuid,uuid,text,integer,integer,text,timestamptz,uuid,bytea,text)',
    'public.biz_ticket_link_update(uuid,uuid,jsonb)',
    'public.biz_ticket_link_revoke(uuid,uuid)',
    'public.biz_ticket_link_reset(uuid,uuid,bytea,text)',
    'public.biz_ticket_link_list(uuid,uuid)',
    'public.pg_ticket_link_resolve(text)',
    'public.pg_ticket_link_signup(text,jsonb,uuid,uuid,text,text)',
    'public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)'
  ] LOOP
    PERFORM pg_temp.i3827a_assert(
      NOT has_function_privilege('anon',v_sig,'EXECUTE')
      AND NOT has_function_privilege('authenticated',v_sig,'EXECUTE')
      AND has_function_privilege('service_role',v_sig,'EXECUTE'),
      'service-role-only function: '||v_sig);
  END LOOP;
END $acl$;

DO $shape$
BEGIN
  PERFORM pg_temp.i3827a_assert(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ticket_type_links_token_hash_check')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ticket_link_signups_link_id_client_request_id_key')
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='ticket_link_members_pending_email_uidx'),
    'token format, idempotency and pending-email uniqueness are constrained');
  PERFORM pg_temp.i3827a_assert(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('ticket_type_links','ticket_link_signups')
        AND column_name IN ('token','raw_token','client_ip','ip_address')),
    'raw bearer tokens and IP addresses have no persistence column');
  PERFORM pg_temp.i3827a_assert(
    pg_get_functiondef('public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure)
      LIKE '%COALESCE(tt.is_hidden, false) = false%'
    AND pg_get_functiondef('public.pg_public_event_by_slug(text,text)'::regprocedure)
      LIKE '%COALESCE(tt.is_hidden, false) = false%',
    'direct and public event readers strip hidden tiers server-side');
  -- [TEST-MOD-APPROVED #3872] R1 adds code and quote-digest inputs to checkout.
  PERFORM pg_temp.i3827a_assert(
    pg_get_functiondef('public.issue_3872_ticket_line_price(uuid,uuid,integer,jsonb,timestamptz,integer)'::regprocedure)
      LIKE '%issue_3827_link_unlocks_tier%',
    'checkout line owner admits a hidden tier only through the transaction-local link guard');
END $shape$;

ROLLBACK;
