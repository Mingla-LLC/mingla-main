// Turnout advice cut mid-word — "…allows for realistic plannin".
//
// Found filming the RSVP tutorial (Step 5 turnout card): the top fix read
// "Clarify Venue Capacity · Essential for any turnout; prevents event
// cancellation due to capacity misunderstanding and allows for realistic
// plannin" — exactly 120 characters, the bare `.slice(0, 120)` storage cap on
// `lift_note`. The engine now clips prose on a word boundary with "…".
//
// Fails on revert: restore `asStr(o.lift_note).slice(0, 120)` and the handler
// test gets "…realistic plannin" back (no ellipsis, partial word).
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-events/__tests__/turnout_advice_word_boundary.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  EVENTS_SYNTH_PAYLOAD,
  eventsInput,
  installStub,
  post,
  TOKEN_A,
  twoBrandWorld,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { clipProse, handler } from "../index.ts";

const OBSERVED_FULL =
  "Essential for any turnout; prevents event cancellation due to capacity misunderstanding and allows for realistic planning of staff and supplies.";

Deno.test("clipProse leaves text within the cap untouched (trimmed)", () => {
  assertEquals(clipProse("  Post teasers  ", 90), "Post teasers");
  assertEquals(clipProse("x".repeat(120), 120), "x".repeat(120));
  assertEquals(clipProse(undefined, 120), "");
  assertEquals(clipProse(42, 120), "");
});

Deno.test("clipProse cuts on a word boundary, ends with one ellipsis, never exceeds the cap", () => {
  const out = clipProse(OBSERVED_FULL, 120);
  assert(out.length <= 120, `length ${out.length}`);
  assert(out.endsWith("…"), out);
  assertEquals(out.includes("plannin…"), false);
  const body = out.slice(0, -1);
  // Every word kept is a whole word of the source, in order.
  assert(OBSERVED_FULL.startsWith(body), out);
  assert(/[\s,;:.]/.test(OBSERVED_FULL[body.length]), `cut inside a word: ${out}`);
});

Deno.test("clipProse drops dangling punctuation before the ellipsis", () => {
  assertEquals(clipProse("Move the date, then post teasers daily", 22), "Move the date, then…");
  assertEquals(clipProse("One two. Three four five six", 12), "One two…");
});

Deno.test("clipProse hard-cuts a single unbreakable token rather than emptying it", () => {
  const out = clipProse(`see https://example.com/${"a".repeat(200)}`, 60);
  assertEquals(out.length, 60);
  assert(out.endsWith("…"));
});

Deno.test("events report — an over-long lift_note arrives word-safe with an ellipsis", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: {
      structuredPayload: {
        ...EVENTS_SYNTH_PAYLOAD,
        fixes: [{
          title: "Clarify Venue Capacity",
          why: "Reach",
          change: "Set a guest limit",
          lift_note: OBSERVED_FULL,
          effort: "this_week",
        }],
      },
      groundedPayload: {},
      groundedStatus: 200,
    },
  });
  try {
    const r = await post(handler, {
      action: "run",
      lane: "app",
      brand_id: BRAND_A,
      input: eventsInput(),
    }, TOKEN_A);
    assertEquals(r.status, 200);
    const liftNote = r.body.report.fixes[0].lift_note as string;
    assert(liftNote.length <= 120, `length ${liftNote.length}`);
    assert(liftNote.endsWith("…"), liftNote);
    assertEquals(liftNote.includes("plannin…"), false);
    assertEquals(r.body.report.fixes[0].title, "Clarify Venue Capacity");
  } finally {
    stub.restore();
  }
});
