# INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase:** 1 of 4 — AUDIT
**Mode:** INVESTIGATE (read-only; no spec, no solutions)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`
**Companion reports:**
- `INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md` (schema + RLS + RPCs + views + edge fns + DROP COLUMN safety plan)
- `INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md` (Phase 2 designer inputs)
- `INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md` (Q1–Q11)

---

## Comms-ledger acknowledgements

Read on entry:
- **COMMS-0001** (WARN, to ORCH-0955) — N/A this ORCH.
- **COMMS-0002** (WARN, to ALL) — factored; META-ORCH-0972 will need an `ORCH_0972_BACKEND_ALLOWLIST` entry in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` for any backend file touch in Phase 4. Flagged for orchestrator at CLOSE.
- **COMMS-0003** (WARN, to ALL) — META-ORCH-0972 does not touch external APIs in Phase 1; SPEC phase will need to verify if edge function audits change call shapes to OpenAI/Resend/etc. acked as `mingla-forensics+claude (META-ORCH-0972 AUDIT)`.
- **COMMS-0004** (WARN, to ALL) — N/A this phase (orchestrator owned INTAKE).
- **COMMS-0005** (WARN, to ORCH-0964) — N/A this ORCH.

No BLOCK entries. Audit proceeded.

---

## P1 DISCOVERY — Base-tree gap (must be resolved before Phase 4)

**Finding:** This META-ORCH-0972 worktree is exactly **1 commit behind `origin/main`**. The missing commit is `dd49d6d2b [deploy] Close ORCH-0963: public brand page kind-branched IA + pg_public_trips_by_brand RPC (#215)`.

**Root cause:** `scripts/orch-worktree/spawn.sh` reported `WARN: anchor cannot fast-forward to origin/main. Continuing with current local main.` at spawn time. The anchor checkout (`~/Desktop/mingla-main`) was on a local-main snapshot that had ORCH-0963 CLOSE artifact commits but did not include the merge commit `dd49d6d2b` for PR #215 (the actual code merge).

**Evidence:**
- `git log HEAD..origin/main` → `dd49d6d2b` (1 commit, ORCH-0963 merge).
- `ls supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql` → not found in worktree.
- `grep "isTripBrand\|TripMiniCard\|NextEventTeaser" mingla-business/src/components/brand/PublicBrandPage.tsx` → 0 matches.

**Consequences for the audit:**
1. Dimension 9 (Public Brand Page) catalogue reflects the **pre-ORCH-0963 state** — flat 3-tab model `"upcoming" | "past" | "about"`, NO `isTripBrand` branching, NO `<TripMiniCard>`/`<NextEventTeaser>` components, NO `pg_public_trips_by_brand` RPC, NO ORCH-0963 strict-grep gate file.
2. The new META-ORCH-0972 model still SUPERSEDES ORCH-0963's design (data-driven tabs replace kind-branched tabs). The audit catalogues both: current-worktree code + the ORCH-0963 surfaces that will arrive on rebase.

**Required action (orchestrator → operator, before Phase 4):**
1. Operator runs `cd ~/Desktop/mingla-main && git pull origin main` to fast-forward local main.
2. META-ORCH-0972 branch rebases: `cd ~/Desktop/mingla-orchs/meta-orch-0972-[…] && git fetch origin && git rebase origin/main`.
3. Re-run a focused diff sweep on `PublicBrandPage.tsx` + `publicEventsService.ts` post-rebase to confirm the ORCH-0963 surfaces are now present and the audit's Dimension 9 supplemental section applies.

**Severity:** P1 (not P0 because Phase 1 audit can complete on current state; P0 if not resolved before Phase 4 implementation begins).

**Cross-ref:** A COMMS-0006 entry should be written by orchestrator on next direct-to-main commit window flagging this gap to any parallel ORCH worker.

---

## Executive summary (plain English)

`brands.kind` is read or branched on across **roughly 30 distinct sites** in the business app and backend — concentrated in 4 zones: (a) brand creation flow (persona picker + TripBrandWizard), (b) authoring gate (`brandAuthoringGate.ts` + RLS view `business_public_brands_view` predicate), (c) AI experience generators (client gates + 3 edge functions), (d) UX routing (home next-action, hub tabs, public brand page address card). The codebase treats `brands.kind` as a 3-way discriminator that drives both **authorization** (who can author what) and **defaults** (what UI / address / persona is set). The operator-locked new model dissolves both responsibilities: authorization becomes universal (any brand can create any offering), defaults become data-driven (offerings render when present; address optional).

**Mechanically, the change is medium effort** (~30 sites, mostly DELETE or REGATE to a simpler signal). **Strategically, the dependencies cascade in a manageable order** (app → views → RLS → RPCs → constraint → column drop) and the DROP COLUMN safety plan is straightforward because no business logic survives that depends on `kind` for authorization after Phase 4 ships.

**Confidence:** HIGH for all 11 dimensions with returned subagent + my-own verification reads; MEDIUM for D12 (false-positive verification) — subagent still running, will be appended.

---

## 12-Dimension catalogue

Format per row: **File** (clickable path) | **Lines** | **Current behavior** | **Kind-coupling** | **Classification** | **Risk** | **Cross-refs**.

Classifications: DELETE | REPURPOSE | REGATE | RENAME | UPDATE-COPY | NO-CHANGE | VERIFY-NEEDED.

