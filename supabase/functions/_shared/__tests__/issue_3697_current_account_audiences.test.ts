import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  audienceProviderFact,
  buildAudienceProviderRequest,
} from "../adAudienceProvider.ts";
import { audienceSyncSeedsForEvent } from "../adAudienceSyncPlan.ts";

const base = {
  market: "NG",
  brandId: "10000000-0000-4000-8000-000000000001",
  brandSlug: "room-27",
  eventId: "20000000-0000-4000-8000-000000000002",
  eventSlug: "friday-night",
  pageType: "event" as const,
  pixelId: "pixel-1",
  eventEndsAt: "2026-12-24T23:59:00Z",
};

Deno.test("#3697 @usemingla audience plan creates precise and shared fallbacks without account fan-out", () => {
  const meta = audienceSyncSeedsForEvent({ ...base, platform: "meta" });
  assert(meta.some((row) => row.code === "M3" && row.scope === "event"));
  assert(meta.some((row) => row.code === "M3" && row.scope === "brand"));
  assert(meta.some((row) => row.code === "M3" && row.scope === "market"));
  assert(meta.every((row) => !("connectionId" in row)));

  const snap = audienceSyncSeedsForEvent({ ...base, platform: "snapchat" });
  assertEquals(
    snap.map((row) => [row.code, row.scope]),
    [["S2", "market"], ["S3", "market"], ["S4", "market"]],
  );
  assert(snap.every((row) => row.eventId === null && row.brandId === null));

  const tiktok = audienceSyncSeedsForEvent({ ...base, platform: "tiktok" });
  assert(tiktok.some((row) => row.code === "T3" && row.scope === "event"));
  assert(tiktok.some((row) => row.code === "T3" && row.scope === "market"));
});

Deno.test("#3697 Snap market fallbacks use documented event-only predicates", () => {
  const snap = audienceSyncSeedsForEvent({ ...base, platform: "snapchat" });
  for (const seed of snap) {
    const request = buildAudienceProviderRequest({
      platform: "snapchat",
      accountId: "30000000-0000-4000-8000-000000000003",
      name: seed.definition.name,
      definition: seed.definition,
    });
    const json = JSON.stringify(request.body);
    assert(!json.includes("item_ids"));
    assert(!json.includes(base.eventId));
    assertEquals(
      request.path,
      "adaccounts/30000000-0000-4000-8000-000000000003/segments",
    );
  }
});

Deno.test("#3697 provider audience facts normalize id, size and readiness", () => {
  assertEquals(
    audienceProviderFact("meta", {
      id: "meta-1",
      approximate_count_lower_bound: 1200,
      approximate_count_upper_bound: 1800,
      operation_status: { code: 200 },
    }),
    { platformAudienceId: "meta-1", approxSize: 1500, providerReady: true },
  );
  assertEquals(
    audienceProviderFact("snapchat", {
      segments: [{
        segment: {
          id: "snap-1",
          approximate_number_users: 900,
          status: "READY",
        },
      }],
    }),
    { platformAudienceId: "snap-1", approxSize: 900, providerReady: true },
  );
  assertEquals(
    audienceProviderFact("tiktok", {
      data: {
        list: [{
          custom_audience_id: "tt-1",
          audience_size: "1001",
          audience_status: "AVAILABLE",
        }],
      },
    }),
    { platformAudienceId: "tt-1", approxSize: 1001, providerReady: true },
  );
});
