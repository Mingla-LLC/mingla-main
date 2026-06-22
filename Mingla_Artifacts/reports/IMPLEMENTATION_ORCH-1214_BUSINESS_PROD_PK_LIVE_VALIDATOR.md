# IMPLEMENTATION — ORCH-1214 [business-prod-pk-live-validator]

**Branch:** `1214-business-prod-pk-live-validator`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/1214-[business-prod-pk-live-validator]/`
**Date:** 2026-06-22

## Root cause (given, confirmed in place)

`mingla-business/app.config.ts` resolves `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` via an
IIFE that branches on `process.env.VERCEL_ENV`. Branch 4 — the `VERCEL_ENV === undefined`
path, which is the **native EAS build** path as well as local dev — hardcoded a
`pk_test_` requirement:

```ts
const localValue = fromEnv ?? sandboxFallback;
if (!localValue.startsWith("pk_test_")) {
  throw new Error(
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ value for local development.",
  );
}
return localValue;
```

On an EAS **production** build, `VERCEL_ENV` is undefined, so branch 4 runs. EAS injects
a `pk_live_…` key (correct for live Stripe mode), the validator throws, `expo config --json`
exits 1, and the build dies. This blocked ALL business production builds once the platform
moved to live Stripe.

## The fix (branch 4 only)

Only branch 4 of the IIFE was changed. Branches 1–3 (Vercel production/preview/other),
the Vercel logic, the `stripeMode` variable, and the GIPHY IIFE are untouched.

```diff
         const localValue = fromEnv ?? sandboxFallback;
+        // ORCH-1214: VERCEL_ENV undefined = native EAS build OR local dev. Accept the
+        // mode-appropriate prefix: pk_live_ only when MINGLA_STRIPE_MODE=live (live
+        // production builds); pk_test_ otherwise (local dev / test mode). Branch 4
+        // previously hardcoded pk_test_, which crashed `expo config` on live EAS builds.
+        if (localValue.startsWith("pk_live_")) {
+          if (stripeMode !== "live") {
+            throw new Error(
+              `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is a pk_live_ value but MINGLA_STRIPE_MODE=${stripeMode}. Set MINGLA_STRIPE_MODE=live for live production builds.`,
+            );
+          }
+          return localValue;
+        }
         if (!localValue.startsWith("pk_test_")) {
           throw new Error(
-            "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ value for local development.",
+            "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ (test/local) or pk_live_ (live) value.",
           );
         }
         return localValue;
```

The in-scope `stripeMode` variable is `process.env.MINGLA_STRIPE_MODE ?? "live"`.
The fix does NOT depend on `EAS_BUILD_PROFILE`.

## Verification — three `expo config` runs (real output)

Run via `node_modules/.bin/expo config` in the worktree (`node_modules` symlinked from anchor).
A fake `pk_live_`-prefixed string is used; only the prefix is load-bearing.

### (a) pk_live + MINGLA_STRIPE_MODE=live → SUCCEEDS, emits the pk_live value

```
$ env EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_51FAKEORCH1214REPLACEWITHANYLONGFAKEvalue... \
      MINGLA_STRIPE_MODE=live node_modules/.bin/expo config --json
EXIT OK; extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_live_51FAKEORCH1214REPLACEWITHANYLONGFAKEvalueAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

### (b) pk_live + MINGLA_STRIPE_MODE=test → THROWS the new mode-mismatch error (exit 1)

`expo config --json` swallows the message (only exit 1 surfaces). Running plain
`expo config` surfaces the exact error:

```
$ env EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_51FAKE... MINGLA_STRIPE_MODE=test \
      node_modules/.bin/expo config
exit=1
Error: Error reading Expo config at .../mingla-business/app.config.ts:

EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is a pk_live_ value but MINGLA_STRIPE_MODE=test. Set MINGLA_STRIPE_MODE=live for live production builds.
    at .../mingla-business/app.config.ts:220:19
```

### (c) unset key → sandbox pk_test_ fallback → SUCCEEDS

```
$ env -u EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY -u MINGLA_STRIPE_MODE \
      node_modules/.bin/expo config --json
EXIT OK; extra key starts with pk_test_: true | prefix: pk_test_51TT
```

## Regression guard — strict-grep gate (REQUIRED, CI-enforced)

**Gate file:** `.github/scripts/strict-grep/orch-1214-business-pk-live-build-accepts-live.mjs`

Invariant `I-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE`. It asserts, against
`mingla-business/app.config.ts` (comments stripped first):

- **INV-1** — branch 4 accepts a pk_live_ value: a `localValue.startsWith("pk_live_")`
  acceptance **AND** the `stripeMode !== "live"` live-mode guard are both present.
