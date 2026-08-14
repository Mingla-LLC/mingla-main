import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AppVersionPolicy,
  compareSemver,
  evaluateBusinessNativeVersion,
  isTrustedMinglaBrowserOrigin,
} from "./appVersionPolicy.ts";

const policy = (mode: "observe" | "enforce"): AppVersionPolicy => ({
  appId: "business",
  platform: "ios",
  minimumVersion: "1.1.5",
  storeUrl: "https://apps.apple.com/app/id6768737367",
  message: "Update Mingla to keep using the app.",
  enforcementMode: mode,
  updatedAt: "2026-08-14T12:00:00.000Z",
});

Deno.test("#2075 numeric semantic versions never compare lexicographically", () => {
  assertEquals(compareSemver("1.1.10", "1.1.9"), 1);
  assertEquals(compareSemver("1.1.3", "1.1.4"), -1);
  assertEquals(compareSemver("1.1", "1.1.4"), null);
});

Deno.test("#2075 selected Edge enforcement rejects stale Host only in enforce mode", async () => {
  const request = new Request("https://edge.test", {
    method: "POST",
    headers: {
      "X-Mingla-App-Id": "business",
      "X-Mingla-App-Platform": "ios",
      "X-Mingla-App-Version": "1.1.4",
    },
  });
  const observe = await evaluateBusinessNativeVersion(
    request,
    "brand-stripe-onboard",
    async () => policy("observe"),
  );
  assertEquals(observe, null);

  const enforce = await evaluateBusinessNativeVersion(
    request,
    "brand-stripe-onboard",
    async () => policy("enforce"),
  );
  assertEquals(enforce?.status, 426);
  assertStringIncludes(await enforce!.text(), '"error":"app_update_required"');
  assertStringIncludes(
    await new Response(JSON.stringify(policy("enforce"))).text(),
    "id6768737367",
  );
});

Deno.test("#2075 trusted Host web is explicitly exempt", async () => {
  let reads = 0;
  const response = await evaluateBusinessNativeVersion(
    new Request("https://edge.test", {
      headers: { Origin: "https://host.usemingla.com" },
    }),
    "brand-stripe-onboard",
    async () => {
      reads += 1;
      return policy("enforce");
    },
  );
  assertEquals(response, null);
  assertEquals(reads, 0);
});

Deno.test("#2075 numeric segments beyond MAX_SAFE_INTEGER compare exactly", () => {
  assertEquals(
    compareSemver("1.9007199254740993.0", "1.9007199254740992.0"),
    1,
  );
  assertEquals(
    compareSemver("1.9007199254740992.0", "1.9007199254740993.0"),
    -1,
  );
});

Deno.test("#2075 crafted Vercel lookalikes are never trusted", () => {
  assertEquals(
    isTrustedMinglaBrowserOrigin(
      "https://mingla-business-evil.vercel.app",
    ),
    false,
  );
  assertEquals(
    isTrustedMinglaBrowserOrigin("https://mingla-admin-evil.vercel.app"),
    false,
  );
});
