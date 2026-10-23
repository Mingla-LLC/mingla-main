#!/usr/bin/env node
// MINGLA-INVARIANT: I-3872-DISCOUNT-MONEY-SERVER-ONLY | issue #3872 | Buyer clients display server quotes and submit their digests; they never calculate discounted ticket, venue-order, or reservation totals locally.
// Buyer clients may display a server quote and submit its digest, but may not
// compute discounted ticket, venue-order, or reservation totals locally.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const FILES = {
  cart: "mingla-business/src/components/checkout/CartContext.tsx",
  eventPay: "mingla-business/app/checkout/[eventId]/payment.tsx",
  experiencePay:
    "mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx",
  tripPay: "mingla-business/app/checkout-trip/[tripEventId]/payment.tsx",
  nativeCart: "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  webReservation:
    "mingla-business/src/components/venue/GuestVenueReservation.tsx",
  nativeReservation:
    "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx",
  webOrder:
    "mingla-business/src/components/venueOrdering/useBuyerVenueOrdering.ts",
  nativeOrder:
    "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
};

const FORBIDDEN = [
  ["useCartTotals", "legacy client cart-total calculator"],
  ["priceAllInGbp *", "client-side ticket multiplication"],
  ["priceGbp *", "client-side ticket multiplication"],
  ["saleAllInGbp *", "client-side sale multiplication"],
  ["_shared/discount", "server discount engine imported into a client"],
];

const REQUIRED = {
  cart: ["quote.buyerTotalCents"],
  eventPay: ["activeQuote.quoteDigest", "activeQuote.quoteListDigest"],
  experiencePay: ["activeQuote.quoteDigest", "activeQuote.quoteListDigest"],
  tripPay: ["activeQuote.quoteDigest", "activeQuote.quoteListDigest"],
  nativeCart: ["useTicketQuote", "quoteDigest", "quoteListDigest"],
  webReservation: ["previewGuestVenueReservation", "activePreview.quoteDigest"],
  nativeReservation: ["previewVenueReservation", "activePreview.quoteDigest"],
  webOrder: ["previewQuery.data?.quoteDigest"],
  nativeOrder: ["previewQuery.data?.quoteDigest"],
};

export function validate(sources) {
  const failures = [];
  for (const [key, source] of Object.entries(sources)) {
    for (const [needle, label] of FORBIDDEN) {
      if (source.includes(needle))
        failures.push(`${key}: ${label} (${needle})`);
    }
    for (const needle of REQUIRED[key] ?? []) {
      if (!source.includes(needle)) failures.push(`${key}: missing ${needle}`);
    }
  }
  return failures;
}

function readSources() {
  return Object.fromEntries(
    Object.entries(FILES).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(ROOT, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const good = Object.fromEntries(
    Object.entries(REQUIRED).map(([key, needles]) => [key, needles.join("\n")]),
  );
  const cases = [
    ["accepts server-only fixtures", good, true],
    [
      "rejects local ticket multiplication",
      { ...good, nativeCart: `${good.nativeCart}\npriceAllInGbp * quantity` },
      false,
    ],
    [
      "rejects a missing reservation digest",
      {
        ...good,
        webReservation: good.webReservation.replace(
          "activePreview.quoteDigest",
          "",
        ),
      },
      false,
    ],
  ];
  let failed = 0;
  for (const [name, fixture, shouldPass] of cases) {
    const passed = validate(fixture).length === 0;
    if (passed !== shouldPass) {
      failed += 1;
      console.error(`FAIL ${name}`);
    } else {
      console.log(`PASS ${name}`);
    }
  }
  if (failed > 0) process.exit(1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  try {
    const failures = validate(readSources());
    if (failures.length > 0) {
      console.error("I-3872-DISCOUNT-MONEY-SERVER-ONLY violations:");
      for (const failure of failures) console.error(`- ${failure}`);
      process.exit(1);
    }
    console.log("PASS I-3872-DISCOUNT-MONEY-SERVER-ONLY");
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(2);
  }
}
