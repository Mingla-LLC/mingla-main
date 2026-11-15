// MINGLA-INVARIANT: I-4238-AF-SERVER-RESPECTS-OPT-OUT | issue #4238 | the Explorer writes its "share usage data" choice to appsflyer_devices.tracking_opt_out on registration and on every change, and sends ad_tracking_opt_out on the native checkout create when opted out, so the server never posts af_purchase for an opted-out buyer.
// @ts-nocheck — Deno runtime test of the REAL appsFlyerService.ts and checkoutAdTracking.ts (fakes for their native imports).
/**
 * #4238 P1-4. The Explorer switch only anonymized the SDK; the server kept
 * posting af_purchase with the buyer's AppsFlyer id.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flush, loadWithFakes } from "./appsFlyerHarness.issue4238.ts";

function makeWorld(optOut: boolean) {
  const world = {
    optOut,
    initOk: null as null | ((r: unknown) => void),
    listeners: [] as Array<(s: unknown, p: unknown) => void>,
    upserts: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }>,
  };
  const appsFlyer = {
    initSdk: (_c: unknown, ok: (r: unknown) => void) => {
      world.initOk = ok;
    },
    onDeepLink: () => () => {},
    setOneLinkCustomDomains: () => {},
    performOnDeepLinking: () => {},
    startSdk: () => {},
    setCustomerUserId: () => {},
    logEvent: () => {},
    anonymizeUser: () => {},
    setUserEmails: (_o: unknown, ok: (r: unknown) => void) => ok({}),
    updateServerUninstallToken: () => {},
    getAppsFlyerUID: (cb: (e: unknown, uid: string) => void) => cb(null, "af-uid-explorer"),
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
    "react-native": { Platform: { OS: "ios" } },
    "./supabase": {
      supabase: {
        auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "a@b.co" } } }) },
        from: (table: string) => {
          assertEquals(table, "appsflyer_devices");
          return {
            upsert: (row: Record<string, unknown>) => {
              world.upserts.push(row);
              return { then: (f: (r: unknown) => void) => f({ error: null }) };
            },
            update: (values: Record<string, unknown>) => {
              const filters: Record<string, unknown> = {};
              const chain = {
                eq: (col: string, val: unknown) => {
                  filters[col] = val;
                  return chain;
                },
                then: (f: (r: unknown) => unknown, r?: (e: unknown) => unknown) => {
                  world.updates.push({ values, filters });
                  return Promise.resolve({ error: null }).then(f, r);
                },
              };
              return chain;
            },
          };
        },
      },
    },
    "./oneLinkResolver": { resolveOneLinkDestination: () => null, OneLinkDestination: undefined },
    "./nativeAdAttributionService": { captureNativeOneLinkAttribution: async () => {} },
    "../store/appStore": {
      useAppStore: {
        getState: () => ({ analyticsOptOut: world.optOut }),
        subscribe: (l: (s: unknown, p: unknown) => void) => {
          world.listeners.push(l);
          return () => {};
        },
      },
    },
    "@react-native-async-storage/async-storage": {
      default: { getItem: async () => null, setItem: async () => {} },
    },
    "./oneSignalService": { onPushSubscriptionToken: () => {} },
  };
  const setOptOut = (next: boolean) => {
    const prev = world.optOut;
    world.optOut = next;
    for (const l of world.listeners) l({ analyticsOptOut: next }, { analyticsOptOut: prev });
  };
  return { world, fakes, setOptOut };
}

Deno.test("#4238 P1-4 the device row carries the switch at registration", async () => {
  for (const optOut of [true, false]) {
    const { world, fakes } = makeWorld(optOut);
    const svc = await loadWithFakes("src/services/appsFlyerService.ts", fakes);
    svc.initializeAppsFlyer();
    world.initOk?.({});
    svc.setAppsFlyerUserId("u-1");
    svc.registerAppsFlyerDevice("u-1");
    await flush();
    assertEquals(world.upserts.length, 1);
    assertEquals(world.upserts[0].app, "consumer");
    assertEquals(world.upserts[0].tracking_opt_out, optOut);
  }
});

Deno.test("#4238 P1-4 switching off (and back on) updates this person's Explorer device rows", async () => {
  const { world, fakes, setOptOut } = makeWorld(false);
  const svc = await loadWithFakes("src/services/appsFlyerService.ts", fakes);
  svc.initializeAppsFlyer();
  world.initOk?.({});
  svc.startAppsFlyer();
  svc.setAppsFlyerUserId("u-1");
  setOptOut(true);
  await flush();
  assertEquals(world.updates.length, 1, "the opt-out never reached the server");
  assertEquals(world.updates[0].values, { tracking_opt_out: true });
  assertEquals(world.updates[0].filters, { user_id: "u-1", app: "consumer" });
  setOptOut(false);
  await flush();
  assertEquals(world.updates.at(-1).values, { tracking_opt_out: false });
  // Signed out: nothing to update (the next registration carries the value).
  svc.clearAppsFlyerUserId();
  setOptOut(true);
  await flush();
  assertEquals(world.updates.length, 2);
});

Deno.test("#4238 P1-4 the native checkout create carries ad_tracking_opt_out only when opted out", async () => {
  for (const [optOut, expected] of [[true, { ad_tracking_opt_out: true }], [false, {}]] as const) {
    const reader = await loadWithFakes("src/services/analyticsOptOut.ts", {
      "../store/appStore": { useAppStore: { getState: () => ({ analyticsOptOut: optOut }) } },
    });
    assertEquals(reader.explorerAnalyticsOptedOut(), optOut);
    const mod = await loadWithFakes("src/payments/checkoutAdTracking.ts", {
      // (the harness's require table is per load, so the reader is faked here)
      "../services/analyticsOptOut": { explorerAnalyticsOptedOut: () => optOut },
    });
    assertEquals(mod.checkoutAdTrackingFields(), expected);
  }
  // A store that cannot load reads "not opted out" and never throws.
  const broken = await loadWithFakes("src/services/analyticsOptOut.ts", {});
  assertEquals(broken.explorerAnalyticsOptedOut(), false);
  // Wiring: the create request body spreads these fields.
  const flow = await Deno.readTextFile(new URL("../../payments/nativeCheckoutFlow.ts", import.meta.url));
  const create = flow.slice(flow.indexOf('"ticket-checkout-create",\n'));
  assert(
    create.slice(0, create.indexOf("lines:")).includes("...checkoutAdTrackingFields(),"),
    "ticket-checkout-create body no longer carries the opt-out",
  );
});
