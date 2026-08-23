/**
 * issue #2485 — every brand blast must carry a one-click unsubscribe header and
 * a Reply-To that reaches a human.
 *
 * WHAT THIS PROVES. It reads the ACTUAL body Mingla POSTs to Resend, not the
 * source that builds it. Three properties:
 *
 *   1. `List-Unsubscribe` + `List-Unsubscribe-Post` are both present. Providers
 *      read the HEADER, never the link in the body, and render their native
 *      Unsubscribe button from it. Both are required together: the first alone
 *      gets a confirmation round-trip; the second is what makes a provider POST
 *      straight to the URL and treat the opt-out as honoured (RFC 8058).
 *   2. `reply_to` is set. Blasts are sent From `<slug>@usemingla.com`, a display
 *      identity with no mailbox — the domain's MX is Google Workspace and those
 *      aliases do not exist there — so before this every reply bounced.
 *   3. The unsubscribe URL is Mingla-branded, not a raw supabase.co endpoint
 *      (#2470), and points at the same signed token the body footer uses.
 *
 * WHY IT MATTERS. Without the header, a recipient's only way to stop mail is the
 * spam button. Spam complaints damage a sending domain far more than opt-outs
 * do, and `usemingla.com` had 17 marketing emails of history in total when this
 * was written — no reputation to absorb them.
 *
 * Until 2026-08-23 this header could not have been added honestly:
 * `marketing-unsubscribe` was deployed with verify_jwt=true, so the endpoint
 * behind it returned 401 to every recipient. Fixed and verified that day.
 *
 * HOW IT IS DRIVEN. Through the exported `processClaimedCampaigns` with its
 * default dispatcher, so the real `sendEmail` runs. `globalThis.fetch` is
 * stubbed and the request body captured, so the headers are MEASURED.
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

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function makeFakeSupabase(brandContactEmail: string | null) {
  const audienceRow = {
    id: AUDIENCE_ID,
    brand_id: BRAND_ID,
    query_definition: { kind: "all_brand_people", brand_id: BRAND_ID },
  };
  const brandRow = {
    id: BRAND_ID,
    name: "Test Brand",
    slug: "test-brand",
    contact_email: brandContactEmail,
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
        if (chain._patch !== null) {
          return Promise.resolve({
            data: { id: chain._id, ...chain._patch },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      update(payload: unknown) {
        chain._patch = payload as Record<string, unknown>;
        return chain;
      },
    };
    return chain;
  };
  return {
    from: (table: string) => builder(table),
    rpc: (name: string, _args: unknown) => {
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

async function sendOnce(brandContactEmail: string | null) {
  const captured: Captured[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.resend.com")) {
      captured.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
    }
    return Promise.resolve(
      new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 }),
    );
    // deno-lint-ignore no-explicit-any
  }) as any;
  Deno.env.set(
    "UNSUBSCRIBE_TOKEN_SECRET",
    "issue-2485-test-secret-not-a-real-key-0123456789",
  );
  try {
    await processClaimedCampaigns(
      makeFakeSupabase(brandContactEmail),
      // deno-lint-ignore no-explicit-any
      [{
        id: CAMPAIGN_ID,
        account_id: ACCOUNT_ID,
        brand_id: BRAND_ID,
        audience_id: AUDIENCE_ID,
        channel: "email",
        channel_payload: {
          kind: "email",
          subject: "An exhibition you signed up for",
          body_html: "<p>Come along.</p>",
          body_text: "Come along.",
        },
        name: "Campaign under test",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      { live: true, resendApiKey: "re_test_key" },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  return captured;
}

// ---------------------------------------------------------------------------
// THE designated fails-on-revert test.
// ---------------------------------------------------------------------------
Deno.test("#2485 — a blast carries one-click unsubscribe headers", async () => {
  const sends = await sendOnce("organiser@example.com");
  assertEquals(sends.length, 1, "exactly one Resend request expected");

  const headers = sends[0].body.headers as Record<string, string> | undefined;
  assert(headers !== undefined, "the Resend payload must carry headers");

  const listUnsub = headers["List-Unsubscribe"];
  assert(
    listUnsub !== undefined,
    "List-Unsubscribe missing — without it a recipient's only exit is the spam button",
  );
  // RFC 8058: the URL is angle-bracketed.
  assert(
    listUnsub.startsWith("<") && listUnsub.endsWith(">"),
    `List-Unsubscribe must be angle-bracketed, got: ${listUnsub}`,
  );
  assertEquals(
    headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
    "List-Unsubscribe alone only gets a confirmation round-trip; the Post header is what makes it one-click",
  );

  // #2470 — branded, and never the raw function endpoint.
  assertStringIncludes(listUnsub, "usemingla.com/unsubscribe/");
  assert(
    !listUnsub.includes("supabase.co"),
    `the unsubscribe header must not expose a raw supabase.co URL: ${listUnsub}`,
  );
});

Deno.test("#2485 — Reply-To is the brand's own address when it has one", async () => {
  const sends = await sendOnce("organiser@example.com");
  assertEquals(sends[0].body.reply_to, "organiser@example.com");
});

Deno.test("#2485 — Reply-To falls back to a real Mingla inbox, never the From alias", async () => {
  // Most brands have no contact_email, so the fallback IS the common path. It
  // must never be <slug>@usemingla.com, which has no mailbox and bounces.
  const sends = await sendOnce(null);
  assertEquals(sends[0].body.reply_to, "support@usemingla.com");
  assert(
    String(sends[0].body.reply_to) !== String(sends[0].body.from),
    "Reply-To must not point back at the unmonitored From alias",
  );
});

Deno.test("#2485 — a blank or malformed contact_email uses the fallback", async () => {
  for (const bad of ["", "   ", "not-an-email"]) {
    const sends = await sendOnce(bad);
    assertEquals(
      sends[0].body.reply_to,
      "support@usemingla.com",
      `contact_email ${JSON.stringify(bad)} must not become a Reply-To`,
    );
  }
});
