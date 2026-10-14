import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { publicTripInstallmentSchedule } from "../../../../packages/offering-rendering/tripInstallmentCapability.ts";

const savedSchedule = {
  deposit_pct: 25,
  installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
};

test("#3859 Explorer old-server unknown and unsupported capability hide a stale schedule", () => {
  assert.equal(publicTripInstallmentSchedule(undefined, savedSchedule), null);
  assert.equal(publicTripInstallmentSchedule(false, savedSchedule), null);
});

test("#3859 Explorer explicit supported capability preserves the saved schedule", () => {
  assert.equal(publicTripInstallmentSchedule(true, savedSchedule), savedSchedule);
});

test("#3859 Explorer canonical reader wiring strips stale schedules before UI state", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../useConsumerTripDetail.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  assert.match(source, /installmentCapabilityAvailable\?:\s*unknown/);
  assert.match(
    source,
    /publicTripInstallmentSchedule\(\s*p\.installmentCapabilityAvailable,\s*tier\.installmentSchedule,?\s*\)/,
  );
  assert.match(source, /const\s+tiers\s*=\s*rawTiers\.map/);
});
