// @ts-nocheck — Deno runtime test of the REAL appsFlyerService.ts wired to the REAL
// peopleJourneyService.ts (fakes only for native imports and the network).
//
// #4226 tester adversarial: install attribution must land on the device row for a
// brand-new sign-in on this phone. app/index.tsx calls setAppsFlyerUserId(user.id)
// and then registerAppsFlyerDevice(user.id) back to back. record_install_attribution
// is an UPDATE of the caller's own appsflyer_devices row and returns no error when
// that row does not exist yet (0 rows). The client must therefore not treat the
// first call as "sent" before the device row exists, or the attribution is never
// written for that session.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flush, loadWithFakes } from "./appsFlyerHarness.issue4238.ts";

Deno.test("#4226 adversarial: a first sign-in on a new phone still stores the install attribution on the device row", async () => {
  // A tiny model of the server: the device row exists only once the upsert ran;
  // the RPC updates it only if it exists (exactly what the SQL does) and never errors.
  const deviceRows = new Map<string, Record<string, unknown>>();
  const rpcCalls: string[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(name);
      if (name === "record_install_attribution") {
        const row = deviceRows.get(`u-1:${args.p_app}:${args.p_appsflyer_id}`);
        if (row && row.media_source == null) row.media_source = (args.p_payload as Record<string, unknown>).media_source;
      }
      return { error: null };
    },
    from: () => ({
      upsert: (row: Record<string, unknown>) => ({
        then: (f: (r: { error: null }) => void) => {
          // The upsert request goes out after the RPC request (call order in
          // app/index.tsx), so it lands on the server after it.
          setTimeout(() => {
            deviceRows.set(`${row.user_id}:${row.app}:${row.appsflyer_uid}`, { ...row, media_source: null });
            f({ error: null });
          }, 0);
        },
      }),
      update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
    }),
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "a@b.co" } } }) },
  };
  const asyncStore = { default: { getItem: async () => null, setItem: async () => {} } };
  const journey = await loadWithFakes("src/services/peopleJourneyService.ts", {
    "./supabase": { supabase: db },
    "@react-native-async-storage/async-storage": asyncStore,
  });

  let initOk: ((r: unknown) => void) | null = null;
  let conversionCb: ((r: unknown) => void) | null = null;
  const appsFlyer = {
    initSdk: (_c: unknown, ok: (r: unknown) => void) => { initOk = ok; },
    onDeepLink: () => () => {},
    onInstallConversionData: (cb: (r: unknown) => void) => { conversionCb = cb; return () => {}; },
    setOneLinkCustomDomains: () => {},
    performOnDeepLinking: () => {},
    startSdk: () => {},
    setCustomerUserId: () => {},
    logEvent: () => {},
    anonymizeUser: () => {},
    setUserEmails: (_o: unknown, ok: (r: unknown) => void) => ok({}),
    updateServerUninstallToken: () => {},
    getAppsFlyerUID: (cb: (e: unknown, uid: string) => void) => cb(null, "af-uid"),
  };
  const svc = await loadWithFakes("src/services/appsFlyerService.ts", {
    "react-native-appsflyer": { default: appsFlyer },
    "expo-constants": { default: { expoConfig: { extra: { EXPO_PUBLIC_APPSFLYER_DEV_KEY: "k", EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "1", EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "a" } } } },
    "react-native": { Platform: { OS: "ios" } },
    "./supabase": { supabase: db },
    "./oneLinkResolver": { resolveOneLinkDestination: () => null, OneLinkDestination: undefined },
    "./nativeAdAttributionService": { captureNativeOneLinkAttribution: async () => {} },
    "./peopleJourneyService": journey,
    "../store/appStore": { useAppStore: { getState: () => ({ analyticsOptOut: false }), subscribe: () => () => {} } },
    "@react-native-async-storage/async-storage": asyncStore,
    "./oneSignalService": { onPushSubscriptionToken: () => {} },
  });

  svc.initializeAppsFlyer();
  initOk?.({});
  // The conversion data arrives at first launch, long before the OTP sign-up finishes.
  conversionCb?.({ type: "onInstallConversionDataLoaded", data: { af_status: "Non-organic", media_source: "Facebook Ads" } });
  await flush();

  // First sign-in on this phone: exactly the app/index.tsx order.
  svc.setAppsFlyerUserId("u-1");
  svc.registerAppsFlyerDevice("u-1");
  await new Promise((r) => setTimeout(r, 20));
  await flush(20);

  const row = deviceRows.get("u-1:consumer:af-uid");
  assertEquals(row?.user_id, "u-1", "the device row was registered");
  assertEquals(
    row?.media_source,
    "Facebook Ads",
    `the install attribution never reached the device row (record_install_attribution calls: ${rpcCalls.filter((n) => n === "record_install_attribution").length})`,
  );
});
