// Issue #4383 — INDEPENDENT TESTER adversarial proof for Admin pushes in the
// shared notification code. Angles the implementor suite does not take:
//   N1  near-miss deep links (case, slash, query, fragment, whitespace, other
//       scheme, the other app's link) are refused by the real dispatcher
//       before anything is written, for both categories
//   N2  prototype-shaped and unknown categories never match the table
//   N3  hostile payload shapes (numbers, objects, arrays, markdown-only,
//       control characters) render without throwing and stay within the
//       composer's limits; the provider bag never carries the typed copy
//   N4  the destination table is frozen: a caller cannot add mingla://connections
//
// FAILS-ON-REVERT: delete the ADMIN_PUSH_CATEGORIES branch in validDeepLink
// (notifyV2.ts) -> N1 fails (the near-miss links reach the writer); delete
// the ADMIN_PUSH_CATEGORIES branch in providerSafePayload -> N3 fails.
//
// Run: deno test --allow-read supabase/functions/_shared/__tests__/issue_4383_admin_push.tester.adversarial.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { dispatchV2, providerSafePayload } from "../notifyV2.ts";
import {
  ADMIN_PUSH_CATEGORY,
  ADMIN_PUSH_DESTINATIONS,
  adminPushDeepLinkValid,
} from "../adminPushDestinations.ts";

const NEAR_MISSES: Record<string, string[]> = {
  "explorer.mingla_update": [
    "mingla://Home", "MINGLA://home", "mingla://home/", "mingla://home?x=1", "mingla://home#top",
    " mingla://home", "mingla://home ", "mingla:///home", "mingla://discover/", "mingla://likes?tab=saved",
    "mingla://connections", "mingla://chats", "mingla://saved", "mingla://profile", "mingla://explore",
    "https://usemingla.com/home", "javascript:alert(1)", "mingla-business://community", "mingla-business://(tabs)/home",
  ],
  "business.mingla_update": [
    "mingla-business://Community", "mingla-business://community/", "mingla-business://community?tab=x",
    "mingla-business://community/announcement/1", "mingla-business://home", "mingla-business://(tabs)/home/",
    "mingla-business://(tabs)/Home", " mingla-business://community", "mingla-business://(tabs)/account",
    "mingla://home", "mingla://discover", "mingla://likes", "https://host.usemingla.com",
  ],
};

function recordingClient(category: string) {
  const writes: string[] = [];
  const client = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  key: category, active: true, is_transactional: true, urgency: "normal",
                  default_channels: ["inapp", "push"], reach_mode: "reach_once",
                  section: category.startsWith("business.") ? "community" : "Mingla updates",
                },
                error: null,
              }),
          }),
        }),
        insert: () => { writes.push(table); return Promise.resolve({ data: null, error: null }); },
        upsert: () => { writes.push(table); return Promise.resolve({ data: null, error: null }); },
        update: () => { writes.push(table); return Promise.resolve({ data: null, error: null }); },
      };
    },
    rpc: (name: string) => { writes.push(`rpc:${name}`); return Promise.resolve({ data: null, error: null }); },
  };
  return { client, writes };
}

Deno.test("N1 near-miss links are refused by the real dispatcher before any write", async () => {
  for (const [category, links] of Object.entries(NEAR_MISSES)) {
    for (const link of links) {
      assertEquals(adminPushDeepLinkValid(category, link), false, `${category} ${JSON.stringify(link)}`);
      const { client, writes } = recordingClient(category);
      const result = await dispatchV2(client as never, {
        category_key: category,
        user_id: "00000000-0000-4000-8000-000000000001",
        payload: { title: "t", body: "b", campaign_id: "c", push_id: "p", deep_link: link },
        deep_link: link,
        idempotency_key: `k:${link}`,
      } as never);
      assertEquals(result, { success: false, reason: "deep_link_invalid" }, `${category} ${JSON.stringify(link)}`);
      assertEquals(writes, [], `${category} ${JSON.stringify(link)} wrote nothing`);
    }
  }
});

