# QA — META-ORCH-1002 [Android glass hardening] Sub-1 (Fast First Strike)

**Mode:** TARGETED (orchestrator-dispatched on-device live-fire)
**Date:** 2026-05-29
**Skill:** mingla-tester (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[android-glass-hardening]/` on branch `META-ORCH-1002-android-glass-hardening` (HEAD `6038214b2`; +1 tester commit `e2eb9a532` adversarial test). Metro port 8087.
**SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md`
**IMPLEMENTATION:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_ANDROID_GLASS_FIRST_STRIKE.md`
**Comms ledger:** read on entry. No `BLOCK`/`OPEN` row targets this skill, this ORCH-ID, or `ALL` requiring action. COMMS-0002/0003/0004 (ALL/WARN) are N/A — no backend/`supabase/functions`, no external API, no INTAKE.

---

## VERDICT: CONDITIONAL PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 2 (praise)
- **Consumer Android (S1–S4): PASS — `proven` live-fire on physical Samsung SM-A725F (Android 14).**
- **Business Android (S5/S6): `probable` — source-verified + regression+adversarial green; live-fire genuinely attempted on physical device AND emulator, both blocked by a pre-existing native-binary-vs-main drift + host saturation (named below). Requires Seth to accept the deferral OR authorize the one destructive unblock.**
- **iOS no-change pass: `probable` — sim live-fire attempted; blocked by the same pre-existing native drift (`ExpoVideo` not in the installed sim binary). iOS branches verified byte-unchanged by source (every change is `Platform.select` ios / gate=false).**

The single clause keeping this from full PASS is the business-Android live-fire leg, blocked by an **environmental** condition (old dev binary missing `react-native-keyboard-controller` native module + host load avg 34–43), not a code defect. The headline fix Seth photographed — the notification-card taupe ring — is **PROVEN fixed on the physical device** with before/after evidence.

---

## 1. Live-fire sim gate (Phase 0.A)

| Leg | Surface ships? | Result | Evidence |
|---|---|---|---|
| **Physical Android (consumer)** | YES — target | **PROVEN** — app booted on fresh worktree bundle (5034 modules), all consumer surfaces rendered | Samsung SM-A725F `R58R54YV7JT`, Android 14, `com.mingla.app.v2` v1.1.0 (DEBUGGABLE) |
| **Physical/emulated Android (business)** | YES — target | **BLOCKED → probable** | native drift + ANR (see §4) |
| **iOS sim (consumer)** | YES — no-op | **BLOCKED → probable** | `ExpoVideo` native module missing in installed sim binary (see §5) |
| **Web** | NO | Skipped — these are RN-mobile surfaces; web glass path (`GlassBlur.tsx`) is deferred Sub-C per SPEC §5 row 3/7 | N/A |

**Driver:** physical-device via `adb` + `input` taps (Maestro not required — no keystroke bugs in scope). Bundle freshness verified: anchor Metro served `expo-router/entry.js` 5034 modules to the device; app logged `[SESSION_PILLS] loadUserSessions complete` (live, logged-in render).

**Metro setup note (resolved blocker):** the worktree's nested project root (`/mingla-orchs/META-ORCH-1002-[android-glass-hardening]/app-mobile`) caused the dev-client to request a malformed `/mingla-main/app-mobile/node_modules/...` bundle path → `UnableToResolveError` (`_devlauncher_err.png`). RESOLVED per `feedback_testing_handoff_just_run_expo_start.md`: applied the 16 changed source files as a patch onto the anchor checkout (real node_modules, correct project root), ran Metro there on 8087, verified, reverted the anchor afterward (anchor confirmed back on clean `main`).

---

## 2. Per-criterion results

### Consumer (PROVEN on physical Samsung)

| SC | Criterion | Result | Evidence |
|---|---|---|---|
| **SC-1 (S1 Android)** | Unread notification card opaque warm-cream `#FFFAF4` reaching all 4 rounded corners; NO taupe ring | **PASS** | `before_notif.png` (taupe ring present) vs `after_notif.png` (ring gone); tight crops `before_card_crop.png` vs `after_card_crop.png` make it unambiguous. This is the headline fix Seth photographed. |
| **SC-2a/S4** | Bottom nav solid frosted over busy content | **PASS** | `after_chat_nav.png` + crop `after_chat_capsule_crop.png` — solid dark nav over chat; `_app_home2.png` over Discover photos |
| **SC-2b** | Top bar solid | **PASS** | `_app_home2.png` (Discover top bar + pill); `after_chat_nav.png` (chat header) |
| **SC-2c** | Glass icon buttons solid | **PASS** | `after_profile_bento.png` (edit-icon buttons), filter icon `_app_home2.png` |
| **SC-2d** | Badges solid | **PASS** | `_app_home2.png` Discover card badges (8.2mi / 17min / 4.4 / price / "First Dates · 2 stops") read solid over photo |
| **SC-2e** | Sticky headers (Likes/Connections) solid | **PASS** | `_friends3.png` Friends/Connections header + search bar solid over dark canvas |
| **SC-2f** | Profile bento (GlassCard) + Discover badges solid | **PASS** | `after_profile_bento.png` (profile/interests/circle bento cards solid to corners) |
| **SC-3 (S3)** | Chat-input capsule solid frosted `rgba(22,24,28,0.94)`, not see-through | **PASS** | `after_chat_capsule_crop.png` — capsule fully occludes chat behind it; a white bubble is visible ABOVE its top edge but nothing bleeds through |

### Business (probable — source + tests; live-fire blocked)

| SC | Criterion | Source verified | Live-fire |
|---|---|---|---|
| **SC-5a (S5)** | `EditPublishedTripIntakeAccordion` active trip tab: NO Android shadow; iOS glow kept | YES — `elevation: Platform.select({ ios: 8, android: 0, default: 8 })` line 530 | BLOCKED (native drift) |
| **SC-5b (S5)** | `TripCreatorStep6Intake` active trip tab — same | YES — same Platform.select line 304 | BLOCKED |
| **SC-6a (S6)** | `EventListCard` host solid frosted to corners on Android; no child clipped; iOS unchanged | YES — `host` android `rgba(20,22,26,0.92)` (line 283) + `overflow:'hidden'` (line 289); `Platform` imported+used | BLOCKED |
| **SC-6b (S6)** | `TripListCard` host — same | YES — android fill line 255 + `overflow:'hidden'` line 261 | BLOCKED |

### Frozen-iOS + global

| SC | Criterion | Result | Evidence |
|---|---|---|---|
| **SC-1-iOS / SC-2-iOS / SC-3-iOS** | iOS pixel-identical (translucent cream, BlurView, tint floor) | **PASS (source `probable`)** | Every change is behind `Platform.select` ios-branch or `ANDROID_GLASS_USES_OPAQUE_FALLBACK === false`; adversarial A-01 asserts the gate is consumed as a NEGATION so iOS keeps BlurView. Sim boot blocked by pre-existing `ExpoVideo` drift (`ios_notif.png`). |
| **SC-2-grep** | No `app-mobile` glass component keeps a live `Platform.Version < 31` glass gate | **PASS** | Regression T-02 + adversarial A-05; grep across all 8 chrome files = 0 live gates |
| **SC-7 (global)** | Zero out-of-scope touch | **PASS** | `git diff main...HEAD` = only §2.1 files + 2 tests + 2 package.json (+ tester adversarial test). Adversarial A-03 confirms `packages/event-rendering/{designTokens.ts,GlassBlur.tsx}` byte-untouched. |

---

## 3. Regression + adversarial gate

**Consumer happy-path (implementor):** `app-mobile/scripts/ci/meta-orch-1002-android-glass-check.mjs` → **26/26 PASS**.
**Business happy-path (implementor):** `mingla-business/src/components/__tests__/metaOrch1002AndroidGlass.test.ts` → **12/12 PASS** (1 suite).
Both committed in `git diff main...HEAD --name-only`. Implementor reported `fails-on-revert` verified at commit `bf0accc253...` (consumer 22/26 on revert; business 3 failed on revert) — cited from the implementation report §5.

**Tester adversarial (NEW, different angle):** `app-mobile/scripts/ci/meta-orch-1002-android-glass-adversarial-check.mjs` → **29/29 PASS**. Committed `e2eb9a532`, in the PR diff. Attacks failure modes the happy-path cannot see:
- **A-01** iOS-opaque-regression guard: every chrome file must consume the gate as a NEGATION (so iOS keeps real BlurView) — catches "made it opaque on iOS too."
- **A-02** translucent-leak guard: no NEW `<0.92` rgba Android fill on the 6 surfaces (happy-path only checks the EXPECTED opaque value is present).
- **A-03** package-isolation: `event-rendering/designTokens.ts` + `GlassBlur.tsx` byte-untouched vs main (I-MOR-0827).
- **A-04** S5/S6 both-files parity (skip-one failure mode).
- **A-05** revert-canary: zero live `Platform.Version < 31` gates remain.
- **A-06** no bare `elevation: 8` survivor in either S5 file.

**Adversarial teeth proven (negative control):** re-introducing a bare `elevation: 8` in `TripCreatorStep6Intake.tsx` → adversarial drops to **27/29 (A-04 + A-06 FAIL)**; restored → **29/29**.

---

## 4. Business-Android live-fire BLOCKER (the CONDITIONAL clause)

**Root cause: pre-existing native-binary-vs-main-source drift, NOT a defect in this ORCH.**

1. Built business Metro (8089) from the anchor with the S5/S6 patches; bundle compiled cleanly (`index.js`, 5045 modules, HTTP 200).
2. Physical Samsung business app (`com.sethogieva.minglabusiness`, EAS dev build versionCode=4) booted from Metro → **red-box: `react-native-keyboard-controller doesn't seem to be linked`** (`_biz_home.png`). The installed EAS binary (finished 5/26, the latest on EAS) **predates** `react-native-keyboard-controller@1.18.5` which current `main` imports at root (`app/_layout.tsx` + keyboard wrappers). Confirmed the dep is on `main` independently of my patches (my diff contains zero keyboard-controller / expo-video references).
3. **Recovery attempt A — fresh debug APK:** kicked off `gradlew :app:assembleDebug`; it **stalled** in the Kotlin plugin-configuration phase (~0.4% CPU, no progress for 6+ min) under host load.
4. **Recovery attempt B — existing local debug APK** (`app-debug.apk`, contains `libreact_codegen_reactnativekeyboardcontroller.so`): install to the physical device **failed `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** (debug signature ≠ EAS signature). Replacing it would require **uninstalling Seth's logged-in EAS business app** — a destructive op on his real data, which I will not do autonomously (operator-decision gate per `feedback_autonomy_posture_verifier_not_manager.md`).
5. **Recovery attempt C — Android emulator** (`META_ORCH_0972_Pixel_7_API35`): booted, installed the debug APK (no signature conflict), bundle served (5045 modules), but the app **repeatedly ANR'd** ("Business isn't responding" / "System UI isn't responding", `_emu_devlauncher.png` / `_emu_dl2.png`) because **host load average was 34–43** (Mac saturated by 2 Metros + 2 other-session iOS sims I must not kill + the emulator). Freeing my consumer Metro (8087) did not drop load enough; the remaining load is other sessions' processes I cannot touch per the no-cross-session-interference rule.

**Why `probable` is the honest ceiling here:** the S5/S6 change is pure JS/style, source-verified line-by-line against the SPEC in BOTH files, covered by the implementor's business happy-path test (12/12) AND the tester adversarial (A-02/A-04/A-06 specifically attack S5/S6), and the bundle compiled clean. The ONLY missing piece is the on-device pixel screenshot, blocked by environmental conditions I genuinely tried three ways to resolve.

**Case-B unblock (pick one), then S5/S6 flips to PROVEN in ~10 min:**
1. **(Recommended, low-cost)** Authorize uninstalling the EAS business dev build on the physical Samsung so I can install the debug APK that already has keyboard-controller linked (you re-login once — business app, no consumer data). I then drive Trip-creator step 6 + an event/trip list card and screenshot.
2. Run the emulator when the Mac is not hosting other sim sessions (load < ~8) so it stops ANR-ing.
3. Accept the `probable` deferral on S5/S6 for this strike (consumer headline fix is proven; business surfaces are lower-visibility, source+test-verified) and let the full Android sweep (Sub-B…F) carry the business on-device proof.

---

## 5. iOS no-change pass

Loaded the same anchor bundle on a booted iPhone 17 sim (pointed at my own Metro 8087; did not touch the other session's 8099/8092 Metros). The consumer app red-boxed at **`Cannot find native module 'ExpoVideo'`** (`EventCoverMedia.tsx` → `expo-video`, added for ORCH-0964/0978 per COMMS-0007), thrown at module-eval in the nav tree (`PublicEventPage`/`PublicBrandPage`/`ConsumerBrandProfileScreen`). Same class of blocker: the installed **iOS sim binary predates `expo-video` on current `main`** — independent of my patches (`ios_notif.png`). Terminated the app to leave that sim clean for its owner.

**iOS verified unchanged by source (fallback):** every consumer change retains its exact pre-change iOS value — `cardUnreadBg` ios branch `rgba(255,247,237,0.6)`; `MessageInterface` iOS branch keeps `<BlurView intensity={glass.chrome.blur.intensity}>` + `glass.chrome.tint.floor`; the 8 chrome files consume the gate as a negation (adversarial A-01) so iOS still computes `useGlass = true` → BlurView. Regression T-07 + adversarial A-01 lock this.

---

## 6. Constitution (touched rules)

| # | Rule | Result |
|---|---|---|
| 1 | No dead taps | N/A — pure visual style; no interaction changed |
| 8 | Subtract before adding | PASS — replaced 8 duplicated inline gates with one shared export |
| 9 | No fabricated data | N/A |
| — | I-7 (no `return null`; visible degradation) | PASS — every changed branch paints a visible opaque View |
| — | I-MOR-0827 package isolation | PASS — adversarial A-03 (token file byte-untouched) |
| — | iOS-render-frozen | PASS — T-07 + adversarial A-01 |

---

## 7. Typecheck + lint (Completion clause 2)

- **Consumer tsc:** 249 errors total, ALL pre-existing baseline (`packages/phone-input` worktree module-resolution + repo strictness debt) — **0 in any touched file**. Matches implementor's reported 249 baseline.
- **Business tsc:** 234 errors total, all pre-existing baseline — **0 in any touched file**. Matches implementor's 234.
- **Consumer lint (touched files + adversarial script):** **0 errors**, 31 warnings — all pre-existing unused-var/array-type on lines I did not touch.
- **Business lint (touched files):** 4 `react-hooks/rules-of-hooks` errors in `EventListCard.tsx` lines 81–101 + `accent` unused warning in `TripListCard.tsx` — **all pre-existing baseline**, in component logic ABOVE my StyleSheet edits (my diff is line 15 import + lines 274–292 `host` block). Implementor flagged the same. My `Platform` import is used → zero new findings.

---

## 8. Completion condition (machine-verified)

1. ✅ Every independent test green — consumer 26/26, business 12/12, adversarial 29/29 (outputs captured §3).
2. ✅ tsc + lint clean on touched files (0 new errors/findings) — §7.
3. ✅ Both regression tests + adversarial in `git diff main...HEAD --name-only`; adversarial attacks a different angle (iOS-freeze / leak / isolation / parity / revert-canary); implementor fails-on-revert cited at `bf0accc253...`.
4. ⚠️ UI/runtime legs: **consumer Android = PROVEN**; **business Android + iOS no-change = `probable`** (sim blocked by pre-existing native drift + host saturation; three recovery attempts named; Case-B requested). This is the sole reason for CONDITIONAL rather than full PASS.
5. ✅ Zero open P0, zero open P1.

---

## 9. P4 — praise

- **P4-1:** The single-shared-gate refactor (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`) is the right call — it killed the 8-file duplicated `Platform.Version < 31` drift that caused the bug, and the on-device result is a clean, consistent solid-frosted chrome across nav/top-bar/badges/bento. Worth replicating in the full sweep.
- **P4-2:** Mathematically-composited opaque hex `#FFFAF4` for the unread card reads identical-in-warmth to the iOS translucent cream while fully killing the taupe ring — exactly the intended "match iOS intent, not iOS blur" policy.

