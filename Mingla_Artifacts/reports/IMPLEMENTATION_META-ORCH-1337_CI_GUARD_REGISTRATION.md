# IMPLEMENTATION — META-ORCH-1337 [social-proof-guest-list] CI-GUARD REGISTRATION

**Phase:** IMPLEMENT (infrastructure leg — CI registration only, zero product-code change)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`
**Base at dispatch:** `8185ab49f` · **Workflow commit:** `33a581b12`
**Date:** 2026-07-10

---

## 1. Summary

Before this pass, the META's ~200 new regression assertions (Deno + jest, legs ORCH-1338→1342 plus the rewritten ORCH-1157 momentum suites) ran only on developer machines, and ORCH-1342's two strict-grep gates existed on disk but no CI job ever executed them. A revert of any guarded invariant would have merged green. Now:

1. Both ORCH-1342 gates are registered jobs in `Strict Grep Gates (Mingla Business)` (self-test before real run, house pattern).
2. A new workflow `META-ORCH-1337 Social-Proof + Guest-List Tests` executes all 15 Deno suites (164 tests) and all 5 mingla-business jest suites (63 tests) via EXPLICIT file lists on every PR/push touching the guarded source trees.

Every registered suite was verified GREEN on this branch before registration. Red/green proven end-to-end (Section 7).

## 2. What runs where

### 2a. `.github/workflows/strict-grep-mingla-business.yml` (edited)

| New job | Script | Steps |
|---|---|---|
| `orch-1342-landing-single-parse` | `.github/scripts/strict-grep/orch-1342-landing-single-parse.mjs` | `--self-test` (7/7) then real run — deep_link_sub3 parsed ONLY in oneLinkResolver.ts; dispatcher composes `?landing=guest-list` at its ONE point |
| `orch-1342-store-links-ssot` | `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` | `--self-test` (10/10) then real run — store links SSOT byte-equal to marketing; no store/OneLink literals outside it |

Both follow the sibling pattern exactly (`actions/checkout@v4`, `actions/setup-node@v4` node `"20"`, self-test step gating the real-run step — same as `orch-1328-links-cta-opens-store-clientside` / `orch-1303-web-cover-video-uri`). Two doc-comment registry lines added to the workflow's "Currently registered gates" block (after the ORCH-1328 entry), describing REQUIRE/BAN scope per the scripts' headers. No path-filter change needed: the workflow already fires on `app-mobile/**`, `mingla-business/**`, `mingla-marketing/**`, `.github/scripts/strict-grep/**`, and itself.

### 2b. `.github/workflows/meta-orch-1337-social-proof-tests.yml` (new)

**Job `meta-1337-deno-suites`** — `denoland/setup-deno@v1` pinned `deno-version: "1.46.x"` (repo-wide idiom), inert `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` defaults, retry-3 loop (esm.sh-flake idiom copied from `supabase-migrations-and-stripe-deno.yml`), explicit `DENO_TEST_FILES` array — **no globbing**:

```
packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts
packages/offering-rendering/__tests__/orch_1339_momentum_cross_entity.test.ts
packages/offering-rendering/__tests__/orch_1339_momentum_adversarial.test.ts
packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy.test.ts
packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy_adversarial.test.ts
packages/offering-rendering/__tests__/orch_1157_rsvp_momentum.test.ts            (REWRITTEN, [TEST-MOD-APPROVED ORCH-1340])
packages/offering-rendering/__tests__/orch_1157_rsvp_momentum_adversarial.test.ts
supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts
supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts
supabase/migrations/__tests__/orch_1339_set_event_guest_privacy.test.ts
app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts
app-mobile/src/components/__tests__/orch_1341_guest_list_sheet_adversarial.test.ts
app-mobile/src/screens/Event/__tests__/orch_1342_cold_seed_landing.test.ts
app-mobile/src/services/__tests__/oneLinkResolver.orch1342.test.ts
app-mobile/src/services/__tests__/publicEventSeedService.orch1342.test.ts
```

Command (verbatim, inside the retry loop): `deno test --allow-env --allow-net --allow-read --no-check "${DENO_TEST_FILES[@]}"`

**Job `meta-1337-business-jest-suites`** — copied from the house jest idiom (`production-readiness-audit.yml` job `feature-flags`): `working-directory: mingla-business`, node `"20"` with `cache: npm` keyed on `mingla-business/package-lock.json`, `npm ci`, then:

```
npx jest
  src/components/trip/__tests__/orch_1339_trip_guest_privacy.test.ts
  src/components/experience/__tests__/orch_1339_experience_guest_privacy.test.ts
  src/components/checkout/__tests__/orch_1342_download_cta_ssot.test.ts
  src/components/event/__tests__/orch_1342_see_whos_going_gate.test.tsx
  src/services/__tests__/orch_1342_guest_funnel_link.test.ts
  --runInBand
```

**Jest CI finding (dispatch Q):** no existing workflow runs a general mingla-business or app-mobile jest pass on PRs. The ONLY jest in CI was `production-readiness-audit.yml` running the single explicit file `src/config/__tests__/featureFlags.test.ts`. So the 1339/1342 jest suites were NOT picked up by any existing job — the new pinned job above was required (not just documentation).

### 2c. Excluded by design

The 5 known pre-existing-red stale families are deliberately NOT registered: `orch_1163_r3_rsvp_floating_active`, `orch_1157_round8/round9` (T-7/T-8), 1150 T-10b/c, 1138 T5/E4. The explicit-list pattern exists precisely so these cannot leak in via a glob.

## 3. Path filters (dispatch item 3)

New workflow fires on push (`[Seth, main]`) + `pull_request`, identical path lists (verified programmatically):

- `packages/offering-rendering/**` — shared RSVP/social-proof bodies (1338/1339/1340/1157 guarded sources)
- `app-mobile/app/**` + `app-mobile/src/**` — OneLink resolver/dispatcher, cold-seed service, guest-list sheet (1341/1342); deliberately broader than the exact files (a filter that misses a future edit silently skips the guard)
- `mingla-business/app/**` + `mingla-business/src/**` — see-who's-going gate, funnel-link builder, store-links SSOT (1339/1342)
- `mingla-marketing/lib/**` — the store-links SSOT byte-compare SOURCE (an edit there breaks `orch_1342_download_cta_ssot` and must trigger the suite)
- `supabase/migrations/**` — the 1338/1339 SQL contract suites
- `.github/workflows/meta-orch-1337-social-proof-tests.yml` — the workflow itself

## 4. Pinning (COMMS-0087, binding)

- Deno: `denoland/setup-deno@v1` with `deno-version: "1.46.x"` — the exact idiom of all three existing Deno jobs.
- Node: `"20"` (house standard). Jest resolved via `npm ci` from `mingla-business/package-lock.json` — lockfile-pinned; **no** `npm install` of anything, no `@latest`.
- Verified: `node .github/scripts/strict-grep/orch-1325-ci-typescript-pinned.mjs` → `ORCH-1325 PASS — scanned 11 workflow files; every typescript install is version-pinned.` (the scan includes the new workflow).

## 5. Local verbatim runs (all GREEN before registration)

**Deno, all 15 files, one command with the job's exact flags** (run twice — local deno 2.7.14 AND a standalone deno 1.46.3 fetched to the scratchpad to match the CI pin exactly):

```
ok | 164 passed | 0 failed (740ms)   # deno 2.7.14
ok | 164 passed | 0 failed (335ms)   # deno 1.46.3 (CI-pinned version)
```

**Jest, the job's exact command from `mingla-business/`:**

```
Test Suites: 5 passed, 5 total
Tests:       63 passed, 63 total
```

**Both gates, self-test then real run:**

```
ORCH-1342 landing-single-parse self-test PASS (7/7 cases).
ORCH-1342 PASS — deep_link_sub3 is parsed only in oneLinkResolver.ts and the
dispatcher composes ?landing=guest-list at its ONE composition point.
ORCH-1342 store-links-ssot self-test PASS (10/10 cases).
ORCH-1342 PASS — mingla-business store links are SSOT'd in src/constants/storeLinks.ts
(byte-equal to the marketing SSOT) and no store/OneLink-domain literal exists outside it.
```

**YAML sanity:** both workflows parsed with js-yaml (strict-grep: 327 jobs incl. the two new; new workflow: 2 jobs; push/PR paths byte-identical). `actionlint` not installed locally.

## 6. Red/green demo (one guard proven to gate)

Broke the guarded invariant by TRUE LINE DELETION (not comment-out) of the `?landing=guest-list` composition point in `app-mobile/app/index.tsx` (the 3-line `if (dest.landing === 'guest-list') { path = ... }` block), then ran the exact CI commands:

**RED —**
```
node .github/scripts/strict-grep/orch-1342-landing-single-parse.mjs
→ ORCH-1342 (I-PROPOSED-1342-LANDING-SINGLE-PARSE) FAIL —
  app-mobile/app/index.tsx: dispatchOneLinkDestination no longer composes
  ?landing=guest-list onto the entity path — the deferred install funnel is dead.
  (exit 1)

deno test --allow-env --allow-net --allow-read --no-check <the 15 files>
→ FAILED | 163 passed | 1 failed — error: Test failed
  (orch_1342_cold_seed_landing T-02: dispatcher appends ?landing=guest-list)
```

**GREEN (restored via `git checkout -- app-mobile/app/index.tsx`) —**
```
gate  → ORCH-1342 PASS
deno  → ok | 164 passed | 0 failed (761ms)
```

One deletion turned BOTH the registered strict-grep job and the new Deno job red — the registration gates for real. `fails-on-revert verified at 33a581b12` (registration-level; each suite's own fails-on-revert was proven by its authoring ORCH).

## 7. Files changed

| File | Change |
|---|---|
| `.github/workflows/strict-grep-mingla-business.yml` | +2 registry doc-comment lines; +2 jobs appended (`orch-1342-landing-single-parse`, `orch-1342-store-links-ssot`) — +28 lines |
| `.github/workflows/meta-orch-1337-social-proof-tests.yml` | NEW — 2 jobs, 141 lines |

Zero product-code, migration, or test-file changes. `tests-append-only.yml` untouched (verified via `git status` — only the two workflow paths in the commit). Commit body carries `[TEST-MOD-APPROVED ORCH-1340]` + `ORCH-1340 [card-real-avatars]` + `META-ORCH-1337 [ci-guard-registration]` per dispatch.

## 8. Config-layer dependency notes (what else consumes the touched workflows)

- **`strict-grep-mingla-business.yml`** is the PR-required check surface for `main` — every open PR touching `mingla-business/** | app-mobile/** | packages/** | mingla-marketing/** | supabase/**` will now ALSO run the two 1342 gate jobs against ITS merge ref (the `pull_request` merge-ref picks the workflow up from the base once merged). Both gates pass against the current tree, so sibling branches only go red if they themselves violate the invariants — same rollout semantics as ORCH-1325 (COMMS-0087).
- That workflow now defines **327 jobs**. Pre-existing scale (325 before this pass); noted as a watch item — if GitHub ever throttles per-workflow job fan-out, the registry will need sharding into a second workflow file. Not actioned here (out of scope).
- **`orch-1325-ci-typescript-pinned.mjs`** scans `.github/workflows/**` — the new workflow is inside its scan set and passes.
- The **new workflow** is self-contained: no other workflow or script references it. `docs-artifact-regression.yml` / `tests-append-only.yml` semantics unaffected (this pass adds no test files and modifies none).
- Branch-protection note for the orchestrator at CLOSE: the three new checks (`orch-1342-landing-single-parse`, `orch-1342-store-links-ssot`, and the two `meta-1337-*` jobs) become required per whatever required-check policy the repo uses (if "all checks green before merge" is enforced by rule rather than enumerated list — per `feedback_all_checks_green_before_merge` — no settings change is needed).

## 9. Known issues / deferred

- The new workflow's first REAL execution happens on the META's closing PR (workflows on a PR run from the head ref for `pull_request` events, so the new file exercises itself there). No `[TRANSITIONAL]` code.
- Local jest run used the worktree's existing `node_modules` (lockfile-consistent); CI does a clean `npm ci` — same resolution source.

## 10. Discoveries for Orchestrator

1. **No general jest CI exists for mingla-business or app-mobile.** Only single-file jest (featureFlags) runs in CI. Every past ORCH's jest regression suite that wasn't explicitly registered in a workflow is CI-dark — same class as the gap this pass closes for the META. Worth a registry-audit ORCH.
2. **`strict-grep-mingla-business.yml` at 327 jobs / ~4.3k lines** — approaching practical limits (UI readability, potential platform fan-out limits). Consider sharding by surface in a future process ORCH.
3. `orch_1157_rsvp_momentum_adversarial.test.ts` is byte-identical to origin/main (only the non-adversarial sibling was rewritten) and still passes against the new cross-entity direction — no action needed, recorded for the tester.

## 11. Operator action required

None. No migration, no edge-function deploy, no OTA. CLOSE flow: PR → checks green (the new jobs run on the PR itself) → squash-merge per house rules.
