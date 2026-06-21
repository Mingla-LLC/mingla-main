# TEST — META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 (NATIVE APPS)

**Tester:** mingla-tester (BRUTAL / adversarial)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch `META-ORCH-1187-leg3-apps`
**Branch HEAD at test:** `6da53db1c` (code `2f16a4a45` + report `6da53db1c`)
**Spec (contract):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1187_GROWTH_ANALYTICS_PHASE1.md` §4.C/§4.F/§4.G/§4.H/§4.I, §5 SC, §SC-Security
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1187_LEG3_APPS.md`
**Mode:** SPEC-COMPLIANCE + SECURITY (source/build-level; on-device runtime explicitly PENDING per dispatch cap)

---

## 1. VERDICT — CONDITIONAL PASS

**P0: 0 · P1: 1 (pre-merge, NOT code) · P2: 1 · P3: 0 · P4: 2**

The native PostHog integration is correct, well-isolated, and the **§SC-Security native session-replay masking is satisfied at source + gate + test level on both apps**. Two issues hold this short of clean PASS, neither a security defect in shipped product code:

- **P1 (pre-merge, artifact regression — NOT product code):** the branch is behind current `origin/main` (`9018a3c25`); merging as-is would DELETE META-ORCH-1186's close artifacts (6 invariants, WORLD_MAP banner, COMMS-0051). A `git rebase origin/main` before merge resolves it with zero product-file conflict.
- **P2 (gate robustness):** the `native-mounts-analytics` strict-grep gate can be fooled by its own doc-comment — masking deleted from ACTIVE code but mentioned in a comment still passes the gate. The node:assert + jest regression tests DO correctly fail-on-revert, so runtime safety holds; the structural gate is weaker than its docstring claims.

**Why CONDITIONAL not PASS:** (a) the on-device runtime SC (events landing with distinct_id, T-17 actual masked-replay-recording inspection, toggle-off-stops-events) are **PENDING ON-DEVICE** per the dispatch cap — they ride the fresh native builds and CANNOT be passed on source alone; (b) the P1 rebase must happen before merge. Source/build/gate/test layers are all green.

**§SC-Security native-masking result (explicit):** **PASS at source + gate + adversarial-test level.** `enableSessionReplay: true` + `maskAllTextInputs: true` + `maskAllImages: true` are present in the LIVE `new PostHogClass(...)` constructor of BOTH apps (`app-mobile/src/services/postHogService.ts:155-163`, `mingla-business/src/services/postHogService.ts:123-134`); no `:false` anywhere; tester adversarial test proves masking lives in active (de-commented) constructor code. The actual replay-recording inspection (T-17) remains **PENDING ON-DEVICE** — see §Device matrix.

---

## 2. SC-by-SC matrix (LEG 3 native scope only)

| SC | Status | Evidence |
|----|--------|----------|
| SC-5-App-iOS/Android (consumer signup / card_saved / purchase capture) | PASS (source) · runtime PENDING ON-DEVICE | `app/index.tsx:951-955` `signup_completed`; `SwipeableCards.tsx` 5 behavior events (`card_viewed/expanded/saved/dismissed`, `deck_exhausted`); `ConsumerEventDetailScreen.tsx` `purchase_completed`. |
| SC-6-Business-iOS/Android (signup / publish event-trip-experience / purchase) | PASS (source) · runtime PENDING ON-DEVICE | `AuthContext.tsx` `signup_completed`; `useBusinessEvents.ts`+`useTrips.ts`+`ExperienceCreatorWizard.tsx` `offering_published`; 3 confirm.tsx `purchase_completed` (event/trip/experience), gated on `status==="paid" && order!==null`. |
| SC-7 (identity=user.id; reset on signout) | PASS (source) | consumer `app/index.tsx:941` `identify(user.id)`; business `AuthContext` identify warm-restore + SIGNED_IN, `reset()` at BOTH signout sites. |
| SC-8 (Mixpanel/AppsFlyer unchanged; no startup regression; no crash on missing env) | PASS | mixpanel/appsflyer service files NOT in diff (verified `git diff --name-only`); init additive; T-10 jest + consumer assert prove no-op-on-missing-key; init is `void` + try/catch, never throws. |
| SC-9 (no `phx_` in client; only `phc_` ships) | PASS (gate) | `i-proposed-1187-no-phx-in-client` PASS (2963 files, 0 `phx_`); config keys env-sourced, null default, no literal committed. |
| SC-12-Native (ATT prompt both apps; toggle suppresses capture) | PASS (source) · ATT-popup + suppression runtime PENDING ON-DEVICE | business ATT added (`expo-tracking-transparency` dep+plugin+`requestTrackingPermissionsAsync()` BEFORE `initializeAppsFlyer()` in `_layout.tsx:456-468`); consumer ATT reused; toggle→`optOut()/optIn()` (jest T-19 PASS). |
| SC-13 (feature-flag read resolves) | PASS (source) · runtime PENDING ON-DEVICE | `getFeatureFlag()` exposed both services (default-undefined, never throws). |
| SC-16 (replay sampling configured) | PASS | `PH_REPLAY_SAMPLE_RATE = 0.2` in both services, in the live constructor `sessionReplayConfig`. $0 billing cap = Seth action SA-1 (out-of-band). |
| SC-Security-Native (replay masks all inputs+images) | **PASS (source+gate+adversarial)** · recording inspection PENDING ON-DEVICE (T-17) | masking in live constructor both apps; `native-mounts-analytics`+`replay-masks-pii` gates PASS; tester adversarial test PASS. |
| SC-Security-Config (mask flags never false) | PASS (gate) | `replay-masks-pii` PASS (0 `:false` flags, 2273 files). |
| I-PROPOSED-1187-POSTHOG-HOST-US | PASS (gate) | US host literal in both services; gate PASS (1 init site, US-hosted, 0 forbidden hosts). |
| COMMS-0028 static key read | PASS (gate) | `posthog-key-static-read` PASS; `Constants.expoConfig.extra` + static `process.env`; no dynamic bracket access. |

