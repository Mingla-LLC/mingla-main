// @ts-nocheck -- Deno-runtime unit + source contract.
// #3682 wave 3 — Explorer Friends of followers controls (#1782) and how a
// received brand invite reads (#1779 / #1781).
// FAILS-ON-REVERT: removing the RPC wiring, the controls-live gate, the
// keep-on-tap rule or the reason split makes these fail.
import { parseFriendsReach } from "../../../services/friendsReachModel.ts";
import {
  friendsReachHint,
  shouldShowBrandFriendsReachRow,
  stopThroughFriendsConfirm,
} from "../friendsReachCopy.ts";
import {
  brandReachReasonLine,
  brandReachRowCopy,
  isBrandReachType,
} from "../../notifications/brandReachNotification.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEq(a: unknown, b: unknown, message: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${message}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
}

Deno.test("#3682 friends reach read parses strictly and defaults off", () => {
  const state = parseFriendsReach({
    controlsLive: true,
    extendedEnabled: false,
    decidedAt: null,
    exits: [
      { brandId: "b1", brandName: "Harmattan", brandSlug: "harmattan", exitedAt: "2026-11-01T00:00:00Z" },
      { brandId: "", brandName: "dropped" },
    ],
  });
  assert(state.controlsLive && !state.extendedEnabled, "flags");
  assertEq(state.stoppedBrands, [
    { brandId: "b1", brandName: "Harmattan", brandSlug: "harmattan", photoUrl: null, exitedAt: "2026-11-01T00:00:00Z" },
  ], "stopped brands");
  const empty = parseFriendsReach({ exits: [] });
  assert(!empty.controlsLive && !empty.extendedEnabled, "a missing flag is never live");
  let threw = false;
  try { parseFriendsReach(null); } catch { threw = true; }
  assert(threw, "malformed read must throw");
});

Deno.test("#3682 service writes through the three RPCs and throws on error", async () => {
  const src = await read("../../../services/friendsReachService.ts");
  for (const name of [
    "issue_3682_explorer_friends_reach_v1",
    "issue_3682_set_friends_reach_v1",
    "issue_3682_set_brand_circle_exit_v1",
  ]) assert(src.includes(`"${name}"`), `missing RPC ${name}`);
  assertEq((src.match(/if \(error\) throw error;/g) ?? []).length, 3, "every call throws its error");
  const keys = await read("../../../hooks/brandFollowKeys.ts");
  assert(/friendsReach: \(userId: string\) =>\s*\["consumerBrand", "friendsReach", userId\]/.test(keys),
    "one key factory, scoped to the user");
  const hook = await read("../../../hooks/useFriendsReach.ts");
  assert(hook.includes("brandFollowKeys.friendsReach("), "hook uses the factory key");
});

Deno.test("#3682 honest copy and gating", async () => {
  assert(friendsReachHint(true).includes("only your name and photo"), "what a brand sees");
  assert(friendsReachHint(true).includes("never your email, phone or which friend"), "never contacts or graph");
  assert(friendsReachHint(false).startsWith("Off."), "off copy");
  assert(stopThroughFriendsConfirm("Harmattan").body.includes("You'll unfollow Harmattan"), "confirm says it unfollows");
  const base = { userId: "u1", isFollowing: false, controlsLive: true, extendedEnabled: true, stopped: false };
  assert(shouldShowBrandFriendsReachRow(base), "non-follower who opted in");
  assert(!shouldShowBrandFriendsReachRow({ ...base, controlsLive: false }), "dark build");
  assert(!shouldShowBrandFriendsReachRow({ ...base, isFollowing: true }), "followers use the Following menu");
  assert(!shouldShowBrandFriendsReachRow({ ...base, userId: null }), "signed out");
  assert(!shouldShowBrandFriendsReachRow({ ...base, extendedEnabled: false }), "not true when opted out");
  assert(shouldShowBrandFriendsReachRow({ ...base, extendedEnabled: false, stopped: true }), "undo stays reachable");

  const settings = await read("../AccountSettings.tsx");
  assert(/friendsReach\.controlsLive \? \(/.test(settings), "settings row gated on controls");
  assert(settings.includes('testID="settings-friends-reach-row"'), "settings row present");
  const sheet = await read("../BrandFollowOverflowSheet.tsx");
  assert(/friendsReach\.controlsLive \? \(/.test(sheet), "Following-menu row gated on controls");
  assert(sheet.includes("setBrandStopped(row.brandId, true, true)"), "Following-menu row unfollows and stops");
  const manage = await read("../BrandsYouFollowManageSheet.tsx");
  assert(manage.includes("setBrandStopped(brandId, false)"), "undo list allows again");
  assert(manage.includes('testID="brands-manage-stopped"'), "undo list present");
  const screen = await read("../../../screens/ConsumerBrandProfileScreen.tsx");
  assert(screen.includes("shouldShowBrandFriendsReachRow("), "brand page row is gated");
});

Deno.test("#3682 received brand invites read with the true reason", async () => {
  const server = await read("../../../../../supabase/functions/_shared/brandReachMessages.ts");
  for (const [code, line] of [
    ["extended", "A friend of yours follows ${brand}."],
    ["book", "You're on ${brand}'s guest list."],
    ["follower", "You follow ${brand}."],
  ]) {
    assert(server.includes(line), `server copy drifted: ${line}`);
    assertEq(brandReachReasonLine(code, "X"), line.replace("${brand}", "X"), `client copy ${code}`);
  }
  assertEq(
    brandReachRowCopy("You're invited to Rooftop. A friend of yours follows Harmattan.", {
      reason: "extended",
      brand_name: "Harmattan",
    }),
    { body: "You're invited to Rooftop.", reason: "A friend of yours follows Harmattan.", reasonCode: "extended" },
    "split",
  );
  assertEq(brandReachRowCopy("Hello.", { reason: "friend_of_maya", brand_name: "H" }).reason, null,
    "unknown reason codes are never shown");
  assertEq(brandReachRowCopy("Hello.", { reason: "follower", brand_name: "H" }),
    { body: "Hello.", reason: null, reasonCode: null }, "no duplicate or invented reason");

  assert(isBrandReachType("brand_offering_invite") && isBrandReachType("brand_campaign_push"), "types");
  const list = await read("../../NotificationsSheet.tsx");
  assert(list.includes("brand_offering_invite: { name: 'ticket-outline'"), "invite icon");
  assert(list.includes("brand_campaign_push: { name: 'storefront'"), "campaign icon");
  assert(/if \(isActionable \|\| isBrandReachType\(notification\.type\)\) \{/.test(list),
    "brand rows are kept as read on tap, never deleted");
  assert(list.includes("notification-reason-"), "reason line rendered");
});
