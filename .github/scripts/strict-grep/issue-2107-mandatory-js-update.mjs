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
//   5. (Sentry REACT-NATIVE-1C) Every in-app restart goes through safeReload,
//      which stops network work before reloadAsync. A request issued while the
//      bridge tears down crashes RCTNetworking, so a bare reloadAsync anywhere
//      is a crash waiting for a tap.
//
//   6. (U1) A broken update's launch error reaches expo-updates' rollback or the
//      restart screen, never a blank screen: both roots mount UpdateLaunchBoundary,
//      the guard core and runtime stay byte-identical, escalation persists the
//      update id before raising, and the web stubs import nothing.
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
  // Sentry REACT-NATIVE-1C — safe restart.
  consumerSafeReload: "app-mobile/src/services/safeReload.ts",
  hostSafeReload: "mingla-business/src/services/safeReload.ts",
  consumerFence: "app-mobile/src/services/reloadNetworkFence.ts",
  hostFence: "mingla-business/src/services/reloadNetworkFence.ts",
  hostFenceWeb: "mingla-business/src/services/reloadNetworkFence.web.ts",
  consumerSafeReloadRuntime: "app-mobile/src/services/safeReloadRuntime.ts",
  hostSafeReloadRuntime: "mingla-business/src/services/safeReloadRuntime.ts",
  consumerSupabase: "app-mobile/src/services/supabase.ts",
  hostSupabase: "mingla-business/src/services/supabase.ts",
  // U1 — launch-window escalation and the restart screen.
  consumerLaunchGuard: "app-mobile/src/services/updateLaunchGuard.ts",
  hostLaunchGuard: "mingla-business/src/services/updateLaunchGuard.ts",
  consumerLaunchRuntime: "app-mobile/src/services/updateLaunchRuntime.ts",
  hostLaunchRuntime: "mingla-business/src/services/updateLaunchRuntime.ts",
  consumerLaunchBoundary: "app-mobile/src/components/UpdateLaunchBoundary.tsx",
  hostLaunchBoundary: "mingla-business/src/components/ui/UpdateLaunchBoundary.tsx",
  consumerLaunchBoundaryWeb: "app-mobile/src/components/UpdateLaunchBoundary.web.tsx",
  hostLaunchBoundaryWeb: "mingla-business/src/components/ui/UpdateLaunchBoundary.web.tsx",
};

