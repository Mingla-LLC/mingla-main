// MINGLA-INVARIANT: I-4226-JOURNEY-TRACKING-NEVER-BLOCKS-EXPLORER | issue #4226 | the Explorer records its onboarding step, sign-up source and AppsFlyer install attribution through fire-and-forget RPCs that log (never throw), are held until the user is known, and are cleared on sign-out.
// @ts-nocheck — Deno runtime test of the REAL peopleJourneyService.ts, screenTracking.ts and appsFlyerService.ts (fakes for native imports).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flush, loadWithFakes } from "./appsFlyerHarness.issue4238.ts";

function makeJourney(opts: { rpcError?: boolean; attributionAnswers?: unknown[] } = {}) {
  const answers = [...(opts.attributionAnswers ?? [])];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const store = new Map<string, string>();
  const fakes = {
    "./supabase": {
      supabase: {
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          if (name === "record_install_attribution") {
            if (opts.rpcError) return { data: null, error: { message: "boom" } };
            return { data: answers.length ? answers.shift() : true, error: null };
          }
          return { error: opts.rpcError ? { message: "boom" } : null };
        },
      },
    },
    "@react-native-async-storage/async-storage": {
      default: {
        getItem: async (k: string) => store.get(k) ?? null,
        setItem: async (k: string, v: string) => void store.set(k, v),
      },
    },
  };
  return { calls, store, fakes };
}

const load = (fakes) => loadWithFakes("src/services/peopleJourneyService.ts", fakes);

Deno.test("#4226 a journey mark is sent for EVERY onboarding step shown, the first included", async () => {
  const { calls, fakes } = makeJourney();
  const j = await load(fakes);
  const { STEP_SUBSTEPS, TICKET_FIRST_SUBSTEPS } = await loadWithFakes("src/hooks/onboardingSequenceLogic.ts", {
    "../types/onboarding": {},
    "./ticketFirstLogic": {},
  });
  const shown: Array<[number, string]> = [];
  for (const [step, subs] of Object.entries(STEP_SUBSTEPS)) for (const s of subs) shown.push([Number(step), s]);
  for (const s of TICKET_FIRST_SUBSTEPS) shown.push([1, s]);
  for (const [step, key] of shown) j.recordJourneyMark("explorer_onboarding", step, key);
  await flush();
  const first = calls[0];
  assertEquals(first.name, "record_journey_mark");
  assertEquals(first.args, { p_kind: "explorer_onboarding", p_step: 1, p_step_key: "language" });
  const sent = new Set(calls.map((c) => `${c.args.p_step}:${c.args.p_step_key}`));
  for (const [step, key] of shown) assert(sent.has(`${step}:${key}`), `no mark for ${step}:${key}`);
  for (const [, key] of shown) assert(/^[a-z_]+$/.test(key), `unstable key ${key}`);
});

Deno.test("#4226 a repeat view of the same step is sent once; a failed write retries on the next view", async () => {
  const ok = makeJourney();
  const j = await load(ok.fakes);
  j.recordJourneyMark("explorer_onboarding", 2, "intents");
  j.recordJourneyMark("explorer_onboarding", 2, "intents");
  await flush();
  assertEquals(ok.calls.length, 1);
  const bad = makeJourney({ rpcError: true });
  const k = await load(bad.fakes);
  k.recordJourneyMark("explorer_onboarding", 2, "intents");
  await flush();
  k.recordJourneyMark("explorer_onboarding", 2, "intents");
  await flush();
  assertEquals(bad.calls.length, 2, "a failed mark was never retried");
});

Deno.test("#4226 a failing or throwing RPC never throws to the caller", async () => {
  const { fakes } = makeJourney();
  fakes["./supabase"].supabase.rpc = async () => { throw new Error("network down"); };
  const j = await load(fakes);
  j.recordJourneyMark("explorer_onboarding", 1, "welcome");
  await j.recordSignupSourceOnce({ userId: "u", hints: {}, optedOut: false });
  await flush();
});

