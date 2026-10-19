// #2107 B1 — the canonical production OTA publishers refuse a config that does
// not resolve an integer extra.criticalIndex.
//
// I-2107-OTA-CARRIES-CRITICAL-INDEX (machine-readable invariant): both
// app.config.js files emit extra.criticalIndex from update-critical-index.json,
// and both publish-production-ota.sh wrappers abort BEFORE the publish step when
// the resolved value is not a non-negative integer.
//
// Driven through the wrappers' MINGLA_EAS_BIN seam pointed at a stub that never
// publishes, against a throwaway COPY of each app directory, so the real
// update-critical-index.json files are never touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BASH = fs.existsSync("/bin/bash") ? "/bin/bash" : "bash";

const APPS = {
  "app-mobile": {
    env: [
      "Environment: production",
      "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stub",
      "EXPO_PUBLIC_POSTHOG_KEY=phc_stub",
      "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stub",
      "",
    ].join("\n"),
    values: [
      "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stubvalue123",
      "EXPO_PUBLIC_POSTHOG_KEY=phc_stubvalue123",
      "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stubvalue123",
    ].join("\n"),
    // Files app.config.js needs to load, relative to the app root.
    configFiles: ["app.json", "app.config.js", "src/config/supabaseProject.js"],
  },
  "mingla-business": {
    env: [
      "Environment: production",
      "EXPO_PUBLIC_SENTRY_DSN=https://k@o1.ingest.us.sentry.io/2",
      "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stub",
      "EXPO_PUBLIC_GIPHY_API_KEY=g_stub",
      "EXPO_PUBLIC_ONESIGNAL_APP_ID=4505e476-stub",
      "EXPO_PUBLIC_POSTHOG_KEY=phc_stub",
      "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stub",
      "",
    ].join("\n"),
    values: [
      "EXPO_PUBLIC_SENTRY_DSN=https://key@o4511136062701568.ingest.us.sentry.io/4511",
      "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stubvalue123",
      "EXPO_PUBLIC_GIPHY_API_KEY=g_stubvalue1234567890",
      "EXPO_PUBLIC_ONESIGNAL_APP_ID=4505e476-0000-4000-8000-000000000000",
      "EXPO_PUBLIC_POSTHOG_KEY=phc_stubvalue123",
      "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stubvalue123",
    ].join("\n"),
    configFiles: ["app.json", "app.config.js"],
  },
};

const STUB_SRC = `#!/usr/bin/env bash
SUB="$1"; shift || true
case "$SUB" in
  env:list) printf '%s' "\${STUB_ENVLIST:-}" ;;
  env:get)
    NAME=""
    while [ $# -gt 0 ]; do case "$1" in --variable-name) NAME="$2"; shift 2 ;; *) shift ;; esac; done
    printf '%s\\n' "\${STUB_VALUES:-}" | grep "^\${NAME}=" || true ;;
  update) echo "stub: NEVER PUBLISHES. args: $*" >&2; exit 42 ;;
  *) echo "stub: unknown $SUB" >&2; exit 127 ;;
esac
`;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "issue2107-publish-guard-"));
const STUB = path.join(scratch, "stub-eas.sh");
fs.writeFileSync(STUB, STUB_SRC, { mode: 0o755 });
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

/** A throwaway copy of the repo shape the wrapper resolves paths against. */
function sandbox(app, criticalFileContent) {
  const root = fs.mkdtempSync(path.join(scratch, `${app}-`));
  const copy = (relative) => {
    const from = path.join(repoRoot, relative);
    const to = path.join(root, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  copy(`${app}/scripts/ota/publish-production-ota.sh`);
  copy("scripts/ota/verify-published-manifest.mjs");
  for (const file of APPS[app].configFiles) copy(`${app}/${file}`);
  if (criticalFileContent !== null) {
    fs.writeFileSync(path.join(root, app, "update-critical-index.json"), criticalFileContent);
  }
  return root;
}

function drive(app, criticalFileContent) {
  const root = sandbox(app, criticalFileContent);
  const r = spawnSync(
    BASH,
    [path.join(root, app, "scripts/ota/publish-production-ota.sh"), "ios", "issue 2107 guard probe"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        MINGLA_EAS_BIN: STUB,
        STUB_ENVLIST: APPS[app].env,
        STUB_VALUES: APPS[app].values,
        EAS_BUILD_PROFILE: "",
      },
    },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("#2107 B1 happy — the committed counter resolves and the wrapper proceeds to the publish step", () => {
  for (const app of Object.keys(APPS)) {
    const committed = fs.readFileSync(path.join(repoRoot, app, "update-critical-index.json"), "utf8");
    const value = JSON.parse(committed).criticalIndex;
    assert.ok(Number.isSafeInteger(value) && value >= 0, `${app} committed criticalIndex must be a non-negative integer`);
    const r = drive(app, committed);
    assert.match(r.out, /\[preflight\] OK extra\.criticalIndex = \d+/, `${app}:\n${r.out}`);
    assert.match(r.out, /NEVER PUBLISHES/, `${app} must reach (the stubbed) publish step:\n${r.out}`);
  }
});

test("#2107 B1 adversarial — a missing, fractional, negative or string counter never reaches the publish step", () => {
  const bad = [
    ["file missing", null],
    ["not JSON", "criticalIndex=3"],
    ["string", '{ "criticalIndex": "3" }'],
    ["fractional", '{ "criticalIndex": 1.5 }'],
    ["negative", '{ "criticalIndex": -1 }'],
    ["absent key", "{}"],
  ];
  for (const app of Object.keys(APPS)) {
    for (const [label, content] of bad) {
      const r = drive(app, content);
      assert.notEqual(r.code, 0, `${app} "${label}" must abort:\n${r.out}`);
      assert.match(r.out, /ABORT \[#2107 preflight\]/, `${app} "${label}" must name the #2107 guard:\n${r.out}`);
      assert.doesNotMatch(r.out, /NEVER PUBLISHES/, `${app} "${label}" reached the publish step:\n${r.out}`);
    }
  }
});

test("#2107 B1 — both app configs emit the counter into extra (so every build and OTA carries it)", () => {
  for (const app of Object.keys(APPS)) {
    const source = fs.readFileSync(path.join(repoRoot, app, "app.config.js"), "utf8");
    assert.match(source, /criticalIndex: readCriticalIndex\(\)/, `${app}/app.config.js must emit extra.criticalIndex`);
    assert.match(source, /require\("\.\/update-critical-index\.json"\)/, `${app}/app.config.js must read the committed counter`);
  }
});
