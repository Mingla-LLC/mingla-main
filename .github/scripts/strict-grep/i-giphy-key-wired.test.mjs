import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";

const SCRIPT = new URL("./i-giphy-key-wired.mjs", import.meta.url);
const SCRIPT_PATH = fileURLToPath(SCRIPT);
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");

function writeFixture(root, rel, source) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/**
 * The gate resolves REPO_ROOT three levels up from the script and reads fixed
 * paths under mingla-business/. To exercise it against fixtures we copy the
 * script into a temp repo root so its relative resolution points at our
 * fixtures.
 */
function runAgainstRepo(appConfig, envExample, services) {
  const root = mkdtempSync(join(tmpdir(), "orch-1116-giphy-wired-"));
  try {
    // Recreate the .github/scripts/strict-grep/ layout so the script's
    // `path.resolve(__dirname, "..","..","..")` lands on `root`.
    const scriptCopy = writeFixture(
      root,
      ".github/scripts/strict-grep/i-giphy-key-wired.mjs",
      SCRIPT_SOURCE,
    );
    writeFixture(root, "mingla-business/app.config.ts", appConfig);
    writeFixture(root, "mingla-business/.env.example", envExample);
    // ORCH-1127 — INV-3 reads the two giphy services; provide them so the gate
    // doesn't fail merely because the fixture files are absent.
    const svc = services ?? {
      giphy: GOOD_GIPHY_SERVICE,
      browse: GOOD_GIPHY_SERVICE,
    };
    writeFixture(
      root,
      "mingla-business/src/services/giphyEventCoverService.ts",
      svc.giphy,
    );
    writeFixture(
      root,
      "mingla-business/src/services/coverProviderBrowseService.ts",
      svc.browse,
    );
    return spawnSync(process.execPath, [scriptCopy], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const GOOD_APP_CONFIG = `
export default () => ({
  extra: {
    EXPO_PUBLIC_GIPHY_API_KEY: (() => {
      const fromEnv = process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? null;
      if (isReleaseBound && (fromEnv === null || fromEnv.length === 0)) {
        throw new Error(
          \`EXPO_PUBLIC_GIPHY_API_KEY is required for the \${profileLabel} build (cover-picker GIF tab). Provision it in the matching EAS environment.\`,
        );
      }
      return fromEnv;
    })(),
  },
});
`;

const PASSTHROUGH_ONLY_APP_CONFIG = `
export default () => ({
  extra: {
    EXPO_PUBLIC_GIPHY_API_KEY: process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? null,
  },
});
`;

const GOOD_ENV = `EXPO_PUBLIC_OPENWEATHER_API_KEY=x\nEXPO_PUBLIC_GIPHY_API_KEY=\n`;
const BAD_ENV = `EXPO_PUBLIC_OPENWEATHER_API_KEY=x\n`;

// ORCH-1127 — service fixtures for the INV-3 extra-first-read check.
const GOOD_GIPHY_SERVICE = `
import Constants from "expo-constants";
const readExtra = (name) => {
  const extra = Constants.expoConfig?.extra;
  return extra?.[name];
};
const readStatic = (name) =>
  name === "EXPO_PUBLIC_GIPHY_API_KEY"
    ? process.env.EXPO_PUBLIC_GIPHY_API_KEY
    : process.env.EXPO_PUBLIC_GIPHY_KEY;
const envValue = (name) => readExtra(name) ?? readStatic(name);
`;
// The regressed reader: dynamic-only process.env bracket access, no extra read.
const DYNAMIC_ONLY_GIPHY_SERVICE = `
const envValue = (name) => {
  const value = globalThis.process?.env?.[name];
  return typeof value === "string" ? value : null;
};
`;

test("self-test passes (detectors behave)", () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, "--self-test"], {
    encoding: "utf8",
  });
  assert.match(out, /SELF-TEST OK/);
});

test("gate passes the post-fix repo HEAD", () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH], {
    encoding: "utf8",
  });
  assert.match(out, /PASS · violations=0/);
});

test("gate passes a guarded app.config + documented .env.example", () => {
  const r = runAgainstRepo(GOOD_APP_CONFIG, GOOD_ENV);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS · violations=0/);
});

test("fails-on-revert: gate FAILS when the fail-loud guard is removed (passthrough only)", () => {
  const r = runAgainstRepo(PASSTHROUGH_ONLY_APP_CONFIG, GOOD_ENV);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /giphy-fail-loud-guard/);
});

test("fails-on-revert: gate FAILS when .env.example entry is removed", () => {
  const r = runAgainstRepo(GOOD_APP_CONFIG, BAD_ENV);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /env-example-documents-key/);
});

test("ORCH-1127: gate PASSES when both services read extra first", () => {
  const r = runAgainstRepo(GOOD_APP_CONFIG, GOOD_ENV, {
    giphy: GOOD_GIPHY_SERVICE,
    browse: GOOD_GIPHY_SERVICE,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS · violations=0/);
});

test("ORCH-1127 fails-on-revert: gate FAILS when a service regresses to a dynamic-only process.env read", () => {
  const r = runAgainstRepo(GOOD_APP_CONFIG, GOOD_ENV, {
    giphy: DYNAMIC_ONLY_GIPHY_SERVICE,
    browse: GOOD_GIPHY_SERVICE,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /giphy-extra-first-read/);
});
