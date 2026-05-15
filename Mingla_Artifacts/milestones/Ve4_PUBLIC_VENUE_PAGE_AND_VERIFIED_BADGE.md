# Ve4 — Public Venue Page + Verified Badge

> **Track:** Track 2 — Physical venues
> **Duration:** 1 week
> **Depends on:** Ve3 (in TestFlight; verified venues exist)
> **Status:** locked, not started

---

## 1. User Outcome

After admin approval, the venue's public Mingla page at `/b/joes-pizza` goes live with full structured data: hero photos, structured address, weekly hours, category, vibe, plus a subtle "Verified" badge ("Claimed by venue" line or blue tick). Anyone visiting the URL without signing in can see the listing. Operator's email contains the live URL for them to share.

This milestone introduces a new public view (`claimed_venues_public_view`) that surfaces verified physical venues regardless of whether they have any events — fixing the audit-flagged limitation that the existing `brands_public_view` requires at least one public live event.

---

## 2. Smoke Test

1. Take a verified venue (from Ve3 smoke test approval)
2. **Open `/b/{slug}` on a second device signed out of any Mingla account**
3. Page renders with:
   - Hero with cover image
   - Brand name + verified badge + "Claimed by venue"
   - Structured address with map preview
   - Weekly hours table
   - Category chips
   - Description / about
   - Photo gallery (operator-uploaded + Google-seeded as fallback)
   - "Upcoming events" section (empty if no events yet, OK)
4. **Test unverified venue:** open `/b/{pending-slug}` — see "not found" or unverified-state placeholder (not the verified page)
5. **Test off-pool verified venue:** all structured data present except possibly google_place_id null
6. **DB probe:** confirm `claimed_venues_public_view` returns the correct row:
   ```sql
   SELECT id, slug, kind, claim_status, address, city
   FROM public.claimed_venues_public_view WHERE slug = '<slug>';
   ```
7. **Regression:** today's brand profile (`brands_public_view`) for popup brands still works — popup brand with public events still renders correctly at `/b/{popup-slug}`
8. Operator email contains the live URL

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | New `claimed_venues_public_view` view filters to `kind='physical'` AND `claim_status='verified'` AND `deleted_at IS NULL` |
| 2 | View projects: id, name, slug, description, structured address, lat/lng, city, country, hours (joined from `brand_hours`), photos (cover + gallery), category, contact info subset |
| 3 | Public route `/b/{brandSlug}` checks both `brands_public_view` AND `claimed_venues_public_view` — verified physical takes precedence |
| 4 | "Verified" badge UI: subtle visual treatment (blue tick or "Claimed by venue" label) |
| 5 | Photo gallery: operator-uploaded photos take precedence; fall back to Google `place_pool` photos if operator hid all |
| 6 | Hours rendered in user's timezone (or venue's timezone — TBD in SPEC) |
| 7 | Map preview using existing map component if available, or OpenStreetMap link |
| 8 | "Upcoming events" section empty-state copy is friendly ("No upcoming events from this venue") |
| 9 | Page is fully anon-tolerant (no `useAuth` calls per `feedback_anon_buyer_routes.md`) |
| 10 | SEO-friendly: title tag includes venue name + city; meta description includes intro |

---

## 4. Files Touched

**Modified:**
- `mingla-business/app/b/[brandSlug]/index.tsx` — extends to render venue data
- `mingla-business/src/services/publicBrandService.ts` — adds verified-venue fetch
- `mingla-business/src/components/brand/PublicBrandPage.tsx` — adds venue-shaped variant

**New:**
- `mingla-business/src/components/brand/VerifiedBadge.tsx`
- `mingla-business/src/components/brand/VenueHoursTable.tsx`
- `mingla-business/src/components/brand/VenueLocationPreview.tsx`
- `mingla-business/src/components/brand/VenuePhotoGallery.tsx`
- `supabase/migrations/<timestamp>_ve4_claimed_venues_public_view.sql`

---

## 5. Data Model Changes

Per project spec §3.9:

```sql
CREATE OR REPLACE VIEW public.claimed_venues_public_view WITH (security_invoker=true) AS
SELECT b.id, b.account_id, b.name, b.slug, b.description, b.profile_photo_url,
       b.contact_email, b.contact_phone, b.social_links, b.custom_links,
       b.default_currency, b.address, b.city, b.country_code, b.lat, b.lng,
       b.cover_hue, b.cover_media_url, b.cover_media_type,
       b.kind, b.place_pool_id, b.google_place_id,
       b.created_at, b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL
  AND b.kind = 'physical'
  AND b.claim_status = 'verified';

COMMENT ON VIEW public.claimed_venues_public_view IS
  'Mingla Business 1.2 — public view for verified physical venues. Surfaces venues regardless of whether they have any associated events (the existing brands_public_view requires at least one public live event, which excludes claimed-but-eventless venues).';

-- Public anonymous SELECT permitted via RLS (security_invoker=true means caller's RLS applies; need explicit policy if base table denies)
GRANT SELECT ON public.claimed_venues_public_view TO anon, authenticated;
```

---

## 6. Dependencies

- Upstream: Ve3 (verified venues exist)
- Downstream: Ve5/Ve6/Ve7 (AI experiences attach to verified venues), C2 (consumer multi-stop composer pulls verified-venue data)

---

## 7. Regression Tests

1. Existing `brands_public_view` flow for popup brands with public events — unchanged
2. Hidden / deleted brand → 404 (both views exclude correctly)
3. Pending claim → unverified-state placeholder (neither view returns the row)
4. Rejected claim → unverified-state placeholder
5. Verified venue with NO photos → falls back to `place_pool` photos correctly; if no pool match either, uses cover_hue gradient
6. Hours rendering across timezones

---

## 8. Hard Guards

- Don't expose internal fields in `claimed_venues_public_view` (no claim_status, no verified_by, no audit fields)
- Don't allow the public page to call `useAuth` — anon-tolerant strict
- Don't redirect verified venues to a different URL — `/b/{slug}` is the canonical home for both popup and venue brands
- Don't render the verified badge for popup or trip-planner brands — only `kind='physical'` AND `claim_status='verified'`
- Don't allow operators to fake the verified badge via custom_links or description text

---

## 9. Open Polish

- Visual treatment of verified badge (multiple design candidates to test)
- Photo gallery layout (grid vs carousel)
- Map provider (existing Leaflet vs simpler static map)
- Whether to show "Verified by Mingla — calling-verified [date]" in tooltip on badge
- "Report this listing" affordance (defer to C2 if we add reporting to consumer side)

---

## 10. Pipeline Notes

**Seth-owned:** SPEC the view's projected columns precisely. Photo-fallback logic from `place_pool` is the trickiest piece — define the cascade explicitly.

**Taofeek-owned:** start with the view migration. Then extend the public brand page to handle both views. Photo fallback is conditional render logic — verify each fallback step works in isolation.
