import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createReferralOfferHandler } from "../../referral-offer-upsert/index.ts";
import {
  buildReferralInviteEmail,
  createReferralInviteHandler,
  sha256,
} from "../../referral-member-invite/index.ts";
import { createReferralRemoveHandler } from "../../referral-member-remove/index.ts";
import { createReferralAcceptHandler } from "../../referral-invite-accept/index.ts";
import { createTrackingLinkHandler } from "../../referral-tracking-link-upsert/index.ts";

const post = (body: unknown) =>
  new Request("https://local.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const json = async (res: Response) =>
  await res.json() as Record<string, unknown>;

Deno.test("#3872 B4 offer writer binds the authenticated actor and exact payload", async () => {
  let call: Record<string, unknown> | null = null;
  const handler = createReferralOfferHandler({
    actorId: async () => "actor-1",
    rpc: async (name, args) => {
      call = { name, ...args };
      return { data: { id: "offer-1", version: 1 }, error: null };
    },
  });
  const payload = {
    brandId: "brand-1",
    name: "Every buyer earns",
    audience: "buyers",
    scopeKind: "brand",
    rewardKind: "cash",
    shareBps: 1000,
    currency: "USD",
    status: "active",
    listings: [],
    tiers: [],
  };
  const res = await handler(post({ action: "create", payload }));
  assertEquals(res.status, 200);
  assertEquals(call, {
    name: "issue_3872_referral_offer_write",
    p_actor: "actor-1",
    p_action: "create",
    p_payload: payload,
  });
});

Deno.test("#3872 B4 offer writer fails closed on auth, permission and unknown errors", async () => {
  const unauth = createReferralOfferHandler({
    actorId: async () => null,
    rpc: async () => ({ data: null, error: null }),
  });
  assertEquals(
    (await unauth(post({ action: "create", payload: {} }))).status,
    401,
  );

  const forbidden = createReferralOfferHandler({
    actorId: async () => "actor-1",
    rpc: async () => ({
      data: null,
      error: { message: "insufficient_permission" },
    }),
  });
  assertEquals(
    (await forbidden(post({ action: "pause", payload: {} }))).status,
    403,
  );

  const internal = createReferralOfferHandler({
    actorId: async () => "actor-1",
    rpc: async () => ({
      data: null,
      error: { message: "secret database detail" },
    }),
  });
  const res = await internal(post({ action: "pause", payload: {} }));
  assertEquals(res.status, 500);
  assertEquals((await json(res)).detail, "internal");
});

Deno.test("#3872 B4 invite tokens are random inputs and only hashes cross the SQL seam", async () => {
  let call: Record<string, unknown> | null = null;
  let next = 1;
  const deliveries: string[] = [];
  const handler = createReferralInviteHandler({
    actorId: async () => "actor-1",
    context: async () => ({
      brandName: "Harmattan",
      offerName: "Street team",
      rewardLine: "Earn 10%.",
    }),
    rpc: async (name, args) => {
      call = { name, ...args };
      return { data: [{ id: "member-1" }], error: null };
    },
    send: async ({ to, html }) => {
      deliveries.push(`${to}:${html}`);
      return { ok: true };
    },
    randomBytes: (size) => new Uint8Array(size).fill(next++),
    origin: "https://host.usemingla.com",
  });
  const res = await handler(post({
    offerId: "offer-1",
    members: [{ email: "Promoter@Example.com", displayName: "A <B>" }],
  }));
  assertEquals(res.status, 200);
  const recorded = call as Record<string, unknown> | null;
  assert(recorded !== null);
  const args = recorded["p_members"] as Array<Record<string, unknown>>;
  assertEquals(args[0].email, "promoter@example.com");
  assertMatch(String(args[0].tokenHash), /^[a-f0-9]{64}$/);
  assertEquals(String(args[0].linkSlug).length, 8);
  assert(
    !JSON.stringify(recorded).includes("AQEBAQEBAQ"),
    "raw invite token must never enter SQL args",
  );
  assertMatch(deliveries[0], /join\/referral\//);
  assertMatch(deliveries[0], /A &lt;B&gt;/);
  assert(!deliveries[0].includes("A <B>"));
});

Deno.test("#3872 B4 partial invite delivery is explicit and invitations remain retryable", async () => {
  let sends = 0;
  const handler = createReferralInviteHandler({
    actorId: async () => "actor-1",
    context: async () => ({
      brandName: "Brand",
      offerName: "Offer",
      rewardLine: "Reward",
    }),
    rpc: async () => ({ data: [{ id: "one" }, { id: "two" }], error: null }),
    send: async () => ({ ok: ++sends === 1 }),
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    origin: "https://host.usemingla.com",
  });
  const res = await handler(post({
    offerId: "offer-1",
    members: [
      { email: "one@example.com" },
      { email: "two@example.com" },
    ],
  }));
  assertEquals(res.status, 207);
  const body = await json(res);
  assertEquals(
    (body.delivery as Array<{ sent: boolean }>).map((row) => row.sent),
    [true, false],
  );
});

Deno.test("#3872 B4 invite acceptance hashes the token and maps email mismatch", async () => {
  let args: Record<string, unknown> | null = null;
  const token = "a".repeat(40);
  const ok = createReferralAcceptHandler({
    actor: async () => ({ id: "user-1", email: "person@example.com" }),
    rpc: async (_name, input) => {
      args = input;
      return { data: { member_id: "member-1" }, error: null };
    },
  });
  assertEquals((await ok(post({ token }))).status, 200);
  assertEquals(args, {
    p_actor: "user-1",
    p_email: "person@example.com",
    p_token_hash: await sha256(token),
  });

  const mismatch = createReferralAcceptHandler({
    actor: async () => ({ id: "user-1", email: "wrong@example.com" }),
    rpc: async () => ({
      data: null,
      error: { message: "invite_email_mismatch" },
    }),
  });
  assertEquals((await mismatch(post({ token }))).status, 403);
});

Deno.test("#3872 B4 removal and tracking links stay behind caller-bound RPCs", async () => {
  const calls: string[] = [];
  const deps = {
    actorId: async () => "actor-1",
    rpc: async (name: string) => {
      calls.push(name);
      return { data: { ok: true }, error: null };
    },
  };
  assertEquals(
    (await createReferralRemoveHandler(deps)(post({ memberId: "member-1" })))
      .status,
    200,
  );
  assertEquals(
    (await createTrackingLinkHandler(deps)(post({
      action: "create",
      payload: {
        brandId: "brand-1",
        label: "Instagram",
        slug: "ig-fall-2026",
      },
    }))).status,
    200,
  );
  assertEquals(calls, [
    "issue_3872_referral_member_remove",
    "issue_3872_tracking_link_write",
  ]);
});

Deno.test("#3872 B4 invite email renderer escapes every dynamic value", () => {
  const rendered = buildReferralInviteEmail({
    brandName: "<Brand>",
    offerName: '"Offer"',
    rewardLine: "A & B",
    acceptUrl: "https://host.usemingla.com/?x=<bad>",
    displayName: "<script>",
  });
  assert(!rendered.html.includes("<script>"));
  assertMatch(rendered.html, /&lt;Brand&gt;/);
  assertMatch(rendered.html, /A &amp; B/);
});
