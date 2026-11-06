// #4273 wave A — "How to reach them": the wizard quote and the wizard worker
// use only the methods the host ticked; a plan with no stored methods keeps the
// automatic behaviour; a job whose ticked methods are all switched off closes
// without sending anything.
import {
  handler,
  handleWizardWorker,
  noMethodsWizardQuote,
  wizardChannelsFor,
} from "./index.ts";

const JOB = {
  outboxJobId: "42739200-0000-4000-8000-000000000001",
  sealedSelectionId: "42739200-0000-4000-8000-000000000002",
  eventId: "42739200-0000-4000-8000-000000000003",
  eventType: "event",
  actorId: "42739200-0000-4000-8000-000000000004",
  brandPersonIds: ["42739200-0000-4000-8000-000000000006"],
  accountRecipientCount: 0,
  selectionHash: "a".repeat(64),
  selectionRevision: 2,
  leaseToken: "42739200-0000-4000-8000-000000000005",
  attemptCount: 1,
  executionSealed: false,
  sealedQueuedCount: null,
  committedGroupId: null,
  committedChannels: null,
};

type Call = { name: string; args: Record<string, unknown> };

function workerService(job: Record<string, unknown>, calls: Call[]) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (
        name === "issue_1780_claim_wizard_invite_observability_v1" ||
        name === "issue_1780_claim_wizard_invite_health_v1"
      ) return { data: [], error: null };
      if (name === "issue_1780_claim_wizard_invite_outbox_v1") {
        return { data: [job], error: null };
      }
      // Stop the Book lane right after the quote call: these tests only read
      // which methods it asked for.
      if (name === "biz_offering_send_quote_candidates") {
        return { data: null, error: { message: "stop_here" } };
      }
      if (name === "issue_1780_fail_wizard_invite_outbox_v1") {
        return { data: "retryable", error: null };
      }
      if (name === "issue_4273_complete_wizard_invite_outbox_no_methods_v1") {
        return { data: { status: "succeeded" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

async function withPolicy<T>(
  env: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  const keys = [
    "MINGLA_DELIVERY_FLAGS_JSON",
    "MARKETING_SEND_LIVE_ENABLED",
    "SMS_LIVE_ENABLED_NG",
    "SMS_LIVE_ENABLED_US",
  ];
  const previous = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  for (const key of keys) Deno.env.delete(key);
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const LIVE_NO_SMS = {
  MARKETING_SEND_LIVE_ENABLED: "true",
  SMS_LIVE_ENABLED_NG: "false",
  SMS_LIVE_ENABLED_US: "false",
};

Deno.test("#4273 wizardChannelsFor narrows the live methods to the ticked ones", () => {
  const live = ["email", "push", "sms"] as Array<"email" | "push" | "sms">;
  const cases: Array<[unknown, string]> = [
    [null, "email,push,sms"],
    [undefined, "email,push,sms"],
    [["push"], "push"],
    [["email", "push"], "email,push"],
    [["sms"], "sms"],
  ];
  for (const [chosen, expected] of cases) {
    const got = wizardChannelsFor(live, chosen).join(",");
    if (got !== expected) throw new Error(`${JSON.stringify(chosen)} -> ${got}`);
  }
  if (wizardChannelsFor(["email", "push"], ["sms"]).length !== 0) {
    throw new Error("a switched-off ticked method must not fall back to another");
  }
  let threw = false;
  try {
    wizardChannelsFor(live, "push");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("malformed methods must be refused");
});

Deno.test("#4273 the worker asks the Book lane only for the ticked methods", async () => {
  await withPolicy(LIVE_NO_SMS, async () => {
    const calls: Call[] = [];
    await handleWizardWorker(
      workerService({ ...JOB, deliveryChannels: ["push"] }, calls) as never,
      "https://project.example.test",
      "service-key",
    );
    const quote = calls.find((call) => call.name === "biz_offering_send_quote_candidates");
    if (JSON.stringify(quote?.args.p_channels) !== '["push"]') {
      throw new Error(`Book lane methods ${JSON.stringify(quote?.args.p_channels)}`);
    }
  });
});

Deno.test("#4273 a legacy job with no stored methods keeps the automatic methods", async () => {
  await withPolicy(LIVE_NO_SMS, async () => {
    const calls: Call[] = [];
    await handleWizardWorker(
      workerService({ ...JOB, deliveryChannels: null }, calls) as never,
      "https://project.example.test",
      "service-key",
    );
    const quote = calls.find((call) => call.name === "biz_offering_send_quote_candidates");
    if (JSON.stringify(quote?.args.p_channels) !== '["email","push"]') {
      throw new Error(`legacy methods ${JSON.stringify(quote?.args.p_channels)}`);
    }
  });
});

Deno.test("#4273 when every ticked method is off, the job closes without sending", async () => {
  await withPolicy(LIVE_NO_SMS, async () => {
    const calls: Call[] = [];
    const response = await handleWizardWorker(
      workerService({ ...JOB, deliveryChannels: ["sms"] }, calls) as never,
      "https://project.example.test",
      "service-key",
    );
    const body = await response.json();
    const names = calls.map((call) => call.name);
    if (names.includes("biz_offering_send_quote_candidates")) {
      throw new Error("an SMS-only job used another method");
    }
    if (
      !names.includes("issue_4273_complete_wizard_invite_outbox_no_methods_v1") ||
      body.outcomes?.[0]?.status !== "succeeded_no_methods"
    ) throw new Error(`not closed: ${JSON.stringify(body)}`);
  });
});

Deno.test("#4273 the no-methods estimate is honest: nobody reached, nothing charged", async () => {
  const quote = await noMethodsWizardQuote({
    selectedCount: 3,
    selectionRevision: 4,
    selectionHash: "b".repeat(64),
    currency: "USD",
  });
  const channels = quote.perChannelReachable as Record<string, number>;
  if (
    quote.canReceiveCount !== 0 || quote.skippedCount !== 3 ||
    quote.estimatedCostMinor !== 0 || channels.email + channels.sms + channels.push !== 0 ||
    !/^[0-9a-f]{64}$/.test(String(quote.quoteHash))
  ) throw new Error(`bad estimate ${JSON.stringify(quote)}`);
  const other = await noMethodsWizardQuote({
    selectedCount: 3,
    selectionRevision: 5,
    selectionHash: "b".repeat(64),
    currency: "USD",
  });
  if (other.quoteHash === quote.quoteHash) {
    throw new Error("the estimate hash must change with the revision");
  }
});

Deno.test({
  name: "#4273 the wizard preview quotes only the ticked methods",
  // supabase-js starts its own auth refresh timers for the per-request clients.
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  // The preview path builds real Supabase clients, so stub fetch at the edge:
  // auth, the plan RPC (user client) and the service RPCs.
  const previousFetch = globalThis.fetch;
  const previousEnv = new Map(
    ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [key, Deno.env.get(key)]),
  );
  Deno.env.set("SUPABASE_URL", "https://project.example.test");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const quoteChannels: unknown[] = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body ?? (input instanceof Request ? await input.text() : null);
    const body = typeof raw === "string" && raw.length > 0 ? JSON.parse(raw) : {};
    const ok = (value: unknown) =>
      new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/auth/v1/user")) {
      return ok({ id: JOB.actorId, aud: "authenticated", role: "authenticated" });
    }
    if (url.endsWith("/rpc/biz_get_offering_invite_plan_v1")) {
      return ok({
        eventId: JOB.eventId,
        selectionRevision: 2,
        brandPersonIds: JOB.brandPersonIds,
        selectionHash: JOB.selectionHash,
        accountRecipientCount: 0,
        deliveryChannels: ["push"],
      });
    }
    if (url.endsWith("/rpc/biz_offering_send_quote_candidates")) {
      quoteChannels.push(body.p_channels);
      return new Response(JSON.stringify({ message: "stop_here" }), { status: 400 });
    }
    if (url.includes("/rest/v1/events")) return ok({ currency: "USD" });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    await withPolicy(LIVE_NO_SMS, async () => {
      await handler(new Request("https://fn.example.test", {
        method: "POST",
        headers: { authorization: "Bearer user-token", "content-type": "application/json" },
        body: JSON.stringify({ mode: "wizard_preview", eventId: JOB.eventId, selectionRevision: 2 }),
      }));
    });
    if (JSON.stringify(quoteChannels) !== '[["push"]]') {
      throw new Error(`preview quoted ${JSON.stringify(quoteChannels)}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