Deno.test("#4226 signup source order: friend invite, collab invite, ticket link, referral, AppsFlyer, unknown", async () => {
  const j = await load(makeJourney().fakes);
  const all = { friendInvite: true, collabInvite: true, ticketLink: true, referralLink: true };
  const conv = { af_status: "Non-organic", media_source: "Facebook Ads", campaign: "lagos" };
  assertEquals(j.deriveSignupSource(all, conv, false).source, "friend_invite");
  assertEquals(j.deriveSignupSource({ ...all, friendInvite: false }, conv, false).source, "collab_invite");
  assertEquals(j.deriveSignupSource({ ...all, friendInvite: false, collabInvite: false }, conv, false).source, "ticket_link");
  assertEquals(j.deriveSignupSource({ ...j.EMPTY_SOURCE_HINTS, referralLink: true }, conv, false).source, "referral_link");
  assertEquals(j.deriveSignupSource(j.EMPTY_SOURCE_HINTS, conv, false), {
    source: "paid_ad",
    detail: { media_source: "Facebook Ads", campaign: "lagos" },
  });
  assertEquals(j.deriveSignupSource(j.EMPTY_SOURCE_HINTS, { af_status: "Organic" }, false).source, "organic");
  assertEquals(j.deriveSignupSource(j.EMPTY_SOURCE_HINTS, null, false).source, "unknown");
  assertEquals(j.deriveSignupSource(j.EMPTY_SOURCE_HINTS, {}, false).source, "unknown");
  // opted out: AppsFlyer data is not used, invites still are
  assertEquals(j.deriveSignupSource(j.EMPTY_SOURCE_HINTS, conv, true).source, "unknown");
  assertEquals(j.deriveSignupSource({ ...j.EMPTY_SOURCE_HINTS, friendInvite: true }, conv, true).source, "friend_invite");
});

Deno.test("#4226 the signup source is recorded once per account with the explorer surface", async () => {
  const { calls, fakes } = makeJourney();
  const j = await load(fakes);
  j.holdInstallConversion({ af_status: "Non-organic", media_source: "tiktokglobal_int", campaign: "c1" });
  await j.recordSignupSourceOnce({ userId: "u-1", hints: {}, optedOut: false });
  await j.recordSignupSourceOnce({ userId: "u-1", hints: {}, optedOut: false });
  const writes = calls.filter((c) => c.name === "record_signup_source");
  assertEquals(writes.length, 1);
  assertEquals(writes[0].args, {
    p_source: "paid_ad",
    p_detail: { media_source: "tiktokglobal_int", campaign: "c1" },
    p_surface: "explorer_app",
  });
  // a later app run for the same account finds the saved flag and sends nothing
  const again = await load(fakes);
  await again.recordSignupSourceOnce({ userId: "u-1", hints: {}, optedOut: false });
  assertEquals(calls.filter((c) => c.name === "record_signup_source").length, 1);
});

Deno.test("#4226 conversion data is held until the user is known, then sent once with the consumer app value", async () => {
  const { calls, fakes } = makeJourney();
  const j = await load(fakes);
  j.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
  assertEquals(await j.sendHeldInstallAttribution({ userId: null, appsflyerId: "af-1", optedOut: false, platform: "ios", appId: "app-1" }), "held");
  assertEquals(calls.length, 0);
  assertEquals(await j.sendHeldInstallAttribution({ userId: "u-1", appsflyerId: "af-1", optedOut: false, platform: "ios", appId: "app-1" }), "sent");
  // handled: the held payload is cleared, so a repeat has nothing left to send
  assertEquals(await j.sendHeldInstallAttribution({ userId: "u-1", appsflyerId: "af-1", optedOut: false, platform: "ios", appId: "app-1" }), "held");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "record_install_attribution");
  assertEquals(calls[0].args.p_app, "consumer");
  assertEquals(calls[0].args.p_appsflyer_id, "af-1");
  assertEquals(calls[0].args.p_payload, { af_status: "Non-organic", media_source: "x", platform: "ios", app_id: "app-1" });
});

