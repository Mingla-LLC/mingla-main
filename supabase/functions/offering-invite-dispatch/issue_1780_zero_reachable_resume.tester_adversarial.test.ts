import { handleWizardWorker } from "./index.ts";

Deno.test("issue #1780 reclaims a sealed zero-reachable job without pepper, execution, or provider I/O", async () => {
  const calls: string[] = [];
  const originalPepper = Deno.env.get("OFFERING_INVITE_TOKEN_PEPPER");
  Deno.env.set("OFFERING_INVITE_TOKEN_PEPPER", "ab".repeat(32));

  const fake = {
    rpc: async (name: string) => {
      calls.push(name);
      if (
        name === "issue_1780_claim_wizard_invite_observability_v1" ||
        name === "issue_1780_claim_wizard_invite_health_v1"
      ) {
        return { data: [], error: null };
      }
      if (name === "issue_1780_claim_wizard_invite_outbox_v1") {
        return {
          data: [{
            outboxJobId: "00000000-1780-4000-8000-000000000401",
            sealedSelectionId: "00000000-1780-4000-8000-000000000402",
            eventId: "00000000-1780-4000-8000-000000000403",
            eventType: "event",
            actorId: "00000000-1780-4000-8000-000000000404",
            brandPersonIds: ["00000000-1780-4000-8000-000000000405"],
            selectionHash: "a".repeat(64),
            selectionRevision: 2,
            leaseToken: "00000000-1780-4000-8000-000000000406",
            attemptCount: 2,
            executionSealed: true,
            // A correct claim may expose only this non-PII aggregate, or the
            // worker may read the existing seal through a service-only RPC.
            sealedQueuedCount: 0,
            queuedCount: 0,
            committedGroupId: null,
            committedChannels: null,
          }],
          error: null,
        };
      }
      if (
        name === "issue_1780_complete_wizard_invite_outbox_no_recipients_v1"
      ) {
        return {
          data: {
            outboxJobId: "00000000-1780-4000-8000-000000000401",
            status: "succeeded",
            providerIo: false,
          },
          error: null,
        };
      }
      if (name === "issue_1780_execute_wizard_invite_outbox_v1") {
        return {
          data: null,
          error: {
            code: "22023",
            message: "wizard_invite_execution_seal_invalid",
          },
        };
      }
      if (name === "issue_1780_fail_wizard_invite_outbox_v1") {
        return { data: "retryable", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => {
      throw new Error("zero-reachable replay attempted provider state I/O");
    },
  };

  try {
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
        `sealed zero-reachable replay was stranded: ${JSON.stringify(body)}`,
      );
    }
    if (
      calls.filter((name) =>
          name ===
            "issue_1780_complete_wizard_invite_outbox_no_recipients_v1"
        ).length !== 1 ||
      calls.includes("biz_offering_send_quote_candidates") ||
      calls.includes("issue_1780_execute_wizard_invite_outbox_v1") ||
      calls.includes("issue_1780_fail_wizard_invite_outbox_v1")
    ) {
      throw new Error(
        `sealed zero-reachable replay crossed the wrong boundary: ${calls.join(",")}`,
      );
    }
  } finally {
    if (originalPepper === undefined) {
      Deno.env.delete("OFFERING_INVITE_TOKEN_PEPPER");
    } else {
      Deno.env.set("OFFERING_INVITE_TOKEN_PEPPER", originalPepper);
    }
  }
});
