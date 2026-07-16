# IMPLEMENTATION — ORCH-1373 [accept-invite-infinite-loader] + 1374 / 1375 / 1376 / 1377 / 1378 / 1380 / 1382

**Skill:** mingla-implementor · **Dispatched by:** mingla-orchestrator
**Date:** 2026-07-15
**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1373_accept-invite-infinite-loader.md`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1373-[accept-invite-infinite-loader]/` on `ORCH-1373-accept-invite-infinite-loader` (rebased onto `origin/main`)
**Status:** **implemented, partially verified** — all 13 SPEC steps built, all gates proven in both directions; runtime/device verification is the tester's (see §9 + OQ-2).

---

## 1. Summary

A brand gets an emailed invite, clicks "Accept invite", and lands on a spinner that never stops. It never accepts, never errors, never says anything. **Every logged-out invitee hits this** — which is essentially every invitee, because an invitee is by definition someone clicking a link in an email. Lifetime funnel: **0 accepted of 1 sent**.

The page's first line said *"if auth isn't ready, wait"*, and the code meant to catch a logged-out visitor and send them to sign in sat **one line below it**. Those two conditions can never both be true, so that redirect **never executed in production**. The page had no screen for a logged-out invitee — only a spinner.

**What a user gets now:**

| ORCH | Plain English |
|---|---|
| **1373** | The invite page resolves fast and always states the outcome — including a real "You're invited / Sign in" screen if you're logged out. Two error states that wrongly said "try again" now tell the truth. |
| **1374** | The scanner-invite page — a line-for-line clone of the same bug — fixed before it ever fires (0 rows today; a loaded landmine). |
| **1375** | Signing in from an invite actually **resumes** the invite instead of dumping you on home with the token thrown away. Works for **email AND Google/Apple**. |
| **1378** | A successful invitee gets an **attributed** "Download the app" button that works on iOS and Android; a crash on every business-web page load is fixed. |
| **1377** | A production log that **lied on 100% of loads** stops lying, and the real state-corruption bug behind it is fixed. |
| **1376** | A latent trap that would silently destroy an invite token / Stripe secret is closed. |
| **1380** | A second live crash (every tab refocus) is fixed. |
| **1382** | A live double-navigation bug in `mingla-business` — every "see who's going" tap opened a tab **and** destroyed the page — is fixed, and the guard now covers both owners. |

**The load-bearing risk the SPEC exists to prevent, honored:** ORCH-1375 shipped *with* 1373. Fixing 1373 alone converts an infinite spinner into a **silent token drop** that *looks like success* — worse than the bug.

---

## 2. SPEC success-criteria coverage

