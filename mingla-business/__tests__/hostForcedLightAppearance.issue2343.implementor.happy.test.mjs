// Issue #2343 — implementor happy-path regression guard.
//
// Host implements one fixed native composition, not a complete adaptive theme.
// The release regression declared `automatic`, so Android followed device Dark
// while React kept white auth surfaces; the logo and dark labels/icons became
// invisible. The explicit dark splash block must remain for #2050, so a Host-
// local Info.plist owner executes after splash and restores the final Light trait.
//
// This suite has no package dependency. It reads the real source/config, executes
// the plugin's pure helper, inventories the real Host picker call sites, and pins
// the explicit CI-batch registration so none of these assertions can go dark.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUSINESS_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");
const APP_JSON = path.join(BUSINESS_ROOT, "app.json");
const APPEARANCE_PLUGIN = path.join(
  BUSINESS_ROOT,
  "plugins/withForcedLightAppearance.js",
);
const PAYMENT_PLAN = path.join(
  BUSINESS_ROOT,
  "src/components/trip/PaymentPlanEditor.tsx",
);
const CI_MANIFEST = path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json");
const IMPLEMENTOR_SUITE =
  "__tests__/hostForcedLightAppearance.issue2343.implementor.happy.test.mjs";
const TESTER_SUITE =
  "__tests__/hostForcedLightAppearance.issue2343.tester.adversarial.test.mjs";
const require = createRequire(import.meta.url);

const read = (file) => fs.readFileSync(file, "utf8");

function maskComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
}

function extractElements(source, tag) {
  const elements = [];
  const opening = `<${tag}`;
  let cursor = 0;

  while ((cursor = source.indexOf(opening, cursor)) !== -1) {
    const boundary = source[cursor + opening.length];
    if (!/[\s/>]/.test(boundary)) {
      cursor += opening.length;
      continue;
    }

    let braceDepth = 0;
    let quote = null;
    let scan = cursor + opening.length;
    let end = -1;

    while (scan < source.length) {
      const current = source[scan];
      const next = source[scan + 1];
      if (quote !== null) {
        if (current === "\\") {
          scan += 2;
          continue;
        }
        if (current === quote) quote = null;
        scan += 1;
        continue;
      }
      if (current === "/" && next === "*") {
        const close = source.indexOf("*/", scan + 2);
        scan = close === -1 ? source.length : close + 2;
        continue;
      }
      if (current === "/" && next === "/") {
        const newline = source.indexOf("\n", scan);
        scan = newline === -1 ? source.length : newline + 1;
        continue;
      }
      if (current === '"' || current === "'" || current === "`") {
        quote = current;
        scan += 1;
        continue;
      }
      if (current === "{") {
        braceDepth += 1;
        scan += 1;
        continue;
      }
      if (current === "}") {
        braceDepth -= 1;
        scan += 1;
        continue;
      }
      if (braceDepth === 0 && current === "/" && next === ">") {
        end = scan + 2;
        break;
      }
      scan += 1;
    }

    assert.notEqual(end, -1, `unterminated <${tag}> at offset ${cursor}`);
    elements.push({
      text: source.slice(cursor, end),
      line: source.slice(0, cursor).split("\n").length,
    });
    cursor = end;
  }

  return elements;
}

function attribute(element, name) {
  const marker = new RegExp(`(?:^|\\s)${name}\\s*=\\s*`).exec(element);
  if (marker === null) return null;
  const start = marker.index + marker[0].length;
  const first = element[start];

  if (first === '"' || first === "'") {
    const close = element.indexOf(first, start + 1);
    assert.notEqual(close, -1, `unterminated ${name} literal`);
    return {
      literal: true,
      value: element.slice(start + 1, close),
      raw: element.slice(start, close + 1),
    };
  }

  if (first === "{") {
    let depth = 0;
    let cursor = start;
    for (; cursor < element.length; cursor += 1) {
      if (element[cursor] === "{") depth += 1;
      if (element[cursor] === "}") {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
      }
    }
    return {
      literal: false,
      value: element.slice(start + 1, cursor - 1).trim(),
      raw: element.slice(start, cursor),
    };
  }

  return null;
}

function productSourceFiles() {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "__tests__" ||
          entry.name === "__fixtures__"
        ) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
      if (/\.(test|spec)\./.test(entry.name)) continue;
      files.push(full);
    }
  };
  walk(path.join(BUSINESS_ROOT, "app"));
  walk(path.join(BUSINESS_ROOT, "src"));
  return files;
}

function pickerRegistry() {
  const sites = [];
  for (const file of productSourceFiles()) {
    const source = read(file);
    if (!source.includes("<DateTimePicker")) continue;
    for (const element of extractElements(
      maskComments(source),
      "DateTimePicker",
    )) {
      const display = attribute(element.text, "display");
      const relativeFile = path.relative(REPO_ROOT, file);
      assert.ok(
        display,
        `${relativeFile}:${element.line} has no display prop; #2343 cannot classify its native reach`,
      );
      const androidOnly = display.literal && display.value === "default";
      sites.push({
        file: relativeFile,
        line: element.line,
        androidOnly,
        display,
        themeVariant: attribute(element.text, "themeVariant"),
        textColor: attribute(element.text, "textColor"),
      });
    }
  }
  return sites;
}

