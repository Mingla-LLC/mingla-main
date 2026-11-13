-- #4419 Part A — Admin keeps the exact email that went out.
--
-- When a campaign's first batch starts, admin-send-email renders it once for
-- the fixed sample person (Maya) and stores the subject, preheader, HTML,
-- plain text and the blog-resolved document every later batch sends. After
-- that the copy never changes: a trigger refuses any write to it, for every
-- role, service_role included (RLS cannot: admin_all_email_log is FOR ALL).
--
-- Also: who cancelled a campaign, the Emails list read (one call, derived
-- state, counts per filter, never the stored HTML) and the delivery summary
-- (counts and failure reasons grouped in SQL, so a large send is never cut at
-- the API's row limit). Both reads are service_role only; the edge function
-- checks the caller is on the team (and an admin for anything but scheduled
-- emails) before calling them.
--
-- No backfill: older rows keep no copy and Admin labels them "Rebuilt".

BEGIN;

ALTER TABLE public.admin_email_log
  ADD COLUMN IF NOT EXISTS rendered_subject text,
  ADD COLUMN IF NOT EXISTS rendered_preheader text,
  ADD COLUMN IF NOT EXISTS rendered_html text,
  ADD COLUMN IF NOT EXISTS rendered_text text,
  ADD COLUMN IF NOT EXISTS rendered_document jsonb,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz,
  ADD COLUMN IF NOT EXISTS render_sample jsonb,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.admin_email_log
  DROP CONSTRAINT IF EXISTS admin_email_log_snapshot_all_or_none;
ALTER TABLE public.admin_email_log
  ADD CONSTRAINT admin_email_log_snapshot_all_or_none CHECK (
    (rendered_subject IS NULL AND rendered_preheader IS NULL AND rendered_html IS NULL
      AND rendered_text IS NULL AND rendered_document IS NULL AND rendered_at IS NULL
      AND render_sample IS NULL)
    OR
    (rendered_subject IS NOT NULL AND rendered_preheader IS NOT NULL AND rendered_html IS NOT NULL
      AND rendered_text IS NOT NULL AND rendered_document IS NOT NULL AND rendered_at IS NOT NULL
      AND render_sample IS NOT NULL)
  );

ALTER TABLE public.admin_email_log
  DROP CONSTRAINT IF EXISTS admin_email_log_snapshot_size;
ALTER TABLE public.admin_email_log
  ADD CONSTRAINT admin_email_log_snapshot_size CHECK (
    COALESCE(octet_length(rendered_html), 0) <= 1048576
    AND COALESCE(octet_length(rendered_text), 0) <= 262144
    AND COALESCE(octet_length(rendered_document::text), 0) <= 1048576
  );

COMMENT ON COLUMN public.admin_email_log.rendered_subject IS
  '#4419 exact subject as sent, rendered for the sample person when the first batch started. Never changes after rendered_at.';
COMMENT ON COLUMN public.admin_email_log.rendered_preheader IS
  '#4419 exact inbox preview line as sent (may be empty). Never changes after rendered_at.';
COMMENT ON COLUMN public.admin_email_log.rendered_html IS
  '#4419 exact HTML as sent to a recipient whose profile equals render_sample. Never changes after rendered_at.';
COMMENT ON COLUMN public.admin_email_log.rendered_text IS
  '#4419 exact plain-text part as sent. Never changes after rendered_at.';
COMMENT ON COLUMN public.admin_email_log.rendered_document IS
  '#4419 the blog-resolved, un-personalized document every batch of this campaign sends (the blog post is frozen at send start).';
COMMENT ON COLUMN public.admin_email_log.rendered_at IS
  '#4419 when the copy was saved (the first batch). Null means no copy: not started yet, or sent before #4419.';
COMMENT ON COLUMN public.admin_email_log.render_sample IS
  '#4419 the fixed sample profile the copy was rendered for (Maya). Never a real person.';
COMMENT ON COLUMN public.admin_email_log.cancelled_by IS
  '#4419 the teammate who cancelled this campaign. Null for campaigns cancelled before #4419.';

-- INVARIANT I-4419-EMAIL-SNAPSHOT-IMMUTABLE: once rendered_at is set, the stored copy never changes. Enforced by trigger issue_4419_admin_email_snapshot_immutable; tested by issue_4419_admin_email_snapshot.implementor.pg17.test.sql.
CREATE OR REPLACE FUNCTION public.issue_4419_admin_email_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.rendered_at IS NOT NULL AND (
       NEW.rendered_at IS DISTINCT FROM OLD.rendered_at
    OR NEW.rendered_subject IS DISTINCT FROM OLD.rendered_subject
    OR NEW.rendered_preheader IS DISTINCT FROM OLD.rendered_preheader
    OR NEW.rendered_html IS DISTINCT FROM OLD.rendered_html
    OR NEW.rendered_text IS DISTINCT FROM OLD.rendered_text
    OR NEW.rendered_document IS DISTINCT FROM OLD.rendered_document
    OR NEW.render_sample IS DISTINCT FROM OLD.render_sample
  ) THEN
    RAISE EXCEPTION 'admin_email_snapshot_immutable' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_admin_email_snapshot_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4419_admin_email_snapshot_immutable ON public.admin_email_log;
CREATE TRIGGER issue_4419_admin_email_snapshot_immutable
BEFORE UPDATE ON public.admin_email_log
FOR EACH ROW
EXECUTE FUNCTION public.issue_4419_admin_email_snapshot_immutable();

-- The Emails list. State is derived here once (the edge function's
-- campaignState says the same): queued counts as sending because a campaign
-- between batches is queued. Non-admins (p_admin false) see scheduled emails
-- only, as before #4419 (Seth, 13 Nov: only admins see sent emails).
-- Never returns rendered_html, rendered_text, rendered_document or the body.
CREATE OR REPLACE FUNCTION public.issue_4419_admin_email_list(
  p_filter text,
  p_query text,
  p_admin boolean,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH base AS (
    SELECT l.*,
      CASE
        WHEN l.status = 'scheduled' THEN 'scheduled'
        WHEN l.status IN ('sending', 'queued') THEN 'sending'
        WHEN l.status IN ('completed', 'sent') THEN 'sent'
        WHEN l.status = 'partial' THEN 'partial'
        WHEN l.status = 'failed' THEN 'failed'
        WHEN l.status = 'cancelled' THEN 'cancelled'
        ELSE 'unknown'
      END AS state
    FROM public.admin_email_log l
    WHERE COALESCE(p_admin, false) OR l.status = 'scheduled'
  ), searched AS (
    SELECT * FROM base
    WHERE NULLIF(p_query, '') IS NULL OR base.subject ILIKE p_query ESCAPE '\'
  ), filtered AS (
    SELECT * FROM searched
    WHERE CASE COALESCE(p_filter, 'all')
      WHEN 'all' THEN true
      WHEN 'attention' THEN searched.state IN ('partial', 'failed')
      ELSE searched.state = p_filter
    END
  ), page AS (
    SELECT f.*,
      row_number() OVER (ORDER BY (f.state = 'scheduled') DESC,
        CASE WHEN f.state = 'scheduled' THEN f.scheduled_for END ASC NULLS LAST,
        COALESCE(f.started_at, f.created_at) DESC, f.id) AS position
    FROM filtered f
    ORDER BY position
    LIMIT GREATEST(LEAST(COALESCE(p_limit, 20), 100), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'subject', p.subject,
        'status', p.status,
        'state', p.state,
        'preheader', COALESCE(p.rendered_preheader, left(p.body, 90)),
        'thumb_url', (
          SELECT COALESCE(b->>'url', b->'snapshot'->>'coverUrl', b->>'coverUrl')
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(COALESCE(p.rendered_document, p.body_document)->'blocks') = 'array'
                THEN COALESCE(p.rendered_document, p.body_document)->'blocks'
              WHEN jsonb_typeof(COALESCE(p.rendered_document, p.body_document)) = 'array'
                THEN COALESCE(p.rendered_document, p.body_document)
              ELSE '[]'::jsonb
            END) WITH ORDINALITY AS blocks(b, n)
          WHERE (b->>'type' = 'image' AND b->>'url' LIKE 'https://%')
             OR (b->>'type' = 'blog_post' AND b->'snapshot'->>'coverUrl' LIKE 'https://%')
             OR (b->>'type' = 'blog_post_resolved' AND b->>'coverUrl' LIKE 'https://%')
          ORDER BY n
          LIMIT 1
        ),
        'audience', CASE WHEN jsonb_typeof(p.audience) = 'object' THEN p.audience - 'email' ELSE NULL END,
        'segment_filter', p.segment_filter,
        'recipient_type', p.recipient_type,
        'recipient_email', CASE WHEN p.recipient_type = 'individual' THEN p.recipient_email END,
        'by_name', public.issue_4383_person_label(p.sent_by),
        'scheduled_for', p.scheduled_for,
        'timezone', p.timezone,
        'created_at', p.created_at,
        'started_at', p.started_at,
        'completed_at', p.completed_at,
        'matched', p.matched_count,
        'recipient_count', p.recipient_count,
        'skipped_count', p.skipped_count,
        'accepted', p.sent_count,
        'failed', p.failed_count,
        'has_snapshot', p.rendered_at IS NOT NULL
      ) ORDER BY p.position)
      FROM page p
    ), '[]'::jsonb),
    'counts', (
      SELECT jsonb_build_object(
        'all', count(*),
        'scheduled', count(*) FILTER (WHERE s.state = 'scheduled'),
        'sending', count(*) FILTER (WHERE s.state = 'sending'),
        'sent', count(*) FILTER (WHERE s.state = 'sent'),
        'attention', count(*) FILTER (WHERE s.state IN ('partial', 'failed')),
        'cancelled', count(*) FILTER (WHERE s.state = 'cancelled')
      ) FROM searched s
    ),
    'total', (SELECT count(*) FROM filtered)
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_admin_email_list(text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_admin_email_list(text, text, boolean, integer, integer)
  TO service_role;

-- One campaign's delivery counts and why sends failed, grouped here so a
-- campaign of any size reads in one row. The codes match the edge function's
-- deliveryFailureCode() and Admin's lib/emailFailureWords.js.
CREATE OR REPLACE FUNCTION public.issue_4419_admin_email_delivery_summary(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH d AS (
    SELECT status, last_error, created_at, id
    FROM public.admin_email_recipient_deliveries
    WHERE campaign_id = p_campaign_id
  ), failures AS (
    SELECT
      CASE
        WHEN last_error ~ '^Resend 429' THEN 'rate_limited'
        WHEN last_error ~ '^Resend 40[13]' THEN 'provider_key'
        WHEN last_error ~ '^Resend 422' THEN 'invalid_address'
        WHEN last_error ~ '^Resend 5[0-9][0-9]'
          OR last_error ~* '(timed out|timeout|fetch failed|network|connection (reset|refused|closed))'
          THEN 'provider_down'
        ELSE 'other'
      END AS code,
      last_error, created_at, id
    FROM d
    WHERE status IN ('failed', 'retrying') AND last_error IS NOT NULL
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM d),
    'accepted', (SELECT count(*) FROM d WHERE status = 'accepted'),
    'failed', (SELECT count(*) FROM d WHERE status = 'failed'),
    'pending', (SELECT count(*) FROM d WHERE status IN ('pending', 'sending', 'retrying')),
    'skipped_late', (SELECT count(*) FROM d WHERE status = 'skipped_opt_out'),
    'by_reason', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', g.code, 'count', g.n) ORDER BY g.n DESC, g.code)
      FROM (SELECT code, count(*) AS n FROM failures GROUP BY code) g
    ), '[]'::jsonb),
    'raw', (SELECT left(last_error, 300) FROM failures ORDER BY created_at, id LIMIT 1)
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_admin_email_delivery_summary(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_admin_email_delivery_summary(uuid)
  TO service_role;

COMMIT;
