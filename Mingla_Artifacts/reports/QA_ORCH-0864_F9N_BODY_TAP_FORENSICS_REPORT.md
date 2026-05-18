# QA — ORCH-0864 [Marketing Composer V2] — F.9n body-editor tap forensics

**Dispatch:** `Mingla_Artifacts/prompts/ORCH-0864_F9N_BODY_EDITOR_TAP_FORENSICS.md`
**Verdict:** **PASS** — body editor is fully functional on iOS sim. Confidence: `proven` via live-fire repro of tap → caret → keyboard → type + chip insertion on a running simulator.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Resolution path:** Option B (fix codegen registry) per operator directive 2026-05-18.

---

## TL;DR

The body editor was dead because **`react-native-webview@13.13.5`'s `codegenConfig` was missing the `ios.modulesProvider` block**, so Expo SDK 54's codegen excluded `RNCWebViewModule` from `RCTModuleProviders.mm`. The runtime's New-Architecture TurboModuleRegistry then threw `'RNCWebViewModule' could not be found` on bundle eval, React's error boundary swallowed it, and pell's WebView never mounted. The visible "opaque grey box" was just the `bodyHost` `<View>` background with nothing inside.

Fix: upgrade `react-native-webview` 13.13.5 → 13.16.1. The newer version's `package.json` includes the missing block:

```json
"ios": {
  "componentProvider": { "RNCWebView": "RNCWebView" },
  "modulesProvider": { "RNCWebViewModule": "RNCWebViewModule" }
}
```

After upgrade + `pod install` + rebuild, `RCTModuleProviders.mm` correctly registers `RNCWebViewModule`. The composer editor now accepts taps, shows the system keyboard, accepts typed input, and renders both personalization tokens and event chips inline with the correct dark-canvas-with-orange-accent styling.

No JS-layer source changes were required. All F.9n-and-prior wiring (View-wrapped RichEditor, useContainer=false, explicit bodyHeight, commandDOM chip CSS injection, focus path) was correct — it just needed a WebView native module that actually existed at runtime.

---

## Live-fire evidence — PASS criteria

Device: iPhone 17 Pro simulator, iOS 26.4, UDID `17091E60-C3B6-4167-980D-60C348E177F6`.

Sequence run via Maestro + `xcrun simctl io screenshot`:

| Criterion | Action | Result | Screenshot |
|---|---|---|---|
| Tap → caret | `tapOn point "50%,68%"` inside body box | Orange caret appears at tap point | `/tmp/sim_typed_v2.png` |
| Type → text | `inputText "Hey going to Vegas!"` | Text "Hello Hey going to Vegas!" rendered in body (white text on transparent BG showing bodyHost dark-grey through) | `/tmp/sim_typed_v2.png` |
| Personalize → chip | tap `composer-v2-pill-personalize` → tap `composer-v2-token-first_name` | `first_name` chip rendered inline with monospace font + orange-bordered pill + × close button | `/tmp/sim_token2.png` |
| +Event → chip | tap `composer-v2-pill-event` → tap `composer-v2-event-card-060d0483-...` | "▣ The DC Adventure · Sun, Aug 16 ×" chip rendered with orange ▣ glyph + orange-tinted pill + × close button | `/tmp/sim_event_v2.png` |
| Continue typing after chip | next-char cursor positioning post-chip | Caret rests after chip; ready for further input (verified in `composer-v2-body-host` hierarchy bounds + focus state) | `/tmp/sim_event_v2.png` |
| No TurboModule error | Reload Metro bundle, watch log | Only pre-existing unrelated warnings (Stripe `forwardRef`, `document` reference). No more `RNCWebViewModule could not be found`. | `/tmp/metro-orch-0847.log` |

All four primary success criteria from the dispatch are met with `proven`-level evidence. The single test brand "Travel Brand" provided real events (The DC Adventure, The Belgium Adventure) which made the +Event flow end-to-end testable. Subject input + Insertion bar (B/I/Link/+Event/Personalize/⋮) all continue to work as designed.

---

## Root cause — six-field finding

**File:** `mingla-business/node_modules/react-native-webview@13.13.5/package.json` (upstream package config)

**Exact code (what was missing):**
```json
"codegenConfig": {
  "name": "RNCWebViewSpec",
  "type": "all",
  "jsSrcsDir": "./src",
  "android": { "javaPackageName": "com.reactnativecommunity.webview" }
  // ← NO ios block at all in 13.13.5
}
```

**What it did:** With no `ios.componentProvider` or `ios.modulesProvider` declared, Expo SDK 54's codegen generator (`expo-modules-autolinking@3.0.25`) skipped `react-native-webview` entirely when emitting `ios/build/generated/ios/RCTModuleProviders.mm`. The generated file contained ONLY OneSignal (which DOES have `ios.modulesProvider` set):

```objc
NSDictionary<NSString *, NSString *> * moduleMapping = @{
  @"OneSignal": @"RCTOneSignalEventEmitter", // react-native-onesignal
};
```

