-- #3682 Wave 2 slice 1 — auto-follow a brand when a signed-in guest buys.
-- Service-role SECURITY DEFINER insert; per-order claim so unfollow is not undone
-- by confirm/webhook replay. Guests without buyer_user_id are skipped by callers.

BEGIN;

-- Durable "we already processed auto-follow for this order" ledger.
-- Survives hard-delete of brand_follows (unfollow), so retries cannot re-follow.
CREATE TABLE IF NOT EXISTS public.brand_follow_auto_claims (
  order_id uuid PRIMARY KEY REFERENCES public.orders (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.brand_follow_auto_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.brand_follow_auto_claims TO service_role;

CREATE OR REPLACE FUNCTION public.biz_auto_follow_brand(
  p_user_id uuid,
  p_brand_id uuid,
  p_source text DEFAULT 'purchase',
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'purchase');
  v_claim_count integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'auto_follow_args_required' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('purchase', 'rsvp', 'booking', 'brand_page', 'web_email') THEN
    RAISE EXCEPTION 'auto_follow_source_invalid' USING ERRCODE = '22023';
  END IF;

  -- Purchase/RSVP paths must claim by order so unfollow stays sticky across replay.
  IF p_order_id IS NOT NULL THEN
    INSERT INTO public.brand_follow_auto_claims (order_id, user_id, brand_id, source)
    VALUES (p_order_id, p_user_id, p_brand_id, v_source)
    ON CONFLICT (order_id) DO NOTHING;
    GET DIAGNOSTICS v_claim_count = ROW_COUNT;
    IF v_claim_count = 0 THEN
      RETURN jsonb_build_object(
        'followed', false,
        'created', false,
        'skipped', 'already_claimed',
        'userId', p_user_id,
        'brandId', p_brand_id,
        'orderId', p_order_id,
        'source', v_source
      );
    END IF;
  END IF;

  INSERT INTO public.brand_follows (user_id, brand_id, source)
  VALUES (p_user_id, p_brand_id, v_source)
  ON CONFLICT ON CONSTRAINT brand_follows_user_brand_key DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'followed', true,
    'created', (v_row_count > 0),
    'userId', p_user_id,
    'brandId', p_brand_id,
    'orderId', p_order_id,
    'source', v_source
  );
END
$f$;

REVOKE ALL ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid)
  TO service_role;

GRANT SELECT, INSERT, DELETE ON TABLE public.brand_follows TO service_role;

-- Display rename: "Extended circle" → "Friends of followers" for newly ensured
-- ring audiences (existing rows keep their stored name until re-ensured).
CREATE OR REPLACE FUNCTION public.biz_get_or_create_marketing_circle_audience_v1(
  p_actor_id uuid,p_brand_id uuid,p_audience_kind text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_id uuid; v_name text;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id
    OR p_audience_kind NOT IN('brand_followers','brand_circle_extended')
    OR public.biz_brand_effective_rank(p_brand_id,p_actor_id)<public.biz_role_rank('marketing_manager')
  THEN RAISE EXCEPTION 'circle_blast_forbidden' USING ERRCODE='42501'; END IF;
  v_name:=CASE p_audience_kind WHEN 'brand_followers' THEN 'Followers' ELSE 'Friends of followers' END;
  SELECT id INTO v_id FROM public.marketing_audiences
  WHERE brand_id=p_brand_id AND is_system_generated
    AND query_definition=jsonb_build_object('kind',p_audience_kind,'brand_id',p_brand_id::text);
  IF v_id IS NULL THEN
    INSERT INTO public.marketing_audiences(account_id,brand_id,name,query_definition,is_system_generated)
    VALUES(p_actor_id,p_brand_id,v_name,jsonb_build_object('kind',p_audience_kind,'brand_id',p_brand_id::text),true)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_id FROM public.marketing_audiences
    WHERE brand_id=p_brand_id AND is_system_generated
      AND query_definition=jsonb_build_object('kind',p_audience_kind,'brand_id',p_brand_id::text);
  ELSE
    UPDATE public.marketing_audiences
      SET name = v_name
      WHERE id = v_id
        AND name IS DISTINCT FROM v_name;
  END IF;
  RETURN jsonb_build_object('audienceId',v_id);
END;
$function$;

COMMIT;
