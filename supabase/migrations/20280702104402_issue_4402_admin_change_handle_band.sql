-- #4402 — Admin can correct the audience band on an approved handle.
--
-- Plain English: Seth's live pass (12 Nov 2026): "Once you choose what you
-- saw no way to change if you made a mistake." An admin can now change the
-- band on an approved handle, with a short reason. The handle stays verified,
-- the band stays the admin's (follower_source='admin'), and History records
-- the old and the new band.
--
-- 20280702004402 is applied in production, so this is its own migration.
-- Invariant (declared in
-- supabase/migrations/__tests__/issue_4402_admin_change_handle_band.implementor.pg17.test.sql):
--   I-4402-BAND-CHANGE-IS-ADMIN-AND-AUDITED.
--
-- Static SQL only.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. History carries a band change with the band it replaced.
ALTER TABLE public.creator_review_events
  ADD COLUMN IF NOT EXISTS previous_follower_band text;
ALTER TABLE public.creator_review_events
  DROP CONSTRAINT creator_review_events_action_check,
  ADD CONSTRAINT creator_review_events_action_check
    CHECK (action IN ('verify','ask_more','decline','suspend','handle_approve','handle_reject','handle_reopen','handle_band_change')),
  DROP CONSTRAINT creator_review_events_handle_shape,
  ADD CONSTRAINT creator_review_events_handle_shape
    CHECK ((action IN ('handle_approve','handle_reject','handle_reopen','handle_band_change')) = (handle_id IS NOT NULL AND platform IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS creator_review_events_previous_follower_band_check,
  ADD CONSTRAINT creator_review_events_previous_follower_band_check
    CHECK (previous_follower_band IS NULL OR previous_follower_band IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m')),
  DROP CONSTRAINT IF EXISTS creator_review_events_band_change_shape,
  ADD CONSTRAINT creator_review_events_band_change_shape
    CHECK (action<>'handle_band_change' OR (follower_band IS NOT NULL AND note IS NOT NULL));

-- 2. Change the band on an approved handle. Admin only; a reason is required;
--    the handle is never un-verified; nothing else on it changes.
CREATE OR REPLACE FUNCTION public.admin_creator_handle_band_change(
  p_handle_id uuid,p_band text,p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_row public.creator_handles; v_old text; v_band text:=nullif(btrim(coalesce(p_band,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),'');
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.creator_handles WHERE id=p_handle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','handle_not_found'); END IF;
  IF v_row.verified_at IS NULL OR v_row.review_required OR v_row.last_check_status IS DISTINCT FROM 'verified' THEN
    RETURN jsonb_build_object('ok',false,'error','handle_not_approved');
  END IF;
  IF v_band IS NULL THEN RETURN jsonb_build_object('ok',false,'error','band_required','field','band'); END IF;
  IF v_band NOT IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_band','field','band');
  END IF;
  IF v_note IS NULL THEN RETURN jsonb_build_object('ok',false,'error','note_required','field','note'); END IF;
  IF char_length(v_note)>500 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  v_old:=v_row.follower_band;
  IF v_old IS NOT DISTINCT FROM v_band AND v_row.follower_source='admin' THEN
    RETURN jsonb_build_object('ok',false,'error','band_unchanged','field','band');
  END IF;
  UPDATE public.creator_handles SET follower_band=v_band,follower_source='admin'
   WHERE id=p_handle_id RETURNING * INTO v_row;
  INSERT INTO public.creator_review_events(creator_account_id,action,note,actor,handle_id,platform,follower_band,previous_follower_band)
  VALUES(v_row.creator_account_id,'handle_band_change',v_note,auth.uid(),v_row.id,v_row.platform,v_band,
         CASE WHEN v_old IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m') THEN v_old END);
  RETURN jsonb_build_object('ok',true,
    'handle',jsonb_build_object('id',v_row.id,'platform',v_row.platform,'handle',v_row.handle,
      'verified_at',v_row.verified_at,'last_check_status',v_row.last_check_status,
      'follower_band',v_row.follower_band,'follower_source',v_row.follower_source),
    'previous_follower_band',v_old);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_creator_handle_band_change(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_creator_handle_band_change(uuid,text,text) TO authenticated,service_role;

-- 3. The Admin record: the 20280702004402 body, plus each history row's
--    previous band (for "band 1k–10k → Under 1k").
CREATE OR REPLACE FUNCTION public.admin_creator_detail(p_creator_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_p public.creator_profiles; v_missing jsonb; v_city jsonb; v_payee public.payee_accounts;
  v_local public.locals; v_app public.local_applications; v_email text; v_person public.profiles;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_p FROM public.creator_profiles WHERE creator_account_id=p_creator_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','creator_not_found'); END IF;
  v_missing:=public.issue_4402_creator_verify_blockers(p_creator_id);
  v_city:=public.issue_3872_creator_home_city_json(p_creator_id);
  SELECT * INTO v_payee FROM public.payee_accounts WHERE user_id=p_creator_id;
  SELECT * INTO v_local FROM public.locals WHERE user_id=p_creator_id;
  SELECT * INTO v_app FROM public.local_applications WHERE user_id=p_creator_id ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_person FROM public.profiles WHERE id=p_creator_id;
  SELECT email INTO v_email FROM auth.users WHERE id=p_creator_id;
  RETURN jsonb_build_object(
    'ok',true,
    'creator_id',v_p.creator_account_id,
    'display_name',v_p.display_name,
    'account_name',coalesce(nullif(btrim(v_person.display_name),''),nullif(btrim(v_person.username),''),nullif(btrim(concat_ws(' ',v_person.first_name,v_person.last_name)),'')),
    'verification',v_p.verification,'review_note',v_p.review_note,'declined_reason',v_p.declined_reason,
    'reviewed_at',v_p.reviewed_at,'created_at',v_p.created_at,'updated_at',v_p.updated_at,
    'person',jsonb_build_object(
      'email_masked',CASE WHEN v_email ~ '^[^@]+@.+$' THEN left(v_email,1)||'***@'||split_part(v_email,'@',2) END,
      'country_code',v_person.country,'created_at',v_person.created_at),
    'about',jsonb_build_object(
      'bio',v_p.bio,'niches',to_jsonb(v_p.niches),'languages',to_jsonb(v_p.languages),
      'home_city',CASE WHEN v_city IS NULL THEN NULL ELSE v_city||jsonb_build_object('country_code',
        (SELECT c.country_code FROM public.seeding_cities c WHERE c.id=v_p.home_city_id)) END,
      'date_of_birth_present',v_p.date_of_birth IS NOT NULL,
      'age_18_plus',coalesce(v_p.date_of_birth<=(current_date-interval '18 years')::date,false)),
    'checks',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',c->>'key','done',coalesce((c->>'done')::boolean,false)) ORDER BY ord),'[]'::jsonb)
              FROM jsonb_array_elements(public.issue_3872_creator_checks(p_creator_id)) WITH ORDINALITY t(c,ord)),
    'missing',(SELECT coalesce(jsonb_agg(m),'[]'::jsonb) FROM jsonb_array_elements_text(v_missing) m WHERE m<>'handle_review'),
    'needs_person',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','handle_review','platform',h.platform) ORDER BY h.platform),'[]'::jsonb)
                    FROM public.creator_handles h WHERE h.creator_account_id=p_creator_id AND h.review_required),
    'can_verify',jsonb_array_length(v_missing)=0,
    'showcase',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'job_id',m.id,'status',m.status,'duration_s',m.duration_s,'width',m.width,'height',m.height,
        'aspect_warning',m.aspect_warning,'failure_code',m.failure_code,'ready_at',m.ready_at,'created_at',m.created_at
      ) ORDER BY m.created_at DESC),'[]'::jsonb)
      FROM (SELECT * FROM public.creator_media_jobs
             WHERE owner_kind='creator' AND owner_id=p_creator_id AND purpose='showcase' AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 6) m),
    'handles',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',h.id,'platform',h.platform,'handle',h.handle,'verify_code',h.verify_code,
        'follower_band',h.follower_band,'follower_source',h.follower_source,'self_reported_band',h.self_reported_band,
        'verified_at',h.verified_at,'last_checked_at',h.last_checked_at,'last_check_status',h.last_check_status,
        'review_required',h.review_required,'review_reason',h.review_reason,'rejected_note',h.rejected_note,
        'verify_expires_at',h.verify_expires_at
      ) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=p_creator_id),
    'packages',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',k.id,'format_key',k.format_key,'format_label',f.name,'platforms',to_jsonb(k.platforms),
        'price_minor',k.price_minor,'currency',k.currency,'turnaround_days',k.turnaround_days,
        'includes_usage_days',k.includes_usage_days,'extra_usage_price_minor',k.extra_usage_price_minor,
        'active',k.active,'updated_at',k.updated_at
      ) ORDER BY k.active DESC,k.updated_at DESC),'[]'::jsonb)
      FROM public.creator_packages k LEFT JOIN public.gig_formats f ON f.key=k.format_key
      WHERE k.creator_account_id=p_creator_id),
    'payout',CASE
      WHEN v_payee.user_id IS NULL THEN jsonb_build_object('provider',NULL,'status','none')
      WHEN v_payee.paystack_status='verified' THEN jsonb_build_object('provider','paystack','status','verified')
      WHEN v_payee.stripe_status='active' THEN jsonb_build_object('provider','stripe','status','active')
      WHEN v_payee.stripe_status<>'none' THEN jsonb_build_object('provider','stripe','status',v_payee.stripe_status)
      WHEN v_payee.paystack_status<>'none' THEN jsonb_build_object('provider','paystack','status',v_payee.paystack_status)
      ELSE jsonb_build_object('provider',NULL,'status','none') END,
    'agreement',jsonb_build_object('signed',public.issue_4216_creator_has_current_agreement(p_creator_id),
      'version',v_p.agreement_version,'signed_at',v_p.agreement_signed_at),
    'local',jsonb_build_object(
      'status',CASE WHEN v_local.id IS NOT NULL THEN v_local.status
                    WHEN v_app.id IS NULL THEN 'none'
                    WHEN v_app.status='agreement_pending' THEN 'invited'
                    ELSE 'applied' END,
      'application_status',v_app.status,
      'city_name',(SELECT c.name FROM public.seeding_cities c WHERE c.id=coalesce(v_local.city_id,v_app.city_id)),
      'seat_started_on',v_local.seat_started_on,
      'application_handles',CASE WHEN v_app.id IS NULL THEN '{}'::jsonb ELSE v_app.handles END),
    'gigs',(SELECT jsonb_build_object('contracts_total',count(*),
        'contracts_active',count(*) FILTER (WHERE g.state NOT IN ('completed','declined','expired','cancelled','resolved_release','resolved_partial','resolved_refund')))
      FROM public.gig_contracts g WHERE g.creator_account_id=p_creator_id),
    'history',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'at',e.at,'action',e.action,'note',e.note,'platform',e.platform,'handle_id',e.handle_id,'follower_band',e.follower_band,'previous_follower_band',e.previous_follower_band,
        'actor_name',coalesce(nullif(btrim(a.display_name),''),nullif(btrim(a.username),''),nullif(btrim(concat_ws(' ',a.first_name,a.last_name)),''))
      ) ORDER BY e.at,e.id),'[]'::jsonb)
      FROM public.creator_review_events e LEFT JOIN public.profiles a ON a.id=e.actor
      WHERE e.creator_account_id=p_creator_id)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_creator_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_creator_detail(uuid) TO authenticated,service_role;

COMMIT;