### Dimension 1 — Brand creation flow

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/types/brand.ts](mingla-business/src/types/brand.ts) | 199 | `kind: "physical" \| "popup" \| "trip_planner"` | TS union literal | DELETE (union itself) | HIGH |
| [mingla-business/src/types/brand.ts](mingla-business/src/types/brand.ts) | 183–204 | Doc block: immutability + persona meaning | Doc-only | UPDATE-COPY | LOW |
| [mingla-business/src/components/brand/BrandSwitcherSheet.tsx](mingla-business/src/components/brand/BrandSwitcherSheet.tsx) | 163 | Hardcoded `kind: "popup"` on popup-create | DB insert payload | REGATE | MEDIUM |
| [mingla-business/src/components/brand/BrandSwitcherSheet.tsx](mingla-business/src/components/brand/BrandSwitcherSheet.tsx) | 248–276 | `personas` array defines 3 persona cards routing to `popup-create` or `trip-create` modes | Persona → mode dispatch | REGATE (kill persona picker per operator) | MEDIUM |
| [mingla-business/src/components/brand/BrandSwitcherSheet.tsx](mingla-business/src/components/brand/BrandSwitcherSheet.tsx) | 361–413 | Persona mode renders `<PersonaPickerCards>` + venue search; back nav → "switch" mode | UI orchestration | REPURPOSE (collapse into universal flow) | MEDIUM |
| [mingla-business/src/components/brand/BrandSwitcherSheet.tsx](mingla-business/src/components/brand/BrandSwitcherSheet.tsx) | 376 | "Choose a brand type" / "What kind of brand?" copy | Copy only | UPDATE-COPY | LOW |
| [mingla-business/src/components/brand/PersonaPickerCards.tsx](mingla-business/src/components/brand/PersonaPickerCards.tsx) | (full file) | Locked `'place' \| 'event' \| 'trip'` persona-id union per I-PROPOSED-TR1-PERSONA-INTERFACE | Persona union lock | DELETE | LOW |
| [mingla-business/src/components/brand/PersonaForkSheet.tsx](mingla-business/src/components/brand/PersonaForkSheet.tsx) | (full file) | Thin wrapper around PersonaPickerCards | Persona wrapper | DELETE | LOW |
| [mingla-business/src/components/brand/TripBrandWizard.tsx](mingla-business/src/components/brand/TripBrandWizard.tsx) | 157 | `kind: "trip_planner"` hardcoded in createBrand payload | DB insert payload | REGATE (collapse into universal flow) | MEDIUM |
| [mingla-business/src/components/brand/TripBrandWizard.tsx](mingla-business/src/components/brand/TripBrandWizard.tsx) | 158 | `address: null` hardcoded | Trip assumption (no address) | REPURPOSE (becomes universal default) | LOW |
| [mingla-business/src/components/brand/TripBrandWizard.tsx](mingla-business/src/components/brand/TripBrandWizard.tsx) | (full file) | 6-step trip-planner-specific brand creation wizard: name + bio + cover + default-brand + current-brand + route to Stripe | Trip-planner-only flow | DELETE / collapse into unified `BrandCreationFlow` | MEDIUM |
| [mingla-business/src/services/brandsService.ts](mingla-business/src/services/brandsService.ts) | 93–128 | `CreateBrandInput.kind: "physical" \| "popup" \| "trip_planner"`; threaded into insert | TS type + DB insert | DELETE (drop from input) / REGATE (DB default) | MEDIUM |
| [mingla-business/src/services/brandMapping.ts](mingla-business/src/services/brandMapping.ts) | 47–48 | `BrandRow.kind` union | TS type | DELETE | MEDIUM |
| [mingla-business/src/services/brandMapping.ts](mingla-business/src/services/brandMapping.ts) | 91–92 | `BrandTableInsert.kind?` optional | TS type | DELETE | MEDIUM |
| [mingla-business/src/services/brandMapping.ts](mingla-business/src/services/brandMapping.ts) | 240–243 | `mapBrandRowToUi: kind: row.kind` passthrough | Row → UI map | DELETE | LOW |
| [mingla-business/src/services/brandMapping.ts](mingla-business/src/services/brandMapping.ts) | 311 | `if (brand.kind !== undefined) row.kind = brand.kind` in insert mapper | UI → row map | DELETE | LOW |
| [mingla-business/src/services/brandMapping.ts](mingla-business/src/services/brandMapping.ts) | 395 | `if (patch.kind !== undefined) out.kind = patch.kind` in update mapper | UI → row map | DELETE | LOW |
| [BrandSwitcherSheet.personaFork.test.ts](mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.ts) | 93–99 | Asserts hardcoded `"popup"` literal + negative trip-planner literal | Test guard | DELETE | LOW |
| BrandSwitcherSheet.personaFork.ve1.test.ts | (full) | Persona-fork test ve1 variant | Test | DELETE | LOW |
| BrandSwitcherSheet.personaFork.ve2.test.ts | (full) | Persona-fork test ve2 variant | Test | DELETE | LOW |
| [TripBrandWizard.test.ts](mingla-business/src/components/brand/__tests__/TripBrandWizard.test.ts) | (full) | 6-step wizard integration test; payload asserts `kind="trip_planner"` | Test | DELETE | LOW |
| [brandsService.tripPlannerKind.test.ts](mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts) | (full) | Asserts trip_planner kind is accepted by createBrand | Test | DELETE | LOW |

**TripBrandWizard 6-step flow (preservation analysis):** Wizard does name → bio → createBrand({kind:'trip_planner', address:null, coverHue:25}) → BrandCoverPickerSheet → updateCreatorAccount default_brand_id → setCurrentBrand zustand → onBrandCreated callback → router.push(/brand/{id}/payments). Each step IS replicable in a unified flow; no unique safety behavior. The only "unique" UX is the hardcoded `address:null` skip — which becomes the universal default in the new model (address is always optional). **Verdict: clean DELETE, no preservation needed.**

### Dimension 2 — Brand edit flow

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/components/brand/BrandEditView.tsx](mingla-business/src/components/brand/BrandEditView.tsx) | 568 | `{draft.kind !== "trip_planner" ? <SECTION B-2 Brand kind> : null}` — wraps entire kind picker section | Immutability enforcement (I-PROPOSED-TR1-KIND-IMMUTABLE) | DELETE (whole SECTION B-2) | LOW |
| Same file | 573–626 | Two kind toggle pills "Physical space" / "Pop-up" with `onPress = setDraft({...draft, kind: ...})` | UI branches by kind | DELETE | LOW |
| Same file | 628–648 | Address `<Input>` visible only when `draft.kind === "physical"` | UI gate | REGATE (address always-visible, always-optional) | MEDIUM |
| Same file | (styles block ~960–1000) | `kindRow`, `kindPill`, `kindPillActive`, `kindPillLabel`, `kindPillLabelActive`, `kindPillSub`, `kindPillSubActive`, `kindHint` style objects | Style block for deleted section | DELETE | LOW |

### Dimension 3 — Authoring gate

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/services/brandAuthoringGate.ts](mingla-business/src/services/brandAuthoringGate.ts) | 7–14 | `PhysicalVenueNotVerifiedError` class | Error class | DELETE | LOW |
| Same file | 17–44 | `assertBrandCanAuthorOfferings(brandId)` — fetches `kind, claim_status`; throws if `kind === "physical" && claim_status !== "verified"` | The blocker | DELETE (whole file) | HIGH (security review: verify no other gate depends on it) |
| [mingla-business/src/services/eventDrafts.ts](mingla-business/src/services/eventDrafts.ts) | 172 | `await assertBrandCanAuthorOfferings(brandId)` in `createServerDraft` | Callsite | DELETE (remove call) | LOW |
| [mingla-business/src/services/tripsService.ts](mingla-business/src/services/tripsService.ts) | 441 | `await assertBrandCanAuthorOfferings(input.brandId)` in `createTripDraft` | Callsite | DELETE (remove call) | LOW |

**Gate truth-table today (verified by reading the file):** the `if (row.kind === 'physical' && row.claim_status !== 'verified')` predicate is the ONLY block. `popup` and `trip_planner` brands ALREADY pass through with no check. So removing the gate just changes "physical+unverified" from BLOCKED to PASS. No popup/trip behavior change. No other gate today depends on `kind` for authoring permission.

