const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Copyright Mingla.
//
// Xcode 26 / Apple clang 21 cannot compile fmt 10.x's compile-time
// (`consteval`) format-string checking. The build dies in the `fmt` pod with:
//   Pods/fmt/include/fmt/format-inl.h:59:24: error: call to consteval function
//   '...basic_format_string<...>' is not a constant expression
// fmt's own `base.h` enables `FMT_USE_CONSTEVAL` for "modern" Apple clang, but
// that path is broken on this toolchain. Forcing `FMT_USE_CONSTEVAL=0` across
// every pod (so the definition is consistent in every TU that includes fmt —
// fmt, RCT-Folly, React-Core) makes fmt fall back to runtime format handling.
// This only disables a compile-time check; there is no runtime behavior change.
//
// Because `mingla-business/ios` is gitignored (Expo CNG), this must live as a
// config plugin so it is re-applied on every `expo prebuild` rather than as a
// hand-edit of the generated Podfile. Sibling of `withAndroidBracketSafeCmake`.

const FMT_MARKER = "FMT_USE_CONSTEVAL=0";

const FMT_POST_INSTALL_BLOCK = `

    # Xcode 26 / clang 21: fmt 10.x consteval format-string checking fails to
    # compile. Force FMT_USE_CONSTEVAL=0 across all pods so the definition is
    # consistent across every TU that includes fmt. Disables a compile-time
    # check only; no runtime impact. Injected by plugins/withIosFmtConsteval.js.
    installer.pods_project.targets.each do |fmt_fix_target|
      fmt_fix_target.build_configurations.each do |fmt_fix_config|
        fmt_fix_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        unless fmt_fix_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'].include?('${FMT_MARKER}')
          fmt_fix_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << '${FMT_MARKER}'
        end
      end
    end`;

const withIosFmtConsteval = (config) =>
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
      if (contents.includes(FMT_MARKER)) {
        return cfg;
      }

      // Insert the fmt fix immediately after the `react_native_post_install(...)`
      // call inside the existing `post_install do |installer|` block, so the
      // append runs after React Native has set its own pod build settings.
      const callMarker = "react_native_post_install(";
      const callIdx = contents.indexOf(callMarker);
      if (callIdx === -1) {
        // No post_install block found — leave the Podfile untouched rather than
        // guess. (Surfaces as a missing FMT_USE_CONSTEVAL=0 at build time.)
        return cfg;
      }
      // The Expo Podfile template closes this call with a line that is exactly
      // `    )` (4-space indent). Inject right after it.
      const closeToken = "\n    )";
      const closeIdx = contents.indexOf(closeToken, callIdx);
      if (closeIdx === -1) {
        return cfg;
      }
      const insertAt = closeIdx + closeToken.length;
      contents =
        contents.slice(0, insertAt) +
        FMT_POST_INSTALL_BLOCK +
        contents.slice(insertAt);

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);

module.exports = withIosFmtConsteval;
