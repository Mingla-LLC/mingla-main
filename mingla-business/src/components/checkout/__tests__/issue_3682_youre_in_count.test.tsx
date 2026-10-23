jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import {
  youreInFollowingDetail,
  youreInOfferDetail,
} from "../YoureInFollowCard";

describe("#3682 You're in follower copy", () => {
  test.each([
    [1205, "You and 1.2k others hear about new dates first."],
    [2, "You and 1 other hear about new dates first."],
    [1, "New dates and offers first."],
    [null, "New dates and offers first."],
  ] as const)("following count %s", (count, expected) => {
    expect(youreInFollowingDetail(count)).toBe(expected);
  });

  test.each([
    [1204, "Join 1.2k others. New dates and offers first."],
    [1, "Join 1 other. New dates and offers first."],
    [0, "Follow to hear about them first."],
    [null, "Follow to hear about them first."],
  ] as const)("offer count %s", (count, expected) => {
    expect(youreInOfferDetail(count)).toBe(expected);
  });
});
