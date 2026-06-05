# QA — ORCH-1076 [paid-readiness-supply-and-publish-banners] · BOTH STREAMS

- **Skill:** mingla-tester (Claude). **Mode:** TARGETED (backend/DB + jest scope; on-device legs deferred to orchestrator+operator per dispatch).
- **Date:** 2026-06-04.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`.
- **Inputs:** SPEC_ORCH-1076_STREAM_A_SUPPLY_SUPPRESSION.md + SPEC_ORCH-1076_STREAM_B_PUBLISH_BANNERS.md; IMPLEMENTATION_ORCH-1076_STREAM_A + STREAM_B.
- **Comms ledger:** read on entry. No BLOCK/WARN row targets `mingla-tester` or ORCH-1076. COMMS-0002 (backend allowlist) + COMMS-0003 (external-API docs inline) are satisfied in-commit (verified §A.7). No new ledger entry warranted.

---

## VERDICT: CONDITIONAL PASS

- **P0: 0 | P1: 0 | P2: 1 | P3: 3 | P4: 2**
- **Stream A (buyer-supply suppression):** verified LIVE against prod DB — all gating, non-regression (SC-OWNER + T-16), free/in-person carve-outs, and self-heal proven. Strict-grep gate green + fails-on-revert. PASS at the backend layer.
- **Stream B (proactive publish banners):** 6 implementor jest suites (64 tests) + my adversarial suite (7 tests) = **76 tests pass in a CLEAN env** (real anchor `node_modules`; ts-jest did NOT hang — the worktree symlink was the sole cause). tsc clean. Per-type resolver/server parity verified at the rounding boundary. PASS at the jest/logic layer.
- **Why CONDITIONAL, not full PASS:** (1) both streams ship UI/runtime surfaces (Stream A buyer pages iOS/Android/web; Stream B business creators iOS/Android) that require on-device `proven`-level repro — explicitly the orchestrator+operator's later step per the dispatch, so the live-fire gate is DEFERRED by design, not skipped. (2) One **P2** client/server parity edge (per-stop sub-cent experience pricing) that the implementor's parity test structurally cannot catch — a FALSE-BLOCK (safe direction), documented below + pinned by my adversarial test. Neither blocks merge; both are explicit operator-deferral items.

---

## STREAM A — live-fire backend verification (prod DB)

Migration `20260917000000_orch_1076_paid_supply_requires_charges_enabled` is **APPLIED on prod** (confirmed in `supabase_migrations.schema_migrations` alongside ORCH-1075's `20260911000000`). All probes are read-only against live data. The MCP role is `supabase_read_only_user` and cannot `SET ROLE anon/service_role`; the five gated RPCs are SECURITY DEFINER (gate enforced in the function body, not via RLS), so I verified the gate three ways: (a) direct RPC call where the read-only role had the grant (deck), (b) mirroring each RPC's exact readiness WHERE predicate against live rows (the SPEC §11.2 method, identical to how the investigation proved the leak), (c) the strict-grep marker gate.

### A.1 Target + readiness predicate
| Probe | Result |
|---|---|
| `pg_brand_can_charge('53aaea42-…')` (Lantern & Vine) | **false** ✓ |
| Target experience `b8bd995b-…` "Raleigh Wine and Dine Crawl" | brand `53aaea42-…`, `experience`, public, scheduled, published, slug `raleigh-wine-and-dine-crawl`, brand_slug `lanternvine`, place_pool `8b720912-…` ✓ |
| Its ticket | `available_online=true, price_cents=7000, deleted_at=null` → PAID-online ✓ |

### A.2 Suppression (the gated paid listing must vanish)
| SC | Surface / RPC | Result |
|---|---|---|
| SC-1 | `pg_eligible_experiences_for_deck` (direct call, geo+intent matching target) | target rows = **0** ✓ (and 0 total — correctly suppressed) |
| SC-2 | `pg_brand_experiences_for_place('8b720912-…')` predicate mirror | `would_survive_gate=false` → suppressed ✓ |
| SC-3 | `pg_public_experiences_by_brand`/`pg_public_brand_upcoming` predicate mirror | `would_survive_gate=false` → suppressed ✓ |
| SC-5 | trips predicate mirror | Lantern has no trips; predicate verified structurally (free-tier / no-priced-tier / can-charge carve-outs read correctly) ✓ |

All four brand-page/place RPCs share the **identical** `(NOT EXISTS paid-online OR pg_brand_can_charge)` predicate (confirmed by reading the migration body), so the single mirror result covers them.

### A.3 Non-regression — MANDATORY adversarial
| Check | Result |
|---|---|
| **SC-OWNER** (owner still sees own not-ready listing) | **PASS** — grepped every caller of the 5 gated RPCs: `useBrandBySlug.ts`, `useVenueExperiences.ts` (consumer app), `publicEventsService.ts` `fetchPublicBrand*` (anon brand page), `discover-cards`/`generate-curated-experiences` edge fns (consumer deck). **Zero** mingla-business dashboard / manage / hub / mingla-admin reads. Owners read the `events` table directly → not gated by construction. |
| **T-16** (keyed-enrich NOT broken; view NOT gated) | **PASS** — `business_public_events_view` is a **plain view** (`pg_matviews`=0, `information_schema.views`=1), and a keyed `WHERE v.id='b8bd995b-…'` STILL returns the not-ready paid experience (1 row). Theme/price/connections keyed-enrich intact. The view is correctly NOT gated. |
| **SC-7** (free + in-person-only-paid never gated) | **PASS** — gate-predicate eval: free-online `would_survive=true`, in-person-only-paid (`available_online=false`) `would_survive=true`, only paid-online `would_survive=false`. |
| **SC-8** (Stripe-ready brand's paid offering still shows) | **PASS** — `leggothis` (9 paid events) + `travelbrand` (2 paid trips) all `would_survive_gate=true` with `can_charge=true`. |
| **SC-9** (self-heal BOTH directions) | **PASS** — Lantern `charges_enabled=false, detached_at=null` → gate_now suppresses; computed flip-to-true → reappears. Every gated object is STABLE / plain view (no matview), so no backfill/refresh. Auto-hide direction is the inverse of the same `pg_brand_can_charge` read. |

### A.4 Deep-link graceful resolvers (static — needs on-device for the render leg)
- **Experience** (`publicExperienceService.ts`): `resolveBookable` calls `pg_brand_can_charge` (anon-granted), FREE short-circuits true, fail-OPEN on RPC error (checkout 409 is backstop); `bookable` threaded through both `BySlug`/`ById`. Page `exp/[…].tsx` adds the THIRD branch `!experience.bookable → "Booking unavailable right now"` between sold-out and checkout (details still render read-only; no 404/409). Jest: 5/5 pass (clean env).
- **Event** (`publicEventsService.ts`): `resolveEventBookable` (single `pg_brand_can_charge`, fail-OPEN); `fetchPublicBrandEvents` drops paid+not-ready via batched `pg_brands_can_charge` (fail-CLOSED for paid). `PublicEventPage.tsx` renders the banner + neutralizes `onBuyTicket`/`onClaimFreeTicket` with a toast (no 404). The shared `@mingla/event-rendering` package is untouched (no cross-surface blast). Render leg = on-device QA.

### A.5 Grants
`pg_brand_can_charge`, `pg_brands_can_charge`, `pg_brand_experiences_for_place` → anon/authenticated/service_role. `pg_public_experiences_by_brand`/`upcoming`/`trips_by_brand` → REVOKE-ALL-FROM-PUBLIC + anon/authenticated. Anon deep-link resolvers can reach the predicate. ✓ (live grant probe.)

### A.6 Strict-grep gate (T-15 / SC-10)
- `orch-1076-paid-supply-requires-charges-enabled.mjs --self-test` → SELF-TEST PASSED.
- Run → all 5 RPCs `OK … readiness marker present` (exit 0).
- **Fails-on-revert:** I removed the `pg_brand_can_charge(tr.brand_id)` marker from the trips RPC → gate emitted `ORCH-1076 FAIL … missing the readiness marker` and `gate FAILED`. Restored → passes. Migration file restored byte-clean (git shows no modification).

### A.7 COMMS / safe-migration
- COMMS-0002: `ORCH_1076_BACKEND_ALLOWLIST` (migration + SQL test + `discover-merged-events/index.ts`) present and spread into the master concat. ✓
- COMMS-0003: Stripe `charges_enabled` doc URLs cited inline in the migration header + edge fn. ✓
- Migration is `CREATE OR REPLACE`-only, idempotent, no destructive DDL/backfill. Prefix `20260917000000` is above the true remote head. ✓
- SQL behavioral test `orch_1076_paid_supply_suppression.test.sql` (G-00/G-01/G-02, ROLLBACK-isolated) is well-formed but **post-apply only** — the read-only MCP role can't seed fixtures. **It does not need a re-run: the migration is already live and the gate is proven by the direct/mirror probes above.** (P3-note.)

---

## STREAM B — independent jest run (CLEAN env) + parity

**Tooling blocker RESOLVED, not deferred.** The dispatch warned ts-jest hangs through the worktree's symlinked `node_modules`. I did NOT run from the worktree. I built a clean env: rsync'd the branch `mingla-business/` source into `/tmp`, symlinked the **anchor's REAL (non-symlinked) `node_modules`** (`~/Desktop/mingla-main/mingla-business/node_modules`, confirmed a real dir with a real `jest` binary), and ran there. ts-jest ran fine (~125s cold, ~15s warm) — confirming the symlink was the sole hang cause. Cleaned up the temp env after.

### B.1 Independent run output (captured)
```
PASS publishStripeReadiness.test.ts          (T-01…T-12 resolvers + server parity)
PASS StripeBlockedCard.test.tsx              (T-13/T-14 primitive + CTA wiring)
PASS CreatorStep7Preview.refactorParity.test.tsx  (T-15/T-16 event identity)
PASS TripPublishStripeBanner.test.tsx        (T-17/T-18/T-19 + T-23/T-24)
PASS ExperiencePublishStripeBanner.test.tsx  (T-20/T-21/T-22 + T-23)
Test Suites: 5 passed, 5 total / Tests: 64 passed, 64 total
```
Plus the Stream A bookable suite `publicExperienceService.orch1076.bookable.test.ts` → 5/5, and my adversarial suite → 7/7. **Consolidated final run: 7 suites, 76 tests, all pass.** Independently reproduces the implementor's claimed 64.

### B.2 Resolver ↔ server parity (the binding INV-1 contract)
Verified the per-type `isPaid` resolvers against the ORCH-1075 server predicates at the boundary, computing BOTH sides independently in JS and in live PostgreSQL:

| Boundary | Client `Math.round(major*100)` | PG `round(major*100)` | Agree? |
|---|---|---|---|
| `0.004` | 0 → not paid | 0 → not paid | ✓ |
| `0.005` | **1 → paid** | **1 → paid** | ✓ (SPEC §9 T-05's "false" was WRONG — implementor §7 correction is correct) |
| `0.0049` | 0 → not paid | 0 → not paid | ✓ |
| `0.01` | 1 → paid | 1 → paid | ✓ |

**Trip + whole-mode experience + event resolvers are exactly server-faithful.** The SPEC author should fix the §9 T-05 note (P4-doc — code already correct).

### B.3 Wiring (static — render leg is on-device QA)
- **Event refactor identity (SC-1 / T-15):** shared `StripeBlockedCard` defaults = the exact event strings (`"Stripe required for paid tickets"` / `"Connect Stripe to publish. Free tickets can be published any time."` / `"Connect Stripe"`); Step-7 renders `<StripeBlockedCard onConnectStripe={…}/>` with NO copy override; local sub-component deleted. T-15 characterization passes (empty diff). ✓
- **Trip (SC-2…SC-5):** `tripNeedsStripe = offeringNeedsStripeToPublish({isPaid: tripDraftIsPaid, stripeStatus})`; dock Publish `disabled={submitting || tripNeedsStripe}` (line 1298); `handlePublishTap` pre-checks → toast + early-return (no confirm dialog). Both the reactive `publishError` and proactive `needsStripe` banners co-render in `TripCreatorStep5Review` (don't suppress each other). ✓
- **Experience (SC-6…SC-9):** banner on Pricing step (4) + Cover step (5); footer Publish `disabled={experienceNeedsStripe}`, Save-as-draft stays enabled; `handleSubmit(true)` pre-check returns before `biz_publish_experience`. ✓
- **D-1 / SC-11 (no edit-to-paid banner):** `experienceNeedsStripe = !isLiveEdit && …` — banner gated off in live-edit; `EditPublishedTripScreen` has no `StripeBlockedCard`. ✓
- **SC-12 (reactive ORCH-1075 catch intact, incl. stale-cache false-green):** `handlePaidPublishGuard` / `mapPublishErrorToState` + `stripe_charges_disabled` → `brandStripeOnboardingRoute` still wired in BOTH create and edit paths. A stale `stripeStatus==="active"` that hides the banner still fails-CLOSED at the RPC. ORCH-1075 migration/guards UNTOUCHED. ✓
- **SC-13:** `businessTodos.ts` not in diff. ✓

---

## FINDINGS

### P2-1 — per-stop experience resolver diverges from server for sub-cent stop prices (FALSE-BLOCK)
`experienceDraftIsPaid` uses `resolvedTotalMajor = Σ parseFloat(stop.priceMajor)` (UNROUNDED major sum) `> 0`, but the server (`20260911000000…:305-308`) sums the PER-STOP-ROUNDED cents `Σ (stop.price_cents)::int` where each cent = `round(major*100)` (wizard write `ExperienceCreatorWizard.tsx:384-386`). For sub-cent per-stop prices that individually round to 0 cents but sum >0 in major units (e.g. 3 × `0.004`: client total 0.012 → paid; server 0 cents → free), the client says paid (banner shows, Publish disabled) while the server would publish it as free. This violates the SPEC INV-1 "can NEVER disagree with the server block" for per-stop mode. **It is a FALSE-BLOCK (over-protective, safe direction) — no buyer is ever exposed to a non-chargeable brand, so it does not regress buyer safety.** The implementor's T-11 parity test cannot catch it because it derives `resolvedTotalMajor` from already-rounded `cents/100` instead of raw majors. **Faithful fix (if ever tightened):** `Σ round(stop.major*100) > 0`. Pinned by my adversarial test (below). Severity P2 because realistic per-stop prices never hit it; flagged as an explicit operator-deferral item, not a merge blocker.

### P3-1 — fail-direction asymmetry across surfaces (documented, defensible)
Hide-surfaces (deck/place/brand-feed RPCs, `discover-merged-events`, `fetchPublicBrandEvents`, `useBrandBySlug`) fail-CLOSED on a readiness error; graceful-banner resolvers (`resolveBookable`/`resolveEventBookable`) fail-OPEN. Both are intentional and commented (the checkout 409 backstops the fail-open deep-links). Note only — no action.

### P3-2 — `publishStripeReadiness.ts` header comment is factually wrong on `0.005`
Line ~79 says `"0.005" rounds to 0 cents → not paid`. Actual (and the test, and the server): `0.005 → 1 cent → paid`. The CODE is correct; only the comment misleads. Fix the comment.

### P3-3 — SQL behavioral test requires post-apply manual run
`orch_1076_paid_supply_suppression.test.sql` can't run under the read-only MCP role. The gate is already proven live by the direct/mirror probes + strict-grep, so this is informational; if the orchestrator wants the seeded G-01/G-02 self-heal proof, hand-run it once post-merge.

### P4-1 — SPEC §9 T-05 expectation is wrong (`0.005 → false`)
Should be `true`. Implementor §7/DISC-A already flagged it. SPEC author should correct the note.

### P4-2 — clean, well-cited implementation
Migration re-emits each RPC verbatim + only the readiness branch with protective comments; resolvers cite exact server line numbers; the "do NOT gate the view" decision is comment-locked in the migration header. Good defensive engineering worth replicating.

---

## REGRESSION TESTS (gate)
- **Implementor happy-path:** `publishStripeReadiness.test.ts` (+4 component/parity suites) — 64 green; fails-on-revert proven by implementor at `1dcc346ca` (drop `!isFree` → T-08 fails; drift card title → 2 suites fail). Stream A: `publicExperienceService.orch1076.bookable.test.ts` 5 green + fails-on-revert at `ccb393d45`; strict-grep fails-on-revert re-proven by me (§A.6).
- **Tester adversarial (NEW, different angle):** `mingla-business/src/components/offering/__tests__/publishStripeReadiness.adversarial.test.ts` — attacks the per-stop sub-cent client/server divergence (P2-1) the implementor's fixture can't reach, plus the trip 0.004/0.005 boundary control. 7/7 green in clean env. Both ship in `git diff origin/main...HEAD`.

## tsc / lint
`tsc --noEmit` on `mingla-business` in the clean env = **0 errors** (the worktree's "243 pre-existing errors" were `@mingla/*` symlink-resolution artifacts; with real `node_modules` they vanish). Zero errors in any touched file.

---

## WHAT STILL NEEDS ON-DEVICE QA (orchestrator + operator)
**Stream A — buyer surfaces (render legs):**
- iOS + Android consumer app: deck never shows the not-ready paid experience; place-card hides it; brand page hides paid not-ready experiences/trips/upcoming; free offering present.
- Web (`mingla-business`): `/b/lanternvine` hides it; `/exp/lanternvine/raleigh-wine-and-dine-crawl` renders details + "Booking unavailable right now" (NOT 404, NOT 409 toast); a paid not-ready `/e/{brand}/{event}` shows the banner in place of Get-tickets.
- Edge-fn runtime: redeploy `discover-merged-events` from MERGED main AFTER `db push`; verify the city feed drops the paid not-ready business-event and the price side-fetch still enriches visible rows.

**Stream B — business creators (render legs):**
- iOS + Android Business: paid trip + paid experience on a Stripe-inactive brand → banner renders (correct copy + tokens), Publish disabled, Save-as-draft enabled (experience), blocking toast fires; Android GlassCard opaque-fallback renders. Events byte-identical. Free/active → no banner.

## Completion-condition status
1. Independent tests green — ✓ (76 tests, output captured §B.1). 2. tsc clean — ✓. 3. Both regression tests in `origin/main...HEAD`, adversarial attacks a different angle — ✓. 4. UI/runtime platform legs at `proven` — **DEFERRED to orchestrator+operator on-device step (dispatch-scoped)** → the one reason this is CONDITIONAL not full PASS. 5. Zero open P0/P1 — ✓.
