import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ClaimContactDeps,
  createClaimContactHandler,
  parseClaimContactBody,
  SUPPORTED_PHONE_COUNTRIES,
} from "../index.ts";

const USER_ID = "40630000-0000-4000-8000-000000009001";
const CHALLENGE_ID = "40630000-0000-4000-8000-000000009002";
const PEPPER = {
  bytes: new Uint8Array(32).fill(8),
  format: "hex" as const,
  fingerprint: "test",
};

function request(body: Record<string, unknown>): Request {
  return new Request("https://project.supabase.co/functions/v1/claim-contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer user-token",
    },
    body: JSON.stringify(body),
  });
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json();
}

function baseDeps(rpc: ClaimContactDeps["rpc"]): ClaimContactDeps {
  return {
    rpc,
    pepper: () => Promise.resolve(PEPPER),
    userId: () => Promise.resolve(USER_ID),
    sendEmail: () => Promise.resolve(true),
    startPhone: () => Promise.resolve({ ok: true }),
    checkPhone: () => Promise.resolve({ ok: true, approved: true }),
  };
}

function claimEnvelope(): Record<string, unknown> {
  return {
    ok: true,
    count: 1,
    eventIds: ["event-id"],
    claims: [{ orderId: "order-id", eventId: "event-id" }],
    claimed: [{ kind: "order", id: "order-id", noun: "ticket" }],
    more: false,
  };
}

Deno.test("#4063 claim-contact parser rejects extra and malformed fields", () => {
  assertEquals(
    parseClaimContactBody({
      op: "send",
      channel: "email",
      value: "buyer@example.test",
    })?.op,
    "send",
  );
  assertEquals(
    parseClaimContactBody({
      op: "send",
      channel: "email",
      value: "buyer@example.test",
      userId: "caller-controlled",
    }),
    null,
  );
  assertEquals(
    parseClaimContactBody({
      op: "verify",
      challengeId: "not-a-uuid",
      code: "123456",
    }),
    null,
  );
});

Deno.test("#4063 email send stores a challenge and returns the user's input", async () => {
  let emailed = "";
  const handler = createClaimContactHandler({
    ...baseDeps((name) => {
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      assertEquals(name, "issue_4063_begin_contact_challenge");
      return Promise.resolve({
        data: { outcome: "started" },
        error: null,
      });
    }),
    sendEmail: (target, code) => {
      emailed = `${target}:${code}`;
      return Promise.resolve(true);
    },
  });
  const response = await handler(request({
    op: "send",
    channel: "email",
    value: " Buyer@Example.Test ",
  }));
  const result = await responseBody(response);
  assertEquals(response.status, 200);
  assertEquals(result.sentTo, "buyer@example.test");
  assert(/^buyer@example\.test:\d{6}$/.test(emailed));
});

Deno.test("#4063 phone send uses the supported-country gate and masked response", async () => {
  let sent = "";
  const handler = createClaimContactHandler({
    ...baseDeps((name) => {
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      if (name === "mingla_e164_country") {
        return Promise.resolve({ data: "GB", error: null });
      }
      return Promise.resolve({ data: { outcome: "started" }, error: null });
    }),
    startPhone: (phone) => {
      sent = phone;
      return Promise.resolve({ ok: true });
    },
  });
  const response = await handler(request({
    op: "send",
    channel: "phone",
    value: "+447700900123",
  }));
  const result = await responseBody(response);
  assertEquals(result.sentTo, "+44 •••• 0123");
  assertEquals(sent, "+447700900123");
});

Deno.test("#4063 already-confirmed contacts sweep without sending", async () => {
  let providerCalls = 0;
  const handler = createClaimContactHandler({
    ...baseDeps((name) => {
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      if (name === "issue_4063_begin_contact_challenge") {
        return Promise.resolve({
          data: { outcome: "already_on_this_account" },
          error: null,
        });
      }
      if (name === "begin_attendance_claim_attempt") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      assertEquals(name, "claim_attendance_by_verified_identity");
      return Promise.resolve({ data: claimEnvelope(), error: null });
    }),
    sendEmail: () => {
      providerCalls += 1;
      return Promise.resolve(true);
    },
  });
  const result = await responseBody(
    await handler(request({
      op: "send",
      channel: "email",
      value: "already@example.test",
    })),
  );
  assertEquals(result.alreadyConfirmed, true);
  assertEquals(result.claimed, claimEnvelope());
  assertEquals(providerCalls, 0);
});

Deno.test("#4063 settled email contact records then runs the identity sweep", async () => {
  const calls: string[] = [];
  const handler = createClaimContactHandler(baseDeps((name) => {
    calls.push(name);
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    if (name === "issue_4063_contact_challenge_for_user") {
      return Promise.resolve({
        data: {
          outcome: "ok",
          channel: "email",
          value: "extra@example.test",
        },
        error: null,
      });
    }
    if (name === "issue_4063_settle_contact_challenge") {
      return Promise.resolve({
        data: {
          outcome: "ok",
          channel: "email",
          value: "extra@example.test",
          userId: USER_ID,
        },
        error: null,
      });
    }
    if (name === "issue_4063_record_claim_contact") {
      return Promise.resolve({ data: { result: "recorded" }, error: null });
    }
    if (name === "begin_attendance_claim_attempt") {
      return Promise.resolve({ data: { allowed: true }, error: null });
    }
    return Promise.resolve({ data: claimEnvelope(), error: null });
  }));
  const response = await handler(request({
    op: "verify",
    challengeId: CHALLENGE_ID,
    code: "123456",
  }));
  assertEquals(response.status, 200);
  assertEquals((await responseBody(response)).claimed, claimEnvelope());
  assert(calls.includes("issue_4063_record_claim_contact"));
  assert(calls.includes("claim_attendance_by_verified_identity"));
});

Deno.test("#4063 phone-country allow-list stays in parity with Business", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/utils/phoneStartCountryForCurrency.ts",
      import.meta.url,
    ),
  );
  const countries = [...source.matchAll(/^\s+[A-Z]{3}: "([A-Z]{2})",$/gm)]
    .map((match) => match[1])
    .sort();
  assertEquals(countries, [...SUPPORTED_PHONE_COUNTRIES]);
});
