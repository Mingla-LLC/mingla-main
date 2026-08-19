// #2322 — implementor happy-path suite.
//
// THE BUG. app-mobile/app.json declares `expo.userInterfaceStyle: "light"`, but the
// expo-splash-screen config plugin overwrites the built Info.plist
// `UIUserInterfaceStyle` to `Automatic` whenever the plugin entry carries ANY truthy
// `dark.*` key — even one that is byte-identical to the light value and therefore
// changes no pixel. Every NATIVE view then follows the DEVICE appearance. An
// <DateTimePicker> with no `themeVariant` draws UIColor.label — near-white in Dark
// Mode — onto a hard-coded light card, so the user scrolls a wheel they cannot read
// and commits a birthday they never saw. On PostExperienceModal (#FFFFFF container,
// non-dismissible, COMMS-0140) the wheels are not faint but completely invisible.
//
// TWO HALVES, DIFFERENT SHIP VEHICLES:
//   * the `themeVariant`/`textColor` props are JavaScript and reach installed users by OTA;
//   * the app.json deletion is native and only lands in the next build.
// The props must therefore be correct UNDER `Automatic` on their own. Nobody may remove
// them later on the grounds that the trait is now Light. T-1 is what enforces that.
//
// OQ-1 (Seth, 2026-08-19). Separately: opening the DOB wheel seeded
// `pendingBirthdayRef` with BIRTHDAY_PICKER_DEFAULT, so tapping Done WITHOUT
// scrolling committed 2000-01-01 as if chosen and unblocked the "Let's go" CTA.
// Done on an untouched wheel must now commit nothing.
//
// This suite runs under `node --test` with NO node_modules: it reads source and
// config off disk. T-2 asserts the app.json SHAPE (the cause) rather than shelling
// out to `expo config` (the effect), because an introspect call needs an install and
// would silently skip without one — the unfalsifiable-gate class of #2113.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE = path.resolve(HERE, "../../..");
const REPO_ROOT = path.resolve(HERE, "../../../..");

const ONBOARDING = path.join(APP_MOBILE, "src/components/OnboardingFlow.tsx");
const POST_EXPERIENCE = path.join(APP_MOBILE, "src/components/PostExperienceModal.tsx");
const APP_JSON = path.join(APP_MOBILE, "app.json");
const CI_MANIFEST = path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json");

const read = (p) => fs.readFileSync(p, "utf8");

// ── JSX helpers ────────────────────────────────────────────────────────────────
// A hand-rolled scanner rather than a parser, because this suite may not install
// anything. It tracks brace depth, string literals and comments so that `=>`, `/*`
// and a `/` inside an attribute cannot be mistaken for the element's closing `/>`.

function extractElements(source, tag) {
  const out = [];
  const open = `<${tag}`;
  let i = 0;
  while ((i = source.indexOf(open, i)) !== -1) {
    const boundary = source[i + open.length];
    if (!/[\s/>]/.test(boundary)) {
      i += open.length;
      continue;
    }
    let depth = 0;
    let quote = null;
    let j = i + open.length;
    let end = -1;
    while (j < source.length) {
      const c = source[j];
      const next = source[j + 1];
      if (quote) {
        if (c === "\\") { j += 2; continue; }
        if (c === quote) quote = null;
        j++;
        continue;
      }
      if (c === "/" && next === "*") {
        const close = source.indexOf("*/", j + 2);
        j = close === -1 ? source.length : close + 2;
        continue;
      }
      if (c === "/" && next === "/") {
        const nl = source.indexOf("\n", j);
        j = nl === -1 ? source.length : nl + 1;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; j++; continue; }
      if (c === "{") { depth++; j++; continue; }
      if (c === "}") { depth--; j++; continue; }
      if (depth === 0 && c === "/" && next === ">") { end = j + 2; break; }
      if (depth === 0 && c === ">") { end = j + 1; break; }
      j++;
    }
    assert.notEqual(end, -1, `unterminated <${tag}> element at offset ${i}`);
    out.push({
      text: source.slice(i, end),
      line: source.slice(0, i).split("\n").length,
    });
    i = end;
  }
  return out;
}

