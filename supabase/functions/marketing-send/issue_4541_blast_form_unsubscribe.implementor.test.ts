// #4541 R4.3 (SC-35, default 4): a Blast with a form, sent for real through
// marketing-send, never reaches a recipient who unsubscribed from the brand and
// never mints that person a form link.
//
// HOW IT IS DRIVEN. Through the exported `processClaimedCampaigns` with its
// default dispatcher, so the real `sendEmail` and the real audience resolver
// (`_shared/marketingAudience.ts`) run against a fake database. The provider is
// a stubbed `fetch` whose request bodies are captured, and every
// `brand_form_link_issue_blast` call is recorded with its contact key.
//
//   - T-UNSUB-EDGE: a `brand_buyers` audience. Two buyers; `marketing_unsubscribes`
//     holds a brand-scoped row for one of them. The edge's own resolver reads
//     that row, so this proves the whole edge path from the unsubscribe row to
//     "no email, no link".
//   - T-UNSUB-BOOK: an `all_brand_people` (Book) audience, which is how a Blast
//     with "+ Form" is normally sent. The unsubscribe is applied in SQL
//     (`biz_marketing_book_send_audience` returns `email_marketing_ok: false`),
//     so here the fake RPC hands back that flag. This proves the edge honours
//     the flag before minting; it does NOT prove the SQL maps a
//     `marketing_unsubscribes` row onto the flag (that is the audience RPC's own
//     pg17 coverage).
//
// Not covered here: the SMS lane (its mint sits behind the same
// `sms_marketing_ok` skip, pinned by issue_4541_blast_form T-ORDER).
//
// FAILS-ON-REVERT: dropping the `email_marketing_ok` skip in sendEmail (or
// minting the form link before it) sends the unsubscribed buyer an email and
// mints them a link, and both cases turn RED.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processClaimedCampaigns } from "./index.ts";

const CAMPAIGN = "45410000-0000-4000-8000-000000000bc1";
const BRAND = "45410000-0000-4000-8000-000000000bb1";
const ACCOUNT = "45410000-0000-4000-8000-000000000ba1";
const AUDIENCE = "45410000-0000-4000-8000-000000000bd1";
const FORM = "45410000-0000-4000-8000-000000000bf1";
const EVENT = "45410000-0000-4000-8000-000000000be1";

const SUBSCRIBED = "ada@lagos-supper.com.ng";
const UNSUBSCRIBED = "bola@lagos-supper.com.ng";

interface Recorder {
  mints: Array<
    { p_contact_key: unknown; p_form_id: unknown; p_campaign_id: unknown }
  >;
  messageInserts: Array<Record<string, unknown>>;
}

function order(id: string, email: string, name: string) {
  return {
    id,
    event_id: EVENT,
    buyer_email: email,
    buyer_name: name,
    buyer_phone: null,
    buyer_phone_e164: null,
    total_cents: 5000,
    currency: "NGN",
    payment_status: "paid",
    confirmed_at: "2026-11-01T10:00:00Z",
    created_at: "2026-11-01T10:00:00Z",
    events: { id: EVENT, title: "Supper club", brand_id: BRAND },
  };
}

