-- #4402 polish PR, migration M3: the Mingla Local pick window.
--
-- WHY (spec comment 6855228971 on #4402, item 6; Seth's decision D5):
--   local_pick_place refused every pick after the 7th of the month, so a Local
--   whose seat started on the 12th (production Local 09f6200e) could not pick
--   a place until next month. D5: a new Local gets a 7-day pick window from
--   seat_started_on (days 0-6, the start day included), and Admin can open a
--   pick window for a Local for the current month, with a reason that is kept
--   in the Local's History (local_events kind pick_window_opened).
--
--   issue_4402_local_pick_window() is the one rule; local_pick_place,
--   local_home.pick_window and admin_local_queue.locals all read it, so the
--   app, Admin and the server never disagree. When more than one window is
--   open, the one that stays open longest is reported (ties keep the order
--   start of month, new seat, Admin), so "pick by" is never earlier than the
--   real close.
--
-- Every replaced function is copied from the production body and changed only
-- as the spec says.
-- Proof: __tests__/issue_4402_polish_local_pick_window.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.local_pick_window_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id uuid NOT NULL REFERENCES public.locals(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  open_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 300),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (local_id, month)
);
-- Read and written only through the definer functions below.
ALTER TABLE public.local_pick_window_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_pick_window_overrides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.local_pick_window_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.local_pick_window_overrides TO service_role;
COMMENT ON TABLE public.local_pick_window_overrides IS
  '#4402 D5: an Admin-opened Mingla Local pick window for one Local and month, with the reason.';

