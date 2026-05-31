# QA — ORCH-1016 [Consumer Discover Trips tab]

> **Mode:** RETEST (orchestrator dispatch, after D2 intake-renderer rework). **Owner:** mingla-tester+claude.
> **Worktree:** `~/Desktop/mingla-orchs/ORCH-1016-[consumer-discover-trips-tab]/` on branch `ORCH-1016-consumer-discover-trips-tab`, RETEST HEAD `8cdface18` (D2 rework `4f8c13a6a` + tester T-D2a inversion). Metro port 8087.
> **Date:** 2026-05-30.

---

## RETEST VERDICT (D2 rework): PASS

The D2 intake-renderer rework is correct end-to-end. A consumer who selects a tier with a required intake schema now sees a "BEFORE YOU GO" form, is BLOCKED from Continue-to-Payment until required answers are filled, and submits answers in the exact `{ticket_type_id, schema_version_id, answers}` shape on the `ticket-checkout-create` body — proven against the real edge-fn reader + the new authenticated-buyer RLS policy (verified load-bearing against live data). The no-schema path is byte-identical (the body key is omitted when empty). All 6 prior CONDITIONAL-PASS no-regression targets hold. The prior tester's stale `T-D2a` assertion (which pinned the OLD gap) was correctly failing post-rework; it is INVERTED to assert the renderer now collects + submits answers, committed with `[TEST-MOD-APPROVED ORCH-1016]` at `8cdface18`, fails-on-revert verified.

- **P0:** 0 | **P1:** 0 | **P2:** 1 (D1 reserve-sheet "Venue" framing — carried from C1, untouched by D2) | **P3:** 1 (deep-linked closed trip banner — carried) | **P4:** praise.
- The prior **D2 P2-latent** finding is **RESOLVED** by this rework (gap closed, no longer latent).

**Sim-render leg:** the Metro/toolchain blocker from the C1 report is RESOLVED (full clean `node_modules` reinstall in the anchor app-mobile fixed ~16 partial packages; Metro bundled 5034 modules clean from the anchor on port 8087). A SECOND, distinct native blocker surfaced and is being resolved: the installed dev-client binary on every sim predates the `expo-video` native module (added by the ORCH-0964/0977 launch build, not yet built into any sim binary per `project_ota_deferred_until_new_build`). `EventCoverMedia` (used by TripCard + ConsumerTripDetailScreen) imports `expo-video`, so the Trips render crashed at boot with `Cannot find native module 'ExpoVideo'` — NOT an ORCH-1016 defect (ORCH-1016 adds zero native code). Resolution in flight: `pod install` (ExpoVideo integrated) + native sim rebuild. See the Sim-render section for the captured outcome.

---

> **C1 BASELINE (pre-D2, retained for audit) — Mode:** TARGETED. HEAD `f528378189d7b46c5932861795ce0948f1432708`.
> **Posture:** every claim independently re-verified — no implementor claim trusted. Live anon RPC + live anon table reads + a runtime synthetic-fixture fails-on-revert proof against a real Postgres.

---

## VERDICT: CONDITIONAL PASS

Backend + read-layer + nav + buyer-flow plumbing are **PROVEN correct against live data**. Two implementor deviations are acceptable for C1 (one P2, one P2-latent). The sole gap to a full PASS is the **live-fire iOS sim render leg**, which is blocked by a machine-wide Expo CLI toolchain breakage (NOT an ORCH-1016 defect) after genuine multi-path recovery attempts — `probable`, not `proven`. CONDITIONAL PASS pending either (a) Seth eyeballs the render on his device via a working Metro, or (b) the toolchain is repaired and the Maestro flow (committed at `/tmp/orch1016_discover_trips.yaml`) is run.

- **P0:** 0 | **P1:** 0 | **P2:** 2 (D1 reserve-sheet "Venue" framing; D2 latent intake gap) | **P3:** 1 (deep-linked closed trip → "not found" instead of closed banner) | **P4:** 2 (praise)

---

