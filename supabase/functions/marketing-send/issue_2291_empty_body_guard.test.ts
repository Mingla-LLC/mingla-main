/**
 * issue #2291 — the email send guard. T-4 (SPEC §9's designated
 * fails-on-revert regression test), T-5, T-6, plus the empty-subject case
 * Seth added on top of the SPEC.
 *
 * WHAT THIS PROVES. `sendEmail` refuses a campaign whose stored payload has no
 * usable email in it, BEFORE the recipient loop — so a refused campaign writes
 * zero `marketing_messages` rows, issues zero Resend requests, and lands
 * `status='failed'` as a whole-campaign refusal rather than a partial send.
 *
 * WHY IT MATTERS. Nothing else on the path refuses one: the DB CHECK is
 * `NOT VALID`, `mkt_claim_campaigns` reads no content,
 * `biz_confirm_marketing_book_send_v1` compares the payload only with its own
 * quote snapshot (which an empty payload matches), and cron job
 * `orch_0815_b_marketing_send` fires every minute under the service role with
 * no human in the loop.
 *
 * HOW IT IS DRIVEN. Through the exported `processClaimedCampaigns` with its
 * DEFAULT dispatcher, so the real `dispatchByKind` → `sendEmail` runs. The
 * Supabase client is a recording fake and `globalThis.fetch` is stubbed and
 * counted, so "zero Resend requests" is measured, not assumed.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processClaimedCampaigns } from "./index.ts";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const BRAND_ID = "22222222-2222-4222-8222-222222222222";
const AUDIENCE_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";

interface Recorded {
  table: string;
  op: "insert" | "update";
  payload: unknown;
}

interface FakeState {
  writes: Recorded[];
  rpcs: string[];
  fetches: string[];
}

/**
 * Minimal recording stand-in for the service-role Supabase client. Only the
 * calls `sendEmail` + `processClaimedCampaigns` actually make are modelled;
 * anything else surfaces as an explicit throw rather than a silent `undefined`,
 * because a fake that quietly answers everything can make a broken guard look
 * green.
 */
