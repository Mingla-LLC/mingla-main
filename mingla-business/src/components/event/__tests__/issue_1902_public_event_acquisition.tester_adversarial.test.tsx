import { resolveEventCheckoutLifecycleGate } from "../../../utils/eventLifecycle";
import type { LiveEvent } from "../../../store/liveEventStore";

const event = (status: LiveEvent["status"] = "scheduled"): LiveEvent =>
  ({ status, endedAt: null } as LiveEvent);

const occurrenceSource = {
  kind: "occurrences" as const,
  value: [
    {
      id: "day-1",
      startAt: "2026-08-29T12:00:00Z",
      endAt: "2026-08-29T19:00:00Z",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
    {
      id: "day-2",
      startAt: "2026-08-30T12:00:00Z",
      endAt: "2026-08-30T19:00:00Z",
      timezone: "Africa/Lagos",
      isMaster: false,
    },
  ],
};

test("issue #2582 tester adversarial: checkout distinguishes Day-2 current, unavailable, and truly closed", () => {
  expect(
    resolveEventCheckoutLifecycleGate(
      event(),
      occurrenceSource,
      Date.parse("2026-08-30T13:01:00Z"),
    ),
  ).toEqual({ kind: "current" });

  expect(
    resolveEventCheckoutLifecycleGate(
      event(),
      { kind: "occurrences", value: [] },
      Date.parse("2026-08-30T13:01:00Z"),
    ),
  ).toEqual({
    kind: "unavailable",
    acquisitionState: { kind: "unavailable", reason: "occurrences_missing" },
  });

  expect(
    resolveEventCheckoutLifecycleGate(
      event(),
      occurrenceSource,
      Date.parse("2026-08-30T19:00:00Z"),
    ),
  ).toEqual({
    kind: "closed",
    acquisitionState: { kind: "ended", reason: "master_end" },
  });

  expect(
    resolveEventCheckoutLifecycleGate(
      event("cancelled"),
      occurrenceSource,
      Date.parse("2026-08-30T13:01:00Z"),
    ),
  ).toEqual({
    kind: "closed",
    acquisitionState: { kind: "cancelled" },
  });
});
