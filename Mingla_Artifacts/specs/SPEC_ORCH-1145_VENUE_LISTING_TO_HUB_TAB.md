# SPEC — ORCH-1145 — Move venue listing from brand page → a Hub "Venue" tab (Phase 1: THE MOVE ONLY)

- **ORCH-ID:** ORCH-1145
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` on branch `ORCH-1145-venue-hub-tab`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1145_VENUE_LISTING_TO_HUB_TAB.md` (this worktree) — findings F-1..F-7 are binding inputs.
- **Mode:** SPEC (contract; no implementation). Illustrative snippets ≤2–3 lines only.

---

## 1. Executive summary

Relocate the existing **venue-listing management surface** from a row on the founder Brand profile page into a new, conditionally-visible **"Venue"** tab inside the Hub, as a peer pill alongside Events / Experiences / Trips. This is a *move* — the management UI is reused as-is (no redesign). The brand-page "Venue listing" Operations row + its `onListing` plumbing are removed (single doorway). The Venue pill appears ONLY for brands with a physical location or a linked venue, mirroring today's brand-page row gate. The standalone `/brand/[id]/listing` route is KEPT as a thin redirect to the new tab, because four non-row navigators (to-do rows, home cards, push deep-links, global search) still target it (F-1). NO OpenTable / reservation / availability / intelligence work — that is a separate future Phase 2.

## 2. Scope & non-goals

**In scope (Phase 1 — relocation only):**
- Add a `venue` sub-tab to the shared Hub sub-nav (id, "Venue" label, route `/(tabs)/hub/listing`).
- New `app/(tabs)/hub/listing.tsx` content-only route that resolves the active brand via `useCurrentBrand()` and renders the existing management UI.
- Extract the existing `app/brand/[id]/listing.tsx` body into a shared, chrome-agnostic component so both the kept route-alias and the new tab render the SAME UI (no duplication).
- Conditional visibility: Venue pill shown iff active brand `hasPhysicalLocation === true || placePoolId != null`.
- Remove the `BrandProfileView` Operations row + `onListing` prop + `brand/[id]/index.tsx` handler/wiring.
- Convert the standalone `/brand/[id]/listing` route into a thin redirect to the Hub tab (forwarding `?focus=feedback`).

