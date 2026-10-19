// MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-WEEKLY-DRIFT | issue #3720 | The existing server-owned Avengers sync path posts one idempotent weekly drift note from current truth status and pinned source blobs.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFeatureGuideDriftNote,
  type FeatureGuideDriftRow,
  featureGuideWeekStart,
  parsePinnedFeatureSource,
  pinnedFeatureSources,
} from "../_shared/featureGuideDrift.ts";
import { ProductAvengersClient } from "../_shared/productAvengers.ts";

const commit = "24d6c918c3e834751abb8884d39587073b9964fc";
const rows: FeatureGuideDriftRow[] = [
  {
    capability_key: "host-payouts",
    title: "Host payouts",
    effective_status: "Needs review",
    verification_due_at: "2026-10-30T00:00:00Z",
    pinned_source_urls: [
      `https://github.com/Mingla-LLC/mingla-main/blob/${commit}/mingla-business/src/services/payouts.ts`,
    ],
  },
  {
    capability_key: "waiting-room",
    title: "Waiting room",
    effective_status: "Live",
    verification_due_at: "2027-01-01T00:00:00Z",
    pinned_source_urls: [
      `https://github.com/Mingla-LLC/mingla-main/blob/${commit}/supabase/functions/waiting-room/index.ts`,
    ],
  },
];

Deno.test("#3720 weekly drift note names due, Needs review and changed-source entries", () => {
  assertEquals(
    featureGuideWeekStart(new Date("2026-10-19T13:00:00Z")),
    "2026-10-19",
  );
  assertEquals(
    featureGuideWeekStart(new Date("2026-10-25T23:59:59Z")),
    "2026-10-19",
  );
  const sources = pinnedFeatureSources(rows);
  assertEquals(sources.length, 2);
  assertEquals(
    parsePinnedFeatureSource("bad", "Bad", "https://example.com/source"),
    null,
  );
  const note = buildFeatureGuideDriftNote({
    weekStart: "2026-10-19",
    generatedAt: new Date("2026-10-19T13:00:00Z"),
    entries: rows,
    changedSources: [sources[1]],
  });
  assertStringIncludes(note, "<!-- feature-guide-drift:2026-10-19 -->");
  assertStringIncludes(note, "Review due within 14 days (1)");
  assertStringIncludes(note, "Needs review now (1)");
  assertStringIncludes(note, "Pinned source changed on main (1)");
  assertStringIncludes(note, "`host-payouts` — Host payouts — due 2026-10-30");
  assertStringIncludes(
    note,
    "`waiting-room` — Waiting room — `supabase/functions/waiting-room/index.ts` changed",
  );
});

Deno.test("#3720 pinned-source comparison uses repository blob identities", async () => {
  const responses = [
    {
      truncated: false,
      tree: [
        {
          type: "blob",
          path: "mingla-business/src/services/payouts.ts",
          sha: "same",
        },
        {
          type: "blob",
          path: "supabase/functions/waiting-room/index.ts",
          sha: "new",
        },
      ],
    },
    {
      truncated: false,
      tree: [
        {
          type: "blob",
          path: "mingla-business/src/services/payouts.ts",
          sha: "same",
        },
        {
          type: "blob",
          path: "supabase/functions/waiting-room/index.ts",
          sha: "old",
        },
      ],
    },
  ];
  const calls: string[] = [];
  const client = new ProductAvengersClient("test-token", async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const changed = await client.changedPinnedSources(pinnedFeatureSources(rows));
  assertEquals(changed.map((source) => source.capabilityKey), ["waiting-room"]);
  assertEquals(calls.length, 2);
  assertStringIncludes(calls[0], "/git/trees/main?recursive=1");
  assertStringIncludes(calls[1], `/git/trees/${commit}?recursive=1`);
});

Deno.test("#3720 weekly comment is idempotent when its durable marker already exists", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = new ProductAvengersClient(
    "test-token",
    async (input, init) => {
      calls.push({ url: String(input), method: String(init?.method ?? "GET") });
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              issue: {
                comments: {
                  nodes: [{
                    databaseId: 6260,
                    body: "<!-- feature-guide-drift:2026-10-19 -->",
                  }],
                },
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  assertEquals(
    await client.ensureIssueComment(
      3720,
      "feature-guide-drift:2026-10-19",
      "new body",
    ),
    "6260",
  );
  assertEquals(calls, [{
    url: "https://api.github.com/graphql",
    method: "POST",
  }]);
});
