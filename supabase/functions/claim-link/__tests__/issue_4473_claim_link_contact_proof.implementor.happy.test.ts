import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ClaimLinkDeps,
  contactCodeHash,
  createClaimLinkHandler,
  parseClaimLinkBody,
} from "../index.ts";

// MINGLA-INVARIANT: I-4473-CLAIM-LINK-CONTACT-PROOF | issue #4473 | A signed-in account that opens a claim link proves the purchase's own contact by a code sent there; the client never supplies or receives the unmasked value, and success records a claim-only contact and runs the purchase sweeps.

const PEPPER = {
  bytes: new Uint8Array(32).fill(7),
  format: "hex" as const,
  fingerprint: "test",
};
const USER_ID = "44730000-0000-4000-8000-0000000000aa";
const CHALLENGE_ID = "44730000-0000-4000-8000-0000000000cc";
const BUYER_EMAIL = "buyer-4473@example.test";
const BUYER_PHONE = "+12025557301";

type Rpc = ClaimLinkDeps["rpc"];

function request(body: Record<string, unknown>, auth = true): Request {
  return new Request("https://project.supabase.co/functions/v1/claim-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer user-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json();
}

function deps(rpc: Rpc, overrides: Partial<ClaimLinkDeps> = {}): ClaimLinkDeps {
  return {
    rpc,
    pepper: () => Promise.resolve(PEPPER),
    userId: () => Promise.resolve(USER_ID),
    sendEmail: () => Promise.resolve(true),
    createEmailUser: () => Promise.resolve(true),
    magicLinkToken: () => Promise.resolve("token"),
    qrPepper: () => "qr-pepper",
    startPhone: () => Promise.resolve({ ok: true }),
    checkPhone: () => Promise.resolve({ ok: true, approved: true }),
    ...overrides,
  };
}

// The sweep RPCs, answering one owned order and one shared order.
function sweepRpc(name: string): ReturnType<Rpc> | null {
  if (name === "begin_attendance_claim_attempt") {
    return Promise.resolve({ data: { allowed: true }, error: null });
  }
  if (name === "claim_attendance_by_verified_identity") {
    return Promise.resolve({
      data: { claimed: [{ kind: "order", id: "owned" }], more: false },
      error: null,
    });
  }
  if (name === "issue_4063_claim_offered_tickets") {
    return Promise.resolve({ data: { claimed: [], more: false }, error: null });
  }
  if (name === "issue_4473_share_purchases_by_verified_identity") {
    return Promise.resolve({
      data: {
        claimed: [{ kind: "order", id: "shared", role: "shared" }],
        more: false,
      },
      error: null,
    });
  }
  return null;
}

Deno.test("#4473 parser accepts only the exact contact proof bodies", () => {
  assertEquals(
    parseClaimLinkBody({ op: "contact_code_send", code: "AB12CD34EF", channel: "phone" })?.op,
    "contact_code_send",
  );
  assertEquals(
    parseClaimLinkBody({ op: "contact_code_send", code: "AB12CD34EF", channel: "fax" }),
    null,
  );
  // The client may not name the contact.
  assertEquals(
    parseClaimLinkBody({
      op: "contact_code_send",
      code: "AB12CD34EF",
      channel: "email",
      value: "attacker@example.test",
    }),
    null,
  );
  assertEquals(
    parseClaimLinkBody({ op: "contact_code_verify", challengeId: CHALLENGE_ID, otp: "123456" })?.op,
    "contact_code_verify",
  );
});

Deno.test("#4473 contact proof requires a signed-in account", async () => {
  const handler = createClaimLinkHandler(deps(
    () => Promise.resolve({ data: null, error: null }),
    { userId: () => Promise.resolve(null) },
  ));
  for (
    const payload of [
      { op: "contact_code_send", code: "AB12CD34EF", channel: "email" },
      { op: "contact_code_verify", challengeId: CHALLENGE_ID, otp: "123456" },
    ]
  ) {
    const response = await handler(request(payload, false));
    assertEquals(response.status, 401);
    assertEquals((await body(response)).error, "unauthorized");
  }
});

Deno.test("#4473 email code goes to the purchase's own address and is shown masked", async () => {
  const sent: string[] = [];
  let begin: Record<string, unknown> = {};
  const handler = createClaimLinkHandler(deps((name, args) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4473_begin_claim_link_contact_challenge") {
      begin = args;
      return Promise.resolve({
        data: { outcome: "started", channel: "email", target: BUYER_EMAIL },
        error: null,
      });
    }
    throw new Error(`unexpected rpc ${name}`);
  }, {
    sendEmail: (target) => {
      sent.push(target);
      return Promise.resolve(true);
    },
  }));
  const response = await handler(
    request({ op: "contact_code_send", code: "ab12cd34ef", channel: "email" }),
  );
  const result = await body(response);
  assertEquals(response.status, 200);
  assertEquals(begin.p_user_id, USER_ID);
  assertEquals(begin.p_claim_code, "AB12CD34EF");
  assertEquals(begin.p_channel, "email");
  assert(typeof begin.p_code_hash === "string");
  assertEquals(sent, [BUYER_EMAIL]);
  assertEquals(result.ok, true);
  assertEquals(result.channel, "email");
  assert(typeof result.challengeId === "string");
  assert(!JSON.stringify(result).includes(BUYER_EMAIL));
  assertEquals(result.sentTo, "b•••@e•••.test");
});

