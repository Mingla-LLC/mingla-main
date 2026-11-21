-- Issue #4490, spec 07 M: a short member code for the venue door.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.venue_membership_subscriptions
  ADD COLUMN member_code text,
  ADD CONSTRAINT venue_membership_subscriptions_member_code_check CHECK (
    member_code IS NULL OR member_code ~ '^[2-9A-HJ-NP-Z]{6}$'
  );

-- Six symbols from an unambiguous 32-character alphabet. Six random bytes
-- supply one unbiased five-bit index each.
CREATE OR REPLACE FUNCTION public.issue_4490_member_code_candidate()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(6);
  v_code text := '';
  v_i integer;
BEGIN
  FOR v_i IN 0..5 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_i) & 31) + 1, 1);
  END LOOP;
  RETURN v_code;
END;
$function$;

CREATE UNIQUE INDEX venue_membership_subscriptions_brand_member_code_uq
  ON public.venue_membership_subscriptions (brand_id, member_code)
  WHERE member_code IS NOT NULL AND status NOT IN ('cancelled', 'declined');

-- Serialising allocation inside one brand makes the read-before-write safe;
-- five fresh candidates satisfy the product collision rule. The unique index
-- remains the final authority for every writer.
CREATE OR REPLACE FUNCTION public.issue_4490_allocate_member_code(p_brand_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_code text;
  v_try integer;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'member_code_unavailable' USING ERRCODE = 'PT409';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':member-code', 4490));
  FOR v_try IN 1..5 LOOP
    v_code := public.issue_4490_member_code_candidate();
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_membership_subscriptions s
      WHERE s.brand_id = p_brand_id AND s.member_code = v_code
        AND s.status NOT IN ('cancelled', 'declined')
    ) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'member_code_unavailable' USING ERRCODE = 'PT409';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_member_code_candidate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_4490_allocate_member_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4490_member_code_candidate(),
  public.issue_4490_allocate_member_code(uuid) TO service_role;

-- Existing current members and instant joins receive a code. An undecided
-- request intentionally stays blank until the venue approves it.
DO $backfill$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT id, brand_id
    FROM public.venue_membership_subscriptions
    WHERE member_code IS NULL
      AND status NOT IN ('cancelled', 'declined', 'requested')
    ORDER BY brand_id, id
    FOR UPDATE
  LOOP
    UPDATE public.venue_membership_subscriptions
    SET member_code = public.issue_4490_allocate_member_code(v_row.brand_id),
        updated_at = now()
    WHERE id = v_row.id;
  END LOOP;
END;
$backfill$;

-- Checked patches preserve the cumulative G/K membership work and refuse a
-- changed predecessor instead of silently producing a partial migration.
CREATE FUNCTION pg_temp.issue_4490_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN RETURN; END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 member-code patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Member and Host detail reads carry the display code. Requested rows remain
-- null until approval; ended rows never match at the door.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_projection(uuid,text,text)'::regprocedure,
  $old$    'status', v_sub.status,
    'memberName', v_sub.member_name,$old$,
  $new$    'status', v_sub.status,
    'memberCode', v_sub.member_code,
    'memberName', v_sub.member_name,$new$
);

