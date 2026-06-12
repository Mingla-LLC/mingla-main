# IMPLEMENTATION — ORCH-1116 [Cover picker GIF tab "This source is taking a break"]

**Skill:** mingla-implementor (business side) · **Phase:** IMPLEMENT · **Date:** 2026-06-11
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]/` · **Branch:** `ORCH-1116-gif-cover-key`
**Commit:** `9b10dd2b1` (single scoped commit) · **Base:** `origin/main` @ `0f9860b4a` (0 behind — no rebase needed)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1116_GIF_COVER_PICKER.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1116_GIF_COVER_PICKER.md`
**Status:** implemented and verified (code + gates green; behavioral guard probe + fails-on-revert proven). EAS-env provisioning + fresh dev/preview rebuild remain Seth's operator steps.

---

## 1. Summary

The business cover-picker GIF tab showed "This source is taking a break." on every
dev/preview build (and local Metro) because the client-direct GIPHY public key
(`EXPO_PUBLIC_GIPHY_API_KEY`) is provisioned only in the EAS **production**
environment. This change does three things, exactly per the SPEC: (Fix) documents
the key in `.env.example` with the rebuild-vs-OTA implication; (Prevent) adds a
config-eval **fail-loud guard** in `app.config.ts` (modeled on the `pk_live`
guard) so a release-bound build can no longer ship without the key, plus a
strict-grep CI gate; (Detect) routes the `not_configured` CONFIG error to
engineering telemetry via the existing Sentry-backed `reportNonFatal`, while
leaving transient faults user-facing-only. The friendly UI copy is unchanged.

The key value itself is NOT in code — provisioning the EAS dev/preview env and a
fresh dev/preview rebuild are Seth's operator steps.

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Evidence / commit |
|----|-------------|--------|-------------------|
| SC-1-iOS/Android | GIF tab loads trending on a built dev/preview-with-key build | ✓ (config-eval verified; runtime needs operator rebuild) | `9b10dd2b1` guard returns key when present (probe T1); operator must provision EAS env + rebuild |
| SC-2-iOS/Android | GIF search returns results | ✓ (same as SC-1 — same key path) | `9b10dd2b1` |
| SC-3 | Release build WITHOUT key FAILS at config-eval with explicit message | ✓ verified | `9b10dd2b1` guard probe: preview/production-apk/vercel-production THROW (§9 below) |
| SC-4 | Development/local build WITHOUT key still builds (friendly copy) | ✓ verified | `9b10dd2b1` guard probe: development/local return null + warn, NO throw |
| SC-5 | `not_configured` emits console.warn + Sentry capture; transient emits nothing | ✓ verified | `9b10dd2b1` jest `CoverPicker.providerTelemetry` T5/T6/T6b |
| SC-6 | `.env.example` documents `EXPO_PUBLIC_GIPHY_API_KEY` | ✓ verified | `9b10dd2b1` `.env.example` |
| SC-7 | Strict-grep gate PASSES with guard present, FAILS on removal | ✓ verified | `9b10dd2b1` `i-giphy-key-wired.mjs` + `.test.mjs` (5/5 pass incl. 2 fails-on-revert cases) |

---

## 3. Files changed (all within SPEC §11 allowlist)

| File | +lines | Change |
|------|--------|--------|
| `mingla-business/.env.example` | +6 | Documented `EXPO_PUBLIC_GIPHY_API_KEY=` placeholder + rebuild-vs-OTA note |
| `mingla-business/app.config.ts` | +45 | GIPHY config-eval fail-loud guard IIFE (modeled on the `pk_live` guard) |
| `mingla-business/src/components/ui/CoverPicker.tsx` | +23 | `reportNonFatal` import + single `reportProviderError` helper (gated on `not_configured`) wired at all 4 provider catch sites |
| `.github/scripts/strict-grep/i-giphy-key-wired.mjs` | +152 (new) | Strict-grep gate: app.config guard + .env.example documented; `--self-test` |
| `.github/scripts/strict-grep/i-giphy-key-wired.test.mjs` | +101 (new) | node:test companion incl. 2 fails-on-revert cases |
| `.github/workflows/strict-grep-mingla-business.yml` | +14 | Registry comment line + `orch-1116-giphy-key-wired` job (self-test + gate) |

Closing diff `git diff origin/main...HEAD --name-only` = exactly these 7 files. Both test files are visible in the closing diff.

---