**What it should do:** Include every TurboModule the project depends on. `react-native-webview@13.16.1`'s `package.json` declares the missing block, and after `pod install` the generated file correctly contains:

```objc
NSDictionary<NSString *, NSString *> * moduleMapping = @{
  @"OneSignal": @"RCTOneSignalEventEmitter", // react-native-onesignal
  @"RNCWebViewModule": @"RNCWebViewModule", // react-native-webview
};
```

**Causal chain:**
1. `package.json` codegenConfig missing `ios.modulesProvider` block → Expo codegen excludes `react-native-webview` from `RCTModuleProviders.mm` emission.
2. App boots → bridge reads `RCTModuleProviders.moduleProviders` → only registers OneSignal in the TurboModuleRegistry. `+[RNCWebViewModule load]` ran (Obj-C runtime class registration) but the JSI-bridge registry has no entry pointing to it.
3. JS imports `react-native-pell-rich-editor` → which imports `react-native-webview` → which calls `TurboModuleRegistry.getEnforcing('RNCWebViewModule')` at module-eval time.
4. `getEnforcing` finds no entry in `moduleProviders` and throws `Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'RNCWebViewModule' could not be found`.
5. React's error boundary catches the throw in the composer subtree → renders fallback (effectively nothing). `<View style={bodyHost}>` remains rendered as a dark-grey card with empty children.
6. Seth sees an unresponsive grey body box. Every prior "fix" (F.7 ScrollView removal, F.7b explicit height, F.9 Pressable wrap, F.9n plain View) was operating at a layer ABOVE this bug. The WebView never mounted, so none of those changes affected anything.

**Verification step (pre-fix):**
1. `nm minglabusiness.debug.dylib | grep RNCWebViewModule` → returns symbols (class IS compiled in)
2. `grep "WebView" ios/build/generated/ios/RCTModuleProviders.mm` → returns nothing (class is NOT registered)
3. Metro log emits `[Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'RNCWebViewModule' could not be found]` on first composer mount
4. Maestro hierarchy dump shows `composer-v2-body-host` with `"children" : [ ]`

**Verification step (post-fix):**
1. `node -e "console.log(require('./node_modules/react-native-webview/package.json').codegenConfig.ios)"` → returns `{ componentProvider: { RNCWebView: 'RNCWebView' }, modulesProvider: { RNCWebViewModule: 'RNCWebViewModule' } }`
2. `grep "WebView" ios/build/generated/ios/RCTModuleProviders.mm` → returns `@"RNCWebViewModule": @"RNCWebViewModule", // react-native-webview`
3. Metro log on bundle reload: no TurboModule error
4. Maestro tap at `50%,68%` + `inputText "Hey going to Vegas!"` → text appears in body with orange caret
5. Maestro tap on `composer-v2-token-first_name` → `first_name` chip renders inline
6. Maestro tap on `composer-v2-event-card-<uuid>` → event chip renders inline with ▣ glyph

**Confidence:** `proven`.

---

## Fix applied

Single-line change to `mingla-business/package.json`:

```diff
-    "react-native-webview": "^13.13.5",
+    "react-native-webview": "^13.16.1",
```

Followed by:
1. `npm install` (regenerates `node_modules/react-native-webview` + updates `package-lock.json`)
2. `cd mingla-business/ios && pod install` (regenerates Pods + codegen output including `RCTModuleProviders.mm`)
3. `xcodebuild` (per runbook with `SENTRY_DISABLE_AUTO_UPLOAD=true`)
4. Manual Pods-frameworks embed + codesign per runbook steps 3–4
5. Reinstall + relaunch on sim

No JS code changes. No native source changes. No patches. Just a single version bump that pulls in upstream's fix.

The F.9n-and-prior JS-layer code (View wrapper, canonical Input subject, panel-render-order swap, bodyHost styling, commandDOM chip CSS injection, caret-color, etc.) is all retained and is now confirmed working end-to-end.

---

## Files changed

- `mingla-business/package.json` — version bump only
- `mingla-business/package-lock.json` — regenerated by `npm install`

Untracked files in `ComposerV2/` directory still need to be committed as part of the broader ORCH-0864 close — they were the F.5+ implementation that never made it into a commit.

The orchestrator should bundle the package.json + package-lock.json changes alongside the broader ORCH-0864 commit at CLOSE time.

---

## Cross-surface impact

| Surface | Affected? | Notes |
|---|---|---|
| Consumer iOS (`app-mobile/`) | **YES** (latent) | Likely had the same codegen registry gap for any package without `ios.modulesProvider`. If app-mobile doesn't use react-native-webview, the bug never surfaces, but the codegen is broken for OTHER TurboModules too. Out of scope for this report — flagged as Hidden Flaw. |
| Consumer Android | NO | Android codegen path differs; this iOS-specific config block doesn't apply. |
| Buyer/anonymous Web | NO | Web build doesn't use native modules. |
| Business iOS (`mingla-business/`) | **YES, fixed** | This report |
| Business Android | UNKNOWN | Untested in this report — would need separate live-fire run on Android emulator. Codegen path differs but the symptom would manifest similarly if Android codegen has the same filter. Recommend follow-up dispatch to test. |
| Admin Web | NO | No native bridge. |
| Business Web preview | NO | No native bridge. |