Deno.test("#4226 sign-out and opt-out clear held attribution (Constitution 6)", async () => {
  const { calls, fakes } = makeJourney();
  const j = await load(fakes);
  j.holdInstallConversion({ af_status: "Organic" });
  j.noteSourceHints({ friendInvite: true });
  j.clearPeopleJourneyState();
  assertEquals(j.getHeldInstallConversion(), null);
  assertEquals(j.getSourceHints().friendInvite, false);
  assertEquals(await j.sendHeldInstallAttribution({ userId: "u-2", appsflyerId: "af", optedOut: false, platform: "ios", appId: "app-1" }), "held");
  j.holdInstallConversion({ af_status: "Organic" });
  assertEquals(await j.sendHeldInstallAttribution({ userId: "u-2", appsflyerId: "af", optedOut: true, platform: "ios", appId: "app-1" }), "skipped");
  assertEquals(j.getHeldInstallConversion(), null);
  assertEquals(calls.length, 0);
});

Deno.test("#4226 the AppsFlyer service holds conversion data that arrives before sign-in and sends it after auth", async () => {
  const sent: unknown[] = [];
  let initOk: ((r: unknown) => void) | null = null;
  let conversionCb: ((r: unknown) => void) | null = null;
  let cleared = 0;
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
  let held: unknown = null;
  const fakes = {
    "react-native-appsflyer": { default: appsFlyer },
    "expo-constants": { default: { expoConfig: { extra: { EXPO_PUBLIC_APPSFLYER_DEV_KEY: "k", EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "1", EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "a" } } } },
    "react-native": { Platform: { OS: "ios" } },
    "./supabase": { supabase: { auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "a@b.co" } } }) }, from: () => ({ upsert: () => ({ then: (f) => f({ error: null }) }) }) } },
    "./oneLinkResolver": { resolveOneLinkDestination: () => null, OneLinkDestination: undefined },
    "./nativeAdAttributionService": { captureNativeOneLinkAttribution: async () => {} },
    "./peopleJourneyService": {
      clearPeopleJourneyState: () => { cleared += 1; held = null; },
      dropHeldInstallConversion: () => { held = null; },
      getHeldInstallConversion: () => held,
      holdInstallConversion: (d: unknown) => { held = d; },
      sendHeldInstallAttribution: async (ctx: { userId: string | null }) => {
        if (!ctx.userId || !held) return "held";
        sent.push({ ...ctx, payload: held });
        return "sent";
      },
    },
    "../store/appStore": { useAppStore: { getState: () => ({ analyticsOptOut: false }), subscribe: () => () => {} } },
    "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {} } },
    "./oneSignalService": { onPushSubscriptionToken: () => {} },
  };
  const svc = await loadWithFakes("src/services/appsFlyerService.ts", fakes);
  svc.initializeAppsFlyer();
  assert(conversionCb, "onInstallConversionData listener not registered");
  initOk?.({});
  conversionCb({ type: "onInstallConversionDataLoaded", data: { af_status: "Non-organic", media_source: "m" } });
  await flush();
  assertEquals(sent.length, 0, "sent before the user was known");
  svc.setAppsFlyerUserId("u-1");
  await flush();
  assertEquals(sent.length, 1);
  assertEquals(sent[0].userId, "u-1");
  assertEquals(sent[0].appsflyerId, "af-uid");
  assertEquals(sent[0].platform, "ios");
  assertEquals(sent[0].appId, "1", "app_id comes from the same source as the device upsert");
  svc.clearAppsFlyerUserId();
  assertEquals(cleared, 1, "sign-out did not clear the held state");
});

Deno.test("#4226 the PostHog super property app=explorer is registered, and a client failure never throws", async () => {
  const t = await loadWithFakes("src/services/screenTracking.ts", {});
  const registered: unknown[] = [];
  assertEquals(t.registerAppSuperProperty({ register: (p) => { registered.push(p); return Promise.resolve(); } }), true);
  assertEquals(registered, [{ app: "explorer" }]);
  assertEquals(t.registerAppSuperProperty(null), false);
  assertEquals(t.registerAppSuperProperty({ register: () => { throw new Error("x"); } }), false);
  t.registerAppSuperProperty({ register: () => Promise.reject(new Error("net")) });
  await flush();
});

