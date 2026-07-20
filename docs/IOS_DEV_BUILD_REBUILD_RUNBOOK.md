# iOS Dev-Build Rebuild Runbook (mingla-business)

**Purpose:** when the simulator's installed dev build is stale or you've made native-affecting changes, this runbook produces a fresh, signed, framework-embedded `.app` on the booted iPhone simulator without fighting `npx expo run:ios`.

**Why this exists:** ORCH-0823 (2026-05-13) burned ~30 minutes discovering and assembling this recipe. `npx expo run:ios` (Expo SDK 54 + Xcode 26) misroutes the simulator UDID through `devicectl` and demands physical-device code-signing. CLI `xcodebuild` works but skips the Pods "Embed Pods Frameworks" run-script phase, leaving the `.app` without OneSignal / AppsFlyer / React frameworks → dyld crash on launch. Manually re-signing is also required because the embed step invalidates the bundle signature.

**Scope:** mingla-business iOS simulator dev build. Same shape works for app-mobile if the workspace name and bundle id are swapped.

**Operator vs orchestrator:** orchestrator can run this end-to-end. Operator only needs to sign in to the app once it launches.

---

## Pre-flight

```bash
# 1. Confirm a simulator is booted
xcrun simctl list devices booted

# 2. Confirm Metro is running on :8081 (or start it)
lsof -i :8081 | head -3
# If not running, start it (kills cached state):
cd /Users/sethogieva/Desktop/mingla-main/mingla-business
nohup npx expo start --dev-client --clear --port 8081 > /tmp/metro.log 2>&1 &

# 3. Confirm pods are installed
ls /Users/sethogieva/Desktop/mingla-main/mingla-business/ios/Pods/Target\ Support\ Files/Pods-minglabusiness/
```

---

## The recipe (paste into a single bash block)

Sets all env vars correctly so the embed-frameworks script + codesign work first try. Targets the booted simulator (replace UDID if different).

```bash
cd /Users/sethogieva/Desktop/mingla-main/mingla-business/ios

# 1. Build (uses default Xcode DerivedData — DO NOT use --derivedDataPath build,
#    that breaks the embed-frameworks script's path resolution)
xcodebuild \
  -workspace minglabusiness.xcworkspace \
  -scheme minglabusiness \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=17091E60-C3B6-4167-980D-60C348E177F6" \
  build

# 2. Locate the built app
APP=$(find ~/Library/Developer/Xcode/DerivedData -name "minglabusiness.app" -type d -path "*Debug-iphonesimulator*" 2>/dev/null | head -1)
echo "App: $APP"

# 3. Embed Pods frameworks manually (Xcode runs this as a build phase; CLI doesn't)
XCODE_VER=$(xcodebuild -version | head -1 | awk '{print $2}' | cut -d. -f1)
CONFIG_DIR=$(dirname "$APP")

export CONFIGURATION_BUILD_DIR="$CONFIG_DIR"
export BUILT_PRODUCTS_DIR="$CONFIG_DIR"
export FRAMEWORKS_FOLDER_PATH="minglabusiness.app/Frameworks"
export PODS_XCFRAMEWORKS_BUILD_DIR="$CONFIG_DIR/XCFrameworkIntermediates"
export TOOLCHAIN_DIR="/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain"
export PLATFORM_NAME=iphonesimulator
export SRCROOT="/Users/sethogieva/Desktop/mingla-main/mingla-business/ios"
export TARGET_BUILD_DIR="$CONFIG_DIR"
export CONFIGURATION=Debug
export ACTION=install
export EXPANDED_CODE_SIGN_IDENTITY="-"
export EXPANDED_CODE_SIGN_IDENTITY_NAME="-"
export ARCHS=arm64
export VALID_ARCHS="arm64 x86_64"
export CODE_SIGNING_REQUIRED=NO
export CODE_SIGNING_ALLOWED=NO
export XCODE_VERSION_MAJOR=$(printf "%04d" $XCODE_VER)
export EFFECTIVE_PLATFORM_NAME="-iphonesimulator"

rm -rf "$APP/Frameworks/"
bash "Pods/Target Support Files/Pods-minglabusiness/Pods-minglabusiness-frameworks.sh" 2>&1 | tail -3

# 4. Re-sign frameworks + dylibs + binary + app bundle (embed step invalidates signature)
for f in "$APP/Frameworks/"*.framework; do
  codesign --force --sign - "$f" >/dev/null 2>&1
done
codesign --force --sign - "$APP/minglabusiness.debug.dylib" >/dev/null 2>&1
codesign --force --sign - "$APP/minglabusiness" >/dev/null 2>&1
codesign --force --sign - "$APP" >/dev/null 2>&1

# 5. Reinstall + launch
xcrun simctl terminate booted com.sethogieva.minglabusiness 2>/dev/null
xcrun simctl uninstall booted com.sethogieva.minglabusiness 2>/dev/null
xcrun simctl install booted "$APP"
xcrun simctl launch booted com.sethogieva.minglabusiness

# 6. Wait for the dev launcher to come up, then connect to Metro
sleep 12
xcrun simctl openurl booted "exp+mingla-business://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"

# 7. Wait for JS bundle, then dismiss the dev menu sheet
sleep 25
osascript -e 'tell application "Simulator" to activate' >/dev/null 2>&1
osascript -e 'tell application "System Events" to keystroke "d" using {command down}' >/dev/null 2>&1
sleep 3

# 8. Confirm app is up
xcrun simctl io booted screenshot /tmp/app-state.png
```

