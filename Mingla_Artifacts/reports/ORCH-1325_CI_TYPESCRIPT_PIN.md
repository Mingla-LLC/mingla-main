# ORCH-1325 — CI TypeScript pin (repo-wide gate crash from `typescript@latest` → TS 7.0)

**Type:** CI-infra launch-blocker · backend/CI-only — no client surface · S1-high (blocked ALL merges)
**Date:** 2026-07-09 · **Discovered by:** ORCH-1324 [business Get-the-app CTA] PR #806

## Symptom
The required CI job `orch-1058-collab-system-banner` (workflow *Strict Grep Gates (Mingla Business)*) failed on PR #806 in 20s:
```
TypeError: Cannot read properties of undefined (reading 'CommonJS')
    at evalTsModule (app-mobile/scripts/ci/orch-1058-banner-allowlist-parity.mjs:49)
      module: ts.ModuleKind.CommonJS,
```
Failed on `pull_request`, `mergeStateStatus: BLOCKED`, with the change (marketing-only) touching **zero** `app-mobile/` files.

## Root cause (proven)
The job installs its transpile dep UNPINNED: `npm install --no-save typescript` (`.github/workflows/strict-grep-mingla-business.yml:2480`). On 2026-07-09 the npm dist-tag **`latest` advanced to TypeScript 7.0.2** (the native/tsgo rewrite), whose package **dropped the classic `ts.ModuleKind` / `ts.transpileModule` JS API** that the three `app-mobile/scripts/ci/orch-1058-*.mjs` gates transpile with.

Reproduced locally:
- `npm install typescript@latest` → **7.0.2**; `import ts` / `import * as ts` / `require('typescript')` ALL yield `ts.ModuleKind === undefined`.
- `npm install typescript@~5.9.2` → **5.9.3**; `ts.ModuleKind.CommonJS === 1` (classic API restored).

Repo-wide: every PR running this required gate was blocked, independent of diff. The repo itself pins `typescript` to `~5.9.2` (app-mobile, mingla-business) / `^5.7.2` (mingla-marketing) — only this ONE CI install step was unpinned (sole match in `.github/workflows/**`).

## Fix
1. `strict-grep-mingla-business.yml:2480` — `npm install --no-save typescript` → `npm install --no-save typescript@~5.9.2` (lockstep with `app-mobile/package.json`).
2. New guard `.github/scripts/strict-grep/orch-1325-ci-typescript-pinned.mjs` — fails any unpinned `typescript` install token under `.github/workflows/**` (exact-token match; `@typescript-eslint/*` exempt). Wired as job `orch-1325-ci-typescript-pinned`. `--self-test` 10/10; live PASS (scanned 10 workflow files).
3. Invariant **I-PROPOSED-1325-CI-TYPESCRIPT-PINNED** ACTIVE.
4. COMMS-0087 broadcast (re-run guidance for other blocked sessions).

## Verification
- Guard self-test 10/10, live PASS. YAML valid (ruby-parsed, 323 jobs, new job present).
- Fix proven: pinned 5.9.3 restores `ts.ModuleKind.CommonJS = 1`.
- Fails-on-revert: reverting the pin fires the guard on line 2480.

## Downstream
Once merged to `origin/main`, other open PRs re-run their `orch-1058-collab-system-banner` check (the `pull_request` merge-ref inherits the pinned base workflow) — no per-branch code change needed; rebase if the merge-ref doesn't refresh. ORCH-1324 PR #806 unblocks the same way.