- **INV-2** — the OLD hardcoded message `"must be a pk_test_ value for local development."`
  is gone (regression sentinel).

Has a `--self-test` mode (exercises both detectors against a fixed-branch-4 fixture and the
OLD-branch-4 fixture).

**Workflow wiring:** `.github/workflows/strict-grep-mingla-business.yml` — new job
`orch-1214-business-pk-live-build-accepts-live` (runs the self-test then the gate), plus a
registry comment line. The workflow already triggers on `mingla-business/**` and
`.github/scripts/strict-grep/**` for both `pull_request` and `push` to `main`/`Seth`.

PASS-on-fix:

```
$ node .github/scripts/strict-grep/orch-1214-business-pk-live-build-accepts-live.mjs --self-test
SELF-TEST OK: I-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE detectors behave

$ node .github/scripts/strict-grep/orch-1214-business-pk-live-build-accepts-live.mjs
OK   [INV-1: pk-live-accepted-under-live-mode] ...
OK   [INV-2: no-hardcoded-pk-test-local-dev] ...
I-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE: PASS · violations=0
```

### Fails-on-revert proof

At commit `__GATE_COMMIT__` (gate + fix committed), `mingla-business/app.config.ts` was
reverted to the OLD hardcoded branch 4 and the gate re-run:

```
$ git checkout <fix-commit>~1 -- mingla-business/app.config.ts   # restore OLD branch 4
$ node .github/scripts/strict-grep/orch-1214-business-pk-live-build-accepts-live.mjs
FAIL [INV-1: pk-live-accepted-under-live-mode] app.config.ts branch 4 must accept pk_live_ under live mode (acceptsPkLive=false, guardsLiveMode=false) ...
FAIL [INV-2: no-hardcoded-pk-test-local-dev] app.config.ts still carries the OLD branch-4 message ...
I-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE: 2 violation(s)
exit=1
$ git checkout HEAD -- mingla-business/app.config.ts   # restore the fix
```

(Exact captured output is recorded in the session transcript; see commit notes below.)

## Defense-in-depth jest test

**File:** `mingla-business/src/__tests__/appConfig_pkLiveFailClose.test.ts` (extended).

Added an `ORCH-1214` describe block exercising:
- (a) pk_live + `MINGLA_STRIPE_MODE=live` → key passes through (success).
- (b) pk_live + `MINGLA_STRIPE_MODE=test` → throws `/pk_live_ value but MINGLA_STRIPE_MODE=test/`.
- (c) unset key → sandbox `pk_test_` fallback (success).
- pk_test + test mode → accepted.
- a non-pk value → throws the generalized `pk_test_ (test/local) or pk_live_ (live)` message.

The old stale case `"throws outside Vercel builds with pk_live publishable key" → /pk_test_/`
(which contradicted the new contract) was removed.

A `beforeEach` was added to the pre-existing `ORCH-0954` describe to provision
`EXPO_PUBLIC_GIPHY_API_KEY` — its release-bound success cases otherwise trip the unrelated
ORCH-1116 GIPHY config-eval guard before reaching the Stripe branch.

```
$ TS_JEST_DISABLE_VER_CHECKER=true npx jest src/__tests__/appConfig_pkLiveFailClose.test.ts \
      --globals '{"ts-jest":{"isolatedModules":true}}'
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

**Note (out-of-scope, pre-existing):** `mingla-business/app.config.ts` carries duplicate
object properties `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` (lines ~149/152 AND
~301/304 — TS1117 "object literal cannot have multiple properties with the same name"). This
pre-exists on `origin/main` and makes ts-jest's type-checker reject the whole file at compile
time — the existing `appConfig_pkLiveFailClose.test.ts` was already **7/7 red on origin/main**
because of it (business jest is not a blocking CI job, so it went unnoticed). The jest run uses
`isolatedModules` to bypass that type-only error; the runtime IIFE logic is correct (also
independently proven by the three `expo config` runs). Fixing the POSTHOG dup is outside the
ORCH-1214 contract — flagged here for the orchestrator.

## Files changed

- `mingla-business/app.config.ts` — branch 4 of the publishable-key IIFE.
- `.github/scripts/strict-grep/orch-1214-business-pk-live-build-accepts-live.mjs` — new gate (REQUIRED guard).
- `.github/workflows/strict-grep-mingla-business.yml` — new job + registry comment.
- `mingla-business/src/__tests__/appConfig_pkLiveFailClose.test.ts` — jest cases (defense-in-depth).
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1214_BUSINESS_PROD_PK_LIVE_VALIDATOR.md` — this report.

## Commit hash(es)

- Implementation commit: `__FINAL_COMMIT__`
