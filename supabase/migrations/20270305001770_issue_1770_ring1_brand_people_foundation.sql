-- Issue #1770, parent #876, prerequisite #873.
-- Dark Ring-1 brand-person, invitation, delivery, suppression, and export substrate.
-- #876/#873 SOURCE FAIL-OPEN — identity/invite failures must never roll back RSVP/payment.

BEGIN;

INSERT INTO public.notification_categories
  (key,section,is_transactional,urgency,default_channels,reach_mode,active)
VALUES
  ('offering_invitation','Marketing',false,'low',ARRAY['email','push','sms'],'reach_once',true)
ON CONFLICT(key) DO UPDATE SET
  section=EXCLUDED.section,
  is_transactional=EXCLUDED.is_transactional,
  urgency=EXCLUDED.urgency,
  default_channels=EXCLUDED.default_channels,
  reach_mode=EXCLUDED.reach_mode,
  active=true;

CREATE OR REPLACE FUNCTION public.issue_1770_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TABLE public.brand_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  linked_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  avatar_url text NULL,
  record_status text NOT NULL DEFAULT 'active'
    CHECK (record_status IN ('active','merged','deleted')),
  merged_into_person_id uuid NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT brand_people_status_shape CHECK (
    (record_status = 'active' AND merged_into_person_id IS NULL AND deleted_at IS NULL)
    OR (record_status = 'merged' AND merged_into_person_id IS NOT NULL
        AND merged_into_person_id <> id AND deleted_at IS NULL)
    OR (record_status = 'deleted' AND merged_into_person_id IS NULL AND deleted_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX brand_people_active_user_uniq
  ON public.brand_people(brand_id, linked_user_id)
  WHERE record_status = 'active' AND linked_user_id IS NOT NULL;
CREATE INDEX brand_people_brand_status_updated_idx
  ON public.brand_people(brand_id, record_status, updated_at DESC);
CREATE INDEX brand_people_merge_target_idx
  ON public.brand_people(merged_into_person_id)
  WHERE merged_into_person_id IS NOT NULL;

CREATE TABLE public.brand_offering_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  origin text NOT NULL CHECK (origin IN ('attached_blast','wizard','backfill_explicit')),
  removal_reason text NULL CHECK (removal_reason IS NULL OR removal_reason IN ('host_removed','identity_merge')),
  superseded_by_invite_id uuid NULL REFERENCES public.brand_offering_invites(id) ON DELETE RESTRICT,
  invited_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_offering_invites_state_shape CHECK (
    (status = 'active' AND removed_at IS NULL AND removal_reason IS NULL AND superseded_by_invite_id IS NULL)
    OR (status = 'removed' AND removed_at IS NOT NULL AND removal_reason IS NOT NULL)
  ),
  CONSTRAINT brand_offering_invites_not_self_superseded CHECK (superseded_by_invite_id IS NULL OR superseded_by_invite_id <> id),
  UNIQUE(event_id, brand_person_id)
);
CREATE INDEX brand_offering_invites_brand_event_idx
  ON public.brand_offering_invites(brand_id, event_id, status);

CREATE TABLE public.brand_person_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('event_rsvp','rsvp_plus_one','order','ticket_holder','reservation','manual','import')),
  source_id uuid NOT NULL,
  offering_invite_id uuid NULL REFERENCES public.brand_offering_invites(id) DEFERRABLE INITIALLY DEFERRED,
  link_method text NOT NULL CHECK (link_method IN ('authenticated_user','invite_token','normalized_address','manual_resolution','historical_safe_match')),
  source_occurred_at timestamptz NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brand_person_source_links_active_source_uniq
  ON public.brand_person_source_links(source_kind, source_id)
  WHERE detached_at IS NULL;
CREATE INDEX brand_person_source_links_person_idx
  ON public.brand_person_source_links(brand_person_id, source_occurred_at DESC)
  WHERE detached_at IS NULL;

CREATE TABLE public.brand_person_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  normalized_name text NOT NULL CHECK (length(btrim(normalized_name)) > 0),
  name_kind text NOT NULL CHECK (name_kind IN ('primary','alternate')),
  source_link_id uuid NULL REFERENCES public.brand_person_source_links(id) DEFERRABLE INITIALLY DEFERRED,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  CONSTRAINT brand_person_names_active_shape CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX brand_person_names_active_value_uniq
  ON public.brand_person_names(brand_person_id, normalized_name) WHERE active;
CREATE UNIQUE INDEX brand_person_names_one_primary_uniq
  ON public.brand_person_names(brand_person_id) WHERE active AND name_kind = 'primary';

CREATE TABLE public.brand_person_contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email','phone')),
  normalized_value text NOT NULL CHECK (length(btrim(normalized_value)) > 0),
  provenance_scope text NOT NULL CHECK (provenance_scope IN ('brand_owned','graph_only')),
  is_exportable boolean NOT NULL DEFAULT false,
  suppression_eligible boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  record_state text NOT NULL DEFAULT 'active' CHECK (record_state IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  CONSTRAINT brand_person_contact_state_shape CHECK (
    (record_state = 'active' AND retired_at IS NULL) OR (record_state = 'retired' AND retired_at IS NOT NULL)
  ),
  CONSTRAINT brand_person_graph_contact_private CHECK (provenance_scope <> 'graph_only' OR is_exportable = false)
);
CREATE UNIQUE INDEX brand_person_contact_methods_active_value_uniq
  ON public.brand_person_contact_methods(brand_person_id, channel, normalized_value)
  WHERE record_state = 'active';
CREATE UNIQUE INDEX brand_person_contact_methods_one_primary_uniq
  ON public.brand_person_contact_methods(brand_person_id, channel)
  WHERE record_state = 'active' AND is_primary;
CREATE INDEX brand_person_contact_methods_brand_lookup_idx
  ON public.brand_person_contact_methods(brand_id, channel, normalized_value)
  WHERE record_state = 'active';

CREATE TABLE public.brand_person_contact_method_sources (
  contact_method_id uuid NOT NULL REFERENCES public.brand_person_contact_methods(id) ON DELETE RESTRICT,
  source_link_id uuid NOT NULL REFERENCES public.brand_person_source_links(id) ON DELETE RESTRICT,
  provenance_kind text NOT NULL CHECK (provenance_kind IN ('rsvp','order','ticket','reservation','manual','import')),
  exportable boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  PRIMARY KEY(contact_method_id, source_link_id),
  CONSTRAINT brand_person_contact_sources_state_shape CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL))
);

CREATE TABLE public.brand_person_identity_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('event_rsvp','rsvp_plus_one','order','ticket_holder','reservation','manual','import')),
  source_id uuid NOT NULL,
  candidate_person_ids uuid[] NOT NULL DEFAULT '{}',
  reason text NOT NULL CHECK (reason IN ('different_nonempty_names','multi_person_address_chain','manual_review')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved_merge','resolved_separate')),
  resolved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_person_conflict_resolution_shape CHECK ((status = 'open' AND resolved_at IS NULL) OR (status <> 'open' AND resolved_at IS NOT NULL)),
  UNIQUE(source_kind, source_id, status)
);

CREATE TABLE public.brand_person_merge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  winner_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  loser_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('normalized_address','authenticated_user','manual_resolution')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  evidence_source_link_id uuid NULL REFERENCES public.brand_person_source_links(id) ON DELETE RESTRICT,
  reversal_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  acted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_person_merge_not_self CHECK (winner_person_id <> loser_person_id),
  CONSTRAINT brand_person_merge_reversal_shape CHECK ((status = 'active' AND reversed_at IS NULL) OR (status = 'reversed' AND reversed_at IS NOT NULL))
);
CREATE UNIQUE INDEX brand_person_merge_active_loser_uniq
  ON public.brand_person_merge_events(loser_person_id) WHERE status = 'active';

CREATE TABLE public.brand_person_channel_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  scope text NOT NULL CHECK (scope IN ('marketing','all')),
  reason text NOT NULL,
  origin_table text NOT NULL,
  origin_id uuid NULL,
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz NULL,
  lifted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brand_person_channel_suppressions_active_uniq
  ON public.brand_person_channel_suppressions(brand_person_id, channel, scope)
  WHERE lifted_at IS NULL;

CREATE TABLE public.brand_offering_invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.brand_offering_invites(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  contact_method_id uuid NULL REFERENCES public.brand_person_contact_methods(id) ON DELETE RESTRICT,
  linked_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  derivation_version smallint NOT NULL DEFAULT 1 CHECK (derivation_version = 1),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_offering_invite_tokens_one_target CHECK (
    ((contact_method_id IS NOT NULL)::int + (linked_user_id IS NOT NULL)::int = 1)
    OR (revoked_at IS NOT NULL AND contact_method_id IS NULL AND linked_user_id IS NULL)
  )
);

