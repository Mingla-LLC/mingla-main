import { readFileSync } from "node:fs";
import { join } from "node:path";

import { publicTripInstallmentSchedule } from "../../../../packages/offering-rendering/tripInstallmentCapability.ts";

const savedSchedule = {
  deposit_pct: 25,
  installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
};

test("#3859 Explorer old-server unknown and unsupported capability hide a stale schedule", () => {
  expect(publicTripInstallmentSchedule(undefined, savedSchedule)).toBeNull();
  expect(publicTripInstallmentSchedule(false, savedSchedule)).toBeNull();
});

test("#3859 Explorer explicit supported capability preserves the saved schedule", () => {
  expect(publicTripInstallmentSchedule(true, savedSchedule)).toBe(savedSchedule);
});

test("#3859 Explorer canonical reader wiring strips stale schedules before UI state", () => {
  const source = readFileSync(join(__dirname, "../useConsumerTripDetail.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  expect(source).toMatch(/installmentCapabilityAvailable\?:\s*unknown/);
  expect(source).toMatch(
    /publicTripInstallmentSchedule\(\s*p\.installmentCapabilityAvailable,\s*tier\.installmentSchedule,?\s*\)/,
  );
  expect(source).toMatch(/const\s+tiers\s*=\s*rawTiers\.map/);
});
