import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { normalizePayoutBanks } from "../../services/payoutBanks.ts";

const read = (path: string): Promise<string> =>
  Deno.readTextFile(new URL(path, import.meta.url));

Deno.test("#4174 — both apps share a SemVer appVersion runtime", async () => {
  const explorer = JSON.parse(await read("../../../app.json")).expo;
  const host = JSON.parse(await read("../../../../mingla-business/app.json")).expo;

  assertMatch(explorer.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assertEquals(host.version, explorer.version);
  assertEquals(explorer.runtimeVersion, { policy: "appVersion" });
  assertEquals(host.ios.runtimeVersion, { policy: "appVersion" });
  assertEquals(host.android.runtimeVersion, { policy: "appVersion" });
});

Deno.test("#4174 — production simulation and APK profiles inherit production env", async () => {
  const explorer = JSON.parse(await read("../../../eas.json")).build;
  const host = JSON.parse(await read("../../../../mingla-business/eas.json")).build;

  for (const build of [explorer, host]) {
    assertEquals(build.production.environment, "production");
    assertEquals(build["production-apk"].extends, "production");
    assertEquals(build["production-apk"].autoIncrement, false);
    assertEquals(build["production-apk"].android.buildType, "apk");
    assertEquals(build["production-simulator"].extends, "production");
    assertEquals(build["production-simulator"].environment, "production");
    assertEquals(build["production-simulator"].autoIncrement, false);
    assertEquals(build["production-simulator"].ios.simulator, true);
    assertEquals(build["production-simulator"].ios.buildConfiguration, "Release");
  }

  const explorerConfig = await read("../../../app.config.js");
  const hostConfig = await read("../../../../mingla-business/app.config.js");
  for (const source of [explorerConfig, hostConfig]) {
    assertStringIncludes(source, '"production-apk"');
    assertStringIncludes(source, '"production-simulator"');
  }
  assertEquals(explorerConfig.includes('"preview-sim"'), false);
});

Deno.test("#4174 — native permission copy describes the features that request it", async () => {
  const explorer = JSON.parse(await read("../../../app.json")).expo;
  const host = JSON.parse(await read("../../../../mingla-business/app.json")).expo;
  const explorerPlist = explorer.ios.infoPlist;
  const hostPlist = host.ios.infoPlist;

  assertMatch(explorerPlist.NSCameraUsageDescription, /photos or videos.*chats/i);
  assertMatch(explorerPlist.NSMicrophoneUsageDescription, /sound.*videos.*chats/i);
  assertMatch(hostPlist.NSCameraUsageDescription, /tickets.*photos or videos.*event covers.*brand group chats/i);
  assertMatch(hostPlist.NSMicrophoneUsageDescription, /sound.*videos.*event covers.*brand group chats/i);
  assertMatch(hostPlist.NSLocationWhenInUseUsageDescription, /location.*marketing.*services/i);
});

Deno.test("#4174 — Nigerian payout banks render one choice per Paystack bank code", () => {
  const banks = [
    { code: "044", name: "Access Bank" },
    { code: "50572", name: "OPay" },
    { code: "50572", name: "OPay duplicate row" },
    { code: " 058 ", name: " Guaranty Trust Bank " },
    { code: "", name: "Missing code" },
    { code: "999", name: "   " },
    { code: null, name: "Malformed provider row" },
    { code: 123, name: "Wrong code type" },
  ];

  assertEquals(normalizePayoutBanks(banks), [
    { code: "044", name: "Access Bank" },
    { code: "50572", name: "OPay" },
    { code: "058", name: "Guaranty Trust Bank" },
  ]);
  assertEquals(banks[1], { code: "50572", name: "OPay" });
});

Deno.test("#4174 — claim links are registered for iOS and Android", async () => {
  const explorer = JSON.parse(await read("../../../app.json")).expo;
  const filter = explorer.android.intentFilters.find((candidate: { data?: Array<{ host?: string }> }) =>
    candidate.data?.some((entry) => entry.host === "usemingla.com")
  );
  assert(filter);
  assert(
    filter.data.some((entry: { host?: string; pathPrefix?: string }) =>
      entry.host === "usemingla.com" && entry.pathPrefix === "/c/"
    ),
  );

  const association = JSON.parse(
    await read("../../../../mingla-marketing/public/.well-known/apple-app-site-association"),
  );
  assert(association.applinks.details[0].paths.includes("/c/*"));
});

Deno.test("#4174 — release cold paths always expose an exit or sign-in action", async () => {
  const hostEditor = await read("../../../../mingla-business/src/components/event/EditPublishedScreen.tsx");
  const stay = await read("../../../app/stay/[groupId].tsx");
  const earningsClaim = await read("../../../app/claim/earnings.tsx");

  assertStringIncludes(hostEditor, 'router.replace(`/(tabs)/hub/events` as never)');
  assertEquals(hostEditor.includes('router.replace(`/(tabs)/events` as never)'), false);
  assertStringIncludes(stay, "router.canGoBack()");
  assertStringIncludes(stay, 'router.replace("/" as never)');
  assertStringIncludes(stay, 'accessibilityLabel="Close stay reservation"');
  assertStringIncludes(earningsClaim, "useAppStore");
  assertStringIncludes(earningsClaim, '{userId ? "Open earnings & rewards" : "Sign in"}');
});

Deno.test("#4174 — view-once media exposes report and person-block actions", async () => {
  const thread = await read("../MessageInterface.tsx");
  const photo = await read("../chat/ViewOncePhotoViewer.tsx");
  const video = await read("../chat/ChatVideoPlayerModal.tsx");

  for (const viewer of [photo, video]) {
    assertStringIncludes(viewer, "onReport?: () => void");
    assertStringIncludes(viewer, "onBlock?: () => void");
    assertStringIncludes(viewer, 't("chat:reportUser")');
    assertStringIncludes(viewer, 't("chat:blockUser")');
  }
  assertStringIncludes(thread, "handleReportMessageRequest(messageId)");
  assertStringIncludes(thread, "blockActiveViewOnceSender");
  assertStringIncludes(thread, "activeViewOnceMessage.senderId !== friend.eventBrandAccountId");
});