Deno.test("#4473 phone code uses the SMS verify path and masks the number", async () => {
  const started: string[] = [];
  const handler = createClaimLinkHandler(deps((name) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4473_begin_claim_link_contact_challenge") {
      return Promise.resolve({
        data: { outcome: "started", channel: "phone", target: BUYER_PHONE },
        error: null,
      });
    }
    if (name === "mingla_e164_country") {
      return Promise.resolve({ data: "US", error: null });
    }
    throw new Error(`unexpected rpc ${name}`);
  }, {
    startPhone: (phone) => {
      started.push(phone);
      return Promise.resolve({ ok: true });
    },
  }));
  const result = await body(await handler(
    request({ op: "contact_code_send", code: "AB12CD34EF", channel: "phone" }),
  ));
  assertEquals(started, [BUYER_PHONE]);
  assertEquals(result.sentTo, "+120•••7301");
  assert(!JSON.stringify(result).includes(BUYER_PHONE));
});

Deno.test("#4473 send maps link and contact outcomes to stable errors", async () => {
  const cases: Array<[string, number, string]> = [
    ["invalid", 400, "invalid"],
    ["expired", 410, "expired"],
    ["rate_limited", 429, "rate_limited"],
    ["limit_reached", 409, "limit_reached"],
    ["no_phone", 200, "no_phone"],
  ];
  for (const [outcome, status, error] of cases) {
    const handler = createClaimLinkHandler(deps((name) => {
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      return Promise.resolve({ data: { outcome }, error: null });
    }));
    const response = await handler(
      request({ op: "contact_code_send", code: "AB12CD34EF", channel: "phone" }),
    );
    assertEquals(response.status, status, outcome);
    assertEquals((await body(response)).error, error, outcome);
  }
});

Deno.test("#4473 an already-proved contact skips the code and sweeps", async () => {
  let emails = 0;
  const handler = createClaimLinkHandler(deps((name) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4473_begin_claim_link_contact_challenge") {
      return Promise.resolve({
        data: { outcome: "already_on_this_account" },
        error: null,
      });
    }
    const swept = sweepRpc(name);
    if (swept) return swept;
    throw new Error(`unexpected rpc ${name}`);
  }, {
    sendEmail: () => {
      emails += 1;
      return Promise.resolve(true);
    },
  }));
  const result = await body(await handler(
    request({ op: "contact_code_send", code: "AB12CD34EF", channel: "email" }),
  ));
  assertEquals(emails, 0);
  assertEquals(result.alreadyConfirmed, true);
  const claimed = result.claimed as Record<string, unknown>;
  assertEquals(claimed.count, 2);
});

