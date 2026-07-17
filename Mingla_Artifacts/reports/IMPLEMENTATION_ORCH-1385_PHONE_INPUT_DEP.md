# IMPLEMENTATION — ORCH-1385 [main CI RED — `@mingla/phone-input` unresolvable in the mingla-business web-build check after Dependabot PR #925 merged red]

**Skill:** mingla-implementor (Claude) — IMPLEMENT (root cause externally proven via COMMS-0108; reproduced before fixing)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1385-[phone-input-dep-red-main]/` on branch `ORCH-1385-phone-input-dep-red-main`
**Date:** 2026-07-17
**Status:** implemented and verified (web lane); mobile lane blast-checked with findings (see §10/§12)
**Commits:** fix `7bdd1ac50` · guard `560939be7` · completeness `0167a5e75` · report (this commit)

---

## 1. Summary

Every PR in the repo was red because the required `mingla-business: web build (expo export)` check
builds PR+main merged, and main itself could not build: Dependabot PR #925 — which is **not** a
routine security batch but a **disguised expo 54→57 major bump** (plus vite 7→8 in mingla-admin and
a next bump in mingla-marketing) that failed this exact check and was merged red anyway — changed
Expo's Metro resolver behaviour so that `@mingla/phone-input` stopped resolving. The deeper flaw
(per the dispatch): **no `@mingla/*` workspace package was declared as a dependency by any app** —
resolution leaned 100% on each app's `metro.config.js` `extraNodeModules` aliases, which a
dependency bump can silently change.

Fix (Seth-approved option (b), root-cause-shaped): declare the consumed `@mingla/*` workspace
packages explicitly as `file:../packages/<name>` dependencies in `mingla-business/package.json`
(and, under the dispatch's "also currently broken" unlock, in `app-mobile/package.json`), and
regenerate the lockfiles minimally. npm now materialises real `node_modules/@mingla/<name>`
symlinks, so resolution works by plain Node/Metro node_modules lookup on every platform,
independent of alias behaviour. A new writer-independent strict-grep gate
(I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED) makes the undeclared-workspace-dep bug class impossible
to reintroduce silently.

**The web-build check — the CI gate blocking every merge — is proven green locally by the exact
commands CI runs.** This branch's PR should therefore be the first green rollup; merging it unblocks
every queued CLOSE (incl. ORCH-1384).

## 2. Success-criteria coverage (dispatch /goal decomposition)

| SC | Criterion | Result | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 | Failure reproduced FIRST on the clean branch with the CI command | ✓ | `npx expo export -p web` → `Web Bundling failed 8667ms` / `Unable to resolve module @mingla/phone-input from app/checkout-experience/[experienceEventId]/buyer.tsx`, candidate list shows the extraNodeModules path was consulted and rejected (§9). Verified THE failure, not a harness artifact (COMMS-0106): deterministic module-resolution error, reproduced twice, vanished with a `node_modules/@mingla/phone-input` symlink alone |
| SC-2 | Root-cause fix: explicit declaration + minimal lockfile regen, sibling-consistent | ✓ `7bdd1ac50` | No sibling declaration precedent existed anywhere in repo history (repo has NO root package.json, NO npm workspaces, NO `file:` deps ever) — the standard npm idiom `file:../packages/<name>` was introduced; lockfile diff reviewed structurally: linkage entries + additive npm normalization, ZERO version bumps, zero removals (§4a) |
| SC-3 | Web lane green by the same commands CI runs | ✓ `7bdd1ac50` | `npx expo export -p web` exit 0; ORCH-1083 bundle-budget PASS (3233071 bytes vs 9405478 ceiling); ORCH-1137 lucide glyph render-proof PASS (§9) |
| SC-4 | `npx tsc --noEmit` zero new errors | ✓ with attribution | app-mobile: byte-identical 1031=1031 lines pre/post. mingla-business: 984→993; diff fully attributed to `@mingla/payments-native` becoming type-resolvable for the FIRST time (it is the one package missing from tsconfig `paths`; pre-fix tsc emitted 2× TS2307 cannot-find-module for it — those vanish, 11 pre-existing-latent errors in never-before-typechecked payments-native files become visible, all `.native.ts*`; no previously-typechecked file gained any error). §12 D-4 |
| SC-5 | Mobile lane blast check, report (fix only if also currently broken) | ✓ | app-mobile WAS currently broken: iOS bundle failed `Unable to resolve module @mingla/payments-native from app/_layout.tsx` on the clean #925 lockfile → dispatch's conditional unlock met → same declaration fix applied (`7bdd1ac50`, `0167a5e75`). Post-fix, BOTH apps' native bundles clear the entire `@mingla` class and then hit a SEPARATE #925 break (`buffer`/react-native-svg — §12 D-2, out of this ORCH's lane) |
| SC-6 | Writer-independent guard, new file, CI-registered, fails-on-revert proven | ✓ `560939be7` | Gate + 8-case self-test + node:test adversarial companion + workflow job mirroring the ORCH-1367 job shape. Fails-on-revert: TRUE LINE-DELETION of the `@mingla/phone-input` declaration → gate exit 1 + companion suite red; restore → exit 0/green. **fails-on-revert verified at `560939be7`** |
| SC-7 | Repo's standard gates on changed paths | ✓ | tests-append-only: clean (new test files only; no TEST-MOD token needed). Workflow YAML validated (344 jobs, new job present, 5 steps). Jest sanity on `@mingla`-importing suites: 6/20 eventCoverMedia failures proven PRE-EXISTING by A/B with symlinks removed (identical 6/14 both ways) — §12 D-5 |

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/package.json` | +6 | six `@mingla/*` `file:` declarations (alphabetical slot) |
| `mingla-business/package-lock.json` | +126/−12 | 6-package linkage (6 dep refs + 6 `../packages/*` metadata + 6 `link:true`); npm-10 normalization: +1 optional-peer `@expo/metro-runtime@57.0.6` entry (nested under expo/@expo/cli), −4 `libc` metadata arrays. Zero version bumps |
| `app-mobile/package.json` | +5 then +1 | six `@mingla/*` `file:` declarations (5 direct-consumed + theme-animations for the offering-rendering transitive) |
| `app-mobile/package-lock.json` | +666/−12 then +14 | structural classification: 41 added entries → 10 = `@mingla` linkage, 31 = npm restoring the `@react-native/babel-preset` / `@react-native/metro-config` optional-peer subtree that #925's Dependabot-authored lockfile omitted; **removed entries: 0; version bumps: NONE** (verified programmatically) |
| `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.mjs` | +290 (new) | the gate |
| `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.test.mjs` | +120 (new) | adversarial companion (runs the REAL gate binary — provenance-safe per COMMS-0106 rule 1) |
| `.github/workflows/strict-grep-mingla-business.yml` | +17 | job `orch-1385-workspace-deps-declared` (self-test → gate → node --test), allowlisted registration |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1385_PHONE_INPUT_DEP.md` | new | this report |

DO-NOT-TOUCH compliance: zero product-source files changed; `packages/phone-input/**` untouched;
app-mobile touched ONLY under the dispatch's explicit "unless it is ALSO currently broken" unlock
(proven broken first — §2 SC-5); no other workflows/gates; no migrations. No git stash used
(COMMS-0105); foreign `stash@{0}` untouched.

## 4. Data-model changes

None. No migrations, no schema, no RLS.

### 4a. Lockfile-diff review method (contract step 3)

Structural diff of `packages` maps old↔new via script, per lockfile: entries added / removed /
version-changed enumerated. mingla-business: linkage + 1 optional-peer entry + libc-metadata
removal; app-mobile: linkage + 31 optional-peer-subtree restorations; **both: zero version
changes, zero third-party additions**. The npm-normalization component was proven
manifest-independent: a plain `npm install` on the UNMODIFIED manifest produced the same class of
rewrite (27/12 lines on mingla-business) — i.e., npm insists on it; committing npm's own output is
the stable minimal state (hand-pruning it would thrash on every future install). Local npm
10.9.7 / node v22.22.2 vs CI node 20 — noted; the CI job runs `npm install` (not `ci`) so lockfile
normalization differences cannot fail the check.

## 5. Edge functions touched

None. Nothing to deploy.

## 6. Regression tests added

1. `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.mjs` — gate with 8-case
   `--self-test` (declared-passes; undeclared static/side-effect/require/dynamic-import each fail;
   subpath attribution; non-`file:` declaration fails; phantom-package declaration fails).
2. `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.test.mjs` — 5 node:test cases:
   real-repo happy path (exit 0), self-test matrix intact, the EXACT #925 failure shape as fixture
   (buyer.tsx + undeclared phone-input) fails, registry-version half-revert fails, reference-form
   attribution. All import `checkApp`/`referencedMinglaPackages` from the gate module itself — no
   re-implemented logic (COMMS-0106 provenance rule).
3. CI registration: job `orch-1385-workspace-deps-declared` in
   `.github/workflows/strict-grep-mingla-business.yml`.

**fails-on-revert verified at `560939be7`** — true line-deletion of
`"@mingla/phone-input": "file:../packages/phone-input"` from `mingla-business/package.json`:
gate exit 1 (names the package + first importing file), companion suite 1-fail; restore via
`git checkout`: gate exit 0, companion 5/5. Both my happy-path/adversarial tests ship in this
branch and appear in `git diff origin/main...HEAD --name-only`. Append-only gate: clean (new
files only — no TEST-MOD token required).

## 7. Old → New receipts

### mingla-business/package.json
**Before:** declared ZERO of the six `@mingla/*` workspace packages it consumes (phone-input ×4
imports, offering-rendering ×46, brand-rendering ×6, location-input ×2, payments-native ×2,
theme-animations transitively via offering-rendering). Resolution rode `metro.config.js`
`extraNodeModules` aliases exclusively — and died on web for phone-input under #925's expo 57.
**Now:** all six declared as `file:../packages/<name>`; npm materialises
`node_modules/@mingla/<name>` symlinks; resolution is plain node_modules lookup on web AND native,
alias-independent.
**Why:** SC-2/SC-3 — the dispatch's root-cause-shaped option (b).
**Lines:** +6.

### mingla-business/package-lock.json
**Before:** #925's Dependabot-authored rewrite; no `@mingla` entries.
**Now:** + linkage entries (`../packages/*` metadata + `node_modules/@mingla/*` link:true) +
npm-10 additive normalization. Zero version changes.
**Why:** SC-2 minimal regeneration. **Lines:** +126/−12.

### app-mobile/package.json + package-lock.json
**Before:** same undeclared pattern; iOS bundle broken on `@mingla/payments-native` under the #925
lockfile (proven before touching — dispatch conditional met).
**Now:** six declarations (incl. theme-animations for the offering-rendering-internal import);
lockfile +linkage +optional-peer restorations, zero bumps.
**Why:** SC-5 unlock. **Lines:** +6 / +680−12.

### .github/scripts/strict-grep/orch-1385-workspace-deps-declared.mjs (+ .test.mjs + workflow job)
**Before:** nothing prevented an app importing an `@mingla/*` package it never declared — the exact
class #925 detonated.
**Now:** CI fails on any `@mingla/*` reference (import/export-from/side-effect/require/dynamic,
incl. subpaths) in either app's source tree that is not declared in that app's package.json as the
exact `file:../packages/<name>` spec onto an existing package dir.
**Why:** SC-6 (CLOSE HARD MUST). **Lines:** +290/+120/+17.

## 8. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Buyer/anonymous Web (mingla-business web) | YES (build-time only) | the required web-build check builds again; zero runtime/product behaviour change (same physical package files bundle, now found via symlink instead of alias) | automatic (one manifest) |
| Business iOS / Business Android | YES (build-time only) | native bundling clears the `@mingla` class (was latently broken — same mechanism as web); still blocked by the separate #925 `buffer` break (§12 D-2) | automatic (same manifest) |
| Consumer iOS / Consumer Android (app-mobile) | YES (build-time only) | iOS bundle failure moves off `@mingla/payments-native` (class cleared); still blocked by the same `buffer` break | automatic (own manifest, same fix shape) |
| Admin Web (mingla-admin) | NO | no `@mingla/*` consumption; #925's vite 7→8 bump untouched (out of lane) | — |
| Business Web preview / marketing | NO | no `@mingla/*` consumption; marketing's next bump untouched | — |

No user-visible pixel/behaviour changes anywhere — this is a dependency-declaration fix; the same
package source files are bundled as before.

## 9. Smoke / verification transcript (real output, abridged)

Repro (clean branch, CI's exact command):
```
Web Bundling failed 8667ms index.js (2113 modules)
Error: Unable to resolve module @mingla/phone-input from .../mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx:
@mingla/phone-input could not be found within the project or in these directories:
  node_modules
  node_modules
  .../packages/phone-input
```
Post-fix, same command: `Exported: .../web-build-check` + `EXPO_EXIT=0`.
CI job step 2: `ORCH-1083 bundle-budget PASS — initial payload 3233071 bytes (ceiling 9405478), 148 chunk files, 0 deferred specifiers in the main entry chunk, __common within cap.`
CI job step 3: `ORCH-1137 render-proof PASS` (both glyph signatures present).
Gate: `ORCH-1385 workspace-deps-declared self-test PASS (8/8 cases).` · real-tree PASS · companion `# pass 5 / # fail 0`.
Fails-on-revert at `560939be7`: `GATE_ON_DELETION=1` → `GATE_ON_RESTORE=0`.
app-mobile clean-branch blast: `Unable to resolve module @mingla/payments-native from .../app-mobile/app/_layout.tsx` (exit 1); post-fix: `@mingla` class clear, fails later on `buffer` (D-2).
mingla-business native blast post-fix: 5379 modules bundled, zero `@mingla` mentions in the failure log; fails on the same `buffer` break (D-2).
tsc: app-mobile 1031=1031 identical; mingla-business 984→993 fully attributed (SC-4).
Local env note: node v22.22.2 / npm 10.9.7 vs CI node 20 — the failing and passing runs used the SAME env, and the repro exactly matches CI's recorded error, so the comparison is valid.

## 10. Known issues / deferred

- **Native bundling of BOTH apps remains broken under the #925 lockfile** by the independent
  `buffer` break (§12 D-2) — deliberately NOT fixed here (out of allowlist: would require a new
  dependency or metro polyfill config, or reverting the expo bump). The web-build check — the gate
  this ORCH exists to green — does not touch it.
- The five previously-alias-only packages now resolve via symlink; the metro `extraNodeModules`
  aliases remain in place (harmless, and still needed as fallback for any resolution path that
  reaches them). Removing them was not in scope.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

None for this branch's content: no migration (`db push` N/A), no edge-function deploys. Downstream
is orchestrator-owned per the dispatch: REVIEW → PR + pre-merge gate (this PR's web-build check
builds PR+main merged and this branch carries the fix, so it should be the FIRST green rollup) →
merge → re-verify a sibling PR's web-build check goes green → CLOSE. Note for the merge decision:
D-1/D-2/D-3 below mean #925's expo-57 state has further un-greened lanes (native bundling, expo/RN
version pairing) that likely warrant their own dep-lane ORCH — possibly reverting the `expo` line
to `~54.0.34` + lockfile regen. **This fix is correct and wanted under EITHER expo version** (the
declarations are version-agnostic), so merging it first is safe and unblocks the queue either way.

## 12. Discoveries for Orchestrator

- **D-1 (register): PR #925 is a disguised MAJOR-framework batch merged red.** Beyond the
  advertised 15 "npm_and_yarn group" updates: `expo ~54.0.34 → ~57.0.6` in BOTH mobile apps
  (react-native left at 0.81.5 — an unsupported SDK pairing; `@expo/metro-config` 54.0.15→57.0.5,
  `@expo/metro` 54.2.0→56.0.0, metro itself unchanged 0.83.3), `vite ^7.3.6 → ^8.1.4` in
  mingla-admin, `next ^15.1.6 → ^15.5.20` + postcss in mingla-marketing. Dependabot batches with
  major framework jumps should never auto-merge red; consider a Dependabot config guard.
- **D-2 (register, P1-class): native bundling of BOTH apps fails under the #925 lockfile on a
  SECOND independent break** — `Unable to resolve module buffer from
  node_modules/react-native-svg/src/utils/fetchData.ts` (Expo 57 resolves react-native-svg's
  TypeScript SOURCE and no longer supplies a `buffer` node-polyfill). Any EAS build cut from
  current main will fail at bundle time. Fix shapes: revert the expo line (option-(a)-shaped),
  declare a `buffer` polyfill dep, or metro resolver config. High confidence #925-caused (window:
  live 1.1.2 binaries were cut pre-#925; no native build attempted since).
- **D-3 (context for D-1/D-2):** even with bundling fixed, expo 57.0.6 + react-native 0.81.5 is an
  unsupported pairing; runtime health of an expo-57 JS bundle (web or OTA) has had NO QA. Reverting
  the expo bump + lockfile regen looks root-cause-shaped for #925's residue; this ORCH's
  declarations survive and remain correct under either version.
- **D-4 (register, latent type bug):** `mingla-business/src/payments/nativeCheckoutFlow.native.ts:351`
  passes `applePay` — not a known property of `PaymentSheetInitInput`
  (`packages/payments-native/useStripePaymentSheet.ts`). Invisible until now because
  `@mingla/payments-native` is missing from `mingla-business/tsconfig.json` `paths` (the only one
  of the six that is), so tsc could never resolve it. Also +10 package-internal implicit-any/type
  errors in payments-native files now visible. Native payment surface — worth its own look.
- **D-5 (pre-existing test red):** `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
  fails 6/20 on this tree — A/B-proven independent of this fix (identical failures with the
  `@mingla` symlinks removed). Source-reading assertions (e.g. `EVENT_COVER_UPLOAD_LIMIT_COPY`)
  no longer match the current wizard cover step source.
- **D-6 (process):** `npx tsc --noEmit` in mingla-business carries ~984 pre-existing error lines —
  it is not a green gate anywhere in CI; treat "zero NEW errors" as diff-vs-baseline, never
  absolute.
- **D-7 (open question, bounded):** WHY Expo 57's resolver rejects the extraNodeModules candidate
  for phone-input on web while location-input (identical manifest shape: `main`+`react-native`+
  `types`, no `exports`) resolves is not fully pinned — the failure listed the alias path among
  rejected candidates, and a bare `node_modules/@mingla/phone-input` symlink alone fixed the whole
  export. The durable fix removes dependence on that behaviour entirely, and the gate keeps it
  removed; pin the resolver internals only if someone needs the expo-57 lane for other reasons.
- **D-8 (invariant candidate):** register I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED in
  `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE (gate + companion already enforce it).

## Comms-ledger actions this session

Acked and pushed to main at `757a36d1d` (before any code work): COMMS-0108 (BLOCK — this ORCH's
subject; acked as assigned fixer; stays OPEN until the fix PR merges and main is green),
COMMS-0107/0106/0105/0104 (WARN — factored: no OneLink surface; expo-export discipline honoured —
a `/`-control-equivalent causality check was used for every failure claimed; zero git stash; new
test files only, no TEST-MOD token needed).
