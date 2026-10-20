// #2107 D — update-gate outcomes reach PostHog through the existing wrapper.
//
// I-2107-UPDATE-GATE-TELEMETRY (machine-readable invariant): version_gate_* and
// critical_update_* outcomes are captured through postHogService (never a
// direct posthog-react-native import), buffered until the client is ready,
// and telemetry can never throw into the gate.
//
// MINGLA-INVARIANT: I-2107-UPDATE-GATE-TELEMETRY | issue #2107 | Update-gate outcomes are captured through postHogService, buffered until ready, and telemetry never throws into the gate.

const mockService = {
  ready: false,
  captured: [] as Array<{ event: string; properties?: Record<string, unknown> }>,
  isReady(): boolean {
    return this.ready;
  },
  capture(event: string, properties?: Record<string, unknown>): void {
    this.captured.push({ event, properties });
  },
};

jest.mock("../postHogService", () => ({ postHogService: mockService }));

describe("#2107 D — update-gate telemetry", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockService.ready = false;
    mockService.captured = [];
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("happy: buffers outcomes until PostHog is ready, then captures them in order", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reportUpdateGateEvent } = require("../updateGateTelemetry") as typeof import("../updateGateTelemetry");
    reportUpdateGateEvent("app-version-policy", "version_gate_timeout", { had_cached_policy: false });
    reportUpdateGateEvent("ota-update-gate", "critical_update_offered", { attempt: 1 });
    expect(mockService.captured).toEqual([]);

    mockService.ready = true;
    jest.advanceTimersByTime(3_000);
    expect(mockService.captured.map((c) => c.event)).toEqual([
      "version_gate_timeout",
      "critical_update_offered",
    ]);
    expect(mockService.captured[1].properties).toEqual({ attempt: 1 });
  });

  it("adversarial: diagnostics stay console-only and a throwing analytics client never escapes", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reportUpdateGateEvent } = require("../updateGateTelemetry") as typeof import("../updateGateTelemetry");
    mockService.ready = true;
    reportUpdateGateEvent("ota-update-gate", "nothing_to_adopt");
    expect(mockService.captured).toEqual([]);

    const original = mockService.capture;
    mockService.capture = () => {
      throw new Error("posthog exploded");
    };
    expect(() =>
      reportUpdateGateEvent("app-version-policy", "version_gate_required"),
    ).not.toThrow();
    mockService.capture = original;
  });

  it("adversarial: a client that never becomes ready drops the buffer instead of retrying forever", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reportUpdateGateEvent } = require("../updateGateTelemetry") as typeof import("../updateGateTelemetry");
    reportUpdateGateEvent("ota-update-gate", "critical_update_skipped_offline");
    jest.advanceTimersByTime(3_000 * 45);
    expect(jest.getTimerCount()).toBe(0);
    mockService.ready = true;
    reportUpdateGateEvent("ota-update-gate", "critical_update_emergency_launch");
    expect(mockService.captured.map((c) => c.event)).toEqual([
      "critical_update_emergency_launch",
    ]);
  });
});
