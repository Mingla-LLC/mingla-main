#!/usr/bin/env node
/**
 * ORCH-1089 — Business Web signed-in Event Creator wizard parity guard.
 *
 * Locks the Home Create reopen marker, static-safe edit recovery,
 * retryable current-brand query failures, the real Step 1-7 wizard, web
 * shim safety, and provider-neutral seller/payout copy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(`ORCH-1089 signed-in Event Creator wizard FAIL: ${message}`);
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
const brandRecovery = read("src/hooks/useCurrentBrandRecovery.ts");
const wizard = read("src/components/event/EventCreatorWizard.tsx");
const step1 = read("src/components/event/CreatorStep1Basics.tsx");
const step2 = read("src/components/event/CreatorStep2When.tsx");
const step3 = read("src/components/event/CreatorStep3Where.tsx");
const step4 = read("src/components/event/CreatorStep4Cover.tsx");
const step5 = read("src/components/event/CreatorStep5Tickets.tsx");
const step6 = read("src/components/event/CreatorStep6Settings.tsx");
const step7 = read("src/components/event/CreatorStep7Preview.tsx");
const ticketTierSheet = read("src/components/event/TicketTierEditSheet.tsx");
const coverPicker = read("src/components/ui/CoverPicker.tsx");
const sheetWeb = read("src/components/ui/Sheet.web.tsx");
const reanimatedWebStub = read("src/shims/reactNativeReanimatedWebStub.js");
const stripeBlockedCard = read("src/components/offering/StripeBlockedCard.tsx");

const createIsReopened =
  home.includes('href="/event/create"') || home.includes("href='/event/create'");
if (!createIsReopened) {
  fail("static Home Create must be reopened to /event/create for ORCH-1089");
}
assertIncludes(home, "data-orch-1089-create-reopened", "public/home.html");
assertNotIncludes(home, 'data-shell-link="create-event"', "public/home.html reopened Create action");

for (const route of ["/hub/experiences", "/ari", "/connect-account-management"]) {
  assertNotIncludes(home, `href="${route}"`, "public/home.html");
  assertNotIncludes(home, `href='${route}'`, "public/home.html");
}
if (home.includes('href="/hub/trips"') || home.includes("href='/hub/trips'")) {
  assertIncludes(home, 'data-orch-1094-core-route="hub-trips"', "public/home.html");
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
  "brand_error",
  "no_brand",
  "currentBrandRecovery.isError",
  "useDraftEventStore.getState().createDraft(currentBrandId)",
  "`/event/${draft.id}/edit?step=0`",
  "goToStaticHome",
]) {
  assertIncludes(createRoute, token, "app/event/create.tsx");
}

for (const token of [
  "CURRENT_BRAND_QUERY_ERROR",
  "hasCurrentBrandRecoveryQueryError",
  "brandsQuery.isError",
  "creatorAccount.isError",
  "hasQueryError ? CURRENT_BRAND_QUERY_ERROR : errorMessage",
]) {
  assertIncludes(brandRecovery, token, "src/hooks/useCurrentBrandRecovery.ts");
}

assertIncludes(editRoute, "safeEventsExitRoute", "app/event/[id]/edit.tsx");
assertIncludes(editRoute, "setMissingDraftTimedOut(true)", "app/event/[id]/edit.tsx");
assertIncludes(editRoute, "We could not load this draft.", "app/event/[id]/edit.tsx");
assertNotIncludes(editRoute, 'router.replace("/(tabs)/home" as never)', "app/event/[id]/edit.tsx");

for (const token of [
  "CreatorStep1Basics",
  "CreatorStep2When",
  "CreatorStep3Where",
  "CreatorStep4Cover",
  "CreatorStep5Tickets",
  "CreatorStep6Settings",
  "CreatorStep7Preview",
  "label=\"Continue\"",
  "onPublishDraft",
]) {
  assertIncludes(wizard, token, "EventCreatorWizard");
}
assertIncludes(step1, 'accessibilityLabel="Event name"', "CreatorStep1Basics");
assertIncludes(step1, 'accessibilityLabel="Event description"', "CreatorStep1Basics");
assertIncludes(step2, 'type="date"', "CreatorStep2When");
assertIncludes(step2, 'type="time"', "CreatorStep2When");
assertIncludes(step2, 'showPicker', "CreatorStep2When");
assertIncludes(step3, "MapboxAddressInput", "CreatorStep3Where");
assertIncludes(step4, "CoverPickerSheet", "CreatorStep4Cover");
assertIncludes(step5, "TicketTierEditSheet", "CreatorStep5Tickets");
assertIncludes(ticketTierSheet, 'type="datetime-local"', "TicketTierEditSheet");
assertIncludes(step6, "Visibility", "CreatorStep6Settings");
assertIncludes(step7, "StripeBlockedCard", "CreatorStep7Preview");

assertIncludes(coverPicker, "isPhoneWeb", "CoverPicker phone-web degradation");
assertIncludes(coverPicker, "Device cover uploads are available on desktop or in the app for now.", "CoverPicker phone-web degradation");
assertIncludes(sheetWeb, "from \"./SheetMobile\"", "Sheet.web import boundary");
assertIncludes(reanimatedWebStub, "const bezier", "Reanimated web stub");
assertIncludes(reanimatedWebStub, "const runOnUI", "Reanimated web stub");

assertIncludes(wizard, "Connect a bank to publish paid tickets.", "EventCreatorWizard provider-neutral copy");
assertIncludes(stripeBlockedCard, "Connect a bank", "StripeBlockedCard provider-neutral copy");
assertNotIncludes(stripCommentLines(stripeBlockedCard), "Connect Stripe", "StripeBlockedCard user-facing copy");

console.log("ORCH-1089 signed-in Event Creator wizard PASS.");
