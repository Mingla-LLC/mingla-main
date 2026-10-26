import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleReferralTouch,
  isAnonymousBearer,
  type ReferralTouchDeps,
} from "../index.ts";

// #3872 walkthrough QA #5: mingla-marketing /r/[slug] sends the project anon
// key as its bearer. It must count as a guest, not an invalid user session.
const ANON_KEY = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  btoa(JSON.stringify({ iss: "supabase", role: "anon" })).replace(/=+$/, ""),
  "signature",
].join(".");

function deps(overrides: Partial<ReferralTouchDeps> = {}): ReferralTouchDeps {
  return {
    pepper: "r2-referral-test-pepper-is-at-least-32-bytes",
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    resolveUser: async () => null,
    loadLink: async () => ({
      kind: "member",
      sourceId: "38727000-0000-4000-8400-000000000040",
      brandId: "38727000-0000-4000-8400-000000000010",
      active: true,
      listingKind: null,
      listingId: null,
    }),
    claimRate: async () => "accepted",
    insertTouch: async () => "38727000-0000-4000-8400-000000000061",
    anonKeys: [ANON_KEY],
    ...overrides,
  };
}

function guestRequest(bearer: string): Request {
  return new Request("https://edge.test/referral-touch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      referer: "https://usemingla.com/r/r2b2m001",
      "user-agent": "Mozilla/5.0",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      kind: "member",
      slug: "r2b2m001",
      surface: "web",
      deviceToken: "device-token-guest-1234567890",
    }),
  });
}

Deno.test("#3872 the public page's anon key records a guest touch", async () => {
  let resolved = 0;
  let inserted: Record<string, unknown> | null = null;
  const response = await handleReferralTouch(
    guestRequest(ANON_KEY),
    deps({
      resolveUser: async () => {
        resolved += 1;
        return null;
      },
      insertTouch: async (row) => {
        inserted = row;
        return "38727000-0000-4000-8400-000000000061";
      },
    }),
  );
  assertEquals(response.status, 201);
  assertEquals(resolved, 0);
  assertEquals((inserted as Record<string, unknown> | null)?.user_id, null);
});

Deno.test("#3872 publishable keys and anon-role JWTs are guests; others are not", () => {
  assertEquals(isAnonymousBearer(ANON_KEY, []), true);
  assertEquals(isAnonymousBearer("sb_publishable_abc123", []), true);
  assertEquals(
    isAnonymousBearer("exact-configured-key", ["exact-configured-key"]),
    true,
  );
  const userJwt = [
    "eyJhbGciOiJIUzI1NiJ9",
    btoa(JSON.stringify({ sub: "u", role: "authenticated" })).replace(
      /=+$/,
      "",
    ),
    "sig",
  ].join(".");
  assertEquals(isAnonymousBearer(userJwt, [ANON_KEY]), false);
  assertEquals(isAnonymousBearer("forged-token", [ANON_KEY]), false);
});

Deno.test("#3872 a forged user token is still refused", async () => {
  const response = await handleReferralTouch(
    guestRequest("forged-token"),
    deps(),
  );
  assertEquals(response.status, 401);
});
