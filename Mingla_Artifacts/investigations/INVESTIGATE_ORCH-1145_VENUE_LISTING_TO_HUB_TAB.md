# INVESTIGATION — ORCH-1145 — Move venue listing from brand page → a Hub "Venue" tab (Phase 1: THE MOVE ONLY)

- **ORCH-ID:** ORCH-1145
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1145-[venue-hub-tab]/` on branch `ORCH-1145-venue-hub-tab` (rebased; 0 behind / 0 ahead of origin/main at investigation time)
- **Mode:** INVESTIGATE (no fix proposed; SPEC is a sibling file)
- **Phase:** 1 = relocation only. No OpenTable / reservation / availability / intelligence work (that is a future Phase 2).
- **Surfaces in scope:** business iOS + business Android + business web preview. NOT consumer, NOT buyer-anon web, NOT admin web.
- **Comms ledger:** read on entry. No OPEN BLOCK row targets ORCH-1145, `mingla-forensics`, or `ALL`. (COMMS-0006 is BLOCK+OPEN but scoped to ORCH-0980, a long-closed unrelated item; COMMS-0030 iOS-build is RESOLVED.) No new cross-ORCH discovery requiring a ledger write — see the ORCH-1144 finding (F-7), which is a *coordination* note, not a clobber.

---

## Symptom summary (this is a feature relocation, not a bug)

**Expected (Seth's request):** The venue-listing management surface — today reached only from a row on the founder Brand profile page — should live as a peer tab labeled **"Venue"** inside the Hub, alongside Events / Experiences / Trips. The brand-page row should be removed (a true move, single doorway). Tab visibility is conditional: shown only for brands with a physical location or a linked venue.

**Actual today:** The venue-listing management page `app/brand/[id]/listing.tsx` is reachable ONLY by navigating into a specific brand (`/brand/{id}`) and tapping the "Venue listing" Operations row. The Hub has exactly three pills (Events / Experiences / Trips) and no venue surface.

This investigation establishes the precise current entry-point + navigation graph, the Hub pill + visibility mechanics, the active-brand resolution path, web-preview parity, and the ORCH-1144 collision reality — so the SPEC can specify the move without stranding any caller.

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/components/brand/BrandProfileView.tsx` | The Operations row + `onListing` prop + `showVenueListing` gate. |
| 2 | `mingla-business/app/brand/[id]/index.tsx` | Route file that supplies `onListing={handleOpenListing}` → `router.push('/brand/{id}/listing')`. |
| 3 | `mingla-business/app/brand/[id]/listing.tsx` | The management page itself (data hooks, internal chrome). |
| 4 | `mingla-business/src/components/hub/HubSubNav.tsx` | Shared pill source of truth (`HubSubTabId`, `SUB_TABS`, `LABELS`, `ROUTES`, `detectActiveSubTab`). |
| 5 | `mingla-business/src/hooks/useHubTabs.ts` | `HubTabName`, `deriveHubVisibleTabs`, `useHubVisibleTabs`, init-tab logic. |
| 6 | `mingla-business/app/(tabs)/hub/_layout.tsx` | Hub shell — owns chrome, brand resolution, the visible-tab redirect effect. |
| 7 | `mingla-business/app/(tabs)/hub/index.tsx` | Index redirect → `/(tabs)/hub/events`. |
| 8 | `mingla-business/app/(tabs)/hub/events.tsx` | Reference sub-route render pattern (content-only). |
| 9 | `mingla-business/src/hooks/useCurrentBrand.ts` | The active-brand resolution mechanism (finding #4). |
| 10 | `mingla-business/src/store/currentBrandStore.ts` | `currentBrandId` pointer + `Brand` re-export. |
| 11 | `mingla-business/src/types/brand.ts` | `hasPhysicalLocation` / `placePoolId` venue fields. |
| 12 | `mingla-business/src/hooks/useBrandOfferingCounts.ts` | Data source feeding `deriveHubVisibleTabs` today. |
| 13 | `mingla-business/src/hooks/useBusinessTodos.ts` | A SECOND navigator to `/brand/{id}/listing`. |
| 14 | `mingla-business/src/services/businessNotificationRouting.ts` | Push deep-link targets to `/brand/{id}/listing`. |
| 15 | `mingla-business/src/lib/search/registry.ts` | Global-search entry to `/brand/{id}/listing`. |
| 16 | `mingla-business/app/(tabs)/hub/__tests__/hub-layout-nav-lock.test.ts` | Source-pins on `_layout.tsx` 1145 must preserve. |
| 17 | `mingla-business/app/brand/[id]/__tests__/listing.orch_1040.test.ts` | The one test that pins the brand-page Operations row. |
| 18 | `Mingla_Artifacts/specs/SPEC_ORCH-1144_*.md` + 1144 worktree `git diff` | Collision analysis. |

---

## Q-scorecard

### Q1 — What is the complete current entry-point + navigation graph for the venue listing? Every `onListing` caller and every navigator to `/brand/[id]/listing`.
**Verdict (proven, source-traced):** ONE UI entry point via `onListing`, but **FIVE distinct production navigators** to the `/brand/{id}/listing` route. Removing only the brand-page row strands the other four unless the route is preserved. See F-1.

### Q2 — How are the Hub pills defined/rendered, and how does `deriveHubVisibleTabs` decide visibility today?
**Verdict (proven):** Pills are defined in the shared `HubSubNav.tsx` (`HubSubTabId` union, `SUB_TABS` array, `LABELS`/`ROUTES` maps, `detectActiveSubTab`). Visibility is computed by `deriveHubVisibleTabs(counts)` in `useHubTabs.ts`, which reads ONLY `BrandOfferingCounts` (events/trips/experiences counts) — it has NO access to brand venue fields today. See F-2.

### Q3 — What is the expo-router pattern for adding a new `app/(tabs)/hub/` sub-route?
**Verdict (proven):** A new content-only `.tsx` file under `app/(tabs)/hub/`. The shell (`_layout.tsx`) renders chrome (TopBar + To-Do toggle + `HubSubNav`) then `<Slot />`. `index.tsx` is an explicit `<Redirect href="/(tabs)/hub/events" />` to force a deterministic landing. Sub-routes render NO TopBar/header of their own. See F-3.

### Q4 (CRITICAL) — How is the active brand id obtained inside the Hub, so the new `/hub/listing` tab targets the correct brand WITHOUT a route param?
**Verdict (proven):** Via `useCurrentBrand()` (which reads `currentBrandId` from the Zustand `currentBrandStore` and fetches the live `Brand` via React Query). The Hub `_layout.tsx` calls `useCurrentBrand()` at line 72; every sub-route (e.g. `events.tsx:157`) calls `useCurrentBrand()` directly too. The new tab resolves the brand id as `useCurrentBrand()?.id ?? null` — NO route param. All listing-page data hooks already accept `brandId: string | null`. See F-4.

### Q5 — Does `listing.tsx` have a web variant, and will the move keep web working?
**Verdict (proven):** NO `.web.tsx` variant exists; `listing.tsx` is a single cross-platform RN file. The Hub already renders on web (`_layout.tsx` has a `Platform.OS === "web"` branch). The listing page uses only cross-platform primitives. Web parity is therefore AUTOMATIC via shared code. See F-5.

### Q6 — Which existing tests does the move break, and what test-mod tokens are needed?
**Verdict (proven):** Exactly one test pins the brand-page row: `app/brand/[id]/__tests__/listing.orch_1040.test.ts` (asserts `label: "Venue listing"`, `onListing(brand.id)`, `onListing={handleOpenListing}`). It will fail when the row is removed → requires `[TEST-MOD-APPROVED ORCH-1145]`. The nav-lock test `hub-layout-nav-lock.test.ts` pins `_layout.tsx` lines that 1145 must PRESERVE (not modify away). No test imports/pins `SUB_TABS` length. See F-6.

### Q7 — ORCH-1144 collision: does it actually edit `HubSubNav.tsx` SUB_TABS / `HubSubTabId` / the Experiences tab in a way that overlaps ORCH-1145?
**Verdict (proven — the dispatch's premise was incorrect):** ORCH-1144 does NOT touch `HubSubNav.tsx`, `useHubTabs.ts`, or `hub/_layout.tsx`. Its actual changed-file set (worktree `git diff origin/main...HEAD`) rebuilds `app/(tabs)/hub/experiences.tsx` content + adds experience chooser/snap routes + edits `UniversalCreatorSheet.tsx`. The two ORCHs are **DISJOINT at the Hub-nav layer** — ZERO shared files. See F-7.

---

## Findings (six-field evidence)

### F-1 — ONE `onListing` UI entry, FIVE production navigators to `/brand/{id}/listing` (CONFIRMED ROOT-OF-GRAPH)
- **Symptom:** Removing the brand-page row alone would strand the To-Do rows, push deep-links, and global search that also route to `/brand/{id}/listing`.
- **Layer:** code.
- **Probe:** `grep -rn "onListing"` + `grep -rn` for `/brand/.../listing` route construction across `mingla-business/{src,app}` (non-test).
- **Evidence (verbatim, file:line):**
  - `src/components/brand/BrandProfileView.tsx:198` `onListing: (brandId: string) => void;` (prop); `:405-415` the conditional row (`label: "Venue listing"`, `onPress: () => { if (brand !== null) onListing(brand.id); }`), gated by `showVenueListing` (`:399-401` = `brand?.hasPhysicalLocation === true || (brand?.placePoolId !== undefined && brand.placePoolId !== null)`).
  - `app/brand/[id]/index.tsx:142-144` `const handleOpenListing = (brandId) => { router.push(\`/brand/${brandId}/listing\` as never); };` and `:199` `onListing={handleOpenListing}`.
  - **Navigator #2 — To-Do system:** `src/hooks/useBusinessTodos.ts:159` `currentBrand !== null ? \`/brand/${currentBrand.id}/listing\` : ""` (`venueListingRoute`) and `:163` `\`/brand/${currentBrand.id}/listing?focus=feedback\`` (`venueFeedbackRoute`). These feed the smart To-Do rows surfaced on Home AND in the Hub `_layout.tsx` To-Do toggle, and the home cards `NoVenueDeckEntryCard` / `DeckReadinessCard` (per their tests).
  - **Navigator #3 — push deep-links:** `src/services/businessNotificationRouting.ts:83` `if (sub === "listing") return \`/brand/${brandId}/listing\`;` (parses `mingla-business://brand/{brandId}/listing` for `new_review`, `claim_decision`) and `:158` `case "business.claim_decision": return brandId ? \`/brand/${brandId}/listing\` : ACCOUNT_FALLBACK;`.
  - **Navigator #4 — global search:** `src/lib/search/registry.ts:135` `route: \`/brand/${BRAND_ID_TOKEN}/listing\`` (entry `brand-public-listing`, titled "Public page" — a copy mismatch noted as a Discovery).
  - **Doc-only ref:** `src/components/brand/VenueClaimStatusBanner.tsx:12` (comment referencing `app/brand/[id]/listing.tsx`).
- **Mechanism:** The route `/brand/[id]/listing` is a shared destination reached by five paths. The dispatch's "single doorway" goal (decision b) applies to the *brand-page entry row* only; the route itself is a deep-link / push / search / to-do target and cannot be deleted without breaking notifications + search + the deck-readiness to-do loop.
- **Severity:** CONFIRMED ROOT CAUSE (of the route-fate decision) — proves the standalone route MUST be preserved (as a redirect or kept page); see SPEC §"Route fate".

### F-2 — Hub pills are defined in `HubSubNav.tsx`; visibility derives from offering COUNTS only (CONFIRMED)
- **Symptom:** To add a conditional "Venue" pill, both the pill definition AND the visibility gate must change, and the gate must gain access to brand venue fields it does not read today.
- **Layer:** code.
- **Probe:** Read `HubSubNav.tsx` + `useHubTabs.ts` in full.
- **Evidence (verbatim):**
  - `HubSubNav.tsx:31` `export type HubSubTabId = "events" | "experiences" | "trips";` and `:32` `export type HubDataDrivenTabId = HubSubTabId | "getstarted";`
  - `:40-44` `const SUB_TABS = [ {id:"events",...}, {id:"experiences",...}, {id:"trips",...} ];`
  - `:46-51` `LABELS` map; `:53-58` `ROUTES` map; `:60-66` `detectActiveSubTab(pathname)` (string `includes` matching, defaulting to `"events"`).
  - `useHubTabs.ts:9` `export type HubTabName = "getstarted" | "events" | "trips" | "experiences";`
  - `:19-31` `deriveHubVisibleTabs(counts: BrandOfferingCounts)` pushes `events`/`trips`/`experiences` iff the respective count `> 0`. It receives ONLY `BrandOfferingCounts` (`useBrandOfferingCounts.ts:6-10` = `{events, trips, experiences}` numbers). No brand object, no `hasPhysicalLocation`/`placePoolId`.
  - `_layout.tsx:74` `const visibleTabs = useHubVisibleTabs(currentBrand?.id ?? null);` and `:226-235` passes `visibleTabs.data` + counts into `<HubSubNav>`.
- **Mechanism:** Adding "Venue" requires: (a) extend the `HubSubTabId`/`HubTabName` unions + `SUB_TABS` + `LABELS` + `ROUTES` + `detectActiveSubTab`; (b) extend visibility so the Venue pill appears iff the active brand's `hasPhysicalLocation || placePoolId`. Because `deriveHubVisibleTabs` takes only counts, the venue flags must be threaded in (signature widened, or computed in `_layout.tsx` and appended). The SPEC chooses the exact data path.
- **Severity:** CONFIRMED ROOT CAUSE (of the visibility wiring).

### F-3 — expo-router hub sub-route pattern (CONFIRMED)
- **Symptom:** N/A (mechanism finding).
- **Layer:** code.
- **Probe:** Read `_layout.tsx`, `index.tsx`, `events.tsx`.
- **Evidence (verbatim):**
  - `_layout.tsx:193-240` renders `<View>` host → `<TopBar>` (brand chip + universal "+" creator) → `<BusinessTodoToggle>` → `<HubSubNav .../>` → `<Slot />`. The shell owns ALL chrome.
  - `index.tsx:16-18` `return <Redirect href="/(tabs)/hub/events" />;` (deterministic landing; comment at `:1-11` explains FS-order nondeterminism without it).
  - `events.tsx:573-578` docblock: "TopBar and 'Events' header title are owned by hub/_layout.tsx ... This sub-route is a content-only screen — paddingTop and brand/universal-creator chrome are layout-supplied." Confirmed: `trips.tsx` renders no TopBar/back (grep empty).
- **Mechanism:** The new `app/(tabs)/hub/listing.tsx` must be content-only and must NOT render a header/back of its own. The existing `app/brand/[id]/listing.tsx` DOES render its own header + back button (`listing.tsx:204-215`, `handleBack` `:144-147`) — so the tab variant must suppress that internal chrome (it would be a redundant back button inside a tab). This is the central adaptation the SPEC must specify.
- **Severity:** CONFIRMED ROOT CAUSE (of the new-file shape).

### F-4 (CRITICAL) — Active brand id inside the Hub = `useCurrentBrand()`, no route param (CONFIRMED)
- **Symptom:** Today's page is brand-id-parameterized (`/brand/[id]/listing`); the Hub is not. The new tab needs the brand id WITHOUT a param.
- **Layer:** code.
- **Probe:** Read `useCurrentBrand.ts` + the Hub `_layout.tsx`/`events.tsx` usage + `currentBrandStore.ts`.
- **Evidence (verbatim):**
  - `useCurrentBrand.ts:40-75` `export const useCurrentBrand = (): Brand | null => { ... const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId); const { data: brand } = useBrand(isAuthReady ? currentBrandId : null); ... return brand ?? null; };`
  - `_layout.tsx:72` `const currentBrand = useCurrentBrand();`
  - `events.tsx:157` `const currentBrand = useCurrentBrand();` (sub-route precedent).
  - `currentBrandStore.ts:201` `export const useCurrentBrandId = (): string | null => ...` (raw pointer also available).
  - Listing-page hooks all accept null: `useBrandPlacePipelineState.ts:23` `(brandId: string | null)`, `:33-34` `useBrandPlaceAuthoringContext(brandId: string | null, ...)`, `useVenueClaimFeedback.ts:173-174` `useVenueClaimOpenCount(brandId: string | null, ...)`. `useBrand` accepts null too.
- **Mechanism:** The new `hub/listing.tsx` calls `const brand = useCurrentBrand();` → `const brandId = brand?.id ?? null;` and feeds that to the existing listing hooks — byte-identical data path to today, minus the route param. No param plumbing, no deep-link change needed for the tab itself.
- **Severity:** CONFIRMED ROOT CAUSE (answers the key wiring question).

### F-5 — No web variant; web parity automatic (CONFIRMED)
- **Symptom:** N/A.
- **Layer:** code.
- **Probe:** `ls app/brand/[id]/` (only `listing.tsx`, no `listing.web.tsx`); `ls app/(tabs)/hub/` (no `.web.tsx` sub-routes).
- **Evidence:** `app/brand/[id]/` contains a single `listing.tsx` (19056 bytes), no `.web` sibling. The Hub directory has no `.web.tsx` sub-routes. `_layout.tsx:198` `paddingTop: insets.top + (Platform.OS === "web" ? spacing.sm : 0)` proves the Hub renders on web. `listing.tsx` uses only `View/ScrollView/Text/Pressable/ActivityIndicator/GlassCard/EventCoverMedia/Button/Icon/Toast` — all cross-platform.
- **Mechanism:** A single cross-platform `hub/listing.tsx` (no `.web.tsx`) ships to iOS, Android, and web preview identically.
- **Severity:** RULED OUT (no web-specific work required); a `.web.tsx` is NOT needed.

### F-6 — Exactly one breaking test; one preservation-constraint test (CONFIRMED)
- **Symptom:** CI gates must stay green.
- **Layer:** code (tests).
- **Probe:** `grep -rln "onListing"`, `grep -rln "Venue listing"`, `grep -rln "SUB_TABS"` across test files; read `hub-layout-nav-lock.test.ts`.
- **Evidence:**
  - BREAKS: `app/brand/[id]/__tests__/listing.orch_1040.test.ts:46-51` asserts `PROFILE).toContain('label: "Venue listing"')`, `toContain("onListing(brand.id)")`, `ROUTE).toContain("onListing={handleOpenListing}")`. Removing the row + prop fails these → `[TEST-MOD-APPROVED ORCH-1145]` required (re-point assertions to the Hub-tab reachability).
  - PRESERVE: `hub-layout-nav-lock.test.ts:40` pins `/if\s*\(\s*!activePath\.includes\(["']\/hub\/["']\)\s*\)\s*return/` and `:43-49` pins guard-precedes-`router.replace` ordering in `_layout.tsx`. 1145 edits `_layout.tsx` (to thread venue visibility) but MUST keep that guard line + ordering intact.
  - No test imports `SUB_TABS` or asserts a fixed pill count (grep empty) → adding a 4th pill breaks no pinned-length test.
- **Mechanism:** The move requires precisely one approved test modification; everything else is preserved.
- **Severity:** SECONDARY ROOT CAUSE (test-gate impact).

### F-7 — ORCH-1144 is DISJOINT at the Hub-nav layer (CONFIRMED — dispatch premise corrected)
- **Symptom:** The dispatch warned ORCH-1144 "ALSO edits HubSubNav.tsx SUB_TABS + HubSubTabId union + the Experiences tab," implying a merge conflict.
- **Layer:** code (cross-ORCH).
- **Probe:** Read `Mingla_Artifacts/specs/SPEC_ORCH-1144_*.md` allowlist; ran `git diff --name-only origin/main...HEAD` in the 1144 worktree `/Users/sethogieva/Desktop/mingla-orchs/orch-1144-[universal-experience-chooser]` (branch `orch-1144-universal-experience-chooser`); grepped that diff for `HubSubNav|useHubTabs|hub/_layout`.
- **Evidence (verbatim — 1144 changed files vs origin/main):**
  ```
  mingla-business/app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts
  mingla-business/app/(tabs)/hub/experiences.tsx
  mingla-business/app/experience/__tests__/orch1144Chooser.tester.adversarial.test.ts
  mingla-business/app/experience/choose.tsx
  mingla-business/app/experience/coming-soon.tsx
  mingla-business/app/experience/snap.tsx
  mingla-business/src/components/experience/ExperienceCreateChooser.tsx
  mingla-business/src/components/ui/UniversalCreatorSheet.tsx
  mingla-business/src/utils/{__tests__/,}canGenerateExperiencesFrom{Menu,Activities}.ts
  ```
  Grep of that diff for `HubSubNav|useHubTabs|hub/_layout` → `NONE — disjoint`. The 1144 SPEC allowlist ("Modify") lists only `experiences.tsx`, `UniversalCreatorSheet.tsx`, `hubExperiences.contract.test.ts`; and DO-NOT-TOUCH explicitly says `events.tsx, trips.tsx` are "parity reference — read, never edit." It does NOT mention `HubSubNav.tsx` or `useHubTabs.ts` at all.
- **Mechanism:** ORCH-1145 touches `HubSubNav.tsx`, `useHubTabs.ts`, `hub/_layout.tsx`, NEW `hub/listing.tsx`, `BrandProfileView.tsx`, `brand/[id]/index.tsx`. ORCH-1144 touches `experiences.tsx` content + experience routes + `UniversalCreatorSheet.tsx`. The file sets are DISJOINT — no overlapping line, no merge conflict at the nav layer. The only theoretical brush point is that BOTH live under `app/(tabs)/hub/` and both rely on the same `<HubSubNav>` rendering `experiences`; but 1145 only ADDS a `venue` pill/route (it does not alter the `experiences` pill or route), and 1144 only changes the experiences-tab CONTENT (it does not alter the pill set). Whoever merges second rebases trivially.
- **Severity:** RULED OUT (as a blocking collision) — downgraded to a light sequencing note (SPEC §"ORCH-1144 sequencing guard").

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | MEMORY + dispatch describe a "single doorway" move + conditional visibility mirroring the brand-page row. Dispatch ALSO claimed an ORCH-1144 HubSubNav overlap. | **CONTRADICTION (resolved):** the ORCH-1144 overlap claim is FALSE per the actual 1144 diff (F-7). Code/diff is truth; the dispatch's Explore-pass assumption is corrected. |
| **Schema** | `brands.hasPhysicalLocation` (bool, DB default false) + `brands.place_pool_id` exist; surfaced on the `Brand` type (`brand.ts` `hasPhysicalLocation` ~line 333, `placePoolId`). No schema change needed for Phase 1. | None. |
| **Code** | Pills in `HubSubNav.tsx`; visibility from counts in `useHubTabs.ts`; active brand via `useCurrentBrand()`; listing page param-driven today but hooks accept `brandId|null`. | None internal. The brand-page `showVenueListing` gate (`BrandProfileView.tsx:399-401`) is the exact predicate to mirror onto the Venue pill (decision a). |
| **Runtime** | Not live-fired — this is a relocation feature, not a reproducer-bound bug; per Prime Directive 7 exemption (no described UI bug with a reproducer). Confidence on mechanism is source-proven via full file reads + the 1144 worktree diff. | None. |
| **Data** | No DB read needed; the gate uses fields already on the in-memory `Brand`. | None. |

---

## Repro evidence

Not a bug — no reproducer to run. This is a forward-looking relocation. All conclusions are source-proven (every relevant file read verbatim) and the cross-ORCH finding is proven by an actual `git diff` of the live ORCH-1144 worktree. Confidence = **proven** for the navigation graph, the active-brand resolution, the web verdict, and the ORCH-1144 disjointness; **proven** for the single test-mod requirement.

---

## Blast radius / cross-surface map

| Surface | In scope? | Effect |
|---------|-----------|--------|
| Business iOS | YES | New Venue Hub pill (conditional); brand-page row removed; route preserved as alias. |
| Business Android | YES | Same (shared RN code; honor opaque-glass policy on any glass surface — the listing page already uses `GlassCard`, unchanged). |
| Business web preview | YES | Automatic via shared code; no `.web.tsx` (F-5). |
| Consumer iOS/Android | NO | Untouched — different app. |
| Buyer/anon web | NO | `PublicBrandPage.tsx` + `PublicVenueDetail` are independent buyer surfaces; out of scope, not edited. |
| Admin web | NO | Untouched. |

**Cross-cutting consumers of the `/brand/{id}/listing` route that the move must NOT strand (F-1):** to-do rows (`useBusinessTodos`), home cards (`NoVenueDeckEntryCard`, `DeckReadinessCard`), push deep-links (`businessNotificationRouting`), global search (`lib/search/registry`). These keep working IF the route is preserved (SPEC recommends a thin redirect to the Hub tab OR keeping the page as-is).

---

## Invariant impact

- **ANDROID_GLASS_USES_OPAQUE_FALLBACK** — preserve. The Venue tab reuses the existing `GlassCard` surfaces from `listing.tsx` (already compliant); no new translucent Android fills.
- **Anon-buyer routes live OUTSIDE `(tabs)`** (`feedback_anon_buyer_routes.md`) — preserve. The Venue tab is a founder-context surface INSIDE `(tabs)/hub/` — correct placement; no buyer route touched.
- **No dead taps** — the new tab MUST render the management UI at runtime (not a placeholder). Pre-stage a DRAFT invariant for venue-tab visibility correctness.
- **No fabricated data / currency-aware** — the listing page shows status/scores/photos; price tiers are categorical labels (Chill/Comfy/Bougie/Lavish), not currency amounts, so no currency formatting is in play on this surface. No `?? fallback` display fabrication introduced.
- **Hub nav-lock guard** (pinned by `hub-layout-nav-lock.test.ts`) — preserve the `!activePath.includes("/hub/")` early-return + guard-before-`router.replace` ordering when threading venue visibility into `_layout.tsx`.

Proposed DRAFT invariant (SPEC owns the final wording): **I-PROPOSED-1145-VENUE-TAB-CONDITIONAL** — the Venue Hub pill renders iff the active brand has `hasPhysicalLocation === true || placePoolId != null`; purely-online brands never see it. Fails-on-revert test asserts `deriveHubVisibleTabs` (or its venue extension) excludes `venue` for a no-location/no-pool brand and includes it otherwise.

---

## Discoveries for Orchestrator (side issues — do NOT widen scope)

1. **Search-registry copy mismatch (pre-existing):** `src/lib/search/registry.ts:135` entry `brand-public-listing` is titled "Public page" / subtitle "How buyers see your brand" but routes to `/brand/{id}/listing` (the founder venue-management page, NOT the public `/b/{slug}` page). This is a mislabel that predates ORCH-1145. Flag for a future cleanup ORCH; if ORCH-1145 keeps the route alias, the entry still resolves, but the title remains wrong. Out of scope for the move.
2. **To-do `venueFeedbackRoute` carries `?focus=feedback`** (`useBusinessTodos.ts:163`) — the deep-link query param auto-opens the feedback sheet (`listing.tsx:129-135`). If Phase 1 redirects `/brand/{id}/listing` → the Hub tab, the redirect MUST forward the `focus` query param, or the feedback auto-open breaks. The SPEC must handle this.

---

## Confidence level

**Proven.** Every file in the manifest was read verbatim; the navigation graph was established by exhaustive grep + line-level confirmation; the active-brand resolution (#4) is traced end-to-end; the ORCH-1144 disjointness is proven by a live `git diff` of the in-flight worktree (not by reading the SPEC alone). No runtime repro was required (relocation feature, not a reproducer-bound bug — Prime Directive 7 exemption).

---

## Recommended next phase + scope

**SPEC (sibling file already produced).** Scope = Phase 1 relocation ONLY:
1. Extend `HubSubNav.tsx` unions + `SUB_TABS` + `LABELS` + `ROUTES` + `detectActiveSubTab` for `venue` / "Venue" / `/(tabs)/hub/listing`.
2. New content-only `app/(tabs)/hub/listing.tsx` that resolves the active brand via `useCurrentBrand()` and renders the EXISTING management UI (extracted/reused from `brand/[id]/listing.tsx`), with the page-internal header/back suppressed.
3. Thread conditional visibility (`hasPhysicalLocation || placePoolId`) into `deriveHubVisibleTabs` / `_layout.tsx`, preserving the nav-lock guard.
4. Remove the `BrandProfileView` Operations row + `onListing` prop + the `brand/[id]/index.tsx` handler/prop.
5. Preserve the standalone `/brand/[id]/listing` route as a thin redirect to the Hub tab (forwarding `?focus=feedback`) — REQUIRED because four non-row navigators still target it (F-1). Do NOT delete it.
6. One `[TEST-MOD-APPROVED ORCH-1145]` modification to `listing.orch_1040.test.ts`; a new fails-on-revert visibility test; preserve `hub-layout-nav-lock.test.ts`.
7. No DB, edge, service, or buyer-web change. NO OpenTable/reservation/intelligence work.

NOT a fix proposal — the SPEC defines the exact contract.