CREATE OR REPLACE FUNCTION public.issue_4402_local_pick_window(p_local_id uuid, p_now timestamptz DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date:=(p_now AT TIME ZONE 'UTC')::date;
  v_month date:=date_trunc('month',(p_now AT TIME ZONE 'UTC'))::date;
  v_seat date; v_best_until timestamptz; v_best_reason text; v_until timestamptz;
BEGIN
  -- MINGLA-INVARIANT: I-4402-LOCAL-1 | issue #4402 | a Local pick is accepted only while issue_4402_local_pick_window().open
  SELECT l.seat_started_on INTO v_seat FROM public.locals l WHERE l.id=p_local_id;
  -- 1. Start of month: the UTC day is 1-7 (open until the 8th, 00:00 UTC).
  IF extract(day FROM v_today)<=7 THEN
    v_best_until:=(v_month+7)::timestamp AT TIME ZONE 'UTC'; v_best_reason:='month_start';
  END IF;
  -- 2. New seat: days 0-6 from seat_started_on, the start day included.
  IF v_seat IS NOT NULL AND v_today>=v_seat AND v_today<v_seat+7 THEN
    v_until:=(v_seat+7)::timestamp AT TIME ZONE 'UTC';
    IF v_best_until IS NULL OR v_until>v_best_until THEN v_best_until:=v_until; v_best_reason:='new_seat'; END IF;
  END IF;
  -- 3. Admin override for this month, still open.
  SELECT o.open_until INTO v_until FROM public.local_pick_window_overrides o
   WHERE o.local_id=p_local_id AND o.month=v_month AND o.open_until>p_now;
  IF FOUND AND (v_best_until IS NULL OR v_until>v_best_until) THEN v_best_until:=v_until; v_best_reason:='admin'; END IF;
  IF v_best_until IS NULL THEN
    RETURN jsonb_build_object('open',false,'reason',NULL,'open_until',NULL,'opens_on',(v_month+interval '1 month')::date);
  END IF;
  RETURN jsonb_build_object('open',true,'reason',v_best_reason,'open_until',v_best_until,'opens_on',NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4402_local_pick_window(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_local_pick_window(uuid,timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.local_pick_place(p_place_id uuid, p_personal_tie boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_local public.locals; v_month date:=date_trunc('month',current_date)::date; v_id uuid; v_conflict text;
BEGIN
  -- #3: the pick ignored the global Locals kill switch.
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags WHERE flag_key='mingla_locals_enabled' AND is_enabled) THEN
    RAISE EXCEPTION 'locals_not_open' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_local FROM public.locals WHERE user_id=v_actor AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active_local_required' USING ERRCODE='42501'; END IF;
  -- #4402 D5: start of month, the new-seat week, or an Admin-opened window.
  IF NOT coalesce((public.issue_4402_local_pick_window(v_local.id)->>'open')::boolean,false) THEN RAISE EXCEPTION 'pick_window_closed' USING ERRCODE='55000'; END IF;
  IF p_personal_tie THEN RAISE EXCEPTION 'personal_tie_conflict' USING ERRCODE='23514'; END IF;
  v_conflict:=public.issue_3872_local_place_conflict(v_local.id,p_place_id);
  IF v_conflict IS NOT NULL THEN RAISE EXCEPTION '%',v_conflict USING ERRCODE='23514'; END IF;
  INSERT INTO public.local_months(local_id,month,place_id,status,picked_at,confirmed_at)
  VALUES(v_local.id,v_month,p_place_id,'confirmed',now(),now()) RETURNING id INTO v_id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data) VALUES(v_local.id,v_id,'local','local_pick',jsonb_build_object('result','confirmed','place_id',p_place_id));
  RETURN jsonb_build_object('ok',true,'local_month_id',v_id,'status','confirmed');
END;
$function$;
REVOKE ALL ON FUNCTION public.local_pick_place(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_pick_place(uuid,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_local_open_pick_window(p_local_id uuid, p_reason text, p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_local public.locals; v_reason text:=btrim(coalesce(p_reason,'')); v_month date:=date_trunc('month',(now() AT TIME ZONE 'UTC'))::date;
  v_until timestamptz:=now()+make_interval(days=>coalesce(p_days,0)); v_email text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 14 THEN RETURN jsonb_build_object('ok',false,'error','days_invalid','field','days'); END IF;
  IF char_length(v_reason) NOT BETWEEN 5 AND 300 THEN RETURN jsonb_build_object('ok',false,'error','reason_required','field','reason'); END IF;
  SELECT * INTO v_local FROM public.locals WHERE id=p_local_id FOR UPDATE;
  IF NOT FOUND OR v_local.status<>'active' THEN RETURN jsonb_build_object('ok',false,'error','local_not_active'); END IF;
  INSERT INTO public.local_pick_window_overrides(local_id,month,open_until,reason,created_by)
  VALUES(v_local.id,v_month,v_until,v_reason,auth.uid())
  ON CONFLICT(local_id,month) DO UPDATE SET open_until=EXCLUDED.open_until,reason=EXCLUDED.reason,created_by=EXCLUDED.created_by,created_at=now();
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id=auth.uid();
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind,data)
  VALUES(v_local.id,NULL,'admin','pick_window_opened',jsonb_build_object('month',v_month,'open_until',v_until,'reason',v_reason,
    'admin_id',auth.uid(),'admin_email',v_email,'days',p_days));
  RETURN jsonb_build_object('ok',true,'open_until',v_until);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_local_open_pick_window(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_local_open_pick_window(uuid,text,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_local_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'agreement',(SELECT jsonb_build_object(
      'version',v.version,'document_url',v.document_url,
      'document_sha256',v.document_sha256,'effective_at',v.effective_at
    ) FROM public.local_agreement_versions v
      WHERE v.is_current AND v.effective_at<=now() AND v.retired_at IS NULL),
    'cities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name) FROM public.seeding_cities c),'[]'::jsonb),
    'programs',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'city_id',p.city_id,'city',c.name,'seats',p.seats,
      'active',(SELECT count(*) FROM public.locals l WHERE l.city_id=p.city_id AND l.status='active'),
      'reserved',(SELECT count(*) FROM public.local_applications a
        WHERE a.city_id=p.city_id AND a.status='agreement_pending' AND a.agreement_due_at>now()),
      'is_open',p.is_open,'monthly_usd_minor',p.monthly_usd_minor,
      'monthly_rate_minor',p.monthly_rate_minor,'payout_currency',p.payout_currency
    ) ORDER BY c.name) FROM public.local_city_programs p JOIN public.seeding_cities c ON c.id=p.city_id),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'user_id',a.user_id,'display_name',coalesce(nullif(btrim(pr.display_name),''),pr.username),
      'city_id',a.city_id,'city',c.name,'handles',a.handles,
      'sample_links',a.sample_links,'why',a.why,'status',a.status,
      'created_at',a.created_at,'agreement_version',a.agreement_version,
      'agreement_due_at',a.agreement_due_at,'agreement_signed_at',x.accepted_at,
      'signature_name',x.signature_name
    ) ORDER BY a.created_at)
      FROM public.local_applications a
      JOIN public.seeding_cities c ON c.id=a.city_id
      LEFT JOIN public.profiles pr ON pr.id=a.user_id
      LEFT JOIN public.local_agreement_acceptances x ON x.application_id=a.id
      LEFT JOIN public.locals l ON l.user_id=a.user_id AND l.city_id=a.city_id
      WHERE a.status IN ('submitted','shortlisted','waitlisted','agreement_pending')
        OR (a.status='accepted' AND (
          x.accepted_at>=now()-interval '30 days' OR l.agreement_signed_at IS NULL
        ))),'[]'::jsonb),
    'picks',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_month_id',m.id,'local_id',m.local_id,
      'local_name',coalesce(nullif(btrim(p.display_name),''),p.username),
      'city',c.name,'place_id',m.place_id,'place_name',pp.name,
      'month',m.month,'status',m.status,'picked_at',m.picked_at
    ) ORDER BY m.picked_at DESC NULLS LAST)
      FROM public.local_months m JOIN public.locals l ON l.id=m.local_id
      JOIN public.profiles p ON p.id=l.user_id JOIN public.seeding_cities c ON c.id=l.city_id
      LEFT JOIN public.place_pool pp ON pp.id=m.place_id
      WHERE m.month=date_trunc('month',current_date)::date),'[]'::jsonb),
    'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_month_id',m.id,'local_id',m.local_id,
      'local_name',coalesce(p.display_name,p.username),'place_name',pp.name,
      'month',m.month,'status',m.status,'review',to_jsonb(r),
      'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]'::jsonb)
        FROM public.local_events e WHERE e.local_month_id=m.id)
    ) ORDER BY m.submitted_at)
      FROM public.local_months m JOIN public.local_reviews r ON r.local_month_id=m.id
      JOIN public.locals l ON l.id=m.local_id JOIN public.profiles p ON p.id=l.user_id
      JOIN public.place_pool pp ON pp.id=m.place_id
      WHERE m.status IN ('submitted','changes_requested')),'[]'::jsonb),
    'payouts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_month_id',m.id,'local_name',coalesce(p.display_name,p.username),
      'month',m.month,'status',m.status,'currency',m.payout_currency,
      'amount_minor',m.payout_amount_minor,'share_status',s.status
    ) ORDER BY m.month DESC)
      FROM public.local_months m JOIN public.locals l ON l.id=m.local_id
      JOIN public.profiles p ON p.id=l.user_id
      LEFT JOIN public.payee_shares s ON s.id=m.payee_share_id
      WHERE m.status IN ('published','paid')),'[]'::jsonb),
    -- #4402 D5: every active Local with this month's pick, its pick window
    -- and its History (newest first, last 20).
    'locals',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'local_id',l.id,'name',coalesce(nullif(btrim(p.display_name),''),p.username),
      'city',c.name,'seat_started_on',l.seat_started_on,
      'pick',(SELECT jsonb_build_object('local_month_id',m.id,'status',m.status,'place_id',m.place_id,'place_name',pp.name,'picked_at',m.picked_at)
        FROM public.local_months m LEFT JOIN public.place_pool pp ON pp.id=m.place_id
        WHERE m.local_id=l.id AND m.month=date_trunc('month',current_date)::date),
      'window',public.issue_4402_local_pick_window(l.id),
      'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'actor',e.actor,'data',e.data,
          'local_month_id',e.local_month_id,'created_at',e.created_at) ORDER BY e.created_at DESC,e.id DESC),'[]'::jsonb)
        FROM (SELECT * FROM public.local_events e0 WHERE e0.local_id=l.id ORDER BY e0.created_at DESC,e0.id DESC LIMIT 20) e)
    ) ORDER BY c.name,l.seat_started_on DESC)
      FROM public.locals l JOIN public.profiles p ON p.id=l.user_id JOIN public.seeding_cities c ON c.id=l.city_id
      WHERE l.status='active'),'[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_local_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_local_queue() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.local_home()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('local',jsonb_build_object('id',l.id,'city_id',l.city_id,'city',c.name,'status',l.status,'since',l.seat_started_on),'current_month',(SELECT to_jsonb(m) FROM public.local_months m WHERE m.local_id=l.id AND m.month=date_trunc('month',current_date)::date),'months',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month DESC) FROM public.local_months m WHERE m.local_id=l.id),'[]'::jsonb),'pick_window',public.issue_4402_local_pick_window(l.id),'payout',(SELECT jsonb_build_object('stripe_status',a.stripe_status,'paystack_status',a.paystack_status,'currency',coalesce(a.paystack_currency,p.currency)) FROM public.payee_accounts a WHERE a.user_id=l.user_id))
  FROM public.locals l JOIN public.seeding_cities c ON c.id=l.city_id JOIN public.profiles p ON p.id=l.user_id WHERE l.user_id=auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.local_home() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_home() TO authenticated, service_role;

COMMIT;
