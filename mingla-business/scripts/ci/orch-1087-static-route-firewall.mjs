#!/usr/bin/env node
/**
 * ORCH-1087-S1 — static Home phone-route firewall.
 *
 * Static Home is the phone-browser launcher. It must not send users from that
 * launcher into full Expo/RN routes that were proven to crash, hang, or need a
 * generated account-session URL.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(`ORCH-1087 static route firewall FAIL: ${message}`);
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
  if (!source.includes(token)) {
    fail(`${label} missing required token: ${token}`);
  }
}

function assertNotIncludes(source, token, label) {
  if (source.includes(token)) {
    fail(`${label} must not include forbidden token: ${token}`);
  }
}

const home = read("public/home.html");
const createIsReopened =
  home.includes('href="/event/create"') || home.includes("href='/event/create'");
const unsafeRoutes = [
  "/hub/experiences",
  "/ari",
  "/connect-account-management",
];
const orch1092ReopenedRoutes = [
  ["/hub/events", "data-orch-1092-hub-events-reopened"],
  ["/hub/trips", 'data-orch-1094-core-route="hub-trips"'],
  ["/marketing", "data-orch-1092-marketing-overview-reopened"],
  ["/marketing/campaigns/compose", "data-orch-1092-compose-shell-reopened"],
  ["/account", "data-orch-1092-account-reopened"],
];

if (createIsReopened) {
  assertIncludes(home, "data-orch-1089-create-reopened", "public/home.html");
} else {
  assertNotIncludes(home, 'href="/event/create"', "public/home.html");
  assertNotIncludes(home, "href='/event/create'", "public/home.html");
}

for (const route of unsafeRoutes) {
  assertNotIncludes(home, `href="${route}"`, "public/home.html");
  assertNotIncludes(home, `href='${route}'`, "public/home.html");
}
for (const [route, marker] of orch1092ReopenedRoutes) {
  assertIncludes(home, `href="${route}"`, "public/home.html");
  assertIncludes(home, marker, "public/home.html");
}

for (const token of ["/_expo/static/js/", "expo-metro-runtime", "Stripe account"]) {
  assertNotIncludes(home, token, "public/home.html");
}

const shellTargets = [
  "hub-experiences",
  "ari-assistant",
  "payout-account",
];

if (!createIsReopened) {
  assertIncludes(home, 'href="#create-event"', "public/home.html");
  assertIncludes(home, 'data-shell-link="create-event"', "public/home.html");
}

for (const target of shellTargets) {
  assertIncludes(home, `href="#${target}"`, "public/home.html");
  assertIncludes(home, `data-shell-link="${target}"`, "public/home.html");
}

for (const copy of [
  "Use desktop or the Mingla Business app",
  "not ready for phone browsers yet",
  "known Android Chrome renderer crash",
  "generated secure session link",
  "invalid management link",
  "Payout account",
]) {
  assertIncludes(home, copy, "public/home.html");
}

assertIncludes(home, 'data-tab-link="account"', "public/home.html");
assertIncludes(home, 'data-panel="shell"', "public/home.html");
assertIncludes(home, "showShell(", "public/home.html");
assertIncludes(home, "shellCopy", "public/home.html");

if (existsSync(join("dist", "home.html"))) {
  const distHome = read(join("dist", "home.html"));
  const distCreateIsReopened =
    distHome.includes('href="/event/create"') ||
    distHome.includes("href='/event/create'");
  if (distCreateIsReopened) {
    assertIncludes(distHome, "data-orch-1089-create-reopened", "dist/home.html");
  } else {
    assertNotIncludes(distHome, 'href="/event/create"', "dist/home.html");
    assertIncludes(distHome, 'href="#create-event"', "dist/home.html");
  }
  for (const route of unsafeRoutes) {
    assertNotIncludes(distHome, `href="${route}"`, "dist/home.html");
  }
  for (const [route, marker] of orch1092ReopenedRoutes) {
    assertIncludes(distHome, `href="${route}"`, "dist/home.html");
    assertIncludes(distHome, marker, "dist/home.html");
  }
  for (const target of shellTargets) {
    assertIncludes(distHome, `href="#${target}"`, "dist/home.html");
  }
  assertNotIncludes(distHome, "Stripe account", "dist/home.html");
  assertNotIncludes(distHome, "/_expo/static/js/", "dist/home.html");
}

console.log("ORCH-1087 static route firewall PASS.");