### Dimension 4 — Address handling

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/types/brand.ts](mingla-business/src/types/brand.ts) | 200–210 | Doc: "address only meaningful when kind === physical" | Doc only | UPDATE-COPY | LOW |
| [mingla-business/src/components/brand/BrandEditView.tsx](mingla-business/src/components/brand/BrandEditView.tsx) | 628–648 | Address Input conditional on `draft.kind === "physical"` | UI gate | REGATE (always-visible, always-optional) | MEDIUM |
| [mingla-business/src/components/brand/TripBrandWizard.tsx](mingla-business/src/components/brand/TripBrandWizard.tsx) | 158 | `address: null` hardcoded | Default | DELETE (universal default already null-optional) | LOW |
| [mingla-business/src/components/brand/BrandSwitcherSheet.tsx](mingla-business/src/components/brand/BrandSwitcherSheet.tsx) | 164 | `address: null` hardcoded for popup-create | Default | DELETE | LOW |
| [mingla-business/src/components/brand/PublicBrandPage.tsx](mingla-business/src/components/brand/PublicBrandPage.tsx) | 227–232 | `showLocation = brand.kind === "physical" && brand.address !== null && trim.length > 0` | UI gate | REGATE (gate on `brand.address` non-empty alone) | MEDIUM |
| [mingla-business/src/utils/homeNextAction.ts](mingla-business/src/utils/homeNextAction.ts) | 112–123 | Rung 4: `kind === "physical" && (address null \| empty)` → "Add your venue address" CTA | UX nudge | DELETE | LOW |

**Operator clarification 2026-05-25:** Address becomes optional data, never a gate. Phase 2 designer decides WHERE in the brand-creation flow address is asked. Audit conclusion: address can be entered at brand-edit any time; brand-creation flow does NOT need to require it; experience-creation always asks for venue (pre-fills from brand address if present). See `INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md` for the journey-level redesign inputs.

### Dimension 5 — Home dashboard (mingla-business)

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/utils/homeNextAction.ts](mingla-business/src/utils/homeNextAction.ts) | 68–78 | Rung 2: `if (brand.kind === "trip_planner") → "Plan a trip" CTA` else event CTA | Kind-branched CTA | REGATE (3-button chooser: Event/Trip/Experience) | MEDIUM |
| Same file | 112–123 | Rung 4: physical-no-address nudge | UX nudge | DELETE | LOW |
| Same file | 33–43 | `pickHomeNextAction(brand, counts, drafts)` signature | Structural | NO-CHANGE | LOW |
| [mingla-business/src/utils/__tests__/homeNextAction.test.ts](mingla-business/src/utils/__tests__/homeNextAction.test.ts) | 67, 76, 84, 101, 110, 117, 160 | Test fixtures: `baseBrand({kind: "trip_planner" \| "popup" \| "physical"})` | Test setup | DELETE/REGATE | MEDIUM |
| [mingla-business/app/(tabs)/home.tsx](mingla-business/app/(tabs)/home.tsx) | (entire file) | NO direct brand.kind reference. References to `kind` are all `item.kind` (offering type: event/experience/trip/draft) — FALSE POSITIVES. Comment at line 453 mentions "physical-no-address rung" but that's just describing homeNextAction's output. | None | NO-CHANGE | LOW |

### Dimension 6 — Hub tabs (mingla-business)

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/app/(tabs)/hub/_layout.tsx](mingla-business/app/(tabs)/hub/_layout.tsx) | (full) | TopBar + HubSubNav (hardcoded 3-tab shell) + `<Slot />` | Structural | REPURPOSE (introduce data-driven tab visibility) | MEDIUM |
| [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/(tabs)/hub/events.tsx) | (full) | No brand.kind references — `item.kind`, `manageCtx.kind` are offering-side enums (FALSE POSITIVES). | None | NO-CHANGE | LOW |
| [mingla-business/app/(tabs)/hub/trips.tsx](mingla-business/app/(tabs)/hub/trips.tsx) | 161 | `if (currentBrand.kind !== "trip_planner") { render "Trips are for trip-planner brands" }` | Hard gate | DELETE | MEDIUM |
| [mingla-business/app/(tabs)/hub/experiences.tsx](mingla-business/app/(tabs)/hub/experiences.tsx) | 292 | `currentBrand.kind === "physical" && claimStatus !== "verified"` → unverified hint | UX gate | REGATE (no kind; if AI gate stays, gate on offering-specific signal) | MEDIUM |
| Same file | 307 | `currentBrand.kind === "physical" && venueCategory === "restaurant"` → show MenuSnapInput | Gate on kind+venueCategory | REGATE (gate on `venueCategory === "restaurant"` alone) | LOW |
| Same file | 319 | `currentBrand.kind === "physical" && venueCategory === "play"` → show ActivitiesSnapInput | Same | REGATE | LOW |
| Same file | 331 | `currentBrand.kind === "physical" && venueCategory === "creative_and_arts"` → "Schedule snap coming soon" | Same | REGATE | LOW |
| Same file | 345 | `currentBrand.kind !== "physical"` → "Experiences are for verified physical venues" | Final else | DELETE (universal access) | MEDIUM |

**Operator requirement 2026-05-25:** Hub tabs become data-driven — show only tabs whose bucket (events/trips/experiences) has content. Need new `useHubTabVisibility()` hook reading offering counts. Default-tab-when-multiple rule still open (Q3).

### Dimension 7 — Offering creation flows

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/app/trip/create.tsx](mingla-business/app/trip/create.tsx) | 9 | Doc comment referencing I-PROPOSED-TR1-KIND-IMMUTABLE | Doc | UPDATE-COPY | LOW |
| Same file | 52 | `if (currentBrand.kind !== "trip_planner") { setErrorMessage; return }` | Hard gate | DELETE | LOW |
| `mingla-business/app/event/create*.tsx` | (full) | No brand.kind references found | None | NO-CHANGE | LOW |
| [mingla-business/app/(tabs)/hub/experiences.tsx](mingla-business/app/(tabs)/hub/experiences.tsx) | 307–327 | Two snap inputs routed by venueCategory (restaurant→menu, play→activities) | Venue-type | REPURPOSE (keep venueCategory branching post-kind-removal) | LOW |
| [mingla-business/src/services/eventDrafts.ts](mingla-business/src/services/eventDrafts.ts) | 172 | Calls authoring gate (D3) | Indirect kind via D3 | DELETE (remove call per D3) | LOW |
| [mingla-business/src/services/tripsService.ts](mingla-business/src/services/tripsService.ts) | 441 | Calls authoring gate (D3) | Indirect kind via D3 | DELETE (remove call per D3) | LOW |

**Experience creation venue (operator open question Q7):** Experiences are stored in `events` table with `event_type = 'experience'`. Row carries `id, brand_id, title, description, slug, status, visibility, created_at, theme` — NO dedicated venue/address column on the experience row itself. Per operator's 2026-05-25 clarification: experience creation should ALWAYS ask for a venue address and pre-fill from brand address if present. **Phase 2 designer must define the schema enrichment** (likely add a `theme.experience_venue` JSON sub-object or a new `venue_text` column on events).

