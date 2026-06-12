# IMPLEMENTATION — ORCH-1127 (ex-1116) [GIF cover-key reachability fix]

**Skill:** mingla-implementor (business side) · **Phase:** IMPLEMENT
**Date:** 2026-06-12
**Working tree:** `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]/` on branch `ORCH-1116-gif-cover-key`
**Binding contract:** `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-1127_GIF_COVER_KEY_REACHABILITY.md` (amends `SPEC_ORCH-1116_GIF_COVER_PICKER.md`)
**Comms:** acknowledged **COMMS-0028** (WARN, ALL) — this implementation is the code fix COMMS-0028 dispatched; appended ack.

---

## 1. Summary (plain English)

The cover-picker GIF tab showed "This source is taking a break." in every real build (dev-channel OTA, TestFlight, production) even after the GIPHY key was provisioned, because the two GIPHY services read the key via a **dynamic** `process.env[name]` lookup that Expo/babel never inlines — so the value was `undefined` in any Hermes standalone bundle. This change makes both services read the key from `Constants.expoConfig.extra` FIRST (the manifest-backed path `app.config.ts` already populates), with a **static** `process.env` fallback for Metro-dev/web, exactly mirroring the house pattern in `supabase.ts`. Proven on a standalone `expo export`: the key value now lands in the bundle (was 0 occurrences with the old reader, now 1).

---

## 2. SPEC success-criteria coverage

| Criterion | Status | Evidence / commit |
|-----------|--------|-------------------|
| SC-CORRECT-1 — standalone export carries the key | ✓ | Standalone `expo export --platform ios` with sentinel key → grep value present (count 1) in `_expo/static/js/ios/index-*.hbc`; was 0 with the original dynamic reader. T-CORRECT-1 jest also proves extra→resolved with empty `process.env`. |
| SC-CORRECT-2 — verify on the RIGHT bundle (not Metro) | ✓ (implementor scope) | Verified via standalone `expo export` + jest empty-`process.env` simulation, NOT the Metro bundle. On-device dev-channel OTA pull is the tester's remaining step per A3.2. |
| SC-CORRECT-3 — both services fixed identically | ✓ | Both `giphyEventCoverService.ts` + `coverProviderBrowseService.ts` import `expo-constants`, read `Constants.expoConfig?.extra` first, drop the dynamic bracket reader. Strict-grep INV-3 enforces it. |
| SC-CORRECT-4 — strict-grep gate extended | ✓ | `i-giphy-key-wired.mjs` Check 3 (INV-3): requires `Constants.expoConfig?.extra` read + forbids dynamic `process.env[<var>]`; fails-on-revert covered by the gate's own test. |
| §4.B comment correction in app.config.ts | ✓ | Lines 181-190 comment corrected (the "EAS inlines it / not a plumbing path" claim removed). |
| Retained §4.A/B/C/D (provision, guard, telemetry, gate) | ✓ | Untouched from `9b10dd2b1`; only the gate is EXTENDED and the comment corrected. |

---

## 3. Files changed

| File | Δ | Nature |
|------|---|--------|
| `mingla-business/src/services/giphyEventCoverService.ts` | +32/-9 | env reader → extra-first (A2); `import Constants`; protective comment |
| `mingla-business/src/services/coverProviderBrowseService.ts` | +32/-9 | identical fix |
| `mingla-business/app.config.ts` | +12/-3 | comment-only correction (A5) |
| `.github/scripts/strict-grep/i-giphy-key-wired.mjs` | +98 | Check 3 INV-3 (extra-first + no-dynamic-bracket) + self-test fixtures + comment-strip helper |
| `.github/scripts/strict-grep/i-giphy-key-wired.test.mjs` | +57 | service fixtures + 2 new tests (pass + fails-on-revert for INV-3) |
| `mingla-business/src/services/__tests__/giphyKeyReachability.test.ts` | NEW | T-CORRECT-1..4 |
| `mingla-business/src/services/__tests__/giphyEventCoverService.test.ts` | +7 | adds `jest.mock("expo-constants")` (service now imports it) |
| `mingla-business/src/services/__tests__/coverProviderBrowseService.test.ts` | +7 | adds `jest.mock("expo-constants")` |

Plus carried artifacts: `SPEC_AMENDMENT_ORCH-1127_*.md` + `SPEC_ORCH-1116_GIF_COVER_PICKER.md` (forensics-authored contracts).

---

## 4. Data-model changes applied

None. No migrations, no schema, no RLS.

---

## 5. Edge functions touched

None. (The Pexels edge path is untouched per A5 DO-NOT-TOUCH.)

---

## 6. Regression tests added

- **New:** `mingla-business/src/services/__tests__/giphyKeyReachability.test.ts` — T-CORRECT-1..4 (7 tests).
- **Existing extended (additive only):** the two service tests gained an `expo-constants` mock (no deletions).
- **Gate test extended (additive only):** `i-giphy-key-wired.test.mjs` +2 tests.

**fails-on-revert verified at `70f799e156898bed679b30038c60cb2410272297`** (post-rebase HEAD with the fix). Method = TRUE line deletion of `readExtra(name) ?? ` in both services (NOT a comment-out):
- Reverted → `npx jest giphyKeyReachability.test.ts`: **4 tests FAIL** (`not_configured` thrown for the extra-only inputs: T-CORRECT-1 x2, T-CORRECT-2, T-CORRECT-4-extra); the 3 static-`process.env` tests still pass.
- Restored → all 7 PASS again.
- Strict-grep gate fails-on-revert: the gate's own `i-giphy-key-wired.test.mjs` test "ORCH-1127 fails-on-revert" feeds a dynamic-only service fixture → gate exits 1 with `giphy-extra-first-read`.

