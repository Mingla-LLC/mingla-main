/**
 * #3682 Wave 2.3 — buyer-web PublicBrandPage Follow wiring.
 *
 * FAILS-ON-REVERT: deleting onToggleFollow / ConfirmDialog unfollow / useBrandFollow
 * from the business adapter makes the assertions fail.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const src = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/brand/PublicBrandPage.tsx"),
    "utf8",
  );

const eventSrc = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/event/PublicEventPage.tsx"),
    "utf8",
  );

describe("#3682 Wave 2.3 — buyer-web Follow wiring", () => {
  test("PublicBrandPage passes onToggleFollow + onFollowingMenu + isFollowing", () => {
    const wrapper = src();
    expect(wrapper).toContain('from "../../hooks/useBrandFollow"');
    expect(wrapper).toContain("useBrandFollow(user?.id ?? null, brand.id)");
    expect(wrapper).toContain("onToggleFollow: handleToggleFollow");
    expect(wrapper).toContain("onFollowingMenu: handleFollowingMenu");
    expect(wrapper).toContain("isFollowing={brandFollow.isFollowing}");
    expect(wrapper).toContain("followPending={brandFollow.isPending}");
    // Alert.alert is a silent no-op on web — ConfirmDialog is required.
    expect(wrapper).toContain('testID="public-brand-unfollow"');
    expect(wrapper).toContain('testID="public-brand-follow-signin"');
    expect(wrapper).not.toMatch(/Alert\.alert\(/);
  });

  test("PublicEventPage wires Presented-by Follow through Foundation previews", () => {
    const page = eventSrc();
    expect(page).toContain("presentedByFollow={presentedByFollow}");
    expect(page).toContain('testID="public-event-presented-by-follow"');
    expect(page).toContain('testID="public-event-unfollow"');
    expect(page).toContain("<FollowButton");
  });
});
