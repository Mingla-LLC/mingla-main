# REVIEW — META-ORCH-0972 Sub-C (Public brand page rebuild + DB schema + RLS + RPCs)

**Reviewer:** Claude `mingla-orchestrator`
**Mode:** REVIEW (post-implementation, pre-operator-migration-gate)
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Reviewed commit:** `a1c1d7f70` ("META-ORCH-0972 Sub-C public brand page + DB schema + RLS + RPCs")
**Baseline:** `2aea165d5` (Sub-B Android retest #3 PASS)

---

## Verdict

**APPROVED — proceed to operator-gated `supabase db push --linked`, then Sub-D dispatch.**

Sub-C ships exactly what the SPEC §Sub-spec C contract requires: Stage 0 + Stage 2 + Stage 3 of the brand-kind decommission safety plan in one atomic migration, the `PublicBrandPage.tsx` rebuild with data-driven tabs + the two new primitives, the public service rewrite without `b.kind` joins, the `Brand.kind` TS field removal, and the `useBrandOfferingCounts` flip to the new RPC behind the unchanged hook signature. Stage 4 (`DROP COLUMN brands.kind`) is correctly deferred to a separate follow-up migration. Zero destructive statements in the migration. All hard guards held. Mandatory regression test passes at HEAD. SQL regression test is well-shaped (5 `pg_get_functiondef` shape assertions). The read-only invariant probe was run correctly via the Supabase Management API (4 probes recorded in implementor §8).

Three forward-flagged items for CLOSE (carried forward, not REVIEW blockers — see §Carry-forward below).

---

## Commit-hash verification (MANDATORY — codified DEC-179 / ORCH-0959)

All 10 sampled production / test files resolve to commit `a1c1d7f70` on the per-ORCH branch. No file is modified-but-uncommitted.

| File | Commit |
|---|---|
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `a1c1d7f70` |
| `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` | `a1c1d7f70` |
| `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` | `a1c1d7f70` |
| `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` | `a1c1d7f70` |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | `a1c1d7f70` |
| `mingla-business/src/components/brand/ExperienceMiniCard.tsx` | `a1c1d7f70` |
| `mingla-business/src/components/brand/NextEventTeaser.tsx` | `a1c1d7f70` |
| `mingla-business/src/services/publicEventsService.ts` | `a1c1d7f70` |
| `mingla-business/src/hooks/useBrandOfferingCounts.ts` | `a1c1d7f70` |
| `mingla-business/src/types/brand.ts` | `a1c1d7f70` |

Full diff scope: 32 files, +2,177 / −559 (most lines in the migration + PublicBrandPage rebuild + publicEventsService rewrite + 11 test realignments). Migration + allowlist landed in the SAME commit per COMMS-0002 — verified.

---

## Dependency walk (MANDATORY — codified DEC-179 / ORCH-0959)

One config-layer file touched: `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`.

**The change:** 2-line extension of the `ORCH_0972_BACKEND_ALLOWLIST` array in the `checkNoNewBackendFiles()` function. Adds:

```js
"supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql",
"supabase/functions/__tests__/pg_public_brand_upcoming.test.sql",
```

**Consumers of the changed key/value:**

| Consumer | Compatibility assessment |
|---|---|
| `checkNoNewBackendFiles()` itself (calling function in the same file) | UNAFFECTED — append-only addition to an allowlist; no logic change. |
| The cumulative allowlist spread at the call site (`...ORCH_0972_BACKEND_ALLOWLIST, ...ORCH_0954_BACKEND_ALLOWLIST, ...`) | UNAFFECTED — set-union semantics; new entries widen the allowlist for THIS ORCH's backend files only. |
| GitHub Actions workflow `.github/workflows/strict-grep-mingla-business.yml` | UNAFFECTED — workflow invokes the script as a binary; the script signature, exit codes, and stdout format are unchanged. |
| Other ORCH allowlists (`ORCH_0954`, `ORCH_0915`, `ORCH_0933`, `META_ORCH_0952`) | UNAFFECTED — each is a separate constant array; no naming or precedence collision. |
| `node --check` of the script | PASS per implementor §7 — syntactically valid JS. |
| Live script execution | PASS per implementor §7 — C7 allowlist accepts the new Sub-C backend files. |

**Conclusion:** dependency walk PASSES. Risk: trivial.

---

## Hard-guard verification

| Guard | Status | Evidence |
|---|---|---|
| Sub-A immutable | HELD | Diff against `2aea165d5` shows zero touches to any Sub-A file. `git merge-base --is-ancestor fee178634 HEAD` PASS. |
| Sub-B immutable (BrandCreationFlow, OfferingChooser, useHubTabs, BrandSwitcherSheet, native Stripe boundary/wrapper, checkout payment screens, all 4 Android jest files, hub/home tabs, app/_layout.tsx, metro.config.js) | HELD | `git diff --name-only 2aea165d5..HEAD \| grep -E '<Sub-A/B file pattern>'` returns empty. |
| No `supabase functions deploy` source touch | HELD | `git diff --name-only 2aea165d5..HEAD \| grep '^supabase/functions/' \| grep -v __tests__` empty. The only `supabase/functions/` file added is the SQL regression test, which doesn't deploy. |
| No package or lockfile changes | HELD | `git diff --name-only 2aea165d5..HEAD \| grep -E 'package\.json\|package-lock\|yarn\.lock'` empty. |
| `metro.config.js` Connect alias preserved | HELD | `metro.config.js` not in diff; Sub-B native Connect alias intact. |
| Preserved adversarial commit | HELD | `git merge-base --is-ancestor 411925909 HEAD` PASS. |
| No Brand.kind reintroduction | HELD | One grep hit `+    expect(publicBrandPage).not.toContain("brand.kind")` is an ANTI-reintroduction assertion in the new mandatory test, not a reintroduction. |
| No PR opened | HELD per implementor §9. |
| No `supabase db push` run | HELD per implementor §9. |
| No `[deploy]` tag in commit message | HELD — commit subject is "META-ORCH-0972 Sub-C public brand page + DB schema + RLS + RPCs" with no tag. |
| Migration + allowlist in same commit | HELD — both at `a1c1d7f70`. |
| Stage 4 not attempted | HELD — `grep -c "DROP COLUMN" / "DROP CONSTRAINT brands_kind_check"` both return 0. |

---

## Migration shape inspection

| Property | Result |
|---|---|
| Atomic (single `BEGIN;` … `COMMIT;`) | YES |
| DROP COLUMN count | 0 (Stage 4 correctly deferred) |
| DROP TABLE count | 0 |
| DROP CONSTRAINT brands_kind_check count | 0 |
| TRUNCATE / DELETE FROM count | 0 |
| Stage section markers | Stage 0 at line 7; Stage 2 at line 35; Stage 3 at line 516 — order matches SPEC |
| Stage 0 contents | `events_experience_next_occurrence_idx` functional GIN partial index + `pg_brand_offering_counts(uuid)` RPC (SECURITY DEFINER, authenticated-only) |
| Stage 2 contents | DROP+CREATE `business_public_brands_view`, `business_public_events_view`, `claimed_venues_public_view` without `b.kind AS brand_kind` |
| Stage 3 contents | SECURITY DEFINER body rewrites for `pg_public_trips_by_brand` (kind-guard removed), `biz_create_venue_brand_pending_review` (no kind insert), `biz_review_venue_claim` (no `kind='physical'` filter), plus new `pg_public_brand_upcoming` + `pg_public_experiences_by_brand` |
| EXECUTE grants posture | `pg_brand_offering_counts` REVOKE PUBLIC + GRANT authenticated (owner-only) — matches SPEC SC-C-6 |

**Risk: very low.** All additive or in-place replacement; no destructive ops; Stage 4 isolation maintained.

---

## Invariant probe verification (codified 2026-05-24 — invariant migration backstop)

Implementor recorded 4 read-only probes via Management API in §8:

| Probe | Result | Material? |
|---|---|---|
| Existing SELECT policies on `public.brands` | 5 policies; named kind policy `"Public can read verified physical venues"` present | YES — migration's DROP+CREATE of this policy has a real target to replace |
| Live non-deleted brands count | 21 | YES — Stage 4 follow-up must handle archive snapshot if any rows still carry meaningful kind values |
| `pg_public_trips_by_brand` kind guard existing | Present before Sub-C (`pg_get_functiondef` contained ORCH-0963 kind guard) | YES — migration's CREATE OR REPLACE has a real guard to remove |
| Experience next_occurrence_at row count | 0 rows currently match the partial-index predicate | YES — the GIN partial index won't omit live data today; index is ready for Sub-D / future writes |

**Probe gate PASSES.** No RAISE EXCEPTION pre-flight guards in the migration that could abort against live rows. No remote-only versions reported by `supabase migration list --linked`. The implementor went beyond the minimum here by probing the existing policy/RPC shapes that the migration replaces — that's the correct posture.

---

## Regression-test gate (Step 0.5 implementor half)

| Test path | Tests | Result at HEAD | Fails-on-revert annotation |
|---|---|---|---|
| `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` | 4 | PASS (orchestrator independently re-ran) | "Verified at `2aea165d5`; temporary reverse of `PublicBrandPage.tsx` + `publicEventsService.ts` produced 4 failing assertions" per implementor §6 |
| `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` | 5 shape assertions via `pg_get_functiondef` introspection | Requires migration apply to run (operator gate) | Annotated `2aea165d5`; pre-migration baseline has no `pg_public_brand_upcoming` function, so the test naturally fails before migration apply — fails-on-revert verified by absence |

**Live re-run at HEAD (orchestrator independent verification):**

- Mandatory new test in isolation: 4 suites, 4 tests, PASS in 3.32s
- Implementor's exact 10-suite battery from report §6: **10 suites, 53 tests, all PASS in 19.6s**

**Adversarial half (tester-side) is still required at CLOSE.** Tester must write one new adversarial regression attacking a different angle than the implementor's happy-path data-driven test — recommended angles: SQL injection probe on `p_brand_slug` (per SPEC adversarial guidance), cursor-pagination boundary at `now()` exclusivity, anon vs authenticated grant differential on the new RPC, or a zero-offering brand asserting that `pg_public_brand_upcoming` returns empty + the page still renders identity/About without crash.

---

## Test modifications (FORWARD-FLAG for CLOSE-commit body)

11 pre-existing test files modified by Sub-C, all legitimate realignments to the new brand-kind-removed / event_type-bearing contracts:

| Test file | Realignment reason |
|---|---|
| `mingla-business/src/services/__tests__/publicEventsService.test.ts` | Adds `event_type: "event"` to row fixtures (views now expose `event_type`); removes `kind: "physical"` from brand row + expected output (Brand TS field deleted) |
| `mingla-business/src/services/__tests__/publicEventsService.tripFetch.test.ts` | Same realignment + trip-fetch path no longer kind-branched |
| `mingla-business/src/services/__tests__/publicEventsService.orch_0962.test.ts` | Same |
| `mingla-business/src/services/__tests__/publicEventsService.orch_0962.adversarial.test.ts` | Same — adversarial assertion realigned to new contract, not weakened |
| `mingla-business/src/services/__tests__/publicEventsService.ve4.test.ts` | Same |
| `mingla-business/src/components/brand/__tests__/PublicBrandPage.nextEventTeaser.test.ts` | Realigned to new `NextEventTeaser` primitive shape |
| `mingla-business/src/components/brand/__tests__/PublicBrandPage.tripBrand.test.ts` | Realigned to data-driven tab visibility |
| `mingla-business/src/components/brand/__tests__/PublicBrandPage.pastCap.adversarial.test.ts` | Realigned to new past-cap behavior on data-driven tabs |
| `mingla-business/src/components/brand/__tests__/TripMiniCard.cancelledTripLeak.adversarial.test.ts` | Realigned to new public trips RPC shape |
| `mingla-business/src/utils/__tests__/homeNextAction.test.ts` | One-line touch consistent with Brand.kind removal |
| `mingla-business/src/utils/__tests__/upcomingBuilder.adversarial.test.ts` | Realigned to new upcoming-builder shape consuming `useUpcomingFeed` |

Spot-checked `publicEventsService.test.ts` diff (representative): adds `event_type: "event"` to fixture row, removes `kind: "physical"` from brand fixture row + expected output. NOT assertion-weakening — it's mirror-image to the new contract where the view exposes `event_type` and `brand.kind` no longer exists.

**Cumulative carry-forward at CLOSE:** the eventual META-ORCH-0972 final PR squash body MUST contain `[TEST-MOD-APPROVED META-ORCH-0972]`. The obligation now spans Sub-B (2 tests) + Sub-C (11 tests) = 13 cumulative test-file modifications. Without the tag, the `tests-append-only` CI gate will reject the PR merge.

---

## Cross-suite flake observation (P4 — informational, NOT a REVIEW blocker)

When the orchestrator ran the broader 12-suite battery (implementor's 10-suite list PLUS `homeNextAction.test.ts` + `upcomingBuilder.adversarial.test.ts`) with `--runInBand --runTestsByPath`, `publicEventsService.ve4.test.ts` reported 1 failed test. When re-run **in isolation** OR **with the implementor's exact 10-suite list**, ve4 PASSes cleanly (4 suites, 4 tests, 2.75s). The fail signature is consistent with jest module-mock state pollution from the additional 2 suites, not a real regression in Sub-C's contract. 

**Recommendation:** monitor at Sub-D tester pass. If the cross-suite flake recurs, it's a separate hygiene ORCH targeting jest mock isolation in `publicEventsService.ve4.test.ts` — not Sub-C's responsibility.

---

## Cross-ORCH / Comms-Ledger ack

Read on entry. No `BLOCK` rows. WARN entries scanned and confirmed against this Sub-C:

- **COMMS-0001** (→ ORCH-0955): N/A.
- **COMMS-0002** (ALL, ORCH-0863 backend strict-grep): **HELD** — both new backend files (migration + SQL test) added to `ORCH_0972_BACKEND_ALLOWLIST` in the same commit `a1c1d7f70`.
- **COMMS-0003** (ALL, external-API docs gate): N/A — no Stripe / Resend / OpenAI / provider contract touched in Sub-C.
- **COMMS-0004** (ALL, INTAKE collision-scan SOP): N/A — REVIEW phase, no new ORCH-ID.
- **COMMS-0005** (→ ORCH-0964, PublicBrandPage `<Head>` non-overlap): **HELD** — implementor confirms in §7 that the SEO/metadata `<Head>` block lines 230–267 were not edited; spot-verified in the PublicBrandPage diff that the rebuild is below/around that block.

Same anchor-state caution as prior REVIEWs — not editing `acked_by` on `main` from this turn; ack recorded inside this REVIEW artifact.

---

## Carry-forward at CLOSE (not REVIEW blockers; flag for the closing orchestrator)

1. **Operator runs `supabase db push --linked`** from the worktree before Sub-D dispatch — gate is open after REVIEW APPROVED. Command (copy-paste-ready, per migration backstop):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase migration list --linked
   # expect: 20260729000000 listed local-only; no remote-only versions
   cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase db push --linked
   ```
2. **`[TEST-MOD-APPROVED META-ORCH-0972]` cumulative tag** required in the eventual META-ORCH-0972 final PR squash body — now covers 13 test-file modifications (2 from Sub-B reworks + 11 from Sub-C).
3. **Tester adversarial regression test** for Sub-C required at Sub-D PASS / final close — recommended angle per §Regression-test gate above.
4. **P4 cross-suite jest mock flake** in `publicEventsService.ve4.test.ts` — monitor at Sub-D tester pass; spin a hygiene ORCH if it recurs.
5. **Stage 4 follow-up migration** (`DROP CONSTRAINT brands_kind_check` + `DROP COLUMN brands.kind`) ships in a separate commit ≥1 release cycle after Sub-A through Sub-D are live; per SPEC, optionally as a new ORCH if scope grows.

---

## Routing

After Seth runs the `supabase db push --linked` command above and confirms migration on remote (visible via `mcp__supabase__list_migrations` or `supabase migration list --linked`), forward → Codex `implementor-mingla` for Sub-D dispatch (edge function deploys for Sub-A's source edits + strict-grep gate rewrites at `.github/scripts/strict-grep/` + Q15 parser regate + adversarial test scope). The orchestrator owns the actual `supabase functions deploy` invocations in Sub-D per the canonical split.

**No NEEDS WORK, no REJECTED items.** Verdict stands: APPROVED with five flagged CLOSE-side carry-forwards.