function attr(elementText, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*`);
  const m = re.exec(elementText);
  if (!m) return null;
  const k = m.index + m[0].length;
  const c = elementText[k];
  if (c === '"' || c === "'") {
    const close = elementText.indexOf(c, k + 1);
    assert.notEqual(close, -1, `unterminated ${name} literal`);
    return { literal: true, value: elementText.slice(k + 1, close), raw: elementText.slice(k, close + 1) };
  }
  if (c === "{") {
    let depth = 0;
    let j = k;
    for (; j < elementText.length; j++) {
      if (elementText[j] === "{") depth++;
      else if (elementText[j] === "}") { depth--; if (depth === 0) { j++; break; } }
    }
    return { literal: false, value: elementText.slice(k + 1, j - 1).trim(), raw: elementText.slice(k, j) };
  }
  return null;
}

function sourceFiles() {
  const roots = [path.join(APP_MOBILE, "src"), path.join(APP_MOBILE, "app")];
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // __tests__ is excluded on purpose: a test asserting on the STRING
        // "<DateTimePicker" is not a call site, and counting it would let a
        // deleted real call site hide behind a test fixture.
        if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "__fixtures__") continue;
        walk(full);
        continue;
      }
      if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
      if (/\.(test|spec)\./.test(entry.name)) continue;
      files.push(full);
    }
  };
  roots.forEach(walk);
  return files;
}

function pickerRegistry() {
  const sites = [];
  for (const file of sourceFiles()) {
    const src = read(file);
    if (!src.includes("<DateTimePicker")) continue;
    for (const el of extractElements(src, "DateTimePicker")) {
      const display = attr(el.text, "display");
      const rel = path.relative(REPO_ROOT, file);
      assert.ok(display, `${rel}:${el.line} — <DateTimePicker> with no \`display\` prop; this registry cannot classify it`);
      // Android-only iff `display` is the bare literal "default". Anything else —
      // "spinner", "inline", or a Platform ternary — can render an iOS view.
      const androidOnly = display.literal && display.value === "default";
      sites.push({
        file: rel,
        line: el.line,
        androidOnly,
        iosSpinner: !androidOnly && /spinner/.test(display.raw),
        themeVariant: attr(el.text, "themeVariant"),
        textColor: attr(el.text, "textColor"),
      });
    }
  }
  return sites;
}

// ── T-1 ────────────────────────────────────────────────────────────────────────

test("T-1: every iOS-capable <DateTimePicker> in app-mobile pins its appearance", () => {
  const unthemed = [];
  const noTextColor = [];
  for (const s of pickerRegistry()) {
    if (s.androidOnly) continue;
    if (!s.themeVariant) unthemed.push(`${s.file}:${s.line}`);
    if (s.iosSpinner && !s.textColor) noTextColor.push(`${s.file}:${s.line}`);
  }
  assert.deepEqual(
    unthemed,
    [],
    "these <DateTimePicker> call sites can render on iOS with no explicit `themeVariant`. " +
      "The built Info.plist resolves UIUserInterfaceStyle to whatever the config plugins leave " +
      "behind, so an unthemed native picker follows the DEVICE appearance and can render " +
      "near-white text on a light card (#2322). Pin it:\n  " + unthemed.join("\n  "),
  );
  assert.deepEqual(
    noTextColor,
    [],
    "these iOS spinner pickers have no explicit `textColor`. The wheel draws UIColor.label " +
      "onto the host RN view's own background, so the two can disagree (#2322):\n  " + noTextColor.join("\n  "),
  );
});

test("T-1b: the registry cannot go vacuous", () => {
  const sites = pickerRegistry();
  assert.ok(
    sites.length >= 9,
    `expected at least 9 <DateTimePicker> call sites in app-mobile, found ${sites.length}. ` +
      "A registry that finds nothing passes T-1 for free — that is the dark-gate class of #2113.",
  );
  const spinners = sites.filter((s) => s.iosSpinner);
  assert.ok(
    spinners.length >= 3,
    `expected at least 3 iOS spinner pickers, found ${spinners.length}`,
  );
  assert.ok(
    sites.some((s) => s.androidOnly),
    "expected at least one Android-only call site; if the exemption branch never fires, T-5 proves nothing",
  );
});

