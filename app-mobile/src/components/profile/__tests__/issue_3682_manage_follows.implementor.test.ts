/**
 * #3682 Wave 2.6 — manage follows wiring (Explorer).
 * FAILS-ON-REVERT: deleting BrandsYouFollowSection / mute menu / settings row
 * makes these assertions fail.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

describe("#3682 Wave 2.6 — manage follows", () => {
  test("ProfilePage mounts BrandsYouFollowSection before Account", () => {
    const src = read("src/components/ProfilePage.tsx");
    expect(src).toContain("BrandsYouFollowSection");
    const brandsIdx = src.indexOf("<BrandsYouFollowSection");
    const accountIdx = src.indexOf("profile:page.account_section");
    expect(brandsIdx).toBeGreaterThan(0);
    expect(accountIdx).toBeGreaterThan(brandsIdx);
  });

  test("ConsumerBrandProfileScreen Following menu uses overflow sheet (not 5-button Alert)", () => {
    const src = read("src/screens/ConsumerBrandProfileScreen.tsx");
    expect(src).toContain("BrandFollowOverflowSheet");
    expect(src).toContain("BrandsYouFollowManageSheet");
    expect(src).toContain('followState={');
    expect(src).toContain('"muted"');
    // Mute durations live in the shared overflow sheet, not Alert.alert.
    const overflow = read(
      "src/components/profile/BrandFollowOverflowSheet.tsx",
    );
    expect(overflow).toContain('["week", "For 1 week"]');
    expect(overflow).toContain('["month", "For 30 days"]');
    expect(overflow).toContain('["indefinite", "Until I turn it back on"]');
  });

  test("AccountSettings opens BrandsYouFollowManageSheet as a child surface", () => {
    const src = read("src/components/profile/AccountSettings.tsx");
    expect(src).toContain("showBrandsScreen");
    expect(src).toContain("BrandsYouFollowManageSheet");
    expect(src).toContain('testID="settings-brands-you-follow-row"');
    expect(src).toContain("anyChildOpen");
  });

  test("brandFollowsService exposes mute + channel prefs via RPC", () => {
    const src = read("src/services/brandFollowsService.ts");
    expect(src).toContain("muteBrand");
    expect(src).toContain("setChannel");
    expect(src).toContain("listFollows");
    expect(src).toContain("biz_brand_follow_set_channel_v1");
    expect(src).toContain("brand_follow_channel_prefs");
  });

  test("Manage sheet uses BaseBottomSheet scroll mode and error/retry", () => {
    const src = read(
      "src/components/profile/BrandsYouFollowManageSheet.tsx",
    );
    expect(src).toContain('scrollMode="scroll"');
    expect(src).not.toMatch(/scrollMode=["']none["']/);
    expect(src).not.toMatch(/from "react-native"[\s\S]*ScrollView/);
    expect(src).toContain("listQuery.isError");
    expect(src).toContain('testID="brands-manage-retry"');
    expect(src).toContain('accessibilityLabel={`More options for ${row.brandName}`}');
  });

  test("Manage sheet exposes Push alongside Email and Text (#3682 Wave 2.7)", () => {
    const src = read(
      "src/components/profile/BrandsYouFollowManageSheet.tsx",
    );
    expect(src).toContain('["push", "Push", "notifications-outline"]');
    expect(src).toContain('["email", "Email", "mail-outline"]');
    expect(src).toContain('["sms", "Text", "chatbubble-outline"]');
    expect(src).toContain("push, email and text");
  });
});