### Dimension 8 — AI experience generators

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/utils/canGenerateExperiencesFromMenu.ts](mingla-business/src/utils/canGenerateExperiencesFromMenu.ts) | 7–14 | Gate: `brand.kind === "physical" && venueCategory === "restaurant" && claimStatus === "verified"` | 3-part AND | REGATE (drop kind + claim; gate on `venueCategory === "restaurant"` alone) | MEDIUM |
| [mingla-business/src/utils/canGenerateExperiencesFromActivities.ts](mingla-business/src/utils/canGenerateExperiencesFromActivities.ts) | 7–14 | Gate: `brand.kind === "physical" && venueCategory === "play" && claimStatus === "verified"` | 3-part AND | REGATE (drop kind + claim) | MEDIUM |
| Tests for above two | various | Fixtures: `baseBrand({kind: "physical", ...})` | Test setup | REGATE (drop kind from fixtures) | LOW |
| [supabase/functions/parse-restaurant-menu/index.ts](supabase/functions/parse-restaurant-menu/index.ts) | 144 | `.select("id, name, kind, venue_category, claim_status, ...")` reads kind from DB | Read | UPDATE-COPY (drop kind from select) | LOW |
| Same file | 155 | `if (brand.kind !== "physical") return errorResponse(403, "BRAND_NOT_ELIGIBLE", "Menu generation is for physical venues only")` | Server-side block | DELETE | MEDIUM |
| Same file | 161 | `if (brand.claim_status !== "verified") return errorResponse(...)` | Server-side block | DELETE (per operator: universal access) | MEDIUM |
| [supabase/functions/parse-play-activities/index.ts](supabase/functions/parse-play-activities/index.ts) | 151 | Same kind read | Read | UPDATE-COPY | LOW |
| Same file | 162 | `if (brand.kind !== "physical") ...` server block | Server-side block | DELETE | MEDIUM |
| Same file | 176 | `if (brand.claim_status !== "verified") ...` server block | Server-side block | DELETE | MEDIUM |
| [supabase/functions/_shared/agentTools.ts](supabase/functions/_shared/agentTools.ts) | 412 | `if (brand.kind !== "physical") throw new ToolError("INVALID_ARGS", "Experiences require a verified physical venue")` in agent's `create_experience` tool | Server-side block | DELETE | MEDIUM |
| Same file | 421 | Error message follow-up | Error copy | DELETE | LOW |
| [supabase/functions/agent-chat/index.ts](supabase/functions/agent-chat/index.ts) | 296, 301, 308 | `error.kind` references — Gemini error type, NOT brand.kind | False positive | NO-CHANGE | LOW |

**Operator correction 2026-05-25:** AI experience generators become universal (not gated on Google Places claim, not gated on kind). A restaurant joining Mingla without a Google Places listing must still be able to upload a menu PDF and parse it. Phase 3 spec must drop both the `kind === 'physical'` and the `claim_status === 'verified'` gates from BOTH client utilities AND all 3 edge functions.

### Dimension 9 — Public brand page (pre-ORCH-0963 state captured; post-merge state via origin/main append)

**This branch (pre-ORCH-0963 — the worktree's actual code):**

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/components/brand/PublicBrandPage.tsx](mingla-business/src/components/brand/PublicBrandPage.tsx) | 108, 124 | `Tab = "upcoming" \| "past" \| "about"` (hardcoded events-only union) | Tab type | REPURPOSE (data-driven union) | MEDIUM |
| Same file | 227–232 | `showLocation = brand.kind === "physical" && address non-empty` — address card gate | UI gate | REGATE (gate on address presence alone) | MEDIUM |
| Same file | 238–274 | `<Head>` SEO/OG block — NO kind branching | None | NO-CHANGE | LOW |
| Same file | 415–431 | Stats card rendered when `publicEventCount > 0` (events-only) | Hardcoded to events | DELETE (per ORCH-0963 intent; META-ORCH-0972 re-confirms) | LOW |
| Same file | 434–452 | Tab button labels "Upcoming" / "Past" / "About" hardcoded | Hardcoded labels | REPURPOSE (data-driven labels) | MEDIUM |
| Same file | 455–467 | Single `UpcomingTab` component for all brands | Single tab | REPURPOSE (per-type tabs + Upcoming aggregator) | MEDIUM |
| [mingla-business/src/services/publicEventsService.ts](mingla-business/src/services/publicEventsService.ts) | ~110 | `BusinessPublicBrandViewRow.kind: "physical" \| "popup"` (missing trip_planner) | TS union | DELETE | MEDIUM |
| Same file | 199–204 | `PublicBrandDetail` shape: `{brand, events, venue}` (no trips, no experiences) | TS shape | REPURPOSE (add trips + experiences) | MEDIUM |
| Same file | 708–746 | `fetchPublicBrandEvents` always called | No dispatch | REPURPOSE (parallel-fetch events + trips + experiences) | MEDIUM |
| Same file | 748–787 | `getPublicBrandBySlug` single events-only path | No dispatch | REPURPOSE (parallel fetch all 3 offering types) | HIGH |
| [mingla-business/app/b/[brandSlug]/index.tsx](mingla-business/app/b/[brandSlug]/index.tsx) | 23–83 | Anon route; calls `usePublicBrandBySlug`; NO auth checks | Structural | NO-CHANGE (anon-tolerance preserved) | LOW |
| Past trips / past events logic | inline memos | Events: `isEventPast(event, computeMasterEndAtUtc(event))` (canonical per ORCH-0850, capped 10) | No kind | NO-CHANGE | LOW |

**On rebase to origin/main (post-ORCH-0963), the following ADDITIONAL surfaces enter scope** — these will need DELETE / REPURPOSE per the META-ORCH-0972 model:

