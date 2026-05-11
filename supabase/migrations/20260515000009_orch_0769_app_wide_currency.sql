-- ORCH-0769: app-wide currency after Stripe onboarding.
--
-- brands.default_currency is the canonical brand commerce default.
-- stripe_connect_accounts.default_currency is Stripe account metadata.
-- events.currency freezes the immutable commerce currency for an event.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'GBP';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_currency_supported_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_currency_supported_check
  CHECK (
    currency = ANY (
      ARRAY[
        'GBP'::bpchar,
        'USD'::bpchar,
        'CAD'::bpchar,
        'CHF'::bpchar,
        'EUR'::bpchar,
        'BGN'::bpchar,
        'CZK'::bpchar,
        'DKK'::bpchar,
        'HUF'::bpchar,
        'ISK'::bpchar,
        'NOK'::bpchar,
        'PLN'::bpchar,
        'RON'::bpchar,
        'SEK'::bpchar
      ]
    )
  );

WITH ticket_currency AS (
  SELECT
    tt.event_id,
    CASE WHEN count(DISTINCT upper(tt.currency::text)) = 1
      THEN max(upper(tt.currency::text))
      ELSE NULL
    END AS currency
  FROM public.ticket_types tt
  WHERE tt.deleted_at IS NULL
  GROUP BY tt.event_id
)
UPDATE public.events e
SET currency = upper(
  COALESCE(
    (
      SELECT tc.currency
      FROM ticket_currency tc
      WHERE tc.event_id = e.id
    ),
    b.default_currency::text,
    'GBP'
  )
)::char(3)
FROM public.brands b
WHERE b.id = e.brand_id;

CREATE OR REPLACE FUNCTION public.tg_enforce_event_ticket_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event_currency char(3);
BEGIN
  SELECT e.currency
  INTO v_event_currency
  FROM public.events e
  WHERE e.id = NEW.event_id;

  IF v_event_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_not_found';
  END IF;

  IF upper(COALESCE(NEW.currency::text, ''))::char(3) <> v_event_currency THEN
    RAISE EXCEPTION 'ticket_currency_must_match_event_currency';
  END IF;

  NEW.currency := v_event_currency;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_ticket_currency ON public.ticket_types;
CREATE TRIGGER trg_enforce_event_ticket_currency
  BEFORE INSERT OR UPDATE OF event_id, currency ON public.ticket_types
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.tg_enforce_event_ticket_currency();

CREATE OR REPLACE FUNCTION "public"."tg_sync_brand_stripe_cache"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.brands
  SET
    stripe_connect_id =
      CASE WHEN NEW.detached_at IS NOT NULL THEN NULL ELSE NEW.stripe_account_id END,
    stripe_charges_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.charges_enabled END,
    stripe_payouts_enabled =
      CASE WHEN NEW.detached_at IS NOT NULL THEN false ELSE NEW.payouts_enabled END,
    default_currency =
      CASE
        WHEN NEW.detached_at IS NOT NULL THEN brands.default_currency
        ELSE upper(NEW.default_currency::text)::char(3)
      END
  WHERE id = NEW.brand_id;

  RETURN NEW;
END;
$$;

UPDATE public.brands b
SET default_currency = upper(sca.default_currency::text)::char(3)
FROM public.stripe_connect_accounts sca
WHERE sca.brand_id = b.id
  AND sca.detached_at IS NULL
  AND sca.default_currency IS NOT NULL;

CREATE OR REPLACE VIEW public.business_management_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  e.created_by,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  e.title,
  e.description,
  e.slug,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  (e.theme - 'business_draft') AS management_theme,
  e.currency
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE
  e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_management_events_view TO authenticated, service_role;
REVOKE SELECT ON public.business_management_events_view FROM anon;

