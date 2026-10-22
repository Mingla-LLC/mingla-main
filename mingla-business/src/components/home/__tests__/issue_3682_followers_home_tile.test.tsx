jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("react-native-svg", () => ({
  __esModule: true,
  default: () => null,
  Circle: () => null,
  Path: () => null,
}));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));

import { followerSourceLine } from "../FollowersHomeTile";
import type { BrandFollowerSummary } from "../../../types/brandFollowers";

const summary: BrandFollowerSummary = {
  schemaVersion: 1,
  total: 1204,
  newThisWeek: 38,
  sourcesThisWeek: {
    checkout: 29,
    brandPage: 7,
    emailInvite: 2,
    other: 0,
  },
  trend: [1100, 1119, 1138, 1155, 1172, 1190, 1204],
  asOf: "2026-10-22T12:00:00.000Z",
};

describe("#3682 Followers Home tile presentation", () => {
  test("orders non-zero source buckets using the approved copy", () => {
    expect(followerSourceLine(summary)).toBe(
      "29 from checkout · 7 from the brand page · 2 from email invites",
    );
  });

  test("hides the source line when this week's count is zero", () => {
    expect(
      followerSourceLine({
        ...summary,
        newThisWeek: 0,
        sourcesThisWeek: { checkout: 0, brandPage: 0, emailInvite: 0, other: 0 },
      }),
    ).toBeNull();
  });
});
