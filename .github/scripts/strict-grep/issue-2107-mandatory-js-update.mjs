#!/usr/bin/env node
//
// #2107 structural contract — mandatory JavaScript updates.
//
// Guards four things unit tests cannot see:
//   1. The blocking layer is mounted at the ROOT of both apps, INSIDE the #2075
//      native gate. Below the native minimum, no OTA can rescue the install, so
//      a download prompt there is a dead end.
//   2. The pure decision core stays byte-identical between the two apps. #2075
//      shipped two copies of the equivalent file with no parity gate and they
//      had already drifted by 30 lines by the time #2107 read them.
//   3. Exactly one module per app imports expo-updates. That invariant was only
//      ever a comment before this issue.
//   4. The OTA policy lives on its own endpoint. Extending app-version-policy's
//      response would make every shipped client's exact-key-set check reject it
//      and fail open — silently disarming the native gate at the moment #2075's
//      enforcement is switched on.
//
// ISSUE_2107_SIMULATE_REVERT=1 proves the gate fails when the root mount is
// removed, so a green run means something.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const FILES = {
  consumerRoot: "app-mobile/app/_layout.tsx",
  hostRoot: "mingla-business/app/_layout.tsx",
  consumerCore: "app-mobile/src/services/otaUpdatePolicy.ts",
  hostCore: "mingla-business/src/services/otaUpdatePolicy.ts",
  consumerRuntime: "app-mobile/src/services/otaUpdateRuntime.ts",
  hostRuntime: "mingla-business/src/services/otaUpdateRuntime.ts",
  consumerLayer: "app-mobile/src/components/OtaAcknowledgementLayer.tsx",
  hostLayer: "mingla-business/src/components/ui/OtaAcknowledgementLayer.tsx",
  consumerBanner: "app-mobile/src/hooks/useOtaUpdates.ts",
  edgePolicy: "supabase/functions/_shared/appOtaPolicy.ts",
  edgeEndpoint: "supabase/functions/app-ota-policy/index.ts",
  nativePolicy: "supabase/functions/_shared/appVersionPolicy.ts",
  config: "supabase/config.toml",
  migration:
    "supabase/migrations/20270413002107_issue_2107_app_ota_policies.sql",
};

// Directories scanned for stray expo-updates importers. Only the two runtime
// modules above are allowed to import it.
const IMPORT_SCAN_ROOTS = [
  "app-mobile/src",
  "app-mobile/app",
  "mingla-business/src",
  "mingla-business/app",
];
const ALLOWED_UPDATES_IMPORTERS = new Set([
  "app-mobile/src/services/otaUpdateRuntime.ts",
  "mingla-business/src/services/otaUpdateRuntime.ts",
]);

function walk(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const child = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(child);
  }
  return out;
}

/** The app id is the ONLY line permitted to differ between the two cores. */
function normalizeCore(source) {
  return source
    .replace(
      /export const OTA_POLICY_APP_ID = "(explorer|business)" as const;/,
      'export const OTA_POLICY_APP_ID = "<app>" as const;',
    )
    .replace(/mingla-business\/src\/services\/otaUpdatePolicy\.ts/g, "<mirror>")
    .replace(/app-mobile\/src\/services\/otaUpdatePolicy\.ts/g, "<mirror>");
}

