-- ===========================================================================
-- issue #1562 [hours-and-price], step 6 of #1550 — expose the venue's OWN
-- timezone on the anon public venue view.
-- ---------------------------------------------------------------------------
-- THE DEFECT. `venue_public_view` publishes `hours` — seven rows of venue-LOCAL
-- wall-clock times — and nothing that says which clock those times belong to.
-- Every consumer of that column therefore had exactly one option, and took it:
-- `new Date()` on the VISITOR's device. `PublicVenueScreen.tsx` called
-- `todayWeekday()` once and fed all three of its hours surfaces from it, so the
-- desktop sticky panel published a literal `Open today · 09:00–17:00` claim
-- derived from a WEEKDAY MATCH — no time-of-day comparison at all — while the
-- week table highlighted whichever row the guest's own device thought it was.
-- #1550 Leg C caught that line asserting a Miami restaurant was open at 03:00.
--
-- NO NEW COLUMN. `venue_availability_config.iana_timezone` has existed since
-- `20261008000000_orch_1148_availability_iana_timezone.sql` (`text NOT NULL
-- DEFAULT 'UTC'`, trigger-validated against `pg_timezone_names`, backfilled
-- from `place_pool.country` + `utc_offset_minutes`). The ORCH-1255 ops re-key
-- (`20261130000002:116-124`) moved it to `UNIQUE (venue_id)` — exactly the key
-- `brand_hours` already uses in this view's own hours subselect. The tz has
-- been the availability engine's DST-correct clock for ten months. It was
-- simply never SELECTED here, so no anonymous surface could see it.
--
-- ---------------------------------------------------------------------------
-- WHY `CREATE OR REPLACE` AND NOT `DROP` + `CREATE`
-- ---------------------------------------------------------------------------
-- `20261221000000_meta_orch_1290_venue_public_view_pitch.sql` used DROP +
-- CREATE and its header states the house rule: a view whose SELECT list is
-- REORDERED must be dropped and recreated. This change only APPENDS, which
-- `CREATE OR REPLACE VIEW` supports directly — and dropping is now actively
-- unsafe here, because `ad_public_stay_destinations_view` (#1431) SELECTs from
-- this view and a bare DROP would fail while a `DROP … CASCADE` would silently
-- delete the ad-attribution view along with it. Appending keeps that dependent
-- intact and untouched; it also keeps every existing column at its existing
-- ordinal, so nothing that reads this view positionally can shift.
--
-- Both clients read `.select("*")` and map BY NAME
-- (`publicEventsService.ts:venuePublicViewRowToPublicVenue`,
-- `app-mobile/src/services/publicVenueService.ts`), so trailing placement is
-- invisible to them.
--
-- ---------------------------------------------------------------------------
-- ANON SAFETY — I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE
-- ---------------------------------------------------------------------------
-- `venue_availability_config` is NOT readable by anon: RLS restricts SELECT to
-- `biz_is_brand_member_for_read_for_caller(brand_id)` and there is no anon
-- GRANT. That is precisely why the join belongs HERE. The view is
-- `security_invoker = false` (the 20260731000000 ruling, re-asserted below), so
-- it reads with the view owner's privileges and publishes exactly one scalar
-- from that table. This is the same shape `place_pool` already has in this view
-- — also not anon-readable, also joined, also narrowed to named columns.
--
-- A timezone is not sensitive: it is derivable from the address the view
-- already publishes. NOTHING else from the availability config crosses — not
-- `service_periods`, not `turn_times`, not `max_reservations_per_slot`, not
-- `buffer_minutes`. Naming one column rather than joining `vac.*` is what makes
-- that checkable by reading the SELECT list.
--
-- LEFT JOIN, deliberately. A config row is created at venue provisioning
-- (`20261130000002:229`) but is not guaranteed — the live pool has a verified
-- venue with no row at all. An INNER JOIN would make that venue VANISH from the
-- public directory, turning a missing clock into a missing page. LEFT JOIN
-- yields NULL, the client resolves `unknown`, and the page states the venue's
-- published hours without claiming to know whether the doors are open.
--
-- Additive-only. No data is written. No column is added to any table. No grant
-- is widened. MONOTONIC VERSION 20270213001562 — strictly above the current max
-- (20270212001538) across this worktree and every sibling under
-- ~/Desktop/mingla-orchs/*/supabase/migrations/.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  b.theme_color, b.theme_font, b.theme_animation, b.cover_hue,
  b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  -- META-ORCH-1290 M1 (D-6): the owner-authored pitch (generative_summary),
  -- anon-safe public-directory text on the already verified-only view.
  pp.generative_summary AS pitch,
  v.created_at, v.updated_at,
  -- issue #1562: the clock the `hours` column above is expressed in. APPENDED
  -- last so CREATE OR REPLACE is legal and every prior ordinal is unchanged.
  vac.iana_timezone AS iana_timezone
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
LEFT JOIN public.venue_availability_config vac ON vac.venue_id = v.id
WHERE v.claim_status = 'verified';

-- security_invoker stays FALSE (definer) per the 20260731000000 ruling —
-- explicit so a future default change cannot flip it, and load-bearing for the
-- availability-config join above.
ALTER VIEW public.venue_public_view SET (security_invoker = false);

GRANT SELECT ON public.venue_public_view TO anon, authenticated;

COMMENT ON VIEW public.venue_public_view IS
  'META-ORCH-1255 M4 (D-2): the ONLY anon read path for venue data '
  '(I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE). SECURITY DEFINER (20260731000000 '
  'ruling); WHERE claim_status=''verified'' + non-deleted brand scope the rows. '
  'pending_review/rejected/suspended/revoked venues are INVISIBLE here; no '
  'Stripe/account columns cross the view. Serves /b/{brandSlug}/v/{venueSlug}. '
  'META-ORCH-1290: + pitch (generative_summary), anon-safe public-directory text. '
  'issue #1562: + iana_timezone (venue_availability_config, LEFT JOIN, NULL-safe) — '
  'the clock the hours column is expressed in, so open-now can be resolved in the '
  'VENUE''s zone instead of the visitor''s device. ONE scalar crosses; no other '
  'availability-config column is exposed and no grant is widened.';

COMMIT;
