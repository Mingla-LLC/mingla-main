# SPEC — ORCH-1129 · mingla-business iOS build: Google-pods modular headers

**Date:** 2026-06-12 · **Skill:** mingla-forensics (SPEC) · **Mode:** IA (follows INVESTIGATE_ORCH-1129_IOS_BUILD_MODULAR_HEADERS.md)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1129-[ios-build-modular-headers]` · branch `ORCH-1129-ios-build-modular-headers`
**Class:** build-config only. NO app source, NO UI, NO DB/RLS/migration, NO edge fn.
**Comms:** references COMMS-0030. Must land on **main** (unblocks the whole team's iOS builds + ORCH-1119's pending device build).

---

## 1. Executive summary

Every fresh EAS iOS build of `mingla-business` fails at **Install pods** because the Google Sign-In pod chain (`@react-native-google-signin/google-signin` → `GoogleSignIn ~> 9.0` → `AppCheckCore ~> 11.x`) pulls in the **Swift pod AppCheckCore**, which imports `GoogleUtilities` and `RecaptchaInterop` — two ObjC pods that don't define module maps. Under the project's **static libraries + New Architecture** config, CocoaPods refuses to integrate a Swift pod whose deps lack module maps and aborts `pod install`.

The fix is a single **Expo config plugin** (`mingla-business/plugins/withGooglePodsModularHeaders.js`) that injects **targeted** `pod '<name>', :modular_headers => true` lines for `GoogleUtilities`, `RecaptchaInterop`, and `AppCheckCore` into the CNG-generated `Podfile` (Expo regenerates `ios/` on every cloud build, so this MUST be a plugin, not a hand-edit). It is a direct sibling of the existing `withIosFmtConsteval.js` plugin and is registered in `app.config.ts`'s `plugins` array.

**Targeted, not global** (`use_modular_headers!`): the blast radius is bounded to exactly these three pods (INVESTIGATE Q4/F-5 — no Firebase, Sentry self-modular, all other Google siblings define modules). Targeted avoids forcing module maps on every pod in the graph (which raises build time and can break unrelated ObjC pods). See §1a.

### 1a. Targeted vs global — decision

| Option | Verdict | Why |
|---|---|---|
| **Targeted `:modular_headers => true` for `{GoogleUtilities, RecaptchaInterop, AppCheckCore}`** | **CHOSEN** | Minimal blast radius; matches CocoaPods' own remediation hint; blast radius proven-bounded (F-5) so it's complete in one shot; no build-time cost on unrelated pods. AppCheckCore included defensively to foreclose re-classification once its leaves are modularized. |
| Global `use_modular_headers!` | Rejected | Forces module-map generation on ALL pods (React-Core, RCT-Folly, fmt, Sentry, etc.), increasing build time and risking new "redefinition of module" / umbrella-header conflicts on pods that were fine as static libs. Unnecessary given the bounded radius. |

### 1b. `expo-build-properties` `ios.useFrameworks` alternative — considered, rejected

Setting `expo-build-properties` → `ios.useFrameworks: "static"` (or `"dynamic"`) is the OTHER common cure (dynamic frameworks sidestep the static-library Swift-pod rule entirely). **Rejected** because:
1. It is a **global build-mode change** to the whole pod graph — far broader than the 3-pod targeted directive; it would interact with `withIosFmtConsteval.js` (fmt/consteval) and the New-Architecture/Hermes setup in ways that demand their own cloud-build validation cycles (the exact slow whack-a-mole the dispatch wants to avoid).
2. `useFrameworks: "dynamic"` changes binary packaging (dynamic frameworks shipped in the app bundle) and can conflict with static-only pods → new failure classes.
3. The project is intentionally on **static library** build type today; the modular-headers directive keeps that, changing only header-import behavior at compile time — **zero runtime/binary behavior change**. The narrowest correct fix wins.

---

## 2. Scope & non-goals

**In scope**
- New file `mingla-business/plugins/withGooglePodsModularHeaders.js` (config plugin).
- One-line registration in `mingla-business/app.config.ts` `plugins` array.
- A strict-grep regression gate (test file) asserting the plugin + directives persist.

**Non-goals (explicitly OUT)**
- `app-mobile/` (consumer) — also uses google-signin and will hit the same break, but is OUT of this ORCH per dispatch (DISC-1129-A; orchestrator registers separately).
- Any `use_modular_headers!` global directive.
- `expo-build-properties` / `useFrameworks` changes (§1b).
- Pinning native pod versions / committing a Podfile.lock (DISC-1129-B; separate decision).
- Any app source, UI, DB, RLS, migration, or edge-function change.
- Android (uses Gradle, unaffected).

**Assumptions**
- The CNG-generated Expo SDK 54 Podfile contains a single app `target` block with a `use_expo_modules!` call inside it (canonical Expo template). The plugin anchors on `use_expo_modules!`; if absent it falls back to anchoring on `target '<name>' do` (see §4 plugin code's two-anchor strategy) and, if neither is found, leaves the Podfile untouched (same fail-soft contract as `withIosFmtConsteval.js`).
- `@expo/config-plugins` resolves (transitive via `expo`) — verified (F-6).

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | **NO** | n/a | none | Manual — separate app; DISC-1129-A flags a parallel fix. One-phrase reason: different app, out of dispatch scope. |
| 2 | Consumer Android | NO | n/a | none | One-phrase reason: no CocoaPods. |
| 3 | Buyer/anon Web | NO | n/a | none | One-phrase reason: web export has no pods phase. |
| 4 | **Business iOS** | **YES** | iOS EAS builds (dev/preview/production) clear Install pods and produce an artifact again | `mingla-business/plugins/withGooglePodsModularHeaders.js`, `mingla-business/app.config.ts`, regression test | Automatic — single CNG Podfile path for all iOS profiles |
| 5 | Business Android | NO | n/a (already builds) | none | One-phrase reason: Gradle, not CocoaPods. |
| 6 | Admin Web | NO | n/a | none | One-phrase reason: not RN/iOS. |
| 7 | Business Web preview | NO | n/a | none | One-phrase reason: web export, no pods. |

---

## 4. Layered specification

Only the **build-config** layer is touched. No DB / edge / service / hook / component / realtime layers apply.

### 4.1 Config plugin (NEW) — `mingla-business/plugins/withGooglePodsModularHeaders.js`

**Contract:**
- CommonJS module exporting a single config-plugin function (matches `withIosFmtConsteval.js`).
- Uses `withDangerousMod(config, ["ios", (cfg) => {...}])`.
- Reads `path.join(cfg.modRequest.platformProjectRoot, "Podfile")`; if it doesn't exist → return `cfg` untouched.
- **Idempotent:** if the marker string is already present, return untouched.
- Injects three `pod ... :modular_headers => true` lines **inside the target block, BEFORE pod resolution** — i.e. immediately ABOVE the `use_expo_modules!` line (primary anchor). If `use_expo_modules!` is absent, anchor immediately AFTER the `target '<name>' do` line (secondary). If neither anchor is found → leave the Podfile untouched (fail-soft; surfaces as the original pod error, never a corrupt Podfile).
- **Why before `use_expo_modules!` / not in `post_install`:** `:modular_headers` is a **pod-declaration-time** directive consumed during dependency resolution; `post_install` runs AFTER resolution and is too late (that's why `withIosFmtConsteval.js` legitimately uses post_install for a build-setting, but THIS fix must precede resolution).

**Reference implementation (illustrative — implementor owns final form; must satisfy the contract + tests):**

```js
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ORCH-1129: GoogleSignIn ~> 9.0 → AppCheckCore (Swift pod) imports GoogleUtilities
// + RecaptchaInterop, which don't define module maps. Under static libraries +
// New Architecture, CocoaPods refuses to integrate the Swift pod and aborts
// `pod install`. Force targeted modular headers for the three Google pods so the
// module maps are generated. Sibling of withIosFmtConsteval.js. CNG-safe (re-runs
// on every prebuild). Compile-time header-import change only; no runtime impact.

