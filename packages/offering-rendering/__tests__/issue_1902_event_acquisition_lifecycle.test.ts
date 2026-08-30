import { nextEventAcquisitionBoundaryDelayMs, resolveEventAcquisitionState } from "../eventAcquisitionLifecycle.ts";
import { resolveEventTerminal } from "../eventAcquisitionLifecycle.ts";

const NOW = Date.parse("2026-08-11T12:00:00Z");
const cases = [
  ["cancelled", null, null, "cancelled"],
  ["ended", null, "2026-08-12T12:00:00Z", "ended"],
  ["scheduled", "2026-08-10T12:00:00Z", "2026-08-12T12:00:00Z", "ended"],
  ["scheduled", null, null, "unavailable"],
  ["scheduled", null, "not-a-date", "unavailable"],
  ["scheduled", null, "2026-08-11T12:00:00Z", "ended"],
  ["live", null, "2026-08-12T12:00:00Z", "current"],
  ["scheduled", "bad-operator-marker", "2026-08-12T12:00:00+00:00", "current"],
] as const;

Deno.test("issue #1902 resolves acquisition lifecycle deterministically", () => {
  for (const [operatorStatus, operatorEndedAtUtc, masterEndAtUtc, expected] of cases) {
    const actual = resolveEventAcquisitionState({ operatorStatus, operatorEndedAtUtc, masterEndAtUtc }, NOW).kind;
    if (actual !== expected) throw new Error(`expected ${expected}, received ${actual}`);
  }
});

Deno.test("issue #1902 preserves reasons, equality, offsets, and safe boundary delay", () => {
  const equal = resolveEventAcquisitionState({ operatorStatus: "scheduled", operatorEndedAtUtc: null, masterEndAtUtc: "2026-08-11T08:00:00-04:00" }, NOW);
  if (equal.kind !== "ended" || equal.reason !== "master_end") throw new Error("offset equality must end");
  const missing = resolveEventAcquisitionState({ operatorStatus: "live", operatorEndedAtUtc: null, masterEndAtUtc: null }, NOW);
  if (missing.kind !== "unavailable" || missing.reason !== "master_end_missing") throw new Error("missing reason lost");
  const invalid = resolveEventAcquisitionState({ operatorStatus: "live", operatorEndedAtUtc: null, masterEndAtUtc: "bad" }, NOW);
  if (invalid.kind !== "unavailable" || invalid.reason !== "master_end_invalid") throw new Error("invalid reason lost");
  const oneSecond = nextEventAcquisitionBoundaryDelayMs([{ operatorStatus: "live", operatorEndedAtUtc: null, masterEndAtUtc: "2026-08-11T12:00:01Z" }], NOW);
  if (oneSecond !== 1_000) throw new Error(`boundary delay mismatch: ${oneSecond}`);
  const capped = nextEventAcquisitionBoundaryDelayMs([{ operatorStatus: "live", operatorEndedAtUtc: null, masterEndAtUtc: "2099-08-11T12:00:01Z" }], NOW);
  if (capped !== 2_147_483_000) throw new Error(`timer cap mismatch: ${capped}`);
  const none = nextEventAcquisitionBoundaryDelayMs([{ operatorStatus: "ended", operatorEndedAtUtc: null, masterEndAtUtc: "2099-08-11T12:00:01Z" }], NOW);
  if (none !== null) throw new Error("terminal state must not schedule a timer");
});

Deno.test("issue #2582 uses the final raw camelCase occurrence across a multi-day gap", () => {
  const occurrences = [
    {
      id: "day-2",
      startAt: "2026-08-30T12:00:00Z",
      endAt: "2026-08-30T19:00:00Z",
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
  const terminalSource = { kind: "occurrences" as const, value: occurrences };
  const terminal = resolveEventTerminal(terminalSource);
  if (
    terminal.kind !== "known" ||
    terminal.endAtUtc !== "2026-08-30T19:00:00.000Z"
  ) {
    throw new Error(`final occurrence was not terminal: ${JSON.stringify(terminal)}`);
  }

  const betweenDays = Date.parse("2026-08-30T08:00:00Z");
  const duringDayTwo = Date.parse("2026-08-30T13:01:00Z");
  for (const nowMs of [betweenDays, duringDayTwo]) {
    const state = resolveEventAcquisitionState(
      {
        operatorStatus: "scheduled",
        operatorEndedAtUtc: null,
        terminalSource,
      },
      nowMs,
    );
    if (state.kind !== "current") {
      throw new Error(`multi-day event ended early at ${nowMs}: ${state.kind}`);
    }
  }

  const boundaryDelay = nextEventAcquisitionBoundaryDelayMs(
    [
      {
        operatorStatus: "scheduled",
        operatorEndedAtUtc: null,
        terminalSource,
      },
    ],
    duringDayTwo,
  );
  if (boundaryDelay !== Date.parse("2026-08-30T19:00:00Z") - duringDayTwo) {
    throw new Error(`final boundary delay mismatch: ${boundaryDelay}`);
  }

  const atFinalEnd = resolveEventAcquisitionState(
    {
      operatorStatus: "scheduled",
      operatorEndedAtUtc: null,
      terminalSource,
    },
    Date.parse("2026-08-30T19:00:00Z"),
  );
  if (atFinalEnd.kind !== "ended") {
    throw new Error(`exact final equality must end: ${atFinalEnd.kind}`);
  }
});
