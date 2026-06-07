#!/usr/bin/env node
/**
 * ORCH-1096 — Business Web Marketing Composer parity guard.
 *
 * Rejects the ORCH-1095 stripped phone shell for /marketing/campaigns/compose
 * and verifies the replacement browser runtime keeps the route bounded,
 * service-contract aligned, and native-module quarantined.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const INJECTOR = "scripts/inject-mobile-blur-css.mjs";
const RUNTIME = "scripts/mobile-web-marketing-composer-runtime.js";
const COMPOSE_ROUTE = "app/(tabs)/marketing/campaigns/compose.tsx";

const FORBIDDEN_NATIVE_TOKENS = [
  "@react-native-community/datetimepicker",
  "react-native-pell-rich-editor",
  "react-native-webview",
  "expo-image-picker",
  "expo-file-system",
  "react-native-compressor",
  "react-native-video-trim",
  "@stripe/connect-js",
  "@stripe/react-connect-js",
];

function fail(message) {
  console.error(`ORCH-1096 business web Marketing Composer parity FAIL: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function assertIncludes(source, token, label) {
  if (!source.includes(token)) fail(`${label} missing required token: ${token}`);
}

function assertNotIncludes(source, token, label) {
  if (source.includes(token)) fail(`${label} must not include forbidden token: ${token}`);
}

function sourceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start === -1) fail(`could not find start token ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  if (end === -1) fail(`could not find end token ${endToken}`);
  return source.slice(start, end);
}

function deferredScriptSrcsFromHtml(html) {
  const match = html.match(/var scripts=(\[[^\]]*\]);function isPhone/);
  if (match === null) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function scriptSrcsFromHtml(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)]
    .map((match) => match[1])
    .filter((src) => src.includes("/_expo/static/js/web/"));
}

function distPathForScript(src, root = "dist") {
  return join(root, src.split("?")[0].replace(/^\//, ""));
}

function walkFiles(root, acc = []) {
  if (!existsSync(root)) return acc;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkFiles(path, acc);
    else if (path.endsWith(".js")) acc.push(path);
  }
  return acc;
}

const injector = read(INJECTOR);
assertIncludes(injector, "mobile-web-marketing-composer-runtime.js", INJECTOR);
assertIncludes(injector, "COMPOSER_RUNTIME_SOURCE", INJECTOR);
assertIncludes(injector, "renderMarketingComposerRoute", INJECTOR);

const composeBranch = sourceBetween(
  injector,
  'if(path==="/marketing/campaigns/compose")',
  'if(path==="/hub/trips")',
);
assertIncludes(composeBranch, "renderMarketingComposerRoute", "compose preboot branch");
assertNotIncludes(composeBranch, 'aria-label="Subject" placeholder="What should buyers know?"', "compose preboot branch");
assertNotIncludes(composeBranch, 'aria-label="Message" placeholder="Write your blast..."', "compose preboot branch");
assertNotIncludes(composeBranch, 'btn("/marketing","Return to marketing",true)', "compose preboot branch");

if (!existsSync(RUNTIME)) {
  fail(`${RUNTIME} is missing`);
}
const runtime = read(RUNTIME);
for (const token of [
  "data-orch-1096-browser-composer",
  "data-orch-1096-audience-picker",
  "data-orch-1096-template-drawer",
  "data-orch-1096-personalization-chip",
  "data-orch-1096-event-chip",
  "data-orch-1096-preview",
  "data-orch-1096-save-draft",
  "data-orch-1096-schedule-picker",
  "data-orch-1096-review",
  "contenteditable=\"true\"",
  "marketing_campaigns",
  "marketing_audiences",
  "marketing_templates",
  "events_with_master_date_view",
  "scheduleSend",
  "createDraft",
  "updateDraft",
  "scheduledTimeIsFuture",
  "Pick a send time in the future.",
  "cancelPendingAutosave",
  "autosaveBlocked",
  "saveDraft(false, { autosave: true })",
]) {
  assertIncludes(runtime, token, RUNTIME);
}
const validationBlock = sourceBetween(runtime, "function validationMessage()", "function syncFieldsFromDom()");
assertIncludes(validationBlock, "scheduledTimeIsFuture()", "schedule validation");
assertIncludes(validationBlock, "Pick a send time in the future.", "schedule validation");
const markDirtyBlock = sourceBetween(runtime, "function markDirty()", "function updateStatusOnly()");
assertIncludes(markDirtyBlock, "autosaveBlocked()", "autosave guard");
assertIncludes(markDirtyBlock, "saveDraft(false, { autosave: true })", "autosave guard");
const confirmBlock = sourceBetween(runtime, "function confirmSchedule()", "function formatScheduledLabel()");
assertIncludes(confirmBlock, "syncFieldsFromDom()", "schedule confirmation validation");
assertIncludes(confirmBlock, "cancelPendingAutosave()", "schedule confirmation autosave guard");
assertIncludes(confirmBlock, 'state.activePanel = "success"', "schedule confirmation autosave guard");
for (const token of FORBIDDEN_NATIVE_TOKENS) {
  assertNotIncludes(runtime, token, RUNTIME);
}
for (const copy of ["Connect Stripe", "Payments & Stripe", "Stripe account"]) {
  assertNotIncludes(runtime, copy, RUNTIME);
}

const composeRoute = read(COMPOSE_ROUTE);
assertIncludes(composeRoute, "ComposerV2Editor", COMPOSE_ROUTE);
assertIncludes(composeRoute, "SchedulePickerSheet", COMPOSE_ROUTE);
assertIncludes(composeRoute, "EmailPreviewPane", COMPOSE_ROUTE);
assertNotIncludes(composeRoute, "redirectMobileBusinessWebToStaticHome", COMPOSE_ROUTE);

if (existsSync(join("dist", "index.html"))) {
  const distIndex = read(join("dist", "index.html"));
  assertIncludes(distIndex, "data-orch-1096-browser-composer", "dist/index.html");
  assertIncludes(distIndex, "renderMarketingComposerRoute", "dist/index.html");
  const phoneBootPaths = [...scriptSrcsFromHtml(distIndex), ...deferredScriptSrcsFromHtml(distIndex)]
    .map((src) => distPathForScript(src))
    .filter((path) => existsSync(path));
  const phoneBoot = phoneBootPaths.reduce((sum, path) => sum + statSync(path).size, 0);
  const bootSource = phoneBootPaths.map((path) => read(path)).join("\n");
  for (const token of FORBIDDEN_NATIVE_TOKENS) {
    assertNotIncludes(bootSource, token, "phone boot chunks");
  }
  for (const token of FORBIDDEN_NATIVE_TOKENS) {
    assertNotIncludes(distIndex, token, "dist/index.html injected runtime");
  }
  const allWebJs = walkFiles(join("dist", "_expo/static/js/web"));
  const composerChunk = allWebJs.find((path) => read(path).includes("ComposerV2Editor"));
  if (composerChunk !== undefined) {
    const bytes = statSync(composerChunk).size;
    console.log(`ORCH-1096 Expo composer chunk evidence ${basename(composerChunk)} ${bytes}`);
  }
  console.log(`ORCH-1096 phone preboot evidence phoneBoot=${phoneBoot}; composerRuntime=inline-preboot`);
}

console.log("ORCH-1096 business web Marketing Composer parity guard PASS");
