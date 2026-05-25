# IMPLEMENTOR DISPATCH — ORCH-0963 [Public brand page business-case optimization (events vs. trip brands)]

**Dispatched:** 2026-05-25 by Claude `mingla-orchestrator`
**Skill:** Claude `mingla-implementor`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/`
**Branch:** `ORCH-0963-public-brand-page-events-vs-trip` (parented off `main`)
**Severity:** S2-medium / `missing-feature` + `ux` + `architecture-flaw`

---

## Goal

Build the kind-aware public brand page contract approved at SPEC + REVIEW. The page (`/b/{brandSlug}`) currently renders identical Upcoming/Past/About event-shaped chrome for every `brands.kind`. Ship: (a) for `kind='trip_planner'` brands — Trips/Past Trips/About tabs powered by a new anon-callable SECURITY DEFINER RPC; (b) for `kind ∈ {physical, popup}` event brands — push the first upcoming event above the bio via a one-line teaser strip + sticky "Buy tickets" pill on the first 3 cards; (c) drop the existing low-information stats card for both kinds.

Single-component-branched architecture (operator Decision 1). One file `PublicBrandPage.tsx` stays one file, internally branched on `brand.kind`.

---

## Inputs to ingest (Phase 0 mandatory)

1. **SPEC (binding contract):** `Mingla_Artifacts/specs/SPEC_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` in worktree. **Read every section** — §3.1 is the exact RPC SQL, §3.2-§3.4 are the layer contracts, §4 is the 15 success criteria, §6 is the 10 tests, §7 is the implementation order, §11 is the CLOSE banner requirements.
2. **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` — F-1..F-7 + D-1..D-5. Pay attention to F-3 (stale `BusinessPublicBrandViewRow.kind` TS type fix) and D-5 (ORCH-0964 file overlap awareness).
3. **REVIEW report:** `Mingla_Artifacts/reports/REVIEW_ORCH-0963_SPEC.md` — has the two pre-implement reminders (allowlist update + migration prefix grep) at the bottom.
4. **COMMS-LEDGER acks on entry:** read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. Active entries relevant to you: COMMS-0002 (ORCH-0863 allowlist gate — MANDATORY update), COMMS-0003 (external-API docs — N/A for this ORCH, no external APIs), COMMS-0004 (INTAKE ID scan — already handled), COMMS-0005 (ORCH-0964 file-overlap warning — DO NOT touch theme tokens / `<Head>` block / font tokens / color tokens / animation primitives).
5. **Memory rules in effect:** `feedback_orchestrator_deploys_edge_functions.md`, `feedback_supabase_mcp_workaround.md`, `feedback_close_commit_precommit_checks.md`, `feedback_worktree_per_orch_workflow.md`, `feedback_rn_color_formats.md` (RN hex/rgb/hsl/hwb only — the SPEC's hash-hue helper must emit `hsl(...)`).

---

## Implementation order (from SPEC §7, plus REVIEW additions)

**A — Pre-flight (do NOT skip):**
1. `cd ~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/` and confirm branch is `ORCH-0963-public-brand-page-events-vs-trip`.
2. **Migration prefix grep:** `ls ~/Desktop/mingla-orchs/*/supabase/migrations/ 2>/dev/null | grep "20260728"` — if any sibling worktree uses `20260728000000`, bump your prefix to `20260728000001`. Per memory backstop "Invariant migration backstop".
3. Verify Supabase project is the production-linked one: `/Users/sethogieva/bin/supabase migration list --linked` should show no remote-only versions; if any, source-reconcile before proceeding per memory rule.

**B — DB layer:**
4. Create `supabase/migrations/<prefix>_orch_0963_pg_public_trips_by_brand.sql` with the exact RPC body from SPEC §3.1. Preserve all `WHERE` clauses, the `b.kind = 'trip_planner'` brand-kind guard, the canonical sold formula (`'valid','used','transferred'`), the REVOKE FROM PUBLIC + GRANT EXECUTE to anon+authenticated lines, the COMMENT.
5. Write Deno SQL contract test: `supabase/migrations/__tests__/pg_public_trips_by_brand.test.ts` per SPEC §6.1 T-01.
6. Write the adversarial Deno SQL test: `supabase/migrations/__tests__/pg_public_trips_by_brand.antiLeak.adversarial.test.ts` per SPEC §6.2 T-07.
7. Run BOTH Deno tests locally; confirm PASS. Then revert one assertion at a time and confirm each test FAILS — captures the "fails-on-revert verified at <commit hash>" line required by Step 0.5 gate.

**C — Service layer (`mingla-business/src/services/publicEventsService.ts`):**
8. Widen `BusinessPublicBrandViewRow.kind` TS union to `"physical" | "popup" | "trip_planner"` (F-3 fix).
9. Add `PublicTripCardRow` + `PublicTripCard` types per SPEC §3.2.
10. Add `tripRowToCard` mapper + `fetchPublicBrandTrips(brandSlug)` per SPEC §3.2.
11. Extend `PublicBrandDetail` shape with `trips: PublicTripCard[]`.
12. Rewrite `getPublicBrandBySlug` to dispatch on `brand.kind` per SPEC §3.2 Change 5.
13. Write Jest service test: `mingla-business/src/services/__tests__/publicEventsService.tripFetch.test.ts` per SPEC §6.1 T-02.

**D — Component layer (`mingla-business/src/components/brand/PublicBrandPage.tsx`):**
14. Add the `isTripBrand` constant + tab type widening + tab label resolution per SPEC §3.4.
15. Add `upcomingTrips` + `pastTrips` memos.
16. Add `handleTripCardPress` callback.
17. Rename existing `UpcomingTab` → `UpcomingEventsTab` + `PastTab` → `PastEventsTab`. Add `UpcomingTripsTab` + `PastTripsTab`.
18. Add `<TripMiniCard>` primitive per SPEC §3.4. Pay close attention to the spots-left label logic: return `null` for unlimited capacity (NEVER "null spots left"), "Sold out" at 0, "N spot/spots left" at 1-5, no badge otherwise. T-05 adversarial will fail any regression.
19. Add `<NextEventTeaser>` primitive per SPEC §3.4. Renders ONLY when `!isTripBrand && upcomingEvents.length > 0`, placed between identity column and bio.
20. Add `formatTripDateRange(start, end, timezone)` helper per SPEC §3.4. Same-day / same-month / cross-month / cross-year branches. Defensive guard: if `endAt < startAt`, log warn + render `startAt` only.
21. Add deterministic-hue hash helper for cover-less trips (small function: hash trip.id → integer 0-359 for `hsl(h, 60%, 45%)`).
22. Wire `pinCta={index < 3}` onto first 3 EventMiniCards in the Upcoming events tab body.
23. **Drop the existing stats card** for both kinds (SC-12).
24. Write all 4 component tests per SPEC §6.1 T-03 + T-04 + SPEC §6.2 T-05 + T-06 + T-08 + T-09.

**E — Strict-grep CI gate:**
25. Create `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` with the 4 assertions from SPEC §3.6.
26. Add one new job to `.github/workflows/strict-grep-mingla-business.yml` invoking the new script. Follow the existing registry pattern per memory [[strict-grep-registry-pattern]].

**F — ORCH-0863 allowlist update (MANDATORY per COMMS-0002 + REVIEW checklist):**
27. Edit `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` to add a new `ORCH_0963_BACKEND_ALLOWLIST` constant listing the new migration file + both Deno test files. Mirror the existing `ORCH_0869_BACKEND_ALLOWLIST` pattern at line 267. Wire it into the C7 allowlist union the same way.

**G — Invariant + commit:**
28. Add `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as DRAFT (orchestrator will flip to ACTIVE at CLOSE).
29. Commit on per-ORCH branch with subject `ORCH-0963: IMPLEMENT — kind-branched public brand page + pg_public_trips_by_brand RPC`. Body lists every file changed + "fails-on-revert verified at <commit hash>" for both happy-path tests.
30. Write the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` per standard template.

---

## Hard guards

- **DO NOT** touch the `<Head>` block (lines ~230-267 of PublicBrandPage.tsx), font tokens, color tokens, animation primitives, identity-column styling, bio styling, social-row styling. Those are ORCH-0964's lane per COMMS-0005.
- **DO NOT** add positive `event_type === 'trip'` filters in client code — the strict-grep gate (assertion #4) will fail you. Trip-rejection in `fetchPublicBrandEvents` is the ONLY allowed reference, and it's a NEGATIVE filter (rejection, not selection).
- **DO NOT** apply the migration yourself — operator owns `supabase db push --linked`. Your job is the source file. After commit, the orchestrator pings the operator with the apply command.
- **DO NOT** modify any test file in this commit beyond adding NEW tests. Per `tests-append-only.yml` CI rule. Existing passing tests stay untouched (renames in implementation order step 17 are file renames, not content modifications — git tracks as moves).
- **DO NOT** add fake data, fake "spots left", fake price, fake destination — Constitution #9. SC-2 + T-05 will catch you if a TripMiniCard ever renders "null" or "undefined" or a fabricated number.
- **DO NOT** widen scope. The 11 divergence-inventory items in F-2 + the locked decisions are the contract. If something off-SPEC seems necessary, STOP and ask the orchestrator.
- **DO NOT** invoke any agent skills from inside this dispatch (no recursive orchestration, no design skill, no test skill).
- **DO NOT** push to remote until the orchestrator REVIEW approves the implementation commit.

---

## Expected output

1. All code commits on branch `ORCH-0963-public-brand-page-events-vs-trip` per implementation order steps 4-29.
2. Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` with sections: Files changed (full list with line counts), Tests added (paths + counts + fails-on-revert proof), SPEC §4 success-criteria coverage table (SC-1..SC-15, each marked ✓ with the commit hash that satisfies it), DIAG markers cleanly scoped (`[ORCH-0963-DIAG]` only if any added — orchestrator reaps at CLOSE), Open questions for orchestrator (if any).
3. Status summary in chat: line count delta, files changed, test results.

---

## Downstream routing

After implementor return:
1. **Orchestrator REVIEW** — Claude `mingla-orchestrator`. Verifies all 15 SC met, all 10 tests present + passing + fails-on-revert proven, commit-hash on every file, dependency walk for CI files.
2. **Operator applies migration** — `cd ~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip] && /Users/sethogieva/bin/supabase db push --linked` (orchestrator emits this command verbatim).
3. **Orchestrator verifies live RPC** via Mgmt API SELECTs from SPEC §3.1.
4. **TEST phase** — Claude `mingla-tester` (canonical TEST owner per memory rule). Runs LF-1..LF-5 live-fire on local Metro dev build (not prod — Cloudflare blocks headless per D-1), adversarial verification, parity check.
5. **CLOSE** — Claude `mingla-orchestrator`. `[deploy]` tag in commit (Vercel-built `mingla-business/` touched). No EAS OTA (no `app-mobile/` touched). One PR per CLOSE per WORKTREE_STRATEGY.md.

Estimated implementation time: 3-5 hours focused work (migration + RPC ~30min, service layer ~45min, component layer ~2hr, tests ~1hr, CI gate + allowlist ~30min).

---

## Sequential pace per operator memory

Operator (Seth) has a standing rule: sequential, one step at a time, no parallel work, wait for approval between major steps. For IMPLEMENT specifically: complete all of A→G in one session, but report progress incrementally — the orchestrator will not interrupt during the implementation window. If you hit a blocker, STOP and ask. Do not invent a workaround that deviates from SPEC.
