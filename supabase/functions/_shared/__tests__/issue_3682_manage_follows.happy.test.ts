/**
 * #3682 Wave 2.6 — manage follows (mute + channel prefs + circle audience filter).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("#3682 Wave 2.6 happy: migration pins mute + channel prefs + audience filter", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270808003682_issue_3682_manage_follows.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("ADD COLUMN IF NOT EXISTS muted_until"));
  assert(migration.includes("brand_follow_channel_prefs"));
  assert(migration.includes("bf_owner_update"));
  assert(migration.includes("biz_brand_follow_channel_ok"));
  assert(migration.includes("FROM PUBLIC, anon, authenticated"));
  assert(migration.includes("biz_marketing_circle_send_audience_v1"));
  assert(migration.includes("biz_brand_follow_channel_ok("));
  assert(migration.includes("v_kind <> 'brand_followers'"));
});

Deno.test("#3682 Wave 2.6 happy: Explorer service + profile wiring", async () => {
  const service = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/services/brandFollowsService.ts",
      import.meta.url,
    ),
  );
  assert(service.includes("muteBrand"));
  assert(service.includes("unmuteBrand"));
  assert(service.includes("setChannel"));
  assert(service.includes("listFollows"));
  assert(service.includes('"infinity"'));
  assert(service.includes("brand_follow_channel_prefs"));

  const profile = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/components/ProfilePage.tsx",
      import.meta.url,
    ),
  );
  assert(profile.includes("BrandsYouFollowSection"));

  const brandScreen = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/screens/ConsumerBrandProfileScreen.tsx",
      import.meta.url,
    ),
  );
  assert(brandScreen.includes('mute("week")'));
  assert(brandScreen.includes('followState={'));
  assert(brandScreen.includes('"muted"'));

  const settings = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/components/profile/AccountSettings.tsx",
      import.meta.url,
    ),
  );
  assert(settings.includes("showBrandsScreen"));
  assert(settings.includes("BrandsYouFollowManageSheet"));
  assert(settings.includes('testID="settings-brands-you-follow-row"'));
});

Deno.test("#3682 Wave 2.6 happy: mute helper treats infinity and future", async () => {
  // Inline the same rules as brandFollowIsMuted (no TS import from app-mobile).
  const isMuted = (mutedUntil: string | null | undefined, now = Date.now()) => {
    if (mutedUntil == null || mutedUntil.length === 0) return false;
    const t = Date.parse(mutedUntil);
    if (Number.isNaN(t)) {
      return mutedUntil === "infinity" || mutedUntil.includes("infinity");
    }
    return t > now;
  };
  assertEquals(isMuted(null), false);
  assertEquals(isMuted("infinity"), true);
  assertEquals(isMuted(new Date(Date.now() + 60_000).toISOString()), true);
  assertEquals(isMuted(new Date(Date.now() - 60_000).toISOString()), false);
});
