// MINGLA-INVARIANT: I-4238-SUB-REVENUE-SERVER-ONLY | issue #4238 | Explorer subscription revenue reaches AppsFlyer only from RevenueCat's server integration: the app logs af_subscribe without af_revenue, and hands RevenueCat the AppsFlyer id once per RevenueCat user.
// @ts-nocheck — Deno runtime test of the REAL useRevenueCat.ts (fakes for React, React Query and the SDKs).
/**
 * #4238 W6-3 (D27). af_subscribe carried the unvalidated client price as
 * af_revenue, and RevenueCat never had the AppsFlyer id.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flush, loadWithFakes } from "../../services/__tests__/appsFlyerHarness.issue4238.ts";

function world(afUid: string | null = "af-uid-1", state: { optOut: boolean } = { optOut: false }) {
  const events: Array<[string, Record<string, unknown>]> = [];
  const setIds: string[] = [];
  const listeners: Array<(info: unknown) => void> = [];
  const fakes = {
    react: { useEffect: (fn: () => unknown) => fn() },
    "@tanstack/react-query": {
      useQuery: (o: unknown) => o,
      useMutation: (o: unknown) => o,
      useQueryClient: () => ({ setQueryData() {}, removeQueries() {} }),
    },
    "react-native-purchases": {
      default: {
        setAppsflyerID: async (id: string | null) => {
          setIds.push(id);
        },
      },
    },
    "../services/revenueCatService": {
      getCustomerInfo: async () => ({}),
      getCurrentOffering: async () => null,
      purchasePackage: async () => ({}),
      restorePurchases: async () => ({}),
      addCustomerInfoListener: (l: (info: unknown) => void) => {
        listeners.push(l);
        return () => {};
      },
      loginRevenueCat: async () => ({}),
      logoutRevenueCatIfIdentified: async () => null,
    },
    "../services/appsFlyerService": {
      getAppsFlyerUid: async () => afUid,
      logAppsFlyerEvent: (n: string, v: Record<string, unknown>) => events.push([n, v]),
    },
    "../services/mixpanelService": { mixpanelService: { trackSubscriptionPurchased() {} } },
    // #4238 P2-3: the Explorer "share usage data" switch.
    "../services/analyticsOptOut": { explorerAnalyticsOptedOut: () => state.optOut },
  };
  return { fakes, events, setIds, listeners };
}

Deno.test("#4238 W6-3 af_subscribe carries no af_revenue", async () => {
  const w = world();
  const hooks = await loadWithFakes("src/hooks/useRevenueCat.ts", w.fakes);
  const mutation = hooks.usePurchasePackage();
  mutation.onSuccess(
    { customerInfo: {} },
    { identifier: "$rc_monthly", product: { price: 9.99, currencyCode: "GBP" } },
  );
  const subscribe = w.events.find((e) => e[0] === "af_subscribe");
  assert(subscribe, "af_subscribe still logged for funnel counts");
  assertEquals("af_revenue" in subscribe[1], false);
  assertEquals("af_currency" in subscribe[1], false);
  assertEquals(subscribe[1].af_content_id, "$rc_monthly");
});

Deno.test("#4238 W6-3 the AppsFlyer id is set on RevenueCat once per RevenueCat user", async () => {
  const w = world();
  const hooks = await loadWithFakes("src/hooks/useRevenueCat.ts", w.fakes);
  hooks.useCustomerInfoListener();
  assertEquals(w.listeners.length, 1);
  w.listeners[0]({ originalAppUserId: "$RCAnonymousID:abc" });
  await flush();
  w.listeners[0]({ originalAppUserId: "$RCAnonymousID:abc" });
  await flush();
  assertEquals(w.setIds, ["af-uid-1"], "once for the anonymous user");
  w.listeners[0]({ originalAppUserId: "user-1" });
  await flush();
  assertEquals(w.setIds, ["af-uid-1", "af-uid-1"], "once more after login (new RevenueCat user)");
});

Deno.test("#4238 W6-3 no AppsFlyer id yet: nothing set, retried on the next update", async () => {
  const w = world(null);
  const hooks = await loadWithFakes("src/hooks/useRevenueCat.ts", w.fakes);
  assertEquals(await hooks.linkAppsFlyerIdToRevenueCat("user-1"), false);
  assertEquals(w.setIds.length, 0);
});

Deno.test("#4238 W6-3 the onboarding trial is mingla_app_trial_started, not a store af_start_trial", async () => {
  const src = (await Deno.readTextFile(new URL("../../components/OnboardingFlow.tsx", import.meta.url)))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert(src.includes("logAppsFlyerEvent('mingla_app_trial_started'"));
  assert(!src.includes("'af_start_trial'"));
});

Deno.test("#4238 P2-3 with share usage data off RevenueCat never gets the AppsFlyer id; a prior link is cleared once; back on links again", async () => {
  const state = { optOut: true };
  const w = world("af-uid-1", state);
  const hooks = await loadWithFakes("src/hooks/useRevenueCat.ts", w.fakes);
  hooks.useCustomerInfoListener();
  w.listeners[0]({ originalAppUserId: "user-1" });
  await flush();
  assertEquals(w.setIds, [null], "opted out: the id is cleared, never set");
  w.listeners[0]({ originalAppUserId: "user-1" });
  await flush();
  assertEquals(w.setIds, [null], "cleared once, not on every update");
  state.optOut = false;
  w.listeners[0]({ originalAppUserId: "user-1" });
  await flush();
  assertEquals(w.setIds, [null, "af-uid-1"], "back on: linked again");
  state.optOut = true;
  w.listeners[0]({ originalAppUserId: "user-1" });
  await flush();
  assertEquals(w.setIds, [null, "af-uid-1", null], "switched off after a link: cleared");
});
