# TEST — ORCH-1116 [Cover picker GIF tab "This source is taking a break"]

**Skill:** mingla-tester (business side) · **Phase:** TEST · **Date:** 2026-06-12
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]/` · **Branch:** `ORCH-1116-gif-cover-key`
**Branch head under test:** `b4d4d9991` (impl `9b10dd2b1` + report `78df87f52` + tester adversarial `b4d4d9991`)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1116_GIF_COVER_PICKER.md` (SC-1..SC-7)
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (iOS 26.4) · **Metro:** port 8086 (this worktree, `.env` loaded)

---

## 1. Verdict

**CONDITIONAL PASS** — 0 P0 · 0 P1 · 0 P2 · 1 P3 · 1 P4.

Conditional on ONE deferral that genuinely requires Seth (not an accepted defect):
the final **on-screen** GIF-tab render (SC-1/SC-2) could not be eyeballed because the
CoverPicker is behind the business-app **sign-in gate** and there is no active session on
the sim — sim login is an orchestrator/Seth touch-point (dispatch hard guard). Confidence on
SC-1/SC-2 is **`probable`** (deterministic runtime-path proof short of the pixel), NOT
`proven`. Everything else is `proven`.

> **CLOSE-GATING (not a TEST defect):** per COMMS-0024 this `gif-cover-key` branch shares the
> stale-anchor ID `ORCH-1116` with the booking-gate-rls session that legitimately keeps the
> number. This fix MUST be **renumbered off 1116** (lowest free ID ≥1122 at the time) before
> CLOSE/merge. Acked in the ledger.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence (confidence) |
|----|-----------|---------|-----------------------|
| **SC-1-iOS** | Fresh build → GIF tab shows GIPHY trending (NOT "This source is taking a break.") | **PROBABLE PASS** | Metro 8086 boot log: `env: load .env` + `env: export EXPO_PUBLIC_GIPHY_API_KEY EXPO_PUBLIC_GIPHY_KEY`. `.env` carries a 32-char GIPHY key (correct GIPHY public-key length; value not printed). Fetched the live iOS bundle from Metro 8086 (`/index.bundle?platform=ios`, 31 MB) → the **key VALUE is inlined** as `{"EXPO_PUBLIC_GIPHY_API_KEY": { enumerable: true, value: "<redacted>" }}` (4 occurrences) — the exact `process.env` shim the runtime reader `coverProviderBrowseService.ts:55-67 envValue()/publicGiphyKey()` walks. Therefore `publicGiphyKey()` returns non-null → `trendingGiphyCovers()` cannot throw `not_configured` → the GIF tab populates. **On-screen pixel BLOCKED on sim login** (see §7). Confidence `probable`. |
| **SC-1-Android** | Same on Android | **NOT RUN (skip+reason)** | Android emulator not in the dispatch device set; the fix is platform-agnostic (shared `coverProviderBrowseService` + EAS env spans both platforms of a profile). Same `probable` mechanism applies. State as skip. |
| **SC-2-iOS** | GIF search (≥2 chars) returns results | **PROBABLE PASS** | Same key path: `searchGiphyEventCovers` (giphyEventCoverService) reads the same `publicGiphyKey()`. `searchGiphyEventCovers` jest suite green (key-present + fail-close paths). On-screen typing BLOCKED on sim login. Confidence `probable`. |
| Pexels/Stock no-regression | Stock tab still works | **PASS** | Untouched edge-proxied path; `pexelsEventCoverService` + `coverProviderBrowseService` jest 25/25; CoverPicker stock catch-site only gained the same gated `reportProviderError("stock", error)` (no behavior change unless `not_configured`). |
| Library no-regression | Library tab still works | **PASS** (source) | No Library-tab code touched in the diff (`git show 9b10dd2b1` = .env.example + app.config guard IIFE + 4 catch-site lines + telemetry helper). |
| **SC-3** | Release-bound build w/o key FAILS at config-eval w/ explicit message | **PASS (proven)** | Tester adversarial test A1–A4 invoke the **real** `app.config.ts` default fn → THROW for `EAS_BUILD_PROFILE` preview/production-apk AND `VERCEL_ENV` production/preview, message `EXPO_PUBLIC_GIPHY_API_KEY is required for the <profile> build`. fails-on-revert proven (A1–A4 fail when the throw is removed). |
| **SC-4** | Dev/local build w/o key still builds (friendly copy, no crash) | **PASS (proven)** | Adversarial A5 (`development`) + A6 (local, no profile) → real default fn does NOT throw, returns null into `extra` + warns. |
| **SC-5** | `not_configured` emits telemetry; transient does NOT | **PASS (proven)** | Implementor jest T5/T6/T6b + non-provider-Error (8/8). Code review: `CoverPicker.tsx:129-137 reportProviderError` gated `if (code !== "not_configured") return;` then single `reportNonFatal("coverPicker.provider", …)`; wired at all 4 catch sites (`:614, :633, :665, :680`). Transient/`invalid_response`/`provider_unavailable`/`rate_limited` short-circuit before the emit. (Runtime Sentry delivery is a no-op on dev — DSN prod-only, per O-2/D-1 — gating logic verified, not Sentry transport.) |
| **SC-6** | `.env.example` documents the key | **PASS (proven)** | `.env.example` carries `EXPO_PUBLIC_GIPHY_API_KEY=` + dashboard link + rebuild-vs-OTA note (diff). Strict-grep INV-2 enforces it. |
| **SC-7** | Strict-grep gate PASSES w/ guard, FAILS on revert | **PASS (proven)** | `i-giphy-key-wired.mjs --self-test` → `SELF-TEST OK`; real run → `PASS · violations=0` (INV-1 guard+throw, INV-2 .env.example); `node --test i-giphy-key-wired.test.mjs` → **5/5** incl. 2 fails-on-revert cases (guard→passthrough; .env.example entry removed). |

