// #3682 wave 2 (B) — push as a campaign channel, through the shared notify
// pipeline with a stubbed provider. Preview returns counts only; confirm seals
// the server-built quote and sends now; every push names the brand, carries a
// short body, a deep link and the true receive reason.
import { handlePushCampaignAction } from "./index.ts";
import {
  buildPushQuote,
  campaignPushLink,
  publicPushQuote,
  sendPushCampaign,
} from "./pushCampaign.ts";

const CAMPAIGN = "36829500-0000-4000-8000-000000000001";
const ACTOR = "36829500-0000-4000-8000-000000000002";
const ANN = "36829500-0000-4000-8000-000000000003";
const BEN = "36829500-0000-4000-8000-000000000004";

const envelope = {
  brandId: "36829500-0000-4000-8000-000000000010",
  channel: "push" as const,
  selectedCount: 2,
  content: { kind: "push", body: "Doors at 9 tonight." },
  candidates: [
    { recipientUserId: ANN, reason: "follower" as const, allowed: true, safeReasonCode: "allowed" },
    { recipientUserId: BEN, reason: "follower" as const, allowed: false, safeReasonCode: "muted_or_off" },
  ],
  audienceId: "36829500-0000-4000-8000-000000000020",
  audienceKind: "brand_followers",
  audienceVersion: 0,
  audienceName: "Followers",
  campaignGroupId: CAMPAIGN,
};

function stub(calls: Array<{ name: string; args: unknown }>) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    updates,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      switch (name) {
        case "biz_marketing_push_quote_candidates_v1":
          return { data: envelope, error: null };
        case "biz_brand_blast_usage_v1":
          return {
            data: { emailCap: 1000, emailRemaining: 990, pushCap: null, pushRemaining: null,
              blastsThisWeek: 1, weekWarningAt: 3, smsCap: 100, smsRemaining: 100 },
            error: null,
          };
        case "biz_confirm_marketing_push_send_v1":
          return { data: { executionId: "x", campaignId: CAMPAIGN, replay: false }, error: null };
        case "mkt_claim_campaigns":
          return {
            data: [{ id: CAMPAIGN, account_id: ACTOR, brand_id: envelope.brandId,
              audience_id: envelope.audienceId, channel: "push",
              channel_payload: { kind: "push", body: "Doors at 9 tonight." },
              name: "Tonight", scheduled_for: null }],
            error: null,
          };
        case "biz_marketing_push_send_worklist_v1":
          return {
            data: { brandName: "Harmattan Club", brandSlug: "harmattanclub",
              eventSlug: "rooftop-night", body: "Doors at 9 tonight.",
              work: [{ messageId: "m-1", userId: ANN, reason: "follower" }] },
            error: null,
          };
        case "mkt_finalize_campaign":
          return { data: "sent", error: null };
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    },
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => {
        updates.push({ table, ...row });
        const chain = { eq: () => chain, then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
        return chain;
      },
    }),
  };
  return client;
}

Deno.test("#3682 push preview returns counts and allowance, never recipients", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const response = await handlePushCampaignAction(stub(calls), ACTOR, {
    action: "preview_push_v1",
    campaign_id: CAMPAIGN,
  });
  const body = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  if (
    body.reachableCount !== 1 || body.selectedCount !== 2 ||
    body.costKind !== "not_metered" || body.estimatedCostMinor !== null ||
    body.allowance?.pushRemaining !== null
  ) throw new Error(`preview wrong: ${JSON.stringify(body)}`);
  if (JSON.stringify(body).includes(ANN) || "candidates" in body) {
    throw new Error("preview leaked a recipient id");
  }
});