test("Host declares fixed Light and keeps the 1.1.6 runtime/version contract", () => {
  const config = JSON.parse(read(APP_JSON)).expo;
  assert.equal(config.userInterfaceStyle, "light");
  assert.equal(config.version, "1.1.6");
  assert.deepEqual(config.ios.runtimeVersion, { policy: "appVersion" });
  assert.deepEqual(config.android.runtimeVersion, { policy: "appVersion" });
});

test("the Host plist owner runs after splash and preserves unrelated keys", () => {
  const config = JSON.parse(read(APP_JSON)).expo;
  const plugins = config.plugins;
  const ownerIndexes = plugins
    .map((plugin, index) => [plugin, index])
    .filter(([plugin]) => plugin === "./plugins/withForcedLightAppearance")
    .map(([, index]) => index);
  const splashIndex = plugins.findIndex(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  );

  assert.equal(
    ownerIndexes.length,
    1,
    "Host must register exactly one final Light owner",
  );
  assert.notEqual(splashIndex, -1, "Host splash registration must exist");
  assert.ok(
    ownerIndexes[0] < splashIndex,
    "the owner must be listed before splash so reverse-order Info.plist mods leave Light final",
  );
  assert.ok(
    fs.existsSync(APPEARANCE_PLUGIN),
    "the configured Host plugin must exist",
  );

  const { forceLightAppearance } = require(APPEARANCE_PLUGIN);
  assert.equal(typeof forceLightAppearance, "function");
  const plist = forceLightAppearance({
    UIUserInterfaceStyle: "Automatic",
    UntouchedEntitlementAdjacentKey: "preserved",
  });
  assert.deepEqual(plist, {
    UIUserInterfaceStyle: "Light",
    UntouchedEntitlementAdjacentKey: "preserved",
  });
});

test("#2050 Host splash identity stays explicit and unchanged in both appearances", () => {
  const plugins = JSON.parse(read(APP_JSON)).expo.plugins;
  const splashEntry = plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  );
  assert.ok(splashEntry, "Host splash registration must exist");
  assert.deepEqual(splashEntry[1], {
    image: "./assets/images/splash-icon.png",
    imageWidth: 240,
    resizeMode: "contain",
    backgroundColor: "#eb7825",
    dark: { backgroundColor: "#eb7825" },
  });
});

test("every iOS-reachable Host DateTimePicker explicitly owns its appearance", () => {
  const sites = pickerRegistry();
  assert.ok(
    sites.length >= 18,
    `expected at least 18 real Host picker call sites; found ${sites.length}`,
  );
  assert.ok(
    sites.some((site) => site.androidOnly),
    "the Android-only exemption must be exercised by at least one real picker",
  );
  assert.ok(
    sites.some((site) => !site.androidOnly),
    "the iOS containment branch must inspect at least one real picker",
  );

  const unthemed = sites
    .filter((site) => !site.androidOnly && site.themeVariant === null)
    .map((site) => `${site.file}:${site.line}`);
  assert.deepEqual(
    unthemed,
    [],
    `iOS-reachable Host pickers must declare their local appearance:\n${unthemed.join("\n")}`,
  );
});

test("PaymentPlanEditor pins its inline iOS picker to the established dark composition", () => {
  const elements = extractElements(read(PAYMENT_PLAN), "DateTimePicker");
  assert.equal(
    elements.length,
    1,
    "PaymentPlanEditor must retain one native picker owner",
  );
  const picker = elements[0].text;
  assert.equal(
    attribute(picker, "display")?.value,
    'Platform.OS === "ios" ? "inline" : "default"',
  );
  assert.deepEqual(attribute(picker, "themeVariant"), {
    literal: true,
    value: "dark",
    raw: '"dark"',
  });
  assert.equal(attribute(picker, "textColor")?.value, "textTokens.primary");
  assert.match(picker, /minimumDate=\{new Date\(`/);
  assert.match(picker, /onChange=\{onDateChange\(inst\.ordinal\)\}/);
});

test("CI names both #2343 suites explicitly and reconciles its suite counter", () => {
  const manifest = JSON.parse(read(CI_MANIFEST));
  assert.equal(manifest.expectedSuites, manifest.suites.length);
  const suites = manifest.suites.filter(
    (suite) => suite.id === "issue-2343-host-forced-light-appearance-tests",
  );
  assert.equal(
    suites.length,
    1,
    "#2343 must have exactly one CI-batch registration",
  );
  assert.equal(suites[0].class, "node20-noinstall");
  assert.equal(suites[0].steps.length, 1);
  const command = suites[0].steps[0].run;
  assert.match(command, /^node --test /);
  assert.ok(command.includes(IMPLEMENTOR_SUITE));
  assert.ok(command.includes(TESTER_SUITE));
  assert.doesNotMatch(command, /[*?{}[\]]/);
});
