# IMPLEMENTATION REPORT — ORCH-1145 — Move venue listing → Hub "Venue" tab (Phase 1: THE MOVE ONLY)

- **ORCH-ID:** ORCH-1145
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` on branch `ORCH-1145-venue-hub-tab`
- **Binding SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1145_VENUE_LISTING_TO_HUB_TAB.md`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1145_VENUE_LISTING_TO_HUB_TAB.md`
- **Commit (post-rebase onto origin/main):** `1e2a3badcee4d805922d2f422eb5c880c3444562`
- **Pre-rebase commit (fails-on-revert proofs taken here):** `e1452b42f3335bbc57e60237cf17b4848a543f53`
- **Mode:** IMPLEMENT (single pass; no deploy/merge/close).
- **Comms ledger:** read on entry. No OPEN BLOCK targets ORCH-1145, `mingla-implementor`, or `ALL`. COMMS-0029 (trip-migration clobber WARN) is unrelated to this code-only Hub-tab change. No new cross-ORCH discovery to write.

---

## 1. What shipped (matches SPEC §4 + §8 implementation order)

A pure code-layer relocation. NO DB / edge / service / RLS / migration / buyer-web / consumer change.

1. **`src/hooks/useHubTabs.ts`** — `HubTabName` union += `"venue"`; new `HubVenueVisibility` input type; `deriveHubVisibleTabs(counts, venue)` now appends `"venue"` LAST iff `venue.hasPhysicalLocation || venue.hasPlacePool` (rightmost peer, SPEC §4.1 / §10 Q1 default); `pickHubInitialTab` stored-tab guard += `"venue"`; `useHubVisibleTabs(brandId, venue)` widened (default keeps counts-only callers valid; no second brand fetch). Protective comment on the venue-append site (SPEC §9 safeguard 2).
2. **`src/components/hub/HubSubNav.tsx`** — `HubSubTabId` += `"venue"`; `SUB_TABS` += `{ id:"venue", label:"Venue", route:"/(tabs)/hub/listing" }` (last); `LABELS`/`ROUTES` += venue; `detectActiveSubTab` maps `/hub/listing → "venue"` before the `events` default. (Venue pill renders bare "Venue" — no count is passed for it.)
3. **`src/components/venue/VenueListingContent.tsx`** (NEW) — the venue-listing management body extracted verbatim from the old `app/brand/[id]/listing.tsx` (ORCH-1040), made route-agnostic: props `{ brandId: string|null; focus?: "feedback"; chromeMode: "tab"|"page" }`. `focus` moved from `useLocalSearchParams` to a prop. `chromeMode="tab"` suppresses the header/back (layout owns chrome) and pads the ScrollView by `insets.bottom + 120` (nav-lock companion pin); `chromeMode="page"` keeps the page header + back (alias fallback safety). All data hooks + handlers (`handleAddVenue`/`handleEdit`/`handleViewPublic`, feedback sheet, Toast) reused as-is. Same `GlassCard` surfaces (Android opaque-glass policy inherited, unchanged).
4. **`app/(tabs)/hub/listing.tsx`** (NEW) — content-only Hub tab. Resolves active brand via `useCurrentBrand()` → `brandId` (NO route param); reads the forwarded `?focus=feedback`; renders `<VenueListingContent brandId chromeMode="tab" focus />`. No dead tap — renders the real management UI at runtime.
5. **`app/(tabs)/hub/_layout.tsx`** — memoizes `venueVisibility = { hasPhysicalLocation: currentBrand?.hasPhysicalLocation === true, hasPlacePool: currentBrand?.placePoolId != null }` from the already-resolved `currentBrand` (no second fetch); threads it into `useHubVisibleTabs`; adds a `/hub/listing → "venue"` branch in the visible-tab redirect effect. **PRESERVED EXACTLY** the nav-lock guard `if (!activePath.includes("/hub/")) return;` and its position before `router.replace` (SPEC §4.6; `hub-layout-nav-lock.test.ts` green + unmodified).
6. **`app/brand/[id]/listing.tsx`** — converted to a thin `<Redirect href="/(tabs)/hub/listing[?focus=feedback]" />` (SPEC §4.5 PRIMARY path). Sets the active brand to the route `id` via `setCurrentBrandId` in a `useEffect` guarded against a set-loop (`brandId !== currentBrandId`); forwards `?focus=feedback`. Route NOT deleted — kept for the four non-row navigators (to-do rows, home cards, push deep-links, global search, F-1). The §4.5 fallback (page-render) was NOT needed: no redirect loop / brand-switch race observed; the guarded set + the auto-clear-invalid-id recovery (F-4) made the primary redirect clean.
7. **`src/components/brand/BrandProfileView.tsx`** — removed the `onListing` prop (type + docblock + destructure + deps), the `showVenueListing` constant, and the `if (showVenueListing) rows.push({ label:"Venue listing" ... })` block. Protective comment at the removed-row site (SPEC §9 safeguard 1). All other Operations rows untouched.
8. **`app/brand/[id]/index.tsx`** — removed `handleOpenListing` + the `onListing={handleOpenListing}` prop pass; left a `[TRANSITIONAL-free]` explanatory comment.
9. **`app/brand/[id]/__tests__/listing.orch_1040.test.ts`** — modified under `[TEST-MOD-APPROVED ORCH-1145]` (token present): management-data assertions re-pointed to the extracted `VenueListingContent`; the brand-page-row reachability assertion re-pointed to (a) row+`onListing` REMOVED, (b) Hub-tab reachability, (c) route-preserved-as-redirect.
10. **`app/(tabs)/hub/__tests__/venueTab.contract.test.ts`** (NEW) — source-contract gate for T-1..T-10 (the node/ts-jest harness has no RN renderer; importing `useHubTabs` pulls AuthContext→RN JSX, so the established source-pin pattern from `hub-layout-nav-lock.test.ts` / `listing.orch_1040.test.ts` is used).

---

## 2. Changed files + commit hash

All 10 files committed at `1e2a3badcee4d805922d2f422eb5c880c3444562` (post-rebase). `git diff --name-only origin/main...HEAD`:

| File | Type |
|------|------|
| `mingla-business/src/hooks/useHubTabs.ts` | modify |
| `mingla-business/src/components/hub/HubSubNav.tsx` | modify |
| `mingla-business/src/components/venue/VenueListingContent.tsx` | **add** |
| `mingla-business/app/(tabs)/hub/listing.tsx` | **add** |
| `mingla-business/app/(tabs)/hub/_layout.tsx` | modify |
| `mingla-business/app/(tabs)/hub/__tests__/venueTab.contract.test.ts` | **add** |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | modify |
| `mingla-business/app/brand/[id]/index.tsx` | modify |
| `mingla-business/app/brand/[id]/listing.tsx` | modify (→ redirect) |
| `mingla-business/app/brand/[id]/__tests__/listing.orch_1040.test.ts` | modify `[TEST-MOD-APPROVED ORCH-1145]` |

Exactly the SPEC "Scoped allowlist". No file outside the allowlist touched. No DO-NOT-TOUCH file edited (`experiences.tsx`, `PublicBrandPage`, `businessNotificationRouting`, `lib/search/registry`, `useBusinessTodos`, `brand.ts`, `currentBrandStore.ts`, venue data hooks — all untouched).

---

## 3. Gate results

| Gate | Result |
|------|--------|
| `venueTab.contract.test.ts` (T-1..T-10 + layout + redirect pins) | **PASS** |
| `listing.orch_1040.test.ts` (modified, `[TEST-MOD-APPROVED ORCH-1145]`) | **PASS** |
| `hub-layout-nav-lock.test.ts` (preserved, UNMODIFIED) | **PASS** |
| Combined run | **3 suites / 22 tests, all PASS** |
| `tsc --noEmit -p tsconfig.json` — errors in any ORCH-1145 file | **ZERO** (pre-existing repo-wide tsc noise in `packages/*`, checkout, marketing etc. is unrelated and present on baseline) |
| `eslint` on all 10 touched files | **0 errors** (the one `useMemo` exhaustive-deps warning I introduced is suppressed with a justified `eslint-disable-next-line` — primitive deps over object identity, layout memoizes; the `HubSubNav` `radius` unused warning is pre-existing on origin/main, unchanged) |

**Pre-existing failures (NOT my regression), confirmed by stashing my edits and re-running:** `src/hooks/__tests__/orch1004AllowlistIntegrity.test.ts` and `src/hooks/__tests__/brandListState.test.ts` fail identically on the worktree baseline with my changes removed. They pin source strings in `useCurrentBrand`/`brandList`/allowlist files I never touched. Flagged for the orchestrator; out of ORCH-1145 scope.

---

## 4. Fails-on-revert proof (SPEC §9 — all three safeguards)

Proven at commit `e1452b42f3335bbc57e60237cf17b4848a543f53` (pre-rebase content-identical to the final commit) by reverting individual files to their `origin/main` versions and re-running `venueTab.contract.test.ts`:

- **Safeguard 1 (row removal) + Safeguard 3 (route preserved):** revert `BrandProfileView.tsx` + `brand/[id]/listing.tsx` to origin/main → **T-7 FAILS** ("BrandProfileView has NO Venue listing row and NO onListing prop") and **T-8 FAILS** ("route preserved as a redirect"). Other 10 tests stay green. Restored → all 12 PASS.
- **Safeguard 2 (visibility gate = I-PROPOSED-1145-VENUE-TAB-CONDITIONAL):** revert `useHubTabs.ts` to origin/main → **T-1/T-2/T-3 FAILS**, **T-4 FAILS**, **HubTabName-union test FAILS** (3 failed / 9 passed). Restored → all PASS.

T-7/T-8 are the SPEC/handoff-designated happy-path fails-on-revert tests; both verified failing on revert at the cited commit.

---

## 5. SPEC compliance + constitution

- **No dead taps:** the Venue tab renders the real `VenueListingContent` at runtime (T-9), not a stub.
- **Android opaque-glass:** reuses the existing `GlassCard` surfaces verbatim; no new translucent Android fills.
- **No fabricated data / currency:** management surface shows status/scores/photos + categorical price tiers (Chill/Comfy/Bougie/Lavish) — no currency amounts, no `?? fallback` display fabrication.
- **Active-brand resolution:** Hub tab uses `useCurrentBrand()` (no route param) → SC-4 brand-switch correctness holds by construction.
- **Deep-link forwarding:** alias forwards `?focus=feedback`; the tab reads it and passes to `VenueListingContent` → SC-7 feedback auto-open preserved.
- **Nav-lock:** guard line + ordering preserved exactly → SC-8; `hub-layout-nav-lock.test.ts` green and unmodified.
- **`[TEST-MOD-APPROVED ORCH-1145]`** token present in the one modified test.
- **ORCH-1144 disjointness:** `experiences.tsx` confirmed untouched in my diff; rebase onto origin/main was mechanical (zero conflicts), confirming F-7.

---

## 6. Spec ambiguity hit

None material. Two SPEC open questions resolved per the SPEC's own defaults:
- **§10 Q1 (pill position):** shipped LAST (rightmost peer) per the SPEC default. One-line reorder if Seth wants otherwise — confirm at REVIEW.
- **§10 Q2 (route-alias strategy):** shipped the §4.5 PRIMARY redirect (no fallback needed — no loop/race observed).
- **§10 Q3 (search-registry "Public page" mislabel):** left as-is per SPEC (out of scope; route still resolves via the alias).

---

## 7. Downstream

NEXT = **mingla-tester** (business iOS + Android + web-preview; device/sim proof of SC-3/SC-4/SC-5/SC-6/SC-7/SC-8). Then **mingla-orchestrator CLOSE** (flip `I-PROPOSED-1145-VENUE-TAB-CONDITIONAL` → ACTIVE; reconcile World Map; ORCH-1144 merge-order note). Did NOT deploy, merge, or close.
