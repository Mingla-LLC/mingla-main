-- #3682 Wave 2.5 — web follow-by-email pending ledger + attach source.
-- Pending rows are email+brand keyed; tokens are hashed (HS256 mint lives on edge).
-- Client has no access: service_role + SECURITY DEFINER only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.brand_follow_email_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('confirm', 'invite')),
  token_hash text NOT NULL,
  user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_follow_email_pending_email_brand_key UNIQUE (email_normalized, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_follow_email_pending_token_hash
  ON public.brand_follow_email_pending (token_hash)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brand_follow_email_pending_expires
  ON public.brand_follow_email_pending (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.brand_follow_email_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_follow_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follow_email_pending TO service_role;

-- Allow attach source used after invite OTP verify (design contract O2).
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
  IF v_source NOT IN (
    'purchase', 'rsvp', 'booking', 'brand_page', 'web_email', 'web_follow_invite'
  ) THEN
    RAISE EXCEPTION 'auto_follow_source_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_source IN ('purchase', 'rsvp', 'booking') AND p_order_id IS NULL THEN
    RAISE EXCEPTION 'auto_follow_order_required' USING ERRCODE = '22023';
  END IF;

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
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid) TO service_role;

-- Durable IP/email request throttle (shared across edge isolates).
CREATE TABLE IF NOT EXISTS public.brand_follow_request_rate (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0
);

ALTER TABLE public.brand_follow_request_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_follow_request_rate FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_follow_request_rate TO service_role;

CREATE OR REPLACE FUNCTION public.biz_web_follow_rate_hit(
  p_bucket_key text,
  p_window_seconds integer DEFAULT 600,
  p_max_hits integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_now timestamptz := now();
  v_window interval := make_interval(secs => GREATEST(p_window_seconds, 1));
  v_hit integer;
BEGIN
  -- Fail closed: empty key cannot be rate-decided → treat as limited.
  IF p_bucket_key IS NULL OR btrim(p_bucket_key) = '' THEN
    RETURN true;
  END IF;

  -- Single atomic upsert: concurrent first hits cannot race past INSERT.
  INSERT INTO public.brand_follow_request_rate AS r (
    bucket_key,
    window_started_at,
    hit_count
  )
  VALUES (p_bucket_key, v_now, 1)
  ON CONFLICT (bucket_key) DO UPDATE
  SET
    window_started_at = CASE
      WHEN r.window_started_at + v_window <= v_now THEN v_now
      ELSE r.window_started_at
    END,
    hit_count = CASE
      WHEN r.window_started_at + v_window <= v_now THEN 1
      ELSE r.hit_count + 1
    END
  RETURNING r.hit_count INTO v_hit;

  RETURN v_hit > GREATEST(p_max_hits, 1);
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_web_follow_rate_hit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_web_follow_rate_hit(text, integer, integer) TO service_role;

-- Single-claimer invite attach (follow + consume in one transaction).
CREATE OR REPLACE FUNCTION public.biz_claim_web_follow_invite(
  p_token_hash text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_pending public.brand_follow_email_pending%ROWTYPE;
  v_updated integer := 0;
BEGIN
  IF p_token_hash IS NULL OR btrim(p_token_hash) = '' OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'args_required');
  END IF;

  SELECT * INTO v_pending
  FROM public.brand_follow_email_pending
  WHERE token_hash = p_token_hash
    AND kind = 'invite'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_pending.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'brand_id', v_pending.brand_id
    );
  END IF;

  IF v_pending.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  PERFORM public.biz_auto_follow_brand(
    p_user_id,
    v_pending.brand_id,
    'web_follow_invite',
    NULL
  );

  UPDATE public.brand_follow_email_pending
  SET consumed_at = now(), user_id = p_user_id
  WHERE id = v_pending.id
    AND consumed_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'brand_id', v_pending.brand_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'brand_id', v_pending.brand_id,
    'email', v_pending.email_normalized
  );
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_claim_web_follow_invite(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_claim_web_follow_invite(text, uuid) TO service_role;

COMMIT;