test("T-5: the Android-only exemption is real and narrow", () => {
  const sites = pickerRegistry();
  const androidOnly = sites.filter((s) => s.androidOnly).map((s) => `${s.file}:${s.line}`);
  const expectedExempt = [
    "app-mobile/src/components/activity/ProposeDateTimeModal.tsx",
    "app-mobile/src/components/expandedCard/ActionButtons.tsx",
    "app-mobile/src/components/expandedCard/ConsumerIntakeForm.tsx",
  ];
  for (const f of expectedExempt) {
    assert.ok(
      androidOnly.some((s) => s.startsWith(`${f}:`)),
      `${f} has a display="default" Android-only picker that must stay exempt from T-1`,
    );
  }
  // The exemption must not swallow the fixed sites.
  for (const broken of ["OnboardingFlow.tsx", "PostExperienceModal.tsx"]) {
    assert.equal(
      androidOnly.some((s) => s.includes(broken)),
      false,
      `${broken}'s pickers are iOS-capable and must NOT be classified Android-only`,
    );
  }
  assert.ok(
    androidOnly.length < sites.length,
    "if every site were exempt, T-1 would be unfalsifiable",
  );
});

// ── T-2 ────────────────────────────────────────────────────────────────────────

test("T-2: the declared light appearance survives prebuild — no dark splash config", () => {
  const cfg = JSON.parse(read(APP_JSON));
  assert.equal(
    cfg.expo.userInterfaceStyle,
    "light",
    "app-mobile declares a light-only UI; this invariant is about that declaration surviving the build",
  );

  const entry = (cfg.expo.plugins || []).find(
    (p) => Array.isArray(p) && p[0] === "expo-splash-screen",
  );
  assert.ok(entry, "expected a configured expo-splash-screen plugin entry in app.json");

  const opts = entry[1] || {};
  const DARK_KEYS = ["image", "tabletImage", "backgroundColor", "tabletBackgroundColor"];
  for (const key of DARK_KEYS) {
    assert.ok(
      !opts.dark || !opts.dark[key],
      `app.json's expo-splash-screen plugin sets a truthy dark.${key}. ` +
        "@expo/prebuild-config's withIosSplashInfoPlist treats ANY truthy dark.* as " +
        "\"dark mode enabled\" and unconditionally assigns Info.plist " +
        "UIUserInterfaceStyle = 'Automatic', silently defeating expo.userInterfaceStyle: " +
        "'light'. That is #2322's root cause, and it cost nothing visually — the dark " +
        "background was #FAFAFA, identical to the light one.",
    );
  }
  assert.ok(
    !(cfg.expo.splash && cfg.expo.splash.dark),
    "the legacy expo.splash block must not grow a dark variant either — same plugin, same override",
  );
});

// ── OQ-1: executed, not grepped ────────────────────────────────────────────────
// These tests EXTRACT the real handler bodies out of OnboardingFlow.tsx and RUN
// them against a stub. A string match would pass against a fix that reads right and
// behaves wrong; executing the shipped source cannot.

function balancedBody(source, from) {
  // `from` is the index of the opening `{` of a function body.
  let depth = 0;
  for (let j = from; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) return source.slice(from + 1, j);
    }
  }
  throw new Error("unbalanced function body");
}

function dobRegion() {
  const src = read(ONBOARDING);
  const start = src.indexOf("onboarding:details.dob_label");
  assert.notEqual(start, -1, "could not find the DOB field in OnboardingFlow.tsx");
  const end = src.indexOf("── STEP 2 ──", start);
  assert.notEqual(end, -1, "could not find the end of onboarding step 1");
  return src.slice(start, end);
}

function onPressBodies(region) {
  const bodies = [];
  const marker = "onPress={() => {";
  let i = 0;
  while ((i = region.indexOf(marker, i)) !== -1) {
    const braceAt = i + marker.length - 1;
    bodies.push(balancedBody(region, braceAt));
    i += marker.length;
  }
  return bodies;
}