CREATE OR REPLACE FUNCTION public.issue_1770_channels_valid(p_channels text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT cardinality(p_channels) > 0
    AND p_channels <@ ARRAY['email','sms','push']::text[]
    AND cardinality(p_channels) = (SELECT count(DISTINCT x) FROM unnest(p_channels) x)
    AND p_channels = (SELECT array_agg(x ORDER BY x) FROM unnest(p_channels) x)
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_frame(p_value text)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT CASE WHEN p_value IS NULL THEN decode('00','hex')
    ELSE decode('01','hex')||int4send(octet_length(convert_to(p_value,'UTF8')))||convert_to(p_value,'UTF8') END
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_json_keys(p_value jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT COALESCE(array_agg(k ORDER BY k),'{}') FROM jsonb_object_keys(p_value) k
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_push_payload_valid(
  p_payload jsonb,p_event_id uuid,p_hash text
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, extensions, pg_temp AS $function$
DECLARE v_bytes bytea; v_computed text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR public.issue_1770_json_keys(p_payload)<>ARRAY['body','eventId','payloadHash','payloadVersion','title']::text[]
    OR p_payload->>'payloadVersion'<>'1' OR p_payload->>'eventId'<>p_event_id::text
    OR COALESCE(p_payload->>'payloadHash','')!~'^[0-9a-f]{64}$'
    OR p_hash IS DISTINCT FROM p_payload->>'payloadHash'
    OR octet_length(convert_to(p_payload->>'title','UTF8'))>200
    OR octet_length(convert_to(p_payload->>'body','UTF8'))>10000
    OR p_payload::text~'(?i)(oi=|javascript:|data:|http://|__MINGLA_OFFERING_INVITE_URL_V1__)'
    OR p_payload::text~E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]'
    OR regexp_replace(p_payload::text,'https://(business\\.usemingla\\.com|cdn\\.usemingla\\.com|mingla\\.app|usemingla\\.com|www\\.usemingla\\.com)','', 'gi')~'(?i)https://'
  THEN RETURN false; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')
    ||public.issue_1770_frame('push')||public.issue_1770_frame('1')
    ||public.issue_1770_frame(p_payload->>'title')||public.issue_1770_frame(p_payload->>'body')
    ||public.issue_1770_frame(p_event_id::text);
  v_computed:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  RETURN v_computed=p_hash;
END;
$function$;

CREATE TABLE public.marketing_send_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('invitation','reminder','retry_delivery')),
  client_request_id uuid NOT NULL,
  channels text[] NOT NULL,
  selection_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_count integer NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  reachable_count integer NOT NULL DEFAULT 0 CHECK (reachable_count >= 0),
  suppressed_count integer NOT NULL DEFAULT 0 CHECK (suppressed_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  queued_count integer NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  estimated_cost_minor bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_minor >= 0),
  actual_cost_minor bigint NULL CHECK (actual_cost_minor IS NULL OR actual_cost_minor >= 0),
  currency char(3) NULL,
  eligibility_hash text NOT NULL CHECK (eligibility_hash ~ '^[0-9a-f]{64}$'),
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  quote_schema_version smallint NOT NULL DEFAULT 1 CHECK (quote_schema_version = 1),
  quoted_at timestamptz NOT NULL,
  execution_snapshot_hash text NOT NULL CHECK (execution_snapshot_hash ~ '^[0-9a-f]{64}$'),
  push_payload_v1 jsonb NULL,
  push_payload_hash text NULL CHECK (push_payload_hash IS NULL OR push_payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','partial','completed','failed','cancelled')),
  last_safe_error_code text NULL,
  created_by uuid NOT NULL,
  created_by_erased_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  CONSTRAINT marketing_send_groups_channels_check CHECK (public.issue_1770_channels_valid(channels)),
  CONSTRAINT marketing_send_groups_push_payload_check CHECK (
    (('push'=ANY(channels)) AND push_payload_v1 IS NOT NULL AND push_payload_hash IS NOT NULL
      AND public.issue_1770_push_payload_valid(push_payload_v1,event_id,push_payload_hash))
    OR (NOT ('push'=ANY(channels)) AND push_payload_v1 IS NULL AND push_payload_hash IS NULL)
  ),
  CONSTRAINT marketing_send_groups_cost_currency CHECK ((estimated_cost_minor = 0 AND COALESCE(actual_cost_minor,0) = 0) OR currency IS NOT NULL),
  UNIQUE(brand_id, client_request_id)
);

CREATE OR REPLACE FUNCTION public.issue_1770_push_payload_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.push_payload_v1 IS DISTINCT FROM OLD.push_payload_v1
    OR NEW.push_payload_hash IS DISTINCT FROM OLD.push_payload_hash THEN
    RAISE EXCEPTION 'offering_push_payload_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_push_payload_immutable
  BEFORE UPDATE OF push_payload_v1,push_payload_hash ON public.marketing_send_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_1770_push_payload_immutable();

CREATE TABLE public.marketing_send_group_campaigns (
  send_group_id uuid NOT NULL REFERENCES public.marketing_send_groups(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  PRIMARY KEY(send_group_id, campaign_id),
  UNIQUE(campaign_id)
);

ALTER TABLE public.marketing_audiences DROP CONSTRAINT marketing_audiences_query_kind_valid;
ALTER TABLE public.marketing_audiences ADD CONSTRAINT marketing_audiences_query_kind_valid CHECK (
  jsonb_typeof(query_definition) = 'object'
  AND (query_definition->>'kind') IN ('brand_buyers','event_buyers','brand_followers','custom_segment','offering_send_group')
);

CREATE TABLE public.brand_offering_invite_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.brand_offering_invites(id) ON DELETE RESTRICT,
  send_group_id uuid NOT NULL REFERENCES public.marketing_send_groups(id) ON DELETE RESTRICT,
  campaign_id uuid NULL REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  marketing_message_id uuid NULL REFERENCES public.marketing_messages(id) ON DELETE RESTRICT,
  contact_method_id uuid NULL REFERENCES public.brand_person_contact_methods(id) ON DELETE RESTRICT,
  recipient_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_erased_at timestamptz NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','push')),
  attempt_kind text NOT NULL CHECK (attempt_kind IN ('initial','reminder','retry')),
  attempt_ordinal smallint NOT NULL DEFAULT 1 CHECK (attempt_ordinal > 0),
  retry_of_attempt_id uuid NULL UNIQUE REFERENCES public.brand_offering_invite_delivery_attempts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','failed','suppressed')),
  is_retryable boolean NOT NULL DEFAULT false,
  safe_reason_code text NULL,
  provider_message_id text NULL,
  provider_app_id uuid NULL,
  provider_accepted_at timestamptz NULL,
  provider_io_claimed_at timestamptz NULL,
  provider_idempotency_key text NULL UNIQUE CHECK (
    provider_idempotency_key IS NULL OR provider_idempotency_key ~ '^offering:[0-9a-f-]{36}:(email|sms|push):v1$'
  ),
  estimated_cost_minor bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_minor >= 0),
  actual_cost_minor bigint NULL CHECK (actual_cost_minor IS NULL OR actual_cost_minor >= 0),
  currency char(3) NULL,
  next_attempt_at timestamptz NULL,
  queued_at timestamptz NULL DEFAULT now(),
  sent_at timestamptz NULL,
  delivered_at timestamptz NULL,
  failed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_invite_attempt_one_target CHECK (
    (channel IN ('email','sms') AND contact_method_id IS NOT NULL AND recipient_user_id IS NULL)
    OR (channel = 'push' AND contact_method_id IS NULL AND (
      recipient_user_id IS NOT NULL OR recipient_erased_at IS NOT NULL
    ))
  ),
  CONSTRAINT brand_invite_attempt_cost_currency CHECK ((estimated_cost_minor = 0 AND COALESCE(actual_cost_minor,0) = 0) OR currency IS NOT NULL),
  CONSTRAINT brand_invite_attempt_push_message_uuid CHECK (
    channel<>'push' OR provider_message_id IS NULL OR
    provider_message_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT brand_invite_attempt_retry_shape CHECK (
    (attempt_kind='retry' AND retry_of_attempt_id IS NOT NULL)
    OR (attempt_kind IN ('initial','reminder') AND retry_of_attempt_id IS NULL)
  ),
  UNIQUE(send_group_id, invite_id, channel, attempt_ordinal)
);
CREATE UNIQUE INDEX brand_invite_attempt_global_ordinal_uniq
  ON public.brand_offering_invite_delivery_attempts(invite_id,channel,attempt_ordinal);
CREATE UNIQUE INDEX brand_invite_attempt_onesignal_message_uniq
  ON public.brand_offering_invite_delivery_attempts(provider_app_id,provider_message_id)
  WHERE channel='push' AND provider_app_id IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE TABLE public.offering_push_provider_events (
  event_id uuid PRIMARY KEY,
  attempt_id uuid NULL REFERENCES public.brand_offering_invite_delivery_attempts(id) ON DELETE RESTRICT,
  provider_app_id uuid NULL,
  provider_message_id uuid NULL,
  evidence_kind text NULL CHECK (evidence_kind IS NULL OR evidence_kind IN ('sent','received','failed')),
  provider_occurred_at timestamptz NULL,
  disposition text NOT NULL CHECK (disposition IN ('applied','ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch','ignored_erased','ignored_before_claim','ignored_future')),
  safe_reason_code text NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check CHECK (status IN
    ('queued','sending','sent','delivered','undelivered','failed','suppressed','skipped'));
ALTER TABLE public.notification_deliveries ADD COLUMN provider_app_id uuid NULL;
DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.notification_deliveries WHERE notification_id IS NOT NULL
    GROUP BY notification_id,channel HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'notification_deliveries_duplicate_preflight'; END IF;
END $block$;
CREATE UNIQUE INDEX notification_deliveries_notification_channel_uniq
  ON public.notification_deliveries(notification_id,channel) WHERE notification_id IS NOT NULL;
CREATE UNIQUE INDEX notification_deliveries_onesignal_message_uniq
  ON public.notification_deliveries(provider_app_id,provider_message_id)
  WHERE channel='push' AND provider_app_id IS NOT NULL AND provider_message_id IS NOT NULL;

ALTER TABLE public.brand_offering_invite_tokens
  ADD COLUMN delivery_attempt_id uuid NOT NULL UNIQUE
    REFERENCES public.brand_offering_invite_delivery_attempts(id) ON DELETE RESTRICT;

CREATE TABLE public.brand_person_ingest_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('event_rsvp','rsvp_plus_one','order','ticket_holder')),
  source_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','retire')),
  revision_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retryable','done','dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  last_safe_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brand_person_ingest_outbox_active_revision_uniq
  ON public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  WHERE status IN ('pending','processing','retryable');
CREATE INDEX brand_person_ingest_outbox_due_idx
  ON public.brand_person_ingest_outbox(next_attempt_at, created_at)
  WHERE status IN ('pending','retryable');

CREATE TABLE public.brand_people_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  export_kind text NOT NULL CHECK (export_kind IN ('brand_book','offering_guest_roster')),
  scope_id uuid NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  filter_hash text NOT NULL,
  client_request_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','failed','expired')),
  storage_path text NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  omitted_person_count integer NOT NULL DEFAULT 0 CHECK (omitted_person_count >= 0),
  omitted_field_count integer NOT NULL DEFAULT 0 CHECK (omitted_field_count >= 0),
  expires_at timestamptz NULL,
  safe_error_code text NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  locked_by uuid NULL,
  last_heartbeat_at timestamptz NULL,
  prepared_storage_path text NULL,
  prepared_row_count integer NULL CHECK (prepared_row_count IS NULL OR prepared_row_count>=0),
  prepared_checksum text NULL CHECK (prepared_checksum IS NULL OR prepared_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_people_export_scope_shape CHECK (
    (export_kind = 'brand_book' AND scope_id IS NULL)
    OR (export_kind = 'offering_guest_roster' AND scope_id IS NOT NULL)
  ),
  UNIQUE(brand_id, client_request_id)
);

CREATE TABLE public.brand_people_export_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.brand_people_export_jobs(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL,
  export_kind text NOT NULL CHECK (export_kind IN ('brand_book','offering_guest_roster')),
  scope_id uuid NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  provenance_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='public') THEN
    INSERT INTO storage.buckets(id,name,public) VALUES('brand-people-exports','brand-people-exports',false)
      ON CONFLICT(id) DO UPDATE SET public=false;
  ELSE
    INSERT INTO storage.buckets(id,name) VALUES('brand-people-exports','brand-people-exports') ON CONFLICT(id) DO NOTHING;
  END IF;
END;
$block$;

DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brand_people','brand_person_names','brand_person_source_links',
    'brand_person_contact_methods','brand_person_contact_method_sources',
    'brand_person_identity_conflicts','brand_person_merge_events',
    'brand_person_channel_suppressions','brand_offering_invites',
    'brand_offering_invite_tokens','marketing_send_groups',
    'marketing_send_group_campaigns','brand_offering_invite_delivery_attempts',
    'brand_person_ingest_outbox','brand_people_export_jobs','brand_people_export_audit',
    'offering_push_provider_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
  ALTER TABLE public.offering_push_provider_events FORCE ROW LEVEL SECURITY;
END;
$block$;

CREATE OR REPLACE FUNCTION public.issue_1770_normalize_email(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_value,''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      THEN lower(btrim(p_value))
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_normalize_phone(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN regexp_replace(COALESCE(p_value,''), '[^0-9+]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$'
      THEN regexp_replace(p_value, '[^0-9+]', '', 'g')
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_validate_person_merge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE v_target_brand uuid; v_cursor uuid; v_depth integer := 0;
BEGIN
  IF NEW.record_status <> 'merged' THEN RETURN NEW; END IF;
  SELECT brand_id INTO v_target_brand FROM public.brand_people WHERE id = NEW.merged_into_person_id;
  IF v_target_brand IS DISTINCT FROM NEW.brand_id THEN
    RAISE EXCEPTION 'brand_person_cross_brand_merge' USING ERRCODE = '23514';
  END IF;
  v_cursor := NEW.merged_into_person_id;
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.id THEN RAISE EXCEPTION 'brand_person_merge_cycle' USING ERRCODE = '23514'; END IF;
    v_depth := v_depth + 1;
    IF v_depth > 32 THEN RAISE EXCEPTION 'brand_person_merge_depth_exceeded' USING ERRCODE = '54001'; END IF;
    SELECT merged_into_person_id INTO v_cursor FROM public.brand_people WHERE id = v_cursor;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.brand_people WHERE id = NEW.merged_into_person_id AND record_status = 'active') THEN
    RAISE EXCEPTION 'brand_person_merge_target_not_active' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE CONSTRAINT TRIGGER issue_1770_validate_person_merge
  AFTER INSERT OR UPDATE OF record_status, merged_into_person_id ON public.brand_people
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_validate_person_merge();

CREATE OR REPLACE FUNCTION public.issue_1770_validate_invite_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.brand_people p ON p.id = NEW.brand_person_id
    WHERE e.id = NEW.event_id AND e.brand_id = NEW.brand_id AND p.brand_id = NEW.brand_id
  ) THEN RAISE EXCEPTION 'offering_invite_scope_mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$function$;
CREATE CONSTRAINT TRIGGER issue_1770_validate_invite_scope
  AFTER INSERT OR UPDATE OF brand_id,event_id,brand_person_id ON public.brand_offering_invites
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_validate_invite_scope();

CREATE OR REPLACE FUNCTION public.issue_1770_delivery_attempt_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE v_old_rank integer; v_new_rank integer;
BEGIN
  IF ROW(NEW.invite_id,NEW.send_group_id,NEW.channel,NEW.attempt_kind,NEW.attempt_ordinal,
         NEW.retry_of_attempt_id,NEW.contact_method_id)
     IS DISTINCT FROM ROW(OLD.invite_id,OLD.send_group_id,OLD.channel,OLD.attempt_kind,OLD.attempt_ordinal,
         OLD.retry_of_attempt_id,OLD.contact_method_id) THEN
    RAISE EXCEPTION 'delivery_attempt_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id AND NOT (
    OLD.recipient_user_id IS NOT NULL AND NEW.recipient_user_id IS NULL
    AND current_setting('mingla.issue1770_erasure_user',true)=OLD.recipient_user_id::text
  ) THEN RAISE EXCEPTION 'delivery_attempt_identity_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.recipient_erased_at IS DISTINCT FROM OLD.recipient_erased_at AND NOT (
    OLD.recipient_erased_at IS NULL AND NEW.recipient_erased_at IS NOT NULL
    AND current_setting('mingla.issue1770_erasure_user',true)=OLD.recipient_user_id::text
  ) THEN RAISE EXCEPTION 'delivery_attempt_identity_immutable' USING ERRCODE='23514'; END IF;
  IF OLD.provider_idempotency_key IS NOT NULL
     AND NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key THEN
    RAISE EXCEPTION 'delivery_attempt_provider_key_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_app_id IS NOT NULL AND NEW.provider_app_id IS DISTINCT FROM OLD.provider_app_id
    OR OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
    OR OLD.provider_accepted_at IS NOT NULL AND NEW.provider_accepted_at IS DISTINCT FROM OLD.provider_accepted_at
    OR OLD.provider_io_claimed_at IS NOT NULL AND NEW.provider_io_claimed_at IS DISTINCT FROM OLD.provider_io_claimed_at THEN
    RAISE EXCEPTION 'delivery_attempt_provider_identity_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.channel='push' AND OLD.status='queued' AND NEW.status IN ('failed','suppressed')
    AND current_setting('mingla.issue1770_push_result_rpc',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'offering_push_preclaim_result_owner_required' USING ERRCODE='23514';
  END IF;
  IF NOT (CASE OLD.status
    WHEN 'queued' THEN NEW.status IN ('queued','sending','suppressed','failed')
    WHEN 'sending' THEN NEW.status IN ('sending','failed','sent','delivered')
    WHEN 'failed' THEN NEW.status='failed' OR (OLD.channel='push' AND NEW.status IN ('sent','delivered'))
    WHEN 'sent' THEN NEW.status IN ('sent','delivered')
    WHEN 'delivered' THEN NEW.status='delivered'
    WHEN 'suppressed' THEN NEW.status='suppressed'
    ELSE false END) THEN
    RAISE EXCEPTION 'delivery_attempt_status_not_monotonic' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_delivery_attempt_transition
  BEFORE UPDATE ON public.brand_offering_invite_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.issue_1770_delivery_attempt_transition();

CREATE OR REPLACE FUNCTION public.issue_1770_invite_token_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF ROW(NEW.id,NEW.invite_id,NEW.delivery_attempt_id,NEW.token_hash,
         NEW.contact_method_id,NEW.derivation_version,NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.invite_id,OLD.delivery_attempt_id,OLD.token_hash,
         OLD.contact_method_id,OLD.derivation_version,OLD.expires_at)
     OR (
       NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id
       AND NOT (OLD.linked_user_id IS NOT NULL AND NEW.linked_user_id IS NULL AND NEW.revoked_at IS NOT NULL)
     )
  THEN
    RAISE EXCEPTION 'offering_invite_token_identity_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_invite_token_immutable
  BEFORE UPDATE ON public.brand_offering_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION public.issue_1770_invite_token_immutable();

CREATE OR REPLACE FUNCTION public.biz_brand_person_canonical(p_person_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_current uuid := p_person_id; v_next uuid; v_depth integer := 0;
BEGIN
  LOOP
    SELECT merged_into_person_id INTO v_next FROM public.brand_people WHERE id = v_current;
    IF NOT FOUND THEN RAISE EXCEPTION 'brand_person_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_next IS NULL THEN RETURN v_current; END IF;
    v_depth := v_depth + 1;
    IF v_depth > 32 OR v_next = p_person_id THEN RAISE EXCEPTION 'brand_person_merge_cycle' USING ERRCODE = '54001'; END IF;
    v_current := v_next;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_merge_brand_people(
  p_winner uuid,p_loser uuid,p_reason text,p_evidence_source_link_id uuid,p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid; v_loser_brand uuid; v_event_id uuid; v_survivor uuid; v_removed uuid; v_merge_id uuid;
  v_loser_invited_at timestamptz;
BEGIN
  IF p_winner = p_loser OR p_reason NOT IN ('normalized_address','authenticated_user','manual_resolution') THEN
    RAISE EXCEPTION 'brand_person_merge_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(p_winner::text,p_loser::text),0));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(p_winner::text,p_loser::text),0));
  SELECT brand_id INTO v_brand FROM public.brand_people WHERE id=p_winner AND record_status='active' FOR UPDATE;
  SELECT brand_id INTO v_loser_brand FROM public.brand_people WHERE id=p_loser AND record_status='active' FOR UPDATE;
  IF v_brand IS NULL OR v_loser_brand IS NULL OR v_brand <> v_loser_brand THEN
    RAISE EXCEPTION 'brand_person_merge_scope_invalid' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.brand_person_merge_events(brand_id,winner_person_id,loser_person_id,reason,evidence_source_link_id,reversal_manifest,acted_by)
  VALUES(v_brand,p_winner,p_loser,p_reason,p_evidence_source_link_id,
    jsonb_build_object('sourceLinkIds',(SELECT COALESCE(jsonb_agg(id),'[]'::jsonb) FROM public.brand_person_source_links WHERE brand_person_id=p_loser AND detached_at IS NULL),
                       'contactMethodIds',(SELECT COALESCE(jsonb_agg(id),'[]'::jsonb) FROM public.brand_person_contact_methods WHERE brand_person_id=p_loser AND record_state='active'),
                       'nameIds',(SELECT COALESCE(jsonb_agg(id),'[]'::jsonb) FROM public.brand_person_names WHERE brand_person_id=p_loser AND active),
                       'winnerContactKeys',(SELECT COALESCE(jsonb_agg(jsonb_build_object('channel',channel,'value',normalized_value)),'[]'::jsonb) FROM public.brand_person_contact_methods WHERE brand_person_id=p_winner AND record_state='active'),
                       'winnerNameKeys',(SELECT COALESCE(jsonb_agg(normalized_name),'[]'::jsonb) FROM public.brand_person_names WHERE brand_person_id=p_winner AND active),
                       'inviteStates',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'brandPersonId',brand_person_id,'status',status,'removalReason',removal_reason,'supersededByInviteId',superseded_by_invite_id,'invitedAt',invited_at,'removedAt',removed_at)),'[]'::jsonb) FROM public.brand_offering_invites WHERE brand_person_id IN (p_winner,p_loser))),
    p_actor) RETURNING id INTO v_merge_id;
  UPDATE public.brand_person_contact_method_sources s SET active=false,retired_at=now()
    WHERE s.active AND s.source_link_id IN (SELECT id FROM public.brand_person_source_links WHERE brand_person_id=p_loser AND detached_at IS NULL);
  UPDATE public.brand_person_source_links SET detached_at=now() WHERE brand_person_id=p_loser AND detached_at IS NULL;
  INSERT INTO public.brand_person_source_links(brand_id,brand_person_id,source_kind,source_id,offering_invite_id,link_method,source_occurred_at)
    SELECT brand_id,p_winner,source_kind,source_id,offering_invite_id,'manual_resolution',source_occurred_at
    FROM public.brand_person_source_links l WHERE l.brand_person_id=p_loser AND l.detached_at IS NOT NULL
      AND l.detached_at >= transaction_timestamp()
    ON CONFLICT (source_kind,source_id) WHERE detached_at IS NULL DO NOTHING;
  UPDATE public.brand_person_contact_methods SET record_state='retired',retired_at=now(),updated_at=now()
    WHERE brand_person_id=p_loser AND record_state='active';
  INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,suppression_eligible,is_primary)
    SELECT brand_id,p_winner,channel,normalized_value,provenance_scope,is_exportable,suppression_eligible,false
    FROM public.brand_person_contact_methods WHERE brand_person_id=p_loser
      AND id IN (SELECT value::uuid FROM jsonb_array_elements_text((SELECT reversal_manifest->'contactMethodIds' FROM public.brand_person_merge_events WHERE id=v_merge_id)) AS value)
    ON CONFLICT (brand_person_id,channel,normalized_value) WHERE record_state='active' DO NOTHING;
  INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
    SELECT winner_contact.id,new_link.id,old_edge.provenance_kind,old_edge.exportable
    FROM public.brand_person_contact_method_sources old_edge
    JOIN public.brand_person_contact_methods loser_contact ON loser_contact.id=old_edge.contact_method_id
    JOIN public.brand_person_source_links old_link ON old_link.id=old_edge.source_link_id
    JOIN public.brand_person_source_links new_link ON new_link.source_kind=old_link.source_kind AND new_link.source_id=old_link.source_id AND new_link.detached_at IS NULL
    JOIN public.brand_person_contact_methods winner_contact ON winner_contact.brand_person_id=p_winner
      AND winner_contact.channel=loser_contact.channel AND winner_contact.normalized_value=loser_contact.normalized_value AND winner_contact.record_state='active'
    WHERE loser_contact.brand_person_id=p_loser
      AND old_link.id IN (SELECT value::uuid FROM jsonb_array_elements_text((SELECT reversal_manifest->'sourceLinkIds' FROM public.brand_person_merge_events WHERE id=v_merge_id)) AS value)
    ON CONFLICT(contact_method_id,source_link_id) DO UPDATE SET active=true,retired_at=NULL,exportable=EXCLUDED.exportable;
  UPDATE public.brand_person_names SET active=false,retired_at=now() WHERE brand_person_id=p_loser AND active;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id)
    SELECT p_winner,n.display_name,n.normalized_name,'alternate',new_link.id
    FROM public.brand_person_names n
    LEFT JOIN public.brand_person_source_links old_link ON old_link.id=n.source_link_id
    LEFT JOIN public.brand_person_source_links new_link ON new_link.source_kind=old_link.source_kind AND new_link.source_id=old_link.source_id AND new_link.detached_at IS NULL
    WHERE n.brand_person_id=p_loser
      AND n.id IN (SELECT value::uuid FROM jsonb_array_elements_text((SELECT reversal_manifest->'nameIds' FROM public.brand_person_merge_events WHERE id=v_merge_id)) AS value)
    ON CONFLICT (brand_person_id,normalized_name) WHERE active DO NOTHING;
  INSERT INTO public.brand_person_channel_suppressions(brand_id,brand_person_id,channel,scope,reason,origin_table,origin_id)
    SELECT brand_id,p_winner,channel,scope,reason,'brand_person_merge_events',v_merge_id
    FROM public.brand_person_channel_suppressions WHERE brand_person_id=p_loser AND lifted_at IS NULL
    ON CONFLICT (brand_person_id,channel,scope) WHERE lifted_at IS NULL DO NOTHING;
  FOR v_event_id IN SELECT event_id FROM public.brand_offering_invites WHERE brand_person_id=p_loser LOOP
    SELECT id INTO v_survivor FROM public.brand_offering_invites WHERE event_id=v_event_id AND brand_person_id=p_winner;
    IF v_survivor IS NULL THEN
      UPDATE public.brand_offering_invites SET brand_person_id=p_winner WHERE event_id=v_event_id AND brand_person_id=p_loser;
    ELSE
      SELECT id,invited_at INTO v_removed,v_loser_invited_at FROM public.brand_offering_invites WHERE event_id=v_event_id AND brand_person_id=p_loser;
      UPDATE public.brand_offering_invites SET invited_at=LEAST(invited_at,v_loser_invited_at),updated_at=now() WHERE id=v_survivor;
      UPDATE public.brand_offering_invites SET status='removed',removal_reason='identity_merge',removed_at=now(),superseded_by_invite_id=v_survivor WHERE id=v_removed;
      UPDATE public.brand_offering_invite_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE invite_id=v_removed;
    END IF;
  END LOOP;
  UPDATE public.brand_people SET record_status='merged',merged_into_person_id=p_winner,updated_at=now() WHERE id=p_loser;
  RETURN v_merge_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_reverse_brand_person_merge(p_merge_event_id uuid,p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_merge public.brand_person_merge_events%ROWTYPE; v_ids jsonb; v_id uuid;
  v_channel text; v_value text; v_normalized_name text; v_invite jsonb;
BEGIN
  SELECT * INTO v_merge FROM public.brand_person_merge_events WHERE id=p_merge_event_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','merge_not_active'); END IF;
  IF EXISTS (SELECT 1 FROM public.brand_person_merge_events WHERE winner_person_id=v_merge.loser_person_id AND status='active') THEN
    RETURN jsonb_build_object('status','merge_reversal_requires_manual_partition');
  END IF;
  v_ids := v_merge.reversal_manifest->'sourceLinkIds';
  IF v_ids IS NULL THEN RETURN jsonb_build_object('status','merge_reversal_requires_manual_partition'); END IF;
  UPDATE public.brand_people SET record_status='active',merged_into_person_id=NULL,updated_at=now() WHERE id=v_merge.loser_person_id;
  FOR v_id IN SELECT value::uuid FROM jsonb_array_elements_text(v_ids) AS value LOOP
    UPDATE public.brand_person_contact_method_sources s SET active=false,retired_at=now()
      WHERE s.source_link_id IN (
        SELECT active_link.id FROM public.brand_person_source_links active_link
        JOIN public.brand_person_source_links old_link ON old_link.id=v_id
        WHERE active_link.source_kind=old_link.source_kind AND active_link.source_id=old_link.source_id AND active_link.detached_at IS NULL
      );
    UPDATE public.brand_person_source_links SET detached_at=now(),updated_at=now()
      WHERE source_kind=(SELECT source_kind FROM public.brand_person_source_links WHERE id=v_id)
        AND source_id=(SELECT source_id FROM public.brand_person_source_links WHERE id=v_id)
        AND detached_at IS NULL;
    UPDATE public.brand_person_source_links SET detached_at=NULL,updated_at=now() WHERE id=v_id;
    UPDATE public.brand_person_contact_method_sources SET active=true,retired_at=NULL WHERE source_link_id=v_id;
  END LOOP;
  FOR v_id IN SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_merge.reversal_manifest->'contactMethodIds','[]'::jsonb)) AS value LOOP
    SELECT channel,normalized_value INTO v_channel,v_value FROM public.brand_person_contact_methods WHERE id=v_id;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_merge.reversal_manifest->'winnerContactKeys','[]'::jsonb)) AS key(value)
      WHERE value->>'channel'=v_channel AND value->>'value'=v_value
    ) THEN
      UPDATE public.brand_person_contact_methods SET record_state='retired',retired_at=now(),updated_at=now()
        WHERE brand_person_id=v_merge.winner_person_id AND channel=v_channel AND normalized_value=v_value AND record_state='active';
    END IF;
    UPDATE public.brand_person_contact_methods SET record_state='active',retired_at=NULL,updated_at=now() WHERE id=v_id;
  END LOOP;
  FOR v_id IN SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_merge.reversal_manifest->'nameIds','[]'::jsonb)) AS value LOOP
    SELECT normalized_name INTO v_normalized_name FROM public.brand_person_names WHERE id=v_id;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_merge.reversal_manifest->'winnerNameKeys','[]'::jsonb)) AS key(value)
      WHERE value=v_normalized_name
    ) THEN
      UPDATE public.brand_person_names SET active=false,retired_at=now()
        WHERE brand_person_id=v_merge.winner_person_id AND normalized_name=v_normalized_name AND active;
    END IF;
    UPDATE public.brand_person_names SET active=true,retired_at=NULL WHERE id=v_id;
  END LOOP;
  FOR v_invite IN SELECT value FROM jsonb_array_elements(COALESCE(v_merge.reversal_manifest->'inviteStates','[]'::jsonb)) AS value LOOP
    UPDATE public.brand_offering_invites SET
      brand_person_id=(v_invite->>'brandPersonId')::uuid,
      status=v_invite->>'status',
      removal_reason=v_invite->>'removalReason',
      superseded_by_invite_id=(v_invite->>'supersededByInviteId')::uuid,
      invited_at=(v_invite->>'invitedAt')::timestamptz,
      removed_at=(v_invite->>'removedAt')::timestamptz,
      updated_at=now()
    WHERE id=(v_invite->>'id')::uuid;
  END LOOP;
  UPDATE public.brand_person_merge_events SET status='reversed',reversed_by=p_actor,reversed_at=now() WHERE id=p_merge_event_id;
  RETURN jsonb_build_object('status','reversed','personId',v_merge.loser_person_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'merge_reversal_requires_manual_partition' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_validate_offering_invite_token(
  p_opaque_token text,
  p_event_id uuid,
  p_authenticated_user_id uuid DEFAULT NULL,
  p_submitted_email text DEFAULT NULL,
  p_submitted_phone_e164 text DEFAULT NULL,
  p_token_pepper text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE v_hash text; v_invite uuid; v_contact uuid; v_user uuid; v_expected text; v_channel text; v_pepper bytea;
BEGIN
  IF p_opaque_token IS NULL OR length(p_opaque_token) < 32 OR p_token_pepper IS NULL OR
     NOT (p_token_pepper ~ '^[0-9a-f]{64,}$' OR p_token_pepper ~ '^[A-Za-z0-9+/]{43,}={0,2}$') THEN RETURN NULL; END IF;
  v_pepper := CASE
    WHEN p_token_pepper ~ '^[0-9a-f]{64,}$' THEN decode(p_token_pepper,'hex')
    ELSE decode(p_token_pepper,'base64')
  END;
  IF octet_length(v_pepper) < 32 THEN RETURN NULL; END IF;
  v_hash := encode(extensions.hmac(
    convert_to('mingla:offering-invite:lookup:v1','UTF8') || decode('00','hex') || convert_to(p_opaque_token,'UTF8'),
    v_pepper,'sha256'
  ),'hex');
  SELECT t.invite_id,t.contact_method_id,t.linked_user_id INTO v_invite,v_contact,v_user
    FROM public.brand_offering_invite_tokens t
    JOIN public.brand_offering_invites i ON i.id=t.invite_id
    WHERE t.token_hash=v_hash AND t.revoked_at IS NULL AND t.expires_at>now()
      AND i.event_id=p_event_id AND i.status='active' AND i.superseded_by_invite_id IS NULL;
  IF v_invite IS NULL THEN RETURN NULL; END IF;
  IF v_user IS NOT NULL AND v_user IS DISTINCT FROM p_authenticated_user_id THEN RETURN NULL; END IF;
  IF v_contact IS NOT NULL THEN
    SELECT channel,normalized_value INTO v_channel,v_expected FROM public.brand_person_contact_methods
      WHERE id=v_contact AND record_state='active' AND provenance_scope='brand_owned';
    IF v_channel='email' AND v_expected IS DISTINCT FROM public.issue_1770_normalize_email(p_submitted_email) THEN RETURN NULL; END IF;
    IF v_channel='phone' AND v_expected IS DISTINCT FROM public.issue_1770_normalize_phone(p_submitted_phone_e164) THEN RETURN NULL; END IF;
  END IF;
  UPDATE public.brand_offering_invite_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE token_hash=v_hash;
  RETURN v_invite;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE LIKE '22%' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'offering_invite_token_validation_failed' USING ERRCODE='P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_brand_person_authorized_contact(
  p_brand_id uuid,p_brand_person_id uuid,p_channel text,p_purpose text
) RETURNS TABLE(contact_method_id uuid,recipient_user_id uuid,normalized_contact text,allowed boolean,reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_person uuid; v_method public.brand_person_contact_methods%ROWTYPE; v_linked_user uuid; v_suppressed boolean; v_can_send boolean;
BEGIN
  IF p_channel NOT IN ('email','sms','push') OR p_purpose NOT IN ('marketing','transactional') THEN
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'invalid_request'::text; RETURN;
  END IF;
  v_person := public.biz_brand_person_canonical(p_brand_person_id);
  SELECT linked_user_id INTO v_linked_user FROM public.brand_people WHERE id=v_person AND brand_id=p_brand_id AND record_status='active';
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'person_not_in_brand'::text; RETURN; END IF;
  IF p_channel='push' THEN
    v_can_send := v_linked_user IS NOT NULL AND public.can_send(v_linked_user,'offering_invitation','push',NULL);
    RETURN QUERY SELECT NULL::uuid,v_linked_user,NULL::text,v_can_send,
      CASE WHEN v_linked_user IS NULL THEN 'channel_unavailable' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
    RETURN;
  END IF;
  SELECT * INTO v_method FROM public.brand_person_contact_methods
    WHERE brand_person_id=v_person AND channel=CASE WHEN p_channel='sms' THEN 'phone' ELSE 'email' END
      AND record_state='active' AND provenance_scope='brand_owned' AND is_exportable
    ORDER BY is_primary DESC,created_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,NULL::uuid,NULL::text,false,'channel_unavailable'::text; RETURN; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.brand_person_channel_suppressions s
      WHERE s.brand_person_id=v_person AND s.channel=p_channel AND s.lifted_at IS NULL
        AND s.scope IN (CASE WHEN p_purpose='marketing' THEN 'marketing' ELSE 'all' END,'all')
    UNION ALL
    SELECT 1 FROM public.channel_suppressions s
      WHERE s.channel=p_channel AND s.scope IN (CASE WHEN p_purpose='marketing' THEN 'marketing' ELSE 'transactional' END,'all')
        AND (s.contact=v_method.normalized_value OR (v_linked_user IS NOT NULL AND s.user_id=v_linked_user))
  ) INTO v_suppressed;
  v_can_send := public.can_send(v_linked_user,'offering_invitation',p_channel,v_method.normalized_value);
  RETURN QUERY SELECT v_method.id,v_linked_user,v_method.normalized_value,NOT v_suppressed AND v_can_send,
    CASE WHEN v_suppressed THEN 'suppressed' WHEN NOT v_can_send THEN 'can_send_denied' ELSE 'allowed' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_prepare_offering_invite_delivery(
  p_attempt_id uuid,
  p_proposed_token_id uuid,
  p_proposed_token_hash text,
  p_derivation_version smallint DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_invite public.brand_offering_invites%ROWTYPE;
  v_group public.marketing_send_groups%ROWTYPE;
  v_token public.brand_offering_invite_tokens%ROWTYPE;
  v_allowed boolean;
  v_contact uuid;
BEGIN
  IF p_derivation_version<>1 OR p_proposed_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'offering_invite_token_proposal_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_attempt FROM public.brand_offering_invite_delivery_attempts
    WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.channel NOT IN ('email','sms') OR v_attempt.status<>'queued'
     OR (v_attempt.next_attempt_at IS NOT NULL AND v_attempt.next_attempt_at>now()) THEN
    RAISE EXCEPTION 'offering_invite_delivery_not_preparable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_invite FROM public.brand_offering_invites WHERE id=v_attempt.invite_id FOR UPDATE;
  SELECT * INTO v_group FROM public.marketing_send_groups WHERE id=v_attempt.send_group_id FOR UPDATE;
  IF v_invite.status<>'active' OR v_invite.superseded_by_invite_id IS NOT NULL
     OR v_invite.event_id<>v_group.event_id OR v_invite.brand_id<>v_group.brand_id THEN
    RAISE EXCEPTION 'offering_invite_delivery_inactive' USING ERRCODE='55000';
  END IF;
  SELECT contact_method_id,allowed INTO v_contact,v_allowed
    FROM public.biz_brand_person_authorized_contact(
      v_invite.brand_id,v_invite.brand_person_id,v_attempt.channel,'marketing'
    );
  IF NOT COALESCE(v_allowed,false) OR v_contact IS DISTINCT FROM v_attempt.contact_method_id THEN
    RAISE EXCEPTION 'offering_invite_delivery_target_changed' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_token FROM public.brand_offering_invite_tokens
    WHERE delivery_attempt_id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.brand_offering_invite_tokens(
      id,invite_id,delivery_attempt_id,token_hash,contact_method_id,
      derivation_version,expires_at
    ) VALUES(
      p_proposed_token_id,v_invite.id,p_attempt_id,p_proposed_token_hash,
      v_attempt.contact_method_id,1,now()+interval '7 days'
    )
    ON CONFLICT(delivery_attempt_id) DO NOTHING;
    SELECT * INTO v_token FROM public.brand_offering_invite_tokens
      WHERE delivery_attempt_id=p_attempt_id FOR UPDATE;
  END IF;
  IF v_token.revoked_at IS NOT NULL OR v_token.expires_at<=now()
     OR v_token.invite_id<>v_invite.id OR v_token.contact_method_id IS DISTINCT FROM v_attempt.contact_method_id
  THEN
    RAISE EXCEPTION 'offering_invite_delivery_token_inactive' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object(
    'attemptId',v_attempt.id,'inviteId',v_invite.id,'tokenId',v_token.id,
    'derivationVersion',v_token.derivation_version,'tokenHash',v_token.token_hash,
    'eventId',v_invite.event_id,'expiresAt',v_token.expires_at,'status',v_attempt.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_claim_offering_invite_provider_io(
  p_attempt_id uuid,
  p_token_id uuid,
  p_provider_idempotency_key text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.brand_offering_invite_delivery_attempts
    WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.channel NOT IN ('email','sms') OR v_attempt.status<>'queued'
     OR (v_attempt.next_attempt_at IS NOT NULL AND v_attempt.next_attempt_at>now())
     OR p_provider_idempotency_key<>format('offering:%s:%s:v1',v_attempt.id,v_attempt.channel)
     OR (
       EXISTS(SELECT 1 FROM public.brand_offering_invite_tokens t
         WHERE t.delivery_attempt_id=v_attempt.id AND t.id<>p_token_id)
       OR NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_tokens t
         WHERE t.delivery_attempt_id=v_attempt.id AND t.id=p_token_id
           AND t.revoked_at IS NULL AND t.expires_at>now())
     )
  THEN
    RAISE EXCEPTION 'offering_invite_provider_io_not_claimable' USING ERRCODE='55000';
  END IF;
  UPDATE public.brand_offering_invite_delivery_attempts SET
    status='sending',provider_idempotency_key=p_provider_idempotency_key,updated_at=now()
  WHERE id=v_attempt.id;
  RETURN 'claimed';
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_preflight_offering_push_provider_io(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE; v_payload jsonb;
  v_invite public.brand_offering_invites%ROWTYPE; v_group public.marketing_send_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.brand_offering_invite_delivery_attempts
  WHERE id=p_attempt_id;
  IF NOT FOUND OR v_attempt.channel<>'push' OR v_attempt.status<>'queued'
    OR v_attempt.recipient_user_id IS NULL OR v_attempt.recipient_erased_at IS NOT NULL
    OR (v_attempt.next_attempt_at IS NOT NULL AND v_attempt.next_attempt_at>now()) THEN
    RAISE EXCEPTION 'offering_push_preflight_ineligible' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_invite FROM public.brand_offering_invites WHERE id=v_attempt.invite_id;
  SELECT * INTO v_group FROM public.marketing_send_groups WHERE id=v_attempt.send_group_id;
  v_payload:=v_group.push_payload_v1;
  IF v_invite.status<>'active' OR v_invite.superseded_by_invite_id IS NOT NULL
    OR v_invite.event_id<>v_group.event_id OR v_invite.brand_id<>v_group.brand_id
    OR NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=v_group.event_id AND e.brand_id=v_group.brand_id AND e.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.brands b WHERE b.id=v_group.brand_id AND b.deleted_at IS NULL)
    OR NOT public.issue_1770_push_payload_valid(v_group.push_payload_v1,v_group.event_id,v_group.push_payload_hash) THEN
    RAISE EXCEPTION 'offering_push_preflight_ineligible' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object(
    'attemptId',v_attempt.id,'recipientUserId',v_attempt.recipient_user_id,
    'internalProviderClaimKey',format('offering:%s:push:v1',v_attempt.id),
    'oneSignalIdempotencyKey',v_attempt.id,
    'pushPayload',v_payload
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_claim_offering_push_provider_io(
  p_attempt_id uuid,
  p_recipient_user_id uuid,
  p_internal_provider_claim_key text,
  p_push_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_invite public.brand_offering_invites%ROWTYPE;
  v_group public.marketing_send_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.brand_offering_invite_delivery_attempts
    WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.channel<>'push' OR v_attempt.status<>'queued'
    OR v_attempt.recipient_user_id IS NULL
    OR v_attempt.recipient_erased_at IS NOT NULL
    OR v_attempt.recipient_user_id IS DISTINCT FROM p_recipient_user_id
    OR (v_attempt.next_attempt_at IS NOT NULL AND v_attempt.next_attempt_at>now())
    OR p_internal_provider_claim_key<>format('offering:%s:push:v1',v_attempt.id) THEN
    RAISE EXCEPTION 'offering_push_provider_io_not_claimable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_invite FROM public.brand_offering_invites WHERE id=v_attempt.invite_id FOR UPDATE;
  SELECT * INTO v_group FROM public.marketing_send_groups WHERE id=v_attempt.send_group_id FOR UPDATE;
  IF v_invite.status<>'active' OR v_invite.superseded_by_invite_id IS NOT NULL
    OR v_invite.event_id<>v_group.event_id OR v_invite.brand_id<>v_group.brand_id
    OR p_push_payload IS DISTINCT FROM v_group.push_payload_v1
    OR NOT public.issue_1770_push_payload_valid(v_group.push_payload_v1,v_group.event_id,v_group.push_payload_hash) THEN
    RAISE EXCEPTION 'offering_push_provider_io_not_claimable' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM public.events e WHERE e.id=v_group.event_id AND e.brand_id=v_group.brand_id
    AND e.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offering_push_provider_io_not_claimable' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM public.brands b WHERE b.id=v_group.brand_id AND b.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offering_push_provider_io_not_claimable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notification_categories WHERE key='offering_invitation' AND active)
    OR NOT public.can_send(v_attempt.recipient_user_id,'offering_invitation','push',NULL) THEN
    RAISE EXCEPTION 'offering_push_provider_io_not_claimable' USING ERRCODE='55000';
  END IF;
  UPDATE public.brand_offering_invite_delivery_attempts SET
    status='sending',provider_idempotency_key=p_internal_provider_claim_key,
    provider_io_claimed_at=now(),updated_at=now()
  WHERE id=v_attempt.id;
  RETURN jsonb_build_object(
    'attemptId',v_attempt.id,'recipientUserId',v_attempt.recipient_user_id,
    'internalProviderClaimKey',p_internal_provider_claim_key,
    'pushPayload',v_group.push_payload_v1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_project_offering_push_delivery(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_attempt public.brand_offering_invite_delivery_attempts%ROWTYPE; v_notification uuid;
  v_queued integer; v_sent integer; v_delivered integer; v_failed integer; v_suppressed integer; v_total integer; v_status text;
BEGIN
  SELECT * INTO v_attempt FROM public.brand_offering_invite_delivery_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.channel<>'push' THEN RAISE EXCEPTION 'offering_push_attempt_not_found' USING ERRCODE='P0002'; END IF;
  SELECT n.id INTO v_notification FROM public.notifications n
    WHERE n.idempotency_key=v_attempt.provider_idempotency_key
      AND n.user_id=v_attempt.recipient_user_id AND n.type='offering_invitation'
      AND v_attempt.safe_reason_code IS DISTINCT FROM 'inbox_unavailable';
  IF v_notification IS NOT NULL THEN
    INSERT INTO public.notification_deliveries(
      notification_id,channel,status,provider,provider_app_id,provider_message_id,
      attempt_at,delivered_at,failed_reason
    ) VALUES(
      v_notification,'push',v_attempt.status,'onesignal',v_attempt.provider_app_id,
      v_attempt.provider_message_id,COALESCE(v_attempt.provider_accepted_at,v_attempt.provider_io_claimed_at,v_attempt.created_at),
      v_attempt.delivered_at,v_attempt.safe_reason_code
    ) ON CONFLICT(notification_id,channel) WHERE notification_id IS NOT NULL DO UPDATE SET
      status=EXCLUDED.status,
      provider_app_id=COALESCE(public.notification_deliveries.provider_app_id,EXCLUDED.provider_app_id),
      provider_message_id=COALESCE(public.notification_deliveries.provider_message_id,EXCLUDED.provider_message_id),
      delivered_at=COALESCE(public.notification_deliveries.delivered_at,EXCLUDED.delivered_at),
      failed_reason=EXCLUDED.failed_reason;
  END IF;
  SELECT count(*) FILTER(WHERE status IN ('queued','sending')),
    count(*) FILTER(WHERE status IN ('sent','delivered')),
    count(*) FILTER(WHERE status='delivered'),count(*) FILTER(WHERE status='failed'),
    count(*) FILTER(WHERE status='suppressed'),count(*)
  INTO v_queued,v_sent,v_delivered,v_failed,v_suppressed,v_total
  FROM public.brand_offering_invite_delivery_attempts WHERE send_group_id=v_attempt.send_group_id;
  v_status:=CASE WHEN v_queued>0 THEN 'running'
    WHEN v_failed=0 THEN 'completed'
    WHEN v_failed=(v_total-v_suppressed) THEN 'failed'
    ELSE 'partial' END;
  UPDATE public.marketing_send_groups SET queued_count=v_queued,sent_count=v_sent,
    delivered_count=v_delivered,failed_count=v_failed,suppressed_count=v_suppressed,
    status=v_status,started_at=COALESCE(started_at,now()),
    completed_at=CASE WHEN v_queued=0 THEN COALESCE(completed_at,now()) ELSE completed_at END,
    updated_at=now() WHERE id=v_attempt.send_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_record_offering_push_dispatch_result(
  p_attempt_id uuid,p_outcome text,p_provider_app_id uuid DEFAULT NULL,
  p_provider_message_id uuid DEFAULT NULL,p_safe_code text DEFAULT NULL,p_retryable boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v public.brand_offering_invite_delivery_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.brand_offering_invite_delivery_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v.channel<>'push' THEN RAISE EXCEPTION 'offering_push_attempt_not_found' USING ERRCODE='P0002'; END IF;
  IF v.provider_app_id IS NOT NULL AND v.provider_app_id IS DISTINCT FROM p_provider_app_id THEN
    RAISE EXCEPTION 'offering_push_result_app_mismatch' USING ERRCODE='23514';
  END IF;
  IF (p_outcome='accepted' AND (p_safe_code IS NOT NULL OR p_retryable))
    OR (p_outcome='definitive_unsent_retryable' AND (NOT p_retryable OR p_safe_code IS NULL OR p_safe_code NOT IN
      ('provider_rate_limited','inbox_unavailable','provider_config_missing','local_before_provider_io_failed')))
    OR (p_outcome='definitive_unsent_terminal' AND (p_retryable OR p_safe_code IS NULL OR p_safe_code NOT IN
      ('local_payload_invalid','inbox_idempotency_collision','claim_tuple_mismatch','provider_no_valid_subscription',
       'provider_request_invalid','provider_config_rejected','provider_request_rejected')))
    OR (p_outcome='ambiguous' AND (p_retryable OR p_safe_code IS DISTINCT FROM 'provider_outcome_unknown'))
    OR (p_outcome='suppressed' AND (p_retryable OR p_safe_code IS NULL OR p_safe_code NOT IN
      ('category_inactive','can_send_denied','claim_ineligible'))) THEN
    RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('mingla.issue1770_push_result_rpc','true',true);
  UPDATE public.brand_offering_invite_delivery_attempts SET
    provider_idempotency_key=COALESCE(provider_idempotency_key,format('offering:%s:push:v1',id)),
    provider_app_id=COALESCE(provider_app_id,p_provider_app_id)
    WHERE id=v.id;
  IF p_outcome='accepted' THEN
    IF v.status<>'sending' OR p_provider_app_id IS NULL OR p_provider_message_id IS NULL THEN RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514'; END IF;
    UPDATE public.brand_offering_invite_delivery_attempts SET status='sending',provider_app_id=p_provider_app_id,
      provider_message_id=p_provider_message_id::text,provider_accepted_at=COALESCE(provider_accepted_at,now()),
      sent_at=COALESCE(sent_at,now()),safe_reason_code=NULL,is_retryable=false,updated_at=now() WHERE id=v.id;
  ELSIF p_outcome IN ('definitive_unsent_retryable','definitive_unsent_terminal') THEN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='failed',safe_reason_code=p_safe_code,
      is_retryable=p_retryable,failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v.id;
  ELSIF p_outcome='ambiguous' THEN
    IF v.status<>'sending' THEN RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514'; END IF;
    UPDATE public.brand_offering_invite_delivery_attempts SET safe_reason_code='provider_outcome_unknown',
      is_retryable=false,updated_at=now() WHERE id=v.id;
  ELSIF p_outcome='suppressed' THEN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='suppressed',safe_reason_code=p_safe_code,
      is_retryable=false,updated_at=now() WHERE id=v.id;
  ELSE RAISE EXCEPTION 'offering_push_result_invalid' USING ERRCODE='23514'; END IF;
  PERFORM set_config('mingla.issue1770_push_result_rpc','',true);
  PERFORM public.issue_1770_project_offering_push_delivery(v.id);
  SELECT * INTO v FROM public.brand_offering_invite_delivery_attempts WHERE id=v.id;
  RETURN jsonb_build_object('attemptId',v.id,'status',v.status,'providerMessageId',v.provider_message_id,'safeCode',v.safe_reason_code,'retryable',v.is_retryable);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_reconcile_offering_push_event(
  p_event_id uuid,p_event_kind text,p_occurred_at timestamptz,p_provider_app_id uuid,
  p_provider_message_id uuid,p_external_id uuid,p_attempt_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v public.brand_offering_invite_delivery_attempts%ROWTYPE; v_kind text; v_disposition text; v_reason text;
  v_existing public.offering_push_provider_events%ROWTYPE; v_has_received boolean; v_has_sent boolean; v_has_failed boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  v_kind:=CASE p_event_kind WHEN 'message.push.sent' THEN 'sent' WHEN 'message.push.received' THEN 'received' WHEN 'message.push.failed' THEN 'failed' ELSE NULL END;
  SELECT * INTO v_existing FROM public.offering_push_provider_events WHERE event_id=p_event_id FOR UPDATE;
  IF FOUND THEN
    IF ROW(v_existing.attempt_id,v_existing.provider_app_id,v_existing.provider_message_id,v_existing.provider_occurred_at)
      IS NOT DISTINCT FROM ROW(p_attempt_id,p_provider_app_id,p_provider_message_id,p_occurred_at)
      AND v_existing.evidence_kind IS NOT DISTINCT FROM v_kind
      AND EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts a WHERE a.id=p_attempt_id AND a.recipient_user_id=p_external_id) THEN
      RETURN jsonb_build_object('disposition','duplicate');
    END IF;
    RETURN jsonb_build_object('disposition','event_id_collision');
  END IF;
  IF p_event_kind='message.push.unsubscribed' THEN v_disposition:='ignored_kind';
  ELSIF v_kind IS NULL THEN v_disposition:='ignored_kind';
  ELSE
    SELECT * INTO v FROM public.brand_offering_invite_delivery_attempts WHERE id=p_attempt_id FOR UPDATE;
    IF NOT FOUND OR v.channel<>'push' THEN v_disposition:='ignored_unknown_attempt';
    ELSIF v.recipient_user_id IS NULL OR v.recipient_erased_at IS NOT NULL THEN v_disposition:='ignored_erased';
    ELSIF v.provider_io_claimed_at IS NULL OR p_occurred_at < v.provider_io_claimed_at-interval '5 minutes' THEN v_disposition:='ignored_before_claim';
    ELSIF p_occurred_at>now()+interval '5 minutes' OR v.created_at>now() THEN v_disposition:='ignored_future';
    ELSIF v.recipient_user_id IS DISTINCT FROM p_external_id
      OR (v.provider_app_id IS NOT NULL AND v.provider_app_id IS DISTINCT FROM p_provider_app_id)
      OR (v.provider_message_id IS NOT NULL AND v.provider_message_id IS DISTINCT FROM p_provider_message_id::text)
      OR EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts other
        WHERE other.id<>v.id AND other.channel='push' AND other.provider_app_id=p_provider_app_id
          AND other.provider_message_id=p_provider_message_id::text) THEN
      v_disposition:='ignored_tuple_mismatch';
    ELSE v_disposition:='applied'; END IF;
  END IF;
  v_reason:=CASE WHEN v_kind='failed' THEN 'provider_push_failed' ELSE NULL END;
  INSERT INTO public.offering_push_provider_events(event_id,attempt_id,provider_app_id,provider_message_id,evidence_kind,provider_occurred_at,disposition,safe_reason_code)
  VALUES(p_event_id,CASE WHEN v_disposition IN ('ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch') THEN NULL ELSE p_attempt_id END,
    CASE WHEN v_disposition IN ('ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch') THEN NULL ELSE p_provider_app_id END,
    CASE WHEN v_disposition IN ('ignored_kind','ignored_unknown_attempt','ignored_tuple_mismatch') THEN NULL ELSE p_provider_message_id END,
    v_kind,p_occurred_at,v_disposition,v_reason);
  IF v_disposition='applied' THEN
    SELECT bool_or(evidence_kind='received'),bool_or(evidence_kind='sent'),bool_or(evidence_kind='failed')
      INTO v_has_received,v_has_sent,v_has_failed FROM public.offering_push_provider_events
      WHERE attempt_id=v.id AND disposition='applied';
    UPDATE public.brand_offering_invite_delivery_attempts SET
      provider_app_id=COALESCE(provider_app_id,p_provider_app_id),provider_message_id=COALESCE(provider_message_id,p_provider_message_id::text),
      status=CASE WHEN v_has_received THEN 'delivered' WHEN v_has_sent THEN 'sent' WHEN v_has_failed THEN 'failed' ELSE status END,
      sent_at=CASE WHEN v_has_sent OR v_has_received THEN COALESCE(sent_at,p_occurred_at) ELSE sent_at END,
      delivered_at=CASE WHEN v_has_received THEN COALESCE(delivered_at,p_occurred_at) ELSE delivered_at END,
      failed_at=CASE WHEN v_has_failed THEN COALESCE(failed_at,p_occurred_at) ELSE failed_at END,
      safe_reason_code=CASE WHEN v_has_received THEN NULL WHEN v_has_sent AND v_has_failed THEN 'provider_partial_failure'
        WHEN v_has_sent THEN NULL WHEN v_has_failed THEN 'provider_push_failed' ELSE safe_reason_code END,
      updated_at=now() WHERE id=v.id;
    PERFORM public.issue_1770_project_offering_push_delivery(v.id);
  END IF;
  RETURN jsonb_build_object('disposition',v_disposition);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source(
  p_brand_id uuid,
  p_event_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_authenticated_user_id uuid DEFAULT NULL,
  p_validated_invite_id uuid DEFAULT NULL,
  p_normalized_email text DEFAULT NULL,
  p_normalized_phone_e164 text DEFAULT NULL,
  p_source_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid; v_event uuid; v_user uuid; v_name text; v_email text; v_phone text;
  v_occurred timestamptz; v_existing uuid; v_prior_person uuid; v_person uuid; v_link uuid; v_conflict uuid;
  v_candidates uuid[]; v_candidate uuid; v_candidate_name text; v_norm_name text;
  v_link_method text := 'normalized_address'; v_provenance text;
BEGIN
  IF p_source_kind NOT IN ('event_rsvp','rsvp_plus_one','order','ticket_holder') THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_kind || ':' || p_source_id::text,0));
  SELECT id,brand_person_id INTO v_link,v_prior_person FROM public.brand_person_source_links
    WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;

  IF p_source_kind='event_rsvp' THEN
    SELECT e.brand_id,r.event_id,r.user_id,
      COALESCE(NULLIF(btrim(r.guest_name),''),'Guest'),
      public.issue_1770_normalize_email(r.guest_email),public.issue_1770_normalize_phone(r.guest_phone),r.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
      FROM public.event_rsvps r JOIN public.events e ON e.id=r.event_id WHERE r.id=p_source_id;
    v_provenance := 'rsvp';
  ELSIF p_source_kind='rsvp_plus_one' THEN
    SELECT e.brand_id,r.event_id,g.matched_user_id,btrim(g.name),
      public.issue_1770_normalize_email(g.email),public.issue_1770_normalize_phone(g.phone),g.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
      FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id=g.rsvp_id
      JOIN public.events e ON e.id=r.event_id WHERE g.id=p_source_id;
    v_provenance := 'rsvp';
  ELSIF p_source_kind='order' THEN
    SELECT e.brand_id,o.event_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      WHERE o.id=p_source_id AND o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
    v_provenance := 'order';
  ELSE
    SELECT e.brand_id,t.event_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
      FROM public.tickets t JOIN public.orders o ON o.id=t.order_id JOIN public.events e ON e.id=t.event_id
      WHERE t.id=p_source_id AND o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
    v_provenance := 'ticket';
  END IF;

  IF v_brand IS NULL THEN
    UPDATE public.brand_person_source_links SET detached_at=COALESCE(detached_at,now()),updated_at=now()
      WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','retired','conflictId',NULL);
  END IF;
  IF v_brand IS DISTINCT FROM p_brand_id OR v_event IS DISTINCT FROM p_event_id OR
     v_user IS DISTINCT FROM p_authenticated_user_id OR v_email IS DISTINCT FROM public.issue_1770_normalize_email(p_normalized_email) OR
     v_phone IS DISTINCT FROM public.issue_1770_normalize_phone(p_normalized_phone_e164) OR v_occurred IS DISTINCT FROM p_source_occurred_at THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  IF p_validated_invite_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invites WHERE id=p_validated_invite_id AND brand_id=v_brand AND event_id=v_event AND status='active'
  ) THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  v_norm_name := lower(regexp_replace(btrim(v_name),'\s+',' ','g'));
  IF v_link IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.brand_people p
       WHERE p.id=public.biz_brand_person_canonical(v_prior_person)
         AND p.brand_id=v_brand AND p.record_status='active'
         AND (v_user IS NULL OR p.linked_user_id=v_user)
     )
     AND EXISTS (
       SELECT 1 FROM public.brand_person_names n
       WHERE n.source_link_id=v_link AND n.active AND n.normalized_name=v_norm_name
     )
     AND (
       (v_email IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='email' AND c.record_state='active'
       ))
       OR EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='email'
           AND c.normalized_value=v_email AND c.record_state='active'
       )
     )
     AND (
       (v_phone IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='phone' AND c.record_state='active'
       ))
       OR EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='phone'
           AND c.normalized_value=v_phone AND c.record_state='active'
       )
     )
  THEN
    RETURN jsonb_build_object(
      'personId',public.biz_brand_person_canonical(v_prior_person),
      'sourceLinkId',v_link,'linkOutcome','already_linked','conflictId',NULL
    );
  END IF;
  IF v_link IS NOT NULL THEN
    UPDATE public.brand_person_contact_method_sources
      SET active=false,retired_at=now()
      WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_contact_methods c
      SET record_state='retired',retired_at=now(),updated_at=now()
      WHERE c.record_state='active'
        AND EXISTS (SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.source_link_id=v_link)
        AND NOT EXISTS (SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.active);
    UPDATE public.brand_person_names
      SET active=false,retired_at=now()
      WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_source_links SET detached_at=now(),updated_at=now() WHERE id=v_link;
  END IF;
  IF p_validated_invite_id IS NOT NULL THEN v_link_method := 'invite_token';
  ELSIF v_user IS NOT NULL THEN v_link_method := 'authenticated_user'; END IF;

  SELECT array_agg(DISTINCT candidate ORDER BY candidate) INTO v_candidates FROM (
    SELECT public.biz_brand_person_canonical(v_prior_person) candidate WHERE v_prior_person IS NOT NULL
    UNION
    SELECT p.id candidate FROM public.brand_people p WHERE p.brand_id=v_brand AND p.record_status='active' AND v_user IS NOT NULL AND p.linked_user_id=v_user
    UNION
    SELECT c.brand_person_id FROM public.brand_person_contact_methods c
      JOIN public.brand_people p ON p.id=c.brand_person_id
      WHERE c.brand_id=v_brand AND p.record_status='active' AND c.record_state='active' AND c.provenance_scope='brand_owned'
        AND ((c.channel='email' AND v_email IS NOT NULL AND c.normalized_value=v_email)
          OR (c.channel='phone' AND v_phone IS NOT NULL AND c.normalized_value=v_phone))
    UNION
    SELECT i.brand_person_id FROM public.brand_offering_invites i
      WHERE p_validated_invite_id IS NOT NULL AND i.id=p_validated_invite_id AND i.status='active'
  ) s;
  IF cardinality(COALESCE(v_candidates,'{}')) > 0 THEN
    FOREACH v_candidate IN ARRAY v_candidates LOOP
      SELECT lower(regexp_replace(btrim(display_name),'\s+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_candidate;
      IF v_candidate_name <> v_norm_name AND v_candidate_name <> 'guest' AND v_norm_name <> 'guest' THEN
        INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason)
        VALUES(v_brand,p_source_kind,p_source_id,v_candidates,'different_nonempty_names')
        ON CONFLICT (source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids
        RETURNING id INTO v_conflict;
        RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','conflict','conflictId',v_conflict);
      END IF;
    END LOOP;
    v_person := v_candidates[1];
    IF cardinality(v_candidates)>1 THEN
      FOREACH v_candidate IN ARRAY v_candidates[2:cardinality(v_candidates)] LOOP
        PERFORM public.biz_merge_brand_people(v_person,v_candidate,
          CASE WHEN v_user IS NOT NULL THEN 'authenticated_user' ELSE 'normalized_address' END,NULL,NULL);
      END LOOP;
    END IF;
  ELSE
    IF v_user IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
      RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
    END IF;
    INSERT INTO public.brand_people(brand_id,linked_user_id,display_name) VALUES(v_brand,v_user,v_name) RETURNING id INTO v_person;
  END IF;
  INSERT INTO public.brand_person_source_links(brand_id,brand_person_id,source_kind,source_id,offering_invite_id,link_method,source_occurred_at)
    VALUES(v_brand,v_person,p_source_kind,p_source_id,p_validated_invite_id,v_link_method,v_occurred) RETURNING id INTO v_link;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id)
    VALUES(v_person,v_name,v_norm_name,CASE WHEN EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND active AND name_kind='primary') THEN 'alternate' ELSE 'primary' END,v_link)
    ON CONFLICT (brand_person_id,normalized_name) WHERE active DO NOTHING;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(v_brand,v_person,'email',v_email,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND record_state='active'))
      ON CONFLICT (brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now()
      RETURNING id INTO v_existing;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
      VALUES(v_existing,v_link,v_provenance,true) ON CONFLICT DO NOTHING;
  END IF;
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(v_brand,v_person,'phone',v_phone,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND record_state='active'))
      ON CONFLICT (brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now()
      RETURNING id INTO v_existing;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
      VALUES(v_existing,v_link,v_provenance,true) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('personId',v_person,'sourceLinkId',v_link,'linkOutcome','linked','conflictId',NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source_derived(p_source_kind text,p_source_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_brand uuid; v_event uuid; v_user uuid; v_email text; v_phone text; v_occurred timestamptz;
BEGIN
  IF p_source_kind='event_rsvp' THEN
    SELECT e.brand_id,r.event_id,r.user_id,public.issue_1770_normalize_email(r.guest_email),public.issue_1770_normalize_phone(r.guest_phone),r.created_at
    INTO v_brand,v_event,v_user,v_email,v_phone,v_occurred FROM public.event_rsvps r JOIN public.events e ON e.id=r.event_id WHERE r.id=p_source_id;
  ELSIF p_source_kind='rsvp_plus_one' THEN
    SELECT e.brand_id,r.event_id,g.matched_user_id,public.issue_1770_normalize_email(g.email),public.issue_1770_normalize_phone(g.phone),g.created_at
    INTO v_brand,v_event,v_user,v_email,v_phone,v_occurred FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id=g.rsvp_id JOIN public.events e ON e.id=r.event_id WHERE g.id=p_source_id;
  ELSIF p_source_kind='order' THEN
    SELECT e.brand_id,o.event_id,o.buyer_user_id,public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
    INTO v_brand,v_event,v_user,v_email,v_phone,v_occurred FROM public.orders o JOIN public.events e ON e.id=o.event_id WHERE o.id=p_source_id;
  ELSIF p_source_kind='ticket_holder' THEN
    SELECT e.brand_id,t.event_id,o.buyer_user_id,public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
    INTO v_brand,v_event,v_user,v_email,v_phone,v_occurred FROM public.tickets t JOIN public.orders o ON o.id=t.order_id JOIN public.events e ON e.id=t.event_id WHERE t.id=p_source_id;
  END IF;
  IF v_brand IS NULL THEN
    UPDATE public.brand_person_source_links SET detached_at=COALESCE(detached_at,now()),updated_at=now()
      WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','retired','conflictId',NULL);
  END IF;
  RETURN public.biz_resolve_brand_person_source(v_brand,v_event,p_source_kind,p_source_id,v_user,NULL,v_email,v_phone,v_occurred);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_enqueue_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_operation text;
  v_old_state jsonb;
  v_new_state jsonb;
  v_revision text;
BEGIN
  v_id := COALESCE(NEW.id,OLD.id);
  v_operation := CASE WHEN TG_OP='DELETE' THEN 'retire' ELSE 'upsert' END;

  -- Only identity inputs consumed by biz_resolve_brand_person_source_derived
  -- participate in the revision. Operational/status-only updates therefore do
  -- not create an unbounded stream of equivalent work.
  IF TG_ARGV[0]='event_rsvp' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object(
        'eventId',to_jsonb(OLD)->>'event_id','userId',to_jsonb(OLD)->>'user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'guest_name','')),'\\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'guest_email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(OLD)->>'guest_phone'),
        'rsvpStatus',to_jsonb(OLD)->>'rsvp_status','approvalStatus',to_jsonb(OLD)->>'approval_status');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object(
        'eventId',to_jsonb(NEW)->>'event_id','userId',to_jsonb(NEW)->>'user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'guest_name','')),'\\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'guest_email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(NEW)->>'guest_phone'),
        'rsvpStatus',to_jsonb(NEW)->>'rsvp_status','approvalStatus',to_jsonb(NEW)->>'approval_status');
    END IF;
  ELSIF TG_ARGV[0]='rsvp_plus_one' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object(
        'rsvpId',to_jsonb(OLD)->>'rsvp_id','userId',to_jsonb(OLD)->>'matched_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'name','')),'\\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(OLD)->>'phone'));
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object(
        'rsvpId',to_jsonb(NEW)->>'rsvp_id','userId',to_jsonb(NEW)->>'matched_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'name','')),'\\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(NEW)->>'phone'));
    END IF;
  ELSIF TG_ARGV[0]='order' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object(
        'eventId',to_jsonb(OLD)->>'event_id','userId',to_jsonb(OLD)->>'buyer_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'buyer_name','')),'\\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'buyer_email'),
        'phone',public.issue_1770_normalize_phone(COALESCE(to_jsonb(OLD)->>'buyer_phone_e164',to_jsonb(OLD)->>'buyer_phone')),
        'confirmedAt',to_jsonb(OLD)->>'confirmed_at','paymentStatus',to_jsonb(OLD)->>'payment_status');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object(
        'eventId',to_jsonb(NEW)->>'event_id','userId',to_jsonb(NEW)->>'buyer_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'buyer_name','')),'\\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'buyer_email'),
        'phone',public.issue_1770_normalize_phone(COALESCE(to_jsonb(NEW)->>'buyer_phone_e164',to_jsonb(NEW)->>'buyer_phone')),
        'confirmedAt',to_jsonb(NEW)->>'confirmed_at','paymentStatus',to_jsonb(NEW)->>'payment_status');
    END IF;
  ELSIF TG_ARGV[0]='ticket_holder' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object('eventId',to_jsonb(OLD)->>'event_id','orderId',to_jsonb(OLD)->>'order_id');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object('eventId',to_jsonb(NEW)->>'event_id','orderId',to_jsonb(NEW)->>'order_id');
    END IF;
  ELSE
    RETURN COALESCE(NEW,OLD);
  END IF;

  IF TG_OP='UPDATE' AND v_old_state IS NOT DISTINCT FROM v_new_state THEN
    RETURN NEW;
  END IF;
  v_revision := md5(COALESCE(v_new_state,v_old_state,'{}'::jsonb)::text);
  INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
    VALUES(TG_ARGV[0],v_id,v_operation,v_revision)
    ON CONFLICT DO NOTHING;
  RETURN COALESCE(NEW,OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'issue_1770_ingest_enqueue_failed source=% id=%',TG_ARGV[0],v_id;
  RETURN COALESCE(NEW,OLD);
END;
$function$;

CREATE TRIGGER issue_1770_event_rsvp_ingest
  AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvps FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_enqueue_source('event_rsvp');
CREATE TRIGGER issue_1770_rsvp_plus_one_ingest
  AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvp_guests FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_enqueue_source('rsvp_plus_one');
CREATE TRIGGER issue_1770_order_ingest
  AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_enqueue_source('order');
CREATE TRIGGER issue_1770_ticket_ingest
  AFTER INSERT OR UPDATE OR DELETE ON public.tickets FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_enqueue_source('ticket_holder');

CREATE OR REPLACE FUNCTION public.biz_claim_brand_person_ingest(p_limit integer DEFAULT 100)
RETURNS SETOF public.brand_person_ingest_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'ingest_claim_limit_invalid' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.brand_person_ingest_outbox
    WHERE (status IN ('pending','retryable') AND next_attempt_at<=now())
       OR (status='processing' AND locked_at<now()-interval '15 minutes')
    ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.brand_person_ingest_outbox o SET status='processing',locked_at=now(),updated_at=now()
  FROM claimed WHERE o.id=claimed.id RETURNING o.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_finish_brand_person_ingest(p_id uuid,p_succeeded boolean,p_safe_error_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.brand_person_ingest_outbox SET
    attempt_count=attempt_count+1,
    status=CASE WHEN p_succeeded THEN 'done' WHEN attempt_count+1>=12 THEN 'dead' ELSE 'retryable' END,
    next_attempt_at=CASE WHEN p_succeeded THEN next_attempt_at ELSE
      now()+LEAST(interval '6 hours',interval '15 seconds'*power(2,LEAST(attempt_count,10)))
        +(interval '1 second'*floor(random()*15)) END,
    processed_at=CASE WHEN p_succeeded OR attempt_count+1>=12 THEN now() ELSE NULL END,
    locked_at=NULL,last_safe_error_code=CASE WHEN p_succeeded THEN NULL ELSE left(COALESCE(p_safe_error_code,'resolver_failed'),120) END,updated_at=now()
  WHERE id=p_id AND status='processing';
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_record_brand_person_suppression(
  p_channel text,p_scope text,p_contact text DEFAULT NULL,p_user_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,p_reason text DEFAULT 'unsubscribe',p_origin_table text DEFAULT 'unknown',p_origin_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_count integer;
BEGIN
  IF p_channel NOT IN ('email','sms') OR p_scope NOT IN ('marketing','all') THEN
    RAISE EXCEPTION 'person_suppression_invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.brand_person_channel_suppressions(brand_id,brand_person_id,channel,scope,reason,origin_table,origin_id)
    SELECT DISTINCT p.brand_id,p.id,p_channel,p_scope,left(COALESCE(p_reason,'unsubscribe'),120),p_origin_table,p_origin_id
    FROM public.brand_people p
    LEFT JOIN public.brand_person_contact_methods c ON c.brand_person_id=p.id AND c.record_state='active'
    WHERE p.record_status='active' AND (p_brand_id IS NULL OR p.brand_id=p_brand_id)
      AND ((p_user_id IS NOT NULL AND p.linked_user_id=p_user_id)
        OR (p_contact IS NOT NULL AND c.normalized_value=CASE WHEN p_channel='email' THEN public.issue_1770_normalize_email(p_contact) ELSE public.issue_1770_normalize_phone(p_contact) END))
    ON CONFLICT (brand_person_id,channel,scope) WHERE lifted_at IS NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_project_channel_suppression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.channel IN ('email','sms') AND NEW.scope IN ('marketing','all') THEN
    PERFORM public.biz_record_brand_person_suppression(NEW.channel,NEW.scope,NEW.contact,NEW.user_id,NEW.brand_id,NEW.reason,TG_TABLE_NAME,NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_channel_suppression_projection
  AFTER INSERT ON public.channel_suppressions FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_project_channel_suppression();

CREATE OR REPLACE FUNCTION public.issue_1770_project_marketing_unsubscribe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.channel IN ('email','all') AND NEW.contact_email IS NOT NULL THEN
    PERFORM public.biz_record_brand_person_suppression('email','marketing',NEW.contact_email,NULL,NEW.brand_id,COALESCE(NEW.reason,'unsubscribe'),TG_TABLE_NAME,NEW.id);
  END IF;
  IF NEW.channel IN ('sms','all') AND NEW.contact_phone IS NOT NULL THEN
    PERFORM public.biz_record_brand_person_suppression('sms','marketing',NEW.contact_phone,NULL,NEW.brand_id,COALESCE(NEW.reason,'unsubscribe'),TG_TABLE_NAME,NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_marketing_unsubscribe_projection
  AFTER INSERT ON public.marketing_unsubscribes FOR EACH ROW
  EXECUTE FUNCTION public.issue_1770_project_marketing_unsubscribe();

DO $block$
DECLARE v_row public.channel_suppressions%ROWTYPE;
BEGIN
  FOR v_row IN SELECT * FROM public.channel_suppressions LOOP
    IF v_row.channel IN ('email','sms') AND v_row.scope IN ('marketing','all') THEN
      PERFORM public.biz_record_brand_person_suppression(
        v_row.channel,v_row.scope,v_row.contact,v_row.user_id,v_row.brand_id,
        v_row.reason,'channel_suppressions',v_row.id
      );
    END IF;
  END LOOP;
END;
$block$;

DO $block$
DECLARE v_row public.marketing_unsubscribes%ROWTYPE;
BEGIN
  FOR v_row IN SELECT * FROM public.marketing_unsubscribes LOOP
    IF v_row.channel IN ('email','all') AND v_row.contact_email IS NOT NULL THEN
      PERFORM public.biz_record_brand_person_suppression(
        'email','marketing',v_row.contact_email,NULL,v_row.brand_id,
        COALESCE(v_row.reason,'unsubscribe'),'marketing_unsubscribes',v_row.id
      );
    END IF;
    IF v_row.channel IN ('sms','all') AND v_row.contact_phone IS NOT NULL THEN
      PERFORM public.biz_record_brand_person_suppression(
        'sms','marketing',v_row.contact_phone,NULL,v_row.brand_id,
        COALESCE(v_row.reason,'unsubscribe'),'marketing_unsubscribes',v_row.id
      );
    END IF;
  END LOOP;
END;
$block$;

CREATE OR REPLACE FUNCTION public.biz_list_brand_people(
  p_brand_id uuid,p_search text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_rows jsonb; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.biz_brand_effective_rank(p_brand_id,v_uid)<public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'brand_people_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'brand_people_limit_invalid' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(row_value ORDER BY updated_at DESC,id DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT p.id,p.updated_at,jsonb_build_object(
      'personId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'updatedAt',p.updated_at,
      'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary))
        FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'),'[]'::jsonb),
      'suppressions',COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'scope',s.scope))
        FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.lifted_at IS NULL),'[]'::jsonb)
    ) row_value
    FROM public.brand_people p WHERE p.brand_id=p_brand_id AND p.record_status='active'
      AND (p_search IS NULL OR p.display_name ILIKE '%'||replace(p_search,'%','\%')||'%' OR EXISTS(
        SELECT 1 FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.normalized_value ILIKE '%'||replace(lower(p_search),'%','\%')||'%'))
      AND (p_cursor IS NULL OR (p.updated_at,p.id)<((p_cursor->>'updatedAt')::timestamptz,(p_cursor->>'personId')::uuid))
    ORDER BY p.updated_at DESC,p.id DESC LIMIT p_limit
  ) q;
  RETURN jsonb_build_object('rows',v_rows,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object('updatedAt',v_rows->-1->>'updatedAt','personId',v_rows->-1->>'personId') ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_create_offering_send_group(
  p_event_id uuid,p_purpose text,p_selection jsonb,p_channels text[],p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'offering_send_preview_required' USING ERRCODE='55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_offering_actor_brand(
  p_actor_id uuid,p_event_id uuid,p_lock boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE v_brand_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=p_actor_id AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now())
  ) THEN
    RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_lock THEN
    SELECT e.brand_id INTO v_brand_id FROM public.events e JOIN public.brands b ON b.id=e.brand_id
      WHERE e.id=p_event_id AND e.deleted_at IS NULL AND b.deleted_at IS NULL
      FOR UPDATE OF e,b;
  ELSE
    SELECT e.brand_id INTO v_brand_id FROM public.events e JOIN public.brands b ON b.id=e.brand_id
      WHERE e.id=p_event_id AND e.deleted_at IS NULL AND b.deleted_at IS NULL;
  END IF;
  IF v_brand_id IS NULL OR public.biz_brand_effective_rank(v_brand_id,p_actor_id)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN v_brand_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_offering_send_quote_candidates(
  p_actor_id uuid,p_event_id uuid,p_purpose text,p_selection jsonb,p_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_brand_id uuid; v_kind text; v_rows jsonb; v_selected integer; v_event_url text;
  v_ids uuid[] := '{}'; v_failed_ids uuid[] := '{}';
  v_retry_push jsonb:=NULL; v_retry_push_hash text:=NULL;
BEGIN
  v_brand_id:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,false);
  IF p_purpose NOT IN ('invitation','reminder','retry_delivery') OR NOT public.issue_1770_channels_valid(p_channels)
    OR jsonb_typeof(p_selection)<>'object' THEN
    RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023';
  END IF;
  v_kind:=p_selection->>'kind';
  IF v_kind IN ('all_brand_people','invited_people') THEN
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_selection) k)<>ARRAY['kind']::text[]
      OR p_purpose='retry_delivery' THEN RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(array_agg(p.id ORDER BY p.id),'{}') INTO v_ids FROM public.brand_people p
      WHERE p.brand_id=v_brand_id AND p.record_status='active'
        AND (v_kind='all_brand_people' OR EXISTS(SELECT 1 FROM public.brand_offering_invites i WHERE i.event_id=p_event_id AND i.brand_person_id=p.id AND i.status='active'));
  ELSIF v_kind='resolved_brand_people_v1' THEN
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_selection) k)<>ARRAY['brandPersonIds','kind','selectionHash','source']::text[]
      OR p_selection->>'source'<>'guest_roster_actions' OR COALESCE(p_selection->>'selectionHash','')!~'^[0-9a-f]{64}$'
      OR jsonb_typeof(p_selection->'brandPersonIds')<>'array' OR p_purpose='retry_delivery' THEN
      RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(array_agg(x::uuid ORDER BY x::uuid),'{}') INTO v_ids FROM jsonb_array_elements_text(p_selection->'brandPersonIds') x;
    IF cardinality(v_ids)<>jsonb_array_length(p_selection->'brandPersonIds') OR cardinality(v_ids)<>cardinality(ARRAY(SELECT DISTINCT unnest(v_ids)))
      OR EXISTS(SELECT 1 FROM unnest(v_ids) x LEFT JOIN public.brand_people p ON p.id=x AND p.brand_id=v_brand_id AND p.record_status='active' WHERE p.id IS NULL) THEN
      RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023';
    END IF;
  ELSIF v_kind='failed_attempts_v1' THEN
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_selection) k)<>ARRAY['failedAttemptIds','kind','selectionHash','source']::text[]
      OR p_selection->>'source'<>'guest_roster_actions' OR COALESCE(p_selection->>'selectionHash','')!~'^[0-9a-f]{64}$'
      OR jsonb_typeof(p_selection->'failedAttemptIds')<>'array' OR p_purpose<>'retry_delivery' THEN
      RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(array_agg(x::uuid ORDER BY x::uuid),'{}') INTO v_failed_ids FROM jsonb_array_elements_text(p_selection->'failedAttemptIds') x;
    IF cardinality(v_failed_ids)<>jsonb_array_length(p_selection->'failedAttemptIds') OR cardinality(v_failed_ids)<>cardinality(ARRAY(SELECT DISTINCT unnest(v_failed_ids)))
      OR EXISTS(SELECT 1 FROM unnest(v_failed_ids) x LEFT JOIN public.brand_offering_invite_delivery_attempts a ON a.id=x
        LEFT JOIN public.brand_offering_invites i ON i.id=a.invite_id
        WHERE a.id IS NULL OR i.event_id<>p_event_id OR a.status<>'failed' OR NOT a.is_retryable OR NOT(a.channel=ANY(p_channels))) THEN
      RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023';
    END IF;
    IF p_channels IS DISTINCT FROM ARRAY(
      SELECT DISTINCT a.channel FROM public.brand_offering_invite_delivery_attempts a
      WHERE a.id=ANY(v_failed_ids) ORDER BY a.channel
    ) THEN RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023'; END IF;
    IF 'push'=ANY(p_channels) THEN
      SELECT g.push_payload_v1,g.push_payload_hash INTO v_retry_push,v_retry_push_hash
      FROM public.brand_offering_invite_delivery_attempts a
      JOIN public.marketing_send_groups g ON g.id=a.send_group_id
      WHERE a.id=ANY(v_failed_ids) AND a.channel='push' ORDER BY a.id LIMIT 1;
      IF v_retry_push IS NULL OR NOT public.issue_1770_push_payload_valid(v_retry_push,p_event_id,v_retry_push_hash)
        OR EXISTS(
          SELECT 1 FROM public.brand_offering_invite_delivery_attempts a
          JOIN public.marketing_send_groups g ON g.id=a.send_group_id
          WHERE a.id=ANY(v_failed_ids) AND a.channel='push'
            AND (g.push_payload_hash IS DISTINCT FROM v_retry_push_hash
              OR g.push_payload_v1 IS DISTINCT FROM v_retry_push
              OR NOT public.issue_1770_push_payload_valid(g.push_payload_v1,p_event_id,g.push_payload_hash))
        ) THEN RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023'; END IF;
    END IF;
    SELECT array_agg(DISTINCT i.brand_person_id ORDER BY i.brand_person_id) INTO v_ids
      FROM public.brand_offering_invite_delivery_attempts a JOIN public.brand_offering_invites i ON i.id=a.invite_id WHERE a.id=ANY(v_failed_ids);
  ELSE RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023'; END IF;
  IF p_purpose='reminder' AND EXISTS(
    SELECT 1 FROM unnest(v_ids) person_id WHERE NOT EXISTS(
      SELECT 1 FROM public.brand_offering_invites i
      WHERE i.event_id=p_event_id AND i.brand_person_id=person_id AND i.status='active'
    )
  ) THEN RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023'; END IF;
  IF cardinality(v_ids)>500 THEN RAISE EXCEPTION 'offering_send_selection_too_large' USING ERRCODE='22023'; END IF;
  SELECT format('https://business.usemingla.com/e/%s/%s',b.slug,e.slug) INTO v_event_url
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id WHERE e.id=p_event_id;
  v_selected:=cardinality(v_ids);
  WITH requested AS (
    SELECT person_id,channel FROM unnest(v_ids) person_id CROSS JOIN unnest(p_channels) channel
      WHERE p_purpose<>'retry_delivery'
    UNION ALL
    SELECT i.brand_person_id,a.channel FROM public.brand_offering_invite_delivery_attempts a
      JOIN public.brand_offering_invites i ON i.id=a.invite_id
      WHERE p_purpose='retry_delivery' AND a.id=ANY(v_failed_ids)
  ), targets AS (
    SELECT r.person_id,r.channel,
      a.contact_method_id contact_id,a.recipient_user_id recipient_id,a.normalized_contact,
      i.id invite_id,
      CASE WHEN p_purpose='retry_delivery' THEN (SELECT a.id FROM public.brand_offering_invite_delivery_attempts a WHERE a.id=ANY(v_failed_ids) AND a.invite_id=i.id AND a.channel=r.channel LIMIT 1) END predecessor_id,
      NOT a.allowed suppressed,a.reason,
      (SELECT max(a.created_at) FROM public.brand_offering_invite_delivery_attempts a JOIN public.brand_offering_invites li ON li.id=a.invite_id WHERE li.brand_person_id=p.id AND a.channel=r.channel) last_contact_at
    FROM requested r JOIN public.brand_people p ON p.id=r.person_id
    LEFT JOIN public.brand_offering_invites i ON i.event_id=p_event_id AND i.brand_person_id=p.id AND i.status='active'
    LEFT JOIN LATERAL public.biz_brand_person_authorized_contact(v_brand_id,p.id,r.channel,'marketing') a ON true
  ), eligible AS (
    SELECT * FROM targets WHERE (channel='push' AND recipient_id IS NOT NULL)
      OR (channel<>'push' AND contact_id IS NOT NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'brandPersonId',person_id,'inviteId',invite_id,'predecessorAttemptId',predecessor_id,'channel',channel,
    'contactMethodId',contact_id,'recipientUserId',recipient_id,'normalizedContact',normalized_contact,
    'allowed',NOT suppressed,'safeReasonCode',CASE WHEN suppressed THEN reason END,
    'lastContactAt',last_contact_at,'eventUrl',v_event_url
  ) ORDER BY person_id,channel,COALESCE(contact_id,recipient_id)),'[]') INTO v_rows FROM eligible;
  RETURN jsonb_build_object('brandId',v_brand_id,'eventUrl',v_event_url,'selectedCount',v_selected,
    'eligibleCount',v_selected,'candidates',v_rows,'retryPushPayload',v_retry_push);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_frame(p_value text)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT CASE WHEN p_value IS NULL THEN decode('00','hex')
    ELSE decode('01','hex')||int4send(octet_length(convert_to(p_value,'UTF8')))||convert_to(p_value,'UTF8') END
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_json_keys(p_value jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT COALESCE(array_agg(k ORDER BY k),'{}') FROM jsonb_object_keys(p_value) k
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_selection_hash(p_selection jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, extensions, pg_temp AS $function$
DECLARE v_kind text; v_bytes bytea;
BEGIN
  v_kind:=p_selection->>'kind';
  IF v_kind IN ('all_brand_people','invited_people') AND public.issue_1770_json_keys(p_selection)=ARRAY['kind']::text[] THEN
    v_bytes:=public.issue_1770_frame('mingla:offering-selection:v1')||public.issue_1770_frame(v_kind);
    RETURN encode(extensions.digest(v_bytes,'sha256'),'hex');
  END IF;
  IF v_kind IN ('resolved_brand_people_v1','failed_attempts_v1') AND p_selection->>'source'='guest_roster_actions'
    AND COALESCE(p_selection->>'selectionHash','')~'^[0-9a-f]{64}$' THEN RETURN p_selection->>'selectionHash'; END IF;
  RAISE EXCEPTION 'offering_send_selection_invalid' USING ERRCODE='22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_seal_offering_execution_snapshot(
  p_actor_id uuid,p_selection jsonb,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp
AS $function$
DECLARE
  v_event uuid; v_brand uuid; v_purpose text; v_channels text[]; v_selection_hash text;
  v_live jsonb; v_candidate jsonb; v_live_candidate jsonb; v_campaign jsonb; v_sms jsonb;
  v_payload_hash text; v_payload_hashes text[]:='{}'; v_eligibility text; v_quote text; v_execution text;
  v_bytes bytea; v_index integer:=0; v_channel text; v_expected_cost bigint:=0; v_segments bigint:=0;
  v_alloc bigint:=0; v_candidate_count integer; v_previous_key text:=NULL; v_rate_ids text[]:='{}';
  v_replay_semantics boolean:=false;
BEGIN
  IF p_execution_snapshot IS NULL OR octet_length(convert_to(p_execution_snapshot::text,'UTF8')) NOT BETWEEN 1 AND 262144
    OR public.issue_1770_json_keys(p_execution_snapshot)<>ARRAY['brandId','campaigns','candidates','channels','eligibilityHash','eventId','executionSnapshotHash','purpose','quote','quotedAt','schemaVersion','selectionHash']::text[]
    OR p_execution_snapshot->>'schemaVersion'<>'1' THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  BEGIN v_event:=(p_execution_snapshot->>'eventId')::uuid; v_brand:=(p_execution_snapshot->>'brandId')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  v_purpose:=p_execution_snapshot->>'purpose';
  SELECT array_agg(x ORDER BY ord) INTO v_channels FROM jsonb_array_elements_text(p_execution_snapshot->'channels') WITH ORDINALITY q(x,ord);
  IF v_purpose NOT IN ('invitation','reminder','retry_delivery') OR NOT public.issue_1770_channels_valid(v_channels)
    OR v_brand<>public.issue_1770_offering_actor_brand(p_actor_id,v_event,false) THEN
    RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501';
  END IF;
  v_selection_hash:=public.issue_1770_selection_hash(p_selection);
  IF p_execution_snapshot->>'selectionHash'<>v_selection_hash THEN RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='40001'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.marketing_send_groups g WHERE g.event_id=v_event AND g.brand_id=v_brand
    AND g.created_by=p_actor_id AND g.execution_snapshot_hash=p_execution_snapshot->>'executionSnapshotHash') INTO v_replay_semantics;
  IF v_replay_semantics THEN v_live:=jsonb_build_object('candidates',p_execution_snapshot->'candidates');
  ELSE v_live:=public.biz_offering_send_quote_candidates(p_actor_id,v_event,v_purpose,p_selection,v_channels); END IF;
  IF NOT v_replay_semantics AND v_purpose='retry_delivery' AND 'push'=ANY(v_channels)
    AND p_execution_snapshot->'campaigns'->'push' IS DISTINCT FROM v_live->'retryPushPayload' THEN
    RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
  END IF;
  v_candidate_count:=jsonb_array_length(p_execution_snapshot->'candidates');
  IF v_candidate_count NOT BETWEEN 1 AND 500 OR v_candidate_count<>jsonb_array_length(v_live->'candidates') THEN
    RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='40001';
  END IF;
  IF public.issue_1770_json_keys(p_execution_snapshot->'campaigns')<>ARRAY['email','push','sms']::text[]
    OR public.issue_1770_json_keys(p_execution_snapshot->'quote')<>ARRAY['currency','estimatedCostMinor','quoteHash','rateIds','smsSegments']::text[] THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  FOREACH v_channel IN ARRAY ARRAY['email','push','sms']::text[] LOOP
    v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
    IF v_channel=ANY(v_channels) AND (v_campaign IS NULL OR v_campaign='null'::jsonb) THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
    IF NOT(v_channel=ANY(v_channels)) AND v_campaign<>'null'::jsonb THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH v_channel IN ARRAY v_channels LOOP
    v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
    IF v_channel='email' THEN
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['bodyHtml','bodyText','embeddedEventIds','payloadHash','payloadVersion','subject','volatileLinkMarker']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'volatileLinkMarker'<>'__MINGLA_OFFERING_INVITE_URL_V1__'
        OR v_campaign->'embeddedEventIds'<>jsonb_build_array(v_event::text)
        OR octet_length(convert_to(v_campaign->>'subject','UTF8'))>200 OR octet_length(convert_to(v_campaign->>'bodyHtml','UTF8'))>50000
        OR octet_length(convert_to(v_campaign->>'bodyText','UTF8'))>10000
        OR (length(v_campaign->>'bodyHtml')-length(replace(v_campaign->>'bodyHtml','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        OR (length(v_campaign->>'bodyText')-length(replace(v_campaign->>'bodyText','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'subject')||public.issue_1770_frame(v_campaign->>'bodyHtml')||public.issue_1770_frame(v_campaign->>'bodyText')
        ||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_campaign->>'volatileLinkMarker');
    ELSIF v_channel='sms' THEN
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['body','embeddedEventIds','payloadHash','payloadVersion','volatileLinkMarker']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'volatileLinkMarker'<>'__MINGLA_OFFERING_INVITE_URL_V1__'
        OR v_campaign->'embeddedEventIds'<>jsonb_build_array(v_event::text) OR octet_length(convert_to(v_campaign->>'body','UTF8'))>10000
        OR (length(v_campaign->>'body')-length(replace(v_campaign->>'body','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'body')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_campaign->>'volatileLinkMarker');
    ELSE
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['body','eventId','payloadHash','payloadVersion','title']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'eventId'<>v_event::text
        OR octet_length(convert_to(v_campaign->>'title','UTF8'))>200 OR octet_length(convert_to(v_campaign->>'body','UTF8'))>10000
        OR v_campaign::text LIKE '%__MINGLA_OFFERING_INVITE_URL_V1__%' THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'title')||public.issue_1770_frame(v_campaign->>'body')||public.issue_1770_frame(v_event::text);
    END IF;
    IF (v_campaign::text~'(?i)(oi=|javascript:|data:|http://)') OR v_campaign::text~E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]'
      OR regexp_replace(v_campaign::text,'https://(business\\.usemingla\\.com|cdn\\.usemingla\\.com|mingla\\.app|usemingla\\.com|www\\.usemingla\\.com)','', 'gi')~'(?i)https://' THEN
      RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023';
    END IF;
    v_payload_hash:=encode(extensions.digest(v_bytes,'sha256'),'hex');
    IF v_campaign->>'payloadHash'<>v_payload_hash THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
    v_payload_hashes:=array_append(v_payload_hashes,v_payload_hash);
  END LOOP;
  v_bytes:=public.issue_1770_frame('mingla:offering-eligibility:v1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_brand::text)
    ||public.issue_1770_frame(v_purpose)||public.issue_1770_frame(v_selection_hash);
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates') LOOP
    v_index:=v_index+1; v_live_candidate:=v_live->'candidates'->(v_index-1);
    IF public.issue_1770_json_keys(v_candidate)<>ARRAY['attemptKind','brandPersonId','candidateKey','channel','contactMethodId','inviteId','outcome','predecessorAttemptId','recipientUserId','safeReasonCode','smsQuote']::text[]
      OR v_previous_key IS NOT NULL AND v_candidate->>'candidateKey'<=v_previous_key
      OR (v_candidate->>'candidateKey')<>concat(v_candidate->>'brandPersonId',':',v_candidate->>'channel',':',COALESCE(v_candidate->>'contactMethodId',v_candidate->>'recipientUserId'))
      OR (NOT v_replay_semantics AND ((v_candidate->>'brandPersonId')<>(v_live_candidate->>'brandPersonId') OR (v_candidate->>'channel')<>(v_live_candidate->>'channel')
      OR COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId','') OR COALESCE(v_candidate->>'recipientUserId','')<>COALESCE(v_live_candidate->>'recipientUserId','')
      OR COALESCE(v_candidate->>'inviteId','')<>COALESCE(v_live_candidate->>'inviteId','') OR COALESCE(v_candidate->>'predecessorAttemptId','')<>COALESCE(v_live_candidate->>'predecessorAttemptId','')
      OR (v_candidate->>'outcome')<>(CASE WHEN (v_live_candidate->>'allowed')::boolean THEN 'queued' ELSE 'suppressed' END)
      OR COALESCE(v_candidate->>'safeReasonCode','')<>COALESCE(v_live_candidate->>'safeReasonCode',''))) THEN
      RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='40001';
    END IF;
    v_previous_key:=v_candidate->>'candidateKey';
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'brandPersonId')
      ||public.issue_1770_frame(v_candidate->>'inviteId')||public.issue_1770_frame(v_candidate->>'predecessorAttemptId')||public.issue_1770_frame(v_candidate->>'channel')
      ||public.issue_1770_frame(v_candidate->>'contactMethodId')||public.issue_1770_frame(v_candidate->>'recipientUserId')||public.issue_1770_frame(v_candidate->>'outcome')
      ||public.issue_1770_frame(v_candidate->>'safeReasonCode')||public.issue_1770_frame(v_candidate->>'attemptKind');
  END LOOP;
  v_eligibility:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->>'eligibilityHash'<>v_eligibility THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  BEGIN v_segments:=(p_execution_snapshot->'quote'->>'smsSegments')::bigint; v_expected_cost:=(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  SELECT COALESCE(array_agg(x ORDER BY x),'{}') INTO v_rate_ids FROM jsonb_array_elements_text(p_execution_snapshot->'quote'->'rateIds') x;
  IF v_rate_ids<>ARRAY(SELECT DISTINCT unnest(v_rate_ids) ORDER BY 1) THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-quote:v1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_purpose);
  FOREACH v_channel IN ARRAY v_channels LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_channel); END LOOP;
  v_bytes:=v_bytes||public.issue_1770_frame(v_eligibility)||public.issue_1770_frame(v_segments::text)||public.issue_1770_frame(v_expected_cost::text)||public.issue_1770_frame(p_execution_snapshot->'quote'->>'currency');
  FOREACH v_payload_hash IN ARRAY v_rate_ids LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOREACH v_payload_hash IN ARRAY v_payload_hashes LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates')
    ORDER BY value->>'brandPersonId',value->>'channel',value->>'contactMethodId'
  LOOP
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'outcome'); v_sms:=v_candidate->'smsQuote';
    IF v_sms IS NULL OR v_sms='null'::jsonb THEN v_bytes:=v_bytes||public.issue_1770_frame(NULL);
    ELSE
      IF public.issue_1770_json_keys(v_sms)<>ARRAY['allocatedCostMinor','country','currency','minorDenominator','minorNumerator','provider','rateId','segments']::text[] THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=v_bytes||public.issue_1770_frame(v_sms->>'segments')||public.issue_1770_frame(v_sms->>'rateId')||public.issue_1770_frame(v_sms->>'provider')||public.issue_1770_frame(v_sms->>'country')||public.issue_1770_frame(v_sms->>'currency')||public.issue_1770_frame(v_sms->>'minorNumerator')||public.issue_1770_frame(v_sms->>'minorDenominator')||public.issue_1770_frame(v_sms->>'allocatedCostMinor');
      v_alloc:=v_alloc+(v_sms->>'allocatedCostMinor')::bigint;
    END IF;
  END LOOP;
  IF v_alloc<>v_expected_cost THEN RAISE EXCEPTION 'offering_execution_cost_invalid' USING ERRCODE='22023'; END IF;
  v_quote:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->'quote'->>'quoteHash'<>v_quote THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-execution:v1')||public.issue_1770_frame('1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_brand::text)||public.issue_1770_frame(v_purpose);
  FOREACH v_channel IN ARRAY v_channels LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_channel); END LOOP;
  v_bytes:=v_bytes||public.issue_1770_frame(v_selection_hash)||public.issue_1770_frame(v_eligibility)||public.issue_1770_frame(v_quote);
  FOREACH v_payload_hash IN ARRAY v_payload_hashes LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates') LOOP
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'brandPersonId')||public.issue_1770_frame(v_candidate->>'inviteId')||public.issue_1770_frame(v_candidate->>'predecessorAttemptId')||public.issue_1770_frame(v_candidate->>'channel')||public.issue_1770_frame(v_candidate->>'contactMethodId')||public.issue_1770_frame(v_candidate->>'recipientUserId')||public.issue_1770_frame(v_candidate->>'outcome')||public.issue_1770_frame(v_candidate->>'attemptKind');
  END LOOP;
  v_execution:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->>'executionSnapshotHash'<>v_execution THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('eligibilityHash',v_eligibility,'quoteHash',v_quote,'executionSnapshotHash',v_execution,'valid',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_next_attempt_ordinal(p_invite_id uuid,p_channel text)
RETURNS smallint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE v_ordinal integer;
BEGIN
  IF p_channel NOT IN ('email','sms','push') THEN
    RAISE EXCEPTION 'offering_attempt_channel_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_invite_id::text || ':' || p_channel,1770));
  SELECT COALESCE(max(attempt_ordinal),0)+1 INTO v_ordinal
  FROM public.brand_offering_invite_delivery_attempts
  WHERE invite_id=p_invite_id AND channel=p_channel;
  IF v_ordinal>32767 THEN RAISE EXCEPTION 'offering_attempt_ordinal_exhausted' USING ERRCODE='54000'; END IF;
  RETURN v_ordinal::smallint;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_execute_offering_send_group(
  p_actor_id uuid,p_event_id uuid,p_purpose text,p_selection jsonb,p_channels text[],
  p_client_request_id uuid,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp
AS $function$
DECLARE
  v_brand uuid; v_existing public.marketing_send_groups%ROWTYPE; v_group_id uuid:=gen_random_uuid();
  v_predecessor public.brand_offering_invite_delivery_attempts%ROWTYPE;
  v_source_invite public.brand_offering_invites%ROWTYPE; v_source_group public.marketing_send_groups%ROWTYPE;
  v_seal jsonb; v_quoted_at timestamptz; v_candidate jsonb; v_campaign jsonb; v_campaign_id uuid;
  v_audience_id uuid; v_invite_id uuid; v_channel text; v_status text; v_ordinal smallint;
  v_campaign_ids jsonb:='[]'; v_selected integer; v_queued integer:=0; v_suppressed integer:=0;
  v_predecessor_id uuid; v_push_payload jsonb:=NULL; v_push_hash text:=NULL;
BEGIN
  IF p_event_id IS DISTINCT FROM (p_execution_snapshot->>'eventId')::uuid OR p_purpose IS DISTINCT FROM p_execution_snapshot->>'purpose'
    OR p_channels IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(p_execution_snapshot->'channels')) THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,true);
  SELECT * INTO v_existing FROM public.marketing_send_groups WHERE brand_id=v_brand AND client_request_id=p_client_request_id FOR UPDATE;
  IF v_existing.id IS NOT NULL AND v_existing.created_by<>p_actor_id THEN RAISE EXCEPTION 'idempotency_actor_mismatch' USING ERRCODE='23505'; END IF;
  v_seal:=public.biz_seal_offering_execution_snapshot(p_actor_id,p_selection,p_execution_snapshot);
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.execution_snapshot_hash<>p_execution_snapshot->>'executionSnapshotHash' THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('groupId',v_existing.id,'status',v_existing.status,'selectedCount',v_existing.selected_count,
      'eligibleCount',v_existing.eligible_count,'reachableCount',v_existing.reachable_count,'suppressedCount',v_existing.suppressed_count,
      'estimatedCostMinor',v_existing.estimated_cost_minor,'currency',v_existing.currency,'replayed',true,
      'campaignIds',COALESCE((SELECT jsonb_agg(campaign_id ORDER BY campaign_id) FROM public.marketing_send_group_campaigns WHERE send_group_id=v_existing.id),'[]'));
  END IF;
  IF p_purpose='retry_delivery' THEN
    FOR v_predecessor_id IN
      SELECT DISTINCT (value->>'predecessorAttemptId')::uuid
      FROM jsonb_array_elements(p_execution_snapshot->'candidates') ORDER BY 1
    LOOP
      SELECT * INTO v_predecessor FROM public.brand_offering_invite_delivery_attempts
        WHERE id=v_predecessor_id FOR UPDATE;
      IF NOT FOUND OR v_predecessor.status<>'failed' OR NOT v_predecessor.is_retryable
        OR v_predecessor.provider_message_id IS NOT NULL
        OR NOT (v_predecessor.channel=ANY(p_channels))
        OR EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts later
          WHERE later.invite_id=v_predecessor.invite_id AND later.channel=v_predecessor.channel
            AND later.attempt_ordinal>v_predecessor.attempt_ordinal)
      THEN RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023'; END IF;
      SELECT * INTO v_source_invite FROM public.brand_offering_invites
        WHERE id=v_predecessor.invite_id FOR UPDATE;
      SELECT * INTO v_source_group FROM public.marketing_send_groups
        WHERE id=v_predecessor.send_group_id FOR UPDATE;
      IF v_source_invite.status<>'active' OR v_source_invite.superseded_by_invite_id IS NOT NULL
        OR v_source_invite.event_id<>p_event_id OR v_source_invite.brand_id<>v_brand
        OR v_source_group.event_id<>p_event_id OR v_source_group.brand_id<>v_brand THEN
        RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
      END IF;
      IF v_predecessor.channel='push' THEN
        IF NOT public.issue_1770_push_payload_valid(v_source_group.push_payload_v1,p_event_id,v_source_group.push_payload_hash) THEN
          RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
        END IF;
        IF v_push_payload IS NULL THEN
          v_push_payload:=v_source_group.push_payload_v1; v_push_hash:=v_source_group.push_payload_hash;
        ELSIF v_push_hash IS DISTINCT FROM v_source_group.push_payload_hash
          OR v_push_payload IS DISTINCT FROM v_source_group.push_payload_v1 THEN
          RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
        END IF;
      END IF;
    END LOOP;
    IF 'push'=ANY(p_channels) AND (v_push_payload IS NULL
      OR p_execution_snapshot->'campaigns'->'push' IS DISTINCT FROM v_push_payload) THEN
      RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
    END IF;
  ELSIF 'push'=ANY(p_channels) THEN
    v_push_payload:=p_execution_snapshot->'campaigns'->'push';
    v_push_hash:=v_push_payload->>'payloadHash';
  END IF;
  BEGIN v_quoted_at:=(p_execution_snapshot->>'quotedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  IF v_quoted_at<now()-interval '5 minutes' OR v_quoted_at>now()+interval '30 seconds' THEN
    RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='40001'; END IF;
  SELECT count(DISTINCT value->>'brandPersonId') INTO v_selected FROM jsonb_array_elements(p_execution_snapshot->'candidates');
  SELECT count(*) FILTER(WHERE value->>'outcome'='queued'),count(*) FILTER(WHERE value->>'outcome'='suppressed')
    INTO v_queued,v_suppressed FROM jsonb_array_elements(p_execution_snapshot->'candidates');
  INSERT INTO public.marketing_send_groups(id,event_id,brand_id,purpose,client_request_id,channels,selection_snapshot,
    selected_count,eligible_count,reachable_count,suppressed_count,skipped_count,queued_count,estimated_cost_minor,currency,
    eligibility_hash,quote_hash,quoted_at,execution_snapshot_hash,push_payload_v1,push_payload_hash,created_by)
  VALUES(v_group_id,p_event_id,v_brand,p_purpose,p_client_request_id,p_channels,
    jsonb_build_object('kind',p_selection->>'kind','selectionHash',p_execution_snapshot->>'selectionHash'),
    v_selected,v_selected,v_queued,v_suppressed,0,v_queued,(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint,
    NULLIF(p_execution_snapshot->'quote'->>'currency','')::char(3),p_execution_snapshot->>'eligibilityHash',
    p_execution_snapshot->'quote'->>'quoteHash',v_quoted_at,p_execution_snapshot->>'executionSnapshotHash',
    v_push_payload,v_push_hash,p_actor_id);
  FOREACH v_channel IN ARRAY p_channels LOOP
    IF v_channel IN ('email','sms') THEN
      v_audience_id:=gen_random_uuid(); v_campaign_id:=gen_random_uuid(); v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
      INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition,is_system_generated)
        VALUES(v_audience_id,p_actor_id,v_brand,format('Offering send %s %s',left(v_group_id::text,8),v_channel),
          jsonb_build_object('kind','offering_send_group','send_group_id',v_group_id,'channel',v_channel),true);
      INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status,scheduled_for)
        VALUES(v_campaign_id,p_actor_id,v_brand,v_audience_id,format('Offering %s',p_purpose),v_channel,
          CASE WHEN v_channel='email' THEN jsonb_build_object('kind','email','subject',v_campaign->>'subject','body_html',v_campaign->>'bodyHtml',
            'body_text',v_campaign->>'bodyText','embedded_events',v_campaign->'embeddedEventIds','volatile_link_marker',v_campaign->>'volatileLinkMarker','payload_hash',v_campaign->>'payloadHash')
          ELSE jsonb_build_object('kind','sms','body',v_campaign->>'body','embedded_events',v_campaign->'embeddedEventIds',
            'volatile_link_marker',v_campaign->>'volatileLinkMarker','payload_hash',v_campaign->>'payloadHash') END,
          'scheduled',now());
      INSERT INTO public.marketing_send_group_campaigns(send_group_id,campaign_id,channel) VALUES(v_group_id,v_campaign_id,v_channel);
      v_campaign_ids:=v_campaign_ids||jsonb_build_array(v_campaign_id);
    END IF;
  END LOOP;
  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates')
    ORDER BY value->>'brandPersonId',value->>'channel',value->>'contactMethodId'
  LOOP
    INSERT INTO public.brand_offering_invites(brand_id,event_id,brand_person_id,status,origin,invited_at,created_by,removed_at,removal_reason,superseded_by_invite_id)
      VALUES(v_brand,p_event_id,(v_candidate->>'brandPersonId')::uuid,'active','attached_blast',now(),p_actor_id,NULL,NULL,NULL)
      ON CONFLICT(event_id,brand_person_id) DO UPDATE SET status='active',removed_at=NULL,removal_reason=NULL,superseded_by_invite_id=NULL,updated_at=now()
      RETURNING id INTO v_invite_id;
    -- The namespace lock covers the read-and-increment through transaction end.
    -- Canonical candidate ordering above prevents opposite-order deadlocks when
    -- two groups overlap on more than one invite/channel namespace.
    v_ordinal:=public.issue_1770_next_attempt_ordinal(v_invite_id,v_candidate->>'channel');
    v_status:=CASE WHEN v_candidate->>'outcome'='queued' THEN 'queued' ELSE 'suppressed' END;
    SELECT campaign_id INTO v_campaign_id FROM public.marketing_send_group_campaigns WHERE send_group_id=v_group_id AND channel=v_candidate->>'channel';
    INSERT INTO public.brand_offering_invite_delivery_attempts(invite_id,send_group_id,campaign_id,contact_method_id,recipient_user_id,
      channel,attempt_kind,attempt_ordinal,retry_of_attempt_id,status,safe_reason_code,estimated_cost_minor,currency,queued_at)
    VALUES(v_invite_id,v_group_id,v_campaign_id,(v_candidate->>'contactMethodId')::uuid,(v_candidate->>'recipientUserId')::uuid,
      v_candidate->>'channel',v_candidate->>'attemptKind',v_ordinal,(v_candidate->>'predecessorAttemptId')::uuid,v_status,
      v_candidate->>'safeReasonCode',COALESCE((v_candidate->'smsQuote'->>'allocatedCostMinor')::bigint,0),
      NULLIF(v_candidate->'smsQuote'->>'currency','')::char(3),CASE WHEN v_status='queued' THEN now() END);
  END LOOP;
  RETURN jsonb_build_object('groupId',v_group_id,'status','queued','selectedCount',v_selected,'eligibleCount',v_selected,
    'reachableCount',v_queued,'suppressedCount',v_suppressed,'estimatedCostMinor',(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint,
    'currency',p_execution_snapshot->'quote'->>'currency','replayed',false,'campaignIds',v_campaign_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_execute_offering_delivery_retry(
  p_actor_id uuid,p_event_id uuid,p_failed_attempt_ids uuid[],p_channels text[],p_client_request_id uuid,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_selection jsonb;
BEGIN
  IF p_failed_attempt_ids IS DISTINCT FROM ARRAY(SELECT DISTINCT (x->>'predecessorAttemptId')::uuid FROM jsonb_array_elements(p_execution_snapshot->'candidates') x ORDER BY 1) THEN
    RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
  END IF;
  v_selection:=jsonb_build_object('kind','failed_attempts_v1','failedAttemptIds',to_jsonb(p_failed_attempt_ids),
    'selectionHash',p_execution_snapshot->>'selectionHash','source','guest_roster_actions');
  RETURN public.biz_execute_offering_send_group(p_actor_id,p_event_id,'retry_delivery',v_selection,p_channels,p_client_request_id,p_execution_snapshot);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_offering_send_group_audience(p_send_group_id uuid,p_channel text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_group public.marketing_send_groups%ROWTYPE; v_rows jsonb;
BEGIN
  SELECT * INTO v_group FROM public.marketing_send_groups WHERE id=p_send_group_id;
  IF NOT FOUND OR p_channel NOT IN ('email','sms') OR NOT (p_channel=ANY(v_group.channels)) THEN
    RAISE EXCEPTION 'offering_send_group_audience_invalid' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contact_key',c.id,'display_name',p.display_name,'first_name',split_part(btrim(p.display_name),' ',1),
    'raw_email',CASE WHEN p_channel='email' THEN c.normalized_value ELSE NULL END,
    'raw_phone',CASE WHEN p_channel='sms' THEN c.normalized_value ELSE NULL END,
    'last_event_id',v_group.event_id,'email_marketing_ok',p_channel='email','sms_marketing_ok',p_channel='sms',
    'offering_invite',jsonb_build_object('attempt_id',a.id,'invite_id',i.id,'event_id',v_group.event_id)
  ) ORDER BY p.display_name,p.id),'[]'::jsonb) INTO v_rows
  FROM public.brand_offering_invite_delivery_attempts a
  JOIN public.brand_offering_invites i ON i.id=a.invite_id
  JOIN public.brand_people p ON p.id=i.brand_person_id
  JOIN public.brand_person_contact_methods c ON c.id=a.contact_method_id
  WHERE a.send_group_id=p_send_group_id AND a.channel=p_channel AND a.status='queued'
    AND i.status='active' AND p.record_status='active' AND c.record_state='active'
    AND c.provenance_scope='brand_owned' AND c.is_exportable;
  RETURN jsonb_build_object('rows',v_rows,'brand_id',v_group.brand_id,
    'reach',jsonb_build_object('total',jsonb_array_length(v_rows),'reachable_email',CASE WHEN p_channel='email' THEN jsonb_array_length(v_rows) ELSE 0 END,'reachable_sms',CASE WHEN p_channel='sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_offering_guest_roster_export_rows(p_job_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'export_provider_not_ready' USING ERRCODE='55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_brand_people_export_rows(p_job_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'export_job_not_found' USING ERRCODE='P0002'; END IF;
  IF v_job.export_kind='offering_guest_roster' THEN
    RETURN QUERY SELECT * FROM public.biz_offering_guest_roster_export_rows(p_job_id); RETURN;
  END IF;
  RETURN QUERY
  WITH people AS (
    SELECT p.id,p.display_name,
      (SELECT c.normalized_value FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='email' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1) primary_email,
      COALESCE((SELECT jsonb_agg(c.normalized_value ORDER BY c.normalized_value) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='email' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable AND NOT c.is_primary),'[]'::jsonb) alternate_emails,
      (SELECT c.normalized_value FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='phone' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1) primary_phone,
      COALESCE((SELECT jsonb_agg(c.normalized_value ORDER BY c.normalized_value) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.channel='phone' AND c.record_state='active' AND c.provenance_scope='brand_owned' AND c.is_exportable AND NOT c.is_primary),'[]'::jsonb) alternate_phones,
      (SELECT min(source_occurred_at) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id) first_source,
      (SELECT max(source_occurred_at) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id) last_source,
      COALESCE((SELECT jsonb_agg(DISTINCT source_kind ORDER BY source_kind) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id),'[]'::jsonb) source_types,
      EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.channel='email' AND s.lifted_at IS NULL) suppressed_email,
      EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.channel='sms' AND s.lifted_at IS NULL) suppressed_sms
    FROM public.brand_people p WHERE p.brand_id=v_job.brand_id AND p.record_status='active'
  ), filtered AS (
    SELECT * FROM people x
    WHERE (v_job.filter_json->>'filter'='all'
      OR (v_job.filter_json->>'filter'='suppressed' AND (x.suppressed_email OR x.suppressed_sms))
      OR (v_job.filter_json->>'filter'='reachable' AND
        ((x.primary_email IS NOT NULL AND NOT x.suppressed_email) OR (x.primary_phone IS NOT NULL AND NOT x.suppressed_sms))))
      AND (v_job.filter_json->>'search'=''
        OR strpos(lower(x.display_name),v_job.filter_json->>'search')>0
        OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods c
          WHERE c.brand_person_id=x.id AND c.record_state='active' AND c.provenance_scope='brand_owned'
            AND c.is_exportable AND strpos(lower(c.normalized_value),v_job.filter_json->>'search')>0))
  )
  SELECT jsonb_build_object(
    'personId',x.id,'name',x.display_name,'primaryEmail',x.primary_email,'alternateEmails',x.alternate_emails,
    'primaryPhone',x.primary_phone,'alternatePhones',x.alternate_phones,'firstSource',x.first_source,'lastSource',x.last_source,
    'sourceTypes',x.source_types,'suppressedEmail',x.suppressed_email,'suppressedSms',x.suppressed_sms)
  FROM filtered x
  ORDER BY
    CASE WHEN v_job.filter_json->>'sort'='action_priority' THEN (x.suppressed_email OR x.suppressed_sms)::integer END DESC,
    CASE WHEN v_job.filter_json->>'sort'='recent_first' THEN x.last_source END DESC NULLS LAST,
    CASE WHEN v_job.filter_json->>'sort' IN ('action_priority','name_asc') THEN lower(x.display_name) END ASC,
    CASE WHEN v_job.filter_json->>'sort'='name_desc' THEN lower(x.display_name) END DESC,
    x.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_export_brand_people(
  p_scope text,p_event_id uuid DEFAULT NULL,p_filter text DEFAULT 'all',p_search text DEFAULT NULL,
  p_sort text DEFAULT 'action_priority',p_filter_snapshot jsonb DEFAULT '{}'::jsonb,
  p_client_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $function$
DECLARE v_brand uuid; v_actor uuid:=auth.uid(); v_job public.brand_people_export_jobs%ROWTYPE; v_snapshot jsonb; v_hash text; v_search text;
BEGIN
  v_search:=lower(regexp_replace(btrim(COALESCE(p_search,'')),'\\s+',' ','g'));
  IF p_scope NOT IN ('brand_book','offering_guest_roster')
     OR (p_scope='brand_book' AND (p_event_id IS NOT NULL OR p_filter NOT IN ('all','reachable','suppressed')))
     OR (p_scope='offering_guest_roster' AND (p_event_id IS NULL OR p_filter NOT IN ('all','rsvpd','ticketed','not_yet','suppressed')))
     OR p_sort NOT IN ('action_priority','name_asc','name_desc','recent_first')
     OR length(v_search)>200
     OR v_search~E'[\\x00-\\x1F\\x7F]'
     OR p_filter_snapshot IS NULL OR jsonb_typeof(p_filter_snapshot)<>'object' OR p_filter_snapshot<>'{}'::jsonb THEN
    RAISE EXCEPTION 'export_filter_invalid' USING ERRCODE='22023';
  END IF;
  IF p_scope='offering_guest_roster' THEN SELECT brand_id INTO v_brand FROM public.events WHERE id=p_event_id AND deleted_at IS NULL;
  ELSE SELECT b.id INTO v_brand FROM public.brands b WHERE b.account_id=v_actor AND b.deleted_at IS NULL ORDER BY b.created_at,b.id LIMIT 1; END IF;
  IF v_actor IS NULL OR v_brand IS NULL OR public.biz_brand_effective_rank(v_brand,v_actor)<public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'brand_people_export_forbidden' USING ERRCODE='42501';
  END IF;
  -- Persist only server-normalized query state. Caller-defined keys, row IDs,
  -- contacts, and query fragments never cross the request boundary.
  v_snapshot:=jsonb_build_object('filter',p_filter,'search',v_search,'sort',p_sort);
  v_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE brand_id=v_brand AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_job.filter_hash<>v_hash OR v_job.export_kind<>p_scope OR v_job.scope_id IS DISTINCT FROM p_event_id THEN RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='23505'; END IF;
  ELSE
    INSERT INTO public.brand_people_export_jobs(brand_id,export_kind,scope_id,filter_json,filter_hash,client_request_id,requested_by)
      VALUES(v_brand,p_scope,p_event_id,v_snapshot,v_hash,p_client_request_id,v_actor) RETURNING * INTO v_job;
  END IF;
  RETURN jsonb_build_object('jobId',v_job.id,'status',v_job.status,'exportableCount',v_job.row_count,
    'omittedPersonCount',v_job.omitted_person_count,'omittedFieldCount',v_job.omitted_field_count,
    'result',CASE WHEN v_job.status='ready' THEN jsonb_build_object('fileName',regexp_replace(v_job.storage_path,'^.*/',''),'expiresAt',v_job.expires_at) ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_get_brand_people_export_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE; v_actor uuid:=auth.uid();
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id;
  IF NOT FOUND OR v_actor IS NULL OR public.biz_brand_effective_rank(v_job.brand_id,v_actor)<public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'brand_people_export_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'jobId',v_job.id,
    'status',v_job.status,
    'result',CASE WHEN v_job.status='ready' AND v_job.expires_at>now() THEN jsonb_build_object(
      'fileName',regexp_replace(v_job.storage_path,'^.*/',''),
      'expiresAt',v_job.expires_at
    ) ELSE NULL END,
    'safeErrorCode',v_job.safe_error_code
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_get_brand_people_export_storage(p_job_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT storage_path
  FROM public.brand_people_export_jobs
  WHERE id=p_job_id AND status='ready' AND expires_at>now()
$function$;

CREATE OR REPLACE FUNCTION public.biz_claim_brand_people_export_jobs(
  p_worker_id uuid,p_limit integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF p_worker_id IS NULL OR p_limit<1 OR p_limit>5 THEN
    RAISE EXCEPTION 'export_claim_invalid' USING ERRCODE='22023';
  END IF;
  WITH candidates AS (
    SELECT id FROM public.brand_people_export_jobs
    WHERE (status='queued' AND next_attempt_at<=now())
       OR (status='running' AND last_heartbeat_at<now()-interval '5 minutes')
    ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END,next_attempt_at,created_at,id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.brand_people_export_jobs j SET
      status='running',attempt_count=LEAST(3,attempt_count+1),locked_at=now(),
      locked_by=p_worker_id,last_heartbeat_at=now(),updated_at=now()
    FROM candidates c WHERE j.id=c.id
    RETURNING j.id,j.brand_id,j.export_kind,j.scope_id,j.filter_json,j.attempt_count,
      j.prepared_storage_path,j.prepared_row_count,j.prepared_checksum
  ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed) ORDER BY id),'[]'::jsonb) INTO v_rows FROM claimed;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_heartbeat_brand_people_export(
  p_job_id uuid,p_worker_id uuid
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  WITH updated AS (
    UPDATE public.brand_people_export_jobs SET last_heartbeat_at=now(),updated_at=now()
    WHERE id=p_job_id AND status='running' AND locked_by=p_worker_id RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated)
$function$;

CREATE OR REPLACE FUNCTION public.biz_prepare_brand_people_export_upload(
  p_job_id uuid,p_worker_id uuid,p_storage_path text,p_row_count integer,p_checksum text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'running' OR v_job.locked_by IS DISTINCT FROM p_worker_id
     OR p_storage_path<>format('brand/%s/%s.csv',v_job.brand_id,v_job.id)
     OR p_row_count<0 OR p_checksum !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'export_prepare_invalid' USING ERRCODE='22023';
  END IF;
  IF v_job.prepared_checksum IS NOT NULL AND
     ROW(v_job.prepared_storage_path,v_job.prepared_row_count,v_job.prepared_checksum)
       IS DISTINCT FROM ROW(p_storage_path,p_row_count,p_checksum) THEN
    RAISE EXCEPTION 'export_prepared_checksum_conflict' USING ERRCODE='23514';
  END IF;
  UPDATE public.brand_people_export_jobs SET prepared_storage_path=p_storage_path,
    prepared_row_count=p_row_count,prepared_checksum=p_checksum,last_heartbeat_at=now(),updated_at=now()
    WHERE id=p_job_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_retry_or_fail_brand_people_export(
  p_job_id uuid,p_worker_id uuid,p_safe_error_code text,p_retryable boolean
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'running' OR v_job.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'export_lease_lost' USING ERRCODE='55000';
  END IF;
  v_status:=CASE WHEN p_retryable AND v_job.attempt_count<3 THEN 'queued' ELSE 'failed' END;
  UPDATE public.brand_people_export_jobs SET status=v_status,
    next_attempt_at=CASE v_job.attempt_count WHEN 1 THEN now()+interval '1 minute' ELSE now()+interval '5 minutes' END,
    locked_at=NULL,locked_by=NULL,last_heartbeat_at=NULL,
    safe_error_code=left(COALESCE(p_safe_error_code,'export_failed'),120),updated_at=now()
    WHERE id=p_job_id;
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_complete_brand_people_export(
  p_job_id uuid,p_worker_id uuid,p_storage_path text,p_row_count integer,
  p_omitted_person_count integer DEFAULT 0,p_omitted_field_count integer DEFAULT 0,p_checksum text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'running' OR v_job.locked_by IS DISTINCT FROM p_worker_id
     OR v_job.prepared_storage_path IS DISTINCT FROM p_storage_path
     OR v_job.prepared_row_count IS DISTINCT FROM p_row_count
     OR v_job.prepared_checksum IS DISTINCT FROM p_checksum THEN
    RAISE EXCEPTION 'export_completion_invalid' USING ERRCODE='55000';
  END IF;
  UPDATE public.brand_people_export_jobs SET status='ready',storage_path=p_storage_path,
    row_count=p_row_count,omitted_person_count=GREATEST(p_omitted_person_count,0),
    omitted_field_count=GREATEST(p_omitted_field_count,0),expires_at=now()+interval '24 hours',
    ready_at=now(),safe_error_code=NULL,locked_at=NULL,locked_by=NULL,last_heartbeat_at=NULL,updated_at=now()
    WHERE id=p_job_id;
  INSERT INTO public.brand_people_export_audit(job_id,brand_id,requested_by,export_kind,scope_id,row_count,provenance_counts)
    VALUES(v_job.id,v_job.brand_id,v_job.requested_by,v_job.export_kind,v_job.scope_id,p_row_count,jsonb_build_object('brand_owned',p_row_count))
    ON CONFLICT(job_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_expire_brand_people_export(
  p_job_id uuid,p_storage_path text
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  WITH updated AS (
    UPDATE public.brand_people_export_jobs SET status='expired',storage_path=NULL,
      prepared_storage_path=NULL,updated_at=now()
    WHERE id=p_job_id AND storage_path=p_storage_path AND expires_at<=now()
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated)
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_reconcile_marketing_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_status text;
BEGIN
  v_status:=CASE NEW.status WHEN 'sent' THEN 'sending' WHEN 'delivered' THEN 'delivered' WHEN 'failed' THEN 'failed' WHEN 'bounced' THEN 'failed' WHEN 'preview_skipped' THEN 'suppressed' ELSE NULL END;
  IF v_status IS NULL THEN RETURN NEW; END IF;
  -- #876 ONE PERSON/CHANNEL — provider acceptance is point-of-no-return; never redispatch on lost terminal write.
  UPDATE public.brand_offering_invite_delivery_attempts a SET
    marketing_message_id=NEW.id,status=v_status,provider_message_id=COALESCE(NEW.provider_message_id,a.provider_message_id),
    sent_at=CASE WHEN v_status IN ('sending','delivered') THEN COALESCE(a.sent_at,NEW.sent_at,now()) ELSE a.sent_at END,
    delivered_at=CASE WHEN v_status='delivered' THEN COALESCE(NEW.delivered_at,now()) ELSE a.delivered_at END,
    failed_at=CASE WHEN v_status='failed' THEN now() ELSE a.failed_at END,
    safe_reason_code=CASE WHEN v_status='failed' THEN 'campaign_delivery_failed' WHEN v_status='suppressed' THEN 'provider_io_disabled' ELSE a.safe_reason_code END,updated_at=now()
  WHERE a.campaign_id=NEW.campaign_id AND a.channel=CASE WHEN NEW.channel='sms' THEN 'sms' ELSE 'email' END
    AND EXISTS(SELECT 1 FROM public.brand_person_contact_methods c WHERE c.id=a.contact_method_id AND c.normalized_value=COALESCE(public.issue_1770_normalize_email(NEW.recipient_email),public.issue_1770_normalize_phone(NEW.recipient_phone)));
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_reconcile_marketing_message AFTER INSERT OR UPDATE OF status,provider_message_id ON public.marketing_messages
  FOR EACH ROW EXECUTE FUNCTION public.issue_1770_reconcile_marketing_message();

CREATE OR REPLACE FUNCTION public.issue_1770_user_erasure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM set_config('mingla.issue1770_erasure_user',OLD.id::text,true);
  UPDATE public.brand_people SET linked_user_id=NULL,avatar_url=NULL,updated_at=now() WHERE linked_user_id=OLD.id;
  UPDATE public.brand_offering_invite_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE linked_user_id=OLD.id;
  UPDATE public.brand_offering_invite_delivery_attempts SET recipient_user_id=NULL,recipient_erased_at=COALESCE(recipient_erased_at,now()) WHERE recipient_user_id=OLD.id;
  UPDATE public.marketing_send_groups SET created_by_erased_at=COALESCE(created_by_erased_at,now()) WHERE created_by=OLD.id;
  RETURN OLD;
END;
$function$;
CREATE TRIGGER issue_1770_user_erasure BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.issue_1770_user_erasure();

CREATE OR REPLACE FUNCTION public.issue_1770_brand_erasure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.brand_people SET record_status='deleted',deleted_at=now(),linked_user_id=NULL,avatar_url=NULL,merged_into_person_id=NULL,updated_at=now()
      WHERE brand_id=NEW.id AND record_status<>'deleted';
    UPDATE public.brand_offering_invite_tokens t SET revoked_at=COALESCE(t.revoked_at,now()) FROM public.brand_offering_invites i WHERE i.id=t.invite_id AND i.brand_id=NEW.id;
    UPDATE public.brand_people_export_jobs SET status='expired',expires_at=now(),updated_at=now() WHERE brand_id=NEW.id AND status IN ('queued','running','ready');
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_1770_brand_erasure AFTER UPDATE OF deleted_at ON public.brands FOR EACH ROW EXECUTE FUNCTION public.issue_1770_brand_erasure();

INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'event_rsvp',r.id,'upsert','backfill:'||r.id::text FROM public.event_rsvps r ON CONFLICT DO NOTHING;
INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'rsvp_plus_one',g.id,'upsert','backfill:'||g.id::text FROM public.event_rsvp_guests g ON CONFLICT DO NOTHING;
INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'order',o.id,'upsert','backfill:'||o.id::text FROM public.orders o WHERE o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled') ON CONFLICT DO NOTHING;
INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
  SELECT 'ticket_holder',t.id,'upsert','backfill:'||t.id::text FROM public.tickets t JOIN public.orders o ON o.id=t.order_id WHERE o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled') ON CONFLICT DO NOTHING;

DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['brand_people','brand_person_source_links','brand_person_contact_methods','brand_offering_invites','marketing_send_groups','brand_offering_invite_delivery_attempts','brand_person_ingest_outbox','brand_people_export_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER issue_1770_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.issue_1770_touch_updated_at()', v_table);
  END LOOP;
END;
$block$;

DO $block$
DECLARE v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_brand_person_canonical(uuid)','public.biz_merge_brand_people(uuid,uuid,text,uuid,uuid)',
    'public.biz_reverse_brand_person_merge(uuid,uuid)','public.biz_validate_offering_invite_token(text,uuid,uuid,text,text,text)',
    'public.biz_brand_person_authorized_contact(uuid,uuid,text,text)',
    'public.biz_prepare_offering_invite_delivery(uuid,uuid,text,smallint)',
    'public.biz_claim_offering_invite_provider_io(uuid,uuid,text)',
    'public.biz_preflight_offering_push_provider_io(uuid)',
    'public.biz_claim_offering_push_provider_io(uuid,uuid,text,jsonb)',
    'public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)',
    'public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)',
    'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)',
    'public.biz_resolve_brand_person_source_derived(text,uuid)','public.biz_claim_brand_person_ingest(integer)',
    'public.biz_finish_brand_person_ingest(uuid,boolean,text)','public.biz_record_brand_person_suppression(text,text,text,uuid,uuid,text,text,uuid)',
    'public.biz_offering_send_quote_candidates(uuid,uuid,text,jsonb,text[])',
    'public.biz_seal_offering_execution_snapshot(uuid,jsonb,jsonb)',
    'public.biz_execute_offering_send_group(uuid,uuid,text,jsonb,text[],uuid,jsonb)',
    'public.biz_execute_offering_delivery_retry(uuid,uuid,uuid[],text[],uuid,jsonb)',
    'public.biz_create_offering_send_group(uuid,text,jsonb,text[],uuid)','public.biz_offering_send_group_audience(uuid,text)','public.biz_offering_guest_roster_export_rows(uuid)',
    'public.biz_brand_people_export_rows(uuid)','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)',
    'public.biz_get_brand_people_export_job(uuid)','public.biz_get_brand_people_export_storage(uuid)',
    'public.biz_claim_brand_people_export_jobs(uuid,integer)','public.biz_heartbeat_brand_people_export(uuid,uuid)',
    'public.biz_prepare_brand_people_export_upload(uuid,uuid,text,integer,text)',
    'public.biz_retry_or_fail_brand_people_export(uuid,uuid,text,boolean)',
    'public.biz_complete_brand_people_export(uuid,uuid,text,integer,integer,integer,text)',
    'public.biz_expire_brand_people_export(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_signature);
  END LOOP;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.issue_1770_touch_updated_at()','public.issue_1770_channels_valid(text[])',
    'public.issue_1770_offering_actor_brand(uuid,uuid,boolean)',
    'public.issue_1770_frame(text)','public.issue_1770_json_keys(jsonb)','public.issue_1770_selection_hash(jsonb)',
    'public.issue_1770_push_payload_valid(jsonb,uuid,text)','public.issue_1770_push_payload_immutable()',
    'public.issue_1770_normalize_email(text)','public.issue_1770_normalize_phone(text)',
    'public.issue_1770_validate_person_merge()','public.issue_1770_validate_invite_scope()',
    'public.issue_1770_delivery_attempt_transition()','public.issue_1770_invite_token_immutable()',
    'public.issue_1770_project_offering_push_delivery(uuid)',
    'public.issue_1770_enqueue_source()','public.issue_1770_next_attempt_ordinal(uuid,text)',
    'public.issue_1770_project_channel_suppression()','public.issue_1770_project_marketing_unsubscribe()',
    'public.issue_1770_reconcile_marketing_message()','public.issue_1770_user_erasure()',
    'public.issue_1770_brand_erasure()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_signature);
  END LOOP;
END;
$block$;
GRANT EXECUTE ON FUNCTION public.biz_list_brand_people(uuid,text,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_get_brand_people_export_job(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.biz_list_brand_people(uuid,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.biz_create_offering_send_group(uuid,text,jsonb,text[],uuid) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.biz_get_brand_people_export_job(uuid) FROM PUBLIC,anon;

COMMENT ON TABLE public.brand_people IS '#876 Ring-1 canonical brand people; required by #873. Source transactions remain authoritative.';
COMMENT ON TABLE public.brand_person_ingest_outbox IS '#876/#873 SOURCE FAIL-OPEN — contains only source keys; resolver failures never roll back RSVP/payment.';
COMMENT ON TABLE public.brand_offering_invite_delivery_attempts IS '#876 ONE PERSON/CHANNEL — provider acceptance is point-of-no-return; never redispatch on lost terminal write.';

DO $block$
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'issue_1770_export_worker_dependencies_missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url') THEN
    RAISE NOTICE 'issue-1770 advisory: vault.decrypted_secrets row "supabase_url" missing. The Brand People export cron will register but its http_post calls will fail until the operator creates it.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE 'issue-1770 advisory: vault.decrypted_secrets row "service_role_key" missing. The Brand People export cron will register but its http_post calls will fail until the operator creates it.';
  END IF;
END;
$block$;

SELECT cron.schedule(
  'issue_1770_brand_people_export_worker',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        || '/functions/v1/brand-people-export-worker',
      headers := jsonb_build_object(
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'content-type','application/json'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

COMMIT;
