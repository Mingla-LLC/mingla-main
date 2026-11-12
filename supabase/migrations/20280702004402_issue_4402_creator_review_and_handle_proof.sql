-- #4402 — Creator review in Admin and honest social-handle proof.
--
-- Plain English: a person at Mingla verifies everything. Every social handle a
-- creator adds goes to Admin review; the server's bio-code check only records
-- what it saw, as evidence. Only an admin's "Approve handle" verifies a handle,
-- and it records the audience band the admin saw (Hosts see only that band).
-- A rejected handle stays rejected until an admin reopens it. A creator is
-- verified only by the admin's Verify, which the server refuses until all six
-- setup steps pass. Nothing turns a creator verified automatically any more:
-- a recompute can say "ready for review", never "verified".
--
-- Invariants (declared in
-- supabase/migrations/__tests__/issue_4402_creator_review.implementor.pg17.test.sql):
--   I-4402-CREATOR-VERIFY-NEEDS-SIX-STEPS: admin_creator_decide('verify')
--     writes nothing unless all six setup checks pass and no handle is under
--     review; it never approves a flagged handle as a side effect.
--   I-4402-HANDLE-DECISION-IS-AUDITED: a handle is approved, rejected or
--     reopened only by admin_creator_handle_decide, which writes a
--     creator_review_events row.
--   I-4402-CHECK-NEVER-UNDOES-ADMIN: the bio-code check writes only through
--     issue_4402_record_handle_check, which skips the write once an admin
--     decided or the code changed.
--   I-4402-ONLY-ADMIN-VERIFIES: no recompute, handle check or setup write sets
--     a creator or a handle verified; only admin_creator_decide('verify') and
--     admin_creator_handle_decide('approve') do.
--
-- Seth's answers (12 Nov 2026): X is no longer a handle platform; an active
-- rate is one of the six steps; a rejected creator sees fixed wording plus
-- the reviewer's short note; verification is by an admin, not automated.
--
-- Static SQL only. The tail moves existing handles onto the admin-review rule
-- and recomputes every creator (production had 0 verified creators and 1
-- unchecked handle on 12 Nov 2026).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. What the last bio-code check saw (evidence for the admin, never a
--    verdict), the rejection note, and the creator's own band (kept beside
--    the band an admin records). No platform-derived audience is stored.
ALTER TABLE public.creator_handles
  ADD COLUMN IF NOT EXISTS last_check_status text,
  ADD COLUMN IF NOT EXISTS rejected_note text,
  ADD COLUMN IF NOT EXISTS self_reported_band text;

