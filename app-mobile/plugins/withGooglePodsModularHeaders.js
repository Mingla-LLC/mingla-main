const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Copyright Mingla. ORCH-1129 / ORCH-1171 (ported from mingla-business).
//
// The Google Sign-In pod chain needs modular headers for AppCheckCore's ObjC deps.
// Without this, fresh EAS iOS builds fail at pod install (COMMS-0031).

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

      if (contents.includes(MARKER)) {
        return cfg;
      }

      const expoAnchor = "use_expo_modules!";
      const expoIdx = contents.indexOf(expoAnchor);
      if (expoIdx !== -1) {
        const lineStart = contents.lastIndexOf("\n", expoIdx) + 1;
        contents =
          contents.slice(0, lineStart) + BLOCK + contents.slice(lineStart);
      } else {
        const m = contents.match(/^target ['"][^'"]+['"] do[^\n]*\n/m);
        if (!m) {
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
