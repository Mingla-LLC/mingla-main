import fs from "node:fs";
import path from "node:path";

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/KpiTile", () => ({ KpiTile: () => null }));

import { followerKpiPresentation } from "../FollowersKpiTile";
import type { BrandFollowerSummary } from "../../../types/brandFollowers";

const summary: BrandFollowerSummary = {
  schemaVersion: 1,
  total: 1204,
  newThisWeek: 38,
  sourcesThisWeek: { checkout: 29, brandPage: 7, emailInvite: 2, other: 0 },
  trend: [1100, 1119, 1138, 1155, 1172, 1190, 1204],
  asOf: "2026-10-22T12:00:00.000Z",
};

describe("#3682 follower KPI", () => {
  test("presents error, zero, and exact growth states honestly", () => {
    expect(followerKpiPresentation(undefined, true)).toEqual({
      value: "—",
      sub: "Couldn't load",
    });
    expect(
      followerKpiPresentation(
        {
          ...summary,
          total: 0,
          newThisWeek: 0,
          sourcesThisWeek: { checkout: 0, brandPage: 0, emailInvite: 0, other: 0 },
          trend: [0, 0, 0, 0, 0, 0, 0],
        },
        false,
      ),
    ).toEqual({ value: "0", sub: "Share your page to get your first" });
    expect(followerKpiPresentation(summary, false)).toEqual({
      value: "1,204",
      delta: "+38 this week",
      deltaUp: true,
    });
  });

  // #3872 round 2 (approved M-brandone): the four tiles became one strip of
  // three numbers — Attendees, Sales, Followers. Followers stays a live tile.
  test("profile shows one strip: Attendees, Sales, Followers", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../BrandProfileView.tsx"),
      "utf8",
    );
    const attendees = source.indexOf('label="Attendees"');
    const sales = source.indexOf('label="Sales"', attendees);
    const followers = source.indexOf("<FollowersKpiTile", sales);
    expect(attendees).toBeGreaterThan(-1);
    expect(sales).toBeGreaterThan(attendees);
    expect(followers).toBeGreaterThan(sales);
    expect(source).not.toContain('label="Events"');
  });

  test("KpiTile keeps a 72 by 24 loading skeleton", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../ui/KpiTile.tsx"),
      "utf8",
    );
    expect(source).toContain("width: 72");
    expect(source).toContain("height: 24");
  });
});
