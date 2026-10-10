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

  test("ConsumerBrandProfileScreen Following menu offers mute durations", () => {
    const src = read("src/screens/ConsumerBrandProfileScreen.tsx");
    expect(src).toContain('mute("week")');
    expect(src).toContain('mute("month")');
    expect(src).toContain('mute("indefinite")');
    expect(src).toContain('followState={');
    expect(src).toContain('"muted"');
  });

  test("AccountSettings opens BrandsYouFollowManageSheet as a child surface", () => {
    const src = read("src/components/profile/AccountSettings.tsx");
    expect(src).toContain("showBrandsScreen");
    expect(src).toContain("BrandsYouFollowManageSheet");
    expect(src).toContain('testID="settings-brands-you-follow-row"');
    expect(src).toContain("anyChildOpen");
  });

  test("brandFollowsService exposes mute + channel prefs", () => {
    const src = read("src/services/brandFollowsService.ts");
    expect(src).toContain("muteBrand");
    expect(src).toContain("setChannel");
    expect(src).toContain("listFollows");
    expect(src).toContain("brand_follow_channel_prefs");
  });
});
