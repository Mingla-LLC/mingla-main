-- Issue #1614: restore PostgREST-compatible arbiters and give Business
-- per-type notification preferences a schema distinct from the legacy coarse
-- notification_preferences relation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  v_partial_index text;
  v_full_arbiters integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.place_pool
    WHERE google_place_id IS NOT NULL
    GROUP BY google_place_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'issue_1614_place_pool_duplicate_google_place_id';
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO v_partial_index
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'public.place_pool'::regclass
    AND c.relname = 'idx_place_pool_google_place_id_nonnull_unique';
  IF v_partial_index IS NULL
     OR v_partial_index !~ 'UNIQUE INDEX .* ON public\.place_pool.*\(google_place_id\) WHERE \(google_place_id IS NOT NULL\)$' THEN
    RAISE EXCEPTION 'issue_1614_unexpected_place_pool_partial_index: %', v_partial_index;
  END IF;

  SELECT count(*) INTO v_full_arbiters
  FROM pg_index i
  WHERE i.indrelid = 'public.place_pool'::regclass
    AND i.indisunique
    AND i.indpred IS NULL
    AND i.indnkeyatts = 1
    AND (SELECT array_agg(a.attname ORDER BY k.ordinality)
         FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ordinality)
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         WHERE k.ordinality <= i.indnkeyatts) = ARRAY['google_place_id']::name[];
  IF v_full_arbiters <> 0 THEN
    RAISE EXCEPTION 'issue_1614_unexpected_place_pool_full_arbiter_count: %', v_full_arbiters;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.person_card_impressions
    WHERE (person_id IS NULL) = (paired_user_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'issue_1614_invalid_impression_subject_shape';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.person_card_impressions
    WHERE paired_user_id IS NOT NULL
    GROUP BY user_id, paired_user_id, place_pool_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'issue_1614_duplicate_paired_impressions';
  END IF;
END
$preflight$;

ALTER TABLE public.place_pool
  ADD CONSTRAINT place_pool_google_place_id_key UNIQUE (google_place_id);
DROP INDEX public.idx_place_pool_google_place_id_nonnull_unique;

ALTER TABLE public.person_card_impressions
  ALTER COLUMN person_id DROP NOT NULL,
  ADD CONSTRAINT person_card_impressions_exactly_one_subject_check
    CHECK ((person_id IS NOT NULL) <> (paired_user_id IS NOT NULL)) NOT VALID;
ALTER TABLE public.person_card_impressions
  VALIDATE CONSTRAINT person_card_impressions_exactly_one_subject_check;
ALTER TABLE public.person_card_impressions
  ADD CONSTRAINT person_card_impressions_paired_user_key
    UNIQUE (user_id, paired_user_id, place_pool_id);
DROP INDEX public.idx_person_place_impressions_paired_user;

CREATE TABLE public.business_notification_type_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'in_app')),
  type text NOT NULL CHECK (type IN (
    'business.order_paid',
    'business.event_sold_out',
    'business.low_inventory',
    'business.refund_processed',
    'business.dispute_opened',
    'business.dispute_action_needed',
    'business.payout_paid',
    'business.account_status_changed',
    'business.new_review',
    'business.claim_decision',
    'business.team_member_joined'
  )),
  opt_in boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_notification_type_preferences_user_channel_type_key
    UNIQUE (user_id, channel, type)
);

CREATE TRIGGER business_notification_type_preferences_updated_at
  BEFORE UPDATE ON public.business_notification_type_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_notification_preferences_updated_at();

ALTER TABLE public.business_notification_type_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_notification_type_preferences_select_own
  ON public.business_notification_type_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY business_notification_type_preferences_insert_own
  ON public.business_notification_type_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY business_notification_type_preferences_update_own
  ON public.business_notification_type_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY business_notification_type_preferences_delete_own
  ON public.business_notification_type_preferences FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.business_notification_type_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.business_notification_type_preferences TO authenticated;

CREATE INDEX idx_business_notification_type_preferences_user_type
  ON public.business_notification_type_preferences (user_id, type);

ALTER TABLE public.notifications
  ADD COLUMN in_app_suppressed_at timestamptz;

CREATE INDEX idx_notifications_business_in_app_visible
  ON public.notifications (user_id, created_at DESC)
  WHERE deleted_at IS NULL AND in_app_suppressed_at IS NULL;

COMMIT;
