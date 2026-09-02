import { describe, expect, test } from "@jest/globals";

import { scrubAttendanceClaimFragment } from "../attendanceClaimDeepLink";

describe("issue #2979 lifecycle-anchored attendance URL restoration", () => {
  test("restores the captured query after pre-parse frames and async reconciliation", () => {
    const cleanUrl = "/attendance/claim?source=email%20recovery&channel=sms";
    let visibleUrl = `${cleanUrl}#synthetic-claim-credential`;
    const replacedUrls: string[] = [];
    const scheduledCallbacks: FrameRequestCallback[] = [];

    const scheduleFinalRestore = scrubAttendanceClaimFragment(
      {
        pathname: "/attendance/claim",
        search: "?source=email%20recovery&channel=sms",
      },
      {
        replaceState: (_data, _unused, url) => {
          visibleUrl = String(url);
          replacedUrls.push(visibleUrl);
        },
      },
      (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
    );

    scheduledCallbacks.shift()?.(0);
    scheduledCallbacks.shift()?.(16);
    expect(scheduledCallbacks).toHaveLength(0);

    // Model the async parser/state reconciliation that occurs after A7's frames.
    visibleUrl = "/attendance/claim";
    scheduleFinalRestore();
    expect(scheduledCallbacks).toHaveLength(1);
    scheduledCallbacks.shift()?.(32);

    expect(visibleUrl).toBe(cleanUrl);
    expect(replacedUrls).toEqual([cleanUrl, cleanUrl, cleanUrl, cleanUrl]);
    expect(replacedUrls.every((url) => !url.includes("#"))).toBe(true);
    expect(scheduledCallbacks).toHaveLength(0);
  });
});
