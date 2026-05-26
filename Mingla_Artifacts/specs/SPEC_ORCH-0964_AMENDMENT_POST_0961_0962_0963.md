# SPEC AMENDMENT — ORCH-0964 [Public-page theme customization] — post ORCH-0961/0962/0963 closes

**Authored:** 2026-05-25 (second pass) by Claude `mingla-forensics`
**Supersedes:** specific sections of `SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`. Original SPEC remains the base contract; this amendment is binding where the two conflict.
**Reason:** between original SPEC authoring and now, ORCH-0961, ORCH-0962, and ORCH-0963 closed and reshaped the code surface ORCH-0964 will edit. COMMS-0005 explicitly warned of the overlap.

---

## Summary of changes

| Section in original SPEC | Status | What changed |
|---|---|---|
| §2 D-4 (Consumer-app scope) | **AMEND** | Operator note in ORCH-0962 CLOSE banner says "standalone consumer-app brand profile folded into ORCH-0964 redesign" — needs Seth re-confirm before SPEC widens. |
| §3 Cross-Surface Impact table | **AMEND** | Buyer-web event page now passes `hideFloatingChrome={true}` (ORCH-0961). Shared `PublicEventPage` has new Close+Share row + `hideFloatingChrome` opt-out. Theme prop must coexist. |
| §4.1 Database migration | **AMEND** | Theme columns must ALSO be exposed in 3 views (ORCH-0962): `business_public_brands_view`, `claimed_venues_public_view`, `business_public_events_view`. Without view updates, hooks won't see the columns and the new `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE` strict-grep gate (ORCH-0962) WILL FAIL. |
| §4.5 Hook layer — buyer-web | **AMEND** | `publicEventsService.ts` mappers (`publicBrandViewRowToBrand`, `claimedVenueRowToBrand`, `viewRowToBrand`) added by ORCH-0962 are the new injection point — extend them to read theme columns. `getPublicBrandBySlug` is now kind-dispatched (ORCH-0963) with new `PublicBrandDetail.trips` shape — theme injection must handle both event-brand and trip-brand return shapes. |
| §4.8 Render — buyer-web public brand page | **REWRITE** | `PublicBrandPage.tsx` is now kind-branched (ORCH-0963): `isTripBrand` branches tab labels + bodies + primitives. Theme MUST apply to BOTH the event-brand UI (Upcoming/Past + `EventMiniCard` + `NextEventTeaser`) AND the trip-brand UI (Trips/Past Trips + `TripMiniCard`). Line ~309 reference in original SPEC is stale — exact line numbers shifted. |
| §4.7 Render — shared `PublicEventPage` | **AMEND** | Add theme prop adjacent to existing `hideFloatingChrome` prop (ORCH-0961). Both must work in combination. Floating chrome (Close+Share row) MUST also pick up `theme.foregroundColor` for icon tint when rendered. |
| §6 Invariants — Preserve | **EXTEND** | Add 3 new ACTIVE invariants to preserve: `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE` (ORCH-0962), `I-PUBLIC-BRAND-KIND-BRANCHED` (ORCH-0963), `I-PROPOSED-HOME-MOBILE-LOCK-PANE` (ORCH-0974, unrelated but flag for awareness). |
| §8 Implementation order | **AMEND** | Step 1 now requires `git rebase origin/main` FIRST — branch is 34 commits behind. After rebase, view updates (now Step 1b) are part of the same migration. |
| §10 Hard guards | **EXTEND** | Add 3 new DO NOTs based on ORCH-0961/0962/0963 architecture. |

Everything else in the original SPEC remains in force unchanged.

---

## 1. Updated §2 D-4 — Consumer-app scope (NEEDS OPERATOR DECISION)

**Original D-4:** "Consumer-app scope: shared `packages/event-rendering/PublicEventPage` only. NO theming of `SwipeableCards`, `CuratedExperienceSwipeCard`, `BusinessEventCard`, `DiscoverScreen`, `EventDetailLayout` (nightOut)."

**New context from ORCH-0962 CLOSE banner (2026-05-25):** "NOT in scope: admin-web (no admin equivalent), standalone consumer-app brand profile (folded into ORCH-0964 redesign per operator 2026-05-25)."

