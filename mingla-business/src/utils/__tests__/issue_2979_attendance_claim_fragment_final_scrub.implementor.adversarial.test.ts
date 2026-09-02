import { describe, expect, test } from "@jest/globals";

import { scrubAttendanceClaimFragment } from "../attendanceClaimDeepLink";

describe("issue #2979 final attendance claim URL scrub", () => {
  test("restores the captured clean URL after Router writes between frames", () => {
    const cleanUrl = "/attendance/claim?source=email%20recovery&channel=sms";
    let visibleUrl = `${cleanUrl}#synthetic-claim-credential`;
    const replacedUrls: string[] = [];
    const scheduledCallbacks: FrameRequestCallback[] = [];

    scrubAttendanceClaimFragment(
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

    expect(visibleUrl).toBe(cleanUrl);
    expect(scheduledCallbacks).toHaveLength(1);

    scheduledCallbacks.shift()?.(0);
    expect(visibleUrl).toBe(cleanUrl);
    expect(scheduledCallbacks).toHaveLength(1);

    // Model Expo Router's later reconciliation after the first scheduled scrub.
    visibleUrl = "/attendance/claim";
    scheduledCallbacks.shift()?.(16);

    expect(visibleUrl).toBe(cleanUrl);
    expect(replacedUrls).toEqual([cleanUrl, cleanUrl, cleanUrl]);
    expect(replacedUrls.every((url) => !url.includes("#"))).toBe(true);
    expect(scheduledCallbacks).toHaveLength(0);
  });
});
