#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUSINESS_ROOT = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(BUSINESS_ROOT, "..");
const DIST_HTML = path.join(BUSINESS_ROOT, "dist/index.html");
const INJECTOR = path.join(BUSINESS_ROOT, "scripts/inject-attendance-claim-bootstrap.mjs");
const MARKER = "mingla-attendance-claim-pre-router";
const HANDOFF_KEY = "__minglaAttendanceClaimFragment";
const EXACT_TAG = new RegExp(`<script id="${MARKER}">([\\s\\S]*?)<\\/script>`);
const require = createRequire(import.meta.url);

const read = (absolutePath) => fs.readFileSync(absolutePath, "utf8");
const count = (haystack, needle) => haystack.split(needle).length - 1;

function exportedHtml() {
  assert.ok(fs.existsSync(DIST_HTML), "dist/index.html must exist: run the production web export and both post-export injectors first");
  return read(DIST_HTML);
}

function extractBootstrap(html) {
  const match = html.match(EXACT_TAG);
  assert.ok(match, "the real exported shell must contain the attendance bootstrap tag");
  return { tag: match[0], source: match[1], index: match.index };
}

function runBootstrap(source, href, initialState) {
  const parsed = new URL(href);
  const replacements = [];
  const history = {
    state: initialState,
    replaceState(state, title, url) {
      replacements.push({ state, title, url });
    },
  };
  const window = { location: parsed, history };
  vm.runInNewContext(source, { window }, { timeout: 1_000 });
  return { window, replacements };
}

function loadActualDeepLinkHelper() {
  const source = read(path.join(BUSINESS_ROOT, "src/utils/attendanceClaimDeepLink.ts"));
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "attendanceClaimDeepLink.ts",
    reportDiagnostics: true,
  });
  assert.deepEqual(
    output.diagnostics?.map((diagnostic) => diagnostic.messageText) ?? [],
    [],
    "the delivered route helper must transpile before its behavior is exercised",
  );
  const module = { exports: {} };
  vm.runInNewContext(output.outputText, {
    exports: module.exports,
    module,
    require,
  }, { timeout: 1_000 });
  return module.exports;
}

test("the real Expo single-output artifact starts with the fail-closed attendance bootstrap", () => {
  const app = JSON.parse(read(path.join(BUSINESS_ROOT, "app.json")));
  assert.equal(app.expo?.web?.output, "single", "this guard is meaningful only for Expo's single-shell delivery mode");

  const html = exportedHtml();
  const bootstrap = extractBootstrap(html);
  assert.equal(count(html, `id="${MARKER}"`), 1, "the real shell must contain exactly one attendance marker");
  assert.equal(bootstrap.index, html.search(/<script\b/i), "no inline or external application JavaScript may run before capture");
  assert.ok(bootstrap.index < html.indexOf("mingla-mobile-web-chunk-recovery"), "attendance capture must precede the later chunk-recovery injector");
  assert.ok(bootstrap.index < html.search(/<script\b[^>]*\bsrc=/i), "attendance capture must precede the first external app bundle");

  for (const forbidden of [
    "console.",
    "fetch(",
    "XMLHttpRequest",
    "sendBeacon",
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "indexedDB",
    "WebSocket",
  ]) {
    assert.equal(bootstrap.source.includes(forbidden), false, `bootstrap must not introduce sink ${forbidden}`);
  }

  const originalState = { key: "router-state", nested: { preserved: true } };
  const pass = runBootstrap(
    bootstrap.source,
    "https://host.usemingla.com/attendance/claim?source=email%20recovery&channel=sms#opaque-fragment-value",
    originalState,
  );
  const descriptor = Object.getOwnPropertyDescriptor(pass.window, HANDOFF_KEY);
  assert.ok(descriptor, "exact route with a nonempty fragment must create the handoff");
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, true, "the consumer must be able to delete the handoff atomically");
  assert.equal(Object.isFrozen(descriptor.value), true);
  assert.equal(descriptor.value.fragment, "opaque-fragment-value");
  assert.equal(descriptor.value.cleanUrl, "/attendance/claim?source=email%20recovery&channel=sms");
  assert.equal(descriptor.value.historyState, originalState);
  assert.deepEqual(pass.replacements, [{ state: originalState, title: "", url: descriptor.value.cleanUrl }]);

  for (const href of [
    "https://host.usemingla.com/attendance/claim?source=email",
    "https://host.usemingla.com/attendance/claim/#opaque",
    "https://host.usemingla.com/attendance/claiming#opaque",
    "https://host.usemingla.com/Attendance/claim#opaque",
  ]) {
    const noop = runBootstrap(bootstrap.source, href, originalState);
    assert.equal(Object.hasOwn(noop.window, HANDOFF_KEY), false, `${href} must not create a handoff`);
    assert.deepEqual(noop.replacements, [], `${href} must not rewrite history`);
  }
});

