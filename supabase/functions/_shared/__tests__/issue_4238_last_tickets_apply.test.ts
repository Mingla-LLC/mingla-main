/**
 * #4238 W4a (5c, D-5): the last-tickets words go live only after the Host
 * accepts, as NEW ads through the apps' review, once per plan per app and
 * once per event; the old ads pause only after the new ones are live.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  applyLastTicketsOffer,
  withLastTicketsText,
} from "../adGoalPromotion.ts";

type Row = Record<string, unknown>;

function fakeDb(row: Row) {
  const updates: Row[] = [];
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      in: () => c,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      update: (patch: Row) => {
        updates.push(patch);
        if (patch.detail) row.detail = patch.detail;
        if (patch.status) row.status = patch.status;
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
      then: (resolve: (value: unknown) => void) =>
        resolve({
          data: table === "ad_sets" ? [{ external_adset_id: "as1" }] : [],
          error: null,
        }),
    };
    return c;
  };
  return { updates, db: { from: chain } };
}

function fakeGraph(newAdStatus: string) {
  const calls: string[] = [];
  const graph = (
    method: string,
    path: string,
    params: Record<string, unknown> = {},
  ) => {
    calls.push(`${method} ${path}`);
    if (method === "GET" && path === "as1/ads") {
      return Promise.resolve({
        data: [
          {
            id: "ad1",
            name: "Ad 1",
            effective_status: "ACTIVE",
            creative: { id: "cr1" },
          },
          {
            id: "ad2",
            name: "Ad 2",
            effective_status: "PAUSED",
            creative: { id: "cr2" },
          },
        ],
      });
    }
    if (method === "GET" && path === "cr1") {
      return Promise.resolve({
        name: "C",
        object_story_spec: {
          page_id: "p",
          video_data: { message: "Old words", video_id: "v" },
        },
      });
    }
    if (method === "POST" && path.endsWith("/adcreatives")) {
      calls.push(
        `creative-text:${
          JSON.stringify((params.object_story_spec as Row).video_data)
        }`,
      );
      return Promise.resolve({ id: "newcr" });
    }
    if (method === "POST" && path.endsWith("/ads")) {
      calls.push(`ad-status:${params.status}`);
      return Promise.resolve({ id: "newad" });
    }
    if (method === "GET" && path === "newad") {
      return Promise.resolve({ effective_status: newAdStatus });
    }
    return Promise.resolve({});
  };
  return { calls, graph };
}

Deno.test("5c: the words swap on every story type and the placement bodies", () => {
  const out = withLastTicketsText({
    object_story_spec: { link_data: { message: "a" } },
    asset_feed_spec: { bodies: [{ text: "a" }, { text: "b" }] },
  }, "Last 18 tickets");
  assertEquals((out.object_story_spec as Row).link_data, {
    message: "Last 18 tickets",
  });
  assertEquals((out.asset_feed_spec as Row).bodies, [{
    text: "Last 18 tickets",
  }]);
});

Deno.test("5c: step 1 adds one new ACTIVE ad per live ad with the last-tickets words; old ads keep running", async () => {
  const row: Row = {
    id: "r1",
    status: "pending",
    detail: { primary: "Last 18 tickets", accepted_at: "x" },
  };
  const { db } = fakeDb(row);
  const { graph, calls } = fakeGraph("PENDING_REVIEW");
  const result = await applyLastTicketsOffer(
    // deno-lint-ignore no-explicit-any
    { db, graph: graph as any, adAccountId: "1" },
    // deno-lint-ignore no-explicit-any
    { row: row as any, campaignId: "c1", nowIso: "2026-11-16T00:00:00Z" },
  );
  assertEquals(result, "created");
  assert(
    calls.includes(
      'creative-text:{"message":"Last 18 tickets","video_id":"v"}',
    ),
  );
  assert(calls.includes("ad-status:ACTIVE"));
  // Only the live ad was copied; nothing was paused yet.
  assertEquals(calls.filter((call) => call === "POST act_1/ads").length, 1);
  assert(!calls.includes("POST ad1"));
  assertEquals((row.detail as Row).new_ad_ids, ["newad"]);
  // Step 2 while the app still reviews: waits, pauses nothing.
  assertEquals(
    // deno-lint-ignore no-explicit-any
    await applyLastTicketsOffer({ db, graph: graph as any, adAccountId: "1" }, {
      row: row as any,
      campaignId: "c1",
      nowIso: "t",
    }),
    "waiting",
  );
});

Deno.test("5c: once the new ad is live the old ad pauses and the offer is applied (once)", async () => {
  const row: Row = {
    id: "r1",
    status: "pending",
    detail: {
      primary: "Last",
      accepted_at: "x",
      new_ad_ids: ["newad"],
      old_ad_ids: ["ad1"],
    },
  };
  const { db } = fakeDb(row);
  const { graph, calls } = fakeGraph("ACTIVE");
  const result = await applyLastTicketsOffer(
    // deno-lint-ignore no-explicit-any
    { db, graph: graph as any, adAccountId: "1" },
    // deno-lint-ignore no-explicit-any
    { row: row as any, campaignId: "c1", nowIso: "t" },
  );
  assertEquals(result, "applied");
  assert(calls.includes("POST ad1"));
  assertEquals(row.status, "applied");
});

Deno.test("5c adversarial: a refused new ad is paused and the old ads are untouched", async () => {
  const row: Row = {
    id: "r1",
    status: "pending",
    detail: {
      primary: "Last",
      accepted_at: "x",
      new_ad_ids: ["newad"],
      old_ad_ids: ["ad1"],
    },
  };
  const { db } = fakeDb(row);
  const { graph, calls } = fakeGraph("DISAPPROVED");
  // deno-lint-ignore no-explicit-any
  const result = await applyLastTicketsOffer({
    db,
    graph: graph as any,
    adAccountId: "1",
  }, { row: row as any, campaignId: "c1", nowIso: "t" });
  assertEquals(result, "failed:new_ad_refused");
  assert(calls.includes("POST newad"));
  assert(!calls.includes("POST ad1"));
});

Deno.test("5c: only an accepted offer is applied, and the Host can accept once per event", async () => {
  const sweep = await Deno.readTextFile(
    new URL("../adGoalPromotion.ts", import.meta.url),
  );
  assert(
    sweep.includes(
      'row?.status === "pending" && typeof row.detail?.accepted_at === "string"',
    ),
  );
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  const start = host.indexOf("async function acceptLastTickets(");
  const body = host.slice(start, host.indexOf("\n}\n", start));
  assert(body.includes('"host_ad_last_tickets_already_used"'));
  assert(
    body.includes('.neq("id", planId)'),
    "sibling plans of the same event are checked",
  );
  assert(host.includes('action === "accept_last_tickets"\n    ? "launch"'));
});