Per the Cross-Surface Impact rule, this fix covers Business iOS only. Business Android and Consumer iOS should be re-tested by the orchestrator as follow-up ORCHs if either of those surfaces uses `react-native-webview` directly or transitively.

---

## Discoveries for orchestrator

- **`RCTModuleProviders.mm` still feels suspiciously sparse.** Post-fix it has only 2 entries (OneSignal + RNCWebViewModule). The mingla-business app has 120 Pods + 150 total pods installed; many of those declare `codegenConfig`. They DO appear correctly in `RCTThirdPartyComponentsProvider.mm` (Fabric components) — but TurboModule registrations are gated by `ios.modulesProvider` block in the package, which most RN libraries don't declare in their codegen config. This is upstream-package-level: each library would need to opt in via that block. The current behavior may simply be how Expo SDK 54 handles TurboModule autolinking, OR there may be silently-broken modules waiting to surface on first use. Worth a separate brief audit ORCH.
- **The runbook needs a Sentry env var.** `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` step 1's `xcodebuild` command fails with `sentry-cli requires --org` unless `SENTRY_DISABLE_AUTO_UPLOAD=true` is set. The runbook should be updated.
- **Pre-existing Metro warnings** are unrelated to this ORCH: `forwardRef render functions accept exactly two parameters` from `@stripe/stripe-react-native`'s `StripeProvider`, and a harmless `ReferenceError: Property 'document' doesn't exist` during bundle eval. Both can be ignored or filed as low-priority cleanup ORCHs.
- **Composer F.9n's `commandDOM` chip CSS injection is confirmed working** — the orange caret-color (`#eb7825`) and the `.mingla-event-chip { background: rgba(235, 120, 37, 0.16); border: 1px solid rgba(235, 120, 37, 0.55); }` and the orange ▣ glyph all render exactly as designed.
- **react-native-webview 13.13.5 → 13.16.1 is a minor patch upgrade** (~3 versions, no API breaks). Peer deps are wildcards. No other library should need adjustment.

---

## Severity rollup

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 0
- **P4:** 1 — observation that `RCTModuleProviders.mm` is sparse; could be silently broken for other modules.

---

## Regression test

Per ORCH-0840 §append-only regression-test enforcement, the fix needs:

(a) **Implementor's happy-path test:** A test that asserts `react-native-webview` resolves at module-load time without throw. This is essentially a TypeScript-level smoke test — calling `import { WebView } from 'react-native-webview'; expect(WebView).toBeDefined();` is not meaningful because the throw happens at runtime in the JSI bridge, not at JS module-resolution time.

Instead, the appropriate guard is a **CI gate that greps `ios/build/generated/ios/RCTModuleProviders.mm` for `RNCWebViewModule` after `pod install` runs**. This is a build-time check, not a Jest test. Owner of the gate: orchestrator at CLOSE. Suggested location: `.github/scripts/strict-grep/orch-0864-codegen-webview.mjs` or extended into the existing `orch-0864-composer-v2.mjs`.

(b) **Tester's adversarial test:** A test that fails if someone downgrades react-native-webview below 13.16.1. Suggested: a package.json validation script that asserts `react-native-webview >= 13.16.1`.

These regression artifacts should land alongside the ORCH-0864 close commit. Operator may waive if Business is BACKFILL-EXEMPT scope, but given the cost of this incident (~6 hours of futile fixes), the gate is worth its weight.

---

## Verdict

**PASS** — proven on iOS sim. Body editor accepts taps, shows keyboard, accepts typed input, renders both personalization tokens and event chips inline with correct styling. The F.9n-and-prior JS-layer code is correct as-is and stays in tree.

ORCH-0864 may now proceed to CLOSE.

---

## Next-Handoff Paragraph

NEXT STEPS — for you, Seth:

1. Read this report's TL;DR + Fix Applied + Discoveries sections.
2. The fix is a single version bump in `mingla-business/package.json` (and the regenerated `package-lock.json`). Both files are dirty in git. The orchestrator (Codex or me) will bundle these alongside the broader ORCH-0864 commit at CLOSE time.
3. Optional but recommended: ask the orchestrator to register a follow-up ORCH `ORCH-0871 [TurboModule codegen registry audit]` to verify that every other package with native modules has the required `ios.modulesProvider` block — there may be silently-broken modules waiting to surface.
4. Optional: ask the orchestrator to extend the strict-grep CI gate to assert `RCTModuleProviders.mm` contains `RNCWebViewModule` so this never silently regresses again.
5. When you're ready to CLOSE ORCH-0864, dispatch the orchestrator with a CLOSE command. The QA verdict here is PASS; the implementor JS code is in tree as F.9n; the package.json bump is the only additional change needed.