ALTER TABLE public.creator_handles
  DROP CONSTRAINT IF EXISTS creator_handles_last_check_status_check,
  ADD CONSTRAINT creator_handles_last_check_status_check
    CHECK (last_check_status IS NULL OR last_check_status IN ('code_seen','code_not_seen','unreadable','expired','verified','rejected')),
  DROP CONSTRAINT IF EXISTS creator_handles_rejected_note_check,
  ADD CONSTRAINT creator_handles_rejected_note_check
    CHECK (rejected_note IS NULL OR char_length(rejected_note) BETWEEN 1 AND 500),
  DROP CONSTRAINT IF EXISTS creator_handles_self_reported_band_check,
  ADD CONSTRAINT creator_handles_self_reported_band_check
    CHECK (self_reported_band IS NULL OR self_reported_band IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m')),
  -- 'admin' = the band a Mingla admin recorded when approving the handle.
  -- 'provider' stays legal for old rows only; nothing writes it any more.
  DROP CONSTRAINT creator_handles_follower_source_check,
  ADD CONSTRAINT creator_handles_follower_source_check
    CHECK (follower_source IN ('self_reported','provider','admin'));
-- creator_handles_review_shape stays exactly as it is: a review reason only on
-- a handle flagged for a person.

UPDATE public.creator_handles
   SET self_reported_band=follower_band
 WHERE self_reported_band IS NULL AND follower_source='self_reported' AND follower_band IS NOT NULL;

-- 2. Review history carries handle decisions too. No FK on handle_id: the
--    audit outlives the handle.
ALTER TABLE public.creator_review_events
  ADD COLUMN IF NOT EXISTS handle_id uuid,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS follower_band text;
ALTER TABLE public.creator_review_events
  DROP CONSTRAINT creator_review_events_action_check,
  ADD CONSTRAINT creator_review_events_action_check
    CHECK (action IN ('verify','ask_more','decline','suspend','handle_approve','handle_reject','handle_reopen')),
  DROP CONSTRAINT IF EXISTS creator_review_events_follower_band_check,
  ADD CONSTRAINT creator_review_events_follower_band_check
    CHECK (follower_band IS NULL OR follower_band IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m')),
  DROP CONSTRAINT IF EXISTS creator_review_events_handle_shape,
  ADD CONSTRAINT creator_review_events_handle_shape
    CHECK ((action IN ('handle_approve','handle_reject','handle_reopen')) = (handle_id IS NOT NULL AND platform IS NOT NULL));

-- 3. Recompute: the 4216 body (20280221004216) plus the rates step, and it
--    never makes anyone verified (Seth, 12 Nov 2026: an admin verifies). All
--    six steps done, or a handle waiting for a person, means 'review' (ready
--    for an admin). A creator an admin already verified stays verified while
--    all six steps still pass, and drops out as soon as one fails.
CREATE OR REPLACE FUNCTION public.issue_3872_recompute_creator_verification(
  p_creator_account_id uuid,p_signal_conflict boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_profile public.creator_profiles; v_reasons text[]:='{}';
  v_has_handle boolean; v_age_ok boolean; v_payee_ok boolean;
  v_showcase_ok boolean; v_agreement_ok boolean; v_package_ok boolean; v_next text;
BEGIN
  SELECT * INTO v_profile FROM public.creator_profiles
   WHERE creator_account_id=p_creator_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found' USING ERRCODE='P0002'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=p_creator_account_id AND verified_at IS NOT NULL AND NOT review_required) INTO v_has_handle;
  v_age_ok:=v_profile.date_of_birth IS NOT NULL AND v_profile.date_of_birth<=(current_date-interval '18 years')::date;
  SELECT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=p_creator_account_id AND (stripe_status='active' OR paystack_status='verified')) INTO v_payee_ok;
  SELECT EXISTS(SELECT 1 FROM public.creator_media_jobs WHERE owner_kind='creator' AND owner_id=p_creator_account_id AND purpose='showcase' AND status='ready' AND deleted_at IS NULL) INTO v_showcase_ok;
  v_agreement_ok:=public.issue_4216_creator_has_current_agreement(p_creator_account_id);
  SELECT EXISTS(SELECT 1 FROM public.creator_packages WHERE creator_account_id=p_creator_account_id AND active) INTO v_package_ok;
  IF NOT v_has_handle THEN v_reasons:=array_append(v_reasons,'verified_handle'); END IF;
  IF NOT v_age_ok THEN v_reasons:=array_append(v_reasons,'age_18_plus'); END IF;
  IF NOT v_payee_ok THEN v_reasons:=array_append(v_reasons,'active_payout'); END IF;
  IF NOT v_showcase_ok THEN v_reasons:=array_append(v_reasons,'processed_showcase'); END IF;
  IF NOT v_agreement_ok THEN v_reasons:=array_append(v_reasons,'signed_agreement'); END IF;
  IF NOT v_package_ok THEN v_reasons:=array_append(v_reasons,'active_package'); END IF;
  v_next:=CASE
    WHEN v_profile.verification IN ('declined','suspended') THEN v_profile.verification
    WHEN v_profile.verification='verified' AND cardinality(v_reasons)=0 AND NOT p_signal_conflict THEN 'verified'
    WHEN p_signal_conflict OR EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=p_creator_account_id AND review_required) THEN 'review'
    WHEN v_profile.verification='needs_more' THEN CASE WHEN cardinality(v_reasons)=0 THEN 'review' ELSE 'needs_more' END
    WHEN v_profile.verification='review' AND v_profile.reviewed_at IS NOT NULL THEN 'review'
    WHEN cardinality(v_reasons)=0 THEN 'review'
    ELSE 'incomplete' END;
  UPDATE public.creator_profiles SET verification=v_next,verification_reasons=v_reasons
   WHERE creator_account_id=p_creator_account_id RETURNING * INTO v_profile;
  RETURN jsonb_build_object('verification',v_profile.verification,'missing',v_profile.verification_reasons);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_recompute_creator_verification(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_recompute_creator_verification(uuid,boolean) TO service_role;

-- 4. Handle upsert: the r3 body (20271225003872), plus: X is no longer a
--    handle platform; every added handle goes straight to Admin review
--    ('awaiting_admin'); a new code clears the last check's evidence; a
--    rejected handle cannot be re-added or given a new code until an admin
--    reopens it; the creator's own band is kept beside the admin's band.
CREATE OR REPLACE FUNCTION public.creator_handle_upsert(
  p_platform text,p_handle text,p_follower_band text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_handle text; v_platform text:=lower(btrim(coalesce(p_platform,''))); v_row public.creator_handles;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_id) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002';
  END IF;
  IF v_platform NOT IN ('instagram','tiktok','youtube','snapchat') THEN
    RAISE EXCEPTION 'platform_unsupported' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=v_id AND platform=v_platform AND last_check_status='rejected') THEN
    RAISE EXCEPTION 'handle_rejected' USING ERRCODE='22023';
  END IF;
  v_handle:=lower(regexp_replace(btrim(p_handle),'^@','','g'));
  INSERT INTO public.creator_handles(creator_account_id,platform,handle,follower_band,self_reported_band,verify_code,review_required,review_reason)
  VALUES(v_id,v_platform,v_handle,p_follower_band,p_follower_band,'MINGLA-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)),true,'awaiting_admin')
  ON CONFLICT(creator_account_id,platform) DO UPDATE SET
    handle=excluded.handle,follower_band=excluded.follower_band,follower_source='self_reported',
    self_reported_band=excluded.self_reported_band,
    verify_code=excluded.verify_code,verify_started_at=now(),verify_expires_at=now()+interval '72 hours',
    verified_at=NULL,last_checked_at=NULL,review_required=true,review_reason='awaiting_admin',
    last_check_status=NULL,rejected_note=NULL
  RETURNING * INTO v_row;
  PERFORM public.issue_3872_recompute_creator_verification(v_id,false);
  RETURN jsonb_build_object('id',v_row.id,'platform',v_row.platform,'handle',v_row.handle,
    'verify_code',v_row.verify_code,'expires_at',v_row.verify_expires_at);
EXCEPTION WHEN unique_violation THEN
  PERFORM public.issue_3872_recompute_creator_verification(v_id,true);
  RAISE EXCEPTION 'handle_already_claimed' USING ERRCODE='23505';
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_handle_upsert(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_handle_upsert(text,text,text) TO authenticated,service_role;

-- 5. Rates: the 4402 body (20280630004402), plus a recompute, because an
--    active rate is now one of the six steps. Adding the last missing rate can
--    only make a creator ready for review; switching off the only rate takes
--    a verified creator out of view.
CREATE OR REPLACE FUNCTION public.creator_package_upsert(
  p_format_key text,p_platforms text[],p_price_minor bigint,p_currency text,
  p_turnaround_days integer,p_includes_usage_days integer DEFAULT 90,
  p_extra_usage_price_minor bigint DEFAULT NULL,p_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_row public.creator_packages;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_id) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.creator_packages(creator_account_id,format_key,platforms,price_minor,currency,turnaround_days,includes_usage_days,extra_usage_price_minor,active)
  VALUES(v_id,p_format_key,p_platforms,p_price_minor,upper(p_currency),p_turnaround_days,p_includes_usage_days,p_extra_usage_price_minor,p_active)
  ON CONFLICT(creator_account_id,format_key) DO UPDATE SET platforms=excluded.platforms,
    price_minor=excluded.price_minor,currency=excluded.currency,turnaround_days=excluded.turnaround_days,
    includes_usage_days=excluded.includes_usage_days,extra_usage_price_minor=excluded.extra_usage_price_minor,active=excluded.active
  RETURNING * INTO v_row;
  PERFORM public.issue_3872_recompute_creator_verification(v_id,false);
  RETURN to_jsonb(v_row)-'creator_account_id';
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean) TO authenticated,service_role;

-- 6. Setup status: the round-2 body (20280102003872), plus each handle's
--    server outcome (so the screen survives a reload), the Local application
--    handles to prefill, and one rates key ('package') with no duplicate.
CREATE OR REPLACE FUNCTION public.issue_4402_suggested_handles(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce((
    SELECT jsonb_object_agg(s.platform,s.handle)
    FROM (
      SELECT k.platform,lower(regexp_replace(btrim(a.handles->>k.platform),'^@+','')) AS handle
      FROM (
        SELECT handles FROM public.local_applications
        WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 1
      ) a
      CROSS JOIN (VALUES ('instagram'),('tiktok')) k(platform)
      WHERE jsonb_typeof(a.handles->k.platform)='string'
    ) s
    WHERE s.handle ~ '^[a-z0-9._-]{1,80}$'
      AND NOT EXISTS(SELECT 1 FROM public.creator_handles h WHERE h.creator_account_id=p_user_id AND h.platform=s.platform)
  ),'{}'::jsonb);
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_suggested_handles(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_suggested_handles(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.creator_setup_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_profile public.creator_profiles;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=v_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('profile',false,'mode_enabled',false,'verification','incomplete','review_note',NULL,'declined_reason',NULL,
      'checks',public.issue_3872_creator_checks(v_id),'home_city',NULL,
      'suggested_handles',public.issue_4402_suggested_handles(v_id),
      'missing',jsonb_build_array('profile','verified_handle','package','processed_showcase','active_payout','signed_agreement'));
  END IF;
  RETURN jsonb_build_object(
    'profile',true,'mode_enabled',v_profile.mode_enabled,'verification',v_profile.verification,
    'review_note',CASE WHEN v_profile.verification IN ('needs_more','suspended') THEN v_profile.review_note END,
    'declined_reason',CASE WHEN v_profile.verification='declined' THEN v_profile.declined_reason END,
    'checks',public.issue_3872_creator_checks(v_id),
    'display_name',v_profile.display_name,'niches',to_jsonb(v_profile.niches),
    'home_city',public.issue_3872_creator_home_city_json(v_id),
    'missing',to_jsonb(array_replace(v_profile.verification_reasons,'active_package','package')),
    'handles',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',h.id,'platform',h.platform,'handle',h.handle,'verify_code',h.verify_code,
        'verified',h.verified_at IS NOT NULL,'review_required',h.review_required,'expires_at',h.verify_expires_at,
        'follower_band',h.follower_band,'follower_source',h.follower_source,
        'last_check_status',h.last_check_status,'last_checked_at',h.last_checked_at,'rejected_note',h.rejected_note
      ) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=v_id),
    'suggested_handles',public.issue_4402_suggested_handles(v_id),
    'packages',(SELECT coalesce(jsonb_agg(to_jsonb(p)-'creator_account_id' ORDER BY p.format_key),'[]'::jsonb) FROM public.creator_packages p WHERE p.creator_account_id=v_id)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_setup_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_setup_status() TO authenticated,service_role;

-- 7. The six Admin steps that are not done, plus 'handle_review' while any
--    handle waits for a person. Empty means Verify may proceed.
CREATE OR REPLACE FUNCTION public.issue_4402_creator_verify_blockers(p_creator_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce((SELECT jsonb_agg(c->>'key' ORDER BY ord)
                     FROM jsonb_array_elements(public.issue_3872_creator_checks(p_creator_id)) WITH ORDINALITY t(c,ord)
                    WHERE NOT coalesce((c->>'done')::boolean,false)),'[]'::jsonb)
    || CASE WHEN EXISTS(SELECT 1 FROM public.creator_handles h WHERE h.creator_account_id=p_creator_id AND h.review_required)
            THEN '["handle_review"]'::jsonb ELSE '[]'::jsonb END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_creator_verify_blockers(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_creator_verify_blockers(uuid) TO service_role;

-- 8. Admin decide: the walkthrough body (20271230003872). Verify no longer
--    vouches for flagged handles, and is refused (nothing written) until all
--    six steps pass with no handle under review. Lifting a suspension or
--    reconsidering a decline is a Verify too, so the same gate applies.
CREATE OR REPLACE FUNCTION public.admin_creator_decide(p_creator_id uuid,p_decision text,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_profile public.creator_profiles; v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_result jsonb; v_missing jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('verify','ask_more','decline','suspend') THEN RAISE EXCEPTION 'invalid_decision' USING ERRCODE='22023'; END IF;
  IF p_decision IN ('ask_more','decline') AND v_note IS NULL THEN RETURN jsonb_build_object('ok',false,'error','note_required','field','note'); END IF;
  IF char_length(coalesce(v_note,''))>1000 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=p_creator_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found' USING ERRCODE='P0002'; END IF;
  IF p_decision='verify' THEN
    v_missing:=public.issue_4402_creator_verify_blockers(p_creator_id);
    IF jsonb_array_length(v_missing)>0 THEN
      RETURN jsonb_build_object('ok',false,'error','checks_incomplete','missing',v_missing);
    END IF;
    -- The only path to 'verified' for a creator (I-4402-ONLY-ADMIN-VERIFIES).
    UPDATE public.creator_profiles SET verification='verified',verification_reasons='{}',review_note=NULL,declined_reason=NULL,reviewed_by=auth.uid(),reviewed_at=now()
     WHERE creator_account_id=p_creator_id RETURNING * INTO v_profile;
    v_result:=jsonb_build_object('verification',v_profile.verification);
  ELSE
    UPDATE public.creator_profiles SET
      verification=CASE p_decision WHEN 'ask_more' THEN 'needs_more' WHEN 'decline' THEN 'declined' ELSE 'suspended' END,
      review_note=CASE WHEN p_decision IN ('ask_more','suspend') THEN v_note ELSE review_note END,
      declined_reason=CASE WHEN p_decision='decline' THEN v_note ELSE NULL END,
      reviewed_by=auth.uid(),reviewed_at=now()
     WHERE creator_account_id=p_creator_id RETURNING * INTO v_profile;
    v_result:=jsonb_build_object('verification',v_profile.verification);
  END IF;
  INSERT INTO public.creator_review_events(creator_account_id,action,note,actor) VALUES(p_creator_id,p_decision,v_note,auth.uid());
  RETURN jsonb_build_object('ok',true,'verification',v_result->>'verification');
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_creator_decide(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_creator_decide(uuid,text,text) TO authenticated,service_role;

-- 9. One handle at a time, and the only path to a verified handle. Approve
--    needs the audience band the admin saw (the only band Hosts see). Reject
--    needs a short note the creator sees under fixed wording, and sticks:
--    the creator cannot re-add or re-check it. Reopen puts a rejected handle
--    back in review with a fresh 72-hour code window.
CREATE OR REPLACE FUNCTION public.admin_creator_handle_decide(
  p_handle_id uuid,p_decision text,p_note text DEFAULT NULL,p_band text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_row public.creator_handles; v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_band text:=nullif(btrim(coalesce(p_band,'')),''); v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject','reopen') THEN RAISE EXCEPTION 'invalid_decision' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.creator_handles WHERE id=p_handle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','handle_not_found'); END IF;
  IF char_length(coalesce(v_note,''))>500 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  IF p_decision='reject' AND v_note IS NULL THEN RETURN jsonb_build_object('ok',false,'error','note_required','field','note'); END IF;
  IF p_decision='approve' AND v_band IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','band_required','field','band');
  END IF;
  IF p_decision='approve' AND v_band NOT IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_band','field','band');
  END IF;
  IF p_decision='reopen' AND v_row.last_check_status IS DISTINCT FROM 'rejected' THEN
    RETURN jsonb_build_object('ok',false,'error','not_rejected');
  END IF;
  IF p_decision='approve' THEN
    UPDATE public.creator_handles SET
      verified_at=coalesce(verified_at,now()),review_required=false,review_reason=NULL,
      last_check_status='verified',rejected_note=NULL,
      follower_band=v_band,follower_source='admin'
     WHERE id=p_handle_id RETURNING * INTO v_row;
  ELSIF p_decision='reject' THEN
    -- The admin's band is withdrawn with the handle; the creator's own stays.
    UPDATE public.creator_handles SET
      verified_at=NULL,review_required=false,review_reason=NULL,
      last_check_status='rejected',rejected_note=v_note,
      follower_band=CASE WHEN follower_source='self_reported' THEN follower_band ELSE self_reported_band END,
      follower_source='self_reported'
     WHERE id=p_handle_id RETURNING * INTO v_row;
  ELSE
    UPDATE public.creator_handles SET
      review_required=true,review_reason='awaiting_admin',
      last_check_status=NULL,last_checked_at=NULL,rejected_note=NULL,
      verify_started_at=now(),verify_expires_at=now()+interval '72 hours'
     WHERE id=p_handle_id RETURNING * INTO v_row;
  END IF;
  INSERT INTO public.creator_review_events(creator_account_id,action,note,actor,handle_id,platform,follower_band)
  VALUES(v_row.creator_account_id,CASE p_decision WHEN 'approve' THEN 'handle_approve' WHEN 'reject' THEN 'handle_reject' ELSE 'handle_reopen' END,v_note,auth.uid(),
         v_row.id,v_row.platform,CASE WHEN p_decision='approve' THEN v_band END);
  v_result:=public.issue_3872_recompute_creator_verification(v_row.creator_account_id,false);
  RETURN jsonb_build_object('ok',true,
    'handle',jsonb_build_object('id',v_row.id,'platform',v_row.platform,'handle',v_row.handle,
      'verified_at',v_row.verified_at,'last_check_status',v_row.last_check_status,'rejected_note',v_row.rejected_note,
      'follower_band',v_row.follower_band,'follower_source',v_row.follower_source),
    'verification',v_result->>'verification','missing',public.issue_4402_creator_verify_blockers(v_row.creator_account_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_creator_handle_decide(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_creator_handle_decide(uuid,text,text,text) TO authenticated,service_role;

-- 10. The Admin creator record in one read. Never the date of birth, never a
--     full email, never a payout account number.
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
        'at',e.at,'action',e.action,'note',e.note,'platform',e.platform,'handle_id',e.handle_id,'follower_band',e.follower_band,
        'actor_name',coalesce(nullif(btrim(a.display_name),''),nullif(btrim(a.username),''),nullif(btrim(concat_ws(' ',a.first_name,a.last_name)),''))
      ) ORDER BY e.at,e.id),'[]'::jsonb)
      FROM public.creator_review_events e LEFT JOIN public.profiles a ON a.id=e.actor
      WHERE e.creator_account_id=p_creator_id)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_creator_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_creator_detail(uuid) TO authenticated,service_role;

-- 11. Board: the walkthrough body (20271230003872) plus the first handle (for
--     the card line) and whether Verify is open. The history keeps its shape.
CREATE OR REPLACE FUNCTION public.admin_creator_queue(p_status text DEFAULT 'needs_person') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('needs_person','setting_up','all','incomplete','review','needs_more','verified','declined','suspended') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'creator_id',p.creator_account_id,'display_name',p.display_name,'city',c.name,
      'verification',p.verification,'review_note',p.review_note,'declined_reason',p.declined_reason,
      'checks',public.issue_3872_creator_checks(p.creator_account_id),
      'flags',to_jsonb(p.verification_reasons)
        ||coalesce((SELECT jsonb_agg('handle_review:'||h.platform) FROM public.creator_handles h WHERE h.creator_account_id=p.creator_account_id AND h.review_required),'[]'::jsonb),
      'handle',(SELECT jsonb_build_object('platform',h.platform,'handle',h.handle) FROM public.creator_handles h
                 WHERE h.creator_account_id=p.creator_account_id ORDER BY h.review_required DESC,h.verified_at IS NOT NULL DESC,h.platform LIMIT 1),
      'can_verify',jsonb_array_length(public.issue_4402_creator_verify_blockers(p.creator_account_id))=0,
      'history',coalesce((SELECT jsonb_agg(jsonb_build_object('at',e.at,'action',e.action,'note',e.note) ORDER BY e.at,e.id) FROM public.creator_review_events e WHERE e.creator_account_id=p.creator_account_id),'[]'::jsonb),
      'updated_at',p.updated_at
    ) ORDER BY p.updated_at)
    FROM public.creator_profiles p LEFT JOIN public.seeding_cities c ON c.id=p.home_city_id
    WHERE p_status='all'
       OR (p_status='needs_person' AND p.verification IN ('review','needs_more'))
       OR (p_status='setting_up' AND p.verification='incomplete')
       OR p.verification=p_status
  ),'[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_creator_queue(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_creator_queue(text) TO authenticated,service_role;

-- 12. Host pre-hire profile: the r3 body (20271226003872), but "Verified
--     audience" lists only bands an admin recorded when approving the handle.
CREATE OR REPLACE FUNCTION public.prehire_creator_profile(p_creator_account_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.brands b WHERE public.biz_is_brand_member_for_read(b.id,auth.uid()))
    AND p.mode_enabled AND p.verification='verified' THEN jsonb_build_object(
      'id',p.creator_account_id,'display_name',p.display_name,'city_id',p.home_city_id,'niches',p.niches,'languages',p.languages,
      'follower_bands',(SELECT coalesce(jsonb_agg(jsonb_build_object('platform',h.platform,'band',h.follower_band,'verified',h.verified_at IS NOT NULL,'source',h.follower_source) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=p.creator_account_id AND h.verified_at IS NOT NULL AND NOT h.review_required AND h.follower_source='admin' AND h.follower_band IS NOT NULL),
      'showcase',(SELECT coalesce(jsonb_agg(jsonb_build_object('media_id',m.id,'thumb',NULL) ORDER BY m.created_at DESC),'[]'::jsonb) FROM public.creator_media_jobs m WHERE m.owner_id=p.creator_account_id AND m.purpose='showcase' AND m.status='ready' AND m.deleted_at IS NULL),
      'rating',CASE WHEN p.rating_count>0 THEN p.rating_avg_x100/100.0 END,'rating_count',p.rating_count,'completed',p.completed_gigs,'reliability',p.reliability_bps,
      'packages',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'format_key',c.format_key,'platforms',c.platforms,'price_minor',c.price_minor,'currency',c.currency,'turnaround_days',c.turnaround_days,'includes_usage_days',c.includes_usage_days,'extra_usage_price_minor',c.extra_usage_price_minor) ORDER BY c.format_key),'[]'::jsonb) FROM public.creator_packages c WHERE c.creator_account_id=p.creator_account_id AND c.active)
    ) ELSE NULL END FROM public.creator_profiles p WHERE p.creator_account_id=p_creator_account_id;
$fn$;
REVOKE ALL ON FUNCTION public.prehire_creator_profile(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prehire_creator_profile(uuid) TO authenticated,service_role;

-- 12b. Host Applicants: the round-2 body (20280102003872), but each
--      applicant's audience lists only bands an admin recorded when approving
--      the handle (Orchestrator, 12 Nov 2026). Never the creator's own band.
CREATE OR REPLACE FUNCTION public.gig_applicants(p_gig_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  -- FILTER keeps a gig with no interest at [] instead of one all-null row,
  -- which crashed the Host Applicants screen (#6). Creators already hired on
  -- the gig appear only under Hired (round 2).
  SELECT CASE WHEN public.biz_is_brand_member_for_read(g.brand_id,auth.uid()) THEN coalesce(jsonb_agg(jsonb_build_object(
    'interest_id',i.id,'creator_id',i.creator_account_id,'display_name',p.display_name,'niches',p.niches,
    'follower_bands',(SELECT coalesce(jsonb_agg(jsonb_build_object('platform',h.platform,'band',h.follower_band,'verified',true,'source',h.follower_source)),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=i.creator_account_id AND h.verified_at IS NOT NULL AND NOT h.review_required AND h.follower_source='admin' AND h.follower_band IS NOT NULL),
    'rating',CASE WHEN p.rating_count>0 THEN p.rating_avg_x100/100.0 END,'completed',p.completed_gigs,'reliability',p.reliability_bps,
    'quote_minor',i.quoted_minor,'currency',g.currency,'package_id',i.package_id,'note',i.note,'status',i.status
  ) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) ELSE NULL END
  FROM public.gigs g
  LEFT JOIN public.gig_interest i ON i.gig_id=g.id AND NOT public.issue_3872_creator_hired_on_gig(g.id,i.creator_account_id)
  LEFT JOIN public.creator_profiles p ON p.creator_account_id=i.creator_account_id
  WHERE g.id=p_gig_id GROUP BY g.brand_id;
$fn$;
REVOKE ALL ON FUNCTION public.gig_applicants(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_applicants(uuid) TO authenticated,service_role;

-- 12c. The bio-code check's only write path (creator-handle-verify, service
--      role). Compare-and-set under a row lock: evidence is saved only while
--      the handle still waits for an admin with the code the check read. If an
--      admin approved, rejected or the creator took a new code while the
--      profile fetch ran, nothing is written and the current state comes back
--      (retest P2-A: an in-flight check must never undo an admin decision).
CREATE OR REPLACE FUNCTION public.issue_4402_record_handle_check(
  p_handle_id uuid,p_creator_account_id uuid,p_verify_code text,p_check text,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_row public.creator_handles; v_saved boolean:=false;
BEGIN
  IF p_check IS NULL OR p_check NOT IN ('code_seen','code_not_seen','unreadable','expired') THEN
    RAISE EXCEPTION 'invalid_check' USING ERRCODE='22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('code_seen','verification_code_not_found','provider_unreadable','provider_fetch_blocked','verification_code_expired') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.creator_handles
   WHERE id=p_handle_id AND creator_account_id=p_creator_account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'found',false); END IF;
  IF v_row.review_required AND v_row.verified_at IS NULL
     AND v_row.last_check_status IS DISTINCT FROM 'rejected' AND v_row.last_check_status IS DISTINCT FROM 'verified'
     AND v_row.verify_code=p_verify_code THEN
    UPDATE public.creator_handles SET last_checked_at=now(),last_check_status=p_check,review_required=true,review_reason=p_reason
     WHERE id=p_handle_id RETURNING * INTO v_row;
    v_saved:=true;
  END IF;
  RETURN jsonb_build_object('saved',v_saved,'found',true,
    'last_check_status',v_row.last_check_status,'verified',v_row.verified_at IS NOT NULL AND NOT v_row.review_required,
    'review_required',v_row.review_required,'follower_band',v_row.follower_band,'follower_source',v_row.follower_source);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_record_handle_check(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_record_handle_check(uuid,uuid,text,text,text) TO service_role;

-- 13. Existing handles onto the admin-review rule: a handle no admin approved
--     waits for one (a rejected one stays rejected), and a band no admin
--     recorded goes back to what the creator said.
UPDATE public.creator_handles h
   SET verified_at=NULL,review_required=true,review_reason=coalesce(h.review_reason,'awaiting_admin')
 WHERE coalesce(h.last_check_status,'') <> 'rejected'
   AND NOT EXISTS(SELECT 1 FROM public.creator_review_events e WHERE e.handle_id=h.id AND e.action='handle_approve')
   AND (h.verified_at IS NOT NULL OR NOT h.review_required);
UPDATE public.creator_handles
   SET follower_band=self_reported_band,follower_source='self_reported'
 WHERE follower_source='provider';

-- 14. Recompute every creator under the admin-verifies rule (never promotes).
DO $do$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT creator_account_id FROM public.creator_profiles LOOP
    PERFORM public.issue_3872_recompute_creator_verification(v_id,false);
  END LOOP;
END;
$do$;

COMMIT;
