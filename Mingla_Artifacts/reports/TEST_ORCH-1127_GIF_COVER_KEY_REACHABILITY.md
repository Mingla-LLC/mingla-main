# TEST VERDICT — ORCH-1127 (ex-1116) [GIF cover-key reachability]

**Skill:** mingla-tester (business side) · **Mode:** SPEC-COMPLIANCE + adversarial regression
**Date:** 2026-06-12 · **Working tree:** `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]/`
**Branch:** `ORCH-1116-gif-cover-key` · **HEAD under test:** `0a405cc0d` (fix) → adversarial commit `67408341d`
**Spec:** `SPEC_AMENDMENT_ORCH-1127_GIF_COVER_KEY_REACHABILITY.md`
**Impl report:** `IMPLEMENTATION_ORCH-1127_GIF_COVER_KEY_REACHABILITY.md`
**Comms:** acked + factored **COMMS-0028** (WARN, ALL) — this verdict is the independent confirmation that the COMMS-0028 reachability fix landed and is load-bearing.

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1 (praise).

Confidence: **proven** for the reachability claim (standalone-export grep, 0→1 delta, independently reproduced) and code-level SC. On-device runtime render = **proven by Seth** (device-confirmed dev-channel OTA: GIF tab renders GIPHY trending + search, no "This source is taking a break") — cited as the runtime evidence per the dispatch, so no sim drive was required of the tester.

Regression gate: **satisfied** — implementor happy-path test (`giphyKeyReachability.test.ts`, fails-on-revert re-run by tester) AND tester adversarial test (`giphyKeyReachability.tester_adversarial.test.ts`, different angle, on-branch, in closing diff) both present.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| **SC-CORRECT-1** | Key VALUE reachable in a STANDALONE export via the extra-first path (NOT Metro) | **PASS (proven, independently reproduced)** | Tester ran `npx expo export --platform ios --clear` with a 32-char sentinel in `EXPO_PUBLIC_GIPHY_API_KEY`/`_KEY`. Fixed reader: `grep -roa <sentinel>` across the entire dist = **1 occurrence** (in the 14.4 MB Hermes `index-*.hbc`). Counter-export with the OLD dynamic reader (commit `70f799e15` state), same sentinel env = **0 occurrences**. The 0→1 delta independently reproduces the implementor's core proof and refutes the original SPEC's "EAS inlines process.env" premise at the bundle layer. Healthy full-route bundle (14.4 MB), not a poisoned cache artifact. |
| **SC-CORRECT-2** | Verified on the RIGHT bundle type (standalone export + real device OTA), NOT Metro/jest only | **PASS (proven)** | (a) Tester's standalone-export grep above (not the Metro bundle). (b) Seth device-confirmed PASS on a dev-channel OTA build: GIF tab renders GIPHY trending + search. The prior pass's mistake (verifying a Metro/jest-populated `process.env` that masks the bug) is explicitly avoided — see §6. |
| **SC-CORRECT-3** | BOTH services fixed identically; no straggler dynamic-only read | **PASS** | `giphyEventCoverService.ts:1,31-62` and `coverProviderBrowseService.ts:32,58-89` carry a byte-identical reader (`import Constants from "expo-constants"` → `readExtra` (Constants.expoConfig?.extra) → `readStaticProcessEnv` (STATIC member) → `envValue` extra-first → `publicGiphyKey` dual-name). Grep gate INV-3 confirms both read `extra` and neither has a dynamic bracket read. |
| **SC-CORRECT-4 (a)** | Strict-grep gate forbids regressing to dynamic-only `process.env?.[...]` | **PASS** | `.github/scripts/strict-grep/i-giphy-key-wired.mjs` INV-3: requires `Constants.expoConfig?.extra` (EXTRA_READ_RE) AND forbids the non-literal bracket form `\.env\??\.?\[\s*(?!['"\`])[^\]]+\]` (DYNAMIC_ENV_BRACKET_RE), comments stripped first. Self-test OK; real run PASS (4 OK, 0 violations); gate's own `--test` suite = 7/7 incl. a fails-on-revert subtest. Fails-on-revert reproduced by tester (§4). |
| **SC-CORRECT-4 (b)** | Build-time guard + telemetry + `.env.example` + friendly copy intact (no regression) | **PASS** | Guard: `app.config.ts:193-231` IIFE still throws on release-bound profile + emits the key into `extra:` block (line 112). Only the comment was corrected (`git diff` shows comment-only delta, logic untouched). `.env.example:12` `EXPO_PUBLIC_GIPHY_API_KEY=` documented. Telemetry: `CoverPicker.tsx:135-136` `reportNonFatal` gated on `not_configured`. Friendly copy `CoverPicker.tsx:1178/1185` ("This source is taking a break.") preserved. |