| ID | Criterion | Verdict | Commit | How verified |
|---|---|---|---|---|
| **SC-1-Web** | Logged-out visitor sees "You're invited" + Sign in ≤1.5s; never a spinner outliving auth | ✓ code + unit | `78b06a5f0` | `orch_1373_mutual_exclusivity.test.ts` (12/12) — logged-out branch reachable, spinner unreachable for `signed_out`. **Wall-clock ≤1.5s is tester's (device).** |
| **SC-2-Web** | `signed_out` **provably reaches** the logged-out branch | ✓ **PROVEN** | `78b06a5f0` | §9.1 test over the **real, unmodified** `authReadiness.ts`; exhaustive sweep → 0 reachable combinations for the shipped gate. |
| **SC-3-Web** | Email-OTP resume returns to the invite; token not discarded | ✓ unit | `22c2731b1` | `authNextHandoff.test.ts` T-9. **End-to-end is tester's.** |
| **SC-4-Web** | **OAuth resume** does the same (the leg a naive fix breaks) | ✓ unit | `22c2731b1` | T-10 simulates the real round-trip (URL annihilated) + a companion test proving the naive URL-only fix drops the token. **End-to-end is tester's — priority.** |
| **SC-5-Web** | 6 named attacks all resolve to home, never off-origin | ✓ **PROVEN** | `46438ec51` | `nextRoute.test.ts` 33/33 — all six SC-5 strings + 11 more. |
| **SC-6-Web** | All 9 outcome states render §4.1.3 copy incl. `invite_declined` + `invite_currency_mismatch` | ✓ code | `78b06a5f0` | Copy lifted verbatim from `InvitePendingSheet.tsx:159-166`. **Render proof is tester's.** |
| **SC-7-Web** | Resolved `phase` never re-masked by auth change | ✓ code | `78b06a5f0` | Render order restructured: `phase` branches precede all auth branches. |
| **SC-8-Web** | `getSession()` retry loop gone | ✓ **PROVEN** | `78b06a5f0` | Deleted; `grep getSession app/accept-brand-invitation.tsx` → 0. |
| **SC-9-Web** | Scanner satisfies SC-1/2/3/4/7 identically | ✓ code | `78b06a5f0` | Same restructure; SPEC's 3 binding differences honored. |
| **SC-10-Web** | Download CTA on **both** success surfaces → `biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept` | ✓ **PROVEN** | `487221525`, `78b06a5f0` | `BusinessAppDownloadCta.test.ts` 12/12 pins exact URL + bans 4 attribution-killing destinations. |
| **SC-11-Web** | Tapping opens a new tab; page **stays mounted** | ✓ **PROVEN** | `0c9767a0e` | `orch_1382_open_external_no_double_nav.test.ts` 7/7 vs a fake Window honoring the real null-on-success contract. |
| **SC-12-Web** | Zero `subscribeOneLinkDeepLink` TypeErrors | ✓ **PROVEN** | `6253d530d` | Runtime call test (9/9). **Live page load is tester's.** |
| **SC-13-Web** | Zero `syncPushPermissionTag` TypeErrors on refocus | ✓ **PROVEN** | `6253d530d` | Runtime call test. **Live refocus is tester's.** |
| **SC-14-Web** | `[auth] loading-gate-backstop` NOT emitted on a resolved load (was 4/4) | ✓ **PROVEN** | `40f79aad3` | `AuthContext.diagnosticTruth.orch1377.test.ts` T-11 (16/16). |
| **SC-15-Web/iOS/Android** | `bootstrapTimedOutRef` not armed by the backstop on a resolved bootstrap | ✓ **PROVEN** | `40f79aad3` | T-11 behavioral + structural: all 3 resolution points set the ref. **Native runtime not exercised** (§10). |
| **SC-16-Web** | `_layout:737` doesn't redirect a self-auth exempt route when expired | ✓ code | `40f79aad3` | Exempt check added; **latent, proven inert 0/4 — not claimed as active.** |
| **SC-17-CI** | Parity gate FAILS on a deleted shim export, PASSES restored — **both directions** | ✓ **PROVEN** | `2a8d9ffae` | §7 proof table. |
| **SC-18-CI** | Extended 1342 gate FAILS on a `biz.usemingla.com` literal outside the SSOT | ✓ **PROVEN** | `953f67ac5` | The SPEC's own decorative probe now EXIT=1 (was PASS). |
| **SC-19-CI** | Open-external gate FAILS on `noopener` **or** `noreferrer`, **any case**, in **either** owner | ✓ **PROVEN** | `0c9767a0e` | 4-direction live proof incl. UPPERCASE. |

---

## 3. Files changed (36 files, +4767 / −223)

**Created (11):**
| File | Purpose |
|---|---|
| `mingla-business/src/utils/nextRoute.ts` | `sanitizeNextRoute` — the open-redirect validator |
| `mingla-business/src/utils/authNextHandoff.ts` | sessionStorage handoff (the OAuth leg) |
| `mingla-business/src/components/invite/BusinessAppDownloadCta.tsx` | the attributed CTA |
| `.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs` | the class-closing gate |
| `mingla-business/src/utils/__tests__/nextRoute.test.ts` | T-16 (33) |
| `mingla-business/src/utils/__tests__/authNextHandoff.test.ts` | T-9/10/14/15, SC-4 (15) |
| `mingla-business/src/utils/__tests__/orch_1373_mutual_exclusivity.test.ts` | T-2 (12) |
| `mingla-business/src/services/__tests__/orch_1378_web_shim_parity.test.ts` | T-20/21 (9) |
| `mingla-business/src/services/__tests__/orch_1382_open_external_no_double_nav.test.ts` | T-19 (7) |
| `mingla-business/src/components/invite/__tests__/BusinessAppDownloadCta.test.ts` | T-18/23 (12) |
| `mingla-business/src/context/__tests__/AuthContext.diagnosticTruth.orch1377.test.ts` | T-11/12 (16) |