Deno.test("#4473 a verified email code records the contact, then sweeps with shared flags", async () => {
  const calls: string[] = [];
  let recorded: Record<string, unknown> = {};
  const digest = await contactCodeHash(PEPPER.bytes, CHALLENGE_ID, "123456");
  const handler = createClaimLinkHandler(deps((name, args) => {
    calls.push(name);
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4473_claim_link_challenge_for_user") {
      assertEquals(args.p_user_id, USER_ID);
      return Promise.resolve({
        data: { outcome: "ok", channel: "email", value: BUYER_EMAIL },
        error: null,
      });
    }
    if (name === "issue_4063_settle_contact_challenge") {
      assertEquals(args.p_code_hash, digest);
      return Promise.resolve({
        data: {
          outcome: "ok",
          purpose: "claim_add_contact",
          channel: "email",
          value: BUYER_EMAIL,
          userId: USER_ID,
        },
        error: null,
      });
    }
    if (name === "issue_4063_record_claim_contact") {
      recorded = args;
      return Promise.resolve({ data: { result: "recorded" }, error: null });
    }
    const swept = sweepRpc(name);
    if (swept) return swept;
    throw new Error(`unexpected rpc ${name}`);
  }));
  const response = await handler(request({
    op: "contact_code_verify",
    challengeId: CHALLENGE_ID,
    otp: "123456",
  }));
  const result = await body(response);
  assertEquals(response.status, 200);
  assertEquals(recorded, {
    p_user_id: USER_ID,
    p_channel: "email",
    p_value: BUYER_EMAIL,
  });
  const claimed = result.claimed as Record<string, unknown>;
  assertEquals(claimed.count, 2);
  assertEquals(claimed.claimed, [
    { kind: "order", id: "owned", sharedWithAnotherAccount: false },
    { kind: "order", id: "shared", role: "shared", sharedWithAnotherAccount: true },
  ]);
  assert(
    calls.indexOf("issue_4063_record_claim_contact") <
      calls.indexOf("claim_attendance_by_verified_identity"),
  );
  assert(!JSON.stringify(result).includes(BUYER_EMAIL));
});

Deno.test("#4473 a phone code is checked with the provider before settling", async () => {
  let checked = "";
  let approvedArg: unknown = null;
  const handler = createClaimLinkHandler(deps((name, args) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4473_claim_link_challenge_for_user") {
      return Promise.resolve({
        data: { outcome: "ok", channel: "phone", value: BUYER_PHONE },
        error: null,
      });
    }
    if (name === "issue_4063_settle_contact_challenge") {
      approvedArg = args.p_provider_approved;
      return Promise.resolve({
        data: { outcome: "bad_code", attemptsLeft: 4 },
        error: null,
      });
    }
    throw new Error(`unexpected rpc ${name}`);
  }, {
    checkPhone: (phone) => {
      checked = phone;
      return Promise.resolve({ ok: true, approved: false });
    },
  }));
  const response = await handler(request({
    op: "contact_code_verify",
    challengeId: CHALLENGE_ID,
    otp: "654321",
  }));
  assertEquals(checked, BUYER_PHONE);
  assertEquals(approvedArg, false);
  assertEquals(response.status, 400);
  assertEquals((await body(response)).error, "bad_code");
});

Deno.test("#4473 a challenge settled for a different purpose or account records nothing", async () => {
  for (
    const settled of [
      { outcome: "ok", purpose: "add_contact", channel: "email", value: BUYER_EMAIL, userId: USER_ID },
      { outcome: "ok", purpose: "claim_add_contact", channel: "email", value: BUYER_EMAIL, userId: "someone-else" },
    ]
  ) {
    const calls: string[] = [];
    const handler = createClaimLinkHandler(deps((name) => {
      calls.push(name);
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      if (name === "issue_4473_claim_link_challenge_for_user") {
        return Promise.resolve({
          data: { outcome: "ok", channel: "email", value: BUYER_EMAIL },
          error: null,
        });
      }
      if (name === "issue_4063_settle_contact_challenge") {
        return Promise.resolve({ data: settled, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    }));
    const response = await handler(request({
      op: "contact_code_verify",
      challengeId: CHALLENGE_ID,
      otp: "123456",
    }));
    assertEquals(response.status, 400);
    assert(!calls.includes("issue_4063_record_claim_contact"));
  }
});

Deno.test("#4473 an unknown or foreign challenge is refused before any code check", async () => {
  let providerCalls = 0;
  const handler = createClaimLinkHandler(deps((name) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4473_claim_link_challenge_for_user") {
      return Promise.resolve({ data: { outcome: "invalid" }, error: null });
    }
    throw new Error(`unexpected rpc ${name}`);
  }, {
    checkPhone: () => {
      providerCalls += 1;
      return Promise.resolve({ ok: true, approved: true });
    },
  }));
  const response = await handler(request({
    op: "contact_code_verify",
    challengeId: CHALLENGE_ID,
    otp: "123456",
  }));
  assertEquals(response.status, 400);
  assertEquals((await body(response)).error, "invalid");
  assertEquals(providerCalls, 0);
});
