-- =====================================================================================
-- Issue #2489 — address privacy is enforced at the SERVER boundary.
--
-- WHAT: one fail-closed predicate, referenced by every anon-reachable read path that
-- can emit an offering's location, so a host who turns on "Hide address until ticket
-- purchase" is not relying on a renderer to keep that promise.
--
-- WHY HERE AND NOT IN A CLIENT: the withheld values were already on the wire before any
-- renderer ran. A client-side check cannot close that, and app builds already installed
-- on phones cannot be patched by shipping new client code. Gating the server objects
-- corrects every consumer at once — mobile, buyer web, business web, SSR/Open Graph —
-- with no client change and no redeploy of anything but the database.
--
-- THE CLASS: the sibling slug RPCs (pg_public_event_by_slug,
-- pg_direct_event_checkout_bundle, pg_public_rsvp_by_slug, pg_public_experience_by_slug)
-- already implement this rule correctly. Four other anon-reachable objects did not, and
-- each implemented (or failed to implement) the rule independently. This migration
-- defines the rule ONCE and points all four at it, so they cannot drift apart again.
--
-- NOT DOING (deliberate, evidenced in the SPEC):
--   * No data migration. No row is edited. The defect is entirely in the read layer.
--   * No coordinate is derived, rounded, jittered or otherwise invented for a gated
--     offering. Missing is hidden, never faked (Constitution #9). A gated offering with
--     no city-level centroid renders as a venue-name + city text card and no map —
--     which is already exactly what the gated slug RPC returns for it today.
--   * city_geo is NOT gated. It is the privacy-safe city centroid by design and the
--     gated RPCs return it unconditionally.
--
-- ORDERING: strictly greater than 20270522002463. Collision-scanned against the anchor
-- checkout and all sibling worktrees under ~/Desktop/mingla-orchs/ immediately before
-- this file was created; nothing above 20270522002463 existed anywhere.
--
-- DEPLOY: `supabase db push` is NOT safe for this change. Six unapplied local migrations
-- from unrelated issues sit below it and a push would carry them along. Apply this file's
-- SQL alone, then insert only its history row, then re-read the live definitions and
-- confirm the gate symbol is present (a deploy command's exit code is not evidence).
-- =====================================================================================

BEGIN;

-- =====================================================================================
-- 1 — THE PREDICATE. Defined once; referenced by every gated site below.
--
-- FAILS CLOSED, and the cast is TOTAL:
--
--   key = true                  -> true  (withhold)   the gated case
--   key = false                 -> false (reveal)     the opted-out case
--   key ABSENT                  -> true  (withhold)   a legacy row must never leak
--   theme IS NULL               -> true  (withhold)
--   key present, NOT a boolean  -> true  (withhold)   AND THE READ DOES NOT RAISE
--
-- That last row is the reason this is a jsonb_typeof test rather than a bare
-- `(theme #>> path)::boolean`. `('garbage')::boolean` raises invalid input syntax, which
-- on this path would turn a privacy gate into a 500 on every public offering read. No
-- production row carries a non-boolean at that key today, so this is hardening rather
-- than a live fix — but nothing in the schema PREVENTS a future writer from putting a
-- string there, and a privacy gate must not be one bad write away from a site-wide
-- outage. Pinned by the fixture's non-boolean scenario.
--
-- Matches the semantics the correct sibling RPCs already implement, and the client
-- mappers' asBoolean(..., true) default, so all of them now share one rule.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.issue_2489_address_withheld(p_theme jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE
           WHEN pg_catalog.jsonb_typeof(p_theme #> '{business_event,hideAddressUntilTicket}') = 'boolean'
             THEN (p_theme #>> '{business_event,hideAddressUntilTicket}')::boolean
           ELSE true
         END
$function$;

COMMENT ON FUNCTION public.issue_2489_address_withheld(jsonb) IS
  '#2489 — the single address-privacy predicate. TRUE means WITHHOLD. Fails closed on an '
  'absent key, a NULL theme, and any non-boolean value at the key, and never raises. '
  'Every anon-reachable read path that can emit an offering location references THIS '
  'function; do not re-implement the rule at a call site.';

-- Not SECURITY DEFINER: it runs with the caller's rights everywhere. events_public_view
-- is security_invoker, so anon evaluates the predicate itself and needs EXECUTE.
REVOKE ALL ON FUNCTION public.issue_2489_address_withheld(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_2489_address_withheld(jsonb)
  TO anon, authenticated, service_role;

-- =====================================================================================
-- 1b — THE PUBLIC-THEME PROJECTION. Also defined once, and also TOTAL.
--
-- The predicate above cannot raise. The branch it used to guard could. Both jsonb
-- delete operators are undefined outside an object: subtracting a key from a scalar
-- or an array raises, and deleting a path whose first element is not an integer
-- raises on an array. `events.theme` is jsonb with NO shape CHECK and hosts hold
-- UPDATE on it, so one bad write was enough to turn a withhold into an exception —
-- and on the two LIST paths an exception is not confined to the offending row: it
-- answers an entire market's, or an entire brand's, request with an error. A gate
-- whose guard cannot fail but whose body can is fail-LOUD, not fail-closed.
--
-- Totality is achieved by testing the shape before every delete, never by catching:
--   theme IS NULL              -> NULL          (unchanged wire shape for a null theme)
--   theme is not an object     -> '{}'          (nothing to publish, nothing to leak)
--   location is not an object  -> skip the path delete; there is no address to strip
--
-- The host's unpublished draft blob is stripped on BOTH branches: it has no business
-- reaching a public caller regardless of the address question.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.issue_2489_public_theme(p_theme jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_theme IS NULL THEN NULL
    WHEN pg_catalog.jsonb_typeof(p_theme) IS DISTINCT FROM 'object' THEN '{}'::jsonb
    WHEN public.issue_2489_address_withheld(p_theme) THEN
      CASE WHEN pg_catalog.jsonb_typeof(p_theme #> '{business_event,location}') = 'object'
             THEN (p_theme - 'business_draft') #- '{business_event,location,address}'
           ELSE (p_theme - 'business_draft')
      END
    ELSE (p_theme - 'business_draft')
  END
$function$;

COMMENT ON FUNCTION public.issue_2489_public_theme(jsonb) IS
  '#2489 — the single public-theme projection. Strips the host draft blob always and '
  'the structured street address when the address is withheld. TOTAL on every jsonb '
  'shape including arrays, scalars and JSON null: it never raises, so one malformed '
  'row cannot answer a whole market''s feed with an exception.';

REVOKE ALL ON FUNCTION public.issue_2489_public_theme(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_2489_public_theme(jsonb)
  TO anon, authenticated, service_role;

-- =====================================================================================
-- 1c — THE PINNED REGISTRY of objects that must carry the shared gate.
--
-- Why a registry rather than a comment: for a SECURITY DEFINER object there is no
-- structural way to make the gate mandatory. Such an object bypasses row-level policy
-- and column grants by construction, so nothing below it can refuse on its behalf. A
-- later migration that re-emits one of them from a copy taken before this file will
-- silently drop the gate, and the diff will read as an addition rather than a removal.
-- Detection is the only defence left, so it has to be a good one.
--
-- The contract, enforced at the end of a full-chain replay by the fixture and again
-- here at apply time: the DECLARED set below must equal the set DISCOVERED by asking
-- the catalog which bodies actually reference the shared symbols. Equality, in both
-- directions, never a count — a count cannot see one object losing the gate while an
-- unrelated one gains it. A declared object that stops referencing the gate fails; an
-- undeclared object that starts referencing it fails too, because a gate spreading by
-- copy-paste into somewhere nobody reasoned about is its own defect.
--
-- Keep the REGISTRY FUNCTION BODY free of the shared symbol names: discovery reads
-- bodies, and comments are part of a body. The names now live as table DATA, which
-- pg_proc.prosrc never sees, so this constraint is satisfied structurally.
--
-- ── #3081 — WHY THE DECLARED SET IS A TABLE AND NOT A VALUES LIST ──────────────────
-- This function was a hardcoded VALUES list, re-emitted by every migration that added
-- a carrier. That made the registry REVERTIBLE BY AN OLDER FILE: re-applying THIS
-- migration ran a CREATE OR REPLACE that discarded every extension a LATER migration
-- had made, and the check below — which lives ~1,500 lines further down in this same
-- file — then compared the rewound list against a catalog that still held the newer
-- carrier and raised. #2986 added `public_search_source_facts` exactly as instructed
-- and still turned main red on 2026-09-02, because the `#2333` lane re-applies this
-- file alone as its last step and NOTHING re-applies #2986 after it.
--
-- A table fixes the property rather than the symptom: the declared set is APPEND-ONLY
-- and no re-apply, in any order, partial or full, can shrink it. A future migration
-- adding the eleventh carrier writes ONE `INSERT … ON CONFLICT DO NOTHING` and is
-- immune to this whole class — it does not have to know this issue ever existed.
-- REMOVING a carrier stays deliberate and loud: the removing migration must DELETE its
-- row in the same change, or the check below fails with "declared … not carrying".
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.issue_2489_gate_carriers (
  object_name text PRIMARY KEY,
  object_kind text NOT NULL CHECK (object_kind IN ('function', 'view'))
);

-- A new table in `public` inherits default-privilege grants for anon, authenticated AND
-- service_role, and every table in this schema must carry RLS (#1860).
--
-- service_role IS NAMED IN THE REVOKE DELIBERATELY. Leaving it out does not leave it
-- read-only — it leaves the inherited `arwdDxtm` untouched and makes the GRANT SELECT
-- below a NO-OP, so any service-key holder could INSERT, UPDATE, DELETE or TRUNCATE the
-- carrier map; service_role also has rolbypassrls, so RLS would not stop it either. The
-- SQL text read correctly and the catalog disagreed: verified by reading relacl back
-- from a live apply, not from this file.
--
-- After the revoke, service_role holds SELECT and nothing else. No policy is defined:
-- every WRITER is the migration applier or a fixture, and both run as the owner, so the
-- set is never written or compared through RLS.
ALTER TABLE public.issue_2489_gate_carriers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_2489_gate_carriers
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.issue_2489_gate_carriers TO service_role;

COMMENT ON TABLE public.issue_2489_gate_carriers IS
  '#2489 — the pinned set of objects required to carry the shared address-privacy '
  'gate, held as APPEND-ONLY DATA (#3081). Adding a gated object means INSERTing it '
  'here, ON CONFLICT DO NOTHING, in the same change that adds the object. Never '
  're-emit this set as a VALUES list from a function: that is what let an older '
  'migration revert a newer one''s extension on replay.';

INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
  ('issue_2489_public_theme',          'function'),
  ('business_public_events_view',      'view'),
  ('events_public_view',               'view'),
  ('pg_discover_business_events',      'function'),
  ('pg_public_brand_upcoming',         'function'),
  ('pg_public_event_by_slug',          'function'),
  ('pg_public_rsvp_by_slug',           'function'),
  ('pg_public_experience_by_slug',     'function'),
  ('pg_direct_event_checkout_bundle',  'function')
ON CONFLICT (object_name) DO NOTHING;

-- STABLE, not IMMUTABLE: the declared set is now read from a table.
CREATE OR REPLACE FUNCTION public.issue_2489_gate_registry()
RETURNS TABLE (object_name text, object_kind text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT r.object_name, r.object_kind FROM public.issue_2489_gate_carriers r
$function$;

COMMENT ON FUNCTION public.issue_2489_gate_registry() IS
  '#2489 — the pinned set of objects required to carry the shared address-privacy '
  'gate. Compared for SET EQUALITY, in both directions, against what the catalog '
  'actually references, at the end of a true-order full-chain replay. Adding a gated '
  'object means INSERTing it into public.issue_2489_gate_carriers in the same change '
  '(#3081); this function is a READER of that table and must never be re-emitted as a '
  'hardcoded list. Meaningful only to a reader that can see the table (owner or '
  'service_role); the fixture''s non-vacuity assertion pins that.';

REVOKE ALL ON FUNCTION public.issue_2489_gate_registry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_2489_gate_registry() TO anon, authenticated, service_role;

-- =====================================================================================
-- 2 — business_public_events_view.
--
-- Latest definer: 20270413001931_issue_1931_private_event_access.sql:642.
--
-- THREE columns change; every other column, its type and its ORDINAL POSITION are
-- byte-identical, because CREATE OR REPLACE VIEW cannot rename, retype or reorder and
-- because six consumers read this relation with `select("*")`. The withheld value
-- becomes NULL, which every one of those consumers already handles (each parses the pin
-- through a null-guarded parser and omits the map when it is absent). This is also why
-- a column-level REVOKE was rejected: `SELECT *` against a relation with a revoked
-- column raises permission denied, which would have hard-crashed the buyer-web event
-- page, the brand page and every social preview instead of degrading them honestly.
--
-- The `WITH (security_invoker = false)` reloption is RESTATED. A bare CREATE OR REPLACE
-- VIEW silently drops it (documented at 20270413001931:637-641). Definer rights are also
-- why the gate has to be an expression in the projection: this view does not inherit the
-- events RLS and cannot be fixed by a policy.
--
-- The theme vector is the one most likely to be missed: the structured street address
-- also lives at business_event.location.address inside the theme JSON, so nulling the
-- pin and the combined string alone would leave the address fully readable. `#-` removes
-- exactly that key. venueName survives so the venue card still renders, and
-- hideAddressUntilTicket survives so clients still know the state.
-- =====================================================================================
CREATE OR REPLACE VIEW public.business_public_events_view WITH (security_invoker = false) AS
  SELECT e.id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.description AS brand_description,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    b.address AS brand_address,
    b.cover_media_url AS brand_cover_media_url,
    b.theme_color AS brand_theme_color,
    b.theme_font AS brand_theme_font,
    b.theme_animation AS brand_theme_animation,
    e.title,
    e.description,
    e.slug,
    e.event_type,
    -- #2489 vector 1 of 3 — the combined "Venue · Street" string.
    CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END AS location_text,
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
    -- #2489 vector 3 of 3 — the structured street address nested in the theme JSON.
    -- The pre-existing `- 'business_draft'` strip is preserved on BOTH branches.
    public.issue_2489_public_theme(e.theme) AS public_theme,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
    -- #2489 vector 2 of 3 — the exact venue pin. Type is `point`; the CASE preserves it.
    CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_geo END AS location_geo,
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    (
      SELECT public.compute_all_in_cents(
               MIN(tt.price_cents),
               COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
               COALESCE(e.pass_service_fee, b.default_pass_service_fee),
               (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
             )
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.price_cents > 0
        AND tt.deleted_at IS NULL
    ) AS display_price_cents,
    -- ORCH-1150 RSVP host-control columns (inert for non-RSVP rows).
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
    (
      SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
      FROM public.event_rsvps r
      WHERE r.event_id = e.id
        AND r.rsvp_status = 'going'
        AND r.approval_status = 'approved'
    ) AS rsvp_going_count,
    -- ORCH-1167 — city-level privacy centroid. Deliberately NOT gated by #2489: it is
    -- the privacy-safe value, and the correctly-gated RPCs return it unconditionally.
    e.city_geo,
    -- ORCH-1291 [rsvp-chip-in] — voluntary contribution config.
    e.rsvp_contribution_enabled,
    e.rsvp_contribution_suggested_cents,
    e.rsvp_contribution_min_cents,
    -- issue #868 [cover-gallery] — ADDITIONAL image/GIF gallery items.
    e.cover_media_gallery
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]))
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);

COMMENT ON VIEW public.business_public_events_view IS
  '#2489 — anon-readable public offering read model. location_text, location_geo and the '
  'theme''s business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true. city_geo is exempt by design. Do not '
  're-emit this view without the gate, and do not re-implement the predicate inline.';

-- =====================================================================================
-- 3 — events_public_view.
--
-- Latest definer: 20270413001931_issue_1931_private_event_access.sql:607.
--
-- Same class, same treatment. This view additionally exposed the RAW `theme` column —
-- including the host's unpublished `business_draft` blob, which has no business reaching
-- an anon caller at all — so the strip mirrors the business view's: drop business_draft
-- unconditionally, and drop the street address when the gate says withhold.
--
-- `WITH ("security_invoker"='true')` is RESTATED for the same reason as above.
-- =====================================================================================
CREATE OR REPLACE VIEW "public"."events_public_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "brand_id",
    "title",
    "description",
    "slug",
    CASE WHEN "public"."issue_2489_address_withheld"("theme") THEN NULL ELSE "location_text" END AS "location_text",
    CASE WHEN "public"."issue_2489_address_withheld"("theme") THEN NULL ELSE "location_geo" END AS "location_geo",
    "online_url",
    "is_online",
    "is_recurring",
    "is_multi_date",
    "recurrence_rules",
    "cover_media_url",
    "cover_media_type",
    "public"."issue_2489_public_theme"("theme") AS "theme",
    "organiser_contact",
    "visibility",
    "show_on_discover",
    "show_in_swipeable_deck",
    "status",
    "published_at",
    "timezone",
    "created_at",
    "updated_at"
   FROM "public"."events"
  WHERE (("deleted_at" IS NULL) AND ("visibility" = 'public'::"text") AND ("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))
    AND NOT "public"."issue_1931_event_ordinary_read_blocked"("id"));

COMMENT ON VIEW public.events_public_view IS
  '#2489 — anon-readable event read model. location_text, location_geo and the theme''s '
  'business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true, and the host''s unpublished business_draft '
  'blob is stripped unconditionally.';

-- =====================================================================================
-- 4 — pg_discover_business_events.
--
-- Latest definer: 20270427002335_issue_2333_discover_online_carveout.sql:77.
-- Re-emitted forward from that body; the ONLY change is the three gated projection keys.
--
-- This is an anon-EXECUTABLE LIST endpoint — no slug required. It returns no rows today
-- only because of a data condition, not because of a gate; the defect is in the shipped
-- object and a single host action would have exposed it. Latent, not theoretical.
--
-- Runs under `SET search_path TO ''`, so the predicate is public.-qualified, exactly as
-- every other symbol in this body already is.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.pg_discover_business_events(p_cities text[], p_lower_bound timestamp with time zone, p_upper_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_party_types text[] DEFAULT NULL::text[], p_vibe_tags text[] DEFAULT NULL::text[], p_music_genres text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_limit integer DEFAULT 20, p_center_lng double precision DEFAULT NULL::double precision, p_center_lat double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH base AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug,
      e.location_text,
      e.location_geo,
      e.online_url,
      e.is_online,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      e.timezone,
      e.currency,
      e.city,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.event_type,
      b.slug AS brand_slug,
      b.name AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      ed.start_at AS master_start_at,
      ed.end_at AS master_end_at,
      ed.timezone AS master_timezone,
      (
        SELECT MIN(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_min_cents,
      (
        SELECT MAX(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_max_cents,
      EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE
          AND tt.price_cents > 0
      ) AS has_paid_online,
      (
        SELECT public.compute_all_in_cents(
          MIN(tt.price_cents),
          COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
          COALESCE(e.pass_service_fee, b.default_pass_service_fee),
          (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
        )
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.price_cents > 0
          AND tt.deleted_at IS NULL
      ) AS display_price_cents,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    INNER JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    INNER JOIN public.event_dates ed
      ON ed.event_id = e.id
     AND ed.is_master IS TRUE
     AND ed.end_at >= p_lower_bound
    WHERE e.deleted_at IS NULL
      AND e.visibility = 'public'
      -- ORCH-1150: admit opted-in RSVP rows alongside ticketed events.
      AND ( e.event_type = 'event'
         OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true) )
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      -- issue #1020: geo-radius OR-fallback on the venue pin. A sub-municipality
      -- venue (city label != browsed city) still surfaces when its pin sits inside
      -- the browsed metro radius; also rescues NULL-city rows that carry a pin.
      -- Every PostGIS symbol AND both type names are public.-qualified because
      -- this function runs under SET search_path = '' (bare ST_*/geometry/geography
      -- would throw does-not-exist). ST_DWithin on geography takes metres.
      --
      -- #2489: this arm reads e.location_geo to decide MEMBERSHIP. That is a
      -- server-side computation whose result is a row, not a coordinate — a gated
      -- event still belongs to the market it is physically in, and suppressing it
      -- from the feed would be a discovery regression rather than a privacy fix.
      -- The pin is withheld from the OUTPUT below, which is where it leaked.
      AND (
            e.city = ANY (p_cities)
         OR (
              p_center_lng IS NOT NULL
              AND p_center_lat IS NOT NULL
              AND p_radius_km  IS NOT NULL
              AND e.location_geo IS NOT NULL
              AND public.ST_DWithin(
                    public.ST_SetSRID(e.location_geo::public.geometry, 4326)::public.geography,
                    public.ST_SetSRID(public.ST_MakePoint(p_center_lng, p_center_lat), 4326)::public.geography,
                    p_radius_km * 1000
                  )
            )
         -- issue #2333 — ONLINE-ONLY carve-out. Seth, 2026-08-19: an online event
         -- surfaces in EVERY market. It has no city and no pin, so BOTH arms above are
         -- false for it (NULL = ANY(...) is NULL, not TRUE; location_geo IS NULL kills
         -- the radius arm) and it was returned by NO market, ever, with no error and no
         -- admin signal. Added LAST so the two existing arms keep their short-circuit
         -- and the common city/geo path is untouched.
         --
         -- The test is theme.business_event.format = 'online', NOT a bare e.is_online.
         -- `is_online` is written as `format === "online" || format === "hybrid"`
         -- (serverDraftEventMapper.ts:708), and a HYBRID event has a real venue, a real
         -- city and a real catchment — broadcasting it into every market on earth is
         -- spam, and is not what was decided. The two predicates differ by one conjunct
         -- and both produce a feed that looks plausible. The `e.is_online IS TRUE`
         -- conjunct is belt-and-braces so a stale/hand-edited theme key alone can never
         -- widen the feed. Pinned by DRAFT invariant
         -- I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED.
         OR (
              e.is_online IS TRUE
              AND lower(btrim(
                COALESCE(e.theme->'business_event'->>'format', ''),
                E' \t\n\r\f\v' || chr(160)
              )) = 'online'
            )
      )
      AND (p_upper_start IS NULL OR ed.start_at <= p_upper_start)
      AND (p_party_types IS NULL OR cardinality(p_party_types) = 0 OR e.party_types && p_party_types)
      AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags) = 0 OR e.vibe_tags && p_vibe_tags)
      AND (p_music_genres IS NULL OR cardinality(p_music_genres) = 0 OR e.music_genres && p_music_genres)
  ),
  gated AS (
    SELECT *
    FROM base
    WHERE NOT (has_paid_online AND NOT public.pg_brand_can_collect(brand_id))
  ),
  ranked AS (
    SELECT
      g.*,
      COUNT(*) OVER () AS total_count
    FROM gated g
    ORDER BY master_start_at ASC NULLS LAST
    OFFSET GREATEST(p_offset, 0)
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT total_count FROM ranked LIMIT 1), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'brand_id', r.brand_id,
            'title', r.title,
            'description', r.description,
            'slug', r.slug,
            -- #2489 — the three vectors, gated by the one shared predicate.
            'location_text', CASE WHEN public.issue_2489_address_withheld(r.theme) THEN NULL ELSE r.location_text END,
            'location_geo',  CASE WHEN public.issue_2489_address_withheld(r.theme) THEN NULL ELSE r.location_geo  END,
            'online_url', r.online_url,
            'is_online', r.is_online,
            'cover_media_url', r.cover_media_url,
            'cover_media_type', r.cover_media_type,
            'theme', public.issue_2489_public_theme(r.theme),
            'timezone', r.timezone,
            'currency', r.currency,
            'city', r.city,
            'party_types', r.party_types,
            'vibe_tags', r.vibe_tags,
            'music_genres', r.music_genres,
            'event_type', r.event_type,
            'brand_slug', r.brand_slug,
            'brand_name', r.brand_name,
            'brand_profile_photo_url', r.brand_profile_photo_url,
            'master_start_at', r.master_start_at,
            'master_end_at', r.master_end_at,
            'master_timezone', r.master_timezone,
            'price_min_cents', r.price_min_cents,
            'price_max_cents', r.price_max_cents,
            'display_price_cents', r.display_price_cents,
            'pricing_currency', r.pricing_currency
          )
          ORDER BY r.master_start_at ASC NULLS LAST
        )
        FROM ranked r
      ),
      '[]'::jsonb
    )
  );
$function$;

-- =====================================================================================
-- 5 — pg_public_brand_upcoming.
--
-- Latest definer: 20270413001931_issue_1931_private_event_access.sql:1606.
-- Re-emitted forward from that body; the ONLY change is the gated `theme` projection.
--
-- Its return signature carries no location_geo / location_text column, so the theme is
-- its only vector — but it projected `e.theme` RAW, stripping neither the street address
-- nor the host's unpublished `business_draft` blob. Both are closed here. The draft
-- strip is unconditional: an anon caller has no claim on a host's unpublished content
-- regardless of the address question.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(
  p_brand_slug text,
  p_cursor_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  offering_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  offering_type text,
  offering_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  starts_at timestamptz,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH offerings AS (
    SELECT
      e.id AS offering_id,
      e.brand_id,
      b.slug AS brand_slug,
      b.name AS brand_name,
      e.event_type AS offering_type,
      e.slug AS offering_slug,
      e.title,
      e.description,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      CASE e.event_type
        WHEN 'event' THEN ed.start_at
        WHEN 'rsvp' THEN ed.start_at
        WHEN 'trip' THEN ed.start_at
        WHEN 'experience' THEN NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz
      END AS starts_at,
      (
        SELECT min(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
      ) AS price_from_cents,
      e.currency::text AS currency,
      (
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.deleted_at IS NULL
            AND tt.price_cents > 0
        )
      ) AS is_free,
      e.published_at
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.published_at IS NOT NULL
      AND e.status IN ('scheduled', 'live')
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.ticket_types tt
           WHERE tt.event_id = e.id
             AND tt.available_online = true
             AND tt.deleted_at IS NULL
             AND tt.price_cents > 0
        )
        OR public.pg_brand_can_collect(e.brand_id)
      )
  )
  SELECT
    o.offering_id,
    o.brand_id,
    o.brand_slug,
    o.brand_name,
    o.offering_type,
    o.offering_slug,
    o.title,
    o.description,
    o.cover_media_url,
    o.cover_media_type,
    -- #2489 — the only vector this signature exposes. business_draft is stripped on
    -- BOTH branches; the street address additionally on the withheld branch.
    public.issue_2489_public_theme(o.theme) AS theme,
    o.starts_at,
    o.price_from_cents,
    o.currency,
    o.is_free,
    o.published_at
  FROM offerings o
  WHERE o.starts_at IS NOT NULL
    AND o.starts_at > COALESCE(p_cursor_at, now())
  ORDER BY o.starts_at ASC, o.published_at DESC
  LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1);
$function$;


-- =====================================================================================
-- 6 — THE FOUR SIBLING READERS THAT ALREADY GATED THE ADDRESS, AND STILL LEAKED IT.
--
-- These four were held up as the correct implementations. Three of them are, for the
-- address field and the pin. All four were wrong in two other ways.
--
-- (a) THE VENUE-NAME FALLBACK. The venue-NAME field fell back to the stored combined
--     location string whenever the theme carried no venue name of its own. That
--     combined string is "venue, then street" — so a withheld offering with no stored
--     venue name shipped its street inside a field the gate never looked at, while the
--     address field beside it was correctly NULL. No production row is in that state
--     today; one ordinary publish puts one there. The fallback now lives INSIDE the
--     gate: when the address is withheld the venue name falls back to nothing, and the
--     venue card correctly does not render, rather than rendering the street.
--
-- (b) THE RAISING CAST. Each re-implemented the rule inline as a bare cast of the JSON
--     value to boolean, which raises on any non-boolean. So the same malformed write
--     that the objects above absorb would have turned these four into errors. They now
--     call the one predicate, which is what "defined once" was supposed to mean.
--
-- The bodies below are the definitions the migration chain currently produces, taken
-- from the catalog rather than retyped, with exactly those two changes plus the total
-- theme projection. Their emitted key sets were compared before and after: unchanged.
-- One of these is being edited concurrently by other work; its recently added purchase
-- quantity caps, transfer flag and in-flight-hold arithmetic are preserved verbatim.
--
-- PRIVILEGES ARE DELIBERATELY NOT RESTATED. Replacing a function preserves its ACL,
-- and these four do not all carry the same one — restating a uniform grant here would
-- silently change who can execute three of them. Nothing about this change needs a
-- privilege to move.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.pg_public_event_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'event'           -- standard ticketed ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json)
    ) END
  FROM ev;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_credit,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      -- RSVP host-control columns (ORCH-1150 mig 20261004000000).
      e.rsvp_capacity,
      e.rsvp_allow_plus_ones,
      e.rsvp_plus_ones_max,
      e.rsvp_waitlist_enabled,
      e.rsvp_approval_mode,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb). Default
      -- TRUE when absent so a legacy row never leaks the street (mirror the event RPC).
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'rsvp'            -- RSVP ONLY (SPEC scope)
      AND e.visibility = 'public'::text
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
    LIMIT 1
  ),
  going AS (
    -- Confirmed-going headcount: SUM(1 + plus_count) over going+approved rows.
    -- Byte-identical to submit_event_rsvp's capacity predicate (maybe excluded =
    -- cap-neutral, ORCH-1150).
    SELECT COALESCE(SUM(1 + r.plus_count), 0) AS going_count
      FROM public.event_rsvps r
      JOIN ev ON ev.id = r.event_id
     WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng}.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.location_geo::geometry),
          'lng', ST_X(ev.location_geo::geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE json_build_object(
          'lat', ST_Y(ev.city_geo),
          'lng', ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      -- RSVP host-control block (REPLACES the event RPC's `tickets` aggregate).
      'rsvpGoingCount', (SELECT going_count FROM going),
      'rsvpCapacity', ev.rsvp_capacity,
      'rsvpAllowPlusOnes', ev.rsvp_allow_plus_ones,
      'rsvpPlusOnesMax', ev.rsvp_plus_ones_max,
      'rsvpWaitlistEnabled', ev.rsvp_waitlist_enabled,
      'rsvpApprovalMode', ev.rsvp_approval_mode
    ) END
  FROM ev;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text, p_experience_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ex AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug                AS event_slug,
      e.status,
      e.visibility,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_gallery,
      e.is_recurring,
      e.is_multi_date,
      e.recurrence_rules,
      e.experience_intents,
      e.pass_mingla_fee,
      e.pass_service_fee,
      e.theme               AS public_theme,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      -- hideAddressUntilTicket lives in theme.business_event (jsonb); default TRUE
      -- for safety (mirror the service + venue mapper fail-closed semantics).
      public.issue_2489_address_withheld(e.theme) AS hide_address,
      b.id                  AS brand_id_b,
      b.slug                AS brand_slug,
      b.name                AS brand_name,
      b.description         AS brand_description,
      b.cover_media_url     AS brand_cover_media_url,
      b.cover_media_type    AS brand_cover_media_type,
      b.cover_hue           AS brand_cover_hue,
      b.theme_color         AS brand_theme_color,
      b.theme_font          AS brand_theme_font,
      b.theme_animation     AS brand_theme_animation,
      (b.claim_status = 'verified') AS brand_is_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE b.slug = p_brand_slug
      AND e.slug = p_experience_slug
      AND e.event_type = 'experience'           -- experience ONLY
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      -- issue #2117 -- the offering visibility rule is expressed ONLY through
      -- the Offering Visibility Gate. Do NOT write it locally here or anywhere
      -- else. The e.status predicate ABOVE deliberately stays local and
      -- verbatim (A-4.2): this reader admits four statuses where its family
      -- sibling admits two.
      -- NOTE: this reader EMITS the offering's own visibility value into its
      -- response. Before #2117 it did so while filtering on nothing. The gate
      -- below is what makes that emission safe.
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    LIMIT 1
  ),
  -- the ONE sellable ticket (lowest display_order, non-hidden, not deleted).
  tk AS (
    SELECT
      tt.id,
      tt.name,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.available_online,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ex.pass_mingla_fee,
               ex.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining (GREATEST(total - sold, 0)); NULL for unlimited. Sold formula
      -- IDENTICAL to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ex ON ex.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
    ORDER BY tt.display_order ASC NULLS LAST, tt.created_at ASC
    LIMIT 1
  )
  SELECT
    CASE WHEN ex.id IS NULL THEN NULL ELSE json_build_object(
      'id', ex.id,
      'brandId', ex.brand_id,
      'brandSlug', ex.brand_slug,
      'experienceSlug', ex.event_slug,
      'title', ex.title,
      'description', ex.description,
      'status', ex.status,
      'visibility', ex.visibility,
      'timezone', COALESCE(ex.timezone, 'UTC'),
      'currency', COALESCE(ex.currency, 'usd'),
      'coverMediaUrl', ex.cover_media_url,
      'coverMediaType', ex.cover_media_type,
      'coverGallery', COALESCE(ex.cover_media_gallery, '[]'::jsonb),
      'venueText', COALESCE(
        NULLIF((ex.public_theme #>> '{experience_meta,venue_text}'), ''),
        (SELECT s.address FROM public.experience_stops s
          WHERE s.event_id = ex.id ORDER BY s.stop_order ASC LIMIT 1)
      ),
      'isRecurring', COALESCE(ex.is_recurring, false),
      'isMultiDate', COALESCE(ex.is_multi_date, false),
      'recurrenceRules', ex.recurrence_rules,
      'intents', COALESCE(to_json(ex.experience_intents), '[]'::json),
      'hideAddressUntilTicket', ex.hide_address,
      'themeColorOverride', ex.theme_color_override,
      'themeFontOverride', ex.theme_font_override,
      'themeAnimationOverride', ex.theme_animation_override,
      'brand', json_build_object(
        'id', ex.brand_id_b,
        'slug', ex.brand_slug,
        'name', ex.brand_name,
        'bio', ex.brand_description,
        'coverMediaUrl', ex.brand_cover_media_url,
        'coverMediaType', ex.brand_cover_media_type,
        'coverHue', ex.brand_cover_hue,
        'verified', COALESCE(ex.brand_is_verified, false),
        'themeColor', ex.brand_theme_color,
        'themeFont', ex.brand_theme_font,
        'themeAnimation', ex.brand_theme_animation
      ),
      -- itinerary stops — ADDRESS-PRIVACY-AWARE (NULL street/lat/lng when hidden).
      'stops', COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id,
          'stopOrder', s.stop_order,
          'placeName', s.place_name,
          'address', CASE WHEN ex.hide_address THEN NULL ELSE NULLIF(s.address, '') END,
          'description', NULLIF(s.ai_description, ''),
          'startTime', s.start_time,
          'lat', CASE WHEN ex.hide_address THEN NULL ELSE s.lat END,
          'lng', CASE WHEN ex.hide_address THEN NULL ELSE s.lng END,
          'imageUrls', COALESCE(to_json(s.image_urls), '[]'::json)
        ) ORDER BY s.stop_order ASC)
        FROM public.experience_stops s
        WHERE s.event_id = ex.id
      ), '[]'::json),
      -- the ONE sellable ticket (per-stop summed all-in, ORCH-1151).
      'ticket', (
        SELECT CASE WHEN tk.id IS NULL THEN NULL ELSE json_build_object(
          'ticketTypeId', tk.id,
          'name', tk.name,
          'priceCents', COALESCE(tk.price_cents, 0),
          'allInCents', tk.all_in_cents,
          'currency', COALESCE(tk.currency, ex.currency, 'usd'),
          'quantityTotal', tk.quantity_total,
          'isUnlimited', COALESCE(tk.is_unlimited, false),
          'isFree', COALESCE(tk.is_free, false) OR COALESCE(tk.price_cents, 0) = 0,
          'ticketsRemaining', tk.remaining,
          'availableOnline', COALESCE(tk.available_online, false)
        ) END
        FROM tk
      ),
      -- bookable occurrences (event_dates) with per-occurrence remaining stamped
      -- from the ONE ticket's event-level remaining (Q2: no per-occurrence cap).
      'dates', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'startAt', d.start_at,
          'endAt', d.end_at,
          'timezone', d.timezone,
          'isMaster', COALESCE(d.is_master, false),
          'ticketsRemaining', (SELECT tk.remaining FROM tk)
        ) ORDER BY d.start_at ASC)
        FROM public.event_dates d
        WHERE d.event_id = ex.id
      ), '[]'::json),
      -- bookable: free → always true; paid → pg_brand_can_collect.
      'bookable', CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM tk
          WHERE tk.available_online = true
            AND COALESCE(tk.price_cents, 0) > 0
        ) THEN true
        ELSE public.pg_brand_can_collect(ex.brand_id)
      END
    ) END
  FROM ex;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(p_event_id uuid DEFAULT NULL::uuid, p_brand_slug text DEFAULT NULL::text, p_event_slug text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      -- issue #2160 DELTA 1 of 3. See the note above the appended keys.
      e.is_multi_date,
      e.is_recurring,
      e.multi_date_pricing_mode,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      -- issue #2160 DELTA 2 of 3 — WITHDRAWN. The literal predicate STAYS.
      --
      -- This clause was briefly `pg_offering_visibility_gate(e.visibility,
      -- e.deleted_at, 'direct')`, to make the SPEC's demanded end state
      -- (T-14 / I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE) true — the SPEC
      -- asserted the gate was ALREADY here and it was not. The substitution was
      -- behaviour-identical and proved so. It is withdrawn anyway, because it
      -- is STRUCTURALLY UNAVAILABLE to any migration that lands after #2117:
      --
      --   The #2117 offering-visibility-gate workflow under `.github/workflows/`
      --   (filename ends `issue-2117-offering-visibility-gate-tests`; the
      --   extension is omitted ON PURPOSE — `validate-manifest-v2.mjs:796`
      --   discovers CI dependencies by scanning EVERY non-workflow file for
      --   `/[A-Za-z0-9_.-]+\.ya?ml/`, comments included, so spelling it in full
      --   here registers this migration as a consumer of that workflow and
      --   drifts the reference inventory. It failed exactly that way in CI.
      --   This file is not a consumer of it; it only explains a decision.)
      --   applies THE WHOLE CHAIN EXCEPT #2117, captures the A-SC-9 baseline,
      --   then applies #2117. Calling the gate makes this file fail phase 1
      --   with "function public.pg_offering_visibility_gate(...) does not
      --   exist" — a `LANGUAGE sql` body is validated at CREATE time. Moving
      --   this file to phase 2 fixes that and then fails A-SC-9(a), because
      --   §H's `authenticated` grant is no longer in the BEFORE snapshot and
      --   is reported as having "arrived" with #2117.
      --
      -- Both constraints cannot hold at once, so the gate is not reusable by
      -- anything downstream of it until that lane's baseline capture is
      -- restructured. That is #2117's own decision to make, not this issue's,
      -- and it is recorded in the implementation report rather than worked
      -- around here: a payment-adjacent public reader is the wrong place to
      -- carry a CI-shaped compromise.
      --
      -- The literal below is what #1929/#1931 shipped and is byte-identical to
      -- what the gate would have returned for audience 'direct'.
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- issue #2462 — THE ORGANISER'S PURCHASE RULES. Absent from this reader
      -- since #1929, which is why `directBundleTicketToStub` fabricated
      -- `minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true`: it had
      -- nothing to map. The server has always enforced them, so the cart let a
      -- guest pick a quantity the RPC then refused with
      -- `ticket_quantity_above_max` -> "Nothing was reserved - please try again",
      -- a permanent dead end. DELETE THESE THREE LINES and that returns.
      tt.min_purchase_qty,
      tt.max_purchase_qty,
      tt.allow_transfers,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total
            - COALESCE((
                SELECT COUNT(*)::integer
                FROM public.tickets t
                WHERE t.ticket_type_id = tt.id
                  AND t.status IN ('valid', 'used', 'transferred')
              ), 0)
            -- issue #2462 — IN-FLIGHT HOLDS COUNT. This subtrahend is byte-for-byte
            -- the `v_reserved` the capacity guard in
            -- issue_1930_ticket_checkout_create_session_base already applies. Without
            -- it the page advertises stock the server has committed: measured on
            -- production, 5 concurrent holds moved the guard by 5 and moved this
            -- number by 0 (229 -> 229). At low traffic v_reserved is ~0 so the two
            -- agree and the divergence is invisible; under load the guest reads
            -- "N available" and is refused as sold out. ONE OWNER FOR CAPACITY.
            - COALESCE((
                SELECT SUM(i.quantity)::integer
                FROM public.ticket_checkout_session_items i
                JOIN public.ticket_checkout_sessions s
                  ON s.id = i.checkout_session_id
                WHERE i.ticket_type_id = tt.id
                  AND s.expires_at > now()
                  AND s.status IN ('pending_free', 'requires_payment', 'processing_payment')
              ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order,
          -- issue #2462 — APPENDED LAST so CREATE OR REPLACE preserves every
          -- pre-existing key name and order (house rule, …1931…:735-740).
          'minPurchaseQty', tix.min_purchase_qty,
          'maxPurchaseQty', tix.max_purchase_qty,
          'allowTransfers', tix.allow_transfers
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json),
      -- ══ issue #2160 DELTA 3 of 3 — APPENDED LAST ═══════════════════════
      -- Appended after every pre-existing key so CREATE OR REPLACE preserves
      -- each existing key's name AND order (the house rule at …1931…:735-740).
      --
      -- `occurrences` (SPEC §F / D-4, closes #2161). The occurrence list now
      -- travels on the SAME SECURITY DEFINER reader that served the event, so
      -- ONE authority decides who may see this event and its schedule. The
      -- direct `.from("event_dates")` read in publicEventOccurrencesService is
      -- deleted in the same change: a guest surface must never read that table
      -- again (I-PROPOSED-2160-D). Costs zero extra round trips.
      --
      -- NO `ticketsRemaining` KEY, DELIBERATELY. `event_dates` has no capacity
      -- column and capacity is authored event-level on ticket_types.quantity_
      -- total, so there is no honest per-day remaining. Stamping the
      -- event-level number onto each day would claim per-day availability that
      -- does not exist (Constitution #9).
      'occurrences', (
        SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                 'id',        d.id,
                 'startAt',   d.start_at,
                 'endAt',     d.end_at,
                 'timezone',  d.timezone,
                 'isMaster',  d.is_master
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
      ),
      -- THE MULTI-DATE SIGNAL. Without these two keys the day chooser is
      -- UNREACHABLE, and it was: `detailFromDirectBundle` hard-codes
      -- `is_multi_date: false`, this bundle is the FIRST reader consulted by
      -- both getPublicEventBySlug and getPublicEventById, and the bundle
      -- carried no multi-date key — so `asWhenMode` resolved every
      -- bundle-served ticketed event to 'single' and #2135's chooser never
      -- mounted, on PUBLIC events as well as unlisted ones. #2161 diagnosed
      -- this as "works for public, silently empty for unlisted"; measured on
      -- the full migration chain, it worked for neither. See the
      -- implementation report.
      --
      -- `isRecurring` rides along because the gate is `multi_date` ONLY —
      -- deriving multi-date from `occurrences.length > 1` would sweep in
      -- recurring events, which #2145 keeps out of scope.
      'isMultiDate', COALESCE(ev.is_multi_date, false),
      'isRecurring', COALESCE(ev.is_recurring, false),
      -- The organiser's pricing choice, so the page can say "per day" or
      -- "for all days" BEFORE the guest sees a total (amendment §7).
      'multiDatePricingMode', COALESCE(ev.multi_date_pricing_mode, 'per_day')
    ) END
  FROM ev;
$function$
;

-- =====================================================================================
-- 7 — APPLY-TIME SET CHECK.
--
-- The same equality the fixture asserts after a full-chain replay, asserted here so a
-- botched apply cannot leave the schema half-gated. It is deliberately NOT a count: a
-- count cannot see one object losing the gate while an unrelated one gains it.
-- =====================================================================================
DO $gate_check$
DECLARE
  v_declared   text[];
  v_found      text[];
  v_missing    text[];
  v_undeclared text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared
  FROM public.issue_2489_gate_registry();

  IF v_declared IS NULL OR cardinality(v_declared) = 0 THEN
    RAISE EXCEPTION '#2489 gate check is vacuous: the registry declared nothing.';
  END IF;

  SELECT array_agg(name ORDER BY name) INTO v_found FROM (
    SELECT p.proname::text AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'issue_2489_address_withheld'
      AND p.proname <> 'issue_2489_gate_registry'
      AND (p.prosrc LIKE '%issue_2489_address_withheld%' OR p.prosrc LIKE '%issue_2489_public_theme%')
    UNION
    SELECT c.relname::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND (pg_get_viewdef(c.oid) LIKE '%issue_2489_address_withheld%'
        OR pg_get_viewdef(c.oid) LIKE '%issue_2489_public_theme%')
  ) q;

  SELECT array_agg(x ORDER BY x) INTO v_missing
  FROM unnest(v_declared) x WHERE x <> ALL (COALESCE(v_found, ARRAY[]::text[]));
  SELECT array_agg(x ORDER BY x) INTO v_undeclared
  FROM unnest(COALESCE(v_found, ARRAY[]::text[])) x WHERE x <> ALL (v_declared);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '#2489: declared objects are not carrying the shared gate: %',
      array_to_string(v_missing, ', ');
  END IF;
  IF v_undeclared IS NOT NULL THEN
    RAISE EXCEPTION '#2489: undeclared objects are carrying the shared gate: %',
      array_to_string(v_undeclared, ', ');
  END IF;
END
$gate_check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
