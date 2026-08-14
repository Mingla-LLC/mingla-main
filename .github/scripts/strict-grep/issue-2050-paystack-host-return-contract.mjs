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
const RETURN_CLIENTS = {
  "app-mobile/src/payments/nativeCheckoutFlow.ts": "data.returnUrl",
  "app-mobile/src/hooks/useReserveTable.ts": "created.returnUrl",
  "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts":
    'const NG_RETURN_PREFIX = "https://host.usemingla.com/o/venue/"',
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts": "data.returnUrl",
};

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
  for (const [file, required] of Object.entries(RETURN_CLIENTS)) {
    if (!files[file].includes(required)) {
      fail(`${file} cannot close the browser on the server-returned Host route`);
    }
  }
}

function load() {
  const files = new Set([
    ...SERVERS,
    ...CLIENTS,
    ...Object.keys(CALLBACKS),
    ...Object.keys(RETURN_CLIENTS),
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
    [Object.keys(RETURN_CLIENTS)[0], Object.values(RETURN_CLIENTS)[0]],
  ]) {
    const bad = { ...good, [target]: good[target].replace(required, "removed") };
    let rejected = false;
    try { validate(bad); } catch { rejected = true; }
    if (!rejected) fail(`BAD callback fixture passed for ${target}`);
  }
  console.log("PASS issue-2050 Paystack Host return contract: GOOD + 6 BAD fixtures");
} else {
  validate(load());
  console.log("PASS issue-2050 Paystack Host return contract");
}
