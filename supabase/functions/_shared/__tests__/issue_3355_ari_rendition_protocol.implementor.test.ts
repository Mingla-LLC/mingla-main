import {
  assert,
  assertEquals,
  assertExists,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS } from "../agentTools.ts";
import {
  ARI_RENDITION_BLOCK_TYPES,
  ARI_RENDITION_LIMITS,
  AriUiCapabilitiesV2,
  buildGenericProposalRendition,
  buildToolReadRendition,
  buildToolReceiptRendition,
  parseAriUiCapabilities,
} from "../ariRendition.ts";

const CAPABILITIES: AriUiCapabilitiesV2 = {
  protocol_version: 2,
  max_schema_version: 2,
  block_version: 1,
  action_version: 1,
  block_types: [...ARI_RENDITION_BLOCK_TYPES],
  graphic_types: ["event", "media", "site", "research", "social"],
  platform: "ios",
  app_version: "1.1.6",
  runtime_version: "1.1.6",
};

Deno.test("#3355 capability negotiation is strict and text-only for old clients", () => {
  assertEquals(parseAriUiCapabilities(CAPABILITIES), CAPABILITIES);
  assertEquals(parseAriUiCapabilities(undefined), null);
  assertEquals(
    parseAriUiCapabilities({ ...CAPABILITIES, max_schema_version: 1 }),
    null,
  );
  assertEquals(
    parseAriUiCapabilities({
      ...CAPABILITIES,
      block_types: CAPABILITIES.block_types.filter((type) =>
        type !== "sources"
      ),
    }),
    null,
  );
  assertEquals(
    buildToolReadRendition({
      toolName: "get_sales_summary",
      result: { total: 12 },
      capabilities: null,
      envValue: "true",
    }),
    null,
  );
  assertEquals(
    buildToolReadRendition({
      toolName: "get_sales_summary",
      result: { total: 12 },
      capabilities: CAPABILITIES,
      envValue: "false",
    }),
    null,
  );
});

Deno.test("#3355 read adapter bounds data, cites HTTPS sources, and removes secrets", () => {
  const rendition = buildToolReadRendition({
    toolName: "inspect_public_social_profile",
    capabilities: CAPABILITIES,
    envValue: "true",
    checkedAt: "2026-10-29T12:00:00.000Z",
    result: {
      profile_id: "11111111-1111-4111-8111-111111111111",
      handle: "@mingla",
      followers: 4200,
      access_token: "must-not-render",
      sources: [
        { title: "Profile", url: "https://social.example/mingla" },
        { title: "Unsafe", url: "http://social.example/insecure" },
      ],
    },
  });
  assertExists(rendition);
  assertEquals(rendition.schema_version, 2);
  assertEquals(rendition.graphic, "social");
  assertEquals(rendition.eyebrow, "Public research");
  const wire = JSON.stringify(rendition);
  assert(wire.includes("@mingla"));
  assert(wire.includes("https://social.example/mingla"));
  assert(wire.includes("Profile"));
  assertFalse(wire.includes("must-not-render"));
  assertFalse(wire.includes("11111111-1111-4111-8111-111111111111"));
  assertFalse(wire.includes("http://social.example/insecure"));
  assert(rendition.blocks.length <= ARI_RENDITION_LIMITS.max_blocks);
});

Deno.test("#3355 workspace results do not expose infrastructure URLs or raw freshness", () => {
  const rendition = buildToolReadRendition({
    toolName: "list_events",
    capabilities: CAPABILITIES,
    envValue: "true",
    checkedAt: "2026-10-30T18:34:16.171Z",
    result: {
      events: [{
        title: "Sunday Rooftop Sessions",
        city: "Lagos",
        cover_url: "https://vz-a16fce08-6c6.b-cdn.net/event-cover.jpg",
        stream_url: "https://stream.usemingla.com/events/123",
      }],
      checked_at: "2026-10-30T18:34:16.171Z",
    },
  });
  assertExists(rendition);
  const wire = JSON.stringify(rendition);
  assertEquals(rendition.title, "Your events");
  assertFalse(wire.includes("sources"));
  assertFalse(wire.includes("b-cdn.net"));
  assertFalse(wire.includes("stream.usemingla.com"));
  assertFalse(wire.includes("2026-10-30T18:34:16.171Z"));
});

