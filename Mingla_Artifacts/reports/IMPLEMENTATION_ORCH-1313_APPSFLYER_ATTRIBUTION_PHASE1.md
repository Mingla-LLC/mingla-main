# IMPLEMENTATION — ORCH-1313 [AppsFlyer attribution + OneLink] · PHASE 1 (attribution correctness)

**Phase:** IMPLEMENT (production code + evidence trail)
**Date:** 2026-07-05
**Skill:** mingla-implementor / claude
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1313-[appsflyer-attribution]/` on branch `ORCH-1313-appsflyer-attribution`
**Baseline commit (all fixes + gates + tests):** `3a4c32d581bb41221bea07ef3123a4be8fb73c0c`
**Binding inputs:** `SPEC_ORCH-1313_APPSFLYER_ATTRIBUTION_PHASE1.md` (implemented A–E per §11-A allowlist ONLY) + `INVESTIGATION_ORCH-1313_APPSFLYER_ATTRIBUTION.md`.
**Scope guard:** built exactly the §11-A allowlist; no §11-B DO-NOT-TOUCH file changed; the §11-C Phase-2 OneLink wall respected (both deep-link listeners stay `false`). No secret VALUE printed.

---

## 1. Summary (plain English)

Six related fixes make AppsFlyer attribution correct at launch:
- **A** — the consumer app now fires the ATT prompt + starts AppsFlyer at **first app-open for anonymous users** (previously it only fired after sign-in, so any download that bounced before sign-up was invisible to attribution and also blocked PostHog on iOS).
- **B** — consumer **logout now clears** the AppsFlyer identity + device cache (was a Constitution #6 gap).
- **C** — the consumer AppsFlyer dev key + app IDs are **env-driven with a release-bound fail-loud build guard** (so a release can never silently ship AppsFlyer dark), and the same guard is added to the business build.
- **D** — the business revenue **server-to-server** path now authenticates with the correct api3 **S2S token (fail-closed, never the dev key)**, sends the iOS app id in the required **`id`-prefixed** form, and adds the required **`os`** field; the dead `process-referral` function is deleted.
- **E** — a **SKAdNetwork** scaffold (AppsFlyer's own network id) is added to both apps' iOS `infoPlist`.

RISK-1 is cleared (dispatch confirmed the consumer literal digest equals the account dev key), so C is pure hygiene — no account change. Invariants remain **DRAFT** (orchestrator flips ACTIVE at CLOSE). No deploy / merge / secret-set performed.

---

## 2. SPEC success-criteria coverage table

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| **SC-A-iOS** | Fresh iOS install, signed OUT: ATT is the first system dialog, before PostHog; `startAppsFlyer()` runs with no sign-in | **implemented; runtime-partially-verified** | Source + gates confirm auth gate removed & ordering preserved (`3a4c32d`). Runtime ATT-dialog ordering is a PHYSICAL-DEVICE proof (iOS sim does not render ATT) — see §9; capped **suspected — runtime unverified on sim**, routed to tester per SPEC §7. |
| **SC-A-Android** | Fresh Android install, signed OUT: `startAppsFlyer()` fires at first-open (no dialog) | **implemented; runtime-partially-verified** | Auth gate removed; on non-iOS the ATT gate is open at module load so `startAppsFlyer()` runs immediately (`3a4c32d`). Runtime capture not driven — see §9. |
| **SC-A-both** | After later sign-in, `setAppsFlyerUserId(user.id)` binds to the already-started device | ✓ (unchanged) | Identity effect `app/index.tsx` L391-413 left verbatim (DO-NOT-TOUCH §11-B). |
| **SC-A-invariant** | No AppsFlyer `startSdk` and no PostHog client construction before `whenAttResolved()` resolves | ✓ | Gate `i-proposed-1313-att-before-any-tracking-transmission` PASS + fails-on-revert (`3a4c32d`). |
| **SC-B** | Logout / account-switch / JWT-expiry all clear AF identity + device cache | ✓ | Gate `i-proposed-1313-logout-clears-appsflyer-identity` PASS + fails-on-revert (`3a4c32d`). |
| **SC-C-build-consumer** | Release-bound profile + env UNSET → build FAILS with the ORCH-1313 guard; env SET → succeeds; local/dev → succeeds via literal fallback | ✓ (live-fire) | Real `expo config` runs: production+unset THROWS; production+set + dev+unset RESOLVE — see §9 Smoke. |
| **SC-C-build-business** | Release-bound profile + AF env UNSET → build FAILS (no silent-dark) | ✓ (live-fire) | Real `expo config`: business production+unset THROWS; dev resolves — see §9 Smoke. |
| **SC-C-parity** | Consumer literal digest == account `APPSFLYER_DEV_KEY` | ✓ (dispatch-confirmed) | Dispatch: RISK-1 CLEARED — same value env-driven; no code account change. |
| **SC-D-auth** | POST `authentication` header == `APPSFLYER_S2S_TOKEN`; unset → returns false, never sends dev key | ✓ | Deno T-D1/T-D2 PASS + gate `…auth-token-not-devkey` PASS, both fail-on-revert (`3a4c32d`). |
| **SC-D-iosid** | iOS api3 URL is `…/inappevent/id<appleId>` (single prefix, idempotent); Android bare package | ✓ | Deno T-D1/T-D3/T-D4 + `ensureIdPrefix` idempotency + gate `…ios-id-prefixed`, fail-on-revert (`3a4c32d`). |
| **SC-D-os** | Every POST body includes `os` == device platform | ✓ | Deno T-D1 (`os:"ios"`), T-D4 (`os:"android"`). |
| **SC-D-delete** | `process-referral/` gone; no references; callers still compile | ✓ | `git rm`; repo-wide grep 0 refs; Deno T-D5; `deno check appsFlyerS2S.ts` EXIT 0. |
| **SC-E** | Both apps' `ios.infoPlist` have non-empty `SKAdNetworkItems` incl. `v9wttpbfk9.skadnetwork` | ✓ | Both `app.json` validated (JSON.parse) — see §9. |

---

## 3. Files changed (line-count deltas vs origin/main)

Product code (§11-A allowlist):
- `app-mobile/app/index.tsx` — +/- 44 (A: ATT effect drop auth gate, mount-once, anchor)
- `app-mobile/src/services/appsFlyerService.ts` — +66/-… (B: clear+reset fns; C: env-drive consts + hasAppsFlyerEnv guard)
- `app-mobile/src/utils/authCleanup.ts` — +19 (B: static import + both clears in integrations block)
- `app-mobile/app.config.ts` — +47 (C: AppsFlyer `extra` block + release-bound fail-loud guard)
- `app-mobile/app.json` — +5/-1 (E: SKAdNetworkItems)
- `mingla-business/app.config.ts` — +25 (C: symmetric release-bound guard)
- `mingla-business/app.json` — +5/-1 (E: SKAdNetworkItems)
- `supabase/functions/_shared/appsFlyerS2S.ts` — +49/-… (D: S2S token auth, iOS id-prefix, os field)
- `supabase/functions/process-referral/index.ts` — **-224 (deleted)**

Tests + gates (append-only) + CI registration:
- `supabase/functions/_shared/__tests__/appsFlyerS2S.orch1313.test.ts` — +297 (T-D1..D5 + idempotency)
- `.github/scripts/strict-grep/i-proposed-1313-consumer-att-not-auth-gated.mjs` — +154
- `.github/scripts/strict-grep/i-proposed-1313-att-before-any-tracking-transmission.mjs` — +138
- `.github/scripts/strict-grep/i-proposed-1313-logout-clears-appsflyer-identity.mjs` — +137
- `.github/scripts/strict-grep/i-proposed-1313-s2s-api3-auth-token-not-devkey.mjs` — +110
- `.github/scripts/strict-grep/i-proposed-1313-s2s-api3-ios-id-prefixed.mjs` — +103
- `.github/scripts/strict-grep/i-proposed-1313-appsflyer-key-fail-loud.mjs` — +150
- `.github/workflows/strict-grep-mingla-business.yml` — +81 (6 gate jobs registered)
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` — +34 (Deno test job registered)