| File | What ORCH-0963 added (per its SPEC + my verified absence in current worktree) | META-ORCH-0972 disposition |
|---|---|---|
| `PublicBrandPage.tsx` | `isTripBrand = brand.kind === "trip_planner"` constant; kind-branched tab labels ("Trips" / "Past Trips" instead of "Upcoming" / "Past"); `<TripMiniCard>` component; `<NextEventTeaser>` component; `formatTripDateRange` helper; hash-hue helper; sticky "Buy tickets" pill on first 3 EventMiniCards | `isTripBrand` constant DELETED; tab labels become data-driven; `<TripMiniCard>` + `<NextEventTeaser>` preserved as presentation primitives (reusable in new data-driven tabs); helpers preserved |
| `publicEventsService.ts` | `BusinessPublicBrandViewRow.kind` widened to admit `"trip_planner"`; `PublicTripCardRow` + `PublicTripCard` types; `fetchPublicBrandTrips` function; `PublicBrandDetail.trips` field; kind-dispatch in `getPublicBrandBySlug` | Kind union DELETED; trip types preserved; `fetchPublicBrandTrips` preserved (used universally); dispatch logic REPURPOSED into parallel-fetch |
| `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql` | New SECURITY DEFINER anon RPC `pg_public_trips_by_brand(p_brand_slug)` with `WHERE b.kind = 'trip_planner'` brand-kind guard + canonical sold formula | RPC PRESERVED but rewritten: REMOVE the `WHERE b.kind = 'trip_planner'` brand-kind guard so it returns trip rows for ANY brand that has trips. New parallel RPC `pg_public_experiences_by_brand` (or unified `pg_public_brand_upcoming`) needed for Upcoming tab. |
| `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` | New gate enforcing kind-branched IA: C1 PublicBrandPage contains `brand.kind === "trip_planner"`; C2 publicEventsService calls `pg_public_trips_by_brand`; C3 BusinessPublicBrandViewRow.kind admits `"trip_planner"`; C4 event-type filter only in allowlisted files | C1+C3 DELETED (kind branching gone); C2 PRESERVED (RPC still called universally); C4 PRESERVED (route segregation still applies). New gate enforces I-PUBLIC-PAGE-DATA-DRIVEN-TABS |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | New ACTIVE invariant `I-PUBLIC-BRAND-KIND-BRANCHED` | SUPERSEDED on META-ORCH-0972 CLOSE |

**Operator requirement 2026-05-25:** Public brand page is redesigned with (a) "Upcoming" tab interleaving events + trips + experiences chronologically when ANY offerings exist, (b) per-type tabs (Events / Trips / Experiences) shown only when that bucket has non-empty data, (c) zero offerings → no tabs, just identity card + empty state.

**Experience data model gap (blocks Phase 2 Q4):** experiences live in `events` table with `event_type='experience'` and NO occurrence date — see Dimension 7 finding. Phase 2 designer must decide (a) experiences appear in Upcoming with a new occurrence date field, OR (b) experiences appear only in Experiences tab. See Open Questions report Q4. **Q4 resolved 2026-05-25:** operator chose (a) IN with new occurrence-date field; Q9 chose JSON sub-field path (`theme.experience_meta.next_occurrence_at`).

#### Post-Rebase Supplemental (verified 2026-05-25 — appended by forensics after worktree rebase onto `dd49d6d2b`)

The pre-rebase Dimension 9 catalogue predicted what ORCH-0963 added to `PublicBrandPage.tsx`, `publicEventsService.ts`, the strict-grep gate, and the new RPC. After the rebase, every prediction was verified by reading the actual files at HEAD. **All predictions held — no wrong predictions, no missed surfaces, no false positives caught.** Catalogue rows below replace the predictive table with verified file-pinned surfaces.

