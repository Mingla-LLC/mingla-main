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
    toolName: "research_social_profile",
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
  const wire = JSON.stringify(rendition);
  assert(wire.includes("@mingla"));
  assert(wire.includes("https://social.example/mingla"));
  assertFalse(wire.includes("must-not-render"));
  assertFalse(wire.includes("11111111-1111-4111-8111-111111111111"));
  assertFalse(wire.includes("http://social.example/insecure"));
  assert(rendition.blocks.length <= ARI_RENDITION_LIMITS.max_blocks);
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
  assert(confirmation.includes("...(rendition ? { rendition } : {})"));
});
