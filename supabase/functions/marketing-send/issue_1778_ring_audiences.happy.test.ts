import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveAudience } from "../_shared/marketingAudience.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";
import { bookRpcErrorEnvelope } from "./index.ts";

const BRAND_ID = "17780000-0000-4000-8000-000000000010";
const AUDIENCE_ID = "17780000-1000-4000-8000-000000000010";
const USER_ID = "17780000-2000-4000-8000-000000000010";

Deno.test("#1778 Circle resolver consumes only the sealed campaign RPC", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: {
          rows: [],
          brand_id: BRAND_ID,
          reach: { total: 0, reachable_email: 0, reachable_sms: 0 },
        },
        error: null,
      });
    },
  };

  for (const kind of ["brand_followers", "brand_circle_extended"] as const) {
    const result = await resolveAudience(
      client as never,
      { kind, brand_id: BRAND_ID },
      "campaign-1778",
    );
    assertEquals(result.rows, []);
  }
  assertEquals(calls, [
    {
      name: "biz_marketing_circle_send_audience_v1",
      args: { p_campaign_id: "campaign-1778" },
    },
    {
      name: "biz_marketing_circle_send_audience_v1",
      args: { p_campaign_id: "campaign-1778" },
    },
  ]);
});

Deno.test("#1778 Circle resolver fails closed without campaign context", async () => {
  await assertRejects(
    () =>
      resolveAudience({} as never, {
        kind: "brand_followers",
        brand_id: BRAND_ID,
      }),
    Error,
    "circle_blast_campaign_context_required",
  );
});

Deno.test("#1778 Circle quote seals identity but exposes aggregates only", async () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const input = {
    brandId: BRAND_ID,
    channel: "email" as const,
    selectedCount: 2,
    content: {
      kind: "email",
      subject: "Circle update",
      body_html: "Private launch",
      body_text: "Private launch",
    },
    audienceId: AUDIENCE_ID,
    audienceKind: "brand_followers" as const,
    audienceVersion: 17,
    audienceName: "Followers",
    candidates: [
      {
        brandPersonId: "17780000-3000-4000-8000-000000000001",
        recipientUserId: USER_ID,
        ring: "follower" as const,
        snapshotVersion: 17,
        contactMethodId: null,
        normalizedContact: "private-follower@example.test",
        allowed: true,
        safeReasonCode: "allowed",
      },
      {
        brandPersonId: "17780000-3000-4000-8000-000000000002",
        recipientUserId: "17780000-2000-4000-8000-000000000011",
        ring: "follower" as const,
        snapshotVersion: 17,
        contactMethodId: null,
        normalizedContact: null,
        allowed: false,
        safeReasonCode: "channel_unavailable",
      },
    ],
  };
  const quote = await buildMarketingBookQuote(input, now);
  assertEquals(quote.reachableCount, 1);
  assertEquals(quote.unavailableCount, 1);
  const safe = publicMarketingBookQuote(quote);
  assert("audienceKind" in safe);
  assertEquals(safe.audienceKind, "brand_followers");
  assertEquals(safe.audienceVersion, 17);
  assertEquals(safe.audienceId, AUDIENCE_ID);
  const publicJson = JSON.stringify(safe);
  assert(!publicJson.includes(USER_ID));
  assert(!publicJson.includes("private-follower@example.test"));
  assert(!publicJson.includes("Private launch"));

  const changed = await buildMarketingBookQuote({
    ...input,
    candidates: input.candidates.map((candidate, index) =>
      index === 0
        ? { ...candidate, normalizedContact: "changed@example.test" }
        : candidate
    ),
  }, now);
  assert(quote.quoteHash !== changed.quoteHash);
});

Deno.test("#1778 Circle RPC failures retain stable public envelopes", () => {
  assertEquals(bookRpcErrorEnvelope("circle_blast_snapshot_stale"), {
    error: "BOOK_BLAST_PREVIEW_STALE",
    status: 409,
  });
  assertEquals(bookRpcErrorEnvelope("circle_blast_flag_disabled"), {
    error: "BOOK_BLAST_FLAG_DISABLED",
    status: 503,
  });
  assertEquals(bookRpcErrorEnvelope("circle_blast_audience_not_found"), {
    error: "BOOK_BLAST_AUDIENCE_NOT_FOUND",
    status: 404,
  });
});

Deno.test("#1778 edge exposes dedicated Circle preview and confirm actions", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assert(source.includes('body.action === "preview_circle_v1"'));
  assert(source.includes('body.action === "confirm_circle_v1"'));
  assert(source.includes('"biz_marketing_circle_quote_candidates_v1"'));
  assert(source.includes('"biz_confirm_marketing_circle_send_v1"'));
});