---

## 3. Findings (P-numbered)

### P3 — Implementor happy-path test exercises a re-implemented MIRROR, not the real exported helper
- **Evidence:** `CoverPicker.providerTelemetry.test.ts:49-54` defines a private `gateUnderTest` copy of `reportProviderError`; T5/T6 call the copy, not the real exported `reportProviderError` (CoverPicker.tsx:129). The real call-site coverage is source-string greps (`:101-124`).
- **Impact:** the behavioral split is proven on a byte-copy; a divergence between the copy and the real helper would not be caught behaviorally (only the source-grep would). LOW — the source greps do catch a real-helper edit, and the tester adversarial test exercises the real `app.config.ts` guard. Not blocking.
- **Required fix:** none required for CLOSE; optional future hardening = import the real `reportProviderError` with native deps mocked (high mock cost under the plain `ts-jest` node preset — why both implementor and tester avoided it for the CoverPicker module).
- **Retest:** n/a (informational).

### P4 — Clean, scope-disciplined change + correct CONFIG-vs-transient gating
- The diff is exactly the SPEC allowlist (7 files); the telemetry gate is a single helper at one call-site, gated `not_configured`-only as specified; the app.config guard faithfully mirrors the Stripe `pk_live` guard incl. the dev/local asymmetry and the VERCEL_ENV web-export superset. Friendly copy untouched. Good work.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out branch head `b4d4d9991`; ran `CoverPicker.providerTelemetry` → **8/8 PASS**.
- TRUE line-deletion of the gate `if (code !== "not_configured") return;` from `CoverPicker.tsx` (via `perl -ni`, confirmed `grep -c` → 0) → re-ran → **1 failed / 7 passed**; exact failing assertion:
  `CoverPicker.providerTelemetry.test.ts:109` → `expect(coverPickerSrc).toMatch(/if \(code !== "not_configured"\) return;/)`.
- Restored via `cp` of the pre-edit backup → `git diff --stat` empty → re-ran → **8/8 PASS**.
- **Implementor fails-on-revert independently confirmed at `9b10dd2b1`.** (Note: the failing assertion is the source-wiring grep, not the behavioral mirror — consistent with P3.)

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `mingla-business/src/__tests__/orch1116GiphyConfigGuard.test.ts` (NEW, append-only).
- **Commit:** `b4d4d9991` (on-branch; in `git diff origin/main...HEAD --name-only`).
- **Angle (DIFFERENT from implementor):** the implementor attacked the *telemetry split* via a mirror + source greps and only manually probed the `app.config.ts` guard (uncommitted). This test exercises the **REAL `app.config.ts` default function** at runtime across the env matrix — including the **VERCEL_ENV web-export THROW branches** the implementor never committed-tested, plus key-plumbing-into-`extra` and the legacy `EXPO_PUBLIC_GIPHY_KEY` fallback. 8 cases (A1–A8): EAS preview/production-apk THROW; VERCEL_ENV production/preview THROW; development/local NO-throw; key-present plumbs value; legacy-name fallback satisfies. Masking note documented (supplies a shape-valid Stripe pk for the VERCEL_ENV cases so the sibling Stripe guard passes first).
- **Run:** 8/8 PASS at HEAD.
- **fails-on-revert verified at `b4d4d9991`:** reducing the GIPHY guard throw to a passthrough (perl, `grep -c` → 0) → **A1–A4 FAIL** (the THROW assertions), A5–A8 correctly still pass → restored → 8/8 PASS.
- **Both tests in the closing diff:** confirmed — `git diff origin/main...HEAD --name-only` lists `orch1116GiphyConfigGuard.test.ts` AND `CoverPicker.providerTelemetry.test.ts`.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No new control; "Use Library"/"Try again" buttons unchanged. |
| 2 | One owner per truth | PASS | Key read by one helper `publicGiphyKey()`; guard is validation-only, not a new plumbing path. |
| 3 | No silent failures | PASS (strengthened) | This change ADDS telemetry to the previously-silent `not_configured`; transient stays user-facing (intentional). |
| 4 | One query key per entity | N/A | No React Query change. |
| 5 | Server state server-side | N/A | No Zustand/server-state change. |
| 6 | Logout clears everything | N/A | Not touched. |
| 7 | `[TRANSITIONAL]` labeled | PASS | None introduced. |
| 8 | Subtract before adding | PASS | Net +1 helper, reuses existing `reportNonFatal`; no parallel mechanism. |
| 9 | No fabricated data | PASS | Missing key → friendly "unavailable" + Library fallback; nothing faked. |
| 10 | Currency-aware | N/A | |
| 11 | One auth instance | PASS | No new `useAuth`; CoverPicker's existing single instance unchanged. |
| 12 | Validate at right time | PASS | Guard validates at BUILD/config-eval time (correct for an `EXPO_PUBLIC_*` build-time inline). |
| 13 | Exclusion consistency | N/A | |
| 14 | Persisted-state startup | N/A | |

No violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS | N/A | No CoverPicker / no GIPHY ref. |
| Consumer Android | N/A | Same. |
| Buyer/anon Web | N/A | Authoring surface, not buyer. |
| **Business iOS** | **PROBABLE (BLOCKED on sim login for pixel)** | App launched on sim `17091E60…` against Metro 8086; bundle built (4739 modules) WITH the GIPHY key inlined (§2 SC-1). App landed on the **sign-in screen** — async-storage manifest shows `currentBrand`/`brandTeamStore` persisted but **NO Supabase auth-token key** → no active session. Every CoverPicker mount (`ExperienceCoverStep`, `BrandCreationFlow`, `BrandEditView`, `VenueCreatorWizard`, `TripCreatorStep1Basics`, `EditPublishedTripScreen`, Ari `ToolProposalCard`) is behind auth — none anon-reachable. Cannot log in without guessing credentials (dispatch hard guard). |
| Business Android | SKIP | Not in device set; platform-agnostic fix. |
| Admin Web | N/A | No CoverPicker. |
| Business Web preview | N/A (config covered) | Guard adds VERCEL_ENV fail-loud branch (adversarial A3/A4); web env-provisioning is the deferred O-4 operator step. |

**Physical iPhone HITL:** not requested in dispatch; not run.

**Operator-unblock ask:** to convert SC-1/SC-2 to `proven`, Seth logs into the business app on sim `17091E60-C3B6-4167-980D-60C348E177F6` (Metro 8086) with a real business account, opens any cover authoring surface (e.g. create an experience/event → Cover step), taps the **GIFs** tab, and confirms GIPHY trending thumbnails render (no "This source is taking a break."). Then type ≥2 chars to confirm search.

---

## 8. Discoveries for Orchestrator

1. **Renumber-before-CLOSE (COMMS-0024):** this `gif-cover-key` branch must drop ORCH-1116 for the lowest free ID (≥1122) before merge — booking-gate-rls keeps 1116. Acked in ledger (`COMMS_LEDGER` commit on main).
2. **COMMS-0026 corroborates the fix:** an independent forensics session proved the root cause = the 2026-05-25 channel-flip `4c3bdfe8f` pointing the `development` profile at a keyless channel, and proved the fix = provision the GIPHY key into dev/preview + REBUILD (the installed binary bakes the null in). This TEST's bundle-inlining evidence is the same mechanism from the build side. The "June-3 runtime regression" theory is a red herring (killed by COMMS-0026). Acked.
3. **Operator pre-req for production parity:** the dispatch states EAS dev/preview env + local `.env` were already provisioned; this was confirmed (Metro env export + `.env` key + bundle inlining). The remaining operator step for a **fresh installed dev/preview build** on Seth's physical device (vs the Metro-served bundle on sim) still applies — EXPO_PUBLIC bakes at build time.
4. **At CLOSE:** flip the 3 DRAFT invariants ACTIVE (I-PROPOSED-GIPHY-KEY-FAIL-LOUD, I-PROPOSED-GIPHY-KEY-WIRED, I-PROPOSED-CONFIG-ERROR-IS-OBSERVABLE) + register `i-giphy-key-wired` in README/INVARIANT_REGISTRY (already wired into `strict-grep-mingla-business.yml`).

---

## 9. Accepted conditions (CONDITIONAL PASS)

- **C-1 (deferral, needs Seth — NOT an accepted P1):** SC-1/SC-2 on-screen pixel render at `probable` (sim login blocker; mechanism proven via bundle inlining + runtime reader trace). Convert to `proven` via the §7 operator-unblock ask. No code defect underlies this — purely an environment/auth touch-point reserved for Seth.

---

## 10. Test/gate run log (this session)

- `i-giphy-key-wired.mjs --self-test` → `SELF-TEST OK`
- `i-giphy-key-wired.mjs` → `PASS · violations=0`
- `node --test i-giphy-key-wired.test.mjs` → 5/5
- `jest CoverPicker.providerTelemetry coverProviderBrowseService giphyEventCoverService pexelsEventCoverService reportNonFatal` → 25/25 (5 suites)
- `jest orch1116GiphyConfigGuard` (tester adversarial) → 8/8; revert → 4 failed/4 passed; restore → 8/8
- `jest CoverPicker.providerTelemetry` revert→restore (Step 0.5) → 1 failed/7 → 8/8
- `tsc --noEmit` → 0 errors in any touched file (255 pre-existing baseline errors elsewhere, unchanged)
- Metro 8086 iOS bundle fetch → GIPHY key value inlined (4 occurrences)
