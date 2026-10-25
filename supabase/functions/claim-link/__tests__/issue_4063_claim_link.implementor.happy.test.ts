import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ClaimLinkDeps,
  createClaimLinkHandler,
  generateContactCode,
  parseClaimLinkBody,
} from "../index.ts";

const PEPPER = {
  bytes: new Uint8Array(32).fill(7),
  format: "hex" as const,
  fingerprint: "test",
};

function request(body: Record<string, unknown>, auth = false): Request {
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

function deps(
  rpc: ClaimLinkDeps["rpc"],
  overrides: Partial<ClaimLinkDeps> = {},
): ClaimLinkDeps {
  return {
    rpc,
    pepper: () => Promise.resolve(PEPPER),
    userId: () => Promise.resolve(null),
    sendEmail: () => Promise.resolve(true),
    createEmailUser: () => Promise.resolve(true),
    magicLinkToken: () => Promise.resolve("one-time-token-hash"),
    ...overrides,
  };
}

Deno.test("#4063 claim-link parser accepts only exact operation bodies", () => {
  assertEquals(parseClaimLinkBody({ op: "resolve", code: "AB12CD34EF" }), {
    op: "resolve",
    code: "AB12CD34EF",
  });
  assertEquals(
    parseClaimLinkBody({ op: "resolve", code: "AB12CD34EF", id: "leak" }),
    null,
  );
  assertEquals(
    parseClaimLinkBody({
      op: "email_code_verify",
      challengeId: "00000000-0000-4000-8000-000000000001",
      otp: "123456",
    })?.op,
    "email_code_verify",
  );
});

Deno.test("#4063 resolver adds app targets without widening masked RPC output", async () => {
  const calls: string[] = [];
  const handler = createClaimLinkHandler(deps((name) => {
    calls.push(name);
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    return Promise.resolve({
      data: {
        status: "active",
        code: "AB12CD34EF",
        noun: "ticket",
        title: "A private event",
        emailMasked: "b•••@e•••.test",
        phoneLast4: "0142",
      },
      error: null,
    });
  }));
  const response = await handler(
    request({ op: "resolve", code: "ab12cd34ef" }),
  );
  const result = await body(response);
  assertEquals(response.status, 200);
  assertEquals(result.status, "active");
  assertEquals(
    (result.appLink as Record<string, unknown>).appScheme,
    "com.mingla.app.v2://c/AB12CD34EF",
  );
  assertEquals(calls, ["pg_venue_order_rate_limit_hit", "resolve_claim_link"]);
});

Deno.test("#4063 malformed resolve is indistinguishable from an unknown code", async () => {
  const handler = createClaimLinkHandler(deps(() => {
    throw new Error("rpc must not run");
  }));
  const response = await handler(request({ op: "resolve", code: "short" }));
  assertEquals(await body(response), { ok: true, status: "not_found" });
});

Deno.test("#4063 handoff is bounded and exposes only the derived public URL", async () => {
  const handler = createClaimLinkHandler(deps((name, args) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    assertEquals(name, "mint_claim_link_handoff");
    assert(typeof args.p_ip_hash === "string");
    return Promise.resolve({
      data: {
        outcome: "ok",
        code: "ZX12CV34BN",
        expiresAt: "2026-10-24T12:10:00Z",
      },
      error: null,
    });
  }));
  const response = await handler(
    request({ op: "handoff", code: "AB12CD34EF" }),
  );
  assertEquals(await body(response), {
    ok: true,
    handoffUrl: "https://usemingla.com/c/ZX12CV34BN",
    expiresAt: "2026-10-24T12:10:00Z",
  });
});

Deno.test("#4063 prefill requires a validated user and a server proof", async () => {
  const handler = createClaimLinkHandler(deps((name) => {
    assertEquals(name, "issue_4063_claim_prefill");
    return Promise.resolve({
      data: {
        outcome: "ok",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneE164: "+12025550142",
      },
      error: null,
    });
  }, { userId: () => Promise.resolve("user-id") }));
  const result = await body(
    await handler(request({
      op: "prefill",
      code: "AB12CD34EF",
    }, true)),
  );
  assertEquals(result, {
    ok: true,
    firstName: "Ada",
    lastName: "Lovelace",
    phoneE164: "+12025550142",
  });
});

Deno.test("#4063 email proof returns one hashed magic-link token after settlement", async () => {
  let sentCode = "";
  let challengeId = "";
  let challengeHash = "";
  let created = false;
  const handler = createClaimLinkHandler(deps(async (name, args) => {
    if (name === "pg_venue_order_rate_limit_hit") {
      return { data: { allowed: true }, error: null };
    }
    if (name === "issue_4063_begin_contact_challenge") {
      challengeId = String(args.p_challenge_id);
      challengeHash = String(args.p_code_hash);
      return {
        data: {
          outcome: "started",
          challengeId,
          target: "buyer@example.test",
        },
        error: null,
      };
    }
    if (name === "issue_4063_settle_contact_challenge") {
      assertEquals(args.p_challenge_id, challengeId);
      assertEquals(args.p_code_hash, challengeHash);
      return {
        data: { outcome: "ok", value: "buyer@example.test" },
        error: null,
      };
    }
    assertEquals(name, "issue_4063_auth_user_for_email");
    return { data: null, error: null };
  }, {
    sendEmail: (_target, code) => {
      sentCode = code;
      return Promise.resolve(true);
    },
    createEmailUser: () => {
      created = true;
      return Promise.resolve(true);
    },
  }));

  const sent = await body(
    await handler(request({
      op: "email_code_send",
      code: "AB12CD34EF",
    })),
  );
  assertEquals(sent.ok, true);
  assertMatch(sentCode, /^\d{6}$/);
  assertMatch(String(sent.challengeId), /^[0-9a-f-]{36}$/);
  assertEquals(sent.sentTo, "b•••@e•••.test");

  const verified = await body(
    await handler(request({
      op: "email_code_verify",
      challengeId,
      otp: sentCode,
    })),
  );
  assertEquals(verified, {
    ok: true,
    tokenHash: "one-time-token-hash",
    verificationType: "magiclink",
  });
  assert(created);
});

Deno.test("#4063 contact code generation remains fixed-width numeric", () => {
  for (let index = 0; index < 100; index += 1) {
    assertMatch(generateContactCode(), /^\d{6}$/);
  }
});
