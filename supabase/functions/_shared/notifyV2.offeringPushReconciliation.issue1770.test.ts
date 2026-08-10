import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchV2, type MinimalClient } from "./notifyV2.ts";

const source = await Deno.readTextFile(
  new URL("./notifyV2.ts", import.meta.url),
);

Deno.test("#1770 offering push owns late claim, result projection, and concurrent loser reread", () => {
  const start = source.indexOf("async function dispatchPersistedOfferingPush");
  const seam = source.slice(
    start,
    source.indexOf("export interface SourceRefundChannelInput", start),
  );
  for (
    const required of [
      'input.category_key === "offering_invitation"',
      "validatePersistedOfferingPushV1",
      '.from("notifications").insert(',
      'client.rpc("can_send"',
      "beforeProviderIo: async () =>",
      'client.rpc("biz_claim_offering_push_provider_io"',
      "recordOfferingPushResult(",
      '.select("status,provider_idempotency_key")',
      "row.provider_idempotency_key === internalKey",
      "duplicate: true",
    ]
  ) {
    if (!seam.includes(required)) {
      throw new Error(`offering reconciliation seam drifted: ${required}`);
    }
  }
  const adapter = seam.indexOf("await pushAdapter.send");
  const claim = seam.indexOf(
    'client.rpc("biz_claim_offering_push_provider_io"',
  );
  const result = seam.indexOf("await recordOfferingPushResult", claim);
  if (adapter < 0 || claim < adapter || result < claim) {
    throw new Error("late-PONR ordering drifted");
  }
  if (seam.includes("await writeDelivery(")) {
    throw new Error("generic delivery writer entered offering push seam");
  }
});

const attemptId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const internalKey = `offering:${attemptId}:push:v1`;
const persisted = {
  payloadVersion: 1 as const,
  payloadHash:
    "7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190",
  title: "You are invited",
  body: "Open Mingla for details.",
  eventId: "00000000-0000-4000-8000-000000000010",
};
const input = {
  user_id: userId,
  category_key: "offering_invitation",
  payload: {},
  idempotency_key: internalKey,
  requested_channel: "push" as const,
  persisted_offering_push: persisted,
  offering_attempt_id: attemptId,
  internal_provider_claim_key: internalKey,
  onesignal_idempotency_key: attemptId,
};

function fake(options: {
  category?: { data: unknown; error: unknown };
  inserts?: Array<{ data: unknown; error: unknown }>;
  reload?: { data: unknown; error: unknown };
  policies?: Array<{ data: unknown; error: unknown }>;
}) {
  let insertCount = 0;
  let policyCount = 0;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () =>
                  table === "notification_categories"
                    ? options.category ??
                      { data: { active: true }, error: null }
                    : options.reload ?? { data: null, error: null },
              };
            },
          };
        },
        insert() {
          const outcome = options.inserts?.[insertCount] ?? {
            data: { id: "77777777-7777-4777-8777-777777777777" },
            error: null,
          };
          insertCount += 1;
          return {
            select() {
              return { single: async () => outcome };
            },
          };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "can_send") {
        return options.policies?.[policyCount++] ?? { data: true, error: null };
      }
      return { data: {}, error: null };
    },
  } as unknown as MinimalClient;
  return {
    client,
    calls,
    get insertCount() {
      return insertCount;
    },
  };
}

Deno.test("#1770 A12 unavailable category and policy remain queued without projection", async () => {
  const category = fake({
    category: { data: null, error: { message: "down" } },
  });
  assertEquals(await dispatchV2(category.client, input), {
    success: false,
    reason: "category_lookup_unavailable",
  });
  assertEquals(category.insertCount, 0);
  assertEquals(category.calls.length, 0);

  const policy = fake({
    policies: [{ data: null, error: { message: "down" } }],
  });
  assertEquals(
    (await dispatchV2(policy.client, input)).reason,
    "can_send_unavailable",
  );
  assertEquals(policy.insertCount, 1);
  assertEquals(policy.calls.map((call) => call.name), ["can_send"]);
});

Deno.test("#1770 A12 proven category and policy denials project suppression", async () => {
  for (const categoryData of [null, { active: false }]) {
    const category = fake({ category: { data: categoryData, error: null } });
    await dispatchV2(category.client, input);
    assertEquals(category.calls.at(-1)?.args.p_safe_code, "category_inactive");
    assertEquals(category.insertCount, 0);
  }
  for (const policyData of [false, null]) {
    const policy = fake({ policies: [{ data: policyData, error: null }] });
    await dispatchV2(policy.client, input);
    assertEquals(policy.calls.at(-1)?.args.p_safe_code, "can_send_denied");
  }
});

Deno.test("#1770 A12 collision reload distinguishes outage, exact replay, and mismatch", async () => {
  const collision = { data: null, error: { code: "23505" } };
  const outage = fake({
    inserts: [collision],
    reload: { data: null, error: { message: "down" } },
  });
  assertEquals(
    (await dispatchV2(outage.client, input)).reason,
    "inbox_unavailable",
  );
  assertEquals(outage.calls.length, 0);

  Deno.env.delete("ONESIGNAL_APP_ID");
  Deno.env.delete("ONESIGNAL_REST_API_KEY");
  const exact = fake({
    inserts: [collision],
    reload: {
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        user_id: userId,
        type: "offering_invitation",
        idempotency_key: internalKey,
      },
      error: null,
    },
  });
  assertEquals((await dispatchV2(exact.client, input)).success, true);
  assertEquals(exact.calls.at(-1)?.args.p_safe_code, "provider_config_missing");

  for (
    const row of [null, {
      id: "77777777-7777-4777-8777-777777777777",
      user_id: "99999999-9999-4999-8999-999999999999",
      type: "offering_invitation",
      idempotency_key: internalKey,
    }]
  ) {
    const mismatch = fake({
      inserts: [collision],
      reload: { data: row, error: null },
    });
    assertEquals(
      (await dispatchV2(mismatch.client, input)).reason,
      "inbox_idempotency_collision",
    );
    assertEquals(
      mismatch.calls.at(-1)?.args.p_safe_code,
      "inbox_idempotency_collision",
    );
  }
});
