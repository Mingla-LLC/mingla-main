// #4490 Explorer W1 — the pass QR is withheld from web (token) reads while
// VENUE_PASS_APP_ONLY is on, and reads carry the app claim link while
// VENUE_APP_HANDOFF is on.
//
// MINGLA-INVARIANT: I-VENUE-PASS-SERVER-WITHHELD-ON-WEB | issue #4490 | with VENUE_PASS_APP_ONLY on, venue-offers get / confirm_return / membership_get and venue-membership-pay-link get pass the QR pepper only to a signed-in owner reading without a token; a token read gets qrPayload null, whatever else it sends.
//
// FAILS-ON-REVERT: replace passPepperFor(...) with qrPepper(env) at the get
// site and W1-1 / W1-4 fail (a token read gets a QR with the flag on).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";
import { createPayLinkHandler } from "../venue-membership-pay-link/index.ts";
import { passPepperFor } from "../_shared/venueAppHandoff.ts";

const GROUP = "00000000-4490-4000-8000-0000000000c1";
const SUB = "00000000-4490-4000-8000-0000000000d2";
const OWNER = "00000000-4490-4000-8000-0000000000e6";
const TOKEN = "T".repeat(43);
const PEPPER = "p".repeat(40);
type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  flags: { appOnly: boolean; handoff: boolean },
): () => ServiceClient {
  return () =>
    ({
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        if (name === "issue_4490_flag_on") {
          return Promise.resolve({
            data: params.p_flag === "VENUE_PASS_APP_ONLY"
              ? flags.appOnly
              : flags.handoff,
            error: null,
          });
        }
        if (name === "mint_claim_link") {
          return Promise.resolve({
            data: { code: "K7Q2MX0001", claimed: false },
            error: null,
          });
        }
        const qr = params.p_qr_pepper ? "mingla:v1:vpass:x:sig:y" : null;
        return Promise.resolve({
          data: name === "issue_4490_membership_get"
            ? {
              subscriptionId: SUB,
              passInApp: flags.appOnly,
              ...(qr ? { pass: { qrPayload: qr } } : {}),
            }
            : {
              groupId: GROUP,
              passInApp: flags.appOnly,
              passes: [{ qrPayload: qr }],
            },
          error: null,
        });
      },
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: {
                user_id: OWNER,
                booked_by_user_id: null,
                offer_kind: "entry",
              },
              error: null,
            }),
        };
        return chain;
      },
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: { id: OWNER } }, error: null }),
      },
    }) as unknown as ServiceClient;
}

const jwt = `x.${
  btoa(JSON.stringify({ role: "authenticated", sub: OWNER })).replace(/=+$/, "")
}.y`;
const env = (name: string) =>
  name === "app.qr_token_pepper" ? PEPPER : undefined;

