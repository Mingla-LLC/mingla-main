import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AppVersionPolicy,
  appVersionCorsHeaders,
  evaluateBusinessNativeVersion,
} from "./appVersionPolicy.ts";

const policy = (
  platform: "ios" | "android",
  mode: "observe" | "enforce",
): AppVersionPolicy => ({
  appId: "business",
  platform,
  minimumVersion: "1.1.5",
  storeUrl: platform === "ios"
    ? "https://apps.apple.com/app/id6768737367"
    : "https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness",
  message: "Update Mingla to keep using the app.",
  enforcementMode: mode,
  updatedAt: "2026-08-14T12:00:00.000Z",
});

Deno.test("#2075 tester: an untrusted Origin cannot turn a headerless client into exempt web", async () => {
  const reads: string[] = [];
  const response = await evaluateBusinessNativeVersion(
    new Request("https://edge.test", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
    "brand-stripe-account-session",
    async (_appId, platform) => {
      reads.push(platform);
      return policy(platform, "enforce");
    },
  );

  assertEquals(reads.sort(), ["android", "ios"]);
  assertEquals(response?.status, 426);
  assertStringIncludes(await response!.text(), '"error":"app_update_required"');
  assertEquals(
    response?.headers.get("Access-Control-Allow-Origin"),
    "null",
  );
});

Deno.test("#2075 tester: headerless observe remains non-blocking and policy outages fail open", async () => {
  const headerless = new Request("https://edge.test", { method: "POST" });
  const observed = await evaluateBusinessNativeVersion(
    headerless,
    "brand-paystack-onboard",
    async (_appId, platform) => policy(platform, "observe"),
  );
  assertEquals(observed, null);

  const unavailable = await evaluateBusinessNativeVersion(
    headerless,
    "brand-paystack-onboard",
    async () => null,
  );
  assertEquals(unavailable, null);
});

Deno.test("#2075 tester: native CORS carries all identity headers without trusting hostile web", () => {
  const headers = appVersionCorsHeaders(
    new Request("https://edge.test", {
      headers: { Origin: "https://not-mingla.vercel.app" },
    }),
  );
  assertEquals(headers["Access-Control-Allow-Origin"], "null");
  assertStringIncludes(
    headers["Access-Control-Allow-Headers"],
    "x-mingla-app-id",
  );
  assertStringIncludes(
    headers["Access-Control-Allow-Headers"],
    "x-mingla-app-platform",
  );
  assertStringIncludes(
    headers["Access-Control-Allow-Headers"],
    "x-mingla-app-version",
  );
});
