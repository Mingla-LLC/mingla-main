// Issue #2343 — independent tester adversarial regression guard.
//
// The implementor suite checks the raw app.json declaration and the exported
// pure helper. This suite attacks the two seams around those checks: the
// dynamic app.config wrapper that EAS actually resolves, and the config-plugin
// callback that Expo actually invokes. It also protects the explicitly scoped
// ShareModal Light branch and PaymentPlan web/native split.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUSINESS_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");
const APP_JSON = path.join(BUSINESS_ROOT, "app.json");
const CONSUMER_APP_JSON = path.join(REPO_ROOT, "app-mobile/app.json");
const APP_CONFIG = path.join(BUSINESS_ROOT, "app.config.js");
const APPEARANCE_PLUGIN = path.join(
  BUSINESS_ROOT,
  "plugins/withForcedLightAppearance.js",
);
const PAYMENT_PLAN = path.join(
  BUSINESS_ROOT,
  "src/components/trip/PaymentPlanEditor.tsx",
);
const SHARE_MODAL = path.join(
  BUSINESS_ROOT,
  "src/components/ui/ShareModalContent.tsx",
);
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(file, "utf8");

function resolvedHostConfig() {
  const raw = JSON.parse(read(APP_JSON)).expo;
  const configure = require(APP_CONFIG);
  assert.equal(
    typeof configure,
    "function",
    "app.config must export a function",
  );
  return configure({ config: structuredClone(raw) });
}

function pluginName(plugin) {
  if (typeof plugin === "string") return plugin;
  if (Array.isArray(plugin)) return plugin[0];
  return null;
}

function loadPluginWithInfoPlistSpy() {
  const source = read(APPEARANCE_PLUGIN);
  const module = { exports: {} };
  let callbackCount = 0;
  const sandbox = {
    module,
    exports: module.exports,
    require(specifier) {
      assert.equal(
        specifier,
        "@expo/config-plugins",
        `unexpected plugin dependency ${specifier}`,
      );
      return {
        withInfoPlist(config, callback) {
          callbackCount += 1;
          return callback(config);
        },
      };
    },
  };
  vm.runInNewContext(source, sandbox, { filename: APPEARANCE_PLUGIN });
  return {
    plugin: module.exports,
    callbackCount: () => callbackCount,
  };
}

test("resolved EAS-facing config cannot drop or reorder the final Light owner", () => {
  const config = resolvedHostConfig();
  const consumerConfig = JSON.parse(read(CONSUMER_APP_JSON)).expo;
  assert.equal(config.userInterfaceStyle, "light");
  assert.match(config.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(config.version, consumerConfig.version);
  assert.deepEqual(config.ios.runtimeVersion, { policy: "appVersion" });
  assert.deepEqual(config.android.runtimeVersion, { policy: "appVersion" });

  const ownerIndexes = config.plugins
    .map((plugin, index) => [pluginName(plugin), index])
    .filter(([name]) => name === "./plugins/withForcedLightAppearance")
    .map(([, index]) => index);
  const splashIndex = config.plugins.findIndex(
    (plugin) => pluginName(plugin) === "expo-splash-screen",
  );

  assert.deepEqual(ownerIndexes, [splashIndex - 1]);
  assert.ok(splashIndex > 0, "resolved config must retain the splash plugin");
});

test("the real plugin entry point repairs a hostile late Automatic plist in place", () => {
  const { plugin, callbackCount } = loadPluginWithInfoPlistSpy();
  assert.equal(typeof plugin, "function");

  const modResults = {
    UIUserInterfaceStyle: "Automatic",
    CFBundleDisplayName: "Mingla Host",
    NSCameraUsageDescription: "preserve me",
  };
  const config = { modResults, sentinel: "preserved" };
  const output = plugin(config);

  assert.equal(
    callbackCount(),
    1,
    "the default export must register one plist mod",
  );
  assert.equal(
    output,
    config,
    "the plugin must preserve the Expo config object",
  );
  assert.equal(
    output.modResults,
    modResults,
    "the plist object must stay intact",
  );
  assert.deepEqual(output, {
    modResults: {
      UIUserInterfaceStyle: "Light",
      CFBundleDisplayName: "Mingla Host",
      NSCameraUsageDescription: "preserve me",
    },
    sentinel: "preserved",
  });
});

test("reverse Expo mod execution leaves Light final, and the forbidden order does not", () => {
  const config = resolvedHostConfig();
  const relevant = config.plugins.filter((entry) => {
    const name = pluginName(entry);
    return (
      name === "./plugins/withForcedLightAppearance" ||
      name === "expo-splash-screen"
    );
  });
  assert.equal(relevant.length, 2);

  const executeReverse = (entries) => {
    const state = { modResults: { UIUserInterfaceStyle: "Unspecified" } };
    for (const entry of [...entries].reverse()) {
      const name = pluginName(entry);
      if (name === "expo-splash-screen") {
        state.modResults.UIUserInterfaceStyle = "Automatic";
      } else {
        loadPluginWithInfoPlistSpy().plugin(state);
      }
    }
    return state.modResults.UIUserInterfaceStyle;
  };

  assert.equal(executeReverse(relevant), "Light");
  assert.equal(
    executeReverse([...relevant].reverse()),
    "Automatic",
    "anti-vacuity: owner-after-splash registration would recreate the release bug",
  );
});

test("fixed native Light keeps ShareModal on its approved legible Light palette", () => {
  const source = read(SHARE_MODAL);
  assert.match(source, /const dark = useColorScheme\(\) === ['"]dark['"]/);
  // [TEST-MOD-APPROVED #4420] the light/dark pairs are Graphite tokens now
  // (Paper panel, paperEnd surface, ink text, on-paper secondary) — still a
  // Light palette under fixed native Light.
  assert.match(source, /dark \? materials\.sheet\.solidFill : color\.paper/);
  assert.match(source, /dark \? color\.card : color\.paperEnd/);
  assert.match(source, /dark \? color\.text1 : color\.ink/);
  assert.match(source, /dark \? color\.text2 : color\.onPaper\.text2/);
  assert.doesNotMatch(source, /Appearance\.setColorScheme/);
});

test("PaymentPlan containment cannot leak the native picker onto business web", () => {
  // [TEST-MOD #4523] PaymentPlanEditor no longer has a web branch and a native
  // branch: both platforms render the Host calendar DateField. Nothing native
  // can leak onto business web only while no native picker or web date input
  // is imported or rendered at all.
  const source = read(PAYMENT_PLAN);
  assert.ok(!source.includes("<DateTimePicker"), "no native picker may return to PaymentPlanEditor");
  assert.ok(!source.includes("<WebDateTimeInput"), "no web-only date input may return beside the calendar field");
  assert.ok(!source.includes("@react-native-community/datetimepicker"), "the native picker module must not be imported");
  assert.match(source, /import \{ DateField \} from "\.\.\/ui\/DateField";/);
  assert.match(source, /<DateField\b/);
});