test("the real route consumes the exported handoff once and every bounded restore keeps the launch URL and Router state", () => {
  const helper = loadActualDeepLinkHelper();
  assert.equal(helper.ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY, HANDOFF_KEY);
  assert.equal(typeof helper.consumeAttendanceClaimFragment, "function");
  assert.equal(typeof helper.createAttendanceClaimFragmentScrubber, "function");

  const launchState = { key: "launch-router-state", nested: { exact: true } };
  const laterState = { key: "later-router-state" };
  const cleanUrl = "/attendance/claim?source=email%20recovery&channel=sms";
  const browserWindow = {
    location: {
      pathname: "/attendance/claim",
      search: "",
      hash: "",
    },
    history: {
      state: laterState,
      replaceState(state, title, url) {
        replacements.push({ state, title, url: String(url) });
      },
    },
  };
  const handoff = Object.freeze({
    fragment: "opaque-exported-fragment",
    cleanUrl,
    historyState: launchState,
  });
  Object.defineProperty(browserWindow, HANDOFF_KEY, {
    value: handoff,
    writable: false,
    enumerable: false,
    configurable: true,
  });

  const consumed = helper.consumeAttendanceClaimFragment(browserWindow, "");
  assert.equal(consumed, handoff, "the route helper must retain the exact frozen export handoff");
  assert.equal(Object.hasOwn(browserWindow, HANDOFF_KEY), false, "the credential-bearing handoff must be deleted synchronously");
  const fallback = helper.consumeAttendanceClaimFragment(browserWindow, "direct-fallback");
  assert.deepEqual(
    { ...fallback },
    {
      fragment: "direct-fallback",
      cleanUrl: "/attendance/claim",
      historyState: laterState,
    },
    "a second consume must not replay the deleted handoff",
  );

  const replacements = [];
  const frames = [];
  const restore = helper.createAttendanceClaimFragmentScrubber(consumed)(
    browserWindow.location,
    browserWindow.history,
    (callback) => {
      frames.push(callback);
      return frames.length;
    },
  );
  frames.shift()?.(0);
  frames.shift()?.(16);
  browserWindow.history.state = { key: "third-router-owner" };
  restore();
  frames.shift()?.(32);
  assert.equal(frames.length, 0, "the defense-in-depth restore must remain bounded");
  assert.equal(replacements.length, 4);
  for (const replacement of replacements) {
    assert.equal(replacement.state, launchState, "history state identity must remain the launch owner");
    assert.equal(replacement.title, "");
    assert.equal(replacement.url, cleanUrl);
    assert.equal(replacement.url.includes("#"), false);
  }

  const route = read(path.join(BUSINESS_ROOT, "app/attendance/claim.tsx"));
  assert.equal(count(route, "consumeAttendanceClaimFragment(window, raw)"), 1, "the route must consume the handoff exactly once");
  assert.ok(route.includes("attendanceAppUrlFromFragment(capturedRaw)"), "the parser must receive the consumed fragment");
  assert.match(
    route,
    /if \(Platform\.OS !== "web" \|\| !parsed\) return;\s*scheduleFinalUrlRestoreRef\.current\?\.\(\);/,
    "the final bounded restore must remain anchored after parsed state commits",
  );
});

