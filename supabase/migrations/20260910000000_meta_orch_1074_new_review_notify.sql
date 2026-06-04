-- META-ORCH-1074 Sub-A [Business notification triggers] — trigger #9
-- `business.new_review`.
--
-- Fires a business.new_review notification the moment a place review reaches
-- moderation_status='approved' (on INSERT-as-approved or on the
-- pending→approved UPDATE transition). Resolves the brand from the reviewed
-- place_pool, then pg_net-invokes the notify-dispatch edge function once per
-- recipient (brand owner + admins). Idempotency is enforced downstream by
-- notify-dispatch's per-recipient idempotency_key
-- (`business.new_review:{reviewId}:{userId}`), so a re-approval / replay
-- collapses to one row per recipient.
--
-- Recipients: brand_owner + brand_admin (post-ORCH-1047 role strings).
--
-- DESIGN NOTES
--   * Real-time, no poll — mirrors the existing trigger→pg_net→edge pattern
--     used by ORCH-0815-B (marketing-send cron) and others.
--   * experience_feedback is NOT wired here: it has no brand link
--     (card_id text only) and no moderation_status column, so there is no
--     reliable brand to notify. Only place_reviews fires in v1 (documented
--     gap; Sub-D F2/F3).
--   * No schema change to notifications / notification_preferences — they are
--     already business-ready (brand_id + deep_link columns present).
--
-- SUPABASE DOCS (cited inline per COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS):
--   * Database Functions + triggers:
--       https://supabase.com/docs/guides/database/functions
--   * pg_net (async HTTP from Postgres → edge function):
--       https://supabase.com/docs/guides/database/extensions/pg_net
--   * Vault (decrypted_secrets for project URL + service-role key):
--       https://supabase.com/docs/guides/database/vault
--   * SECURITY DEFINER + search_path lint (function hardening):
--       https://supabase.com/docs/guides/database/database-linter
--
-- MIGRATION PREFIX: 20260910000000 — strictly above the max prefix scanned
-- across main + all sibling worktrees on 2026-06-04 (per parent §3.A.6 LOCKED
-- floor ≥20260910000000).

BEGIN;

-- pg_net advisory (runtime requirement — the trigger registers regardless; the
-- net.http_post call needs pg_net + vault.secrets rows at runtime).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'META-ORCH-1074 advisory: pg_net extension not present. The new_review trigger will register but net.http_post calls will fail at runtime until pg_net is enabled.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'META-ORCH-1074 advisory: vault schema not present. The new_review trigger will register but cannot read supabase_url / service_role_key until vault is configured.';
  END IF;
END$$;

-- =============================================================
-- Trigger function: notify brand managers on an approved place review.
-- =============================================================
-- SECURITY DEFINER so it can read across place_pool → brands and reach vault
-- secrets regardless of the inserting role. search_path pinned to public,
-- pg_temp per the linter rule.
CREATE OR REPLACE FUNCTION public.meta_orch_1074_notify_new_review()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
DECLARE
  v_brand_id      uuid;
  v_brand_name    text;
  v_supabase_url  text;
  v_service_key   text;
  v_recipient     uuid;
BEGIN
  -- Only act when the row is (now) approved. On UPDATE, require an actual
  -- transition INTO approved so re-saving an already-approved row is a no-op.
  IF NEW.moderation_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.moderation_status IS NOT DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;

  -- Resolve the brand that owns the reviewed place_pool (claimed venue).
  -- No place_pool_id, or no claiming brand → nothing to notify.
  IF NEW.place_pool_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.id, b.name
    INTO v_brand_id, v_brand_name
    FROM public.brands b
   WHERE b.place_pool_id = NEW.place_pool_id
     AND b.deleted_at IS NULL
   ORDER BY b.created_at ASC
   LIMIT 1;

  IF v_brand_id IS NULL THEN
    RETURN NEW;  -- unclaimed place — no business to notify.
  END IF;

  -- Vault secrets for the edge invoke. Missing → skip (advisory above).
  SELECT decrypted_secret INTO v_supabase_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'META-ORCH-1074: vault secrets missing; skipping new_review dispatch for review %', NEW.id;
    RETURN NEW;
  END IF;

  -- One notify-dispatch invoke per recipient (owner + admin). notify-dispatch
  -- enforces idempotency per (idempotency_key) so replays collapse.
  FOR v_recipient IN
    SELECT DISTINCT m.user_id
      FROM public.brand_team_members m
     WHERE m.brand_id = v_brand_id
       AND m.removed_at IS NULL
       AND m.accepted_at IS NOT NULL
       AND m.role IN ('brand_owner', 'brand_admin')
  LOOP
    -- pg_net async POST — https://supabase.com/docs/guides/database/extensions/pg_net
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/notify-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'userId', v_recipient,
        'brandId', v_brand_id,
        'type', 'business.new_review',
        'title', 'New review',
        'body', COALESCE(NEW.rating::text, '') ||
                CASE WHEN NEW.rating IS NULL THEN 'A new review came in.'
                     ELSE '★ — see what they said.' END,
        'data', jsonb_build_object(
          'reviewId', NEW.id,
          'rating', NEW.rating,
          'placeOrExperienceId', NEW.place_pool_id,
          'kind', 'place',
          'brandName', COALESCE(v_brand_name, 'your brand')
        ),
        'relatedId', NEW.id,
        'relatedType', 'review',
        'deepLink', 'mingla-business://brand/' || v_brand_id::text || '/listing',
        'idempotencyKey', 'business.new_review:' || NEW.id::text || ':' || v_recipient::text
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.meta_orch_1074_notify_new_review() OWNER TO postgres;

COMMENT ON FUNCTION public.meta_orch_1074_notify_new_review() IS
  'META-ORCH-1074 Sub-A: pg_net-invokes notify-dispatch for business.new_review when a place review reaches moderation_status=approved. Owner+admin recipients; idempotent downstream.';

-- AFTER INSERT OR UPDATE trigger on place_reviews. The function self-gates on
-- approved + transition, so firing on every UPDATE is safe (no spurious sends).
DROP TRIGGER IF EXISTS meta_orch_1074_new_review_notify
  ON public.place_reviews;

CREATE TRIGGER meta_orch_1074_new_review_notify
  AFTER INSERT OR UPDATE OF moderation_status ON public.place_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.meta_orch_1074_notify_new_review();

COMMENT ON TRIGGER meta_orch_1074_new_review_notify ON public.place_reviews IS
  'META-ORCH-1074 Sub-A: fires business.new_review to the owning brand on approved place reviews.';

COMMIT;