Test runs (post-restore):
```
giphyKeyReachability.test.ts          7 passed
giphyEventCoverService.test.ts        (suite) passed
coverProviderBrowseService.test.ts    (suite) passed
=> Test Suites: 3 passed, Tests: 14 passed
node --test i-giphy-key-wired.test.mjs => 7 pass / 0 fail
node i-giphy-key-wired.mjs --self-test => SELF-TEST OK
node i-giphy-key-wired.mjs            => PASS · violations=0
```

---

## 7. Old → New receipts

### giphyEventCoverService.ts / coverProviderBrowseService.ts (identical)
**Before:** `envValue(name)` read `globalThis.process?.env?.[name]` (DYNAMIC bracket) — never inlined by babel-preset-expo → `undefined` in Hermes standalone/OTA → `publicGiphyKey()` null → `not_configured` → friendly copy on every non-Metro build.
**Now:** `envValue(name)` reads `Constants.expoConfig?.extra?.[name]` first (manifest-backed, runtime-populated), then a STATIC `process.env.EXPO_PUBLIC_GIPHY_API_KEY`/`EXPO_PUBLIC_GIPHY_KEY` fallback (inlined for Metro/web). Dual-name fallback + trim/empty→null normalization preserved. All network/normalization/clamp/fail-close logic untouched.
**Why:** SC-CORRECT-1/3 — make the key reachable in standalone/OTA builds (COMMS-0028 / amendment F-CORRECT-1..4).
**Lines:** ~+32/-9 each.

### app.config.ts
**Before:** comment claimed "runtime services read process.env directly (EAS inlines it), so this IIFE is a build-time validation GATE, not a new plumbing path."
**Now:** comment states the IIFE's emission into `extra` IS the plumbing path the services read; corrects the wrong inlining assumption.
**Why:** A5 — comment-only correction; guard LOGIC unchanged.
**Lines:** +12/-3.

### i-giphy-key-wired.mjs (+ .test.mjs)
**Before:** asserted only (1) app.config fail-loud guard + (2) `.env.example` documents the key.
**Now:** also asserts (3, INV-3) both giphy services read `Constants.expoConfig.extra` and contain NO dynamic `process.env[<var>]` bracket read; protective comments are comment-stripped before the dynamic-bracket check so they don't self-trip.
**Why:** A3.4 — make the exact bug un-reintroducible.
**Lines:** +98 / +57.

---

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | No | GIPHY cover picker is business-app only. |
| Consumer Android | No | same |
| Buyer/anon Web | No | not on buyer routes |
| Business iOS | YES | GIF tab in CoverPicker now renders trending/search GIFs in standalone/OTA/prod builds (shared RN code) |
| Business Android | YES | same shared code path |
| Admin Web (adjacent) | No | no admin code touched |
| Business Web preview (adjacent) | YES (positive) | web export now also carries the key via the static `process.env` inline fallback |

Parity is **automatic** (one shared RN codebase; both services fixed identically).

---

## 9. Smoke result

Standalone `expo export --platform ios` (NOT Metro), three variants of the reader:

| Reader | Sentinel key value count in dist |
|--------|----------------------------------|
| Original DYNAMIC `globalThis.process?.env?.[name]` (the bug) | **0** |
| Fix A static-only fallback | 1 |
| **Fix A (extra-first + static fallback) — shipped** | **1** |

The 0→1 jump on the export is the load-bearing proof the key is now reachable. jest also proves resolution from `extra` with `process.env` emptied (standalone simulation).

---

## 10. Known issues / deferred

- On-device dev-channel OTA + standalone dev-client GIF-tab render (SC-CORRECT-2 step 2) is the **tester's** runtime step (A3.2) — implementor scope ends at the standalone-export proof + jest simulation. No `[TRANSITIONAL]` code introduced.
- Renumber 1116→1127 deferred to CLOSE (ID collision with `SPEC_ORCH-1116_BOOKING_GATE_RLS.md`); worktree/branch kept as-is per A6.

---

## 11. Operator action required

- **No migration. No edge-fn deploy.** Nothing for `db push`.
- Tester (mingla-tester, business side): verify SC-CORRECT-1..4 on a **standalone export AND a dev-channel `eas update` pulled by a real installed build** — explicitly NOT the Metro bundle (A3.2). Re-publish the ORCH-1119 dev update afterward (COMMS-0028 notes this session's prior dev OTAs were ineffective + superseded ORCH-1119's head).
- Orchestrator: REVIEW → tester dispatch; at CLOSE flip the original §6 DRAFT invariants to ACTIVE and renumber to ORCH-1127.

---

## 12. Discoveries for Orchestrator

- During rebase onto `origin/main`, a conflict in `.github/workflows/strict-grep-mingla-business.yml` — ORCH-1117 added a job at the same anchor point as the ORCH-1116 job from `9b10dd2b1`. Resolved by keeping BOTH jobs (no logic lost). FYI only.
- The two existing service tests previously passed ONLY because Node/jest populates `process.env` (the same illusion as Metro, per F-CORRECT-5). They now carry an explicit empty-`extra` mock so they genuinely exercise the static-`process.env` fallback path; the new `giphyKeyReachability.test.ts` is the one that exercises the standalone (extra-only) condition.