function makeFakeSupabase(state: FakeState) {
  const audienceRow = {
    id: AUDIENCE_ID,
    brand_id: BRAND_ID,
    // `all_brand_people` resolves through ONE rpc, so the audience fake stays
    // small. It is also NOT `offering_send_group`, which keeps the offering
    // marker-symmetry check quiet and leaves this test measuring one thing.
    query_definition: { kind: "all_brand_people", brand_id: BRAND_ID },
  };
  const brandRow = {
    id: BRAND_ID,
    name: "Test Brand",
    slug: "test-brand",
    cover_media_url: null,
    cover_media_type: null,
  };

  const builder = (table: string) => {
    const chain = {
      _patch: null as Record<string, unknown> | null,
      _id: null as unknown,
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        if (column === "id") chain._id = value;
        return chain;
      },
      in() {
        return chain;
      },
      maybeSingle() {
        if (table === "marketing_audiences") {
          return Promise.resolve({ data: audienceRow, error: null });
        }
        if (table === "brands") {
          return Promise.resolve({ data: brandRow, error: null });
        }
        // `persistEmailSentTerminal` re-reads the row it just wrote and throws
        // unless the patch round-trips under the SAME id; echo it back so the
        // happy path can reach its terminal state.
        if (chain._patch !== null) {
          return Promise.resolve({
            data: { id: chain._id, ...chain._patch },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert(payload: unknown) {
        state.writes.push({ table, op: "insert", payload });
        return Promise.resolve({ data: null, error: null });
      },
      update(payload: unknown) {
        state.writes.push({ table, op: "update", payload });
        chain._patch = payload as Record<string, unknown>;
        return chain;
      },
    };
    return chain;
  };

  return {
    from: (table: string) => builder(table),
    rpc: (name: string, _args: unknown) => {
      state.rpcs.push(name);
      if (name === "biz_marketing_book_send_audience") {
        return Promise.resolve({
          data: {
            brand_id: BRAND_ID,
            reach: { total: 1, reachable_email: 1, reachable_sms: 0 },
            rows: [{
              contact_key: "buyer@example.com",
              display_name: "Real Buyer",
              first_name: "Real",
              raw_email: "buyer@example.com",
              raw_phone: null,
              order_count: 1,
              total_spend_minor: 5000,
              total_spend_currency: "USD",
              last_event_id: null,
              last_event_name: null,
              last_purchase_at: null,
              email_marketing_ok: true,
              sms_marketing_ok: false,
            }],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function campaignWith(payload: Record<string, unknown>) {
  return {
    id: CAMPAIGN_ID,
    account_id: ACCOUNT_ID,
    brand_id: BRAND_ID,
    audience_id: AUDIENCE_ID,
    channel: "email",
    // deno-lint-ignore no-explicit-any
    channel_payload: payload as any,
    name: "Campaign under test",
    scheduled_for: null,
  };
}

async function runDispatch(payload: Record<string, unknown>) {
  const state: FakeState = { writes: [], rpcs: [], fetches: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    state.fetches.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 }),
    );
    // deno-lint-ignore no-explicit-any
  }) as any;
  Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-2291-test-secret-not-a-real-key-0123456789");
  try {
    const summary = await processClaimedCampaigns(
      makeFakeSupabase(state),
      // deno-lint-ignore no-explicit-any
      [campaignWith(payload)] as any,
      { live: true, resendApiKey: "re_test_key" },
    );
    return { summary, state };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const messageRows = (state: FakeState) =>
  state.writes.filter((w) =>
    w.table === "marketing_messages" && w.op === "insert"
  );
const markedFailed = (state: FakeState) =>
  state.writes.some((w) =>
    w.table === "marketing_campaigns" && w.op === "update" &&
    (w.payload as { status?: string }).status === "failed"
  );

// ---------------------------------------------------------------------------
// T-4 — THE designated fails-on-revert test (SPEC §9).
// ---------------------------------------------------------------------------
Deno.test("#2291 T-4 — a scheduled email with an EMPTY body is refused at dispatch", async () => {
  const { summary, state } = await runDispatch({
    kind: "email",
    subject: "A perfectly good subject",
    body_html: "",
    body_text: "",
  });

  assertEquals(summary.failed, 1, "the campaign must be refused, not sent");
  assertEquals(summary.succeeded, 0);
  assertEquals(summary.delivered, 0);
  assertStringIncludes(summary.errors[0].reason, "email_body_empty");
  assertEquals(
    messageRows(state).length,
    0,
    "a refused campaign must write ZERO marketing_messages rows",
  );
  assertEquals(
    state.fetches.length,
    0,
    "a refused campaign must issue ZERO Resend requests",
  );
  assert(markedFailed(state), "the campaign must be left status='failed'");
});

// ---------------------------------------------------------------------------
// T-5 — the key is absent entirely (the exact shape `draft_campaign` wrote).
// ---------------------------------------------------------------------------
Deno.test("#2291 T-5 — an email payload with NO body_html key at all is refused", async () => {
  const { summary, state } = await runDispatch({
    kind: "email",
    subject: "Subject present",
    // No body_html. This is the Ari `{kind, body}` shape, minus the SMS key.
  });

  assertEquals(summary.failed, 1);
  assertStringIncludes(summary.errors[0].reason, "email_body_empty");
  assertEquals(messageRows(state).length, 0);
  assertEquals(state.fetches.length, 0);
  assert(markedFailed(state));
});

// ---------------------------------------------------------------------------
// T-5b — whitespace is not content. `<p> </p>`-style bodies still reach a
// customer as a blank email.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-5b — a whitespace-only body is refused", async () => {
  const { summary, state } = await runDispatch({
    kind: "email",
    subject: "Subject present",
    body_html: "   \n\t  ",
  });

  assertEquals(summary.failed, 1);
  assertStringIncludes(summary.errors[0].reason, "email_body_empty");
  assertEquals(messageRows(state).length, 0);
  assertEquals(state.fetches.length, 0);
});

// ---------------------------------------------------------------------------
// T-5c / T-5d — Seth's addition on top of the SPEC: subject is required at
// SEND time too. An email landing with a blank subject line is its own
// deliverability and trust failure.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-5c — a real body with an EMPTY subject is refused at dispatch", async () => {
  const { summary, state } = await runDispatch({
    kind: "email",
    subject: "",
    body_html: "<p>Doors at 9. See you there.</p>",
  });

  assertEquals(summary.failed, 1, "an empty subject line must not ship");
  assertStringIncludes(summary.errors[0].reason, "email_subject_empty");
  assertEquals(messageRows(state).length, 0);
  assertEquals(state.fetches.length, 0);
  assert(markedFailed(state));
});

Deno.test("#2291 T-5d — a missing subject key is refused just like an empty one", async () => {
  const { summary, state } = await runDispatch({
    kind: "email",
    body_html: "<p>Doors at 9. See you there.</p>",
  });

  assertEquals(summary.failed, 1);
  assertStringIncludes(summary.errors[0].reason, "email_subject_empty");
  assertEquals(messageRows(state).length, 0);
  assertEquals(state.fetches.length, 0);
});

// ---------------------------------------------------------------------------
// T-6 — the guard must NOT block a legitimate campaign. Without this, the
// guard could be "if (true) throw" and every other case above would still pass.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-6 — a complete email payload still dispatches", async () => {
  const { summary, state } = await runDispatch({
    kind: "email",
    subject: "Doors at 9",
    body_html: "<p>Doors at 9. See you there.</p>",
    body_text: "Doors at 9. See you there.",
    embedded_events: [],
  });

  assertEquals(summary.failed, 0, `unexpected failure: ${JSON.stringify(summary.errors)}`);
  assertEquals(summary.succeeded, 1);
  assertEquals(summary.delivered, 1);
  assertEquals(
    messageRows(state).length,
    1,
    "the happy path must still write its message row",
  );
  assertEquals(state.fetches.length, 1, "the happy path must still reach Resend");
  assertStringIncludes(state.fetches[0], "api.resend.com");
});