After step 8, the app should be on its first user-visible screen (sign-in if not authed, Home tab if already signed in).

---

## Symptoms the runbook fixes

| Symptom | Root cause |
|---|---|
| `npx expo run:ios` fails with `No code signing certificates are available` | Expo CLI v54 + Xcode 26 devicectl version mismatch routes simulator UDID to physical-device path |
| App launch returns a PID but app doesn't appear; crash log says `Library not loaded: @rpath/OneSignalCore.framework/OneSignalCore` | CLI `xcodebuild` doesn't run the Pods "Embed Pods Frameworks" run-script phase. Step 3 fixes. |
| App launch returns a PID but app doesn't appear; crash log says `Library not loaded: @rpath/minglabusiness.debug.dylib` | Step 3 invalidated the bundle signature. Step 4 fixes. |
| Install denied with `SBMainWorkspace` error and no crash log | Same as above — bundle signature mismatch. Step 4 fixes. |
| App boots but immediately throws `TurboModuleRegistry.getEnforcing(...): 'OneSignal' could not be found` (or AppsFlyer, etc.) | Installed binary predates the native module being linked. Step 1 (rebuild) fixes. |
| Metro bundler reports `Unable to resolve module react-native-appsflyer` (or any installed package) | Stale Metro module-graph cache. Restart Metro with `npx expo start --clear`. |
| App opens to Expo Dev Launcher with `Development Servers` list, doesn't auto-connect | Step 6 deep-link triggers connection. Step 7 dismisses the dev menu sheet that appears after first connection. |
| First post-rebuild test result looks suspicious (e.g. autocorrect appears active when source has `autoCorrect: false`) | Old JS bundle still cached. Force a hard reload: `osascript -e 'tell application "System Events" to keystroke "r" using {command down}'` AND verify a known-distinguishable value before trusting test results. |

---

## Verification — before declaring the rebuild successful

Don't trust "the app is up" alone. Verify the JS bundle reflects current source:

```bash
# Confirm Metro served a fresh bundle
curl -s "http://localhost:8081/status" | head -1   # expect: packager-status:running

# Confirm app process is alive
xcrun simctl spawn booted launchctl list | grep mingla
```

For test runs that depend on a specific JS-side value reaching native (e.g. ORCH-0823's `autoCapitalize: "none"` flag), explicitly verify by either (a) reading the value through the simulator's accessibility hierarchy with `~/.maestro/bin/maestro --device <UDID> hierarchy | grep <attribute>`, or (b) running a behavioral test that's guaranteed-distinguishable from the previous build (e.g. type a known autocorrect-near-miss word and confirm no suggestion bubble).

---

## When NOT to use this runbook

- **Production builds:** use `eas build --profile production` instead.
- **Android:** different toolchain. Different runbook needed.
- **Native dependency just added (e.g. new expo plugin):** run `cd ios && pod install` first, THEN this runbook.
- **Just a JS change:** Metro fast-refresh handles it. Hard-reload (Cmd+R in sim) if state seems stuck. No rebuild needed unless you see TurboModuleRegistry errors.

---

## Sibling: dev-tooling ORCH candidates

This runbook documents workarounds, not fixes. Worth filing separate ORCHs to:

1. **Track the Expo CLI v54 + Xcode 26 devicectl regression upstream** (Expo issue tracker; may be fixed in a future Expo SDK).
2. **Investigate why CLI `xcodebuild` skips the Pods embed-frameworks phase** — should run as part of the `Pods-minglabusiness` target's build phases. May be a Cocoapods + Xcode 26 interaction.
3. **Investigate codesign invalidation** — `--force --deep` should propagate but doesn't reach the inner `.debug.dylib` automatically.

Until any of those upstream/internal fixes land, this runbook is the source of truth.

---

**Codified:** 2026-05-13 by ORCH-0823 close. Runbook owner: orchestrator (Claude or Codex). Update via separate dev-tooling ORCH if any step changes.
