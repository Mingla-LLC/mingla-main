// #2322 tester-owned adversarial guard (SPEC T-3/T-4).
//
// The implementor registry asks whether iOS-capable pickers are themed at all.
// This companion pins the opposite failure class: a future "theme fix" that is
// explicit but wrong (dark/variable/undefined), or conditional Appearance logic
// that makes the light-card pixels depend on the device trait again.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(HERE, "..");
const APP_MOBILE = path.resolve(COMPONENTS, "../..");
const ONBOARDING = path.join(COMPONENTS, "OnboardingFlow.tsx");
const POST_EXPERIENCE = path.join(COMPONENTS, "PostExperienceModal.tsx");
const APP_JSON = path.join(APP_MOBILE, "app.json");
const read = (file) => fs.readFileSync(file, "utf8");

function pickerElements(source) {
  return source.match(/<DateTimePicker\b[\s\S]*?\/>/g) ?? [];
}

function onboardingDobRegion() {
  const source = read(ONBOARDING);
  const start = source.indexOf("onboarding:details.dob_label");
  const end = source.indexOf("── STEP 2 ──", start);
  assert.notEqual(start, -1, "DOB field marker must exist");
  assert.notEqual(end, -1, "onboarding step boundary must exist");
  return source.slice(start, end);
}

test("T-3: the onboarding DOB wheel pins the light tone and its own palette token", () => {
  const pickers = pickerElements(onboardingDobRegion());
  assert.equal(pickers.length, 1, "expected exactly one DOB picker in onboarding step 1");
  assert.match(pickers[0], /themeVariant\s*=\s*["']light["']/);
  assert.match(pickers[0], /textColor\s*=\s*\{colors\.text\.primary\}/);
  assert.doesNotMatch(pickers[0], /themeVariant\s*=\s*\{[^}]+\}/);
});

test("T-3: both reschedule wheels pin light with PostExperienceModal's flat palette", () => {
  const source = read(POST_EXPERIENCE);
  const regionStart = source.indexOf("[#2322]");
  assert.notEqual(regionStart, -1, "the load-bearing picker comment must exist");
  const pickers = pickerElements(source.slice(regionStart));
  assert.equal(pickers.length, 2, "expected the reschedule date and time wheels");
  for (const picker of pickers) {
    assert.match(picker, /themeVariant\s*=\s*["']light["']/);
    assert.match(picker, /textColor\s*=\s*\{colors\.gray900\}/);
    assert.doesNotMatch(picker, /themeVariant\s*=\s*\{[^}]+\}/);
  }
});

test("T-4: neither repaired component may branch picker appearance on the device", () => {
  for (const file of [ONBOARDING, POST_EXPERIENCE]) {
    const source = read(file);
    assert.doesNotMatch(source, /\buseColorScheme\b/);
    assert.doesNotMatch(source, /\bAppearance\s*\./);
    assert.doesNotMatch(source, /from\s+["']react-native["'][^;]*\bAppearance\b/);
  }
});

test("native owner is registered exactly once before splash (non-vacuous order)", () => {
  const plugins = JSON.parse(read(APP_JSON)).expo.plugins;
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
    "the forced-light owner must be present exactly once; a missing owner must not pass as index -1",
  );
  assert.notEqual(splashIndex, -1, "splash registration must exist");
  assert.ok(
    ownerIndexes[0] < splashIndex,
    "the forced-light owner must be listed before splash so its reverse-order mod executes last",
  );
});
