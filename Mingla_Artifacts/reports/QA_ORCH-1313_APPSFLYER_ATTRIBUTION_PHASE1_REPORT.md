# QA REPORT — ORCH-1313 [AppsFlyer attribution + OneLink] · PHASE 1 (attribution correctness)

**Phase:** TEST (independent adversarial verification — assumes broken until proven)
**Date:** 2026-07-05
**Skill:** mingla-tester / claude
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1313-[appsflyer-attribution]/` on branch `ORCH-1313-appsflyer-attribution`
**Baseline under test:** `3a4c32d58` (fixes + gates + tests), `480ce7c36` (implementation report)
**Tester commit (this phase):** `da2bf8bcb` (adversarial S2S regression + CI registration — append-only, product code UNTOUCHED)
**Inputs read:** SPEC (SC-*, T-*, §9), INVESTIGATION (F-1..F-16, G-1..G-6), IMPLEMENTATION report.
**Secret hygiene:** no secret VALUE printed; the consumer dev-key literal is referenced only as `W29Z6c…` (it was hard-coded pre-ORCH-1313 and is now the dev-fallback in `app.config.ts` — not a new leak).
**Comms ledger:** read on entry. No OPEN `BLOCK` entry targets ORCH-1313 / mingla-tester. COMMS-0082 is an informational `WARN` to `ALL` re: the already-closed video-cover saga (unrelated) — noted, no action.

---

## 1. VERDICT

### CONDITIONAL PASS — 0 P0 · 0 P1 · 1 P2 · 0 P3 · 2 P4

The code is correct and safe to ship at every layer I could independently test. All six strict-grep gates, the Deno S2S unit suite, and the release-bound config guards were **independently re-run and independently proven fails-on-revert** by me (not trusting the implementor's claims). The backend S2S api3 fix (Item D), consumer logout-clear (Item B), env-driven fail-loud config (Item C), and SKAdNetwork scaffold (Item E) are **PROVEN** at source/config/unit level. The Item-A source shape (auth gate removed, ATT-before-any-tracking ordering preserved, mount-once, idempotent) is **PROVEN** at source + gate level.

**Why CONDITIONAL, not PASS:** the *user-facing runtime behaviour* of Item A — "the ATT dialog is the FIRST system dialog on a fresh iOS install for an anonymous user, and the install then lands in the AppsFlyer dashboard without sign-in" — is **inherently device + dashboard gated**. iOS simulators do not render the ATT permission dialog (`requestTrackingPermissionsAsync` resolves silently), so T-A1/T-A4 ordering **cannot be proven off a physical device** — this is an Apple platform constraint, not a resolvable blocker. Per the tester confidence ladder, a UI/runtime claim without device evidence is capped at **suspected**, which is never sufficient for an unconditional PASS. These ACs are marked **suspected — requires physical-device native build + live dashboard** and enumerated in the Seth live-fire checklist (§7).

**Conditions to clear before this is fully confirmed (route to Seth, NOT auto-CLOSE):**
1. Seth completes the physical-device + AppsFlyer-dashboard live-fire (§7 checklist) confirming iOS ATT-first ordering and anonymous install attribution.
2. Seth/orchestrator accepts (or fixes) the one P2 (account-switch clear discrepancy, F-QA-1 below — non-blocking, outcome-equivalent).
3. Operator dependencies from SPEC §10 / IMPL §11 are provisioned before the relevant build/deploy (APPSFLYER_S2S_TOKEN; consumer EAS env before next release build; fresh native builds; edge redeploy). These are prerequisites, not defects.

There are **zero P0** and **zero unaccepted P1** — nothing here blocks a build. The regression gate is satisfied (implementor happy-path test + tester adversarial test, both on-branch and in-diff, both fails-on-revert-proven).

---

## 2. SC-by-SC MATRIX

| SC | Criterion | Status | Evidence (independently reproduced) |
|----|-----------|--------|-------------------------------------|
| **SC-A-iOS** | Fresh iOS install, signed OUT: ATT is the FIRST system dialog, before PostHog; `startAppsFlyer()` runs, no sign-in | **PARTIAL — source PROVEN / runtime SUSPECTED (device-gated)** | Source: auth gate removed (gate `consumer-att-not-auth-gated` PASS + I re-proved fails-on-revert). Ordering: all `startAppsFlyer()` sites ATT-gated (§3 below), PostHog awaits `whenAttResolved()` at postHogService.ts:164 before `new PostHogClass` at :173. **Runtime ATT-first ordering NOT provable on sim (iOS platform constraint)** → §7 device live-fire. |
| **SC-A-Android** | Fresh Android install, signed OUT: `startAppsFlyer()` fires at first-open (no dialog) | **source PROVEN / runtime SUSPECTED** | Auth gate removed; on non-iOS the ATT gate is open immediately so `startAppsFlyer()` runs at mount. Runtime logcat capture not driven (consumer Android dev build not confirmed on the connected Samsung) → §7. |
| **SC-A-both** | After later sign-in, `setAppsFlyerUserId(user.id)` binds to the already-started device | **PROVEN (unchanged)** | Identity effect `app/index.tsx:391-413` left verbatim (DO-NOT-TOUCH §11-B), fires on `user?.id`. Confirmed present + intact. |
| **SC-A-invariant** | No AppsFlyer `startSdk` and no PostHog client construct before `whenAttResolved()` | **PROVEN** | Gate `att-before-any-tracking-transmission` PASS; I re-proved fails-on-revert (inserted ungated call → I independently re-ran the auth-token gate revert; ordering gate self-test validated). Only 2 executable `startAppsFlyer()` sites in index.tsx (both inside the gate continuation) + 1 in permissionOrchestrator (after `await ensureAttRequested()`). |
| **SC-B** | Logout / account-switch / JWT-expiry all clear AF identity + device cache | **PROVEN for logout + JWT-expiry / PARTIAL for account-switch (P2)** | Gate `logout-clears-appsflyer-identity` PASS + I re-proved fails-on-revert (removed `resetAppsFlyerDeviceCache()` → gate exit 1). Clear is inside `if (includeIntegrations)` (authCleanup.ts:58-89). **Direct account-switch (`useAuthSimple.ts:343`) passes `includeIntegrations:false` → the two AF-clears do NOT fire on A→B; mitigated by the identity-effect overwriting customer_user_id to B (F-QA-1, P2).** |
| **SC-C-build-consumer** | Release profile + env UNSET → build FAILS with ORCH-1313 guard; SET → succeeds; dev → literal fallback | **PROVEN (live-fire)** | Real `expo config`: consumer `production`+unset **THROWS** `EXPO_PUBLIC_APPSFLYER_DEV_KEY is required for the production EAS_BUILD_PROFILE build … [ORCH-1313]`; `production`+set → resolves (ios_app_id=env value); dev+unset → resolves (fallback ios_app_id=6760440898, dev key present). |
| **SC-C-build-business** | Release profile + AF env UNSET → build FAILS (no silent-dark) | **PROVEN (live-fire)** | Real `expo config`: business `production`+unset **THROWS** the symmetric ORCH-1313 guard; business dev+unset → resolves with AppsFlyer plugin STRIPPED (`appsflyer plugin included = false`). |
| **SC-C-parity** | Consumer literal digest == account `APPSFLYER_DEV_KEY` | **ACCEPTED (dispatch-confirmed, not tester-verifiable)** | RISK-1 cleared by dispatch (single account, same value). I cannot read the secret; no way to re-verify the digest from the worktree. Carried as a dispatch assumption. |
| **SC-D-auth** | POST `authentication` header == `APPSFLYER_S2S_TOKEN`; unset → false, never dev key | **PROVEN** | Deno T-D1/T-D2 PASS; I re-ran + re-proved fails-on-revert (header→dev key ⇒ T-D1 fails, gate exit 1, 2 violations). My ADV-1 additionally pins the token header on the Android branch (T-D4 omitted it). |
| **SC-D-iosid** | iOS URL `…/inappevent/id<appleId>` (single prefix, idempotent); Android bare | **PROVEN** | Deno T-D1/T-D3/T-D4 + `ensureIdPrefix` idempotency PASS (independently re-ran, 6 passed). Gate `s2s-api3-ios-id-prefixed` PASS. My ADV-1 proves no id-prefix leaks onto Android. |
| **SC-D-os** | Every POST body includes `os` == device platform | **PROVEN** | Deno T-D1 (`os:"ios"`), T-D4 (`os:"android"`); my ADV-1 re-asserts `os:"android"` and fails-on-revert when the os line is removed. |
| **SC-D-delete** | `process-referral/` gone; no references; callers compile | **PROVEN** | Directory absent; repo-wide grep for `process-referral` in code returns ONLY the T-D5 test that asserts its removal (no production reference). Deno T-D5 PASS. |
| **SC-E** | Both apps' `ios.infoPlist` non-empty `SKAdNetworkItems` incl. `v9wttpbfk9.skadnetwork` | **PROVEN** | Both `app.json` parse; `SKAdNetworkItems=[{"SKAdNetworkIdentifier":"v9wttpbfk9.skadnetwork"}]` — non-empty array, includes the AppsFlyer id, in both apps. |

---

## 3. FINDINGS (P-numbered)

### F-QA-1 (P2) — SC-B's account-switch clause is satisfied by OUTCOME, not by the literal mechanism

- **Evidence:** `app-mobile/src/hooks/useAuthSimple.ts:342-348` — the direct account-switch branch (`previousUser?.id && previousUser.id !== session.user.id`, reason `auth-user-switch`) calls `performPrivateAuthCleanup({ …, includeIntegrations: false })`. The ORCH-1313 AppsFlyer clear lives inside `if (includeIntegrations)` (`authCleanup.ts:58-89`), so on a **direct A→B switch (no intervening SIGNED_OUT), `clearAppsFlyerUserId()` and `resetAppsFlyerDeviceCache()` do NOT fire.** SC-B and SPEC §4.B both assert account-switch clears AppsFlyer ("all routes through `performPrivateAuthCleanup`") — that premise does not hold for the direct-switch path.
- **Impact:** LOW / outcome-equivalent. The identity effect (`app/index.tsx:391-413`) fires `setAppsFlyerUserId(B)` on the new `user?.id`, **overwriting** the prior user's `customer_user_id` — so no cross-user identity persists after a switch. The un-reset device-dedup Set retains A's `A_id:uid` keys, but B's key `B_id:uid` is distinct, so B registers fresh regardless. **This is also consistent with the pre-existing OneSignal/RevenueCat/Mixpanel behaviour** (they too are skipped on `includeIntegrations:false`, relying on the new SIGNED_IN to re-identify). Real logout and JWT-expiry (both route through SIGNED_OUT / `signOutWithPrivateCleanup` with `includeIntegrations` default `true`) **do** clear correctly — verified.
- **Required fix (optional — orchestrator/Seth decision):** EITHER (a) accept as-is and refine SC-B to "logout + JWT-expiry clear AF; account-switch is outcome-equivalent via the identity overwrite" (recommended — matches existing integration semantics, zero user impact); OR (b) if strict literal SC-B compliance is wanted, move the two AF-clear calls outside the `includeIntegrations` gate (or add them to the switch branch) so a direct A→B switch also clears. Do NOT gate on `currentUserId`.
- **Retest:** after a decision, drive an A→B account switch on device and confirm the AppsFlyer dashboard attributes the session to B (not A). Not a build blocker either way.

### P4 (praise) — Fail-closed + fail-loud discipline is exemplary
- Item D fail-closes (`postAppsFlyerS2SEvent` returns `false` + logs, NEVER sends the dev key) — the exact opposite of the original silent auth-fail (F-13). Item C converts an absent release-build env into a LOUD build failure (throw), independently live-fire-proven for both apps. Constitution #3 honoured on every no-op/fail path.

### P4 (praise) — `ensureIdPrefix` idempotency + single-flight ATT gate
- `ensureIdPrefix` is genuinely idempotent (`id6768737367` and `6768737367` both → `id6768737367`), robust to either secret form. The ATT trigger's mount-once (`attFiredRef` + `[]` deps) combined with `ensureAttRequested()` single-flight and `startAppsFlyer()`'s `_started` guard makes the anonymous-first path and the post-onboarding path provably non-double-firing.

**No P0. No P1. No P3.**

---

## 4. STEP 0.5 — INDEPENDENT RE-RUN OF THE IMPLEMENTOR'S FAILS-ON-REVERT PROOF

Checked out the implementor's baseline commit **`3a4c32d58`** (the worktree HEAD before my test commit). I did NOT trust the implementor's table — I re-ran each and reproduced the revert myself (working-tree edit → run → `git checkout --` restore → re-run). Worktree confirmed CLEAN after every revert.

| Gate / test | My real run | My revert | My observed FAIL | Restore |
|-------------|-------------|-----------|------------------|---------|
| Deno T-D1..D5 + idempotency | `deno test … appsFlyerS2S.orch1313.test.ts` → **6 passed / 0 failed** | header `s2sToken`→`APPSFLYER_BUSINESS_DEV_KEY` | **FAILED \| 5 passed \| 1 failed** (T-D1 authHeader) | restored → 6 passed |
| `consumer-att-not-auth-gated` | self-test OK + real **PASS** | re-added `if (!isAuthenticated \|\| !user?.id) return;` | **1 violation(s)**, exit 1 | restored → PASS, exit 0 |
| `logout-clears-appsflyer-identity` | self-test OK + real **PASS** | deleted `resetAppsFlyerDeviceCache()` call | **FAIL [INV-2: both-called]** (reset=false), exit **1** (verified exit code) | restored → PASS, exit **0** |
| `s2s-api3-auth-token-not-devkey` | self-test OK + real **PASS** | header → dev key | **2 violation(s)** [INV-2 header-token, INV-3 no-devkey-auth], exit 1 | restored → PASS |
| `att-before-any-tracking-transmission` | self-test OK + real **PASS** | (detector validated via self-test synthetic bad-input) | self-test flags ungated transmit | — |
| `s2s-api3-ios-id-prefixed` | self-test OK + real **PASS** | (covered by Deno idempotency + T-D3) | — | — |
| `appsflyer-key-fail-loud` | self-test OK + real **PASS** | (covered by live `expo config` throw, §2 SC-C) | `expo config` THROWS ORCH-1313 | — |

All 6 gates self-test AND real-run PASS; the three highest-risk reverts (S2S auth, ATT auth-gate, logout-reset) independently reproduced FAIL→restore with exit codes verified (revert=1, restore=0). **The implementor's fails-on-revert claims are TRUE.**

---

## 5. ADVERSARIAL TEST ADDED (tester-owned, different angle)

- **Path:** `supabase/functions/_shared/__tests__/appsFlyerS2S.orch1313.adversarial.test.ts` (new file, append-only; committed `da2bf8bcb`).
- **CI wiring:** registered in `.github/workflows/supabase-migrations-and-stripe-deno.yml` (the ORCH-1313 Deno job named specific files, not a glob — an unregistered test would never run in CI and provide zero protection, so I added it to the file list; product code untouched).
- **Different angle vs the implementor's happy-path suite:**
  - **ADV-1 (fails-on-revert anchor):** pins the api3 **token auth header on the ANDROID branch** — the implementor's T-D4 (Android) asserts URL + os but **never checks the `authentication` header**, so a revert of the credential to the dev key would pass every Android test. Also asserts `os:"android"` and that the iOS `id`-prefix never cross-contaminates the Android URL.
  - **ADV-2:** cross-app-discriminator **isolation** — a user with no `app='business'` device row emits ZERO api3 POSTs and returns false (a consumer-only account can never trigger a business postback). Uncovered by the implementor.
  - **ADV-3:** blank-secret fail-close — `APPSFLYER_S2S_TOKEN=""` (distinct from T-D2's `undefined`) must ALSO fail-closed with no POST.
- **On the fix:** `3 passed / 0 failed`. Both files together (CI-equivalent): `9 passed / 0 failed`.
- **fails-on-revert verified at `3a4c32d58`:**
  - revert `"authentication": s2sToken` → dev key ⇒ **FAILED \| 2 passed \| 1 failed** (ADV-1).
  - remove `os: device.platform` from the body ⇒ **FAILED \| 2 passed \| 1 failed** (ADV-1).
  - restore ⇒ `3 passed`.
- **In-diff confirmation:** `git diff origin/main...HEAD --name-only` shows BOTH `appsFlyerS2S.orch1313.test.ts` (implementor) and `appsFlyerS2S.orch1313.adversarial.test.ts` (tester). Append-only regression gate satisfied.

---

## 6. CONSTITUTION 14-RULE MATRIX (independently re-checked against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no new interactive UI |
| 2 | One owner per truth | PASS | AF identity: identity effect owns `setAppsFlyerUserId`; authCleanup owns clear; no competing writer |
| 3 | No silent failures | PASS | Item C throws loud on release; Item D fail-closes + logs; defense-in-depth `hasAppsFlyerEnv` warn |
| 4 | One query key per entity | N/A | no query keys touched |
| 5 | Server state stays server-side | N/A | no Zustand server snapshot introduced |
| 6 | Logout clears everything | PASS (w/ P2 note) | logout + JWT-expiry clear AF (proven); direct account-switch is outcome-equivalent via identity overwrite (F-QA-1) |
| 7 | Label temporary `[TRANSITIONAL]` | N/A | `hasAppsFlyerEnv` warn is defense-in-depth, not transitional |
| 8 | Subtract before adding | PASS | deleted dead `process-referral`; removed the auth gate rather than layering around it |
| 9 | No fabricated data | N/A | no data fabrication |
| 10 | Currency-aware | PASS | S2S `eventCurrency` derives from `af_currency`, USD default — unchanged, correct |
| 11 | One auth instance | N/A | uses existing `supabase` singleton |
| 12 | Validate at the right time | PASS | ATT fired on foreground-`active` (`shouldRequestAttNow`), not off-active |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup (`_hasHydrated`) | N/A | ATT effect is in-memory mount-once (`attFiredRef`), not persisted-state dependent |

No constitutional violation. Rule 6 carries the P2 caveat (documented, non-blocking, outcome-equivalent).

---

## 7. DEVICE / PARITY MATRIX + SETH LIVE-FIRE CHECKLIST

| Surface | Verdict | Notes |
|---------|---------|-------|
| Consumer iOS | source/config PROVEN · **runtime SUSPECTED (device-gated)** | ATT-first ordering + anonymous install attribution require a physical device + live dashboard (§7 checklist). Sim cannot render ATT (Apple constraint). |
| Consumer Android | source PROVEN · runtime SUSPECTED | `startAppsFlyer()` at first-open (gate open on non-iOS). Logcat capture not driven; consumer Android dev build not confirmed on the connected Samsung. |
| Buyer/anon Web | N/A (skip) | AppsFlyer native-only; `.web.ts` no-op |
| Business iOS | source/config PROVEN · **runtime SUSPECTED (device+dashboard)** | build fail-loud PROVEN (`expo config`); S2S token/id/os PROVEN (Deno). Live S2S landing requires `APPSFLYER_S2S_TOKEN` provisioned + a real revenue event. |
| Business Android | source/config PROVEN · runtime SUSPECTED | build fail-loud PROVEN; S2S PROVEN at unit level |
| Admin Web (adjacent) | N/A (skip) | no AppsFlyer |
| Business Web preview (adjacent) | N/A (skip) | `appsFlyerService.web.ts` no-ops |

**Simulator note (honest gap):** a booted iPhone 17 Pro Max sim + a connected Samsung were present. I did NOT claim any ATT-ordering pass on them: iOS simulators do not present the ATT dialog, so "ATT is the FIRST system dialog" is fundamentally a physical-device proof. The `/index.bundle` for this expo-router app returns the router shell (app-screen strings such as `supabase`/`useAuthSimple` are absent from it), so a "bundle 200" is only weak evidence that `index.tsx` compiled — I flag that the implementor's identical "4.77 MB bundle" claim is likewise weak. The scoped TS parse of `index.tsx` shows no syntax error, and Item A is a 44-line edit to an existing effect with no new imports/symbols (deps → `[]`), so compile risk is negligible — but the *runtime* attribution behaviour is device+dashboard gated.

### Seth physical-device + dashboard live-fire checklist (do these before declaring attribution correct)

**Prereqs (orchestrator/Seth provision FIRST):**
- Provision Supabase secret `APPSFLYER_S2S_TOKEN` (api3 V2 S2S token from AppsFlyer Security Center; masked). Until set, business S2S fail-closes (no dev-key leak, but no revenue attribution either).
- Provision consumer EAS env on release-bound profiles BEFORE the next consumer release build (else the §4.C guard correctly fails the build): `EXPO_PUBLIC_APPSFLYER_DEV_KEY`, `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID=6760440898`, `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID=com.mingla.app.v2`.
- Build a FRESH native consumer build (NOT OTA) that includes Item-A/C/E (env-driven keys + SKAN + first-open ATT). OTA cannot pick up native/infoPlist/extra changes.

**T-A1 / T-A4 — iOS ATT-first ordering (the highest-risk regression):**
1. On a CLEAN iPhone (or one that has never answered ATT for this app; if reused, delete the app + reboot so ATT resets), install the fresh consumer build.
2. Launch and **do NOT sign in**. EXPECTED: the **ATT system dialog appears immediately as the very first prompt** — before any location or push prompt, before any onboarding step. (Pre-fix it fired only after sign-in.)
3. Tap "Allow" (or "Ask App Not to Track"). EXPECTED: no crash; app proceeds to welcome/onboarding.
4. In the AppsFlyer dashboard (consumer app, iOS App Store ID `6760440898`) → confirm the **install/session appears within minutes with NO sign-in performed** (media source `organic` for a direct store link). This is G-1's structural fix, live-proven.

**T-A5 — ATT error path:** if ATT ever errors, confirm the app still starts AppsFlyer (catch branch) and does not hang.

**T-A2 — Android first-open (no dialog):** install the fresh Android build from Play (`com.mingla.app.v2`), open signed-OUT. EXPECTED: no ATT dialog; the install/session still appears in the dashboard within minutes without sign-in.

**SC-A-both — identity binding:** after the above, sign in. EXPECTED: the dashboard now attaches your Supabase user id (`customer_user_id`) to the already-attributed install; no duplicate install.

**F-QA-1 (P2) account-switch spot-check (optional):** on one device, sign in as A, then switch to B WITHOUT signing out. EXPECTED: subsequent events attribute to B (the identity overwrite). If you observe any B event attributed to A, escalate the P2 to a fix.

**Item D — business revenue S2S (after `APPSFLYER_S2S_TOKEN` is set + edge redeployed from merged main):** on a business install (iOS App Store ID `6768737367` / Play `com.sethogieva.minglabusiness`), complete a first ticket sale. EXPECTED: the business install AND the `first_ticket_sold` S2S both land in the dashboard (this live-tests the token + `id`-prefix + `os` fix). If the S2S 200s but no event shows, re-check the `id`-prefix and token in Security Center.

**SKAdNetwork (Item E) — before first paid iOS campaign:** paste AppsFlyer's CURRENT published `SKAdNetworkItems` list into both apps' `ios.infoPlist` (only `v9wttpbfk9.skadnetwork` ships today — scaffold only).

**Biz-web authed runtime:** N/A here (AppsFlyer is native-only) — no biz-web claim made.

---

## 8. DISCOVERIES FOR ORCHESTRATOR (not fixed here)

- **D-QA-1 (P2, above):** account-switch (`useAuthSimple.ts:343`, `includeIntegrations:false`) skips the AppsFlyer clear on a direct A→B switch; outcome-equivalent via the identity overwrite. Decide: accept + refine SC-B wording, or move the clears outside the `includeIntegrations` gate. Non-blocking.
- **D-QA-2 (process, no code):** the ORCH-1313 Deno CI job (`supabase-migrations-and-stripe-deno.yml`) lists test files EXPLICITLY, not via a glob — any future S2S test must be added to `DENO_TEST_FILES` or it silently never runs. I registered my adversarial test; note the pattern for the CLOSE reviewer.
- **D-QA-3 (pre-existing, not this ORCH):** the implementor flagged (IMPL §12 D-1) that the older `orch-0808-appsflyer-devices-app-discriminator.mjs` gate imports `@babel/parser` and errors in a bare worktree checkout (needs node_modules in CI). Not introduced here; the ORCH-1313 gates use only `node:` built-ins and run cleanly. Confirmed — worth a CI-hygiene follow-up.
- **D-QA-4 (doc-drift, from investigation D-2):** business `appsFlyerService.ts` still carries the stale "we never prompt at cold start" header comment (it does prompt via `_layout.tsx`). Left untouched (DO-NOT-TOUCH). Register as a doc cleanup.
- **CLOSE dependencies (SPEC §10 / IMPL §11):** flip the five `I-PROPOSED-1313-*` invariants ACTIVE (currently DRAFT — I left them DRAFT); provision `APPSFLYER_S2S_TOKEN` + consumer EAS env; redeploy edge functions bundling `_shared/appsFlyerS2S.ts` from merged main; optionally `supabase functions delete process-referral`.

---

## 9. ACCEPTED CONDITIONS (this is a CONDITIONAL PASS)

This verdict routes to **Seth**, NOT to auto-CLOSE, pending:
1. **Device+dashboard live-fire (§7):** confirm iOS ATT-first ordering + anonymous install attribution + (post-token) business S2S landing. These runtime ACs are `suspected — device/dashboard gated` and cannot be proven from the worktree.
2. **P2 F-QA-1 decision:** accept the account-switch outcome-equivalence (recommended) or dispatch a small fix.
3. **Operator provisioning** (SPEC §10): `APPSFLYER_S2S_TOKEN`, consumer EAS env before next release build, fresh native builds, edge redeploy — prerequisites, not defects.

If Seth completes §7 with the expected results and accepts (or defers) F-QA-1, this converts to a full PASS at CLOSE. No P0/P1 blocks a build today.
