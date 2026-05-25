# INVESTIGATION — ORCH-0962 [Brand-edit → public-brand field rendering audit]

**Status:** Phase 0 complete (source + schema + view + mapper + render-component audit). Phase 1 (live test-brand walkthrough) PENDING credentials + sim setup — see "Open work" at end.

**Skill:** Claude `mingla-forensics` (INVESTIGATE).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/` on branch `ORCH-0962-brand-edit-public-render-audit`.
**Commit investigated:** `15ca67e85` (worktree HEAD at spawn).
**Confidence:** `proven` for source/schema findings (all six fields satisfied per finding). `suspected` for visual rendering nuances pending live-fire screenshots.

---

## Executive summary

The Edit Brand page exposes **~18 editable fields** across 6 sections (Photo, About, Brand kind, Contact, Social links, Display). The public brand page (`/b/{brandSlug}`) renders a subset with several systemic gaps. **Three gap classes dominate**:

1. **Contact info is invisible on the public page across all surfaces.** Operator types `contact_email` + `contact_phone` on Edit Brand. Both persist to `brands.contact_email` + `brands.contact_phone`. **`business_public_brands_view` does NOT select either column** → mapper produces `contact: undefined` → AboutTab's contact block + email/phone CTAs never render. This is the most user-visible gap: every brand operator who filled contact info on Edit Brand thinks their email/phone shows publicly. It doesn't.

2. **Tagline and bio visually merge into one paragraph on the public page.** Tagline is stored (joined with bio into `brands.description` via `\n\n`) but the public-view mapper (`publicEventsService.ts:337`) reads the whole joined string into `bio` without ever calling `splitBrandDescription`. The tagline-as-first-paragraph visual hierarchy is erased — public viewers see one block of body text with no distinct tagline.

3. **Facebook + LinkedIn social icons are missing from public UI.** Operator can type Facebook/LinkedIn URLs into Edit Brand. They persist to `social_links` jsonb and the mapper extracts them into `links.facebook` / `links.linkedin`. But `PublicBrandPage.tsx:644-686` `SocialLinksRow` only iterates 6 of the 8 social keys — facebook + linkedin are not in the icon list. Two of the 8 social inputs are dead-letter.

**Plus 5 smaller gaps**: `displayAttendeeCount` toggle has zero render consumers anywhere on the public page (purely dead UI), `contact.phoneCountryIso` is write-dropped (no DB column exists), `links.custom` is extractable by the mapper but has no editor UI and no render UI, brand `kind`/`address`/`coverMediaUrl` are hardcoded wrong values when a brand appears in event-detail context, and brand `display_attendee_count` is hardcoded `false` for verified-venue brands at the mapper line `publicEventsService.ts:398`.

**Consumer-app public brand surface confirmed absent.** No `/b/` route, no `BrandProfile` / `BrandDetail` / `PublicBrandPage` component in `app-mobile/src/`. The only consumer-app brand surface is inside `ExpandedBusinessEventSheet.tsx` which renders the buyer-web `PublicEventPage` component (event-card overlay) — brand data appears there as a contextual element of an event, not as a standalone profile. This is the **headline finding** for any redesign: there is no consumer-app surface to redesign yet.

**Brand-kind walkthrough not yet performed.** Source confirms BrandEditView correctly gates BRAND KIND + address sub-form behind `kind !== "trip_planner"` (preserves ORCH-0855 invariant). Physical-only address visibility (`kind === "physical"`) is correctly gated. Live sim walkthrough across all three kinds + buyer-web pending Phase 1.

---

## Investigation manifest

Files read end-to-end:

1. `mingla-business/app/b/[brandSlug]/index.tsx` (83 lines) — public-brand route wrapper.
2. `mingla-business/src/components/brand/BrandEditView.tsx` (1098 lines) — write surface.
3. `mingla-business/src/components/brand/PublicBrandPage.tsx` (1117 lines) — render surface.
4. `mingla-business/src/hooks/usePublicEvents.ts` (78 lines) — data hook (`usePublicBrandBySlug`).
5. `mingla-business/src/services/publicEventsService.ts` (965 lines) — service layer including `getPublicBrandBySlug`, `publicBrandViewRowToBrand`, `claimedVenueRowToBrand`, `viewRowToBrand`.
6. `mingla-business/src/services/brandMapping.ts` (425 lines) — UI ↔ column mapper including `joinBrandDescription`, `splitBrandDescription`, `mapUiToBrandUpdatePatch`.
7. `mingla-business/src/hooks/useBrands.ts` (lines 260-360) — `useUpdateBrand` mutation flow.
8. `mingla-business/src/utils/brandPatch.ts` (full file) — `computeDirtyFieldsPatch` diff helper.
9. `mingla-business/src/store/currentBrandStore.ts` (203 lines) — re-export shim; type history.
10. `mingla-business/src/types/brand.ts` (342 lines) — canonical Brand type with field-by-field comments.

Schema reads via Supabase MCP:

11. `information_schema.columns` for `public.brands` (40 columns enumerated).
12. `pg_get_viewdef('public.business_public_brands_view')` (16 columns SELECTed).
13. `pg_get_viewdef('public.claimed_venues_public_view')` (24 columns SELECTed including `brand_hours` join).

Consumer-app absence proof (negative search):

14. `app-mobile/src/` grep for `PublicBrand|public_brand|/b/\[brandSlug\]|getPublicBrand|usePublicBrand` → 1 hit (`ExpandedBusinessEventSheet.tsx`, renders buyer-web `PublicEventPage` in a bottom sheet — not a standalone brand page).
15. `app-mobile/` find for any file with "brand" in name → 1 hit (`BrandIcons.tsx` — icon library only).

---

## Write-side enumeration (Edit Brand page)

| # | UI section | Field label | State key | Persists to | Notes |
|---|---|---|---|---|---|
| A1 | Photo | Brand photo (avatar) | `draft.photo` + `draft.profilePhotoType` | `brands.profile_photo_url` + `brands.profile_photo_type` | Uploaded via `BrandAvatarPickerSheet`. |
| A2 | Photo | Slug (read-only display) | `brand.slug` | n/a — locked at create per I-17 | Display-only; `trg_brands_immutable_slug` enforces. |
| B1 | About | Display name | `draft.displayName` | `brands.name` | Required. |
| B2 | About | Tagline | `draft.tagline` | `brands.description` (first paragraph, joined with bio via `\n\n`) | Joined via `joinBrandDescription`. |
| B3 | About | Bio / description | `draft.bio` | `brands.description` (remaining paragraphs) | Joined via `joinBrandDescription`. |
| B4 | Brand cover | Cover media (Upload / Pexels / GIPHY) | `draft.coverMediaUrl` + `draft.coverMediaType` | `brands.cover_media_url` + `brands.cover_media_type` | Picker = `BrandCoverPickerSheet`. |
| B5 | (DB only, no UI) | Cover hue fallback | `brand.coverHue` | `brands.cover_hue` (default 25) | Used as fallback render when no cover media. Editable UI removed per ORCH-0805. |
| B6 | Brand kind | Kind toggle (physical \| popup) | `draft.kind` | `brands.kind` | Section gated behind `kind !== "trip_planner"`. trip_planner brands never see this. |
| B7 | Brand kind | Address (physical only) | `draft.address` | `brands.address` | Only rendered when `kind === "physical"`. |
| C1 | Contact | Contact email | `draft.contact.email` | `brands.contact_email` | Persisted but invisible on public page (see G-01). |
| C2a | Contact | Contact phone | `draft.contact.phone` | `brands.contact_phone` | Same as C1. |
| C2b | Contact | Phone country ISO | `draft.contact.phoneCountryIso` | **NOTHING — no column exists** | Write-dropped at mapper (no `out.phone_country_iso` line). Client-side only. |
| D1 | Social | Website | `draft.links.website` | `brands.social_links.website` | Rendered. |
| D2 | Social | Instagram | `draft.links.instagram` | `brands.social_links.instagram` | Rendered. |
| D3 | Social | TikTok | `draft.links.tiktok` | `brands.social_links.tiktok` | Rendered. |
| D4 | Social | X (Twitter) | `draft.links.x` | `brands.social_links.x` | Rendered. |
| D5 | Social | Facebook | `draft.links.facebook` | `brands.social_links.facebook` | **NOT rendered (see G-03).** |
| D6 | Social | YouTube | `draft.links.youtube` | `brands.social_links.youtube` | Rendered. |
| D7 | Social | LinkedIn | `draft.links.linkedin` | `brands.social_links.linkedin` | **NOT rendered (see G-03).** |
| D8 | Social | Threads | `draft.links.threads` | `brands.social_links.threads` | Rendered. |
| E1 | Display | Show attendee count toggle | `draft.displayAttendeeCount` | `brands.display_attendee_count` | **DEAD — no consumer on public page renders attendee count anywhere (see G-05).** |
| F1 | Danger zone | Delete brand button | n/a | calls `onRequestDelete` → soft delete | Action, not a field. |

**Total editable user-facing fields: 19** (A1, B1-B4, B6, B7, C1, C2a, C2b, D1-D8, E1). Plus 1 read-only display (A2 slug) and 1 destructive action (F1 delete).

---

## Schema reconciliation — `brands` table

| Column | Type | Default | Editable from BrandEditView? | Read on public page? |
|---|---|---|---|---|
| id | uuid | gen_random_uuid() | No (system) | Yes (via slug lookup) |
| account_id | uuid | — | No (system) | No |
| name | text | NOT NULL | Yes (B1) | Yes |
| slug | text | NOT NULL | No (locked at create, I-17) | Yes (route key) |
| description | text | NULL | Yes (B2 + B3 joined) | Yes — **but never split, see G-02** |
| profile_photo_url | text | NULL | Yes (A1) | Yes |
| contact_email | text | NULL | Yes (C1) | **No — view drops it, see G-01** |
| contact_phone | text | NULL | Yes (C2a) | **No — view drops it, see G-01** |
| social_links | jsonb | `{}` | Yes (D1-D8) | Yes — but mapper output for facebook/linkedin is unused by UI, see G-03 |
| custom_links | jsonb | `[]` | **No editor UI exists for custom links** | Mapper extracts but no render UI either |
| display_attendee_count | bool | true | Yes (E1) | **DEAD — no render consumer, see G-05** |
| tax_settings | jsonb | `{}` | No (Stripe Tax surface owns) | No |
| default_currency | char | NULL | No (Stripe Connect surface owns) | Exposed in venue view, no brand-page render consumer |
| stripe_connect_id | text | NULL | No | No |
| stripe_payouts_enabled | bool | false | No | No |
| stripe_charges_enabled | bool | false | No | No |
| created_at | timestamptz | now() | No (system) | Yes (in view, not rendered) |
| updated_at | timestamptz | now() | No (system) | Yes (in view, not rendered) |
| deleted_at | timestamptz | NULL | No (system; soft delete) | No (view filters out) |
| kind | text | `'popup'` | Yes (B6) | Yes (drives address visibility) |
| address | text | NULL | Yes (B7) | Yes (physical-only render) |
| cover_hue | int | 25 | No (UI removed ORCH-0805) | Yes (fallback gradient) |
| cover_media_url | text | NULL | Yes (B4) | Yes |
| cover_media_type | text | NULL | Yes (B4) | Implicit |
| profile_photo_type | text | NULL | Yes (A1) | Implicit |
| place_pool_id | uuid | NULL | No (venue claim) | Joined in venue view |
| google_place_id | text | NULL | No (venue claim) | Exposed in venue view, no render consumer on `/b/` |
| lat | double | NULL | No (venue claim) | Yes (VenueLocationPreview, venue-only) |
| lng | double | NULL | No (venue claim) | Yes (VenueLocationPreview, venue-only) |
| city | text | NULL | No (venue claim) | Yes (page title + VenueLocationPreview) |
| country_code | text | NULL | No (venue claim) | Yes (claimedVenueRowToBrand) |
| claim_status | text | `'none'` | No (admin-controlled) | Drives venue-card render (verified=true) |
| verified_at | timestamptz | NULL | No (admin) | No |
| verified_by | uuid | NULL | No (admin) | No |
| venue_category | text | NULL | No (venue onboarding) | Yes (categoryChip) |
| rejection_reason | text | NULL | No (admin) | No |
| claim_follow_up_at | timestamptz | NULL | No (admin) | No |
| duplicate_of_brand_id | uuid | NULL | No (admin) | No |
| marked_called_at | timestamptz | NULL | No (admin) | No |
| marked_called_by | uuid | NULL | No (admin) | No |
| claim_decision_emailed_at | timestamptz | NULL | No (admin) | No |

**Side table:** `brand_hours` — joined into `claimed_venues_public_view.hours` and rendered via `VenueHoursTable` on the public page **only for verified physical venues**. **No editor UI exists in BrandEditView for hours.** This is a gap — see G-06.

---

## View reconciliation — `business_public_brands_view`

```
SELECT id, slug, name, description, profile_photo_url, social_links, custom_links,
       display_attendee_count, kind, address, cover_hue, cover_media_url,
       cover_media_type, profile_photo_type, created_at, updated_at
