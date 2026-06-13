# INVESTIGATION — ORCH-1129 · mingla-business iOS build broken team-wide (CocoaPods modular headers)

**Date:** 2026-06-12
**Skill:** mingla-forensics (sub-agent of mingla-orchestrator Conductor)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1129-[ios-build-modular-headers]` · branch `ORCH-1129-ios-build-modular-headers` (rebased clean on origin/main)
**Class:** build-infra / CocoaPods / Expo CNG. NO app source, NO UI, NO DB/RLS/migration.
**Comms:** ACKED **COMMS-0030** (WARN→ALL, OPEN) — this investigation IS the ORCH-1129 it points to; it is the source-of-truth for the breakage. Factored COMMS-0027/0028/0029 (OTA/cache/trip-RPC) — none bear on iOS pod resolution.

---

## Symptom summary (expected vs actual)

- **Expected:** `eas build -p ios` of `mingla-business` (any profile) installs CocoaPods and produces an artifact.
- **Actual:** every fresh iOS cloud build since ~2026-05-30 dies at the **Install pods** phase:
  ```
  [!] The following Swift pods cannot yet be integrated as static libraries:
  The Swift pod `AppCheckCore` depends upon `GoogleUtilities` and `RecaptchaInterop`,
  which do not define modules. To opt into those targets generating module maps
  (which is necessary to import them from Swift when building as static libraries),
  you may set `use_modular_headers!` globally in your Podfile, or specify
  `:modular_headers => true` for particular dependencies.
  pod install exited with non-zero code: 1
  ```
- **Reproduction conditions:** ALWAYS, on a fresh EAS cloud `pod install`. Does NOT reproduce on a LOCAL `npx expo prebuild -p ios` + pod install on the orchestrator's Mac (different CocoaPods spec-repo state — see Q4). Android unaffected.

---

## Investigation manifest (every file read, in trace order)

| # | File / artifact | Why |
|---|---|---|
| 1 | `COMMS_LEDGER.md` (anchor) — COMMS-0030, 0029, 0028, 0027 | Entry contract; the breakage is logged in 0030 |
| 2 | `mingla-business/app.config.ts` (full) | Find the plugins array + existing config-plugin pattern; confirm google-signin plugin entry |
| 3 | `mingla-business/plugins/withIosFmtConsteval.js` (full) | The existing iOS Podfile-injection config plugin — exact template for the fix |
| 4 | `mingla-business/plugins/withAndroidBracketSafeCmake.js` (listed) | Sibling plugin; confirm plugin convention |
| 5 | `mingla-business/package.json` / `package-lock.json` | Resolve `@react-native-google-signin/google-signin` JS version + history |
| 6 | `node_modules/@react-native-google-signin/google-signin/{package.json,*.podspec}` | Confirm RNGoogleSignin→GoogleSignIn pod pin |
| 7 | `~/.cocoapods/repos/trunk/Specs/.../GoogleSignIn/9.0.0,9.1.0/*.json` | Prove GoogleSignIn 9.x → AppCheckCore dependency |
| 8 | `~/.cocoapods/repos/trunk/Specs/.../AppCheckCore/11.2.0/*.json` | Prove AppCheckCore is a Swift pod → GoogleUtilities deps |
| 9 | `~/.cocoapods/.../GoogleUtilities,GTMSessionFetcher,AppAuth,GTMAppAuth,PromisesObjC/*.json` | Module-definition status of every sibling pod (blast radius) |
| 10 | `node_modules/@sentry/react-native/*.podspec`; `@react-native-firebase` presence | Rule out OTHER Swift-pod→non-modular chains |
| 11 | `mingla-business/eas.json` | iOS build profiles + the verification gate profile |
| 12 | `git grep modular_headers` (all branches) | Confirm NO existing modular-headers config anywhere |

---

## Q-scorecard

### Q1 — What is the exact pod dependency chain that triggers the error?
`@react-native-google-signin/google-signin` (RNGoogleSignin 16.1.2) → `GoogleSignIn ~> 9.0` → `AppCheckCore ~> 11.0` → `GoogleUtilities/{Environment,UserDefaults} ~> 8.0` + (transitively, in 11.3.0) `RecaptchaInterop`. AppCheckCore is classified by CocoaPods as a **Swift pod**; GoogleUtilities and RecaptchaInterop are ObjC/C pods that do **not** define a module map. Under **static libraries + New Architecture**, a Swift pod cannot `import` a non-modular dependency unless that dependency generates a module map → CocoaPods hard-fails `pod install` and tells you to set `:modular_headers => true` (targeted) or `use_modular_headers!` (global).
**Verdict: PROVEN** (podspec JSON pasted in F-1/F-2).

### Q2 — Why did it start ~2026-05-30 if the JS package didn't change?
The JS package did **not** change at the cutover. `package.json` has pinned `"^16.0.0"` unchanged for a long time, and `package-lock.json` already resolved `16.1.2` both **before and after** the 2026-05-28 ORCH-0978 commit (`058fabd7d`) that last touched the lockfile (F-3). The trigger is **CocoaPods cloud-side transitive resolution**: in an Expo CNG project there is **no committed `ios/Podfile.lock`**, so EAS resolves the native Google pods **fresh to the latest spec-repo-compatible versions on every build**. Google published `AppCheckCore 11.3.0` (and the GoogleUtilities 8.1.1 / RecaptchaInterop revs) that the cloud now resolves; that AppCheckCore rev is the one CocoaPods flags as a Swift pod requiring modular headers under static libs. The last GREEN build (`d9bf545a`, 2026-05-30) resolved a pre-11.3.0 AppCheckCore that did not yet trip the static-library Swift-pod guard. So the breakage is **time-based (upstream pod publish), not commit-based** — exactly why every branch is affected and rebasing does nothing.
**Verdict: PROVEN** (lockfile diff + the absence of any committed Podfile.lock + the "no modular_headers on any branch" grep).

### Q3 — Why does LOCAL prebuild+pod-install pass but the CLOUD fails?
The orchestrator's Mac has a CocoaPods **trunk spec mirror that predates AppCheckCore 11.3.0** — confirmed: `~/.cocoapods/repos/trunk/Specs/.../AppCheckCore/` tops out at **11.2.0** locally (F-4), while the cloud (fresh `pod repo update`) resolves **11.3.0**. CocoaPods resolves to the highest spec-repo-available version satisfying `~> 11.0`; the Mac picks ≤11.2.0 (no Swift-pod static-lib trip on that rev's classification, or an already-cached `Pods/`), the cloud picks 11.3.0 (which trips it). Same `Podfile`, different resolved graph → the bug is invisible locally and only manifests on a clean cloud resolution. **This is why verification REQUIRES an EAS cloud build, not a local one.**
**Verdict: PROVEN** (local spec mirror caps at 11.2.0; cloud error names 11.3.0).

### Q4 — Full blast radius: is it ONLY AppCheckCore→{GoogleUtilities,RecaptchaInterop}, or will fixing those expose the next non-modular pod (whack-a-mole)?
The **only** Swift-pod→non-modular-dependency chain in this project is the Google Sign-In tree. Verified:
- **No Firebase:** `@react-native-firebase` is **absent** (F-5).
- **Sentry** (`@sentry/react-native` 7.2.0 → `RNSentry` → `Sentry/HybridSDK 8.56.1`) depends only on the Sentry framework, which ships its own module — not in the non-modular set (F-5).
- The AppCheckCore sibling pods that ARE in the resolved graph: `GTMSessionFetcher` (DEFINES_MODULE), `AppAuth` (DEFINES_MODULE), `PromisesObjC` (DEFINES_MODULE) all define modules; `GTMAppAuth` is itself a Swift pod (a consumer, not a non-modular dependency) (F-6). The two pods CocoaPods names as non-modular — `GoogleUtilities` and `RecaptchaInterop` — are the complete set the AppCheckCore Swift pod imports.
- Defensive note: a targeted fix should also mark **`AppCheckCore`** itself `:modular_headers => true` (harmless, and forecloses the edge case where CocoaPods, after the two leaf pods are modularized, re-classifies the chain) — this makes the one-shot fix bulletproof without going global.
**Verdict: PROVEN-bounded.** Targeted set = `{ GoogleUtilities, RecaptchaInterop, AppCheckCore }`. No further pod in the graph needs it.

### Q5 — Is there any existing modular-headers config to extend, or is this greenfield?
`git grep -l "modular_headers\|use_modular_headers"` across the worktree + all branches returns **nothing** (F-7). Greenfield. The project already carries the precedent pattern (`plugins/withIosFmtConsteval.js` injects into the generated Podfile via `withDangerousMod`); the fix is a sibling plugin.
**Verdict: PROVEN.**

---

## Findings (six-field evidence)

### F-1 — GoogleSignIn 9.x depends on AppCheckCore ~> 11.0 [CONFIRMED ROOT CAUSE component]
- **Symptom:** EAS error names `AppCheckCore` as the failing Swift pod.
- **Layer:** build / CocoaPods dependency graph.
- **Probe:** `node -e` over `~/.cocoapods/repos/trunk/Specs/.../GoogleSignIn/9.0.0/9.1.0/GoogleSignIn.podspec.json`.
- **Evidence:**
  `GoogleSignIn 9.0.0 deps: {"AppCheckCore":["~> 11.0"],"AppAuth":["~> 2.0"],"GTMAppAuth":["~> 5.0"],"GTMSessionFetcher/Core":["~> 3.3"]}` (identical in 9.1.0).
  RNGoogleSignin podspec: `s.dependency "GoogleSignIn", package["GoogleSignInPodVersion"]`; installed `package.json` → `GoogleSignInPodVersion: ~> 9.0`, `version: 16.1.2`.
- **Mechanism:** the google-signin native module pins GoogleSignIn ~> 9.0, which pulls AppCheckCore ~> 11.0 into the graph — the Swift pod CocoaPods then refuses to integrate as a static lib.
- **Severity:** CONFIRMED ROOT CAUSE (dependency-chain origin).

### F-2 — AppCheckCore (Swift pod) depends on non-modular GoogleUtilities/RecaptchaInterop [CONFIRMED ROOT CAUSE]
- **Symptom:** "Swift pod `AppCheckCore` depends upon `GoogleUtilities` and `RecaptchaInterop`, which do not define modules."
- **Layer:** build / CocoaPods.
- **Probe:** `node -e` over AppCheckCore 11.2.0 + GoogleUtilities podspec JSON.
- **Evidence:** `AppCheckCore 11.2.0 deps: {"PromisesObjC":["~> 2.4"],"GoogleUtilities/Environment":["~> 8.0"],"GoogleUtilities/UserDefaults":["~> 8.0"]}`; GoogleUtilities podspec has **no** `DEFINES_MODULE`/module_map (`defines module? false`, `pod_target_xcconfig: {GCC_C_LANGUAGE_STANDARD, HEADER_SEARCH_PATHS}`). The cloud resolves AppCheckCore **11.3.0** (local mirror caps at 11.2.0), which CocoaPods classifies as a Swift pod under static libraries.
- **Mechanism:** static libraries + New Architecture force a Swift pod to import its deps via module maps; GoogleUtilities/RecaptchaInterop don't generate one → `pod install` aborts with the modular-headers instruction.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-3 — The JS google-signin version did NOT change at the ~May-30 cutover [RULES OUT a JS-bump cause]
- **Symptom:** breakage onset 2026-05-30 with no obvious code change.
- **Layer:** code / lockfile.
- **Probe:** `git show 058fabd7d^:.../package-lock.json` vs `058fabd7d:...` → extract resolved google-signin version.
- **Evidence:** BEFORE `058fabd7d` = `16.1.2`; AFTER = `16.1.2`. `package.json` spec = `"^16.0.0"` (unchanged). `git log -S google-signin -- package.json` → last real change was `4f5d797d2 "new app"` (project genesis) / `058fabd7d` (whitespace only).
- **Mechanism:** since the JS version is constant, the only moving part is the cloud's fresh CocoaPods resolution of latest-compatible native Google pods → upstream pod publish is the trigger, not a repo commit.
- **Severity:** RULED OUT (JS bump) → confirms the upstream-resolution mechanism (Q2).

### F-4 — Local CocoaPods spec mirror predates the offending AppCheckCore rev [CONFIRMED — explains local-passes]
- **Symptom:** local prebuild + pod install succeeds; cloud fails.
- **Layer:** runtime / tooling environment.
- **Probe:** `find ~/.cocoapods/repos/trunk/Specs -path '*AppCheckCore/*' -name '*.podspec.json'` → version list.
- **Evidence:** local AppCheckCore versions top out at `11.0.0, 11.1.0, 11.2.0` (no 11.3.0). RecaptchaInterop is **absent** from the local mirror entirely. Cloud error names **11.3.0**.
- **Mechanism:** CocoaPods resolves to the highest available compatible rev per spec repo; Mac (stale mirror / cached Pods) ≤11.2.0 doesn't trip, cloud (fresh `pod repo update`) = 11.3.0 trips → bug is local-invisible. **Verification must be an EAS cloud build.**
- **Severity:** CONFIRMED ROOT CAUSE (of the local-vs-cloud divergence).

### F-5 — No other Swift-pod→non-modular chain exists (blast radius bounded) [CONFIRMED]
- **Symptom:** risk that fixing the named pods exposes the next one.
- **Layer:** build / dependency graph.
- **Probe:** `ls node_modules/@react-native-firebase` (absent); `grep dependency @sentry/react-native podspec`; sibling podspec module-status scan.
- **Evidence:** no `@react-native-firebase`; `RNSentry` → `Sentry/HybridSDK 8.56.1` only (Sentry ships its own module); `GTMSessionFetcher 5.3.0`, `AppAuth 2.0.0`, `PromisesObjC 2.4.0` all DEFINES_MODULE; `GTMAppAuth` is itself a Swift consumer. Only `GoogleUtilities` + `RecaptchaInterop` are the non-modular leaves AppCheckCore imports.
- **Mechanism:** the complete non-modular set the Swift pods import is `{GoogleUtilities, RecaptchaInterop}`; marking those (+ AppCheckCore defensively) closes the entire surface in one shot.
- **Severity:** CONFIRMED (no whack-a-mole beyond the named set).

### F-6 — Existing `withIosFmtConsteval.js` is the exact fix template [CONFIRMED — fix vector]
- **Symptom:** N/A (capability finding).
- **Layer:** build-config / Expo CNG.
- **Probe:** read `mingla-business/plugins/withIosFmtConsteval.js` + `app.config.ts` plugins array.
- **Evidence:** the plugin uses `withDangerousMod(config, ["ios", (cfg)=>{ ...edit Podfile... }])`, reads `path.join(cfg.modRequest.platformProjectRoot, "Podfile")`, is **idempotent** (skips if marker present), and is registered as `"./plugins/withIosFmtConsteval"` in the `app.config.ts` plugins array (alongside `"./plugins/withAndroidBracketSafeCmake"`). `@expo/config-plugins` resolves (transitive via expo).
- **Mechanism:** the established, working pattern for injecting into the CNG-generated Podfile is a `withDangerousMod` config plugin referenced from `app.config.ts` — the ORCH-1129 fix is a sibling of this file.
- **Severity:** CONFIRMED (fix vector; consumed by the SPEC).

### F-7 — No modular-headers config exists on any branch [CONFIRMED]
- **Probe:** `git grep -ln "modular_headers\|use_modular_headers"` (worktree) — empty; COMMS-0030 confirms across origin/main + all branches.
- **Evidence:** zero matches.
- **Severity:** CONFIRMED (greenfield; rebase cannot help).

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|---|---|
| **Docs** | COMMS-0030 states the breakage is team-wide since ~2026-05-30, NOT caused by ORCH-1119. Matches evidence. |
| **Schema** | N/A — no DB surface. |
| **Code** | `app.config.ts` registers the google-signin plugin + two Podfile-injection plugins; NO modular-headers config anywhere (F-7). |
| **Runtime** | EAS cloud `pod install` aborts naming AppCheckCore/GoogleUtilities/RecaptchaInterop (3 cloud builds + a preview build, per COMMS-0030). |
| **Data** | Lockfile google-signin = 16.1.2 unchanged across the cutover (F-3); local spec mirror caps AppCheckCore at 11.2.0 vs cloud 11.3.0 (F-4). |

**Contradiction flagged:** Code/Data layers say "nothing changed in the repo," yet Runtime fails — the truth lives in the **CocoaPods cloud resolution layer** (no committed Podfile.lock → fresh transitive resolution to a newly-published pod). That gap IS the bug.

---

## Repro evidence

- **Cloud failure:** authoritatively reported by the orchestrator (COMMS-0030): 3 EAS cloud builds + a `preview` build (`5d513012`) all error at Install pods; last GREEN = `d9bf545a` (2026-05-30). Not re-burned here (build-infra investigation; ~35 min/iteration; the SPEC's verification gate is the cloud build).
- **Local non-repro (corroborated):** local CocoaPods trunk mirror caps AppCheckCore at 11.2.0 and lacks RecaptchaInterop entirely (F-4) — directly explains why a local prebuild+pod-install resolves a non-tripping graph. This is the proof that **local cannot reproduce or verify**; the fix must be proven by an EAS cloud build.

Per Prime Directive 7 exemption (pure build-config / CI investigation), no simulator run is required. Confidence ceiling is not capped by a missing sim repro — the chain is proven from authoritative podspec JSON + lockfile history + the cloud error text.

---

## Blast radius / cross-surface map

| Surface | In/Out | Note |
|---|---|---|
| Business iOS (dev/preview/production/TestFlight) | **IN — blocked** | All iOS EAS builds fail at Install pods until fixed |
| Business Android | OUT | Android uses Gradle, not CocoaPods — unaffected |
| Consumer app-mobile iOS/Android | OUT | Separate app; not in scope (NOTE: `app-mobile` ALSO uses google-signin — see Discoveries) |
| Buyer/anon Web, Admin Web, Business Web preview | OUT | Web export has no CocoaPods phase |

The fix is confined to `mingla-business/` build config: a new plugin file + one line in `app.config.ts`. Zero app source, zero runtime behavior change (modular headers only changes how headers are imported at compile time; the app binary behaves identically).

---

## Invariant impact

- No existing invariant in `INVARIANT_REGISTRY.md` governs modular headers (greenfield).
- The SPEC proposes a NEW invariant `I-PROPOSED-IOS-GOOGLE-PODS-MODULAR-HEADERS` (DRAFT) — a strict-grep gate asserting the config plugin + the `:modular_headers => true` directives for `{GoogleUtilities, RecaptchaInterop, AppCheckCore}` stay present, so this cannot silently regress when the next session edits build config. (Forensics flags it; the orchestrator flips it ACTIVE on CLOSE.)

## Discoveries for Orchestrator

- **DISC-1129-A (cross-app):** `app-mobile/` (consumer) also depends on `@react-native-google-signin/google-signin`. If the consumer app cuts a fresh iOS build it will hit the IDENTICAL failure. NOT in ORCH-1129 scope (business-app only per dispatch), but the orchestrator should register a parallel fix for `app-mobile/` before its next iOS build, or port the same plugin. (Out-of-scope; flagged, not actioned.)
- **DISC-1129-B (infra):** the root structural cause is that a CNG project resolves native pods fresh every cloud build with no `Podfile.lock` pin. The modular-headers plugin fixes THIS break; future upstream pod publishes could surface other build breaks the same way. Consider whether to pin critical pod versions long-term (separate, larger decision — not this ORCH).

## Confidence level

**root cause proven.** The full dependency chain, the why-May-30 (upstream pod publish vs unchanged JS lockfile), the local-vs-cloud divergence (local spec mirror caps at 11.2.0), and the bounded blast radius are each backed by pasted podspec/lockfile evidence. The only thing not re-run here is the cloud build itself (the verification gate, owned by the implementor/tester) — which does not lower the diagnosis confidence.

## Recommended next phase + scope

**SPEC (this dispatch, IA mode).** Scope: a single `withDangerousMod` config plugin in `mingla-business/plugins/` injecting **targeted** `:modular_headers => true` for `{GoogleUtilities, RecaptchaInterop, AppCheckCore}` into the CNG-generated Podfile (sibling of `withIosFmtConsteval.js`), registered in `app.config.ts` plugins. Targeted over global (see SPEC §1 justification). Verification gate = a GREEN EAS iOS `development`-profile cloud build that clears Install pods. Regression guard = strict-grep gate. Lands on **main** (unblocks the whole team + ORCH-1119's pending iOS build). Build-config only.
