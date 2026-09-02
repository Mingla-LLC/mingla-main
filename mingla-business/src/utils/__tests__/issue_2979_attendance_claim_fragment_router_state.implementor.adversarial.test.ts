import { describe, expect, test } from "@jest/globals";

import { scrubAttendanceClaimFragment } from "../attendanceClaimDeepLink";

describe("issue #2979 attendance claim Router state preservation", () => {
  test("reuses the captured Router state object for every bounded URL scrub", () => {
    const cleanUrl = "/attendance/claim?source=email%20recovery&channel=sms";
    const routerState = {
      key: "synthetic-router-entry",
      route: { pathname: "/attendance/claim" },
    };
    const laterStateOwner = { key: "different-router-owner" };
    let visibleUrl = `${cleanUrl}#synthetic-claim-credential`;
    let stateReads = 0;
    const writtenStates: unknown[] = [];
    const scheduledCallbacks: FrameRequestCallback[] = [];

    const scheduleFinalRestore = scrubAttendanceClaimFragment(
      {
        pathname: "/attendance/claim",
        search: "?source=email%20recovery&channel=sms",
      },
      {
        get state(): unknown {
          stateReads += 1;
          return stateReads === 1 ? routerState : laterStateOwner;
        },
        replaceState: (state, _unused, url) => {
          writtenStates.push(state);
          visibleUrl = String(url);
        },
      },
      (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
    );

    scheduledCallbacks.shift()?.(0);
    scheduledCallbacks.shift()?.(16);
    visibleUrl = "/attendance/claim";
    scheduleFinalRestore();
    scheduledCallbacks.shift()?.(32);

    expect(visibleUrl).toBe(cleanUrl);
    expect(stateReads).toBe(1);
    expect(writtenStates).toHaveLength(4);
    writtenStates.forEach((state) => expect(state).toBe(routerState));
    expect(scheduledCallbacks).toHaveLength(0);
  });
});