const DEFAULT_BIRTHDAY = new Date(2000, 0, 1);
const CHOSEN_BIRTHDAY = new Date(1994, 5, 17);

function harness() {
  const region = dobRegion();
  const bodies = onPressBodies(region);

  const openBody = bodies.find((b) => b.includes("setShowDatePicker(true)"));
  const doneBody = bodies.find(
    (b) => b.includes("setShowDatePicker(false)") && b.includes("pendingBirthdayRef"),
  );
  assert.ok(openBody, "could not extract the DOB field's open handler");
  assert.ok(doneBody, "could not extract the iOS Done handler");

  const picker = extractElements(region, "DateTimePicker")[0];
  assert.ok(picker, "could not find the DOB <DateTimePicker>");
  const onChangeAttr = attr(picker.text, "onChange");
  assert.ok(onChangeAttr && !onChangeAttr.literal, "could not extract the DOB onChange handler");
  const arrow = onChangeAttr.value;
  const onChangeBody = balancedBody(arrow, arrow.indexOf("{", arrow.indexOf("=>")));
  const valueExpr = attr(picker.text, "value");
  assert.ok(valueExpr && !valueExpr.literal, "could not extract the DOB picker's `value` expression");

  return { openBody, doneBody, onChangeBody, valueExpr: valueExpr.value };
}

function makeRuntime(initialBirthday) {
  const state = {
    data: { userBirthday: initialBirthday },
    pickerOpen: false,
    setDataCalls: 0,
  };
  const env = {
    pendingBirthdayRef: { current: "NEVER-INITIALISED" },
    BIRTHDAY_PICKER_DEFAULT: DEFAULT_BIRTHDAY,
    Platform: { OS: "ios" },
    setShowDatePicker: (v) => { state.pickerOpen = v; },
    setData: (updater) => {
      state.setDataCalls += 1;
      state.data = typeof updater === "function" ? updater(state.data) : updater;
    },
    get data() { return state.data; },
  };
  const run = (body, extra = {}) => {
    const scope = { ...env, ...extra };
    // `data` is a getter on env; spread has already resolved it, which is what the
    // handlers see at call time anyway.
    scope.data = state.data;
    const fn = new Function(...Object.keys(scope), `"use strict";\n${body}`);
    return fn(...Object.values(scope));
  };
  return { state, env, run };
}

test("OQ-1: opening the wheel and tapping Done WITHOUT scrolling stores no birthday", () => {
  const { openBody, doneBody } = harness();
  const { state, env, run } = makeRuntime(undefined);

  run(openBody);
  assert.equal(state.pickerOpen, true, "the field must still open the picker");
  assert.equal(
    env.pendingBirthdayRef.current,
    null,
    "opening the DOB field must leave NO pending value. Seeding the ref with " +
      "BIRTHDAY_PICKER_DEFAULT is what made Done commit 2000-01-01 as if the user had chosen it (#2322 OQ-1).",
  );

  run(doneBody);
  assert.equal(
    state.setDataCalls,
    0,
    "Done on an untouched wheel must not write to onboarding state",
  );
  assert.equal(
    state.data.userBirthday,
    undefined,
    "a user who never moved the wheel must not end up with a stored birthday — " +
      "it feeds profiles.birthday and buildOccasions()",
  );
  assert.equal(state.pickerOpen, false, "Done must still close the picker");
});

test("OQ-1: the CTA stays blocked when no birthday was chosen", () => {
  const src = read(ONBOARDING);
  const at = src.indexOf("case 'details':");
  assert.notEqual(at, -1, "could not find the step-1 CTA case in OnboardingFlow.tsx");
  const rest = src.slice(at + "case 'details':".length);
  // The whole case body, up to whichever comes first: the next case or a break.
  const nextCase = rest.indexOf("case '");
  const body = rest.slice(0, nextCase === -1 ? 400 : nextCase);
  assert.match(
    body,
    /disabled:\s*!data\.userBirthday/,
    "the step-1 'Let's go' CTA must remain gated on a REAL birthday. Combined with the " +
      "test above, an untouched wheel now leaves the CTA disabled instead of unblocking it " +
      "with a value nobody picked.",
  );
});

