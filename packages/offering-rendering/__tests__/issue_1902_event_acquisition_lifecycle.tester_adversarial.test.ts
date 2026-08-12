import {
  nextEventAcquisitionBoundaryDelayMs,
  resolveEventAcquisitionState,
} from "../eventAcquisitionLifecycle.ts";

const assertEquals = (actual: unknown, expected: unknown, label: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test("tester adversarial: hostile schedule inputs and operator truth fail closed before timers", () => {
  const now = Date.parse("2026-08-12T04:00:00.000Z");
  const cases = [
    [{ operatorStatus: "cancelled" as const, operatorEndedAtUtc: null, masterEndAtUtc: "2099-01-01T00:00:00.000Z" }, { kind: "cancelled" }],
    [{ operatorStatus: "ended" as const, operatorEndedAtUtc: null, masterEndAtUtc: "2099-01-01T00:00:00.000Z" }, { kind: "ended", reason: "operator_status" }],
    [{ operatorStatus: "live" as const, operatorEndedAtUtc: "2026-08-12T03:59:59.999Z", masterEndAtUtc: "2099-01-01T00:00:00.000Z" }, { kind: "ended", reason: "operator_ended_at" }],
    [{ operatorStatus: "scheduled" as const, operatorEndedAtUtc: null, masterEndAtUtc: "SAT 12 AUG · 8 PM" }, { kind: "unavailable", reason: "master_end_invalid" }],
    [{ operatorStatus: "scheduled" as const, operatorEndedAtUtc: null, masterEndAtUtc: "Infinity" }, { kind: "unavailable", reason: "master_end_invalid" }],
  ] as const;
  for (const [input, expected] of cases) {
    assertEquals(resolveEventAcquisitionState(input, now), expected, "resolution");
    assertEquals(nextEventAcquisitionBoundaryDelayMs([input], now), null, "closed state timer");
  }
});

Deno.test("tester adversarial: offset equality ends immediately and far timers are safely chunked", () => {
  const now = Date.parse("2026-08-12T04:00:00.000Z");
  const equality = { operatorStatus: "live" as const, operatorEndedAtUtc: null, masterEndAtUtc: "2026-08-12T00:00:00-04:00" };
  assertEquals(resolveEventAcquisitionState(equality, now), { kind: "ended", reason: "master_end" }, "offset equality");
  assertEquals(nextEventAcquisitionBoundaryDelayMs([equality], now), null, "equality timer");
  const future = { operatorStatus: "scheduled" as const, operatorEndedAtUtc: null, masterEndAtUtc: "2099-01-01T00:00:00.000Z" };
  assertEquals(nextEventAcquisitionBoundaryDelayMs([future], now), 2_147_483_000, "timer cap");
});
