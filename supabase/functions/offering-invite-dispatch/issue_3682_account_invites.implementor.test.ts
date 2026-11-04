// #3682 wave 2 (A) — the wizard worker invites account-only followers by push
// and email through the shared notify pipeline, records every item, and
// completes an account-only job without touching the Book lane.
import {
  accountInviteLink,
  handleWizardWorker,
  mergeWizardAccountQuote,
} from "./index.ts";
import { renderBrandReachMessage } from "../_shared/brandReachMessages.ts";

const JOB = {
  outboxJobId: "36829200-0000-4000-8000-000000000001",
  sealedSelectionId: "36829200-0000-4000-8000-000000000002",
  eventId: "36829200-0000-4000-8000-000000000003",
  eventType: "event",
  actorId: "36829200-0000-4000-8000-000000000004",
  brandPersonIds: [] as string[],
  accountRecipientCount: 1,
  selectionHash: "a".repeat(64),
  selectionRevision: 2,
  leaseToken: "36829200-0000-4000-8000-000000000005",
  attemptCount: 1,
  executionSealed: false,
  sealedQueuedCount: null,
  committedGroupId: null,
  committedChannels: null,
};
const FOLLOWER = "36829200-0000-4000-8000-000000000010";

function stubService(calls: Array<{ name: string; args: unknown }>) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (
        name === "issue_1780_claim_wizard_invite_observability_v1" ||
        name === "issue_1780_claim_wizard_invite_health_v1"
      ) return { data: [], error: null };
      if (name === "issue_1780_claim_wizard_invite_outbox_v1") {
        return { data: [JOB], error: null };
      }
      if (name === "issue_3682_build_wizard_account_invites_v1") {
        return {
          data: {
            context: {
              brandName: "Harmattan Club",
              brandSlug: "harmattanclub",
              eventTitle: "Rooftop Night",
              eventSlug: "rooftop-night",
            },
            work: [
              {
                deliveryId: "36829200-0000-4000-8000-000000000020",
                userId: FOLLOWER,
                ring: "follower",
                channel: "push",
                email: null,
              },
              {
                deliveryId: "36829200-0000-4000-8000-000000000021",
                userId: FOLLOWER,
                ring: "follower",
                channel: "email",
                email: "guest@example.test",
              },
            ],
          },
          error: null,
        };
      }
      if (
        name === "issue_3682_record_wizard_account_invite_v1" ||
        name === "issue_3682_complete_wizard_account_outbox_v1"
      ) return { data: true, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

Deno.test("#3682 account-only wizard job sends push + email to the follower and completes", async () => {
  const previousOrigin = Deno.env.get("BUSINESS_WEB_ORIGIN");
  Deno.env.set("BUSINESS_WEB_ORIGIN", "https://host.example.test");
  try {
    const calls: Array<{ name: string; args: unknown }> = [];
    const sent: Array<Record<string, unknown>> = [];
    const response = await handleWizardWorker(
      stubService(calls) as never,
      "https://project.example.test",
      "service-key",
      async (_client, input) => {
        sent.push(input as unknown as Record<string, unknown>);
        return {
          success: true,
          deliveries: [{
            channel: input.requested_channel as string,
            status: "sent",
            providerMessageId: "p-1",
          }],
        };
      },
    );
    const body = await response.json();
    if (body.outcomes?.[0]?.status !== "succeeded") {
      throw new Error(`job not completed: ${JSON.stringify(body)}`);
    }
    if (sent.length !== 2) throw new Error(`expected 2 sends, got ${sent.length}`);
    const push = sent.find((row) => row.requested_channel === "push")!;
    const email = sent.find((row) => row.requested_channel === "email")!;
    if (
      push.category_key !== "brand_offering_invite" || push.contact !== null ||
      push.user_id !== FOLLOWER ||
      push.deep_link !== "https://host.example.test/e/harmattanclub/rooftop-night"
    ) throw new Error(`push input wrong: ${JSON.stringify(push)}`);
    if (email.contact !== "guest@example.test") {
      throw new Error("email lane must use the server-resolved address");
    }
    if (JSON.stringify(push.payload).includes("@")) {
      throw new Error("payload carried an address");
    }
    const names = calls.map((call) => call.name);
    if (names.includes("biz_offering_send_quote_candidates")) {
      throw new Error("an account-only job entered the Book lane");
    }
    const records = calls.filter((call) =>
      call.name === "issue_3682_record_wizard_account_invite_v1"
    ).map((call) => (call.args as Record<string, unknown>).p_state);
    if (records.join() !== "sent,sent") {
      throw new Error(`records ${records.join()}`);
    }
    if (
      names.indexOf("issue_3682_complete_wizard_account_outbox_v1") <
        names.lastIndexOf("issue_3682_record_wizard_account_invite_v1")
    ) throw new Error("completion ran before every item was recorded");
  } finally {
    if (previousOrigin === undefined) Deno.env.delete("BUSINESS_WEB_ORIGIN");
    else Deno.env.set("BUSINESS_WEB_ORIGIN", previousOrigin);
  }
});

Deno.test("#3682 a provider failure is recorded per item and never resends", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  await handleWizardWorker(
    stubService(calls) as never,
    "https://project.example.test",
    "service-key",
    async () => {
      throw new Error("provider down");
    },
  );
  const states = calls.filter((call) =>
    call.name === "issue_3682_record_wizard_account_invite_v1"
  ).map((call) => (call.args as Record<string, unknown>).p_state);
  if (states.join() !== "failed,failed") {
    throw new Error(`expected failed records, got ${states.join()}`);
  }
});

