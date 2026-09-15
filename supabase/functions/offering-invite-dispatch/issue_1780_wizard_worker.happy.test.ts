import {
  handler,
  handleWizardWorker,
  resolveWizardQuoteCurrency,
} from "./index.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("issue #1780 worker owns channels and performs no provider I/O before commit", () => {
  for (
    const required of [
      'mode: "wizard_worker"',
      '"issue_1780_claim_wizard_invite_outbox_v1"',
      '"issue_1780_execute_wizard_invite_outbox_v1"',
      '"issue_1780_complete_wizard_invite_outbox_v1"',
      '"issue_1780_complete_wizard_invite_outbox_no_recipients_v1"',
      '"issue_1780_fail_wizard_invite_outbox_v1"',
      '"marketing_send_live_enabled"',
      '"sms_live_enabled.ng"',
      '"sms_live_enabled.us"',
      'source: "guest_roster_actions"',
      'status: "succeeded_no_recipients"',
      "perChannelReachable: {",
      "canReceiveCount",
      "skippedCount",
    ]
  ) {
    if (!source.includes(required)) {
      throw new Error(`missing worker contract: ${required}`);
    }
  }
  const committed = source.indexOf(
    '"issue_1780_execute_wizard_invite_outbox_v1"',
  );
  const postCommitHandoff = source.indexOf(
    "const clean = await dispatchCommittedWizardGroup",
  );
  if (committed < 0 || postCommitHandoff < 0 || committed > postCommitHandoff) {
    throw new Error(
      "provider-capable work moved before durable execution commit",
    );
  }
  const workerShape = source.slice(
    source.indexOf("function isWizardWorkerBody"),
    source.indexOf("function deliveryFlagEnabled"),
  );
  if (
    !workerShape.includes(
      'exactKeys(value as Record<string, unknown>, ["mode"])',
    )
  ) {
    throw new Error("worker request accepts client recipients/channels");
  }
  for (
    const forbidden of [
      "api.resend.com",
      "api.twilio.com",
      "api.ng.termii.com",
      "onesignal.com/api",
    ]
  ) {
    if (source.includes(forbidden)) {
      throw new Error(`worker bypasses provider owner: ${forbidden}`);
    }
  }
  const noRecipients = source.indexOf(
    '"issue_1780_complete_wizard_invite_outbox_no_recipients_v1"',
  );
  if (
    noRecipients < 0 || source.indexOf("providerIo: false", noRecipients) < 0
  ) {
    throw new Error(
      "empty reachable snapshot does not terminate provider-dark",
    );
  }
});