---

## 10. Discoveries for orchestrator

- **Cross-cutting native drift (P2, not this ORCH's defect):** every installed dev binary (consumer iOS sim + business Android EAS v4) predates current `main`'s root native deps (`expo-video`, `react-native-keyboard-controller`). Any on-device QA of `main` JS now requires a fresh native dev build first. The physical Samsung CONSUMER binary (v1.1.0 launch build) is current and boots fine — which is why consumer S1–S4 proved cleanly. Recommend a fresh business dev build + iOS sim dev build be staged before the next on-device business/iOS QA dispatch.
- **Evidence dir:** `/tmp/mingla-shots/metaorch1002/` — headline: `before_card_crop.png` vs `after_card_crop.png` (taupe ring before/after).

---

## Evidence index (key)

| File | Shows |
|---|---|
| `before_notif.png` / `before_card_crop.png` | Unread card WITH taupe ring (Seth's photographed artifact) |
| `after_notif.png` / `after_card_crop.png` | Unread card cream fill reaching corners, NO ring (SC-1 PROVEN) |
| `after_chat_nav.png` / `after_chat_capsule_crop.png` | Chat-input capsule + bottom nav solid frosted over chat (SC-3, SC-2a) |
| `_app_home2.png` | Discover top bar + card badges solid over photos (SC-2b/d/f) |
| `_friends3.png` | Connections sticky header solid (SC-2e) |
| `after_profile_bento.png` | Profile bento GlassCards + icon buttons solid (SC-2c/f) |
| `_biz_home.png` | Business red-box `keyboard-controller not linked` (native drift blocker) |
| `_emu_dl2.png` | Emulator ANR under host saturation |
| `ios_notif.png` | iOS sim red-box `ExpoVideo` (native drift; iOS verified by source) |
