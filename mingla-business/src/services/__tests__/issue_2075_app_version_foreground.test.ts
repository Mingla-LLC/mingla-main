import {
  VERSION_FOREGROUND_REFRESH_MS,
  VersionForegroundStateMachine,
} from "../appVersionForeground";

describe("#2075 version foreground lifecycle", () => {
  it("checks after background -> inactive -> active at 15 minutes", () => {
    const machine = new VersionForegroundStateMachine();
    expect(machine.transition("background", 100, false)).toBeNull();
    expect(machine.transition("inactive", 200, false)).toBeNull();
    expect(
      machine.transition("active", 100 + VERSION_FOREGROUND_REFRESH_MS, false),
    ).toEqual({ backgroundDurationMs: VERSION_FOREGROUND_REFRESH_MS });
  });

  it("consumes a shorter background cycle without checking", () => {
    const machine = new VersionForegroundStateMachine();
    machine.transition("background", 100, false);
    machine.transition("inactive", 200, false);
    expect(machine.transition("active", 999, false)).toBeNull();
    expect(machine.transition("inactive", 1_000, false)).toBeNull();
    expect(machine.transition("active", 2_000_000, false)).toBeNull();
  });

  it("does not treat active -> inactive -> active as a background resume", () => {
    const machine = new VersionForegroundStateMachine();
    expect(machine.transition("inactive", 100, false)).toBeNull();
    expect(machine.transition("active", 2_000_000, false)).toBeNull();
  });

  it("checks immediately on a true foreground when already required", () => {
    const machine = new VersionForegroundStateMachine();
    machine.transition("background", 100, true);
    machine.transition("inactive", 200, true);
    expect(machine.transition("active", 300, true)).toEqual({
      backgroundDurationMs: 200,
    });
  });
});