function post(
  fn: string,
  body: Record<string, unknown>,
  withJwt: boolean,
): Request {
  return new Request(`http://local/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withJwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readGet(
  flags: { appOnly: boolean; handoff: boolean },
  body: Record<string, unknown>,
  withJwt: boolean,
): Promise<{ data: Record<string, unknown>; calls: Call[] }> {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: client(calls, flags),
    env,
  });
  const res = await handle(post("venue-offers", body, withJwt));
  assertEquals(res.status, 200);
  return { data: (await res.json()).data, calls };
}

const qrOf = (d: Record<string, unknown>) =>
  (d.passes as Array<Record<string, unknown>>)[0].qrPayload;

Deno.test("W1-1 flag on: a token read (buyer web) gets no QR", async () => {
  const { data, calls } = await readGet({ appOnly: true, handoff: false }, {
    action: "get",
    groupId: GROUP,
    token: TOKEN,
  }, false);
  assertEquals(qrOf(data), null);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_get_offer_booking")?.params
      .p_qr_pepper,
    null,
  );
});

Deno.test("W1-2 flag on: the signed-in owner without a token gets the QR", async () => {
  const { data } = await readGet({ appOnly: true, handoff: false }, {
    action: "get",
    groupId: GROUP,
  }, true);
  assert(typeof qrOf(data) === "string");
});

Deno.test("W1-3 flag off: both a token read and the owner get the QR (today)", async () => {
  assert(
    typeof qrOf(
      (await readGet({ appOnly: false, handoff: false }, {
        action: "get",
        groupId: GROUP,
        token: TOKEN,
      }, false)).data,
    ) === "string",
  );
  assert(
    typeof qrOf(
      (await readGet({ appOnly: false, handoff: false }, {
        action: "get",
        groupId: GROUP,
      }, true)).data,
    ) === "string",
  );
});

Deno.test("W1-4 flag on: a token read that also sends a JWT and channel app still gets no QR", async () => {
  const { data } = await readGet({ appOnly: true, handoff: false }, {
    action: "get",
    groupId: GROUP,
    token: TOKEN,
    channel: "app",
  }, true);
  assertEquals(qrOf(data), null);
});

Deno.test("W1-5 claim: null while VENUE_APP_HANDOFF is off, the short link while on", async () => {
  const off = await readGet({ appOnly: false, handoff: false }, {
    action: "get",
    groupId: GROUP,
    token: TOKEN,
  }, false);
  assertEquals(off.data.claim, { shortUrl: null, code: null });
  assertEquals(off.calls.some((c) => c.name === "mint_claim_link"), false);
  const on = await readGet({ appOnly: false, handoff: true }, {
    action: "get",
    groupId: GROUP,
    token: TOKEN,
  }, false);
  assertEquals(on.data.claim, {
    shortUrl: "https://usemingla.com/c/K7Q2MX0001",
    code: "K7Q2MX0001",
    texted: false, // N155: no claim text queued in this fake
    textsLeft: 3,
  });
  assertEquals(on.calls.find((c) => c.name === "mint_claim_link")?.params, {
    p_subject_kind: "venue_booking",
    p_subject_id: GROUP,
  });
});

Deno.test("W1-6 membership_get: member token read gets no pass with the flag on; claim kind venue_membership", async () => {
  const { data, calls } = await readGet({ appOnly: true, handoff: true }, {
    action: "membership_get",
    subscriptionId: SUB,
    token: "m".repeat(43),
  }, false);
  assertEquals(data.pass, undefined);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_membership_get")?.params
      .p_qr_pepper,
    null,
  );
  assertEquals(
    calls.find((c) => c.name === "mint_claim_link")?.params.p_subject_kind,
    "venue_membership",
  );
});

Deno.test("W1-7 venue-membership-pay-link get: the renewal page gets no pass with the flag on", async () => {
  const calls: Call[] = [];
  const handle = createPayLinkHandler(
    { client: client(calls, { appOnly: true, handoff: false }), env } as never,
  );
  const res = await handle(
    post("venue-membership-pay-link", {
      action: "get",
      subscriptionId: SUB,
      token: "m".repeat(43),
    }, false),
  );
  assertEquals(res.status, 200);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_membership_get")?.params
      .p_qr_pepper,
    null,
  );
});

Deno.test("W1-8 passPepperFor: the one rule", () => {
  assertEquals(passPepperFor(PEPPER, false, { userId: null }, "\\xab"), PEPPER);
  assertEquals(passPepperFor(PEPPER, true, { userId: null }, "\\xab"), null);
  assertEquals(passPepperFor(PEPPER, true, { userId: OWNER }, "\\xab"), null);
  assertEquals(passPepperFor(PEPPER, true, { userId: OWNER }, null), PEPPER);
  assertEquals(passPepperFor(null, false, { userId: OWNER }, null), null);
});

Deno.test("W1-9 text_claim_link: token hash passed, never a typed number; the owner without a token passes the user id", async () => {
  const withToken = await readGet({ appOnly: false, handoff: true }, {
    action: "text_claim_link",
    groupId: GROUP,
    token: TOKEN,
    phone: "+2348000000000",
  }, false);
  const call = withToken.calls.find((c) =>
    c.name === "issue_4490_text_claim_link"
  );
  assert(call !== undefined);
  assertEquals(Object.keys(call.params).sort(), [
    "p_group_id",
    "p_token_hash",
    "p_user_id",
  ]);
  assert(
    typeof call.params.p_token_hash === "string" &&
      call.params.p_user_id === null,
  );
  const owner = await readGet({ appOnly: false, handoff: true }, {
    action: "text_claim_link",
    groupId: GROUP,
  }, true);
  assertEquals(
    owner.calls.find((c) => c.name === "issue_4490_text_claim_link")?.params
      .p_user_id,
    OWNER,
  );
});

Deno.test("W1-10 N155: claim.texted is true only when a claim text row exists for this booking", async () => {
  const { claimTexted } = await import("./index.ts");
  let pattern = "";
  const fake = (rows: unknown[]) => ({
    from: () => ({
      select: () => ({
        like: (_c: string, p: string) => {
          pattern = p;
          return { limit: () => Promise.resolve({ data: rows, error: null }) };
        },
      }),
    }),
  }) as unknown as ServiceClient;
  assertEquals(await claimTexted(fake([]), GROUP), false);
  assertEquals(pattern, `venue-claim-text:${GROUP}:%`);
  assertEquals(await claimTexted(fake([{ id: 1 }]), GROUP), true);
});