Artifacts committed: SPEC + INVESTIGATION (this ORCH). Total: 20 files, +1931 / -257.

---

## 4. Data-model changes applied

None. No migration, no schema/RLS change. `appsflyer_devices` and `brand_appsflyer_milestones` untouched; the D fix only READS `appsflyer_devices` (via the already-correct `.eq("app","business")` filter, unchanged — I-PROPOSED-AF-DISCRIMINATOR preserved).

---

## 5. Edge functions touched

- `_shared/appsFlyerS2S.ts` (shared module; imported by `stripeWebhookRouter.ts` + `stripeDisputeHandlers.ts`). Change is INTERNAL to `postAppsFlyerS2SEvent` + a new exported `ensureIdPrefix` — call sites unchanged. **`verify_jwt` to preserve on the deploying functions:** `stripe-webhook-router` (uses signature verification, not JWT — preserve existing) and any function importing this shared module; this shared file has no `verify_jwt` of its own.
- **DELETED:** `process-referral/` — the orchestrator should also remove the DEPLOYED function post-merge (`supabase functions delete process-referral`) or leave it orphaned (authenticated, uncalled, harmless). Zero callers confirmed repo-wide.
- **Deploy list for orchestrator (from MERGED main, NOT this phase):** redeploy the functions that bundle `_shared/appsFlyerS2S.ts` — `stripe-webhook-router` (+ any dispute handler function). Provision the new secret `APPSFLYER_S2S_TOKEN` BEFORE relying on business revenue attribution (see §11).