Deno.test("N1 a missing link is refused too (a push always names its screen)", async () => {
  for (const category of Object.values(ADMIN_PUSH_CATEGORY)) {
    for (const link of [undefined, null, ""]) {
      const { client, writes } = recordingClient(category);
      const result = await dispatchV2(client as never, {
        category_key: category,
        user_id: "00000000-0000-4000-8000-000000000001",
        payload: { title: "t", body: "b" },
        deep_link: link,
        idempotency_key: "k",
      } as never);
      assertEquals(result, { success: false, reason: "deep_link_invalid" }, `${category} ${String(link)}`);
      assertEquals(writes, []);
    }
  }
});

Deno.test("N2 prototype-shaped and unknown categories never match the table", () => {
  for (const category of ["__proto__", "constructor", "toString", "explorer", "host", "explorer.mingla_updates", "business.mingla_update ", "Explorer.mingla_update"]) {
    for (const row of ADMIN_PUSH_DESTINATIONS) {
      assertEquals(adminPushDeepLinkValid(category, row.deepLink), false, `${category} ${row.deepLink}`);
    }
  }
});

Deno.test("N3 hostile payloads render within limits and never throw", () => {
  const hostile: Record<string, unknown>[] = [
    {},
    { title: 42, body: 7 },
    { title: { a: 1 }, body: ["x", "y"] },
    { title: "**", body: "__" },
    { title: "a\u0000b\u0007c", body: "line1\nline2\r\n\tline3" },
    { title: "x".repeat(5000), body: "y".repeat(5000) },
    { title: "<script>alert(1)</script>", body: "[click](javascript:alert(1))" },
  ];
  for (const category of Object.values(ADMIN_PUSH_CATEGORY)) {
    for (const payload of hostile) {
      const r = renderCategoryMessage(category, payload);
      assert(typeof r.push.title === "string" && r.push.title.length > 0, `${category} title for ${JSON.stringify(payload).slice(0, 40)}`);
      assert(r.push.title.length <= 65, `${category} title <= 65 (${r.push.title.length})`);
      assert(typeof r.push.body === "string" && r.push.body.length <= 178, `${category} body <= 178`);
      assert(!r.push.body.includes("javascript:"), `${category} no link target leaks into the body`);
      assertEquals(r.email, { subject: "", body: "" });
      assertEquals(r.sms, "");
    }
  }
});

Deno.test("N3 the provider bag never carries typed copy, whatever else rides in the payload", () => {
  for (const category of Object.values(ADMIN_PUSH_CATEGORY)) {
    const bag = providerSafePayload(category, {
      campaign_id: "c", push_id: "p", title: "secret", body: "secret", deep_link: "mingla://home",
      user_id: "u", email: "a@b.c", test: true, announcement_id: "x",
    });
    assertEquals(Object.keys(bag).sort(), ["campaign_id", "push_id"], category);
    // A test push has no campaign: the bag simply omits it (never undefined values).
    const testBag = providerSafePayload(category, { push_id: "p", test: true, title: "t", body: "b" });
    assert(!Object.values(testBag).includes(undefined), `${category} test bag has no undefined`);
    assertEquals(testBag.push_id, "p");
  }
});

Deno.test("N4 the destination table is frozen", () => {
  assertThrows(() => (ADMIN_PUSH_DESTINATIONS as unknown as unknown[]).push({ app: "explorer", value: "connections", label: "Chats", deepLink: "mingla://connections", isDefault: false }));
  assertThrows(() => { (ADMIN_PUSH_DESTINATIONS[0] as unknown as { deepLink: string }).deepLink = "mingla://connections"; });
  assertEquals(ADMIN_PUSH_DESTINATIONS.length, 5);
  assertEquals(adminPushDeepLinkValid("explorer.mingla_update", "mingla://connections"), false);
});