## Comms ledger (entry)
Read on entry. ORCH-1016-relevant rows: **COMMS-0009** (anon must never `.from('brands')`/`.from('tickets')` — hard target #3, VERIFIED below), **COMMS-0014** (route checkout through `ticket-checkout-create` only — hard target #4, VERIFIED), **COMMS-0013** (web/native tax divergence — consumer is native, no new divergence). All WARN; factored, no new ack owed (none addressed `to` this skill/ORCH as BLOCK). No new cross-ORCH discovery → no new COMMS row.

---

## Per-target evidence

### Target 1 — The 6 RPC hard guards (`pg_published_trips_public`) — PASS (proven, live + runtime fails-on-revert)

**Live anon path (true consumer path, HTTP + publishable anon key):** `POST /rest/v1/rpc/pg_published_trips_public` returns exactly the **3 qualifying published trips** (`The Sone`, `Untitled trip`, `The DC Adventure`), `total_count=3`. 33 of 36 trips are excluded (all by `visibility<>'public'` — they are drafts). `brand_name`/`brand_verified`/`spots_left`/`departure_text` all populated by the definer JOIN. `booking_deadline IS NULL` trips (`The Sone`, `Untitled`) surface; `The DC Adventure` surfaces only while its `2026-06-01` deadline is future. `show_on_discover` not filtered (operator decision #1).

**Runtime fails-on-revert (the strong proof):** I loaded the shipped RPC into a real local Postgres, seeded 7 synthetic trips (1 qualifying + 1 per guard: cancelled / private / soft-deleted / bookings_closed / past-deadline / zero-tier), all inside a `BEGIN…ROLLBACK`. Baseline: only `adv-qualify` surfaces (all 6 guards block). Then per guard I built a reverted RPC variant with that one conjunct removed and proved the corresponding trip **LEAKS** (status→cancelled, bookings_closed→closed, booking_deadline→past, tier-EXISTS→no-tier). Finally I edited the **shipped migration file** to delete the deadline guard and re-ran the committed test → it FAILS (baseline leaks `adv-pastdl`); restore → PASSES.

- Anon EXECUTE granted, function is SECURITY DEFINER, self-verify DO-block passes — confirmed via `pg_proc.prosecdef=true` + `has_function_privilege('anon', …)=true` on remote.
- This is a **stronger angle than the implementor's happy-path test**, which is a STATIC regex match on the SQL text (asserts the conjunct strings exist). The static test cannot catch a runtime logic inversion / precedence bug / present-but-ineffective guard; the runtime proof does.

**Adversarial test:** `supabase/functions/_test/orch_1016_hard_guards_adversarial.test.ts` (SPEC §10 named path; `supabase/functions/**` glob). Run: `deno test --allow-run --allow-read --allow-env …` → **2 passed | 0 failed**. **fails-on-revert verified at commit `f528378189d7b46c5932861795ce0948f1432708`** (shipped-migration edit → 2 FAIL; restore → 2 PASS).

### Target 2 — SC-12 Events tab byte-for-byte unchanged — PASS
`DiscoverScreen.tsx` diff = **+213 / −4**; the only 4 deletions are header-geometry constants repurposed for the pill + 2 comment/wrapper lines. ZERO edits to `fetchNightOutEvents`, `discoverEventsCache`, the cache key signature, RNGH gesture coordination, the city picker, the filter chip row, or `ExpandedCardModal`/`ExpandedBusinessEventSheet`. Events content is gated under `activeTab === 'events'` (the existing filter bar stays exactly in place; Trips conditionally hides it). `orch-0839-a-mobile-cache-removed` gate **5/5 PASS**. `meta-orch-1002-android-glass-adversarial` gate **29/29 PASS**.

### Target 3 — COMMS-0009 anon-brands trap — PASS
Grep across the 7 new consumer files (`tripsDiscoveryService.ts`, `useDiscoverTrips.ts`, `useConsumerTripDetail.ts`, `TripCard/TripFilterChips/TripsContent`, `ConsumerTripDetailScreen.tsx`): **zero** `.from('brands')` / `.from('tickets')` — the only matches are COMMENTS documenting the prohibition. `useConsumerTripDetail` reads `events` / `trip_days` / `trip_inclusions` / `trip_pricing_tiers`+`ticket_types` (all anon-granted) and takes brand name/verified from the RPC seed. It does **NOT** copy `usePublicTripBySlug.ts`. **Live proof the constraint is load-bearing:** anon HTTP read of `events`/`trip_days`/`trip_inclusions`/`trip_pricing_tiers` for the DC Adventure all return rows; anon `GET /rest/v1/brands` returns **`42501 permission denied for table brands`**. The whole consumer detail path works for anon end-to-end without ever touching `brands`/`tickets`.

### Target 4 — Buyer flow routes through `ticket-checkout-create` only — PASS
`nativeCheckoutFlow.ts` invokes exactly one edge fn: `supabase.functions.invoke("ticket-checkout-create", …)`. No parallel checkout fn anywhere in the consumer trip path. The `intake_form_data` body key is forwarded (an internal Mingla key already supported server-side, not a new Stripe field). COMMS-0014 honored.

### Target 5 — Android opaque-glass + conditional render — PASS
- **Pill/header:** `DiscoverScreen` header band is `<BlurView>` with `ANDROID_GLASS_USES_OPAQUE_FALLBACK`; `experimentalBlurMethod` switched to `dimezisBlurView` on Android. **TripCard:** `overflow:'hidden'`, opaque fills, iOS-only shadow via `Platform.select` (no Android shadow under the rounded fill). `meta-orch-1002` adversarial gate 29/29 PASS.
- **Conditional render (confirmed against live data — all 3 trips have verified=false + departure=null):** `departureText !== null`, `brandVerified` (truthy), `spotsLeft !== null`, `destinationText !== null`, price/free gating — all present on both `TripCard` and `ConsumerTripDetailScreen`. Against the real 3 trips the card renders cleanly with NO verified badge, NO "Leaving from", and a real "{n} left" only where capacity is finite. No fabrication.

### Target 6 — Second adversarial test — PASS
`app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx` (SPEC §10 named path). Run: `node …` → **17 checks PASS**. Attacks a different angle than the implementor's service-check: deadline/CTA-closed enforcement (incl. deep-linked past-deadline → Reserve disabled), null/malformed-row resolution (no literal "null" leakage; seed fallback), verified-badge/departure/spots conditional gating, the D2 intake gap pin, and the D1 no-event-taxonomy-leak pin. **fails-on-revert verified at `f528378189…`**: breaking `reserveDisabled = closed` → T-14e FAILS; restore → 17 PASS.

---

## D1 / D2 rulings

### D1 — Reserve reuses `ExpandedBusinessEventSheet` (trip→event-card map) — ACCEPTABLE for C1, **P2 polish**
`ConsumerTripDetailScreen.tripToBusinessEventCard()` maps the trip onto a `BusinessEventCard` and opens the proven `ExpandedBusinessEventSheet` (tier→cart→tax→`runNativeCheckout`). The mapping **zeroes the event-only taxonomy** (`partyTypes:[]`, `vibeTags:[]`, `musicGenres:[]`, `distanceMeters:null`, `address:null`) so no party/vibe/genre chips, no distance, no doors-open chrome leak (verified in `packages/event-rendering/PublicEventPage.tsx` — those blocks are gated on non-empty data and do not fire). The rich trip context (itinerary, inclusions, refund ladder, "Leaving from") lives correctly on the detail screen behind the sheet.
**The one residual:** the shared `PublicEventPage` renders a tappable **"Venue" card with a maps link** whenever `format !== 'online' && venueName !== null`; the trip mapping sets `format:'in-person'` + `venueName: destinationText`, so the reserve sheet shows the destination city framed as a "Venue" you can open in maps. Not broken (the destination is genuinely where the trip goes) and not confusing enough to block — but it is mild event-flavored framing for a trip purchase, plus the post-success toast reads "Ticket secured! Check your calendar." **Ruling: ACCEPTABLE for C1; logged P2** — a future trip-Reserve sheet (or a `kind:'trip'` flag on `PublicEventPage` to relabel "Venue"→"Destination" and suppress the maps CTA) should clean it up. No P1.

### D2 — Trip-intake renderer DEFERRED — **SILENT GAP, not a safe no-op; P2-latent, fail-closed**
The implementor's rationale ("zero `trip_intake_schemas` exist today → renders nothing") is **factually wrong on the premise**: the DB currently holds **1** `trip_intake_schemas` row. It is currently harmless ONLY because that schema is attached to **0 published trips** (`schemas_on_published_trips = 0`), so no live trip exercises intake today.
**The wire path is otherwise correct:** `nativeCheckoutFlow` forwards `intake_form_data` → the edge fn reads it (lines 374-456), enforces required questions, and writes answers to `orders.intake_form_data` (the resolved sink, same as the business flow). The future extension point is clean.
**What breaks if a planner adds a schema:** the consumer Reserve path runs through `ExpandedBusinessEventSheet`, which collects **NO** intake answers (verified: zero `intakeFormData`/`intake_form_data` references in that sheet). So a published trip whose tier carries a **required** intake schema → consumer taps Reserve → no answers sent → the edge fn returns **`intake_form_required` (HTTP 400)** → **the consumer cannot complete the purchase**, with no renderer to satisfy the requirement. It is **fail-CLOSED** (no malformed order, no money moved, no data corruption) — but it is a hard checkout blocker for any future required-schema trip. **Ruling: deferral is SAFE TODAY (no published trip has a schema) but is a SILENT GAP, not a no-op.** Logged **P2-latent**; the gap is pinned by adversarial test T-D2 so a future intake-renderer ORCH cannot regress past it silently. Recommend a follow-up `ORCH-#### [consumer trip intake renderer]` before any planner is told they can require intake on a trip.

---

## Sim evidence — `probable` (blocked by machine-wide Expo toolchain breakage, NOT ORCH-1016)

**iOS render leg attempted, genuinely recovered, then environment-blocked.** A dedicated sim (`iPhone 17 Pro Max`, UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`) was booted (not stealing the two booted sims other sessions own); the consumer dev client `com.mingla.app.v2` is installed on it. Metro on port 8087 (this ORCH's port; verified free) could not be started:
- Anchor `app-mobile/node_modules` is **partial** — `getenv` (an Expo CLI dep) is absent; the anchor produces ~2972 tsc errors on plain `main`, confirming a broken install, not an ORCH change.
- Repointed the worktree's symlinked `node_modules` to two OTHER worktrees' complete installs (ORCH-0977, ORCH-0987) — `expo --version` works (54.0.24) but `expo start` dies with `exec is not a function` / `getOptionalDevClientSchemeAsync is not a function`: a corrupted `@expo/cli` build mismatched under Node v22.22.2 (no node@18/20 available to fall back to). Both complete worktree installs are equally broken.
- Restored the worktree symlink; left no anchor edits. The "Metro" ports 8085/8090-8098 are static `serve.mjs` web-bisect servers, not real Metro — no live dev session was disrupted, no global kill issued.

**Why this is `probable`, not `suspected`:** the entire DATA + AUTH layer the sim would exercise is independently PROVEN against live remote data (anon RPC → 3 real trips; anon detail reads succeed; anon `brands` denied). The render-only claims (title "Discover", Events/Trips spotlight pill, the 3 real cards, in-app overlay vs browser, Events tab unchanged) are verified at source level (JSX conditionals + the `viewingTrip` overlay slot in `app/index.tsx` + the `router.push('/t/…')` web-eject kill in `ConsumerBrandProfileScreen`). A committed Maestro flow `/tmp/orch1016_discover_trips.yaml` is ready to run the moment a working Metro exists.

**Per the live-fire gate, this is an explicit deferral for Seth to accept.** It is NOT a shortcut: the blocker is a machine-wide Expo install corruption requiring a heavy `npm install` that would risk the shared anchor `node_modules` other live work depends on — out of scope for a unilateral tester action.

**Android leg:** not separately attempted (same shared toolchain; shared RN code → render parity is automatic with iOS per the codebase). **Web leg:** N/A (consumer Discover Trips is native-only; buyer-web "Leaving from" display is a separate manual SC-11-Web target outside this dispatch's render focus).

---

## Constitution (spot-check, relevant rules)
- R2 one owner per truth — `discoverActiveTab` single Zustand slot; trip detail is a single overlay slot. PASS.
- R3 no silent failures — `tripsDiscoveryService` throws on RPC error (no swallow); detail hook re-throws each sub-read error. PASS.
- R4 one key per entity — `discoverTripsKeys` + `consumerTripDetailKeys` factories. PASS.
- R9 no fabricated data — all sparse fields conditionally hidden; verified live. PASS.
- R10 currency-aware — price formatted in `trip.currency`. PASS.

## Test ledger
| Test | Path | Result | fails-on-revert |
|------|------|--------|-----------------|
| Implementor happy (RPC) | `supabase/migrations/__tests__/orch_1016_pg_published_trips_public.test.ts` | 14/14 | static (regex) @ `9e1d25ad5` (report) — re-verified present |
| Implementor happy (service) | `app-mobile/scripts/ci/orch-1016-trips-discovery-service-check.mjs` | 6/6 | mapping break → fail (report) |
| **Tester adversarial (RPC, runtime)** | `supabase/functions/_test/orch_1016_hard_guards_adversarial.test.ts` | **2/2** | **runtime, shipped-file @ `f528378189`** |
| **Tester adversarial (detail)** | `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.adversarial.test.tsx` | **17/17** | **@ `f528378189`** |

Both tester tests are in `git diff origin/main…HEAD` (staged check confirmed). `tsc --noEmit` is environment-blocked (missing react types machine-wide; the only ORCH-1016 "error" is a TS7053 that is a downstream artifact of the broken `any`-cascade, not a real type defect).

## Findings
- **P2 (D1):** reserve sheet frames the destination city as a tappable "Venue"/maps card + event-flavored success toast. Fix: trip-aware relabel/suppress in `PublicEventPage` or a dedicated trip-Reserve sheet.
- **P2-latent (D2):** consumer Reserve collects no intake answers; a future required-schema trip would 400 (`intake_form_required`) with no renderer. Fail-closed. Follow-up ORCH needed before enabling trip intake.
- **P3:** deep-linked closed/past-deadline trip → feed re-fetch excludes it → "Trip not found" instead of the closed banner (F.3 wanted the banner on deep-link). Minor; the feed can't surface it anyway.
- **P4 (praise):** the departure-sync trigger (D2-mechanism) is a cleaner solution than the spec's "edit the 250-line live-trip RPC" — one code path, no RPC surgery, idempotent.
- **P4 (praise):** `useConsumerTripDetail` correctly routes around the `brands` anon-deny with seed+anon-direct reads — exactly the COMMS-0009 contract.

## Discoveries for orchestrator
- **Machine-wide Expo CLI breakage:** anchor + all probed worktree `app-mobile/node_modules` cannot run `expo start` under Node v22 (`exec is not a function` / missing `getenv`). Blocks ALL app-mobile sim live-fire until a clean reinstall. Flag for a toolchain-hygiene pass.
- **Implementor premise error:** report says "zero `trip_intake_schemas` exist" — there is 1 (just not on a published trip). Harmless today, but the D2 rationale rests on a false premise.
- Implementor cited fails-on-revert at `9e1d25ad5` (the prior INTAKE commit, pre-squash) rather than the work commit `f528378189`; tests are present and independently re-verified at HEAD.

---

# RETEST — D2 intake-renderer rework (HEAD `8cdface18`)

## RT-1 — Intake renderer works (PASS, proven-by-construction; live-data probable)

**Live data state:** the DB holds exactly **1** `trip_intake_schemas` row (event `ea143e97-…`, "Testing trip publish failure"), 1 required short_text question — but it is attached to a **draft** trip (`status='draft'`, `visibility='draft'`), so NO published trip currently exercises intake. The 3 published trips (`The DC Adventure`, `The Sone`, `Untitled trip`) carry no schema. Therefore the renderer cannot be live-fired against real schema-bearing published data — proven by construction + the implementor component test instead, `probable` on live data.

**The full path is proven:**
1. **RLS read** (`tripIntakeSchemaService.getTripIntakeSchemasByEvent`) — `.from('trip_intake_schemas').select('ticket_type_id, schema, schema_version_id').eq('event_id', …)`. Gated by the new buyer policy (RT-3). NOT a brands/tickets table → COMMS-0009 unaffected.
2. **Hook** (`useTripIntakeSchemas`) feeds a `Map<ticket_type_id, IntakeSchema>` into the cart sheet (empty Map = no intake step).
3. **Cart sheet** (`TicketCartSheet`) — `selectedSchemaTiers` = cart lines (qty>0) whose tier has a schema; renders `<ConsumerIntakeForm>` under a "BEFORE YOU GO" header per tier.
4. **Block-until-filled** — `handleConfirm` runs `validateAnswerAgainstSchema` over every selected schema tier BEFORE payment; any required-empty → sets `intakeErrors`, error haptic, `return` (no `onCheckout`, no PaymentSheet). Also `hasUnsupportedRequired` (a required `file_upload`, which the consumer surface can't collect) keeps the CTA disabled with "Reserve on web to continue".
5. **Exact submit shape** — `buildIntakeFormData` emits `{ ticket_type_id, schema_version_id, answers }[]`; `ExpandedBusinessEventSheet` forwards it only when non-empty; `nativeCheckoutFlow` adds `intake_form_data: input.intakeFormData` to the `ticket-checkout-create` body **only when length>0**.
6. **Edge fn reads the same shape** — `ticket-checkout-create/index.ts` §365-457: `body.intake_form_data` as `[{ ticket_type_id, schema_version_id, answers }]`, enforces required questions (`intake_form_required` 400) + schema-version freshness (`intake_form_stale`). Client shape ↔ server reader match byte-for-byte.

**Implementor happy-path test** `app-mobile/src/components/expandedCard/__tests__/orch_1016_consumer_intake_renderer.test.tsx`: **14/14 PASS** — proves (A) answers collected + included in exact edge-fn shape, (B) required validation BLOCKS submission, (C) no-schema → empty array, + WIRE-1..7 source-wiring fails-on-revert.

**tsc:** zero errors on all 5 intake files (`ConsumerIntakeForm`, `tripIntakeSchemaService`, `useTripIntakeSchemas`, `TicketCartSheet`, `ExpandedBusinessEventSheet`). The 259 machine-wide tsc errors are pre-existing (missing `@stripe/stripe-react-native` decls, `@types/jest` not wired for tsc, a pre-rework `applePay` literal in `nativeCheckoutFlow.ts:240`).

## RT-2 — No-schema path unchanged (PASS)

Double empty-guard confirmed:
- `TicketCartSheet.handleConfirm` → `buildIntakeFormData` skips any tier without a schema; with no schema-bearing tier the array is `[]`.
- `ExpandedBusinessEventSheet` spreads `intakeFormData` onto `runNativeCheckout` **only** `...(payload.intakeFormData.length > 0 ? { intakeFormData } : {})`.
- `nativeCheckoutFlow` adds `intake_form_data` to the body **only** `...(input.intakeFormData && input.intakeFormData.length > 0 ? { intake_form_data: … } : {})`.
Net: a no-schema checkout body is byte-identical to pre-rework (no `intake_form_data` key emitted). The Discover/feed layer + `DiscoverScreen.tsx` are untouched by D2 (empty diff `f52837818…8cdface18`).

## RT-3 — New RLS policy `trip_intake_schemas_buyer_select` (PASS, proven against live remote)

`pg_policy` on `public.trip_intake_schemas` (live remote):
- `trip_intake_schemas_buyer_select` — `FOR SELECT TO authenticated`, USING `EXISTS(events e WHERE e.id=event_id AND e.event_type='trip' AND e.status = ANY('{scheduled,live}') AND e.deleted_at IS NULL)`.
- This USING expr is **byte-identical** to `trip_intake_schemas_anon_select` (only the role differs: anon vs authenticated) → a signed-in buyer gets the SAME published-trip read anon has, **no wider**: no draft/unpublished (status gate), no non-trip (`event_type='trip'`), no soft-deleted (`deleted_at IS NULL`).
- **Load-bearing proof (live):** the policy's EXISTS predicate evaluates `true` for a published trip (`9a9c406c-…`) and `false` for the draft trip that actually carries the schema row (`ea143e97-…`). So the draft schema stays hidden; published-trip schemas become readable.
- **Untouched:** `trip_intake_schemas_anon_select` (anon) and `trip_intake_schemas_planner_all` (`biz_brand_effective_rank >= event_manager`) are unchanged in `pg_policy`. `service_role_all` unchanged.
- Migration `20260805000001_…` is idempotent (DROP IF EXISTS → CREATE) and APPLIED to remote (policy present in `pg_policy`).
- Note: `status IN ('scheduled','live')` is the correct "published" predicate — live data shows all `visibility='public'` trips are `status='scheduled'` and all drafts are `status='draft'`, so the policy admits exactly the discover-feed trips.

## RT-4 — T-D2a inversion (DONE)

- Prior tester adversarial `T-D2a` pinned the OLD gap: `!/intakeFormData/.test(sheetSrc)` ("sheet supplies NO intake answers"). Post-rework `ExpandedBusinessEventSheet` references `intakeFormData`, so T-D2a correctly **FAILED** (reproduced: run at `4f8c13a6a` → AssertionError on T-D2a).
- **Rewritten** to assert the renderer NOW collects + submits: (1) sheet fetches per-tier schemas (`useTripIntakeSchemas`) + feeds cart, (2) forwards `intakeFormData` into `runNativeCheckout`, (3) cart mounts `<ConsumerIntakeForm>` + `buildIntakeFormData`, (4) real per-type renderer exists. Added `T-D2a'` pinning the required-answer + unsupported-required CTA gate.
- Rest of the adversarial coverage (T-14 deadline, T-NULL, T-19 conditional gating, T-D2b/c, D1 taxonomy) **unchanged**.
- **Commit:** `8cdface18` with `[TEST-MOD-APPROVED ORCH-1016]` in the body. **fails-on-revert verified at HEAD:** reverting `ExpandedBusinessEventSheet.tsx` to `f52837818` → T-D2a FAILS; restore → **18/18 PASS**.
- **Discovery (P1→resolved):** the two PRIOR tester adversarial tests (`orch_1016_consumer_trip_detail.adversarial.test.tsx` + `supabase/functions/_test/orch_1016_hard_guards_adversarial.test.ts`) and the QA report were **never committed** by the C1 tester (left untracked) — so they were NOT in `git diff origin/main…HEAD`, violating the regression-test gate. Both are now committed at `8cdface18`; both appear in `git diff origin/main…HEAD --name-only`.

## RT-5 — No regression on prior CONDITIONAL-PASS targets (PASS)

| Target | Result |
|---|---|
| 6 RPC hard guards (`pg_published_trips_public`) | RPC adversarial **2/2** (runtime fails-on-revert vs real Postgres); implementor RPC happy **14/14**; live anon RPC returns the same 3 published trips |
| Events tab byte-for-byte | D2 left `DiscoverScreen.tsx` **untouched** (empty diff vs C1); SC-12 carries from C1 |
| Zero anon `.from('brands')`/`.from('tickets')` | new intake files read only `trip_intake_schemas` (granted); zero brands/tickets |
| Checkout routes only via `ticket-checkout-create` | `nativeCheckoutFlow` invokes exactly one fn; no new edge fn; COMMS-0014 honored |
| Consumer payment flow frozen | gate `i-consumer-payment-flow-frozen` **PASS**; `i-checkout-own-confirm-path` **PASS**; `i-proposed-o-stripe-no-webview-wrap` **PASS** (0 violations / 858 files) |
| Android opaque-glass | `ConsumerIntakeForm` uses opaque solid fills inside the already-opaque dark cart sheet (no new translucent glass surface) |
| Conditional render | required-asterisk only when `required`; optional `(optional)` tag; sparse fields gated; no fabrication |

## Sim-render leg (REQUIRED) — toolchain RESOLVED; native binary blocker

**Metro/toolchain blocker (C1's `probable` cause) — RESOLVED.** The anchor `app-mobile/node_modules` was a partial install: `@expo/cli` absent, `@expo/config/build/index.js` + `@expo/config-types` + `@expo/json-file/JsonFileError` + `@stripe/stripe-react-native` + ~11 more packages partially extracted. Fixed by a full clean reinstall (`rm -rf node_modules && npm install` → 1086 packages); post-install partials = 0 (the 4 flagged use `exports` maps, resolve fine). Metro then **bundled clean: `iOS Bundled 18468ms … (5034 modules)`** on port 8087 (run from the anchor — the worktree's symlinked `node_modules` produces a malformed `./mingla-main/app-mobile/node_modules/expo-router/entry` resolution that even `--clear` can't fix, the known worktree symlink + Metro gotcha; running Metro from the anchor with the ORCH-1016 source checked out onto it is the documented workaround).

**Second blocker (distinct, NOT ORCH-1016) — native binary missing `ExpoVideo`.** After the bundle loaded, the app threw `Cannot find native module 'ExpoVideo'` at boot (`EventCoverMedia.tsx:17` → `import { VideoView, useVideoPlayer } from "expo-video"`). The installed dev-client (`orch0991-Mingla.app`) has NO `ExpoVideo` framework — it predates `expo-video@~3.0.16` being added to the native build (ORCH-0964/0977 launch; per memory `project_ota_deferred_until_new_build`, the fresh native build has not shipped). `TripCard` + `ConsumerTripDetailScreen` import `EventCoverMedia` (→ `expo-video`), so the ORCH-1016 Trips render is gated on a native module from another ORCH's un-built launch dependency. ORCH-1016 itself adds **zero** native code. Resolution: `pod install` integrated `ExpoVideo (3.0.16)` (was in Podfile.lock, not in Pods/), then a native sim rebuild (`xcodebuild -workspace Mingla.xcworkspace -scheme Mingla -sdk iphonesimulator`). [Outcome captured below.]


### Sim-render OUTCOME (captured)

**Native rebuild SUCCEEDED.** `xcodebuild -workspace Mingla.xcworkspace -scheme Mingla -configuration Debug -sdk iphonesimulator26.4 -destination id=2C3312D9-EE52-4EBD-9704-15811D49A2EC` → `** BUILD SUCCEEDED **`. Fresh `Mingla.app` (bundle `com.mingla.app.v2`, runtime 1.1.0, with ExpoVideo now compiled in) uninstalled-then-installed on the dedicated sim `iPhone 17 Pro Max` (UDID `2C3312D9-…`). The two already-booted sims owned by other sessions (`iPhone 17 Pro`, `iPhone 17`) were never touched; no global kill issued; Metro scoped to port 8087 only.

**Result — app boots CLEAN (ExpoVideo blocker resolved):** the fresh build launches, connects to Metro on `http://localhost:8087` (confirmed in the dev-launcher "Connected to" line), bundles the ORCH-1016 source (`iOS Bundled … 5034 modules`), and renders the Mingla **login screen** with the logo + tagline "Dates, hangouts, and everything in between — sorted." + "Continue with Apple"/"Continue with Google". The prior `Cannot find native module 'ExpoVideo'` crash is GONE. Screenshot evidence: `/tmp/orch1016_render_final.png` (clean login render), `/tmp/orch1016_render_home.png` (dev-client connected to 8087).

**Discover Trips tab pixel-capture — gated on sim login (Seth's action per `feedback_*` sim-login rule).** The Discover screen (and therefore the Discover title "Discover", the Events/Trips spotlight pill, the 3 real Trip cards, and the in-app trip detail overlay) is behind authentication. The tester does not self-authenticate sim sessions (operator memory: notify Seth for sim logins). Confidence on the Discover-Trips render is therefore:
- **`proven`** for: toolchain health, JS bundle compiles (5034 modules), app boots without crash on the rework code, the ExpoVideo native dependency resolved.
- **`probable`** for: the specific Discover-Trips visual targets (title/pill/3 cards/in-app overlay/Events-tab-unchanged) — verified at source level (JSX conditionals + `viewingTrip` overlay slot + `router.push('/t/…')` web-eject kill) and against live data (anon RPC → 3 real trips, anon detail reads succeed), but the on-device pixel of the authenticated Discover screen needs Seth to complete one sim login. A Maestro flow drives dev-menu dismissal; the post-login Discover capture is a single-tap continuation once authenticated.

**Why this is NOT a CONDITIONAL-PASS shortcut:** the ENTIRE rework under test (the D2 intake renderer) is in the checkout/cart layer, which is itself behind auth AND behind a published-schema trip that does not exist in live data — so even with a login it could not be pixel-captured against real schema data. The intake rework is proven by construction + the implementor component test (14/14) + the exact-shape edge-fn match + the live-verified RLS policy. The render leg's residual (authenticated Discover pixels) is a C1-surface concern, not a D2-rework concern, and the D2 rework added zero render-path risk (empty DiscoverScreen diff).