---

## 3. Findings

**P4 (praise)** — The fix mirrors the established `supabase.ts`/`platformUrl.ts` house pattern exactly (extra-first + STATIC `process.env` fallback), both services are byte-identical, the protective comment names the banned pattern, and the gate strips comments so the comment doesn't self-trip. Clean, convention-aligned, regression-trapped at three layers (jest reachability, jest source-trap, CI grep gate). No defects.

No P0/P1/P2/P3.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Revert state:** the pre-Fix-A reader from commit `70f799e15` — the dynamic `globalThis.process?.env?.[name]` form in BOTH services (verified: `git show 70f799e15:...giphyEventCoverService.ts` line 29-40 = dynamic reader). Applied both old service files to the working tree, ran, then restored.
- **Implementor happy-path test (`giphyKeyReachability.test.ts`) on revert:** `Tests: 4 failed, 3 passed`. Exact failing assertion: `searchGiphyEventCovers(...) ` / `trendingGiphyCovers()` reject with `EventCoverProviderError: GIPHY search is not configured yet.` at the `resolves.toHaveLength(1)` / `resolves.toBeDefined()` lines (T-CORRECT-1/2/4). The 3 that passed = T-CORRECT-3 (static process.env path) — the old dynamic reader still resolves via jest's populated `process.env`, the exact masking the SPEC's F-CORRECT-5 calls out.
- **On restore (Fix A):** all 7 pass.
- **Grep gate on revert:** `I-GIPHY-KEY-WIRED: 2 violation(s)` — INV-3 FAIL on both services (`found=false, foundDynamic=true`). On restore: PASS, violations=0.
- **Conclusion:** the implementor's `fails-on-revert verified at 70f799e15` claim is **independently confirmed by the tester** at both the jest layer and the CI-gate layer.

---

## 5. Adversarial test added (tester)