---

## 6. Regression tests added + fails-on-revert proof

All proven at baseline commit **`3a4c32d581bb41221bea07ef3123a4be8fb73c0c`** (fix + test coexist). Each revert was a working-tree edit, gate/test re-run (FAIL), then `git checkout --` restore (PASS).

| Gate / test | File | Real run | Fails-on-revert demonstration | Result |
|-------------|------|----------|-------------------------------|--------|
| I-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED | `strict-grep/i-proposed-1313-consumer-att-not-auth-gated.mjs` | PASS (self-test + real) | re-added `if (!isAuthenticated \|\| !user?.id) return` → **FAIL (1 violation)** → restore PASS | ✓ |
| I-PROPOSED-1313-ATT-BEFORE-ANY-TRACKING-TRANSMISSION | `strict-grep/i-proposed-1313-att-before-any-tracking-transmission.mjs` | PASS | inserted ungated `startAppsFlyer()` before the gate → **FAIL exit 1** → restore PASS | ✓ |
| I-PROPOSED-1313-LOGOUT-CLEARS-APPSFLYER-IDENTITY | `strict-grep/i-proposed-1313-logout-clears-appsflyer-identity.mjs` | PASS | deleted `resetAppsFlyerDeviceCache()` call line → **FAIL exit 1 (reset=false)** → restore PASS | ✓ |
| I-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY | `strict-grep/i-proposed-1313-s2s-api3-auth-token-not-devkey.mjs` | PASS | reverted header to dev key → **FAIL exit 1 (3 violations)** → restore PASS | ✓ |
| I-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED | `strict-grep/i-proposed-1313-s2s-api3-ios-id-prefixed.mjs` | PASS | dropped `ensureIdPrefix(iosAppId)` → **FAIL exit 1** → restore PASS | ✓ |
| I-PROPOSED-1313-APPSFLYER-KEY-FAIL-LOUD (§4.C) | `strict-grep/i-proposed-1313-appsflyer-key-fail-loud.mjs` | PASS | deleted the consumer config throw guard → **FAIL exit 1** → restore PASS | ✓ |
| Deno T-D1..D5 + `ensureIdPrefix` idempotency | `_shared/__tests__/appsFlyerS2S.orch1313.test.ts` | **6 passed / 0 failed** | (a) header→dev-key revert → **2 failed**; (b) drop iOS normalizer → **1 failed** → restore **6 passed** | ✓ |