function fakeDatabase(
  audienceKind: "brand_buyers" | "all_brand_people",
  rec: Recorder,
) {
  const tableRows = (table: string, columns: string): unknown[] => {
    if (table === "orders") {
      return [
        order("o1", SUBSCRIBED, "Ada Obi"),
        order("o2", UNSUBSCRIBED, "Bola Ade"),
      ];
    }
    if (
      table === "marketing_unsubscribes" && columns.includes("contact_email")
    ) {
      // The brand unsubscribe the recipient made from an earlier Blast.
      return [{
        contact_email: UNSUBSCRIBED,
        channel: "all",
        scope: "brand",
        brand_id: BRAND,
      }];
    }
    return [];
  };
  const builder = (table: string) => {
    let columns = "";
    let patch: Record<string, unknown> | null = null;
    let id: unknown = null;
    const chain = {
      select(c?: string) {
        if (typeof c === "string") columns = c;
        return chain;
      },
      eq(column: string, value: unknown) {
        if (column === "id") id = value;
        return chain;
      },
      in: () => chain,
      not: () => chain,
      or: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      delete: () => chain,
      update(p: Record<string, unknown>) {
        patch = p;
        return chain;
      },
      insert(row: Record<string, unknown> | Record<string, unknown>[]) {
        if (table === "marketing_messages" && !Array.isArray(row)) {
          rec.messageInserts.push(row);
        }
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        if (table === "marketing_audiences") {
          return Promise.resolve({
            data: {
              id: AUDIENCE,
              brand_id: BRAND,
              query_definition: { kind: audienceKind, brand_id: BRAND },
            },
            error: null,
          });
        }
        if (table === "brands") {
          return Promise.resolve({
            data: {
              id: BRAND,
              account_id: ACCOUNT,
              name: "Lagos Supper",
              slug: "lagos-supper",
              contact_email: null,
              cover_media_url: null,
              cover_media_type: null,
            },
            error: null,
          });
        }
        if (patch !== null) {
          return Promise.resolve({ data: { id, ...patch }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(
        resolve: (v: { data: unknown; error: null }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve({ data: tableRows(table, columns), error: null })
          .then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "brand_form_blast_check") {
        return Promise.resolve({
          data: { ok: true, formId: FORM, formName: "Dietary needs" },
          error: null,
        });
      }
      if (name === "brand_form_link_issue_blast") {
        rec.mints.push(args as Recorder["mints"][number]);
        return Promise.resolve({
          data: { token: "b".repeat(64) },
          error: null,
        });
      }
      if (name === "biz_marketing_book_send_audience") {
        const row = (email: string, name: string, ok: boolean) => ({
          contact_key: email,
          display_name: name,
          first_name: name.split(" ")[0],
          raw_email: email,
          raw_phone: null,
          order_count: 1,
          total_spend_minor: 5000,
          total_spend_currency: "NGN",
          last_event_id: null,
          last_event_name: null,
          last_purchase_at: null,
          email_marketing_ok: ok,
          sms_marketing_ok: false,
        });
        return Promise.resolve({
          data: {
            brand_id: BRAND,
            reach: { total: 2, reachable_email: 1, reachable_sms: 0 },
            // The SQL resolver applies the brand unsubscribe as this flag.
            rows: [
              row(SUBSCRIBED, "Ada Obi", true),
              row(UNSUBSCRIBED, "Bola Ade", false),
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

async function sendBlastWithForm(
  audienceKind: "brand_buyers" | "all_brand_people",
) {
  const rec: Recorder = { mints: [], messageInserts: [] };
  const sent: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("api.resend.com")) {
      sent.push(
        JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ id: `resend-${sent.length}` }), {
        status: 200,
      }),
    );
    // deno-lint-ignore no-explicit-any
  }) as any;
  Deno.env.set(
    "UNSUBSCRIBE_TOKEN_SECRET",
    "issue-4541-test-secret-not-a-real-key-0123456789",
  );
  let summary;
  try {
    summary = await processClaimedCampaigns(
      fakeDatabase(audienceKind, rec),
      [{
        id: CAMPAIGN,
        account_id: ACCOUNT,
        brand_id: BRAND,
        audience_id: AUDIENCE,
        channel: "email",
        channel_payload: {
          kind: "email",
          subject: "Supper on Saturday",
          body_html: "<p>Tell us what you eat.</p>",
          body_text: "Tell us what you eat.",
          embedded_form: { form_id: FORM },
        },
        name: "Supper on Saturday",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      { live: true, resendApiKey: "re_test_key" },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  return { rec, sent, summary };
}

function assertOnlySubscribedReached(
  out: Awaited<ReturnType<typeof sendBlastWithForm>>,
): void {
  const { rec, sent, summary } = out;
  assertEquals(summary.errors, [], "the send itself succeeds");
  // Exactly one message, to the subscribed buyer, carrying their own form link.
  assertEquals(sent.flatMap((b) => b.to as string[]), [SUBSCRIBED]);
  assert(
    String(sent[0].html).includes(`/form/${FORM}?c=${CAMPAIGN}#t=`),
    "the email carries the form link",
  );
  assert(
    !sent.some((b) => JSON.stringify(b).includes(UNSUBSCRIBED)),
    "nothing is sent to the unsubscribed buyer",
  );
  // Exactly one personal form link, minted for the subscribed buyer only.
  assertEquals(rec.mints.map((m) => m.p_contact_key), [SUBSCRIBED]);
  assertEquals(rec.mints[0].p_form_id, FORM);
  assertEquals(rec.mints[0].p_campaign_id, CAMPAIGN);
  // No message row for the unsubscribed buyer either.
  assertEquals(rec.messageInserts.map((m) => m.recipient_email), [SUBSCRIBED]);
}

Deno.test("T-UNSUB-EDGE SC-35 a brand-unsubscribed buyer gets no Blast email and no form link (edge resolver)", async () => {
  assertOnlySubscribedReached(await sendBlastWithForm("brand_buyers"));
});

Deno.test("T-UNSUB-BOOK SC-35 a Book contact the SQL marks unsubscribed gets no Blast email and no form link", async () => {
  assertOnlySubscribedReached(await sendBlastWithForm("all_brand_people"));
});