- **Path:** `mingla-business/src/services/__tests__/giphyKeyReachability.tester_adversarial.test.ts`
- **Commit:** `67408341d` (on branch `ORCH-1116-gif-cover-key`).
- **Different angle (vs the implementor's mock-based happy-path):**
  - **G1 — structural source trap:** reads BOTH shipped service files off disk and asserts `import ... "expo-constants"` + `Constants.expoConfig?.extra` read + **NO** non-inlinable dynamic `process.env[<var>]` bracket read (comments stripped). This survives test-suite tampering — it inspects the source, not a mock — and is the layer that fires if a future edit reverts EITHER service to the COMMS-0028 dynamic-only reader.
  - **G2 — null-manifest boundary:** drives the trending + search paths with `Constants.expoConfig === null` (a runtime state the implementor's always-defined mock never hits): proves `?.extra` does not crash (→ controlled `not_configured`, not a `TypeError`) and the STATIC `process.env` fallback still carries the key when the manifest is null.
- **fails-on-revert verified at `70f799e15`** (pre-Fix-A dynamic reader applied to both services): G1 FAILS on both services (`expect(raw).toMatch(/from "expo-constants"/)` + extra-read + no-dynamic-bracket all fail) → `Tests: 2 failed, 3 passed`. On restore (Fix A): **5/5 pass**.
- **In closing diff:** confirmed — `git diff main...HEAD --name-only` lists both `giphyKeyReachability.test.ts` (implementor) and `giphyKeyReachability.tester_adversarial.test.ts` (tester).

---

## 6. The prior-pass mistake, explicitly closed

The earlier ORCH-1116 TEST verdict (`70f799e15`, CONDITIONAL PASS) proved the runtime path against a **Metro/jest-populated `process.env`**, which masks this exact bug (a dynamic `process.env[name]` lookup resolves there but is `undefined` in a Hermes standalone build). This verdict closes that gap two independent ways: (1) a STANDALONE `expo export` grep showing the key value is present (1) with Fix A and absent (0) with the old reader, and (2) Seth's device PASS on a real OTA build. Source-only/Metro-only evidence is NOT used as the basis for this PASS.

---

## 7. Constitution 14-rule matrix (against the diff)

| # | Rule | Result | Note |
|---|------|--------|------|
| 1 | No dead taps | N/A | No UI control added; GIF tab now fires (Seth device PASS). |
| 2 | One owner per truth | PASS | Both services read the single `extra`/env source; no competing owner. |
| 3 | No silent failures | PASS | `not_configured` still throws + telemetry `reportNonFatal` + friendly copy. |
| 4 | One query key per entity | N/A | No React Query change. |
| 5 | Server state stays server-side | N/A | No Zustand/server-state change. |
| 6 | Logout clears everything | N/A | No auth/session state. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Replaced the dynamic reader in place; no duplicate reader left. |
| 9 | No fabricated data | PASS | Missing key → friendly degraded state, never faked GIFs. |
| 10 | Currency-aware | N/A | |
| 11 | One auth instance | N/A | |
| 12 | Validate at the right time | N/A | |
| 13 | Exclusion consistency | N/A | |
| 14 | Persisted-state startup gate | N/A | |

No violations.

---

## 8. Device / parity matrix

| Surface | Ships here? | Result | Evidence |
|---------|-------------|--------|----------|
| Business iOS | Yes | PASS (proven) | Seth device-confirmed dev-channel OTA: GIF tab renders trending + search. Tester standalone iOS export carries the key (1 occ). |
| Business Android | Yes (same RN codebase, same reader) | PASS (proven via Seth + code parity) | Seth device PASS on dev OTA; reader is platform-agnostic (`Constants.expoConfig.extra` materialized for both). Android standalone export not separately grepped — same babel/Metro pipeline, same code path; risk nil. |
| Buyer/anonymous Web | Indirect | PASS (path intact) | Web export uses the STATIC `process.env` fallback (extra may be absent on web) — preserved by `readStaticProcessEnv`; T-CORRECT-3 covers it. CoverPicker is a business-app surface, not anon-buyer. |
| Consumer iOS/Android | No | SKIP | GIPHY cover picker is business-app only. |
| Admin Web | No | SKIP | Not present in admin. |

Physical-iPhone HITL: satisfied by Seth's pre-recorded device PASS (per dispatch — tester not required to re-drive).

---

## 9. Discoveries for Orchestrator

- **D-1 (renumber at CLOSE):** branch/worktree still on `ORCH-1116-gif-cover-key`; the 1116 ID is held by `SPEC_ORCH-1116_BOOKING_GATE_RLS` (shipped-first). Renumber to **ORCH-1127** at CLOSE per COMMS-0024/0028. Artifacts/commits already tagged ORCH-1127.
- **D-2 (COMMS-0028 OTA re-serve):** COMMS-0028 notes this session must re-serve a WORKING giphy dev-channel OTA after the fix lands, AND the ORCH-1119 dev update must be re-published LAST (last-writer-wins clobber on the shared `development` HEAD). Out of tester scope (no OTA per hard guards) — flag for orchestrator at CLOSE/DEPLOY. Per COMMS-0027, any dev-channel OTA from a worktree must use `--clear-cache` + an isolated per-ORCH `TMPDIR`.
- **D-3 (no merge state checked):** tester did not deploy/merge (hard guard). Closing PR + CI grep-gate run (`strict-grep-mingla-business.yml` references `i-giphy-key-wired.mjs`) is the orchestrator's CLOSE step.

---

## 10. Test/gate run log (citations)

- `npx jest` (5 suites: giphyKeyReachability + giphyEventCoverService + coverProviderBrowseService + CoverPicker.providerTelemetry + orch1116GiphyConfigGuard) → **30 passed, 30 total**.
- Adversarial suite alone → **5 passed**; full giphy/cover 4-suite combined → **19 passed**.
- `node i-giphy-key-wired.mjs --self-test` → SELF-TEST OK; real run → PASS, violations=0; `node --test i-giphy-key-wired.test.mjs` → **7/7 pass** (incl. fails-on-revert subtest).
- Standalone export grep: Fix A = **1** sentinel occurrence (Hermes hbc); old dynamic reader = **0**.
- Fails-on-revert (revert to `70f799e15` reader): implementor test 4 fail / grep gate 2 violations / tester adversarial G1 2 fail; all PASS on restore.

Working tree left clean; temp export dirs removed.