test("OQ-1: the wheel still SHOWS 01/01/2000, so the control looks normal", () => {
  const { valueExpr } = harness();
  const scope = {
    pendingBirthdayRef: { current: null },
    data: { userBirthday: undefined },
    BIRTHDAY_PICKER_DEFAULT: DEFAULT_BIRTHDAY,
  };
  const resolved = new Function(
    ...Object.keys(scope),
    `"use strict"; return (${valueExpr});`,
  )(...Object.values(scope));
  assert.equal(
    resolved,
    DEFAULT_BIRTHDAY,
    "with nothing pending and nothing stored the picker must still display " +
      "BIRTHDAY_PICKER_DEFAULT. The fix removes the silent COMMIT, not the visible default.",
  );
});

test("OQ-1: scrolling the wheel and then tapping Done DOES store the chosen date", () => {
  const { openBody, doneBody, onChangeBody } = harness();
  const { state, run } = makeRuntime(undefined);

  run(openBody);
  run(onChangeBody, { _event: { type: "set" }, selectedDate: CHOSEN_BIRTHDAY });
  run(doneBody);

  assert.equal(
    state.data.userBirthday,
    CHOSEN_BIRTHDAY,
    "a birthday the user actually scrolled to must still commit on Done — the fix must not " +
      "make Done permanently inert",
  );
});

test("OQ-1: re-opening an already-set birthday and tapping Done preserves it", () => {
  const { openBody, doneBody } = harness();
  const existing = new Date(1988, 10, 3);
  const { state, run } = makeRuntime(existing);

  run(openBody);
  run(doneBody);

  assert.equal(
    state.data.userBirthday,
    existing,
    "Done on an untouched re-opened picker must leave the stored birthday alone, not clear it",
  );
});

// ── Registration ───────────────────────────────────────────────────────────────

test("this suite is registered in the CI batch, by explicit filename", () => {
  const manifest = JSON.parse(read(CI_MANIFEST));
  const suite = manifest.suites.find((s) => s.id === "issue-2322-ios-picker-theming-tests");
  assert.ok(suite, "the #2322 suite is missing from .github/ci-batch/MANIFEST.json — it would never run");
  assert.equal(manifest.expectedSuites, manifest.suites.length, "expectedSuites must match the registry");
  assert.ok(manifest.classes.includes(suite.class), `class ${suite.class} is not declared in manifest.classes`);
  assert.equal(suite.steps.length, 1);
  assert.equal(suite.steps[0].cwd, "app-mobile");

  const run = suite.steps[0].run;
  // MEASURED on node v22 while building this suite: `node --test <pattern-with-*>`
  // that matches ZERO files prints "# fail 0" and EXITS 0. A glob here would let a
  // renamed or deleted suite report green forever — the #2113 dark-gate class, and
  // the same trap as the jest bracketed-route pattern. Explicit paths exit 1 when
  // the file is missing, which is the safe direction.
  assert.equal(
    run.includes("*"),
    false,
    "the #2322 batch step must name its test files explicitly: node --test with a glob " +
      "that matches nothing exits 0 and reports success",
  );

  const dir = path.join(APP_MOBILE, "src/components/__tests__");
  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("issue_2322_ios_picker_theming") && f.endsWith(".test.mjs"));
  assert.ok(onDisk.length >= 1, "expected at least this suite on disk");

  for (const f of onDisk) {
    assert.ok(
      run.includes(f),
      `${f} exists but is NOT named in the #2322 batch step, so CI never runs it. ` +
        "Add it to the `run` command in .github/ci-batch/MANIFEST.json. " +
        "(The tester's adversarial file must be registered when it lands — this " +
        "assertion is what makes forgetting it loud instead of silent.)",
    );
  }

  for (const named of run.match(/src\/components\/__tests__\/\S+\.test\.mjs/g) || []) {
    assert.ok(
      fs.existsSync(path.join(APP_MOBILE, named)),
      `the batch step names ${named}, which does not exist — node --test would fail the whole suite`,
    );
  }
});
