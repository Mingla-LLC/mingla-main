// #4596 — no campaign ends failed without a reason, and event audiences ride
// the one owner. Zero reachable ends failed with failure_reason no_recipients
// (no send loop, no finalize); a thrown send writes its error code, never the
// raw message; a finalize 'failed' gets no_recipients; the legacy event_buyers
// lane asks the database owner (paid buyers plus going RSVP guests) instead of
// reading paid orders; a single-event combined blast still finds its chat.
// INVARIANT I-4596-NO-SILENT-ZERO: marketing-send never leaves a campaign failed with a null failure_reason; zero reachable is failure_reason no_recipients.
// MINGLA-INVARIANT: I-4596-NO-SILENT-ZERO | issue #4596 | marketing-send never leaves a campaign failed with a null failure_reason; zero reachable is failure_reason no_recipients (this suite).
//
// FAILS-ON-REVERT: dropping the no_recipients branch in processClaimedCampaigns fails
// T-ZERO; dropping failureReasonCode from the catch fails T-CATCH; dropping the
// post-finalize reason fails T-FINALIZE; restoring the orders resolver for
// event_buyers fails T-EVENT-LANE; dropping the combined branch of
// eventChatEventId fails T-CHAT.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eventChatEventId,
  failureReasonCode,
  noRecipientsToReach,
  processClaimedCampaigns,
} from "./index.ts";
import { resolveAudience } from "../_shared/marketingAudience.ts";

const CAMPAIGN = "45960000-0000-4000-8000-0000000000c1";
const EVENT = "45960000-0000-4000-8000-0000000000e1";
const BRAND = "45960000-0000-4000-8000-0000000000b1";

interface Write {
  table: string;
  values: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
}

