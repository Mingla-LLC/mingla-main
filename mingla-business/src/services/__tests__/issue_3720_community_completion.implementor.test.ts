import { describe, expect, jest, test } from "@jest/globals";

import { parseBusinessDeepLink } from "../businessNotificationRouting";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-3720" }) },
}));
jest.mock("../supabase", () => ({ supabase: {} }));
jest.mock(
  "../mixpanelService",
  () => ({ mixpanelService: { track: jest.fn() } }),
);
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

// [TEST-MOD #4420] Ideas, Q&A, votes, comments, reports, blocks and appeals
// left the Host app (Community retired, client only; the server RPCs stay for
// older builds). Their UI pins went with the deleted panel; an old reply link
// now opens Help & Support, which never lands on nothing.
describe("#3720 Wave 7 Host Community completion", () => {
  test("an old Community reply deep link opens Help & Support", () => {
    expect(
      parseBusinessDeepLink(
        "mingla-business://community/post/37200000-0000-4000-8000-000000000777",
      ),
    ).toBe("/account/support");
    expect(parseBusinessDeepLink("mingla-business://community/post/not-a-uuid"))
      .toBe("/account/support");
  });
});