test("the Vercel and workflow chains cannot bypass, duplicate, or postpone the injector", () => {
  const vercel = JSON.parse(read(path.join(BUSINESS_ROOT, "vercel.json")));
  assert.equal(vercel.outputDirectory, "dist");
  const raw = vercel.buildCommand;
  assert.equal(/[;\n]|\|\|/.test(raw), false, "alternate shell control flow could bypass a fail-closed injector");
  const commands = raw.split("&&").map((value) => value.trim());
  const exportCommand = "npx expo export -p web";
  const attendanceCommand = "node scripts/inject-attendance-claim-bootstrap.mjs";
  const blurCommand = "node scripts/inject-mobile-blur-css.mjs";
  const inviteCommand = "node scripts/build-invite-critical-entry.mjs";
  assert.equal(commands.filter((value) => value === exportCommand).length, 1, "Vercel must perform exactly one production export");
  assert.equal(commands.filter((value) => value === attendanceCommand).length, 1, "Vercel must perform exactly one attendance injection");
  assert.deepEqual(commands.slice(-4), [exportCommand, attendanceCommand, blurCommand, inviteCommand]);

  const workflow = read(path.join(REPO_ROOT, ".github/workflows/issue-922-business-web-actionable.yml"));
  const testerPath = "mingla-business/scripts/ci/issue-2979-attendance-export-pipeline.tester.test.mjs";
  assert.ok(workflow.includes(`- "${testerPath}"`), "the independent guard must trigger its owning workflow");
  const exportStep = workflow.match(/      - name: Export and build the dedicated entry\n([\s\S]*?)(?=\n      - name: )/);
  assert.ok(exportStep, "the production-shaped export step must remain discoverable");
  const runLines = exportStep[1]
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value && value !== "run: |");
  assert.deepEqual(runLines, [
    "npx expo export -p web --clear",
    attendanceCommand,
    blurCommand,
    inviteCommand,
  ]);
  const exportIndex = workflow.indexOf("- name: Export and build the dedicated entry");
  const testerIndex = workflow.indexOf("- name: Independent production-shaped attendance bootstrap guard");
  const structuralIndex = workflow.indexOf("- name: Structural, drift, route, and size guard");
  assert.ok(exportIndex < testerIndex && testerIndex < structuralIndex, "the independent guard must consume the just-built artifact before later checks");

  const htmlOwner = read(path.join(BUSINESS_ROOT, "app/+html.tsx"));
  for (const forbidden of [MARKER, HANDOFF_KEY, "ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP", "inject-attendance-claim-bootstrap"]) {
    assert.equal(htmlOwner.includes(forbidden), false, `ineffective +html owner must not retain ${forbidden}`);
  }
});

test("the injector wins against inline JavaScript already present in a production-shaped shell and stays idempotent", () => {
  const finalHtml = exportedHtml();
  const bootstrap = extractBootstrap(finalHtml);
  const preexistingInline = '<script id="future-expo-inline">window.__futureExpoInline=true;</script>';
  const rawProductionShape = finalHtml
    .replace(bootstrap.tag, "")
    .replace(/(<head\b[^>]*>)/i, `$1${preexistingInline}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2979-export-pipeline-"));
  const shell = path.join(tempRoot, "index.html");
  try {
    fs.writeFileSync(shell, rawProductionShape, "utf8");
    const first = execFileSync(process.execPath, [INJECTOR, shell], { cwd: BUSINESS_ROOT, encoding: "utf8" });
    assert.match(first, /\[attendance-claim-bootstrap\] exported HTML verified/);
    const once = read(shell);
    const reinjected = extractBootstrap(once);
    assert.equal(reinjected.index, once.search(/<script\b/i), "capture must remain first even if Expo gains an inline bootstrap");
    assert.ok(reinjected.index < once.indexOf("future-expo-inline"));
    assert.ok(reinjected.index < once.indexOf("mingla-mobile-web-chunk-recovery"));

    execFileSync(process.execPath, [INJECTOR, shell], { cwd: BUSINESS_ROOT, encoding: "utf8" });
    assert.equal(read(shell), once, "a second build-chain invocation must be byte-idempotent");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("missing and production-shaped malformed shells fail closed without fabricating or rewriting output", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2979-export-fail-closed-"));
  const missing = path.join(tempRoot, "missing.html");
  const malformed = path.join(tempRoot, "malformed.html");
  try {
    const absent = spawnSync(process.execPath, [INJECTOR, missing], { cwd: BUSINESS_ROOT, encoding: "utf8" });
    assert.notEqual(absent.status, 0);
    assert.equal(fs.existsSync(missing), false);

    const real = exportedHtml();
    const before = real.replace(/<\/head>/i, "");
    fs.writeFileSync(malformed, before, "utf8");
    const broken = spawnSync(process.execPath, [INJECTOR, malformed], { cwd: BUSINESS_ROOT, encoding: "utf8" });
    assert.notEqual(broken.status, 0);
    assert.equal(read(malformed), before, "fail-closed validation must happen before a malformed shell is rewritten");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