Deno.test("#4226 screen names are stable and carry no ids; one screen per change; opt-out stops it", async () => {
  const t = await loadWithFakes("src/services/screenTracking.ts", {});
  assertEquals(t.screenNameForRoute(["b", "[brandSlug]", "[slug]"]), "route_b_brand_slug_slug");
  assertEquals(t.screenNameForRoute(["index"]), null);
  assertEquals(t.screenNameForRoute([]), null);
  assertEquals(t.screenNameForRoute(["(tabs)", "creator"]), "route_creator");
  const base = { isLoadingAuth: false, isAuthenticated: true, inOnboarding: false, showPreferences: false, currentPage: "home" };
  assertEquals(t.screenNameForApp({ ...base, isLoadingAuth: true }), null);
  assertEquals(t.screenNameForApp({ ...base, isAuthenticated: false }), "welcome");
  assertEquals(t.screenNameForApp({ ...base, inOnboarding: true }), "onboarding");
  assertEquals(t.screenNameForApp({ ...base, showPreferences: true }), "preferences");
  assertEquals(t.screenNameForApp(base), "page_home");
  const seen: string[] = [];
  let optedOut = false;
  const tracker = t.createScreenTracker({ getClient: () => ({ screen: (n) => { seen.push(n); } }), isOptedOut: () => optedOut });
  tracker.track("page_home");
  tracker.track("page_home");
  tracker.track("page_connections");
  optedOut = true;
  tracker.track("page_profile");
  assertEquals(seen, ["page_home", "page_connections"]);
  assertEquals(tracker.track("Bad Name With Spaces"), false);
});

Deno.test("#4226 wiring: onboarding marks every step view, PostHog tags the app, routes and pages are tracked", async () => {
  const root = new URL("../../../", import.meta.url);
  const read = (p: string) => Deno.readTextFile(new URL(p, root));
  const onboarding = await read("src/components/OnboardingFlow.tsx");
  assert(/recordJourneyMark\('explorer_onboarding', navState\.step, navState\.subStep\)/.test(onboarding));
  const effect = onboarding.slice(onboarding.indexOf("recordJourneyMark('explorer_onboarding'") - 200);
  assert(/\}, \[user\?\.id, navState\.step, navState\.subStep\]\)/.test(effect), "the mark effect must run on every step/substep change");
  assert(onboarding.includes("recordSignupSourceFromOnboarding"));
  const ph = await read("src/services/postHogService.ts");
  assert(/this\.initialized = true;\s*\/\/ #4226[^\n]*\n\s*registerAppSuperProperty\(client\)/.test(ph), "super property not registered right after init");
  assert(ph.includes("registerAppSuperProperty(this.client)"));
  assert((await read("app/_layout.tsx")).includes("<RouteScreenTracker />"));
  assert((await read("app/index.tsx")).includes("screenNameForApp("));
});

Deno.test("#4226 rework: held attribution clears only after a boolean answer; errors and empty answers keep it, at most 3 tries", async () => {
  // false = "already recorded earlier": handled, payload cleared
  const a = makeJourney({ attributionAnswers: [false] });
  const ja = await load(a.fakes);
  ja.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
  assertEquals(await ja.sendHeldInstallAttribution({ userId: "u-1", appsflyerId: "af", optedOut: false, platform: "ios", appId: "app-1" }), "sent");
  assertEquals(ja.getHeldInstallConversion(), null);

  // error: kept
  const b = makeJourney({ rpcError: true });
  const jb = await load(b.fakes);
  jb.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
  assertEquals(await jb.sendHeldInstallAttribution({ userId: "u-1", appsflyerId: "af", optedOut: false, platform: "ios", appId: "app-1" }), "failed");
  assert(jb.getHeldInstallConversion() !== null, "payload dropped after an error");

  // no error but no answer ("no rows"): kept, never "sent"; stops after 3 tries
  const c = makeJourney({ attributionAnswers: [undefined, null, undefined, undefined] });
  const jc = await load(c.fakes);
  jc.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
  const ctx = { userId: "u-1", appsflyerId: "af", optedOut: false, platform: "ios", appId: "app-1" };
  assertEquals(await jc.sendHeldInstallAttribution(ctx), "failed");
  assertEquals(await jc.sendHeldInstallAttribution(ctx), "failed");
  assertEquals(await jc.sendHeldInstallAttribution(ctx), "failed");
  assertEquals(await jc.sendHeldInstallAttribution(ctx), "skipped");
  assertEquals(c.calls.filter((x) => x.name === "record_install_attribution").length, 3);
  assert(jc.getHeldInstallConversion() !== null);
});