**Out of LEG-3 scope (Legs 1/2):** SC-1..4, SC-10/11, SC-Security-Web, SC-14/15. NOTE: impl Discovery #1 confirms Leg 2 (buyer-web) is NOT on main yet — independently re-verified (`mingla-business/src/analytics/` absent; `posthog-js` absent from `mingla-business/package.json`). Flagged to orchestrator.

---

## 3. Findings

### P1 — Branch behind origin/main; merging as-is reverts META-ORCH-1186 close artifacts (PRE-MERGE; not product code)
- **Evidence:** merge-base = `acce886ba`, but `origin/main` advanced to `9018a3c25`. `git diff origin/main` shows the branch DELETING the 1186 invariants from `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-PROPOSED-1186-HOURS-SINGLE-OWNER + 5 siblings), the 1186 close banner from `Mingla_Artifacts/WORLD_MAP.md`, and `COMMS-0051` from `COMMS_LEDGER.md`. Confirmed: `git show HEAD:...INVARIANT_REGISTRY.md | grep I-PROPOSED-1186-HOURS-SINGLE-OWNER` = 0; `git show origin/main:...` = 1.
- **Impact:** a squash-merge of this branch would silently revert another shipped ORCH's bookkeeping (the stale-anchor-clobber pattern the project memory warns about).
- **Required fix:** `cd <worktree> && git fetch origin && git rebase origin/main` (or merge origin/main) before opening/merging the PR. Zero product-file overlap (the only files newer main touches that this branch also touches are the 3 artifact files, all additive); ORCH-1189 product files (`LikesPage.tsx`, etc.) are disjoint.
- **Retest:** after rebase, `git diff origin/main -- Mingla_Artifacts/INVARIANT_REGISTRY.md COMMS_LEDGER.md Mingla_Artifacts/WORLD_MAP.md` shows only ADDITIONS (or empty), no deletions of 1186/COMMS-0051 lines.

### P2 — `native-mounts-analytics` gate fooled by doc-comment (gate robustness)
- **Evidence:** `.github/scripts/strict-grep/i-proposed-1187-native-mounts-analytics.mjs:69-71` tests `/maskAllTextInputs\s*:\s*true/.test(c)` against the RAW file without stripping comments (unlike its sibling `replay-masks-pii.mjs:55-59` which DOES strip). Tester proof: deleting `maskAllTextInputs: true` from BOTH active config sites while leaving the doc-comment "is configured with `maskAllTextInputs: true`" → gate STILL PASSES (reproduced 2x via stash-revert, tree restored clean). The gate's own docstring claims "stripping replay masking from the client constructor → this gate FAILS" — that claim is false.
- **Impact:** the structural fails-on-revert safeguard for the native masking security gate is weaker than documented; a future dev could strip masking from active code and the gate wouldn't catch it. (NOT a current shipped defect — both apps' live config is correct.)
- **Required fix:** in `native-mounts-analytics.mjs`, strip comments before the mask-flag regex tests (copy the `stripComments()` helper from `replay-masks-pii.mjs`). Mitigated meanwhile by the tester adversarial test (§5) which strips comments and asserts masking in the live constructor.
- **Retest:** re-run the stash-revert (delete active `maskAllTextInputs: true`, keep comment) → the gate must FAIL.

### P4 — Praise: clean native/web isolation + graceful no-op + parallel-run discipline
- Lazy `import("posthog-react-native")` only when `Platform.OS !== 'web'`; null-client guards on every helper; never throws on missing env (T-10 proven); Mixpanel/AppsFlyer byte-untouched; identical event-name strings for a clean future 1:1 Mixpanel retirement. Provider mounts ONCE per app inside the auth providers via `client={client}` (single instance — autocapture + imperative captures share one client; correct per OQ-4). ATT fires before AppsFlyer (SC-12 ordering correct).

### P4 — Note: dead `buildOptions()` helper in consumer service
- `app-mobile/src/services/postHogService.ts:124-137` `static buildOptions()` is exported but the provider uses `getClient()` (the live client built in `initialize()`), so `buildOptions()` is unused. Harmless (its config matches the live constructor), but it's a second copy of the masking config — keep them in sync or remove the dead helper in a future cleanup. Not a defect.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- **Checked out / ran at:** branch HEAD `6da53db1c` (impl proof commit `2f16a4a45`).
- **Consumer (node:assert):** ran `node app-mobile/src/services/__tests__/orch_1187_posthog_native_consumer.test.ts` → `OK: 23 assertions passed`. Deleted `maskAllTextInputs: true` (true line-deletion) → `AssertionError [ERR_ASSERTION]: native replay must mask all text inputs (maskAllTextInputs: true) — PII gate. actual: false, expected: true` at test line 32. Restored via `git checkout --` → 23 pass. **Matches the implementor's claim.**
- **Business (jest):** ran `npx jest postHogService.orch1187.test.ts` → 3 passed. Deleted `maskAllTextInputs: true` from the active config → `1 failed, 2 passed` (the "constructs the client with masked replay + US host" test FAILS). Restored → 3 pass. **Matches the implementor's claim.**
- Tree confirmed clean after each revert (`git status --short` empty).

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/services/__tests__/postHogService.orch1187.tester.adversarial.test.ts` (NEW, append-only, on-branch, in-diff).
- **Angle (different from implementor):** the implementor tests the config passed to a MOCKED constructor. The tester test attacks the **comment-fooling weakness (P2)** at the SOURCE level for BOTH apps: it strips comments, then asserts the de-commented code still has `enableSessionReplay/maskAllTextInputs/maskAllImages: true` AND that masking lives inside the live `new PostHogClass(...)` constructor region (not only an unused helper or a comment).
- **Result:** 4 tests PASS.
- **fails-on-revert verified at `6da53db1c`:** deleting `maskAllTextInputs: true` from the active business config (comment left intact) → the `native-mounts` GATE STILL PASSES (fooled — proving P2) while the tester adversarial test FAILS (`2 failed, 2 passed`) — i.e. it catches exactly what the gate misses. Restored → 4 pass, tree clean.

