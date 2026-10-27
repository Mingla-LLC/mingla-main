import {
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleReferralTouch,
  referralHmacHex,
  type ReferralTouchDeps,
} from "../index.ts";

const PEPPER = "r2-referral-test-pepper-is-at-least-32-bytes";
const LINK = {
  kind: "member" as const,
  sourceId: "38727000-0000-4000-8400-000000000040",
  brandId: "38727000-0000-4000-8400-000000000010",
  active: true,
  listingKind: "event" as const,
  listingId: "38727000-0000-4000-8400-000000000020",
};

function deps(overrides: Partial<ReferralTouchDeps> = {}): ReferralTouchDeps {
  return {
    pepper: PEPPER,
    now: () => new Date("2026-10-24T12:00:00.000Z"),
    resolveUser: async () => "38727000-0000-4000-8400-000000000003",
    loadLink: async () => LINK,
    claimRate: async () => "accepted",
    insertTouch: async () => "38727000-0000-4000-8400-000000000060",
    ...overrides,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Request {
  return new Request("https://edge.test/referral-touch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
      referer: "https://host.usemingla.com/r/r2b2m001",
      "user-agent": "Mozilla/5.0",
      ...headers,
    },
    body: JSON.stringify({
      kind: "member",
      slug: "r2b2m001",
      surface: "web",
      deviceToken: "device-token-r2-b2-1234567890",
      ...body,
    }),
  });
}

Deno.test("#3872 referral touch stores HMAC identity only and expires in 30 days", async () => {
  let inserted: Record<string, unknown> | null = null;
  const response = await handleReferralTouch(
    request(),
    deps({
      insertTouch: async (row) => {
        inserted = row;
        return "38727000-0000-4000-8400-000000000060";
      },
    }),
  );
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body.recorded, true);
  assertMatch(body.visitorKey, /^[a-f0-9]{64}$/);
  assertNotEquals(body.visitorKey, "device-token-r2-b2-1234567890");
  const captured = inserted as Record<string, unknown> | null;
  assertExists(captured);
  assertEquals(captured.visitor_key, body.visitorKey);
  assertEquals(captured.touched_at, "2026-10-24T12:00:00.000Z");
  assertEquals(captured.expires_at, "2026-11-23T12:00:00.000Z");
  assertEquals(JSON.stringify(captured).includes("203.0.113.7"), false);
  assertEquals(
    JSON.stringify(captured).includes("device-token-r2-b2-1234567890"),
    false,
  );
});

Deno.test("#3872 referral touch uses distinct domain-separated device and IP HMACs", async () => {
  const device = await referralHmacHex(PEPPER, "device:same-value-123456");
  const ip = await referralHmacHex(PEPPER, "ip:same-value-123456");
  assertMatch(device, /^[a-f0-9]{64}$/);
  assertNotEquals(device, ip);
});

Deno.test("#3872 bots and foreign referrers cannot create touches", async () => {
  let calls = 0;
  const guarded = deps({
    claimRate: async () => {
      calls += 1;
      return "accepted";
    },
    insertTouch: async () => {
      calls += 1;
      return "never";
    },
  });
  const bot = await handleReferralTouch(
    request({}, {
      "user-agent": "facebookexternalhit/1.1",
    }),
    guarded,
  );
  assertEquals(bot.status, 200);
  assertEquals((await bot.json()).reason, "bot");

  const foreign = await handleReferralTouch(
    request({}, {
      referer: "https://evil.example/referral",
    }),
    guarded,
  );
  assertEquals(foreign.status, 403);
  assertEquals(calls, 0);
});

Deno.test("#3872 removed or ended links redirect safely without a touch", async () => {
  let inserted = false;
  const response = await handleReferralTouch(
    request(),
    deps({
      loadLink: async () => ({ ...LINK, active: false }),
      insertTouch: async () => {
        inserted = true;
        return "never";
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).reason, "inactive");
  assertEquals(inserted, false);
});

Deno.test("#3872 durable rate refusal happens before link or insert work", async () => {
  let downstream = 0;
  const response = await handleReferralTouch(
    request(),
    deps({
      claimRate: async () => "limited",
      loadLink: async () => {
        downstream += 1;
        return LINK;
      },
      insertTouch: async () => {
        downstream += 1;
        return "never";
      },
    }),
  );
  assertEquals(response.status, 429);
  assertEquals(downstream, 0);
});

Deno.test("#3872 supplied invalid JWT cannot silently downgrade to guest", async () => {
  const response = await handleReferralTouch(
    request({}, {
      authorization: "Bearer forged-token",
    }),
    deps({ resolveUser: async () => null }),
  );
  assertEquals(response.status, 401);
});
