// MINGLA-INVARIANT: I-4238-AF-START-NEVER-LOST | issue #4238 | an Explorer AppsFlyer start, customer id or device registration requested before initSdk's callback is applied exactly once after init, and events logged before transmission are sent after it, in order (at most 50, dropped on sign-out).
// MINGLA-INVARIANT: I-4238-AF-RESPECTS-OPT-OUT | issue #4238 | with the Explorer "share usage data" switch off, AppsFlyer is anonymized and no AppsFlyer event, hashed email or uninstall token is sent.
// @ts-nocheck — Deno runtime test of the REAL appsFlyerService.ts (fakes for its native imports).
/**
 * #4238 Wave 6, Explorer (app-mobile): W6-1 start race + queue, W6-5 uninstall
 * token, W6-6 opt-out, W6-7 registration once + method, W6-11 SHA-256 email.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flush, loadWithFakes } from "./appsFlyerHarness.issue4238.ts";

function makeWorld(opts: { platform?: "ios" | "android"; optOut?: boolean; user?: { id: string; email: string } | null } = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
  };
  const world = {
    platform: opts.platform ?? "ios",
    optOut: opts.optOut ?? false,
    initOk: null as null | ((r: unknown) => void),
    storeListeners: [] as Array<(s: unknown, p: unknown) => void>,
    tokenListener: null as null | ((t: string | null) => void),
    user: opts.user ?? null,
    storage: new Map<string, string>(),
    calls,
  };
  const appsFlyer = {
    initSdk: (_cfg: unknown, ok: (r: unknown) => void) => {
      world.initOk = ok;
    },
    onDeepLink: () => () => {},
    setOneLinkCustomDomains: () => {},
    performOnDeepLinking: () => {},
    startSdk: rec("startSdk"),
    setCustomerUserId: rec("setCustomerUserId"),
    logEvent: rec("logEvent"),
    anonymizeUser: rec("anonymizeUser"),
    setUserEmails: (o: unknown, ok: (r: unknown) => void) => {
      calls.push(["setUserEmails", [o]]);
      ok({});
    },
    updateServerUninstallToken: rec("updateServerUninstallToken"),
    getAppsFlyerUID: (cb: (e: unknown, uid: string) => void) => {
      calls.push(["getAppsFlyerUID", []]);
      cb(null, "af-uid-explorer");
    },
  };
  const fakes = {
    "react-native-appsflyer": { default: appsFlyer },
    "expo-constants": {
      default: {
        expoConfig: {
          extra: {
            EXPO_PUBLIC_APPSFLYER_DEV_KEY: "k",
            EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "6760440898",
            EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.mingla.app.v2",
          },
        },
      },
    },
    "react-native": { Platform: { get OS() { return world.platform; } } },
    "./supabase": {
      supabase: {
        auth: { getUser: async () => ({ data: { user: world.user } }) },
        from: () => ({ upsert: () => ({ then: (f: (r: unknown) => void) => f({ error: null }) }) }),
      },
    },
    "./oneLinkResolver": { resolveOneLinkDestination: () => null, OneLinkDestination: undefined },
    "./nativeAdAttributionService": { captureNativeOneLinkAttribution: async () => {} },
    "../store/appStore": {
      useAppStore: {
        getState: () => ({ analyticsOptOut: world.optOut }),
        subscribe: (l: (s: unknown, p: unknown) => void) => {
          world.storeListeners.push(l);
          return () => {};
        },
      },
    },
    "@react-native-async-storage/async-storage": {
      default: {
        getItem: async (k: string) => world.storage.get(k) ?? null,
        setItem: async (k: string, v: string) => {
          world.storage.set(k, v);
        },
      },
    },
    "./oneSignalService": {
      onPushSubscriptionToken: (l: (t: string | null) => void) => {
        world.tokenListener = l;
      },
    },
  };
  const named = (n: string) => calls.filter((c) => c[0] === n);
  const setOptOut = (next: boolean) => {
    const prev = world.optOut;
    world.optOut = next;
    for (const l of world.storeListeners) l({ analyticsOptOut: next }, { analyticsOptOut: prev });
  };
  return { world, fakes, named, setOptOut };
}

const load = (fakes: Record<string, Record<string, unknown>>) =>
  loadWithFakes("src/services/appsFlyerService.ts", fakes);

Deno.test("#4238 W6-1 ATT resolving before init no longer skips the start: startSdk runs once after init", async () => {
  const { world, fakes, named } = makeWorld();
  const svc = await load(fakes);
  svc.initializeAppsFlyer();
  svc.startAppsFlyer(); // ATT resolved first
  svc.setAppsFlyerUserId("u-1");
  svc.registerAppsFlyerDevice("u-1");
  svc.logAppsFlyerEvent("af_content_view", { id: "1" });
  svc.logAppsFlyerEvent("af_add_to_wishlist", { id: "2" });
  assertEquals(named("startSdk").length, 0);
  assertEquals(named("logEvent").length, 0);
  world.initOk?.({});
  assertEquals(named("startSdk").length, 1, "start applied once after init");
  assertEquals(named("setCustomerUserId").length, 1);
  assertEquals(named("getAppsFlyerUID").length, 1, "device registration replayed");
  assertEquals(named("logEvent").map((c) => c[1][0]), ["af_content_view", "af_add_to_wishlist"]);
  svc.startAppsFlyer();
  world.initOk?.({});
  assertEquals(named("startSdk").length, 1, "never a second start");
  assertEquals(named("logEvent").length, 2);
});

Deno.test("#4238 W6-1 events between init and start are held until start; the queue caps at 50 and sign-out drops it", async () => {
  const a = makeWorld();
  const svc = await load(a.fakes);
  svc.initializeAppsFlyer();
  a.world.initOk?.({});
  for (let i = 0; i < 60; i += 1) svc.logAppsFlyerEvent(`e${i}`, {});
  assertEquals(a.named("logEvent").length, 0, "manualStart: nothing before startSdk");
  svc.startAppsFlyer();
  assertEquals(a.named("logEvent").length, svc.PRE_START_EVENT_QUEUE_MAX);
  assertEquals(a.named("logEvent")[0][1][0], "e10", "oldest dropped");

  const b = makeWorld();
  const svc2 = await load(b.fakes);
  svc2.initializeAppsFlyer();
  svc2.logAppsFlyerEvent("before_sign_out", {});
  svc2.clearAppsFlyerUserId();
  b.world.initOk?.({});
  svc2.startAppsFlyer();
  assertEquals(b.named("logEvent").length, 0, "queue dropped on sign-out");
});

Deno.test("#4238 W6-6 opt-out anonymizes and logs nothing; opting back in restores", async () => {
  const { world, fakes, named, setOptOut } = makeWorld({ optOut: true, user: { id: "u-1", email: "a@b.co" } });
  const svc = await load(fakes);
  svc.initializeAppsFlyer();
  world.initOk?.({});
  svc.startAppsFlyer();
  assertEquals(named("anonymizeUser")[0][1][0], true);
  svc.logAppsFlyerEvent("af_content_view", {});
  svc.setAppsFlyerUserId("u-1");
  await flush();
  assertEquals(named("logEvent").length, 0);
  assert(!named("setUserEmails").some((c) => c[1][0].emails.length > 0), "no email while opted out");
  setOptOut(false);
  await flush();
  assertEquals(named("anonymizeUser").at(-1)[1][0], false);
  svc.logAppsFlyerEvent("af_content_view", {});
  assertEquals(named("logEvent").length, 1);
});

Deno.test("#4238 W6-11 sign-in sends the email with crypt type 3; sign-out clears it", async () => {
  const { world, fakes, named } = makeWorld({ user: { id: "u-1", email: " Guest@Example.COM " } });
  const svc = await load(fakes);
  svc.initializeAppsFlyer();
  world.initOk?.({});
  svc.setAppsFlyerUserId("u-1");
  await flush();
  const sent = named("setUserEmails").map((c) => c[1][0]);
  assertEquals(sent[0], { emails: ["guest@example.com"], emailsCryptType: 3 });
  assertEquals(svc.APPSFLYER_EMAIL_CRYPT_SHA256, 3);
  svc.clearAppsFlyerUserId();
  assertEquals(named("setUserEmails").at(-1)[1][0], { emails: [], emailsCryptType: 3 });
});

Deno.test("#4238 W6-5 the uninstall token: APNs hex on iOS, FCM on Android, a Firebase Installation ID refused", async () => {
  const ios = makeWorld();
  const svc = await load(ios.fakes);
  svc.initializeAppsFlyer();
  ios.world.tokenListener?.("AB".repeat(32));
  assertEquals(ios.named("updateServerUninstallToken").length, 0, "held until init");
  ios.world.initOk?.({});
  assertEquals(ios.named("updateServerUninstallToken")[0][1][0], "ab".repeat(32));
  ios.world.tokenListener?.("ab".repeat(32));
  assertEquals(ios.named("updateServerUninstallToken").length, 1, "once per token change");

  const android = makeWorld({ platform: "android" });
  const svc2 = await load(android.fakes);
  svc2.initializeAppsFlyer();
  android.world.initOk?.({});
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => errors.push(a[0]);
  try {
    android.world.tokenListener?.("cXbz1Xyz-abcdEFGHijk_l");
  } finally {
    console.error = orig;
  }
  assertEquals(android.named("updateServerUninstallToken").length, 0);
  assert(String(errors[0]).includes("Firebase Installation ID"));
  const fcm = `fid:APA91b${"x".repeat(140)}`;
  android.world.tokenListener?.(fcm);
  assertEquals(android.named("updateServerUninstallToken")[0][1][0], fcm);
});

Deno.test("#4238 W6-7 two sessions before onboarding finishes give one af_complete_registration, with the real method", async () => {
  const { world, fakes, named } = makeWorld();
  const svc = await load(fakes);
  svc.initializeAppsFlyer();
  world.initOk?.({});
  svc.startAppsFlyer();
  const input = { userId: "u-1", provider: "phone", completedOnboarding: false, country: "NG" };
  assertEquals(await svc.logAppsFlyerAuthOutcome(input), "registration");
  // App killed and reopened before onboarding finished: a fresh module, same device storage.
  const svc2 = await load({ ...fakes });
  svc2.initializeAppsFlyer();
  world.initOk?.({});
  svc2.startAppsFlyer();
  assertEquals(await svc2.logAppsFlyerAuthOutcome(input), "already_registered");
  const regs = named("logEvent").filter((c) => c[1][0] === "af_complete_registration");
  assertEquals(regs.length, 1);
  assertEquals(regs[0][1][1], { af_registration_method: "phone", country: "NG" });
  assertEquals(await svc2.logAppsFlyerAuthOutcome({ ...input, completedOnboarding: true, provider: "email" }), "login");
  const last = named("logEvent").at(-1)[1];
  assertEquals([last[0], last[1]], ["af_login", { af_login_method: "email" }]);
  assertEquals(svc.appsFlyerAuthMethod("apple"), "apple");
  assertEquals(svc.appsFlyerAuthMethod("google"), "google");
  assertEquals(svc.appsFlyerAuthMethod(undefined), "email");
});

Deno.test("#4238 W6-1 wiring: exactly one startSdk, inside startAppsFlyer (ATT gate unchanged)", async () => {
  const src = (await Deno.readTextFile(new URL("../appsFlyerService.ts", import.meta.url)))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assertEquals((src.match(/appsFlyer\.startSdk\(\)/g) ?? []).length, 1);
  assert(src.indexOf("appsFlyer.startSdk()") > src.indexOf("export function startAppsFlyer"));
});
