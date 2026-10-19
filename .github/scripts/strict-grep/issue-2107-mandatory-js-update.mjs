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
  consumerLayerWeb: "app-mobile/src/components/OtaAcknowledgementLayer.web.tsx",
  hostLayerWeb: "mingla-business/src/components/ui/OtaAcknowledgementLayer.web.tsx",
  consumerBanner: "app-mobile/src/hooks/useOtaUpdates.ts",
  edgePolicy: "supabase/functions/_shared/appOtaPolicy.ts",
  edgeEndpoint: "supabase/functions/app-ota-policy/index.ts",
  nativePolicy: "supabase/functions/_shared/appVersionPolicy.ts",
  config: "supabase/config.toml",
  migration:
    "supabase/migrations/20270413002107_issue_2107_app_ota_policies.sql",
  // 2026-10-19 airtight build (critical-index flow, A1-A4, B1-B4, D).
  consumerTelemetry: "app-mobile/src/services/updateGateTelemetry.ts",
  hostTelemetry: "mingla-business/src/services/updateGateTelemetry.ts",
  consumerGate: "app-mobile/src/components/MandatoryUpdateGate.tsx",
  hostGate: "mingla-business/src/components/ui/MandatoryUpdateGate.tsx",
  hostGateWeb: "mingla-business/src/components/ui/MandatoryUpdateGate.web.tsx",
  consumerConfig: "app-mobile/app.config.js",
  hostConfig: "mingla-business/app.config.js",
  consumerPublish: "app-mobile/scripts/ota/publish-production-ota.sh",
  hostPublish: "mingla-business/scripts/ota/publish-production-ota.sh",
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
    // #2107 B2 — the restart cap is persisted, the restart is verified by id,
    // and expo-updates' own recovery signals always let the person in.
    requireText(key, "CRITICAL_UPDATE_MAX_ATTEMPTS", `${key} must bound critical-update restarts`);
    requireText(key, "isEmergencyLaunch", `${key} must let an emergency launch in`);
    requireText(key, '"updatePreviouslyFailed"', `${key} must let a previously-failed update in`);
    requireText(key, "runningUpdateId === record.targetUpdateId", `${key} must verify the restart by update id`);
    const persistAt = sources[key].indexOf("this.dependencies.saveAttemptRecord(");
    const reloadAt = sources[key].indexOf("updates.reload()");
    if (persistAt === -1 || reloadAt === -1 || persistAt > reloadAt) {
      failures.push(`${key} must persist the attempt record BEFORE reloading — an in-memory cap resets on every reload`);
    }
    // #2107 B4 — the kill switch is ON by default and the server marker matches.
    const marker = /ABSENT_POLICY_ROW_UPDATED_AT = "([^"]+)"/.exec(sources[key]);
    const edgeMarker = /ABSENT_POLICY_ROW_UPDATED_AT = "([^"]+)"/.exec(sources.edgePolicy);
    if (marker === null || edgeMarker === null || marker[1] !== edgeMarker[1]) {
      failures.push(`${key} absent-row marker must equal the edge function's — otherwise "no row" stops enforcing`);
    }
  }

  // D — telemetry: one byte-identical module per app, through the existing
  // analytics wrapper, never a direct SDK import.
  if (sources.consumerTelemetry !== sources.hostTelemetry) {
    failures.push("updateGateTelemetry.ts drifted between app-mobile and mingla-business");
  }
  for (const key of ["consumerTelemetry", "hostTelemetry"]) {
    if (/(from\s+|require\(\s*)["']posthog-react-native["']/.test(sources[key])) {
      failures.push(`${key} must not import posthog-react-native — go through postHogService (orch-1296)`);
    }
    requireText(key, 'require("./postHogService")', `${key} must report through the existing postHogService wrapper, lazily`);
  }

  // A1-A4 — the native store-floor gate.
  for (const key of ["consumerGate", "hostGate"]) {
    requireText(key, "resolveGateLayout(", `${key} must keep a mounted app mounted (A2)`);
    requireText(key, "check(false)", `${key} foreground recheck must not veil the app (A2)`);
    requireText(key, "decision.message", `${key} must show the policy message (A4)`);
  }

  // B1 — every build and OTA carries the counter; publishing refuses without it.
  for (const key of ["consumerConfig", "hostConfig"]) {
    requireText(key, "criticalIndex: readCriticalIndex()", `${key} must emit extra.criticalIndex`);
  }
  for (const key of ["consumerPublish", "hostPublish"]) {
    requireText(key, "ABORT [#2107 preflight]", `${key} must refuse a config without an integer criticalIndex`);
    const guardAt = sources[key].indexOf("ABORT [#2107 preflight]");
    const publishAt = sources[key].indexOf("${MINGLA_EAS_BIN} update");
    if (guardAt === -1 || publishAt === -1 || guardAt > publishAt) {
      failures.push(`${key} must check criticalIndex BEFORE the publish command`);
    }
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

  // 7 — web resolves to a stub, so none of this reaches the browser boot chunk.
  // A runtime Platform check is not enough: it still ships the native layer, its
  // policy core and expo-updates inside the EAGER __common chunk. Measured at
  // 3,761 B on #2107, against #2099's 1,024 B ceiling.
  for (const key of ["consumerLayerWeb", "hostLayerWeb", "hostGateWeb"]) {
    const imports = [...sources[key].matchAll(/^import .*? from ["']([^"']+)["'];?$/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier !== "react");
    if (imports.length > 0) {
      failures.push(
        `${key} must import nothing but react — ${imports.join(", ")} would land in the web boot payload`,
      );
    }
    const exported = key === "hostGateWeb" ? "export function MandatoryUpdateGate" : "export function OtaAcknowledgementLayer";
    if (!sources[key].includes(exported)) {
      failures.push(`${key} must export the same component name so Metro can resolve it for web`);
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
    hostCore: sources.hostCore.replace("CRITICAL_UPDATE_MAX_ATTEMPTS", "MAX_ATTEMPTS"),
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
  const fattenedWeb = validate({
    ...sources,
    hostLayerWeb:
      `import { createOtaGateCoordinator } from "../../services/otaUpdateRuntime";\n${sources.hostLayerWeb}`,
  });
  if (fattenedWeb.length === 0) {
    console.error("#2107 self-test: an import added to the web stub was not detected — the boot-payload guard proves nothing");
    process.exit(1);
  }
  const reloadFirst = validate({
    ...sources,
    consumerCore: sources.consumerCore.replace(
      "this.dependencies.saveAttemptRecord(",
      "this.dependencies.saveAttemptRecordAfterReload(",
    ),
  });
  if (reloadFirst.length === 0) {
    console.error("#2107 self-test: an attempt record that is no longer persisted before reload was not detected");
    process.exit(1);
  }
  const markerDrift = validate({
    ...sources,
    edgePolicy: sources.edgePolicy.replace(
      'ABSENT_POLICY_ROW_UPDATED_AT = "1970-01-01T00:00:00.000Z"',
      'ABSENT_POLICY_ROW_UPDATED_AT = "1970-01-01T00:00:00.001Z"',
    ),
  });
  if (markerDrift.length === 0) {
    console.error("#2107 self-test: an absent-row marker drift between edge and client was not detected");
    process.exit(1);
  }
  const unguardedPublish = validate({
    ...sources,
    hostPublish: sources.hostPublish.split("ABORT [#2107 preflight]").join("WARN"),
  });
  if (unguardedPublish.length === 0) {
    console.error("#2107 self-test: a publish script without the criticalIndex guard was not detected");
    process.exit(1);
  }
  const blockingForeground = validate({
    ...sources,
    hostGate: sources.hostGate.split("check(false)").join("check(true)"),
  });
  if (blockingForeground.length === 0) {
    console.error("#2107 self-test: a foreground recheck that veils the app was not detected");
    process.exit(1);
  }
  console.log(
    "#2107 self-test passed (clean green; revert, drift, seeded-row, fattened web stub, reload-before-persist, marker drift, unguarded publish and blocking foreground all caught).",
  );
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
