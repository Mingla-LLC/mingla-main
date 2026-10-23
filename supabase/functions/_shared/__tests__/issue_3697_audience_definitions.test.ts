import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AUTOMATIC_EVENT_AUDIENCE_CODES,
  AUTOMATIC_MARKET_AUDIENCE_CODES,
  buildAudienceDefinition,
} from "../adAudienceDefinitions.ts";

const base = {
  scope: "event" as const,
  market: "NG",
  brandId: "brand-1",
  brandSlug: "night-host",
  eventId: "event-1",
  eventSlug: "friday-live",
  pixelId: "pixel-1",
  eventEndsAt: "2026-11-01T02:00:00Z",
};

Deno.test("#3697 automatic audience catalog covers every contracted event code", () => {
  assertEquals(AUTOMATIC_EVENT_AUDIENCE_CODES, {
    meta: ["M3", "M5", "M6"],
    snapchat: [],
    tiktok: ["T2", "T3", "T4"],
  });
  assertEquals(AUTOMATIC_MARKET_AUDIENCE_CODES, {
    meta: ["M3", "M4", "M5", "M6"],
    snapchat: ["S2", "S3", "S4"],
    tiktok: ["T2", "T3", "T4"],
  });
});

Deno.test("#3697 checkout audiences exclude purchase with matching event id", () => {
  const meta = buildAudienceDefinition({
    ...base,
    platform: "meta",
    code: "M5",
  });
  assertEquals(meta.windowDays, 14);
  assertEquals(meta.rule.inclusions, [
    { event: "InitiateCheckout", content_ids: ["event-1"] },
  ]);
  assertEquals(meta.rule.exclusions, [
    { event: "Purchase", content_ids: ["event-1"] },
  ]);

  const tiktok = buildAudienceDefinition({
    ...base,
    platform: "tiktok",
    code: "T3",
  });
  assertEquals(tiktok.rule.exclusions, [
    { event: "CompletePayment", content_id: "event-1" },
  ]);
});

Deno.test("#3697 event buyer audiences are date-bound", () => {
  for (
    const [platform, code] of [
      ["meta", "M6"],
      ["tiktok", "T4"],
    ] as const
  ) {
    const result = buildAudienceDefinition({ ...base, platform, code });
    assertEquals(result.rule.event_ends_at, base.eventEndsAt);
  }
});

Deno.test("#3697 Snap uses honest market pools and rejects fake event scoping", () => {
  assertThrows(
    () =>
      buildAudienceDefinition({
        ...base,
        platform: "snapchat",
        code: "S3",
      }),
    Error,
    "snap_event_scope_unsupported",
  );
  const snap = buildAudienceDefinition({
    ...base,
    scope: "market",
    brandId: null,
    brandSlug: null,
    eventId: null,
    eventSlug: null,
    platform: "snapchat",
    code: "S3",
  });
  assertEquals(snap.rule.pixel_spec_object, {
    or: { event: [{ eq: "START_CHECKOUT" }] },
  });
});

Deno.test("#3697 code/platform mismatch fails closed", () => {
  assertThrows(
    () =>
      buildAudienceDefinition({ ...base, platform: "snapchat", code: "M3" }),
    Error,
    "mismatch",
  );
});