This suggests Seth approved that ORCH-0964 might build a standalone consumer-app brand profile screen — there is NO such screen today in `app-mobile/`. If true, scope grows by:

- **NEW screen** in `app-mobile/src/components/brand/` — a brand profile page mirroring buyer-web `/b/{brandSlug}` (themed by D-1..D-7).
- **Navigation entry** from wherever in the consumer app a brand should be reachable (currently nowhere — needs design + IA decision).
- **Hook** to fetch brand + events for that screen (consumer-app analog of `usePublicBrandBySlug`).
- **Doubles consumer-app testing surface** for ORCH-0964 (event sheet + brand screen).

**Recommendation:** ASK SETH BEFORE EXPANDING. Two interpretations of the ORCH-0962 note are possible:
- **(A) Wide:** build the consumer-app brand profile in this ORCH (significant scope add).
- **(B) Narrow:** the ORCH-0962 note is forward-looking — "if/when a consumer-app brand profile gets built, theming will be part of ORCH-0964's contract" — but the screen itself is a separate future ORCH.

I lean (B) for blast-radius control. Confirm in handoff before implementor dispatches.

## 2. Updated §3 Cross-Surface Impact — addendum rows

Add these rows to the table (do not remove existing rows):

| Surface | In scope? | What user sees | File paths touched | Parity |
|---|---|---|---|---|
| Buyer-web public BRAND page (event-brand variant) | ✅ YES | Themed Upcoming/Past tabs, `NextEventTeaser`, sticky-CTA `EventMiniCard` (first 3). | `PublicBrandPage.tsx` line ~144 onward (the event-brand branch). | Manual. |
| Buyer-web public BRAND page (trip-planner variant) | ✅ YES | Themed Trips/Past Trips tabs, `TripMiniCard`s. | `PublicBrandPage.tsx` `isTripBrand` branches + `TripMiniCard` primitive. | Manual. |
| Shared `PublicEventPage` floating chrome | ⚠️ Partial | Close/Share icons in the floating chrome row pick up `theme.foregroundColor` tint when rendered. When `hideFloatingChrome={true}` (buyer-web event page per ORCH-0961), the chrome is skipped entirely and only the adapter's own Close+Share row is themed. | `packages/event-rendering/PublicEventPage.tsx`. | Automatic via shared package. |
| Buyer-web event page adapter | ✅ YES | The adapter's own Close+Share `IconChrome` row (added by ORCH-0961) picks up `theme.foregroundColor`. | `mingla-business/src/components/event/PublicEventPage.tsx` (adapter — not the shared package). | Manual. |

## 3. Updated §4.1 — Database migration AMENDMENT

The original migration adds 3 columns to `brands` and 3 to `events`. That stays. **ADD to the same migration file:**

```sql
-- Expose theme columns through the canonical RLS-aware public views (per I-PROPOSED-BRAND-FIELD-MAP-COVERAGE).
-- ORCH-0962 established these views as the only path from DB → buyer-web render.

DROP VIEW IF EXISTS public.business_public_brands_view CASCADE;
CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT
  -- existing columns per ORCH-0962 migration 20260727000003 — implementor copies all of them here verbatim
  b.id, b.slug, b.name, b.kind, b.description,
  b.profile_photo_url, b.cover_media_url, b.cover_media_type,
  b.cover_hue, b.address, b.contact_email, b.contact_phone,
  b.social_links, b.custom_links, b.display_attendee_count,
  b.default_currency,
  -- ORCH-0964 ADD:
  b.theme_color,
  b.theme_font,
  b.theme_animation
FROM public.brands b
WHERE b.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = b.id
      AND e.deleted_at IS NULL
      AND e.visibility IN ('public','password')
      AND e.status = 'live'
  );

-- Same pattern for claimed_venues_public_view (verified physical brands) — add theme_color, theme_font, theme_animation.
-- Same pattern for business_public_events_view — add theme_color_override, theme_font_override, theme_animation_override
--   AND retain ORCH-0962's brand-context fields (brand_kind, brand_address, brand_cover_media_url) PLUS expose brand's
--   theme_color/font/animation via subselect so the buyer-web event page can resolve theme without a second round-trip.

GRANT SELECT ON public.business_public_brands_view TO anon, authenticated;
-- Mirror grants for the other 2 views.
```

