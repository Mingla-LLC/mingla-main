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

Deno.test("issue #2582 tester adversarial: canonical occurrence truth is all-or-nothing and operator-owned", () => {
  const twoDay = [
    {
      id: "day-2",
      startAt: "2026-08-30T13:00:00+01:00",
      endAt: "2026-08-30T20:00:00+01:00",
      timezone: "Africa/Lagos",
      isMaster: false,
    },
    {
      id: "day-1",
      startAt: "2026-08-29T12:00:00Z",
      endAt: "2026-08-29T19:00:00Z",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
  ];
  const input = {
    operatorStatus: "scheduled" as const,
    operatorEndedAtUtc: null,
    terminalSource: { kind: "occurrences" as const, value: twoDay },
  };

  assertEquals(
    resolveEventAcquisitionState(input, Date.parse("2026-08-30T18:59:59.999Z")),
    { kind: "current" },
    "one millisecond before final end",
  );
  assertEquals(
    resolveEventAcquisitionState(input, Date.parse("2026-08-30T19:00:00Z")),
    { kind: "ended", reason: "master_end" },
    "final-end equality",
  );
  assertEquals(
    resolveEventAcquisitionState(
      { ...input, terminalSource: { ...input.terminalSource, value: [...twoDay].reverse() } },
      Date.parse("2026-08-30T08:00:00Z"),
    ),
    { kind: "current" },
    "row order and between-day gap",
  );

  const malformedCases: Array<[string, unknown, "occurrences_missing" | "occurrences_invalid"]> = [
    ["missing", null, "occurrences_missing"],
    ["empty", [], "occurrences_missing"],
    ["non-array", { id: "day-1" }, "occurrences_missing"],
    [
      "mixed malformed future row",
      [...twoDay, { id: "bad", startAt: "2026-09-01T12:00:00Z", endAt: "not-a-date" }],
      "occurrences_invalid",
    ],
    [
      "reversed interval",
      [{ id: "reverse", startAt: "2026-08-30T20:00:00Z", endAt: "2026-08-30T19:00:00Z" }],
      "occurrences_invalid",
    ],
    [
      "offset-free instant",
      [{ id: "local", startAt: "2026-08-30T12:00:00", endAt: "2026-08-30T19:00:00" }],
      "occurrences_invalid",
    ],
    ["duplicate id", [...twoDay, { ...twoDay[1] }], "occurrences_invalid"],
  ];
  for (const [label, value, reason] of malformedCases) {
    assertEquals(
      resolveEventAcquisitionState(
        {
          operatorStatus: "scheduled",
          operatorEndedAtUtc: null,
          terminalSource: { kind: "occurrences", value },
          masterEndAtUtc: "2099-01-01T00:00:00Z",
        },
        Date.parse("2026-08-30T08:00:00Z"),
      ),
      { kind: "unavailable", reason },
      `${label} fails closed without scalar fallback`,
    );
  }

  assertEquals(
    resolveEventAcquisitionState(
      { ...input, operatorStatus: "cancelled" },
      Date.parse("2026-08-30T08:00:00Z"),
    ),
    { kind: "cancelled" },
    "cancelled precedence",
  );
  assertEquals(
    resolveEventAcquisitionState(
      { ...input, operatorStatus: "ended" },
      Date.parse("2026-08-30T08:00:00Z"),
    ),
    { kind: "ended", reason: "operator_status" },
    "operator status precedence",
  );
  assertEquals(
    resolveEventAcquisitionState(
      { ...input, operatorEndedAtUtc: "2099-01-01T00:00:00Z" },
      Date.parse("2026-08-30T08:00:00Z"),
    ),
    { kind: "ended", reason: "operator_ended_at" },
    "future finite operator-ended precedence remains byte-compatible",
  );
  assertEquals(
    resolveEventAcquisitionState(
      { ...input, operatorEndedAtUtc: "invalid" },
      Date.parse("2026-08-30T08:00:00Z"),
    ),
    { kind: "current" },
    "invalid operator-ended value does not poison canonical schedule",
  );
});
