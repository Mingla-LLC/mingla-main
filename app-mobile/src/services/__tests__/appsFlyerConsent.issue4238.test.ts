// MINGLA-INVARIANT: I-4238-AF-DMA-CONSENT-EXPLORER | issue #4238 | on an EU / EEA / UK device the Explorer gives AppsFlyer DMA consent data (setConsentData) from the "share usage data" switch before startSdk and on every change; elsewhere it says GDPR does not apply.
// @ts-nocheck — Deno runtime test of the REAL appsFlyerConsent.ts and appsFlyerService.ts (fakes for native imports).
/**
 * #4238 P2-2 (W6-6). setConsentData was never called, so AppsFlyer had no DMA
 * consent signal for European installs.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as consent from "../appsFlyerConsent.ts";
import { flush, loadWithFakes } from "./appsFlyerHarness.issue4238.ts";

Deno.test("#4238 P2-2 consent data: EU/EEA/UK follows the switch, elsewhere not subject to GDPR", () => {
  const on = { isUserSubjectToGDPR: true, hasConsentForDataUsage: true, hasConsentForAdsPersonalization: true, hasConsentForAdStorage: true };
  const off = { isUserSubjectToGDPR: true, hasConsentForDataUsage: false, hasConsentForAdsPersonalization: false, hasConsentForAdStorage: false };
  assertEquals(consent.appsFlyerConsentFor(false, "GB"), on);
  assertEquals(consent.appsFlyerConsentFor(false, "de"), on);
  assertEquals(consent.appsFlyerConsentFor(true, "FR"), off);
  assertEquals(consent.appsFlyerConsentFor(true, "NO"), off);
  assertEquals(consent.appsFlyerConsentFor(false, "US"), { isUserSubjectToGDPR: false });
  assertEquals(consent.appsFlyerConsentFor(true, "NG"), { isUserSubjectToGDPR: false });
  assertEquals(consent.appsFlyerConsentFor(false, null), { isUserSubjectToGDPR: false });
  assertEquals(consent.regionFromLocale("en-GB"), "GB");
  assertEquals(consent.regionFromLocale("zh-Hant-TW"), "TW");
  assertEquals(consent.regionFromLocale("en"), null);
  assertEquals(consent.DMA_REGION_CODES.size, 31);
});

function makeWorld(optOut: boolean, region: string) {
  const world = { optOut, initOk: null, listeners: [], calls: [] as Array<[string, unknown]> };
  const appsFlyer = {
    initSdk: (_c: unknown, ok: (r: unknown) => void) => {
      world.initOk = ok;
    },
    onDeepLink: () => () => {},
    setOneLinkCustomDomains: () => {},
    performOnDeepLinking: () => {},
    startSdk: () => world.calls.push(["startSdk", null]),
    setCustomerUserId: () => {},
    logEvent: () => {},
    anonymizeUser: () => {},
    setUserEmails: (_o: unknown, ok: (r: unknown) => void) => ok({}),
    updateServerUninstallToken: () => {},
    getAppsFlyerUID: (cb: (e: unknown, uid: string) => void) => cb(null, "af"),
    setConsentData: (c: unknown) => world.calls.push(["setConsentData", c]),
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
    "./supabase": { supabase: { auth: { getUser: async () => ({ data: { user: null } }) }, from: () => ({}) } },
    "./oneLinkResolver": { resolveOneLinkDestination: () => null, OneLinkDestination: undefined },
    "./nativeAdAttributionService": { captureNativeOneLinkAttribution: async () => {} },
    "../store/appStore": {
      useAppStore: {
        getState: () => ({ analyticsOptOut: world.optOut }),
        subscribe: (l) => {
          world.listeners.push(l);
          return () => {};
        },
      },
    },
    "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {} } },
    "./oneSignalService": { onPushSubscriptionToken: () => {} },
    "./appsFlyerConsent": consent,
    "expo-localization": { getLocales: () => [{ regionCode: region }] },
  };
  const setOptOut = (next: boolean) => {
    const prev = world.optOut;
    world.optOut = next;
    for (const l of world.listeners) l({ analyticsOptOut: next }, { analyticsOptOut: prev });
  };
  return { world, fakes, setOptOut };
}

Deno.test("#4238 P2-2 a UK device sets consent before startSdk, and again when the switch changes", async () => {
  const { world, fakes, setOptOut } = makeWorld(false, "GB");
  const svc = await loadWithFakes("src/services/appsFlyerService.ts", fakes);
  svc.initializeAppsFlyer();
  world.initOk?.({});
  svc.startAppsFlyer();
  const names = world.calls.map((c) => c[0]);
  assertEquals(names.indexOf("setConsentData") >= 0 && names.indexOf("setConsentData") < names.indexOf("startSdk"), true);
  assertEquals(world.calls[0][1].hasConsentForDataUsage, true);
  setOptOut(true);
  await flush();
  const last = world.calls.filter((c) => c[0] === "setConsentData").at(-1)[1];
  assertEquals(last, {
    isUserSubjectToGDPR: true,
    hasConsentForDataUsage: false,
    hasConsentForAdsPersonalization: false,
    hasConsentForAdStorage: false,
  });
});

Deno.test("#4238 P2-2 a US device tells AppsFlyer GDPR does not apply", async () => {
  const { world, fakes } = makeWorld(false, "US");
  const svc = await loadWithFakes("src/services/appsFlyerService.ts", fakes);
  svc.initializeAppsFlyer();
  world.initOk?.({});
  assertEquals(world.calls.find((c) => c[0] === "setConsentData")[1], { isUserSubjectToGDPR: false });
});