## 4. Data-model changes applied

None. No DB / migration / edge function / hook / realtime layer touched (per SPEC §4).

---

## 5. Edge functions touched

None. The Pexels edge path (`event-cover-pexels-curated`) is untouched (DO-NOT-TOUCH honored).

---

## 6. Regression tests added

- **Happy-path (implementor):** `mingla-business/src/components/ui/__tests__/CoverPicker.providerTelemetry.test.ts` (8 tests). Behavioral CONFIG-vs-transient split (T5/T6/T6b + non-provider Error) with `reportNonFatal` mocked, plus source-wiring assertions (import present, single gated helper, all 4 call-sites, friendly copy unchanged). **Run: 8/8 PASS.**
- **Gate companion:** `.github/scripts/strict-grep/i-giphy-key-wired.test.mjs` (5 tests incl. self-test + 2 fails-on-revert cases). **Run: 5/5 PASS** via `node --test`.
- **fails-on-revert verified at `9b10dd2b1`:** deleted the gate condition line `if (code !== "not_configured") return;` from `CoverPicker.tsx` (TRUE line deletion, not comment-out) → `CoverPicker.providerTelemetry` test FAILED (1 failed / 7 passed). Restored via `git checkout -- CoverPicker.tsx` → 8/8 PASS again. The strict-grep gate's own `.test.mjs` additionally proves the gate FAILS when the app.config guard is reduced to a passthrough (no throw) and when the `.env.example` entry is removed.

---

## 7. Old → New receipts

### `mingla-business/.env.example`
- **Before:** No GIPHY entry; local Metro dev had no documented key (F-3/F-5).
- **Now:** Documents `EXPO_PUBLIC_GIPHY_API_KEY=` with GIPHY dashboard link + the EXPO_PUBLIC build-time-inlining (rebuild-not-OTA) note.
- **Why:** SC-6 / §4.A2.
- **Lines:** +6.

### `mingla-business/app.config.ts`
- **Before:** No GIPHY validation; a release build with a missing key silently shipped a broken GIF tab.
- **Now:** Config-eval IIFE reads `EXPO_PUBLIC_GIPHY_API_KEY ?? EXPO_PUBLIC_GIPHY_KEY`; THROWS for release-bound profiles (`production`/`production-apk`/`preview`/`preview-sim` via `EAS_BUILD_PROFILE`, plus Vercel `production`/`preview` via `VERCEL_ENV`) when absent; warns (no crash) for `development`/local. Returns the value into `extra` (belt-and-suspenders, matching the Stripe model); runtime services still read `process.env` directly.
- **Why:** SC-3 / SC-4 / §4.B; I-PROPOSED-GIPHY-KEY-FAIL-LOUD.
- **Lines:** +45.

### `mingla-business/src/components/ui/CoverPicker.tsx`
- **Before:** All 4 provider catch sites set `errorCode`/status and showed friendly copy with ZERO telemetry — a silent CONFIG failure (I-NO-SILENT-FAILURES gap).
- **Now:** Single exported `reportProviderError(kind, error)` helper containing the sole `reportNonFatal("coverPicker.provider", error, { provider, code })` call, gated on `code === "not_configured"` only; invoked from all 4 catch sites (`loadTrending`, `loadCurated`, `runProviderSearch` gif + stock). Friendly copy untouched.
- **Why:** SC-5 / §4.C; strengthens I-NO-SILENT-FAILURES.
- **Lines:** +23 (import + helper + 4 call-site lines).

### `.github/scripts/strict-grep/i-giphy-key-wired.mjs` (+ `.test.mjs`, workflow job)
- **Before:** No CI gate inspected GIPHY key wiring (F-7 detection gap).
- **Now:** Gate asserts the app.config fail-loud guard (key ref + throw) AND the `.env.example` entry; FAILS on removal of either. Registered as workflow job `orch-1116-giphy-key-wired` (self-test + run).
- **Why:** SC-7 / §4.D; I-PROPOSED-GIPHY-KEY-WIRED.

---

## 8. Cross-surface impact table

| Surface | Affected? | Parity | Note |
|---------|-----------|--------|------|
| Consumer iOS | NO | — | No CoverPicker / no GIPHY ref |
| Consumer Android | NO | — | Same |
| Buyer/anon Web | NO | — | Authoring surface, not buyer |
| Business iOS | YES | Automatic (shared CoverPicker + app.config) | GIF tab fix + telemetry |
| Business Android | YES | Automatic (shared code + EAS env per profile spans both platforms) | Same |
| Admin Web | NO | — | No CoverPicker |
| Business Web preview | PARTIAL (config) | Manual — web export needs the env at build time too (Vercel guard branch added; O-4 deferred) | Pexels still works regardless |