// The one routed restart each runtime is allowed to contain.
const ROUTED_RELOAD = "runSafeReload(() => Updates.reloadAsync())";
// Anything that restarts the JS bundle. window.location.reload is a browser
// page load, not a bridge teardown, and is out of scope.
const RELOAD_CALL = /\b(?:reloadAsync|DevSettings\.reload|NativeModules\.DevSettings\.reload)\s*\(/g;
const isTestFile = (file) => /(^|\/)__tests__\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file);

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

  // 3b — every restart goes through safeReload (Sentry REACT-NATIVE-1C).
  for (const file of sources.scanned) {
    if (ALLOWED_UPDATES_IMPORTERS.has(file) || isTestFile(file)) continue;
    if (RELOAD_CALL.test(sources.byFile[file])) {
      failures.push(`${file} restarts the app directly — route it through runSafeReload in otaUpdateRuntime.ts`);
    }
    RELOAD_CALL.lastIndex = 0;
  }
  for (const key of ["consumerRuntime", "hostRuntime"]) {
    const calls = (sources[key].match(RELOAD_CALL) ?? []).length;
    const routed = sources[key].split(ROUTED_RELOAD).length - 1;
    if (calls === 0 || routed !== calls) {
      failures.push(
        `${key} calls reloadAsync outside runSafeReload (${calls} call(s), ${routed} routed) — a request issued during the reload crashes RCTNetworking`,
      );
    }
    requireText(key, 'import { runSafeReload } from "./safeReloadRuntime";', `${key} must restart through safeReloadRuntime`);
  }
  for (const [a, b, label] of [
    ["consumerSafeReload", "hostSafeReload", "safeReload.ts"],
    ["consumerFence", "hostFence", "reloadNetworkFence.ts"],
    ["consumerSafeReloadRuntime", "hostSafeReloadRuntime", "safeReloadRuntime.ts"],
  ]) {
    if (sources[a] !== sources[b]) failures.push(`${label} drifted between app-mobile and mingla-business`);
  }
  for (const key of ["consumerSafeReload", "hostSafeReload"]) {
    // The core imports nothing, so it can never pull a native module anywhere.
    if (/^import\s/m.test(sources[key])) failures.push(`${key} must import nothing`);
    for (const phase of ["dependencies.pause", "dependencies.flush", "dependencies.lockdown", "dependencies.settle", "dependencies.reload()"]) {
      requireText(key, phase, `${key} must run ${phase}`);
    }
    const order = ["for (const step of dependencies.pause)", "for (const flush of dependencies.flush)", "for (const step of dependencies.lockdown)", "dependencies.settle,", "await dependencies.reload()"]
      .map((needle) => sources[key].indexOf(needle));
    if (order.some((at) => at === -1) || order.some((at, i) => i > 0 && at < order[i - 1])) {
      failures.push(`${key} must pause, flush, lock down and settle BEFORE reloading`);
    }
    requireText(key, "await restore();", `${key} must restore the app when the reload fails`);
  }
  for (const key of ["consumerSafeReloadRuntime", "hostSafeReloadRuntime"]) {
    for (const [needle, what] of [
      ["closeNetworkFence()", "close the app network fence"],
      ["onlineManager.setOnline(false)", "take React Query offline"],
      ["queryClient.cancelQueries()", "cancel queries"],
      ["supabase.removeAllChannels()", "remove realtime channels"],
      ["lockDownXhrSends(", "hold remaining XHR sends"],
      ["waitForNetworkIdle()", "let in-flight requests settle"],
      ["openNetworkFence()", "reopen the network on restore"],
    ]) requireText(key, needle, `${key} must ${what}`);
    if (/^import .* from ["'](?!\.\/)/m.test(sources[key])) {
      failures.push(`${key} must import only its sibling pure modules — app modules are required lazily`);
    }
  }
  requireText("consumerSupabase", "trackNetworkRequest(() => fetchWithTimeoutUntracked(url, options))", "Explorer Supabase fetch must go through the restart fence");
  requireText("consumerSupabase", "fetch: fetchWithTimeout,", "Explorer Supabase client must use the fenced fetch");
  requireText("hostSupabase", "createTrackedFetch(() => fetch)", "Host Supabase fetch must go through the restart fence");
  requireText("hostSupabase", "createClient(supabaseUrl, supabaseAnonKey, withRestartFence({", "Host Supabase client must use the fenced fetch");
  if ([...sources.hostFenceWeb.matchAll(/^import\s/gm)].length > 0) {
    failures.push("reloadNetworkFence.web.ts must import nothing — it is in the web boot payload");
  }
  requireText("hostFenceWeb", "export function createTrackedFetch", "the web fence stub must export createTrackedFetch");

  // 6 — U1: a broken update's launch error is escalated or shown, never blank.
  for (const [rootKey, label] of [["consumerRoot", "Consumer"], ["hostRoot", "Host"]]) {
    if (!sources[rootKey].includes("<UpdateLaunchBoundary>")) {
      failures.push(`${label} root must mount UpdateLaunchBoundary — without it a broken update's render error is a blank screen`);
    }
  }
  const hostBoundaryAt = sources.hostRoot.indexOf("<UpdateLaunchBoundary>");
  const hostProvidersAt = sources.hostRoot.indexOf("<QueryClientProvider client={queryClient}>");
  if (hostBoundaryAt === -1 || hostProvidersAt === -1 || hostBoundaryAt > hostProvidersAt) {
    failures.push("Host UpdateLaunchBoundary must wrap the provider tree, so it catches before ORCH-0964's fallback");
  }
  const consumerExportAt = sources.consumerRoot.indexOf("export default Sentry.wrap(function RootLayoutWithLaunchGuard()");
  if (consumerExportAt === -1 || sources.consumerRoot.indexOf("<RootLayout />", consumerExportAt) === -1) {
    failures.push("Consumer root export must wrap RootLayout itself in UpdateLaunchBoundary — Explorer has no other root boundary");
  }
  for (const [a, b, label] of [
    ["consumerLaunchGuard", "hostLaunchGuard", "updateLaunchGuard.ts"],
    ["consumerLaunchRuntime", "hostLaunchRuntime", "updateLaunchRuntime.ts"],
  ]) {
    if (sources[a] !== sources[b]) failures.push(`${label} drifted between app-mobile and mingla-business`);
  }
  const normalizeBoundary = (source) => source.replace(/"(?:\.\.\/)+services\//g, '"<services>/');
  if (normalizeBoundary(sources.consumerLaunchBoundary) !== normalizeBoundary(sources.hostLaunchBoundary)) {
    failures.push("UpdateLaunchBoundary.tsx drifted between app-mobile and mingla-business (only the services path may differ)");
  }
  for (const key of ["consumerLaunchGuard", "hostLaunchGuard"]) {
    if (/^import\s/m.test(sources[key])) failures.push(`${key} must import nothing`);
    const persistAt = sources[key].indexOf("this.dependencies.store.write(serializeUpdateLaunchRecord(next));");
    const raiseAt = sources[key].indexOf("this.dependencies.escalate(error);");
    if (persistAt === -1 || raiseAt === -1 || persistAt > raiseAt) {
      failures.push(`${key} must persist the escalated update id BEFORE raising the fatal — otherwise it can escalate the same update again`);
    }
    for (const [needle, what] of [
      ['return skip("embedded_launch")', "never escalate an embedded launch"],
      ['return skip("already_escalated")', "never escalate one update id twice"],
      ['return skip("in_app_reload")', "never escalate straight after an in-app reload"],
      ['return skip("window_elapsed")', "stop escalating once the launch window has passed"],
      ['return skip("confirmed_good")', "never escalate a confirmed launch"],
    ]) requireText(key, needle, `${key} must ${what}`);
  }
  for (const key of ["consumerLaunchRuntime", "hostLaunchRuntime"]) {
    if (/^import .* from ["'](?!\.\/)/m.test(sources[key])) {
      failures.push(`${key} must import only its sibling pure modules — native modules are required lazily`);
    }
    requireText(key, "if (environment.isDev) return;", `${key} must leave development's red box alone`);
    requireText(key, "escalate: (error) => original(error, true)", `${key} must raise through the handler captured at install`);
    requireText(key, "await createOtaUpdateBridge().reload();", `${key} restart must go through the safeReload bridge`);
  }
  for (const key of ["consumerLaunchBoundary", "hostLaunchBoundary"]) {
    requireText(key, "installUpdateLaunchGuard();", `${key} must install the guard when the root imports it`);
    requireText(key, "if (__DEV__) throw this.state.error;", `${key} must keep development's red box`);
    requireText(key, "return <LaunchErrorRestartScreen />;", `${key} must show the restart screen, never a blank one`);
    requireText(key, "onPress={onRestart}", `${key} restart button must be wired`);
    requireText(key, "requestLaunchErrorRestart()", `${key} restart button must restart through safeReload`);
  }
  for (const key of ["consumerLaunchBoundaryWeb", "hostLaunchBoundaryWeb"]) {
    const imports = [...sources[key].matchAll(/^import (?:type )?.*? from ["']([^"']+)["'];?$/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier !== "react");
    if (imports.length > 0) failures.push(`${key} must import nothing but react — ${imports.join(", ")} would reach the web boot payload`);
    requireText(key, "export function UpdateLaunchBoundary", `${key} must export the same component name`);
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
  // Sentry REACT-NATIVE-1C — a bypassed restart at ONE call site is caught.
  const bypassedRuntime = validate({
    ...sources,
    hostRuntime: sources.hostRuntime.replace(ROUTED_RELOAD, "Updates.reloadAsync()"),
  });
  if (!bypassedRuntime.some((failure) => failure.includes("outside runSafeReload"))) {
    console.error("#2107 self-test: a reloadAsync that bypasses safeReload was not detected");
    process.exit(1);
  }
  const strayFile = "app-mobile/src/hooks/useOtaUpdates.ts";
  const strayReload = validate({
    ...sources,
    byFile: {
      ...sources.byFile,
      [strayFile]: `${sources.byFile[strayFile]}\nexport const restart = () => Updates.reloadAsync();\n`,
    },
  });
  if (!strayReload.some((failure) => failure.includes("restarts the app directly"))) {
    console.error("#2107 self-test: a direct reloadAsync outside the runtime owner was not detected");
    process.exit(1);
  }
  const devSettingsReload = validate({
    ...sources,
    byFile: {
      ...sources.byFile,
      [strayFile]: `${sources.byFile[strayFile]}\nDevSettings.reload();\n`,
    },
  });
  if (devSettingsReload.length === 0) {
    console.error("#2107 self-test: a DevSettings.reload call was not detected");
    process.exit(1);
  }
  const unpausedCore = validate({
    ...sources,
    hostSafeReload: sources.hostSafeReload.replace("for (const step of dependencies.pause)", "for (const step of [])"),
  });
  if (unpausedCore.length === 0) {
    console.error("#2107 self-test: a safeReload core that no longer pauses was not detected");
    process.exit(1);
  }
  const unfencedSupabase = validate({
    ...sources,
    hostSupabase: sources.hostSupabase.replace("withRestartFence({", "({"),
  });
  if (unfencedSupabase.length === 0) {
    console.error("#2107 self-test: a Supabase client outside the restart fence was not detected");
    process.exit(1);
  }
  const unmountedBoundary = validate({
    ...sources,
    consumerRoot: sources.consumerRoot.split("<UpdateLaunchBoundary>").join("<View>"),
  });
  if (!unmountedBoundary.some((failure) => failure.includes("UpdateLaunchBoundary"))) {
    console.error("#2107 self-test: a root without the launch boundary was not detected");
    process.exit(1);
  }
  const raiseBeforePersist = validate({
    ...sources,
    hostLaunchGuard: sources.hostLaunchGuard.replace(
      "this.dependencies.store.write(serializeUpdateLaunchRecord(next));",
      "this.dependencies.store.writeLater(serializeUpdateLaunchRecord(next));",
    ),
  });
  if (raiseBeforePersist.length === 0) {
    console.error("#2107 self-test: a guard that raises before persisting the update id was not detected");
    process.exit(1);
  }
  const blankBoundary = validate({
    ...sources,
    hostLaunchBoundary: sources.hostLaunchBoundary.replace("return <LaunchErrorRestartScreen />;", "return null;"),
  });
  if (blankBoundary.length === 0) {
    console.error("#2107 self-test: a boundary that renders blank instead of the restart screen was not detected");
    process.exit(1);
  }
  const fattenedLaunchWeb = validate({
    ...sources,
    hostLaunchBoundaryWeb: `import { installUpdateLaunchGuard } from "../../services/updateLaunchRuntime";\n${sources.hostLaunchBoundaryWeb}`,
  });
  if (fattenedLaunchWeb.length === 0) {
    console.error("#2107 self-test: an import added to the launch boundary web stub was not detected");
    process.exit(1);
  }
  console.log(
    "#2107 self-test passed (clean green; revert, drift, seeded-row, fattened web stub, reload-before-persist, marker drift, unguarded publish, blocking foreground, bypassed restart, stray restart, DevSettings restart, unpaused core, unfenced Supabase, unmounted launch boundary, raise-before-persist, blank boundary and fattened launch web stub all caught).",
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
