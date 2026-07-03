# INVESTIGATION — ORCH-1272 · Venue deck-readiness "Recommend me" step flashes and closes on web after Submit (new venue stuck at `business_authoring_status='processing'`)

- **Phase:** INVESTIGATE (no code changes; fix recommended, not built)
- **Date:** 2026-07-03
- **Surface:** Mingla Business — WEB (Vercel). Native unaffected today because the shipped code isn't on native yet (deployment skew — see F-7).
- **Sourcing:** all app/edge code read from `origin/main` @ `9dc99ea46` (the anchor working tree `c3ed85521` is ~53 commits behind and lacks the shipped venue code). DB evidence read read-only from prod `gqnoajqerqhnvulmnyvv`.
- **Confidence:** `probable`. Structural root cause + dead-end + recoverability are **proven** (code + DB). The exact per-frame unmount trigger is **suspected** (source-only ceiling: authed business-web runtime is unreachable per `feedback_biz_web_authed_runtime_unreachable_cap_claims`; the recommended fix is trigger-agnostic).

---

## A. Layman summary — what breaks, how bad, can the user recover

When you finish creating a **brand-new** venue in the Business app on the **web** and tap **"Submit for review,"** the app quietly does two things on the server (creates the venue row, runs "tier-1"), then tries to show you the **"Get recommended on Mingla"** screen (the AI step, "Recommend me to users"). That screen appears for a split second and vanishes. You never get to add photos / website / price, run the AI, or approve — so the venue is left half-built at `business_authoring_status = 'processing'` and never becomes deck-eligible. It is correctly **hidden from explorers** (it's `is_servable = false`), so no bad public exposure.

**How bad:** High. It breaks the primary "add a new venue" flow on web end-to-end — *every* newly created venue lands stuck. It is **not** data loss and **not** a public-facing bug.

**Can the user recover?** **Yes, but it's not obvious.** The venue still shows as a card in the Hub venue tab. Tapping it → the venue's management page → **"Edit listing"** re-opens the exact same deck-readiness screen via a *durable* route that reloads the saved state from the server; from there they can add photos/website/price, run "Recommend me," and approve. So a stuck venue is **recoverable**, just via a path the user has to discover. There is **no cron / resume / to-do that auto-un-sticks it** — it sits at `processing` forever until the operator manually returns.

**Why the fix is simple:** the durable recovery route (`/venue/deck-readiness?...`) already exists and already works. The create flow just needs to **navigate to that durable route on submit-success** instead of showing the deck-readiness screen from throw-away in-memory state.

---

## B. The flow (as shipped on origin/main)

`app/venue/create.tsx` is a phase machine: `gate → category → wizard → success`.

1. The 6-step create wizard lives in `VenueCreatorWizard.tsx`. Step `s5` = `VenueStep7Review` with the **"Submit for review"** button → `handleSubmit()`.
2. `handleSubmit()` (create path) runs, in order:
   - `createVenue.mutateAsync(...)` → `biz_create_venue_listing` → new `venue_listings` row.
   - `upsertTier1Place(...)` → edge `run-business-place-authoring-pipeline` action `upsert_tier1_place` → sets `place_pool.business_authoring_status = 'processing'`.
   - `setCreatedVenue({...})` (ephemeral React state), then `useDraftVenueStore.getState().reset(currentBrand.id)` (blanks the draft).
3. On the next render the wizard **conditionally** returns the deck-readiness screen **inline**:
   ```
   if (createdVenue !== null && user?.id !== undefined && currentBrand !== null) {
     return <VenueDeckReadinessSetup ... onDone={() => onDone(null, createdVenue.venueId)} />;
   }
   ```
   `VenueCreatorWizard.tsx:604-620` (origin/main).
4. `VenueDeckReadinessSetup` is the "Get recommended on Mingla / Recommend me to users" screen. The AI is fired by the operator via `handleRunAi` (`run_tier2_pipeline`) and finalized by `handleConfirm` (`confirm_ai_outputs`); only a successful confirm returns `deck_eligible` and calls `onDone()` → create.tsx `phase="success"`.

**Claim path is different by design:** in `handleSubmit`, when `claimMode`, it calls `onDone(null, venueId, claimName)` **directly** and returns *before* `setCreatedVenue` — it never mounts the inline deck-readiness screen; create.tsx shows the "…is in review" success screen (`VenueCreatorWizard.tsx:399-403`, `create.tsx` success block).

---

## C. Q-scorecard

- **Q1 — What renders after create "Submit for review," and how is deck-readiness mounted?**
  Verdict: The wizard mounts `VenueDeckReadinessSetup` **inline**, gated behind `createdVenue !== null && user?.id !== undefined && currentBrand !== null`, itself nested inside create.tsx's own gate `!isAuthReady || user === null || !hydrated`. The just-created venue exists **only** in the wizard's ephemeral `createdVenue` React state — no URL param, no persisted store. (**F-1**, proven.)

- **Q2 — Why does it mount then immediately unmount on web?**
  Verdict: Because the deck-readiness leg is ephemeral and multiply-gated on volatile signals, **any** transient re-resolution of the `/venue/create` subtree on web tears it down and loses `createdVenue` irrecoverably; the draft is already `reset()` to blank, so the wizard/route rebuilds at the gate. `VenueDeckReadinessSetup` itself has **no** self-dismiss/auto-`onDone`, so the unmount is external. Exact per-frame trigger **suspected** (ranked in **F-2**); structural cause **proven** (**F-1/F-3**).

- **Q3 — Why does `'processing'` stick?**
  Verdict: `upsert_tier1_place` is the only writer of `'processing'`; the only transitions out (`deck_eligible`/`needs_fix`) are `run_tier2_pipeline` / `confirm_ai_outputs` / `refresh_deck_readiness`, all operator-driven on the deck-readiness screen. No cron/auto path exists. Dead-end confirmed. (**F-4**, proven.)

- **Q4 — Is the stuck venue recoverable?**
  Verdict: Yes. Hub venue card → `/venue/{venueId}` → `VenueListingContent` "Edit listing" (unconditional) → durable `/venue/deck-readiness?brand_id=&place_pool_id=&venue_id=&focus=review`, which reloads server state and lets the operator finish. Not auto-prompted. (**F-5**, proven.)

- **Q5 — What is the CORRECT behavior for create vs claim?**
  Verdict: Create = inline/durable deck-readiness after tier-1 (operator must run AI + confirm to go deck-eligible). Claim = intentionally DEFER deck-readiness to the post-submit resume route (the venue is staged pending admin approval). Both are honored in code; the create leg's *ephemeral* mounting is the defect. (**F-6**, proven.)

- **Q6 — Why web and not native?**
  Verdict: Deployment skew. META-ORCH-1255 (multi-venue) + ORCH-1263 (claim-adoption) shipped 2026-07-02/03 and ride Vercel (web) immediately; business **native OTA is prohibited** (COMMS-0063 — a pure-JS OTA bricks launch) so native still runs pre-1255 code and doesn't have this flow at all. It is **not** a web-specific code branch. (**F-7**, proven via memory + code.)

- **Q7 — Cleanup: are the two test rows safe to delete, and what must be preserved?**
  Verdict: "The Cluster Fuck" = a pure `business_authored` placeholder (off-deck) → delete venue row + place_pool row. "Academy Street Bistro" = a pending claim on a REAL seeded Raleigh place → delete ONLY the venue_listings claim row; **preserve** place_pool `008c13b3` (still `is_servable=true`). Flag: the claim mutated the real place's authoring state (see **F-8**). (proven, DB.)

---

## D. Findings (six-field evidence)

### F-1 — The deck-readiness "success leg" for CREATE is ephemeral React state, multiply-gated on volatile auth/brand/hydration signals — **CONFIRMED ROOT CAUSE (structural)**
- **Symptom:** Deck-readiness screen appears then vanishes; venue left at tier-1.
- **Layer:** code.
- **Probe:** `git show origin/main:mingla-business/src/components/venue/VenueCreatorWizard.tsx`; `.../app/venue/create.tsx`.
- **Evidence:**
  - Wizard: `const [createdVenue, setCreatedVenue] = useState<{...}|null>(null)` and the inline mount guard `if (createdVenue !== null && user?.id !== undefined && currentBrand !== null) return <VenueDeckReadinessSetup .../>` (`VenueCreatorWizard.tsx:604`). `createdVenue` is set in `handleSubmit` and **never persisted** to a store or URL.
  - create.tsx wraps the whole route in `if (!isAuthReady || user === null || !hydrated) return <View .../>;` (blank), which **unmounts the entire wizard** — destroying `createdVenue` — if any of those three flip for even one frame (`create.tsx`, the guard just above `if (phase === "wizard")`).
  - `handleSubmit` resets the draft immediately after arming the screen: `setCreatedVenue({...}); ...; useDraftVenueStore.getState().reset(currentBrand.id);` — so after any teardown the wizard rebuilds from a **blank** draft at step 0, with `createdVenue===null`; there is no way back to the deck-readiness step in-session.
- **Mechanism:** The decision "show deck-readiness for the venue I just made" is stored only in throw-away component state behind three volatile predicates; any subtree teardown loses it permanently, and the blanked draft guarantees the rebuild lands on the gate, not the AI step.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — Exact per-frame unmount trigger — **SUSPECTED CONTRIBUTOR (source-only ceiling)**
- **Symptom:** The teardown in F-1 actually fires on web after submit.
- **Layer:** runtime (unreached).
- **Probe:** static trace of every auto-navigation / gate that governs `/venue/create` on web.
- **Evidence (ranked candidates, none provable source-only):**
  1. **Root auth-gate / create-auth-effect flicker.** `app/_layout.tsx` renders `AuthResolvingScreen` (spinner) or `<Redirect href="/" />` whenever `authResolving`/`redirectToSignIn` briefly compute true; and `create.tsx` has `useEffect(... if (user === null) router.replace("/(tabs)/home"))`. A single post-mutation auth-state echo (a `TOKEN_REFRESHED` / re-render that momentarily reads `user`/`isAuthReady`/`currentBrand` as falsy) tears down the subtree. This is the single best fit for **both** create's deck-readiness AND claim's success screen flashing (both live inside `/venue/create`).
  2. **Chunk reload.** `src/diagnostics/chunkReloadGuard.ts` calls `window.location.reload()` on a `ChunkLoadError` (web-only). If a stale `index.html` references an evicted `VenueDeckReadinessSetup` shared chunk (R2 split it out of the eager boot chunk), the page reloads → user lands at boot → venue stuck. (Less likely to be deterministic since the chunk is a static dep of the create route and normally loads with it.)
  3. **Re-render cascade** flipping `currentBrand`/`user` for one frame during the `createVenue` invalidations (`venueListingKeys.byBrand` + `brandPlacePipelineKeys.byBrand`).
- **Ruled OUT as deterministic causes:** the mutation does **not** invalidate `brandKeys.detail`, and `useBrand` has 5-min `staleTime` (`useBrands.ts:361-363`), so `useCurrentBrand()` won't drop `currentBrand`; `onAuthStateChange` sets `user` from `s?.user` on every event so a token refresh keeps `user` set (`AuthContext.tsx:541-542`); create.tsx's `reset`/phase effects are one-shot (`[fromPoolParam, hydrated, reset]`, all stable) and do not re-run on submit.
- **Mechanism:** any of the above tears down `/venue/create` per F-1.
- **Severity:** SUSPECTED CONTRIBUTOR. **The recommended fix (F-9) neutralizes all three** by making the leg durable and param-addressed.

### F-3 — `VenueDeckReadinessSetup` does NOT self-dismiss — rules the flash out of the child — **RULED OUT (as source)**
- **Probe:** full read of `src/components/venue/VenueDeckReadinessSetup.tsx`.
- **Evidence:** `onDone()` is called from exactly one place: `handleConfirm` after `confirmAiOutputs` returns `status === "deck_eligible"` (`VenueDeckReadinessSetup.tsx:428-435`). No `useEffect` calls `onDone`; the only effects manage loader-stage copy and re-seed inputs from props. On a fresh create, `recommendReady` is false (no cover/gallery/website/price), so "Recommend me" is disabled and confirm is unreachable — the screen cannot self-advance.
- **Severity:** RULED OUT (confirms the unmount is external → F-1/F-2).

### F-4 — `'processing'` is a dead-end with no auto-recovery — **CONFIRMED ROOT CAUSE (of the stuck state)**
- **Symptom:** venue permanently `business_authoring_status='processing'`.
- **Layer:** schema + edge + data.
- **Probe:** `supabase/functions/run-business-place-authoring-pipeline/index.ts` status writes; prod read-only `execute_sql`.
- **Evidence:**
  - Only writer of `'processing'`: `upsert_tier1_place` (`index.ts:626` and `:708` — `business_authoring_status: "processing"`).
  - Only transitions OUT: `run_tier2_pipeline` (`:1428`), `confirm_ai_outputs` (`:1554/:1560`), `refresh_deck_readiness` (`:1632` `const status = servable && confirmed ? "deck_eligible" : "needs_fix"`). All are operator-invoked from the deck-readiness screen. No cron/scheduled/resume writer exists anywhere in the migrations or edge functions.
  - DB (stuck row, place_pool `cd41f4e8`): `business_authoring_status='processing'`, `business_authoring_inputs` keys = `['tier1']` only, `ai_signal_scores` NULL, `business_gallery_urls` count 0, `price_tiers` `[]`, `is_servable=false`, `is_claimed=true`. → reached tier-1 and nothing after.
- **Mechanism:** if the deck-readiness screen never runs, the venue can never leave `processing` on its own.
- **Severity:** CONFIRMED ROOT CAUSE (of the persisted stuck state).

### F-5 — The stuck venue IS recoverable via the durable resume route — **PROVEN (severity mitigant)**
- **Layer:** code.
- **Probe:** `VenueCardList.tsx`, `app/venue/[venueId]/index.tsx`, `VenueListingContent.tsx`, `app/venue/deck-readiness.tsx`, `utils/deckReadinessRoutes.ts`.
- **Evidence:**
  - Hub card → `router.push(\`/venue/${venueId}\`)` (`VenueCardList.tsx:100`).
  - `/venue/[venueId]` → `VenueManagementPage` → renders `VenueListingContent`.
  - `VenueListingContent` renders **"Edit listing"** unconditionally for any venue (`VenueListingContent.tsx:428`, `onPress={handleEdit}`), and `handleEdit` → `/venue/deck-readiness?brand_id=...&place_pool_id=...&venue_id=...&focus=review&fix=review_pipeline` (`:189-193`).
  - `app/venue/deck-readiness.tsx` mounts `VenueDeckReadinessSetup` from **URL params**, reloading `initialTier2/pending bio/facets/coaching/cover/gallery` from `useBrandPlaceAuthoringContext` — i.e. it survives re-renders because its inputs are durable.
- **Mechanism:** the recovery path already exists and works; only its discoverability (no proactive to-do prompting "finish deck-readiness") is weak.
- **Severity:** PROVEN — this is why the bug is High-but-recoverable, not catastrophic.

### F-6 — Correct behavior: create = inline/durable deck-readiness; claim = deferred resume — **PROVEN (scoping)**
- **Evidence:** Wizard header comment + code: "Claim mode does NOT enter the inline deck-readiness leg — deck-readiness stays reachable post-submit via the existing to-dos/resume route" (`VenueCreatorWizard.tsx:33-37`); claim `handleSubmit` calls `onDone(...)` directly and returns before `setCreatedVenue` (`:399-403`). Create path sets `createdVenue` and shows the inline screen. So the *intended* contract is exactly right; the defect is that the create leg's inline mount is **ephemeral/fragile**, not that claim defers.
- **Severity:** PROVEN — the fix must touch ONLY the create post-submit leg; do not "fix" claim's intentional defer.

### F-7 — Web-only = deployment skew, not a web code branch — **PROVEN**
- **Evidence:** memory `project_meta_orch_1255_multi_venue_first_class.md`: "Business `eas update` is PROHIBITED — COMMS-0063 proved a pure-JS OTA bricks launch … every business fix ships via native build until ORCH-1261." META-ORCH-1255 + ORCH-1263 merged 2026-07-02/03 (`29887ed19`, `f0d60b7cf`) and are live on Vercel web. The same note pre-flags the area: "ORCH-1268 … deck-readiness screen has no exit — Seth UX call."
- **Severity:** PROVEN — the fix ships **web-only via Vercel** (`[deploy]` tag); business native rides the next native build (no `eas update`).

### F-8 — Claiming a REAL seeded place mutated its live authoring state pre-approval — **DISCOVERY (secondary; flag for orchestrator)**
- **Layer:** data.
- **Evidence:** Academy place_pool `008c13b3` (`fetched_via='detail_refresh'`, real Google place, `is_servable=true`, `is_claimed=false`) now shows `business_authoring_status='processing'` and `business_authoring_inputs` keys = `['tier1','tier2','adoption','selected_place_pool_id']`, `ai_signal_scores` present. The pending claim's `upsert_tier1_place` (linked_existing) flipped the live row's status to `processing` and staged `adoption`/`tier1` onto the live `business_authoring_inputs` **before** admin approval. `is_servable` stayed true (still on the deck), so it's functionally benign for explorers, but it contradicts the "stage-only until approve" intent for the *status/inputs* fields.
- **Severity:** DISCOVERY — not part of ORCH-1272's flash; register separately. Cleanup below preserves the place but flags an optional status/inputs revert.

---

## E. Five-truth-layer reconciliation
- **Docs/intent:** create shows deck-readiness after tier-1; claim defers to resume route. (Matches code.)
- **Schema:** `place_pool.business_authoring_status` CHECK includes `processing/needs_fix/deck_eligible` (feeder migration `20260809000000:47-55`); only edge actions transition it.
- **Code:** deck-readiness leg for create is ephemeral + multiply-gated (F-1). Contradiction with the *durable* claim/resume design — this gap IS the bug.
- **Runtime:** unreached (authed business web unreachable) — exact trigger suspected (F-2).
- **Data:** stuck row proves tier-1-only (`['tier1']`, no scores/gallery/price, off-deck). Academy proves stage-side-effect (F-8).

## F. Blast radius / cross-surface
- **In scope:** Business Web (create venue → deck-readiness leg), `app/venue/create.tsx` + `VenueCreatorWizard.tsx` create branch only.
- **Adjacent (verify parity):** the durable route `app/venue/deck-readiness.tsx` (recovery) — already correct; the fix should reuse it. `VenueListingContent`/`VenueSettingsModule` recovery CTAs — already correct.
- **Out of scope:** claim path (intentional defer — F-6); native (ships on next build — F-7); consumer app; admin.
- **Invariants touched:** none violated; note `I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START` interplay for F-8 (staging onto live place row).

---

## G. Recommended fix (direction only — NOT built, NOT a spec)

**Make the create post-submit deck-readiness leg durable instead of ephemeral.** After a successful create tier-1 in `handleSubmit` (create path), navigate to the **already-existing** durable route rather than arming `createdVenue`:

```
/venue/deck-readiness?brand_id={brandId}&place_pool_id={tier1.place_pool_id}&venue_id={venueId}&focus=review
```

(build via `routeForDeckReadinessFix({ brandId, placePoolId, venueId, fix: "review_pipeline" })`).

Why this is the right, minimal fix:
- That route addresses the deck-readiness screen by **URL params** and reloads state from the server (`useBrandPlaceAuthoringContext`) — it is immune to auth-gate flicker, chunk reload, and re-render cascades (neutralizes all F-2 candidates without needing to identify the exact one).
- It makes create use the **same durable resume path** claim/recovery already rely on (one code path, F-5/F-6).
- The ephemeral `createdVenue` inline branch in `VenueCreatorWizard` (`:604-620`) can then be retired for the create path (or kept only as a native fallback until native rebuilds).
- Optional hardening (register as follow-ups, do not fold into this fix): (a) add a "Finish getting recommended" **to-do** for venues at `processing` so recovery is proactively surfaced; (b) reconcile with the pre-flagged **ORCH-1268** ("deck-readiness screen has no exit"); (c) address F-8 (claim staging onto a live place's status/inputs).

**Do NOT** change the claim path's intentional defer (F-6). **Do NOT** add auto-cron transitions out of `processing`.

**Ship:** web-only via **Vercel** (`[deploy]` commit tag). No `eas update` (business native OTA prohibited — COMMS-0052/0063); the fix reaches native on the next native build.

---

## H. Cleanup SQL (test rows under brand `1ce63bf4-1a33-4309-ab0b-ec23343e3569`)

Both rows are safe to remove. Neither is visible to explorers: "The Cluster Fuck" is `is_servable=false`; "Academy Street Bistro" is a *pending* claim whose real seeded place stays live untouched. All venue-keyed child tables (`brand_hours`, `brand_place_pipeline_state`, `reservations`, `venue_tables`, `venue_waitlist`, `venue_availability_config`, `venue_blackouts`, `venue_capacity_rules`, `venue_reservation_settings`, `venue_claim_feedback`) are `ON DELETE CASCADE` on `venue_id`, so a single `venue_listings` delete cleans all dependents.

```sql
BEGIN;

-- 1) "The Cluster Fuck" — the CREATE test venue. Delete the venue row
--    (cascades pipeline/hours/etc.), THEN its business_authored placeholder
--    place_pool (no google_place_id, off-deck, not a real place).
DELETE FROM venue_listings
 WHERE id = 'f41cbabe-8bf3-4067-9922-c9ac4f8b738f';   -- cascades all venue-keyed children
DELETE FROM place_pool
 WHERE id = 'cd41f4e8-d342-478e-8cfa-19d2a06f44c8'
   AND fetched_via = 'business_authored'               -- guard: only the placeholder
   AND is_servable = false;

-- 2) "Academy Street Bistro" — the CLAIM test. Delete ONLY the venue_listings
--    claim row (cascades its staged pipeline/feedback). PRESERVE the real
--    seeded place_pool 008c13b3 (detail_refresh, is_servable=true).
DELETE FROM venue_listings
 WHERE id = 'a5c44a05-3293-4e66-94a8-d8e2badca15c';

-- DO NOT DELETE place_pool 008c13b3-a97e-48bf-908c-5f5eca09aa11 (real Raleigh place, live on deck).

-- Verify before COMMIT: expect 0 rows.
SELECT count(*) AS should_be_zero
  FROM venue_listings
 WHERE id IN ('f41cbabe-8bf3-4067-9922-c9ac4f8b738f','a5c44a05-3293-4e66-94a8-d8e2badca15c');
-- And confirm the real place survived, still servable:
SELECT id, is_servable, is_claimed FROM place_pool
 WHERE id = '008c13b3-a97e-48bf-908c-5f5eca09aa11';   -- expect is_servable=true, is_claimed=false

COMMIT;
```

**FLAG (F-8) — optional, judgment call, do NOT run blind:** the deleted Academy claim left the *real* place `008c13b3` at `business_authoring_status='processing'` with staged `adoption`/`tier1` in `business_authoring_inputs`. Because `is_servable=true`, it remains on the deck and is functionally fine. If you want to fully revert the pre-claim state, the safe values must come from an audit/authoring-event trail (the place already had real `tier2`+`ai_signal_scores`), not a guess — recommend leaving it as-is unless a discoverability/scoring issue surfaces, and registering F-8 as its own ticket.

---

## I. Recommended next phase
SPEC (mingla-forensics SPEC mode) — scope strictly to F-9: replace the create-path ephemeral inline deck-readiness with a `router.replace` to the durable `/venue/deck-readiness?...` route on tier-1 success; keep claim's defer untouched; ship web-only via Vercel. Then implementor → tester. Register F-8 and the discoverability to-do as separate follow-ups; reconcile with ORCH-1268.
