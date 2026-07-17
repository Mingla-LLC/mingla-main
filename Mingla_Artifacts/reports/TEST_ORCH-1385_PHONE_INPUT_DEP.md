# TEST — ORCH-1385 [main CI RED — `@mingla/phone-input` unresolvable in the mingla-business web-build check] — CLOSE Step-0.5 adversarial leg

**Skill:** mingla-tester (Claude) — TEST phase, CLOSE Step-0.5 adversarial regression leg
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1385-[phone-input-dep-red-main]/` on branch `ORCH-1385-phone-input-dep-red-main` (reset onto merged `origin/main` — the squash `d4f0996df` / PR #929 is ancestor of HEAD; verified `git merge-base --is-ancestor`)
**Date:** 2026-07-17
**Claim under test:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1385_PHONE_INPUT_DEP.md` (fix merged as squash `d4f0996df`, PR #929, 352/0 checks)

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 3 (guard gaps F-1/F-2/F-3, per dispatch graded as findings, not fix failures) · P4: 2 (F-4 quirk, P-1 praise).

Phase 0.A exemption: CI/build-config-only change — zero runtime/UI surface delta (same package bytes bundle, found via symlink instead of alias). The live-fire obligation for this class is the CI build command itself, executed independently below. No sim legs apply.

Regression gate: implementor happy-path + companion MERGED on main (in `d4f0996df`); tester adversarial suite NEW on this branch (`b4c3b3d93`), different angles, real-gate provenance, own fails-on-revert. Gate satisfied.

## 2. SC-by-SC matrix (dispatch /goal decomposition)

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-A | Merged fix independently live-fire verified: web export exit 0 on MERGED main | **PASS** | My own run of the exact `web-build-check.yml` sequence from the rebased tree (HEAD = origin/main `7d10955d9`, contains `d4f0996df`): `npm install` exit 0 → `npx expo export -p web --output-dir <scratch>` **EXPO_EXIT=0** → ORCH-1083 bundle-budget **PASS, initial payload 3233071 bytes** (byte-identical to the implementor's reported number — independent convergence) → ORCH-1137 lucide glyph proof **PASS**. Worktree stayed clean after `npm install` (zero lockfile drift under local npm 10.9.7 / node v22.22.2; CI is node 20 — same-env-comparison caveat as the implementation report, and the merged PR's own CI run at 2m8s is the node-20 proof) |
| SC-B | Guard attacked from ≥3 angles the implementor did NOT cover, every result in a NEW tester-authored test importing the REAL gate | **PASS** | 7 angles / 12 tests in `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs` (§5); provenance: unit probes child-import the REAL module via `pathToFileURL` (D-IMPL-1384-1 bracket workaround), E2E fixture legs execute a **sha256-verified byte-identical runtime copy** of the real gate (asserted every run); zero re-implemented logic |
| SC-C | One tester-angle fails-on-revert proof with hash | **PASS** | T-2 (real-tree six-declaration pin — manifest-content angle, distinct from the implementor's gate-exit-code angle). **fails-on-revert verified at `b4c3b3d93`** (§6) |
| SC-D | PASS/CONDITIONAL/FAIL verdict with severity-graded guard gaps | **PASS** | §1 verdict; findings §4 |

## 3. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Performed at `b4c3b3d93` (= merged main `7d10955d9` + my test commit; the fix content is the merged squash `d4f0996df`). True line-deletion of `"@mingla/phone-input": "file:../packages/phone-input"` from `mingla-business/package.json`:

- **Gate on revert: exit 1**, exact output: `mingla-business imports @mingla/phone-input (first seen in mingla-business/app/checkout/[eventId]/buyer.tsx) but does not declare it in mingla-business/package.json…` — note the failure names a **bracket path**, proving E2E on the REAL tree that the readdir walk handles `[id]` dirs.
- **Implementor companion on revert: red** — but as ONE opaque unit: `not ok 1 - …test.mjs / # tests 1 / # pass 0 / # fail 1`. Mechanism: the companion's top-level `import` of the gate module executes the gate's main body, which `process.exit(1)`s on the broken tree BEFORE any test runs (finding F-4). The implementor's "companion suite 1-fail" claim is accurate but the 1 fail is the whole file, not a test case.
- **Restore via `git checkout -- mingla-business/package.json`: gate exit 0, companion 5/5, tester suite 12/12.** Worktree clean after restore (`git status --porcelain` empty).

Implementor's claim independently CONFIRMED (their recorded proof was at pre-squash `560939be7`; my re-run is against the merged artifact).

## 4. Findings

**F-1 (P3) — the gate's scan misses real import-bearing surfaces; the guarded bug class survives there.**
Evidence: gate `APPS` config scans only `mingla-business/{app,src}` and `app-mobile/{app,src,components}` (`orch-1385-workspace-deps-declared.mjs:55-58`). Proven blind by T-4 E2E (REAL gate copy, fixture roots): undeclared imports in `mingla-business/index.js` (the bundle ENTRY file), `mingla-business/api/`, `app-mobile/index.ts`, `app-mobile/scripts/` → all exit 0. Live today: `@mingla/` references already exist outside the scan (`mingla-business/__tests__/` ×5 files, `jest.orch*.cjs` configs, `app-mobile/scripts/ci/` ×5) — those are jest/CI-self-catching, not silent. Impact: metro `extraNodeModules` aliases remain in place, so a FUTURE undeclared `@mingla` import living only in an unscanned bundled surface (entry file, api/) resolves via alias today and re-enters the exact #925 latent class the gate exists to kill. Window is narrow (convention puts imports in `app/`/`src/`), hence P3 — rises to P2 if entry-file/api `@mingla` imports become practice. Required fix (future gate revision, NOT this ORCH): add top-level files + `api/`, `__tests__/`, `scripts/` to the scan, or walk the app dir root with the existing SKIP_DIRS. Retest: flip T-4's KNOWN-GAP assertions to `code === 1`.

**F-2 (P3, fail-safe direction) — the gate false-fires on comments and template literals.**
Evidence: T-8 E2E — a fixture whose ONLY reference is `// import { X } from "@mingla/ghost-pkg"` (or a block comment, or import-shaped text in a template literal) exits 1. Unit probes confirm the extractor attributes all three. Impact: a PR carrying only commented-out/documentation text mentioning an undeclared `@mingla` package is wrongly blocked — annoying, never dangerous (over-firing blocks; it cannot let a break slip). Required fix: comment/string stripping before regex, if the noise ever bites. Retest: flip T-8 to `code === 0`.

**F-3 (P3) — backtick dynamic import evades the gate.**
Evidence: T-9 — `const p = await import(\`@mingla/ghost-pkg\`)` is valid JS that bundlers resolve statically, but all four gate regexes match only `'` and `"` quotes → extractor returns empty, E2E exit 0. Impact: a real evasion vector for the declared invariant, though an unusual authoring form. Required fix: add a backtick variant to the four patterns. Retest: flip T-9 to detection.

**F-4 (P4) — importing the gate module executes the full real-tree scan (no entry-point guard).**
Evidence: T-12 (clean tree: PASS banner printed on import, exit 0) + §3 (broken tree: `process.exit(1)` at import kills the importing process — which is why the implementor's companion reds as one opaque file under revert, losing per-test reporting). My suite unit-probes via child processes for this reason. Impact: degraded failure diagnostics only; CI still reds correctly. Suggested fix (future): `import.meta.main`-style guard; T-12 pins current behaviour so the change is conscious.

**P-1 (P4, praise) — attacked angles that HELD.** No hardcoded package list (T-3: a never-seen `@mingla/never-heard-of-pkg` undeclared → exit 1 naming it); bracket-dir scanning solid both in fixture (T-5) and on the real tree (§3 — the D-IMPL-1384-1 glob-hazard class does not apply to the gate's fs walk); `export * from` / `export {X} from` / `import type` / multiline all attributed (T-7, unit + E2E); wrong-dir declaration `file:../packages/offering-rendering` for phone-input, trailing slash, and `File:` case variant all fail exact-spec rule B (T-10); `app-mobile/components` srcDir is live future-proofing, not dead config (T-6); workflow wiring sound — `on.pull_request.paths` includes `app-mobile/**`, `packages/**`, `mingla-business/**`, `.github/scripts/strict-grep/**`, so an app-mobile-only undeclared-import PR DOES run the business-named workflow (T-11 now pins this: a future filter-narrowing or job unhook goes red).

## 5. Adversarial test added

- Path: `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs` (NEW file; append-only gate run: `1 passed, 0 failed`).
- Commit: `b4c3b3d93` on `ORCH-1385-phone-input-dep-red-main`.
- 12 tests / 7 angles, all DISTINCT from the implementor's companion (their coverage: real-tree exit 0, self-test matrix, static-import #925 fixture, registry-version half-revert, subpath/require/dynamic attribution — none of my T-1..T-12 duplicates these).
- Provenance: real-module child-import (unit) + sha256-sealed runtime copy of the real gate (E2E fixtures) + real gate at real path (real-tree legs). KNOWN-GAP assertions encode CURRENT behaviour with loud markers naming F-1/F-2/F-3, so main stays green and a future gate fix must consciously flip them.
- Pristine tree: 12/12 pass. **fails-on-revert verified at `b4c3b3d93`** — line-deletion of the phone-input declaration → suite 7/12 with T-1/T-2 red; T-2's verbatim failure: `mingla-business lost the ORCH-1385 declaration for @mingla/phone-input · + undefined − 'file:../packages/phone-input'`; restore → 12/12.
- Closing-diff visibility: `git diff origin/main...HEAD --name-only` = exactly this test file (the implementor's happy-path + companion already MERGED to main inside `d4f0996df`, satisfying the gate's on-main half; mine rides the CLOSE PR).
- NOT CI-registered: the workflow job runs only the implementor's companion. Wiring my suite in is a one-line workflow addition — orchestrator's call at CLOSE (gate/workflow modification is outside this leg's hard guards).

## 6. Constitution (14-rule matrix)

No product/runtime code changed in the fix (dependency declarations + lockfile + CI gate) — rules audited against the merged diff `d4f0996df`:
1 No dead taps — N/A · 2 One owner per truth — **PASS** (resolution now owned by package.json declarations; aliases demoted to fallback, report §10 documents) · 3 No silent failures — **PASS** (gate exits 2 loudly on missing package.json/zero sources; verified in fixture construction) · 4 Query-key factory — N/A · 5 Server state — N/A · 6 Logout — N/A · 7 `[TRANSITIONAL]` — **PASS** (none introduced) · 8 Subtract before adding — **PASS** (six declaration lines; zero version bumps in either lockfile — implementor's structural-diff claim §4a consistent with my clean `npm install`) · 9 No fabricated data — N/A · 10 Currency — N/A · 11 One auth — N/A · 12 Datetime validation — N/A · 13 Exclusion consistency — N/A · 14 Hydration gate — N/A.

## 7. Device / parity matrix

CI-only change; no runtime delta ships to any surface (same package sources bundle as before). Consumer iOS / Consumer Android / Business iOS / Business Android / Buyer Web / Admin Web / Business Web preview — all **skipped: no user-facing behaviour change** (the export artifact was additionally sanity-checked by the ORCH-1137 glyph grep, which proves real component code made it into the bundle). Native BUILD lanes for both apps remain broken by the independent #925 `buffer` break — already registered as ORCH-1386, explicitly out of this ORCH's lane; nothing new observed. Physical-iPhone HITL: N/A (no runtime surface).

## 8. Discoveries for Orchestrator

- **D-T1:** implementor's companion suite loses per-test reporting under any gate failure (dies at import — F-4). If a future gate revision lands, prefer an entry-point guard + child-process pattern (my suite demonstrates it).
- **D-T2:** live `@mingla` references already exist outside the gate's scan (mingla-business `__tests__/`, `jest.orch*.cjs`, app-mobile `scripts/ci/`) — currently jest/CI-self-catching, but the gate's stated invariant ("every `@mingla/*` package an app imports") reads broader than its enforcement (F-1).
- **D-T3:** the gate's declaration check verifies the target DIR exists, not that it is a real package; T-2 now pins name-integrity (`packages/<x>/package.json` name === declaration) on the real tree for all declared deps.
- **D-T4:** the ORCH branch carried pre-squash duplicate history that conflicted on rebase; I reset it onto `origin/main` (all content was in `d4f0996df`) — CLOSE reap should expect the rewritten branch (pushed with lease).
- **D-T5 (CLOSE option):** one-line addition to the `orch-1385-workspace-deps-declared` CI job to also run the adversarial suite (`node --test .github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs`) — keeps T-11's wiring pin and the KNOWN-GAP markers enforced on every PR. T-11 tolerates the added step.

## 9. Comms-ledger actions this session

Acked and pushed to origin/main at `7d10955d9` before any test work: COMMS-0105 (WARN — zero git stash used; foreign `stash@{0}` untouched) and COMMS-0106 (WARN — real-gate provenance honoured; new test files only, no TEST-MOD token; dummy-pk_live/`/`-control export discipline noted, not needed for the build-exit leg which mirrors CI verbatim). COMMS-0108 (BLOCK, this ORCH's subject) verified already RESOLVED.