FROM brands b
WHERE deleted_at IS NULL
  AND ((kind = ANY (ARRAY['popup', 'trip_planner'])) OR (kind = 'physical' AND claim_status = 'verified'));
```

**Columns DROPPED by the view (cannot be rendered on the public page even if a mapper wanted to):**
- `contact_email`
- `contact_phone`
- `default_currency`
- `place_pool_id`, `google_place_id`, `lat`, `lng`, `city`, `country_code` (only exposed via `claimed_venues_public_view` for verified venues)
- All Stripe / claim / admin fields (correctly excluded)

**Visibility filter:** popup + trip_planner ALWAYS visible; physical only visible when `claim_status = 'verified'`. **Implication:** a physical brand operator who fills in every Edit Brand field but hasn't completed venue verification has a public brand page that returns 404 from `business_public_brands_view`. (`getPublicBrandBySlug` falls through to `claimed_venues_public_view` first, then this view — both filter out unverified physical brands.)

---

## Render-side enumeration — `PublicBrandPage.tsx`

Rendered visually on `/b/{brandSlug}` in this order:

1. **Hero cover band** (180px tall, `brand.coverMediaUrl` or `hsl(coverHue, 60%, 45%)` fallback). Per-platform branching: `expo-image` on Android, RN `Image` on iOS + web.
2. **Floating chrome row** (top): close button (founder-only — gated by `ownsThisBrand`, currently always-hidden) + share button.
3. **Identity column** (Linktree-style centered): Avatar (size hero, overlaps cover by 42px) + brand name + (if verified venue) `VerifiedBadge` + (if physical with non-empty address) address line.
4. **Bio/tagline block**: if `bio` non-empty → renders bio; else if `tagline` non-empty → renders tagline; else nothing. **Bio always wins when present — tagline is a fallback-only field.**
5. **Compact social row** (icons-only, Linktree-style). Iterates 6 icons: website, instagram, tiktok, x, youtube, threads. **Facebook + linkedin omitted.** Custom links omitted.
6. **Venue card** (verified physical venues only): category chip + `VenueLocationPreview` (address + city + lat/lng) + `VenueHoursTable` + `VenuePhotoGallery`.
7. **Stats card** (if `publicEventCount > 0`): one column showing event count. No attendee count, no follower count, no GMV — and **no consumer of `display_attendee_count` anywhere**.
8. **Tabs row**: Upcoming · Past · About.
9. **Upcoming tab**: `EventMiniCard` per upcoming event, or empty state.
10. **Past tab**: capped at 10 most recent, cancelled events filtered.
11. **About tab**: bio block (duplicated from #4) + contact block (email + phone CTAs — never renders because mapper produces `contact: undefined`) + "Find us" social row (full labels, all 6 icons same set as compact row).
12. **Footer**: "Verified host on Mingla since YYYY" — **currently suppressed (always null, see line 176)** per Cycle 13a DEC-092 deferred restoration.
13. **Share modal** + (if web) SEO Head with og:image / twitter:image generated from `brandOgImageUrl({ brandSlug, profilePhotoUrl })`.

---

## Gap matrix

Verdict legend: ✅ renders correctly · ⚠️ renders partially/wrong-shape · ❌ does not render · 🚫 surface does not exist · DEAD = field has zero render consumer.

| # | Field (Edit Brand) | DB column | View exposes? | Mapper produces? | Buyer-web `/b/` render | iOS-consumer | Android-consumer | Verdict | Root-cause class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Brand photo (A1) | profile_photo_url + profile_photo_type | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK (web); SURFACE-MISSING (consumer) | SURFACE-MISSING |
| 2 | Display name (B1) | name | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 3 | Tagline (B2) | description (joined first paragraph) | ✅ | ⚠️ tagline=undefined; full description → bio | ⚠️ visually merges with bio | 🚫 | 🚫 | **G-02 READ-WRONG-SHAPE** | READ-WRONG-SHAPE |
| 4 | Bio (B3) | description (joined remainder) | ✅ | ✅ (whole description → bio) | ✅ (but bio includes tagline text) | 🚫 | 🚫 | OK on its own; G-02 contamination | READ-WRONG-SHAPE (via G-02) |
| 5 | Cover media (B4) | cover_media_url + cover_media_type | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 6 | Brand kind (B6) | kind | ✅ | ✅ | ✅ (drives address visibility) | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 7 | Address (B7) | address | ✅ | ✅ | ✅ (physical only) | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 8 | Contact email (C1) | contact_email | **❌ VIEW DROPS** | ❌ undefined | ❌ AboutTab contact block never renders | 🚫 | 🚫 | **G-01 SCHEMA-VIEW-DROPS** | READ-MISSING |
| 9 | Contact phone (C2a) | contact_phone | **❌ VIEW DROPS** | ❌ undefined | ❌ same as above | 🚫 | 🚫 | **G-01 SCHEMA-VIEW-DROPS** | READ-MISSING |
| 10 | Phone country ISO (C2b) | **(no column)** | n/a | n/a | ❌ never rendered, never persisted | 🚫 | 🚫 | **G-04 SCHEMA-MISSING** | SCHEMA-MISSING |
| 11 | Website (D1) | social_links.website | ✅ | ✅ | ✅ (globe icon) | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 12 | Instagram (D2) | social_links.instagram | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 13 | TikTok (D3) | social_links.tiktok | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 14 | X (D4) | social_links.x | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 15 | Facebook (D5) | social_links.facebook | ✅ | ✅ | **❌ UI omits this icon** | 🚫 | 🚫 | **G-03 READ-MISSING** | READ-MISSING |
| 16 | YouTube (D6) | social_links.youtube | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 17 | LinkedIn (D7) | social_links.linkedin | ✅ | ✅ | **❌ UI omits this icon** | 🚫 | 🚫 | **G-03 READ-MISSING** | READ-MISSING |
| 18 | Threads (D8) | social_links.threads | ✅ | ✅ | ✅ | 🚫 | 🚫 | OK; SURFACE-MISSING | SURFACE-MISSING |
| 19 | Show attendee count (E1) | display_attendee_count | ✅ | ✅ | **❌ DEAD — no render consumer** | 🚫 | 🚫 | **G-05 DEAD-WRITE** | DEAD-WRITE |
| 20 | (no UI) Cover hue fallback | cover_hue | ✅ | ✅ | ✅ (fallback gradient) | 🚫 | 🚫 | OK; SURFACE-MISSING | OK |
| 21 | (no UI) Venue hours | brand_hours table | ✅ (in venue view) | ✅ (PublicVenueDetail.hours) | ✅ (VenueHoursTable, verified venues only) | 🚫 | 🚫 | **G-06 NO-EDITOR** | SCHEMA-DEAD-AT-EDITOR |
| 22 | (no UI) Custom links | custom_links | ✅ | ✅ (mapper extracts) | **❌ no render UI either** | 🚫 | 🚫 | **G-07 DEAD-COLUMN** | DEAD-COLUMN |

**Additional gap not tied to a single field — event-detail brand context (G-08):**
`viewRowToBrand` at `publicEventsService.ts:288-312` is used when a brand appears inside an event detail. It hardcodes `kind: "popup"` (line 294), `address: null` (line 295), `tagline: undefined` (line 308), and never reads brand `coverMediaUrl`. Physical brands viewed through event-detail render as popup, lose their address, lose tagline, and lose their cover image. Buyer-web event surfaces (`/e/{brandSlug}/{eventSlug}`) and consumer-app event sheets (`ExpandedBusinessEventSheet`) both hit this code path.

**Additional gap (G-09) — verified-venue `displayAttendeeCount`:**
`claimedVenueRowToBrand` at `publicEventsService.ts:398` hardcodes `displayAttendeeCount: false` regardless of the DB value. Verified-venue operators who flip the toggle on E1 get no effect — but since the toggle has no consumer anyway (G-05), the impact is currently theoretical.

---

## Root-cause clusters

### Cluster 1 — `business_public_brands_view` SELECT list is incomplete (G-01)
**File:** view definition in latest brands migration.
**Code:** `SELECT id, slug, name, description, profile_photo_url, social_links, custom_links, display_attendee_count, kind, address, cover_hue, cover_media_url, cover_media_type, profile_photo_type, created_at, updated_at FROM brands ...`
**Missing columns:** `contact_email`, `contact_phone`.
**Causal chain:** Edit Brand writes contact info → row updated correctly → view excludes columns → mapper has no source → `contact: undefined` → AboutTab contact block + email/phone CTAs never render.
**Verification:** `SELECT pg_get_viewdef(...)` output above; AboutTab guard at `PublicBrandPage.tsx:574-577` requires `brand.contact?.email` or `brand.contact?.phone` to be non-empty.

### Cluster 2 — `publicBrandViewRowToBrand` doesn't split joined description (G-02)
**File:** `mingla-business/src/services/publicEventsService.ts`.
**Line:** `337` — `bio: row.description ?? undefined,` and `338` — `tagline: undefined,`.
**What it does:** Assigns the entire joined description string to `bio` and explicitly drops tagline.
**What it should do:** Call `splitBrandDescription(row.description)` and assign the two parts to `tagline` + `bio` separately, matching the symmetric `mapServerBrandRowToBrand` path used by the founder's own brand load.
**Causal chain:** Operator types tagline+bio → joined into `description` → view returns description → mapper assigns whole string to bio → PublicBrandPage line 356-360 renders bio (the whole joined string) as one paragraph → tagline visual hierarchy erased.
**Same issue at `viewRowToBrand:308`** (event-detail brand context) — also hardcodes `tagline: undefined`.

### Cluster 3 — `SocialLinksRow` icon list is incomplete (G-03)
**File:** `mingla-business/src/components/brand/PublicBrandPage.tsx`.
**Lines:** `644-686`.
**What it does:** Iterates `links.website / instagram / tiktok / x / youtube / threads` (6 platforms).
**What it should do:** Iterate all 8 platforms the Edit Brand form accepts and the type defines — add `facebook` (between x and youtube) and `linkedin` (between threads and end).
**Causal chain:** Operator types Facebook + LinkedIn URLs → persist to `social_links` jsonb → mapper extracts both into `links.facebook` and `links.linkedin` → UI iteration skips both keys → no icons render.

### Cluster 4 — phoneCountryIso has no schema (G-04)
**Files:** `mingla-business/src/types/brand.ts:136` (type declares it), `mingla-business/src/services/brandMapping.ts:380` (update mapper ignores it).
**What it does:** UI tracks the country code, but `mapUiToBrandUpdatePatch` never writes a column for it.
**What it should do:** Either add a `brands.contact_phone_country_iso` column + write/read path, OR remove the prop from `Input variant="phone"` `onCountryChange` callback in BrandEditView (visible at lines 674-679 of BrandEditView.tsx) and document phoneCountryIso as ephemeral client-only.
**Severity downgrade reason:** The phone Input visually defaults country to "GB" on next session per the comment at `brand.ts:130-137`, so the operator never sees broken state unless they change country from default and expect persistence.

### Cluster 5 — `displayAttendeeCount` has no public-page consumer (G-05)
**File:** `mingla-business/src/components/brand/PublicBrandPage.tsx`.
**What's there:** Stats card at lines 399-415 renders only `EVENTS` count derived from `publicEventCount`. No `if (brand.displayAttendeeCount)` branch anywhere. Comment at `brand.ts:236-238` says "Consumer (Cycle 3+ public-page rendering) wires up later" — never wired.
**What it should do:** Either render an attendee count when the toggle is on (requires server-derived per-brand attendee sum — currently not in any view), OR remove the toggle from BrandEditView until the feature ships.

### Cluster 6 — venue hours have no editor (G-06)
**Schema:** `brand_hours` table exists, exposed via `claimed_venues_public_view.hours` jsonb, rendered via `VenueHoursTable` on the public page for verified venues.
**Editor:** None. BrandEditView has no hours grid. `BrandEditView.tsx` makes no reference to `brand_hours`.
**Implication:** Hours are populated through the venue claim/onboarding flow (Ve1+ surfaces) but **operators cannot edit hours from Edit Brand**. If hours change (holiday, new schedule), the operator has no path to update.

### Cluster 7 — `custom_links` column has no editor and no renderer (G-07)
**Schema:** `brands.custom_links` jsonb column with default `[]`.
**Editor:** None. BrandEditView header docstring line 21 explicitly notes "Custom links UI deferred (schema field stays in `links.custom`)".
**Renderer:** None. `SocialLinksRow` does not iterate `links.custom`.
**Status:** Dead column. Should be either built (editor + renderer) or removed.

### Cluster 8 — event-detail brand context lies about kind, address, cover (G-08)
**File:** `mingla-business/src/services/publicEventsService.ts:288-312` `viewRowToBrand`.
**What it does:** When a brand appears nested inside an event detail (consumer event sheet, buyer-web event page), hardcodes `kind: "popup"`, `address: null`, `tagline: undefined`, and reads no brand cover media.
**Why it exists:** The `business_public_events_view` row doesn't include brand's `kind`/`address`/`cover_media_url` columns — only event's own fields. The mapper has to fabricate.
**Fix direction:** Either extend the event view to include brand kind/address/cover (one more join), or accept that brand-in-event-context is a stripped-down "card" representation and don't render kind-dependent UI there.

---

## Cross-surface impact

**Buyer-web `/b/{brandSlug}`:** the surface where all 9 gaps surface visibly to a public viewer. This is the primary fix target.

**Buyer-web `/e/{brandSlug}/{eventSlug}`:** affected by G-08 (brand-in-event-context). Lower priority — buyers focus on event details, not brand metadata, in this context.

**Consumer iOS + Consumer Android:** **No `/b/` surface exists in `app-mobile/`.** The only brand surface is brand metadata rendered inside `ExpandedBusinessEventSheet.tsx` via the shared buyer-web `PublicEventPage` (event-detail context), affected by G-08 only. **Standalone consumer-app brand profile = does not exist.** This is the foundational headline finding before any redesign.

**Business iOS + Business Android + Business-web preview:** the write surfaces. No gaps on the write side except G-04 (phoneCountryIso) and G-06/G-07 (missing editors for hours + custom links).

**Admin web:** explicitly out of scope per INTAKE.

---

## Invariant cross-check

- **I-17 brand slug immutability:** preserved. BrandEditView correctly renders slug as read-only (line 461-471), `mapUiToBrandUpdatePatch` defensively drops `patch.slug` (line 369 comment).
- **I-PROPOSED-TR1-KIND-IMMUTABLE (ORCH-0855):** preserved. BrandEditView gates the BRAND KIND section behind `kind !== "trip_planner"` (line 568). Toggle options never include `'trip_planner'`.
- **I-PROPOSED-J Zustand persist holds IDs not records (ORCH-0742):** preserved. `currentBrandStore` v14 only persists `currentBrandId`.
- **Constitution #9 (no fabricated data):** **VIOLATED by G-08.** `viewRowToBrand` hardcodes `kind: "popup"` and `address: null` for any brand viewed in event-detail context — fabricates data when the underlying brand may be physical with a real address. Severity: P1 — physical brands viewed through event surfaces are misrepresented.
- **Constitution #9 (no fabricated data):** **VIOLATED by G-09.** `claimedVenueRowToBrand` hardcodes `displayAttendeeCount: false` for verified venues regardless of DB. Severity: P3 because G-05 makes the field unused anyway, but the hardcode is still a fabrication.
- **Constitution #3 (no silent failures):** **arguably VIOLATED by G-01.** Operator types contact email/phone, hits Save, sees success toast. No surface communicates that the data is not publicly visible. The save IS successful (the column is written) — the silent failure is downstream.

---

## Pre-redesign recommendations (for orchestrator routing)

**In-scope for ORCH-0962 fix bundle (single SPEC):**
- **G-01 (contact info not exposed):** add `contact_email` + `contact_phone` to `business_public_brands_view` SELECT list (migration), add `contact` field population to `publicBrandViewRowToBrand` + `claimedVenueRowToBrand` + `viewRowToBrand`. SPEC must address whether public exposure of email/phone is the right product decision (vs. a "Contact this brand" form that protects PII) — likely a product/design question.
- **G-02 (tagline merges with bio):** add `splitBrandDescription(row.description)` to `publicBrandViewRowToBrand` + `claimedVenueRowToBrand` + `viewRowToBrand`. Update `PublicBrandPage.tsx` `bio/tagline` block to render BOTH when both exist (tagline as eyebrow/lead, bio as body).
- **G-03 (facebook + linkedin icons missing):** add 2 icons to `SocialLinksRow` entries array. Trivial; ~5 lines.
- **G-08 (event-detail brand fabrication):** add brand `kind`, `address`, `cover_media_url` columns to `business_public_events_view`, update `viewRowToBrand` to read them. SPEC must verify no other consumers of the view rely on the missing-columns shape.
- **G-09 (verified-venue displayAttendeeCount hardcoded):** flip `claimedVenueRowToBrand:398` to read `row.display_attendee_count` — trivial.

**Defer to a follow-up ORCH (G-05 displayAttendeeCount feature):**
- Either build a consumer (per-brand attendee count query + stats card render) or remove the toggle from BrandEditView. This is a product decision, not a bug fix — register as a separate ORCH so ORCH-0962 stays bounded.

**Defer to a follow-up ORCH (G-06 hours editor):**
- Build a hours-editor sub-form in BrandEditView for verified physical brands. Bigger UX scope (grid layout, weekday rows, open/close times, closed-day toggle). Register as a separate ORCH (probably alongside venue management work).

**Defer or remove (G-07 custom_links):**
- Either ship editor + renderer or drop the column. Product decision. Register as a separate ORCH if Seth wants to ship it; otherwise schedule a column drop in a future cleanup.

**Defer or remove (G-04 phoneCountryIso):**
- Either add `brands.contact_phone_country_iso` column + write/read path or accept the country picker as ephemeral. Lowest priority; current default-to-GB renders adequately.

**Headline pre-redesign finding (NOT a gap to fix in ORCH-0962):**
- Consumer-app has no standalone public brand surface. Before any redesign of the public brand page, register a separate ORCH to either (a) build a consumer-app brand profile screen if the redesign target needs consumer reach, or (b) confirm the redesign is buyer-web + business-web only and document consumer-app brand-in-event-context as the only consumer surface.

---

## Discoveries for orchestrator

- **D-1: `brandsService.ts` `updateBrand` not yet inspected.** The write path from `mapUiToBrandUpdatePatch` → actual Supabase RPC/call is in `mingla-business/src/services/brandsService.ts:491`. Read confirms patch shape but the final Supabase call (UPDATE vs edge function vs RPC) wasn't traced. Not load-bearing for the gap findings (DB schema confirms what columns exist regardless of update mechanism) but worth completing in Phase 1.
- **D-2: PublicBrandPage `ownsThisBrand` close chrome is always hidden** (current `verifiedHostSinceYear` is permanently `null` per Cycle 13a deferred restoration). Not a gap from this audit but a known deferred re-wiring task per code comment at `PublicBrandPage.tsx:174-176`.
- **D-3: ORCH-0964 [public-page-theme-customization] is spawning in parallel.** The redesign work this audit precedes likely overlaps with ORCH-0964. Operator should sequence them — finish ORCH-0962 fix bundle (truthful field rendering) BEFORE ORCH-0964 redesigns the public page, otherwise the redesign will design around the wrong (current-broken) set of fields.
- **D-4: `BrandEditView.tsx` has `tagline` as the "second" About field, but the DESIGN of "tagline above bio" assumes tagline renders as a short eyebrow line and bio as body** — once G-02 is fixed, the public page render order should also reflect this hierarchy (tagline as styled eyebrow, bio as body text), not just two paragraphs of the same style.
- **D-5: `SocialLinksRow` social entries are out of order between the type definition and the UI iteration.** Type lists: website, instagram, tiktok, x, facebook, youtube, linkedin, threads. UI lists: website, instagram, tiktok, x, youtube, threads (and skips fb+linkedin). Whatever fix lands for G-03 should canonicalize the order across type + render to reduce drift.

---

## Open work — Phase 1 (live simulator walkthrough)

**BLOCKED on:**
1. Sim setup. Operator confirmed "nothing booted; spin up from scratch" — I'll need to boot iPhone 17 Pro (business write), an Android emulator (business + buyer-web Chromium), and use the dev-build rebuild runbook (`Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`).
2. **Test brand operator credentials.** I need a logged-in account on the business app to create the three test brands (physical + popup + trip_planner). Either an existing account email/password or a fresh sign-up walkthrough.
3. **Acknowledgement that creating a `trip_planner` brand requires completing Stripe Connect onboarding per ORCH-0855 DEC-4.** If we want the trip_planner walkthrough, we need test Stripe Connect credentials or an existing trip-planner brand to edit.

**Once unblocked, Phase 1 will:**
- Create 3 test brands (physical-claimed, popup, trip_planner) and walk every Edit Brand field with maximum-content strings + emojis + URLs + uploaded photos + flipped toggles.
- Open `/b/{brandSlug}` for each on buyer-web Chromium, screenshot every section, confirm each gap above visually.
- Open the consumer-app, prove negatively that no `/b/` route exists, screenshot the event-sheet brand-in-event-context render (G-08).
- Capture per-platform parity screenshots (business iOS vs Android Edit Brand layout).
- Append a Phase 1 addendum to this report with screenshot inventory + any visual gaps not visible from source.

The Phase 0 findings above are sufficient to draft the SPEC for the in-scope fix bundle (G-01, G-02, G-03, G-08, G-09) without waiting for Phase 1 — Phase 1 will validate visually and may surface new visual-only gaps but is unlikely to overturn any of the source-confirmed findings.
