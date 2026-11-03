-- Issue #3355: the Ari flow engine switch lives in public.feature_flags as
-- 'ari_flow_engine', seeded off, and re-applying the seed never flips a row
-- someone switched on. Reverting the migration makes the first block raise.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.feature_flags
    WHERE flag_key = 'ari_flow_engine' AND is_enabled = false
  ) THEN
    RAISE EXCEPTION 'ari_flow_engine flag missing or not seeded off';
  END IF;
END $$;

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'ari_flow_engine';
INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('ari_flow_engine',false,'re-seed')
ON CONFLICT(flag_key) DO NOTHING;

DO $$
BEGIN
  IF NOT (SELECT is_enabled FROM public.feature_flags WHERE flag_key = 'ari_flow_engine') THEN
    RAISE EXCEPTION 're-applying the seed flipped a switched-on flag off';
  END IF;
END $$;

ROLLBACK;