function client(
  rpcs: Record<string, { data: unknown; error: unknown }> = {},
  messageRows: unknown[] = [],
) {
  const called: string[] = [];
  const writes: Write[] = [];
  return {
    called,
    writes,
    rpc: (fn: string, _args?: unknown) => {
      called.push(fn);
      return Promise.resolve(rpcs[fn] ?? { data: null, error: null });
    },
    from: (table: string) => {
      const write: Write = { table, values: {}, filters: [] };
      const result = { data: messageRows, error: null };
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        update: (values: Record<string, unknown>) => {
          write.values = values;
          writes.push(write);
          return chain;
        },
        select: () => chain,
        eq: (column: string, value: unknown) => {
          write.filters.push(["eq", column, value]);
          return chain;
        },
        is: (column: string, value: unknown) => {
          write.filters.push(["is", column, value]);
          return chain;
        },
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
}

const campaign = {
  id: CAMPAIGN,
  account_id: "a",
  brand_id: BRAND,
  audience_id: "c",
  channel: "email",
  channel_payload: { kind: "email", subject: "Hi", body_html: "<p>Hi</p>" },
  name: "Guests",
  scheduled_for: null,
};
const options = { live: true, resendApiKey: "" };

Deno.test("T-ZERO SC-7 zero reachable ends failed with no_recipients, no finalize", async () => {
  const c = client();
  const out = await processClaimedCampaigns(
    c,
    [campaign as never],
    options,
    () =>
      Promise.resolve({
        delivered: 0,
        deferred: 0,
        failed: 0,
        preview_skipped: 0,
        no_recipients: true,
      }),
  );
  const write = c.writes.find((w) => w.table === "marketing_campaigns");
  assert(write !== undefined);
  assertEquals(write.values.status, "failed");
  assertEquals(write.values.failure_reason, "no_recipients");
  assertEquals(write.values.recipient_count, 0);
  assert(!c.called.includes("mkt_finalize_campaign"));
  assert(c.called.includes("biz_record_marketing_book_send_failure_v1"));
  assertEquals(out.errors, [{
    campaign_id: CAMPAIGN,
    reason: "no_recipients",
  }]);
});

Deno.test("T-CATCH a thrown send writes its code, never the raw message or null", async () => {
  const c = client();
  await processClaimedCampaigns(
    c,
    [campaign as never],
    options,
    () =>
      Promise.reject(
        new Error("audience_load:provider said something private"),
      ),
  );
  const write = c.writes.find((w) => w.table === "marketing_campaigns");
  assertEquals(write?.values.status, "failed");
  assertEquals(write?.values.failure_reason, "audience_load");
  assertEquals(failureReasonCode("email_body_empty"), "email_body_empty");
  assertEquals(
    failureReasonCode("Some provider text with spaces"),
    "send_failed",
  );
  assertEquals(failureReasonCode(""), "send_failed");
  // #4541's CHECK: ^[a-z0-9_]{1,64}$ — longer, upper-case or dotted codes are not stored raw.
  assertEquals(failureReasonCode("x".repeat(65)), "send_failed");
  assertEquals(failureReasonCode("x".repeat(64)), "x".repeat(64));
  assertEquals(failureReasonCode("Provider.Error"), "send_failed");
});

Deno.test("T-FINALIZE a finalize that fails the campaign (push: 0 delivered) gets no_recipients when null", async () => {
  const c = client({ mkt_finalize_campaign: { data: "failed", error: null } });
  await processClaimedCampaigns(
    c,
    [{ ...campaign, channel: "push" } as never],
    options,
    () =>
      Promise.resolve({
        delivered: 0,
        deferred: 0,
        failed: 0,
        preview_skipped: 0,
      }),
  );
  const write = c.writes.find((w) => w.table === "marketing_campaigns");
  assertEquals(write?.values, { failure_reason: "no_recipients" });
  assert(
    write?.filters.some(([op, col, v]) =>
      op === "is" && col === "failure_reason" && v === null
    ),
  );
  assert(
    write?.filters.some(([op, col, v]) =>
      op === "eq" && col === "status" && v === "failed"
    ),
  );
});

Deno.test("T-FINALIZE email whose rows all failed at the provider is all_sends_failed, not no_recipients", async () => {
  const c = client({ mkt_finalize_campaign: { data: "failed", error: null } }, [{ id: "m1" }]);
  await processClaimedCampaigns(c, [campaign as never], options, () =>
    Promise.resolve({ delivered: 0, deferred: 0, failed: 0, preview_skipped: 0 }));
  const write = c.writes.find((w) => w.table === "marketing_campaigns");
  assertEquals(write?.values, { failure_reason: "all_sends_failed" });
});

Deno.test("T-FINALIZE email with no message rows at all is no_recipients", async () => {
  const c = client({ mkt_finalize_campaign: { data: "failed", error: null } }, []);
  await processClaimedCampaigns(c, [campaign as never], options, () =>
    Promise.resolve({ delivered: 0, deferred: 0, failed: 0, preview_skipped: 0 }));
  const write = c.writes.find((w) => w.table === "marketing_campaigns");
  assertEquals(write?.values, { failure_reason: "no_recipients" });
});

Deno.test("T-FINALIZE a sent campaign is not touched", async () => {
  const c = client({ mkt_finalize_campaign: { data: "sent", error: null } });
  await processClaimedCampaigns(
    c,
    [campaign as never],
    options,
    () =>
      Promise.resolve({
        delivered: 2,
        deferred: 0,
        failed: 0,
        preview_skipped: 0,
      }),
  );
  assertEquals(
    c.writes.filter((w) => w.table === "marketing_campaigns").length,
    0,
  );
});

Deno.test("T-GUARD zero reachable is refused only on a first pass", async () => {
  assertEquals(await noRecipientsToReach(client(), CAMPAIGN, 3), false);
  assertEquals(await noRecipientsToReach(client({}, []), CAMPAIGN, 0), true);
  // A resumed pass already wrote rows: its finalize decides, not the guard.
  assertEquals(
    await noRecipientsToReach(client({}, [{ id: "m1" }]), CAMPAIGN, 0),
    false,
  );
});

Deno.test("T-EVENT-LANE A2 event_buyers asks the database owner for buyers plus going guests", async () => {
  const rows = [
    {
      contact_key: "p1",
      raw_email: "guest@example.test",
      email_marketing_ok: true,
    },
    {
      contact_key: "k1",
      raw_email: "buyer@example.test",
      email_marketing_ok: true,
    },
  ];
  const c = client({
    biz_marketing_event_send_audience_v1: {
      data: {
        rows,
        brand_id: BRAND,
        reach: { total: 2, reachable_email: 2, reachable_sms: 0 },
      },
      error: null,
    },
  });
  const out = await resolveAudience(c as never, {
    kind: "event_buyers",
    event_id: EVENT,
  }, CAMPAIGN);
  assertEquals(c.called, ["biz_marketing_event_send_audience_v1"]);
  assertEquals(out.rows.length, 2);
  assertEquals(out.brand_id, BRAND);
});

Deno.test("T-EVENT-LANE event_buyers without a campaign, or a bad answer, fails closed", async () => {
  let threw = "";
  try {
    await resolveAudience(client() as never, {
      kind: "event_buyers",
      event_id: EVENT,
    });
  } catch (error) {
    threw = (error as Error).message;
  }
  assertEquals(threw, "event_audience_campaign_context_required");
  threw = "";
  try {
    await resolveAudience(
      client({
        biz_marketing_event_send_audience_v1: {
          data: { rows: [] },
          error: null,
        },
      }) as never,
      { kind: "event_buyers", event_id: EVENT },
      CAMPAIGN,
    );
  } catch (error) {
    threw = (error as Error).message;
  }
  assertEquals(threw, "event_audience_invalid_response");
});

Deno.test("T-CHAT SC-9 a single-event combined blast still writes into the event chat", () => {
  assertEquals(
    eventChatEventId({ kind: "event_buyers", event_id: EVENT }),
    EVENT,
  );
  assertEquals(
    eventChatEventId({
      kind: "combined_sources",
      brand_id: BRAND,
      sources: [`event:${EVENT}`],
    }),
    EVENT,
  );
  assertEquals(
    eventChatEventId({
      kind: "combined_sources",
      brand_id: BRAND,
      sources: ["book", `event:${EVENT}`],
    }),
    null,
  );
  assertEquals(
    eventChatEventId({
      kind: "combined_sources",
      brand_id: BRAND,
      sources: ["book"],
    }),
    null,
  );
});
