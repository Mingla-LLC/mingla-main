import { runInNewContext } from "node:vm";

import { describe, expect, test } from "@jest/globals";

import {
  ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP,
  ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
  consumeAttendanceClaimFragment,
  createAttendanceClaimFragmentScrubber,
} from "../attendanceClaimDeepLink";

describe("issue #2979 pre-Router attendance URL capture", () => {
  test("restores the launch query and state after Router erases both before the route effect", () => {
    const cleanUrl =
      "/attendance/claim?source=email%20recovery&channel=sms";
    const launchState = {
      key: "launch-router-state",
      route: { pathname: "/attendance/claim" },
    };
    const laterRouterState = { key: "later-router-state" };
    let visibleUrl = `${cleanUrl}#synthetic-claim-fragment`;
    const replacements: [unknown, string][] = [];
    const scheduledCallbacks: FrameRequestCallback[] = [];
    const browserWindow = {
      location: {
        pathname: "/attendance/claim",
        search: "?source=email%20recovery&channel=sms",
        hash: "#synthetic-claim-fragment",
      },
      history: {
        state: launchState as unknown,
        replaceState: (state: unknown, _unused: string, url?: string | URL | null) => {
          replacements.push([state, String(url)]);
          visibleUrl = String(url);
          browserWindow.location.hash = "";
        },
      },
    };

    runInNewContext(ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP, {
      window: browserWindow,
    });
    expect(visibleUrl).toBe(cleanUrl);

    // Model Router dropping the launch query/state before the route effect.
    browserWindow.location.search = "";
    browserWindow.history.state = laterRouterState;
    visibleUrl = "/attendance/claim";

    const raw = browserWindow.location.hash.replace(/^#/, "");
    const handoff = consumeAttendanceClaimFragment(
      browserWindow as unknown as Window,
      raw,
    );
    expect(Object.prototype.hasOwnProperty.call(
      browserWindow,
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    )).toBe(false);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(handoff.fragment).toBe("synthetic-claim-fragment");
    expect(handoff.cleanUrl).toBe(cleanUrl);
    expect(handoff.historyState).toBe(launchState);

    const scrubAttendanceClaimFragment =
      createAttendanceClaimFragmentScrubber(handoff);
    const scheduleFinalRestore = scrubAttendanceClaimFragment(
      browserWindow.location,
      browserWindow.history,
      (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
    );
    scheduledCallbacks.shift()?.(0);
    scheduledCallbacks.shift()?.(16);

    // Model the later lifecycle reconciliation before the bounded A8 restore.
    visibleUrl = "/attendance/claim";
    scheduleFinalRestore();
    scheduledCallbacks.shift()?.(32);

    expect(visibleUrl).toBe(cleanUrl);
    expect(replacements).toHaveLength(5);
    replacements.forEach(([state, url]) => {
      expect(state).toBe(launchState);
      expect(url).toBe(cleanUrl);
    });
    expect(scheduledCallbacks).toHaveLength(0);
  });
});
