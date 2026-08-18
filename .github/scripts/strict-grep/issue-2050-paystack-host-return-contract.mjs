#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SERVERS = [
  "supabase/functions/ticket-checkout-create/index.ts",
  "supabase/functions/rsvp-contribution-create/index.ts",
  "supabase/functions/venue-order-create/index.ts",
  "supabase/functions/venue-reservation-create/index.ts",
];
const CLIENTS = [
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
  "app-mobile/src/services/venueReservationService.ts",
  "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  "app-mobile/src/services/venueOrderingService.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
  "mingla-business/src/services/ticketCheckoutService.ts",
  "mingla-business/src/services/rsvpEvents.ts",
];
const CALLBACKS = {
  "supabase/functions/ticket-checkout-create/index.ts":
    "${PRODUCTION_BUSINESS_WEB_ORIGIN}/${callbackSurface}/${eventId}/confirm?cs=paystack&csi=",
  "supabase/functions/rsvp-contribution-create/index.ts":
    "buildContributionPaystackReturnUrl(",
  "supabase/functions/venue-order-create/index.ts":
    "${callbackOrigin}/o/venue/${",
  "supabase/functions/venue-reservation-create/index.ts":
    "${PRODUCTION_BUSINESS_WEB_ORIGIN}/reserve/${",
  "supabase/functions/venue-order-staff/index.ts":
    "${PRODUCTION_BUSINESS_WEB_ORIGIN}/o/venue/${",
};
// issue #2227 (2026-08-18) — AMENDED, client-side callback half only.
//
// This map used to pin the literal each client passed as the SECOND argument of
// WebBrowser.openAuthSessionAsync — the server's https Host return URL — on the
// premise that it was the callback iOS would auto-close the in-app browser on.
// That premise is false on every shipped iOS build and has never been true in
// this repo's lifetime:
//
//   expo-web-browser >= 15 (pinned since 2025-10-07, SDK 54) routes an https
//   redirect to ASWebAuthenticationSession(callback: .https(host:path:)) on iOS
//   >= 17.4. That API REQUIRES an Associated Domains entitlement carrying the
//   `webcredentials` service for the host. Neither app declares one — both
//   app-mobile/app.json and mingla-business/app.json list `applinks:` only —
//   and the served apple-app-site-association at host.usemingla.com has no
//   `webcredentials` key at all. iOS therefore destroys the session at start(),
//   before it draws a pixel, and reports it as a user cancellation.
//
// Measured on iOS 26.5, 2026-08-18, one probe per literal this map used to pin:
//   https://host.usemingla.com/o/venue/    -> cancel in 119ms, entitlement error
//   https://host.usemingla.com/reserve/x   -> cancel in  87ms, entitlement error
//   https://host.usemingla.com/checkout/…  -> cancel in  97ms, entitlement error
// On Android the auto-close never existed either: expo-web-browser's own
// polyfill says "Users on Android need to manually press the 'x' button in
// Chrome Custom Tabs, sadly" and does not implement dismissBrowser there.
//
// This gate landed 2026-08-14, ten months after that expo-web-browser pin, so
// the auto-close it asserted was already dead when it was written: it passed by
// matching a literal whose runtime behaviour had died. See #2227.
//
// WHAT IS UNCHANGED: the server still builds the https Host return URL, every
// client still sends `returnContract: "host_v1"`, and Paystack still redirects
// the buyer to that Host page. Those halves are asserted above and are NOT
// weakened here. What changed is only that the client no longer hands that URL
// to iOS as an ASWebAuthenticationSession callback — it opens the provider with
// WebBrowser.openBrowserAsync, which iOS actually presents.
//
// Invariant: I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION (#2227).
const BROWSER_CLIENTS = [
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
  "app-mobile/src/hooks/useReserveTable.ts",
  "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
];
const OPEN_BROWSER = "WebBrowser.openBrowserAsync(";
// The CALL, not the word: #2227 requires a protective comment naming the
// forbidden API directly above the replacement call.
const AUTH_SESSION_CALL = /openAuthSessionAsync\s*\(/;

const fail = (message) => { throw new Error(`[issue-2050] ${message}`); };

export function validate(files) {
  for (const file of SERVERS) {
    const source = files[file];
    const branch = source.indexOf('provider === "paystack"');
    const marker = source.indexOf('body.returnContract !== "host_v1"', branch);
    const rejection = source.indexOf('error: "upgrade_required"', marker);
    const initialize = source.indexOf("paystackInitializeTransaction({", branch);
    if (branch < 0 || marker < branch || rejection < marker || initialize < 0 || marker > initialize) {
      fail(`${file} does not reject an old native contract before Paystack initialization`);
    }
  }
  for (const file of CLIENTS) {
    if (!files[file].includes('returnContract: "host_v1"')) {
      fail(`${file} does not send the Host return contract`);
    }
  }
  for (const [file, required] of Object.entries(CALLBACKS)) {
    const source = files[file];
    if (!source.includes(required)) {
      fail(`${file} does not return Paystack to its real Host status surface`);
    }
    if (
      source.includes('Deno.env.get("PAYSTACK_CALLBACK_BASE")') ||
      source.includes('"https://host.usemingla.com/pay/callback"')
    ) {
      fail(`${file} still depends on the retired generic callback`);
    }
  }
  for (const file of BROWSER_CLIENTS) {
    const source = files[file];
    // Falsifiable half A: the provider page must still be opened, by the
    // primitive iOS will actually present. Delete the call and this fails.
    if (!source.includes(OPEN_BROWSER)) {
      fail(`${file} no longer opens the provider page with ${OPEN_BROWSER}`);
    }
    // Falsifiable half B: no reverting to the API iOS refuses. Restore an
    // openAuthSessionAsync(...) call here and this fails.
    if (AUTH_SESSION_CALL.test(source)) {
      fail(
        `${file} hands the browser back to openAuthSessionAsync — iOS >= 17.4 ` +
          `destroys that session without a \`webcredentials\` Associated Domain, ` +
          `so the buyer never sees the payment page (#2227)`,
      );
    }
  }
}

function load() {
  const files = new Set([
    ...SERVERS,
    ...CLIENTS,
    ...Object.keys(CALLBACKS),
    ...BROWSER_CLIENTS,
  ]);
  return Object.fromEntries([...files].map((file) => [
    file,
    fs.readFileSync(path.join(ROOT, file), "utf8"),
  ]));
}

if (process.argv.includes("--self-test")) {
  const good = load();
  validate(good);
  for (const target of [SERVERS[0], SERVERS[2], CLIENTS[0], CLIENTS[5]]) {
    const bad = { ...good, [target]: good[target].replaceAll("host_v1", "legacy_v0") };
    let rejected = false;
    try { validate(bad); } catch { rejected = true; }
    if (!rejected) fail(`BAD fixture passed for ${target}`);
  }
  for (const [target, required] of [
    [Object.keys(CALLBACKS)[0], Object.values(CALLBACKS)[0]],
  ]) {
    const bad = { ...good, [target]: good[target].replace(required, "removed") };
    let rejected = false;
    try { validate(bad); } catch { rejected = true; }
    if (!rejected) fail(`BAD callback fixture passed for ${target}`);
  }
  // #2227 client-callback half — BOTH directions must still bite, on EVERY
  // browser client, or the amendment would have quietly stopped checking.
  for (const target of BROWSER_CLIENTS) {
    const dropped = {
      ...good,
      [target]: good[target].replaceAll(OPEN_BROWSER, "notTheBrowser("),
    };
    let rejected = false;
    try { validate(dropped); } catch { rejected = true; }
    if (!rejected) fail(`BAD fixture passed: ${target} stopped opening the provider page`);

    const reverted = {
      ...good,
      [target]: good[target].replace(
        OPEN_BROWSER,
        "WebBrowser.openAuthSessionAsync(returnUrl, ",
      ),
    };
    rejected = false;
    try { validate(reverted); } catch { rejected = true; }
    if (!rejected) fail(`BAD fixture passed: ${target} reverted to openAuthSessionAsync`);
  }
  console.log(
    "PASS issue-2050 Paystack Host return contract: GOOD + 5 contract BAD fixtures + 8 #2227 browser-client BAD fixtures",
  );
} else {
  validate(load());
  console.log("PASS issue-2050 Paystack Host return contract");
}
