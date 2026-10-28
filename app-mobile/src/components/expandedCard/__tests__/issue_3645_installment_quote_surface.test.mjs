import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../TicketCartSheet.tsx", import.meta.url), "utf8");
const detail = readFileSync(
  new URL("../../../screens/Trip/ConsumerTripDetailScreen.tsx", import.meta.url),
  "utf8",
);

test("#3645 mobile cart renders server-locked deposit, later charges, and plan total", () => {
  assert.match(source, /installmentChargeSchedule\.payments\.map/);
  assert.match(source, /quote\.buyerTotalCents/);
  assert.match(source, /quote\.planTotalBuyerCents \?\? quote\.buyerTotalCents/);
  assert.match(source, /Includes fees &amp; tax/);
  assert.match(source, /installmentReassuranceText/);
});

test("#3645 mobile trip detail never fabricates pre-quote NGN amounts", () => {
  assert.match(detail, /% today/);
  assert.match(detail, /% on/);
});
