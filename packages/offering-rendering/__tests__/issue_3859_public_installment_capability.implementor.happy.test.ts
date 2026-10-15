import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  publicTripInstallmentsAvailable,
  publicTripInstallmentSchedule,
} from "../tripInstallmentCapability.ts";

const savedSchedule = {
  deposit_pct: 25,
  installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
};

Deno.test("#3859 old-server unknown and unsupported capability fail closed", () => {
  for (const capability of [undefined, null, false, "true", 1, {}]) {
    assertEquals(publicTripInstallmentsAvailable(capability), false);
    assertEquals(
      publicTripInstallmentSchedule(capability, savedSchedule),
      null,
    );
  }
});

Deno.test("#3859 explicit supported capability preserves the canonical saved schedule", () => {
  assertEquals(publicTripInstallmentsAvailable(true), true);
  assertStrictEquals(
    publicTripInstallmentSchedule(true, savedSchedule),
    savedSchedule,
  );
});

Deno.test("#3859 stale schedule is hidden and therefore cannot become a selectable plan", () => {
  const oldServerPayload = { tiers: [{ installments: savedSchedule }] };
  const unsupportedPayload = {
    installmentCapabilityAvailable: false,
    tiers: [{ installments: savedSchedule }],
  };
  const supportedPayload = {
    installmentCapabilityAvailable: true,
    tiers: [{ installments: savedSchedule }],
  };

  assertEquals(
    publicTripInstallmentSchedule(
      (oldServerPayload as { installmentCapabilityAvailable?: unknown })
        .installmentCapabilityAvailable,
      oldServerPayload.tiers[0].installments,
    ),
    null,
  );
  assertEquals(
    publicTripInstallmentSchedule(
      unsupportedPayload.installmentCapabilityAvailable,
      unsupportedPayload.tiers[0].installments,
    ),
    null,
  );
  assertStrictEquals(
    publicTripInstallmentSchedule(
      supportedPayload.installmentCapabilityAvailable,
      supportedPayload.tiers[0].installments,
    ),
    savedSchedule,
  );
});