**Implementor MUST:** read the current view definitions on `origin/main` (after rebase) and copy the existing column lists verbatim — do NOT trim or reorder. Three view DROPs + CREATE OR REPLACEs in this migration.

**Pre-flight probe:** still N/A (all new columns NULL-able with no data assumptions). View changes are pure additions.

## 4. Updated §4.5 — Hook layer AMENDMENT

`publicEventsService.ts` mappers added by ORCH-0962 are the canonical injection point:

- **`publicBrandViewRowToBrand`** — extend to read `theme_color`, `theme_font`, `theme_animation` from the view row, return as `Brand.theme: { color, font, animation } | null` (NULL when all 3 columns NULL).
- **`claimedVenueRowToBrand`** — same extension for verified physical brands.
- **`viewRowToBrand`** (event-detail brand context) — same extension for the brand object embedded in event response.
- **`getPublicBrandBySlug`** (kind-dispatched per ORCH-0963) — both code paths (event-brand and trip-planner) must return brand.theme.
- **`getPublicEventBySlug`** — extend to read event-level override columns. Hook then calls `resolveTheme(brand.theme, event.themeOverrides)` from `@mingla/event-rendering` and returns `resolvedTheme`.

Strict-grep gate `orch-0962-brand-field-map-coverage.mjs` will FAIL if a column lands in DB but a mapper or renderer doesn't consume it. Implementor must extend the mapper-coverage gate's expected-field list to include the 3 new theme columns + 3 new event override columns.

## 5. Updated §4.7 — Shared `PublicEventPage` AMENDMENT

Theme prop placement (alongside existing `hideFloatingChrome` opt-out prop added by ORCH-0961):

```typescript
interface PublicEventPageProps {
  // ... existing props (per packages/event-rendering/types.ts on origin/main)
  hideFloatingChrome?: boolean;  // ORCH-0961 — default false
  theme?: ResolvedTheme;         // ORCH-0964 — NEW
}
```

Combined behavior:
- When `hideFloatingChrome={true}` AND `theme` is set: skip shared floating chrome entirely (adapter renders its own themed chrome). Apply theme to hero + content.
- When `hideFloatingChrome={false}` (or undefined) AND `theme` is set: shared floating chrome icons tinted with `theme.foregroundColor`. Apply theme to hero + content.
- When `theme` undefined: existing behavior — `MINGLA_DEFAULT_THEME` applies.

Test cases T-13 + T-14 (from original SPEC §7) extend to cover both `hideFloatingChrome` states.

## 6. Updated §4.8 — Buyer-web PublicBrandPage AMENDMENT (REWRITE of original §4.8)

`PublicBrandPage.tsx` is now kind-branched (ORCH-0963 line 144: `const isTripBrand = brand.kind === "trip_planner"`).

**Implementor wires theme into BOTH branches:**

1. **Hue fallback** at line ~309 (existing inline `backgroundColor: hsl(${brand.coverHue}, 60%, 45%)`): swap to `backgroundColor: resolvedTheme.color` where `resolvedTheme = resolveTheme(brand.theme, null)`. Fall back to the existing `hsl(coverHue, 60%, 45%)` formula ONLY when `brand.theme === null` AND `brand.coverHue !== 25` (default) — preserves visual continuity per investigation D-3.

2. **Event-brand branch:** apply `theme.fontFamilyValue` to section heading + tab labels + `NextEventTeaser` "NEXT · date · name · From £X →" text. Sticky "Buy tickets" pill picks up `theme.color` background + `theme.foregroundColor` text.

3. **Trip-planner branch:** apply `theme.fontFamilyValue` to section heading + tab labels + `TripMiniCard` destination/date/price strings. `TripMiniCard` "Booking closed" badge keeps its existing destructive-state color (do NOT theme — accessibility precedence).

4. **Entrance animation** mounts ONCE on the brand page itself (not per `EventMiniCard` / `TripMiniCard` — would be visually chaotic). Absolutely-positioned overlay over the hero band on first mount; subsequent navigation back to the same brand within session does NOT replay.

5. **Existing close button** (added by ORCH-0961) picks up `theme.foregroundColor` for icon tint.

Strict-grep gate `orch-0963-public-brand-kind-branched.mjs` MUST continue to pass — theme work does not regress the kind-branching invariant.