**Modified (14 product + 4 tests + 3 gates/workflow):**
`app/accept-brand-invitation.tsx` · `app/accept-brand-invitation/success.tsx` · `app/accept-scanner-invitation.tsx` · `app/auth/index.tsx` · `app/auth/callback.tsx` · `app/_layout.tsx` · `app/index.tsx` · `src/context/AuthContext.tsx` · `src/utils/coldLoadAuthGates.ts` · `src/services/appsFlyerService.web.ts` · `src/services/oneSignalService.web.ts` · `src/services/guestFunnelLink.ts` · `src/constants/storeLinks.ts` · `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` · `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs` · `.github/workflows/strict-grep-mingla-business.yml` · 4 test files (rename-tracking only — §8).

**Allowlist compliance — verified mechanically:** `supabase/**` ZERO · `mingla-marketing/**` ZERO · `app-mobile|mingla-admin|packages` ZERO · `authReadiness.ts` ZERO · `SeeWhosGoingGate`/`InvitePendingSheet` ZERO · `app.json`/`eas.json` ZERO.

**Two files touched beyond the §11.1 list, both forced and both reported:** `app/index.tsx` (constant #2 rename — a caller the SPEC's blast radius missed) and `src/__tests__/orch1102Wave2LoadingTimeout.test.ts` + `AuthContext.bootPaintDecouple.orch1294.test.ts` (see §8 SPEC-CORRECTION-1).

---

## 4. Data-model changes applied

**NONE.** No migration written, no `supabase/**` file touched, no production DB write. The schema already expresses every outcome (`accepted_at`/`expires_at`/`revoked_at`/`declined_at`/`status`) and the edge fn already returns all seven error codes — the bug was **100% client-side**. Confirmed by reading `supabase/functions/accept-brand-invitation/index.ts:96-116` (read-only).

## 5. Edge functions touched

**NONE.** No deploy required. (Read-only inspection of `accept-brand-invitation` and `accept-scanner-invitation` confirmed the 7-vs-5 error-code asymmetry the copy fix depends on.)

---

## 6. Regression tests added

**104 new tests across 7 new files, all green.**

| File | Tests | Covers |
|---|---|---|
| `nextRoute.test.ts` | 33 | T-16 / SC-5 |
| `AuthContext.diagnosticTruth.orch1377.test.ts` | 16 | T-11/T-12 / SC-14/15 |
| `authNextHandoff.test.ts` | 15 | T-9/10/14/15 / **SC-4** |
| `orch_1373_mutual_exclusivity.test.ts` | 12 | **T-2 / SC-2** |
| `BusinessAppDownloadCta.test.ts` | 12 | T-18/23 / SC-10 |
| `orch_1378_web_shim_parity.test.ts` | 9 | T-20/21 / SC-12/13 |
| `orch_1382_open_external_no_double_nav.test.ts` | 7 | T-19 / SC-11 |

**`fails-on-revert verified at `40f79aad3`` (diagnostic-truth guard):** true **line-deletion** of `if (bootstrapResolvedRef.current) return;` → T-11a/b/c/d **FAIL**; restore → 16/16 PASS; file byte-exact vs pre-mutation backup.

**§9.1 fails-on-revert by construction:** the mutual-exclusivity proof imports the **real, unmodified** `authReadiness.ts`. Restoring the `!isAuthReady` early-return makes the logged-out branch unreachable → the reachability assertion fails. This is why §11.2 forbids touching that module, and I did not.

---

## 7. ⚠️ BOTH-DIRECTIONS GATE PROOFS (SPEC §9.0 — the binding rule)

> ORCH-1381 shipped a live production bug past **two GREEN gates** because they asserted TOKEN PRESENCE, not BEHAVIOUR. Every gate below was proven to fail, with the exact mutation recorded.

### 7.1 `i-1378-web-shim-export-parity.mjs` (NEW) — SC-17

| # | Mutation (on the **real shipped** files) | Result |
|---|---|---|
| 1 | line-DELETE `subscribeOneLinkDeepLink` from `appsFlyerService.web.ts` | **EXIT=1** ✓ |
| 2 | line-DELETE `syncPushPermissionTag` from `oneSignalService.web.ts` | **EXIT=1** ✓ |
| 3 | restore both | **EXIT=0**, 28 pairs green, byte-exact ✓ |

Self-test **11/11**, incl. an **anti-decorative case**: a name mentioned only in a **comment** does NOT satisfy the gate. Plus superset-passes, type-only-passes, orphan-skipped.
**No allowlist** — 28 pairs swept, 0 drifting.

### 7.2 `orch-1342-store-links-ssot.mjs` (EXTENDED) — SC-18

| # | Mutation | Result |
|---|---|---|
| 1 | **The SPEC's exact decorative probe**: `const PROBE = "https://biz.usemingla.com/ZSCW";` appended to `guestFunnelLink.ts` | **EXIT=1** ✓ — **was EXIT=0 (PASS) before this PR** |
| 2 | `"https://BIZ.USEMINGLA.COM/ZSCW"` (UPPERCASE) | **EXIT=1** ✓ (case-insensitivity real) |
| 3 | `"https://minglabiz.onelink.me/ZSCW"` | **EXIT=1** ✓ |
| 4 | **T-24**: re-add `apps.apple.com` literal to the **de-grandfathered** `success.tsx` | **EXIT=1** ✓ — would have been PASS while grandfathered |
| 5 | restore all | **EXIT=0**, byte-exact ✓ |

Self-test **17/17** (was 11/11). All five BANNED patterns made **case-insensitive**.

### 7.3 `orch-1381-open-external-no-double-nav.mjs` (EXTENDED to 2 owners) — SC-19

| # | Mutation (on the **real** `guestFunnelLink.ts`) | Result |
|---|---|---|
| 1 | restore the **exact LIVE shipped shape** (`'noopener,noreferrer'` + `if(!win) assign`) | **EXIT=1** ✓ (R1+R2+R3 all fire) |
| 2 | **HALF-FIX**: drop `noopener`, keep `'noreferrer'` | **EXIT=1** ✓ |
| 3 | **UPPERCASE** `'NOOPENER'` | **EXIT=1** ✓ |
| 4 | remove `win.opener = null` | **EXIT=1** ✓ (tabnabbing) |
| 5 | restore | **EXIT=0**, byte-exact ✓ |

Self-test **12/12** (was 8/8), incl. the live-business broken AND fixed shapes.

### 7.4 Collateral gates (not weakened)
`orch-1324-business-getapp-device-aware` · `orch-1328-links-cta-opens-store-clientside` · `orch-1381-business-getapp-android-choice` · `orch-1105-layout-no-self-redirect` — **all LIVE-PASS**.

---

## 8. ⚠️ WHERE THE SPEC WAS WRONG (all resolved in code; spec amendment owed)

The dispatch asked me to say so. Five findings — the SPEC was excellent, and these are the seams.

### SPEC-CORRECTION-1 — §4.5.3 / §11.1: the rename blast radius is **5 files, not 3** *(would have broken CI)*
§4.5.3 enumerates `AuthContext.timeout.test.ts`, `authContext.adversarial.orch1204.test.tsx`, `authContext.sync-hydration.orch1204.test.tsx`. It **missed**:
- **`mingla-business/src/__tests__/orch1102Wave2LoadingTimeout.test.ts`** — **16 references**, incl. a hard regex `/export const AUTH_RESOLUTION_HARD_CEILING_MS = (\d+);/`. This file is **not in the §11.1 allowlist** and would have **failed CI**. It is also the *largest* consumer of both renamed constants.
- `AuthContext.bootPaintDecouple.orch1294.test.ts` (comment ref — stale, not breaking).
- **`app/index.tsx`** — a *product* caller of constant #2 (3 refs), also not in the allowlist.

Also: `AuthContext.timeout.test.ts` — which the SPEC *did* list — contains **zero** references to either constant. The enumeration was inverted from reality on 2 of 3 entries.
**Resolved:** all 5 updated; every deletion **mechanically proven rename-only** (normalise identifier → files byte-identical to `origin/main`).

### SPEC-CORRECTION-2 — §4.4.2: `subscribeOneLinkDeepLink` returns **`void`**, not an unsubscribe function
The SPEC mandates the shim return `() => void` *"because `_layout.tsx:518` may store/call it"*. **Both claims are false against the source:** native `appsFlyerService.ts:257` declares `): void`, and `_layout.tsx:518` does **not** read the return value.
**Resolved:** implemented `void`, per the SPEC's own governing rule (*"no-ops matching the native type signatures"*). Following the literal text would have created the exact native/web signature divergence the parity gate exists to close.

### SPEC-CORRECTION-3 — §4.4.5: "device-aware `detectClientPlatform()`" contradicts "One URL, no branching"
Both are mandated; the second leaves the first nothing to decide. Calling the detector and discarding the result is dead code (Constitution #8), and branching client-side to a store URL would **destroy the `af_tranid` attribution** — the very defect §4.4.4 replaces.
**Resolved:** no detection; the OneLink's own 301 *is* the device-awareness. `Platform.OS` gates the web-only render (correct tool for a render gate).

### SPEC-CORRECTION-4 — §8 step ordering forces a red commit
Step 7 de-grandfathers `success.tsx`; step 11 pays the debt. Between them the gate is **red**, contradicting §8's *"each step independently green"*.
**Resolved:** de-grandfathering moved into the step-11 commit. Every commit lands green.

### SPEC-CORRECTION-5 — §4.4.3 grandfather conditional resolves to **NO**
The SPEC says grandfather `appsFlyerService.ts` for `rawonelink` *"only if it already carries the literal — verify before adding"*. **Verified: it does not** (it carries `go.usemingla.com`, already grandfathered under `onelink`). No entry added. *(The SPEC handled this correctly by making it conditional; recording the resolution.)*

---

## 9. Old → New receipts

### `app/accept-brand-invitation.tsx`
**Before:** `if (!isAuthReady) return;` above an **unreachable** `if (user === null) → /auth?next=`. Every logged-out invitee: infinite spinner, forever. 10×150ms `getSession()` retry loop before every accept. `errorCopyFor` handled 5 of 7 edge codes; the other two said *"Try again in a moment"* about **permanent** states. Render gate `if (!isAuthReady || phase.kind === "loading")` could re-mask a resolved outcome.
**Now:** branches on `authStatus` (two independent axes). `signed_out` → "You're invited" + Sign in (resumes via `?next=`). `error` → actionable retry. Resolved `phase` renders first and never consults auth. Retry loop **deleted**. All 7 codes have correct copy.
**Why:** SC-1/2/6/7/8, C-1373-A/B/C/D. **Lines:** ~180 changed.

### `app/accept-scanner-invitation.tsx`
**Before:** line-for-line clone of the dead gate.
**Now:** identical restructure. Per SPEC: no retry loop (never had one), no new codes (its edge fn returns 5 — adding them = dead copy), no CTA.
**Why:** SC-9 / C-1374. **Lines:** ~150.

### `app/auth/index.tsx` + `app/auth/callback.tsx`
**Before:** `next` had **4 writers, 0 readers**. `/auth` ignored query params and hard-redirected home → token silently discarded. `/auth/callback` → `<Redirect href="/" />` unconditionally.
**Now:** capture-on-mount → sessionStorage; both readers consume-once and **re-validate**.
**Why:** SC-3/**SC-4**. **Lines:** ~74.

### `src/context/AuthContext.tsx`
**Before:** backstop guarded only by `if (!mounted) return;` → fired on **every** load ≥7s incl. a 604ms resolve (4/4), logging a falsehood and arming `bootstrapTimedOutRef` (meaning "bootstrap FAILED") on every healthy boot.
**Now:** `bootstrapResolvedRef` early-return; set at **all three** resolution points (labelled 1/3, 2/3, 3/3). Constant + log renamed to state the job. Comment block corrected.
**Why:** SC-14/15, C-1377-LOG/F3/N4. **Lines:** ~113. **ORCH-1204/1292/1004 preserved.**

### `src/services/guestFunnelLink.ts` (ORCH-1382)
**Before:** `window.open(dest,'_blank','noopener,noreferrer')` + `if (!win) location.assign(dest)` → **null on success** → tab opened **and** page navigated away, **every tap**, live.
**Now:** bare `open(dest,'_blank')` + `win.opener = null` + `assign` only in the else. Injectable `w`.
**Why:** SC-11/19. Fixes the live `SeeWhosGoingGate` violation of `I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS`. **Lines:** ~60.

### `app/accept-brand-invitation/success.tsx`
**Before:** hardcoded, **non-attributed**, non-device-aware iOS+Android button pair shown to everyone, opened via `window.location.href` (destroys the page). Every install from this screen invisible to AppsFlyer.
**Now:** the shared CTA. **De-grandfathered** from the 1342 gate.
**Why:** SC-10, §4.4.4. **Lines:** ~50.

### The two `.web.*` shims
**Before:** 4 missing exports → 2 live TypeErrors (every page load / every tab refocus).
**Now:** no-ops matching native signatures + the class-closing CI gate.
**Why:** SC-12/13/17.

---

## 10. Cross-surface impact

| # | Surface | Affected | What changes for a user | Parity |
|---|---|---|---|---|
| 1 | Consumer iOS | **NO** | — | No brand-invite route exists |
| 2 | Consumer Android | **NO** | — | Same |
| 3 | **Buyer/anon Web (`mingla-business` web)** | **YES — PRIMARY** | Invite resolves + states outcome; logged-out gets a real screen + working resume; success gets an attributed CTA; root layout stops throwing; "see who's going" stops double-navigating | **Automatic** — the surface the invite email opens |
| 4 | Business iOS | **PARTIAL** | Auth-gate fix + copy apply automatically. 1377 F-3 ref fix applies (ORCH-1292 de-gated the backstop to native). CTA web-only by design. **Rides the next NATIVE build — no OTA (COMMS-0063).** | Automatic (shared modules); **not runtime-verified on native** |
| 5 | Business Android | **PARTIAL** | Same as #4 | Same |
| 6 | Admin Web | **NO** | — | Separate app |
| 7 | Business Web preview | **YES — incidental** | Root-layout TypeErrors gone → every business-web route stops throwing | Automatic |

---

## 11. Smoke result — **stated honestly**

**What I actually ran:** the full `mingla-business` jest suite, all four strict-grep gates (self-test + live + mutation proofs), `tsc --noEmit`, and the append-only check. **All in-scope suites green.**

**What I did NOT run:** no simulator, no physical device, no browser, no preview deploy. **No production DB write; no `supabase/**` touch; no migration; no edge deploy; no OTA; no merge.**

**⚠️ OQ-2 — I did NOT verify the authed happy path.** The SPEC states the post-accept membership grant has **never been observed end-to-end** (0 of 1 invites ever accepted; the investigation's authed arm used a synthetic session). **I did not change that.** I have **not** proven that a real invitee, signing in with a real account, ends up a real member of the brand. My work proves the *gate* no longer blocks them. **That grant remains untested, not proven** — the tester must close it with a real invite end-to-end.

### Baselines — measured, not assumed
| Metric | origin/main | This branch | Delta |
|---|---|---|---|
| `tsc --noEmit` errors | **797** | **797** | **0 new** |
| Failing jest suites (full run) | **300** | **300** | **0 new** |

Both measured by stashing my work and re-running the identical command. **My changes introduce zero new typecheck errors and zero new test failures.**

---

## 12. Known issues / deferred

- **No `[TRANSITIONAL]` code introduced.**
- **ORCH-1376 is latent** — proven inert 0/4, labelled as defensive hardening in code and here. Not claimed as an active bug.
- **ORCH-1377 F-3's user-visible consequence remains `suspected`** — the SPEC capped it there (source-only; staging needs a prod session revocation, refused). I did **not** upgrade the claim. T-11 verifies the **mechanism** (ref not armed on a resolved boot), not the unproven end-state.
- **Native runtime unverified** for the 1377/1376 legs (rides the next business native build; **OTA forbidden** — COMMS-0063).
- **`app/index.tsx` + 2 extra test files** touched beyond §11.1 — forced by the mandated rename (§8 SPEC-CORRECTION-1).

---

## 13. Operator action required

- **Migration `db push`: NONE.** No migration written.
- **Edge-function deploy: NONE.** No `supabase/**` file touched; no `verify_jwt` affected.
- **`[deploy]` REQUIRED** on the PR title — touches `mingla-business/**`; the fix must reach `business.usemingla.com` via Vercel.
- **OTA: FORBIDDEN** (COMMS-0063 — business-app OTA empirically BRICKS launch). Business ships via native build only.
- **⚠️ APPEND-ONLY BLESS TOKEN — the COMMS-0098 trap.** Four test files carry rename-only deletions, so `[TEST-MOD-APPROVED ORCH-1377]` **must sit on the PR branch's HEAD commit**. It is on the HEAD commit as of this report. **Any later commit (docs sync, flip, rebase) BURIES it and fails `Test files: append-only`** — re-add it to the new HEAD via amend, exactly as PR #883 had to (`9517b0c85`).

---

## 14. Discoveries for the orchestrator

1. **⚠️ PRE-EXISTING RED ON `main`: `AuthContext.timeout.test.ts` Case 18 FAILS on `origin/main`.** It asserts `AUTH_CONTEXT_SOURCE` matches `/if \(_event === ["']SIGNED_IN["']\)/`; that pattern does **not** exist in `AuthContext.tsx` on main either. Test file byte-identical to main; my `SIGNED_IN` count identical (19). **Not mine.** Almost certainly **ORCH-1351 [ci-dark-test-registry-audit]** territory — a test that fails and nothing notices. Worth registering.

2. **⚠️ 300 failing jest suites on `origin/main`** (235 failing tests) — the *baseline*. Whatever CI runs, it is not this suite, or main would be red. This is a large dark-test surface and materially weakens "the tests are green" as a signal. Recommend folding into ORCH-1351.

3. **⚠️ SHARED-STASH HAZARD RECURRED — a foreign stash is sitting in this repo's stash list.** `stash@{0}: On main: anchor-uncommitted-pre-ORCH1318-build` (contains COMMS_LEDGER.md, MASTER_BUG_LIST.md, OPEN_INVESTIGATIONS.md **+ untracked `SPEC_ORCH-1318_APPSFLYER_ONELINK.md`**). My routine `git stash`/`pop` for a baseline measurement had **nothing of mine to save**, so the `pop` restored **that session's** work into my worktree and left 3 files in `UU` conflict. I detected it, restored all 3 to HEAD, and **the stash is intact** (`git stash list` still shows it) — no work lost, nothing of it committed. **This is the exact incident COMMS-0092 recorded** (the 435-line ORCH-1318 SPEC leaking via a shared stash). **Recommend: an owner claims or drops that stash** — it is a live trap for every session in this repo.

4. **`DownloadMinglaCta.tsx:32`'s `.catch(() => Linking.openURL(...))` is dead code on web** (RN-web's `openURL` never rejects). Pre-existing; SPEC §10-3 scoped it out; **not fixed**. Flagging that it is now a *provable* dead path.

5. **1342 gate's `appsFlyerService.ts` grandfather (`go.usemingla.com`) is now a provable mismatch** — the business branded domain is live as `biz.usemingla.com` while the service still names the consumer domain. SPEC §10-4. Native-build-bound (ORCH-1346). **Not touched.**

6. **COMMS-0101/§10-1 ledger correction still owed** (business OneLink live on Android; ORCH-1381 told to wait on a cleared blocker). COMMS-0104 already records this — confirming it landed.

7. **OQ-1 needs Seth's ruling** (SPEC §10.2): CTA on success only vs. also on the logged-out screen. I implemented **success-only** per the SPEC's recommendation — pre-install the app cannot resume the invite, so a pre-sign-in download button sends the invitee away from the only flow that works.

---

## 15. Downstream

**mingla-tester** — verify §5 on the physical Samsung `R58R54YV7JT` against a **preview** deploy.
**Priority: SC-4** (the OAuth resume leg — the one a naive fix silently breaks) and **OQ-2** (the never-once-observed authed happy path). **Drive a REAL invite end-to-end** — that is the only thing that closes OQ-2, and I explicitly have not.