Deno.test("issue #1780 empty and all-suppressed jobs succeed without provider I/O or pepper", async () => {
  const originalFetch = globalThis.fetch;
  const eventId = "00000000-1780-4000-8000-000000000010";
  const brandId = "00000000-1780-4000-8000-000000000001";
  const personId = "00000000-1780-4000-8000-000000000021";
  const recipientId = "00000000-1780-4000-8000-000000000031";
  const hash = "a".repeat(64);
  try {
    globalThis.fetch = () => {
      throw new Error("provider I/O must remain dark");
    };
    for (
      const candidates of [
        [],
        [{
          brandPersonId: personId,
          inviteId: null,
          predecessorAttemptId: null,
          channel: "push",
          contactMethodId: null,
          recipientUserId: recipientId,
          normalizedContact: null,
          allowed: false,
          safeReasonCode: "suppressed",
          lastContactAt: null,
        }],
      ]
    ) {
      const calls: string[] = [];
      const fake = {
        rpc: async (name: string) => {
          calls.push(name);
          if (name === "issue_1780_claim_wizard_invite_outbox_v1") {
            return {
              data: [{
                outboxJobId: "00000000-1780-4000-8000-000000000041",
                sealedSelectionId: "00000000-1780-4000-8000-000000000042",
                eventId,
                eventType: "event",
                actorId: "00000000-1780-4000-8000-000000000043",
                brandPersonIds: candidates.length === 0 ? [] : [personId],
                selectionHash: hash,
                selectionRevision: 2,
                leaseToken: "00000000-1780-4000-8000-000000000044",
                attemptCount: 1,
                sendGroupId: null,
                executionSnapshot: null,
              }],
              error: null,
            };
          }
          if (name === "biz_offering_send_quote_candidates") {
            return { data: { brandId, candidates }, error: null };
          }
          if (
            name === "issue_1780_complete_wizard_invite_outbox_no_recipients_v1"
          ) {
            return { data: { status: "succeeded" }, error: null };
          }
          throw new Error(`unexpected rpc ${name}`);
        },
      };
      const response = await handleWizardWorker(
        fake as never,
        "https://edge.test",
        "service-test-key",
      );
      const body = await response.json();
      if (
        response.status !== 200 || body.providerIo !== false ||
        body.outcomes?.[0]?.status !== "succeeded_no_recipients"
      ) {
        throw new Error(
          `zero-reachable job did not succeed provider-dark: ${
            JSON.stringify(body)
          }`,
        );
      }
      if (
        calls.includes("issue_1780_execute_wizard_invite_outbox_v1") ||
        calls.includes("issue_1780_fail_wizard_invite_outbox_v1")
      ) {
        throw new Error(
          "zero-reachable job executed delivery or entered failure",
        );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1780 crash recovery resumes stored group without requote or duplicate group", async () => {
  const eventId = "00000000-1780-4000-8000-000000000010";
  const groupId = "00000000-1780-4000-8000-000000000051";
  const campaignId = "00000000-1780-4000-8000-000000000052";
  const calls: string[] = [];
  const submissions: unknown[] = [];
  const originalFetch = globalThis.fetch;
  const chain = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    update() {
      return this;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: [{ campaign_id: campaignId }], error: null });
    },
    maybeSingle: async () => ({ data: { status: "running" }, error: null }),
  };
  const fake = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "issue_1780_claim_wizard_invite_outbox_v1") {
        return {
          data: [{
            outboxJobId: "00000000-1780-4000-8000-000000000041",
            sealedSelectionId: "00000000-1780-4000-8000-000000000042",
            eventId,
            eventType: "event",
            actorId: "00000000-1780-4000-8000-000000000043",
            brandPersonIds: ["00000000-1780-4000-8000-000000000021"],
            selectionHash: "a".repeat(64),
            selectionRevision: 2,
            leaseToken: "00000000-1780-4000-8000-000000000044",
            attemptCount: 2,
            sendGroupId: groupId,
            executionSnapshot: { channels: ["email"] },
          }],
          error: null,
        };
      }
      if (name === "issue_1780_complete_wizard_invite_outbox_v1") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => chain,
  };
  try {
    globalThis.fetch = async (_input, init) => {
      submissions.push(JSON.parse(String(init?.body)));
      return new Response("ok", { status: 200 });
    };
    const response = await handleWizardWorker(
      fake as never,
      "https://edge.test",
      "service-test-key",
    );
    const body = await response.json();
    if (response.status !== 200 || body.outcomes?.[0]?.status !== "succeeded") {
      throw new Error(
        `stored execution did not resume: ${JSON.stringify(body)}`,
      );
    }
    if (
      calls.includes("biz_offering_send_quote_candidates") ||
      calls.includes("issue_1780_execute_wizard_invite_outbox_v1")
    ) {
      throw new Error(
        "reclaimed executed job was requoted or created a duplicate group",
      );
    }
    if (
      submissions.length !== 1 ||
      (submissions[0] as { campaign_id?: string }).campaign_id !== campaignId
    ) {
      throw new Error(
        "resume did not preserve the stable campaign operation key",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1780 partial provider handoff retries the stable group then terminalizes cleanly", async () => {
  const groupId = "00000000-1780-4000-8000-000000000061";
  const campaignId = "00000000-1780-4000-8000-000000000062";
  const calls: string[] = [];
  const submissions: string[] = [];
  let claimNumber = 0;
  let handoffNumber = 0;
  const originalFetch = globalThis.fetch;
  const chain = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    update() {
      return this;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: [{ campaign_id: campaignId }], error: null });
    },
    maybeSingle: async () => ({
      data: { status: handoffNumber === 1 ? "partial" : "running" },
      error: null,
    }),
  };
  const fake = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "issue_1780_claim_wizard_invite_outbox_v1") {
        claimNumber += 1;
        return {
          data: [{
            outboxJobId: "00000000-1780-4000-8000-000000000041",
            sealedSelectionId: "00000000-1780-4000-8000-000000000042",
            eventId: "00000000-1780-4000-8000-000000000010",
            eventType: "event",
            actorId: "00000000-1780-4000-8000-000000000043",
            brandPersonIds: ["00000000-1780-4000-8000-000000000021"],
            selectionHash: "a".repeat(64),
            selectionRevision: 2,
            leaseToken: claimNumber === 1
              ? "00000000-1780-4000-8000-000000000064"
              : "00000000-1780-4000-8000-000000000065",
            attemptCount: claimNumber,
            sendGroupId: groupId,
            executionSnapshot: { channels: ["email"] },
          }],
          error: null,
        };
      }
      if (name === "issue_1780_fail_wizard_invite_outbox_v1") {
        return { data: "retryable", error: null };
      }
      if (name === "issue_1780_complete_wizard_invite_outbox_v1") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => chain,
  };
  try {
    globalThis.fetch = async (_input, init) => {
      handoffNumber += 1;
      submissions.push(
        (JSON.parse(String(init?.body)) as { campaign_id: string }).campaign_id,
      );
      return new Response("", { status: handoffNumber === 1 ? 503 : 200 });
    };
    const first = await (await handleWizardWorker(
      fake as never,
      "https://edge.test",
      "service-test-key",
    )).json();
    const second = await (await handleWizardWorker(
      fake as never,
      "https://edge.test",
      "service-test-key",
    )).json();
    if (
      first.outcomes?.[0]?.status !== "retryable" ||
      second.outcomes?.[0]?.status !== "succeeded"
    ) {
      throw new Error(
        `partial handoff stranded: ${JSON.stringify({ first, second })}`,
      );
    }
    if (
      calls.includes("biz_offering_send_quote_candidates") ||
      calls.includes("issue_1780_execute_wizard_invite_outbox_v1") ||
      submissions.length !== 2 || submissions.some((id) => id !== campaignId)
    ) {
      throw new Error(
        "partial recovery changed the sealed group/operation identity",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("issue #1780 quote currency is canonical and mismatches fail closed", () => {
  if (resolveWizardQuoteCurrency(0, null, "EUR") !== "EUR") {
    throw new Error("zero-cost quote did not use offering currency");
  }
  if (resolveWizardQuoteCurrency(125, "GBP", "GBP") !== "GBP") {
    throw new Error("paid quote did not retain snapshot currency");
  }
  let mismatch = false;
  try {
    resolveWizardQuoteCurrency(125, "USD", "GBP");
  } catch (error) {
    mismatch = error instanceof Error &&
      error.message === "wizard_invite_currency_mismatch";
  }
  if (!mismatch) throw new Error("paid currency mismatch did not fail closed");
});

Deno.test("issue #1780 worker rejects callers without both service credentials", async () => {
  const response = await handler(
    new Request("https://edge.test/offering-invite-dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "wizard_worker" }),
    }),
  );
  if (response.status !== 403) {
    throw new Error(`expected 403, received ${response.status}`);
  }
  const body = await response.json();
  if (body.providerIo !== false) {
    throw new Error("rejected worker request did not prove provider-dark");
  }
});

Deno.test("issue #1780 preview accepts no client channel list and stays provider-dark", async () => {
  for (
    const required of [
      'mode: "wizard_preview"',
      "currentWizardDeliveryPolicy",
      "applyWizardSmsMarketFlags",
      "countryFromE164",
    ]
  ) {
    if (!source.includes(required)) {
      throw new Error(`missing preview authority: ${required}`);
    }
  }
  const previewShape = source.slice(
    source.indexOf("function isWizardPreviewBody"),
    source.indexOf("function deliveryFlagEnabled"),
  );
  if (
    previewShape.includes("channels") || previewShape.includes("brandPersonIds")
  ) {
    throw new Error(
      "wizard preview accepts client delivery or recipient authority",
    );
  }
  const response = await handler(
    new Request("https://edge.test/offering-invite-dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "wizard_preview",
        eventId: "00000000-1780-4000-8000-000000000010",
        selectionRevision: 1,
      }),
    }),
  );
  if (response.status !== 401 || (await response.json()).providerIo !== false) {
    throw new Error("unauthorized preview was not provider-dark");
  }
});
