/**
 * ORCH-1129 [iOS build modular headers] — IMPLEMENTOR happy-path regression gate.
 *
 * The team-wide iOS build break (COMMS-0030): GoogleSignIn 9.x → AppCheckCore
 * (Swift pod) imports GoogleUtilities + RecaptchaInterop, which lack module maps;
 * under static libraries + New Architecture CocoaPods aborts `pod install`. The
 * fix is a config plugin (`withGooglePodsModularHeaders.js`) that injects targeted
 * `:modular_headers => true` for those three pods into the CNG Podfile, plus its
 * registration in `app.config.ts`.
 *
 * SC-4 (a GREEN EAS iOS cloud build clearing Install pods) is NOT provable here —
 * local prebuild succeeds, only the cloud build reproduces the bug. That gate is
 * owned by the tester/Seth. This file is the STRUCTURAL safeguard (§9): it locks
 * the plugin + directives + registration in source so a future build-config edit
 * can't silently drop them and re-break all iOS builds team-wide.
 *
 * Fails-on-revert: deleting the plugin registration from app.config.ts, or the
 * `:modular_headers => true` directives / pod names from the plugin, makes the
 * relevant assertions below FAIL.
 *
 * [TEST-MOD-APPROVED ORCH-1129]
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BUSINESS_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_PATH = path.join(
  BUSINESS_ROOT,
  "plugins",
  "withGooglePodsModularHeaders.js",
);
const APP_CONFIG_PATH = path.join(BUSINESS_ROOT, "app.config.ts");

const REQUIRED_PODS = ["GoogleUtilities", "RecaptchaInterop", "AppCheckCore"];

describe("ORCH-1129 iOS Google-pods modular-headers gate", () => {
  // ---- T-1: plugin registered in app.config.ts -----------------------------
  test("T-1 — app.config.ts registers ./plugins/withGooglePodsModularHeaders", () => {
    const appConfig = fs.readFileSync(APP_CONFIG_PATH, "utf8");
    expect(appConfig).toContain('"./plugins/withGooglePodsModularHeaders"');
  });

  // ---- T-2: plugin file emits all 3 :modular_headers directives ------------
  // The plugin builds the directive lines via template interpolation
  // (`pod '${p}', :modular_headers => true`), so the source carries the
  // `:modular_headers => true` fragment + each pod NAME, and the template
  // shape — not the fully-expanded literal (that's asserted on generated
  // output in T-3). Assert all three present so a future edit that drops the
  // directive or a pod name fails the gate.
  test("T-2 — plugin file exists and carries :modular_headers => true for all 3 pods", () => {
    expect(fs.existsSync(PLUGIN_PATH)).toBe(true);
    const plugin = fs.readFileSync(PLUGIN_PATH, "utf8");
    expect(plugin).toContain(":modular_headers => true");
    expect(plugin).toContain("pod '${p}', :modular_headers => true");
    for (const pod of REQUIRED_PODS) {
      expect(plugin).toContain(`"${pod}"`);
    }
  });

  // ---- Behavior (T-3..T-5): drive the real exported plugin against fixtures -
  // Build a CNG-shaped fixture Podfile in a temp dir, run the plugin's inner
  // withDangerousMod callback against it, and assert the resulting file. This
  // exercises the real injection/idempotency/fail-soft logic, not just strings.

  type DangerousMod = (
    config: unknown,
    mod: [string, (cfg: { modRequest: { platformProjectRoot: string } }) => unknown],
  ) => unknown;

  function loadPluginCallback(): (cfg: {
    modRequest: { platformProjectRoot: string };
  }) => unknown {
    let captured:
      | ((cfg: { modRequest: { platformProjectRoot: string } }) => unknown)
      | undefined;
    jest.resetModules();
    jest.doMock("@expo/config-plugins", () => ({
      withDangerousMod: ((_config, [, cb]) => {
        captured = cb;
        return _config;
      }) as DangerousMod,
    }));
    // Dynamic require AFTER jest.doMock so the plugin binds the mocked
    // withDangerousMod (capturing its inner callback). Top-level import would
    // bind the real module before the mock is installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require("../../plugins/withGooglePodsModularHeaders.js");
    plugin({});
    jest.dontMock("@expo/config-plugins");
    if (!captured) {
      throw new Error("plugin did not register a withDangerousMod callback");
    }
    return captured;
  }

  function withTempPodfile(
    contents: string,
    run: (dir: string, podfilePath: string) => void,
  ): void {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch1129-"),
    );
    const podfilePath = path.join(dir, "Podfile");
    try {
      fs.writeFileSync(podfilePath, contents);
      run(dir, podfilePath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const CNG_PODFILE = [
    "require File.join(File.dirname(`node --print \"require.resolve('expo/package.json')\"`), 'scripts/autolinking')",
    "platform :ios, '15.1'",
    "",
    "target 'minglabusiness' do",
    "  use_expo_modules!",
    "  config = use_native_modules!",
    "  use_react_native!(:path => config[:reactNativePath])",
    "  post_install do |installer|",
    "    react_native_post_install(",
    "      installer,",
    "    )",
    "  end",
    "end",
    "",
  ].join("\n");

  test("T-3 — injects the 3 pods ABOVE use_expo_modules!, inside the target", () => {
    const cb = loadPluginCallback();
    withTempPodfile(CNG_PODFILE, (dir, podfilePath) => {
      cb({ modRequest: { platformProjectRoot: dir } });
      const out = fs.readFileSync(podfilePath, "utf8");
      for (const pod of REQUIRED_PODS) {
        expect(out).toContain(`pod '${pod}', :modular_headers => true`);
      }
      // Each directive lands above use_expo_modules! ...
      const useExpoIdx = out.indexOf("use_expo_modules!");
      for (const pod of REQUIRED_PODS) {
        expect(out.indexOf(`pod '${pod}'`)).toBeLessThan(useExpoIdx);
      }
      // ... and below the target line (i.e. inside the target block).
      const targetIdx = out.indexOf("target 'minglabusiness' do");
      expect(targetIdx).toBeGreaterThanOrEqual(0);
      expect(out.indexOf("pod 'GoogleUtilities'")).toBeGreaterThan(targetIdx);
    });
  });

  test("T-4 — idempotent: applying twice does not duplicate the block", () => {
    const cb = loadPluginCallback();
    withTempPodfile(CNG_PODFILE, (dir, podfilePath) => {
      cb({ modRequest: { platformProjectRoot: dir } });
      cb({ modRequest: { platformProjectRoot: dir } });
      const out = fs.readFileSync(podfilePath, "utf8");
      const markerCount = out.split("ORCH-1129 modular headers").length - 1;
      expect(markerCount).toBe(1);
      const podCount =
        out.split("pod 'GoogleUtilities', :modular_headers => true").length - 1;
      expect(podCount).toBe(1);
    });
  });

  test("T-5 — fail-soft: no anchor → Podfile unchanged, no throw", () => {
    const cb = loadPluginCallback();
    const noAnchor = "platform :ios, '15.1'\n# no target, no use_expo_modules\n";
    withTempPodfile(noAnchor, (dir, podfilePath) => {
      expect(() => cb({ modRequest: { platformProjectRoot: dir } })).not.toThrow();
      expect(fs.readFileSync(podfilePath, "utf8")).toBe(noAnchor);
    });
  });

  test("T-5b — missing Podfile → no throw, returns cfg", () => {
    const cb = loadPluginCallback();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch1129-"));
    try {
      expect(() =>
        cb({ modRequest: { platformProjectRoot: dir } }),
      ).not.toThrow();
      expect(fs.existsSync(path.join(dir, "Podfile"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