## 7. New §6 invariants to PRESERVE (additions to existing list)

- **`I-PROPOSED-BRAND-FIELD-MAP-COVERAGE`** (ORCH-0962, ACTIVE) — every `brands` column the buyer-web public brand page reads must flow through `views → mappers → Brand interface → renderer`. Theme columns MUST be added to all 4 levels.
- **`I-PUBLIC-BRAND-KIND-BRANCHED`** (ORCH-0963, ACTIVE) — `PublicBrandPage.tsx` MUST keep `isTripBrand` branching. Theme work MAY NOT remove or weaken the kind-branched structure.
- **`I-PROPOSED-HOME-MOBILE-LOCK-PANE`** (ORCH-0974, ACTIVE) — informational only; theme work does not touch home dashboard, but flag for awareness if scope creep occurs.

## 8. Updated §8 implementation order

Insert at step 0:

> **Step 0 — Rebase per-ORCH branch onto origin/main.** Branch `ORCH-0964-public-page-theme-customization` is 34+ commits behind main as of 2026-05-25. `cd ~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization] && git fetch origin main && git rebase origin/main`. Resolve any conflicts (most likely in `Mingla_Artifacts/WORLD_MAP.md` and `WORKTREE_REGISTRY.md`). After rebase, re-read `mingla-business/src/components/brand/PublicBrandPage.tsx`, `packages/event-rendering/PublicEventPage.tsx`, `packages/event-rendering/types.ts`, `mingla-business/src/services/publicEventsService.ts` from the rebased tree — line numbers in original SPEC are stale.

Insert at step 1b (after migration step 1):

> **Step 1b — View updates in the same migration file.** Add `business_public_brands_view`, `claimed_venues_public_view`, `business_public_events_view` DROP + CREATE OR REPLACE statements per §3 above. Verify with `mcp__supabase__list_tables` after operator `db push`.

## 9. New §10 hard guards (additions)

- **DO NOT** remove or weaken the `isTripBrand` kind-branching in `PublicBrandPage.tsx`. Theme applies WITHIN branches, not across them.
- **DO NOT** apply theme to `TripMiniCard.bookingsClosed` badge or `EventMiniCard.soldOut` badge — accessibility-critical destructive states must keep their designed colors.
- **DO NOT** mount the entrance animation per-mini-card on the brand page (would replay N times for N events). Mount once per brand-page session above the tabs.
- **DO NOT** drop or reorder columns when adding theme columns to the 3 views — copy the existing column list verbatim from the post-ORCH-0962 view definitions.
- **DO NOT** skip extending the `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE` gate's expected-field list — adding a column without registering it in the gate is auto-FAIL.
- **DO NOT** touch the ORCH-0961 `hideFloatingChrome` opt-out path. Theme prop is additive, not replacing.

## 10. Coordination notes

- **COMMS-0005 RESOLVED** by ORCH-0963 close (PR #215, `dd49d6d2b`) — overlap warning's "if 0964 lands first, 0963 inherits theme" branch is no longer relevant. ORCH-0964 inherits everything from 0963.
- **ORCH-0962 split-outs (ORCH-0966 / 0967 / 0968 / 0969)** are S3-low and REGISTERED-only; ORCH-0964 does NOT depend on any of them.
- **ORCH-0970 (buyer-web mobile-viewport bundle bug)** is a pre-existing buyer-web bug that may affect ORCH-0964 TEST phase on real iPhone Safari. Not a blocker — TEST verdict can be CONDITIONAL PASS with the mobile-viewport eyeball deferred pending ORCH-0970 resolution.
- **ORCH-0971 (worktree-per-ORCH live-fire infra)** is pre-existing infrastructure debt — affects live-fire TEST methodology, not the SPEC. CONDITIONAL PASS pattern observed in ORCH-0954/0961/0962/0963/0974 recent closes is the operating norm.

## 11. New COMMS write requirement

Implementor SHOULD update `COMMS_LEDGER.md` COMMS-0005 status to `RESOLVED` after the ORCH-0964 close commit lands (the warning's purpose is served — both ORCHs are now in main, no overlap remains).

---

**SPEC + AMENDMENT are now READY for implementor dispatch** subject to operator decision on §1 (consumer-app brand profile scope expansion: in or out).
