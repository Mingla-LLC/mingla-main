#!/usr/bin/env node
/**
 * ORCH-1088 — Business Web Event Creator phone-browser parity guard.
 *
 * Locks the static Home route firewall, the bounded /event/create state
 * machine, static-safe web exits, provider-neutral publish copy, and the
 * launch-approved phone-web cover upload degradation.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(`ORCH-1088 event creator phone parity FAIL: ${message}`);
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

function stripCommentLines(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join("\n");
}

const home = read("public/home.html");
const createRoute = read("app/event/create.tsx");
const editRoute = read(join("app", "event", "[id]", "edit.tsx"));
const wizard = read("src/components/event/EventCreatorWizard.tsx");
const preview = read("src/components/event/CreatorStep7Preview.tsx");
const stripeBlockedCard = read("src/components/offering/StripeBlockedCard.tsx");
const coverPicker = read("src/components/ui/CoverPicker.tsx");
const reanimatedWebStub = read("src/shims/reactNativeReanimatedWebStub.js");

const createIsReopened =
  home.includes('href="/event/create"') ||
  home.includes("href='/event/create'");
if (createIsReopened && !home.includes("data-orch-1088-create-reopened")) {
  if (!home.includes("data-orch-1089-create-reopened")) {
    fail("static Home may link Create to /event/create only with an ORCH reopen marker");
  }
}
if (!createIsReopened) {
  assertIncludes(home, 'href="#create-event"', "public/home.html");
  assertIncludes(home, 'data-shell-link="create-event"', "public/home.html");
}

for (const route of ["/hub/experiences", "/hub/trips", "/ari", "/connect-account-management"]) {
  assertNotIncludes(home, `href="${route}"`, "public/home.html");
  assertNotIncludes(home, `href='${route}'`, "public/home.html");
}
for (const [route, marker] of [
  ["/hub/events", "data-orch-1092-hub-events-reopened"],
  ["/marketing", "data-orch-1092-marketing-overview-reopened"],
  ["/marketing/campaigns/compose", "data-orch-1092-compose-shell-reopened"],
  ["/account", "data-orch-1092-account-reopened"],
]) {
  if (home.includes(`href="${route}"`) || home.includes(`href='${route}'`)) {
    assertIncludes(home, marker, "public/home.html");
  }
}
for (const token of ["/_expo/static/js/", "expo-metro-runtime", "Stripe account"]) {
  assertNotIncludes(home, token, "public/home.html");
}

for (const token of [
  "ROUTE_BOOT_TIMEOUT_MS",
  "DRAFT_HYDRATION_TIMEOUT_MS",
  "CreateRouteTerminalState",
  "signed_out",
  "auth_timeout",
  "auth_error",
  "brand_error",
  "no_brand",
  "draft_hydration_timeout",
  "console.warn(\"[event/create] terminal-state\"",
  "Sign in to create an event.",
  "We could not finish sign-in.",
  "Create or select a brand before starting an event.",
  "This browser cannot save drafts right now.",
  "Getting your brand ready",
  "Loading local drafts",
]) {
  assertIncludes(createRoute, token, "app/event/create.tsx");
}
assertIncludes(createRoute, "goToStaticHome", "app/event/create.tsx");

for (const token of [
  "const bezier",
  "RNEasing?.bezier",
  "bezier,",
  "const runOnUI",
  "runOnUI,",
]) {
  assertIncludes(reanimatedWebStub, token, "src/shims/reactNativeReanimatedWebStub.js");
}

for (const token of [
  "MISSING_DRAFT_TIMEOUT_MS",
  "missing-draft-timeout",
  "safeEventsExitRoute",
  '"/home#hub-events"',
  "We could not load this draft.",
]) {
  assertIncludes(editRoute, token, "app/event/[id]/edit.tsx");
}
assertNotIncludes(editRoute, 'router.replace("/(tabs)/hub/events" as never);', "app/event/[id]/edit.tsx");
assertIncludes(wizard, 'href: "/(tabs)/hub/events"', "EventCreatorWizard desktop rail keeps desktop Hub link only");

for (const token of [
  "isPhoneWeb",
  "Device cover uploads are available on desktop or in the app for now.",
  "disabled={uploading || disabled || isPhoneWeb}",
]) {
  assertIncludes(coverPicker, token, "src/components/ui/CoverPicker.tsx");
}

assertIncludes(wizard, "Connect a bank to publish paid tickets.", "EventCreatorWizard publish copy");
assertIncludes(preview, "StripeBlockedCard", "CreatorStep7Preview publish card");
assertIncludes(stripeBlockedCard, "Connect a bank", "StripeBlockedCard publish copy");
assertNotIncludes(stripCommentLines(stripeBlockedCard), "Connect Stripe", "StripeBlockedCard user-facing publish copy");

if (existsSync(join("dist", "home.html"))) {
  const distHome = read(join("dist", "home.html"));
  assertNotIncludes(distHome, "Stripe account", "dist/home.html");
  assertNotIncludes(distHome, "/_expo/static/js/", "dist/home.html");
}

if (existsSync(join("dist", "index.html"))) {
  const distIndex = read(join("dist", "index.html"));
  assertIncludes(distIndex, "mingla-mobile-web-home-preboot", "dist/index.html");
  assertIncludes(distIndex, "mingla-mobile-web-no-blur", "dist/index.html");
}

console.log("ORCH-1088 event creator phone parity PASS.");