Deno.test("#3682 wizard estimate folds account recipients in and changes the quote hash", async () => {
  const book = {
    quoteHash: "b".repeat(64),
    selectedCount: 2,
    eligibleCount: 2,
    reachableCount: 2,
    canReceiveCount: 1,
    skippedCount: 1,
    perChannelReachable: { email: 1, sms: 0, push: 1 },
  };
  const merged = await mergeWizardAccountQuote(book, {
    accountRecipientCount: 3,
    canReceiveCount: 2,
    push: 2,
    email: 1,
  });
  const channels = merged.perChannelReachable as Record<string, number>;
  if (
    merged.selectedCount !== 5 || merged.canReceiveCount !== 3 ||
    merged.skippedCount !== 2 || channels.push !== 3 || channels.email !== 2 ||
    channels.sms !== 0 || merged.quoteHash === book.quoteHash ||
    !/^[0-9a-f]{64}$/.test(String(merged.quoteHash))
  ) throw new Error(`merge wrong: ${JSON.stringify(merged)}`);
  const unchanged = await mergeWizardAccountQuote(book, null);
  if (unchanged.quoteHash !== book.quoteHash || unchanged.selectedCount !== 2) {
    throw new Error("a Book-only quote must be unchanged");
  }
});

Deno.test("#3682 account invites name the brand and the true reason", () => {
  const follower = renderBrandReachMessage("brand_offering_invite", {
    brand_name: "Harmattan Club",
    event_title: "Rooftop Night",
    reason: "follower",
  });
  const friend = renderBrandReachMessage("brand_offering_invite", {
    brand_name: "Harmattan Club",
    event_title: "Rooftop Night",
    reason: "extended",
  });
  if (
    follower.push.title !== "Harmattan Club" ||
    !follower.push.body.includes("You follow Harmattan Club.") ||
    !friend.push.body.includes("A friend of yours follows Harmattan Club.")
  ) throw new Error(JSON.stringify({ follower, friend }));
  if (accountInviteLink({ brandName: null, brandSlug: "bad slug", eventTitle: null, eventSlug: null }) !== null) {
    throw new Error("an invalid slug produced a link");
  }
});