## 6. Constitution 14-rule matrix (vs the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | Toggle calls store setter + `optOut()/optIn()`; no inert rows. |
| 2 | One owner per truth | PASS | opt-out lives only in `appStore.analyticsOptOut` (consumer) / `analyticsPrefsStore` (business); postHogService is the sole capture facade. |
| 3 | No silent failures | PASS (analytics-appropriate) | catches `console.warn` (init/identify/reset); capture swallows by design (analytics must never break UI) — acceptable + documented. |
| 4 | One query key per entity | N/A | no React Query changes. |
| 5 | Server state stays server-side | PASS | only a boolean privacy pref in Zustand (client preference, correct). |
| 6 | Logout clears everything | PASS | `reset()` on signout (both apps); opt-out INTENTIONALLY not cleared (device privacy pref, documented, mirrors ATT). |
| 7 | Label `[TRANSITIONAL]` | N/A | no transitional code. |
| 8 | Subtract before adding | PASS | reuses existing Toggle/SimpleToggleRow/SettingsRow; no parallel UI primitive. |
| 9 | No fabricated data | PASS | events carry real props (order totals, user.id, provider); no fakes. |
| 10 | Currency-aware | PASS | purchase events pass real `currency` + `value` from `confirmResult.order`. |
| 11 | One auth instance | N/A | no auth-instance change. |
| 12 | Validate at right time | N/A. |
| 13 | Exclusion consistency | N/A. |
| 14 | Persisted-state startup | PASS | business `analyticsPrefsStore` has `_hasHydrated` gate; consumer uses existing persisted appStore middleware. Minor: boot `initialize()` reads `getState().analyticsOptOut` — see Discovery D-2. |

