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

REVOKE ALL ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid) TO service_role;

COMMIT;