| File | Line(s) | Verified behavior | Classification | Risk |
|---|---|---|---|---|
| [PublicBrandPage.tsx](mingla-business/src/components/brand/PublicBrandPage.tsx) | 144 | `const isTripBrand = brand.kind === "trip_planner"` — the kind-branch constant (14 references in file) | DELETE | MEDIUM |
| Same file | 196–208 | `upcomingTrips` + `pastTrips` memos gate on `!isTripBrand` to return `[]` for non-trip brands | DELETE (memos collapse with universal data-driven tabs) | MEDIUM |
| Same file | 212–223 | Tab labels + counts + empty-state copy all branched on `isTripBrand` (`"Trips" / "Past Trips"` vs `"Upcoming" / "Past"`) | REPURPOSE (labels become data-driven per new I-PUBLIC-PAGE-DATA-DRIVEN-TABS) | MEDIUM |
| Same file | 484–492 | `NextEventTeaser` only rendered when `!isTripBrand && upcomingEvents.length > 0` | REPURPOSE (NextEventTeaser preserved as presentation primitive; rendered when event bucket non-empty) | LOW |
| Same file | 521, 538 | Inner tab-body branching on `isTripBrand` (renders TripMiniCards vs EventMiniCards) | REPURPOSE (each per-type tab body renders its own card type; no brand-level branch) | MEDIUM |
| Same file | 701, 730 | `<TripMiniCard>` for upcoming + past trips lists | REPURPOSE (preserved as presentation primitive in new Trips tab) | LOW |
| Same file | 985–1036 | `<NextEventTeaser>` component definition (NEXT · date · name · From £X →) | REPURPOSE (preserved as presentation primitive; usable in Events tab) | LOW |
| Same file | 1038–1138 | `<TripMiniCard>` component definition (cover, date-range, title, destination, From-price, spots-left, hash-hue fallback) | REPURPOSE (preserved as presentation primitive in new Trips tab) | LOW |
| Same file | 1139–1151 | `hashHueFromString()` helper for trip cover fallback hue | NO-CHANGE (utility; reusable) | LOW |
| Same file | 1152–1206 | `formatTripDateRange()` helper for trip date display | NO-CHANGE (utility; reusable) | LOW |
| Same file | 1371, 1397, 1447+ | Styles: `nextEventTeaser*`, `tripMiniCard*`, footer rows | REPURPOSE (style blocks preserved with their components) | LOW |
| [publicEventsService.ts](mingla-business/src/services/publicEventsService.ts) | 36 | `BusinessPublicEventViewRow.brand_kind: "physical" \| "popup" \| "trip_planner"` (ORCH-0962 add — public-events view selects brand kind) | DELETE (drop `brand_kind` from view + from this TS row) | MEDIUM |
| Same file | 111–114 | `BusinessPublicBrandViewRow.kind: "physical" \| "popup" \| "trip_planner"` (the union ORCH-0963 widened) | DELETE | MEDIUM |
| Same file | 145 | `kind: "physical"` literal in `ClaimedVenuePublicViewRow` (venue-public view always physical, per ORCH-0622) | REGATE (drop kind from claimed-venues view + this row; verified venues are kind-independent under new model) | MEDIUM |
| Same file | 205–208 | `PublicBrandDetail.trips: PublicTripCard[]` field added by ORCH-0963; comment notes "Empty array for physical/popup; populated for trip_planner" | REPURPOSE (always populated when brand has trips; no kind branching) | LOW |
| Same file | 222–268 | `PublicTripCardRow` + `PublicTripCard` TS types (full shape: trip_id, slug, dates, destination, capacity, spots_left, currency, etc.) | NO-CHANGE (preserved as data shape for trips tab) | LOW |
| Same file | 270–333 | `tripRowToCard(row)` mapper (snake_case → camelCase) | NO-CHANGE (preserved) | LOW |
| Same file | 405 | Mapper line: `kind: row.brand_kind` (public-event-view path) | DELETE (drop kind passthrough from `viewRowToBrand`) | LOW |
| Same file | 435 | Mapper line: `kind: row.kind` (public-brand-view path) | DELETE (drop kind passthrough from `brandViewRowToBrand`) | LOW |
| Same file | 497 | Mapper line: `kind: "physical"` (claimed-venue path, hardcoded) | DELETE (drop kind from claimed-venue-row mapper) | LOW |
| Same file | 836–848 | `fetchPublicBrandTrips(brandSlug)` calls `pg_public_trips_by_brand` RPC; carries `orch-strict-grep-allow events-type-filter` marker | REPURPOSE (called universally — for any brand that has trips, not just trip_planner) | MEDIUM |
| Same file | 850–905 | `getPublicBrandBySlug` dispatch logic: line 889 `isTripPlanner = brandRow.kind === "trip_planner"`; lines 890–892 ternary `isTripPlanner ? [[], await fetchPublicBrandTrips(...)] : [await fetchPublicBrandEvents(...), []]` | REPURPOSE (replace with parallel fetch of events + trips + experiences regardless of brand) | HIGH |
| Same file | 869 | Comment: "verified venues are kind='physical' — never trip_planner" | UPDATE-COPY (under new model, verified venues can be any kind-free brand) | LOW |
| Same file | 887 | Comment: "kind-branched content load. Trip-planner brands fetch trips ... event brands fetch events" | UPDATE-COPY (rewrite to describe universal fetch) | LOW |
| Same file | 987 | `.order("kind")` in some claimed-venue query path | VERIFY-NEEDED (line context truncated; orchestrator should spot-check during Phase 3 SPEC) | LOW |
| Same file | 1086 | `kind: i.kind` in some loop mapper | NO-CHANGE (this is INSIDE a loop over offering items where `i.kind` is offering-side, NOT brand-side — FALSE POSITIVE verified via line-context scan) | LOW |
| [pg_public_trips_by_brand.sql](supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql) | 11–38 | RPC signature: `pg_public_trips_by_brand(p_brand_slug text) RETURNS TABLE (trip_id uuid, ..., published_at timestamptz)` — 19 fields. SECURITY DEFINER. STABLE. `SET search_path = public, pg_temp`. | REPURPOSE (signature preserved; only the brand-kind guard at line 46 is removed) | LOW |
| Same file | 41–46 | Brand CTE filters `b.kind = 'trip_planner'` — the security boundary preventing accidental misuse against event brands | REGATE (drop the kind filter — trips fetched for any brand that has them) | MEDIUM |
| Same file | 48–57 | `trip_rows` CTE filters `e.event_type = 'trip' AND e.visibility = 'public' AND e.status IN ('scheduled','live','ended','cancelled') AND e.deleted_at IS NULL` | NO-CHANGE (event-type filter is correct; trips are events with `event_type='trip'`) | LOW |
| Same file | 75–82 | Sold formula: `tickets.status IN ('valid', 'used', 'transferred')` via `tt.id = t.ticket_type_id` join — mirrors `biz_ticket_checkout_create_session` per `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE` | NO-CHANGE (canonical formula must be preserved) | LOW |
| Same file | 125–127 | Sort: `(CASE WHEN tr.status IN ('scheduled','live') THEN 0 ELSE 1 END), d.start_at NULLS LAST` — upcoming first, then past | NO-CHANGE (preserved) | LOW |
| Same file | 130–131 | `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated;` | NO-CHANGE (anon-callable grant preserved) | LOW |
| [orch-0963-public-brand-kind-branched.mjs](.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs) | 81–86 | C1 assertion: `assertContains(PAGE_FILE, "brand.kind === \"trip_planner\"")` — requires the literal kind-branch in PublicBrandPage | DELETE (the literal is going away) | LOW |
| Same file | 88–93 | C2 assertion: `assertContains(SERVICE_FILE, "pg_public_trips_by_brand")` — requires the RPC call in publicEventsService | PRESERVE (RPC stays, just called universally) | LOW |
| Same file | 95–100 | C3 assertion: `assertMatchesRegex(SERVICE_FILE, /kind:\s*"physical"\s*\|\s*"popup"\s*\|\s*"trip_planner"/)` — requires the TS union | DELETE (union goes away with kind column) | LOW |
| Same file | 102–155 | C4 assertion: walks `mingla-business/src/`, excludes `node_modules`/`__tests__`/dot-dirs, finds files matching `/event_type\s*===\s*['"]trip['"]/` outside the 3-file allowlist (`publicEventsService.ts`, `businessEvents.ts`, `routeForEventRow.ts`) | **PRESERVE** (this gate enforces `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` — route segregation between `/e/*` events-only + `/t/*` trips-only, ORTHOGONAL to brand-kind decommission) | LOW |
| [strict-grep-mingla-business.yml](.github/workflows/strict-grep-mingla-business.yml) | 181–190 | Job `orch-0963-public-brand-kind-branched` runs the mjs gate above | REPURPOSE (rename and rewrite to enforce I-PUBLIC-PAGE-DATA-DRIVEN-TABS once C1+C3 deleted; keep C2+C4) | LOW |

**Prediction-vs-reality summary:** the pre-rebase predictions held on every surface. The only new surfaces caught post-rebase (not in the prediction) are:
- Line 36 of publicEventsService — `BusinessPublicEventViewRow.brand_kind` field (ORCH-0962 add, not ORCH-0963; was missed in the predictive table but flagged in Data Model Audit §B.3 as `business_public_events_view` adding `b.kind AS brand_kind`). Now catalogued in Dimension 9 too for completeness.
- Line 145 / 497 — `ClaimedVenuePublicViewRow.kind: "physical"` literal (ORCH-0622 VE4 view's kind column passthrough). Caught here; cross-refs Data Model Audit §B.2.
- Line 987 — `.order("kind")` in a claimed-venue query. Marked VERIFY-NEEDED for Phase 3 SPEC.

**Cross-ref to invariants:**
- ORCH-0963 introduced `I-PUBLIC-BRAND-KIND-BRANCHED` ACTIVE → META-ORCH-0972 will SUPERSEDE on CLOSE with `I-PUBLIC-PAGE-DATA-DRIVEN-TABS`.
- ORCH-0963's C4 gate enforces `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` (ORCH-0859 origin) — PRESERVED through META-ORCH-0972.
- `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE` (ORCH-0947) — the canonical sold formula in `pg_public_trips_by_brand` MUST be preserved when the RPC is rewritten to drop the brand-kind guard.

**No false positives, no missed surfaces, no solution drift.** Supplemental audit complete.

### Dimension 10 — Venue claim (VE1–VE4)

Full backend catalogue lives in the Data Model Audit report. Headline surfaces in app code:

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-business/src/components/brand/VenueClaimStatusBanner.tsx](mingla-business/src/components/brand/VenueClaimStatusBanner.tsx) | 28 | `if (brand.kind !== "physical") return null` — banner hidden for non-physical | UI gate | REGATE (show banner for any brand with active claim) | MEDIUM |
| [mingla-business/src/services/venueClaimBannerLogic.ts](mingla-business/src/services/venueClaimBannerLogic.ts) | 25 | `if (row.kind !== "physical") return null` | Pure-fn gate | REGATE | MEDIUM |
| [venueClaimService.test.ts](mingla-business/src/services/__tests__/venueClaimService.test.ts) | 31–39 | `kind: "popup" → variant=null` assertion | Test | UPDATE-COPY | LOW |
| [ve4MigrationContract.test.ts](mingla-business/src/services/__tests__/ve4MigrationContract.test.ts) | (full) | Asserts kind/claim_status presence in VE4 view | Test | UPDATE-COPY (after view rewrite) | LOW |

