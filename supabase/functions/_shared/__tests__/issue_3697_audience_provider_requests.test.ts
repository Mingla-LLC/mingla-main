import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildAudienceDefinition } from "../adAudienceDefinitions.ts";
import {
  assertHashedBuyerWire,
  buildAudienceProviderRequest,
  buildHashedBuyerBatch,
} from "../adAudienceProvider.ts";

const base = {
  scope: "event" as const,
  market: "NG",
  brandId: "10000000-0000-4000-8000-000000000001",
  brandSlug: "room-27",
  eventId: "20000000-0000-4000-8000-000000000002",
  eventSlug: "friday-night",
  pixelId: "pixel-1",
  eventEndsAt: "2026-12-24T23:59:00Z",
};

Deno.test("#3697 Meta request scopes the event and excludes its buyers", () => {
  const definition = buildAudienceDefinition({
    ...base,
    platform: "meta",
    code: "M5",
  });
  const request = buildAudienceProviderRequest({
    platform: "meta",
    accountId: "act_123",
    name: definition.name,
    definition,
  });
  assertEquals(request.path, "act_123/customaudiences");
  assertEquals(request.body?.subtype, "WEBSITE");
  const rule = JSON.parse(String(request.body?.rule));
  assertEquals(
    rule.inclusions.rules[0].filter.filters,
    [
      { field: "event", operator: "eq", value: "InitiateCheckout" },
      {
        field: "content_ids",
        operator: "i_contains",
        value: [base.eventId],
      },
    ],
  );
  assertEquals(
    rule.exclusions.rules[0].filter.filters[0],
    { field: "event", operator: "eq", value: "Purchase" },
  );
});

Deno.test("#3697 TikTok rule request keeps event content identity parity", () => {
  const definition = buildAudienceDefinition({
    ...base,
    platform: "tiktok",
    code: "T3",
  });
  const request = buildAudienceProviderRequest({
    platform: "tiktok",
    accountId: "777",
    name: definition.name,
    definition,
  });
  assertEquals(request.path, "dmp/custom_audience/rule/create/");
  assertEquals(request.body?.audience_type, "WEBSITE");
  const rule = request.body?.rule_spec as Record<string, unknown>;
  const include = rule.inclusion_rule_set as Record<string, unknown>;
  assertEquals(
    (include.rules as Record<string, unknown>[])[0].filter_set,
    {
      operator: "AND",
      filters: [
        { field: "EVENT", operator: "EQ", value: "InitiateCheckout" },
        { field: "CONTENT_ID", operator: "EQ", value: base.eventId },
      ],
    },
  );
});

Deno.test("#3697 undocumented Snap item/content scoping fails closed", () => {
  for (const code of ["S2", "S3", "S4"]) {
    assertThrows(
      () =>
        buildAudienceDefinition({
          ...base,
          platform: "snapchat",
          code,
        }),
      Error,
      "snap_event_scope_unsupported",
    );
  }
});

Deno.test("#3697 Snap market pool uses documented website-event rules", () => {
  const definition = buildAudienceDefinition({
    ...base,
    scope: "market",
    brandId: null,
    brandSlug: null,
    eventId: null,
    eventSlug: null,
    platform: "snapchat",
    code: "S3",
  });
  const request = buildAudienceProviderRequest({
    platform: "snapchat",
    accountId: "30000000-0000-4000-8000-000000000003",
    name: definition.name,
    definition,
  });
  assertEquals(
    request.path,
    "adaccounts/30000000-0000-4000-8000-000000000003/segments",
  );
  const segment = (request.body?.segments as Record<string, unknown>[])[0];
  assertEquals(segment.source_type, "PIXEL");
  assertEquals(segment.pixel_spec_object, {
    or: { event: [{ eq: "START_CHECKOUT" }] },
  });
});

Deno.test("#3697 buyer-list sync is flag-off and hash-only", () => {
  assertThrows(
    () => buildHashedBuyerBatch(false, []),
    Error,
    "buyer_list_sync_disabled",
  );
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const batch = buildHashedBuyerBatch(true, [
    { email_sha256: hashA, phone_sha256: hashB },
    { email_sha256: hashA },
    { email_sha256: "buyer@example.com", phone_sha256: "+15551234567" },
    { email_sha256: "c".repeat(64), tracking_opt_out: true },
  ]);
  assertEquals(batch, { emailSha256: [hashA], phoneSha256: [hashB] });
  assertHashedBuyerWire({
    users: [
      ...batch.emailSha256.map((value) => `sha256:${value}`),
      ...batch.phoneSha256.map((value) => `sha256:${value}`),
    ],
  });
  assertThrows(
    () => assertHashedBuyerWire({ users: ["buyer@example.com"] }),
    Error,
    "buyer_list_contains_unhashed_identifier",
  );
});
