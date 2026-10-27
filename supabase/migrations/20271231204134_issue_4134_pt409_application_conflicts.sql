-- Issue #4134 — no database function may answer an ordinary application
-- conflict with SQLSTATE 40001 (serialization_failure) any more.
--
-- PostgREST 14 retries SQLSTATE 40001 inside the server with no limit. Every
-- function below raises 40001 for a conflict that cannot heal by itself (a
-- stale revision, a stale cursor, an expired lease, a request still marked in
-- flight, a fault turned into "try again"), so one stale call loops forever and
-- pins database CPU. That happened on 2026-10-22..26 through
-- biz_apply_trip_draft_graph. #4064 (20271213004064) fixed the same class for
-- ops_card_lock and business_update_rsvp_graph; this migration finishes the job
-- for every remaining function in the application schemas.
--
-- What changes, and nothing else:
--   1. Every RAISE site that sets ERRCODE '40001' / 'serialization_failure',
--      or raises SQLSTATE '40001' / serialization_failure directly, now uses
--      PT409. PostgREST answers PT409 once, as HTTP 409. Every message, hint,
--      detail and code path is unchanged; the clients read the message.
--   2. Every EXCEPTION handler that caught serialization_failure / SQLSTATE
--      '40001' keeps that condition and ALSO catches SQLSTATE 'PT409'. Without
--      this, a conflict that used to be re-raised or classed as "busy" would
--      fall into the next WHEN OTHERS arm and change behaviour (for example
--      biz_guest_roster_list would turn a stale cursor into
--      guest_roster_filter_invalid, and get_brand_circle_reach would swallow it
--      into an "unavailable" answer). A genuine serialization failure is still
--      caught exactly as before.
--
-- No function is excluded: none uses 40001 as a transient signal that a blind
-- server-side retry could clear. The "try_again" messages ask the CALLER to
-- send the request again, which still happens, once, from the client.
--
-- The file is static SQL, with no EXECUTE, so every statement can be read by
-- the migration gates (#1860 rule C7). It works in four steps:
--   A. snapshot each of the 77 target functions (oid, owner, grants, SECURITY
--      DEFINER, settings, volatility, strictness, leakproof, return and
--      argument types, comment, and the md5 of its definition);
--   B. CREATE OR REPLACE each one with its new definition. CREATE OR REPLACE
--      keeps the oid, owner, grants and comment;
--   C. check, before COMMIT, that each function was exactly the definition this
--      file was generated from (or already its new one, so a second run is a
--      no-op), that it ended exactly as generated, that nothing but its body
--      changed, and that no function outside the system schemas still raises
--      40001 or catches it without PT409. Any failure raises, and the whole
--      transaction rolls back.
--
BEGIN;

SET LOCAL lock_timeout = '5s';
-- Every definition below is fully schema-qualified, and every md5 is taken
-- under this search_path, so neither depends on the caller's session.
SET LOCAL search_path TO pg_catalog, pg_temp;

-- A. The targets, with the md5 of pg_get_functiondef() before this migration
--    (identical on a full replay of the chain and on production, compared
--    2026-10-26) and after it.
CREATE TEMP TABLE issue_4134_target (
  signature text PRIMARY KEY,
  pre_md5 text NOT NULL,
  post_md5 text NOT NULL
) ON COMMIT DROP;

INSERT INTO issue_4134_target (signature, pre_md5, post_md5) VALUES
  ('private.enqueue_wizard_invites_on_publish_v1(uuid,bigint,boolean)',
   '201262dd253ecfdfffa2efcee02a8cf5', 'a6082396957b333f9f02dd00b1eb0b96'),
  ('private.execute_brand_offering_invite_wizard_v1(uuid,uuid)',
   'bd35a6f5bd1a8b85c9ecb52ad4eae446', '74c4e7e47be36d031707021b2eb7aad1'),
  ('public.biz_apply_trip_draft_graph(uuid,jsonb,timestamp with time zone,uuid)',
   'e1963f182bb2ad8a64078357b13989dc', 'd1ed5bf5bd52f6cb68c31933e7e9fb10'),
  ('public.biz_execute_guest_roster_send_group(uuid,uuid,text,jsonb,text[],uuid,jsonb)',
   '22201c511f0310d561f1a8e1b67b1a85', '20a844c6c82084a753ee90a0cd53facf'),
  ('public.biz_execute_offering_delivery_retry(uuid,uuid,uuid[],text[],uuid,jsonb)',
   '8d75e8d0240eaa678cb2c2faf69a9e43', '91d2ec4f6b9973f80d08c937b23e1247'),
  ('public.biz_guest_roster_get_preview(uuid,uuid,uuid)',
   '4c104bbb3ccc31059cb4a345da00c844', '3948c07b30e040132778e4fd92e05b63'),
  ('public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer)',
   '1f4061f9bce210450ef1b6a7f042d9dc', 'e8ec840972efd28600b0a1c12e0c0a01'),
  ('public.biz_guest_roster_resolve_action(uuid,uuid,text,text[],text[])',
   '3664d32f81072df585aeca0c88b29a68', '9fac658f9d19bda8d8847fb84e47ffea'),
  ('public.biz_guest_roster_set_rsvp_approval(uuid,text,text,uuid)',
   'b94167028bf5afcde508a883fa6cc6ef', '57e7eef463716e1b15e80fa34446d166'),
  ('public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)',
   'f1c619684570e1b342f80241b1869f36', 'a5188c3bfe7eeee016e45dc6d4366340'),
  ('public.biz_merge_brand_people_manual(uuid,uuid,uuid,text,text,uuid)',
   '0d00f50a3252462c124b1d1c296ce50b', 'd05a430aa363d4f3350d56a22593fe59'),
  ('public.biz_promote_brand_person_contact(uuid,uuid,uuid,text,uuid)',
   '19fee2ad5974473f22fc263a075e585f', 'f7fb6d075a45fc787c95e2eb234612aa'),
  ('public.biz_publish_stay(uuid,bigint,uuid)',
   '4dc2149401c8b3e3f9f6bd33fff0d08e', '7190fb7271ee3373bc89ce2b490e6ab5'),
  ('public.biz_publish_trip_command(uuid,timestamp with time zone,uuid,bigint,boolean)',
   '8753a915f268800f820e877b74272a7c', '239125305c296a5b732f5813c064eaea'),
  ('public.biz_reorder_menu_items_v1(uuid,uuid,uuid,jsonb,uuid[])',
   '8bb00480944ec97b7912cad6068ce518', 'c5c62940e0a4ba490e2e737a46061a7a'),
  ('public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid)',
   '0964aabc6c03a2c30661dd4919175957', '707b01e6b6b5b0007698204c4d553ac3'),
  ('public.biz_save_menu_modifier_group_v1(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb)',
   '6d04313e3d18a1ef541f784046ea028d', '6773b56b854524b38a0340fcb0451b98'),
  ('public.biz_save_stay_settings_v2(uuid,jsonb,bigint,uuid)',
   '2d396120c777014f4c3cbd46d96ae48a', '0744c02f27c919157b5b0513e1c4b64f'),
  ('public.biz_soft_delete_trip(uuid,timestamp with time zone,uuid)',
   'd8680ccba74cf0468bc7ab57405014bf', 'e91029259dad4ac18de242a76eeb363a'),
  ('public.biz_update_trip_live_command(uuid,jsonb,text,timestamp with time zone,uuid)',
   '348491b05012360860c61e15dbd3e6ae', '9a64f9b24019077df36f92c430fedd99'),
  ('public.business_list_rsvp_roster(uuid,text,jsonb,integer)',
   'e5067da02ef34f235751031381390e6b', '7422db49801de87b2b376c91dc9cc64a'),
  ('public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid)',
   '0799ce523c2fd3a8038197c02057f4b6', 'b75d41ca68a54e839cf911d2924c75f0'),
  ('public.claim_agent_first_turn(uuid,uuid,jsonb,text,text)',
   '5265d9857603261e9b3b538fa7b400e2', '5467b83d978afdf1aa54c6b65064c55f'),
  ('public.community_reorder_roadmap(uuid[])',
   '7779d1f1f9f5622768fccd9dca288c47', 'ac6aefc2e3e1a39aba5ffba75cb0bf0c'),
  ('public.content_calendar_assign(uuid,text[],bigint,text)',
   '44416abfe94f69c1334ca7f05bf90278', '10be21408b1ebdc17fec90981a7c22d0'),
  ('public.content_calendar_delete(uuid,bigint)',
   'e85a71dbc324d15ab221e21aac1213eb', '80c8d90aa62f414e926e76a15ff73340'),
  ('public.content_calendar_move(uuid,text,bigint,boolean,boolean,boolean,text)',
   'e07d53b78d242d027681409bb03c2083', '1daa720df2686c9ff29f886d7ac148f1'),
  ('public.content_calendar_request_begin(text,text,text,jsonb)',
   '40aa1dadd95a89c6c386225a9ad195ba', '6ea3d5a183cdf0887c145bf1a4f63690'),
  ('public.content_calendar_request_finish(text,text,text,jsonb)',
   'cfd83bbfb4451c272b55b3b41f184db1', '0c164d1bc34a15089db9d3d129b921c8'),
  ('public.content_calendar_undo(uuid,bigint)',
   '6f36ca02ec9d31e8a87225cbf896f876', 'ea5fd2990a816767baab8dcbb5ccd2ae'),
  ('public.content_calendar_update(uuid,jsonb,bigint,text)',
   '8eca085c69d5fea88776902793489b01', 'a6c5b4fe0ac04ea94011e9f43992a342'),
  ('public.crm_beta_lead_to_host(uuid)',
   'f830384948258d3b8d4f76eb26cdb06b', 'ca8ce63c170fae9a79bc1ab0dd936b34'),
  ('public.crm_record_create_core(text,jsonb,text,text)',
   'b9e2e9fa2eca88c84594b0a05052f10c', 'a526629e50397c730f809006ba5cd835'),
  ('public.crm_records_bulk_create(text,jsonb,text)',
   '3b16474aac855e0fb7a052307c836629', '0c7fafeb11da52922ffc10866b785a90'),
  ('public.get_brand_circle_reach(uuid,text,jsonb,integer)',
   'e6f89cc58e1d8a75defabd3053807f14', 'da2bf2723bfd106645668f3059cfe1ea'),
  ('public.issue_1384_admin_update_place_and_discovery_range(uuid,text,text,text[],boolean,text[],bigint,bigint,bigint,text,uuid)',
   '09e28cd99b409622cf43a0d2cb67e222', '656e1f1b7191e944130ad9d88b1831ba'),
  ('public.issue_1384_resolve_reconciliation(uuid,uuid,text,uuid,jsonb,uuid)',
   'b590de95e9be022359f79d33bc9d14cd', '7d4b6ad04784e9e94785b6cddd886b36'),
  ('public.issue_1384_save_discovery_price_range(uuid,uuid,uuid,bigint,bigint,character,bigint,text,uuid)',
   'd156ab2db4ee5d27bffbf8692f46f99f', '715665eb87809bf9404c891bf566b942'),
  ('public.issue_1384_set_provisional_currency(uuid,character,bigint)',
   'c09444f3b1a50fb078043705f6dd5fb0', '157adf0b568904e295b082cd13be11b7'),
  ('public.issue_1387_resolve_currency_reconciliation(uuid,uuid,text,uuid,jsonb,jsonb,uuid)',
   '9b7bad19fb60db39328182a68e439fb9', '18cd5163f3fcf0bb5e4bfc7392d3102e'),
  ('public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)',
   'eec5f6a9750eb113d3c75c027455a704', '284a54566e53f692dccdd48acff12b38'),
  ('public.issue_1388_guard_state_transition()',
   'eaaba94868e96699dd11c796aebce6ef', 'eec3a57de661b16aedd87d25c7c03d22'),
  ('public.issue_1388_manage_request(text,uuid,bigint,text,uuid)',
   '57c76b3d1be85ec273ded1fc715d29f7', 'a11ad9152fa59b7f2d3d783a9ba911bf'),
  ('public.issue_1388_quote_stay_cart(uuid,jsonb,text,uuid)',
   '494c73fe39317f5a1f5576d475224615', '2fb6bc0a84c1b417eae1dfa6305067b4'),
  ('public.issue_1389_bind_payment_attempt(uuid,text,text,uuid)',
   '77c58ba6fa613fc77bb172182809ab17', '19dcf67d23c9cab0e71ba301a2bc4801'),
  ('public.issue_1389_cancel(uuid,text,text,text,uuid)',
   'ba0b91370db6dbfcf51725fa225d5c5e', '2a55a957bc5959ba1ef091b98d6343a7'),
  ('public.issue_1389_cancel_preview(uuid,uuid[],bigint,uuid)',
   'a3431bdd0256a83cedaf28749ce4b43f', '584b7d1f9215dcd136bb77f629f9b9ff'),
  ('public.issue_1389_prepare_payment(uuid,text,bigint,uuid)',
   '6ed901abac877b199c29224be732f0d9', '2ecb2b18c23cd9a07a9fdc279dec89e4'),
  ('public.issue_1389_record_stay_dispute(text,text,text,text,integer,text,text)',
   '42b0855cfb2f72ad42203b01f3c3303f', 'a848c49d00384986717823e4af59e8b4'),
  ('public.issue_1427_admin_pause_stay_offering(uuid,bigint,text)',
   'c651a4bb61212407a63f10d640c09b2b', '90f8a424ccac9d8fed6a08d945249123'),
  ('public.issue_1780_complete_wizard_invite_health_alert_v1(text,uuid)',
   '1729fc99df355b77ca3a9c040c639261', '75e380e3d88cfe37b93d94b8312f096e'),
  ('public.issue_1780_complete_wizard_invite_observability_v1(bigint,uuid)',
   '5e6c063b4c82c1be4065ccf40f5b7360', '0509e3ed44ccd24114e1f1e87c0702f6'),
  ('public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(uuid,uuid,uuid)',
   'fcd690556971eb357d9362a0458d42dd', 'c7890c850e823f925d6a0b42322b2685'),
  ('public.issue_1780_complete_wizard_invite_outbox_v1(uuid,uuid,uuid)',
   'e17a931c6a5ed167e118dc9d7919ca00', 'b47c31f72391b4894f86b6e8c1ddadc8'),
  ('public.issue_1780_execute_wizard_invite_outbox_v1(uuid,uuid,uuid)',
   'ef2e34f53621a69aa15e5ee23fe56d9e', '7790a7668d8fbb65bc91a3396c29c2a8'),
  ('public.issue_1780_fail_wizard_invite_outbox_v1(uuid,uuid,text,boolean)',
   '4882e5676458a52114729877e3da74a9', '74967aba78d9321f90f1c86a72f5db10'),
  ('public.issue_1780_seal_wizard_invite_execution_v1(uuid,uuid,uuid,jsonb)',
   '0eb09de84f7856e04b32cdf4a4ab57f5', 'ff34fd51b39faf4b2c01038d7890bd4f'),
  ('public.issue_1975_reservation_transition(uuid,text,bigint,uuid,text)',
   '79f778d24cb7f15ea0e0657d8519837f', 'c574697d6e3fa672a18a6c6f0412da74'),
  ('public.issue_3720_link_brand_message_product_signal(uuid,integer,uuid)',
   'cda8f70a65ceb84064f64387f79d66c7', '3822eb1373d7dcec435615867936f19b'),
  ('public.issue_3720_link_product_signal_source(uuid,integer,text,uuid)',
   '96ed88a4c5501bd9e75901adb428073e', '739547d5acc46d97ad6ff30ff580aceb'),
  ('public.issue_3720_record_feature_evidence(uuid,integer,text,text,text,text,timestamp with time zone,timestamp with time zone)',
   '95ffd7cf92790754db2352d506476d1d', '461876d39e824798533292ce242a4dfa'),
  ('public.issue_3720_save_feature_capability(text,integer,text,text,text[],text[],text,text,text,text,text[],timestamp with time zone)',
   'f47554125957f96012d4f116dbe2b53e', 'e9ce8767a26d72d08c7e1c60b331f45a'),
  ('public.issue_3720_save_product_avengers_review(uuid,integer,text,text,text,text[],text,text,text,text,text,text)',
   'f019c29d6c00fa1d12cbf78344d0468e', '77c7b8d895b2d867bb5e11a73cfae458'),
  ('public.issue_3720_set_next_update(text,uuid,integer,timestamp with time zone,text)',
   'f4e7ac04278cd3acb6ad89b5573ec885', 'bd9cb63bc8c706741381bf16cb7d04ba'),
  ('public.issue_3720_update_internal_thread(uuid,integer,text,text)',
   '1e47e968d3d9acca60a0720e64883c7c', '0bafcf624c867d85af9299e5364a11f2'),
  ('public.issue_3720_update_product_signal(uuid,integer,text,text,timestamp with time zone,text,text)',
   'cde3bbf6d0342fab9c67380a7409d828', '52709e6afac69e8456bfa0f693ffc418'),
  ('public.issue_3988_reassign_internal_thread(uuid,integer,uuid)',
   'd2025e593c7b0cb1b7f70e29c92a2963', '85f331f32efd6bd2b2be1578cbd53526'),
  ('public.issue_3988_reassign_product_signal(uuid,integer,uuid)',
   'aa47bb828ef53b150df4129e53c78721', '98264e64d0d60b1d667e2de873b7a9d4'),
  ('public.ops_brand_autolink()',
   '9a263eadad7f821e5f8fe9bfad0c8893', 'a996ff67e216a2a07de42eb381feca19'),
  ('public.ops_brand_cards_confirm(uuid[],text)',
   'fb0492dab7c83af635f120af0447302b', '2e83381ba1eb2e994df3c30fc64e56b0'),
  ('public.ops_request_begin(text,text,text,jsonb)',
   '7d72890478d6904da4dfab3a027b4e97', '00b73ce547590dea719baf5311aa2579'),
  ('public.ops_request_finish(text,text,text,jsonb)',
   '8bdc6d738ddb93c702c041dbdc73be1d', 'db89a0ab1dc7344b34c368c87359a105'),
  ('public.ops_work_add(jsonb,text)',
   '1ede97a001d75ce48273988be491a75a', 'ed86c92a1a97b207826c5bedb4c346cb'),
  ('public.ops_work_update(uuid,jsonb,bigint,text)',
   'cb7aa9891b560aa7f44fa1c62076b068', '46885003fae359a510997183733289f8'),
  ('public.team_agent_call(text,text,jsonb,text)',
   '336b45d8e68dc9b90902528896ba46f3', '8c047d6fcc37f403fa4d3b62263f186a'),
  ('public.team_draft_save(jsonb,text)',
   'bbc18a1ff3055f10d56163520367af18', '315ef265f01254134bbbc3fc846ef0e1'),
  ('public.team_draft_unsend(uuid)',
   '0f1e4fd979f0cfc6be99a13188604327', 'bde98c4683f12e31df547ebd38de5a6b');

CREATE TEMP TABLE issue_4134_before ON COMMIT DROP AS
SELECT t.signature,
       p.oid,
       p.proowner,
       p.proacl::text AS acl,
       p.prosecdef,
       p.proconfig,
       p.provolatile,
       p.proleakproof,
       p.proisstrict,
       p.prorettype,
       p.proargtypes::text AS argtypes,
       obj_description(p.oid, 'pg_proc') AS comment,
       md5(pg_get_functiondef(p.oid)) AS md5_before
  FROM issue_4134_target AS t
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(t.signature);

-- B. MACHINE-GENERATED — do not edit by hand. These 77 definitions are the
--    output of pg_get_functiondef() (search_path pg_catalog) after the
--    original regexp rewrite of this migration ran on a full PG17 replay of the
--    chain (supabase/postgres:17.4.1.075). Before that rewrite, the md5 of
--    every one of the 77 matched production's exactly. The only differences
--    from each function's previous definition are 40001 / serialization_failure
--    -> PT409 at RAISE sites and "OR SQLSTATE 'PT409'" added to the four
--    handlers. Ordered by signature.

CREATE OR REPLACE FUNCTION private.enqueue_wizard_invites_on_publish_v1(p_event_id uuid, p_expected_revision bigint, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_selection_id uuid; v_outbox_id uuid; v_outbox_state text;
  v_selected_count integer; v_ids uuid[];
BEGIN
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans
    WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',false,'selectedCount',0,'status','not_requested'));
  END IF;
  SELECT COALESCE(array_agg(m.brand_person_id ORDER BY m.brand_person_id),'{}'::uuid[])
    INTO v_ids
  FROM private.brand_offering_invite_plan_members m
  WHERE m.plan_id=v_plan.id;
  v_selected_count:=cardinality(v_ids);
  IF v_plan.state='locked' THEN
    SELECT o.id,o.state INTO v_outbox_id,v_outbox_state
    FROM private.brand_offering_invite_selections s
    LEFT JOIN private.brand_offering_invite_outbox o ON o.plan_id=v_plan.id
      AND o.selection_revision=s.selection_revision
    WHERE s.event_id=p_event_id AND s.selection_revision=v_plan.published_selection_revision;
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',v_selected_count>0,
      'selectedCount',v_selected_count,
      'selectionRevision',v_plan.published_selection_revision,
      'outboxJobId',v_outbox_id,'status',COALESCE(v_outbox_state,'empty')));
  END IF;
  IF v_selected_count=0 THEN
    UPDATE private.brand_offering_invite_plans SET
      state='locked',published_selection_revision=selection_revision,locked_at=now(),updated_at=now()
    WHERE event_id=p_event_id;
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',false,'selectedCount',0,'selectionRevision',v_plan.selection_revision,'status','empty'));
  END IF;
  IF NOT COALESCE(p_confirmed,false) OR p_expected_revision IS NULL
     OR p_expected_revision<>v_plan.selection_revision THEN
    RAISE EXCEPTION 'wizard_invite_publish_confirmation_required' USING ERRCODE='PT409';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) pid
    LEFT JOIN public.brand_people bp ON bp.id=pid AND bp.brand_id=v_plan.brand_id AND bp.record_status='active'
    WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE='PT409';
  END IF;
  INSERT INTO private.brand_offering_invite_selections(
    event_id,brand_id,event_type,selection_revision,brand_person_ids,selection_hash,actor_id)
  VALUES(p_event_id,v_plan.brand_id,v_plan.event_type,v_plan.selection_revision,
    v_ids,v_plan.selection_hash,v_plan.updated_by)
  ON CONFLICT(event_id,selection_revision) DO UPDATE SET event_id=EXCLUDED.event_id
  RETURNING id INTO v_selection_id;
  INSERT INTO private.brand_offering_invite_outbox(
    plan_id,brand_id,event_id,event_type,selection_revision,operation_key,sealed_selection_id)
  VALUES(v_plan.id,v_plan.brand_id,p_event_id,v_plan.event_type,v_plan.selection_revision,
    'wizard:v1:'||v_plan.event_type||':'||p_event_id::text||':'||v_plan.selection_revision::text,
    v_selection_id)
  ON CONFLICT(event_id,selection_revision) DO UPDATE
    SET operation_key=EXCLUDED.operation_key
  RETURNING id,state INTO v_outbox_id,v_outbox_state;
  INSERT INTO private.brand_offering_invite_observability_events(
    event_name,outbox_job_id,offering_kind,selection_revision,selected_count,job_state)
  VALUES('wizard_invite_outbox_enqueued',v_outbox_id,v_plan.event_type,
    v_plan.selection_revision,v_selected_count,v_outbox_state)
  ON CONFLICT(outbox_job_id) DO NOTHING;
  UPDATE private.brand_offering_invite_plans SET
    state='locked',published_selection_revision=selection_revision,locked_at=now(),updated_at=now()
  WHERE event_id=p_event_id;
  RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
    'planned',true,'selectedCount',v_selected_count,
    'selectionRevision',v_plan.selection_revision,'outboxJobId',v_outbox_id,'status',v_outbox_state));
END;
$function$
;
CREATE OR REPLACE FUNCTION private.execute_brand_offering_invite_wizard_v1(p_outbox_job_id uuid, p_sealed_selection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_selection private.brand_offering_invite_selections%ROWTYPE;
  v_seal private.brand_offering_invite_execution_seals%ROWTYPE;
  v_selection_json jsonb; v_channels text[]; v_result jsonb;
BEGIN
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
    WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id FOR UPDATE;
  IF NOT FOUND OR v_job.state<>'leased' OR v_job.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO v_selection FROM private.brand_offering_invite_selections
    WHERE id=p_sealed_selection_id AND event_id=v_job.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_seal_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_seal FROM private.brand_offering_invite_execution_seals
    WHERE outbox_job_id=v_job.id AND sealed_selection_id=v_selection.id;
  IF NOT FOUND OR v_seal.queued_count<=0 THEN
    RAISE EXCEPTION 'wizard_invite_execution_seal_invalid' USING ERRCODE='22023';
  END IF;
  v_selection_json:=jsonb_build_object('kind','resolved_brand_people_v1','source','guest_roster_actions',
    'brandPersonIds',to_jsonb(v_selection.brand_person_ids),'selectionHash',v_selection.selection_hash);
  PERFORM set_config('mingla.issue_1780_outbox_job_id',v_job.id::text,true);
  PERFORM set_config('mingla.issue_1780_outbox_lease_token',v_job.lease_token::text,true);
  SELECT array_agg(value ORDER BY ord) INTO v_channels
    FROM jsonb_array_elements_text(v_seal.execution_snapshot->'channels') WITH ORDINALITY q(value,ord);
  v_result:=public.biz_execute_offering_send_group(
    v_selection.actor_id,v_selection.event_id,'invitation',v_selection_json,v_channels,
    v_job.id,v_seal.execution_snapshot);
  -- Keep the durable job leased after database execution. Provider handoff is
  -- post-commit; only the completion RPC below may mark the job succeeded.
  RETURN v_result||jsonb_build_object('channels',to_jsonb(v_channels));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph(p_event_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_item jsonb;
  v_ticket_type uuid;
  v_currency char(3);
  v_theme jsonb;
  v_business_trip jsonb;
  v_known text[] := ARRAY['event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings'];
  -- issue #3801
  v_dates_touched boolean;
  v_trip_start timestamptz;
  v_trip_end timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip';
  END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'apply_trip_draft_graph', v_event.brand_id, p_event_id,
    jsonb_build_object('patch', p_patch, 'expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'trip_not_draft'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'trip_patch_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k
     WHERE NOT (k = ANY (v_known))
  ) THEN
    RAISE EXCEPTION 'trip_patch_key_not_allowed' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------ basics --
  IF p_patch ? 'event' THEN
    IF jsonb_typeof(p_patch->'event') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'event') key
       WHERE key <> ALL (ARRAY[
         'title', 'description', 'timezone', 'destination_text', 'departure_text',
         'cover_media_url', 'cover_media_poster_url', 'cover_media_type',
         'cover_media_gallery', 'business_trip'])
    ) THEN
      RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
    END IF;

    -- `events.destination_text` / `events.departure_text` are the canonical
    -- columns (ORCH-0950-expanded, ORCH-1016, I-PROPOSED-TRIP-CANONICAL-COLUMNS)
    -- and publish reads them. The theme keys are the authoring input and the
    -- wire format the existing publish/live owners consume. Both are written in
    -- the one statement below, DERIVED FROM THE SAME merged object, so the two
    -- cannot drift and neither input shape can produce a half-written trip.
    v_theme := COALESCE(v_event.theme, '{}'::jsonb);
    v_business_trip := COALESCE(v_theme->'business_trip', '{}'::jsonb);
    IF (p_patch->'event') ? 'business_trip' THEN
      IF jsonb_typeof(p_patch#>'{event,business_trip}') <> 'object' THEN
        RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
      END IF;
      v_business_trip := v_business_trip || (p_patch#>'{event,business_trip}');
    END IF;
    IF (p_patch->'event') ? 'destination_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('destinationLocationText', p_patch#>'{event,destination_text}');
    END IF;
    IF (p_patch->'event') ? 'departure_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('departureLocationText', p_patch#>'{event,departure_text}');
    END IF;
    v_theme := jsonb_set(v_theme, '{business_trip}', v_business_trip, true);

    UPDATE public.events SET
      title = CASE WHEN (p_patch->'event') ? 'title'
                THEN COALESCE(NULLIF(btrim(p_patch#>>'{event,title}'), ''), title) ELSE title END,
      description = CASE WHEN (p_patch->'event') ? 'description'
                THEN NULLIF(p_patch#>>'{event,description}', '') ELSE description END,
      timezone = CASE WHEN (p_patch->'event') ? 'timezone'
                THEN COALESCE(NULLIF(p_patch#>>'{event,timezone}', ''), 'UTC') ELSE timezone END,
      -- Derived from the MERGED business_trip, not from the raw patch key, so a
      -- destinationLocationText nested under `event.business_trip` populates
      -- the canonical column exactly as `event.destination_text` does. This
      -- also heals a legacy row whose theme and column disagree, on the next
      -- patch.
      destination_text = CASE WHEN v_business_trip ? 'destinationLocationText'
                THEN NULLIF(btrim(v_business_trip->>'destinationLocationText'), '') ELSE destination_text END,
      departure_text = CASE WHEN v_business_trip ? 'departureLocationText'
                THEN NULLIF(btrim(v_business_trip->>'departureLocationText'), '') ELSE departure_text END,
      cover_media_url = CASE WHEN (p_patch->'event') ? 'cover_media_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_url}', '') ELSE cover_media_url END,
      cover_media_poster_url = CASE WHEN (p_patch->'event') ? 'cover_media_poster_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_poster_url}', '') ELSE cover_media_poster_url END,
      cover_media_type = CASE WHEN (p_patch->'event') ? 'cover_media_type'
                THEN NULLIF(p_patch#>>'{event,cover_media_type}', '') ELSE cover_media_type END,
      cover_media_gallery = CASE WHEN (p_patch->'event') ? 'cover_media_gallery'
                THEN p_patch#>'{event,cover_media_gallery}' ELSE cover_media_gallery END,
      theme = v_theme,
      updated_at = now()
     WHERE id = p_event_id;

    -- issue #3801 — ONE OWNER FOR DRAFT TRIP DATES: the master event_dates row.
    --
    -- The wizard authors the dates as startAt / endAt inside
    -- `event.business_trip`, and never sends an `event_dates` group. Before
    -- this block the dates therefore reached the theme only, while publish and
    -- every reader (the wizard reload, the Hub list) read the master
    -- event_dates row — which did not exist. Publish refused every trip with
    -- `trip_dates_required` and the wizard reopened with blank dates.
    --
    -- The master row is now derived here, from the SAME merged object the theme
    -- write above just used and in the same transaction, so the two cannot
    -- drift:
    --   * dates touched by this patch and complete (both set, end after start)
    --       -> the master row is replaced with them;
    --   * dates touched and now cleared, half-set or out of order
    --       -> the master row is removed, so no stale row can outvote the
    --          theme at publish (the publish owner then names the real fault);
    --   * dates NOT touched, the theme holds a complete pair, and there is no
    --     master row -> the row is created. This heals a draft saved before
    --     this migration on its next basics save;
    --   * dates NOT touched and a master row exists -> left exactly as it is
    --     (it may have been written through the explicit `event_dates` group).
    -- An explicit `event_dates` group in the same patch keeps its existing
    -- behaviour and wins: this block stands aside and the group below runs.
    IF NOT (p_patch ? 'event_dates') THEN
      v_dates_touched := COALESCE(
        (p_patch#>'{event,business_trip}') ? 'startAt'
        OR (p_patch#>'{event,business_trip}') ? 'endAt', false);
      v_trip_start := NULL;
      v_trip_end := NULL;
      BEGIN
        v_trip_start := NULLIF(btrim(v_business_trip->>'startAt'), '')::timestamptz;
        v_trip_end := NULLIF(btrim(v_business_trip->>'endAt'), '')::timestamptz;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow
             OR invalid_parameter_value OR invalid_text_representation THEN
          -- A date this patch just wrote that is not a date is refused, with
          -- the code the `event_dates` group already uses. Unreadable text
          -- already sitting in an old draft is not this patch's fault and
          -- must not block an unrelated save.
          IF v_dates_touched THEN
            RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
          END IF;
          v_trip_start := NULL;
          v_trip_end := NULL;
      END;

      IF v_trip_start IS NOT NULL AND v_trip_end IS NOT NULL
         AND v_trip_end > v_trip_start THEN
        IF v_dates_touched OR NOT EXISTS (
          SELECT 1 FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true
        ) THEN
          DELETE FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true;
          INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
          SELECT p_event_id, v_trip_start, v_trip_end, e.timezone, true
            FROM public.events e
           WHERE e.id = p_event_id;
        END IF;
      ELSIF v_dates_touched THEN
        DELETE FROM public.event_dates
         WHERE event_id = p_event_id AND is_master = true;
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------------------- dates --
  IF p_patch ? 'event_dates' THEN
    IF jsonb_typeof(p_patch->'event_dates') <> 'array' THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'event_dates') LOOP
      IF NULLIF(v_item->>'start_at', '') IS NULL THEN
        RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id,
        (v_item->>'start_at')::timestamptz,
        NULLIF(v_item->>'end_at', '')::timestamptz,
        COALESCE(NULLIF(v_item->>'timezone', ''), v_event.timezone),
        COALESCE((v_item->>'is_master')::boolean, true)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------------- days --
  IF p_patch ? 'days' THEN
    IF jsonb_typeof(p_patch->'days') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          WHERE jsonb_typeof(d) <> 'object'
             OR COALESCE((d->>'ordinal')::int, 0) < 1
             OR NULLIF(btrim(d->>'title'), '') IS NULL
             OR jsonb_typeof(COALESCE(d->'media', '[]'::jsonb)) <> 'array')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          GROUP BY (d->>'ordinal')::int HAVING count(*) > 1)
    THEN
      RAISE EXCEPTION 'trip_days_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_days WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'days') LOOP
      INSERT INTO public.trip_days(event_id, ordinal, title, narrative, date, stops, media)
      VALUES (
        p_event_id,
        (v_item->>'ordinal')::smallint,
        v_item->>'title',
        NULLIF(v_item->>'narrative', ''),
        NULLIF(v_item->>'date', '')::date,
        COALESCE(v_item->'stops', '[]'::jsonb),
        COALESCE(v_item->'media', '[]'::jsonb)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------- inclusions --
  IF p_patch ? 'inclusions' THEN
    IF jsonb_typeof(p_patch->'inclusions') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'inclusions') i
          WHERE COALESCE(i->>'kind', '') NOT IN ('included', 'excluded')
             OR NULLIF(btrim(i->>'item'), '') IS NULL
             OR COALESCE((i->>'ordinal')::int, -1) < 0)
    THEN
      RAISE EXCEPTION 'trip_inclusions_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'inclusions') LOOP
      INSERT INTO public.trip_inclusions(event_id, kind, item, ordinal)
      VALUES (p_event_id, v_item->>'kind', v_item->>'item', (v_item->>'ordinal')::smallint);
    END LOOP;
  END IF;

  ------------------------------------------------------------------- tiers --
  IF p_patch ? 'tiers' THEN
    IF jsonb_typeof(p_patch->'tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    v_currency := v_event.currency;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;

      IF COALESCE((v_item->>'deleted')::boolean, false) THEN
        IF v_ticket_type IS NULL THEN RAISE EXCEPTION 'trip_tier_id_required'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.tickets
           WHERE ticket_type_id = v_ticket_type
             AND status IN ('valid', 'used', 'transferred')
        ) THEN
          RAISE EXCEPTION 'tier_delete_with_sales';
        END IF;
        UPDATE public.ticket_types
           SET deleted_at = now(), updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        CONTINUE;
      END IF;

      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');

      IF v_ticket_type IS NULL THEN
        IF NULLIF(btrim(v_item->>'tier_name'), '') IS NULL
           OR COALESCE((v_item->>'price_cents')::int, -1) < 0
           OR COALESCE((v_item->>'capacity')::int, 0) < 1 THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.ticket_types(
          event_id, name, price_cents, currency, quantity_total, is_unlimited,
          is_free, min_purchase_qty, available_online, available_in_person, display_order
        ) VALUES (
          p_event_id,
          v_item->>'tier_name',
          COALESCE((v_item->>'price_cents')::int, 0),
          v_currency,
          (v_item->>'capacity')::int,
          false,
          COALESCE((v_item->>'price_cents')::int, 0) = 0,
          1, true, false,
          COALESCE((v_item->>'display_order')::int, 0)
        ) RETURNING id INTO v_ticket_type;
        INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
        VALUES (p_event_id, v_ticket_type, v_item->>'tier_name',
                COALESCE(v_item->'tier_metadata', '{}'::jsonb));
      ELSE
        IF (v_item ? 'price_cents' AND (v_item->>'price_cents')::int < 0)
           OR (v_item ? 'capacity' AND (v_item->>'capacity')::int < 1) THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        UPDATE public.ticket_types SET
          name = COALESCE(v_item->>'tier_name', name),
          price_cents = COALESCE((v_item->>'price_cents')::int, price_cents),
          quantity_total = COALESCE((v_item->>'capacity')::int, quantity_total),
          is_free = COALESCE((v_item->>'price_cents')::int, price_cents) = 0,
          updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        UPDATE public.trip_pricing_tiers SET
          tier_name = COALESCE(v_item->>'tier_name', tier_name),
          tier_metadata = COALESCE(v_item->'tier_metadata', tier_metadata)
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      END IF;
    END LOOP;
  END IF;

  ----------------------------------------------------------- intake schemas --
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RAISE EXCEPTION 'trip_intake_schemas_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'intake_schemas') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;
      IF v_ticket_type IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.trip_pricing_tiers
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type
      ) THEN
        RAISE EXCEPTION 'trip_intake_schema_unknown_tier';
      END IF;
      IF NOT (v_item ? 'schema') OR jsonb_typeof(v_item->'schema') = 'null' THEN
        DELETE FROM public.trip_intake_schemas
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      ELSE
        IF NOT public.validate_trip_intake_schema(v_item->'schema') THEN
          RAISE EXCEPTION 'trip_intake_schema_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.trip_intake_schemas(event_id, ticket_type_id, schema, schema_version_id)
        VALUES (p_event_id, v_ticket_type, v_item->'schema',
                NULLIF(v_item#>>'{schema,schema_version_id}', '')::uuid)
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = now();
      END IF;
    END LOOP;
  END IF;

  ---------------------------------------------------------------- settings --
  IF p_patch ? 'settings' THEN
    IF jsonb_typeof(p_patch->'settings') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'settings') key
       WHERE key <> ALL (ARRAY[
         'refund_policy', 'booking_deadline', 'bookings_closed',
         'pass_tax', 'pass_mingla_fee', 'pass_service_fee'])
    ) THEN
      RAISE EXCEPTION 'trip_settings_patch_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.events SET
      refund_policy = CASE WHEN (p_patch->'settings') ? 'refund_policy'
                THEN p_patch#>'{settings,refund_policy}' ELSE refund_policy END,
      booking_deadline = CASE WHEN (p_patch->'settings') ? 'booking_deadline'
                THEN NULLIF(p_patch#>>'{settings,booking_deadline}', '')::timestamptz ELSE booking_deadline END,
      bookings_closed = CASE WHEN (p_patch->'settings') ? 'bookings_closed'
                THEN (p_patch#>>'{settings,bookings_closed}')::boolean ELSE bookings_closed END,
      pass_tax = CASE WHEN (p_patch->'settings') ? 'pass_tax'
                THEN (p_patch#>>'{settings,pass_tax}')::boolean ELSE pass_tax END,
      pass_mingla_fee = CASE WHEN (p_patch->'settings') ? 'pass_mingla_fee'
                THEN (p_patch#>>'{settings,pass_mingla_fee}')::boolean ELSE pass_mingla_fee END,
      pass_service_fee = CASE WHEN (p_patch->'settings') ? 'pass_service_fee'
                THEN (p_patch#>>'{settings,pass_service_fee}')::boolean ELSE pass_service_fee END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  -- A sidecar-only patch still advances the graph revision, so the next
  -- compare-and-swap sees a moved target.
  UPDATE public.events SET updated_at = now() WHERE id = p_event_id;

  v_result := public.biz_get_trip_draft_graph(p_event_id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_execute_guest_roster_send_group(p_actor_id uuid, p_event_id uuid, p_purpose text, p_selection jsonb, p_channels text[], p_client_request_id uuid, p_execution_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_brand uuid; v_rollout jsonb; v_selected_count integer;
BEGIN
  IF p_purpose<>'reminder' OR p_selection->>'source'<>'guest_roster_actions'
     OR p_selection->>'kind'<>'resolved_brand_people_v1' THEN
    RAISE EXCEPTION 'guest_roster_action_invalid' USING ERRCODE='22023';
  END IF;
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,false);
  v_selected_count:=jsonb_array_length(p_selection->'brandPersonIds');
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF NOT COALESCE((v_rollout->>CASE WHEN v_selected_count>1
    THEN 'bulkActionsEnabled' ELSE 'singleActionsEnabled' END)::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_action_disabled' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_selection->'brandPersonIds') person_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.biz_guest_roster_project(p_event_id) r
      WHERE r.row_data->>'personId'=person_id AND (r.row_data->>'canRemind')::boolean
    )
  ) THEN
    RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='PT409';
  END IF;
  RETURN public.biz_execute_offering_send_group(
    p_actor_id,p_event_id,p_purpose,p_selection,p_channels,
    p_client_request_id,p_execution_snapshot
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_execute_offering_delivery_retry(p_actor_id uuid, p_event_id uuid, p_failed_attempt_ids uuid[], p_channels text[], p_client_request_id uuid, p_execution_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_selection jsonb; v_locked_count integer; v_brand uuid; v_rollout jsonb; v_selected_count integer;
BEGIN
  IF p_failed_attempt_ids IS NULL OR cardinality(p_failed_attempt_ids) NOT BETWEEN 1 AND 500
     OR cardinality(p_failed_attempt_ids)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_failed_attempt_ids))) THEN
    RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
  END IF;
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,false);
  SELECT count(DISTINCT i.brand_person_id) INTO v_selected_count
  FROM public.brand_offering_invite_delivery_attempts a
  JOIN public.brand_offering_invites i ON i.id=a.invite_id
  WHERE a.id=ANY(p_failed_attempt_ids) AND i.event_id=p_event_id;
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF NOT COALESCE((v_rollout->>CASE WHEN v_selected_count>1
    THEN 'bulkActionsEnabled' ELSE 'singleActionsEnabled' END)::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_action_disabled' USING ERRCODE='42501';
  END IF;
  PERFORM a.id FROM public.brand_offering_invite_delivery_attempts a
  WHERE a.id=ANY(p_failed_attempt_ids) ORDER BY a.id FOR UPDATE;
  SELECT count(*) INTO v_locked_count FROM public.brand_offering_invite_delivery_attempts a
  WHERE a.id=ANY(p_failed_attempt_ids);
  IF v_locked_count<>cardinality(p_failed_attempt_ids)
     OR EXISTS (
       SELECT 1 FROM public.brand_offering_invite_delivery_attempts a
       JOIN public.brand_offering_invites i ON i.id=a.invite_id
       WHERE a.id=ANY(p_failed_attempt_ids)
         AND (i.event_id<>p_event_id OR a.status<>'failed' OR NOT a.is_retryable
           OR NOT (a.channel=ANY(p_channels))
           OR EXISTS (
             SELECT 1 FROM public.brand_offering_invite_delivery_attempts later
             WHERE later.invite_id=a.invite_id AND later.channel=a.channel
               AND later.attempt_ordinal>a.attempt_ordinal
           ))
     ) THEN
    RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='PT409';
  END IF;
  IF p_failed_attempt_ids IS DISTINCT FROM ARRAY(
    SELECT DISTINCT (x->>'predecessorAttemptId')::uuid
    FROM jsonb_array_elements(p_execution_snapshot->'candidates') x ORDER BY 1
  ) THEN
    RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
  END IF;
  v_selection:=jsonb_build_object(
    'kind','failed_attempts_v1','failedAttemptIds',to_jsonb(p_failed_attempt_ids),
    'selectionHash',p_execution_snapshot->>'selectionHash','source','guest_roster_actions'
  );
  RETURN public.biz_execute_offering_send_group(
    p_actor_id,p_event_id,'retry_delivery',v_selection,p_channels,
    p_client_request_id,p_execution_snapshot
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_guest_roster_get_preview(p_actor_id uuid, p_preview_id uuid, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.guest_roster_action_previews%ROWTYPE; v_rollout jsonb;
BEGIN
  SELECT * INTO v FROM public.guest_roster_action_previews WHERE id=p_preview_id FOR UPDATE;
  IF NOT FOUND OR v.actor_id<>p_actor_id
     OR public.issue_1770_offering_actor_brand(p_actor_id,v.event_id,false)<>v.brand_id THEN
    RAISE EXCEPTION 'guest_roster_preview_forbidden' USING ERRCODE='42501';
  END IF;
  IF v.consumed_at IS NOT NULL AND v.execute_client_request_id<>p_client_request_id THEN
    RAISE EXCEPTION 'guest_roster_preview_consumed' USING ERRCODE='23505';
  END IF;
  IF v.expires_at<now() AND v.consumed_at IS NULL THEN
    RAISE EXCEPTION 'guest_roster_preview_expired' USING ERRCODE='PT409';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v.brand_id);
  IF NOT COALESCE((v_rollout->>CASE WHEN v.selected_count>1
    THEN 'bulkActionsEnabled' ELSE 'singleActionsEnabled' END)::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_action_disabled' USING ERRCODE='42501';
  END IF;
  IF v.consumed_at IS NULL AND v.action='reminder' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v.selection->'brandPersonIds') person_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.biz_guest_roster_project(v.event_id) r
      WHERE r.row_data->>'personId'=person_id AND (r.row_data->>'canRemind')::boolean
    )
  ) THEN RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='PT409'; END IF;
  -- Claim before any provider I/O. The edge supplies preview_id as the stable
  -- execution identity, so concurrent calls and remount retries converge on
  -- the same downstream send-group idempotency key.
  IF v.consumed_at IS NULL THEN
    UPDATE public.guest_roster_action_previews
    SET consumed_at=now(),execute_client_request_id=p_client_request_id
    WHERE id=p_preview_id;
    v.consumed_at:=now();
    v.execute_client_request_id:=p_client_request_id;
  END IF;
  RETURN jsonb_build_object('eventId',v.event_id,'action',v.action,'selection',v.selection,
    'channels',to_jsonb(v.channels),'quoteHash',v.quote_hash,
    'estimatedCostMinor',v.estimated_cost_minor,'currency',v.currency,
    'replayed',v.consumed_at IS NOT NULL);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_guest_roster_list(p_event_id uuid, p_filter text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_sort text DEFAULT 'action_priority'::text, p_cursor jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_brand uuid; v_rollout jsonb; v_search text; v_rows jsonb; v_all jsonb;
  v_count integer; v_rank integer; v_watermark bigint; v_query_hash text; v_last jsonb;
  v_cursor_rank integer; v_cursor_name text; v_cursor_activity timestamptz; v_cursor_key text;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_brand IS NULL THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rank:=public.biz_brand_effective_rank(v_brand,auth.uid());
  IF v_rank<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF NOT COALESCE((v_rollout->>'readEnabled')::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_disabled' USING ERRCODE='42501';
  END IF;
  IF p_filter NOT IN ('all','rsvpd','ticketed','not_yet','suppressed','needs_attention','no_response','confirmed',
    'checked_in','not_checked_in','delivery_failed','removed','going','maybe','awaiting_approval','waitlisted',
    'declined','denied','bought_ticket','refunded','cancelled','transferred')
    OR p_sort NOT IN ('action_priority','name_asc','name_desc','recent_first')
    OR p_limit NOT BETWEEN 1 AND 100
    OR (p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object'
      OR public.issue_1770_json_keys(p_cursor)<>
        ARRAY['activityAt','name','queryHash','rank','rosterKey','signature','watermark']::text[])) THEN
    RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
  END IF;
  v_search:=lower(regexp_replace(btrim(COALESCE(p_search,'')),'\s+',' ','g'));
  IF length(v_search)>200 OR v_search~E'[\\x00-\\x1F\\x7F]' THEN RAISE EXCEPTION 'guest_roster_search_invalid' USING ERRCODE='22023'; END IF;
  v_query_hash:=encode(extensions.digest(convert_to(
    p_event_id::text||':'||p_filter||':'||v_search||':'||p_sort,'UTF8'
  ),'sha256'),'hex');
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events
  WHERE event_id=p_event_id;
  BEGIN
    IF p_cursor IS NOT NULL AND (
      (p_cursor->>'watermark')::bigint<>v_watermark
      OR p_cursor->>'queryHash'<>v_query_hash
    ) THEN RAISE EXCEPTION 'guest_roster_cursor_stale' USING ERRCODE='PT409'; END IF;
    IF p_cursor IS NOT NULL THEN
      v_cursor_rank:=(p_cursor->>'rank')::integer;
      v_cursor_name:=p_cursor->>'name';
      v_cursor_activity:=(p_cursor->>'activityAt')::timestamptz;
      v_cursor_key:=p_cursor->>'rosterKey';
      IF v_cursor_name IS NULL OR v_cursor_key IS NULL OR v_cursor_activity IS NULL
         OR v_cursor_rank NOT BETWEEN 0 AND 9 THEN
        RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
      END IF;
    END IF;
  EXCEPTION WHEN serialization_failure OR SQLSTATE 'PT409' THEN RAISE;
    WHEN OTHERS THEN RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
  END;
  IF p_cursor IS NOT NULL AND p_cursor->>'signature' IS DISTINCT FROM public.biz_guest_roster_cursor_signature(
    v_query_hash,v_watermark,v_cursor_rank,v_cursor_name,v_cursor_activity,v_cursor_key
  ) THEN
    RAISE EXCEPTION 'guest_roster_cursor_forged' USING ERRCODE='22023';
  END IF;
  WITH all_rows AS MATERIALIZED (SELECT row_data r FROM public.biz_guest_roster_project(p_event_id)),
  filtered AS (
    SELECT r FROM all_rows WHERE
      (v_search='' OR strpos(lower(r->>'displayName'),v_search)>0
        OR strpos(lower(COALESCE(r->>'contactLabel','')),v_search)>0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'orderIds') order_id WHERE lower(order_id)=v_search)
        OR EXISTS (
          SELECT 1 FROM public.brand_person_contact_methods contact
          WHERE contact.brand_person_id=(r->>'personId')::uuid
            AND contact.record_state='active' AND contact.provenance_scope='brand_owned'
            AND contact.is_exportable AND strpos(lower(contact.normalized_value),v_search)>0
        ))
      AND CASE p_filter
        WHEN 'all' THEN true WHEN 'no_response' THEN r->>'primaryStatus'='not_responded'
        WHEN 'confirmed' THEN r->>'primaryStatus' IN ('bought_ticket','going')
        WHEN 'needs_attention' THEN (r->>'canRetry')::boolean OR r->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')
        WHEN 'not_yet' THEN r->>'primaryStatus' IN ('not_responded','not_sent','sending','invite_failed','suppressed_or_skipped')
        WHEN 'delivery_failed' THEN r->>'invitationStatus'='failed'
        WHEN 'suppressed' THEN r->>'invitationStatus'='suppressed_or_skipped'
        WHEN 'checked_in' THEN (r->>'checkedIn')::boolean
        WHEN 'not_checked_in' THEN NOT (r->>'checkedIn')::boolean
        WHEN 'rsvpd' THEN r->>'rsvpId' IS NOT NULL
        WHEN 'ticketed' THEN (r->'party'->>'activeTickets')::integer>0
        ELSE r->>'primaryStatus'=p_filter END
  ), enriched AS (
    SELECT r,
      CASE WHEN (r->>'canRetry')::boolean THEN 0 ELSE CASE r->>'primaryStatus' WHEN 'invite_failed' THEN 0 WHEN 'awaiting_approval' THEN 1
        WHEN 'not_responded' THEN 2 WHEN 'waitlisted' THEN 3 ELSE 9 END END AS sort_rank,
      lower(r->>'displayName') AS sort_name,
      (r->>'latestActivityAt')::timestamptz AS sort_activity,
      r->>'rosterKey' AS sort_key
    FROM filtered
  ), after_cursor AS (
    SELECT * FROM enriched e WHERE p_cursor IS NULL OR CASE p_sort
      WHEN 'action_priority' THEN (e.sort_rank,e.sort_name,e.sort_key)>(v_cursor_rank,v_cursor_name,v_cursor_key)
      WHEN 'name_asc' THEN (e.sort_name,e.sort_key)>(v_cursor_name,v_cursor_key)
      WHEN 'name_desc' THEN e.sort_name<v_cursor_name OR (e.sort_name=v_cursor_name AND e.sort_key>v_cursor_key)
      WHEN 'recent_first' THEN e.sort_activity<v_cursor_activity OR (e.sort_activity=v_cursor_activity AND e.sort_key>v_cursor_key)
      ELSE false END
  ), page_rows AS (
    SELECT * FROM after_cursor ORDER BY
      CASE WHEN p_sort='action_priority' THEN sort_rank END,
      CASE WHEN p_sort='recent_first' THEN sort_activity END DESC,
      CASE WHEN p_sort IN ('action_priority','name_asc') THEN sort_name END,
      CASE WHEN p_sort='name_desc' THEN sort_name END DESC,
      sort_key LIMIT p_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(
      CASE WHEN COALESCE((v_rollout->>'singleActionsEnabled')::boolean,false)
        THEN r ELSE r||jsonb_build_object('canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false) END
      ORDER BY CASE WHEN p_sort='action_priority' THEN sort_rank END,
        CASE WHEN p_sort='recent_first' THEN sort_activity END DESC,
        CASE WHEN p_sort IN ('action_priority','name_asc') THEN sort_name END,
        CASE WHEN p_sort='name_desc' THEN sort_name END DESC,sort_key
    ) FROM page_rows),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(r) FROM all_rows),'[]'::jsonb),
    (SELECT count(*) FROM all_rows)
  INTO v_rows,v_all,v_count;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'summary',jsonb_build_object(
    'all',v_count,
    'notResponded',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus'='not_responded'),
    'confirmed',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus' IN ('bought_ticket','going')),
    'needsAttention',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE (x->>'canRetry')::boolean OR x->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')),
    'invited',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='invited'),
    'notSent',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='not_sent'),
    'sending',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='sending'),
    'inviteFailed',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='failed'),
    'watermark',v_watermark,
    'generatedAt',now()),'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit
      THEN jsonb_build_object(
        'rank',CASE WHEN (v_last->>'canRetry')::boolean THEN 0 ELSE CASE v_last->>'primaryStatus' WHEN 'invite_failed' THEN 0 WHEN 'awaiting_approval' THEN 1
          WHEN 'not_responded' THEN 2 WHEN 'waitlisted' THEN 3 ELSE 9 END END,
        'name',lower(v_last->>'displayName'),'activityAt',v_last->>'latestActivityAt',
        'rosterKey',v_last->>'rosterKey','queryHash',v_query_hash,'watermark',v_watermark,
        'signature',public.biz_guest_roster_cursor_signature(
          v_query_hash,v_watermark,
          CASE WHEN (v_last->>'canRetry')::boolean THEN 0 ELSE CASE v_last->>'primaryStatus' WHEN 'invite_failed' THEN 0 WHEN 'awaiting_approval' THEN 1
            WHEN 'not_responded' THEN 2 WHEN 'waitlisted' THEN 3 ELSE 9 END END,
          lower(v_last->>'displayName'),(v_last->>'latestActivityAt')::timestamptz,v_last->>'rosterKey')
      ) ELSE NULL END,
    'staleAfter',now()+interval '30 seconds',
    'canBulkActions',COALESCE((v_rollout->>'bulkActionsEnabled')::boolean,false),
    'canExport',COALESCE((v_rollout->>'exportEnabled')::boolean,false)
      AND v_rank>=public.biz_role_rank('brand_admin'));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_guest_roster_resolve_action(p_actor_id uuid, p_event_id uuid, p_action text, p_roster_keys text[], p_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid; v_rollout jsonb; v_people uuid[]; v_attempts uuid[]; v_hash text;
BEGIN
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,false);
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF p_action NOT IN ('reminder','retry_delivery') OR p_roster_keys IS NULL
     OR cardinality(p_roster_keys) NOT BETWEEN 1 AND 500
     OR cardinality(p_roster_keys)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_roster_keys)))
     OR p_channels IS NULL OR cardinality(p_channels) NOT BETWEEN 1 AND 3
     OR p_channels IS DISTINCT FROM ARRAY(SELECT DISTINCT x FROM unnest(p_channels) x ORDER BY x)
     OR NOT p_channels<@ARRAY['email','push','sms']::text[]
     OR NOT COALESCE((v_rollout->>CASE WHEN cardinality(p_roster_keys)>1 THEN 'bulkActionsEnabled' ELSE 'singleActionsEnabled' END)::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_action_invalid' USING ERRCODE='22023';
  END IF;
  WITH selected AS (
    SELECT row_data FROM public.biz_guest_roster_project(p_event_id)
    WHERE row_data->>'rosterKey'=ANY(p_roster_keys)
  )
  SELECT array_agg((row_data->>'personId')::uuid ORDER BY row_data->>'personId') INTO v_people
  FROM selected
  WHERE row_data->>'personId' IS NOT NULL
    AND CASE p_action WHEN 'reminder' THEN (row_data->>'canRemind')::boolean
      ELSE (row_data->>'canRetry')::boolean END;
  IF cardinality(COALESCE(v_people,'{}'))<>cardinality(p_roster_keys) THEN
    RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='PT409';
  END IF;
  IF p_action='retry_delivery' THEN
    SELECT array_agg(id ORDER BY id) INTO v_attempts FROM (
      SELECT DISTINCT ON (i.brand_person_id,a.channel) a.id
      FROM public.brand_offering_invite_delivery_attempts a
      JOIN public.brand_offering_invites i ON i.id=a.invite_id
      WHERE i.event_id=p_event_id AND i.brand_person_id=ANY(v_people)
        AND a.channel=ANY(p_channels) AND a.status='failed' AND a.is_retryable
        AND NOT EXISTS (SELECT 1 FROM public.brand_offering_invite_delivery_attempts later
          WHERE later.invite_id=a.invite_id AND later.channel=a.channel
            AND later.attempt_ordinal>a.attempt_ordinal)
      ORDER BY i.brand_person_id,a.channel,a.attempt_ordinal DESC
    ) q;
    IF cardinality(COALESCE(v_attempts,'{}'))=0 THEN
      RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='PT409';
    END IF;
  END IF;
  v_hash:=encode(extensions.digest(convert_to(
    p_event_id::text||':'||p_action||':'||array_to_string(p_roster_keys,',')||':'||array_to_string(p_channels,','),'UTF8'
  ),'sha256'),'hex');
  IF p_action='reminder' THEN
    RETURN jsonb_build_object('selection',jsonb_build_object(
      'kind','resolved_brand_people_v1','brandPersonIds',to_jsonb(v_people),
      'selectionHash',v_hash,'source','guest_roster_actions'),
      'selectedCount',cardinality(p_roster_keys));
  END IF;
  RETURN jsonb_build_object('selection',jsonb_build_object(
    'kind','failed_attempts_v1','failedAttemptIds',to_jsonb(v_attempts),
    'selectionHash',v_hash,'source','guest_roster_actions'),
    'selectedCount',cardinality(p_roster_keys));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_guest_roster_set_rsvp_approval(p_event_id uuid, p_roster_key text, p_decision text, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_brand uuid; v_rollout jsonb; v_row jsonb; v_rsvp uuid; v_target text;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_brand IS NULL
     OR public.biz_brand_effective_rank(v_brand,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF NOT COALESCE((v_rollout->>'singleActionsEnabled')::boolean,false)
     OR p_decision NOT IN ('approve','deny') OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'guest_roster_action_invalid' USING ERRCODE='22023';
  END IF;
  SELECT row_data INTO v_row FROM public.biz_guest_roster_project(p_event_id)
  WHERE row_data->>'rosterKey'=p_roster_key;
  v_rsvp:=(v_row->>'rsvpId')::uuid;
  v_target:=CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'denied' END;
  IF v_rsvp IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.event_rsvps r WHERE r.id=v_rsvp
      AND r.event_id=p_event_id AND r.rsvp_status='going'
      AND r.approval_status IN ('pending',v_target)
  ) THEN RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='PT409'; END IF;
  UPDATE public.event_rsvps SET approval_status=v_target WHERE id=v_rsvp AND approval_status<>v_target;
  SELECT row_data INTO v_row FROM public.biz_guest_roster_project(p_event_id)
  WHERE row_data->>'rosterKey'=p_roster_key;
  RETURN v_row;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_manage_stay_inventory(p_action text, p_venue_id uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_offering_id uuid;
  v_currency character(3);
  v_item jsonb;
  v_job public.stay_bulk_jobs%ROWTYPE;
  v_success integer := 0;
  v_failed integer := 0;
  v_index integer := 0;
  v_error text;
  v_rule public.stay_place_schedule_rules%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_date date;
  v_end_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_start_resolution text;
  v_end_resolution text;
  v_local_window_start timestamp;
  v_local_window_end timestamp;
  v_local_slot_start timestamp;
  v_local_slot_end timestamp;
  v_next_version integer;
  v_current_price public.stay_price_versions%ROWTYPE;
  v_current_policy public.stay_policy_versions%ROWTYPE;
  v_current_fee public.stay_fee_versions%ROWTYPE;
  v_media_id uuid;
  v_request_hash text;
  v_requires_finance boolean;
  v_requires_inventory boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND OR v_venue.venue_category <> 'stay' THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_requires_finance := v_action IN (
    'set_price',
    'set_policy',
    'replace_fees',
    'resolve_currency_reconciliation'
  )
     OR (
       v_action = 'create_offering'
       AND (
         p_payload ? 'price'
         OR jsonb_array_length(COALESCE(p_payload->'fees', '[]'::jsonb)) > 0
       )
     )
     OR (
       v_action = 'bulk_create'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) item
         WHERE item ? 'price'
            OR jsonb_array_length(COALESCE(item->'fees', '[]'::jsonb)) > 0
       )
     )
     OR (
       v_action = 'upsert_room_nights'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'nights', '[]'::jsonb)) night
         WHERE night ? 'priceOverrideMinor'
       )
     )
     OR (
       v_action = 'upsert_place_windows'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           COALESCE(p_payload->'windows', '[]'::jsonb)
         ) window_item
         WHERE window_item ? 'priceOverrideMinor'
       )
     );
  v_requires_inventory := v_action NOT IN (
    'get',
    'set_price',
    'set_policy',
    'replace_fees',
    'resolve_currency_reconciliation'
  );

  IF v_action = 'get' THEN
    IF NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'read'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_requires_inventory AND NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'inventory'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_requires_finance AND NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'finance'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF v_action = 'resolve_currency_reconciliation' THEN
    RETURN public.issue_1387_resolve_currency_reconciliation(
      v_venue.brand_id,
      (p_payload->>'reconciliationId')::uuid,
      p_payload->>'decision',
      NULLIF(p_payload->>'fxSnapshotId', '')::uuid,
      COALESCE(p_payload->'ranges', '[]'::jsonb),
      COALESCE(p_payload->'stayItems', '[]'::jsonb),
      p_request_id
    );
  ELSIF v_action = 'get' THEN
    RETURN public.issue_1387_stay_inventory_snapshot(p_venue_id);
  ELSIF v_action = 'save_settings' THEN
    INSERT INTO public.stay_settings (
      venue_id, brand_id, property_kind, timezone, default_booking_mode,
      check_in_time, check_out_time, instant_payment_hold_minutes,
      request_response_hours, approved_payment_minutes, booking_horizon_days,
      booking_state, house_rules, created_by, updated_by
    ) VALUES (
      p_venue_id,
      v_venue.brand_id,
      NULLIF(lower(pg_catalog.btrim(p_payload->>'propertyKind')), ''),
      COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'timezone'), ''), 'UTC'),
      COALESCE(
        NULLIF(lower(pg_catalog.btrim(p_payload->>'defaultBookingMode')), ''),
        'request'
      ),
      COALESCE(NULLIF(p_payload->>'checkInTime', '')::time, '15:00'::time),
      COALESCE(NULLIF(p_payload->>'checkOutTime', '')::time, '11:00'::time),
      COALESCE((p_payload->>'instantPaymentHoldMinutes')::smallint, 15),
      COALESCE((p_payload->>'requestResponseHours')::smallint, 24),
      COALESCE((p_payload->>'approvedPaymentMinutes')::smallint, 30),
      COALESCE((p_payload->>'bookingHorizonDays')::smallint, 365),
      COALESCE(NULLIF(lower(p_payload->>'bookingState'), ''), 'draft'),
      NULLIF(p_payload->>'houseRules', ''),
      v_uid,
      v_uid
    )
    ON CONFLICT (venue_id) DO UPDATE
      SET property_kind = EXCLUDED.property_kind,
          timezone = EXCLUDED.timezone,
          default_booking_mode = EXCLUDED.default_booking_mode,
          check_in_time = EXCLUDED.check_in_time,
          check_out_time = EXCLUDED.check_out_time,
          instant_payment_hold_minutes = EXCLUDED.instant_payment_hold_minutes,
          request_response_hours = EXCLUDED.request_response_hours,
          approved_payment_minutes = EXCLUDED.approved_payment_minutes,
          booking_horizon_days = EXCLUDED.booking_horizon_days,
          booking_state = EXCLUDED.booking_state,
          house_rules = EXCLUDED.house_rules,
          version = public.stay_settings.version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE p_expected_version IS NOT NULL
        AND public.stay_settings.version = p_expected_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
  ELSIF v_action = 'create_offering' THEN
    v_offering_id := public.issue_1387_create_offering_internal(
      v_venue.brand_id, p_venue_id, p_payload, v_uid
    );
  ELSIF v_action = 'update_offering' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    UPDATE public.stay_offerings
      SET name = COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'name'), ''), name),
          summary = COALESCE(p_payload->>'summary', summary),
          description = COALESCE(p_payload->>'description', description),
          confirmation_mode = CASE WHEN p_payload ? 'confirmationMode'
            THEN NULLIF(
              lower(pg_catalog.btrim(p_payload->>'confirmationMode')), ''
            )
            ELSE confirmation_mode END,
          inventory_basis = COALESCE(
            NULLIF(lower(p_payload->>'inventoryBasis'), ''),
            inventory_basis
          ),
          unit_naming_mode = COALESCE(
            NULLIF(lower(p_payload->>'unitNamingMode'), ''),
            unit_naming_mode
          ),
          quantity = CASE WHEN p_payload ? 'quantity'
            THEN NULLIF(p_payload->>'quantity', '')::integer ELSE quantity END,
          capacity = CASE WHEN p_payload ? 'capacity'
            THEN NULLIF(p_payload->>'capacity', '')::integer ELSE capacity END,
          min_guests = COALESCE(
            (p_payload->>'minGuests')::integer, min_guests
          ),
          max_guests = COALESCE((p_payload->>'maxGuests')::integer, max_guests),
          max_adults = CASE WHEN p_payload ? 'maxAdults'
            THEN NULLIF(p_payload->>'maxAdults', '')::integer ELSE max_adults END,
          max_children = CASE WHEN p_payload ? 'maxChildren'
            THEN NULLIF(p_payload->>'maxChildren', '')::integer
            ELSE max_children END,
          place_pricing_basis = CASE WHEN p_payload ? 'placePricingBasis'
            THEN NULLIF(lower(p_payload->>'placePricingBasis'), '')
            ELSE place_pricing_basis END,
          min_notice_minutes = COALESCE(
            (p_payload->>'minNoticeMinutes')::integer, min_notice_minutes
          ),
          max_advance_days = CASE WHEN p_payload ? 'maxAdvanceDays'
            THEN NULLIF(p_payload->>'maxAdvanceDays', '')::integer
            ELSE max_advance_days END,
          buffer_before_minutes = COALESCE(
            (p_payload->>'bufferBeforeMinutes')::integer,
            buffer_before_minutes
          ),
          buffer_after_minutes = COALESCE(
            (p_payload->>'bufferAfterMinutes')::integer,
            buffer_after_minutes
          ),
          amenities = CASE WHEN p_payload ? 'amenities' THEN ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'amenities')
          ) ELSE amenities END,
          safety_rules = CASE WHEN p_payload ? 'safetyRules' THEN ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'safetyRules')
          ) ELSE safety_rules END,
          accessibility_features = CASE
            WHEN p_payload ? 'accessibilityFeatures' THEN ARRAY(
              SELECT jsonb_array_elements_text(p_payload->'accessibilityFeatures')
            ) ELSE accessibility_features END,
          access_scope = COALESCE(
            NULLIF(lower(pg_catalog.btrim(p_payload->>'accessScope')), ''),
            access_scope
          ),
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE id = v_offering_id
        AND venue_id = p_venue_id
        AND version = p_expected_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
  ELSIF v_action = 'replace_units' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_offering_id
      AND venue_id = p_venue_id
      AND inventory_basis = 'exclusive_units'
      AND unit_naming_mode = 'named'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_named_unit_not_allowed' USING ERRCODE = '22023';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF jsonb_typeof(COALESCE(p_payload->'units', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(p_payload->'units', '[]'::jsonb))
          > v_offering.quantity THEN
      RAISE EXCEPTION 'stay_unit_quantity_exceeded' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_units
      SET status = 'archived', updated_by = v_uid, updated_at = now(),
          version = version + 1
      WHERE offering_id = v_offering_id AND status <> 'archived';
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_payload->'units', '[]'::jsonb))
    LOOP
      INSERT INTO public.stay_units (
        offering_id, brand_id, venue_id, name, external_reference,
        created_by, updated_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        pg_catalog.btrim(v_item->>'name'),
        NULLIF(pg_catalog.btrim(v_item->>'externalReference'), ''),
        v_uid, v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'change_status' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND OR v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF lower(p_payload->>'status') = 'live' THEN
      SELECT * INTO v_settings
      FROM public.stay_settings s
      WHERE s.venue_id = p_venue_id AND s.booking_state = 'active';
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.stay_price_versions p
        WHERE p.offering_id = v_offering_id AND p.effective_to IS NULL
      ) OR NOT EXISTS (
        SELECT 1 FROM public.stay_policy_versions p
        WHERE p.offering_id = v_offering_id AND p.effective_to IS NULL
      ) OR (
        SELECT count(*) FROM public.stay_offering_media m
        WHERE m.offering_id = v_offering_id
          AND m.status = 'ready' AND m.is_cover
      ) <> 1 THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF pg_catalog.btrim(v_offering.description) = ''
         OR v_venue.claim_status <> 'verified' THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.kind = 'room' AND NOT EXISTS (
        SELECT 1 FROM public.stay_room_nights n
        WHERE n.offering_id = v_offering_id
          AND NOT n.stop_sell
          AND n.sellable_quantity > 0
          AND n.local_date >=
            (now() AT TIME ZONE v_settings.timezone)::date
      ) THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.kind = 'place' AND NOT EXISTS (
        SELECT 1 FROM public.stay_place_windows w
        WHERE w.offering_id = v_offering_id
          AND NOT w.stop_sell
          AND COALESCE(w.sellable_units, w.sellable_capacity, 0) > 0
          AND w.ends_at > now()
      ) THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.unit_naming_mode = 'named' AND (
        SELECT count(*) FROM public.stay_units u
        WHERE u.offering_id = v_offering_id AND u.status = 'active'
      ) <> v_offering.quantity THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF NOT public.pg_brand_can_collect(v_venue.brand_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.brands b
           WHERE b.id = v_venue.brand_id AND b.default_currency IS NOT NULL
         ) THEN
        RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.stay_offerings
      SET status = lower(p_payload->>'status'),
          archived_at = CASE WHEN lower(p_payload->>'status') = 'archived'
            THEN now() ELSE NULL END,
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'set_policy' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_current_policy
    FROM public.stay_policy_versions
    WHERE offering_id = v_offering_id AND effective_to IS NULL
    FOR UPDATE;
    v_next_version := COALESCE(v_current_policy.version_number, 0) + 1;
    IF v_current_policy.id IS NOT NULL THEN
      UPDATE public.stay_policy_versions SET effective_to = now()
      WHERE id = v_current_policy.id;
    END IF;
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number,
      cancellation_policy, free_cancel_cutoff_minutes,
      late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, request_terms, house_rules,
      terms, created_by
    ) VALUES (
      v_offering_id, v_venue.brand_id, p_venue_id, v_next_version,
      pg_catalog.btrim(p_payload->>'cancellationPolicy'),
      COALESCE((p_payload->>'freeCancelCutoffMinutes')::integer, 0),
      COALESCE((p_payload->>'lateRefundBasisPoints')::integer, 0),
      COALESCE((p_payload->>'noShowRefundBasisPoints')::integer, 0),
      COALESCE(
        (p_payload->>'operatorCancelRefundBasisPoints')::integer, 10000
      ),
      NULLIF(p_payload->>'requestTerms', ''),
      NULLIF(p_payload->>'houseRules', ''),
      COALESCE(p_payload->'terms', '{}'::jsonb), v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'set_price' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    v_currency := public.issue_1387_assert_authoring_currency(
      v_venue.brand_id,
      upper(p_payload->>'currencyCode')::character(3)
    );
    SELECT * INTO v_current_price
    FROM public.stay_price_versions
    WHERE offering_id = v_offering_id AND effective_to IS NULL
    FOR UPDATE;
    v_next_version := COALESCE(v_current_price.version_number, 0) + 1;
    IF v_current_price.id IS NOT NULL THEN
      UPDATE public.stay_price_versions SET effective_to = now()
      WHERE id = v_current_price.id;
    END IF;
    INSERT INTO public.stay_price_versions (
      offering_id, brand_id, venue_id, version_number, amount_minor,
      currency_code, pricing_unit, supersedes_version_id, created_by
    ) VALUES (
      v_offering_id, v_venue.brand_id, p_venue_id, v_next_version,
      (p_payload->>'amountMinor')::bigint, v_currency,
      CASE
        WHEN v_offering.kind = 'room' THEN 'room_night'
        WHEN v_offering.place_pricing_basis = 'per_booking'
          THEN 'place_booking'
        WHEN v_offering.place_pricing_basis = 'per_unit'
          THEN 'place_unit'
        ELSE 'place_guest'
      END,
      v_current_price.id, v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'replace_fees' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    FOR v_current_fee IN
      SELECT * FROM public.stay_fee_versions
      WHERE offering_id = v_offering_id AND effective_to IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.stay_fee_versions SET effective_to = now()
      WHERE id = v_current_fee.id;
    END LOOP;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'fees', '[]'::jsonb)
      )
    LOOP
      SELECT COALESCE(max(f.version_number), 0) + 1
      INTO v_next_version
      FROM public.stay_fee_versions f
      WHERE f.offering_id = v_offering_id
        AND f.fee_key = lower(pg_catalog.btrim(v_item->>'feeKey'));
      IF lower(v_item->>'calculation') LIKE 'fixed_%' THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      INSERT INTO public.stay_fee_versions (
        offering_id, brand_id, venue_id, fee_key, label, version_number,
        fee_kind, calculation, amount_minor, basis_points, currency_code,
        display_mode, refund_treatment, created_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        lower(pg_catalog.btrim(v_item->>'feeKey')),
        pg_catalog.btrim(v_item->>'label'), v_next_version,
        COALESCE(NULLIF(lower(v_item->>'feeKind'), ''), 'mandatory_fee'),
        lower(v_item->>'calculation'),
        NULLIF(v_item->>'amountMinor', '')::bigint,
        NULLIF(v_item->>'basisPoints', '')::integer,
        v_currency,
        COALESCE(NULLIF(lower(v_item->>'displayMode'), ''), 'separate'),
        COALESCE(
          NULLIF(lower(v_item->>'refundTreatment'), ''), 'same_as_line'
        ),
        v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'attach_media' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF COALESCE((p_payload->>'isCover')::boolean, false) THEN
      UPDATE public.stay_offering_media SET is_cover = false, updated_at = now()
      WHERE offering_id = v_offering_id AND is_cover;
    END IF;
    v_media_id := public.issue_1387_attach_media_internal(
      v_offering_id,
      v_venue.brand_id,
      p_venue_id,
      p_payload,
      COALESCE(
        (p_payload->>'sortOrder')::integer,
        (SELECT COALESCE(max(m.sort_order), -1) + 1
         FROM public.stay_offering_media m
         WHERE m.offering_id = v_offering_id)
      ),
      v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'reorder_media' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'mediaIds', '[]'::jsonb)) <> (
      SELECT count(*) FROM public.stay_offering_media m
      WHERE m.offering_id = v_offering_id
    ) OR (
      SELECT count(DISTINCT (value #>> '{}')::uuid)
      FROM jsonb_array_elements(COALESCE(p_payload->'mediaIds', '[]'::jsonb))
    ) <> jsonb_array_length(COALESCE(p_payload->'mediaIds', '[]'::jsonb)) THEN
      RAISE EXCEPTION 'stay_media_set_changed' USING ERRCODE = 'PT409';
    END IF;
    SET CONSTRAINTS public.stay_offering_media_sort_unique DEFERRED;
    v_index := 0;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_payload->'mediaIds')
    LOOP
      UPDATE public.stay_offering_media
        SET sort_order = v_index, updated_at = now()
        WHERE id = (v_item #>> '{}')::uuid
          AND offering_id = v_offering_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_media_set_changed' USING ERRCODE = 'PT409';
      END IF;
      v_index := v_index + 1;
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'remove_media' THEN
    v_media_id := (p_payload->>'mediaId')::uuid;
    SELECT o.* INTO v_offering
    FROM public.stay_offerings o
    JOIN public.stay_offering_media m ON m.offering_id = o.id
    WHERE m.id = v_media_id AND o.venue_id = p_venue_id
    FOR UPDATE OF o;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_media_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.stay_offering_media m
      JOIN public.stay_offerings o ON o.id = m.offering_id
      WHERE m.id = v_media_id AND o.venue_id = p_venue_id
        AND o.status = 'live' AND m.is_cover
    ) THEN
      RAISE EXCEPTION 'stay_live_cover_required' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.stay_offering_media m
    USING public.stay_offerings o
    WHERE m.id = v_media_id
      AND o.id = m.offering_id
      AND o.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_media_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering.id;
  ELSIF v_action = 'bulk_create' THEN
    IF jsonb_typeof(p_payload->'items') <> 'array'
       OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'stay_invalid_bulk_request' USING ERRCODE = '22023';
    END IF;
    v_request_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to((p_payload->'items')::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    INSERT INTO public.stay_bulk_jobs (
      venue_id, brand_id, idempotency_key, requested_count,
      request_payload, request_hash, request_id, created_by
    ) VALUES (
      p_venue_id, v_venue.brand_id,
      pg_catalog.btrim(p_payload->>'idempotencyKey'),
      jsonb_array_length(p_payload->'items'),
      p_payload->'items', v_request_hash, p_request_id, v_uid
    )
    ON CONFLICT (venue_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_job;
    IF v_job.id IS NULL THEN
      SELECT * INTO v_job FROM public.stay_bulk_jobs
      WHERE venue_id = p_venue_id
        AND idempotency_key = pg_catalog.btrim(p_payload->>'idempotencyKey');
      IF v_job.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = 'PT409';
      END IF;
      RETURN jsonb_build_object(
        'job', to_jsonb(v_job),
        'items', COALESCE((
          SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_index)
          FROM public.stay_bulk_job_items i WHERE i.job_id = v_job.id
        ), '[]'::jsonb),
        'replayed', true
      );
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_payload->'items')
    LOOP
      BEGIN
        v_offering_id := public.issue_1387_create_offering_internal(
          v_venue.brand_id, p_venue_id, v_item, v_uid
        );
        INSERT INTO public.stay_bulk_job_items (
          job_id, item_index, status, offering_id, result
        ) VALUES (
          v_job.id, v_index, 'succeeded', v_offering_id,
          jsonb_build_object('offeringId', v_offering_id)
        );
        v_success := v_success + 1;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        INSERT INTO public.stay_bulk_job_items (
          job_id, item_index, status, error_code, safe_error_message
        ) VALUES (
          v_job.id, v_index, 'failed',
          CASE WHEN v_error LIKE 'stay_%' THEN split_part(v_error, ' ', 1)
            ELSE 'stay_item_invalid' END,
          CASE WHEN v_error LIKE 'stay_%'
            THEN 'This item needs review.'
            ELSE 'This item could not be created.' END
        );
        v_failed := v_failed + 1;
      END;
      v_index := v_index + 1;
    END LOOP;
    UPDATE public.stay_bulk_jobs
      SET status = CASE WHEN v_failed = 0 THEN 'completed'
        WHEN v_success = 0 THEN 'failed' ELSE 'completed_with_errors' END,
          succeeded_count = v_success,
          failed_count = v_failed,
          completed_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
    RETURN jsonb_build_object(
      'job', to_jsonb(v_job),
      'items', (
        SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_index)
        FROM public.stay_bulk_job_items i WHERE i.job_id = v_job.id
      ),
      'replayed', false
    );
  ELSIF v_action = 'upsert_room_nights' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id AND kind = 'room';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_room_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'nights', '[]'::jsonb)) > 366 THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'nights', '[]'::jsonb)
      )
    LOOP
      IF (v_item->>'localDate')::date
           < (now() AT TIME ZONE v_settings.timezone)::date
         OR (v_item->>'localDate')::date
           > (now() AT TIME ZONE v_settings.timezone)::date
             + LEAST(
               v_settings.booking_horizon_days,
               COALESCE(
                 v_offering.max_advance_days,
                 v_settings.booking_horizon_days
               )
             ) THEN
        RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
      END IF;
      IF v_item ? 'priceOverrideMinor'
         AND NULLIF(v_item->>'priceOverrideMinor', '') IS NOT NULL THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      INSERT INTO public.stay_room_nights (
        offering_id, local_date, brand_id, venue_id, sellable_quantity,
        price_override_minor, currency_code, stop_sell, minimum_nights,
        maximum_nights, updated_by
      ) VALUES (
        v_offering_id, (v_item->>'localDate')::date,
        v_venue.brand_id, p_venue_id,
        COALESCE((v_item->>'sellableQuantity')::integer, v_offering.quantity),
        NULLIF(v_item->>'priceOverrideMinor', '')::bigint,
        v_currency,
        COALESCE((v_item->>'stopSell')::boolean, false),
        COALESCE((v_item->>'minimumNights')::integer, 1),
        NULLIF(v_item->>'maximumNights', '')::integer,
        v_uid
      )
      ON CONFLICT (offering_id, local_date) DO UPDATE
        SET sellable_quantity = EXCLUDED.sellable_quantity,
            price_override_minor = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN EXCLUDED.price_override_minor
              ELSE public.stay_room_nights.price_override_minor
            END,
            currency_code = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN EXCLUDED.currency_code
              ELSE public.stay_room_nights.currency_code
            END,
            stop_sell = EXCLUDED.stop_sell,
            minimum_nights = EXCLUDED.minimum_nights,
            maximum_nights = EXCLUDED.maximum_nights,
            version = public.stay_room_nights.version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE v_item ? 'expectedVersion'
          AND public.stay_room_nights.version =
            (v_item->>'expectedVersion')::bigint;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
      END IF;
    END LOOP;
  ELSIF v_action = 'upsert_place_schedule' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id AND kind = 'place';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_place_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    IF (p_payload->>'localStartDate')::date
         < (now() AT TIME ZONE v_settings.timezone)::date
       OR COALESCE(
         NULLIF(p_payload->>'localEndDate', '')::date,
         (p_payload->>'localStartDate')::date
       ) > (now() AT TIME ZONE v_settings.timezone)::date
           + LEAST(
             v_settings.booking_horizon_days,
             COALESCE(
               v_offering.max_advance_days,
               v_settings.booking_horizon_days
             )
           ) THEN
      RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'scheduleRuleId' THEN
      DELETE FROM public.stay_place_windows w
      WHERE w.schedule_rule_id = (p_payload->>'scheduleRuleId')::uuid
        AND w.offering_id = v_offering_id;
      UPDATE public.stay_place_schedule_rules
        SET mode = lower(p_payload->>'mode'),
            timezone = p_payload->>'timezone',
            local_start_date = (p_payload->>'localStartDate')::date,
            local_end_date = NULLIF(p_payload->>'localEndDate', '')::date,
            weekdays = ARRAY(
              SELECT value::text::smallint
              FROM jsonb_array_elements(
                COALESCE(p_payload->'weekdays', '[]'::jsonb)
              )
            ),
            local_start_time = NULLIF(p_payload->>'localStartTime', '')::time,
            local_end_time = NULLIF(p_payload->>'localEndTime', '')::time,
            slot_duration_minutes =
              NULLIF(p_payload->>'slotDurationMinutes', '')::integer,
            slot_interval_minutes =
              NULLIF(p_payload->>'slotIntervalMinutes', '')::integer,
            full_day_start_time =
              NULLIF(p_payload->>'fullDayStartTime', '')::time,
            full_day_end_time =
              NULLIF(p_payload->>'fullDayEndTime', '')::time,
            dst_fold_policy = COALESCE(
              NULLIF(lower(p_payload->>'dstFoldPolicy'), ''),
              dst_fold_policy
            ),
            active = COALESCE((p_payload->>'active')::boolean, active),
            version = version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE id = (p_payload->>'scheduleRuleId')::uuid
          AND offering_id = v_offering_id
          AND version = p_expected_version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
      END IF;
    ELSE
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone,
        local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, slot_duration_minutes,
        slot_interval_minutes, full_day_start_time, full_day_end_time,
        dst_fold_policy, created_by, updated_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        lower(p_payload->>'mode'),
        p_payload->>'timezone',
        (p_payload->>'localStartDate')::date,
        NULLIF(p_payload->>'localEndDate', '')::date,
        ARRAY(
          SELECT value::text::smallint
          FROM jsonb_array_elements(
            COALESCE(p_payload->'weekdays', '[]'::jsonb)
          )
        ),
        NULLIF(p_payload->>'localStartTime', '')::time,
        NULLIF(p_payload->>'localEndTime', '')::time,
        NULLIF(p_payload->>'slotDurationMinutes', '')::integer,
        NULLIF(p_payload->>'slotIntervalMinutes', '')::integer,
        NULLIF(p_payload->>'fullDayStartTime', '')::time,
        NULLIF(p_payload->>'fullDayEndTime', '')::time,
        COALESCE(NULLIF(lower(p_payload->>'dstFoldPolicy'), ''), 'reject'),
        v_uid, v_uid
      );
    END IF;
  ELSIF v_action = 'materialize_place_windows' THEN
    SELECT * INTO v_rule
    FROM public.stay_place_schedule_rules
    WHERE id = (p_payload->>'scheduleRuleId')::uuid
      AND venue_id = p_venue_id
      AND active
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_schedule_rule_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_offering
    FROM public.stay_offerings o
    WHERE o.id = v_rule.offering_id AND o.venue_id = p_venue_id
    FOR UPDATE;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    v_date := GREATEST(
      v_rule.local_start_date,
      (p_payload->>'fromDate')::date
    );
    v_end_date := LEAST(
      COALESCE(v_rule.local_end_date, (p_payload->>'toDate')::date),
      (p_payload->>'toDate')::date
    );
    IF v_end_date < v_date
       OR v_end_date - v_date > LEAST(
         v_settings.booking_horizon_days,
         COALESCE(
           v_offering.max_advance_days,
           v_settings.booking_horizon_days
         )
       )
       OR v_end_date > (now() AT TIME ZONE v_settings.timezone)::date
         + LEAST(
           v_settings.booking_horizon_days,
           COALESCE(
             v_offering.max_advance_days,
             v_settings.booking_horizon_days
           )
         ) THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.stay_place_windows w
    WHERE w.schedule_rule_id = v_rule.id
      AND w.local_date BETWEEN v_date AND v_end_date;
    WHILE v_date <= v_end_date LOOP
      IF (
        v_rule.mode = 'fixed_slots' AND v_date = v_rule.local_start_date
      ) OR (
        v_rule.mode <> 'fixed_slots'
        AND extract(dow FROM v_date)::smallint = ANY(v_rule.weekdays)
      ) THEN
        IF v_rule.mode = 'full_day' THEN
          v_local_window_start := v_date + v_rule.full_day_start_time;
          v_local_window_end := v_date + v_rule.full_day_end_time;
          IF v_local_window_end <= v_local_window_start THEN
            v_local_window_end := v_local_window_end + interval '1 day';
          END IF;
        ELSE
          v_local_window_start := v_date + v_rule.local_start_time;
          v_local_window_end := v_date + v_rule.local_end_time;
          IF v_local_window_end <= v_local_window_start THEN
            v_local_window_end := v_local_window_end + interval '1 day';
          END IF;
        END IF;
        v_local_slot_start := v_local_window_start;
        v_local_slot_end := CASE
          WHEN v_rule.mode = 'repeating_windows' THEN
            v_local_slot_start
              + pg_catalog.make_interval(mins => v_rule.slot_duration_minutes)
          ELSE v_local_window_end
        END;
        WHILE v_local_slot_end <= v_local_window_end LOOP
        SELECT r.instant, r.resolution
          INTO v_start, v_start_resolution
        FROM public.issue_1387_resolve_local_timestamp(
          v_local_slot_start::date, v_local_slot_start::time,
          v_rule.timezone,
          v_rule.dst_fold_policy
        ) r;
        SELECT r.instant, r.resolution
          INTO v_end, v_end_resolution
        FROM public.issue_1387_resolve_local_timestamp(
          v_local_slot_end::date, v_local_slot_end::time,
          v_rule.timezone, v_rule.dst_fold_policy
        ) r;
        INSERT INTO public.stay_place_windows (
          offering_id, schedule_rule_id, brand_id, venue_id, local_date,
          starts_at, ends_at, sellable_units, sellable_capacity,
          dst_resolution, updated_by
        ) VALUES (
          v_rule.offering_id, v_rule.id, v_rule.brand_id, v_rule.venue_id,
          v_date, v_start, v_end,
          CASE WHEN v_offering.inventory_basis = 'exclusive_units'
            THEN v_offering.quantity ELSE NULL END,
          CASE WHEN v_offering.inventory_basis = 'shared_capacity'
            THEN v_offering.capacity ELSE NULL END,
          CASE WHEN v_start_resolution = 'unambiguous'
                    AND v_end_resolution = 'unambiguous'
            THEN 'unambiguous' ELSE v_rule.dst_fold_policy END,
          v_uid
        )
        ON CONFLICT (offering_id, starts_at, ends_at) DO UPDATE
          SET schedule_rule_id = EXCLUDED.schedule_rule_id,
              sellable_units = EXCLUDED.sellable_units,
              sellable_capacity = EXCLUDED.sellable_capacity,
              dst_resolution = EXCLUDED.dst_resolution,
              version = public.stay_place_windows.version + 1,
              updated_by = v_uid,
              updated_at = now();
          EXIT WHEN v_rule.mode <> 'repeating_windows';
          v_local_slot_start := v_local_slot_start
            + pg_catalog.make_interval(mins => v_rule.slot_interval_minutes);
          v_local_slot_end := v_local_slot_start
            + pg_catalog.make_interval(mins => v_rule.slot_duration_minutes);
        END LOOP;
      END IF;
      v_date := v_date + 1;
    END LOOP;
  ELSIF v_action = 'upsert_place_windows' THEN
    IF jsonb_array_length(
      COALESCE(p_payload->'windows', '[]'::jsonb)
    ) > 500 THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_payload->'windows', '[]'::jsonb))
    LOOP
      SELECT w.* INTO v_window
      FROM public.stay_place_windows w
      JOIN public.stay_offerings o ON o.id = w.offering_id
      WHERE w.id = (v_item->>'windowId')::uuid
        AND w.venue_id = p_venue_id
        AND o.kind = 'place'
      FOR UPDATE OF w;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_place_window_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF v_window.version <> (v_item->>'expectedVersion')::bigint THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
      END IF;
      SELECT * INTO v_offering
      FROM public.stay_offerings o
      WHERE o.id = v_window.offering_id;
      IF v_item ? 'priceOverrideMinor'
         AND NULLIF(v_item->>'priceOverrideMinor', '') IS NOT NULL THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      UPDATE public.stay_place_windows
        SET sellable_units = CASE
              WHEN v_offering.inventory_basis = 'exclusive_units'
              THEN COALESCE(
                (v_item->>'sellableUnits')::integer,
                sellable_units
              )
              ELSE NULL
            END,
            sellable_capacity = CASE
              WHEN v_offering.inventory_basis = 'shared_capacity'
              THEN COALESCE(
                (v_item->>'sellableCapacity')::integer,
                sellable_capacity
              )
              ELSE NULL
            END,
            stop_sell = COALESCE(
              (v_item->>'stopSell')::boolean, stop_sell
            ),
            price_override_minor = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN NULLIF(v_item->>'priceOverrideMinor', '')::bigint
              ELSE price_override_minor
            END,
            currency_code = CASE
              WHEN v_item ? 'priceOverrideMinor' THEN v_currency
              ELSE currency_code
            END,
            version = version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE id = v_window.id;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'stay_invalid_action' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'inventory', public.issue_1387_stay_inventory_snapshot(p_venue_id),
    'offeringId', v_offering_id,
    'requestId', p_request_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_merge_brand_people_manual(p_brand_id uuid, p_winner_person_id uuid, p_loser_person_id uuid, p_winner_version text, p_loser_version text, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid; v_hash text; v_replay jsonb; v_preview jsonb; v_merge uuid; v_sep_ids uuid[]; v_result jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,50);
  IF p_client_request_id IS NULL OR p_winner_person_id=p_loser_person_id THEN RAISE EXCEPTION 'people_merge_invalid' USING ERRCODE='22023'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('winner',p_winner_person_id,'loser',p_loser_person_id,'winnerVersion',p_winner_version,'loserVersion',p_loser_version)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  v_replay:=public.issue_1772_maintenance_replay(p_client_request_id,p_brand_id,v_actor,'manual_merge',v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.brand_people WHERE id IN (p_winner_person_id,p_loser_person_id) ORDER BY id FOR UPDATE;
  IF public.issue_1772_brand_person_version(p_winner_person_id) IS DISTINCT FROM p_winner_version
     OR public.issue_1772_brand_person_version(p_loser_person_id) IS DISTINCT FROM p_loser_version THEN
    RAISE EXCEPTION 'people_identity_stale' USING ERRCODE='PT409';
  END IF;
  v_preview:=public.biz_preview_brand_person_merge(p_brand_id,p_winner_person_id,p_loser_person_id);
  IF v_preview->>'state'='open_conflict' THEN RAISE EXCEPTION 'people_merge_open_conflict' USING ERRCODE='23514'; END IF;
  IF v_preview->>'state'='distinct_linked_users' THEN RAISE EXCEPTION 'people_merge_distinct_linked_users' USING ERRCODE='23514'; END IF;
  SELECT array_agg(s.id ORDER BY s.id) INTO v_sep_ids FROM public.brand_person_identity_separations s
  WHERE s.brand_id=p_brand_id AND s.superseded_at IS NULL AND s.separated_person_id IS NOT NULL
    AND ((s.person_id=p_winner_person_id AND s.separated_person_id=p_loser_person_id)
      OR (s.person_id=p_loser_person_id AND s.separated_person_id=p_winner_person_id));
  v_merge:=public.biz_merge_brand_people(p_winner_person_id,p_loser_person_id,'manual_resolution',NULL,v_actor);
  UPDATE public.brand_person_identity_separations SET superseded_at=now(),superseded_by=v_actor,superseded_by_merge_event_id=v_merge
    WHERE id=ANY(COALESCE(v_sep_ids,'{}'));
  UPDATE public.brand_person_merge_events SET reversal_manifest=reversal_manifest||jsonb_build_object('supersededSeparationIds',to_jsonb(COALESCE(v_sep_ids,'{}'::uuid[]))) WHERE id=v_merge;
  v_result:=jsonb_build_object('operationId',p_client_request_id,'mergeEventId',v_merge,
    'survivorPersonId',p_winner_person_id,'absorbedPersonId',p_loser_person_id,
    'identityVersion',public.issue_1772_brand_person_version(p_winner_person_id),'replayed',false);
  INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'manual_merge',v_hash,50,'completed',v_result,now());
  RETURN v_result;
END
$function$
;
CREATE OR REPLACE FUNCTION public.biz_promote_brand_person_contact(p_brand_id uuid, p_person_id uuid, p_contact_method_id uuid, p_person_version text, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid; v_hash text; v_replay jsonb; v_contact public.brand_person_contact_methods%ROWTYPE; v_outcome text; v_result jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,20);
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('person',p_person_id,'contact',p_contact_method_id,'version',p_person_version)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  v_replay:=public.issue_1772_maintenance_replay(p_client_request_id,p_brand_id,v_actor,'promote_primary',v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.brand_people WHERE id=p_person_id AND brand_id=p_brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
  IF public.issue_1772_brand_person_version(p_person_id) IS DISTINCT FROM p_person_version THEN RAISE EXCEPTION 'people_identity_stale' USING ERRCODE='PT409'; END IF;
  SELECT * INTO v_contact FROM public.brand_person_contact_methods
    WHERE id=p_contact_method_id AND brand_id=p_brand_id AND brand_person_id=p_person_id
      AND record_state='active' AND provenance_scope='brand_owned' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_contact_not_found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.brand_person_contact_methods WHERE brand_person_id=p_person_id AND channel=v_contact.channel AND record_state='active' ORDER BY id FOR UPDATE;
  IF v_contact.is_primary THEN v_outcome:='unchanged';
  ELSE
    UPDATE public.brand_person_contact_methods SET is_primary=false,updated_at=now() WHERE brand_person_id=p_person_id AND channel=v_contact.channel AND record_state='active' AND is_primary;
    UPDATE public.brand_person_contact_methods SET is_primary=true,updated_at=now() WHERE id=v_contact.id;
    UPDATE public.brand_people SET updated_at=now() WHERE id=p_person_id;
    v_outcome:='completed';
  END IF;
  v_result:=jsonb_build_object('operationId',p_client_request_id,'outcome',v_outcome,'personId',p_person_id,
    'contactMethodId',p_contact_method_id,'channel',v_contact.channel,
    'identityVersion',public.issue_1772_brand_person_version(p_person_id),'replayed',false);
  INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'promote_primary',v_hash,20,v_outcome,v_result,now());
  RETURN v_result;
END
$function$
;
CREATE OR REPLACE FUNCTION public.biz_publish_stay(p_venue_id uuid, p_expected_version bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_default_currency character(3);
  v_authoring_enabled boolean := false;
  v_ready_offering_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(flag.is_enabled, false)
  INTO v_authoring_enabled
  FROM public.feature_flags flag
  WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
  IF NOT COALESCE(v_authoring_enabled, false) THEN
    RAISE EXCEPTION 'stay_authoring_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'stay_venue_not_approved' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND OR p_expected_version IS NULL
     OR v_settings.version <> p_expected_version
     OR char_length(pg_catalog.btrim(COALESCE(v_settings.summary, ''))) < 20
     OR v_settings.check_in_time = v_settings.check_out_time THEN
    RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
  END IF;
  -- #3645 PR11d — stay publish requires a current price → always paid.
  PERFORM public.biz_require_current_organiser_terms(v_venue.brand_id);
  SELECT brand.default_currency
  INTO v_default_currency
  FROM public.brands brand
  WHERE brand.id = v_venue.brand_id
  FOR UPDATE;
  IF v_default_currency IS NULL
     OR NOT public.pg_brand_can_collect(v_venue.brand_id)
     OR EXISTS (
       SELECT 1
       FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_venue.brand_id
         AND reconciliation.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.array_agg(offering.id ORDER BY offering.id)
  INTO v_ready_offering_ids
  FROM public.stay_offerings offering
  WHERE offering.venue_id = p_venue_id
    AND offering.status IN ('draft', 'live')
    AND pg_catalog.btrim(offering.description) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.stay_price_versions price
      WHERE price.offering_id = offering.id
        AND price.effective_to IS NULL
        AND price.currency_code = v_default_currency
    )
    AND EXISTS (
      SELECT 1
      FROM public.stay_policy_versions policy
      WHERE policy.offering_id = offering.id
        AND policy.effective_to IS NULL
    )
    AND (
      SELECT count(*)
      FROM public.stay_offering_media media
      WHERE media.offering_id = offering.id
        AND media.status = 'ready'
        AND media.is_cover
    ) = 1
    AND (
      offering.unit_naming_mode <> 'named'
      OR (
        SELECT count(*)
        FROM public.stay_units unit_row
        WHERE unit_row.offering_id = offering.id
          AND unit_row.status = 'active'
      ) = offering.quantity
    )
    AND (
      (
        offering.kind = 'room'
        AND EXISTS (
          SELECT 1
          FROM public.stay_room_nights night
          WHERE night.offering_id = offering.id
            AND NOT night.stop_sell
            AND night.sellable_quantity > 0
            AND night.local_date >=
              (now() AT TIME ZONE v_settings.timezone)::date
        )
      )
      OR (
        offering.kind = 'place'
        AND EXISTS (
          SELECT 1
          FROM public.stay_place_windows place_window
          WHERE place_window.offering_id = offering.id
            AND NOT place_window.stop_sell
            AND COALESCE(
              place_window.sellable_units,
              place_window.sellable_capacity,
              0
            ) > 0
            AND place_window.ends_at > now()
        )
      )
    );
  IF cardinality(COALESCE(v_ready_offering_ids, '{}'::uuid[])) = 0 THEN
    RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('mingla.stay_publish_authorized', 'true', true);
  UPDATE public.stay_settings
  SET booking_state = 'active',
      version = version + 1,
      updated_by = v_uid,
      updated_at = now()
  WHERE venue_id = p_venue_id
    AND version = p_expected_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_offerings
  SET status = 'live',
      version = version + 1,
      updated_by = v_uid,
      updated_at = now()
  WHERE id = ANY(v_ready_offering_ids)
    AND status = 'draft';
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  INSERT INTO public.audit_log (
    user_id,
    brand_id,
    action,
    target_type,
    target_id,
    before,
    after
  ) VALUES (
    v_uid,
    v_venue.brand_id,
    'stay.publish',
    'stay',
    p_venue_id,
    jsonb_build_object('bookingState', v_settings.booking_state),
    jsonb_build_object(
      'bookingState',
      'active',
      'offeringIds',
      v_ready_offering_ids
    )
  );
  RETURN jsonb_build_object(
    'inventory',
    public.issue_1387_stay_inventory_snapshot(p_venue_id)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(p_event_id uuid, p_expected_updated_at timestamp with time zone, p_operation_id uuid, p_invite_selection_revision bigint, p_invite_selection_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_begin jsonb; v_result jsonb; v_start timestamptz;
  v_end timestamptz; v_payload jsonb; v_command_payload jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_event.event_type<>'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);
  v_command_payload:=jsonb_build_object('expected_updated_at',p_expected_updated_at);
  IF p_invite_selection_revision IS NOT NULL OR COALESCE(p_invite_selection_confirmed,false) THEN
    v_command_payload:=v_command_payload||jsonb_build_object(
      'invite_selection_revision',p_invite_selection_revision,
      'invite_selection_confirmed',COALESCE(p_invite_selection_confirmed,false));
  END IF;
  v_begin:=public.biz_trip_command_begin(
    p_operation_id,'publish_trip',v_event.brand_id,p_event_id,v_command_payload);
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;
  IF p_expected_updated_at IS NULL OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE='PT409';
  END IF;
  SELECT start_at,end_at INTO v_start,v_end FROM public.event_dates
    WHERE event_id=p_event_id AND is_master=true ORDER BY start_at LIMIT 1;
  v_payload:=jsonb_build_object(
    'title',v_event.title,'description',v_event.description,'timezone',v_event.timezone,
    'cover_media_url',v_event.cover_media_url,'cover_media_poster_url',v_event.cover_media_poster_url,
    'cover_media_type',v_event.cover_media_type,'cover_media_provider',v_event.cover_media_provider,
    'cover_media_source_url',v_event.cover_media_source_url,'cover_media_credit',v_event.cover_media_credit,
    'cover_media_credit_url',v_event.cover_media_credit_url,'cover_media_alt',v_event.cover_media_alt,
    'cover_media_gallery',v_event.cover_media_gallery,
    'theme',jsonb_set(COALESCE(v_event.theme,'{}'::jsonb),'{business_trip}',
      COALESCE(v_event.theme->'business_trip','{}'::jsonb)||jsonb_build_object(
        'destinationLocationText',v_event.destination_text,'departureLocationText',v_event.departure_text,
        -- issue #3801: the master event_dates row is the owner. A draft that
        -- has none (saved before the row was kept in step, or seeded with
        -- dates at create) falls back to the dates already stored in its
        -- theme instead of having them overwritten with null. start_at and
        -- end_at are both NOT NULL, so the pair always comes from one source.
        'startAt',COALESCE(to_jsonb(v_start),v_event.theme#>'{business_trip,startAt}'),
        'endAt',COALESCE(to_jsonb(v_end),v_event.theme#>'{business_trip,endAt}')),true));
  v_result:=public.issue_1719_publish_trip_with_poster(p_event_id,v_payload,NULL);
  IF COALESCE((v_result->>'ok')::boolean,true) THEN
    v_result:=v_result||jsonb_build_object(
      'graph',public.biz_get_trip_draft_graph(p_event_id),
      'revision',(SELECT updated_at FROM public.events WHERE id=p_event_id))
      ||private.enqueue_wizard_invites_on_publish_v1(
        p_event_id,p_invite_selection_revision,p_invite_selection_confirmed);
  END IF;
  RETURN public.biz_trip_command_finish(p_operation_id,v_result);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_reorder_menu_items_v1(p_brand_id uuid, p_venue_id uuid, p_menu_id uuid, p_expected_items jsonb, p_ordered_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_menu public.menus%ROWTYPE;
  v_expected jsonb;
  v_expected_id uuid;
  v_expected_sort_bigint bigint;
  v_expected_ids uuid[] := ARRAY[]::uuid[];
  v_expected_sorts integer[] := ARRAY[]::integer[];
  v_expected_keys text[];
  v_current_ids uuid[] := ARRAY[]::uuid[];
  v_current_order uuid[] := ARRAY[]::uuid[];
  v_current_contiguous boolean := true;
  v_row_count integer := 0;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, v_uid)
        < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'menu_item_reorder_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_venue_id IS NULL OR p_menu_id IS NULL THEN
    RAISE EXCEPTION 'menu_item_reorder_scope_required' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_expected_items) IS DISTINCT FROM 'array'
     OR p_ordered_item_ids IS NULL THEN
    RAISE EXCEPTION 'menu_item_reorder_complete_arrays_required'
      USING ERRCODE = '22023';
  END IF;
  -- Lock the exact parent before any child rows. Scope mismatches are permission
  -- failures so a caller cannot probe another brand or venue by UUID.
  SELECT candidate.*
    INTO v_menu
    FROM public.menus candidate
   WHERE candidate.id = p_menu_id
     AND candidate.brand_id = p_brand_id
     AND candidate.venue_id = p_venue_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_item_reorder_scope_forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Every current child is locked in deterministic UUID order before the
  -- complete-set and expected-position snapshots are examined.
  PERFORM current_item.id
    FROM public.menu_items current_item
   WHERE current_item.menu_id = p_menu_id
   ORDER BY current_item.id
   FOR UPDATE;

  -- menu_items has independent brand and menu foreign keys, so a malformed
  -- legacy/direct writer can create a child whose brand disagrees with its
  -- parent. Never expose or rewrite that row through this definer function.
  IF EXISTS (
    SELECT 1
      FROM public.menu_items current_item
     WHERE current_item.menu_id = p_menu_id
       AND current_item.brand_id IS DISTINCT FROM p_brand_id
  ) THEN
    RAISE EXCEPTION 'menu_item_reorder_child_scope_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.array_position(p_ordered_item_ids, NULL::uuid) IS NOT NULL
     OR pg_catalog.cardinality(p_ordered_item_ids) IS DISTINCT FROM (
       SELECT pg_catalog.count(DISTINCT desired_id)::integer
         FROM pg_catalog.unnest(p_ordered_item_ids) AS desired_id
     ) THEN
    RAISE EXCEPTION 'menu_item_reorder_desired_ids_invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR v_expected IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_expected_items)
  LOOP
    IF pg_catalog.jsonb_typeof(v_expected) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'menu_item_reorder_expected_object_required'
        USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(key ORDER BY key)
      INTO v_expected_keys
      FROM pg_catalog.jsonb_object_keys(v_expected) AS key;
    IF v_expected_keys IS DISTINCT FROM ARRAY['id', 'sort_order']::text[]
       OR pg_catalog.jsonb_typeof(v_expected->'id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_expected->'sort_order') IS DISTINCT FROM 'number'
       OR (v_expected->>'sort_order') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'menu_item_reorder_expected_shape_invalid'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_expected_id := (v_expected->>'id')::uuid;
      v_expected_sort_bigint := (v_expected->>'sort_order')::bigint;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'menu_item_reorder_expected_value_invalid'
          USING ERRCODE = '22023';
    END;
    IF v_expected_sort_bigint NOT BETWEEN -2147483648 AND 2147483647
       OR v_expected_id = ANY(v_expected_ids) THEN
      RAISE EXCEPTION 'menu_item_reorder_expected_value_invalid'
        USING ERRCODE = '22023';
    END IF;
    v_expected_ids := pg_catalog.array_append(v_expected_ids, v_expected_id);
    v_expected_sorts := pg_catalog.array_append(
      v_expected_sorts,
      v_expected_sort_bigint::integer
    );
  END LOOP;

  SELECT COALESCE(pg_catalog.array_agg(item.id ORDER BY item.id), ARRAY[]::uuid[])
    INTO v_current_ids
    FROM public.menu_items item
   WHERE item.menu_id = p_menu_id
     AND item.brand_id = p_brand_id;

  SELECT COALESCE(
           pg_catalog.array_agg(ordered.id ORDER BY ordered.sort_order, ordered.name, ordered.id),
           ARRAY[]::uuid[]
         ),
         COALESCE(pg_catalog.bool_and(ordered.sort_order = ordered.position - 1), true)
    INTO v_current_order, v_current_contiguous
    FROM (
      SELECT item.id,
             item.name,
             item.sort_order,
             pg_catalog.row_number() OVER (
               ORDER BY item.sort_order, item.name, item.id
             )::integer AS position
        FROM public.menu_items item
       WHERE item.menu_id = p_menu_id
         AND item.brand_id = p_brand_id
    ) ordered;

  -- A client payload whose expected and desired sets disagree is malformed.
  IF pg_catalog.cardinality(v_expected_ids) IS DISTINCT FROM pg_catalog.cardinality(p_ordered_item_ids)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(v_expected_ids) AS expected_id
        WHERE NOT (expected_id = ANY(p_ordered_item_ids))
     ) THEN
    RAISE EXCEPTION 'menu_item_reorder_complete_set_required'
      USING ERRCODE = '22023';
  END IF;

  -- Once the two client arrays are internally complete, a difference from
  -- locked membership is a stale/membership race, not malformed input.
  IF pg_catalog.cardinality(p_ordered_item_ids) IS DISTINCT FROM pg_catalog.cardinality(v_current_ids)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(v_current_ids) AS current_id
        WHERE NOT (current_id = ANY(p_ordered_item_ids))
     ) THEN
    RAISE EXCEPTION 'menu_item_reorder_conflict' USING ERRCODE = 'PT409';
  END IF;

  -- A successfully-applied request may have lost its response. Once the exact
  -- desired order is already present and contiguous, replay succeeds even when
  -- the caller's old expected positions no longer match.
  IF v_current_contiguous AND v_current_order = p_ordered_item_ids THEN
    SELECT pg_catalog.jsonb_build_object(
             'brand_id', p_brand_id,
             'venue_id', p_venue_id,
             'menu_id', p_menu_id,
             'items', COALESCE(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', item.id,
                 'sort_order', item.sort_order
               ) ORDER BY item.sort_order, item.name, item.id
             ), '[]'::jsonb)
           )
      INTO v_result
      FROM public.menu_items item
     WHERE item.menu_id = p_menu_id
       AND item.brand_id = p_brand_id;
    RETURN v_result;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ROWS FROM (
             pg_catalog.unnest(v_expected_ids),
             pg_catalog.unnest(v_expected_sorts)
           ) AS expected(id, sort_order)
      JOIN public.menu_items current_item ON current_item.id = expected.id
     WHERE current_item.menu_id = p_menu_id
       AND current_item.brand_id = p_brand_id
       AND current_item.sort_order IS DISTINCT FROM expected.sort_order
  ) THEN
    RAISE EXCEPTION 'menu_item_reorder_conflict' USING ERRCODE = 'PT409';
  END IF;

  WITH desired AS (
    SELECT requested.id, requested.ordinality::integer - 1 AS sort_order
      FROM pg_catalog.unnest(p_ordered_item_ids) WITH ORDINALITY
           AS requested(id, ordinality)
  )
  UPDATE public.menu_items item
     SET sort_order = desired.sort_order
    FROM desired
   WHERE item.id = desired.id
     AND item.menu_id = p_menu_id
     AND item.brand_id = p_brand_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count IS DISTINCT FROM pg_catalog.cardinality(v_current_ids) THEN
    RAISE EXCEPTION 'menu_item_reorder_conflict' USING ERRCODE = 'PT409';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
           'brand_id', p_brand_id,
           'venue_id', p_venue_id,
           'menu_id', p_menu_id,
           'items', COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', item.id,
               'sort_order', item.sort_order
             ) ORDER BY item.sort_order, item.name, item.id
           ), '[]'::jsonb)
         )
    INTO v_result
    FROM public.menu_items item
   WHERE item.menu_id = p_menu_id
     AND item.brand_id = p_brand_id;

  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_replace_offering_invite_plan_v1(p_event_id uuid, p_selection jsonb, p_expected_revision bigint, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_plan_id uuid;
  v_ids uuid[] := '{}'; v_explicit uuid[] := '{}'; v_excluded uuid[] := '{}';
  v_groups uuid[] := '{}'; v_everyone boolean; v_followers boolean; v_friends boolean;
  v_request_hash text; v_legacy_hash text;
  v_prior private.brand_offering_invite_mutation_receipts%ROWTYPE; v_result jsonb;
  v_rings text[] := '{}'; v_keys text[]; v_flags boolean;
  v_raw_selection jsonb; v_legacy_shape boolean := false;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, v_actor);
  IF p_client_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR jsonb_typeof(p_selection) <> 'object' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  v_raw_selection := p_selection;
  v_keys := ARRAY(SELECT jsonb_object_keys(p_selection) ORDER BY 1);
  IF v_keys = ARRAY[
       'excludedPersonIds', 'includeEveryone', 'manualGroupIds', 'personIds'
     ]::text[] THEN
    v_legacy_shape := true;
    p_selection := p_selection || jsonb_build_object(
      'includeFollowers', false,
      'includeFriendsOfFollowers', false);
  ELSIF v_keys <> ARRAY[
       'excludedPersonIds',
       'includeEveryone',
       'includeFollowers',
       'includeFriendsOfFollowers',
       'manualGroupIds',
       'personIds'
     ]::text[] THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_selection -> 'manualGroupIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'personIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'excludedPersonIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'includeEveryone') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFollowers') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFriendsOfFollowers') <> 'boolean' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_explicit
      FROM jsonb_array_elements_text(p_selection -> 'personIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_groups
      FROM jsonb_array_elements_text(p_selection -> 'manualGroupIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_excluded
      FROM jsonb_array_elements_text(p_selection -> 'excludedPersonIds') x;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END;
  v_everyone := (p_selection ->> 'includeEveryone')::boolean;
  v_followers := (p_selection ->> 'includeFollowers')::boolean;
  v_friends := (p_selection ->> 'includeFriendsOfFollowers')::boolean;
  IF v_followers THEN
    v_rings := array_append(v_rings, 'follower');
  END IF;
  IF v_friends THEN
    v_rings := array_append(v_rings, 'extended');
  END IF;
  v_request_hash := encode(extensions.digest(convert_to(
    jsonb_build_object('expectedRevision', p_expected_revision, 'selection', p_selection)::text, 'UTF8'), 'sha256'), 'hex');
  IF v_legacy_shape THEN
    v_legacy_hash := encode(extensions.digest(convert_to(
      jsonb_build_object('expectedRevision', p_expected_revision, 'selection', v_raw_selection)::text, 'UTF8'), 'sha256'), 'hex');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1780));
  SELECT * INTO v_prior FROM private.brand_offering_invite_mutation_receipts
    WHERE event_id = p_event_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_prior.actor_id = v_actor AND (
         v_prior.request_hash = v_request_hash
         OR (v_legacy_shape AND v_prior.request_hash = v_legacy_hash)
       ) THEN
      RETURN v_prior.response_json || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'wizard_invite_idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  IF v_scope.event_deleted OR v_scope.event_status <> 'draft' OR v_scope.event_visibility <> 'draft' THEN
    RAISE EXCEPTION 'wizard_invite_offering_not_draft' USING ERRCODE = '55000';
  END IF;
  IF NOT COALESCE((SELECT is_enabled FROM public.feature_flags
      WHERE flag_key = 'business_wizard_invite_selection_v1'), false) THEN
    RAISE EXCEPTION 'wizard_invite_feature_disabled' USING ERRCODE = '55000';
  END IF;
  IF v_followers THEN
    SELECT count(*) = 1 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags WHERE flag_key = 'brand_circle_followers_v1';
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_friends THEN
    SELECT count(*) = 3 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags
     WHERE flag_key IN (
       'brand_circle_extended_v1',
       'brand_circle_extended_controls_ios_v1',
       'brand_circle_extended_controls_android_v1');
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_groups) gid LEFT JOIN public.marketing_audiences a
      ON a.id = gid AND a.brand_id = v_scope.brand_id AND a.deleted_at IS NULL
      AND NOT a.is_system_generated AND a.query_definition = '{"kind":"manual_group"}'::jsonb
      WHERE a.id IS NULL)
     OR EXISTS(SELECT 1 FROM unnest(v_explicit || v_excluded) pid LEFT JOIN public.brand_people bp
      ON bp.id = pid AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active' WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_ids FROM (
    SELECT bp.id FROM public.brand_people bp
      WHERE v_everyone AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM unnest(v_explicit) requested(id)
      JOIN public.brand_people bp ON bp.id = requested.id AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM public.marketing_manual_group_memberships gm
      JOIN public.brand_people bp ON bp.id = gm.brand_person_id AND bp.brand_id = gm.brand_id AND bp.record_status = 'active'
      WHERE gm.audience_id = ANY (v_groups) AND gm.brand_id = v_scope.brand_id AND gm.state = 'active'
    UNION
    SELECT person_id FROM private.issue_3682_circle_invite_person_ids(v_scope.brand_id, v_rings) person_id
  ) selected WHERE NOT (id = ANY (v_excluded));
  IF cardinality(v_ids) > 500 THEN RAISE EXCEPTION 'wizard_invite_selection_too_large' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans WHERE event_id = p_event_id FOR UPDATE;
  IF FOUND AND v_plan.state = 'locked' THEN RAISE EXCEPTION 'wizard_invite_plan_locked' USING ERRCODE = '55000'; END IF;
  IF COALESCE(v_plan.selection_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('currentRevision', COALESCE(v_plan.selection_revision, 0))::text;
  END IF;
  INSERT INTO private.brand_offering_invite_plans(
    event_id, brand_id, event_type, selection_revision, selection_hash, created_by, updated_by)
  VALUES (p_event_id, v_scope.brand_id, v_scope.event_type, p_expected_revision + 1,
    private.issue_1780_selection_hash(v_ids), v_actor, v_actor)
  ON CONFLICT (event_id) DO UPDATE SET
    selection_revision = EXCLUDED.selection_revision,
    selection_hash = EXCLUDED.selection_hash, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING id INTO v_plan_id;
  DELETE FROM private.brand_offering_invite_plan_members
  WHERE plan_id = v_plan_id;
  INSERT INTO private.brand_offering_invite_plan_members(
    plan_id, brand_person_id, added_by)
  SELECT v_plan_id, id, v_actor FROM unnest(v_ids) selected(id);
  v_result := private.issue_1780_plan_response(p_event_id) || jsonb_build_object('replayed', false);
  INSERT INTO private.brand_offering_invite_mutation_receipts(event_id, client_request_id, actor_id, request_hash, response_json)
    VALUES (p_event_id, p_client_request_id, v_actor, v_request_hash, v_result);
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_save_menu_modifier_group_v1(p_brand_id uuid, p_menu_item_id uuid, p_group_id uuid, p_name text, p_selection_mode text, p_min_select integer, p_max_select integer, p_sort_order integer, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.menu_items%ROWTYPE;
  v_group public.menu_modifier_groups%ROWTYPE;
  v_group_exists boolean := false;
  v_option jsonb;
  v_option_id uuid;
  v_option_ids uuid[] := ARRAY[]::uuid[];
  v_sort_orders integer[] := ARRAY[]::integer[];
  v_keys text[];
  v_name text;
  v_delta bigint;
  v_sort integer;
  v_option_count integer;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, v_uid)
        < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'modifier_group_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'modifier_group_identity_required' USING ERRCODE = '22023';
  END IF;

  SELECT item.*
    INTO v_item
    FROM public.menu_items item
   WHERE item.id = p_menu_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_item_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_item.brand_id IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'menu_item_brand_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT modifier_group.*
    INTO v_group
    FROM public.menu_modifier_groups modifier_group
   WHERE modifier_group.id = p_group_id
   FOR UPDATE;
  IF FOUND THEN
    v_group_exists := true;
    IF v_group.brand_id IS DISTINCT FROM p_brand_id
       OR v_group.menu_item_id IS DISTINCT FROM p_menu_item_id THEN
      RAISE EXCEPTION 'modifier_group_scope_mismatch' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Current children lock after the parent locks, in deterministic ID order.
  PERFORM current_option.id
    FROM public.menu_modifiers current_option
   WHERE current_option.group_id = p_group_id
   ORDER BY current_option.id
   FOR UPDATE;

  v_name := pg_catalog.btrim(p_name);
  IF v_name IS NULL OR pg_catalog.length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'modifier_group_name_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_selection_mode NOT IN ('single', 'multi') THEN
    RAISE EXCEPTION 'modifier_group_selection_mode_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_min_select IS NULL OR p_min_select NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'modifier_group_min_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_max_select IS NOT NULL AND p_max_select NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'modifier_group_max_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_sort_order IS NULL OR p_sort_order < 0 THEN
    RAISE EXCEPTION 'modifier_group_sort_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_selection_mode = 'single'
     AND (p_min_select > 1 OR (p_max_select IS NOT NULL AND p_max_select <> 1)) THEN
    RAISE EXCEPTION 'modifier_group_single_bounds_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_selection_mode = 'multi'
     AND p_max_select IS NOT NULL
     AND p_max_select < p_min_select THEN
    RAISE EXCEPTION 'modifier_group_multi_bounds_invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_options) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_options) = 0 THEN
    RAISE EXCEPTION 'modifier_options_nonempty_array_required' USING ERRCODE = '22023';
  END IF;

  v_option_count := pg_catalog.jsonb_array_length(p_options);
  IF p_min_select > v_option_count THEN
    RAISE EXCEPTION 'modifier_group_min_exceeds_options' USING ERRCODE = '22023';
  END IF;

  FOR v_option IN SELECT value FROM pg_catalog.jsonb_array_elements(p_options) LOOP
    IF pg_catalog.jsonb_typeof(v_option) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'modifier_option_object_required' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(key ORDER BY key)
      INTO v_keys
      FROM pg_catalog.jsonb_object_keys(v_option) AS key;
    IF v_keys IS DISTINCT FROM ARRAY['id','name','price_delta_cents','sort_order']::text[] THEN
      RAISE EXCEPTION 'modifier_option_keys_invalid' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_typeof(v_option->'id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_option->'name') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_option->'price_delta_cents') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(v_option->'sort_order') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'modifier_option_types_invalid' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_option_id := (v_option->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'modifier_option_id_invalid' USING ERRCODE = '22023';
    END;
    IF v_option_id = ANY(v_option_ids) THEN
      RAISE EXCEPTION 'modifier_option_id_duplicate' USING ERRCODE = '22023';
    END IF;
    v_option_ids := pg_catalog.array_append(v_option_ids, v_option_id);

    v_name := pg_catalog.btrim(v_option->>'name');
    IF pg_catalog.length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'modifier_option_name_invalid' USING ERRCODE = '22023';
    END IF;
    IF (v_option->>'price_delta_cents') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'modifier_option_delta_invalid' USING ERRCODE = '22023';
    END IF;
    v_delta := (v_option->>'price_delta_cents')::bigint;
    IF v_delta NOT BETWEEN -100000000 AND 100000000 THEN
      RAISE EXCEPTION 'modifier_option_delta_invalid' USING ERRCODE = '22023';
    END IF;
    IF (v_option->>'sort_order') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'modifier_option_sort_invalid' USING ERRCODE = '22023';
    END IF;
    v_sort := (v_option->>'sort_order')::integer;
    IF v_sort = ANY(v_sort_orders) THEN
      RAISE EXCEPTION 'modifier_option_sort_duplicate' USING ERRCODE = '22023';
    END IF;
    v_sort_orders := pg_catalog.array_append(v_sort_orders, v_sort);

    -- An existing UUID from another group/brand is never adoptable.
    IF EXISTS (
      SELECT 1
        FROM public.menu_modifiers existing_option
       WHERE existing_option.id = v_option_id
         AND (existing_option.group_id IS DISTINCT FROM p_group_id
              OR existing_option.brand_id IS DISTINCT FROM p_brand_id)
    ) THEN
      RAISE EXCEPTION 'modifier_option_scope_mismatch' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.min(sort_value) FROM pg_catalog.unnest(v_sort_orders) sort_value) <> 0
     OR (SELECT pg_catalog.max(sort_value) FROM pg_catalog.unnest(v_sort_orders) sort_value)
        <> v_option_count - 1 THEN
    RAISE EXCEPTION 'modifier_option_sort_not_contiguous' USING ERRCODE = '22023';
  END IF;

  IF v_group_exists THEN
    UPDATE public.menu_modifier_groups
       SET name = pg_catalog.btrim(p_name),
           selection_mode = p_selection_mode,
           min_select = p_min_select,
           max_select = p_max_select,
           is_active = true,
           sort_order = p_sort_order
     WHERE id = p_group_id;
  ELSE
    INSERT INTO public.menu_modifier_groups (
      id, brand_id, menu_item_id, name, selection_mode,
      min_select, max_select, is_active, sort_order
    ) VALUES (
      p_group_id, p_brand_id, p_menu_item_id, pg_catalog.btrim(p_name),
      p_selection_mode, p_min_select, p_max_select, true, p_sort_order
    ) ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'modifier_group_identity_race_retry'
        USING ERRCODE = 'PT409';
    END IF;
  END IF;

  FOR v_option IN SELECT value FROM pg_catalog.jsonb_array_elements(p_options) LOOP
    INSERT INTO public.menu_modifiers (
      id, group_id, brand_id, name, price_delta_cents,
      currency, is_available, sort_order
    ) VALUES (
      (v_option->>'id')::uuid,
      p_group_id,
      p_brand_id,
      pg_catalog.btrim(v_option->>'name'),
      (v_option->>'price_delta_cents')::integer,
      v_item.currency,
      true,
      (v_option->>'sort_order')::integer
    )
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          price_delta_cents = EXCLUDED.price_delta_cents,
          currency = EXCLUDED.currency,
          is_available = true,
          sort_order = EXCLUDED.sort_order
      WHERE public.menu_modifiers.group_id = EXCLUDED.group_id
        AND public.menu_modifiers.brand_id = EXCLUDED.brand_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'modifier_option_identity_race_retry'
        USING ERRCODE = 'PT409';
    END IF;
  END LOOP;

  UPDATE public.menu_modifiers omitted
     SET is_available = false
   WHERE omitted.group_id = p_group_id
     AND omitted.brand_id = p_brand_id
     AND NOT (omitted.id = ANY(v_option_ids))
     AND EXISTS (
       SELECT 1
         FROM public.venue_order_item_modifiers history
        WHERE history.menu_modifier_id = omitted.id
     );

  DELETE FROM public.menu_modifiers omitted
   WHERE omitted.group_id = p_group_id
     AND omitted.brand_id = p_brand_id
     AND NOT (omitted.id = ANY(v_option_ids))
     AND NOT EXISTS (
       SELECT 1
         FROM public.venue_order_item_modifiers history
        WHERE history.menu_modifier_id = omitted.id
     );

  SELECT pg_catalog.jsonb_build_object(
           'id', saved_group.id,
           'menu_item_id', saved_group.menu_item_id,
           'name', saved_group.name,
           'selection_mode', saved_group.selection_mode,
           'min_select', saved_group.min_select,
           'max_select', saved_group.max_select,
           'is_active', saved_group.is_active,
           'sort_order', saved_group.sort_order,
           'modifiers', COALESCE((
             SELECT pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'id', saved_option.id,
                        'group_id', saved_option.group_id,
                        'name', saved_option.name,
                        'price_delta_cents', saved_option.price_delta_cents,
                        'currency', saved_option.currency,
                        'is_available', saved_option.is_available,
                        'sort_order', saved_option.sort_order
                      )
                      ORDER BY saved_option.sort_order,
                               saved_option.name,
                               saved_option.id
                    )
               FROM public.menu_modifiers saved_option
              WHERE saved_option.group_id = saved_group.id
                AND saved_option.is_available
           ), '[]'::jsonb)
         )
    INTO v_result
    FROM public.menu_modifier_groups saved_group
   WHERE saved_group.id = p_group_id
     AND saved_group.brand_id = p_brand_id
     AND saved_group.menu_item_id = p_menu_item_id;

  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_save_stay_settings_v2(p_venue_id uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_existing public.stay_settings%ROWTYPE;
  v_timezone text;
  v_check_in time;
  v_check_out time;
  v_amenities text[];
  v_accessibility text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  SELECT * INTO v_existing
  FROM public.stay_settings
  WHERE venue_id = p_venue_id
  FOR UPDATE;
  IF FOUND AND (
    p_expected_version IS NULL OR v_existing.version <> p_expected_version
  ) THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF NOT FOUND AND p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  v_timezone := COALESCE(
    NULLIF(pg_catalog.btrim(p_payload->>'timezone'), ''),
    'UTC'
  );
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names timezone_row
    WHERE timezone_row.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'stay_invalid_timezone' USING ERRCODE = '22023';
  END IF;
  v_check_in := COALESCE(
    NULLIF(p_payload->>'checkInTime', '')::time,
    '15:00'::time
  );
  v_check_out := COALESCE(
    NULLIF(p_payload->>'checkOutTime', '')::time,
    '11:00'::time
  );
  IF v_check_in = v_check_out THEN
    RAISE EXCEPTION 'stay_invalid_arrival_times' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'amenities', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(
       COALESCE(p_payload->'accessibilityFeatures', '[]'::jsonb)
     ) <> 'array' THEN
    RAISE EXCEPTION 'stay_invalid_settings' USING ERRCODE = '22023';
  END IF;
  v_amenities := ARRAY(
    SELECT DISTINCT pg_catalog.btrim(value)
    FROM jsonb_array_elements_text(
      COALESCE(p_payload->'amenities', '[]'::jsonb)
    )
    WHERE pg_catalog.btrim(value) <> ''
    ORDER BY pg_catalog.btrim(value)
  );
  v_accessibility := ARRAY(
    SELECT DISTINCT pg_catalog.btrim(value)
    FROM jsonb_array_elements_text(
      COALESCE(p_payload->'accessibilityFeatures', '[]'::jsonb)
    )
    WHERE pg_catalog.btrim(value) <> ''
    ORDER BY pg_catalog.btrim(value)
  );
  IF cardinality(v_amenities) > 50
     OR cardinality(v_accessibility) > 50 THEN
    RAISE EXCEPTION 'stay_invalid_settings' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stay_settings (
    venue_id,
    brand_id,
    property_kind,
    summary,
    amenities,
    accessibility_features,
    arrival_instructions,
    timezone,
    default_booking_mode,
    check_in_time,
    check_out_time,
    instant_payment_hold_minutes,
    request_response_hours,
    approved_payment_minutes,
    booking_horizon_days,
    booking_state,
    house_rules,
    created_by,
    updated_by
  ) VALUES (
    p_venue_id,
    v_venue.brand_id,
    NULLIF(lower(pg_catalog.btrim(p_payload->>'propertyKind')), ''),
    NULLIF(pg_catalog.btrim(p_payload->>'summary'), ''),
    v_amenities,
    v_accessibility,
    NULLIF(pg_catalog.btrim(p_payload->>'arrivalInstructions'), ''),
    v_timezone,
    COALESCE(
      NULLIF(lower(pg_catalog.btrim(p_payload->>'defaultBookingMode')), ''),
      'request'
    ),
    v_check_in,
    v_check_out,
    COALESCE((p_payload->>'instantPaymentHoldMinutes')::smallint, 15),
    COALESCE((p_payload->>'requestResponseHours')::smallint, 24),
    COALESCE((p_payload->>'approvedPaymentMinutes')::smallint, 30),
    COALESCE((p_payload->>'bookingHorizonDays')::smallint, 365),
    'review',
    NULLIF(pg_catalog.btrim(p_payload->>'houseRules'), ''),
    v_uid,
    v_uid
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET property_kind = EXCLUDED.property_kind,
      summary = EXCLUDED.summary,
      amenities = EXCLUDED.amenities,
      accessibility_features = EXCLUDED.accessibility_features,
      arrival_instructions = EXCLUDED.arrival_instructions,
      timezone = EXCLUDED.timezone,
      default_booking_mode = EXCLUDED.default_booking_mode,
      check_in_time = EXCLUDED.check_in_time,
      check_out_time = EXCLUDED.check_out_time,
      instant_payment_hold_minutes = EXCLUDED.instant_payment_hold_minutes,
      request_response_hours = EXCLUDED.request_response_hours,
      approved_payment_minutes = EXCLUDED.approved_payment_minutes,
      booking_horizon_days = EXCLUDED.booking_horizon_days,
      booking_state = CASE
        WHEN public.stay_settings.booking_state = 'active'
          THEN 'active'
        ELSE 'review'
      END,
      house_rules = EXCLUDED.house_rules,
      version = public.stay_settings.version + 1,
      updated_by = v_uid,
      updated_at = now();

  RETURN jsonb_build_object(
    'inventory',
    public.issue_1387_stay_inventory_snapshot(p_venue_id)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_soft_delete_trip(p_event_id uuid, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1971));
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_event.event_type <> 'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'delete_trip', v_event.brand_id, p_event_id,
    jsonb_build_object('expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = 'PT409';
  END IF;

  -- Every payment rail, not just the web ones.
  IF EXISTS (
    SELECT 1 FROM public.orders
     WHERE event_id = p_event_id
       AND payment_status NOT IN ('failed', 'cancelled')
  ) THEN
    v_result := jsonb_build_object(
      'id', p_event_id, 'deleted', false, 'rejected', true,
      'reason', 'has_confirmed_orders', 'prior_status', v_event.status);
    RETURN public.biz_trip_command_finish(p_operation_id, v_result);
  END IF;

  UPDATE public.events SET deleted_at = now(), updated_at = now() WHERE id = p_event_id;
  v_result := jsonb_build_object(
    'id', p_event_id, 'deleted', true, 'rejected', false,
    'prior_status', v_event.status);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_update_trip_live_command(p_event_id uuid, p_patch jsonb, p_reason text, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_forward jsonb := '{}'::jsonb;
  v_item jsonb;
  v_dates jsonb;
  v_ticket_type uuid;
  v_business_trip jsonb := '{}'::jsonb;
  v_graph_only text[] := ARRAY['event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings'];
  v_known text[] := ARRAY[
    -- Ari's TripDraftGraphV1 groups.
    'event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings',
    -- The established shared Business LiveTripPatch vocabulary.
    'title', 'description', 'theme', 'pricing_tiers', 'days', 'inclusions',
    'cover_media_url', 'cover_media_poster_url', 'cover_media_type',
    'cover_media_gallery', 'cover_media_provider', 'cover_media_source_url',
    'cover_media_credit', 'cover_media_credit_url', 'cover_media_alt',
    'refund_policy', 'booking_deadline', 'bookings_closed', 'intake_schemas'];
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'update_trip_live', v_event.brand_id, p_event_id,
    jsonb_build_object('patch', p_patch, 'reason', p_reason,
                       'expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'trip_not_live';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 10 AND 200 THEN
    RAISE EXCEPTION 'trip_update_reason_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k
        WHERE NOT (k = ANY (v_known)))
  THEN
    RAISE EXCEPTION 'trip_patch_key_not_allowed' USING ERRCODE = '22023';
  END IF;

  -- Everything that is already top-level Business vocabulary rides through
  -- untouched. Only the graph-only groups are translated.
  v_forward := COALESCE(p_patch, '{}'::jsonb) - v_graph_only;

  IF p_patch ? 'event' THEN
    IF jsonb_typeof(p_patch->'event') <> 'object' THEN
      RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
    END IF;
    v_forward := v_forward
      || ((p_patch->'event') - ARRAY['destination_text', 'departure_text', 'business_trip']);
    IF (p_patch->'event') ? 'business_trip' THEN
      v_business_trip := v_business_trip || (p_patch#>'{event,business_trip}');
    END IF;
    IF (p_patch->'event') ? 'destination_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('destinationLocationText', p_patch#>'{event,destination_text}');
    END IF;
    IF (p_patch->'event') ? 'departure_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('departureLocationText', p_patch#>'{event,departure_text}');
    END IF;
  END IF;

  IF p_patch ? 'event_dates' THEN
    IF jsonb_typeof(p_patch->'event_dates') <> 'array' THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
    v_dates := p_patch->'event_dates'->0;
    v_business_trip := v_business_trip
      || jsonb_build_object('startAt', v_dates->'start_at', 'endAt', v_dates->'end_at');
  END IF;

  IF v_business_trip <> '{}'::jsonb THEN
    v_forward := v_forward || jsonb_build_object(
      'theme',
      COALESCE(v_forward->'theme', '{}'::jsonb) || jsonb_build_object(
        'business_trip',
        COALESCE(v_forward#>'{theme,business_trip}', '{}'::jsonb) || v_business_trip));
  END IF;

  IF p_patch ? 'days' THEN v_forward := v_forward || jsonb_build_object('days', p_patch->'days'); END IF;
  IF p_patch ? 'inclusions' THEN v_forward := v_forward || jsonb_build_object('inclusions', p_patch->'inclusions'); END IF;
  IF p_patch ? 'intake_schemas' THEN v_forward := v_forward || jsonb_build_object('intake_schemas', p_patch->'intake_schemas'); END IF;

  -- Deposit/instalment bounds are validated for BOTH vocabularies before
  -- anything is delegated or written.
  IF p_patch ? 'pricing_tiers' THEN
    IF jsonb_typeof(p_patch->'pricing_tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'pricing_tiers') LOOP
      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');
    END LOOP;
  END IF;

  IF p_patch ? 'tiers' THEN
    IF jsonb_typeof(p_patch->'tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      IF NOT COALESCE((v_item->>'deleted')::boolean, false) THEN
        PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');
      END IF;
    END LOOP;
    -- The live gate expects the COMPLETE retained tier set. Merge the requested
    -- changes into the stored set and omit explicit deletes; new rows are added
    -- only after the gate's sold-count/refund/readiness checks return ok.
    v_forward := v_forward || jsonb_build_object('pricing_tiers', COALESCE((
      SELECT jsonb_agg(base || COALESCE(change, '{}'::jsonb)
                       ORDER BY (base->>'display_order')::int)
        FROM (
          SELECT jsonb_build_object(
                   'ticket_type_id', tt.id,
                   'tier_name', t.tier_name,
                   'tier_metadata', t.tier_metadata,
                   'price_cents', tt.price_cents,
                   'capacity', tt.quantity_total,
                   'display_order', tt.display_order) AS base,
                 (SELECT item FROM jsonb_array_elements(p_patch->'tiers') item
                   WHERE NULLIF(item->>'ticket_type_id', '')::uuid = tt.id LIMIT 1) AS change
            FROM public.trip_pricing_tiers t
            JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
           WHERE t.event_id = p_event_id AND tt.deleted_at IS NULL
        ) retained
       WHERE NOT COALESCE((change->>'deleted')::boolean, false)
    ), '[]'::jsonb));

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'tiers') item
       WHERE NULLIF(item->>'ticket_type_id', '') IS NULL
         AND COALESCE((item->>'price_cents')::int, 0) > 0
    ) AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
      RETURN public.biz_trip_command_finish(p_operation_id, v_result);
    END IF;
  END IF;

  IF p_patch ? 'settings' THEN
    IF jsonb_typeof(p_patch->'settings') <> 'object' THEN
      RAISE EXCEPTION 'trip_settings_patch_invalid' USING ERRCODE = '22023';
    END IF;
    v_forward := v_forward || (p_patch->'settings');
  END IF;

  -- Delegate to the proven audited/refund-safe live authority. Its safety logic
  -- is reused, never forked or weakened.
  v_result := public.issue_1719_update_live_trip_with_poster(p_event_id, v_forward, p_reason);
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN public.biz_trip_command_finish(p_operation_id, v_result);
  END IF;

  -- Ari-only tier lifecycle the live gate does not own: explicit removals and
  -- brand-new tiers, applied after the gate approved the retained set.
  IF p_patch ? 'tiers' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      IF COALESCE((v_item->>'deleted')::boolean, false) THEN
        IF EXISTS (
          SELECT 1 FROM public.tickets
           WHERE ticket_type_id = NULLIF(v_item->>'ticket_type_id', '')::uuid
             AND status IN ('valid', 'used', 'transferred')
        ) THEN
          RAISE EXCEPTION 'tier_delete_with_sales';
        END IF;
        UPDATE public.ticket_types SET deleted_at = now(), updated_at = now()
         WHERE id = NULLIF(v_item->>'ticket_type_id', '')::uuid
           AND event_id = p_event_id AND deleted_at IS NULL;
      ELSIF NULLIF(v_item->>'ticket_type_id', '') IS NULL THEN
        IF NULLIF(btrim(v_item->>'tier_name'), '') IS NULL
           OR COALESCE((v_item->>'price_cents')::int, -1) < 0
           OR COALESCE((v_item->>'capacity')::int, 0) < 1 THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.ticket_types(
          event_id, name, price_cents, currency, quantity_total, is_unlimited,
          is_free, min_purchase_qty, available_online, available_in_person, display_order
        ) VALUES (
          p_event_id, v_item->>'tier_name', (v_item->>'price_cents')::int,
          v_event.currency, (v_item->>'capacity')::int, false,
          (v_item->>'price_cents')::int = 0, 1, true, false,
          COALESCE((v_item->>'display_order')::int, 0)
        ) RETURNING id INTO v_ticket_type;
        INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
        VALUES (p_event_id, v_ticket_type, v_item->>'tier_name',
                COALESCE(v_item->'tier_metadata', '{}'::jsonb));
      END IF;
    END LOOP;
  END IF;

  IF p_patch ? 'settings' THEN
    UPDATE public.events SET
      pass_tax = CASE WHEN (p_patch->'settings') ? 'pass_tax'
                THEN (p_patch#>>'{settings,pass_tax}')::boolean ELSE pass_tax END,
      pass_mingla_fee = CASE WHEN (p_patch->'settings') ? 'pass_mingla_fee'
                THEN (p_patch#>>'{settings,pass_mingla_fee}')::boolean ELSE pass_mingla_fee END,
      pass_service_fee = CASE WHEN (p_patch->'settings') ? 'pass_service_fee'
                THEN (p_patch#>>'{settings,pass_service_fee}')::boolean ELSE pass_service_fee END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  v_result := v_result || jsonb_build_object(
    'graph', public.biz_get_trip_draft_graph(p_event_id),
    'revision', (SELECT updated_at FROM public.events WHERE id = p_event_id));
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.business_list_rsvp_roster(p_event_id uuid, p_search text DEFAULT NULL::text, p_cursor jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event public.events%ROWTYPE; v_search text; v_watermark bigint; v_rows jsonb; v_summary jsonb;
  v_cursor_created timestamptz; v_cursor_id uuid; v_last jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'rsvp_roster_limit_invalid' USING ERRCODE='22023'; END IF;
  v_search:=lower(btrim(COALESCE(p_search,'')));
  IF length(v_search)>120 OR v_search~E'[\\x00-\\x1F\\x7F]' THEN RAISE EXCEPTION 'rsvp_roster_search_invalid' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  IF p_cursor IS NOT NULL THEN
    IF (p_cursor->>'watermark')::bigint<>v_watermark THEN RAISE EXCEPTION 'rsvp_roster_stale' USING ERRCODE='PT409'; END IF;
    v_cursor_created:=(p_cursor->>'createdAt')::timestamptz; v_cursor_id:=(p_cursor->>'rsvpId')::uuid;
  END IF;
  WITH projected AS (
    SELECT r.id,r.created_at,
      COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(r.guest_name),''),'Unnamed RSVP') display_name,
      r.rsvp_status,r.approval_status,1+r.plus_count party_size,
      (r.checked_in_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)) checked_in
    FROM public.event_rsvps r LEFT JOIN public.profiles p ON p.id=r.user_id
    WHERE r.event_id=p_event_id
      AND (v_search='' OR strpos(lower(COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(r.guest_name),''),'Unnamed RSVP')),v_search)>0)
      AND (p_cursor IS NULL OR (r.created_at,r.id)>(v_cursor_created,v_cursor_id))
    ORDER BY r.created_at,r.id LIMIT p_limit
  ), safe_rows AS (
    SELECT jsonb_build_object('rosterKey','rsvp:'||id::text,'displayName',display_name,
      'attendanceStatus',rsvp_status,'approvalStatus',approval_status,'partySize',party_size,
      'checkedIn',checked_in,'canApprove',(rsvp_status IN ('going','waitlisted') AND approval_status IN ('pending','denied')),
      'canDeny',(rsvp_status IN ('going','waitlisted') AND approval_status IN ('pending','approved')),
      'createdAt',created_at) row_data FROM projected
  ) SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'createdAt',row_data->>'rosterKey'),'[]'::jsonb)
    INTO v_rows FROM safe_rows;
  SELECT jsonb_build_object('all',count(*),'pending',count(*) FILTER(WHERE approval_status='pending'),
    'goingPeople',COALESCE(sum(1+plus_count) FILTER(WHERE rsvp_status='going' AND approval_status='approved'),0),
    'checkedIn',count(*) FILTER(WHERE checked_in_at IS NOT NULL),'watermark',v_watermark)
    INTO v_summary FROM public.event_rsvps WHERE event_id=p_event_id;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'summary',v_summary,'watermark',v_watermark,
    'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object(
      'createdAt',v_last->>'createdAt','rsvpId',substring(v_last->>'rosterKey' from 6),'watermark',v_watermark) ELSE NULL END);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.business_set_rsvp_guest_status(p_event_id uuid, p_decision text, p_scope text, p_roster_keys text[] DEFAULT NULL::text[], p_expected_watermark bigint DEFAULT NULL::bigint, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_event public.events%ROWTYPE; v_ids uuid[]; v_id uuid; v_row public.event_rsvps%ROWTYPE;
  v_target text; v_confirmed integer; v_requested integer; v_free integer; v_applied integer:=0;
  v_unchanged integer:=0; v_skipped integer:=0; v_results jsonb:='[]'::jsonb; v_pending integer; v_going integer;
  v_watermark bigint; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_decision NOT IN ('approve','deny') OR p_scope NOT IN ('selected','all_pending') THEN
    RAISE EXCEPTION 'rsvp_guest_action_invalid' USING ERRCODE='22023';
  END IF;
  v_target:=CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'denied' END;
  IF p_scope='selected' THEN
    IF p_roster_keys IS NULL OR cardinality(p_roster_keys) NOT BETWEEN 1 AND 100
       OR cardinality(p_roster_keys)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_roster_keys)))
       OR EXISTS(SELECT 1 FROM unnest(p_roster_keys) k WHERE k!~'^rsvp:[0-9a-f-]{36}$') THEN
      RAISE EXCEPTION 'rsvp_guest_selection_invalid' USING ERRCODE='22023';
    END IF;
    SELECT array_agg(substring(k from 6)::uuid ORDER BY substring(k from 6)::uuid) INTO v_ids FROM unnest(p_roster_keys) k;
  ELSE
    IF p_roster_keys IS NOT NULL THEN RAISE EXCEPTION 'rsvp_guest_selection_invalid' USING ERRCODE='22023'; END IF;
    v_ids:='{}'::uuid[];
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_decision||':'||p_scope||':'||
    COALESCE(to_jsonb(p_roster_keys)::text,'null')||':'||COALESCE(p_expected_watermark::text,'null'),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_guest_status:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='guest_status' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  IF p_expected_watermark IS NOT NULL AND p_expected_watermark<>v_watermark THEN
    RAISE EXCEPTION 'rsvp_roster_stale' USING ERRCODE='PT409';
  END IF;
  IF p_scope='all_pending' THEN
    SELECT array_agg(id ORDER BY created_at,id) INTO v_ids FROM public.event_rsvps
      WHERE event_id=p_event_id AND approval_status='pending';
    v_ids:=COALESCE(v_ids,'{}'::uuid[]);
  END IF;
  PERFORM 1 FROM public.event_rsvps WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
  IF p_scope='selected' AND (SELECT count(*) FROM public.event_rsvps WHERE id=ANY(v_ids) AND event_id=p_event_id)<>cardinality(v_ids) THEN
    RAISE EXCEPTION 'rsvp_guest_selection_stale' USING ERRCODE='PT409';
  END IF;
  IF p_scope='selected' AND EXISTS(SELECT 1 FROM public.event_rsvps WHERE id=ANY(v_ids) AND
      (event_id<>p_event_id OR rsvp_status NOT IN ('going','waitlisted') OR approval_status NOT IN ('pending','approved','denied'))) THEN
    RAISE EXCEPTION 'rsvp_guest_selection_stale' USING ERRCODE='PT409';
  END IF;
  SELECT COALESCE(sum(1+plus_count),0) INTO v_confirmed FROM public.event_rsvps
    WHERE event_id=p_event_id AND rsvp_status='going' AND approval_status='approved'
      AND NOT(id=ANY(v_ids));
  IF p_decision='approve' AND p_scope='selected' AND v_event.rsvp_capacity IS NOT NULL THEN
    SELECT COALESCE(sum(1+plus_count),0) INTO v_requested FROM public.event_rsvps WHERE id=ANY(v_ids);
    IF v_confirmed+v_requested>v_event.rsvp_capacity THEN RAISE EXCEPTION 'rsvp_capacity_full' USING ERRCODE='23514'; END IF;
  END IF;
  v_free:=CASE WHEN v_event.rsvp_capacity IS NULL THEN NULL ELSE v_event.rsvp_capacity-v_confirmed END;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_row FROM public.event_rsvps WHERE id=v_id;
    IF p_decision='approve' AND p_scope='all_pending' AND v_free IS NOT NULL AND 1+v_row.plus_count>v_free THEN
      v_skipped:=v_skipped+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('rosterKey','rsvp:'||v_id,'outcome','skipped_for_capacity')); CONTINUE;
    END IF;
    IF v_row.approval_status=v_target THEN
      v_unchanged:=v_unchanged+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('rosterKey','rsvp:'||v_id,'outcome','unchanged')); CONTINUE;
    END IF;
    IF p_decision='approve' THEN
      UPDATE public.event_rsvps SET approval_status='approved',rsvp_status=CASE WHEN rsvp_status='waitlisted' THEN 'going' ELSE rsvp_status END WHERE id=v_id;
      IF (SELECT rsvp_status FROM public.event_rsvps WHERE id=v_id)='going' THEN PERFORM public.enqueue_rsvp_pass(v_id,NULL); END IF;
      IF v_free IS NOT NULL THEN v_free:=v_free-(1+v_row.plus_count); END IF;
    ELSE
      UPDATE public.event_rsvps SET approval_status='denied' WHERE id=v_id;
      INSERT INTO public.rsvp_notifications(event_id,rsvp_id,channel,recipient,status,template_key,payload,idempotency_key,attempt_count)
      VALUES(p_event_id,v_id,NULL,NULL,'pending',CASE WHEN v_row.approval_status='approved' THEN 'rsvp_removed' ELSE 'rsvp_denied' END,
        jsonb_build_object('rsvp_id',v_id,'event_id',p_event_id),
        'rsvp_approval:'||v_id::text||':'||v_row.approval_status||':denied',0) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    v_applied:=v_applied+1; v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'rosterKey','rsvp:'||v_id,'outcome','applied','approvalStatus',v_target,
      'wasRemoved',(p_decision='deny' AND v_row.approval_status='approved')));
  END LOOP;
  SELECT count(*) FILTER(WHERE approval_status='pending'),
    COALESCE(sum(1+plus_count) FILTER(WHERE rsvp_status='going' AND approval_status='approved'),0)
    INTO v_pending,v_going FROM public.event_rsvps WHERE event_id=p_event_id;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  v_result:=jsonb_build_object('requestedCount',cardinality(v_ids),'appliedCount',v_applied,'unchangedCount',v_unchanged,
    'skippedForCapacity',v_skipped,'outcomes',v_results,'pendingRemaining',v_pending,'goingPersonCount',v_going,'watermark',v_watermark);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'guest_status',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_agent_first_turn(p_brand_id uuid, p_client_turn_id uuid, p_content jsonb, p_prompt_version text, p_model_version text)
 RETURNS TABLE(conversation_id uuid, message_id uuid, created boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_message_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_client_turn_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'client_turn_id required';
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.brands brand
    WHERE brand.id = p_brand_id
      AND brand.deleted_at IS NULL
      AND (
        brand.account_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.brand_team_members member
          WHERE member.brand_id = brand.id
            AND member.user_id = v_user_id
            AND member.accepted_at IS NOT NULL
            AND member.removed_at IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'brand access denied';
  END IF;

  BEGIN
    INSERT INTO public.agent_conversations(user_id, brand_id, title)
    VALUES (v_user_id, p_brand_id, NULL)
    RETURNING id INTO v_conversation_id;

    INSERT INTO public.agent_messages(
      conversation_id, user_id, role, content, client_turn_id,
      prompt_version, model_version
    )
    VALUES (
      v_conversation_id, v_user_id, 'user', p_content, p_client_turn_id,
      p_prompt_version, p_model_version
    )
    RETURNING id INTO v_message_id;

    RETURN QUERY SELECT v_conversation_id, v_message_id, true;
    RETURN;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT message.conversation_id, message.id
  INTO v_conversation_id, v_message_id
  FROM public.agent_messages message
  WHERE message.user_id = v_user_id
    AND message.role = 'user'
    AND message.client_turn_id = p_client_turn_id
  LIMIT 1;

  IF v_conversation_id IS NULL OR v_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'first turn claim conflicted';
  END IF;
  RETURN QUERY SELECT v_conversation_id, v_message_id, false;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.community_reorder_roadmap(p_ordered_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expected integer;
  v_got integer;
  i integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_ordered_ids IS NULL OR array_length(p_ordered_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ordered_ids_required' USING ERRCODE = '22023';
  END IF;

  -- Lock all cards; require the ordered set to match exactly (no stale partial).
  PERFORM 1 FROM public.community_roadmap_cards ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_expected FROM public.community_roadmap_cards;
  SELECT count(DISTINCT x) INTO v_got FROM unnest(p_ordered_ids) AS t(x);
  IF v_got <> v_expected OR array_length(p_ordered_ids, 1) <> v_expected THEN
    RAISE EXCEPTION 'stale_reorder_set' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.community_roadmap_cards c WHERE c.id = t.id)
  ) THEN
    RAISE EXCEPTION 'stale_reorder_set' USING ERRCODE = 'PT409';
  END IF;

  FOR i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.community_roadmap_cards
       SET sort_order = i - 1, updated_at = now()
     WHERE id = p_ordered_ids[i];
  END LOOP;

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'reorder_roadmap',
    'community_roadmap',
    NULL,
    jsonb_build_object('count', v_expected)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_assign(p_id uuid, p_owner_emails text[], p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v record; v_item public.content_calendar_items; v_owners text[]; v_replay jsonb; v_out jsonb; v_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'assign',
    jsonb_build_object('id',p_id,'owner_emails',p_owner_emails,'expected_revision',p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(x)) ORDER BY lower(btrim(x))), ARRAY[]::text[]) INTO v_owners FROM unnest(COALESCE(p_owner_emails,ARRAY[]::text[])) x WHERE btrim(x)<>'';
  IF cardinality(v_owners) > 10 OR EXISTS (SELECT 1 FROM unnest(v_owners) x WHERE NOT EXISTS
      (SELECT 1 FROM public.admin_team_directory() d WHERE d.email=x AND d.status='active')) THEN
    RAISE EXCEPTION 'invalid_owners: Choose at most 10 active team members.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409'; END IF;
  UPDATE public.content_calendar_items SET owner_emails=v_owners, revision=revision+1, updated_by=v.actor_email, updated_at=now()
    WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.assigned',
    jsonb_build_object('changed_fields',jsonb_build_array('owners'),'from_revision',p_expected_revision,'to_revision',v_item.revision));
  v_out := jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'assign',v_out);
  RETURN v_out;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_delete(p_id uuid, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v record; v_item public.content_calendar_items; v_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden: Only the owner or an admin can delete content.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE='PT409'; END IF;
  UPDATE public.content_calendar_items SET deleted_at=now(),deleted_by=v.actor_email,revision=revision+1,updated_by=v.actor_email,updated_at=now() WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.deleted',
    jsonb_build_object('from_revision',p_expected_revision,'to_revision',v_item.revision,'changed_fields',jsonb_build_array('deleted_at')));
  RETURN jsonb_build_object('id',p_id,'audit_id',v_audit);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_move(p_id uuid, p_to text, p_expected_revision bigint, p_approve_copy boolean DEFAULT false, p_approve_design boolean DEFAULT false, p_publish_without_link boolean DEFAULT false, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; v_item public.content_calendar_items; v_replay jsonb; v_out jsonb; v_audit uuid;
  v_from_idx integer; v_to_idx integer; v_now timestamptz := clock_timestamp();
  v_previous_copy_by text; v_previous_copy_at timestamptz;
  v_previous_design_by text; v_previous_design_at timestamptz; v_previous_without_link boolean;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email,p_request_key,'move',jsonb_build_object(
    'id',p_id,'to',p_to,'expected_revision',p_expected_revision,'approve_copy',COALESCE(p_approve_copy,false),
    'approve_design',COALESCE(p_approve_design,false),'publish_without_link',COALESCE(p_publish_without_link,false)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409'; END IF;
  SELECT ord INTO v_from_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=v_item.stage;
  SELECT ord INTO v_to_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=p_to;
  IF v_to_idx IS NULL THEN RAISE EXCEPTION 'invalid_stage: Use Idea, Writing, Design, Review, Scheduled or Published.' USING ERRCODE='22023'; END IF;
  IF v_to_idx=v_from_idx THEN RAISE EXCEPTION 'no_change: That card is already in this stage.' USING ERRCODE='22023'; END IF;
  IF v_to_idx > v_from_idx + 1 THEN RAISE EXCEPTION 'stage_order: Move forward one stage at a time.' USING ERRCODE='22023'; END IF;
  v_previous_copy_by:=v_item.copy_approved_by; v_previous_copy_at:=v_item.copy_approved_at;
  v_previous_design_by:=v_item.design_approved_by; v_previous_design_at:=v_item.design_approved_at;
  v_previous_without_link:=v_item.published_without_link;
  IF v_item.stage='writing' AND p_to='design' THEN
    IF NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL THEN RAISE EXCEPTION 'copy_required: Add copy before Design.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_copy,false) THEN RAISE EXCEPTION 'copy_approval_required: Approve the copy before Design.' USING ERRCODE='22023'; END IF;
    v_item.copy_approved_by:=v.actor_email; v_item.copy_approved_at:=v_now;
  ELSIF v_item.stage='review' AND p_to='scheduled' THEN
    IF v_item.publish_at IS NULL OR cardinality(v_item.channels)=0 THEN RAISE EXCEPTION 'schedule_required: Add a publish date, time and at least one channel.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_design,false) THEN RAISE EXCEPTION 'design_approval_required: Approve the design before Scheduled.' USING ERRCODE='22023'; END IF;
    v_item.design_approved_by:=v.actor_email; v_item.design_approved_at:=v_now;
  ELSIF v_item.stage='scheduled' AND p_to='published' AND v_item.live_url IS NULL AND NOT COALESCE(p_publish_without_link,false) THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  IF v_to_idx<v_from_idx THEN
    IF v_to_idx<=2 THEN
      v_item.copy_approved_by:=NULL; v_item.copy_approved_at:=NULL;
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    ELSIF v_to_idx<=4 THEN
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    END IF;
  END IF;
  v_item.published_without_link := p_to='published' AND v_item.live_url IS NULL AND COALESCE(p_publish_without_link,false);
  UPDATE public.content_calendar_items SET stage=p_to,
    copy_approved_by=v_item.copy_approved_by,copy_approved_at=v_item.copy_approved_at,
    design_approved_by=v_item.design_approved_by,design_approved_at=v_item.design_approved_at,
    published_without_link=v_item.published_without_link,
    revision=revision+1,updated_by=v.actor_email,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.stage_move',jsonb_build_object(
    'previous_stage',(SELECT stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE ord=v_from_idx),
    'next_stage',p_to,'from_revision',p_expected_revision,'to_revision',v_item.revision,
    'previous_copy_approved_by',v_previous_copy_by,'previous_copy_approved_at',v_previous_copy_at,
    'previous_design_approved_by',v_previous_design_by,'previous_design_approved_at',v_previous_design_at,
    'previous_published_without_link',v_previous_without_link,
    'copy_approved_by',v_item.copy_approved_by,'copy_approved_at',v_item.copy_approved_at,
    'design_approved_by',v_item.design_approved_by,'design_approved_at',v_item.design_approved_at,
    'published_without_link',v_item.published_without_link));
  v_out := jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'move',v_out);
  RETURN v_out;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_request_begin(p_actor text, p_request_key text, p_operation text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_digest text; v_row public.content_calendar_request_keys;
BEGIN
  IF p_request_key IS NULL THEN RETURN NULL; END IF;
  IF p_request_key !~ '^[A-Za-z0-9_-]{8,90}$' THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 90 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_digest := encode(extensions.digest(convert_to(COALESCE(p_args, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.content_calendar_request_keys (actor_email, request_key, operation, args_digest)
  VALUES (p_actor, p_request_key, p_operation, v_digest)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT v_row FROM public.content_calendar_request_keys k
   WHERE k.actor_email = p_actor AND k.request_key = p_request_key FOR UPDATE;
  IF v_row.operation IS DISTINCT FROM p_operation OR v_row.args_digest IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'request_key_reused: That request key already belongs to another action or different details. Use a new key.' USING ERRCODE = '22023';
  END IF;
  IF v_row.response IS NULL THEN
    RAISE EXCEPTION 'try_again: The first request did not finish. Send the same request again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_row.response || jsonb_build_object('replayed', true);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_request_finish(p_actor text, p_request_key text, p_operation text, p_response jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_request_key IS NULL THEN RETURN; END IF;
  UPDATE public.content_calendar_request_keys k SET response = p_response
   WHERE k.actor_email = p_actor AND k.request_key = p_request_key
     AND k.operation = p_operation AND k.response IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'try_again: The request could not be recorded safely. Send the same request again.' USING ERRCODE = 'PT409';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_undo(p_audit_id uuid, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v record; v_a public.content_calendar_audit; v_item public.content_calendar_items; v_new_audit uuid;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  SELECT * INTO v_a FROM public.content_calendar_audit a WHERE a.id=p_audit_id AND a.actor_email=v.actor_email
    AND a.action IN ('content.stage_move','content.rescheduled') AND a.created_at >= now()-interval '8 seconds';
  IF NOT FOUND THEN RAISE EXCEPTION 'undo_expired: Undo is only available to the person who made the change, for 8 seconds.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=v_a.item_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision OR (v_a.metadata->>'to_revision')::bigint<>p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed after that action, so it cannot be undone safely.' USING ERRCODE='PT409'; END IF;
  IF v_a.action='content.stage_move' THEN
    v_item.stage := v_a.metadata->>'previous_stage';
    v_item.copy_approved_by := v_a.metadata->>'previous_copy_approved_by';
    v_item.copy_approved_at := (v_a.metadata->>'previous_copy_approved_at')::timestamptz;
    v_item.design_approved_by := v_a.metadata->>'previous_design_approved_by';
    v_item.design_approved_at := (v_a.metadata->>'previous_design_approved_at')::timestamptz;
    v_item.published_without_link := COALESCE((v_a.metadata->>'previous_published_without_link')::boolean,false);
  ELSE v_item.publish_at := (v_a.metadata->>'previous_publish_at')::timestamptz; END IF;
  UPDATE public.content_calendar_items SET stage=v_item.stage,publish_at=v_item.publish_at,
    copy_approved_by=v_item.copy_approved_by,copy_approved_at=v_item.copy_approved_at,
    design_approved_by=v_item.design_approved_by,design_approved_at=v_item.design_approved_at,
    published_without_link=v_item.published_without_link,revision=revision+1,
    updated_by=v.actor_email,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  v_new_audit := public.content_calendar_audit_write(v_item.id,v.actor_email,v.via,'content.undo',
    jsonb_build_object('undid_audit_id',p_audit_id,'to_revision',v_item.revision,'restored_stage',v_item.stage));
  RETURN jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_new_audit);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; v_item public.content_calendar_items; v_after jsonb; v_replay jsonb; v_out jsonb;
  v_args jsonb; v_audit uuid; v_action text := 'content.updated'; v_value text; v_channels text[];
  v_fields text[]; v_before_publish timestamptz;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_args := jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision);
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'update', v_args);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN
       ('title','publish_at','channels','copy','notes','drive_url','live_url','format','audience','city_id')) THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one supported field.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409';
  END IF;
  v_before_publish := v_item.publish_at;
  SELECT array_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(p_changes) k;
  IF p_changes ? 'title' THEN
    IF jsonb_typeof(p_changes->'title') <> 'string' OR char_length(btrim(p_changes->>'title')) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'invalid_title: Title must be 1 to 160 characters.' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.content_calendar_items i WHERE i.id<>p_id AND i.deleted_at IS NULL
                 AND i.title_key=public.crm_name_key(p_changes->>'title')) THEN
      RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
    END IF;
    v_item.title := btrim(p_changes->>'title');
  END IF;
  IF p_changes ? 'publish_at' THEN
    IF jsonb_typeof(p_changes->'publish_at') = 'null' THEN v_item.publish_at := NULL;
    ELSIF jsonb_typeof(p_changes->'publish_at') <> 'string' THEN RAISE EXCEPTION 'invalid_publish_at: Use a date-time or null.' USING ERRCODE='22023';
    ELSE v_item.publish_at := (p_changes->>'publish_at')::timestamptz; END IF;
  END IF;
  IF p_changes ? 'channels' THEN
    IF jsonb_typeof(p_changes->'channels') <> 'array' OR jsonb_array_length(p_changes->'channels') > 9
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'channels') e
                   WHERE jsonb_typeof(e) <> 'string' OR e#>>'{}' NOT IN ('instagram','tiktok','facebook','x','threads','youtube','linkedin','website','email')) THEN
      RAISE EXCEPTION 'invalid_channels: Choose only supported channels.' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(array_agg(DISTINCT e ORDER BY e), ARRAY[]::text[]) INTO v_channels
      FROM jsonb_array_elements_text(p_changes->'channels') e;
    v_item.channels := v_channels;
  END IF;
  IF p_changes ? 'copy' THEN
    IF v_item.stage NOT IN ('idea','writing') THEN
      RAISE EXCEPTION 'copy_locked: Copy is read-only after Writing. Move the card back to Writing to revise it.' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_changes->'copy') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'copy','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_copy: Copy must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.copy_text := NULLIF(p_changes->>'copy','');
  END IF;
  IF p_changes ? 'notes' THEN
    IF jsonb_typeof(p_changes->'notes') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'notes','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_notes: Notes must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.notes := NULLIF(p_changes->>'notes','');
  END IF;
  FOREACH v_value IN ARRAY ARRAY['drive_url','live_url'] LOOP
    IF p_changes ? v_value THEN
      IF jsonb_typeof(p_changes->v_value) NOT IN ('string','null') OR char_length(COALESCE(p_changes->>v_value,'')) > 2000
         OR (NULLIF(p_changes->>v_value,'') IS NOT NULL AND (p_changes->>v_value) !~ '^https?://') THEN
        RAISE EXCEPTION 'invalid_url: Links must start with http:// or https:// and be at most 2,000 characters.' USING ERRCODE='22023'; END IF;
      IF v_value='drive_url' THEN v_item.drive_url := NULLIF(p_changes->>v_value,'');
      ELSE v_item.live_url := NULLIF(p_changes->>v_value,''); END IF;
    END IF;
  END LOOP;
  IF p_changes ? 'format' THEN
    IF jsonb_typeof(p_changes->'format') NOT IN ('string','null') OR (NULLIF(p_changes->>'format','') IS NOT NULL
       AND p_changes->>'format' NOT IN ('graphic','carousel','short_video','long_video','story','talking_head','motion_graphics','photo_ugc','blog','email','landing_page')) THEN
      RAISE EXCEPTION 'invalid_format: Choose a supported format.' USING ERRCODE='22023'; END IF;
    v_item.format := NULLIF(p_changes->>'format','');
  END IF;
  IF p_changes ? 'audience' THEN
    IF jsonb_typeof(p_changes->'audience') NOT IN ('string','null') OR (NULLIF(p_changes->>'audience','') IS NOT NULL
       AND p_changes->>'audience' NOT IN ('explorer','business','education_investor')) THEN
      RAISE EXCEPTION 'invalid_audience: Choose a supported audience.' USING ERRCODE='22023'; END IF;
    v_item.audience := NULLIF(p_changes->>'audience','');
  END IF;
  IF p_changes ? 'city_id' THEN
    IF jsonb_typeof(p_changes->'city_id')='null' OR NULLIF(p_changes->>'city_id','') IS NULL THEN v_item.city_id := NULL;
    ELSIF jsonb_typeof(p_changes->'city_id') <> 'string' OR NOT EXISTS (SELECT 1 FROM public.seeding_cities c WHERE c.id=(p_changes->>'city_id')::uuid) THEN
      RAISE EXCEPTION 'invalid_city: Choose a listed city.' USING ERRCODE='22023';
    ELSE v_item.city_id := (p_changes->>'city_id')::uuid; END IF;
  END IF;
  IF v_item.stage NOT IN ('idea','writing') AND
     (NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL OR v_item.copy_approved_at IS NULL OR v_item.copy_approved_by IS NULL) THEN
    RAISE EXCEPTION 'copy_approval_required: Design and later stages require approved copy.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage IN ('scheduled','published') AND
     (v_item.design_approved_at IS NULL OR v_item.design_approved_by IS NULL OR v_item.publish_at IS NULL OR cardinality(v_item.channels)=0) THEN
    RAISE EXCEPTION 'schedule_required: Scheduled and Published require approved design, a publish date and at least one channel.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage='published' AND v_item.live_url IS NULL AND NOT v_item.published_without_link THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  UPDATE public.content_calendar_items SET title=v_item.title, publish_at=v_item.publish_at, channels=v_item.channels,
    copy_text=v_item.copy_text, notes=v_item.notes, drive_url=v_item.drive_url, live_url=v_item.live_url,
    format=v_item.format, audience=v_item.audience, city_id=v_item.city_id, revision=revision+1,
    updated_by=v.actor_email, updated_at=now() WHERE id=p_id RETURNING * INTO v_item;
  v_after := public.content_calendar_item_json(v_item);
  IF v_fields = ARRAY['publish_at']::text[] THEN v_action := 'content.rescheduled'; END IF;
  v_audit := public.content_calendar_audit_write(p_id, v.actor_email, v.via, v_action,
    jsonb_build_object('changed_fields',to_jsonb(v_fields),'from_revision',p_expected_revision,'to_revision',v_item.revision) ||
    CASE WHEN v_action='content.rescheduled' THEN jsonb_build_object('previous_publish_at',v_before_publish) ELSE '{}'::jsonb END);
  v_out := jsonb_build_object('item', v_after, 'audit_id', v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_changes: A date or identifier has the wrong shape.' USING ERRCODE='22023';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.crm_beta_lead_to_host(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v        record;
  v_lead   public.beta_access_leads;
  v_host   public.crm_records;
  v_icp    jsonb;
  v_region jsonb;
  v_fields jsonb;
  v_res    jsonb;
  v_note   text;
  v_now    timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT COALESCE(public.admin_team_can('beta_leads'), false) THEN
    RAISE EXCEPTION 'forbidden: Your account cannot open Beta leads. Ask the owner to give you team access.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM public.beta_access_leads l WHERE l.id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That beta lead is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_beta:' || p_lead_id::text, 0));

  -- Already a host: an answer, not an error. Nothing is written.
  SELECT * INTO v_host FROM public.crm_records c
   WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.beta_lead_id = p_lead_id;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'exists', 'record', public.crm_record_lite_json(v_host));
  END IF;

  v_icp    := public.crm_beta_icp(v_lead.brand_type);
  v_region := public.crm_city_region(v_lead.city);
  -- The email goes first so it is never the part that is cut.
  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'name', v_lead.brand_name,
    'icp', v_icp->>'icp',
    'region_id', v_region->>'region_id',
    'contact', left(v_lead.email || ' ' || chr(183) || ' ' || v_lead.contact_name, 300),
    'channel', 'email',
    'source', 'inbound'))
    || jsonb_build_object('owners', jsonb_build_array(v.actor_email))
    || CASE WHEN char_length(btrim(v_lead.email)) <= 200
                 AND public.crm_ident_key('email', btrim(v_lead.email)) IS NOT NULL
            THEN jsonb_build_object('identifiers', jsonb_build_array(
                   jsonb_build_object('kind', 'email', 'value', btrim(v_lead.email))))
            ELSE '{}'::jsonb END;
  v_note := format('Type chosen: %s. City as typed: %s.', v_icp->>'labels', v_lead.city);

  BEGIN
    v_res := public.crm_record_create_core('hosts', v_fields, v.actor_email, v.via);
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM LIKE 'invalid_name:%' THEN
      RAISE EXCEPTION 'lead_name_unusable: This lead''s business name cannot be used as a host name. Add the host by hand from Hosts.'
        USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;

  IF v_res->>'status' = 'duplicate' THEN
    -- A host with this name, or with this email, is already there. Link the
    -- lead to it if it has no lead yet; otherwise say so. Never a second host.
    SELECT * INTO v_host FROM public.crm_records c
     WHERE c.id = (v_res->'existing'->>'id')::uuid AND c.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = 'PT409';
    END IF;
    IF v_host.beta_lead_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'duplicate', 'record', public.crm_record_lite_json(v_host));
    END IF;
    BEGIN
      UPDATE public.crm_records
         SET beta_lead_id = p_lead_id, updated_by = v.actor_email, updated_at = v_now
       WHERE id = v_host.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = 'PT409';
    END;
    INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
    VALUES (v_host.id, 'note', v.actor_email, v.via,
            'Linked to a beta lead. '
            || CASE WHEN v_res->>'reason' = 'identifier' THEN 'Same email as this beta lead. ' ELSE '' END
            || v_note, v_now, v_now);
    PERFORM public.crm_audit(v.actor_email, 'crm.beta_lead_link', 'crm_record', v_host.id::text,
      jsonb_strip_nulls(jsonb_build_object('via', v.via)) || jsonb_build_object('lead_id', p_lead_id));
    SELECT * INTO v_host FROM public.crm_records c WHERE c.id = v_host.id;
    RETURN jsonb_build_object('status', 'linked', 'record', public.crm_record_lite_json(v_host));
  END IF;

  -- Created. Tie the lead to the new host, say where it came from, audit it.
  BEGIN
    UPDATE public.crm_records
       SET beta_lead_id = p_lead_id
     WHERE id = (v_res->'record'->>'id')::uuid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
      USING ERRCODE = 'PT409';
  END;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
  VALUES ((v_res->'record'->>'id')::uuid, 'note', v.actor_email, v.via, 'Added from a beta lead. ' || v_note, v_now, v_now);
  PERFORM public.crm_audit(v.actor_email, 'crm.beta_lead_convert', 'crm_record', v_res->'record'->>'id',
    jsonb_strip_nulls(jsonb_build_object('via', v.via)) || jsonb_build_object(
      'lead_id', p_lead_id, 'icp', v_icp->>'icp', 'icp_note', v_icp->>'note',
      'region_id', v_region->>'region_id', 'region_note', v_region->>'note'));

  SELECT * INTO v_host FROM public.crm_records c WHERE c.id = (v_res->'record'->>'id')::uuid;
  RETURN jsonb_build_object('status', 'created', 'record', public.crm_record_json(v_host),
    'icp_note', v_icp->>'note', 'region_note', v_region->>'note', 'city', v_lead.city);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.crm_record_create_core(p_pipeline text, p_fields jsonb, p_actor text, p_via text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_clean    jsonb;
  v_owners   text[];
  v_key      text;
  v_existing public.crm_records;
  v_rec      public.crm_records;
  v_first    text;
  v_moved    text;
  v_now      timestamptz := clock_timestamp();
  v_idents   jsonb;
  v_hits     jsonb;
  v_id       jsonb;
BEGIN
  v_clean := public.crm_validate_fields(p_pipeline, p_fields, 'create');
  v_owners := CASE
    WHEN jsonb_typeof(v_clean->'owners') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(v_clean->'owners'))
    ELSE ARRAY[p_actor]
  END;
  v_key := public.crm_name_key(v_clean->>'name');

  IF p_via IS NOT NULL AND v_clean ? 'allow_shared_identifier' THEN
    RAISE EXCEPTION 'field_not_for_agents: Only a person can add a second record that shares a contact detail. Ask your person.'
      USING ERRCODE = '22023';
  END IF;
  v_idents := CASE WHEN jsonb_typeof(v_clean->'identifiers') = 'array' THEN v_clean->'identifiers' ELSE '[]'::jsonb END;
  -- One add at a time per contact detail, so two requests that carry the same
  -- one cannot both find it free.
  FOR v_id IN SELECT e FROM jsonb_array_elements(v_idents) AS e ORDER BY e->>'kind', e->>'value_key' LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'crm_ident:' || p_pipeline || ':' || (v_id->>'kind') || ':'
      || CASE WHEN v_id->>'kind' = 'phone'
              THEN right(public.crm_phone_national(v_id->>'value_key'), 7) ELSE v_id->>'value_key' END, 0));
  END LOOP;

  -- An exact duplicate is an answer, not an error. Nothing is written.
  SELECT * INTO v_existing FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.name_key = v_key AND c.deleted_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'duplicate', 'reason', 'name', 'existing', public.crm_record_lite_json(v_existing));
  END IF;

  -- A contact detail another record already holds is a duplicate too. A
  -- person may add anyway; an agent may not.
  IF jsonb_array_length(v_idents) > 0 THEN
    v_hits := public.crm_identifier_matches(p_pipeline, v_idents, NULL);
    IF jsonb_array_length(v_hits) > 0
       AND NOT (p_via IS NULL AND COALESCE(v_clean->'allow_shared_identifier' = 'true'::jsonb, false)) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'reason', 'identifier',
                                'existing', v_hits->0->'record', 'matched_on', v_hits->0->'matched_on',
                                'others', jsonb_array_length(v_hits) - 1);
    END IF;
  END IF;

  v_first := public.crm_pipeline_def(p_pipeline)->'stages'->0->>'id';
  BEGIN
    INSERT INTO public.crm_records (
      pipeline, name, icp, region_id, stage, contact, channel, source, next_action, due_on,
      brand_id, place_id, followers, agreement, rate,
      contact_rule, contact_rule_reason, contact_rule_by, contact_rule_at,
      created_by, created_at, updated_by, updated_at)
    VALUES (
      p_pipeline, v_clean->>'name', v_clean->>'icp', (v_clean->>'region_id')::uuid, v_first,
      v_clean->>'contact', v_clean->>'channel', v_clean->>'source', v_clean->>'next_action',
      (v_clean->>'due_on')::date, (v_clean->>'brand_id')::uuid, (v_clean->>'place_pool_id')::uuid,
      (v_clean->>'followers')::integer, v_clean->>'agreement', v_clean->>'rate',
      v_clean->>'contact_rule',
      CASE WHEN (v_clean->>'contact_rule') IS NOT NULL THEN v_clean->>'contact_rule_reason' END,
      CASE WHEN (v_clean->>'contact_rule') IS NOT NULL THEN p_actor END,
      CASE WHEN (v_clean->>'contact_rule') IS NOT NULL THEN v_now END,
      p_actor, v_now, p_actor, v_now)
    RETURNING * INTO v_rec;
  EXCEPTION WHEN unique_violation THEN
    -- Two people added the same name at the same moment: the second one gets
    -- the same "duplicate" answer.
    SELECT * INTO v_existing FROM public.crm_records c
     WHERE c.pipeline = p_pipeline AND c.name_key = v_key AND c.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'try_again: Another change to the same record happened at the same moment, so nothing was saved. Send the same request again.'
        USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('status', 'duplicate', 'reason', 'name', 'existing', public.crm_record_lite_json(v_existing));
  END;

  INSERT INTO public.crm_record_owners (record_id, owner_email, added_by, added_at)
  SELECT v_rec.id, o.e, p_actor, v_now FROM unnest(v_owners) AS o(e);

  INSERT INTO public.crm_record_identifiers (record_id, kind, platform, value, value_key, created_by, created_at)
  SELECT v_rec.id, e->>'kind', e->>'platform', e->>'value', e->>'value_key', p_actor, v_now
  FROM jsonb_array_elements(v_idents) AS e;

  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
  VALUES (v_rec.id, 'created', p_actor, p_via, 'Added to the pipeline.', v_now, v_now);

  IF v_rec.brand_id IS NOT NULL THEN
    v_moved := public.crm_apply_brand_link(v_rec.id);
  END IF;

  PERFORM public.crm_audit(p_actor, 'crm.record_create', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('pipeline', p_pipeline, 'name', v_rec.name,
                                         'owners', to_jsonb(v_owners), 'moved_to', v_moved, 'via', p_via,
                                         'identifiers', NULLIF(jsonb_array_length(v_idents), 0),
                                         'contact_rule', v_clean->>'contact_rule')));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = v_rec.id;
  RETURN jsonb_build_object('status', 'created', 'record', public.crm_record_json(v_rec), 'moved_to', v_moved);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.crm_records_bulk_create(p_pipeline text, p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v         record;
  v_res     jsonb;
  v_item    jsonb;
  v_idx     integer := 0;
  v_one     jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_res := public.crm_request_begin(v.actor_email, p_request_key, 'crm_records_bulk_create');
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_items: Send a list of 1 to 50 records, each a JSON object with at least a name.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'too_many: Send at most 50 records in one request.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT t.value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(value, ord) ORDER BY t.ord LOOP
    BEGIN
      v_one := public.crm_record_create_core(p_pipeline, v_item, v.actor_email, v.via);
      IF v_one->>'status' = 'created' THEN
        v_created := v_created || jsonb_build_array(jsonb_build_object('index', v_idx, 'record', v_one->'record'));
      ELSE
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'index', v_idx,
          'name', CASE WHEN jsonb_typeof(v_item) = 'object' THEN v_item->>'name' ELSE NULL END,
          'reason', 'duplicate', 'existing', v_one->'existing'));
      END IF;
    EXCEPTION
      WHEN invalid_parameter_value THEN
        v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
          'index', v_idx,
          'name', CASE WHEN jsonb_typeof(v_item) = 'object' THEN v_item->>'name' ELSE NULL END,
          'error', SQLERRM));
      WHEN others THEN
        RAISE WARNING 'crm_records_bulk_create: item % stopped the request (% %)', v_idx, SQLSTATE, SQLERRM;
        RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s of the list, so nothing was saved. Send the same request again.', v_idx + 1)
          USING ERRCODE = 'PT409';
    END;
    v_idx := v_idx + 1;
  END LOOP;

  PERFORM public.crm_audit(v.actor_email, 'crm.bulk_create', 'crm_pipeline', p_pipeline,
    jsonb_strip_nulls(jsonb_build_object(
      'created', jsonb_array_length(v_created), 'skipped', jsonb_array_length(v_skipped),
      'invalid', jsonb_array_length(v_invalid), 'via', v.via)));

  v_res := jsonb_build_object('created', v_created, 'skipped', v_skipped, 'invalid', v_invalid);
  PERFORM public.crm_request_finish(v.actor_email, p_request_key, 'crm_records_bulk_create', v_res);
  RETURN v_res;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_brand_circle_reach(p_brand_id uuid, p_ring text DEFAULT 'all'::text, p_cursor jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_rank integer; v_snapshot bigint;
  v_f record; v_e record; v_rows jsonb:='[]'::jsonb; v_next jsonb:=NULL; v_has_more boolean:=false;
  v_f_count bigint; v_e_count bigint; v_state text; v_cursor_keys text[];
BEGIN
  IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='circle_forbidden'; END IF;
  v_rank:=public.biz_brand_effective_rank(p_brand_id,v_actor);
  IF COALESCE(v_rank,-1)<public.biz_role_rank('marketing_manager') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='circle_forbidden'; END IF;
  IF p_ring IS NULL OR p_ring NOT IN ('all','follower','extended') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_ring_invalid'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_limit_invalid'; END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_cursor_invalid'; END IF;
    SELECT array_agg(key ORDER BY key) INTO v_cursor_keys FROM jsonb_object_keys(p_cursor) key;
    IF v_cursor_keys IS DISTINCT FROM ARRAY['memberId','ringOrder','snapshotVersion','sortName']::text[]
      OR jsonb_typeof(p_cursor->'snapshotVersion')<>'number' OR jsonb_typeof(p_cursor->'ringOrder')<>'number'
      OR jsonb_typeof(p_cursor->'sortName')<>'string' OR jsonb_typeof(p_cursor->'memberId')<>'string'
      OR (p_cursor->>'snapshotVersion') !~ '^[0-9]+$'
      OR (p_cursor->>'snapshotVersion')::numeric>9223372036854775807
      OR (p_cursor->>'ringOrder') !~ '^[23]$'
      OR (p_cursor->>'memberId')::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_cursor_invalid'; END IF;
  END IF;

  SELECT * INTO v_f FROM public.issue_1777_brand_reach_scope_status(p_brand_id,'follower');
  SELECT * INTO v_e FROM public.issue_1777_brand_reach_scope_status(p_brand_id,'extended');
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id=p_brand_id;
  IF p_cursor IS NOT NULL AND (v_snapshot IS NULL OR (p_cursor->>'snapshotVersion')::bigint<>v_snapshot) THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='circle_cursor_stale'; END IF;

  IF v_f.scope_state='ready' THEN
    SELECT count(*) INTO v_f_count FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.generation_id=v_f.generation_id AND rm.ring='follower'
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=v_actor AND bu.blocked_id=rm.user_id) OR (bu.blocker_id=rm.user_id AND bu.blocked_id=v_actor));
  END IF;
  IF v_e.scope_state='ready' THEN
    SELECT count(*) INTO v_e_count FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.generation_id=v_e.generation_id AND rm.ring='extended'
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=v_actor AND bu.blocked_id=rm.user_id) OR (bu.blocker_id=rm.user_id AND bu.blocked_id=v_actor));
  END IF;

  WITH page AS (
    SELECT rm.member_id,rm.ring,rm.ring_order,rm.display_name,rm.avatar_url,rm.reason_code,lower(rm.display_name) sort_name
    FROM public.brand_reach_members rm
    WHERE rm.brand_id=p_brand_id
      AND ((p_ring IN ('all','follower') AND v_f.scope_state='ready' AND rm.generation_id=v_f.generation_id AND rm.ring='follower') OR
           (p_ring IN ('all','extended') AND v_e.scope_state='ready' AND rm.generation_id=v_e.generation_id AND rm.ring='extended'))
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=v_actor AND bu.blocked_id=rm.user_id) OR (bu.blocker_id=rm.user_id AND bu.blocked_id=v_actor))
      AND (p_cursor IS NULL OR (rm.ring_order,lower(rm.display_name),rm.member_id) > ((p_cursor->>'ringOrder')::smallint,p_cursor->>'sortName',(p_cursor->>'memberId')::uuid))
    ORDER BY rm.ring_order,lower(rm.display_name),rm.member_id LIMIT p_limit+1
  ), sliced AS (SELECT * FROM page ORDER BY ring_order,sort_name,member_id LIMIT p_limit)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'memberId',member_id,'ring',ring,'displayName',display_name,'avatarUrl',avatar_url,
      'reasonCode',reason_code,'reasonLabel',CASE ring WHEN 'follower' THEN 'Follows your brand.' ELSE 'In your extended circle.' END
    ) ORDER BY ring_order,sort_name,member_id),'[]'::jsonb),
    (SELECT count(*)>p_limit FROM page)
  INTO v_rows,v_has_more FROM sliced;

  IF v_has_more AND jsonb_array_length(v_rows)>0 THEN
    WITH last_row AS (SELECT value FROM jsonb_array_elements(v_rows) WITH ORDINALITY x(value,n) ORDER BY n DESC LIMIT 1), member AS (
      SELECT rm.* FROM public.brand_reach_members rm,last_row l WHERE rm.member_id=(l.value->>'memberId')::uuid
    ) SELECT jsonb_build_object('snapshotVersion',v_snapshot,'ringOrder',ring_order,'sortName',lower(display_name),'memberId',member_id) INTO v_next FROM member;
  END IF;
  v_state:=CASE
    WHEN p_ring='follower' THEN CASE WHEN v_f.scope_state='ready' THEN 'ready' ELSE 'unavailable' END
    WHEN p_ring='extended' THEN CASE WHEN v_e.scope_state='ready' THEN 'ready' ELSE 'unavailable' END
    WHEN v_f.scope_state='ready' AND v_e.scope_state='ready' THEN 'ready'
    WHEN v_f.scope_state='ready' OR v_e.scope_state='ready' THEN 'partial' ELSE 'unavailable' END;
  IF v_state='unavailable' THEN v_rows:='[]'::jsonb; v_next:=NULL; END IF;
  RETURN jsonb_build_object(
    'schemaVersion',1,'state',v_state,'snapshotVersion',CASE WHEN v_state='unavailable' THEN NULL ELSE v_snapshot END,
    'counts',jsonb_build_object('followers',CASE WHEN v_f.scope_state='ready' THEN v_f_count ELSE NULL END,'extended',CASE WHEN v_e.scope_state='ready' THEN v_e_count ELSE NULL END,'total',CASE WHEN v_f.scope_state='ready' AND v_e.scope_state='ready' THEN v_f_count+v_e_count ELSE NULL END),
    'availability',jsonb_build_object(
      'followers',jsonb_build_object('state',CASE WHEN v_f.scope_state='ready' THEN 'ready' ELSE 'unavailable' END,'reason',v_f.safe_reason,'refreshedAt',v_f.refreshed_at,'expiresAt',v_f.expires_at),
      'extended',jsonb_build_object('state',CASE WHEN v_e.scope_state='ready' THEN 'ready' ELSE 'unavailable' END,'reason',v_e.safe_reason,'refreshedAt',v_e.refreshed_at,'expiresAt',v_e.expires_at)
    ),'rows',v_rows,'nextCursor',v_next
  );
EXCEPTION
  WHEN SQLSTATE '42501' OR SQLSTATE '22023' OR SQLSTATE '40001' OR SQLSTATE 'PT409' THEN RAISE;
  WHEN OTHERS THEN
    RETURN jsonb_build_object('schemaVersion',1,'state','unavailable','snapshotVersion',NULL,'counts',jsonb_build_object('followers',NULL,'extended',NULL,'total',NULL),'availability',jsonb_build_object('followers',jsonb_build_object('state','unavailable','reason','authority_unavailable','refreshedAt',NULL,'expiresAt',NULL),'extended',jsonb_build_object('state','unavailable','reason','authority_unavailable','refreshedAt',NULL,'expiresAt',NULL)),'rows','[]'::jsonb,'nextCursor',NULL);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1384_admin_update_place_and_discovery_range(p_place_pool_id uuid, p_name text, p_price_tier text, p_price_tiers text[], p_is_active boolean, p_ai_categories text[], p_source_min_minor bigint, p_source_max_minor bigint, p_expected_version bigint, p_actor_reason text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_existing public.place_discovery_price_ranges%ROWTYPE;
  v_saved public.place_discovery_price_ranges%ROWTYPE;
  v_place_result jsonb;
BEGIN
  -- Authorization is deliberately the first state-dependent operation.
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_actor_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'admin_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.place_discovery_price_ranges r
  WHERE r.place_pool_id = p_place_pool_id
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'active' THEN
    IF p_expected_version IS NULL
       OR v_existing.version <> p_expected_version THEN
      RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF p_source_min_minor IS NULL OR p_source_min_minor < 0
       OR (p_source_max_minor IS NOT NULL
           AND p_source_max_minor < p_source_min_minor) THEN
      RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
    END IF;
  ELSIF p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  SELECT public.admin_edit_place(
    p_place_pool_id,
    p_name,
    p_price_tier,
    p_is_active,
    p_price_tiers
  ) INTO v_place_result;

  IF v_existing.place_pool_id IS NOT NULL
     AND v_existing.status = 'active' THEN
    SELECT * INTO v_saved
    FROM public.issue_1384_save_discovery_price_range(
      v_existing.brand_id,
      v_existing.venue_id,
      p_place_pool_id,
      p_source_min_minor,
      p_source_max_minor,
      v_existing.source_currency_code,
      p_expected_version,
      pg_catalog.btrim(p_actor_reason),
      p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'place', v_place_result,
    'discoveryPrice', CASE
      WHEN v_saved.place_pool_id IS NULL THEN NULL
      ELSE to_jsonb(v_saved)
    END
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1384_resolve_reconciliation(p_brand_id uuid, p_reconciliation_id uuid, p_decision text, p_fx_snapshot_id uuid DEFAULT NULL::uuid, p_ranges jsonb DEFAULT '[]'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_authoritative_ids uuid[];
  v_request_ids uuid[];
  v_item jsonb;
  v_range public.place_discovery_price_ranges%ROWTYPE;
  v_new_min bigint;
  v_new_max bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('convert', 'reenter', 'accept_no_ranges') THEN
    RAISE EXCEPTION 'incomplete_reentry' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(
    current_setting('mingla.stay_currency_resolution', true),
    ''
  ) <> 'allowed' AND EXISTS (
    SELECT 1
    FROM public.stay_currency_reconciliation_items i
    WHERE i.reconciliation_id = p_reconciliation_id
      AND i.brand_id = p_brand_id
      AND i.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'stay_currency_reconciliation_required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;
  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND OR v_rec.status <> 'pending' THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_brand.default_currency IS NOT NULL
     AND v_brand.default_currency <> v_rec.to_currency_code THEN
    RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required'
  FOR UPDATE;

  SELECT COALESCE(array_agg(r.place_pool_id ORDER BY r.place_pool_id), '{}')
  INTO v_authoritative_ids
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required';

  SELECT COALESCE(
    array_agg((item->>'placePoolId')::uuid ORDER BY (item->>'placePoolId')::uuid),
    '{}'
  ) INTO v_request_ids
  FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb)) item;

  IF p_decision = 'accept_no_ranges' THEN
    IF cardinality(v_authoritative_ids) <> 0 OR cardinality(v_request_ids) <> 0 THEN
      RAISE EXCEPTION 'range_set_changed' USING ERRCODE = 'PT409';
    END IF;
  ELSIF v_authoritative_ids IS DISTINCT FROM v_request_ids THEN
    RAISE EXCEPTION 'range_set_changed' USING ERRCODE = 'PT409';
  END IF;

  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  PERFORM set_config(
    'mingla.discovery_price_reconciliation_id',
    p_reconciliation_id::text,
    true
  );
  PERFORM set_config(
    'mingla.discovery_price_action',
    CASE p_decision WHEN 'convert' THEN 'reconciled_conversion'
      ELSE 'reentered' END,
    true
  );

  IF p_decision = 'convert' THEN
    IF p_fx_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.fx_rate_snapshots s
      WHERE s.id = p_fx_snapshot_id
        AND s.status IN ('active', 'superseded')
        AND now() <= s.expires_at
    ) THEN
      RAISE EXCEPTION 'fx_snapshot_stale' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config(
      'mingla.discovery_price_fx_snapshot_id',
      p_fx_snapshot_id::text,
      true
    );
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb))
  LOOP
    SELECT * INTO v_range
    FROM public.place_discovery_price_ranges r
    WHERE r.place_pool_id = (v_item->>'placePoolId')::uuid
      AND r.brand_id = p_brand_id
    FOR UPDATE;
    IF NOT FOUND OR v_range.version <> (v_item->>'expectedVersion')::bigint THEN
      RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = 'PT409';
    END IF;

    IF p_decision = 'convert' THEN
      v_new_min := public.fx_convert_minor(
        v_range.source_min_minor,
        v_range.source_currency_code,
        v_rec.to_currency_code,
        p_fx_snapshot_id
      );
      v_new_max := CASE WHEN v_range.source_max_minor IS NULL THEN NULL ELSE
        public.fx_convert_minor(
          v_range.source_max_minor,
          v_range.source_currency_code,
          v_rec.to_currency_code,
          p_fx_snapshot_id
        )
      END;
    ELSE
      IF (v_item->>'currencyCode')::character(3) <> v_rec.to_currency_code THEN
        RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
      END IF;
      v_new_min := (v_item->>'sourceMinMinor')::bigint;
      v_new_max := NULLIF(v_item->>'sourceMaxMinor', '')::bigint;
      IF v_new_min IS NULL OR v_new_min < 0
         OR (v_new_max IS NOT NULL AND v_new_max < v_new_min) THEN
        RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE public.place_discovery_price_ranges
      SET status = 'active',
          source_min_minor = v_new_min,
          source_max_minor = v_new_max,
          source_currency_code = v_rec.to_currency_code,
          source_type = CASE WHEN p_decision = 'convert'
            THEN 'reconciled_conversion' ELSE 'business_authored' END,
          source_recorded_at = now(),
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE place_pool_id = v_range.place_pool_id;
  END LOOP;

  UPDATE public.brand_currency_reconciliations
    SET status = CASE p_decision
      WHEN 'convert' THEN 'converted'
      WHEN 'reenter' THEN 'reentered'
      ELSE 'accepted_no_ranges'
    END,
    decision = p_decision,
    fx_snapshot_id = p_fx_snapshot_id,
    resolved_by = v_uid,
    resolved_at = now(),
    resolution_metadata = jsonb_build_object(
      'rangeCount', cardinality(v_authoritative_ids),
      'requestId', p_request_id
    )
  WHERE id = p_reconciliation_id;

  UPDATE public.brands
    SET provisional_currency_code = CASE
      WHEN default_currency IS NULL
        AND v_rec.reason = 'provisional_changed'
      THEN v_rec.to_currency_code
      ELSE NULL
    END
  WHERE id = p_brand_id;

  RETURN public.issue_1384_brand_currency_state(p_brand_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1384_save_discovery_price_range(p_brand_id uuid, p_venue_id uuid, p_place_pool_id uuid, p_source_min_minor bigint, p_source_max_minor bigint, p_source_currency_code character, p_expected_version bigint DEFAULT NULL::bigint, p_actor_reason text DEFAULT 'business_authored'::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS public.place_discovery_price_ranges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_currency character(3);
  v_existing public.place_discovery_price_ranges%ROWTYPE;
  v_result public.place_discovery_price_ranges%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_user()
     AND public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source_min_minor IS NULL OR p_source_min_minor < 0
     OR (p_source_max_minor IS NOT NULL
         AND p_source_max_minor < p_source_min_minor) THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_listings v
    WHERE v.id = p_venue_id
      AND v.brand_id = p_brand_id
      AND v.place_pool_id = p_place_pool_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.brand_currency_reconciliations r
    WHERE r.brand_id = p_brand_id AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'currency_reconciliation_required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(b.default_currency, b.provisional_currency_code)
    INTO v_currency
  FROM public.brands b
  WHERE b.id = p_brand_id
  FOR UPDATE;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_currency <> p_source_currency_code THEN
    RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.place_discovery_price_ranges
  WHERE place_pool_id = p_place_pool_id
  FOR UPDATE;

  IF FOUND AND (
    p_expected_version IS NULL OR v_existing.version <> p_expected_version
  ) THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF NOT FOUND AND p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  PERFORM set_config(
    'mingla.discovery_price_action',
    COALESCE(NULLIF(p_actor_reason, ''), 'business_authored'),
    true
  );
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  INSERT INTO public.place_discovery_price_ranges (
    place_pool_id, brand_id, venue_id, status,
    source_min_minor, source_max_minor, source_currency_code,
    source_type, source_recorded_at, version,
    created_by, updated_by
  ) VALUES (
    p_place_pool_id, p_brand_id, p_venue_id, 'active',
    p_source_min_minor, p_source_max_minor, p_source_currency_code,
    'business_authored', now(), 1,
    v_uid, v_uid
  )
  ON CONFLICT (place_pool_id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    venue_id = EXCLUDED.venue_id,
    status = 'active',
    source_min_minor = EXCLUDED.source_min_minor,
    source_max_minor = EXCLUDED.source_max_minor,
    source_currency_code = EXCLUDED.source_currency_code,
    source_type = CASE
      WHEN p_actor_reason = 'admin_edit' THEN
        public.place_discovery_price_ranges.source_type
      ELSE 'business_authored'
    END,
    source_recorded_at = now(),
    version = public.place_discovery_price_ranges.version + 1,
    updated_by = v_uid,
    updated_at = now()
  RETURNING * INTO v_result;

  IF public.is_admin_user() THEN
    PERFORM public.admin_write_audit(
      'admin.discovery_price.update',
      'place_pool',
      p_place_pool_id::text,
      COALESCE(NULLIF(p_actor_reason, ''), 'admin_edit'),
      jsonb_build_object(
        'before', CASE WHEN v_existing.place_pool_id IS NULL
          THEN NULL ELSE to_jsonb(v_existing) END,
        'after', to_jsonb(v_result),
        'requestId', p_request_id
      ),
      true
    );
  END IF;

  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1384_set_provisional_currency(p_brand_id uuid, p_currency_code character, p_expected_state_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_range_count bigint;
  v_reconciliation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supported_brand_currencies c
    WHERE c.code = upper(p_currency_code::text)::character(3) AND c.active
  ) THEN
    RAISE EXCEPTION 'unsupported_currency' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_brand.default_currency IS NOT NULL THEN
    RAISE EXCEPTION 'currency_already_set' USING ERRCODE = 'P0001';
  END IF;
  IF v_brand.discovery_currency_state_version <> p_expected_state_version THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_brand.provisional_currency_code = p_currency_code THEN
    RETURN public.issue_1384_brand_currency_state(p_brand_id);
  END IF;

  SELECT
    (
      SELECT count(*)
      FROM public.place_discovery_price_ranges r
      WHERE r.brand_id = p_brand_id
        AND r.status IN ('active', 'reconciliation_required')
    )
    + (
      SELECT count(*)
      FROM public.stay_price_versions p
      WHERE p.brand_id = p_brand_id AND p.effective_to IS NULL
    )
    + (
      SELECT count(*)
      FROM public.stay_fee_versions f
      WHERE f.brand_id = p_brand_id
        AND f.effective_to IS NULL
        AND f.calculation LIKE 'fixed_%'
    )
  INTO v_range_count;

  IF v_brand.provisional_currency_code IS NOT NULL AND v_range_count > 0 THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      initiated_by
    ) VALUES (
      p_brand_id,
      v_brand.provisional_currency_code,
      p_currency_code,
      'provisional_changed',
      'pending',
      v_uid
    ) RETURNING id INTO v_reconciliation_id;
    PERFORM set_config(
      'mingla.discovery_price_action',
      'currency_reconciliation_required',
      true
    );
    UPDATE public.place_discovery_price_ranges
      SET status = 'reconciliation_required',
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE brand_id = p_brand_id AND status = 'active';
  ELSE
    UPDATE public.brands
      SET provisional_currency_code = p_currency_code
      WHERE id = p_brand_id;
  END IF;

  RETURN public.issue_1384_brand_currency_state(p_brand_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1387_resolve_currency_reconciliation(p_brand_id uuid, p_reconciliation_id uuid, p_decision text, p_fx_snapshot_id uuid DEFAULT NULL::uuid, p_ranges jsonb DEFAULT '[]'::jsonb, p_stay_items jsonb DEFAULT '[]'::jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_authoritative_ids uuid[];
  v_request_ids uuid[];
  v_item jsonb;
  v_registered public.stay_currency_reconciliation_items%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_new_amount bigint;
  v_new_version integer;
  v_replacement_id uuid;
  v_state jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('convert', 'reenter', 'accept_no_ranges') THEN
    RAISE EXCEPTION 'incomplete_reentry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
    AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.stay_currency_reconciliation_items i
  WHERE i.reconciliation_id = p_reconciliation_id
    AND i.brand_id = p_brand_id
    AND i.status = 'pending'
  FOR UPDATE;

  SELECT COALESCE(array_agg(i.id ORDER BY i.id), '{}')
  INTO v_authoritative_ids
  FROM public.stay_currency_reconciliation_items i
  WHERE i.reconciliation_id = p_reconciliation_id
    AND i.brand_id = p_brand_id
    AND i.status = 'pending';

  SELECT COALESCE(
    array_agg((item->>'itemId')::uuid ORDER BY (item->>'itemId')::uuid),
    '{}'
  ) INTO v_request_ids
  FROM jsonb_array_elements(COALESCE(p_stay_items, '[]'::jsonb)) item;

  IF p_decision = 'accept_no_ranges' THEN
    IF cardinality(v_authoritative_ids) <> 0 OR cardinality(v_request_ids) <> 0 THEN
      RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = 'PT409';
    END IF;
  ELSIF v_authoritative_ids IS DISTINCT FROM v_request_ids THEN
    RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = 'PT409';
  END IF;

  IF p_decision = 'convert' AND (
    p_fx_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.fx_rate_snapshots s
      WHERE s.id = p_fx_snapshot_id
        AND s.status IN ('active', 'superseded')
        AND now() <= s.expires_at
    )
  ) THEN
    RAISE EXCEPTION 'fx_snapshot_stale' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_stay_items, '[]'::jsonb))
  LOOP
    SELECT * INTO v_registered
    FROM public.stay_currency_reconciliation_items i
    WHERE i.id = (v_item->>'itemId')::uuid
      AND i.reconciliation_id = p_reconciliation_id
      AND i.brand_id = p_brand_id
      AND i.status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = 'PT409';
    END IF;

    IF p_decision = 'convert' THEN
      v_new_amount := public.fx_convert_minor(
        v_registered.source_amount_minor,
        v_registered.source_currency_code,
        v_rec.to_currency_code,
        p_fx_snapshot_id
      );
    ELSE
      IF upper(v_item->>'currencyCode')::character(3)
         <> v_rec.to_currency_code THEN
        RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
      END IF;
      v_new_amount := (v_item->>'amountMinor')::bigint;
      IF v_new_amount IS NULL OR v_new_amount < 0 THEN
        RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_registered.item_kind = 'price' THEN
      SELECT * INTO v_price
      FROM public.stay_price_versions p
      WHERE p.id = v_registered.source_version_id
        AND p.brand_id = p_brand_id
        AND p.effective_to IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = 'PT409';
      END IF;
      SELECT max(p.version_number) + 1 INTO v_new_version
      FROM public.stay_price_versions p
      WHERE p.offering_id = v_price.offering_id;
      UPDATE public.stay_price_versions SET effective_to = now()
      WHERE id = v_price.id;
      INSERT INTO public.stay_price_versions (
        offering_id, brand_id, venue_id, version_number, amount_minor,
        currency_code, pricing_unit, reconciliation_id,
        supersedes_version_id, created_by
      ) VALUES (
        v_price.offering_id, v_price.brand_id, v_price.venue_id,
        v_new_version, v_new_amount, v_rec.to_currency_code,
        v_price.pricing_unit, p_reconciliation_id, v_price.id, v_uid
      ) RETURNING id INTO v_replacement_id;
    ELSE
      SELECT * INTO v_fee
      FROM public.stay_fee_versions f
      WHERE f.id = v_registered.source_version_id
        AND f.brand_id = p_brand_id
        AND f.effective_to IS NULL
        AND f.calculation LIKE 'fixed_%'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = 'PT409';
      END IF;
      SELECT max(f.version_number) + 1 INTO v_new_version
      FROM public.stay_fee_versions f
      WHERE f.offering_id = v_fee.offering_id
        AND f.fee_key = v_fee.fee_key;
      UPDATE public.stay_fee_versions SET effective_to = now()
      WHERE id = v_fee.id;
      INSERT INTO public.stay_fee_versions (
        offering_id, brand_id, venue_id, fee_key, label, version_number,
        fee_kind, calculation, amount_minor, basis_points, currency_code,
        display_mode, refund_treatment, reconciliation_id,
        supersedes_version_id, created_by
      ) VALUES (
        v_fee.offering_id, v_fee.brand_id, v_fee.venue_id, v_fee.fee_key,
        v_fee.label, v_new_version, v_fee.fee_kind, v_fee.calculation,
        v_new_amount, NULL, v_rec.to_currency_code, v_fee.display_mode,
        v_fee.refund_treatment, p_reconciliation_id, v_fee.id, v_uid
      ) RETURNING id INTO v_replacement_id;
    END IF;

    UPDATE public.stay_currency_reconciliation_items
      SET status = CASE p_decision WHEN 'convert' THEN 'converted'
        ELSE 'reentered' END,
          replacement_version_id = v_replacement_id,
          resolved_at = now()
      WHERE id = v_registered.id;
  END LOOP;

  PERFORM set_config('mingla.stay_currency_resolution', 'allowed', true);
  SELECT public.issue_1384_resolve_reconciliation(
    p_brand_id,
    p_reconciliation_id,
    p_decision,
    p_fx_snapshot_id,
    p_ranges,
    p_request_id
  ) INTO v_state;

  UPDATE public.brand_currency_reconciliations
    SET resolution_metadata = resolution_metadata || jsonb_build_object(
      'stayMoneyCount', cardinality(v_authoritative_ids)
    )
  WHERE id = p_reconciliation_id;

  RETURN v_state;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1388_create_stay_group(p_quote_id uuid, p_idempotency_key text, p_guest jsonb, p_expected_quote_version bigint DEFAULT NULL::bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_key text := public.issue_1388_actor_key();
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_group_id uuid := gen_random_uuid();
  v_hold_id uuid := gen_random_uuid();
  v_settings public.stay_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_reservation_line public.stay_reservation_lines%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_night public.stay_room_nights%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_resource jsonb;
  v_allocation public.stay_quote_allocations%ROWTYPE;
  v_date date;
  v_unit_id uuid;
  v_preference uuid;
  v_unit_index integer;
  v_held bigint;
  v_committed bigint;
  v_available bigint;
  v_request_hash text;
  v_group_state text;
  v_line_state text;
  v_hold_expires_at timestamptz;
  v_request_deadline timestamptz;
  v_dependency_room_line_id uuid;
BEGIN
  IF v_uid IS NULL OR v_actor_key IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_quote_id IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_guest) <> 'object'
     OR jsonb_typeof(p_guest->'name') <> 'string'
     OR (
       p_guest ? 'email'
       AND jsonb_typeof(p_guest->'email') <> 'string'
     )
     OR (
       p_guest ? 'phone'
       AND jsonb_typeof(p_guest->'phone') <> 'string'
     )
     OR (
       p_guest ? 'phoneCountryIso'
       AND jsonb_typeof(p_guest->'phoneCountryIso') NOT IN ('string','null')
     )
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'name', '')))
       NOT BETWEEN 1 AND 120
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'email', ''))) > 254
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) > 40
     OR (
       char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) > 0
       AND pg_catalog.btrim(p_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$'
     )
     OR (
       NULLIF(p_guest->>'phoneCountryIso','') IS NOT NULL
       AND (p_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$'
     )
     OR (
       NULLIF(p_guest->>'phoneCountryIso','') IS NOT NULL
       AND char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) = 0
     )
     OR (
       char_length(pg_catalog.btrim(COALESCE(p_guest->>'email', ''))) = 0
       AND char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) = 0
     )
     OR p_guest - ARRAY['name', 'email', 'phone', 'phoneCountryIso'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'quoteId', p_quote_id,
        'guest', p_guest
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_key || ':group:' || pg_catalog.btrim(p_idempotency_key),
      1388
    )
  );
  SELECT * INTO v_existing
  FROM public.stay_reservation_groups
  WHERE actor_key_hash = v_actor_key
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_group_projection(v_existing.id);
  END IF;

  SELECT * INTO v_quote
  FROM public.stay_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> v_actor_key THEN
    RAISE EXCEPTION 'stay_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_quote_version IS NULL
     OR v_quote.version <> p_expected_quote_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' AND v_quote.expires_at <= now() THEN
      UPDATE public.stay_quotes
      SET status = 'expired', version = version + 1
      WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'stay_quote_expired' USING ERRCODE = '22023';
  END IF;

  -- Binding lock order: brand/settings/currency readiness, idempotency/quote,
  -- offerings, Room nights, Place windows, private units, then active slices.
  PERFORM 1 FROM public.brands
  WHERE id = v_quote.brand_id
  FOR UPDATE;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = v_quote.venue_id
  FOR UPDATE;
  IF NOT FOUND OR v_settings.booking_state <> 'active'
     OR NOT public.pg_brand_can_collect(v_quote.brand_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.brands b
       WHERE b.id = v_quote.brand_id
         AND upper(b.default_currency) = v_quote.currency_code
     )
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations r
       WHERE r.brand_id = v_quote.brand_id AND r.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.stay_offerings offering
  JOIN public.stay_quote_lines line ON line.offering_id = offering.id
  WHERE line.quote_id = v_quote.id
  ORDER BY offering.id
  FOR UPDATE OF offering;

  PERFORM 1
  FROM public.stay_room_nights night
  JOIN public.stay_quote_lines line
    ON line.offering_id = night.offering_id
   AND line.kind = 'room'
   AND night.local_date >= line.room_check_in
   AND night.local_date < line.room_check_out
  WHERE line.quote_id = v_quote.id
  ORDER BY night.offering_id, night.local_date
  FOR UPDATE OF night;

  PERFORM 1
  FROM public.stay_place_windows window_row
  JOIN public.stay_quote_lines line
    ON line.place_window_id = window_row.id
  WHERE line.quote_id = v_quote.id
  ORDER BY window_row.offering_id, window_row.starts_at, window_row.id
  FOR UPDATE OF window_row;

  PERFORM 1
  FROM public.stay_units unit_row
  JOIN public.stay_quote_lines line
    ON line.offering_id = unit_row.offering_id
  WHERE line.quote_id = v_quote.id
    AND unit_row.status = 'active'
  ORDER BY unit_row.offering_id, unit_row.id
  FOR UPDATE OF unit_row;

  PERFORM 1
  FROM public.stay_inventory_hold_slices slice_row
  JOIN public.stay_inventory_holds hold_row
    ON hold_row.id = slice_row.hold_id
  WHERE slice_row.offering_id IN (
    SELECT offering_id
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
  )
    AND hold_row.state IN ('active', 'reconciliation_required')
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  FOR UPDATE OF slice_row, hold_row;

  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.offering_id IN (
    SELECT offering_id
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
  )
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;

  UPDATE public.stay_inventory_holds hold_row
  SET state = 'expired', version = version + 1, updated_at = now()
  WHERE hold_row.state = 'active'
    AND hold_row.expires_at <= now()
    AND EXISTS (
      SELECT 1
      FROM public.stay_inventory_hold_slices slice_row
      WHERE slice_row.hold_id = hold_row.id
        AND slice_row.offering_id IN (
          SELECT offering_id
          FROM public.stay_quote_lines
          WHERE quote_id = v_quote.id
        )
    );

  FOR v_line IN
    SELECT * FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
    ORDER BY offering_id, place_window_id NULLS FIRST
  LOOP
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_line.offering_id;
    IF NOT FOUND OR v_offering.status <> 'live'
       OR v_offering.version <> v_line.offering_version
       OR v_offering.confirmation_mode <> v_line.confirmation_mode
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_price_versions p
         WHERE p.id = v_line.price_version_id
           AND p.offering_id = v_line.offering_id
           AND p.effective_to IS NULL
           AND p.currency_code = v_quote.currency_code
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_policy_versions p
         WHERE p.id = v_line.policy_version_id
           AND p.offering_id = v_line.offering_id
           AND p.effective_to IS NULL
       ) THEN
      RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
    END IF;
    FOR v_resource IN
      SELECT value
      FROM jsonb_array_elements(v_line.inventory_snapshot->'resources')
    LOOP
      IF v_resource->>'resourceType' = 'room_night' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.stay_room_nights n
          WHERE n.offering_id = v_line.offering_id
            AND n.local_date = (v_resource->>'localDate')::date
            AND n.version = (v_resource->>'version')::bigint
            AND NOT n.stop_sell
        ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM public.stay_place_windows w
          WHERE w.id = (v_resource->>'windowId')::uuid
            AND w.offering_id = v_line.offering_id
            AND w.version = (v_resource->>'version')::bigint
            AND NOT w.stop_sell
            AND w.ends_at > now()
        ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  v_group_state := CASE v_quote.mode
    WHEN 'request' THEN 'request_pending'
    ELSE 'instant_payment_pending'
  END;
  v_line_state := CASE v_quote.mode
    WHEN 'request' THEN 'request_pending'
    ELSE 'payment_pending'
  END;
  v_request_deadline := CASE v_quote.mode
    WHEN 'request' THEN
      now() + make_interval(hours => v_settings.request_response_hours)
    ELSE NULL
  END;
  v_hold_expires_at := COALESCE(
    v_request_deadline,
    now() + make_interval(mins => v_settings.instant_payment_hold_minutes)
  );

  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash,
    venue_id, brand_id, currency_code, mode, state,
    request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash
  ) VALUES (
    v_group_id,
    'ST-' || upper(substr(replace(v_group_id::text, '-', ''), 1, 20)),
    v_quote.id, v_uid, v_actor_key,
    v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    v_quote.mode, v_group_state, v_request_deadline, NULL, p_guest,
    v_quote.source_subtotal_minor, v_quote.fee_total_minor,
    v_quote.tax_total_minor, v_quote.total_minor,
    pg_catalog.btrim(p_idempotency_key), v_request_hash
  );

  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state,
    room_check_in, room_check_out, room_quantity,
    place_window_id, place_units, place_guests, adults, children,
    base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot
  )
  SELECT
    gen_random_uuid(), v_group_id, line.id, line.offering_id, line.kind,
    v_line_state, line.room_check_in, line.room_check_out, line.room_quantity,
    line.place_window_id, line.place_units, line.place_guests,
    line.adults, line.children,
    line.base_minor, line.fee_minor, line.tax_minor, line.total_minor,
    line.offering_snapshot, line.price_snapshot, line.policy_snapshot
  FROM public.stay_quote_lines line
  WHERE line.quote_id = v_quote.id AND line.kind = 'room'
  ORDER BY line.offering_id;

  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state,
    room_check_in, room_check_out, room_quantity,
    place_window_id, place_units, place_guests, adults, children,
    base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot,
    dependency_room_line_id
  )
  SELECT
    gen_random_uuid(), v_group_id, line.id, line.offering_id, line.kind,
    v_line_state, line.room_check_in, line.room_check_out, line.room_quantity,
    line.place_window_id, line.place_units, line.place_guests,
    line.adults, line.children,
    line.base_minor, line.fee_minor, line.tax_minor, line.total_minor,
    line.offering_snapshot, line.price_snapshot, line.policy_snapshot,
    CASE WHEN offering.access_scope = 'overnight_guests_only' THEN (
      SELECT room_reservation.id
      FROM public.stay_reservation_lines room_reservation
      JOIN public.stay_quote_lines room_quote
        ON room_quote.id = room_reservation.quote_line_id
      WHERE room_reservation.group_id = v_group_id
        AND room_reservation.kind = 'room'
        AND room_quote.room_check_in <= window_row.local_date
        AND room_quote.room_check_out > window_row.local_date
      ORDER BY room_reservation.offering_id, room_reservation.id
      LIMIT 1
    ) ELSE NULL END
  FROM public.stay_quote_lines line
  JOIN public.stay_offerings offering ON offering.id = line.offering_id
  JOIN public.stay_place_windows window_row ON window_row.id = line.place_window_id
  WHERE line.quote_id = v_quote.id AND line.kind = 'place'
  ORDER BY line.offering_id, line.place_window_id;

  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines line
    JOIN public.stay_offerings offering ON offering.id = line.offering_id
    WHERE line.group_id = v_group_id
      AND line.kind = 'place'
      AND offering.access_scope = 'overnight_guests_only'
      AND line.dependency_room_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_inventory_holds (
    id, group_id, state, expires_at, reason
  ) VALUES (
    v_hold_id, v_group_id, 'active', v_hold_expires_at,
    CASE v_quote.mode
      WHEN 'request' THEN 'request_response'
      ELSE 'instant_payment'
    END
  );

  FOR v_line IN
    SELECT quote_line.*
    FROM public.stay_quote_lines quote_line
    WHERE quote_line.quote_id = v_quote.id
    ORDER BY quote_line.offering_id, quote_line.place_window_id NULLS FIRST
  LOOP
    SELECT * INTO v_reservation_line
    FROM public.stay_reservation_lines
    WHERE group_id = v_group_id AND quote_line_id = v_line.id;
    SELECT * INTO v_offering
    FROM public.stay_offerings WHERE id = v_line.offering_id;

    IF v_line.kind = 'room' THEN
      FOR v_date IN
        SELECT d::date
        FROM generate_series(
          v_line.room_check_in::timestamp,
          (v_line.room_check_out - 1)::timestamp,
          interval '1 day'
        ) d
        ORDER BY d
      LOOP
        SELECT * INTO v_night
        FROM public.stay_room_nights
        WHERE offering_id = v_line.offering_id AND local_date = v_date;
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        WHERE slice_row.offering_id = v_line.offering_id
          AND slice_row.resource_type = 'room_night'
          AND slice_row.room_date = v_date
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments
        WHERE offering_id = v_line.offering_id
          AND resource_type = 'room_night'
          AND room_date = v_date
          AND state = 'active';
        v_available := v_night.sellable_quantity - v_held - v_committed;
        IF v_available < v_line.room_quantity THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
      END LOOP;

      IF v_offering.unit_naming_mode = 'named' THEN
        FOR v_allocation IN
          SELECT * FROM public.stay_quote_allocations
          WHERE quote_line_id = v_line.id
          ORDER BY allocation_ordinal
        LOOP
          v_preference := v_allocation.named_unit_preference;
          IF v_preference IS NOT NULL THEN
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.id = v_preference
              AND u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND slice_row.resource_type = 'room_night'
                  AND slice_row.room_date >= v_line.room_check_in
                  AND slice_row.room_date < v_line.room_check_out
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.resource_type = 'room_night'
                  AND commitment.room_date >= v_line.room_check_in
                  AND commitment.room_date < v_line.room_check_out
                  AND commitment.state = 'active'
              );
          ELSE
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND slice_row.resource_type = 'room_night'
                  AND slice_row.room_date >= v_line.room_check_in
                  AND slice_row.room_date < v_line.room_check_out
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.resource_type = 'room_night'
                  AND commitment.room_date >= v_line.room_check_in
                  AND commitment.room_date < v_line.room_check_out
                  AND commitment.state = 'active'
              )
            ORDER BY u.id
            LIMIT 1;
          END IF;
          IF v_unit_id IS NULL THEN
            RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
          END IF;
          FOR v_date IN
            SELECT d::date
            FROM generate_series(
              v_line.room_check_in::timestamp,
              (v_line.room_check_out - 1)::timestamp,
              interval '1 day'
            ) d
            ORDER BY d
          LOOP
            INSERT INTO public.stay_inventory_hold_slices (
              hold_id, reservation_line_id, resource_type, offering_id,
              room_date, quantity, exclusive_unit_id
            ) VALUES (
              v_hold_id, v_reservation_line.id, 'room_night',
              v_line.offering_id, v_date, 1, v_unit_id
            );
          END LOOP;
          v_unit_id := NULL;
        END LOOP;
      ELSE
        FOR v_date IN
          SELECT d::date
          FROM generate_series(
            v_line.room_check_in::timestamp,
            (v_line.room_check_out - 1)::timestamp,
            interval '1 day'
          ) d
          ORDER BY d
        LOOP
          INSERT INTO public.stay_inventory_hold_slices (
            hold_id, reservation_line_id, resource_type, offering_id,
            room_date, quantity
          ) VALUES (
            v_hold_id, v_reservation_line.id, 'room_night',
            v_line.offering_id, v_date, v_line.room_quantity
          );
        END LOOP;
      END IF;
    ELSE
      SELECT * INTO v_window
      FROM public.stay_place_windows WHERE id = v_line.place_window_id;
      IF v_offering.inventory_basis = 'shared_capacity' THEN
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        WHERE slice_row.place_window_id = v_window.id
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments
        WHERE place_window_id = v_window.id AND state = 'active';
        v_available :=
          v_window.sellable_capacity - v_held - v_committed;
        IF v_available < v_line.place_guests THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
        INSERT INTO public.stay_inventory_hold_slices (
          hold_id, reservation_line_id, resource_type, offering_id,
          place_window_id, quantity
        ) VALUES (
          v_hold_id, v_reservation_line.id, 'place_window',
          v_line.offering_id, v_window.id, v_line.place_guests
        );
      ELSE
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        JOIN public.stay_place_windows held_window
          ON held_window.id = slice_row.place_window_id
        WHERE slice_row.offering_id = v_line.offering_id
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          )
          AND held_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND held_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        SELECT COALESCE(sum(commitment.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments commitment
        JOIN public.stay_place_windows committed_window
          ON committed_window.id = commitment.place_window_id
        WHERE commitment.offering_id = v_line.offering_id
          AND commitment.state = 'active'
          AND committed_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND committed_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        v_available := v_window.sellable_units - v_held - v_committed;
        IF v_available < v_line.place_units THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;

        IF v_offering.unit_naming_mode = 'named' THEN
          FOR v_unit_index IN 1..v_line.place_units
          LOOP
            v_preference := v_line.named_unit_preferences[v_unit_index];
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND (v_preference IS NULL OR u.id = v_preference)
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                JOIN public.stay_place_windows held_window
                  ON held_window.id = slice_row.place_window_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
                  AND held_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
                      < v_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                  AND held_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                      > v_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                JOIN public.stay_place_windows committed_window
                  ON committed_window.id = commitment.place_window_id
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.state = 'active'
                  AND committed_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
                      < v_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                  AND committed_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                      > v_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
              )
            ORDER BY u.id
            LIMIT 1;
            IF v_unit_id IS NULL THEN
              RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
            END IF;
            INSERT INTO public.stay_inventory_hold_slices (
              hold_id, reservation_line_id, resource_type, offering_id,
              place_window_id, quantity, exclusive_unit_id
            ) VALUES (
              v_hold_id, v_reservation_line.id, 'place_window',
              v_line.offering_id, v_window.id, 1, v_unit_id
            );
            v_unit_id := NULL;
          END LOOP;
        ELSE
          INSERT INTO public.stay_inventory_hold_slices (
            hold_id, reservation_line_id, resource_type, offering_id,
            place_window_id, quantity
          ) VALUES (
            v_hold_id, v_reservation_line.id, 'place_window',
            v_line.offering_id, v_window.id, v_line.place_units
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.stay_quotes
  SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    request_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group_id,
    CASE v_quote.mode
      WHEN 'request' THEN 'stay_request_submitted'
      ELSE 'stay_instant_payment_pending'
    END,
    'guest',
    v_uid,
    p_request_id,
    'create:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'mode', v_quote.mode,
      'holdExpiresAt', v_hold_expires_at,
      'lineCount', (
        SELECT count(*) FROM public.stay_reservation_lines
        WHERE group_id = v_group_id
      )
    )
  );

  RETURN public.issue_1388_group_projection(v_group_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1388_guard_state_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stay_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_quotes' THEN
    IF OLD.status <> NEW.status AND NOT (
      (OLD.status = 'building' AND NEW.status = 'active')
      OR (
        OLD.status = 'active'
        AND NEW.status IN ('expired', 'consumed')
      )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    IF OLD.state <> NEW.state AND NOT (
       (
         OLD.state = 'instant_payment_pending'
         AND NEW.state IN (
           'finalizing', 'cancelled', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'request_pending'
         AND NEW.state IN (
           'approved_payment_required',
           'declined',
           'request_expired',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'approved_payment_required'
         AND NEW.state IN (
           'finalizing',
           'request_expired',
           'cancelled',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'finalizing'
         AND NEW.state IN ('confirmed', 'reconciliation_required')
       )
       OR (
         OLD.state = 'confirmed'
         AND NEW.state IN (
           'partially_cancelled', 'cancelled', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'partially_cancelled'
         AND NEW.state IN ('cancelled', 'reconciliation_required')
       )
       OR (
         OLD.state = 'reconciliation_required'
         AND NEW.state IN (
           'finalizing',
           'confirmed',
           'partially_cancelled',
           'cancelled'
         )
       )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_lines' THEN
    IF OLD.state <> NEW.state AND NOT (
       (
         OLD.state = 'payment_pending'
         AND NEW.state IN (
           'confirmed', 'cancelled', 'expired', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'request_pending'
         AND NEW.state IN (
           'approved_payment_required',
           'declined',
           'expired',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'approved_payment_required'
         AND NEW.state IN (
           'confirmed', 'cancelled', 'expired', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'confirmed'
         AND NEW.state IN ('cancelled', 'reconciliation_required')
       )
       OR (
         OLD.state = 'reconciliation_required'
         AND NEW.state IN ('confirmed', 'cancelled')
       )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_holds' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_hold_identity_immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state AND NOT (
      (
        OLD.state = 'active'
        AND NEW.state IN (
          'converted', 'released', 'expired', 'reconciliation_required'
        )
      )
      OR (
        OLD.state = 'reconciliation_required'
        AND NEW.state IN ('converted', 'released')
      )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_commitments' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.reservation_line_id <> OLD.reservation_line_id
       OR NEW.resource_type <> OLD.resource_type
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.room_date IS DISTINCT FROM OLD.room_date
       OR NEW.place_window_id IS DISTINCT FROM OLD.place_window_id
       OR NEW.quantity <> OLD.quantity
       OR NEW.exclusive_unit_id IS DISTINCT FROM OLD.exclusive_unit_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_commitment_identity_immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state
       AND NOT (OLD.state = 'active' AND NEW.state = 'released') THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1388_manage_request(p_action text, p_group_id uuid, p_expected_version bigint, p_idempotency_key text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_existing_event public.stay_reservation_events%ROWTYPE;
  v_event_type text;
  v_event_key text;
  v_payment_deadline timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_action NOT IN ('approve_request', 'decline_request')
     OR p_group_id IS NULL
     OR p_expected_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_group.brand_id, v_uid, 'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = v_group.venue_id
  FOR UPDATE;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id
  FOR UPDATE;
  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = p_group_id
  FOR UPDATE;

  v_event_type := CASE v_action
    WHEN 'approve_request' THEN 'stay_request_approved'
    ELSE 'stay_request_declined'
  END;
  v_event_key := v_action || ':' || pg_catalog.btrim(p_idempotency_key);
  SELECT * INTO v_existing_event
  FROM public.stay_reservation_events
  WHERE group_id = p_group_id AND idempotency_key = v_event_key;
  IF FOUND THEN
    IF v_existing_event.event_type NOT IN (
      v_event_type,
      'stay_request_expired'
    ) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_group_projection(p_group_id);
  END IF;
  IF v_hold.id IS NULL OR v_hold.state <> 'active' THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
  END IF;

  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.mode <> 'request' OR v_group.state <> 'request_pending' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;

  IF v_group.request_deadline <= now() OR v_hold.expires_at <= now() THEN
    UPDATE public.stay_reservation_groups
    SET state = 'request_expired', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id,
      request_id, idempotency_key, safe_metadata
    ) VALUES (
      p_group_id, 'stay_request_expired', 'staff', v_uid,
      p_request_id, v_event_key,
      jsonb_build_object('expiredAt', now())
    );
    RETURN public.issue_1388_group_projection(p_group_id);
  END IF;

  IF v_action = 'approve_request' THEN
    IF v_settings.booking_state <> 'active'
       OR NOT public.pg_brand_can_collect(v_group.brand_id)
       OR EXISTS (
         SELECT 1 FROM public.brand_currency_reconciliations r
         WHERE r.brand_id = v_group.brand_id AND r.status = 'pending'
       ) THEN
      RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
    END IF;
    v_payment_deadline :=
      now() + make_interval(mins => v_settings.approved_payment_minutes);
    UPDATE public.stay_reservation_groups
    SET state = 'approved_payment_required',
        payment_deadline = v_payment_deadline,
        version = version + 1,
        updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'approved_payment_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET expires_at = v_payment_deadline,
        reason = 'approved_payment',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    UPDATE public.stay_reservation_groups
    SET state = 'declined', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'declined', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET state = 'released',
        reason = 'request_declined',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    request_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, v_event_type, 'staff', v_uid,
    p_request_id, v_event_key,
    jsonb_build_object('paymentDeadline', v_payment_deadline)
  );
  RETURN public.issue_1388_group_projection(p_group_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1388_quote_stay_cart(p_venue_id uuid, p_lines jsonb, p_idempotency_key text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_key text := public.issue_1388_actor_key();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_quote public.stay_quotes%ROWTYPE;
  v_quote_id uuid := gen_random_uuid();
  v_quote_line_id uuid;
  v_offering public.stay_offerings%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_night public.stay_room_nights%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_window_id uuid;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_item jsonb;
  v_allocation jsonb;
  v_normalized_lines jsonb;
  v_request_hash text;
  v_currency character(3);
  v_kind text;
  v_check_in date;
  v_check_out date;
  v_common_check_in date;
  v_common_check_out date;
  v_date date;
  v_quantity integer;
  v_units integer;
  v_guests integer;
  v_adults integer;
  v_children integer;
  v_nights integer;
  v_base bigint;
  v_available bigint;
  v_held bigint;
  v_committed bigint;
  v_named_preferences uuid[];
  v_named_preference uuid;
  v_inventory_snapshot jsonb;
  v_mode text := 'instant';
  v_total_base bigint;
  v_total bigint;
BEGIN
  IF v_uid IS NULL OR v_actor_key IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_venue_id IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF COALESCE(v_item->>'offeringId', '') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR lower(COALESCE(v_item->>'kind', '')) NOT IN ('room', 'place')
       OR (
         lower(v_item->>'kind') = 'place'
         AND COALESCE(v_item->>'placeWindowId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       ) THEN
      RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) item
    GROUP BY
      lower(item->>'kind'),
      (item->>'offeringId')::uuid,
      CASE WHEN lower(item->>'kind') = 'place'
        THEN (item->>'placeWindowId')::uuid ELSE NULL END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'stay_duplicate_cart_line' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(value ORDER BY
    (value->>'offeringId')::uuid,
    CASE WHEN lower(value->>'kind') = 'place'
      THEN (value->>'placeWindowId')::uuid ELSE NULL END
  ) INTO v_normalized_lines
  FROM jsonb_array_elements(p_lines);
  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'venueId', p_venue_id,
          'lines', v_normalized_lines
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_key || ':quote:' || pg_catalog.btrim(p_idempotency_key),
      1388
    )
  );
  SELECT * INTO v_quote
  FROM public.stay_quotes
  WHERE actor_key_hash = v_actor_key
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_quote.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_quote_projection(v_quote.id);
  END IF;

  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = p_venue_id AND booking_state = 'active';
  IF NOT FOUND OR v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'stay_reservations_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT upper(b.default_currency)::character(3) INTO v_currency
  FROM public.brands b
  WHERE b.id = v_venue.brand_id
    AND b.default_currency IS NOT NULL;
  IF v_currency IS NULL OR NOT public.pg_brand_can_collect(v_venue.brand_id) THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, status, source_subtotal_minor, fee_total_minor, tax_total_minor,
    total_minor, request_hash, price_revision_set_hash,
    inventory_revision_set_hash, policy_snapshot_hash, idempotency_key,
    expires_at, request_id
  ) VALUES (
    v_quote_id, v_uid, v_actor_key, p_venue_id, v_venue.brand_id, v_currency,
    'instant', 'building', 0, 0, 0, 0, v_request_hash,
    repeat('0', 64), repeat('0', 64), repeat('0', 64),
    pg_catalog.btrim(p_idempotency_key),
    now() + make_interval(mins => v_settings.instant_payment_hold_minutes),
    p_request_id
  );

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_normalized_lines)
    ORDER BY
      (value->>'offeringId')::uuid,
      CASE WHEN lower(value->>'kind') = 'place'
        THEN (value->>'placeWindowId')::uuid ELSE NULL END
  LOOP
    v_kind := lower(v_item->>'kind');
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = (v_item->>'offeringId')::uuid
      AND venue_id = p_venue_id
      AND brand_id = v_venue.brand_id
      AND kind = v_kind
      AND status = 'live';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_offering.confirmation_mode, '') NOT IN ('instant', 'request')
    THEN
      RAISE EXCEPTION 'stay_reservations_unavailable' USING ERRCODE = 'P0001';
    END IF;
    IF v_offering.confirmation_mode = 'request' THEN
      v_mode := 'request';
    END IF;
    SELECT * INTO v_price
    FROM public.stay_price_versions
    WHERE offering_id = v_offering.id AND effective_to IS NULL;
    SELECT * INTO v_policy
    FROM public.stay_policy_versions
    WHERE offering_id = v_offering.id AND effective_to IS NULL;
    IF v_price.id IS NULL OR v_policy.id IS NULL
       OR v_price.currency_code <> v_currency THEN
      RAISE EXCEPTION 'stay_currency_mismatch' USING ERRCODE = '22023';
    END IF;

    v_quote_line_id := gen_random_uuid();
    v_base := 0;
    v_adults := 0;
    v_children := 0;
    v_named_preferences := '{}'::uuid[];
    v_inventory_snapshot := '[]'::jsonb;

    IF v_kind = 'room' THEN
      BEGIN
        v_check_in := (v_item->>'checkIn')::date;
        v_check_out := (v_item->>'checkOut')::date;
        v_quantity := (v_item->>'quantity')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
      END;
      IF v_check_out <= v_check_in
         OR v_quantity IS NULL
         OR v_quantity NOT BETWEEN 1 AND 100
         OR v_quantity > v_offering.quantity
         OR jsonb_typeof(v_item->'allocations') <> 'array'
         OR jsonb_array_length(v_item->'allocations') <> v_quantity THEN
        RAISE EXCEPTION 'stay_invalid_room_allocation' USING ERRCODE = '22023';
      END IF;
      IF v_common_check_in IS NULL THEN
        v_common_check_in := v_check_in;
        v_common_check_out := v_check_out;
      ELSIF v_common_check_in <> v_check_in
         OR v_common_check_out <> v_check_out THEN
        RAISE EXCEPTION 'stay_room_dates_must_match' USING ERRCODE = '22023';
      END IF;
      v_nights := v_check_out - v_check_in;
      IF v_check_in <
           (now() AT TIME ZONE v_settings.timezone)::date
         OR v_check_in >
           (now() AT TIME ZONE v_settings.timezone)::date
             + LEAST(
               v_settings.booking_horizon_days,
               COALESCE(
                 v_offering.max_advance_days,
                 v_settings.booking_horizon_days
               )
             )
         OR (
           (v_check_in::timestamp + v_settings.check_in_time)
             AT TIME ZONE v_settings.timezone
         ) < now() + make_interval(mins => v_offering.min_notice_minutes)
      THEN
        RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
      END IF;

      FOR v_allocation IN
        SELECT value
        FROM jsonb_array_elements(v_item->'allocations')
        WITH ORDINALITY allocation(value, ordinal)
        ORDER BY ordinal
      LOOP
        BEGIN
          v_adults := v_adults
            + COALESCE((v_allocation->>'adults')::integer, 0);
          v_children := v_children
            + COALESCE((v_allocation->>'children')::integer, 0);
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'stay_invalid_room_allocation'
            USING ERRCODE = '22023';
        END;
        IF COALESCE((v_allocation->>'adults')::integer, 0) < 0
           OR COALESCE((v_allocation->>'children')::integer, 0) < 0
           OR COALESCE((v_allocation->>'adults')::integer, 0)
             > v_offering.max_adults
           OR COALESCE((v_allocation->>'children')::integer, 0)
             > v_offering.max_children
           OR COALESCE((v_allocation->>'adults')::integer, 0)
              + COALESCE((v_allocation->>'children')::integer, 0)
             NOT BETWEEN v_offering.min_guests AND v_offering.max_guests THEN
          RAISE EXCEPTION 'stay_invalid_room_allocation'
            USING ERRCODE = '22023';
        END IF;
        IF NULLIF(v_allocation->>'namedUnitPreference', '') IS NOT NULL THEN
          IF (v_allocation->>'namedUnitPreference') !~
             '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN
            RAISE EXCEPTION 'stay_invalid_room_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preference :=
            (v_allocation->>'namedUnitPreference')::uuid;
          IF v_named_preference = ANY(v_named_preferences)
             OR NOT EXISTS (
               SELECT 1 FROM public.stay_units u
               WHERE u.id = v_named_preference
                 AND u.offering_id = v_offering.id
                 AND u.status = 'active'
             ) THEN
            RAISE EXCEPTION 'stay_invalid_room_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preferences :=
            pg_catalog.array_append(v_named_preferences, v_named_preference);
        END IF;
      END LOOP;

      FOR v_date IN
        SELECT d::date
        FROM generate_series(
          v_check_in::timestamp,
          (v_check_out - 1)::timestamp,
          interval '1 day'
        ) d
        ORDER BY d
      LOOP
        SELECT * INTO v_night
        FROM public.stay_room_nights
        WHERE offering_id = v_offering.id AND local_date = v_date;
        IF NOT FOUND OR v_night.stop_sell
           OR v_nights < v_night.minimum_nights
           OR (
             v_night.maximum_nights IS NOT NULL
             AND v_nights > v_night.maximum_nights
           )
           OR (
             v_night.price_override_minor IS NOT NULL
             AND v_night.currency_code <> v_currency
           ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
        SELECT COALESCE(sum(s.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.offering_id = v_offering.id
          AND s.resource_type = 'room_night'
          AND s.room_date = v_date
          AND (
            (h.state = 'active' AND h.expires_at > now())
            OR h.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(c.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments c
        WHERE c.offering_id = v_offering.id
          AND c.resource_type = 'room_night'
          AND c.room_date = v_date
          AND c.state = 'active';
        v_available := v_night.sellable_quantity - v_held - v_committed;
        IF v_available < v_quantity THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
        v_base := v_base
          + COALESCE(v_night.price_override_minor, v_price.amount_minor)
            * v_quantity;
        v_inventory_snapshot := v_inventory_snapshot || jsonb_build_array(
          jsonb_build_object(
            'resourceType', 'room_night',
            'localDate', v_date,
            'version', v_night.version,
            'sellableQuantity', v_night.sellable_quantity
          )
        );
      END LOOP;

      INSERT INTO public.stay_quote_lines (
        id, quote_id, offering_id, kind, confirmation_mode,
        room_check_in, room_check_out, room_quantity,
        adults, children, named_unit_preferences,
        base_minor, fee_minor, tax_minor, total_minor,
        price_version_id, policy_version_id, offering_version,
        inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot
      ) VALUES (
        v_quote_line_id, v_quote_id, v_offering.id, 'room',
        v_offering.confirmation_mode,
        v_check_in, v_check_out, v_quantity,
        v_adults, v_children, v_named_preferences,
        v_base, 0, 0, v_base,
        v_price.id, v_policy.id, v_offering.version,
        jsonb_build_object('resources', v_inventory_snapshot),
        jsonb_build_object(
          'name', v_offering.name,
          'kind', v_offering.kind,
          'inventoryBasis', v_offering.inventory_basis,
          'unitNamingMode', v_offering.unit_naming_mode,
          'quantity', v_offering.quantity,
          'maxGuests', v_offering.max_guests,
          'maxAdults', v_offering.max_adults,
          'maxChildren', v_offering.max_children
        ),
        to_jsonb(v_price),
        to_jsonb(v_policy)
      );
      INSERT INTO public.stay_quote_allocations (
        quote_line_id, allocation_ordinal, adults, children,
        named_unit_preference
      )
      SELECT
        v_quote_line_id,
        ordinal::integer - 1,
        COALESCE((value->>'adults')::integer, 0),
        COALESCE((value->>'children')::integer, 0),
        NULLIF(value->>'namedUnitPreference', '')::uuid
      FROM jsonb_array_elements(v_item->'allocations')
        WITH ORDINALITY allocation(value, ordinal)
      ORDER BY ordinal;
    ELSE
      BEGIN
        v_window_id := (v_item->>'placeWindowId')::uuid;
        v_units := NULLIF(v_item->>'units', '')::integer;
        v_guests := NULLIF(v_item->>'guests', '')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
      END;
      SELECT * INTO v_window
      FROM public.stay_place_windows
      WHERE id = v_window_id AND offering_id = v_offering.id;
      IF NOT FOUND OR v_window.stop_sell OR v_window.ends_at <= now()
         OR v_window.starts_at
              < now() + make_interval(mins => v_offering.min_notice_minutes)
         OR v_window.local_date >
              (now() AT TIME ZONE v_settings.timezone)::date
              + LEAST(
                v_settings.booking_horizon_days,
                COALESCE(
                  v_offering.max_advance_days,
                  v_settings.booking_horizon_days
                )
              )
         OR (
           v_window.price_override_minor IS NOT NULL
           AND v_window.currency_code <> v_currency
         ) THEN
        RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
      END IF;

      IF v_offering.inventory_basis = 'shared_capacity' THEN
        IF v_units IS NOT NULL
           OR v_guests IS NULL
           OR v_guests NOT BETWEEN
             v_offering.min_guests AND v_offering.max_guests THEN
          RAISE EXCEPTION 'stay_invalid_place_allocation'
            USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(sum(s.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.place_window_id = v_window.id
          AND (
            (h.state = 'active' AND h.expires_at > now())
            OR h.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(c.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments c
        WHERE c.place_window_id = v_window.id AND c.state = 'active';
        v_available :=
          v_window.sellable_capacity - v_held - v_committed;
        IF v_available < v_guests THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
      ELSE
        IF v_units IS NULL
           OR v_units NOT BETWEEN 1 AND v_offering.quantity
           OR v_guests IS NULL
           OR v_guests NOT BETWEEN
             v_offering.min_guests AND v_offering.max_guests THEN
          RAISE EXCEPTION 'stay_invalid_place_allocation'
            USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(sum(s.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        JOIN public.stay_place_windows held_window
          ON held_window.id = s.place_window_id
        WHERE s.offering_id = v_offering.id
          AND (
            (h.state = 'active' AND h.expires_at > now())
            OR h.state = 'reconciliation_required'
          )
          AND held_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND held_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        SELECT COALESCE(sum(c.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments c
        JOIN public.stay_place_windows committed_window
          ON committed_window.id = c.place_window_id
        WHERE c.offering_id = v_offering.id
          AND c.state = 'active'
          AND committed_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND committed_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        v_available := v_window.sellable_units - v_held - v_committed;
        IF v_available < v_units THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
        END IF;
      END IF;

      IF v_offering.unit_naming_mode = 'named' THEN
        IF jsonb_typeof(COALESCE(
          v_item->'namedUnitPreferences', '[]'::jsonb
        )) <> 'array' OR jsonb_array_length(COALESCE(
          v_item->'namedUnitPreferences', '[]'::jsonb
        )) > COALESCE(v_units, 0) THEN
          RAISE EXCEPTION 'stay_invalid_place_allocation'
            USING ERRCODE = '22023';
        END IF;
        FOR v_allocation IN
          SELECT value
          FROM jsonb_array_elements(COALESCE(
            v_item->'namedUnitPreferences', '[]'::jsonb
          ))
        LOOP
          IF jsonb_typeof(v_allocation) <> 'string'
             OR trim(both '"' from v_allocation::text) !~
               '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN
            RAISE EXCEPTION 'stay_invalid_place_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preference :=
            trim(both '"' from v_allocation::text)::uuid;
          IF v_named_preference = ANY(v_named_preferences)
             OR NOT EXISTS (
               SELECT 1 FROM public.stay_units u
               WHERE u.id = v_named_preference
                 AND u.offering_id = v_offering.id
                 AND u.status = 'active'
             ) THEN
            RAISE EXCEPTION 'stay_invalid_place_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preferences :=
            pg_catalog.array_append(v_named_preferences, v_named_preference);
        END LOOP;
      END IF;

      v_adults := COALESCE(NULLIF(v_item->>'adults', '')::integer, 0);
      v_children := COALESCE(NULLIF(v_item->>'children', '')::integer, 0);
      IF v_adults < 0
         OR v_children < 0
         OR (
           v_adults + v_children > 0
           AND v_adults + v_children <> v_guests
         ) THEN
        RAISE EXCEPTION 'stay_invalid_place_allocation'
          USING ERRCODE = '22023';
      END IF;
      v_base := COALESCE(v_window.price_override_minor, v_price.amount_minor)
        * CASE v_offering.place_pricing_basis
            WHEN 'per_unit' THEN v_units
            WHEN 'per_guest' THEN v_guests
            ELSE 1
          END;
      IF v_base IS NULL THEN
        RAISE EXCEPTION 'stay_invalid_place_allocation'
          USING ERRCODE = '22023';
      END IF;
      v_inventory_snapshot := jsonb_build_object(
        'resources', jsonb_build_array(jsonb_build_object(
          'resourceType', 'place_window',
          'windowId', v_window.id,
          'version', v_window.version,
          'startsAt', v_window.starts_at,
          'endsAt', v_window.ends_at,
          'sellableUnits', v_window.sellable_units,
          'sellableCapacity', v_window.sellable_capacity
        ))
      );

      INSERT INTO public.stay_quote_lines (
        id, quote_id, offering_id, kind, confirmation_mode,
        place_window_id, place_units, place_guests, adults, children,
        named_unit_preferences, base_minor, fee_minor, tax_minor, total_minor,
        price_version_id, policy_version_id, offering_version,
        inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot
      ) VALUES (
        v_quote_line_id, v_quote_id, v_offering.id, 'place',
        v_offering.confirmation_mode, v_window.id, v_units, v_guests,
        v_adults, v_children, v_named_preferences,
        v_base, 0, 0, v_base,
        v_price.id, v_policy.id, v_offering.version,
        v_inventory_snapshot,
        jsonb_build_object(
          'name', v_offering.name,
          'kind', v_offering.kind,
          'inventoryBasis', v_offering.inventory_basis,
          'unitNamingMode', v_offering.unit_naming_mode,
          'quantity', v_offering.quantity,
          'capacity', v_offering.capacity,
          'maxGuests', v_offering.max_guests,
          'accessScope', v_offering.access_scope,
          'pricingBasis', v_offering.place_pricing_basis,
          'bufferBeforeMinutes', v_offering.buffer_before_minutes,
          'bufferAfterMinutes', v_offering.buffer_after_minutes
        ),
        to_jsonb(v_price),
        to_jsonb(v_policy)
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.stay_quote_lines place_line
    JOIN public.stay_offerings place_offering
      ON place_offering.id = place_line.offering_id
    JOIN public.stay_place_windows place_window
      ON place_window.id = place_line.place_window_id
    WHERE place_line.quote_id = v_quote_id
      AND place_offering.access_scope = 'overnight_guests_only'
      AND NOT EXISTS (
        SELECT 1
        FROM public.stay_quote_lines room_line
        WHERE room_line.quote_id = v_quote_id
          AND room_line.kind = 'room'
          AND room_line.room_check_in <= place_window.local_date
          AND room_line.room_check_out > place_window.local_date
      )
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_quote_fee_lines (
    quote_id, quote_line_id, fee_version_id, name, fee_kind,
    amount_minor, included_in_base, refund_treatment, snapshot
  )
  SELECT
    v_quote_id,
    line.id,
    fee.id,
    fee.label,
    fee.fee_kind,
    CASE fee.calculation
      WHEN 'fixed_per_room_night' THEN
        fee.amount_minor
          * line.room_quantity
          * (line.room_check_out - line.room_check_in)
      WHEN 'fixed_per_place_booking' THEN fee.amount_minor
      WHEN 'fixed_per_place_unit' THEN fee.amount_minor * line.place_units
      WHEN 'fixed_per_place_guest' THEN fee.amount_minor * line.place_guests
      WHEN 'percentage_of_line_base' THEN
        ((line.base_minor::numeric * fee.basis_points + 5000) / 10000)::bigint
      ELSE 0
    END,
    fee.display_mode = 'included',
    fee.refund_treatment,
    to_jsonb(fee)
  FROM public.stay_quote_lines line
  JOIN public.stay_fee_versions fee
    ON fee.offering_id = line.offering_id
   AND fee.effective_to IS NULL
  WHERE line.quote_id = v_quote_id
    AND fee.calculation <> 'fixed_per_group'
    AND (
      fee.calculation = 'percentage_of_line_base'
      OR (line.kind = 'room' AND fee.calculation = 'fixed_per_room_night')
      OR (
        line.kind = 'place'
        AND (
          fee.calculation IN (
            'fixed_per_place_booking',
            'fixed_per_place_guest'
          )
          OR (
            fee.calculation = 'fixed_per_place_unit'
            AND line.place_units IS NOT NULL
          )
        )
      )
    )
    AND (
      fee.calculation = 'percentage_of_line_base'
      OR fee.currency_code = v_currency
    );

  FOR v_fee IN
    SELECT fee.*
    FROM public.stay_fee_versions fee
    WHERE fee.effective_to IS NULL
      AND fee.calculation = 'fixed_per_group'
      AND fee.currency_code = v_currency
      AND EXISTS (
        SELECT 1 FROM public.stay_quote_lines line
        WHERE line.quote_id = v_quote_id
          AND line.offering_id = fee.offering_id
      )
    ORDER BY fee.id
  LOOP
    SELECT sum(base_minor) INTO v_total_base
    FROM public.stay_quote_lines WHERE quote_id = v_quote_id;
    IF v_total_base = 0 THEN
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind,
        amount_minor, included_in_base, refund_treatment, snapshot
      )
      SELECT
        v_quote_id, line.id, v_fee.id, v_fee.label, v_fee.fee_kind,
        CASE WHEN row_number() OVER (ORDER BY line.id) = 1
          THEN v_fee.amount_minor ELSE 0 END,
        v_fee.display_mode = 'included',
        v_fee.refund_treatment,
        to_jsonb(v_fee)
      FROM public.stay_quote_lines line
      WHERE line.quote_id = v_quote_id;
    ELSE
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind,
        amount_minor, included_in_base, refund_treatment, snapshot
      )
      WITH base_allocations AS (
        SELECT
          line.id,
          floor(
            v_fee.amount_minor::numeric * line.base_minor / v_total_base
          )::bigint AS floor_minor,
          (
            v_fee.amount_minor::numeric * line.base_minor
            - floor(
              v_fee.amount_minor::numeric * line.base_minor / v_total_base
            ) * v_total_base
          ) AS remainder
        FROM public.stay_quote_lines line
        WHERE line.quote_id = v_quote_id
      ),
      ranked AS (
        SELECT
          b.*,
          row_number() OVER (ORDER BY b.remainder DESC, b.id) AS rank,
          sum(b.floor_minor) OVER () AS floor_total
        FROM base_allocations b
      )
      SELECT
        v_quote_id,
        ranked.id,
        v_fee.id,
        v_fee.label,
        v_fee.fee_kind,
        ranked.floor_minor + CASE
          WHEN ranked.rank <= v_fee.amount_minor - ranked.floor_total
            THEN 1 ELSE 0 END,
        v_fee.display_mode = 'included',
        v_fee.refund_treatment,
        to_jsonb(v_fee)
      FROM ranked;
    END IF;
  END LOOP;

  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor,
      tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT
      quote_line_id,
      COALESCE(sum(amount_minor) FILTER (
        WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base
      ), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (
        WHERE fee_kind = 'tax' AND NOT included_in_base
      ), 0) AS tax_minor
    FROM public.stay_quote_fee_lines
    WHERE quote_id = v_quote_id
    GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;

  SELECT sum(total_minor) INTO v_total
  FROM public.stay_quote_lines WHERE quote_id = v_quote_id;
  IF v_total IS NULL OR v_total > 9000000000000000 THEN
    RAISE EXCEPTION 'stay_money_out_of_range' USING ERRCODE = '22003';
  END IF;

  UPDATE public.stay_quotes q
  SET mode = v_mode,
      status = 'active',
      source_subtotal_minor = totals.source_subtotal_minor,
      fee_total_minor = totals.fee_total_minor,
      tax_total_minor = totals.tax_total_minor,
      total_minor = totals.total_minor,
      price_revision_set_hash = (
        SELECT encode(extensions.digest(
          pg_catalog.convert_to(string_agg(
            l.price_version_id::text || ':' || l.price_snapshot::text,
            '|' ORDER BY l.offering_id, l.place_window_id NULLS FIRST
          ), 'UTF8'), 'sha256'), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id
      ),
      inventory_revision_set_hash = (
        SELECT encode(extensions.digest(
          pg_catalog.convert_to(string_agg(
            l.offering_id::text || ':' || l.offering_version::text
              || ':' || l.inventory_snapshot::text,
            '|' ORDER BY l.offering_id, l.place_window_id NULLS FIRST
          ), 'UTF8'), 'sha256'), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id
      ),
      policy_snapshot_hash = (
        SELECT encode(extensions.digest(
          pg_catalog.convert_to(string_agg(
            l.policy_version_id::text || ':' || l.policy_snapshot::text,
            '|' ORDER BY l.offering_id, l.place_window_id NULLS FIRST
          ), 'UTF8'), 'sha256'), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id
      )
  FROM (
    SELECT
      sum(base_minor) AS source_subtotal_minor,
      sum(fee_minor) AS fee_total_minor,
      sum(tax_minor) AS tax_total_minor,
      sum(total_minor) AS total_minor
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote_id
  ) totals
  WHERE q.id = v_quote_id;

  RETURN public.issue_1388_quote_projection(v_quote_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_bind_payment_attempt(p_attempt_id uuid, p_provider_payment_ref text, p_provider_charge_ref text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_provider_payment_ref, '')))
       NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.state = 'pending' THEN
    IF v_attempt.provider_payment_ref <> pg_catalog.btrim(
      p_provider_payment_ref
    ) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  IF v_attempt.state <> 'created' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_payment_attempts
  SET state = 'pending',
      provider_payment_ref = pg_catalog.btrim(p_provider_payment_ref),
      provider_charge_ref = NULLIF(
        pg_catalog.btrim(COALESCE(p_provider_charge_ref, '')),
        ''
      ),
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;
  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    provider_reference, idempotency_key, metadata
  ) VALUES (
    v_attempt.group_id, v_attempt.id, 'charge_pending',
    v_attempt.amount_minor, v_attempt.currency_code,
    v_attempt.provider_payment_ref,
    'stay:charge_pending:' || v_attempt.id,
    jsonb_build_object('provider', v_attempt.provider)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_cancel_preview(p_group_id uuid, p_selected_line_ids uuid[], p_expected_group_version bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_actor_type text;
  v_selected uuid[];
  v_snapshot jsonb;
  v_amount bigint;
  v_preview_id uuid := gen_random_uuid();
  v_hash text;
  v_expires_at timestamptz := now() + interval '10 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR cardinality(p_selected_line_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_selected_line_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT selected_id ORDER BY selected_id)
  INTO v_selected
  FROM unnest(p_selected_line_ids) selected_id;
  IF cardinality(v_selected) <> cardinality(p_selected_line_ids) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.user_id = v_uid THEN
    v_actor_type := 'guest';
  ELSIF public.is_admin_user() THEN
    v_actor_type := 'admin';
  ELSIF public.issue_1387_has_brand_capability(
    v_group.brand_id,
    v_uid,
    'inventory'
  ) THEN
    v_actor_type := 'staff';
  ELSE
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF (
    SELECT count(*) FROM public.stay_reservation_lines line
    WHERE line.group_id = p_group_id
      AND line.id = ANY(v_selected)
      AND line.state = 'confirmed'
  ) <> cardinality(v_selected) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_selected)
      AND room_line.kind = 'room'
      AND place_line.group_id = p_group_id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_selected))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH eligible AS (
    SELECT
      allocation.id AS payment_allocation_id,
      allocation.reservation_line_id,
      allocation.component,
      allocation.component_ref,
      allocation.refund_treatment,
      GREATEST(
        0,
        allocation.charged_minor
          - allocation.refunded_minor
          - COALESCE((
            SELECT sum(refund_allocation.amount_minor)
            FROM public.stay_refund_allocations refund_allocation
            JOIN public.stay_refunds refund_row
              ON refund_row.id = refund_allocation.refund_id
            WHERE refund_allocation.payment_allocation_id = allocation.id
              AND refund_row.state IN (
                'submitted', 'processing', 'manual_reconciliation'
              )
          ), 0)
      ) AS outstanding_minor,
      CASE
        WHEN allocation.refund_treatment = 'refundable' THEN 10000
        WHEN allocation.refund_treatment = 'nonrefundable' THEN 0
        WHEN v_actor_type IN ('staff', 'admin') THEN
          COALESCE(
            (line.policy_snapshot->>'operator_cancel_refund_basis_points')
              ::integer,
            10000
          )
        WHEN now() < public.issue_1389_line_start_at(line.id)
          - make_interval(mins => COALESCE(
            (line.policy_snapshot->>'free_cancel_cutoff_minutes')::integer,
            0
          )) THEN 10000
        WHEN now() < public.issue_1389_line_start_at(line.id) THEN
          COALESCE(
            (line.policy_snapshot->>'late_refund_basis_points')::integer,
            0
          )
        ELSE COALESCE(
          (line.policy_snapshot->>'no_show_refund_basis_points')::integer,
          0
        )
      END AS refund_basis_points
    FROM public.stay_payment_allocations allocation
    JOIN public.stay_reservation_lines line
      ON line.id = allocation.reservation_line_id
    WHERE allocation.payment_attempt_id = v_attempt.id
      AND allocation.reservation_line_id = ANY(v_selected)
  ),
  calculated AS (
    SELECT
      eligible.*,
      LEAST(
        outstanding_minor,
        (
          outstanding_minor::numeric * refund_basis_points + 5000
        )::bigint / 10000
      ) AS refund_minor
    FROM eligible
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'paymentAllocationId', payment_allocation_id,
      'reservationLineId', reservation_line_id,
      'component', component,
      'componentRef', component_ref,
      'refundTreatment', refund_treatment,
      'refundBasisPoints', refund_basis_points,
      'amountMinor', refund_minor::text
    ) ORDER BY reservation_line_id, payment_allocation_id), '[]'::jsonb),
    COALESCE(sum(refund_minor), 0)
  INTO v_snapshot, v_amount
  FROM calculated
  WHERE refund_minor > 0;

  v_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'previewId', v_preview_id,
        'groupId', p_group_id,
        'groupVersion', v_group.version,
        'actorUserId', v_uid,
        'selectedLineIds', to_jsonb(v_selected),
        'amountMinor', v_amount::text,
        'allocations', v_snapshot,
        'expiresAt', v_expires_at
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.stay_cancel_previews (
    id, group_id, actor_user_id, actor_type, selected_line_ids,
    group_version, amount_minor, allocation_snapshot, preview_hash, expires_at
  ) VALUES (
    v_preview_id, p_group_id, v_uid, v_actor_type, v_selected,
    v_group.version, v_amount, v_snapshot, v_hash, v_expires_at
  );

  RETURN jsonb_build_object(
    'previewId', v_preview_id,
    'previewHash', v_hash,
    'groupId', p_group_id,
    'groupVersion', v_group.version,
    'selectedLineIds', to_jsonb(v_selected),
    'amountMinor', v_amount::text,
    'currencyCode', v_group.currency_code,
    'allocations', v_snapshot,
    'expiresAt', v_expires_at
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_cancel(p_preview_id uuid, p_preview_hash text, p_idempotency_key text, p_reason text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_allocation jsonb;
  v_fee_reversal bigint;
  v_fee_remaining bigint;
  v_existing_fee bigint;
  v_all_active_selected boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview_id IS NULL
     OR p_preview_hash !~ '^[a-f0-9]{64}$'
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
       NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-cancel:' || p_preview_id::text,
      1389
    )
  );
  SELECT * INTO v_refund
  FROM public.stay_refunds
  WHERE idempotency_key = pg_catalog.btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN jsonb_build_object(
      'refundId', v_refund.id,
      'groupId', v_refund.group_id,
      'state', v_refund.state,
      'amountMinor', v_refund.amount_minor::text,
      'currencyCode', v_refund.currency_code
    );
  END IF;

  SELECT * INTO v_preview
  FROM public.stay_cancel_previews
  WHERE id = p_preview_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_preview.actor_user_id <> v_uid
     OR v_preview.preview_hash <> p_preview_hash THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_preview.consumed_at IS NOT NULL OR v_preview.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_cancel_preview_expired' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_preview.group_id
  FOR UPDATE;
  IF v_group.version <> v_preview.group_version
     OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = v_group.id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.stay_payment_allocations allocation
  WHERE allocation.payment_attempt_id = v_attempt.id
    AND allocation.reservation_line_id = ANY(v_preview.selected_line_ids)
  ORDER BY allocation.reservation_line_id, allocation.id
  FOR UPDATE;
  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.group_id = v_group.id
    AND commitment.reservation_line_id = ANY(v_preview.selected_line_ids)
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_preview.selected_line_ids)
      AND room_line.kind = 'room'
      AND place_line.group_id = v_group.id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_preview.selected_line_ids))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(application_fee_reversal_minor), 0)
  INTO v_existing_fee
  FROM public.stay_refunds prior_refund
  WHERE prior_refund.payment_attempt_id = v_attempt.id
    AND prior_refund.state IN (
      'submitted', 'processing', 'succeeded', 'manual_reconciliation'
    );
  v_fee_remaining := GREATEST(
    0,
    v_attempt.application_fee_minor - v_existing_fee
  );
  v_fee_reversal := CASE
    WHEN v_preview.amount_minor = 0 THEN 0
    WHEN v_preview.amount_minor >= (
      SELECT COALESCE(sum(
        allocation.charged_minor - allocation.refunded_minor
      ), 0)
      FROM public.stay_payment_allocations allocation
      WHERE allocation.payment_attempt_id = v_attempt.id
    ) THEN v_fee_remaining
    ELSE LEAST(
      v_fee_remaining,
      (
        v_attempt.application_fee_minor::numeric
          * v_preview.amount_minor
          + v_attempt.amount_minor / 2
      )::bigint / v_attempt.amount_minor
    )
  END;

  INSERT INTO public.stay_refunds (
    group_id, payment_attempt_id, cancel_preview_id,
    requested_by_type, requested_by_user_id, reason, state,
    amount_minor, application_fee_reversal_minor, currency_code,
    provider, idempotency_key
  ) VALUES (
    v_group.id, v_attempt.id, v_preview.id,
    v_preview.actor_type, v_uid, pg_catalog.btrim(p_reason),
    CASE WHEN v_preview.amount_minor = 0 THEN 'succeeded' ELSE 'submitted' END,
    v_preview.amount_minor, v_fee_reversal, v_group.currency_code,
    v_attempt.provider, pg_catalog.btrim(p_idempotency_key)
  ) RETURNING * INTO v_refund;

  IF v_preview.amount_minor > 0 THEN
    WITH requested AS (
      SELECT
        (item->>'paymentAllocationId')::uuid AS payment_allocation_id,
        (item->>'reservationLineId')::uuid AS reservation_line_id,
        (item->>'amountMinor')::bigint AS amount_minor
      FROM jsonb_array_elements(v_preview.allocation_snapshot) item
    ),
    floors AS (
      SELECT
        requested.*,
        floor(
          v_fee_reversal::numeric * requested.amount_minor
          / v_preview.amount_minor
        )::bigint AS fee_floor,
        (
          v_fee_reversal::numeric * requested.amount_minor
          - floor(
            v_fee_reversal::numeric * requested.amount_minor
            / v_preview.amount_minor
          ) * v_preview.amount_minor
        ) AS remainder
      FROM requested
    ),
    ranked AS (
      SELECT
        floors.*,
        row_number() OVER (
          ORDER BY remainder DESC, payment_allocation_id
        ) AS remainder_rank,
        v_fee_reversal - sum(fee_floor) OVER () AS extras
      FROM floors
    )
    INSERT INTO public.stay_refund_allocations (
      refund_id, payment_allocation_id, reservation_line_id,
      amount_minor, organizer_liability_minor,
      platform_fee_reversal_minor, state
    )
    SELECT
      v_refund.id,
      ranked.payment_allocation_id,
      ranked.reservation_line_id,
      ranked.amount_minor,
      ranked.amount_minor - (
        ranked.fee_floor
        + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END
      ),
      ranked.fee_floor
        + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END,
      'submitted'
    FROM ranked;

    INSERT INTO public.source_refunds (
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, requested_by_user_id, reason, provider, currency,
      original_charge_cents, buyer_refund_requested_cents,
      original_application_fee_cents, fee_reversal_required_cents,
      fee_state, fee_leg_kind, financial_state,
      organizer_refund_liability_cents, platform_fee_absorption_cents,
      provider_payment_reference, provider_account_reference, idempotency_key
    ) VALUES (
      'stay_reservation', v_refund.id, v_group.id, v_group.brand_id,
      v_group.venue_id, 'stay_cancellation',
      CASE v_preview.actor_type
        WHEN 'guest' THEN 'consumer'
        WHEN 'admin' THEN 'admin'
        ELSE 'brand_staff'
      END,
      v_uid, pg_catalog.btrim(p_reason), v_attempt.provider,
      v_group.currency_code::text, v_attempt.amount_minor::integer,
      v_refund.amount_minor::integer,
      v_attempt.application_fee_minor::integer,
      v_fee_reversal::integer,
      CASE WHEN v_fee_reversal = 0 THEN 'not_required' ELSE 'queued' END,
      CASE
        WHEN v_fee_reversal = 0 THEN 'not_required'
        WHEN v_attempt.provider = 'stripe'
          THEN 'stripe_application_fee_refund'
        ELSE 'paystack_ledger_allocation'
      END,
      'pending',
      (v_refund.amount_minor - v_fee_reversal)::integer,
      v_fee_reversal::integer,
      v_attempt.provider_payment_ref,
      v_attempt.connected_account_ref,
      'stay-refund:' || v_refund.id
    ) RETURNING * INTO v_source;

    UPDATE public.stay_refunds
    SET source_refund_id = v_source.id,
        updated_at = now()
    WHERE id = v_refund.id
    RETURNING * INTO v_refund;

    INSERT INTO public.source_refund_ledger_allocations (
      refund_id, allocation_type, amount_cents, currency, provider,
      state, idempotency_key
    ) VALUES (
      v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents,
      v_source.currency, v_source.provider, 'prepared',
      'source-refund-allocation:buyer:' || v_source.id
    );
    IF v_source.organizer_refund_liability_cents > 0 THEN
      INSERT INTO public.source_refund_ledger_allocations (
        refund_id, allocation_type, amount_cents, currency, provider,
        state, idempotency_key
      ) VALUES (
        v_source.id, 'organizer_refund_liability',
        v_source.organizer_refund_liability_cents,
        v_source.currency, v_source.provider, 'prepared',
        'source-refund-allocation:organizer:' || v_source.id
      );
    END IF;
    IF v_source.platform_fee_absorption_cents > 0 THEN
      INSERT INTO public.source_refund_ledger_allocations (
        refund_id, allocation_type, amount_cents, currency, provider,
        state, idempotency_key
      ) VALUES (
        v_source.id, 'platform_application_fee_reversal',
        v_source.platform_fee_absorption_cents,
        v_source.currency, v_source.provider, 'prepared',
        'source-refund-allocation:platform:' || v_source.id
      );
    END IF;
  END IF;

  UPDATE public.stay_inventory_commitments
  SET state = 'released',
      released_at = now(),
      release_reason = 'reservation_cancelled'
  WHERE group_id = v_group.id
    AND reservation_line_id = ANY(v_preview.selected_line_ids)
    AND state = 'active';
  UPDATE public.stay_reservation_lines
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND id = ANY(v_preview.selected_line_ids)
    AND state = 'confirmed';

  SELECT NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_lines line
    WHERE line.group_id = v_group.id AND line.state = 'confirmed'
  ) INTO v_all_active_selected;
  UPDATE public.stay_reservation_groups
  SET state = CASE
        WHEN v_all_active_selected THEN 'cancelled'
        ELSE 'partially_cancelled'
      END,
      version = version + 1,
      updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_cancel_previews
  SET consumed_at = now()
  WHERE id = v_preview.id;

  FOR v_allocation IN
    SELECT jsonb_build_object(
      'lineId', allocation.reservation_line_id,
      'amountMinor', sum(allocation.amount_minor)::text
    ) AS value
    FROM public.stay_refund_allocations allocation
    WHERE allocation.refund_id = v_refund.id
    GROUP BY allocation.reservation_line_id
    ORDER BY allocation.reservation_line_id
  LOOP
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, refund_id, entry_type,
      amount_minor, currency_code, idempotency_key, metadata
    ) VALUES (
      v_group.id,
      (v_allocation->>'lineId')::uuid,
      v_attempt.id,
      v_refund.id,
      CASE WHEN v_refund.amount_minor = 0
        THEN 'refund_succeeded' ELSE 'refund_requested' END,
      (v_allocation->>'amountMinor')::bigint,
      v_group.currency_code,
      'stay:refund_requested:' || v_refund.id || ':' ||
        (v_allocation->>'lineId'),
      jsonb_build_object('reason', 'reservation_cancelled')
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_cancelled', v_preview.actor_type, v_uid,
    p_request_id, 'cancel:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'refundId', v_refund.id,
      'selectedLineIds', to_jsonb(v_preview.selected_line_ids),
      'amountMinor', v_refund.amount_minor::text,
      'currencyCode', v_refund.currency_code
    )
  );

  RETURN jsonb_build_object(
    'refundId', v_refund.id,
    'groupId', v_group.id,
    'state', v_refund.state,
    'amountMinor', v_refund.amount_minor::text,
    'currencyCode', v_refund.currency_code,
    'group', public.issue_1388_group_projection(v_group.id)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_prepare_payment(p_group_id uuid, p_idempotency_key text, p_expected_group_version bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness_revision bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-payment:' || p_group_id::text || ':' ||
        pg_catalog.btrim(p_idempotency_key),
      1389
    )
  );

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'groupId', p_group_id,
        'expectedVersion', p_expected_group_version
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF (
    v_group.mode = 'instant'
    AND v_group.state <> 'instant_payment_pending'
  ) OR (
    v_group.mode = 'request'
    AND v_group.state <> 'approved_payment_required'
  ) THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.mode = 'request' AND v_group.payment_deadline IS NULL THEN
    RAISE EXCEPTION 'stay_payment_before_approval' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
  END IF;

  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack'
      THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack'
      THEN pricing.paystack_subaccount_code
      ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(
    v_group.brand_id,
    v_group.venue_id
  ) pricing
  LIMIT 1;

  SELECT b.payout_hold_cutover_at INTO v_cutover
  FROM public.brands b WHERE b.id = v_group.brand_id;
  SELECT b.discovery_currency_state_version INTO v_readiness_revision
  FROM public.brands b
  WHERE b.id = v_group.brand_id;

  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_group.brand_id
         AND reconciliation.status = 'pending'
     )
     OR v_cutover IS NULL THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_provider = 'stripe' AND (
    v_account IS NULL
    OR NOT public.issue_1389_flag_enabled('STAY_STRIPE_COMMERCE')
  ) THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_provider = 'paystack' AND (
    v_currency <> 'NGN'
    OR NOT public.issue_1389_flag_enabled('STAY_PAYSTACK_COMMERCE')
  ) THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_group.total_minor <= 0 OR v_group.total_minor > 2147483647 THEN
    RAISE EXCEPTION 'stay_money_out_of_range' USING ERRCODE = '22003';
  END IF;

  v_app_fee := LEAST(
    v_group.total_minor,
    ((v_group.total_minor::numeric * COALESCE(v_take_rate, 0) + 5000)
      / 10000)::bigint
  );
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id;

  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref,
    amount_minor, currency_code, application_fee_minor, state,
    idempotency_key, request_hash, readiness_revision
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account,
    v_group.total_minor, v_group.currency_code, v_app_fee, 'created',
    pg_catalog.btrim(p_idempotency_key), v_request_hash,
    COALESCE(v_readiness_revision, 1)
  ) RETURNING * INTO v_attempt;

  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment, snapshot
  )
  SELECT
    v_attempt.id, line.id, 'base', 'base',
    line.base_minor, 'same_as_line',
    jsonb_build_object('policy', line.policy_snapshot)
  FROM public.stay_reservation_lines line
  WHERE line.group_id = p_group_id
  ORDER BY line.id;

  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment, snapshot
  )
  SELECT
    v_attempt.id,
    reservation_line.id,
    CASE quote_fee.fee_kind WHEN 'tax' THEN 'tax' ELSE 'fee' END,
    quote_fee.id::text,
    quote_fee.amount_minor,
    quote_fee.refund_treatment,
    quote_fee.snapshot
  FROM public.stay_reservation_lines reservation_line
  JOIN public.stay_quote_fee_lines quote_fee
    ON quote_fee.quote_line_id = reservation_line.quote_line_id
  WHERE reservation_line.group_id = p_group_id
    AND NOT quote_fee.included_in_base
    AND quote_fee.amount_minor > 0
  ORDER BY reservation_line.id, quote_fee.id;

  IF (
    SELECT COALESCE(sum(allocation.charged_minor), 0)
    FROM public.stay_payment_allocations allocation
    WHERE allocation.payment_attempt_id = v_attempt.id
  ) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_payment_allocation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', v_uid, p_request_id,
    'payment-prepared:' || v_attempt.id,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code
    )
  );

  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_record_stay_dispute(p_provider_event_id text, p_provider_event_type text, p_provider_charge_ref text, p_dispute_ref text, p_amount_minor integer, p_currency_code text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_event_id uuid;
  v_line record;
  v_resolved boolean := lower(p_status) IN ('won', 'warning_closed');
  v_release public.brand_payout_releases%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor < 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_charge_ref, '')) NOT BETWEEN 3 AND 200
     OR char_length(COALESCE(p_dispute_ref, '')) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = 'stripe'
    AND (
      provider_charge_ref = p_provider_charge_ref
      OR provider_payment_ref = p_provider_charge_ref
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  IF v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR p_amount_minor > v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_provider_evidence_mismatch'
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type,
    payment_attempt_id, event_fingerprint, safe_payload
  ) VALUES (
    'stripe', p_provider_event_id, p_provider_event_type,
    v_attempt.id,
    encode(extensions.digest(
      pg_catalog.convert_to(
        p_provider_event_id || ':' || p_dispute_ref || ':' || p_status,
        'UTF8'
      ),
      'sha256'
    ), 'hex'),
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', true,
      'groupId', v_group.id,
      'replayed', true
    );
  END IF;

  IF v_resolved THEN
    UPDATE public.stay_reservation_lines
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id
      AND state = 'reconciliation_required';
    UPDATE public.stay_reservation_groups
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE id = v_group.id
      AND state = 'reconciliation_required'
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_refunds refund_row
        WHERE refund_row.group_id = v_group.id
          AND refund_row.state IN (
            'submitted', 'processing', 'manual_reconciliation'
          )
      );
  ELSE
    UPDATE public.stay_reservation_lines
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id AND state = 'confirmed';
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN ('confirmed', 'partially_cancelled');
  END IF;

  FOR v_line IN
    WITH weights AS (
      SELECT
        line.id,
        line.total_minor,
        floor(
          p_amount_minor::numeric * line.total_minor
            / v_attempt.amount_minor
        )::integer AS amount_floor,
        (
          p_amount_minor::numeric * line.total_minor
            - floor(
              p_amount_minor::numeric * line.total_minor
                / v_attempt.amount_minor
            ) * v_attempt.amount_minor
        ) AS remainder
      FROM public.stay_reservation_lines line
      WHERE line.group_id = v_group.id
        AND line.state <> 'cancelled'
    ),
    ranked AS (
      SELECT
        weights.*,
        row_number() OVER (ORDER BY remainder DESC, id) AS remainder_rank,
        p_amount_minor - sum(amount_floor) OVER () AS extras
      FROM weights
    )
    SELECT
      id AS line_id,
      amount_floor
        + CASE WHEN remainder_rank <= extras THEN 1 ELSE 0 END
        AS disputed_minor
    FROM ranked
    ORDER BY id
  LOOP
    SELECT release_row.* INTO v_release
    FROM public.payout_release_items item
    JOIN public.brand_payout_releases release_row
      ON release_row.id = item.release_id
    WHERE item.source_type = 'stay_reservation'
      AND item.source_id = v_line.line_id
    FOR UPDATE OF release_row;
    IF FOUND AND v_release.status <> 'released' THEN
      UPDATE public.payout_release_items
      SET disputed_cents = CASE WHEN v_resolved
            THEN 0 ELSE v_line.disputed_minor END,
          net_cents = GREATEST(
            0,
            gross_cents - refunded_cents
              - CASE WHEN v_resolved THEN 0 ELSE v_line.disputed_minor END
              - mingla_fee_cents - partner_share_cents
              - provider_fee_cents
          )
      WHERE source_type = 'stay_reservation'
        AND source_id = v_line.line_id;
      UPDATE public.brand_payout_releases release_row
      SET disputed_cents = totals.disputed,
          net_release_cents = totals.net,
          updated_at = now()
      FROM (
        SELECT
          sum(item.disputed_cents)::integer AS disputed,
          sum(item.net_cents)::integer AS net
        FROM public.payout_release_items item
        WHERE item.release_id = v_release.id
      ) totals
      WHERE release_row.id = v_release.id;
    ELSIF FOUND AND v_release.status = 'released'
      AND v_line.disputed_minor > 0 THEN
      INSERT INTO public.payout_ledger_adjustments (
        release_id, brand_id, currency, kind, amount_cents,
        provider_ref, idempotency_key
      ) VALUES (
        v_release.id, v_release.brand_id, v_release.currency,
        CASE WHEN v_resolved
          THEN 'dispute_reversal' ELSE 'post_release_dispute' END,
        v_line.disputed_minor, p_dispute_ref,
        'stay-dispute:' || p_dispute_ref || ':' ||
          v_line.line_id || ':' ||
          CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      IF NOT v_resolved THEN
        PERFORM public.convert_postponement_debt_to_permanent(
          v_release.id,
          'post_release_dispute',
          LEAST(
            v_line.disputed_minor,
            v_release.organiser_cash_delivered_cents
          ),
          now()
        );
      END IF;
    END IF;

    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.line_id, v_attempt.id,
      CASE WHEN v_resolved THEN 'payout_reversed' ELSE 'chargeback' END,
      v_line.disputed_minor, v_attempt.currency_code, p_dispute_ref,
      'stay:dispute:' || p_dispute_ref || ':' || v_line.line_id ||
        ':' || CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
      jsonb_build_object('status', lower(p_status))
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id,
    CASE WHEN v_resolved
      THEN 'stay_dispute_resolved' ELSE 'stay_dispute_recorded' END,
    'service',
    'dispute:' || p_dispute_ref || ':' ||
      CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN jsonb_build_object(
    'matched', true,
    'groupId', v_group.id,
    'brandId', v_group.brand_id,
    'resolved', v_resolved
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1427_admin_pause_stay_offering(p_offering_id uuid, p_expected_version bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before public.stay_offerings%ROWTYPE;
  v_after public.stay_offerings%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF translate(
    COALESCE(p_reason, ''),
    E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205)
      || chr(8232) || chr(8233) || chr(65279), ''
  ) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.stay_offerings offering
  WHERE offering.id = p_offering_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'live' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '22023';
  END IF;
  IF v_before.version <> p_expected_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_offerings offering
  SET status = 'paused', version = offering.version + 1,
      updated_by = auth.uid(), updated_at = now()
  WHERE offering.id = p_offering_id AND offering.version = p_expected_version
  RETURNING * INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.admin_write_audit(
    p_action => 'stay.offering_pause',
    p_entity_type => 'stay_offering',
    p_entity_id => p_offering_id::text,
    p_reason => p_reason,
    p_metadata => jsonb_build_object(
      'before', jsonb_build_object('status', v_before.status, 'version', v_before.version),
      'after', jsonb_build_object('status', v_after.status, 'version', v_after.version)
    )
  );
  RETURN jsonb_build_object(
    'offeringId', v_after.id, 'status', v_after.status,
    'version', v_after.version, 'updatedAt', v_after.updated_at
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_health_alert_v1(p_signal_key text, p_notification_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501';
  END IF;
  UPDATE private.wizard_invite_alert_state SET
    last_notified_at=now(),notification_token=NULL,
    notification_lease_until=NULL,updated_at=now()
  WHERE signal_key=p_signal_key AND active
    AND notification_token=p_notification_token
    AND notification_lease_until>now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wizard_invite_alert_lease_invalid' USING ERRCODE='PT409';
  END IF;
  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_observability_v1(p_event_occurrence_id bigint, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501';
  END IF;
  UPDATE private.brand_offering_invite_observability_events SET
    emitted_at=now(),lease_token=NULL,lease_expires_at=NULL
  WHERE id=p_event_occurrence_id AND emitted_at IS NULL
    AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wizard_invite_observability_lease_invalid' USING ERRCODE='PT409';
  END IF;
  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(p_outbox_job_id uuid, p_sealed_selection_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_seal private.brand_offering_invite_execution_seals%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
    WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id
      AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409'; END IF;
  SELECT * INTO v_seal FROM private.brand_offering_invite_execution_seals
    WHERE outbox_job_id=v_job.id AND sealed_selection_id=p_sealed_selection_id;
  IF NOT FOUND OR v_seal.queued_count<>0 THEN
    RAISE EXCEPTION 'wizard_invite_zero_reachable_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  UPDATE private.brand_offering_invite_outbox SET
    state='succeeded',lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
    completed_at=now(),updated_at=now()
  WHERE id=v_job.id AND state='leased' AND lease_token=p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('outboxJobId',v_job.id,'status','succeeded','providerIo',false);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_outbox_v1(p_outbox_job_id uuid, p_sealed_selection_id uuid, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  UPDATE private.brand_offering_invite_outbox o SET
    state='succeeded',lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
    completed_at=now(),updated_at=now()
  WHERE o.id=p_outbox_job_id AND o.sealed_selection_id=p_sealed_selection_id
    AND o.state='leased' AND o.lease_token=p_lease_token AND o.lease_expires_at>now()
    AND EXISTS(SELECT 1 FROM private.brand_offering_invite_execution_seals xs
      WHERE xs.outbox_job_id=o.id AND xs.queued_count>0)
    AND EXISTS(SELECT 1 FROM public.marketing_send_groups g
      WHERE g.brand_id=o.brand_id AND g.client_request_id=o.id
        AND g.status IN ('running','completed'));
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409'; END IF;
  RETURN true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_execute_wizard_invite_outbox_v1(p_outbox_job_id uuid, p_sealed_selection_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.brand_offering_invite_outbox
    WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id
      AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now()) THEN
    RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409';
  END IF;
  RETURN private.execute_brand_offering_invite_wizard_v1(p_outbox_job_id,p_sealed_selection_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_fail_wizard_invite_outbox_v1(p_outbox_job_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_state text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  IF p_error_code IS NULL OR p_error_code!~'^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'wizard_invite_worker_error_invalid' USING ERRCODE='22023';
  END IF;
  UPDATE private.brand_offering_invite_outbox SET
    state=CASE WHEN p_retryable AND attempt_count<8 THEN 'retryable' ELSE 'terminal' END,
    next_attempt_at=CASE WHEN p_retryable AND attempt_count<8
      THEN now()+make_interval(secs=>LEAST(3600,15*(2^LEAST(attempt_count,8))::integer)) ELSE next_attempt_at END,
    lease_token=NULL,lease_expires_at=NULL,last_error_code=p_error_code,
    completed_at=CASE WHEN p_retryable AND attempt_count<8 THEN NULL ELSE now() END,updated_at=now()
  WHERE id=p_outbox_job_id AND state='leased' AND lease_token=p_lease_token
  RETURNING state INTO v_state;
  IF v_state IS NULL THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409'; END IF;
  RETURN v_state;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1780_seal_wizard_invite_execution_v1(p_outbox_job_id uuid, p_sealed_selection_id uuid, p_lease_token uuid, p_execution_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_selection private.brand_offering_invite_selections%ROWTYPE;
  v_selection_json jsonb; v_validated jsonb; v_existing private.brand_offering_invite_execution_seals%ROWTYPE;
  v_queued integer; v_candidates integer; v_seal_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
  WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id
    AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='PT409'; END IF;
  SELECT * INTO v_selection FROM private.brand_offering_invite_selections
  WHERE id=p_sealed_selection_id AND event_id=v_job.event_id
    AND brand_id=v_job.brand_id AND event_type=v_job.event_type
    AND selection_revision=v_job.selection_revision;
  IF NOT FOUND OR p_execution_snapshot IS NULL
     OR p_execution_snapshot->>'eventId'<>v_job.event_id::text
     OR p_execution_snapshot->>'brandId'<>v_job.brand_id::text
     OR p_execution_snapshot->>'purpose'<>'invitation'
     OR p_execution_snapshot->>'selectionHash'<>v_selection.selection_hash
     OR jsonb_typeof(p_execution_snapshot->'candidates')<>'array' THEN
    RAISE EXCEPTION 'wizard_invite_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  v_selection_json:=jsonb_build_object('kind','resolved_brand_people_v1','source','guest_roster_actions',
    'brandPersonIds',to_jsonb(v_selection.brand_person_ids),'selectionHash',v_selection.selection_hash);
  v_candidates:=jsonb_array_length(p_execution_snapshot->'candidates');
  SELECT count(*) INTO v_queued FROM jsonb_array_elements(p_execution_snapshot->'candidates') c
    WHERE c->>'outcome'='queued';
  -- The #1770 validator remains the authority. This transaction-local marker
  -- permits only this leased wizard job to validate a literal zero-candidate seal.
  PERFORM set_config('mingla.issue_1780_zero_candidate_outbox_id',v_job.id::text,true);
  v_validated:=public.biz_seal_offering_execution_snapshot(
    v_selection.actor_id,v_selection_json,p_execution_snapshot);
  SELECT * INTO v_existing FROM private.brand_offering_invite_execution_seals
    WHERE outbox_job_id=v_job.id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.execution_snapshot_hash<>v_validated->>'executionSnapshotHash' THEN
      RAISE EXCEPTION 'wizard_invite_execution_seal_conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('sealId',v_existing.id,'replayed',true,
      'queuedCount',v_existing.queued_count,'candidateCount',v_existing.candidate_count);
  END IF;
  INSERT INTO private.brand_offering_invite_execution_seals(
    outbox_job_id,sealed_selection_id,execution_snapshot,execution_snapshot_hash,
    queued_count,candidate_count)
  VALUES(v_job.id,p_sealed_selection_id,p_execution_snapshot,
    v_validated->>'executionSnapshotHash',v_queued,v_candidates)
  RETURNING id INTO v_seal_id;
  RETURN jsonb_build_object('sealId',v_seal_id,'replayed',false,
    'queuedCount',v_queued,'candidateCount',v_candidates);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1975_reservation_transition(p_reservation_id uuid, p_to_status text, p_expected_version bigint, p_table_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS public.reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.reservations;
  v_from text;
  v_brand uuid;
  v_policy text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.reservations
    WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_from := v_row.status;
  v_brand := v_row.brand_id;

  -- Brand-member gate (manager+), identical to biz_reservation_transition.
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Optimistic concurrency: refuse a stale expected version before any write.
  --
  -- #2592 A2 — SQLSTATE '40001' is KEPT here, deliberately, after re-deriving
  -- the question from the code rather than from the SQLSTATE's textbook name.
  --
  -- '40001' is this repository's ESTABLISHED convention for an optimistic-
  -- concurrency conflict: `stay_version_conflict`, `stay_media_set_changed` and
  -- `stay_idempotency_conflict` in 20270131013808, `range_version_conflict` in
  -- 20270131013809, and `stay_version_conflict` in 20270204001448 — ~20 sites
  -- for structurally the SAME operation as this one. Diverging on this single
  -- function would make the reservation path behave differently from the Stay
  -- path for an identical failure, which is its own defect.
  --
  -- Nothing in this repository reads a Postgres SQLSTATE to decide a retry:
  -- there is no pooler retry setting, no library default, and no branch on
  -- '40001' anywhere in `mingla-business/src`, `app-mobile/src` or
  -- `supabase/functions`. The searched-for retry loop does not exist on this
  -- stack, so the SQLSTATE is not where the exposure lives.
  --
  -- What DOES carry the meaning is the MESSAGE LITERAL. Every existing site
  -- pairs '40001' with a stable literal that the OWNING Edge function maps to
  -- HTTP 409 (`manage-stay-inventory/index.ts`, `stay-reservations/index.ts`,
  -- `manage-brand-discovery-currency/index.ts` all match on the literal, never
  -- on the code). `reservation_version_conflict` is that stable literal here,
  -- and the expected/actual versions are appended so the caller can re-read the
  -- real one instead of re-sending the stale one.
  --
  -- This function is the one version-conflict site with NO owning Edge in
  -- front of it — Ari calls it straight through `callRpc`. The 409 translation
  -- therefore happens in the tool layer, in `transition_venue_reservation`
  -- (`_shared/agentDomainTools.ts`), which raises `VERSION_CONFLICT` instead of
  -- the generic `RPC_FAILED`; `toolErrorHttpStatus` maps that to 409 rather
  -- than the 500 a stale version used to be reported as. Without that, a
  -- deterministic caller mistake was surfaced as a server fault — the one
  -- classification the Ari envelope contract calls `safe_to_retry: true`.
  IF v_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'reservation_version_conflict_expected_%_actual_%',
      p_expected_version, v_row.version USING ERRCODE = 'PT409';
  END IF;

  -- Legal-transition enforcement (server-side; the heart of the invariant).
  IF NOT public.pg_reservation_transition_is_legal(v_from, p_to_status) THEN
    RAISE EXCEPTION 'illegal_transition_%_to_%', v_from, p_to_status
      USING ERRCODE = '23514';
  END IF;

  -- Any table (re)assignment must belong to the SAME brand's venue.
  IF p_table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_tables
     WHERE id = p_table_id AND brand_id = v_brand
  ) THEN
    RAISE EXCEPTION 'table_not_in_brand_%', p_table_id USING ERRCODE = '23514';
  END IF;

  -- no_show RECORDS the forfeit-policy DECISION only (NO capture here).
  IF p_to_status = 'no_show' THEN
    SELECT no_show_fee_policy INTO v_policy
      FROM public.venue_reservation_settings WHERE brand_id = v_brand;
  END IF;

  -- The BEFORE UPDATE trigger increments version exactly once.
  UPDATE public.reservations
     SET status = p_to_status,
         table_id = COALESCE(p_table_id, table_id),
         updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.transition',
    'reservation', p_reservation_id::text,
    jsonb_build_object('status', v_from, 'version', p_expected_version),
    jsonb_build_object(
      'status', p_to_status,
      'table_id', v_row.table_id,
      'reason', p_reason,
      'no_show_fee_policy', v_policy,
      'version', v_row.version
    )
  );

  RETURN v_row;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_link_brand_message_product_signal(p_signal_id uuid, p_expected_revision integer, p_source_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid();v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF NOT EXISTS(
    SELECT 1
    FROM public.messages message
    JOIN public.conversations conversation ON conversation.id=message.conversation_id
    WHERE message.id=p_source_id
      AND message.deleted_at IS NULL
      AND conversation.linked_entity_type='brand'
      AND public.issue_3720_brand_group_can_access(conversation.id,v_actor)
  ) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE='P0002';
  END IF;

  UPDATE public.support_product_signals
  SET affected_people=affected_people+1,updated_at=now(),revision=revision+1
  WHERE id=p_signal_id AND revision=p_expected_revision
  RETURNING revision INTO v_revision;
  IF v_revision IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.support_product_signals WHERE id=p_signal_id) THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE='PT409';
  END IF;

  INSERT INTO public.support_product_signal_sources(signal_id,source_kind,source_id,linked_by)
  VALUES(p_signal_id,'brand_group_message',p_source_id,v_actor);
  INSERT INTO public.support_product_workflow_audit(
    actor_user_id,action,entity_kind,entity_id,after_snapshot
  ) VALUES(
    v_actor,'product_signal_source_linked','product_signal',p_signal_id,
    jsonb_build_object('source_kind','brand_group_message','source_id',p_source_id,'revision',v_revision)
  );
  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_link_product_signal_source(p_signal_id uuid, p_expected_revision integer, p_source_kind text, p_source_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_source_kind = 'support_ticket'
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_source_kind = 'internal_thread'
     AND NOT EXISTS (SELECT 1 FROM public.support_internal_threads WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.support_product_signals
     SET affected_people = affected_people + 1,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.support_product_signals WHERE id = p_signal_id) THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  BEGIN
    INSERT INTO public.support_product_signal_sources(signal_id, source_kind, source_id, linked_by)
    VALUES (p_signal_id, p_source_kind, p_source_id, v_actor);
  EXCEPTION WHEN unique_violation THEN
    -- Keep the counter and link atomic if another operator linked the source.
    RAISE;
  END;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_source_linked', 'product_signal', p_signal_id,
    jsonb_build_object(
      'source_kind', p_source_kind,
      'source_id', p_source_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_record_feature_evidence(p_capability_id uuid, p_expected_revision integer, p_evidence_kind text, p_evidence_url text, p_verdict text, p_details text, p_observed_at timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_evidence_id uuid;
  v_revision integer;
  v_complete boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_evidence_kind NOT IN (
       'source', 'test', 'route', 'pull_request', 'release_record', 'migration',
       'feature_flag', 'deployment', 'app_release', 'live_check'
     )
     OR p_verdict NOT IN ('verified', 'conflict')
     OR COALESCE(p_evidence_url, '') !~ '^https://'
     OR char_length(p_evidence_url) > 1000
     OR char_length(btrim(COALESCE(p_details, ''))) NOT BETWEEN 4 AND 2000
     OR p_observed_at IS NULL OR p_observed_at > now() + interval '5 minutes'
     OR (p_expires_at IS NOT NULL AND p_expires_at <= p_observed_at) THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.product_capabilities c
   WHERE c.id = p_capability_id AND c.revision = p_expected_revision
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409'; END IF;

  UPDATE public.product_capability_evidence
     SET is_current = false
   WHERE capability_id = p_capability_id
     AND evidence_kind = p_evidence_kind
     AND is_current;
  INSERT INTO public.product_capability_evidence(
    capability_id, evidence_kind, evidence_url, verdict, details,
    observed_at, expires_at, recorded_by
  ) VALUES (
    p_capability_id, p_evidence_kind, p_evidence_url, p_verdict,
    btrim(p_details), p_observed_at, p_expires_at, v_actor
  ) RETURNING id INTO v_evidence_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(c.required_evidence_kinds) required(kind)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.product_capability_evidence e
        WHERE e.capability_id = c.id AND e.evidence_kind = required.kind
          AND e.is_current AND e.verdict = 'verified'
          AND (e.expires_at IS NULL OR e.expires_at > now())
     )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.product_capability_evidence e
     WHERE e.capability_id = c.id AND e.is_current
       AND (e.verdict = 'conflict' OR (e.expires_at IS NOT NULL AND e.expires_at <= now()))
  ) INTO v_complete
  FROM public.product_capabilities c WHERE c.id = p_capability_id;

  UPDATE public.product_capabilities
     SET revision = revision + 1,
         last_verified_at = CASE WHEN v_complete THEN now() ELSE last_verified_at END,
         updated_by = v_actor, updated_at = now()
   WHERE id = p_capability_id
   RETURNING revision INTO v_revision;
  INSERT INTO public.product_truth_audit(
    actor_user_id, action, capability_id, evidence_id, metadata
  ) VALUES (
    v_actor, 'evidence_recorded', p_capability_id, v_evidence_id,
    jsonb_build_object('kind', p_evidence_kind, 'verdict', p_verdict,
      'revision', v_revision)
  );
  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_save_feature_capability(p_capability_key text, p_expected_revision integer, p_title text, p_outcome_summary text, p_who_can_use text[], p_surfaces text[], p_how_to text, p_limitations text, p_support_wording text, p_claimed_status text, p_required_evidence_kinds text[], p_verification_due_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_allowed constant text[] := ARRAY[
    'source', 'test', 'route', 'pull_request', 'release_record', 'migration',
    'feature_flag', 'deployment', 'app_release', 'live_check'
  ];
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_expected_revision' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_capability_key, '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR char_length(p_capability_key) > 80
     OR p_claimed_status NOT IN ('planned', 'live', 'retired')
     OR cardinality(COALESCE(p_who_can_use, ARRAY[]::text[])) NOT BETWEEN 1 AND 20
     OR cardinality(COALESCE(p_surfaces, ARRAY[]::text[])) NOT BETWEEN 1 AND 20
     OR cardinality(COALESCE(p_required_evidence_kinds, ARRAY[]::text[])) NOT BETWEEN 1 AND 10
     OR EXISTS (SELECT 1 FROM unnest(p_required_evidence_kinds) kind WHERE kind <> ALL(v_allowed))
     OR (SELECT count(*) FROM unnest(p_required_evidence_kinds) kind)
        <> (SELECT count(DISTINCT kind) FROM unnest(p_required_evidence_kinds) kind)
     OR EXISTS (SELECT 1 FROM unnest(p_who_can_use) value WHERE char_length(btrim(value)) NOT BETWEEN 2 AND 80)
     OR EXISTS (SELECT 1 FROM unnest(p_surfaces) value WHERE char_length(btrim(value)) NOT BETWEEN 2 AND 120) THEN
    RAISE EXCEPTION 'invalid_capability' USING ERRCODE = '22023';
  END IF;
  IF p_claimed_status = 'live' AND p_verification_due_at IS NULL THEN
    RAISE EXCEPTION 'verification_due_required' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision = 0 THEN
    INSERT INTO public.product_capabilities(
      capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
      limitations, support_wording, claimed_status, required_evidence_kinds,
      verification_due_at, created_by, updated_by
    ) VALUES (
      p_capability_key, btrim(p_title), btrim(p_outcome_summary), p_who_can_use,
      p_surfaces, btrim(p_how_to), btrim(p_limitations), btrim(p_support_wording),
      p_claimed_status, p_required_evidence_kinds, p_verification_due_at,
      v_actor, v_actor
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.product_capabilities
       SET title = btrim(p_title), outcome_summary = btrim(p_outcome_summary),
           who_can_use = p_who_can_use, surfaces = p_surfaces,
           how_to = btrim(p_how_to), limitations = btrim(p_limitations),
           support_wording = btrim(p_support_wording), claimed_status = p_claimed_status,
           required_evidence_kinds = p_required_evidence_kinds,
           verification_due_at = p_verification_due_at,
           revision = revision + 1, updated_by = v_actor, updated_at = now()
     WHERE capability_key = p_capability_key AND revision = p_expected_revision
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  INSERT INTO public.product_truth_audit(actor_user_id, action, capability_id, metadata)
  VALUES (v_actor, 'capability_saved', v_id,
    jsonb_build_object('claimed_status', p_claimed_status,
      'expected_revision', p_expected_revision));
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_save_product_avengers_review(p_signal_id uuid, p_expected_revision integer, p_public_title text, p_public_problem_statement text, p_public_outcome text, p_public_acceptance_criteria text[], p_board_product text, p_board_theme text, p_board_priority text, p_board_estimate text, p_board_horizon text, p_board_quarter text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_kind text;
  v_revision integer;
  v_work_type text;
  v_criteria text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_expected_revision' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision = 0
     AND EXISTS (SELECT 1 FROM public.product_avengers_reviews r WHERE r.signal_id = p_signal_id) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_revision > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.product_avengers_reviews r
        WHERE r.signal_id = p_signal_id AND r.revision = p_expected_revision
     ) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  SELECT s.signal_kind INTO v_kind
    FROM public.support_product_signals s WHERE s.id = p_signal_id FOR UPDATE;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_kind NOT IN ('bug', 'feature') THEN
    RAISE EXCEPTION 'signal_not_product_work' USING ERRCODE = '22023';
  END IF;
  v_work_type := CASE v_kind WHEN 'bug' THEN 'Bug' ELSE 'Initiative' END;
  SELECT array_agg(btrim(value)) INTO v_criteria
    FROM unnest(COALESCE(p_public_acceptance_criteria, ARRAY[]::text[])) value
   WHERE char_length(btrim(value)) BETWEEN 4 AND 1000;
  IF cardinality(COALESCE(v_criteria, ARRAY[]::text[])) = 0 THEN
    RAISE EXCEPTION 'acceptance_criteria_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_avengers_reviews (
    signal_id, public_title, public_problem_statement, public_outcome,
    public_acceptance_criteria, board_work_type, board_product, board_theme,
    board_priority, board_estimate, board_horizon, board_quarter,
    reviewed_by, reviewed_at
  ) VALUES (
    p_signal_id, btrim(p_public_title), btrim(p_public_problem_statement),
    btrim(p_public_outcome), v_criteria, v_work_type, p_board_product,
    btrim(p_board_theme), p_board_priority, p_board_estimate,
    p_board_horizon, p_board_quarter, v_actor, now()
  )
  ON CONFLICT (signal_id) DO UPDATE
    SET public_title = EXCLUDED.public_title,
        public_problem_statement = EXCLUDED.public_problem_statement,
        public_outcome = EXCLUDED.public_outcome,
        public_acceptance_criteria = EXCLUDED.public_acceptance_criteria,
        board_work_type = EXCLUDED.board_work_type,
        board_product = EXCLUDED.board_product,
        board_theme = EXCLUDED.board_theme,
        board_priority = EXCLUDED.board_priority,
        board_estimate = EXCLUDED.board_estimate,
        board_horizon = EXCLUDED.board_horizon,
        board_quarter = EXCLUDED.board_quarter,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = now(),
        revision = public.product_avengers_reviews.revision + 1,
        updated_at = now()
    WHERE public.product_avengers_reviews.revision = p_expected_revision
  RETURNING revision INTO v_revision;
  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'save_public_review', 'product_signal', p_signal_id::text,
    jsonb_build_object('revision', v_revision, 'work_type', v_work_type));
  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_set_next_update(p_source_kind text, p_source_id uuid, p_expected_revision integer, p_next_update_at timestamp with time zone, p_next_update_note text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
  v_conversation uuid;
  v_before jsonb;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_update_note, '')) = '' THEN
    RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
  END IF;

  IF p_source_kind = 'support_ticket' THEN
    SELECT conversation_id,
           jsonb_build_object('next_update_at', next_update_at, 'revision', support_workflow_revision)
      INTO v_conversation, v_before
      FROM public.support_tickets
     WHERE id = p_source_id;

    UPDATE public.support_tickets
       SET next_update_at = p_next_update_at,
           next_update_note = left(btrim(p_next_update_note), 500),
           last_message_at = now(),
           support_workflow_revision = support_workflow_revision + 1
     WHERE id = p_source_id
       AND support_workflow_revision = p_expected_revision
    RETURNING support_workflow_revision INTO v_revision;

    IF v_revision IS NULL THEN
      IF v_conversation IS NULL THEN
        RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
      END IF;
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
    END IF;

    INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    VALUES (
      v_conversation,
      NULL,
      'Mingla will update you by ' || to_char(p_next_update_at AT TIME ZONE 'UTC', 'FMDay, FMMonth DD at HH12:MI AM') || ' UTC. ' || left(btrim(p_next_update_note), 500),
      'system'
    );
  ELSE
    SELECT jsonb_build_object('next_update_at', next_update_at, 'revision', revision)
      INTO v_before
      FROM public.support_internal_threads
     WHERE id = p_source_id;

    UPDATE public.support_internal_threads
       SET next_update_at = p_next_update_at,
           next_update_note = left(btrim(p_next_update_note), 500),
           updated_at = now(),
           revision = revision + 1
     WHERE id = p_source_id
       AND revision = p_expected_revision
    RETURNING revision INTO v_revision;

    IF v_revision IS NULL THEN
      IF v_before IS NULL THEN
        RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
      END IF;
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor,
    'next_update_set',
    CASE WHEN p_source_kind = 'support_ticket' THEN 'support_ticket' ELSE 'internal_thread' END,
    p_source_id,
    v_before,
    jsonb_build_object('next_update_at', p_next_update_at, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_update_internal_thread(p_thread_id uuid, p_expected_revision integer, p_status text, p_priority text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_status NOT IN ('new', 'open', 'pending', 'resolved', 'closed')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('status', status, 'priority', priority, 'revision', revision)
    INTO v_before
    FROM public.support_internal_threads
   WHERE id = p_thread_id;

  UPDATE public.support_internal_threads
     SET status = p_status,
         priority = p_priority,
         resolved_at = CASE
           WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now())
           ELSE NULL
         END,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_thread_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_updated', 'internal_thread', p_thread_id, v_before,
    jsonb_build_object('status', p_status, 'priority', p_priority, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_update_product_signal(p_signal_id uuid, p_expected_revision integer, p_state text, p_priority text, p_next_update_at timestamp with time zone, p_next_step text, p_customer_reply_draft text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_state NOT IN ('needs_review', 'waiting_details', 'ready_product', 'linked', 'update_due', 'released', 'closed')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_step, '')) = '' OR btrim(coalesce(p_customer_reply_draft, '')) = '' THEN
    RAISE EXCEPTION 'product_fields_required' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'state', state, 'priority', priority, 'next_update_at', next_update_at, 'revision', revision
  ) INTO v_before
    FROM public.support_product_signals
   WHERE id = p_signal_id;

  UPDATE public.support_product_signals
     SET state = p_state,
         priority = p_priority,
         next_update_at = p_next_update_at,
         next_step = left(btrim(p_next_step), 1000),
         customer_reply_draft = left(btrim(p_customer_reply_draft), 4000),
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_updated', 'product_signal', p_signal_id, v_before,
    jsonb_build_object(
      'state', p_state, 'priority', p_priority,
      'next_update_at', p_next_update_at, 'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3988_reassign_internal_thread(p_thread_id uuid, p_expected_revision integer, p_assigned_staff_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_assigned_staff_id IS NULL THEN
    RAISE EXCEPTION 'assignee_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.support_staff
     WHERE user_id = p_assigned_staff_id AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'assignee_not_support_staff' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'assigned_staff_id', assigned_staff_id,
    'revision', revision
  ) INTO v_before
    FROM public.support_internal_threads
   WHERE id = p_thread_id;

  UPDATE public.support_internal_threads
     SET assigned_staff_id = p_assigned_staff_id,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_thread_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_reassigned', 'internal_thread', p_thread_id, v_before,
    jsonb_build_object(
      'assigned_staff_id', p_assigned_staff_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3988_reassign_product_signal(p_signal_id uuid, p_expected_revision integer, p_owner_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.support_staff
     WHERE user_id = p_owner_user_id AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'owner_not_support_staff' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'owner_user_id', owner_user_id,
    'revision', revision
  ) INTO v_before
    FROM public.support_product_signals
   WHERE id = p_signal_id;

  UPDATE public.support_product_signals
     SET owner_user_id = p_owner_user_id,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_reassigned', 'product_signal', p_signal_id, v_before,
    jsonb_build_object(
      'owner_user_id', p_owner_user_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_brand_autolink()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_since timestamptz; b record; v_res jsonb; v_linked integer := 0; v_created integer := 0; v_pick integer := 0;
        v_busy integer := 0; v_settled boolean; v_status text;
BEGIN
  v_since := public.ops_try_timestamptz(public.ops_setting('brand_auto_since') #>> '{}');
  IF v_since IS NULL THEN RETURN jsonb_build_object('linked', 0, 'created', 0, 'pick', 0); END IF;
  -- #3980 W3 rework 2: a brand whose pick or reopen card a person closed is
  -- decided ("stays Lost" included); a brand the last run could not settle
  -- waits until its next try. #3980 W3 rework 3: only a person's close is a
  -- decision (an agent's close is not). #3980 W4 rework: "decided" is
  -- ops_brand_decided, the same function the owner's preview and confirm
  -- read.
  -- #3980 W4 rework 2: a decided brand is asked again on exactly the test
  -- the preview and the confirm use: ops_brand_new_exact, a host card that
  -- matches exactly and is not on the card the person closed, whenever that
  -- card appeared (before or after the close). To keep each run cheap, a
  -- decided brand is looked at when something could have changed its
  -- answer: never looked at since the person's latest close, a card or
  -- brand change since its last look (a contact point added, a card or the
  -- brand edited), or a day since its last look. At most 25 brands a run,
  -- and a run never waits for a brand an owner's confirm is working on.
  -- #3980 Wave 4 prep: the order puts real changes before routine looks.
  -- Tier 0: brands nobody decided about. Tier 1: a decided brand with a real
  -- change since its last look (or since the close, if never looked at): the
  -- brand edited, or a host card with one of its contact points added or
  -- edited. Tier 2: a decided brand never looked at since the person's latest
  -- close. Tier 3: decided brands due only for their daily look. So a real
  -- change is never held behind many routine looks.
  FOR b IN SELECT c.id, c.decided_id FROM (
           SELECT c0.*,
                  CASE WHEN c0.decided_id IS NULL THEN 0
                       WHEN c0.updated_at > COALESCE(c0.looked_at, c0.closed_at)
                         OR public.ops_brand_changed_since(c0.id, COALESCE(c0.looked_at, c0.closed_at)) THEN 1
                       WHEN c0.looked_at IS NULL OR c0.looked_at < c0.closed_at THEN 2
                       ELSE 3 END AS tier
             FROM (
             SELECT br.id, br.created_at, d.id AS decided_id, d.closed_at,
                    (SELECT t.updated_at FROM public.ops_brand_autolink_waits t
                      WHERE t.brand_id = br.id AND t.last_status = 'decided') AS looked_at,
                    br.updated_at
               FROM public.brands br
               LEFT JOIN LATERAL public.ops_brand_decided(br.id) d ON true
              WHERE br.deleted_at IS NULL AND br.created_at >= v_since
                AND NOT EXISTS (SELECT 1 FROM public.crm_records h WHERE h.brand_id = br.id AND h.pipeline = 'hosts' AND h.deleted_at IS NULL)
                AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key IN ('brand_pick:' || br.id, 'brand_lost:' || br.id)
                                  AND k.archived_at IS NULL AND k.status <> 'done')
                AND NOT EXISTS (SELECT 1 FROM public.ops_brand_autolink_waits t WHERE t.brand_id = br.id AND t.next_at > now())) c0
             OFFSET 0) c
            WHERE c.tier < 3 OR c.looked_at < now() - interval '1 day'
            -- Brands nobody decided about come first, so looks at decided
            -- brands never hold back a new brand; daily-only looks come last.
            ORDER BY c.tier, c.created_at, c.id LIMIT 25 LOOP
    v_settled := false; v_status := NULL;
    BEGIN
      IF b.decided_id IS NOT NULL AND cardinality(public.ops_brand_new_exact(b.id, b.decided_id)) = 0 THEN
        -- Still decided: nothing matches exactly that is not on the card.
        v_status := 'decided';
      -- #3980 W4 rework 2: the run never waits for a brand someone else is
      -- working on (an owner's confirm holds it): it leaves the brand for the
      -- next run, with no wait and nothing counted. So a confirm and a run
      -- can never wait for each other.
      ELSIF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('ops_brand_autolink:' || b.id, 0)) THEN
        v_status := 'busy';
      ELSE
        v_res := public.ops_brand_autolink_one(b.id);
        v_status := v_res->>'status';
        CASE v_status WHEN 'linked' THEN v_linked := v_linked + 1; WHEN 'created' THEN v_created := v_created + 1;
                      WHEN 'pick' THEN v_pick := v_pick + 1; WHEN 'ask_reopen' THEN v_pick := v_pick + 1; ELSE NULL; END CASE;
        v_settled := v_status IN ('linked', 'created', 'has_card', 'gone')
                     OR (v_status IN ('pick', 'ask_reopen') AND v_res->'card'->>'status' IN ('added', 'kept', 'reopened') AND v_res->'card'->>'id' IS NOT NULL);
        IF NOT v_settled AND v_status <> 'decided' THEN
          v_status := left(v_status || COALESCE(':' || (v_res->'card'->>'status'), ''), 40);
        END IF;
      END IF;
    EXCEPTION
      -- Two writers met on the same card at the same moment: the brand is
      -- left for the next run, never held back as if it failed.
      WHEN deadlock_detected OR lock_not_available OR serialization_failure OR SQLSTATE 'PT409' THEN
        v_status := 'busy';
      WHEN others THEN
        RAISE WARNING 'ops_brand_autolink: brand % stopped (% %)', b.id, SQLSTATE, SQLERRM;
        v_status := 'stopped';
    END;
    IF v_status = 'busy' THEN
      v_busy := v_busy + 1;
      CONTINUE;
    END IF;
    BEGIN
      IF v_status = 'decided' THEN
        -- #3980 W3 rework 3: still decided. No wait; the time of this look is
        -- kept so the brand is looked at again only when something changed.
        INSERT INTO public.ops_brand_autolink_waits AS t (brand_id, tries, next_at, last_status)
        VALUES (b.id, 1, now(), 'decided')
        ON CONFLICT (brand_id) DO UPDATE SET tries = 1, next_at = now(), last_status = 'decided', updated_at = now();
      ELSIF v_settled THEN
        DELETE FROM public.ops_brand_autolink_waits t WHERE t.brand_id = b.id;
      ELSE
        INSERT INTO public.ops_brand_autolink_waits AS t (brand_id, tries, next_at, last_status)
        VALUES (b.id, 1, now() + interval '1 hour', COALESCE(v_status, 'unsettled'))
        ON CONFLICT (brand_id) DO UPDATE
          SET tries = LEAST(t.tries + 1, 1000),
              next_at = now() + LEAST(interval '1 hour' * power(2, LEAST(t.tries, 10)), interval '7 days'),
              last_status = EXCLUDED.last_status, updated_at = now();
      END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_brand_autolink: brand % wait not saved (% %)', b.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'created', v_created, 'pick', v_pick, 'busy', v_busy);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_brand_cards_confirm(p_brand_ids uuid[], p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_ids uuid[]; v_replay jsonb; v_id uuid; v_res jsonb; v_name text; v_linked integer := 0; v_created integer := 0;
  v_skipped integer := 0; v_busy integer := 0; v_unchanged integer := 0; v_results jsonb := '[]'::jsonb; v_out jsonb; v_status text; v_words text; v_card jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_owner_person_only('Only the owner adds host cards for brands in bulk.');
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 90 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_brand_ids IS NULL OR cardinality(p_brand_ids) = 0 OR array_position(p_brand_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_brands: Choose at least one brand.' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_brand_ids) x ORDER BY x);
  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'invalid_brands: Choose at most 100 brands at a time.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'brand_cards', to_jsonb(v_ids));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT br.name INTO v_name FROM public.brands br WHERE br.id = v_id;
    BEGIN
      v_res := public.ops_brand_autolink_one(v_id);
      v_status := v_res->>'status';
    EXCEPTION
      -- #3980 W4 rework 2: Mingla was working on the same brand at that
      -- moment. Nothing changed; it is busy, never "left for a person".
      WHEN deadlock_detected OR lock_not_available OR serialization_failure OR SQLSTATE 'PT409' THEN
        v_status := 'busy'; v_res := '{}'::jsonb;
      WHEN others THEN
        v_status := 'failed'; v_res := jsonb_build_object('error', left(regexp_replace(SQLERRM, '^[a-z_]+: ', ''), 300));
    END;
    -- The words follow what happened to the card a person needs: "asks"
    -- only when a card was added just now.
    v_card := v_res->'card';
    v_words := CASE
      WHEN v_status = 'linked' THEN 'Linked to its host card.'
      WHEN v_status = 'created' THEN 'Host card added.'
      WHEN v_status IN ('pick', 'ask_reopen') AND v_card->>'status' = 'added' THEN
        CASE v_status WHEN 'pick' THEN 'A card asks a person to pick the right host card.'
                      ELSE 'A card asks a person whether to reopen the Lost host card.' END
      -- #3980 W4 rework 2: a card a person closed, opened again.
      WHEN v_status = 'pick' AND v_card->>'status' = 'reopened' AND COALESCE((v_res->>'reask')::boolean, false) THEN
        'A card asks a person again: a host card now matches exactly that was not on the card they closed.'
      WHEN v_status = 'pick' AND v_card->>'status' = 'reopened' THEN
        'A card asks a person again: an agent closed it, and only a person decides which host card a brand belongs to.'
      WHEN v_status = 'ask_reopen' AND v_card->>'status' = 'reopened' THEN
        'A card asks a person again whether to reopen the Lost host card: an agent closed it, and only a person decides.'
      WHEN v_status IN ('pick', 'ask_reopen') AND v_card->>'status' = 'kept' AND v_card->>'id' IS NOT NULL THEN
        'A card already waits for a person; no second card was made.'
      WHEN v_status IN ('pick', 'ask_reopen') AND v_card->>'status' = 'kept' THEN
        'Its card for a person was closed in the last 14 days; nothing new was asked.'
      WHEN v_status IN ('pick', 'ask_reopen') THEN 'Not changed: the card for a person could not be made. Try again or add it by hand.'
      WHEN v_status = 'decided' THEN format('Decided by %s on %s; left as it is.', COALESCE(public.ops_name(v_res->>'closed_by'), 'a person'),
                                            to_char((v_res->>'closed_at')::timestamptz AT TIME ZONE 'UTC', 'FMDD Mon YYYY'))
      WHEN v_status = 'has_card' THEN 'It already has a host card.'
      WHEN v_status = 'gone' THEN 'This brand no longer exists.'
      WHEN v_status = 'busy' THEN 'Busy: Mingla was working on this brand at the same moment. Nothing changed; try again.'
      ELSE 'Not changed: ' || COALESCE(v_res->>'error', 'try again.') END;
    IF v_status = 'linked' THEN v_linked := v_linked + 1;
    ELSIF v_status = 'created' THEN v_created := v_created + 1;
    ELSIF v_status = 'busy' THEN v_busy := v_busy + 1;
    ELSE v_skipped := v_skipped + 1; END IF;
    -- #3980 W4 rework 2: of the skipped, those no person needs to look at
    -- (a host card already, gone, or decided and left as it is).
    IF v_status IN ('has_card', 'gone', 'decided') THEN v_unchanged := v_unchanged + 1; END IF;
    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'brand_id', v_id, 'name', v_name, 'status', v_status, 'words', v_words,
      'record_id', v_res->>'record_id', 'card_id', v_res->'card'->>'id')));
  END LOOP;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'backfill_confirmed', 'info', NULL, NULL, NULL,
    format('%s confirmed host cards for %s brands: %s linked, %s added, %s left for a person%s.',
           public.ops_name(v.actor_email), cardinality(v_ids), v_linked, v_created, v_skipped,
           CASE WHEN v_busy > 0 THEN format(', %s busy (try again)', v_busy) ELSE '' END),
    jsonb_build_object('backfill', 'brand_cards', 'linked', v_linked, 'created', v_created, 'skipped', v_skipped, 'busy', v_busy, 'unchanged', v_unchanged));
  v_out := jsonb_build_object('linked', v_linked, 'created', v_created, 'skipped', v_skipped, 'busy', v_busy, 'unchanged', v_unchanged,
                              'replayed', false, 'results', v_results);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'brand_cards', v_out);
  RETURN v_out;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_request_begin(p_actor text, p_key text, p_operation text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_digest text; v_row public.ops_request_keys;
BEGIN
  IF p_key IS NULL THEN RETURN NULL; END IF;
  IF p_key !~ '^[A-Za-z0-9_-]{8,90}$' THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 90 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_digest := encode(extensions.digest(convert_to(COALESCE(p_args, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.ops_request_keys (actor_email, request_key, operation, args_digest)
  VALUES (p_actor, p_key, p_operation, v_digest) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT v_row FROM public.ops_request_keys k WHERE k.actor_email = p_actor AND k.request_key = p_key FOR UPDATE;
  IF v_row.operation IS DISTINCT FROM p_operation OR v_row.args_digest IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'request_key_reused: That request key already belongs to another action or different details. Use a new key.' USING ERRCODE = '22023';
  END IF;
  IF v_row.response IS NULL THEN
    RAISE EXCEPTION 'try_again: The first request did not finish. Send the same request again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_row.response || jsonb_build_object('replayed', true);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_request_finish(p_actor text, p_key text, p_operation text, p_response jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_key IS NULL THEN RETURN; END IF;
  UPDATE public.ops_request_keys k SET response = p_response
   WHERE k.actor_email = p_actor AND k.request_key = p_key AND k.operation = p_operation AND k.response IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'try_again: The request could not be recorded safely. Send the same request again.' USING ERRCODE = 'PT409';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_work_add(p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_item jsonb; v_idx integer := 0; v_rows jsonb := '[]'::jsonb;
  v_chk jsonb; cl jsonb; c public.ops_work_cards; v_event uuid; v_gate jsonb; v_added integer := 0; v_refused integer := 0;
  v_dups integer := 0; v_out jsonb; v_fields text; v_owners text[]; v_watchers text[]; v_ex_id uuid; v_ex_number bigint; v_ex_title text; v_who text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_cards: Send a list of 1 to 50 cards.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-add', 'add', p_items);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) ORDER BY e.ord LOOP
    v_chk := public.ops_validate_card(v_item, 'add', v.actor_email, v_today);
    IF jsonb_array_length(v_chk->'fixes') > 0 THEN
      SELECT string_agg(DISTINCT public.ops_field_words(f->>'field'), ', ') INTO v_fields FROM jsonb_array_elements(v_chk->'fixes') f;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused', 'fixes', v_chk->'fixes',
        'title', v_chk->'clean'->'title'));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', NULL, NULL, NULL,
        format('Card not added (%s): %s to fix.', COALESCE(v_chk->'clean'->>'title', 'no title'), v_fields),
        jsonb_build_object('fields', (SELECT jsonb_agg(DISTINCT f->>'field') FROM jsonb_array_elements(v_chk->'fixes') f)));
      v_refused := v_refused + 1;
    ELSIF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate', 'existing', v_chk->'duplicate',
        'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', (v_chk->'duplicate'->>'id')::uuid, 'work_card', (v_chk->'duplicate'->>'id')::uuid,
        format('Card not added: it repeats Card %s.', v_chk->'duplicate'->>'number'), '{}'::jsonb);
      v_dups := v_dups + 1;
    ELSE
      cl := v_chk->'clean';
      v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
      v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
      v_gate := CASE WHEN cl->>'kind' = 'promo' THEN public.ops_promo_gate(cl->'anchor', v_today) END;
      BEGIN
        INSERT INTO public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason,
          kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, request_key)
        VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
          CASE WHEN cl->>'person_reason' IS NOT NULL THEN 'person' ELSE 'todo' END,
          COALESCE((v_gate->>'blocked')::boolean, false),
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'kind' END,
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'reason' END,
          cl->>'person_reason', cl->>'kind', (cl->>'kit_step')::integer, cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
          (cl->>'due_on')::date, cl->>'due_source', public.ops_sprint_for((cl->>'due_on')::date, v_today), cl->'plan',
          v.actor_email, v.via, v.actor_email, v.via, p_request_key || '-i' || v_idx)
        RETURNING * INTO c;
        PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
        PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
        v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
        IF public.ops_github_set(c.id, cl->'github', v.actor_email, v.via) THEN
          PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'github',
            'GitHub: ' || (SELECT string_agg('#' || (g->>'number'), ', ') FROM jsonb_array_elements(cl->'github') g), NULL, NULL, c.revision, c.revision);
        END IF;
        PERFORM public.ops_notify_people(c.id, v_event, v_owners, v.actor_email, format('%s added you as owner: %s', v_who, c.title));
        PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v.actor_email, format('%s added you as watcher: %s', v_who, c.title));
        PERFORM public.ops_log_write(v.actor_email, v.via, 'card_added', 'ok', c.id, 'work_card', c.id,
          format('Added Card %s: %s', c.number, c.title), jsonb_build_object('owners', cardinality(v_owners), 'watchers', cardinality(v_watchers)));
        IF c.status = 'person' THEN
          PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
            format('Card %s needs a person: %s', c.number, c.title), jsonb_build_object('reason', c.person_reason));
        END IF;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'added', 'card', public.ops_card_json(c, v_today)));
        v_added := v_added + 1;
      EXCEPTION WHEN unique_violation THEN
        SELECT w.id, w.number, w.title INTO v_ex_id, v_ex_number, v_ex_title FROM public.ops_work_cards w
         WHERE w.archived_at IS NULL AND ((w.title_key = public.crm_name_key(cl->>'title') AND w.status <> 'done')
            OR (w.anchor_kind = cl->>'anchor_kind' AND w.anchor_id = (cl->>'anchor_id')::uuid AND w.kit_step = (cl->>'kit_step')::integer))
         LIMIT 1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate',
          'existing', jsonb_build_object('id', v_ex_id, 'number', v_ex_number, 'title', v_ex_title),
          'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_ex_title, v_ex_number)));
        v_dups := v_dups + 1;
      END;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  v_out := jsonb_build_object('results', v_rows, 'added', v_added, 'refused', v_refused, 'duplicate', v_dups, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-add', 'add', v_out);
  RETURN v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM ~ '^[a-z_]+: ' THEN RAISE; END IF;
  RAISE WARNING 'ops_work_add: request stopped (% %)', SQLSTATE, SQLERRM;
  RAISE EXCEPTION 'try_again: Something went wrong on our side, so nothing in this request was added. Send the same request again.' USING ERRCODE = 'PT409';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_work_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text;
  v_before jsonb; v_item jsonb; v_chk jsonb; cl jsonb; v_fixes jsonb; v_people jsonb; v_links_changed boolean := false;
  v_cats text[] := ARRAY[]::text[]; v_action text; v_event uuid; v_out jsonb; v_gate jsonb; v_week date; v_who text;
  v_status text; v_reason text; v_result text; v_breason text; v_owners text[]; v_watchers text[]; v_anchor_changed boolean := false;
  v_back boolean := false; v_back_reason text; -- Wave 2: leaving Needs a person
  v_removed_words text; -- #3980 rework 2: who was taken off, for the agent log
  v_gh_changed boolean := false; v_chat text;
  v_gh_list text; v_gh_wait boolean := false; -- #3980 synced, Wave 2: waiting for GitHub
  v_gh_cur text; -- #3980 W2 rework: the links a waiting card has now
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A card change does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'update',
    jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  v_who := public.ops_actor_label(v.actor_email, v.via);
  v_anchor_changed := p_changes ? 'anchor' AND (p_changes->'anchor' IS DISTINCT FROM
    CASE WHEN c.anchor_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) END);

  v_item := jsonb_build_object('id', c.id,
    'title', COALESCE(p_changes->'title', to_jsonb(c.title)),
    'instructions', COALESCE(p_changes->'instructions', to_jsonb(c.instructions)),
    'done_means', COALESCE(p_changes->'done_means', to_jsonb(c.done_means)),
    'owners', CASE WHEN p_changes ? 'owners' THEN p_changes->'owners' ELSE to_jsonb(public.ops_card_people(c.id, 'owner')) END,
    'watchers', CASE WHEN p_changes ? 'watchers' THEN p_changes->'watchers' ELSE to_jsonb(public.ops_card_people(c.id, 'watcher')) END,
    'links', CASE WHEN p_changes ? 'links' THEN p_changes->'links'
                  ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id)) FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb) END,
    'anchor', CASE WHEN p_changes ? 'anchor' THEN p_changes->'anchor'
                   WHEN c.anchor_id IS NOT NULL THEN jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) ELSE 'null'::jsonb END,
    'kit_step', to_jsonb(c.kit_step), 'kind', to_jsonb(c.kind),
    'person_reason', CASE WHEN p_changes ? 'person_reason' THEN p_changes->'person_reason' ELSE to_jsonb(c.person_reason) END,
    'plan', CASE WHEN p_changes ? 'plan' THEN p_changes->'plan' ELSE c.plan END,
    'github', CASE WHEN p_changes ? 'github' THEN p_changes->'github'
                   ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'number', g.number) ORDER BY g.number)
                                    FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb) END,
    'due_on', CASE WHEN p_changes ? 'due_on' THEN p_changes->'due_on'
                   WHEN v_anchor_changed AND c.due_source <> 'explicit' THEN 'null'::jsonb ELSE to_jsonb(c.due_on) END,
    '_due_source', CASE WHEN p_changes ? 'due_on' THEN 'explicit' ELSE c.due_source END);
  IF p_changes ? 'links' AND NOT (p_changes ? 'anchor') AND c.anchor_id IS NOT NULL
     AND jsonb_typeof(p_changes->'links') = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'links') l WHERE l->>'kind' = c.anchor_kind AND lower(l->>'id') = c.anchor_id::text)
     AND c.kind = 'task' AND c.kit_step IS NULL THEN
    -- removing the anchor's link frees the card from its event
    v_item := jsonb_set(v_item, '{anchor}', 'null'::jsonb);
    IF c.due_source <> 'explicit' THEN v_item := jsonb_set(v_item, '{due_on}', to_jsonb(c.due_on)); v_item := jsonb_set(v_item, '{_due_source}', '"explicit"'); END IF;
    v_anchor_changed := true;
  END IF;
  v_chk := public.ops_validate_card(v_item, 'update', v.actor_email, v_today);
  v_fixes := v_chk->'fixes';
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' AND p_changes ? 'title' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message',
      format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
  END IF;
  cl := v_chk->'clean';

  -- status, needs a person, blocked, result, week
  v_status := c.status; v_reason := c.person_reason;
  IF p_changes ? 'status' THEN
    IF jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('todo','doing','person') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be todo, doing or person. Close a card with proof, or push it back.'));
    ELSE v_status := p_changes->>'status'; END IF;
  END IF;
  IF p_changes ? 'person_reason' THEN v_reason := cl->>'person_reason'; END IF;
  IF v_status = 'person' AND v_reason IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'Needs a person must say why: send, spend, publish or other.'));
  END IF;
  IF v_status <> 'person' THEN v_reason := NULL; END IF;
  -- Wave 2: an agent moving a card that needs a person back to To do or
  -- Doing must say why; the log records it and owners and watchers are told.
  v_back := c.status = 'person' AND v_status <> 'person';
  IF v_back THEN
    v_back_reason := CASE WHEN jsonb_typeof(p_changes->'reason') = 'string' THEN left(public.ops_one_line(p_changes->>'reason'), 500) END;
    IF public.ops_has_control(v_back_reason) THEN v_back_reason := NULL; END IF;
    IF v.via IS NOT NULL AND v_back_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required: Say why this card no longer needs a person. Your person and the card''s watchers are told.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- #3980 W2 rework 3: an agent never moves a roadmap approval card or
  -- changes what it waits for, so it cannot send it back and then close it.
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (v_status IS DISTINCT FROM c.status OR (p_changes ? 'person_reason' AND cl->>'person_reason' IS DISTINCT FROM c.person_reason)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
  END IF;
  n := c;
  -- Wave 2: the GitHub issues and pull requests the card waits for.
  SELECT string_agg('#' || (x->>'number'), ', ' ORDER BY (x->>'number')::integer) INTO v_gh_list
    FROM jsonb_array_elements(COALESCE(cl->'github', '[]'::jsonb)) x;
  SELECT string_agg('#' || g.number, ', ' ORDER BY g.number) INTO v_gh_cur FROM public.ops_work_github g WHERE g.card_id = c.id;
  -- #3980 W2 rework: an agent cannot change what a waiting card waits for
  -- (adding, removing or swapping a link would let it lift the wait); a
  -- person can, and the agent log says who did.
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL AND p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_cur, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL
     AND ((p_changes ? 'blocked_on_github' AND jsonb_typeof(p_changes->'blocked_on_github') = 'boolean' AND NOT (p_changes->>'blocked_on_github')::boolean)
          OR (NOT (p_changes ? 'blocked_on_github') AND p_changes ? 'blocked')) THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_list, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'blocked_on_github' THEN
    v_gh_wait := true;
    IF jsonb_typeof(p_changes->'blocked_on_github') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_on_github', 'message', 'Blocked until Live must be true or false.'));
    ELSIF (p_changes->>'blocked_on_github')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      IF v_gh_list IS NULL THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'Link a GitHub issue or pull request first; the card then waits for it to be Live.'));
      ELSE n.blocked := true; n.blocked_kind := 'github'; n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
    ELSIF c.blocked_kind = 'github' THEN
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked' THEN
    IF jsonb_typeof(p_changes->'blocked') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked', 'message', 'Blocked must be true or false.'));
    ELSIF (p_changes->>'blocked')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      v_breason := public.ops_one_line(p_changes->>'blocked_reason');
      IF v_breason IS NULL OR char_length(v_breason) NOT BETWEEN 5 AND 300 THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.'));
      ELSE n.blocked := true; n.blocked_kind := 'manual'; n.blocked_reason := v_breason; END IF;
    ELSE
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked_reason' THEN
    v_breason := public.ops_one_line(p_changes->>'blocked_reason');
    IF c.blocked_kind = 'manual' AND v_breason IS NOT NULL AND char_length(v_breason) BETWEEN 5 AND 300 THEN n.blocked_reason := v_breason;
    ELSE v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.')); END IF;
  END IF;
  -- Wave 2: a card waiting for GitHub keeps its reason in step with its links.
  IF NOT v_gh_wait AND n.blocked_kind = 'github' AND p_changes ? 'github' THEN
    IF v_gh_list IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card waiting for GitHub keeps at least one GitHub link. Lift the wait first.'));
    ELSE n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
  END IF;
  IF p_changes ? 'result' THEN
    v_result := CASE WHEN jsonb_typeof(p_changes->'result') = 'string' THEN public.ops_multi_line(p_changes->>'result') END;
    IF char_length(COALESCE(v_result, '')) > 2000 OR public.ops_has_control(v_result) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'result', 'message', 'Keep the result to 2,000 characters.'));
    ELSE n.result := v_result; END IF;
  END IF;
  IF p_changes ? 'week' AND jsonb_typeof(p_changes->'week') <> 'null' THEN
    BEGIN
      v_week := public.ops_monday((p_changes->>'week')::date);
      IF v_week NOT BETWEEN v_today - 730 AND v_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'week', 'message', 'Sprint must be a real week within two years.'));
      v_week := NULL;
    END;
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  n.title := cl->>'title'; n.instructions := cl->>'instructions'; n.done_means := cl->>'done_means';
  n.anchor_kind := cl->>'anchor_kind'; n.anchor_id := (cl->>'anchor_id')::uuid;
  n.due_on := (cl->>'due_on')::date; n.due_source := cl->>'due_source'; n.plan := cl->'plan';
  n.status := v_status; n.person_reason := v_reason;
  IF v_status = 'doing' AND c.status <> 'doing' THEN n.started_at := COALESCE(c.started_at, clock_timestamp()); n.working_by := v.actor_email; n.working_via := v.via; END IF;
  -- Back to To do: nobody is working on it any more, so the mark ends.
  IF v_status = 'todo' AND c.status = 'doing' THEN n.working_by := NULL; n.working_via := NULL; END IF;
  n.sprint_id := CASE WHEN v_week IS NOT NULL THEN public.ops_sprint_ensure(v_week) ELSE c.sprint_id END;
  IF c.kind = 'promo' AND v_anchor_changed AND c.override_at IS NULL THEN
    v_gate := public.ops_promo_gate(cl->'anchor', v_today);
    n.blocked := (v_gate->>'blocked')::boolean;
    n.blocked_kind := CASE WHEN n.blocked THEN v_gate->>'kind' END;
    n.blocked_reason := CASE WHEN n.blocked THEN v_gate->>'reason' END;
  END IF;

  -- #3980 W2 rework 4: on a roadmap approval card an agent changes nothing
  -- that ties it to its draft or decides whether it is open: its links, its
  -- GitHub links, blocked or waiting, or its anchor. Its wording, plan,
  -- result and due date stay editable. (A trigger refuses the same for every
  -- other writer.)
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (ROW(n.blocked, n.blocked_kind, n.blocked_reason, n.anchor_kind, n.anchor_id)
            IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason, c.anchor_kind, c.anchor_id)
          OR (p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur)
          OR (p_changes ? 'links' AND
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT l.kind || ':' || l.target_id::text AS k FROM public.ops_work_links l WHERE l.card_id = c.id) a)
              IS DISTINCT FROM
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT (x->>'kind') || ':' || lower(x->>'id') AS k FROM jsonb_array_elements(COALESCE(cl->'links', '[]'::jsonb)) x) b))) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes what this card links to or waits for.' USING ERRCODE = '42501';
  END IF;
  -- #3980 W2 follow-up: nor who owns or watches it (the same test
  -- ops_people_set uses for "changed"; a trigger backstops every writer).
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (public.ops_card_people(c.id, 'owner')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)) x ORDER BY x)
          OR public.ops_card_people(c.id, 'watcher')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'watchers', '[]'::jsonb)) x
                                    WHERE NOT x = ANY (ARRAY(SELECT jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)))) ORDER BY x)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes who owns or watches this card.' USING ERRCODE = '42501';
  END IF;

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  IF n.plan IS DISTINCT FROM c.plan THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    plan = n.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via,
    working_chat = CASE WHEN v_status = 'doing' AND c.status <> 'doing' THEN v_chat
                        WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_chat END,
    working_seen_at = CASE WHEN v_status = 'doing' AND c.status <> 'doing' AND v.via IS NOT NULL THEN clock_timestamp()
                           WHEN v_status = 'doing' AND c.status <> 'doing' THEN NULL
                           WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_seen_at END
   WHERE id = c.id;
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  v_people := public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
  IF (v_people->>'changed')::boolean THEN v_cats := v_cats || 'people'::text; END IF;
  v_links_changed := public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
  IF v_links_changed THEN v_cats := v_cats || 'links'::text; END IF;
  IF p_changes ? 'github' THEN
    v_gh_changed := public.ops_github_set(c.id, cl->'github', v.actor_email, v.via);
    IF v_gh_changed THEN v_cats := v_cats || 'github'::text; END IF;
    -- #3980 W2 rework: a person changing what a waiting card waits for is logged by name.
    IF v_gh_changed AND c.blocked_kind = 'github' AND v.via IS NULL THEN
      PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
        format('%s changed what Card %s waits for: %s (was %s).', v_who, c.number, COALESCE(v_gh_list, 'nothing'), COALESCE(v_gh_cur, 'nothing')),
        jsonb_build_object('changed', '["github"]'::jsonb, 'from', v_gh_cur, 'to', v_gh_list, 'waiting', true));
    END IF;
  END IF;

  IF cardinality(v_cats) = 0 THEN
    SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = c.id;
    v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', NULL, 'changed', false);
    PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
    RETURN v_out;
  END IF;
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_action := CASE WHEN cardinality(v_cats) = 1 THEN v_cats[1] ELSE 'updated' END;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, v_action, CASE WHEN v_back THEN v_back_reason END, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  -- "Gia, Hal": the people taken off the card, by name, for the agent log.
  -- A name another teammate shares carries the address: "Gia <gia@...>".
  SELECT string_agg(public.ops_name(x.email)
           || CASE WHEN EXISTS (SELECT 1 FROM public.admin_team_directory() d
                                 WHERE d.status = 'active' AND d.email <> x.email
                                   AND lower(public.crm_display_name(d.email)) = lower(public.ops_name(x.email)))
                   THEN ' <' || x.email || '>' ELSE '' END, ', ' ORDER BY x.ord) INTO v_removed_words
    FROM jsonb_array_elements_text(COALESCE(v_people->'removed', '[]'::jsonb)) WITH ORDINALITY AS x(email, ord);
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_owners')), v.actor_email,
    format('%s added you as owner: %s', v_who, n.title));
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_watchers')), v.actor_email,
    format('%s added you as watcher: %s', v_who, n.title));
  -- An agent that takes someone off a card tells them: who, which agent, and
  -- the card (the notice links to it). Guardrail, not a bottleneck.
  IF v.via IN ('claude', 'codex') THEN
    PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'removed')), v.actor_email,
      format('%s took you off this card: %s', v_who, n.title));
  END IF;
  IF n.status = 'person' AND c.status <> 'person' THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s: %s needs a person (%s)', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'send a message' WHEN 'spend' THEN 'spend money' WHEN 'publish' THEN 'publish an event' ELSE 'other' END));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s needs a person: %s', n.number, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card stops needing a person.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s moved %s back to %s from Needs a person%s', v_who, n.title, CASE n.status WHEN 'doing' THEN 'Doing' ELSE 'To do' END,
        COALESCE(': ' || v_back_reason, '')));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'info', c.id, 'work_card', c.id,
      format('Card %s no longer needs a person%s', n.number, COALESCE(': ' || v_back_reason, '.')),
      jsonb_build_object('changed', to_jsonb(v_cats), 'from', 'person', 'to', n.status, 'reason', v_back_reason));
  ELSIF v.via IS NOT NULL THEN
    PERFORM public.ops_log_write(v.actor_email, v.via,
      CASE v_action WHEN 'plan' THEN 'step' WHEN 'blocked' THEN 'blocked' WHEN 'unblocked' THEN 'unblocked' ELSE 'updated' END, 'ok', c.id, 'work_card', c.id,
      CASE WHEN v_action = 'plan' THEN format('Plan on Card %s: %s of %s steps done.', n.number,
             (SELECT count(*) FROM jsonb_array_elements(n.plan) s WHERE s->>'status' = 'done'), jsonb_array_length(n.plan))
           WHEN v_action = 'blocked' THEN format('Card %s blocked: %s', n.number, n.blocked_reason)
           -- #3980 rework 2: a removal says who was taken off, not "Updated".
           WHEN v_action = 'people' AND v_removed_words IS NOT NULL
                AND jsonb_array_length(v_people->'new_owners') = 0 AND jsonb_array_length(v_people->'new_watchers') = 0
             THEN format('Took %s off Card %s: %s', v_removed_words, n.number, n.title)
           WHEN v_removed_words IS NOT NULL THEN format('Updated Card %s: %s. Took %s off it.', n.number, n.title, v_removed_words)
           ELSE format('Updated Card %s: %s', n.number, n.title) END, jsonb_build_object('changed', to_jsonb(v_cats)));
  END IF;
  v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'invalid_card: An open card already has this title. Update that card instead.' USING ERRCODE = '22023';
END;

$function$
;
CREATE OR REPLACE FUNCTION public.team_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  c_tools constant text[] := ARRAY[
    'get_started', 'my_day', 'find_records', 'get_record', 'check_names',
    'find_mingla_link', 'check_contactable', 'list_beta_leads', 'team_summary',
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply',
    'save_drafts', 'update_draft', 'list_drafts', 'withdraw_drafts'];
  c_writes constant text[] := ARRAY[
    'add_records', 'upsert_record', 'update_records',
    'move_stage', 'set_owners', 'log_activity', 'record_reply',
    'save_drafts', 'update_draft', 'withdraw_drafts'];
  c_plumbing constant text[] := ARRAY[
    'mcp:initialize', 'mcp:ping', 'mcp:tools/list', 'mcp:resources/list', 'mcp:resources/read',
    'mcp:prompts/list', 'mcp:prompts/get', 'mcp:notification', 'mcp:other'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_rk constant text := '^[A-Za-z0-9_-]{8,70}$';
  -- The argument that holds the list, for each tool that takes one.
  c_lists constant jsonb := '{"add_records": "records", "update_records": "updates", "move_stage": "moves",
                              "set_owners": "items", "log_activity": "entries", "record_reply": "replies",
                              "save_drafts": "drafts", "withdraw_drafts": "ids"}';
  v_auth    jsonb;
  v_key     uuid;
  v_owner   text;
  v_uid     uuid;
  v_agent   text;
  v_me      jsonb;
  v_lim     jsonb := public.team_agent_limits();
  v_args    jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_tool    text;
  v_started timestamptz := clock_timestamp();
  v_day     timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_n       bigint;
  v_oldest  timestamptz;
  v_retry   integer;
  v_token   text;
  v_words   text;
  v_call    uuid;
  v_client  text;
  v_result  jsonb;
  v_ok      boolean := false;
  v_m       text[];
  v_g       jsonb;
  v_date    date;
  v_int     integer;
  v_bool    boolean;
  v_name    jsonb;
  v_rows    jsonb;
  v_utc     date := (now() AT TIME ZONE 'UTC')::date;
  v_zone    text;
  v_zfrom   text;
  v_dfrom   text;
  v_dates   jsonb;
  v_lock_before text;
  v_field   text;
  v_list    jsonb;
  v_item    jsonb;
  v_idx     integer;
  v_id      uuid;
  v_one     jsonb;
  v_two     jsonb;
  v_row     jsonb;
  v_touch   jsonb;
  v_rk      text;
  v_stage   text;
  v_pipe    text;
  v_to      text;
  v_note    text;
  v_moved   text;
  v_replay  boolean;
  v_items   integer := 0;
  v_sum     jsonb := '{}'::jsonb;
  v_c1      integer := 0;
  v_c2      integer := 0;
  v_c3      integer := 0;
  v_c4      integer := 0;
  v_c5      integer := 0;
  v_want    integer := 0;
  v_cand    jsonb;
  v_chk     jsonb;
BEGIN
  -- A setup code, not a key: handed straight on. Nothing else here runs.
  IF p_tool = 'setup:redeem' THEN
    RETURN public.team_agent_setup_redeem(p_key_hash, p_client);
  END IF;

  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN
    RETURN '{"auth":"invalid"}'::jsonb;
  END IF;
  v_key   := (v_auth->>'key_id')::uuid;
  v_owner := v_auth->>'owner_email';
  v_uid   := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent';
  v_me    := jsonb_build_object('role', v_auth->>'role', 'agent', v_agent);
  -- Only a name from the fixed lists is ever stored.
  v_tool  := CASE WHEN p_tool = ANY (c_tools) OR p_tool = ANY (c_plumbing) THEN p_tool ELSE 'unknown' END;

  -- Limits. A refused request is recorded and does not count against the key.
  -- One request at a time per key from here to the end of the transaction, so
  -- the count below and the row written after it are one step: two requests
  -- arriving together can never both be "the last one allowed". A request
  -- waits for its turn for a bounded time only.
  v_lock_before := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', (v_lim->>'key_wait_ms') || 'ms', true);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_limit:' || v_key::text, 0));
    PERFORM set_config('lock_timeout', v_lock_before, true);
  EXCEPTION WHEN lock_not_available THEN
    PERFORM set_config('lock_timeout', v_lock_before, true);
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started,
            LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer,
            'limited');
    RETURN jsonb_build_object('limited',
      jsonb_build_object('retry_after_s', 2, 'token', 'busy',
        'message', 'Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'),
      'me', v_me);
  END;
  SELECT count(*), min(c.started_at) INTO v_n, v_oldest
  FROM public.team_agent_calls c
  WHERE c.key_id = v_key AND c.started_at > v_started - interval '60 seconds' AND c.outcome <> 'limited';
  IF v_n >= (v_lim->>'requests_per_minute')::integer THEN
    v_retry := GREATEST(1, LEAST(60, ceil(60 - extract(epoch FROM (v_started - v_oldest)))::integer));
    v_token := 'rate_limited';
    v_words := format('Your agent has made a lot of requests in the last minute. Wait %s seconds, then carry on. Nothing was lost.', v_retry);
  ELSIF v_tool NOT LIKE 'mcp:%' THEN
    SELECT count(*) INTO v_n
    FROM public.team_agent_calls c
    WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited' AND c.tool NOT LIKE 'mcp:%';
    IF v_n >= (v_lim->>'tool_calls_per_day')::integer THEN
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
      v_token := 'daily_limit';
      v_words := format('Your agent reached today''s limit of %s requests. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'tool_calls_per_day');
    ELSIF v_tool = ANY (c_writes) THEN
      SELECT COALESCE(sum(c.items), 0) INTO v_n
      FROM public.team_agent_calls c
      WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited';
      -- The most this request could write, counted before it writes anything,
      -- so the day's limit is never passed part-way through a request.
      v_list := v_args->COALESCE(c_lists->>v_tool, 'record');
      v_want := CASE
        WHEN v_tool = 'upsert_record' THEN 1 + COALESCE((jsonb_typeof(v_args->'touch') = 'object')::integer, 0)
        WHEN jsonb_typeof(v_list) IS DISTINCT FROM 'array' THEN 1
        WHEN v_tool = 'add_records' THEN jsonb_array_length(v_list)
          + (SELECT count(*)::integer FROM jsonb_array_elements(v_list) AS e
              WHERE jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'first_touch') = 'object')
        ELSE jsonb_array_length(v_list) END;
      v_list := NULL;
      IF v_n >= (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := format('Your agent reached today''s limit of %s records written. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'records_written_per_day');
      ELSIF v_n + v_want > (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := format('This request could write %s records and your agent has %s left of today''s %s. Nothing was written. Send fewer in one request, or wait: the count starts again at midnight UTC.',
          v_want, (v_lim->>'records_written_per_day')::integer - v_n, v_lim->>'records_written_per_day');
      END IF;
    END IF;
  END IF;
  IF v_token IS NOT NULL THEN
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited',
      jsonb_build_object('retry_after_s', v_retry, 'token', v_token, 'message', v_words), 'me', v_me);
  END IF;

  -- The request row. From here on, crm_ctx() answers "via" this agent for
  -- this person, in this transaction only.
  INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started)
  RETURNING id INTO v_call;

  v_client := NULLIF(left(regexp_replace(COALESCE(p_client, ''), '[[:cntrl:]]', '', 'g'), 120), '');
  UPDATE public.team_agent_keys
     SET last_used_at = v_started, last_used_client = v_client
   WHERE id = v_key AND (last_used_at IS NULL OR last_used_at < v_started - interval '60 seconds');

  BEGIN
    IF v_tool LIKE 'mcp:%' THEN
      v_result := CASE
        WHEN v_tool IN ('mcp:resources/read', 'mcp:prompts/list', 'mcp:prompts/get') THEN public.team_agent_guide()
        ELSE '{}'::jsonb
      END;
    ELSE
      -- The gate, before anything else: the person must hold the crm area.
      PERFORM 1 FROM public.crm_ctx();

      -- "Today", for the tools that depend on a date: the date the request
      -- names, else today in the zone the request names, else today in the
      -- zone the key remembers, else today in UTC. The answer says which.
      IF v_tool IN ('my_day', 'team_summary', 'find_records') THEN
        v_zone := v_auth->>'time_zone';
        v_zfrom := 'your key';
        IF v_args ? 'time_zone' AND jsonb_typeof(v_args->'time_zone') <> 'null' THEN
          IF jsonb_typeof(v_args->'time_zone') <> 'string' OR (v_args->>'time_zone') !~ '^[A-Za-z0-9_+/-]{1,64}$'
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_args->>'time_zone') THEN
            RAISE EXCEPTION 'invalid_arguments: "time_zone" is missing or the wrong kind. Send a zone name such as America/New_York.' USING ERRCODE = '22023';
          END IF;
          v_zone := v_args->>'time_zone';
          v_zfrom := 'this request';
        END IF;
        BEGIN
          v_date := (clock_timestamp() AT TIME ZONE COALESCE(v_zone, 'UTC'))::date;
        EXCEPTION WHEN others THEN
          v_zone := NULL;      -- a remembered zone this server no longer knows
          v_date := v_utc;
        END;
        IF v_zone IS NULL THEN
          v_zone := 'UTC';
          v_zfrom := 'no zone is recorded for your key, so UTC';
        END IF;
        v_dfrom := 'the clock';
        IF v_args ? 'today' AND jsonb_typeof(v_args->'today') <> 'null' THEN
          BEGIN
            IF jsonb_typeof(v_args->'today') <> 'string' OR (v_args->>'today') !~ '^\d{4}-\d{2}-\d{2}$' THEN
              RAISE EXCEPTION 'bad' USING ERRCODE = '22007';
            END IF;
            v_date := (v_args->>'today')::date;
          EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send a date such as 2026-10-13.' USING ERRCODE = '22023';
          END;
          IF v_date NOT BETWEEN v_utc - 1 AND v_utc + 1 THEN
            RAISE EXCEPTION 'invalid_arguments: "today" is missing or the wrong kind. Send your person''s own date today (it is within a day of the date in UTC), or leave it out.' USING ERRCODE = '22023';
          END IF;
          v_dfrom := 'this request';
        END IF;
        v_dates := jsonb_build_object('today', v_date, 'time_zone', v_zone, 'zone_from', v_zfrom, 'date_from', v_dfrom);
      END IF;

      -- A tool that takes a list: the list is there, holds 1 to 50 objects.
      v_field := c_lists->>v_tool;
      IF v_field IS NOT NULL THEN
        v_list := v_args->v_field;
        IF jsonb_typeof(v_list) IS DISTINCT FROM 'array' OR jsonb_array_length(v_list) < 1
           OR (v_tool = 'withdraw_drafts' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) AS e
                 WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~* c_uuid))
           OR (v_tool <> 'withdraw_drafts' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) AS e WHERE jsonb_typeof(e) <> 'object')) THEN
          RAISE EXCEPTION '%', format('invalid_arguments: "%s" is missing or the wrong kind. Send a list of 1 to 50 valid items.', v_field)
            USING ERRCODE = '22023';
        END IF;
        IF jsonb_array_length(v_list) > (v_lim->>'items_per_request')::integer THEN
          RAISE EXCEPTION 'too_many_items: Send at most 50 items in one request. Split the rest into another request.' USING ERRCODE = '22023';
        END IF;
      END IF;
      -- A tool that adds or logs: the request key that makes a repeat safe.
      IF v_tool IN ('add_records', 'upsert_record', 'log_activity', 'record_reply', 'save_drafts') THEN
        IF jsonb_typeof(v_args->'request_key') IS DISTINCT FROM 'string' OR (v_args->>'request_key') !~ c_rk THEN
          RAISE EXCEPTION 'request_key_required: Send a request_key (8 to 70 letters, digits, - or _) with this request, and the same one if you repeat it, so a repeat changes nothing.'
            USING ERRCODE = '22023';
        END IF;
        v_rk := v_args->>'request_key';
        -- The key belongs to this tool and these arguments. Another use of it
        -- stops here, before anything is written.
        PERFORM public.crm_request_claim(v_rk || '-claim', 'agent:' || v_tool, v_args);
      END IF;

      CASE v_tool
        WHEN 'get_started' THEN
          v_g := public.team_agent_guide();
          v_result := jsonb_build_object(
            'me', (v_g->'config'->'me') - 'can_delete' - 'can_add_region',
            'role', v_auth->>'role',
            'agent', v_agent,
            'can', jsonb_build_object('delete', false,
                                      'set_targets', public.is_admin_user(),
                                      'see_team_dashboard', public.is_admin_user()),
            'status', v_g->'guide'->'status',
            'pipelines', v_g->'config'->'pipelines',
            'channels', v_g->'config'->'channels',
            'sources', v_g->'config'->'sources',
            'reply_classes', v_g->'config'->'reply_classes',
            'agreements', v_g->'config'->'agreements',
            'regions', v_g->'config'->'regions',
            'team', v_g->'config'->'team',
            'limits', v_g->'limits',
            'rules', v_g->'guide'->'rules',
            'routines', v_g->'guide'->'routines',
            'coming_next', v_g->'guide'->'coming_next');

        WHEN 'my_day', 'team_summary' THEN
          v_result := CASE v_tool WHEN 'my_day' THEN public.crm_home_summary(v_date) || jsonb_build_object('drafts_waiting', public.team_draft_counts()->'waiting')
                                  ELSE public.crm_team_summary(v_date) END;

        WHEN 'find_records' THEN
          v_result := public.team_agent_records_find((v_args - 'time_zone') || jsonb_build_object('today', v_date));

        WHEN 'get_record' THEN
          IF jsonb_typeof(v_args->'id') IS DISTINCT FROM 'string' OR (v_args->>'id') !~* c_uuid THEN
            RAISE EXCEPTION '%', format('invalid_id: "%s" is not a record id. Use an id returned by find_records.',
              left(COALESCE(v_args->>'id', ''), 60)) USING ERRCODE = '22023';
          END IF;
          v_int := (v_lim->>'record_log_default')::integer;
          IF v_args ? 'activity_limit' AND jsonb_typeof(v_args->'activity_limit') <> 'null' THEN
            IF jsonb_typeof(v_args->'activity_limit') <> 'number' OR (v_args->>'activity_limit') !~ '^\d{1,3}$'
               OR (v_args->>'activity_limit')::integer NOT BETWEEN 1 AND (v_lim->>'record_log_max')::integer THEN
              RAISE EXCEPTION '%', format('invalid_arguments: "activity_limit" is missing or the wrong kind. Send a whole number from 1 to %s.',
                v_lim->>'record_log_max') USING ERRCODE = '22023';
            END IF;
            v_int := (v_args->>'activity_limit')::integer;
          END IF;
          v_g := public.crm_record_get((v_args->>'id')::uuid);
          v_result := jsonb_build_object(
            'record', v_g->'record',
            'links', v_g->'links',
            'activity', COALESCE((SELECT jsonb_agg(e ORDER BY ord)
                                    FROM jsonb_array_elements(v_g->'activity') WITH ORDINALITY AS t(e, ord)
                                   WHERE ord <= v_int), '[]'::jsonb),
            'activity_shown', LEAST(v_int, jsonb_array_length(v_g->'activity')),
            'more_activity', jsonb_array_length(v_g->'activity') > v_int);

        WHEN 'check_names' THEN
          IF jsonb_typeof(v_args->'names') IS DISTINCT FROM 'array'
             OR jsonb_array_length(v_args->'names') < 1
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_args->'names') e
                         WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 160) THEN
            RAISE EXCEPTION 'invalid_arguments: "names" is missing or the wrong kind. Send a list of 1 to 50 names, each at most 160 characters.' USING ERRCODE = '22023';
          END IF;
          IF jsonb_array_length(v_args->'names') > (v_lim->>'items_per_request')::integer THEN
            RAISE EXCEPTION 'too_many_items: Send at most 50 items in one request. Split the rest into another request.' USING ERRCODE = '22023';
          END IF;
          v_rows := '[]'::jsonb;
          FOR v_name IN SELECT e FROM jsonb_array_elements(v_args->'names') WITH ORDINALITY AS t(e, ord) ORDER BY ord LOOP
            v_rows := v_rows || jsonb_build_array(
              jsonb_build_object('name', v_name #>> '{}')
              || public.crm_duplicate_check(v_args->>'pipeline', v_name #>> '{}', NULL));
          END LOOP;
          v_result := jsonb_build_object('pipeline', v_args->>'pipeline', 'names', v_rows);

        WHEN 'find_mingla_link' THEN
          IF jsonb_typeof(v_args->'query') IS DISTINCT FROM 'string' OR char_length(v_args->>'query') > 160 THEN
            RAISE EXCEPTION 'invalid_arguments: "query" is missing or the wrong kind. Send at least 2 and at most 160 characters of a name.' USING ERRCODE = '22023';
          END IF;
          v_result := public.crm_link_search(v_args->>'kind', v_args->>'query');

        WHEN 'list_beta_leads' THEN
          v_bool := true;
          IF v_args ? 'only_new' AND jsonb_typeof(v_args->'only_new') <> 'null' THEN
            IF jsonb_typeof(v_args->'only_new') <> 'boolean' THEN
              RAISE EXCEPTION 'invalid_arguments: "only_new" is missing or the wrong kind. Send true or false.' USING ERRCODE = '22023';
            END IF;
            v_bool := (v_args->>'only_new')::boolean;
          END IF;
          v_int := (v_lim->>'find_page_default')::integer;
          IF v_args ? 'limit' AND jsonb_typeof(v_args->'limit') <> 'null' THEN
            IF jsonb_typeof(v_args->'limit') <> 'number' OR (v_args->>'limit') !~ '^\d{1,3}$'
               OR (v_args->>'limit')::integer NOT BETWEEN 1 AND (v_lim->>'find_page_max')::integer THEN
              RAISE EXCEPTION '%', format('invalid_arguments: "limit" is missing or the wrong kind. Send a whole number from 1 to %s.',
                v_lim->>'find_page_max') USING ERRCODE = '22023';
            END IF;
            v_int := (v_args->>'limit')::integer;
          END IF;
          v_g := public.crm_beta_leads_list();
          SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_rows
          FROM (SELECT e, ord FROM jsonb_array_elements(v_g->'leads') WITH ORDINALITY AS t(e, ord)
                 WHERE NOT v_bool OR jsonb_typeof(e->'host') IS DISTINCT FROM 'object'
                 ORDER BY ord LIMIT v_int) s;
          v_result := jsonb_build_object('leads', v_rows, 'total', v_g->'total', 'new_count', v_g->'new_count',
                                         'only_new', v_bool, 'shown', jsonb_array_length(v_rows));

        WHEN 'check_contactable' THEN
          v_result := public.crm_contact_check(v_args->>'pipeline', v_args->'candidates');

        WHEN 'add_records' THEN
          -- The bulk add the browser uses, then one log entry for each new
          -- record that came with a first touch.
          v_g := public.crm_records_bulk_create(
            v_args->>'pipeline',
            (SELECT jsonb_agg(t.e - 'first_touch' ORDER BY t.ord) FROM jsonb_array_elements(v_list) WITH ORDINALITY AS t(e, ord)),
            v_rk || '-a');
          v_replay := COALESCE((v_g->>'replayed')::boolean, false);
          v_rows := '[]'::jsonb;
          FOR v_idx IN 0 .. jsonb_array_length(v_list) - 1 LOOP
            v_item := v_list->v_idx;
            v_touch := NULL;
            SELECT e INTO v_one FROM jsonb_array_elements(v_g->'created') AS e WHERE (e->>'index')::integer = v_idx;
            IF FOUND THEN
              v_c1 := v_c1 + 1;
              v_row := jsonb_build_object('index', v_idx, 'status', 'created', 'record', v_one->'record');
              IF v_item ? 'first_touch' AND jsonb_typeof(v_item->'first_touch') <> 'null' THEN
                BEGIN
                  IF jsonb_typeof(v_item->'first_touch') <> 'object' THEN
                    RAISE EXCEPTION 'invalid_entry: Send first_touch as one object with a channel, a direction and the message.' USING ERRCODE = '22023';
                  END IF;
                  v_two := public.crm_record_log((v_one->'record'->>'id')::uuid,
                             (v_item->'first_touch') || jsonb_build_object('kind', 'touch'),
                             v_rk || '-t' || v_idx);
                  IF COALESCE((v_two->>'replayed')::boolean, false) THEN
                    v_touch := jsonb_build_object('status', 'replayed', 'activity', v_two->'activity');
                  ELSE
                    v_touch := jsonb_build_object('status', 'logged', 'activity', v_two->'activity');
                    v_c4 := v_c4 + 1;
                  END IF;
                  v_row := v_row || jsonb_build_object('record', v_two->'record');
                EXCEPTION
                  WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                    v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                    v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object(
                      'token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That touch could not be logged.')));
                    v_c5 := v_c5 + 1;
                  WHEN others THEN
                    RAISE WARNING 'team_agent_call: add_records item % stopped the request (% %)', v_idx, SQLSTATE, SQLERRM;
                    RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
                      USING ERRCODE = 'PT409';
                END;
              END IF;
            ELSE
              SELECT e INTO v_one FROM jsonb_array_elements(v_g->'skipped') AS e WHERE (e->>'index')::integer = v_idx;
              IF FOUND THEN
                v_c2 := v_c2 + 1;
                v_row := jsonb_build_object('index', v_idx, 'status', 'exists', 'existing', v_one->'existing',
                  'reason', CASE WHEN public.crm_name_key(regexp_replace(btrim(COALESCE(v_item->>'name', '')), '\s+', ' ', 'g'))
                                      = public.crm_name_key(COALESCE(v_one->'existing'->>'name', ''))
                                 THEN 'name' ELSE 'identifier' END);
                -- Every record this one matches is weighed: the strictest
                -- contact rule on any of them is the verdict.
                v_chk := NULL;
                BEGIN
                  v_chk := public.crm_contact_check(v_args->>'pipeline', jsonb_build_array(jsonb_strip_nulls(
                             jsonb_build_object('name', v_item->'name', 'identifiers', v_item->'identifiers'))))->'results'->0;
                EXCEPTION WHEN invalid_parameter_value THEN
                  v_chk := NULL;
                END;
                IF v_chk->>'verdict' IN ('exists', 'do_not_contact', 'warm_intro_only') THEN
                  v_row := v_row || jsonb_build_object('verdict', v_chk->'verdict', 'matches', v_chk->'matches');
                  IF v_row->>'reason' = 'identifier' THEN
                    v_row := v_row || jsonb_build_object('matched_on', (
                      SELECT m->'matched_on' FROM jsonb_array_elements(v_chk->'matches') AS m
                       WHERE m->'record'->>'id' = v_one->'existing'->>'id'));
                  END IF;
                END IF;
                IF v_item ? 'first_touch' AND jsonb_typeof(v_item->'first_touch') <> 'null' THEN
                  v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object('token', 'exists',
                    'message', 'This record was already there, so the touch was not logged. Use upsert_record or log_activity if it still applies.'));
                  v_c5 := v_c5 + 1;
                END IF;
              ELSE
                SELECT e INTO v_one FROM jsonb_array_elements(v_g->'invalid') AS e WHERE (e->>'index')::integer = v_idx;
                v_c3 := v_c3 + 1;
                v_m := regexp_match(COALESCE(v_one->>'error', ''), '^([a-z_]+): (.+)$');
                v_row := jsonb_build_object('index', v_idx, 'status', 'invalid', 'error', jsonb_build_object(
                  'token', COALESCE(v_m[1], 'invalid'), 'message', COALESCE(v_m[2], 'That record could not be added.')));
              END IF;
            END IF;
            IF v_touch IS NOT NULL THEN
              v_row := v_row || jsonb_build_object('touch', v_touch);
            END IF;
            v_rows := v_rows || jsonb_build_array(v_row);
          END LOOP;
          v_result := jsonb_build_object('results', v_rows,
            'counts', jsonb_build_object('created', v_c1, 'exists', v_c2, 'invalid', v_c3,
                                         'touches_logged', v_c4, 'touches_refused', v_c5),
            'replayed', v_replay);
          v_items := CASE WHEN v_replay THEN 0 ELSE v_c1 END + v_c4;
          v_sum := jsonb_build_object('created', CASE WHEN v_replay THEN 0 ELSE v_c1 END, 'exists', v_c2,
                                      'refused', v_c3 + v_c5, 'logged', v_c4, 'replayed', v_replay::integer);

        WHEN 'upsert_record' THEN
          -- Add it, or find it, and log this touch on it. A record that is
          -- already there is never changed by this tool.
          IF jsonb_typeof(v_args->'record') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_arguments: "record" is missing or the wrong kind. Send one record as an object with at least a name.' USING ERRCODE = '22023';
          END IF;
          v_g := public.crm_record_create(v_args->>'pipeline', v_args->'record', v_rk || '-c');
          v_replay := COALESCE((v_g->>'replayed')::boolean, false);
          IF v_g->>'status' = 'created' THEN
            v_id := (v_g->'record'->>'id')::uuid;
            v_result := jsonb_build_object('status', 'created', 'record', v_g->'record', 'moved_to', v_g->'moved_to');
            v_c1 := CASE WHEN v_replay THEN 0 ELSE 1 END;
          ELSE
            v_id := (v_g->'existing'->>'id')::uuid;
            v_result := jsonb_strip_nulls(jsonb_build_object('reason', v_g->'reason', 'matched_on', v_g->'matched_on'))
                        || jsonb_build_object('status', 'exists', 'record', public.crm_record_get(v_id)->'record');
            v_c2 := 1;
            -- Every record this one matches is weighed: the strictest contact
            -- rule on any of them is the verdict.
            BEGIN
              v_chk := public.crm_contact_check(v_args->>'pipeline', jsonb_build_array(jsonb_strip_nulls(
                         jsonb_build_object('name', v_args->'record'->'name', 'identifiers', v_args->'record'->'identifiers'))))->'results'->0;
            EXCEPTION WHEN invalid_parameter_value THEN
              v_chk := NULL;
            END;
            IF v_chk->>'verdict' IN ('exists', 'do_not_contact', 'warm_intro_only') THEN
              v_result := v_result || jsonb_build_object('verdict', v_chk->'verdict', 'matches', v_chk->'matches');
            END IF;
          END IF;
          IF v_args ? 'touch' AND jsonb_typeof(v_args->'touch') <> 'null' THEN
            BEGIN
              IF jsonb_typeof(v_args->'touch') <> 'object' THEN
                RAISE EXCEPTION 'invalid_entry: Send touch as one object with a channel, a direction and the message.' USING ERRCODE = '22023';
              END IF;
              -- A first message is not logged when any record this one
              -- matches carries a contact rule.
              IF v_chk->>'verdict' IN ('do_not_contact', 'warm_intro_only')
                 AND (v_args->'touch'->>'direction') IS DISTINCT FROM 'inbound' THEN
                RAISE EXCEPTION '%', format('%s: "%s" is marked %s: %s. Nothing was logged. %s',
                    v_chk->>'verdict', v_chk->'record'->>'name',
                    CASE v_chk->>'verdict' WHEN 'do_not_contact' THEN 'Do not contact' ELSE 'Warm intro only' END,
                    v_chk->'record'->>'contact_rule_reason',
                    CASE v_chk->>'verdict' WHEN 'do_not_contact' THEN 'Do not message them; tell your person.'
                                           ELSE 'Ask your person to make the introduction.' END)
                  USING ERRCODE = '42501';
              END IF;
              v_two := public.crm_record_log(v_id, (v_args->'touch') || jsonb_build_object('kind', 'touch'), v_rk || '-u');
              IF COALESCE((v_two->>'replayed')::boolean, false) THEN
                v_touch := jsonb_build_object('status', 'replayed', 'activity', v_two->'activity');
              ELSE
                v_touch := jsonb_build_object('status', 'logged', 'activity', v_two->'activity');
                v_c4 := 1;
              END IF;
              v_result := v_result || jsonb_build_object('record', v_two->'record');
            EXCEPTION
              WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                v_touch := jsonb_build_object('status', 'refused', 'error', jsonb_build_object(
                  'token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That touch could not be logged.')));
                v_c5 := 1;
            END;
            v_result := v_result || jsonb_build_object('touch', v_touch);
          END IF;
          v_result := v_result || jsonb_build_object('replayed', v_replay);
          v_items := v_c1 + v_c4;
          v_sum := jsonb_build_object('created', v_c1, 'exists', v_c2, 'logged', v_c4, 'refused', v_c5,
                                      'replayed', v_replay::integer);

        WHEN 'save_drafts' THEN
          v_result := public.team_draft_save(v_args->'drafts', v_rk);
          v_items := (SELECT count(*) FROM jsonb_array_elements(v_result->'results') e WHERE e->>'status' = 'saved');
          v_sum := jsonb_build_object('saved', v_items,
            'refused', jsonb_array_length(v_result->'results') - v_items);

        WHEN 'update_draft' THEN
          IF jsonb_typeof(v_args->'id') IS DISTINCT FROM 'string' OR (v_args->>'id') !~* c_uuid
             OR jsonb_typeof(v_args->'changes') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_arguments: Send a draft id and a changes object.' USING ERRCODE = '22023';
          END IF;
          v_result := public.team_draft_update((v_args->>'id')::uuid, v_args->'changes');
          v_items := CASE WHEN COALESCE((v_result->>'changed')::boolean, false) THEN 1 ELSE 0 END;
          v_sum := jsonb_build_object('updated', v_items);

        WHEN 'list_drafts' THEN
          v_result := public.team_draft_list(v_args);

        WHEN 'withdraw_drafts' THEN
          v_result := public.team_draft_discard(ARRAY(SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(v_args->'ids') e));
          v_items := (SELECT count(*) FROM jsonb_array_elements(v_result->'results') e WHERE e->>'status' = 'discarded');
          v_sum := jsonb_build_object('discarded', v_items);

        WHEN 'update_records', 'move_stage', 'set_owners', 'log_activity', 'record_reply' THEN
          v_rows := '[]'::jsonb;
          FOR v_idx IN 0 .. jsonb_array_length(v_list) - 1 LOOP
            v_item := v_list->v_idx;
            BEGIN
              IF jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string' OR (v_item->>'id') !~* c_uuid THEN
                RAISE EXCEPTION '%', format('invalid_id: "%s" is not a record id. Use an id returned by find_records.',
                  left(COALESCE(v_item->>'id', ''), 60)) USING ERRCODE = '22023';
              END IF;
              v_id := (v_item->>'id')::uuid;
              v_row := jsonb_build_object('index', v_idx, 'id', v_id);

              IF v_tool = 'update_records' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'changes')) THEN
                    RAISE EXCEPTION 'unknown_field: An update takes id and changes, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_update(v_id, v_item->'changes');
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'updated', 'record', v_one->'record', 'moved_to', v_one->'moved_to');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'unchanged', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'move_stage' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'to', 'expected_from', 'reason')) THEN
                    RAISE EXCEPTION 'unknown_field: A move takes id, to, expected_from and reason, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  IF jsonb_typeof(v_item->'expected_from') IS DISTINCT FROM 'string' OR btrim(v_item->>'expected_from') = '' THEN
                    RAISE EXCEPTION '%', format('invalid_arguments: "moves[%s].expected_from" is missing or the wrong kind. Send the stage you saw the card in.', v_idx)
                      USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_move_stage(v_id, v_item->>'to', v_item->>'reason', v_item->>'expected_from');
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'moved', 'record', v_one->'record', 'activity_id', v_one->'activity_id');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'already_there', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'set_owners' THEN
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k WHERE k NOT IN ('id', 'owner_emails'))
                     OR jsonb_typeof(v_item->'owner_emails') IS DISTINCT FROM 'array'
                     OR jsonb_array_length(v_item->'owner_emails') > 10
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'owner_emails') AS e WHERE jsonb_typeof(e) <> 'string') THEN
                    RAISE EXCEPTION 'invalid_owners: Send owner_emails as a list of at most 10 team email addresses. An empty list means unassigned.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_set_owners(v_id, ARRAY(SELECT jsonb_array_elements_text(v_item->'owner_emails')));
                  IF COALESCE((v_one->>'changed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'updated', 'record', v_one->'record');
                    v_c1 := v_c1 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'unchanged', 'record', v_one->'record');
                    v_c2 := v_c2 + 1;
                  END IF;

                ELSIF v_tool = 'log_activity' THEN
                  v_one := public.crm_record_log(v_id, v_item - 'id', v_rk || '-l' || v_idx);
                  IF COALESCE((v_one->>'replayed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'replayed', 'activity', v_one->'activity', 'record', v_one->'record');
                    v_c3 := v_c3 + 1;
                  ELSE
                    v_row := v_row || jsonb_build_object('status', 'logged', 'activity', v_one->'activity', 'record', v_one->'record');
                    v_c1 := v_c1 + 1;
                  END IF;

                ELSE
                  -- record_reply: the inbound touch, then the card moves to
                  -- Replied (or to the stage asked for) when that applies.
                  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k
                              WHERE k NOT IN ('id', 'channel', 'body', 'occurred_at', 'reply_class', 'message_ref', 'move_to', 'reason')) THEN
                    RAISE EXCEPTION 'unknown_field: A reply takes id, channel, body, occurred_at, reply_class, message_ref, move_to and reason, nothing else.' USING ERRCODE = '22023';
                  END IF;
                  IF jsonb_typeof(v_item->'body') IS DISTINCT FROM 'string' OR btrim(v_item->>'body') = '' THEN
                    RAISE EXCEPTION 'invalid_body: Record what they said, word for word.' USING ERRCODE = '22023';
                  END IF;
                  v_one := public.crm_record_log(v_id,
                    jsonb_strip_nulls(jsonb_build_object(
                      'kind', 'touch', 'direction', 'inbound', 'channel', v_item->'channel', 'body', v_item->'body',
                      'occurred_at', v_item->'occurred_at', 'reply_class', v_item->'reply_class',
                      'message_ref', v_item->'message_ref')),
                    v_rk || '-r' || v_idx);
                  v_moved := NULL;
                  v_note := NULL;
                  IF COALESCE((v_one->>'replayed')::boolean, false) THEN
                    v_row := v_row || jsonb_build_object('status', 'replayed', 'activity', v_one->'activity',
                                                         'record', v_one->'record', 'moved_to', NULL);
                    v_c3 := v_c3 + 1;
                  ELSE
                    v_pipe  := v_one->'record'->>'pipeline';
                    v_stage := v_one->'record'->>'stage';
                    v_to    := NULLIF(btrim(COALESCE(v_item->>'move_to', '')), '');
                    IF v_to IS NULL THEN
                      IF COALESCE((public.crm_stage_def(v_pipe, v_stage)->>'terminal')::boolean, false) THEN
                        v_note := format('This card is in %s, so it stayed there. Move it yourself if they are back.',
                                         public.crm_stage_def(v_pipe, v_stage)->>'label');
                      ELSIF (public.crm_stage_def(v_pipe, v_stage)->>'pos')::integer
                              < (public.crm_stage_def(v_pipe, 'replied')->>'pos')::integer THEN
                        v_to := 'replied';
                      ELSIF v_stage <> 'replied' THEN
                        v_note := format('Already in %s, so the card stayed where it is.',
                                         public.crm_stage_def(v_pipe, v_stage)->>'label');
                      END IF;
                    END IF;
                    v_two := NULL;
                    IF v_to IS NOT NULL THEN
                      BEGIN
                        v_two := public.crm_record_move_stage(v_id, v_to, v_item->>'reason', v_stage);
                        IF COALESCE((v_two->>'changed')::boolean, false) THEN
                          v_moved := v_to;
                          v_c2 := v_c2 + 1;
                        END IF;
                      EXCEPTION WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                        v_two := NULL;
                        v_note := SQLERRM;
                      END;
                    END IF;
                    v_row := v_row || jsonb_build_object('status', 'logged', 'activity', v_one->'activity',
                      'record', COALESCE(v_two->'record', v_one->'record'), 'moved_to', v_moved)
                      || jsonb_strip_nulls(jsonb_build_object('move_note', v_note));
                    v_c1 := v_c1 + 1;
                  END IF;
              END IF;
            EXCEPTION
              WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
                v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
                v_row := jsonb_build_object('index', v_idx, 'id', v_item->'id', 'status', 'error',
                  'error', jsonb_build_object('token', COALESCE(v_m[1], 'refused'),
                                              'message', COALESCE(v_m[2], 'That item was refused.')));
                v_c4 := v_c4 + 1;
              WHEN others THEN
                RAISE WARNING 'team_agent_call: % item % stopped the request (% %)', v_tool, v_idx, SQLSTATE, SQLERRM;
                RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
                  USING ERRCODE = 'PT409';
            END;
            v_rows := v_rows || jsonb_build_array(v_row);
          END LOOP;
          v_result := jsonb_build_object('results', v_rows, 'counts', CASE v_tool
            WHEN 'update_records' THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'error', v_c4)
            WHEN 'move_stage'     THEN jsonb_build_object('moved', v_c1, 'already_there', v_c2, 'error', v_c4)
            WHEN 'set_owners'     THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'error', v_c4)
            WHEN 'log_activity'   THEN jsonb_build_object('logged', v_c1, 'replayed', v_c3, 'error', v_c4)
            ELSE jsonb_build_object('logged', v_c1, 'moved', v_c2, 'replayed', v_c3, 'error', v_c4) END);
          v_items := v_c1;
          v_sum := CASE v_tool
            WHEN 'update_records' THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'move_stage'     THEN jsonb_build_object('moved', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'set_owners'     THEN jsonb_build_object('updated', v_c1, 'unchanged', v_c2, 'refused', v_c4)
            WHEN 'log_activity'   THEN jsonb_build_object('logged', v_c1, 'replayed', v_c3, 'refused', v_c4)
            ELSE jsonb_build_object('logged', v_c1, 'moved', v_c2, 'replayed', v_c3, 'refused', v_c4) END;

        ELSE
          RAISE EXCEPTION 'unknown_tool: That tool does not exist. Call tools/list to see what is available.' USING ERRCODE = '22023';
      END CASE;
    END IF;
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_items := 0;
    v_sum := '{}'::jsonb;
    v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
    IF v_m IS NOT NULL THEN
      v_token := v_m[1];
      v_words := v_m[2];
    ELSE
      v_token := 'server_error';
      v_words := 'Something went wrong on our side. Nothing was saved. Send the same request again.';
      RAISE WARNING 'team_agent_call: tool % ended with an unexpected error (% %)', v_tool, SQLSTATE, SQLERRM;
    END IF;
  END;

  -- Counts only: never a name, an argument or a result.
  UPDATE public.team_agent_calls
     SET outcome = CASE WHEN v_ok THEN 'ok' ELSE left(v_token, 60) END,
         items = v_items,
         summary = v_sum,
         duration_ms = LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer
   WHERE id = v_call;

  IF v_ok THEN
    -- "dates" is there for a tool that depends on a date: the date and the
    -- time zone that answer was worked out for.
    RETURN jsonb_strip_nulls(jsonb_build_object('dates', v_dates))
           || jsonb_build_object('ok', true, 'result', v_result, 'me', v_me);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('token', v_token, 'message', v_words), 'me', v_me);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.team_draft_save(p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v         record;
  v_replay  jsonb;
  v_item    jsonb;
  v_idx     integer := 0;
  v_rows    jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_rec     public.crm_records;
  v_draft   public.team_drafts;
  v_channel text;
  v_body    text;
  v_recipient text;
  v_thread  text;
  v_subject text;
  v_reason  text;
  v_flags   text[];
  v_reply   uuid;
  v_expiry  timestamptz;
  v_bad     text;
  v_m       text[];
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NULL OR v.via NOT IN ('claude','codex') THEN
    RAISE EXCEPTION 'agent_only: Only your connected agent can create a draft.' USING ERRCODE = '42501';
  END IF;
  v_replay := public.crm_request_begin(v.actor_email, p_request_key || '-d', 'team_draft_save');
  IF v_replay IS NOT NULL THEN RETURN v_replay || jsonb_build_object('replayed', true); END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_drafts: Send a list of 1 to 50 drafts.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) ORDER BY e.ord LOOP
    BEGIN
      IF jsonb_typeof(v_item) <> 'object' THEN
        RAISE EXCEPTION 'invalid_draft: Each draft must be an object.' USING ERRCODE = '22023';
      END IF;
      SELECT k INTO v_bad FROM jsonb_object_keys(v_item) k
       WHERE k NOT IN ('record_id','channel','recipient','thread_ref','in_reply_to','subject','body','reason','flags','expires_at') LIMIT 1;
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION '%', format('unknown_field: A draft does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_item->'record_id') IS DISTINCT FROM 'string'
         OR (v_item->>'record_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'invalid_id: record_id must be an id returned by find_records.' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_rec FROM public.crm_records c
       WHERE c.id = (v_item->>'record_id')::uuid AND c.deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
      END IF;
      IF v_rec.contact_rule = 'do_not_contact' THEN
        RAISE EXCEPTION '%', format('do_not_contact: "%s" is marked Do not contact: %s. Do not message them; tell your person.', v_rec.name, v_rec.contact_rule_reason)
          USING ERRCODE = '42501';
      ELSIF v_rec.contact_rule = 'warm_intro_only' THEN
        RAISE EXCEPTION '%', format('warm_intro_only: "%s" is marked Warm intro only: %s. Ask your person to make the introduction.', v_rec.name, v_rec.contact_rule_reason)
          USING ERRCODE = '42501';
      END IF;
      PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);
      PERFORM public.ops_recent_touch_assert(v_rec.id, v.actor_email, v.via);
      IF jsonb_typeof(v_item->'channel') IS DISTINCT FROM 'string'
         OR (v_item->>'channel') NOT IN ('email','whatsapp','instagram_dm','tiktok_dm','phone','in_person') THEN
        RAISE EXCEPTION 'invalid_channel: Use email, whatsapp, instagram_dm, tiktok_dm, phone or in_person.' USING ERRCODE = '22023';
      END IF;
      v_channel := v_item->>'channel';
      IF jsonb_typeof(v_item->'body') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid_body: A draft needs a message.' USING ERRCODE = '22023';
      END IF;
      v_body := normalize(btrim(v_item->>'body'), NFC);
      IF char_length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'invalid_body: A draft message must be 1 to 4,000 characters.' USING ERRCODE = '22023';
      END IF;

      IF v_item ? 'recipient' AND jsonb_typeof(v_item->'recipient') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid_recipient: recipient must be text or null.' USING ERRCODE = '22023';
      END IF;
      v_recipient := NULLIF(btrim(COALESCE(v_item->>'recipient','')), '');
      IF char_length(COALESCE(v_recipient,'')) > 200 THEN RAISE EXCEPTION 'invalid_recipient: Keep recipient to 200 characters.' USING ERRCODE = '22023'; END IF;
      IF v_item ? 'thread_ref' AND jsonb_typeof(v_item->'thread_ref') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid_thread_ref: thread_ref must be text or null.' USING ERRCODE = '22023';
      END IF;
      v_thread := NULLIF(btrim(COALESCE(v_item->>'thread_ref','')), '');
      IF char_length(COALESCE(v_thread,'')) > 500 THEN RAISE EXCEPTION 'invalid_thread_ref: Keep thread_ref to 500 characters.' USING ERRCODE = '22023'; END IF;
      IF v_item ? 'subject' AND jsonb_typeof(v_item->'subject') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid_subject: subject must be text or null.' USING ERRCODE = '22023';
      END IF;
      v_subject := NULLIF(btrim(COALESCE(v_item->>'subject','')), '');
      IF char_length(COALESCE(v_subject,'')) > 200 THEN RAISE EXCEPTION 'invalid_subject: Keep subject to 200 characters.' USING ERRCODE = '22023'; END IF;
      IF v_subject IS NOT NULL AND v_channel <> 'email' THEN RAISE EXCEPTION 'subject_not_email: Only an email draft has a subject.' USING ERRCODE = '22023'; END IF;
      IF v_item ? 'reason' AND jsonb_typeof(v_item->'reason') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid_reason: reason must be one line of text or null.' USING ERRCODE = '22023';
      END IF;
      v_reason := NULLIF(btrim(COALESCE(v_item->>'reason','')), '');
      IF v_reason ~ E'[\\r\\n]' OR char_length(COALESCE(v_reason,'')) > 200 THEN RAISE EXCEPTION 'invalid_reason: Keep reason to one line and 200 characters.' USING ERRCODE = '22023'; END IF;

      IF NOT (v_item ? 'flags') OR jsonb_typeof(v_item->'flags') = 'null' THEN
        v_flags := '{}'::text[];
      ELSIF jsonb_typeof(v_item->'flags') <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'flags') x WHERE jsonb_typeof(x) <> 'string') THEN
        RAISE EXCEPTION 'invalid_flags: flags must be a list.' USING ERRCODE = '22023';
      ELSE
        v_flags := ARRAY(SELECT x FROM jsonb_array_elements_text(v_item->'flags') x);
        IF cardinality(v_flags) > 5 OR EXISTS (SELECT 1 FROM unnest(v_flags) x WHERE x NOT IN ('money','giveaway','date_or_time','call','unverified'))
           OR cardinality(v_flags) <> cardinality(ARRAY(SELECT DISTINCT x FROM unnest(v_flags) x)) THEN
          RAISE EXCEPTION 'invalid_flags: Use each of money, giveaway, date_or_time, call and unverified at most once.' USING ERRCODE = '22023';
        END IF;
      END IF;

      v_reply := NULL;
      IF v_item ? 'in_reply_to' AND jsonb_typeof(v_item->'in_reply_to') <> 'null' THEN
        IF jsonb_typeof(v_item->'in_reply_to') <> 'string'
           OR (v_item->>'in_reply_to') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'invalid_reply: in_reply_to must be an inbound touch id from this record.' USING ERRCODE = '22023';
        END IF;
        v_reply := (v_item->>'in_reply_to')::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.crm_activity a WHERE a.id = v_reply AND a.record_id = v_rec.id AND a.kind = 'touch' AND a.direction = 'inbound') THEN
          RAISE EXCEPTION 'invalid_reply: in_reply_to must be an inbound touch id from this record.' USING ERRCODE = '22023';
        END IF;
      END IF;
      v_expiry := NULL;
      IF v_item ? 'expires_at' AND jsonb_typeof(v_item->'expires_at') <> 'null' THEN
        IF jsonb_typeof(v_item->'expires_at') <> 'string' THEN RAISE EXCEPTION 'invalid_expires_at: expires_at must be a date and time or null.' USING ERRCODE = '22023'; END IF;
        BEGIN v_expiry := (v_item->>'expires_at')::timestamptz;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
          RAISE EXCEPTION 'invalid_expires_at: expires_at must be a real date and time.' USING ERRCODE = '22023';
        END;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_draft_cap:' || v.actor_email || ':' || v_rec.id::text, 0));
      IF (SELECT count(*) FROM public.team_drafts d WHERE d.owner_email = v.actor_email AND d.record_id = v_rec.id AND d.state = 'waiting') >= 3 THEN
        RAISE EXCEPTION 'too_many_drafts: This record already has 3 drafts waiting. Withdraw one first.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.team_drafts (
        owner_email, record_id, channel, recipient, thread_ref, in_reply_to, subject,
        body, original_body, reason, flags, expires_at, created_via, request_key)
      VALUES (
        v.actor_email, v_rec.id, v_channel, v_recipient, v_thread, v_reply, v_subject,
        v_body, v_body, v_reason, v_flags, v_expiry, v.via, p_request_key || '-i' || v_idx)
      RETURNING * INTO v_draft;
      PERFORM public.crm_audit(v.actor_email, 'draft.create', 'team_draft', v_draft.id::text,
        jsonb_build_object('record_id', v_draft.record_id, 'channel', v_draft.channel, 'state', v_draft.state, 'via', v.via));
      v_row := jsonb_build_object('index', v_idx, 'status', 'saved',
        'draft', to_jsonb(v_draft) - ARRAY['owner_email','request_key']::text[]);
    EXCEPTION
      WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN
        v_m := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
        IF v_m[1] IN ('claimed','recently_messaged','draft_waiting') THEN PERFORM public.ops_log_write(v.actor_email, v.via, 'draft_stopped', 'stopped', NULL, 'crm_record', v_rec.id, left(v_m[2], 300), '{}'::jsonb); END IF;
        v_row := jsonb_build_object('index', v_idx, 'status', 'error',
          'error', jsonb_build_object('token', COALESCE(v_m[1], 'refused'), 'message', COALESCE(v_m[2], 'That draft was refused.')));
      WHEN unique_violation THEN
        RAISE EXCEPTION 'request_key_reused: That request key was already used for different draft items. Send a new request key.' USING ERRCODE = '22023';
      WHEN others THEN
        RAISE WARNING 'team_draft_save: item % stopped the request (% %)', v_idx, SQLSTATE, SQLERRM;
        RAISE EXCEPTION '%', format('try_again: Something went wrong on our side at item %s, so nothing in this request was saved. Send the same request again.', v_idx + 1)
          USING ERRCODE = 'PT409';
    END;
    v_rows := v_rows || jsonb_build_array(v_row);
    v_idx := v_idx + 1;
  END LOOP;
  v_replay := jsonb_build_object('results', v_rows, 'replayed', false);
  PERFORM public.crm_request_finish(v.actor_email, p_request_key || '-d', 'team_draft_save', v_replay);
  RETURN v_replay;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.team_draft_unsend(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; d public.team_drafts; a public.crm_activity; undo_ jsonb; stage_ok boolean:=true; stage_words text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN RAISE EXCEPTION 'people_send: Only a person can Undo the Mingla record.' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.team_drafts x WHERE x.id=p_id AND x.owner_email=v.actor_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That draft is not here.' USING ERRCODE='P0002'; END IF;
  IF d.state<>'sent' OR d.sent_at<=statement_timestamp()-interval '60 seconds' THEN RAISE EXCEPTION 'undo_expired: The Mingla record can no longer be undone.' USING ERRCODE='22023'; END IF;
  IF d.sent_move_activity_id IS NOT NULL THEN
    BEGIN undo_:=public.crm_record_undo_stage_move(d.sent_move_activity_id);
    EXCEPTION WHEN invalid_parameter_value OR no_data_found OR insufficient_privilege THEN stage_ok:=false; stage_words:=regexp_replace(SQLERRM,'^[a-z_]+: ',''); END;
  END IF;
  SELECT * INTO a FROM public.crm_activity x WHERE x.id=d.sent_activity_id FOR UPDATE;
  IF NOT FOUND OR a.record_id<>d.record_id OR a.kind<>'touch' OR a.direction<>'outbound' OR a.actor_email IS DISTINCT FROM v.actor_email OR a.via IS NOT NULL THEN
    RAISE EXCEPTION 'try_again: The recorded touch changed, so nothing was undone. Refresh and try again.' USING ERRCODE='PT409';
  END IF;
  DELETE FROM public.crm_activity x WHERE x.id=a.id;
  UPDATE public.team_drafts SET state='waiting',sent_at=NULL,sent_activity_id=NULL,sent_move_activity_id=NULL,updated_at=clock_timestamp()
   WHERE id=d.id RETURNING * INTO d;
  PERFORM public.crm_audit(v.actor_email,'draft.unsend','team_draft',d.id::text,jsonb_build_object('record_id',d.record_id,'channel',d.channel,'state',d.state,'via',NULL,'stage_undone',stage_ok));
  RETURN jsonb_strip_nulls(jsonb_build_object('draft',to_jsonb(d)-ARRAY['owner_email','request_key']::text[],'changed',true,'stage_undone',stage_ok,'stage_note',stage_words));
END;
$function$
;

-- C. Verify before COMMIT. No EXECUTE: every check is a plain catalogue read.
DO $issue_4134_verify$
DECLARE
  c_raise_errcode constant text :=
    'errcode\s*:?=\s*''(40001|serialization_failure)''';
  c_raise_sqlstate constant text :=
    'raise\s+(exception\s+)?sqlstate\s+''40001''';
  c_raise_condition constant text :=
    'raise\s+(exception\s+)?serialization_failure\M';
  c_handler constant text :=
    '(when|or)\s+(serialization_failure|sqlstate\s+''40001'')(?!\s+or\s+sqlstate\s+''PT409'')';
  v_bad text;
BEGIN
  -- Same functions, same oids, same owner, grants, security, settings and
  -- comment: only the bodies changed.
  SELECT string_agg(b.signature, ', ' ORDER BY b.signature) INTO v_bad
    FROM issue_4134_before AS b
    LEFT JOIN pg_proc AS p ON p.oid = b.oid
   WHERE b.oid IS NULL
      OR p.oid IS NULL
      OR p.proowner IS DISTINCT FROM b.proowner
      OR p.proacl::text IS DISTINCT FROM b.acl
      OR p.prosecdef IS DISTINCT FROM b.prosecdef
      OR p.proconfig IS DISTINCT FROM b.proconfig
      OR p.provolatile IS DISTINCT FROM b.provolatile
      OR p.proleakproof IS DISTINCT FROM b.proleakproof
      OR p.proisstrict IS DISTINCT FROM b.proisstrict
      OR p.prorettype IS DISTINCT FROM b.prorettype
      OR p.proargtypes::text IS DISTINCT FROM b.argtypes
      OR obj_description(p.oid, 'pg_proc') IS DISTINCT FROM b.comment;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4134_verify: rewriting changed more than the body of: %', v_bad;
  END IF;

  -- Each function was the definition this file was generated from (or is
  -- already the new one, on a second run). Anything else means the database
  -- moved on, and this file would overwrite that change.
  SELECT string_agg(b.signature, ', ' ORDER BY b.signature) INTO v_bad
    FROM issue_4134_before AS b
    JOIN issue_4134_target AS t ON t.signature = b.signature
   WHERE b.md5_before IS DISTINCT FROM t.pre_md5
     AND b.md5_before IS DISTINCT FROM t.post_md5;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4134_verify: not the definition this migration was generated from: %', v_bad;
  END IF;

  -- Each function now reads exactly as generated.
  SELECT string_agg(t.signature, ', ' ORDER BY t.signature) INTO v_bad
    FROM issue_4134_target AS t
   WHERE md5(pg_get_functiondef(to_regprocedure(t.signature))) IS DISTINCT FROM t.post_md5;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4134_verify: did not end as generated: %', v_bad;
  END IF;

  -- No function anywhere outside the system schemas still raises 40001, and
  -- every handler that catches it also catches PT409.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_bad
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND (p.prosrc ~* c_raise_errcode
          OR p.prosrc ~* c_raise_sqlstate
          OR p.prosrc ~* c_raise_condition
          OR p.prosrc ~* c_handler);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4134_verify: still raising or only catching SQLSTATE 40001: %', v_bad;
  END IF;

  RAISE NOTICE 'issue_4134: % functions raise PT409 for application conflicts',
    (SELECT count(*) FROM issue_4134_target);
END
$issue_4134_verify$;

COMMIT;
