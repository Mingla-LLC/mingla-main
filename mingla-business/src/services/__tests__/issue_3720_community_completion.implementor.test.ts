import fs from "node:fs";
import path from "node:path";
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

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("#3720 Wave 7 Host Community completion", () => {
  test("routes a bounded Community reply deep link to the in-app thread", () => {
    expect(
      parseBusinessDeepLink(
        "mingla-business://community/post/37200000-0000-4000-8000-000000000777",
      ),
    )
      .toBe(
        "/account/support?tab=community&communityPost=37200000-0000-4000-8000-000000000777",
      );
    expect(parseBusinessDeepLink("mingla-business://community/post/not-a-uuid"))
      .toBe("/account/support?tab=community");
  });

  test("Host UI exposes ideas, Q&A, votes, comments, reports, blocks and appeals", () => {
    const panel = read(
      "mingla-business/src/components/support/CommunityConversationsPanel.tsx",
    );
    const service = read("mingla-business/src/services/communityService.ts");
    expect(panel).toMatch(/Ideas/);
    expect(panel).toMatch(/Q&A/);
    expect(panel).toMatch(/Vote/);
    expect(panel).toMatch(/Accept answer/);
    expect(panel).toMatch(/Report/);
    expect(panel).toMatch(/Block author/);
    expect(panel).toMatch(/Appeal decision/);
    expect(service).toMatch(/issue_3720_community_submit_post/);
    expect(service).toMatch(/issue_3720_community_report/);
    expect(service).toMatch(/issue_3720_community_block_author/);
    expect(service).not.toMatch(
      /from\(["']community_(?:posts|content_reports|content_appeals)/,
    );
  });

  test("first-three review copy is visible before a Host submits", () => {
    const panel = read(
      "mingla-business/src/components/support/CommunityConversationsPanel.tsx",
    );
    expect(panel).toContain("Your first three posts are reviewed");
  });
});