Deno.test("#3355 internal tool discovery stays out of user-facing result cards", () => {
  for (const toolName of ["search_capabilities", "request_tools"]) {
    assertEquals(
      buildToolReadRendition({
        toolName,
        result: {
          query: "tag waiters order",
          matches: [{ name: "cancel_order", score: 1 }],
          reason: "Need marketing tools to access propose_ad_plan",
          requested: ["marketing", "listings"],
          available: ["core", "brand", "money", "marketing"],
        },
        capabilities: CAPABILITIES,
        envValue: "true",
      }),
      null,
    );
  }
});

Deno.test("#3355 every registered write tool has a generic safe proposal fallback", () => {
  for (const tool of AGENT_TOOLS) {
    const rendition = buildGenericProposalRendition({
      toolName: tool.name,
      toolArgs: {
        brand_id: "11111111-1111-4111-8111-111111111111",
        title: "Visible scope",
        secret: "must-not-render",
      },
      pendingActionId: "22222222-2222-4222-8222-222222222222",
      capabilities: CAPABILITIES,
      envValue: "true",
    });
    assertExists(rendition, `${tool.name} must have a proposal rendition`);
    const wire = JSON.stringify(rendition);
    assertFalse(
      wire.includes("must-not-render"),
      `${tool.name} leaked a secret`,
    );
    assertFalse(
      wire.includes("11111111-1111-4111-8111-111111111111"),
      `${tool.name} leaked a resource id`,
    );
    assertEquals(rendition.actions?.map((action) => action.id), [
      "confirm",
      "cancel",
    ]);
  }
});

Deno.test("#3355 confirmed tools produce a durable generic receipt", () => {
  const receipt = buildToolReceiptRendition({
    toolName: "publish_event",
    result: { title: "Friday Dinner", status: "published" },
    pendingActionId: "22222222-2222-4222-8222-222222222222",
    capabilities: CAPABILITIES,
    envValue: "true",
    completedAt: "2026-10-29T12:00:00.000Z",
  });
  assertExists(receipt);
  assertEquals(
    receipt.rendition_id,
    "receipt:22222222-2222-4222-8222-222222222222",
  );
  assertEquals(receipt.kind, "receipt");
  assertEquals(receipt.state, "submitted");
  assertEquals(receipt.graphic, "event");
  assert(JSON.stringify(receipt).includes("Friday Dinner"));
  assertFalse(JSON.stringify(receipt.blocks).includes("22222222"));
});