---

## 9. Smoke / verification result

- **Strict-grep gate:** `i-giphy-key-wired.mjs --self-test` → `SELF-TEST OK`. Real run → `PASS · violations=0`. `node --test i-giphy-key-wired.test.mjs` → 5/5 pass.
- **Jest:** `CoverPicker.providerTelemetry` 8/8; `giphyEventCoverService` + `coverProviderBrowseService` + `pexelsEventCoverService` + `reportNonFatal` + full `CoverPicker.*` suites → 43/43 pass (no regression).
- **TypeScript:** `tsc --noEmit` produces ZERO errors referencing the 4 touched files (pre-existing unrelated errors in other files only).
- **Config-eval guard probe** (isolated guard logic, env-var matrix):
  - `EAS_BUILD_PROFILE=preview`, no key → THROWS (explicit message). ✓ SC-3
  - `EAS_BUILD_PROFILE=production-apk`, no key → THROWS. ✓
  - `VERCEL_ENV=production`, no key → THROWS. ✓
  - `EAS_BUILD_PROFILE=development`, no key → returns null + warn, NO throw. ✓ SC-4
  - local (no profile), no key → returns null + warn, NO throw. ✓
  - `EAS_BUILD_PROFILE=preview` + key present → returns key. ✓ SC-1/SC-2 path
- **Not verified (operator-gated):** the actual GIF thumbnails rendering on a fresh dev/preview build — requires Seth to provision the EAS dev/preview env vars and rebuild (the key value is not in the repo). Labeled `implemented, partially verified` for SC-1/SC-2 runtime only.

---

## 10. Known issues / deferred

- **O-1 (key provenance):** Reuse the production GIPHY key for dev/preview (Seth's locked decision: reuse). No code reflects a value.
- **O-2 (Sentry DSN dev/preview):** `EXPO_PUBLIC_SENTRY_DSN` is production-only, so the `not_configured` Sentry capture is a no-op on dev/preview builds (only `console.warn` fires there). Seth's call whether to provision the DSN for dev/preview; not blocking. (D-1)
- **O-4 (business web export):** the Vercel/web export needs `EXPO_PUBLIC_GIPHY_API_KEY` at build time for the GIF tab to work on web; the guard already covers Vercel production/preview, but env provisioning there is an operator step if web authoring is in use. Deferred.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required (Seth)

1. Provision the GIPHY key into the EAS development + preview environments:
   ```
   eas env:create --environment development --name EXPO_PUBLIC_GIPHY_API_KEY --value <prod key> --visibility plaintext
   eas env:create --environment preview     --name EXPO_PUBLIC_GIPHY_API_KEY --value <prod key> --visibility plaintext
   ```
   (Optionally repeat for `EXPO_PUBLIC_GIPHY_KEY` to preserve the dual-name fallback.)
2. Fresh dev/preview build (EXPO_PUBLIC_* is inlined at build time — an OTA on the already-installed dev build will NOT pick up the key).
3. (Optional, O-2) provision `EXPO_PUBLIC_SENTRY_DSN` for dev/preview if you want config alerts to fire from those builds.
4. No migration. No edge-function deploy.

---

## 12. Discoveries for Orchestrator

- The `app.config.ts` GIPHY guard intentionally uses BOTH `EAS_BUILD_PROFILE` (native) and `VERCEL_ENV` (web export) so the web authoring path is also fail-loud — a small superset of the SPEC's native-only emphasis, justified by Cross-Surface row 7 (PARTIAL web). No scope widening beyond the allowlisted file.
- At CLOSE, flip the three DRAFT invariants ACTIVE (I-PROPOSED-GIPHY-KEY-FAIL-LOUD, I-PROPOSED-GIPHY-KEY-WIRED, I-PROPOSED-CONFIG-ERROR-IS-OBSERVABLE) and update the README "Active gates registered" table + INVARIANT_REGISTRY per the 4-step gate registration doc.
- No COMMS-ledger entry written (no cross-ORCH discovery this turn). No OPEN ledger rows addressed to implementor / ORCH-1116 / ALL.