`deno test --allow-env --allow-net --allow-read --no-check …appsFlyerS2S.orch1313.test.ts` → `ok | 6 passed | 0 failed`.
Both the strict-grep gates AND the Deno test are visible in `git diff origin/main...HEAD --name-only` (append-only gate satisfied). No existing test modified or deleted.

---

## 7. Old → New receipts

### app-mobile/app/index.tsx (Item A)
- **Before:** ATT effect early-returned `if (isLoadingAuth) return; if (!isAuthenticated || !user?.id) return;` with deps `[isAuthenticated, isLoadingAuth, user?.id]` — ATT + `startAppsFlyer()` never fired for an anonymous session; on iOS this also blocked PostHog (which awaits the same gate).
- **After:** effect fires once at mount (deps `[]`, `attFiredRef` + eslint-disable), no auth gate, ORCH-1313 anchor comment added; body (`whenAttResolved().then(resumeInAppMessages)` + `ensureAttRequested().then(startAppsFlyer).catch(startAppsFlyer)`) unchanged.
- **Why:** SC-A / G-1 — capture every install without sign-in, preserving the ATT-before-tracking ordering.
- **Lines:** ~44.

### app-mobile/src/services/appsFlyerService.ts (Items B + C)
- **Before:** three hard-coded literals (dev key + app IDs); no `clearAppsFlyerUserId` / `resetAppsFlyerDeviceCache`.
- **After:** constants read `Constants.expoConfig.extra` first then `process.env` (+ `hasAppsFlyerEnv`); `initializeAppsFlyer()` early-returns with a warn when env absent (defense-in-depth); added `clearAppsFlyerUserId()` (sets `customer_user_id` to "") + `resetAppsFlyerDeviceCache()` (clears the dedup Set), mirroring the business service.
- **Why:** SC-B (Constitution #6) + SC-C (single-source + fail-loud).
- **Lines:** ~66.

### app-mobile/src/utils/authCleanup.ts (Item B)
- **Before:** integrations block reset OneSignal/RevenueCat/Mixpanel only.
- **After:** static import of both AF-clear fns + a synchronous try/catch calling both inside `if (includeIntegrations)`.
- **Why:** SC-B — logout/account-switch/JWT-expiry all clear AF identity.
- **Lines:** +19.

### app-mobile/app.config.ts + mingla-business/app.config.ts (Item C)
- **Before:** consumer emitted no AppsFlyer `extra`; business silently STRIPPED the AF plugin when env absent (silent-dark).
- **After:** consumer emits the 3 AppsFlyer values into `extra` via `appsFlyerConfigValue()` — throws on a release-bound EAS profile when the env is unset, dev fallback otherwise. Business adds a symmetric release-bound throw (`!hasAppsFlyerEnv()`), dev keeps strip-and-no-op.
- **Why:** SC-C-build-consumer / SC-C-build-business — never ship dark.
- **Lines:** +47 / +25.

### supabase/functions/_shared/appsFlyerS2S.ts (Item D)
- **Before:** `authentication` header used `APPSFLYER_BUSINESS_DEV_KEY`; iOS app id sent bare; no `os` field.
- **After:** reads `APPSFLYER_S2S_TOKEN` (fail-closed, never dev key); exported idempotent `ensureIdPrefix` applied on the iOS branch; `os: device.platform` added to the body; env/JSDoc updated.
- **Why:** SC-D-auth / SC-D-iosid / SC-D-os / G-4.
- **Lines:** ~49.

### app-mobile/app.json + mingla-business/app.json (Item E)
- **Before:** no `SKAdNetworkItems` in either infoPlist.
- **After:** `SKAdNetworkItems: [{ SKAdNetworkIdentifier: "v9wttpbfk9.skadnetwork" }]` under each `ios.infoPlist`.
- **Why:** SC-E — SKAN scaffold before first paid iOS UA. Full list is a REMAINS-FOR-SETH data item.
- **Lines:** +5 each.

---

## 8. Cross-surface impact table

| Surface | Affected | What changes / why not | Parity |
|---------|----------|------------------------|--------|
| Consumer iOS | YES (A,B,C,E) | ATT fires at first-open (anonymous); logout clears AF; release build fails loud if env unset; SKAN scaffold | manual (RN shared + iOS ATT/infoPlist) |
| Consumer Android | YES (A,B,C) | `startAppsFlyer()` at first-open (no ATT dialog); logout clears AF; build fails loud if env unset | manual (ATT branch differs) |
| Buyer/anon Web | NO | AppsFlyer is native-only; `.web.ts` no-op | n/a |
| Business iOS | YES (C,D,E) | build fails loud if AF env unset; S2S lands (token + id-prefix + os); SKAN scaffold. Start-timing unchanged. | manual |
| Business Android | YES (C,D) | build fails loud if AF env unset; S2S lands (token) | manual |
| Admin Web (adjacent) | NO | no AppsFlyer | n/a |
| Business Web preview (adjacent) | NO | `appsFlyerService.web.ts` no-ops | n/a |

Backend edge (`_shared/appsFlyerS2S.ts` + `process-referral` deletion) is a shared backend surface serving business iOS/Android.

---

## 9. Smoke result (what was actually run)

**Type-check:** `deno check supabase/functions/_shared/appsFlyerS2S.ts` → EXIT 0. `tsc --noEmit` on app-mobile: **zero errors reference my four changed TS files** (the ~876 total are the pre-existing app-mobile baseline; app-mobile CI uses `expo lint`, not strict tsc).

**JSON:** both `app.json` files parse; SKAdNetworkItems present.

**C guard live-fire (real `expo config`):**
- Consumer, DEV (no `EAS_BUILD_PROFILE`) + env unset → **resolves**, `extra` carries the literal fallback (`W29Z6c…`, `6760440898`, `com.mingla.app.v2`).
- Consumer, `EAS_BUILD_PROFILE=production` + env SET → **resolves** (extra carries values).
- Consumer, `production` + env UNSET → **THROWS** `EXPO_PUBLIC_APPSFLYER_DEV_KEY is required for the production EAS_BUILD_PROFILE build … [ORCH-1313]`.
- Business, `production` + env UNSET → **THROWS** the symmetric ORCH-1313 guard; business DEV (no profile) → **resolves** (strip-and-no-op).

**D unit tests:** `deno test …appsFlyerS2S.orch1313.test.ts` → **6 passed / 0 failed** (URL `…/inappevent/id6768737367`, header == token, `os` present, Android bare package, token-unset fail-closed, idempotent prefix, `process-referral` gone).

**Metro / iOS bundle:** started Metro on port 8090 from this worktree; requested `index.bundle?platform=ios` → **HTTP 200, 4.77 MB, no bundle error** — proving the Item-A `index.tsx` change compiles and is served in the app bundle.

**iOS-sim ATT-ordering repro (T-A1..A5) — RUNTIME UNVERIFIED, honest gap:** a booted iPhone 17 Pro Max sim with the consumer dev build IS present, and Metro booted + bundled cleanly, but (1) iOS **simulators do not render the ATT permission dialog** (`requestTrackingPermissionsAsync` resolves without a prompt), so the ordering claim "ATT is the FIRST system dialog" (T-A1/T-A4) is fundamentally a **physical-device** proof; and (2) in this non-interactive harness the installed dev build would not auto-connect to the worktree's Metro (0 bundle requests after `openurl`), so I could not capture the anonymous-first cold-boot console. **Per the dispatch, T-A1/T-A2/T-A4/T-A5 are marked `suspected — runtime unverified on sim`.** The SOURCE-level ordering is CONFIRMED (auth gate removed; every `startAppsFlyer()` inside the ATT-gate continuation; postHog awaits `whenAttResolved()` before client construction — all three strict-grep-gated with fails-on-revert). SPEC §7 assigns the physical-device runtime proof of T-A1..A5 to the tester.

---

## 10. Known issues / deferred

- **No `[TRANSITIONAL]` markers added.** The consumer `hasAppsFlyerEnv` warn is defense-in-depth, not transitional.
- **T-A1..A5 physical-device runtime proof** deferred to the tester (§9). The ATT-dialog-first ordering cannot be shown on a simulator.
- **Item E** ships only AppsFlyer's own `v9wttpbfk9.skadnetwork`; the exhaustive published SKAdNetworkItems list is a REMAINS-FOR-SETH data item before the first paid iOS campaign (SPEC §10.6). Low priority (no ad spend).
- **`process-referral` deployed function** still exists on the remote until the orchestrator deletes it post-merge (or leaves it orphaned; harmless).

---

## 11. Operator action required (orchestrator/Seth — NOT this phase)

1. **Provision Supabase secret `APPSFLYER_S2S_TOKEN`** (api3 V2 S2S token from AppsFlyer Security Center; masked) BEFORE relying on business revenue S2S. Until set, `postAppsFlyerS2SEvent` fail-closes (returns false + logs) — never sends the dev key. `APPSFLYER_BUSINESS_DEV_KEY` is no longer read for auth (the Supabase secret can be retired separately).
2. **Provision consumer EAS env** across release-bound profiles BEFORE the next consumer release build (else the §4.C guard correctly fails the build): `EXPO_PUBLIC_APPSFLYER_DEV_KEY`, `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID=6760440898`, `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID=com.mingla.app.v2`.
3. **Fresh native builds required** (NOT OTA) for consumer + business to pick up the new `extra`/infoPlist (SKAN + env-driven keys).
4. **Redeploy** the edge functions bundling `_shared/appsFlyerS2S.ts` from MERGED main; optionally `supabase functions delete process-referral`.
5. **CLOSE:** flip the five `I-PROPOSED-1313-*` invariants ACTIVE (left DRAFT here).
6. **Migration `db push`:** none (no migration in this ORCH).
7. **REMAINS-FOR-SETH (SPEC §10):** confirm EXPO_PUBLIC business inlining on a real build; obtain the S2S token; paste the full SKAdNetworkItems list before paid iOS UA; end-to-end install-attribution live-fire.

---

## 12. Discoveries for Orchestrator

- **D-1 (env/CI note):** the strict-grep workflow runs each gate as a bare `node <gate>.mjs` with no dependency install. My 6 new gates use ONLY `node:` built-ins (no `@babel/parser`), so they run cleanly. NOTE: the pre-existing `orch-0808-appsflyer-devices-app-discriminator.mjs` imports `@babel/parser`, which is not resolvable in a bare worktree checkout (it errored locally for me) — it must resolve from a node_modules in CI. Not introduced by this ORCH; my S2S change only READS `appsflyer_devices`, so the 0808 invariant is preserved.
- **D-2:** business `appsFlyerService.ts` still carries the stale header comment "ATT deferred — we never prompt at cold start" (investigation D-2 doc-drift); it actually prompts via `_layout.tsx`. Left untouched (DO-NOT-TOUCH §11-B) — register as a doc cleanup.
- **D-3:** the consumer `initSdk` config still uses the real typed `react-native-appsflyer` (`devKey: string`), so the env-driven `string | undefined` consts are narrowed via the explicit per-value guard in `initializeAppsFlyer` (business avoids this via its custom `unknown`-typed SDK shim). No action; noted for parity awareness.

---

**Routing:** back to **mingla-orchestrator** for REVIEW, then **mingla-tester** (physical-device T-A1..A5 ATT-ordering is the highest-risk regression; adversarial angles in SPEC §9). No deploy / merge / PR / secret-set performed by this phase.