const MARKER = "ORCH-1129 modular headers";
const MODULAR_PODS = ["GoogleUtilities", "RecaptchaInterop", "AppCheckCore"];

const BLOCK =
  `  # ${MARKER}: GoogleSignIn 9.x → AppCheckCore (Swift) needs module maps for\n` +
  `  # these non-modular deps under static libraries. Injected by\n` +
  `  # plugins/withGooglePodsModularHeaders.js.\n` +
  MODULAR_PODS.map((p) => `  pod '${p}', :modular_headers => true`).join("\n") +
  "\n";

const withGooglePodsModularHeaders = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfile)) return cfg;
      let contents = fs.readFileSync(podfile, "utf8");
      if (contents.includes(MARKER)) return cfg; // idempotent

      const expoAnchor = "use_expo_modules!";
      const expoIdx = contents.indexOf(expoAnchor);
      if (expoIdx !== -1) {
        const lineStart = contents.lastIndexOf("\n", expoIdx) + 1;
        contents = contents.slice(0, lineStart) + BLOCK + contents.slice(lineStart);
      } else {
        const m = contents.match(/^target ['"][^'"]+['"] do[^\n]*\n/m);
        if (!m) return cfg; // no anchor → leave untouched (fail-soft)
        const insertAt = m.index + m[0].length;
        contents = contents.slice(0, insertAt) + BLOCK + contents.slice(insertAt);
      }
      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);

