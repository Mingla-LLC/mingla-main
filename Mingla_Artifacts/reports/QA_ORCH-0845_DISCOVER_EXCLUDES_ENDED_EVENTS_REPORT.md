# QA — ORCH-0845: Discover excludes ended events on every code path

**Mode:** TARGETED
**Skill:** Claude `mingla-tester`
**Date:** 2026-05-15
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md`](../specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md)
**Implementation report:** [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md`](IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md`](INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**HEAD at QA:** `ebd9875f7f99590315e69291dd196bdd27c8d802`
**Deployed edge function:** `discover-merged-events` v8 (`ezbr_sha256: 98db04a7cad1570a73bf9774c32ee51b7dc9d7e0c11270b2ac171b58138a99d5`), `verify_jwt: false` preserved.

---

## Verdict

**PASS** — `P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 4`.

Sim evidence: **EXEMPT — backend / edge-function only** per Phase 0.A backend-only exemption. The change has zero UI/runtime surface (one edge function source file + tests + invariant + CI gate). No mobile/business/admin code touched; no native config touched; no client rebuild required. Source-only + Deno-test + live HTTP probe of the deployed function are the appropriate verification layers.

Regression tests:
- Implementor (happy-path): `supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts` — 6 Deno tests, all PASS, `fails-on-revert verified at 47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d` per implementation report §6.2.
- Tester (adversarial, NEW): `supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts` — 5 Deno tests, all PASS, `fails-on-revert verified at ebd9875f7f99590315e69291dd196bdd27c8d802` (two independent revert paths exercised — see §6 below).

Verdict-gate compliance:
- Phase 0.A: backend-only exemption claimed and justified.
- ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5: both tests at real `__tests__/` paths under `supabase/functions/`, both ship in the same PR (`git status --short` shows both in the unstaged set), both have explicit fails-on-revert evidence, both attack distinct angles (see §3 below).

---

## 1. Phase 0 — Triage

**Under test:** ORCH-0845 implementation of the spec at `SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md`. Single-file edge-function fix that hoists `event_dates.end_at >= lowerBoundUtc` floor + `event_dates.is_master = true` into the unconditional query chain of `discover-merged-events/index.ts`, plus collapses the `eventDatesEmbed` ternary to unconditional `!inner`.

**Layers touched:**
- Edge function (`discover-merged-events/index.ts`) — direct
- CI (new strict-grep gate + workflow registration) — direct
- Invariant registry (new I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE) — direct
- Test files (implementor happy-path + tester adversarial) — direct

**NOT touched:** DB schema, RLS, migrations, RPCs, mobile, business, admin, native config, EAS, packages.

**Deployment target:** Edge function only. Already deployed to production (v8 confirmed via `mcp__supabase__list_edge_functions`). No app rebuild or store submission required.

**Sub-mode:** `TARGETED` — bounded, single-file fix with proven root cause and locked spec.

---

## 2. Blast radius

| Surface | Affected? | Coverage |
|---|---|---|
| Consumer Discover screen (app-mobile) "All" filter | YES | SC-01 live HTTP probe PASS post-deploy (orchestrator) + my source code re-read + adversarial Attack 3 |
| Consumer Discover screen, facet chips (no date) | YES | SC-02 live HTTP probe PASS post-deploy (orchestrator) — same code path |
| Consumer Discover screen, dated chips (Tonight/Week/Month) | YES (regression-prone) | SC-03 live HTTP probe PASS post-deploy + adversarial Attack 3 specifically guards ORCH-0839-A F-5 / I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS |
| `discover-cards` edge function (place pool) | No | Different system — does not query `events`. Verified via source grep. |
| Buyer share-link `/e/{brand}/{event}` checkout | OUT OF SCOPE | Already-known hidden flaw (INVESTIGATION §8 discovery #1 — `computeIsPast` uses `start+24h` heuristic). Not a regression of this ORCH; separate follow-up needed. Confirmed unchanged by this ORCH. |
| Mingla-business operator app | No | Hub events list is operator-owned, intentionally shows past events. Not affected. |
| Mingla-admin | No | No admin Discover surface exists. |
| Ticketmaster fan-out | No | TM filtering delegated to TM's API; this ORCH does not touch TM call construction. Live HTTP probe shows `tmCalled: true` and 19 TM items returned alongside business events. |

---

## 3. Spec-criterion verification matrix

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| SC-01 | Raleigh no-window call excludes Big Party `549e0a64...` | Orchestrator-run live HTTP probe post-deploy v8: response had `businessCount: 1` ("Another Tested Event"), Big Party absent | PASS |
| SC-02 | Same call with facets excludes Friday Free Sunset Mixer QA `b6122ef8...` | Orchestrator-run live HTTP probe — also captured under the no-window default; both ghost-inventory rows absent | PASS |
| SC-03 | Tonight chip still includes in-progress events | Orchestrator-run live HTTP probe with `localStartEndDateTime=2026-05-15T00:00:00,2026-05-15T23:59:00` + `timezone=America/New_York`: Big Party still excluded (its end is before window.start); upcoming event present. Adversarial Attack 3 locks the source shape that enables this | PASS |
| SC-04 | Diff scope = 6 files (or 7 including SPEC) | `git diff --stat`: only 3 modified + 5 untracked, all under `supabase/functions/discover-merged-events/`, `Mingla_Artifacts/`, `.github/scripts/strict-grep/`, `.github/workflows/`. No mobile/business/admin/migration files | PASS |
| SC-05 | Strict-grep gate green on head; red on synthetic revert | I re-ran `node .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`: exit 0, both required tokens at lines 315 + 354. Synthetic revert verification documented in implementation report §6.3 + re-verified in my own §6 below | PASS |
| SC-06 | Happy-path test passes with `fails-on-revert verified at <hash>` line | Implementor cites `47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d` in implementation report §6.2. I re-ran the test: 6 PASS. I did not re-run the revert because the implementor's evidence is sufficient + my own adversarial test reverts hit distinct lines, providing independent regression coverage | PASS |
| SC-07 | Adversarial test passes with 3+ distinct angles + fails-on-revert line | This QA delivers `end_at_boundary.test.ts` with 5 attack vectors (boundary equality, boundary off-by-one, Tonight-invariant regression-inversion, upper-bound scope, upper-bound count-uniqueness). All 5 pass. Fails-on-revert verified at HEAD `ebd9875f...` on two independent revert paths (Attack 3 caught ternary collapse; Attack 4 caught upper-bound hoist) | PASS |
| SC-08 | `verify_jwt: false` preserved | `mcp__supabase__list_edge_functions` returned `verify_jwt: false` for the v8 function. Orchestrator confirmed in deploy turn | PASS |
| SC-09 | DB ghost-inventory rows still exist (READ-time fix) but edge function returns zero ghosts | Investigation §3 Layer 5 confirms 2/9 rows still in DB. Post-deploy probe shows zero ghosts in response. Read-time semantics confirmed | PASS |

All 9 spec criteria PASS.

---

## 4. Forensic code reading (independent re-read)

I re-read `supabase/functions/discover-merged-events/index.ts` end-to-end without referencing the implementor's old→new receipts. Findings:

### 4.1 Predicate construction (lines 306–354)

The `eventDatesEmbed` is unconditional `event_dates!inner ( id, start_at, end_at, timezone, is_master )` (line 306–307). The `lowerBoundUtc` ternary at line 315–316 is the exact shape the spec D-2 binds. The unconditional `.eq("event_dates.is_master", true).gte("event_dates.end_at", lowerBoundUtc)` at lines 353–354 is correctly placed at the end of the base query chain. The dated-chip `if`-block at 369–371 retains only `.lte("event_dates.start_at", dateWindowUtc.endUtc)` — single line, no duplicates.

**No issues found.** Implementation matches SPEC §3.2.2 verbatim.

### 4.2 Comment block (lines 280–305)

The unified ORCH-0828 → 0839-A → 0845 chronological history is present. All three ORCH-IDs are named in order with their feature/bug labels. I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS is cited as preserved. I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE is cited as established. CI gate path is named. Schema reassurance about `end_at NOT NULL` + `CHECK end_at > start_at` is present. I-PROPOSED-AX EVENT_HAS_MASTER_DATE is cited as the safety basis for the `!inner` switch.

**No issues found.** Comment is well-structured, factually correct, and useful for future readers.

### 4.3 Untouched regions

I confirmed the following are byte-equivalent to pre-0845:
- Imports (lines 1–41)
- CORS headers (43–48)
- Type interfaces (50–130)
- Helpers (132–186)
- Request validation (190–256)
- Timezone parsing (230–256)
- Supabase client construction (258–266)
- City-IN-construction (337–350) — preserves ORCH-0824 hotfix-5b
- Facet filters (356–364) — unchanged
- `range()` (373) — unchanged
- DB error handling (376–379) — unchanged
- Row normalization, brand filtering, ticket aggregation (382–500+) — unchanged
- Ticketmaster fan-out and ranking (rest of file) — unchanged

**No silent regressions.** The implementor stayed within scope.

### 4.4 `verify_jwt`

Confirmed `supabase/config.toml` entry for `discover-merged-events` still sets `verify_jwt = false`. The function header comment at line 17 also re-states this. Live `mcp__supabase__list_edge_functions` confirms the deployed v8 has `verify_jwt: false`.

---

## 5. Constitution (14 rules)

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | Backend-only |
| 2 | One owner per truth | PASS | `lowerBoundUtc` is the sole owner of the "is past" decision in this function |
| 3 | No silent failures | PASS | `dbError` 500, `invalid_timezone` 400, `city_required` 400 paths untouched — all surface errors |
| 4 | One key per entity | N/A | No React Query |
| 5 | Server state server-side | N/A | No Zustand |
| 6 | Logout clears everything | N/A | No auth state |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` markers introduced |
| 8 | Subtract before adding | PASS | The ternary embed was collapsed BEFORE the always-on predicate was added; the master-date filter was MOVED OUT of the if-block, not duplicated |
| 9 | No fabricated data | PASS | Filter operates on real `event_dates.end_at` rows; no synthetic dates |
| 10 | Currency-aware | N/A | No currency surface |
| 11 | One auth instance | N/A | `verify_jwt = false` unchanged |
| 12 | Validate at right time | PASS | `lowerBoundUtc` computed per-request via `new Date().toISOString()`, not at module load |
| 13 | Exclusion consistency | PASS | Same end-time floor applies on no-window AND dated-chip paths (only the upper bound differs) |
| 14 | Persisted-state startup | N/A | No persisted state |

**Zero violations. Zero P0 triggers.**

---

## 6. Independent regression tests (S-5b)

### 6.1 File and content

`supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts` — 5 `Deno.test` blocks across four attack vectors:

| Attack | Angle | What it catches |
|--------|-------|-----------------|
| 1 | Boundary equality (`==` boundary, must satisfy `>=`) | A "fix" that switched `.gte` → `.gt`. Caught at request-time floor literal equality. |
| 2 | Boundary off-by-one (1ms before, must NOT satisfy) | A "fix" that added grace-period seconds/ms to the floor. |
| 3 | Tonight-invariant regression-inversion (ternary must remain) | A reckless "simplification" collapsing `lowerBoundUtc = dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()` to `lowerBoundUtc = new Date().toISOString()`. Implementor's structural test does NOT catch this because `.gte` would still be hoisted. This is the most important adversarial vector. |
| 4 | Upper-bound scope (must stay INSIDE if-block) | A "fix" that mirror-hoisted the upper bound out of the dated-chip branch, which would crash or send "undefined" as the upper bound on the no-window path. |
| 5 (bonus) | Upper-bound count-uniqueness | Duplicate `.lte("event_dates.start_at", ...)` calls elsewhere in the file. Prevents the upper bound from being inadvertently copied onto the unconditional path. |

Attack 3 is the critical adversarial vector — it inverts the implementor's structural test angle. The implementor's test asserts placement; my Attack 3 asserts the SHAPE of the decision logic so a placement-preserving regression still fails.

### 6.2 Run on fixed code

```
$ deno test --allow-read supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts
running 5 tests
ORCH-0845 adversarial — boundary equality: end_at exactly == lowerBoundUtc is INCLUDED ... ok (0ms)
ORCH-0845 adversarial — boundary off-by-one: end_at = lowerBoundUtc - 1ms is EXCLUDED ... ok (0ms)
ORCH-0845 adversarial — Tonight path uses window.startUtc, NOT now() (preserves ORCH-0839-A F-5) ... ok (1ms)
ORCH-0845 adversarial — upper bound .lte(event_dates.start_at, ...) stays INSIDE the if-block ... ok (0ms)
ORCH-0845 adversarial — no-window path has NO upper-bound filter on event_dates.start_at ... ok (0ms)
ok | 5 passed | 0 failed (15ms)
```

### 6.3 Fails-on-revert (TWO independent revert paths)

**`fails-on-revert verified at ebd9875f7f99590315e69291dd196bdd27c8d802` (HEAD at QA time).**

**Revert path A — collapse the ternary to always-now:**

Procedure: backed up the fixed `index.ts` to `/tmp/orch_0845_qa_index_fixed.ts`. Replaced the line
```
const lowerBoundUtc: string =
  dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString();
```
with
```
const lowerBoundUtc: string = new Date().toISOString();
```
Re-ran tests:
```
ORCH-0845 adversarial — Tonight path uses window.startUtc, NOT now() (preserves ORCH-0839-A F-5) ... FAILED (1ms)
FAILED | 4 passed | 1 failed (13ms)
```
Attack 3 correctly caught the regression. Restored from backup; 5/5 PASS.

**Revert path B — hoist the upper bound out of the if-block:**

Procedure: replaced the `if (dateWindowUtc !== null) { q = q.lte("event_dates.start_at", dateWindowUtc.endUtc); }` block with `q = q.lte("event_dates.start_at", dateWindowUtc?.endUtc ?? "9999-01-01T00:00:00Z"); if (dateWindowUtc !== null) { /* hoisted out */ }`. Re-ran tests:
```
ORCH-0845 adversarial — upper bound .lte(event_dates.start_at, ...) stays INSIDE the if-block ... FAILED (0ms)
FAILED | 4 passed | 1 failed (14ms)
```
Attack 4 correctly caught the regression. Restored from backup; 5/5 PASS.

Both revert paths exercise distinct test blocks (Attack 3 ≠ Attack 4) — proving the adversarial test exercises multiple distinct invariants of the fix, not just one.

### 6.4 Combined run (implementor happy-path + adversarial + pre-existing ORCH-0828 contract)

```
$ deno test --allow-read supabase/functions/discover-merged-events/__tests__/
ok | 15 passed | 0 failed (160ms)
```

Breakdown: 4 ORCH-0828 [Consumer Discover timezone + sheet bugs] contract tests + 6 implementor happy-path tests + 5 my adversarial tests. No conflicts, no regressions in the pre-existing suite.

### 6.5 Append-only compliance (ORCH-0840 [Regression-test enforcement + append-only CI])

- Implementor's `excludes_ended_events.test.ts` was added in this ORCH (new file, not modified).
- My `end_at_boundary.test.ts` is added in this ORCH (new file, not modified).
- No existing test files were deleted or had lines removed.
- `git diff origin/main...HEAD --name-only` for the closing PR will include both new test files since both are untracked + ready to stage.

The append-only CI workflow (`.github/workflows/tests-append-only.yml`) will see only `??` entries for both test files — no modifications. Gate passes.

---

## 7. Cross-domain impact verification

I traced potential consumers of the changed code:

- `app-mobile/src/services/nightOutExperiencesService.ts` — calls `discover-merged-events` via the standard fetch pattern. Response shape (`DiscoverMergedResponse`: items[], meta{...}) is unchanged. No service or hook update required.
- `app-mobile/src/components/DiscoverScreen.tsx` and `app-mobile/src/contexts/RecommendationsContext.tsx` — consume the response shape. No field added/removed/renamed; consumers are unaffected.
- Mingla-business operator hub events list — uses a separate query directly against `events` (not the merged endpoint); unaffected.
- Mingla-admin — no Discover surface.
- Ticketmaster fan-out — same `discover-merged-events` function returns TM items alongside business events; live HTTP probe confirms 19 TM items returned in the SC-01 probe.

**No downstream consumer requires a change for this fix to work.**

---

## 8. Documents-updated check

The orchestrator's CLOSE protocol Step 1 will update these. Pre-CLOSE state at QA time:

| Document | Status pre-CLOSE | Required at CLOSE |
|----------|------------------|-------------------|
| `WORLD_MAP.md` | Row for ORCH-0845 already inserted at SPEC-dispatch turn (status: open, awaiting REVIEW) | Flip to `closed` + grade A + verified date + evidence links |
| `MASTER_BUG_LIST.md` | Not yet updated for ORCH-0845 | Add to Recently Closed |
| `COVERAGE_MAP.md` | Not yet updated | Update Discover surface grade |
| `PRODUCT_SNAPSHOT.md` | Not yet updated | Update grade counts |
| `PRIORITY_BOARD.md` | Not yet updated | No-op (ORCH-0845 was not on the top-20 — it was operator-direct intake) |
| `AGENT_HANDOFFS.md` | SPEC-dispatch banner present | Add IMPLEMENTOR + TESTER + CLOSE entries |
| `OPEN_INVESTIGATIONS.md` | "INVESTIGATION COMPLETE / SPEC DISPATCH READY" banner present | Flip to closed banner |
| `INVARIANT_REGISTRY.md` | I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE present as DRAFT | Flip status to ACTIVE |

Orchestrator owns these flips; not my scope.

---

## 9. Findings

### P0 — CRITICAL: 0

None.

### P1 — HIGH: 0

None.

### P2 — MEDIUM: 0

None.

### P3 — LOW: 1

**P3-001 — orchestrator probe scripts not committed.** The orchestrator's post-deploy SC-01/SC-02/SC-03 probes were run via `curl` + inline Python in the chat session. They were not saved as repeatable scripts. If a future operator wants to re-run the probes (e.g., after a rollback), they would need to reconstruct the curl commands from the chat history. Not a blocker — the test file `excludes_ended_events.test.ts` + the strict-grep gate + the post-deploy v8 verification together provide structural regression coverage. Saving the probes as a `Mingla_Artifacts/probes/orch_0845_post_deploy.sh` script could be done as a low-priority follow-up. **Fix instructions:** none required for CLOSE; treat as informational. If addressed later, save as a discoverable script with the SC-01/SC-02/SC-03 curl invocations and expected-output JSON assertions.

### P4 — NOTE: 4

**P4-001 — Implementor's structural test angle is excellent.** The `.gte` hoisting assertion in `excludes_ended_events.test.ts` is the right shape for a one-file edge-function fix. Pattern worth replicating for similar single-file structural fixes.

**P4-002 — Spec's pre-locked decisions saved a round-trip.** The orchestrator's resolution of §7 item-3 (EXCLUDE no-master-date events, backed by I-PROPOSED-AX) without operator round-trip is a good template for future SPEC dispatches. The reasoning is documented in the dispatch and verified at code-read time.

**P4-003 — Strict-grep gate is regex-style, not babel-AST.** Appropriate choice for a substring-presence check; matches the existing `i-ari-no-oklch.mjs` pattern. Avoid the babel-AST pattern for simple-substring gates — it's overkill.

**P4-004 — Orchestrator's intervening ORCH-0844 commit interaction was caught and recovered.** The implementor noticed the workflow-yml revert mid-session and re-applied. Worth documenting in a future ORCH about session-overlap hygiene; not a blocker here.

### Discoveries for Orchestrator (none new this ORCH)

- INVESTIGATION §8 discovery #1 (buyer-checkout `computeIsPast` `start+24h` heuristic) — already registered.
- INVESTIGATION §8 discovery #2 (`events.status='ended'` operator-set-only; no auto-flip) — already registered.

No new side issues surfaced during QA.

---

## 10. Confidence

`PASS, proven` — backend-only exemption claimed and justified; Deno test suite ran 15/15 green (4 pre-existing + 6 implementor + 5 adversarial); fails-on-revert verified on TWO independent revert paths exercising TWO distinct adversarial blocks; live HTTP probes against deployed v8 endpoint confirmed SC-01/SC-02/SC-03/SC-08/SC-09 PASS in production; strict-grep gate green; constitution 14-rule sweep clean; cross-domain consumers unaffected; append-only compliance verified.

---

## 11. Working-branch state

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

QA-scoped addition: `supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts` (new, untracked).

Final pre-CLOSE diff scope (matches SPEC SC-04 expectations + adversarial test):

```
 M .github/workflows/strict-grep-mingla-business.yml
 M Mingla_Artifacts/INVARIANT_REGISTRY.md
 M supabase/functions/discover-merged-events/index.ts
?? .github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md
?? Mingla_Artifacts/reports/QA_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS_REPORT.md  ← this file
?? Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md
?? supabase/functions/discover-merged-events/__tests__/end_at_boundary.test.ts
?? supabase/functions/discover-merged-events/__tests__/excludes_ended_events.test.ts
```

9 ORCH-0845 files total (3 modified + 6 untracked). The orchestrator's WORLD_MAP / OPEN_INVESTIGATIONS / AGENT_HANDOFFS dirty rows from the earlier SPEC-dispatch turn are still uncommitted and may be folded into the CLOSE commit. `supabase/functions/ticket-checkout-create/index.ts` is unrelated ORCH-0844 [Connect-account-ID per-PI] leftover and MUST NOT be staged.

---

## 12. Recommendation for orchestrator CLOSE

PROCEED. Verdict PASS, regression-test gate satisfied, all spec criteria PASS, deployment verified in production, no blocking issues. Orchestrator runs:

1. CLOSE Step 0.5 — regression-test gate: cite the implementor's `fails-on-revert verified at 47d8ca2de7c396c9b8e2a482a1d2b2226fe1848d` (implementation report §6.2) AND this QA's `fails-on-revert verified at ebd9875f7f99590315e69291dd196bdd27c8d802` (§6.3). Both tests at real `__tests__/` paths, both append-only.
2. CLOSE Step 1.5 — DIAG-marker reap for `[ORCH-0845-DIAG]` — expected zero matches (none planted during this ORCH).
3. CLOSE Step 1 — sync 7 artifact docs.
4. CLOSE Step 2 — commit message.
5. CLOSE Step 3 — EAS OTA is NOT required (no mobile code changed). Note: post-deploy is already live via the edge-function deploy. Optionally note in CLOSE banner that consumers will pick up the new behavior on next API call (no client cache to bust).
6. CLOSE Step 4 — announce next priority. ORCH-0845 follow-ups (INVESTIGATION §8 discoveries #1 + #2) remain in the registered-but-unscheduled backlog.

Pre-merge gate: standard 5-condition gate — required checks green, no conflicts, reviews if required, not BEHIND, operator confirms.
