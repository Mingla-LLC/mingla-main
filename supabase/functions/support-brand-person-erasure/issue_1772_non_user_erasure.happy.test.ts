import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createErasureHandler,
  type ErasureHandlerDependencies,
} from "./index.ts";
import {
  ErasureTemporarilyUnavailable,
  resolveErasureChallengeKey,
} from "./erasureContract.ts";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "20000000-0000-4000-8000-000000000002";
const PERSON_ID = "30000000-0000-4000-8000-000000000003";
const CONTACT_ID = "40000000-0000-4000-8000-000000000004";
const REQUEST_ID = "50000000-0000-4000-8000-000000000005";
const CHALLENGE_ID = "60000000-0000-4000-8000-000000000006";
const OPERATION_ID = "70000000-0000-4000-8000-000000000007";

type RpcCall = { name: string; args: Record<string, unknown> };

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    action: "create_challenge",
    caseReference: "SUPPORT-1772",
    brandId: BRAND_ID,
    personId: PERSON_ID,
    contactMethodId: CONTACT_ID,
    clientRequestId: REQUEST_ID,
    ...overrides,
  };
}

function request(body: Record<string, unknown>): Request {
  return new Request("https://example.test/support-brand-person-erasure", {
    method: "POST",
    headers: {
      authorization: "Bearer support-user-jwt",
      "content-type": "application/json",
      origin: "https://host.usemingla.com",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(
  rpc: ErasureHandlerDependencies["rpc"],
  overrides: Partial<ErasureHandlerDependencies> = {},
): ErasureHandlerDependencies {
  return {
    authenticate: async () => ({ userId: ACTOR_ID }),
    rpc,
    resolveKey: () => new Uint8Array(32).fill(7),
    randomUuid: () => CHALLENGE_ID,
    randomCode: () => "654321",
    hash: async (_key, challengeId, code) => `hash:${challengeId}:${code}`,
    sendEmail: async (input) => {
      await input.beforeProviderIo();
      return { status: "sent" };
    },
    sendSms: async (input) => {
      await input.beforeProviderIo();
      return { status: "sent" };
    },
    cleanup: async () => true,
    diagnostic: () => undefined,
    ...overrides,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("#1772 secret resolver accepts only the independent canonical bundle field", async () => {
  for (const size of [32, 64]) {
    const encoded = btoa(String.fromCharCode(...new Uint8Array(size).fill(9)));
    const key = resolveErasureChallengeKey((name) => {
      assertEquals(name, "AD_CONVERSION_TOKENS");
      return JSON.stringify({
        ACCESS_TOKEN: "existing-field-is-untouched",
        BRAND_PERSON_ERASURE_CHALLENGE_SECRET: encoded,
      });
    });
    assertEquals(key.byteLength, size);
  }

  const invalidBundles: Array<[string | undefined, string]> = [
    [undefined, "bundle_missing"],
    ["not-json", "bundle_invalid_json"],
    ["[]", "bundle_invalid_root"],
    ["{}", "field_missing"],
    [
      JSON.stringify({ BRAND_PERSON_ERASURE_CHALLENGE_SECRET: 42 }),
      "field_wrong_type",
    ],
    [
      JSON.stringify({ BRAND_PERSON_ERASURE_CHALLENGE_SECRET: "not/base64=" }),
      "field_invalid_base64",
    ],
    [
      JSON.stringify({ BRAND_PERSON_ERASURE_CHALLENGE_SECRET: btoa("short") }),
      "field_invalid_size",
    ],
  ];
  for (const [bundle, reason] of invalidBundles) {
    const error = await assertRejects(
      async () => resolveErasureChallengeKey(() => bundle),
      ErasureTemporarilyUnavailable,
    );
    assertEquals(error.safeReason, reason);
  }
});

Deno.test("#1772 email challenge claims once immediately before one provider attempt", async () => {
  const calls: RpcCall[] = [];
  let providerAttempts = 0;
  let emailIdempotencyKey: string | null = null;
  const deps = dependencies(async (name, args) => {
    calls.push({ name, args });
    if (name === "issue_1772_create_brand_person_erasure_challenge") {
      return {
        data: {
          challengeId: CHALLENGE_ID,
          deliveryState: "pending",
          shouldDispatch: true,
          destination: "person@example.test",
          channel: "email",
        },
      };
    }
    if (name === "issue_1772_claim_erasure_challenge_delivery") {
      return { data: { claimed: true, deliveryState: "dispatching" } };
    }
    if (name === "issue_1772_finish_erasure_challenge_delivery") {
      return { data: { deliveryState: "sent" } };
    }
    throw new Error(`unexpected RPC ${name}`);
  }, {
    sendEmail: async (input) => {
      emailIdempotencyKey = input.idempotencyKey;
      assertEquals(providerAttempts, 0);
      await input.beforeProviderIo();
      providerAttempts += 1;
      return { status: "sent" };
    },
  });

  const response = await createErasureHandler(deps)(request(createBody()));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body, {
    challengeId: CHALLENGE_ID,
    deliveryState: "sent",
    replayed: false,
  });
  assertEquals(providerAttempts, 1);
  assertEquals(
    emailIdempotencyKey,
    `brand-person-erasure:${CHALLENGE_ID}:v1`,
  );
  assertEquals(calls.map((call) => call.name), [
    "issue_1772_create_brand_person_erasure_challenge",
    "issue_1772_claim_erasure_challenge_delivery",
    "issue_1772_finish_erasure_challenge_delivery",
  ]);
  assertEquals(calls[0].args.p_code_hash, `hash:${CHALLENGE_ID}:654321`);
  assertEquals(calls[2].args, {
    p_challenge_id: CHALLENGE_ID,
    p_actor_id: ACTOR_ID,
    p_state: "sent",
    p_safe_code: null,
  });
  const serialized = JSON.stringify(body);
  assert(!serialized.includes("654321"));
  assert(!serialized.includes("person@example.test"));
});

Deno.test("#1772 SMS challenge uses the same DB claim with no idempotency input", async () => {
  const calls: RpcCall[] = [];
  let providerAttempts = 0;
  const deps = dependencies(async (name, args) => {
    calls.push({ name, args });
    if (name === "issue_1772_create_brand_person_erasure_challenge") {
      return {
        data: {
          challengeId: CHALLENGE_ID,
          deliveryState: "pending",
          shouldDispatch: true,
          destination: "+12025550177",
          channel: "phone",
        },
      };
    }
    if (name === "issue_1772_claim_erasure_challenge_delivery") {
      return { data: { claimed: true, deliveryState: "dispatching" } };
    }
    return { data: { deliveryState: "sent" } };
  }, {
    sendSms: async (input) => {
      assertEquals("idempotencyKey" in input, false);
      await input.beforeProviderIo();
      providerAttempts += 1;
      return { status: "sent" };
    },
  });

  const response = await createErasureHandler(deps)(request(createBody()));
  assertEquals(response.status, 200);
  assertEquals(providerAttempts, 1);
  assertEquals(calls.map((call) => call.name), [
    "issue_1772_create_brand_person_erasure_challenge",
    "issue_1772_claim_erasure_challenge_delivery",
    "issue_1772_finish_erasure_challenge_delivery",
  ]);
});

Deno.test("#1772 replay never resends an active challenge", async () => {
  for (
    const [deliveryState, expectedStatus, expectedError] of [
      ["sent", 200, undefined],
      ["pending", 503, "erasure_challenge_state_unknown"],
      ["dispatching", 503, "erasure_challenge_state_unknown"],
      ["failed", 503, "erasure_delivery_unavailable"],
    ] as const
  ) {
    let sends = 0;
    const deps = dependencies(async (name) => {
      assertEquals(name, "issue_1772_create_brand_person_erasure_challenge");
      return {
        data: {
          challengeId: CHALLENGE_ID,
          deliveryState,
          shouldDispatch: false,
        },
      };
    }, {
      sendEmail: async () => {
        sends += 1;
        return { status: "sent" };
      },
      sendSms: async () => {
        sends += 1;
        return { status: "sent" };
      },
    });
    const response = await createErasureHandler(deps)(request(createBody()));
    const body = await json(response);
    assertEquals(response.status, expectedStatus);
    assertEquals(body.error, expectedError);
    assertEquals(sends, 0);
  }
});

Deno.test("#1772 uncertain claim or provider outcome stays unknown without finish or resend", async () => {
  for (const scenario of ["claim_unknown", "provider_unknown"] as const) {
    const calls: RpcCall[] = [];
    let providerAttempts = 0;
    const deps = dependencies(async (name, args) => {
      calls.push({ name, args });
      if (name === "issue_1772_create_brand_person_erasure_challenge") {
        return {
          data: {
            challengeId: CHALLENGE_ID,
            deliveryState: "pending",
            shouldDispatch: true,
            destination: "person@example.test",
            channel: "email",
          },
        };
      }
      if (name === "issue_1772_claim_erasure_challenge_delivery") {
        if (scenario === "claim_unknown") {
          return { data: null, error: { message: "transport_lost" } };
        }
        return { data: { claimed: true, deliveryState: "dispatching" } };
      }
      throw new Error(`finish must not run after ${scenario}`);
    }, {
      sendEmail: async (input) => {
        await input.beforeProviderIo();
        providerAttempts += 1;
        return { status: "failed", error: "provider_unavailable" };
      },
    });
    const response = await createErasureHandler(deps)(request(createBody()));
    assertEquals(response.status, 503);
    assertEquals(
      (await json(response)).error,
      "erasure_challenge_state_unknown",
    );
    assertEquals(providerAttempts, scenario === "claim_unknown" ? 0 : 1);
    assertEquals(
      calls.some((call) =>
        call.name === "issue_1772_finish_erasure_challenge_delivery"
      ),
      false,
    );
  }
});

Deno.test("#1772 a definite pre-provider failure alone transitions pending to failed", async () => {
  const calls: RpcCall[] = [];
  const deps = dependencies(async (name, args) => {
    calls.push({ name, args });
    if (name === "issue_1772_create_brand_person_erasure_challenge") {
      return {
        data: {
          challengeId: CHALLENGE_ID,
          deliveryState: "pending",
          shouldDispatch: true,
          destination: "person@example.test",
          channel: "email",
        },
      };
    }
    if (name === "issue_1772_finish_erasure_challenge_delivery") {
      return { data: { deliveryState: "failed" } };
    }
    throw new Error(`unexpected RPC ${name}`);
  }, {
    sendEmail: async () => ({ status: "failed", error: "no_contact" }),
  });
  const response = await createErasureHandler(deps)(request(createBody()));
  assertEquals(response.status, 503);
  assertEquals((await json(response)).error, "erasure_delivery_unavailable");
  assertEquals(calls.map((call) => call.name), [
    "issue_1772_create_brand_person_erasure_challenge",
    "issue_1772_finish_erasure_challenge_delivery",
  ]);
  assertEquals(calls[1].args.p_state, "failed");
  assertEquals(calls[1].args.p_safe_code, "no_contact");
});

Deno.test("#1772 execute scrubs in DB before cleanup and exposes no storage paths", async () => {
  const calls: RpcCall[] = [];
  const cleaned: string[][] = [];
  const deps = dependencies(async (name, args) => {
    calls.push({ name, args });
    if (name === "issue_1772_execute_brand_person_erasure") {
      return {
        data: {
          operationId: OPERATION_ID,
          state: "db_erased",
          cleanupPaths: ["private/a.csv", "private/b.csv"],
        },
      };
    }
    if (name === "issue_1772_complete_brand_person_erasure_cleanup") {
      return { data: { state: "completed" } };
    }
    throw new Error(`unexpected RPC ${name}`);
  }, {
    cleanup: async (paths) => {
      cleaned.push(paths);
      return true;
    },
  });
  const response = await createErasureHandler(deps)(request({
    action: "execute",
    challengeId: CHALLENGE_ID,
    code: "654321",
    clientRequestId: REQUEST_ID,
  }));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body, { operationId: OPERATION_ID, state: "completed" });
  assertEquals(cleaned, [["private/a.csv", "private/b.csv"]]);
  assertEquals(calls.map((call) => call.name), [
    "issue_1772_execute_brand_person_erasure",
    "issue_1772_complete_brand_person_erasure_cleanup",
  ]);
  assertEquals(
    calls[0].args.p_verification_hash,
    `hash:${CHALLENGE_ID}:654321`,
  );
  assert(!JSON.stringify(body).includes("private/"));
});

Deno.test("#1772 missing secret fails before code, RPC, or provider work", async () => {
  const sequence: string[] = [];
  const deps = dependencies(async () => {
    sequence.push("rpc");
    return { data: null };
  }, {
    resolveKey: () => {
      sequence.push("key");
      throw new ErasureTemporarilyUnavailable("field_missing");
    },
    randomUuid: () => {
      sequence.push("uuid");
      return CHALLENGE_ID;
    },
    randomCode: () => {
      sequence.push("code");
      return "654321";
    },
    sendEmail: async () => {
      sequence.push("provider");
      return { status: "sent" };
    },
  });
  const response = await createErasureHandler(deps)(request(createBody()));
  assertEquals(response.status, 503);
  assertEquals((await json(response)).error, "erasure_temporarily_unavailable");
  assertEquals(sequence, ["key"]);
});
