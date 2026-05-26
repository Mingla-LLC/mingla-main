# REVIEW — META-ORCH-0972 Sub-D (CI gates + Q15 parser regate + edge-deploy handoff)

**Reviewer:** Claude `mingla-orchestrator`
**Mode:** REVIEW (post-implementation, with orchestrator-owned edge deploys executed in-session)
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Reviewed commit:** `7c7da04b8` ("META-ORCH-0972 Sub-D strict-grep and parser gates")
**Baseline:** `a1c1d7f70` (Sub-C live on remote per prior turn)

---

## Verdict

**APPROVED + DEPLOYS EXECUTED — proceed to Claude `mingla-tester` for Sub-D PASS with adversarial regression test.**

Sub-D delivers exactly what SPEC §Sub-spec D requires and nothing more: two new META-ORCH-0972 strict-grep gates wired to CI, the ORCH-0963 gate cleanly renamed/reshaped (kind branches stripped, route segregation preserved), ORCH-0855 adversarial gate stripped of A-07/A-13 (deletable per SPEC §F.1), the Q15 `temporaryCategory` parser regate threaded all the way through to the Gemini `systemInstruction` prompt for both restaurant menu and play activities, and the implementor happy-path regression test that proves the new `no-brand-kind-reads` gate actually fires on a planted offender. All 4 orchestrator-owned edge function deploys completed cleanly with single-step version bumps; `verify_jwt: true` preserved on all 4 per `supabase/config.toml` default; new sha256 hashes confirm fresh bundles on remote.

Three forward-flags for CLOSE (see §Carry-forward below).

---

## Commit-hash verification (MANDATORY — codified DEC-179 / ORCH-0959)

All 11 production / test files resolve to commit `7c7da04b8` on the per-ORCH branch. No file is modified-but-uncommitted.

| File | Commit |
|---|---|
| `.github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | `7c7da04b8` |
| `.github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` | `7c7da04b8` |
| `.github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` | `7c7da04b8` |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `7c7da04b8` |
| `.github/workflows/strict-grep-mingla-business.yml` | `7c7da04b8` |
| `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` | `7c7da04b8` |
| `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` | `7c7da04b8` |
| `supabase/functions/_shared/geminiMenuParser.ts` | `7c7da04b8` |
| `supabase/functions/_shared/geminiActivitiesParser.ts` | `7c7da04b8` |
| `supabase/functions/parse-restaurant-menu/index.ts` | `7c7da04b8` |
| `supabase/functions/parse-play-activities/index.ts` | `7c7da04b8` |

Old ORCH-0963 gate (`orch-0963-public-brand-kind-branched.mjs`) confirmed DELETED from working tree per `[ -f ... ]` test. Diff scope: 12 files, +422 / −112.

---

## Dependency walk (MANDATORY — codified DEC-179 / ORCH-0959)

Two config-layer surfaces touched in this commit: the strict-grep workflow yml and the ORCH-0863 backend allowlist script. Both required explicit consumer review.

### Workflow yml (`.github/workflows/strict-grep-mingla-business.yml`)

Three changes inside the existing `jobs:` block, all surgical:

1. **Rename** the existing `orch-0963-public-brand-kind-branched` job to `orch-0963-public-trip-rpc-and-route-segregation` + point its `run:` line at the renamed script.
2. **Add** new job `meta-orch-0972-data-driven-tabs` (10-line standard pattern: actions/checkout@v4 + setup-node@v4 with node-version 20 + `node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs`).
3. **Add** new job `meta-orch-0972-no-brand-kind-reads` (same shape).

| Consumer | Compatibility |
|---|---|
| Workflow trigger block (on: pull_request / push) | UNAFFECTED — top-level triggers unchanged. |
| Existing 30+ jobs above and below the changed block | UNAFFECTED — appended jobs run in parallel; renamed job retains its position. |
| Branch-protection required-checks (if configured to require the old name) | POTENTIAL ATTENTION — if branch protection rules reference the old check name `ORCH-0963: public brand page kind-branched`, the new name `ORCH-0963: public trip RPC and route segregation` needs to be re-pinned. Flagged for CLOSE; tester should also surface this if the eventual PR check status displays an orphaned old-name check. |
| GitHub Actions concurrency / cancel-in-progress | UNAFFECTED — no shared `concurrency:` keys touched. |

### Strict-grep script `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

Three lines added to `ORCH_0972_BACKEND_ALLOWLIST`:

```js
"supabase/functions/_shared/geminiMenuParser.ts",
"supabase/functions/_shared/geminiActivitiesParser.ts",
"supabase/migrations/20260730000000_meta_orch_0972_drop_brand_kind.sql",
```

| Consumer | Compatibility |
|---|---|
| `checkNoNewBackendFiles()` allowlist spread at call site | UNAFFECTED — set-union widens for Sub-D's parser touches; the Stage 4 placeholder is forward-looking and harmless (the file doesn't exist yet, but having it pre-allowlisted means the Stage 4 commit can land without a parallel allowlist edit). |
| Other ORCH allowlists in the same file | UNAFFECTED. |