-- Instant plans receive their code in the same insert as the membership.
-- Request plans use their separate insert and stay blank until approval.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)'::regprocedure,
  $old$  END IF;
  INSERT INTO public.venue_membership_subscriptions (
    id, plan_id, brand_id, user_id, member_name, member_email, member_phone, member_token_hash, qr_token_hash,
    status, start_on, terms, actor_key_hash, idempotency_key, request_hash
  ) VALUES (
    p_subscription_id, v_plan.id, v_plan.brand_id, p_user_id, btrim(p_member->>'name'), v_email, v_phone,
    p_member_token_hash, encode(pg_catalog.sha256(extensions.gen_random_bytes(32)), 'hex'),
    'pending',$old$,
  $new$  END IF;
  INSERT INTO public.venue_membership_subscriptions (
    id, plan_id, brand_id, user_id, member_name, member_email, member_phone, member_token_hash, qr_token_hash,
    member_code, status, start_on, terms, actor_key_hash, idempotency_key, request_hash
  ) VALUES (
    p_subscription_id, v_plan.id, v_plan.brand_id, p_user_id, btrim(p_member->>'name'), v_email, v_phone,
    p_member_token_hash, encode(pg_catalog.sha256(extensions.gen_random_bytes(32)), 'hex'),
    public.issue_4490_allocate_member_code(v_plan.brand_id), 'pending',$new$
);

-- Approval is the first moment a request becomes a usable membership, so it
-- is also the first moment its code exists (before the approval email queues).
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_member(uuid,text,jsonb,bigint,text)'::regprocedure,
  $old$    SET status = 'pending', decided_at = now(), decline_reason = NULL,
        version = version + 1, updated_at = now()$old$,
  $new$    SET status = 'pending', decided_at = now(), decline_reason = NULL,
        member_code = COALESCE(member_code, public.issue_4490_allocate_member_code(brand_id)),
        version = version + 1, updated_at = now()$new$
);

-- Join, approval and renewal messages all render the same display code.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_enqueue(uuid,uuid,text,text)'::regprocedure,
  $old$      'member_name', v_sub.member_name,
      'plan_name', v_plan.name,$old$,
  $new$      'member_name', v_sub.member_name,
      'member_code', v_sub.member_code,
      'plan_name', v_plan.name,$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

-- A typed code resolves only inside this venue, then reuses the one member
-- admission authority so status, payment, allowance and capacity rules stay
-- identical to QR/list check-in.
CREATE OR REPLACE FUNCTION public.issue_4490_admit_member_by_code(
  p_venue_id uuid,
  p_code text,
  p_guests integer,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_code text;
  v_subscription_id uuid;
  v_log uuid;
  v_today date;
  v_staff_misses integer;
  v_venue_misses integer;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  IF COALESCE(p_guests, 0) NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  v_code := upper(regexp_replace(COALESCE(p_code, ''), '[[:space:]-]+', '', 'g'));

  SELECT
    count(*) FILTER (WHERE l.scanner_user_id = p_scanner_user_id),
    count(*)
  INTO v_staff_misses, v_venue_misses
  FROM public.venue_check_in_log l
  WHERE l.venue_id = p_venue_id
    AND l.created_at > now() - interval '10 minutes'
    AND l.result = 'not_found'
    AND l.method = 'manual'
    AND l.detail @> '{"via":"code"}'::jsonb;
  IF v_staff_misses >= 5 OR v_venue_misses >= 30 THEN
    RAISE EXCEPTION 'member_code_rate_limited' USING ERRCODE = 'PT429';
  END IF;

  IF v_code ~ '^[2-9A-HJ-NP-Z]{6}$' THEN
    SELECT s.id INTO v_subscription_id
    FROM public.venue_membership_subscriptions s
    WHERE s.brand_id = v_venue.brand_id
      AND s.member_code = v_code
      AND s.status NOT IN ('cancelled', 'declined')
      AND public.issue_4490_member_venue(s.id) = p_venue_id;
  END IF;

  IF v_subscription_id IS NULL THEN
    v_today := public.issue_4490_venue_local_date(p_venue_id);
    INSERT INTO public.venue_check_in_log (
      venue_id, brand_id, result, admitted_delta, method, scanner_user_id, local_date, detail
    ) VALUES (
      p_venue_id, v_venue.brand_id, 'not_found', 0, 'manual', p_scanner_user_id, v_today,
      '{"via":"code"}'::jsonb
    ) RETURNING id INTO v_log;
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log, 'kind', 'member');
  END IF;

  RETURN public.issue_4490_admit_member(
    v_venue, v_subscription_id, COALESCE(p_guests, 0), p_scanner_user_id, 'manual');
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_admit_member_by_code(uuid, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_admit_member_by_code(uuid, text, integer, uuid)
  TO service_role;

COMMIT;
