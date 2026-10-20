// #2107 (U1) — TESTER adversarial test, broken-update fallback leg (Host copy; updateLaunchGuard.ts is byte-identical).
//
// Angle the implementor suite does not cover: the guard's decisions are made by
// SEPARATE processes that only share the on-disk record. This replays the U1
// journey across six launches on one persistent store, in the order a phone
// lives it, including a cold start that comes back quickly — well inside the
// 60 s marker window — after the in-app restart into the broken update.
//
// The property under attack: the in-app reload marker describes exactly ONE
// process. If it were left armed, the person's very next cold start would be
// reported as an in-app restart.
//
// #2107 change (escalation removed after the Android device test showed a
// render-time fatal only crashes): no launch is ever escalated. Assertions on
// launches 3, 4 and the final record were changed accordingly.

import {
  UPDATE_LAUNCH_WINDOW_MS,
  UpdateLaunchGuard,
  parseUpdateLaunchRecord,
  serializeUpdateLaunchRecord,
  withInAppReloadMarked,
  type UpdateLaunchFacts,
} from "../updateLaunchGuard";

type Disk = { value: string | null };

const facts = (updateId: string | null, isEmbeddedLaunch = false): UpdateLaunchFacts => ({
  enabled: true,
  updateId,
  isEmbeddedLaunch,
  isEmergencyLaunch: false,
});

/** One JS process: its own guard, started at `startedAt`, on the shared disk. */
function launch(disk: Disk, running: UpdateLaunchFacts, startedAt: number) {
  const clock = { now: startedAt };
  const escalated: unknown[] = [];
  const events: string[] = [];
  const timers: Array<() => void> = [];
  // Offered but outside the type: the guard must never call it.
  const offeredEscalate = { escalate: (error: unknown) => escalated.push(error) };
  const guard = new UpdateLaunchGuard({
    ...offeredEscalate,
    now: () => clock.now,
    readFacts: () => running,
    store: {
      read: () => disk.value,
      write: (value) => {
        disk.value = value;
      },
    },
    report: (event) => events.push(event),
    setTimer: (callback) => timers.push(callback),
  });
  guard.start();
  return { guard, clock, escalated, events, fireWindowTimer: () => timers.forEach((t) => t()) };
}

/** What safeReloadRuntime writes right before the native restart. */
function markInAppRestart(disk: Disk, at: number): void {
  disk.value = serializeUpdateLaunchRecord(withInAppReloadMarked(parseUpdateLaunchRecord(disk.value), at));
}

describe("#2107 tester — the U1 journey across processes on one disk", () => {
  it("in-app restart shows the restart screen, the quick cold start after it is a fresh unconfirmed launch, and nothing ever escalates", () => {
    const disk: Disk = { value: null };
    const t0 = 5_000_000;

    // Launch 1: running healthy update A; the first commit confirms it.
    const p1 = launch(disk, facts("update-a"), t0);
    p1.guard.noteHealthyCommit();
    expect(p1.events).toContain("update_launch_confirmed_good");

    // The critical gate restarts in-app into update X (which is broken).
    markInAppRestart(disk, t0 + 20_000);

    // Launch 2: started BY that in-app restart, X throws on its first render.
    const p2 = launch(disk, facts("update-x"), t0 + 20_500);
    expect(p2.guard.handleError(new Error("X render"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "in_app_reload",
    });
    expect(p2.escalated).toEqual([]);

    // Launch 3: the person force-closes and reopens 25 s later — still well
    // inside the 60 s marker window. This is a fresh process: reported as an
    // unconfirmed download, shown the restart screen, never escalated.
    const p3 = launch(disk, facts("update-x"), t0 + 45_000);
    expect(p3.guard.handleError(new Error("X render"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "unconfirmed_download",
    });
    expect(p3.escalated).toEqual([]);
    expect(p3.events).toContain("update_launch_error");

    // Launch 4: expo-updates launches X again — the restart screen again, no crash.
    const p4 = launch(disk, facts("update-x"), t0 + 120_000);
    expect(p4.guard.handleError(new Error("X render"), "global_handler")).toEqual({
      kind: "restart_screen",
      reason: "unconfirmed_download",
    });
    expect(p4.escalated).toEqual([]);

    // Launch 5: rolled back to A, which was confirmed good on launch 1. An early
    // error in a confirmed update is a normal bug: restart screen, no escalation.
    const p5 = launch(disk, facts("update-a"), t0 + 180_000);
    expect(p5.guard.handleError(new Error("A bug"), "root_boundary")).toEqual({
      kind: "restart_screen",
      reason: "confirmed_good",
    });
    expect(p5.escalated).toEqual([]);

    // Launch 6: a new healthy update Y stays up for the whole window; the timer
    // confirms it, and a later error never escalates.
    const p6 = launch(disk, facts("update-y"), t0 + 240_000);
    p6.fireWindowTimer();
    expect(p6.events).toContain("update_launch_confirmed_good");
    p6.clock.now += UPDATE_LAUNCH_WINDOW_MS + 1;
    expect(p6.guard.handleError(new Error("Y later bug"), "root_boundary").kind).toBe("restart_screen");
    expect(p6.escalated).toEqual([]);

    const record = parseUpdateLaunchRecord(disk.value);
    expect(record?.confirmed).toEqual(expect.arrayContaining(["update-a", "update-y"]));
    expect(record?.inAppReloadAt).toBeNull();
  });
});