**Conclusion:** dependency walk PASSES. One operator-side note flagged for branch-protection re-pin if relevant.

---

## Hard-guard verification

| Guard | Status | Evidence |
|---|---|---|
| Sub-A immutable | HELD | `git merge-base --is-ancestor fee178634 HEAD` PASS; no diff touches Sub-A files. |
| Sub-B immutable | HELD | Zero touches to BrandCreationFlow, OfferingChooser, useHubTabs, BrandSwitcherSheet, native Stripe boundary/wrapper, checkout payment screens, all 4 Sub-B Android jest files, hub/home tabs, `app/_layout.tsx`, `metro.config.js`. |
| Sub-C immutable | HELD | Zero touches to `PublicBrandPage.tsx`, `ExperienceMiniCard.tsx`, `NextEventTeaser.tsx`, `publicEventsService.ts`, `useBrandOfferingCounts.ts`, `types/brand.ts`, the live `20260729000000_meta_orch_0972_universal_authoring.sql` migration. |
| No new migration | HELD | `git diff --name-only a1c1d7f70..HEAD \| grep '^supabase/migrations/'` returns empty. |
| Stage 4 brands.kind removal NOT attempted | HELD | No `DROP COLUMN`, no `brands_kind_check` constraint drop anywhere in diff. The Stage 4 migration filename is only an allowlist placeholder — the actual SQL file is not in this commit. |
| No `supabase db push` run by implementor | HELD per report §10. |
| No `supabase functions deploy` run by implementor | HELD per report §10 (deploys are orchestrator-owned, executed below). |
| No PR opened | HELD per report §10. |
| No `[deploy]` tag in commit message | HELD — subject is "META-ORCH-0972 Sub-D strict-grep and parser gates". |
| Preserved adversarial commit | HELD — `git merge-base --is-ancestor 411925909 HEAD` PASS. |
| No package or lockfile changes | HELD — `git diff --name-only a1c1d7f70..HEAD \| grep -E 'package\.json\|package-lock\|yarn\.lock'` empty. |
| No Brand.kind reintroduction | HELD — every `+` hit on `brand.kind` / `currentBrand.kind` is an ANTI-reintroduction assertion inside the new gates / test fixture / report, not a real read. |

---

## Local gate + test verification

All run by the orchestrator from the worktree:

| Check | Result |
|---|---|
| `node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | PASS — "N1-N4 all passed" |
| `node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` | PASS — "D1-D4 all passed" |
| `node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` | PASS — C2/C4 preserved (`pg_public_trips_by_brand` RPC call site + no-positive-event-type-trip-filter); C1/C3 (kind branches) correctly removed |
| `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS — C7 allowlist gate green, 214 changed files surveyed, zero offenders |
| `npx jest --runInBand __tests__/strictGrep/noBrandKindReads.test.ts` | PASS — 1 suite, 1 test, 2.99s. SC-D-8 fixture asserts the new gate exits non-zero against a planted `brand.kind` read in a temp dir |
| ORCH-0855 script not workflow-wired | CONFIRMED — `grep -rn "orch-0855" .github/workflows/` returns empty; the "EXPECTED FAIL" implementor noted in §7 is harmless because nothing in CI runs it |
| Stale ORCH-0963 job removed from workflow | CONFIRMED — `grep "orch-0963-public-brand-kind-branched" .github/workflows/` returns empty |
| New META-ORCH-0972 jobs wired | CONFIRMED — both jobs present at lines 192 + 203 of the workflow yml |
| Parser Q15 regate end-to-end | VERIFIED — `parse-restaurant-menu/index.ts:169` passes `temporaryCategory` to `parseMenuWithGemini`; `geminiMenuParser.ts` accepts it (default `"restaurant"`) and prepends `"You are parsing a ${temporaryCategory} menu.\n\n${SYSTEM_PROMPT}"` to the Gemini `systemInstruction`; same shape for play-activities side; no `UPDATE brands SET venue_category` anywhere in changed files |

---

## Orchestrator-owned edge function deploys (executed this turn)

Per `feedback_orchestrator_deploys_edge_functions.md` and the dispatch's expected output, I deployed all 4 functions enumerated in implementor §8 and verified version bumps via `mcp__supabase__list_edge_functions`.

| Function | Pre-deploy version | Post-deploy version | Δ | verify_jwt preserved | New ezbr_sha256 (first 16) |
|---|---|---|---|---|---|
| `parse-restaurant-menu` | 38 | **39** | +1 | true ✓ | `460855d4f2d501d4...` |
| `parse-play-activities` | 37 | **38** | +1 | true ✓ | `d3f83568544965c1...` |
| `agent-chat` | 71 | **72** | +1 | true ✓ | `0e2e34241ef3412f...` |
| `agent-confirm-action` | 66 | **67** | +1 | true ✓ | `26af7ed1d63019d8...` |