Deno.test("#3682 push confirm seals the server quote and sends now with brand, body, link and reason", async () => {
  const previousOrigin = Deno.env.get("BUSINESS_WEB_ORIGIN");
  Deno.env.set("BUSINESS_WEB_ORIGIN", "https://host.example.test");
  try {
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = stub(calls);
    const quotedAt = new Date();
    const quote = await buildPushQuote(CAMPAIGN, envelope, quotedAt);
    const sent: Array<Record<string, unknown>> = [];
    const response = await handlePushCampaignAction(client, ACTOR, {
      action: "confirm_push_v1",
      campaign_id: CAMPAIGN,
      client_request_id: "36829500-0000-4000-8000-000000000099",
      quoteHash: quote.quoteHash,
      quotedAt: quotedAt.toISOString(),
      scheduledFor: null,
    }, async (_db, input) => {
      sent.push(input as unknown as Record<string, unknown>);
      return { success: true, notificationId: "n-1",
        deliveries: [{ channel: "push", status: "sent", providerMessageId: "os-1" }] };
    });
    const body = await response.json();
    if (response.status !== 200 || body.resultState !== "complete" ||
        body.dispatch?.delivered !== 1) {
      throw new Error(`confirm wrong: ${JSON.stringify(body)}`);
    }
    const sealed = calls.find((call) => call.name === "biz_confirm_marketing_push_send_v1")!
      .args as Record<string, Record<string, unknown>>;
    if (sealed.p_quote_snapshot.quoteHash !== quote.quoteHash) {
      throw new Error("confirm did not seal the server-built quote");
    }
    if (sent.length !== 1) throw new Error(`expected 1 push, got ${sent.length}`);
    const push = sent[0];
    const payload = push.payload as Record<string, unknown>;
    if (
      push.category_key !== "brand_campaign_push" || push.requested_channel !== "push" ||
      push.user_id !== ANN || payload.brand_name !== "Harmattan Club" ||
      payload.body !== "Doors at 9 tonight." || payload.reason !== "follower" ||
      push.deep_link !== "https://host.example.test/e/harmattanclub/rooftop-night"
    ) throw new Error(`push input wrong: ${JSON.stringify(push)}`);
    if (!client.updates.some((row) => row.table === "marketing_push_messages" && row.status === "sent")) {
      throw new Error("the push row was not marked sent");
    }
  } finally {
    if (previousOrigin === undefined) Deno.env.delete("BUSINESS_WEB_ORIGIN");
    else Deno.env.set("BUSINESS_WEB_ORIGIN", previousOrigin);
  }
});

Deno.test("#3682 a changed quote hash is a stale preview, never a send", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const response = await handlePushCampaignAction(stub(calls), ACTOR, {
    action: "confirm_push_v1",
    campaign_id: CAMPAIGN,
    client_request_id: "36829500-0000-4000-8000-000000000098",
    quoteHash: "0".repeat(64),
    quotedAt: new Date().toISOString(),
    scheduledFor: null,
  });
  const body = await response.json();
  if (response.status !== 409 || body.error !== "BOOK_BLAST_PREVIEW_STALE") {
    throw new Error(JSON.stringify(body));
  }
  if (calls.some((call) => call.name === "biz_confirm_marketing_push_send_v1")) {
    throw new Error("a stale preview reached confirm");
  }
});

Deno.test("#3682 a provider failure is recorded, not retried as sent", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = stub(calls);
  const outcome = await sendPushCampaign(client, { id: CAMPAIGN, brand_id: envelope.brandId },
    async () => { throw new Error("down"); });
  if (outcome.failed !== 1 || outcome.delivered !== 0 ||
      !client.updates.some((row) => row.status === "failed" && row.failure_reason === "provider_failed")) {
    throw new Error(JSON.stringify({ outcome, updates: client.updates }));
  }
  if (campaignPushLink("harmattanclub", null, "https://h.test") !== "https://h.test/b/harmattanclub") {
    throw new Error("brand-only link wrong");
  }
  const quote = await buildPushQuote(CAMPAIGN, envelope, new Date());
  if ("candidates" in publicPushQuote(quote)) throw new Error("public quote kept candidates");
});
