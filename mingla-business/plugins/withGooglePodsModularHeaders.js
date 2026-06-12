const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Copyright Mingla. ORCH-1129.
//
// The Google Sign-In pod chain
// (@react-native-google-signin/google-signin → GoogleSignIn ~> 9.0 →
// AppCheckCore ~> 11.x) pulls in the Swift pod `AppCheckCore`, which imports
// `GoogleUtilities` and `RecaptchaInterop` — two ObjC pods that don't define
// module maps. Under this project's static-libraries + New-Architecture config,
// CocoaPods refuses to integrate a Swift pod whose deps lack module maps and
// aborts `pod install`:
//   [!] The Swift pod `AppCheckCore` depends upon `GoogleUtilities` and
//   `RecaptchaInterop`, which do not define modules ... set
//   `use_modular_headers!` ... `pod install exited with non-zero code: 1`
// Every fresh EAS iOS build since ~2026-05-30 died at the Install pods phase
// because of this (COMMS-0030). Forcing TARGETED `:modular_headers => true` for
// exactly these three pods generates the module maps CocoaPods needs, keeping
// the rest of the graph as static libraries (NOT a global `use_modular_headers!`
// — that would force module maps on every pod and risk new conflicts).
//
// This is a compile-time header-import change only; no runtime/binary behavior
// change. AppCheckCore is included defensively so the directive survives any
// future re-classification once its leaves are modularized.
//
// Because `mingla-business/ios` is gitignored (Expo CNG), this must live as a
// config plugin so it is re-applied on every `expo prebuild` / cloud build
// rather than as a hand-edit of the generated Podfile. Sibling of
// `withIosFmtConsteval.js`. Do NOT remove without re-proving a GREEN EAS iOS
// build (see SPEC_ORCH-1129).

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
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        "Podfile",
      );
      if (!fs.existsSync(podfilePath)) {
        return cfg;
      }
      let contents = fs.readFileSync(podfilePath, "utf8");

      // Idempotent: skip if already applied.
      if (contents.includes(MARKER)) {
        return cfg;
      }

      // `:modular_headers` is a pod-declaration-time directive consumed during
      // dependency resolution, so it must precede resolution. Inject the block
      // immediately ABOVE the `use_expo_modules!` line (primary anchor — inside
      // the app target block, before pods resolve).
      const expoAnchor = "use_expo_modules!";
      const expoIdx = contents.indexOf(expoAnchor);
      if (expoIdx !== -1) {
        const lineStart = contents.lastIndexOf("\n", expoIdx) + 1;
        contents =
          contents.slice(0, lineStart) + BLOCK + contents.slice(lineStart);
      } else {
        // Secondary anchor: immediately AFTER the `target '<name>' do` line.
        const m = contents.match(/^target ['"][^'"]+['"] do[^\n]*\n/m);
        if (!m) {
          // No anchor found — leave the Podfile untouched (fail-soft). Surfaces
          // as the original pod error, never a corrupt Podfile.
          return cfg;
        }
        const insertAt = m.index + m[0].length;
        contents =
          contents.slice(0, insertAt) + BLOCK + contents.slice(insertAt);
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);

module.exports = withGooglePodsModularHeaders;