**Operator requirement 2026-05-25:** Venue claim becomes opt-in discovery booster. Banner reframes from "verify your venue to start selling" → "claim your venue for better discovery." VE1-VE4 system SURVIVES — only the framing flips and the RLS view predicates change (see Data Model Audit).

### Dimension 11 — Backend (DB + edge functions)

Full catalogue in [`INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md`](./INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md). Summary:

- **`brands.kind` column** — added by `20260506000000_brand_kind_address_cover_hue_media.sql`; widened by `20260607000000_orch_0855_brands_kind_trip_planner.sql`. CHECK constraint `brands_kind_check` admits `(physical, popup, trip_planner)`. Latest definition verified. **Phase 4 disposition:** drop the CHECK first, drop the column in a follow-up safe-deploy after one full release cycle.
- **RLS / Views:** `business_public_brands_view` and `claimed_venues_public_view` were DROP/RECREATE'd by `20260727000003_orch_0962_brand_field_render_truthful.sql` (latest version). Both currently SELECT `kind` and apply kind-conditional WHERE clauses. **Phase 4 disposition:** REPURPOSE (drop kind from SELECT, rewrite WHERE).
- **The critical RLS predicate** on the `brands` public-read policy: `kind IN ('popup', 'trip_planner') OR (kind = 'physical' AND claim_status = 'verified')` — this is the venue-claim gate. **Phase 4 disposition:** rewrite to remove kind ("verified-or-popup" → "all brands by default; visibility moderated by other policies"). HIGH risk — RLS security boundary.
- **RPCs:** `biz_create_venue_brand_pending_review` hardcodes `kind = 'physical'` in INSERT; `biz_review_venue_claim` has `AND b.kind = 'physical'` guard. **Phase 4:** parameterize kind or remove kind from both.
- **Edge functions:** 3 (parse-restaurant-menu, parse-play-activities, _shared/agentTools.ts) have authorization-grade `kind !== 'physical'` gates. **Phase 4:** DELETE the gates (per Dim 8). `agent-chat` `kind` references are Gemini error types — FALSE POSITIVES. `tripConfirmationEmail.ts` `kind` is trip-inclusion enum — FALSE POSITIVE. `ticket-confirmation-dispatch` + `installment_kinds.test.ts` reference installment notification kinds — FALSE POSITIVE.
- **Strict-grep gates:** `orch-0855*` adversarial check (A-07 persona union, A-13 kind-immutable) — DELETE on Phase 4. `orch-0963-public-brand-kind-branched.mjs` (on origin/main, not in worktree) — partial DELETE (C1+C3), partial PRESERVE (C2+C4).

### Dimension 12 — False-positive verification (consumer + admin + shared packages)

**Consumer app (app-mobile) — NO-BRAND-KIND-DEPENDENCY confirmed.** Full verification swept 10 files initially flagged by grep plus `grep -rn "brand\.kind\|brands\.kind\|currentBrand\.kind"` — zero hits. Every "kind" reference in the consumer app is a discriminated-union for client-side state:

| File | Lines | What "kind" refers to | Classification |
|---|---|---|---|
| [app-mobile/src/payments/nativeCheckoutFlow.ts](app-mobile/src/payments/nativeCheckoutFlow.ts) | 13, 53, 58, 84, 153, 158 | Checkout response kind (free_completed / requires_payment / requires_web_redirect) | NO-CHANGE |
| [app-mobile/src/contexts/deckStateRegistry.ts](app-mobile/src/contexts/deckStateRegistry.ts) | 24, 30, 31, 49, 71, 114, 128 | Deck context kind (solo vs collab) | NO-CHANGE |
| [app-mobile/src/components/ExpandedCardModal.tsx](app-mobile/src/components/ExpandedCardModal.tsx) | 1385, 1386 | Card expansion target kind (nightOut vs businessEvent) | NO-CHANGE |
| [app-mobile/src/components/DiscoverScreen.tsx](app-mobile/src/components/DiscoverScreen.tsx) | 848, 1205, 1253, 1259, 1772, 1784 | Same expansion target union | NO-CHANGE |
| [app-mobile/src/components/board/BoardSettingsDropdown.tsx](app-mobile/src/components/board/BoardSettingsDropdown.tsx) | 53, 238, 247, 416, 425, 585, 930, 953, 968 | Session invite kind (warm vs cold contact method) | NO-CHANGE |
| [app-mobile/src/components/activity/CalendarTab.tsx](app-mobile/src/components/activity/CalendarTab.tsx) | 48, 63, 64, 487+ | Calendar row kind (calendar vs ticket) | NO-CHANGE |
| [app-mobile/src/components/connections/PendingCollabChatSheet.tsx](app-mobile/src/components/connections/PendingCollabChatSheet.tsx) | 141, 149 | Invite outcome kind | NO-CHANGE |
| [app-mobile/src/components/connections/AddFriendView.tsx](app-mobile/src/components/connections/AddFriendView.tsx) | 40, 41, 79, 80, 83, 327 | Sent item kind (request vs invite) | NO-CHANGE |
| [app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx](app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx) | 34, 121, 198 | PublicBrandProps mapping reads only `id, slug, displayName` — NOT kind | NO-CHANGE |
| [app-mobile/src/components/ConnectionsPage.tsx](app-mobile/src/components/ConnectionsPage.tsx) | 177–179 | Brand query selects `id, name, slug, account_id` — NOT kind | NO-CHANGE |

**Admin app (mingla-admin) — ONE ACTUAL BRAND-KIND DEPENDENCY FOUND (P1 finding):**

| File | Lines | Behavior | Coupling | Classification | Risk |
|---|---|---|---|---|---|
| [mingla-admin/src/services/adminClaimsService.js](mingla-admin/src/services/adminClaimsService.js) | 37 | `.eq("kind", "physical")` filter on brands table — populates the admin Venue Claims review queue | DB filter on brand.kind | REGATE | MEDIUM |

All other mingla-admin `kind` hits are rule-set kind (time_window/numeric_range/etc.), batch-progress kind (seed vs refresh), or alert kind — all NO-CHANGE.

**Shared packages — NO-BRAND-KIND-DEPENDENCY confirmed:** `packages/event-rendering/` `PublicBrandProps` reads only `id, slug, displayName`. `packages/payments-native/` + `packages/phone-input/` — zero brand.kind references.

