// @ts-nocheck
// #3872 — creator push notifications deep-link to `mingla://creator/...`.
// Before the walkthrough build, parseDeepLink had no `creator` case and these
// taps landed on the "Unknown deep link path" warning (no navigation).
// Deno-runnable: deepLinkService.ts is pure.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { executeDeepLink, parseDeepLink } from "../deepLinkService.ts";

const ID = "6f1c2c1e-8f4a-4b4e-9a51-1d2f3e4a5b6c";

Deno.test("#3872 creator, gig, contract, setup, Local and Earnings links resolve to routes", () => {
  assertEquals(parseDeepLink("mingla://creator"), { kind: "route", path: "/creator" });
  assertEquals(parseDeepLink(`mingla://creator/gig/${ID}`), { kind: "route", path: `/creator/gig/${ID}` });
  assertEquals(parseDeepLink(`mingla://creator/contract/${ID}`), { kind: "route", path: `/creator/contract/${ID}` });
  assertEquals(parseDeepLink("mingla://creator/setup/payout"), { kind: "route", path: "/creator/setup/payout" });
  assertEquals(parseDeepLink("mingla://creator/status"), { kind: "route", path: "/creator/status" });
  assertEquals(parseDeepLink("mingla://local"), { kind: "route", path: "/local" });
  assertEquals(parseDeepLink("mingla://earnings"), { kind: "route", path: "/earnings" });
  assertEquals(parseDeepLink(`com.mingla.app.v2://creator/contract/${ID}`), { kind: "route", path: `/creator/contract/${ID}` });
});

Deno.test("#3872 malformed creator links are rejected, not routed", () => {
  assertEquals(parseDeepLink("mingla://creator/contract/not-a-uuid"), null);
  assertEquals(parseDeepLink("mingla://creator/setup/../../x"), null);
  assertEquals(parseDeepLink(`mingla://creator/gig/${ID}/extra`), null);
  assertEquals(parseDeepLink("mingla://local/anything"), null);
});

Deno.test("#3872 a route destination pushes the router path", () => {
  const pushed: string[] = [];
  executeDeepLink({ kind: "route", path: `/creator/contract/${ID}` }, { setCurrentPage: () => undefined, openRouterPath: (p) => pushed.push(p) });
  assertEquals(pushed, [`/creator/contract/${ID}`]);
});