Deno.test("#3355 ticket receipts show canonical price and capacity", () => {
  const receipt = buildToolReceiptRendition({
    toolName: "upsert_ticket_tier",
    result: {
      effective_currency: "NGN",
      tiers: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "General Admission",
        isFree: false,
        isUnlimited: false,
        priceGbp: 20000,
        capacity: 80,
        visibility: "public",
      }],
    },
    pendingActionId: "22222222-2222-4222-8222-222222222222",
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assertExists(receipt);
  const wire = JSON.stringify(receipt.blocks);
  assert(wire.includes('"label":"Price","value":"NGN 20,000"'));
  assert(wire.includes('"label":"Capacity","value":"80"'));
  assert(wire.includes('"label":"Visibility","value":"Public"'));
  assertFalse(wire.includes("11111111-1111-4111-8111-111111111111"));

  const freeReceipt = buildToolReceiptRendition({
    toolName: "upsert_ticket_tier",
    result: {
      tier: {
        name: "Complimentary",
        is_free: true,
        is_unlimited: false,
        quantity_total: 25,
        is_hidden: true,
      },
    },
    pendingActionId: "33333333-3333-4333-8333-333333333333",
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assertExists(freeReceipt);
  const freeWire = JSON.stringify(freeReceipt.blocks);
  assert(freeWire.includes('"label":"Price","value":"Free"'));
  assert(freeWire.includes('"label":"Capacity","value":"25"'));
  assert(freeWire.includes('"label":"Visibility","value":"Hidden"'));
});

Deno.test("#3355 event receipts render proof without database internals", () => {
  const receipt = buildToolReceiptRendition({
    toolName: "create_event",
    result: {
      event: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Autumn Table",
        slug: "draft-85ac85b6d8e84325",
        status: "draft",
        visibility: "draft",
        created_by: "33333333-3333-4333-8333-333333333333",
        created_at: "2026-10-29T18:51:38.201809+00:00",
        theme: {
          business_draft: {
            requestedVisibility: "private",
            when: {
              date: "2026-11-14",
              doorsOpen: "19:00",
              timezone: "America/New_York",
            },
            tickets: [{
              id: "ari-general-admission",
              name: "General admission",
              capacity: 20,
              isFree: true,
            }],
          },
        },
      },
    },
    toolArgs: {
      title: "Autumn Table",
      start_at: "2026-11-15T00:00:00.000Z",
      timezone: "America/New_York",
      visibility: "private",
    },
    brandName: "Lantern Room",
    pendingActionId: "22222222-2222-4222-8222-222222222222",
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assertExists(receipt);
  const wire = JSON.stringify(receipt);
  assert(wire.includes("Autumn Table"));
  assert(wire.includes("Lantern Room"));
  assert(wire.includes("Nov 14, 2026"));
  assert(wire.includes("Draft — not published"));
  assert(wire.includes("20 guests · Free"));
  assert(wire.includes("remaining event details and cover"));
  assertFalse(wire.includes("details, tickets and cover"));
  for (
    const leaked of [
      "draft-85ac85b6d8e84325",
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
      "created_by",
      "created_at",
      "2026-10-29T18:51:38.201809+00:00",
    ]
  ) {
    assertFalse(wire.includes(leaked), `receipt leaked ${leaked}`);
  }
});

Deno.test("#3355 event receipts preserve confirmed admission when the immediate result is empty", () => {
  const receipt = buildToolReceiptRendition({
    toolName: "create_event",
    result: {
      event: {
        title: "Capacity Receipt Proof",
        theme: {
          business_draft: {
            requestedVisibility: "private",
            tickets: [],
          },
        },
      },
    },
    toolArgs: {
      title: "Capacity Receipt Proof",
      tickets: [{
        name: "General admission",
        capacity: 20,
        isFree: true,
      }],
    },
    pendingActionId: "22222222-2222-4222-8222-222222222222",
    capabilities: CAPABILITIES,
    envValue: "true",
  });

  assertExists(receipt);
  const wire = JSON.stringify(receipt);
  assert(wire.includes("20 guests · Free"));
  assert(wire.includes("details and cover"));
  assertFalse(wire.includes("details, tickets and cover"));
});

Deno.test("#3355 event receipt echoes confirmed date range, venue and grounded copy", () => {
  const receipt = buildToolReceiptRendition({
    toolName: "create_event",
    result: {
      event: {
        title: "Seth Is Popping",
        theme: {
          business_draft: {
            requestedVisibility: "private",
            tickets: [{ capacity: 200, isFree: true }],
          },
        },
      },
    },
    toolArgs: {
      title: "Seth Is Popping",
      start_at: "2026-11-15T17:00:00.000Z",
      end_at: "2026-11-15T22:00:00.000Z",
      timezone: "Africa/Lagos",
      location_text: "Harmattan Club in Lagos",
      description:
        "Seth Is Popping takes place at Harmattan Club in Lagos on November 15, 2026, from 6:00 PM to 11:00 PM WAT. Free admission for up to 200 guests.",
      tickets: [{ capacity: 200, isFree: true }],
    },
    brandName: "Harmattan Club",
    pendingActionId: "33333333-3333-4333-8333-333333333333",
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assertExists(receipt);
  const wire = JSON.stringify(receipt);
  assert(wire.includes("Nov 15, 2026, 6:00 PM WAT – 11:00 PM WAT"));
  assert(wire.includes("Harmattan Club in Lagos"));
  assert(wire.includes("Free admission for up to 200 guests"));
  assert(wire.includes("Review the saved details and add a cover"));
});

Deno.test("#3355 real chat and confirmation paths persist negotiated renditions", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const confirmation = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  assert(chat.includes("parseAriUiCapabilities(body.ari_ui)"));
  assert(chat.includes("buildToolReadRendition({"));
  assert(chat.includes("buildGenericProposalRendition({"));
  assert(chat.includes("...(rendition ? { rendition } : {})"));
  assert(confirmation.includes("parseAriUiCapabilities(body.ari_ui)"));
  assert(confirmation.includes("buildToolReceiptRendition({"));
  assert(confirmation.includes('tool.name === "create_event"'));
  assert(confirmation.includes("deterministicEventTaskFinished"));
  assert(confirmation.includes("...(rendition ? { rendition } : {})"));
});