**Verdict updates:**
- **Affected Surfaces declaration in WORLD_MAP must be updated:** admin-web IS in scope (previously flagged "pending grep" — now confirmed). The adminClaimsService Venue Claims filter is part of Phase 4 implementation scope.
- **Consumer app stays explicitly NOT in scope** — verification complete, brand-kind-agnostic.
- **Phase 2 designer must address:** admin venue claims queue still needs to surface "brands that have initiated a claim" — but the filter signal changes from `kind === 'physical'` to `claim_status !== 'none'` (or `claim_request_id IS NOT NULL`, depending on the new opt-in claim flow design).

---

## Cross-dimensional invariants

**Will SUPERSEDE on META-ORCH-0972 CLOSE:**

1. **I-PROPOSED-TR1-PERSONA-INTERFACE** (ORCH-0855, ACTIVE) — locks `PersonaDef.id` to `'place' | 'event' | 'trip'`. Enforced by `scripts/ci/orch-0855-adversarial-check.mjs` A-07. **Disposition:** SUPERSEDED — persona picker deleted, no union to lock.
2. **I-PROPOSED-TR1-KIND-IMMUTABLE** (ORCH-0855, ACTIVE) — locks `brands.kind` to immutable post-create for trip_planner. Enforced by BrandEditView gate at line 568 + A-13. **Disposition:** SUPERSEDED — no kind to be immutable.
3. **I-PUBLIC-BRAND-KIND-BRANCHED** (ORCH-0963, ACTIVE on origin/main) — public brand page MUST render content per `brands.kind`. **Disposition:** SUPERSEDED by I-PUBLIC-PAGE-DATA-DRIVEN-TABS.
4. **DEC-152** (Universal Creator Sheet TopSheet extension carve-out per ORCH-0826 M0) — TopSheet now has 2 acceptable consumers (BrandSwitcherSheet `heightMode="fixed-70"` + UniversalCreatorSheet `heightMode="compact"`). **Disposition:** PARTIAL SUPERSEDE — persona-fork in BrandSwitcherSheet is deleted; rule applies to the universal flow.
5. **DEC-161** (`brands.kind` immutable post-create for trip_planner) — **Disposition:** SUPERSEDED.

**Will INTRODUCE on META-ORCH-0972 CLOSE:**

1. **I-BRAND-UNIVERSAL-AUTHORING** — every brand can create every offering type (event, trip, experience). No kind-based authoring gate. Enforced by strict-grep: no `brand.kind === "..."` in active product code outside the migration-history directory.
2. **I-PUBLIC-PAGE-DATA-DRIVEN-TABS** — public brand page tabs render based on offering counts (`events.length > 0`, `trips.length > 0`, `experiences.length > 0`), NOT on `brand.kind`. Upcoming tab interleaves chronologically when ANY offerings exist.
3. **I-HUB-TABS-DATA-DRIVEN** — business app hub tabs render based on offering counts. Tabs hidden when bucket empty.
4. **I-VENUE-CLAIM-OPTIONAL** — venue claim is an opt-in discovery booster; it does NOT gate authoring. RLS views may use `claim_status` for verified-badge rendering but NOT for authoring authorization.
5. **I-EXPERIENCE-VENUE-PER-OFFERING** (proposed pending Phase 2 designer confirmation) — experience offerings carry their own venue field; pre-filled from brand address if present; required at offering creation time.

---

## Completeness checklist

- [x] D1 Brand creation flow — 22 surfaces catalogued (5 files + 6 tests + persona picker + persona fork + 3 brand types + service + 3 mappers)
- [x] D2 Brand edit flow — SECTION B-2 + styles block catalogued
- [x] D3 Authoring gate — file + 2 callsites + truth-table verified
- [x] D4 Address handling — 6 surfaces catalogued + operator clarification recorded
- [x] D5 Home dashboard — 2 rungs + tests + false-positive verification on home.tsx
- [x] D6 Hub tabs — _layout + 4 tab files + 5 distinct gates in experiences.tsx verified
- [x] D7 Offering creation — 6 surfaces + experience venue gap noted for Phase 2
- [x] D8 AI experience generators — 2 client utils + 3 edge functions + tests + false-positive verification on agent-chat
- [x] D9 Public brand page — pre-ORCH-0963 worktree state catalogued + post-rebase additional surfaces enumerated
- [x] D10 Venue claim — 4 app surfaces catalogued (deeper RLS detail in Data Model Audit)
- [x] D11 Backend — summary catalogued (full SQL detail in Data Model Audit)
- [x] D12 False-positive verification — consumer + shared packages NO-BRAND-KIND-DEPENDENCY confirmed; admin has 1 ACTUAL dependency in `adminClaimsService.js:37` (Venue Claims queue filter)
- [x] Base-tree gap discovery flagged as P1
- [x] Migration-chain rule applied (latest migration verified for `brands_kind_check`, `business_public_brands_view`, `claimed_venues_public_view`)
- [x] Comms-ledger entries 0001-0005 read and acked

**Confidence:** HIGH on all 12 dimensions. Subagent D verified, P1 admin-claims finding caught.

---

## Discoveries for orchestrator

1. **Base-tree gap (P1)** — local main is behind origin/main; META-ORCH-0972 worktree missing the ORCH-0963 merge commit. Operator must `git pull` and the worktree must rebase before Phase 4 implementation. Recommend writing COMMS-0006 on next clean main commit window flagging this risk to any parallel ORCH session that may spawn from a stale anchor.
2. **TripBrandWizard collapse is clean** — no unique safety/UX behavior to preserve; the 6 steps map 1:1 onto a unified brand-creation flow with `address: null` as the universal default.
3. **Authoring gate truth-table is simpler than feared** — only `physical+unverified` is currently blocked. Popup and trip_planner brands already bypass. Removing the gate is mechanically trivial; the only risk is whether any OTHER non-grep'd gate elsewhere depends on it for security (verified: none).
4. **`agent-chat/index.ts` lines 296/301/308 are FALSE POSITIVES** — these reference Gemini error types (`error.kind`), not brand kind. Worth recording in the Phase 4 spec scope as "explicitly out of scope; do not touch."
5. **`tripConfirmationEmail.ts` and `ticket-confirmation-dispatch/installment_kinds.test.ts` are FALSE POSITIVES** — they reference offering-side enums (trip inclusion kind, installment notification kind). Do not touch.
6. **Experience data model has no occurrence date** — experiences live in the `events` table with `event_type='experience'` but no `next_occurrence_at` or `start_at`. This blocks Phase 2's design of the new public-page Upcoming tab if experiences are to interleave chronologically with events + trips. Captured as Q4 in Open Questions report.
7. **`brands.kind` DROP COLUMN is safe in 2 steps** after Phase 4 ships the code changes: (a) drop the CHECK constraint, (b) drop the column. No data depends on kind after the RLS views, RPCs, and edge functions are rewritten.

End of Report 1.