CREATE OR REPLACE VIEW public.business_public_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  e.title,
  e.description,
  e.slug,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  (e.theme - 'business_draft') AS public_theme,
  e.currency
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE
  e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_publish_event_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_tickets jsonb;
  v_ticket jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_timezone text;
  v_visibility text;
  v_currency char(3);
  v_price numeric;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);
  v_tickets := COALESCE(v_business_draft->'tickets', '[]'::jsonb);
  v_currency := upper(COALESCE(
    NULLIF(v_business_draft->>'currency', ''),
    NULLIF(p_draft_payload->>'currency', ''),
    v_brand.default_currency::text,
    'GBP'
  ))::char(3);

  IF v_currency <> ALL (
    ARRAY[
      'GBP'::bpchar,
      'USD'::bpchar,
      'CAD'::bpchar,
      'CHF'::bpchar,
      'EUR'::bpchar,
      'BGN'::bpchar,
      'CZK'::bpchar,
      'DKK'::bpchar,
      'HUF'::bpchar,
      'ISK'::bpchar,
      'NOK'::bpchar,
      'PLN'::bpchar,
      'RON'::bpchar,
      'SEK'::bpchar
    ]
  ) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  IF jsonb_typeof(v_tickets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_tickets) = 0 THEN
    RAISE EXCEPTION 'event_ticket_required';
  END IF;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    IF NULLIF(btrim(COALESCE(v_ticket->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'ticket_name_required';
    END IF;

    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    IF COALESCE((v_ticket->>'isFree')::boolean, false) = true THEN
      IF v_price <> 0 THEN
        RAISE EXCEPTION 'free_ticket_price_must_be_zero';
      END IF;
    ELSE
      IF v_price < 0 THEN
        RAISE EXCEPTION 'ticket_price_cannot_be_negative';
      END IF;
    END IF;
    IF COALESCE((v_ticket->>'isUnlimited')::boolean, false) = false
      AND COALESCE((v_ticket->>'capacity')::integer, 0) <= 0
    THEN
      RAISE EXCEPTION 'ticket_capacity_required';
    END IF;
    IF NULLIF(COALESCE(v_ticket->>'password', ''), '') IS NOT NULL THEN
      RAISE EXCEPTION 'ticket_plaintext_password_forbidden';
    END IF;
  END LOOP;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'event';
  END IF;
  v_final_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = v_event.brand_id
      AND e.deleted_at IS NULL
      AND e.id <> p_event_id
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);

  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = COALESCE((p_draft_payload->>'is_recurring')::boolean, false),
    is_multi_date = COALESCE((p_draft_payload->>'is_multi_date')::boolean, false),
    recurrence_rules = p_draft_payload->'recurrence_rules',
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft - 'tickets') || jsonb_build_object('currency', v_currency::text),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    currency = v_currency,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  UPDATE public.ticket_types
  SET deleted_at = v_now, updated_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    INSERT INTO public.ticket_types (
      event_id,
      name,
      description,
      price_cents,
      currency,
      quantity_total,
      is_unlimited,
      is_free,
      sale_start_at,
      sale_end_at,
      min_purchase_qty,
      max_purchase_qty,
      is_hidden,
      is_disabled,
      requires_approval,
      allow_transfers,
      password_protected,
      password_hash,
      available_online,
      available_in_person,
      waitlist_enabled,
      display_order,
      deleted_at
    ) VALUES (
      p_event_id,
      btrim(v_ticket->>'name'),
      NULLIF(v_ticket->>'description', ''),
      CASE
        WHEN COALESCE((v_ticket->>'isFree')::boolean, false) THEN 0
        ELSE round(v_price * 100)::integer
      END,
      v_currency,
      CASE
        WHEN COALESCE((v_ticket->>'isUnlimited')::boolean, false) THEN NULL
        ELSE COALESCE((v_ticket->>'capacity')::integer, 0)
      END,
      COALESCE((v_ticket->>'isUnlimited')::boolean, false),
      COALESCE((v_ticket->>'isFree')::boolean, false),
      NULLIF(v_ticket->>'saleStartAt', '')::timestamptz,
      NULLIF(v_ticket->>'saleEndAt', '')::timestamptz,
      COALESCE((v_ticket->>'minPurchaseQty')::integer, 1),
      NULLIF(v_ticket->>'maxPurchaseQty', '')::integer,
      COALESCE(v_ticket->>'visibility', 'public') = 'hidden',
      COALESCE(v_ticket->>'visibility', 'public') = 'disabled',
      COALESCE((v_ticket->>'approvalRequired')::boolean, false),
      COALESCE((v_ticket->>'allowTransfers')::boolean, true),
      COALESCE((v_ticket->>'passwordProtected')::boolean, false),
      NULL,
      COALESCE(v_ticket->>'availableAt', 'both') IN ('online', 'both'),
      COALESCE(v_ticket->>'availableAt', 'both') IN ('door', 'both'),
      COALESCE((v_ticket->>'waitlistEnabled')::boolean, false),
      COALESCE((v_ticket->>'displayOrder')::integer, 0),
      NULL
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'client_revision', p_client_revision
  );
END;
$$;

COMMENT ON COLUMN public.brands.default_currency IS
  'ORCH-0769: canonical brand commerce default for future Mingla pricing/display. Synced from active Stripe connected account currency by service-role trigger.';

COMMENT ON COLUMN public.stripe_connect_accounts.default_currency IS
  'ORCH-0769: Stripe connected account metadata. Not the app-wide UI source; brands.default_currency is canonical for future brand commerce state.';

COMMENT ON COLUMN public.events.currency IS
  'ORCH-0769: immutable commerce currency for published event ticket pricing and downstream transaction snapshots.';

COMMENT ON FUNCTION "public"."tg_sync_brand_stripe_cache"() IS
  'ORCH-0769: mirrors stripe_connect_accounts to brands Stripe cache and syncs active SCA default_currency into brands.default_currency; detach clears Stripe cache without resetting brand commerce currency.';

COMMENT ON FUNCTION public.tg_enforce_event_ticket_currency() IS
  'ORCH-0769: prevents new active ticket_types rows from diverging from events.currency.';

COMMENT ON FUNCTION public.business_publish_event_draft(uuid, jsonb, integer) IS
  'ORCH-0769: publishes business drafts with event/ticket currency from draft currency, brand default_currency, then GBP fallback; accepts legacy priceGbp and new price/priceMajor.';
