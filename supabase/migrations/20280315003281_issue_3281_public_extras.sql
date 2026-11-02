-- issue #3281 — Extras, slice 4 (server): buyers read each ticket's extras
-- from the same reader that serves the event.
--
-- The design (#3283 §3.4) puts extras on the payload that already carries the
-- tiers, so a buyer surface has no extras loading or error state: if the
-- tickets rendered, the extras rendered. Both public event readers are wrapped
-- the way #3872 wrapped them, and a ticket gains an `extras` key only when it
-- has an active extra, so every payload without extras is byte-identical.
--
-- Each extra carries, from the server only:
--   priceCents / priceAllInCents — the all-in price uses compute_all_in_cents
--     with the same inputs pg_public_event_tier_pricing uses for a ticket, so
--     the client never grosses a price (the #1167 all-in rule, orch-1153).
--   validOccurrenceIds — event_dates ids it is sold on; null means every date
--     its ticket admits.
--   remaining — null when unlimited; a number for a shared count; an object
--     keyed by event_dates id for a date-limited extra, whose count is per date.

BEGIN;

CREATE FUNCTION public.issue_3281_public_ticket_extras(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'description', a.description,
      'priceCents', a.price_cents,
      'priceAllInCents', CASE WHEN a.price_cents = 0 THEN 0 ELSE public.compute_all_in_cents(
        a.price_cents,
        COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
        COALESCE(e.pass_service_fee, b.default_pass_service_fee),
        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
      ) END,
      'maxPerTicket', a.max_per_ticket,
      'isUnlimited', a.is_unlimited,
      'validOccurrenceIds', CASE WHEN a.valid_occurrence_keys IS NULL THEN NULL ELSE to_jsonb(ARRAY(
        SELECT d.id FROM public.event_dates d
         WHERE d.event_id = e.id AND d.occurrence_key = ANY (a.valid_occurrence_keys)
         ORDER BY d.start_at, d.id)) END,
      'remaining', CASE
        WHEN a.is_unlimited THEN NULL
        WHEN a.valid_occurrence_keys IS NULL
          THEN to_jsonb(GREATEST(a.quantity_total - public.issue_3281_add_on_taken(a.id, NULL, NULL), 0))
        ELSE COALESCE((
          SELECT jsonb_object_agg(d.id::text,
                   GREATEST(a.quantity_total - public.issue_3281_add_on_taken(a.id, d.occurrence_key, NULL), 0))
            FROM public.event_dates d
           WHERE d.event_id = e.id AND d.occurrence_key = ANY (a.valid_occurrence_keys)
        ), '{}'::jsonb)
      END
    ) ORDER BY a.sort_order, a.id), '[]'::jsonb)
  FROM public.ticket_add_ons a
  JOIN public.ticket_types tt ON tt.id = a.ticket_type_id
  JOIN public.events e ON e.id = tt.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE a.ticket_type_id = p_ticket_type_id
    AND a.is_active
    AND tt.deleted_at IS NULL;
$fn$;

-- Adds `extras` to each ticket that has any, keeping the payload's key order
-- (refundPolicy stays last, as #3872 and #3284 require). Anything that isn't an
-- object with an extra on sale comes back untouched, byte for byte.
CREATE FUNCTION public.issue_3281_attach_public_extras(p_payload json)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_out json;
BEGIN
  IF p_payload IS NULL OR json_typeof(p_payload) <> 'object'
     OR json_typeof(p_payload->'tickets') IS DISTINCT FROM 'array'
     OR NOT EXISTS (
       SELECT 1 FROM json_array_elements(p_payload->'tickets') t
         JOIN public.ticket_add_ons a
           ON a.ticket_type_id = CASE WHEN (t->>'id') ~* v_uuid THEN (t->>'id')::uuid END
        WHERE a.is_active) THEN
    RETURN p_payload;
  END IF;
  SELECT json_object_agg(entry.key,
      CASE WHEN entry.key = 'tickets' THEN (
        SELECT jsonb_agg(
          item.value::jsonb || CASE WHEN x.extras <> '[]'::jsonb
            THEN jsonb_build_object('extras', x.extras) ELSE '{}'::jsonb END
          ORDER BY item.ordinality)
        FROM json_array_elements(entry.value) WITH ORDINALITY item(value, ordinality)
        -- Each ticket's extras are read once.
        CROSS JOIN LATERAL (
          SELECT CASE WHEN (item.value->>'id') ~* v_uuid
            THEN public.issue_3281_public_ticket_extras((item.value->>'id')::uuid)
            ELSE '[]'::jsonb END AS extras
        ) x
      )::json
      ELSE entry.value END
      ORDER BY entry.ordinality)
    INTO v_out
    FROM json_each(p_payload) WITH ORDINALITY entry(key, value, ordinality);
  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_public_ticket_extras(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_attach_public_extras(json) FROM PUBLIC, anon, authenticated;

-- Wrap both public readers, keeping their signatures, grants and settings.
DO $install$
DECLARE
  v_body text;
BEGIN
  SELECT regexp_replace(p.prosrc, E';\\s*$', '') INTO v_body
    FROM pg_proc p WHERE p.oid = 'public.pg_public_event_by_slug(text,text)'::regprocedure;
  IF position('issue_3281_attach_public_extras' IN v_body) > 0 THEN
    RAISE EXCEPTION 'issue_3281_public_extras_already_wrapped';
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text,p_event_slug text) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS %L',
    format(E'WITH issue_3281_original(payload) AS MATERIALIZED (\n%s\n)\n'
      'SELECT public.issue_3281_attach_public_extras(payload) FROM issue_3281_original;', v_body));

  SELECT regexp_replace(p.prosrc, E';\\s*$', '') INTO v_body
    FROM pg_proc p
   WHERE p.oid = 'public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure;
  IF position('issue_3281_attach_public_extras' IN v_body) > 0 THEN
    RAISE EXCEPTION 'issue_3281_public_extras_already_wrapped';
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle('
    'p_event_id uuid DEFAULT NULL,p_brand_slug text DEFAULT NULL,p_event_slug text DEFAULT NULL) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path='''' AS %L',
    format(E'WITH issue_3281_original(payload) AS MATERIALIZED (\n%s\n)\n'
      'SELECT public.issue_3281_attach_public_extras(payload) FROM issue_3281_original;', v_body));
END;
$install$;

NOTIFY pgrst, 'reload schema';

COMMIT;