module.exports = withGooglePodsModularHeaders;
```

### 4.2 Registration — `mingla-business/app.config.ts`

Add `"./plugins/withGooglePodsModularHeaders"` to the `plugins` array. Place it **adjacent to the other two custom plugins** (after `"./plugins/withIosFmtConsteval"`), so all three Podfile-affecting plugins are grouped:

```ts
      "./plugins/withAndroidBracketSafeCmake",
      "./plugins/withIosFmtConsteval",
      "./plugins/withGooglePodsModularHeaders", // ORCH-1129
```
(Ordering among the iOS plugins is safe: this plugin injects pod declarations before resolution; `withIosFmtConsteval` edits post_install build settings — they touch disjoint Podfile regions and are each idempotent/marker-guarded.)

---

## 5. Success criteria

- **SC-1 (plugin exists & registered):** `mingla-business/plugins/withGooglePodsModularHeaders.js` exists, exports a function, and `app.config.ts` `plugins` includes `"./plugins/withGooglePodsModularHeaders"`.
- **SC-2 (Podfile injection — local proof):** running `npx expo prebuild -p ios --no-install` (or inspecting the generated Podfile after prebuild) in a throwaway dir yields a Podfile containing all three `pod '<name>', :modular_headers => true` lines INSIDE the target block, ABOVE `use_expo_modules!`. (Local prebuild succeeds — INVESTIGATE Q3 — so this is verifiable locally even though the BUG isn't.)
- **SC-3 (idempotent):** applying the plugin twice (re-running prebuild) does not duplicate the block (marker guard).
- **SC-4 (VERIFICATION GATE — cloud, business-iOS):** a fresh **EAS iOS `development`-profile cloud build** (`eas build -p ios --profile development`) **clears the Install pods phase** — i.e. `pod install` exits 0 and the build proceeds past pods (artifact produced, or fails only LATER for an unrelated reason). **This is the load-bearing gate: because local cannot reproduce the failure (F-4), only a GREEN cloud pods phase proves the fix.** Success signal = the build log no longer contains `cannot yet be integrated as static libraries` / `pod install exited with non-zero code: 1`, and reaches the compile/archive phase.
- **SC-5 (no regression elsewhere):** the change touches only the two files + the test; `git diff --stat` shows no app-source/DB/edge changes.

---

## 6. Invariants

**Preserved:** none broken — greenfield (F-7). The existing `withIosFmtConsteval` post_install injection is untouched (disjoint Podfile region).

**NEW (DRAFT — orchestrator flips ACTIVE on CLOSE):**
- `I-PROPOSED-IOS-GOOGLE-PODS-MODULAR-HEADERS` — `mingla-business` MUST carry the `withGooglePodsModularHeaders` config plugin registered in `app.config.ts`, and that plugin MUST emit `:modular_headers => true` for `GoogleUtilities`, `RecaptchaInterop`, and `AppCheckCore`. Verified by the §9 strict-grep gate. **Why:** the break is invisible locally and re-emerges on any fresh cloud build; without the gate a future build-config edit could silently drop the plugin and re-break all iOS builds team-wide.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy) | plugin registered | read `app.config.ts` plugins array | contains `"./plugins/withGooglePodsModularHeaders"` | build-config (grep gate) |
| T-2 (happy) | plugin emits all 3 directives | read plugin source | contains `:modular_headers => true` for each of `GoogleUtilities`, `RecaptchaInterop`, `AppCheckCore` | build-config (grep gate) |
| T-3 (behavior) | plugin injects into a Podfile | a fixture Podfile string with `target 'mingla-business' do\n  use_expo_modules!\n ... end`; run the exported plugin's mod fn against it | resulting Podfile has the 3 pod lines ABOVE `use_expo_modules!`, inside the target | unit (node) |
| T-4 (idempotent) | apply twice | run the mod fn twice on the fixture | marker + 3 lines appear exactly once | unit (node) |
| T-5 (fail-soft) | no anchor | a Podfile fixture with neither `use_expo_modules!` nor a `target ... do` | Podfile returned unchanged (no throw) | unit (node) |
| T-6 (cloud gate) | real EAS build | `eas build -p ios --profile development` | Install pods phase exits 0; log lacks the modular-headers error | cloud (manual, owned by tester/Seth) |

T-3/T-4/T-5 can run by requiring the plugin and invoking the inner `withDangerousMod` callback with a mocked `cfg` whose `modRequest.platformProjectRoot` points at a temp dir containing a fixture `Podfile` — mirror how Expo dangerous-mod plugins are unit-tested. (If the repo has no existing dangerous-mod unit test harness, T-1/T-2 strict-grep + T-6 cloud gate are the minimum bar; T-3..T-5 are strongly recommended and cheap.)

---

## 8. Implementation order

1. Create `mingla-business/plugins/withGooglePodsModularHeaders.js` per §4.1.
2. Register it in `mingla-business/app.config.ts` per §4.2.
3. Add the regression test/gate per §9 (and T-3..T-5 unit tests if a harness exists).
4. Local proof (SC-2/SC-3): `npx expo prebuild -p ios --no-install` in a scratch checkout (NOT the symlinked worktree node_modules path if it risks cache poisoning — use a clean dir), inspect the generated `ios/Podfile` for the 3 lines above `use_expo_modules!`.
5. **Hand to tester/Seth for the cloud gate (SC-4 / T-6):** `eas build -p ios --profile development` must clear Install pods.

---

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** a strict-grep test (jest or the repo's existing grep-gate harness, sibling of the `i-giphy-key-wired` gate referenced in COMMS-0028) named e.g. `iosGooglePodsModularHeaders.gate.test.ts` that asserts:
1. `mingla-business/app.config.ts` contains `"./plugins/withGooglePodsModularHeaders"`.
2. `mingla-business/plugins/withGooglePodsModularHeaders.js` exists and contains `:modular_headers => true` AND each of the literal pod names `GoogleUtilities`, `RecaptchaInterop`, `AppCheckCore`.

**Fails-on-revert proof (REQUIRED):** deleting the plugin registration line from `app.config.ts` (or the directives from the plugin) MUST make the gate FAIL; restoring it MUST make it PASS. The implementor records both states in the implementation report.

**Protective comment:** the plugin's header comment (shown in §4.1) explains WHY (the AppCheckCore Swift-pod static-library break) so a future editor doesn't "clean it up."

---

## 10. Open questions

- **OQ-1 (anchor confirmation):** the plugin anchors on `use_expo_modules!` (primary) with a `target ... do` fallback. The implementor should confirm against the actually-generated SDK 54 Podfile at step 4; the dual-anchor + fail-soft design means even an unexpected layout cannot corrupt the Podfile, but the primary anchor should be confirmed present so the injection lands inside the target. No blocker — just a confirm-at-implement.
- **OQ-2 (cloud gate ownership):** SC-4/T-6 burns ~35 min of EAS minutes. Confirm with Seth which profile to spend it on — recommended `development` (cheapest, dev-client, and it's what ORCH-1119 needs next). No code dependency.

(Neither OQ blocks IMPLEMENT; both are confirm-at-build.)

## 11. Downstream routing

**Next = mingla-implementor.** Build per §4/§8 in the worktree `~/Desktop/mingla-orchs/ORCH-1129-[ios-build-modular-headers]` (branch `ORCH-1129-ios-build-modular-headers`); rebase on origin/main first. Produce the plugin + registration + gate, prove SC-2/SC-3 locally + fails-on-revert (§9), write the implementation report. **Then = mingla-tester** for SC-4/T-6 (the GREEN EAS iOS `development` cloud build clearing Install pods — the load-bearing gate; local cannot prove it). **Then = orchestrator CLOSE** — merge to **main** (unblocks team-wide iOS builds + ORCH-1119's device build; reference COMMS-0030 and resolve it on close), flip `I-PROPOSED-IOS-GOOGLE-PODS-MODULAR-HEADERS` ACTIVE, and register the `app-mobile/` parallel fix (DISC-1129-A).

---

## Scoped allowlist + DO-NOT-TOUCH

**ALLOWLIST (implementor may change ONLY these):**
- `mingla-business/plugins/withGooglePodsModularHeaders.js` (NEW)
- `mingla-business/app.config.ts` (add one plugins-array line + the grouped comment)
- the new regression-gate test file (+ optional T-3..T-5 unit test file) under `mingla-business/`'s test location

**DO-NOT-TOUCH:**
- `mingla-business/plugins/withIosFmtConsteval.js`, `withAndroidBracketSafeCmake.js`, `withAdiRegistration.js` (disjoint; leave intact)
- `package.json` / `package-lock.json` (no dependency change — `@expo/config-plugins` already resolves transitively)
- `eas.json`, any app source, `app-mobile/`, any DB/edge/migration
- No `use_modular_headers!` global, no `expo-build-properties`/`useFrameworks` edits

Touching anything outside the allowlist → STOP and request a SPEC amendment (`SPEC_AMENDMENT_ORCH-1129_*.md`); never silently widen.
