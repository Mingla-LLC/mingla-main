/**
 * Live browser verification found that Expo Router can restore its initial
 * fragment after the attendance handoff's first history scrub. The second,
 * pre-paint scrub is therefore a security boundary, not cosmetic cleanup.
 */

import { describe, expect, test } from "@jest/globals";

import { scrubAttendanceClaimFragment } from "../attendanceClaimDeepLink";

describe("issue #2979 attendance claim browser credential cleanup", () => {
  test("scrubs immediately and again before paint without retaining the fragment", () => {
    const replacedUrls: string[] = [];
    const scheduledCallbacks: FrameRequestCallback[] = [];
    scrubAttendanceClaimFragment(
      { pathname: "/attendance/claim", search: "?source=email" },
      {
        replaceState: (_data, _unused, url) => {
          replacedUrls.push(String(url));
        },
      },
      (callback) => {
        scheduledCallbacks.push(callback);
        return 2979;
      },
    );

    expect(replacedUrls).toEqual(["/attendance/claim?source=email"]);
    expect(scheduledCallbacks).toHaveLength(1);

    // Model Expo Router restoring its launch state after the first scrub.
    // The scheduled callback must remove it again before the next paint.
    scheduledCallbacks[0]?.(0);
    expect(replacedUrls).toEqual([
      "/attendance/claim?source=email",
      "/attendance/claim?source=email",
    ]);
    expect(replacedUrls.every((url) => !url.includes("#"))).toBe(true);
  });
});
