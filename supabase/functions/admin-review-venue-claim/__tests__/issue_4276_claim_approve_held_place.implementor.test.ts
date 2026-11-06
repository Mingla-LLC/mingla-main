// #4276 — approving a claim on a place the city pipeline holds (serving_hold).
// The hold trigger parks is_servable=true as held_final_check_passed with
// is_servable=false, so the approve must read the row back and say the place is
// held, not live. And a scorer reply that skipped the place (held_old_result) or
// wrote nothing (written=0) is reported as not scored, with the reason.
//
// Run: deno test --allow-all supabase/functions/admin-review-venue-claim/__tests__/issue_4276_claim_approve_held_place.implementor.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  HELD_BY_CITY_PIPELINE_MESSAGE,
  runApproveGoLive,
  scorerReplyUnscoredReason,
} from "../index.ts";

const PPID = "pp-4276-held";

// Passes the real _shared/bouncer.ts bounce().
const PASSING_ROW = {
  id: PPID,
  name: "Lantern & Vine",
  lat: 38.9,
  lng: -77.03,
  types: ["restaurant", "bar"],
  business_status: "OPERATIONAL",
  website: "https://lanternandvine.com",
  opening_hours: { periods: [{ open: { day: 0, time: "1700" } }] },
  photos: [{ name: "g1" }, { name: "g2" }],
  stored_photo_urls: [
    "https://cdn/x1.jpg",
    "https://cdn/x2.jpg",
    "https://cdn/x3.jpg",
    "https://cdn/x4.jpg",
    "https://cdn/x5.jpg",
  ],
  review_count: 120,
  rating: 4.6,
};

// A fake admin client whose place_pool row behaves like the hold trigger: an
// update that sets is_servable=true on a held row leaves is_servable=false and
// records held_final_check_passed=true.
function makeFakeAdmin(opts: {
  serving_hold: boolean;
  scorerReply: (signalId: string) => unknown;
}) {
  const row: Record<string, unknown> = {
    ...PASSING_ROW,
    is_servable: false,
    serving_hold: opts.serving_hold,
    held_final_check_passed: null,
  };
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    let signals = false;
    b.select = () => {
      if (table === "signal_definitions") signals = true;
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      patch = p;
      return b;
    };
    b.eq = () => {
      if (signals) {
        return Promise.resolve({ data: [{ id: "s1" }, { id: "s2" }], error: null });
      }
      if (patch) {
        const p = patch;
        patch = null;
        if (table === "place_pool") {
          Object.assign(row, p);
          if (row.serving_hold === true && "is_servable" in p) {
            row.held_final_check_passed = p.is_servable === true;
            row.is_servable = false;
          }
        }
        return Promise.resolve({ data: null, error: null });
      }
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve({ data: table === "place_pool" ? { ...row } : null, error: null });
    return b;
  };
  const functions = {
    invoke: (_fn: string, args: { body: { signal_id: string } }) =>
      Promise.resolve({ data: opts.scorerReply(args.body.signal_id), error: null }),
  };
  return { client: { from, functions }, row };
}

const SCORED = { success: true, scored_count: 1, written: 1, held_old_result: 0 };

Deno.test("#4276: approving a held place reports it held, not servable", async () => {
  const { client, row } = makeFakeAdmin({ serving_hold: true, scorerReply: () => SCORED });
  const res = await runApproveGoLive(client, PPID, null);
  assertEquals(row.is_servable, false);
  assertEquals(row.held_final_check_passed, true);
  assertEquals(res.servable, false, "a held place must not be reported servable");
  assertEquals(res.held, true);
  assertEquals(res.held_message, HELD_BY_CITY_PIPELINE_MESSAGE);
});

Deno.test("#4276: approving a place that is not held still reports it servable", async () => {
  const { client } = makeFakeAdmin({ serving_hold: false, scorerReply: () => SCORED });
  const res = await runApproveGoLive(client, PPID, null);
  assertEquals(res.servable, true);
  assertEquals(res.held, false);
  assertEquals(res.held_message, null);
  assertEquals(res.scored_signals, ["s1", "s2"]);
  assertEquals(res.unscored_signals, []);
});

Deno.test("#4276: a held_old_result or written=0 reply is reported as not scored, with the reason", async () => {
  const { client } = makeFakeAdmin({
    serving_hold: false,
    scorerReply: (sid) =>
      sid === "s1"
        ? { success: true, scored_count: 0, written: 0, held_old_result: 1 }
        : { success: true, scored_count: 0, ineligible_count: 1, written: 0, held_old_result: 0 },
  });
  const res = await runApproveGoLive(client, PPID, null);
  assertEquals(res.scored_signals, [], "no signal was scored");
  assertEquals(res.unscored_signals.map((u) => u.signal_id), ["s1", "s2"]);
  assert(res.unscored_signals[0].reason.startsWith("held_old_result"));
  assert(res.unscored_signals[1].reason.startsWith("not_written"));
});

Deno.test("#4276: scorerReplyUnscoredReason reads only the fields the scorer sends", () => {
  assertEquals(scorerReplyUnscoredReason(null), null);
  assertEquals(scorerReplyUnscoredReason({ success: true }), null);
  assertEquals(scorerReplyUnscoredReason(SCORED), null);
  assert(scorerReplyUnscoredReason({ written: 0, vetoed_count: 1 })?.includes("vetoed"));
  assert(scorerReplyUnscoredReason({ written: 1, held_old_result: 2 })?.startsWith("held_old_result"));
});