export function validate(sources, { simulateRevert = false } = {}) {
  const failures = [];
  const requireText = (key, needle, label) => {
    if (!sources[key].includes(needle)) failures.push(label);
  };

  // 1 — root mount, inside the native gate.
  for (
    const [rootKey, gateOpen, label] of [
      ["consumerRoot", "<MandatoryUpdateGate>", "Consumer"],
      ["hostRoot", "<MandatoryUpdateGate", "Host"],
    ]
  ) {
    const source = simulateRevert && rootKey === "consumerRoot"
      ? sources[rootKey].split("<OtaAcknowledgementLayer>").join("")
      : sources[rootKey];
    if (!source.includes("<OtaAcknowledgementLayer>")) {
      failures.push(`${label} root must mount OtaAcknowledgementLayer`);
      continue;
    }
    const gateAt = source.indexOf(gateOpen);
    const layerAt = source.indexOf("<OtaAcknowledgementLayer>");
    if (gateAt === -1 || layerAt < gateAt) {
      failures.push(
        `${label} OTA layer must mount INSIDE MandatoryUpdateGate — below the native minimum an OTA cannot rescue the install`,
      );
    }
  }

  // 2 — the two decision cores are one behaviour.
  if (normalizeCore(sources.consumerCore) !== normalizeCore(sources.hostCore)) {
    failures.push(
      "otaUpdatePolicy.ts drifted between app-mobile and mingla-business — the two apps must resolve updates identically",
    );
  }
  for (const key of ["consumerCore", "hostCore"]) {
    requireText(key, "FORCE_RESTART_MAX_ATTEMPTS", `${key} must bound force_restart attempts`);
    requireText(key, '"force_restart"', `${key} must carry the dormant emergency mode`);
  }

  // 3 — a single expo-updates owner per app, enforced not commented.
  for (const file of sources.scanned) {
    if (ALLOWED_UPDATES_IMPORTERS.has(file)) continue;
    if (/from ["']expo-updates["']/.test(sources.byFile[file])) {
      failures.push(`${file} imports expo-updates directly — route it through otaUpdateRuntime.ts`);
    }
  }
  for (const key of ["consumerRuntime", "hostRuntime"]) {
    requireText(key, 'from "expo-updates"', `${key} must own the expo-updates import`);
    requireText(key, "!__DEV__ && Updates.isEnabled", `${key} must double-guard the native module`);
  }

  // 4 — separate endpoint; the shipped native contract is untouched.
  requireText("edgeEndpoint", "readAppOtaPolicy", "the OTA endpoint must read the OTA policy table");
  requireText("edgeEndpoint", "runtime_version", "the OTA endpoint must be addressed per runtime, not per app");
  requireText("edgeEndpoint", "isSupportedRuntimeVersion", "the OTA endpoint must reject version-shaped junk");
  requireText("config", "[functions.app-ota-policy]", "app-ota-policy must be registered in config.toml");
  requireText("config", "verify_jwt = false", "app-ota-policy must be publicly readable");
  if (sources.nativePolicy.includes("app_ota_policies")) {
    failures.push(
      "app-version-policy must not learn about OTA policy — shipped clients key-set-validate that response and would fail open",
    );
  }
  requireText("migration", "create table public.app_ota_policies", "OTA policy table migration missing");
  requireText("migration", "enable row level security", "app_ota_policies must have RLS enabled");
  requireText("migration", "revoke all on public.app_ota_policies", "app_ota_policies must not be client-readable");
  if (/insert into public\.app_ota_policies/i.test(sources.migration)) {
    failures.push(
      "the migration must NOT seed enforcement rows — every lane stays silent until its bootstrap OTA is verified",
    );
  }

  // 5 — the optional banner survives, per the #2107 operator decision.
  requireText("consumerBanner", "dismissBanner", "the optional dismissible banner must be preserved");
  requireText("consumerBanner", "createOtaUpdateBridge", "the optional banner must consume the shared bridge");

  // 6 — the layer never blocks web, and never lets a mode it cannot name block.
  for (const key of ["consumerLayer", "hostLayer"]) {
    requireText(key, 'Platform.OS !== "web"', `${key} must never block a web surface`);
    requireText(key, "accessibilityViewIsModal", `${key} must trap assistive focus while blocking`);
    requireText(key, "hardwareBackPress", `${key} must absorb the Android back button`);
    if (sources[key].includes("onDismiss") || sources[key].includes("AUTO_DISMISS")) {
      failures.push(`${key} must not be dismissible — that is the optional banner's job`);
    }
  }

  return failures;
}

function loadSources() {
  const sources = { byFile: {}, scanned: [] };
  for (const [key, relative] of Object.entries(FILES)) sources[key] = read(relative);
  for (const dir of IMPORT_SCAN_ROOTS) {
    for (const file of walk(dir)) {
      sources.scanned.push(file);
      sources.byFile[file] = read(file);
    }
  }
  return sources;
}

function selfTest() {
  const sources = loadSources();
  const clean = validate(sources);
  if (clean.length > 0) {
    console.error("#2107 self-test: clean tree unexpectedly failed:");
    for (const failure of clean) console.error(`  - ${failure}`);
    process.exit(1);
  }
  const reverted = validate(sources, { simulateRevert: true });
  if (reverted.length === 0) {
    console.error("#2107 self-test: a removed root mount was not detected — this gate proves nothing");
    process.exit(1);
  }
  const drifted = validate({
    ...sources,
    hostCore: sources.hostCore.replace("FORCE_RESTART_MAX_ATTEMPTS", "MAX_ATTEMPTS"),
  });
  if (drifted.length === 0) {
    console.error("#2107 self-test: core drift between the two apps was not detected");
    process.exit(1);
  }
  const seeded = validate({
    ...sources,
    migration: `${sources.migration}\ninsert into public.app_ota_policies (app_id) values ('explorer');`,
  });
  if (seeded.length === 0) {
    console.error("#2107 self-test: a seeded enforcement row was not detected");
    process.exit(1);
  }
  console.log("#2107 self-test passed (clean green; revert, drift and seeded-row all caught).");
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const failures = validate(loadSources(), {
    simulateRevert: process.env.ISSUE_2107_SIMULATE_REVERT === "1",
  });
  if (failures.length > 0) {
    console.error("#2107 structural contract FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("#2107 structural contract holds.");
}

main();