**Non-goals (explicitly OUT — do not build):**
- Any OpenTable / reservation / booking / availability / table-management / "more intelligence" feature (Phase 2).
- Any redesign of the management content itself (status card, AI scores, changes-remaining, feedback sheet, edit/resubmit) — reused verbatim.
- Any DB / edge-function / service / RLS / migration change. The visibility gate reads fields already present on the in-memory `Brand`.
- Any consumer-app, buyer-anon-web, admin-web change. `PublicBrandPage.tsx` + `PublicVenueDetail` are untouched.
- Any change to the Experiences tab (that is ORCH-1144's lane — disjoint per F-7).

**Assumptions:** `brand.hasPhysicalLocation` / `brand.placePoolId` are reliably populated on the active `Brand` (proven on the `Brand` type and already consumed by `BrandProfileView`'s `showVenueListing` gate).

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | none | none | n/a — different app |
| 2 | Consumer Android (`app-mobile/`) | NO | none | none | n/a |
| 3 | Buyer/anonymous Web | NO | none — `/b/{slug}` venue display unchanged | none | n/a — independent surface |
| 4 | Business iOS | YES | Hub gains a conditional "Venue" pill; brand-page "Venue listing" row gone; tapping Venue shows the existing listing management UI for the active brand | all §4 files | shared RN code |
| 5 | Business Android | YES | identical to iOS; existing `GlassCard` surfaces keep opaque-glass fallback | same | shared RN code (automatic) |
| 6 | Admin Web (`mingla-admin/`) | NO | none | none | n/a |
| 7 | Business Web preview | YES | identical to iOS; no `.web.tsx` needed (F-5) | same | shared RN code (automatic) |

## 4. Layered specification

No Database / Edge / Service / Realtime layers are touched. Only the component + hook + route layers change.

### 4.1 Shared hook — `useHubTabs.ts` (visibility gate)

Extend the tab universe and thread the venue condition.

- `HubTabName` union: add `"venue"` → `"getstarted" | "events" | "trips" | "experiences" | "venue"`.
- `deriveHubVisibleTabs` gains a venue input. Choose the **explicit-argument** approach (keeps the function pure + unit-testable, matches its current pure shape):
  - New signature: `deriveHubVisibleTabs(counts: BrandOfferingCounts, venue: { hasPhysicalLocation: boolean; hasPlacePool: boolean }): HubTabName[]`.
  - Push order: keep `events` → `trips` → `experiences` (count-gated as today), then append `"venue"` iff `venue.hasPhysicalLocation || venue.hasPlacePool`.
  - Venue placement: append LAST so the venue pill sits after the offering pills (peer pill, rightmost). (Seth's decision (c) = "a peer pill alongside Events / Experiences / Trips"; rightmost is the least-surprising peer position. If Seth wants it leftmost, that is a one-line reorder — flagged in §10.)
- `useHubVisibleTabs(brandId)` must now also read the brand's venue flags. It already calls `useBrandOfferingCounts(brandId)`. Add: resolve the active `Brand` (it can call `useCurrentBrand()` OR accept the venue flags as args from the caller — pick the path that avoids a second brand fetch). RECOMMENDED: have `_layout.tsx` (which already holds `currentBrand`) compute `{ hasPhysicalLocation, hasPlacePool }` and pass them into `useHubVisibleTabs`, OR call `deriveHubVisibleTabs` with the layout's `currentBrand`. Keep `useBrand`/React-Query the single source — do NOT add a parallel fetch.
- `pickHubInitialTab` + `HUB_LAST_TAB_STORAGE_KEY` literal-union guards: add `"venue"` to the accepted stored-tab set so a user who last sat on Venue restores there (only if still visible).

### 4.2 Shared component — `HubSubNav.tsx` (pill definition)

- `HubSubTabId` union: add `"venue"` → `"events" | "experiences" | "trips" | "venue"`.
- `SUB_TABS`: append `{ id: "venue", label: "Venue", route: "/(tabs)/hub/listing" }` (append last, matching §4.1 placement).
- `LABELS` map: add `venue: "Venue"`.
- `ROUTES` map: add `venue: "/(tabs)/hub/listing"`.
- `detectActiveSubTab`: add `if (lower.includes("/hub/listing")) return "venue";` BEFORE the `events` default. Route segment is `listing` (file name) — the URL is `/(tabs)/hub/listing`, so match on `/hub/listing`.

### 4.3 New route — `app/(tabs)/hub/listing.tsx` (content-only tab)

- Content-only (NO TopBar, NO header, NO back button — chrome is owned by `_layout.tsx`, per F-3).
- Resolve the active brand: `const brand = useCurrentBrand(); const brandId = brand?.id ?? null;` (F-4). No route param.
- Render the extracted shared listing body (§4.4) with `brandId` + `chromeMode="tab"` (suppresses the page-internal header/back) + an optional `focus` prop (default none — the tab has no query param; deep-link `?focus=feedback` only arrives via the kept route-alias §4.5).
- Bottom padding: mirror the sibling sub-routes — the inner ScrollView must clear the floating BottomNav (`insets.bottom + 120`, per the nav-lock companion pin pattern). The extracted body must accept/apply this so the last card is tappable.
- States: loading (ActivityIndicator — already in the body), no-venue ("Add your venue" CTA — already in the body), populated (status/scores/submitted/changes/actions — already in the body). All preserved from the existing page.

### 4.4 Extraction — shared `VenueListingContent` component (reuse, no duplication)

To honor "reuse the EXISTING management UI as-is" AND keep both the tab and the kept route working from one source:

- Create `mingla-business/src/components/venue/VenueListingContent.tsx` (new file) by lifting the BODY of `app/brand/[id]/listing.tsx` — everything from the `useBrand`/pipeline/authoring-context hooks (`listing.tsx:84-200`) through the `<ScrollView>...</ScrollView>` + feedback sheet + Toast (`:217-405`) and the `styles` block (`:409-503`).
- Props: `{ brandId: string | null; focus?: "feedback"; chromeMode: "tab" | "page" }`.
  - `chromeMode="page"` → render the existing header row + back button (the kept route-alias keeps page chrome IF it ever renders content; but per §4.5 the route is a pure redirect, so in practice only `"tab"` renders content — still, keep the prop for safety + the one test).
  - `chromeMode="tab"` → render NO header/back; the layout supplies chrome.
- The component owns ALL the data hooks + handlers verbatim (`handleAddVenue`, `handleEdit`, `handleViewPublic`, feedback sheet, Toast, deep-link `focus` auto-open effect). Move the `focus` source from `useLocalSearchParams` to the `focus` prop so the component is route-agnostic.
- `app/brand/[id]/listing.tsx` is then either deleted (replaced by the redirect §4.5) — the redirect file does NOT import the content.

### 4.5 Route fate — `app/brand/[id]/listing.tsx` → thin redirect (REQUIRED, do NOT delete the route)

Per F-1, four non-row navigators still target `/brand/{id}/listing`: `useBusinessTodos` (to-do rows + home cards), `businessNotificationRouting` (push deep-links `new_review`/`claim_decision`), `lib/search/registry` (global search). The route MUST resolve.

- Replace the page body with a redirect to the Hub tab. Because the Hub tab is active-brand-scoped (no id param), the redirect must FIRST ensure the active brand matches the route's `id`, then redirect to `/(tabs)/hub/listing`, forwarding `?focus=feedback`:
  - Read `id` + `focus` from `useLocalSearchParams`.
  - If `id` !== current `currentBrandId`, set the current brand to `id` (via `useCurrentBrandStore().setCurrentBrand` / `setCurrentBrandId`) so the tab shows the correct brand. (The brand is fetched by `useCurrentBrand` inside the tab.)
  - `return <Redirect href={focus === "feedback" ? "/(tabs)/hub/listing?focus=feedback" : "/(tabs)/hub/listing"} />;`
  - Implementor note: `Redirect` runs at render; set the brand id in a `useEffect`/inline before returning the `Redirect`, guarding against redirect loops. Validate the brand id belongs to the user (the tab's `useCurrentBrand` already auto-clears invalid ids — F-4 evidence).
- Forward `?focus=feedback` so the to-do `venueFeedbackRoute` (Discovery #2) still auto-opens the feedback sheet inside the tab. The tab passes `focus` into `VenueListingContent`.
- **Alternative (if the brand-switch-on-redirect proves fragile in IMPLEMENT):** keep `app/brand/[id]/listing.tsx` rendering `VenueListingContent` with `chromeMode="page"` + the route `id` (NOT a redirect). This guarantees deep-links land on the right brand's listing with zero brand-switch side effect, at the cost of two content entry points. The investigation’s "single doorway" goal (decision b) is about the *brand-page entry ROW*, which is removed either way; the deep-link route is a separate concern. **RECOMMENDATION: ship the redirect (§4.5 primary); fall back to the page-render alternative only if a redirect loop or brand-switch race appears in IMPLEMENT — stop-and-amend if so.**

### 4.6 `app/(tabs)/hub/_layout.tsx` (thread venue visibility, preserve nav-lock)

- Compute venue flags from the already-resolved `currentBrand`: `hasPhysicalLocation = currentBrand?.hasPhysicalLocation === true`, `hasPlacePool = currentBrand?.placePoolId != null`.
- Pass them into the visibility derivation (§4.1) so `visibleTabs.data` can include `"venue"`.
- The visible-tab redirect effect (`_layout.tsx:136-159`): extend the `active` derivation to detect `/hub/listing` → `"venue"` (add a branch BEFORE the `events` default), mirroring `detectActiveSubTab`. **PRESERVE EXACTLY** the `if (!activePath.includes("/hub/")) return;` guard line (`:148`) and its position BEFORE `router.replace` (`:157`) — `hub-layout-nav-lock.test.ts:40,43-49` pins both. Do not reorder or remove.

### 4.7 `BrandProfileView.tsx` + `app/brand/[id]/index.tsx` (remove the row + plumbing)

- `BrandProfileView.tsx`: remove the `onListing` prop from `BrandProfileViewProps` (`:194-198`), from the destructure (`:248`), from the `operationsRows` `useMemo` (the `if (showVenueListing) { rows.push({... label:"Venue listing" ...}) }` block `:405-416`), and from the `useMemo` deps (`:482`). Remove the now-unused `showVenueListing` constant (`:399-401`) IF nothing else reads it (grep — it is only read by the removed block). Remove the docblock note (`:194-198`). Leave every OTHER Operations row untouched.
- `app/brand/[id]/index.tsx`: remove `handleOpenListing` (`:141-144`) and the `onListing={handleOpenListing}` prop pass (`:199`). Leave all other handlers/props.

## 5. Success criteria (per-surface where parity is manual; iOS/Android/Web share code → one criterion unless noted)

- **SC-1** — For a brand with `hasPhysicalLocation === true` OR `placePoolId != null`, the Hub sub-nav renders a 4th pill labeled exactly **"Venue"** as a peer alongside Events/Experiences/Trips (those still count-gated).
- **SC-2** — For a purely-online brand (`hasPhysicalLocation !== true` AND `placePoolId == null`), the Venue pill does NOT render.
- **SC-3** — Tapping the Venue pill navigates to `/(tabs)/hub/listing` and renders the existing venue-listing management UI (status badge + hint, AI match scores when present, "What you submitted", changes-remaining, Edit/View-public actions, feedback sheet when an active follow-up exists) for the ACTIVE brand — NOT a placeholder, NO dead tap (SC verified at runtime).
- **SC-4** — The Venue tab shows the correct brand WITHOUT any route param: switching the active brand (brand switcher) and re-opening the Venue tab shows the new brand's listing.
- **SC-5** — The brand profile page (`/brand/{id}`) NO LONGER shows a "Venue listing" Operations row; all other Operations rows (Payments & Bank, Pricing defaults, Team, Blasts, Finance reports, Audit log) render unchanged.
- **SC-6** — Navigating to `/brand/{id}/listing` directly (e.g. via a push deep-link `mingla-business://brand/{id}/listing`, a to-do row, or global search) lands on the venue-listing UI for that brand (via the redirect to `/(tabs)/hub/listing`, with the active brand set to `{id}`). No 404, no blank screen.
- **SC-7** — A to-do `venueFeedbackRoute` (`/brand/{id}/listing?focus=feedback`) lands on the venue listing with the feedback sheet auto-opened (when an active follow-up round exists), via `?focus=feedback` forwarding.
- **SC-8** — The Hub tab-bar nav-lock behavior is preserved: pushing a route OUTSIDE the hub group (e.g. `/venue/deck-readiness` from the Edit-listing button) does NOT bounce the user back to the Hub (the `!activePath.includes("/hub/")` guard still early-returns).
- **SC-9-Android** — On Android, every glass surface in the Venue tab uses the opaque fallback (inherited from the unchanged `GlassCard` usages); no translucent Android fill is introduced.
- **SC-10** — Business web preview renders the Venue tab identically (shared code; no `.web.tsx`).

## 6. Invariants

| Invariant | How preserved | Verifying test |
|-----------|---------------|----------------|
| ANDROID_GLASS_USES_OPAQUE_FALLBACK | Reuse existing `GlassCard` surfaces verbatim; no new translucent Android fills | Existing glass gates; visual SC-9 |
| Anon-buyer routes OUTSIDE `(tabs)` (`feedback_anon_buyer_routes.md`) | Venue tab is founder-context INSIDE `(tabs)/hub/`; no buyer route touched | n/a (placement) |
| Hub nav-lock guard (META-ORCH-1059) | Preserve `_layout.tsx:148` guard + `:157` ordering when adding the venue branch | `hub-layout-nav-lock.test.ts` (must still PASS unmodified) |
| No dead taps | Venue tab renders real management UI at runtime | SC-3 + new contract test |
| **I-PROPOSED-1145-VENUE-TAB-CONDITIONAL** (DRAFT — flips ACTIVE on CLOSE) | `deriveHubVisibleTabs` includes `"venue"` iff `hasPhysicalLocation \|\| placePool` | §9 fails-on-revert test |

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy) | venue brand visibility | counts `{0,0,0}`, `hasPhysicalLocation=true` | `deriveHubVisibleTabs` returns `["venue"]` | unit (useHubTabs) |
| T-2 (happy) | placePool-only brand | counts `{0,0,0}`, `placePoolId="pp_1"` | returns `["venue"]` | unit |
| T-3 (edge) | online-only brand | counts `{2,0,0}`, no location/pool | returns `["events"]`, NO `"venue"` | unit |
| T-4 (edge) | mixed | counts `{1,1,1}`, `hasPhysicalLocation=true` | `["events","trips","experiences","venue"]` (order) | unit |
| T-5 (structural) | pill defined | source | `HubSubNav.tsx` `SUB_TABS` contains `{id:"venue",label:"Venue",route:"/(tabs)/hub/listing"}` | static |
| T-6 (structural) | active detection | `detectActiveSubTab("/(tabs)/hub/listing")` | returns `"venue"` | unit |
| T-7 (structural) | row removed | `BrandProfileView.tsx` source | does NOT contain `label: "Venue listing"` and does NOT contain `onListing` | static (fails-on-revert) |
| T-8 (structural) | route preserved | `app/brand/[id]/listing.tsx` source | contains a `Redirect` to `/(tabs)/hub/listing` (or renders `VenueListingContent`) — route is NOT 404 | static |
| T-9 (happy) | tab renders content | mount `hub/listing.tsx` with a venue brand | renders status badge / management UI, NOT a placeholder | component |
| T-10 (error) | no active brand | `useCurrentBrand()` → null | tab renders the "No listing yet / Add your venue" branch, no crash | component |
| T-11 (modified) | brand-page reachability re-point | `listing.orch_1040.test.ts` under `[TEST-MOD-APPROVED ORCH-1145]` | asserts Hub-tab reachability instead of the removed row | static |
| T-12 (preserve) | nav-lock | `hub-layout-nav-lock.test.ts` | still PASSES unmodified | static |

## 8. Implementation order

1. **`useHubTabs.ts`** — extend `HubTabName`, widen `deriveHubVisibleTabs` signature + venue append, update `pickHubInitialTab`/stored-tab guards. (Unit tests T-1..T-4 first.)
2. **`HubSubNav.tsx`** — extend `HubSubTabId`, `SUB_TABS`, `LABELS`, `ROUTES`, `detectActiveSubTab`. (T-5, T-6.)
3. **`src/components/venue/VenueListingContent.tsx`** — extract the listing body from `app/brand/[id]/listing.tsx`; add `chromeMode` + `focus` + `brandId` props; move `focus` source from route params to prop.
4. **`app/(tabs)/hub/listing.tsx`** — new content-only route; `useCurrentBrand()` → `brandId`; render `VenueListingContent chromeMode="tab"`; bottom padding `insets.bottom + 120`. (T-9, T-10.)
5. **`app/(tabs)/hub/_layout.tsx`** — compute venue flags from `currentBrand`; thread into visibility; add `/hub/listing → "venue"` branch in the redirect effect; PRESERVE the nav-lock guard + ordering. (T-12 must still pass.)
6. **`app/brand/[id]/listing.tsx`** — replace body with the redirect to `/(tabs)/hub/listing` (forward `?focus=feedback`; set active brand to route `id`). (T-8.) [Fallback: render `VenueListingContent chromeMode="page"` — only if redirect proves fragile; stop-and-amend.]
7. **`BrandProfileView.tsx`** — remove the row + `onListing` prop + `showVenueListing` (if now unused) + deps. (T-7.)
8. **`app/brand/[id]/index.tsx`** — remove `handleOpenListing` + the prop pass.
9. **`listing.orch_1040.test.ts`** — modify under `[TEST-MOD-APPROVED ORCH-1145]` to assert Hub-tab reachability. (T-11.)
10. Run the business jest suite + any strict-grep gates; confirm T-7/T-8 fail on revert.

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard 1 (row removal):** T-7 asserts `BrandProfileView.tsx` source contains NEITHER `label: "Venue listing"` NOR `onListing`. Reverting the row (re-adding the block/prop) makes T-7 FAIL; the move restored makes it PASS. Protective comment at the removed-row site’s replacement (in `operationsRows`): `// ORCH-1145 — venue listing moved to the Hub "Venue" tab; do NOT re-add a brand-page row (single doorway).`
- **Structural safeguard 2 (visibility gate):** T-3 asserts an online-only brand’s `deriveHubVisibleTabs` excludes `"venue"`; T-1/T-2 assert it includes `"venue"` for location/pool brands. Reverting the venue-append (or the condition) flips these → FAIL. This is the fails-on-revert test for **I-PROPOSED-1145-VENUE-TAB-CONDITIONAL**. Protective comment in `deriveHubVisibleTabs`: `// ORCH-1145 — Venue pill is conditional on hasPhysicalLocation || placePoolId (mirrors the retired brand-page gate). Purely-online brands never see it.`
- **Structural safeguard 3 (route not stranded):** T-8 asserts `/brand/[id]/listing` still resolves to the listing UI (redirect or render). Deleting the route file → FAIL.
- **Preserve gate:** `hub-layout-nav-lock.test.ts` stays green WITHOUT modification — proves the nav-lock guard survived.

## 10. Open questions

1. **Venue pill position** — SPEC places it LAST (rightmost peer). If Seth wants it leftmost or in a specific order relative to Events/Experiences/Trips, that is a one-line reorder in `SUB_TABS` + `deriveHubVisibleTabs` append site. Default = rightmost; confirm at REVIEW.
2. **Route-alias strategy** — SPEC recommends the §4.5 redirect (forwarding `?focus=feedback` + setting active brand). If IMPLEMENT hits a redirect loop or brand-switch race, fall back to rendering `VenueListingContent chromeMode="page"` at the route (no redirect). Implementor must stop-and-amend before choosing the fallback. No Seth input needed unless both prove problematic.
3. **Search-registry copy (Discovery #1)** — the `brand-public-listing` search entry is mislabeled "Public page" but routes to the founder listing. Out of scope for ORCH-1145; flagged for a future cleanup. Confirm we leave it (route still resolves via the alias).

## 11. Downstream routing

NEXT = **mingla-implementor (business side)**. Then mingla-tester (business iOS + Android + web-preview, with device/sim proof of SC-3/SC-5/SC-6/SC-8). Then mingla-orchestrator CLOSE (flip I-PROPOSED-1145-VENUE-TAB-CONDITIONAL → ACTIVE; reconcile World Map; the ORCH-1144 merge-order note in §"sequencing guard"). Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` on branch `ORCH-1145-venue-hub-tab`.

---

## Scoped allowlist (implementor may change ONLY these)

**Add:**
- `mingla-business/src/components/venue/VenueListingContent.tsx`
- `mingla-business/app/(tabs)/hub/listing.tsx`
- New unit/contract tests for T-1..T-10 (e.g. `src/hooks/__tests__/useHubTabs.venue.test.ts`, `app/(tabs)/hub/__tests__/venueTab.contract.test.ts`).

**Modify:**
- `mingla-business/src/hooks/useHubTabs.ts`
- `mingla-business/src/components/hub/HubSubNav.tsx`
- `mingla-business/app/(tabs)/hub/_layout.tsx`
- `mingla-business/app/brand/[id]/listing.tsx` (→ redirect, or `VenueListingContent` page-mode fallback)
- `mingla-business/src/components/brand/BrandProfileView.tsx` (remove row + prop)
- `mingla-business/app/brand/[id]/index.tsx` (remove handler + prop pass)
- `mingla-business/app/brand/[id]/__tests__/listing.orch_1040.test.ts` (under `[TEST-MOD-APPROVED ORCH-1145]`)

**Delete:** none (the old `listing.tsx` is repurposed, not deleted).

## DO-NOT-TOUCH (stop-and-amend before any edit)

- `mingla-business/src/components/brand/PublicBrandPage.tsx` + `src/services/publicEventsService.ts` (`PublicVenueDetail`) — buyer-facing, out of scope.
- `mingla-business/app/(tabs)/hub/experiences.tsx`, `events.tsx`, `trips.tsx`, `getstarted.tsx`, `index.tsx` — read as reference; do NOT edit (experiences.tsx is ORCH-1144's lane — F-7).
- `mingla-business/src/services/businessNotificationRouting.ts`, `src/lib/search/registry.ts`, `src/hooks/useBusinessTodos.ts` — they keep routing to `/brand/{id}/listing`; the route alias (§4.5) absorbs them. Do NOT repoint these in Phase 1 (avoids widening the diff; the alias is the contract).
- `mingla-business/src/types/brand.ts`, `currentBrandStore.ts` — `hasPhysicalLocation`/`placePoolId`/`Brand` re-export consumed as-is; no change.
- All venue data hooks (`useBrandPlacePipelineState`, `useBrandPlaceAuthoringContext`, `useVenueClaimFeedback`) — reused verbatim.
- Any DB / edge / migration / RLS — none in Phase 1.
- ANY OpenTable / reservation / availability / intelligence feature — Phase 2, not here.

## ORCH-1144 sequencing guard

ORCH-1144 (in-flight, branch `orch-1144-universal-experience-chooser`, NOT on origin/main) and ORCH-1145 are **DISJOINT** — proven by `git diff --name-only origin/main...HEAD` on the 1144 worktree (F-7): 1144 touches `app/(tabs)/hub/experiences.tsx` + experience routes + `UniversalCreatorSheet.tsx`; it does NOT touch `HubSubNav.tsx`, `useHubTabs.ts`, or `hub/_layout.tsx`. ZERO file overlap. **No merge conflict is expected.** Whoever merges to origin/main SECOND simply `git fetch origin && git rebase origin/main` — the rebase is mechanical (no shared hunks). The only shared concept is that both add things under `app/(tabs)/hub/`: 1145 adds a `venue` pill/route; 1144 changes the `experiences` tab CONTENT. Neither alters the other's pill or route. **Implementor action:** rebase onto origin/main immediately before final push; if 1144 has merged, confirm `experiences.tsx` is untouched by your diff (it must be) and proceed.