## 7. Device / parity matrix

| Surface | Result | Notes |
|---------|--------|-------|
| Consumer iOS | SOURCE PASS · runtime PENDING ON-DEVICE | rides fresh native build (COMMS-0047 — must bundle PostHog deps + ORCH-1171 keyboard module in ONE cut). |
| Consumer Android | SOURCE PASS · runtime PENDING ON-DEVICE | shared RN code; replay screenshot-based both OS. |
| Business iOS | SOURCE PASS · runtime PENDING ON-DEVICE | + NEW ATT prompt; toggle on `account/notifications.tsx`. |
| Business Android | SOURCE PASS · runtime PENDING ON-DEVICE | ATT iOS-only no-op. |
| Buyer/anon Web | N/A this leg (Leg 2) | independently confirmed Leg 2 not on main; native service no-ops on web. |
| Admin Web | N/A | Phase 2. |
| Business Web preview | PASS (isolation) | postHogService no-ops on web (`Platform.OS==='web'` + lazy import). |

**Physical-iPhone HITL:** not run — capped PENDING ON-DEVICE per dispatch (requires the fresh builds + EAS `EXPO_PUBLIC_POSTHOG_KEY`). NOT marked skipped; explicit deferral per the dispatch CAP.

**On-device steps to clear the PENDING items (for the next build):**
1. Set EAS env `EXPO_PUBLIC_POSTHOG_KEY` = the public `phc_*` key (project 479999) on both apps' release-bound profiles; cut fresh dev builds (consumer build MUST also include ORCH-1171's `react-native-keyboard-controller` + COMMS-0031 modular-headers plugin — single cut, COMMS-0047).
2. Launch each app; in PostHog Live Events confirm `$pageview`/autocapture + `distinct_id == Supabase user.id` after signin (SC-5/6/7).
3. **T-17 (security, the gate that cannot pass on source):** open a checkout + a PII-entry screen, then in PostHog → Session Replay open the recording; confirm ALL text inputs + images render as masked blocks — ANY readable card/email/password = FAIL.
4. Settings → Analytics OFF → perform an action → confirm NO new event reaches PostHog; ON → resumes (SC-12 / T-19 runtime).
5. iOS: confirm the ATT prompt appears in BOTH apps at first launch (business is newly-wired).

## 8. Discoveries for Orchestrator

1. **Leg 2 (buyer web) NOT on main** — independently confirmed; dispatch said "Legs 1&2 done" but only Leg 1 (marketing) is on origin/main. Leg 2 still needs dispatch. (Existing gates already zero-guard the buyer-web surface for when it lands.)
2. **D-2 (minor, boot opt-out timing):** both services read `getState().analyticsOptOut` at `initialize()`. Consumer `initialize()` runs deferred (post-paint) so the appStore is hydrated; business `analyticsPrefsStore._hasHydrated` exists but `initialize()` does not explicitly await it. Worst case on a cold boot of an opted-out user: a brief window before `optOut()` applies. Low blast radius (deferred init + persisted store usually rehydrates first); flag for a belt-and-suspenders `_hasHydrated` await if Seth wants zero-leak-on-cold-boot for opted-out users.
3. **P2 gate weakness** (above) — recommend folding the `stripComments()` fix into the close, or accept the tester adversarial test as the durable guard.
4. **Dead `buildOptions()` helper** (consumer) — cleanup candidate.

## 9. Accepted conditions (CONDITIONAL PASS)

This CONDITIONAL PASS is gated on, and surfaced to Seth (NOT auto-routed to CLOSE):
- **C-1 (P1, blocking merge):** rebase the branch onto current `origin/main` (`9018a3c25`) before merge so the META-ORCH-1186 invariants / WORLD_MAP banner / COMMS-0051 are NOT reverted.
- **C-2 (PENDING ON-DEVICE, per dispatch cap):** SC-5/6/7/12/13 runtime + the §SC-Security **T-17 actual masked-replay-recording inspection** + toggle-off-stops-events must be verified on the fresh native builds before the consumer leg is considered fully closed. Source/gate/test layers are green; T-17 is NOT passed on source alone.
- **C-3 (P2, recommend):** strengthen the `native-mounts-analytics` gate (strip comments) — or accept the tester adversarial test as the guard.
- **Seth out-of-band actions still open:** SA-1 ($0 PostHog billing cap + no card), SA-2 (enable replay+surveys in project settings), EAS `EXPO_PUBLIC_POSTHOG_KEY`.
