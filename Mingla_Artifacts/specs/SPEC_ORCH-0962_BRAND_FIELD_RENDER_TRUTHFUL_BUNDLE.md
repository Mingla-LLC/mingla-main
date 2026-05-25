# SPEC — ORCH-0962 [Brand-edit → public-brand field rendering — truthful bundle]

**Skill:** Claude `mingla-forensics` (SPEC mode).
**Phase:** INVESTIGATE-THEN-SPEC (IA). INVESTIGATE complete at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0962_BRAND_EDIT_PUBLIC_RENDER_AUDIT.md`.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/` on branch `ORCH-0962-brand-edit-public-render-audit`.
**Severity:** S1-high.
**Tags:** `quality-gap` + `bug` + `data-integrity`.

---

## §1 Scope

This SPEC fixes the **five source-confirmed render-truth gaps** between Edit Brand (write) and the public brand page (read) that have a single tractable fix path each. The remaining four gaps are split out per §1.3.

### §1.1 In-scope gaps

- **G-01 — Contact info invisible.** `contact_email` + `contact_phone` flow from Edit Brand → DB but the public view drops both columns and the public mapper produces `contact: undefined`. Public AboutTab contact block never renders.
- **G-02 — Tagline and bio visually merge.** Persisted correctly (joined into `brands.description` via `\n\n`) but never split on read; full joined string renders as one bio paragraph.
- **G-03 — Facebook + LinkedIn icons missing.** Persisted, extracted by mapper, never iterated by the render `SocialLinksRow`.
- **G-08 — Event-detail brand fabrication.** `viewRowToBrand` hardcodes `kind: "popup"`, `address: null`, `tagline: undefined`, drops brand `coverMediaUrl`. Physical brands lose identity when viewed inside event detail.
- **G-09 — Verified-venue `displayAttendeeCount` hardcoded.** `claimedVenueRowToBrand:398` hardcodes `displayAttendeeCount: false` regardless of DB value. (Currently theoretical because G-05 makes the field unused anyway — but fix is one line and removes Constitution #9 violation.)

### §1.2 Non-goals

- **No redesign.** Visual layout, typography, color, animation of the public brand page are NOT in scope. This SPEC restores truthful data flow only.
- **No new editor UI.** No hours editor, no custom_links editor, no phoneCountryIso column — those are split out.
- **No new consumer-app surface.** Building a consumer-app public brand profile screen is folded into ORCH-0964 [public-page-theme-customization] redesign scope per operator directive 2026-05-25.
- **No PII protection layer.** This SPEC restores rendering of contact email/phone exactly as they're already collected. If the product position is that public-bare email exposes brand operators to spam, register a follow-up ORCH for a contact-form replacement; do not block this fix.
- **No mobile-app `/b/` route plumbing.** ORCH-0964 absorbs this.

### §1.3 Split-out as separate ORCHs (register at INTAKE — do not bundle here)

- **G-04 phoneCountryIso has no column.** Product decision: persist or accept ephemeral. → new ORCH if persistence wanted.
- **G-05 displayAttendeeCount has no consumer.** Product decision: build the attendee-count consumer or remove the toggle. → new ORCH.
- **G-06 no hours editor.** Product + design scope. → new ORCH (likely alongside venue management work).
- **G-07 custom_links column unused.** Product decision: ship editor + renderer or drop column. → new ORCH or scheduled column drop.
- **Consumer-app standalone brand profile screen** (route + entry points from event pages, brand-name taps, brand-photo taps anywhere in consumer app). Per operator directive 2026-05-25 → folded into ORCH-0964 redesign scope, NOT a new ORCH.

### §1.4 Assumptions

- The latest `brands` schema migration is authoritative as inspected (40 columns confirmed via `information_schema.columns`).
- `business_public_brands_view`, `claimed_venues_public_view`, `business_public_events_view` are the three views in play. No additional views surface brand data publicly.
- No active brand has filled tagline + bio in a way that depends on the current "merged into one block" rendering as a feature. (If true, G-02 fix is purely a quality win.)
- Operator (Seth) has confirmed that exposing `contact_email` + `contact_phone` to anonymous web viewers is acceptable for this fix. Spam-protection layer can come later via separate ORCH.

---

## §2 Cross-Surface Impact (mandatory per Phase 2.5)

| # | Surface | In scope? | Behaviour the SPEC demands | Parity vs other surfaces |
|---|---|---|---|---|
| 1 | Consumer iOS | **NO — surface does not exist** | n/a (consumer-app standalone brand profile is ORCH-0964 scope) | n/a |
| 2 | Consumer Android | **NO — surface does not exist** | n/a (same) | n/a |
| 3 | Buyer/anonymous Web (`/b/{brandSlug}`) | **YES — primary** | All 5 gaps fixed; tagline+bio render with hierarchy, contact block renders, fb+linkedin icons render, brand-in-event context renders truthful kind/address/cover, verified-venue attendee-count toggle honors DB | n/a (primary) |
| 4 | Buyer/anonymous Web (`/e/{brandSlug}/{eventSlug}`) | **YES — G-08 only** | Brand-in-event context shows truthful kind/address/cover (no hardcoded popup/null) | Mirrors `/b/` brand mapping logic via shared `viewRowToBrand` helper |
| 5 | Business iOS | **NO — write surface, no change** | n/a | n/a |
| 6 | Business Android | **NO — write surface, no change** | n/a | n/a |
| 7 | Business Web preview | **NO — write surface, no change** | n/a | n/a |
| 8 | Admin Web | **NO — out of scope per INTAKE** | n/a | n/a |
| 9 | Consumer-app `ExpandedBusinessEventSheet` (event sheet that mounts buyer-web `PublicEventPage` via shared component) | **YES — automatic via shared code** | G-08 fix flows automatically via the shared `PublicEventPage` + `viewRowToBrand`. Brand-in-event context inside the consumer event sheet will now show truthful brand kind/address/cover. | Parity automatic — same code path. |

**Parity is automatic.** All affected code is in shared mingla-business modules consumed by both buyer-web and consumer-app's event sheet. No platform-specific success criteria needed. **Single success criterion per gap (SC-N) applies across all in-scope surfaces.**

---

## §3 Layer-by-layer specification

### §3.1 Database / View layer

**Migration filename:** `supabase/migrations/<YYYYMMDDHHMMSS>_orch_0962_brand_field_render_truthful.sql` (timestamp via `date -u +%Y%m%d%H%M%S` at implementor time — must be later than every prefix in `main` AND every active worktree's `supabase/migrations/`).

#### §3.1.1 `business_public_brands_view` — add 2 columns

```sql
CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT
  id,
  slug,
  name,
  description,
  profile_photo_url,
  contact_email,         -- ORCH-0962 G-01
  contact_phone,         -- ORCH-0962 G-01
  social_links,
  custom_links,
  display_attendee_count,
  kind,
  address,
  cover_hue,
  cover_media_url,
  cover_media_type,
  profile_photo_type,
  created_at,
  updated_at
FROM brands b
WHERE deleted_at IS NULL
  AND (
    (kind = ANY (ARRAY['popup'::text, 'trip_planner'::text]))
    OR (kind = 'physical'::text AND claim_status = 'verified'::text)
  );
```

**Permissions:** view inherits permissions from `brands`; no GRANT changes required. `brands` RLS already gates anonymous access to the view's predicate set.

#### §3.1.2 `claimed_venues_public_view` — add 2 columns

```sql
CREATE OR REPLACE VIEW public.claimed_venues_public_view AS
SELECT
  b.id,
  b.name,
  b.slug,
  b.description,
  b.profile_photo_url,
  b.profile_photo_type,
  b.contact_email,        -- ORCH-0962 G-01
  b.contact_phone,        -- ORCH-0962 G-01
  b.social_links,
  b.custom_links,
  b.display_attendee_count,  -- ORCH-0962 G-09 (currently DROPPED by this view; add it back so mapper can read truthfully)
  b.default_currency,
  b.address,
  b.city,
  b.country_code,
  b.lat,
  b.lng,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.kind,
  b.venue_category,
  b.place_pool_id,
  b.google_place_id,
  b.created_at,
  b.updated_at,
  ( SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'weekday', bh.weekday,
          'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
          'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
          'is_closed', bh.is_closed
        )
        ORDER BY bh.weekday
      ),
      '[]'::jsonb
    ) AS "coalesce"
    FROM brand_hours bh
    WHERE bh.brand_id = b.id
  ) AS hours,
  pp.stored_photo_urls AS pool_photo_urls
FROM brands b
LEFT JOIN place_pool pp ON pp.id = b.place_pool_id
WHERE b.deleted_at IS NULL
  AND b.kind = 'physical'::text
  AND b.claim_status = 'verified'::text;
```

**Note:** the SELECT order matches the existing view exactly except for the three added columns (contact_email, contact_phone, display_attendee_count) inserted in logical positions.

#### §3.1.3 `business_public_events_view` — add 3 brand columns

```sql
-- Inside the existing CREATE OR REPLACE VIEW business_public_events_view,
-- the SELECT list joins `brands b ON b.id = e.brand_id`. Add three columns
-- to the SELECT list, prefixed `brand_` to match existing naming:
--
--   b.kind            AS brand_kind,         -- ORCH-0962 G-08
--   b.address         AS brand_address,      -- ORCH-0962 G-08
--   b.cover_media_url AS brand_cover_media_url, -- ORCH-0962 G-08
--
-- All existing columns preserved. Implementor must read the current view
-- definition via pg_get_viewdef before editing — do NOT rewrite from
-- a stale spec. The migration applies a full CREATE OR REPLACE VIEW with
-- the new columns added.
```

**Implementor pre-flight (MANDATORY):** read the current `business_public_events_view` definition via:

```sql
SELECT pg_get_viewdef('public.business_public_events_view', true);
```

Add the three brand columns to the SELECT list at the correct position (after the existing `brand_*` columns: `brand_id`, `brand_slug`, `brand_name`, `brand_description`, `brand_profile_photo_url`, `brand_display_attendee_count`). Preserve every other column verbatim including ORCH-0792 master_* event date columns. Use full `CREATE OR REPLACE VIEW` syntax — do not use `ALTER VIEW ... ADD COLUMN` (not supported).

#### §3.1.4 Permissions + RLS

No new RLS policies. Views read from `brands` which already has anonymous-read RLS for the rows matching each view's WHERE clause. No new GRANTs.

#### §3.1.5 Migration safety check

Pre-flight read-only probe (run before `db push --linked`):

```sql
SELECT COUNT(*) FROM brands WHERE contact_email IS NOT NULL OR contact_phone IS NOT NULL;
```

Expected: integer ≥ 0; no error. If query errors, schema state has diverged from the investigation and the migration must be re-spec'd.

### §3.2 Service / mapper layer

**File:** `mingla-business/src/services/publicEventsService.ts`.

#### §3.2.1 `BusinessPublicBrandViewRow` interface update

Add two fields to the TS interface at line ~95-112:

```ts
interface BusinessPublicBrandViewRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profile_photo_url: string | null;
  contact_email: string | null;   // ORCH-0962 G-01
  contact_phone: string | null;   // ORCH-0962 G-01
  social_links: unknown;
  custom_links: unknown;
  display_attendee_count: boolean;
  kind: "physical" | "popup";
  address: string | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  profile_photo_type: "image" | "video" | "gif" | null;
  created_at: string;
  updated_at: string;
}
```

#### §3.2.2 `ClaimedVenuePublicViewRow` interface update

Add three fields:

```ts
export interface ClaimedVenuePublicViewRow {
  // ... existing fields ...
  contact_email: string | null;          // ORCH-0962 G-01
  contact_phone: string | null;          // ORCH-0962 G-01
  display_attendee_count: boolean;       // ORCH-0962 G-09 — replaces hardcoded false
  // ... rest preserved ...
}
```

#### §3.2.3 `BusinessPublicEventViewRow` interface update

Add three fields:

```ts
interface BusinessPublicEventViewRow {
  // ... existing fields preserved ...
  brand_kind: "physical" | "popup" | "trip_planner"; // ORCH-0962 G-08
  brand_address: string | null;                       // ORCH-0962 G-08
  brand_cover_media_url: string | null;               // ORCH-0962 G-08
  // ... rest preserved ...
}
```

#### §3.2.4 New helper: `extractBrandContact`

Insert near the existing `asLinks` helper (~line 263):

```ts
import { splitBrandDescription } from "./brandMapping"; // ORCH-0962 G-02

const extractBrandContact = (
  email: string | null,
  phone: string | null,
): Brand["contact"] => {
  const out: NonNullable<Brand["contact"]> = {};
  if (typeof email === "string" && email.length > 0) out.email = email;
  if (typeof phone === "string" && phone.length > 0) out.phone = phone;
  return Object.keys(out).length > 0 ? out : undefined;
};
```

#### §3.2.5 `publicBrandViewRowToBrand` — G-01 + G-02

Replace lines ~314-341. Diff:

```ts
export const publicBrandViewRowToBrand = (
  row: BusinessPublicBrandViewRow,
  eventCount = 0,
): PublicBrandRecord => {
  // ORCH-0962 G-02: split joined tagline + bio
  const { tagline, bio } = splitBrandDescription(row.description);
  return {
    id: row.id,
    displayName: row.name,
    slug: row.slug,
    kind: row.kind,
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    profilePhotoType: row.profile_photo_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    role: "owner",
    stats: { events: eventCount, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    bio: bio,                                          // ORCH-0962 G-02
    tagline: tagline,                                  // ORCH-0962 G-02
    contact: extractBrandContact(row.contact_email, row.contact_phone), // ORCH-0962 G-01
    links: asLinks(row.social_links, row.custom_links),
    displayAttendeeCount: row.display_attendee_count,
  };
};
```

#### §3.2.6 `claimedVenueRowToBrand` — G-01 + G-02 + G-09

Replace lines ~372-407. Diff (key changes only):

```ts
  // ORCH-0962 G-02: split joined tagline + bio
  const { tagline, bio } = splitBrandDescription(row.description);
  return {
    // ... preserved fields ...
    bio: bio,                                          // ORCH-0962 G-02
    tagline: tagline,                                  // ORCH-0962 G-02
    contact: extractBrandContact(row.contact_email, row.contact_phone), // ORCH-0962 G-01
    links: asLinks(row.social_links, row.custom_links),
    displayAttendeeCount: row.display_attendee_count,  // ORCH-0962 G-09 (was: false)
    // ... rest preserved ...
  };
```

#### §3.2.7 `viewRowToBrand` (event-detail brand context) — G-02 + G-08

Replace lines ~288-312. Key changes: read brand_kind/brand_address/brand_cover_media_url from row instead of hardcoding; split description.

```ts
const viewRowToBrand = (row: BusinessPublicEventViewRow): PublicBrandRecord => {
  const theme = asRecord(row.public_theme);
  // ORCH-0962 G-02: split joined tagline + bio
  const { tagline, bio } = splitBrandDescription(row.brand_description);
  return {
    id: row.brand_id,
    displayName: row.brand_name,
    slug: row.brand_slug,
    kind: row.brand_kind,                              // ORCH-0962 G-08 (was: "popup")
    address: row.brand_address,                        // ORCH-0962 G-08 (was: null)
    coverHue: asNumber(theme.brandCoverHue, asNumber(theme.coverHue, 25)),
    coverMediaUrl: row.brand_cover_media_url ?? undefined, // ORCH-0962 G-08
    photo: row.brand_profile_photo_url ?? undefined,
    role: "owner",
    stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    bio: bio,                                          // ORCH-0962 G-02 (was: row.brand_description ?? undefined)
    tagline: tagline,                                  // ORCH-0962 G-02 (was: undefined)
    links: asLinks(theme.brandLinks),
    displayAttendeeCount: row.brand_display_attendee_count,
  };
};
```

### §3.3 Component layer

**File:** `mingla-business/src/components/brand/PublicBrandPage.tsx`.

#### §3.3.1 `SocialLinksRow` entries — G-03

Insert facebook between x and youtube (lines ~664-678), and add linkedin between threads and the closing brace:

```ts
    if (links.x !== undefined && links.x.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.x, "https://x.com/"),
        icon: "x",
        label: "X",
      });
    }
    // ORCH-0962 G-03
    if (links.facebook !== undefined && links.facebook.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.facebook, "https://facebook.com/"),
        icon: "facebook",
        label: "Facebook",
      });
    }
    if (links.youtube !== undefined && links.youtube.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.youtube, "https://youtube.com/@"),
        icon: "youtube",
        label: "YouTube",
      });
    }
    // ORCH-0962 G-03
    if (links.linkedin !== undefined && links.linkedin.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.linkedin, "https://linkedin.com/in/"),
        icon: "linkedin",
        label: "LinkedIn",
      });
    }
    if (links.threads !== undefined && links.threads.length > 0) {
      out.push({
        url: normalizeSocialUrl(links.threads, "https://threads.net/@"),
        icon: "threads",
        label: "Threads",
      });
    }
```

**LinkedIn URL normalization decision:** the LinkedIn URL base prefix `https://linkedin.com/in/` matches the most common per-person profile path. Brands may want company pages (`/company/<slug>`). If a brand enters a full URL starting with `http://` or `https://`, `normalizeSocialUrl` short-circuits and uses the operator's URL verbatim (line 791-794). The `/in/` default is for bare-handle entries; document this in a kit-side comment.

**Icon names:** `facebook` and `linkedin` MUST exist in the `Icon` primitive's `IconName` union. Implementor pre-flight: grep `IconName` type definition + the icon registry; if either name is missing, add it before the SocialLinksRow change (Icon kit work, ~10 lines).

#### §3.3.2 Bio + Tagline render hierarchy — G-02 follow-through

Replace lines ~356-360 (currently bio-or-tagline-fallback) with both-render hierarchy:

```tsx
{/* ORCH-0962 G-02 — render tagline AND bio when both are present.
    Tagline as styled eyebrow / lead, bio as body text below.
    Pre-0962 behaviour rendered tagline only as a fallback when bio
    was empty — visually erased the tagline whenever both existed. */}
{brand.tagline !== undefined && brand.tagline.trim().length > 0 ? (
  <Text style={styles.taglineCentered}>{brand.tagline}</Text>
) : null}
{brand.bio !== undefined && brand.bio.trim().length > 0 ? (
  <Text style={styles.bioLeadCentered}>{brand.bio}</Text>
) : null}
```

Add `taglineCentered` style to the StyleSheet (after `bioLeadCentered`):

```ts
  // ORCH-0962 G-02 — tagline renders as styled eyebrow above bio.
  // Reuses bioLeadCentered's max-width + alignment to keep visual centering;
  // distinct fontWeight + smaller fontSize differentiate it from bio body.
  taglineCentered: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
    lineHeight: 18,
    marginBottom: spacing.xs,
    textAlign: "center",
    maxWidth: 540,
    alignSelf: "center",
    paddingHorizontal: spacing.sm,
  },
```

#### §3.3.3 Head meta tags — G-02 follow-through

Lines 233-263 currently fall back from `brand.bio` to `brand.tagline`. Once tagline is correctly populated, these still work (bio wins as preferred SEO description, tagline is fallback). **No change required** to `<Head>` block.

#### §3.3.4 AboutTab contact block — G-01 follow-through

`PublicBrandPage.tsx:574-611` already has the contact-block render guarded by `brand.contact?.email` or `brand.contact?.phone`. **No code change required** — the existing render will now light up because the mapper produces a non-undefined `contact` object.

---

## §4 Success criteria

Numbered, observable, testable.

- **SC-01 (G-01) — Contact info renders on public brand page.** Given a brand with non-empty `contact_email = "test-orch-0962@example.com"` and `contact_phone = "+447700900312"`, the public brand page (`/b/{brandSlug}`) AboutTab renders both values as tappable `mailto:` and `tel:` links exactly matching the stored values. Verified via DB seed + Playwright snapshot.

- **SC-02 (G-01) — Empty contact info renders nothing.** Given a brand with `contact_email = NULL` and `contact_phone = NULL`, the public brand page AboutTab does NOT render a "Contact" section header (the guard at PublicBrandPage.tsx:574-577 keeps the block hidden).

- **SC-03 (G-02) — Tagline and bio render distinctly when both present.** Given a brand with tagline `"Eat well, live well"` and bio `"We're a London-based brunch spot..."`, the public brand page renders the tagline as a styled eyebrow line (smaller, uppercase-tracked, tertiary color) directly above the bio body text. Tagline text and bio text are visually distinct.

- **SC-04 (G-02) — Tagline-only brand renders tagline only.** Given a brand with tagline only (bio empty), the public brand page renders the tagline at the tagline-style position. The bio paragraph slot remains empty.

- **SC-05 (G-02) — Bio-only brand renders bio only.** Given a brand with bio only (tagline empty), the public brand page renders bio at the bio-style position. The tagline slot remains empty.

- **SC-06 (G-03) — Facebook icon renders.** Given a brand with `social_links.facebook = "https://facebook.com/testbrand"`, the public brand page social row renders a Facebook icon in the icon list, tappable, opening the stored URL.

- **SC-07 (G-03) — LinkedIn icon renders.** Given a brand with `social_links.linkedin = "https://linkedin.com/company/testbrand"`, the public brand page social row renders a LinkedIn icon in the icon list, tappable, opening the stored URL.

- **SC-08 (G-08) — Physical brand in event context shows true kind + address + cover.** Given a physical brand with `address = "12 Old St, London"` and `cover_media_url = "<URL>"` AND a published event under that brand, the buyer-web event page (`/e/{brandSlug}/{eventSlug}`) and the consumer-app event sheet (`ExpandedBusinessEventSheet`) render the brand's actual kind (physical), actual address, and actual cover image (not hardcoded popup / null / missing).

- **SC-09 (G-09) — Verified-venue brand `displayAttendeeCount` honors DB.** Given a verified-venue brand with `display_attendee_count = true` (or false), the value flows through `claimedVenueRowToBrand` into `Brand.displayAttendeeCount` matching the DB. (Note: G-05 — the public page has no consumer of this field yet — is out of scope; this SC verifies the data-truth fix only, not visible render.)

- **SC-10 (parity) — All in-scope surfaces match.** `business_public_brands_view`, `claimed_venues_public_view`, and `business_public_events_view` are the three views and one shared service. After fix, no surface that consumes them shows a regression vs the pre-fix state for any field not listed in G-01..G-09. Verified via grep of every consumer of `PublicBrandRecord` (the mapped type).

- **SC-11 (idempotency) — Re-running migration is safe.** The migration uses `CREATE OR REPLACE VIEW` for all three views; running the migration twice is a no-op. Verified by re-running on a local Supabase branch.

---

## §5 Invariants

### §5.1 Invariants preserved

- **I-17 brand slug immutability.** No change to slug handling. Migration touches no column related to slug.
- **I-PROPOSED-TR1-KIND-IMMUTABLE (ORCH-0855).** No change. `BrandEditView` still gates BRAND KIND behind `kind !== "trip_planner"`. `viewRowToBrand`'s new `row.brand_kind` read can return `"trip_planner"` for trip-planner brands viewed in event-detail context — that is correct truthful rendering.
- **I-PROPOSED-J Zustand-persist-no-server-snapshots.** No change to Zustand persist.
- **I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED.** N/A — no external API calls in scope.
- **Constitution #5 (server state via React Query).** No change. All reads flow through `usePublicBrandBySlug` / `usePublicEventBySlug` already.

### §5.2 Invariants restored

- **Constitution #9 (no fabricated data) — RESTORED for brand-in-event-context (G-08) and verified-venue displayAttendeeCount (G-09).** Pre-fix code hardcoded `kind`/`address`/`displayAttendeeCount` regardless of DB state — fabrication. Post-fix code reads from DB. Cite this restoration in the CLOSE commit.

### §5.3 New invariant (DRAFT → ACTIVE on ORCH-0962 CLOSE)

- **I-PROPOSED-BRAND-FIELD-MAP-COVERAGE.** Every editable field on `BrandEditView` whose value persists to a column in `brands` MUST be either (a) read by the public-page mapper and rendered by `PublicBrandPage` / `AboutTab`, OR (b) explicitly documented as "edit-only / not public" with a one-line comment in `BrandEditView.tsx`. New editable fields added to `BrandEditView` MUST update both the appropriate public view's SELECT list and the mapper, OR explicitly document the omission with rationale. Enforcement: strict-grep CI gate at `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` (cross-references the list of `setDraft({...draft, X})` calls in `BrandEditView.tsx` against the SELECT lists of `business_public_brands_view` + `claimed_venues_public_view` and against the `publicBrandViewRowToBrand` + `claimedVenueRowToBrand` mappers, warns on any new key that appears in BrandEditView but not in both the view and the mapper).

---

## §6 Test cases

**Implementor happy-path tests (Step 0.5 gate — fails-on-revert mandatory):**

| ID | Layer | Scenario | Input | Expected | File path |
|---|---|---|---|---|---|
| T-01 | service unit | publicBrandViewRowToBrand splits tagline+bio | row.description = "Eat well, live well\n\nWe brunch hard." | brand.tagline = "Eat well, live well"; brand.bio = "We brunch hard." | `mingla-business/src/services/__tests__/publicEventsService.orch_0962.test.ts` |
| T-02 | service unit | publicBrandViewRowToBrand produces contact when fields non-empty | row.contact_email = "x@y.com"; row.contact_phone = "+447700900312" | brand.contact = { email: "x@y.com", phone: "+447700900312" } | same file |
| T-03 | service unit | publicBrandViewRowToBrand produces contact:undefined when both empty | row.contact_email = null; row.contact_phone = null | brand.contact === undefined | same file |
| T-04 | service unit | claimedVenueRowToBrand reads displayAttendeeCount from row | row.display_attendee_count = true | brand.displayAttendeeCount === true (NOT hardcoded false) | same file |
| T-05 | service unit | viewRowToBrand (event-detail) reads brand_kind from row | row.brand_kind = "physical"; row.brand_address = "12 Old St" | brand.kind === "physical"; brand.address === "12 Old St" | same file |
| T-06 | service unit | viewRowToBrand reads brand_cover_media_url | row.brand_cover_media_url = "https://cdn.example/cover.jpg" | brand.coverMediaUrl === "https://cdn.example/cover.jpg" | same file |
| T-07 | component | SocialLinksRow renders facebook icon | links = { facebook: "https://facebook.com/testbrand" } | facebook icon present in rendered tree | `mingla-business/src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts` |
| T-08 | component | SocialLinksRow renders linkedin icon | links = { linkedin: "https://linkedin.com/in/testbrand" } | linkedin icon present | same file |
| T-09 | component | PublicBrandPage renders tagline + bio as distinct text nodes | brand.tagline = "Tag"; brand.bio = "Bio body." | two `<Text>` nodes with `styles.taglineCentered` and `styles.bioLeadCentered` respectively | same file |

**Tester adversarial tests (Step 0.5 gate — different angle than implementor's tests):**

| ID | Layer | Scenario | Input | Expected | File path |
|---|---|---|---|---|---|
| A-01 | service unit (boundary) | publicBrandViewRowToBrand: description with only `\n\n` separator splits to empty tagline + empty bio (both treated as undefined / hidden) | row.description = "\n\n" | brand.tagline ∈ {undefined, ""}; brand.bio ∈ {undefined, ""} — neither renders on UI | `mingla-business/src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts` |
| A-02 | service unit (boundary) | publicBrandViewRowToBrand: description with single paragraph (no separator) → bio only, tagline undefined | row.description = "Just a bio." | brand.tagline === undefined; brand.bio === "Just a bio." | same file |
| A-03 | service unit (malformed) | extractBrandContact: whitespace-only email + phone → contact undefined | row.contact_email = "   "; row.contact_phone = "  " | brand.contact === undefined (whitespace not treated as present) | same file |
| A-04 | service unit (G-08 isolation) | viewRowToBrand: trip_planner brand kind flows through truthfully | row.brand_kind = "trip_planner" | brand.kind === "trip_planner" (no popup downgrade) | same file |
| A-05 | component (XSS-adjacent) | SocialLinksRow: facebook URL with embedded query string passes through normalizeSocialUrl untouched (no double-encoding) | links = { facebook: "https://facebook.com/brand?ref=mingla" } | rendered href === input verbatim | `mingla-business/src/components/brand/__tests__/PublicBrandPage.orch_0962.adversarial.test.ts` |

**Fails-on-revert verification (mandatory per Step 0.5 gate):** for each happy-path test T-01..T-09, the test MUST PASS when run against the fix and FAIL when run against the pre-fix code. Implementor records `fails-on-revert verified at <commit hash>` for each test in the implementation report.

---

## §7 Implementation order

1. **Pre-flight (read-only):**
   - Run `SELECT pg_get_viewdef('public.business_public_events_view', true);` and save the verbatim definition to use as the base for the §3.1.3 migration.
   - Confirm `facebook` and `linkedin` exist in the `Icon` primitive's `IconName` union; add to icon registry if missing.
   - Run the §3.1.5 safety probe.

2. **Database / migration (`supabase/migrations/<timestamp>_orch_0962_brand_field_render_truthful.sql`):**
   - `CREATE OR REPLACE VIEW business_public_brands_view` with contact_email + contact_phone added.
   - `CREATE OR REPLACE VIEW claimed_venues_public_view` with contact_email + contact_phone + display_attendee_count added.
   - `CREATE OR REPLACE VIEW business_public_events_view` with brand_kind + brand_address + brand_cover_media_url added (preserve all existing columns verbatim).

3. **Service / mapper (`mingla-business/src/services/publicEventsService.ts`):**
   - Add the 3 row-interface field additions.
   - Add `extractBrandContact` helper.
   - Import `splitBrandDescription` from `brandMapping`.
   - Update `publicBrandViewRowToBrand`, `claimedVenueRowToBrand`, `viewRowToBrand`.

4. **Component (`mingla-business/src/components/brand/PublicBrandPage.tsx`):**
   - Add facebook + linkedin entries to `SocialLinksRow`.
   - Replace bio/tagline fallback with both-render hierarchy.
   - Add `taglineCentered` style.

5. **Tests:** write T-01..T-09 (implementor) at the paths above; adversarial A-01..A-05 ship in the tester phase.

6. **Strict-grep gate:** add `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` per §5.3, plug into `.github/workflows/strict-grep-mingla-business.yml` as one script + one job per memory rule `feedback_strict_grep_registry_pattern.md`.

7. **Operator-applied migration (after implementor pushes):**
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]" && /Users/sethogieva/bin/supabase db push --linked
   ```

8. **Verify post-apply (orchestrator):**
   ```sql
   SELECT contact_email, contact_phone FROM business_public_brands_view LIMIT 1;
   SELECT brand_kind, brand_address, brand_cover_media_url FROM business_public_events_view LIMIT 1;
   ```
   Both queries must return without error.

9. **Edge function deploy:** N/A — no edge functions touched.

---

## §8 Regression prevention

- **I-PROPOSED-BRAND-FIELD-MAP-COVERAGE** strict-grep gate (§5.3) catches future additions of editable fields that aren't plumbed end-to-end.
- **T-01..T-09 + A-01..A-05** lock each gap fix at the unit + component layer with fails-on-revert verification.
- **Protective comments:** every modified line carries an inline `// ORCH-0962 G-NN` tag so future audits can grep the fix surface.

---

## §9 Discoveries for orchestrator

- **D-1 — ORCH-0964 sequencing.** ORCH-0964 [public-page-theme-customization] is spawning in parallel and is now scoped (per operator 2026-05-25) to also build the consumer-app standalone public brand profile screen + entry points from event pages, brand-name taps, and brand-photo taps anywhere in the consumer app. Strongly recommend ORCH-0964 wait for ORCH-0962 CLOSE before starting visual work — otherwise the redesign will be implemented against the wrong (currently-broken) field set. Recommend the orchestrator write a `COMMS-NNNN` ledger entry to ORCH-0964 ack'ing this sequencing.
- **D-2 — Four follow-up ORCHs to register at INTAKE.** Per §1.3: phoneCountryIso persistence (G-04), displayAttendeeCount consumer (G-05), hours editor (G-06), custom_links editor + renderer or column drop (G-07). Each is a small standalone ORCH; all are product/design decisions, not investigatable bugs.
- **D-3 — Spam-protection follow-up.** Once G-01 lands, brand email + phone are publicly visible to anonymous web viewers. If a brand operator complains about scraping, the follow-up is a `brand-contact-message` edge function that replaces bare email/phone exposure with a contact form. Register only on demand.
- **D-4 — `useUpdateBrand` write path not exhaustively traced.** The implementor SPEC doesn't require it (the schema confirms what columns exist), but for completeness someone should at some point trace `brandsService.updateBrand` → final Supabase call. Discovery from Phase 0 investigation.