All four bundled cleanly (script sizes 110.1–129.1 kB) and report `Deployed Functions on project gqnoajqerqhnvulmnyvv: <name>`. `updated_at` timestamps cluster at `1779761439–1779761492` (the deploy moment), distinct from the pre-deploy `1779695...` baseline. The `entrypoint_path` for all 4 now reflects the META-ORCH-0972 worktree path (`/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/supabase/functions/<name>/index.ts`), confirming deploys came from the correct source tree.

**SC-D-1 / SC-D-9 cleared.** Tester can now exercise the live functions; recommended single curl sanity per function (non-404 response) is below in §Tester handoff.

---

## Regression-test gate (Step 0.5 implementor half — confirmed)

| Test path | Tests | Result | Annotation |
|---|---|---|---|
| `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` | 1 (SC-D-8) | PASS at HEAD | Implementor §6 cites "fails-on-revert verified at `a1c1d7f70`" — temporary removal of the new no-brand-kind gate script produced expected Jest failure, then restoration produced PASS |

**Adversarial half (tester-side) required at PASS.** Recommended angles for the tester (per Step 0.5 + the deploy now being live):

1. Plant a `brand.kind === 'physical'` read inside an `mingla-business/app/` file (not just `src/`) and assert the gate catches it — exercises the gate's `app/` coverage in addition to the implementor-tested `src/` path.
2. Plant a `currentBrand.kind` read and confirm the data-driven-tabs gate catches it in `PublicBrandPage.tsx` / hub layout (different gate, different scope than implementor test).
3. Call `parse-restaurant-menu` with a real authenticated JWT against the live function, capture the Gemini request payload via function logs, assert the `systemInstruction` text contains `"You are parsing a restaurant menu."` (proves the Q15 `temporaryCategory` actually reaches the prompt layer, not just the request body).
4. Anon vs authenticated grant differential on `pg_brand_offering_counts` (Sub-C contract) — verify the new no-brand-kind world still respects the SECURITY DEFINER authentication boundary.

---

## Cross-ORCH / Comms-Ledger ack

Read on entry; the implementor's report §2 cites that COMMS-0002/0003/0004 were already acked on anchor `main` at commit `c29aaf51e`, so the ledger row updates exist. WARN entries scanned this turn:

- **COMMS-0001** (→ ORCH-0955): N/A.
- **COMMS-0002** (ALL, backend strict-grep allowlist): **HELD** — Sub-D's 3 new backend-allowlist entries (`geminiMenuParser.ts`, `geminiActivitiesParser.ts`, the Stage 4 placeholder migration filename) landed in the SAME commit as the parser source edits + workflow wiring.
- **COMMS-0003** (ALL, external-API docs gate): N/A material — the Gemini `temporaryCategory` thread is a prompt-text prepend, not an endpoint/enum/payload change. The Gemini request shape (`contents`, `systemInstruction`, `generationConfig`) is unchanged.
- **COMMS-0004** (ALL, INTAKE collision SOP): N/A — REVIEW phase, no new ORCH-ID.
- **COMMS-0005** (→ ORCH-0964): N/A — Sub-D does not touch `PublicBrandPage.tsx`.

---

## Carry-forward at CLOSE (not REVIEW blockers; flag for the closing orchestrator)

1. **GitHub branch-protection re-pin** — if `main` branch-protection requires the old check name `ORCH-0963: public brand page kind-branched`, re-pin to `ORCH-0963: public trip RPC and route segregation` before merging the final META-ORCH-0972 CLOSE PR. If branch protection doesn't enumerate this specific check, no action needed.
2. **`[TEST-MOD-APPROVED META-ORCH-0972]` cumulative tag** — required in the final PR squash body. Sub-D modified zero pre-existing tests, but the cumulative obligation from Sub-B (2 tests) + Sub-C (11 tests) still stands. Without the tag, the `tests-append-only` CI gate will reject the merge.
3. **Stage 4 follow-up decision** — `DROP CONSTRAINT brands_kind_check` + `DROP COLUMN brands.kind` is intentionally NOT in this commit. Per SPEC §Phase 5 and the "Stage 4 follow-up migration" allowlist placeholder (`20260730000000_meta_orch_0972_drop_brand_kind.sql`), this ships in a separate commit on the SAME per-ORCH branch (if scope allows) OR a new ORCH (your call) ≥1 release cycle after the META-ORCH-0972 final close. Optional 14-day archive snapshot if any live rows carry meaningful `kind` values at the time of drop — there are 21 live brands per the Sub-C probe, so an archive snapshot is the safer default.

---

## Routing

Forward → Claude `mingla-tester` for META-ORCH-0972 Sub-D PASS verification with the adversarial regression test required by Step 0.5. Tester also covers the live edge smoke required by SC-D-9 (one authenticated curl per deployed function, expecting non-404 + correct 200/4xx validation). On PASS, control returns to Claude `mingla-orchestrator` for the Stage 4 follow-up decision and final META-ORCH-0972 CLOSE PR sequencing.

**No NEEDS WORK, no REJECTED items.** Verdict stands: APPROVED + DEPLOYS EXECUTED + VERSION-BUMPS VERIFIED.
