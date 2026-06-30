// ORCH-1245 regression tests for the PURE/decidable parts of the reviewer seed.
// End-to-end DB seeding is live-fire verified post-deploy; here we lock the
// logic that can break silently: idempotency decision, canonical pairing UUID
// ordering, demo-friend email convention, and the message/card data builders
// (shape + NOT-NULL columns + sender alternation).

import {
  DEMO_FRIENDS,
  REVIEWER_PROFILE,
  orderPair,
  shouldSkipSeed,
  buildMessages,
  buildSavedCards,
} from "./seedReviewerAccount.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

// ── Idempotency decision ──────────────────────────────────────────────────────
Deno.test("shouldSkipSeed: skips when a pairing already exists", () => {
  assert(shouldSkipSeed(true, false) === true, "pairing present → skip");
});
Deno.test("shouldSkipSeed: skips when a session already exists", () => {
  assert(shouldSkipSeed(false, true) === true, "session present → skip");
});
Deno.test("shouldSkipSeed: seeds a fresh account (neither present)", () => {
  assert(shouldSkipSeed(false, false) === false, "fresh account → seed");
});

// ── Canonical pairing UUID ordering (pairings_ordered CHECK: a < b) ───────────
Deno.test("orderPair: always returns user_a_id < user_b_id regardless of input order", () => {
  const lo = "00000000-0000-0000-0000-000000000001";
  const hi = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  const forward = orderPair(lo, hi);
  assert(forward.user_a_id === lo && forward.user_b_id === hi, "forward order preserved");
  assert(forward.user_a_id < forward.user_b_id, "forward satisfies a<b");

  const reversed = orderPair(hi, lo);
  assert(reversed.user_a_id === lo && reversed.user_b_id === hi, "reversed order corrected");
  assert(reversed.user_a_id < reversed.user_b_id, "reversed satisfies a<b");
});

Deno.test("orderPair: realistic mixed-case-ish UUIDs always satisfy the CHECK", () => {
  const pairs: [string, string][] = [
    ["a1b2c3d4-0000-0000-0000-000000000000", "0fffffff-0000-0000-0000-000000000000"],
    ["7e000000-0000-0000-0000-000000000000", "7e000000-0000-0000-0000-000000000001"],
    ["deadbeef-0000-0000-0000-000000000000", "00000000-0000-0000-0000-00000000beef"],
  ];
  for (const [a, b] of pairs) {
    const o = orderPair(a, b);
    assert(o.user_a_id < o.user_b_id, `ordered for ${a}/${b}`);
    // The pair is one of the two inputs (no mutation).
    assert(
      (o.user_a_id === a || o.user_a_id === b) && (o.user_b_id === a || o.user_b_id === b),
      "outputs are the inputs",
    );
  }
});

// ── Demo-friend email convention ──────────────────────────────────────────────
Deno.test("demo friends use the stable internal email convention", () => {
  assert(DEMO_FRIENDS.length === 3, "exactly 3 demo friends");
  DEMO_FRIENDS.forEach((f, i) => {
    assert(f.email === `demo-friend-${i + 1}@review.mingla.internal`, `email ${i + 1} stable`);
    assert(f.display_name.length > 0, "has display_name");
    assert(f.username.length > 0, "has username");
    assert(f.avatar_url.startsWith("https://"), "avatar is https");
  });
  // Emails are unique.
  const emails = new Set(DEMO_FRIENDS.map((f) => f.email));
  assert(emails.size === 3, "emails unique");
  // Reviewer profile is polished too.
  assert(REVIEWER_PROFILE.display_name.length > 0, "reviewer has display_name");
});

// ── Message builder: shape, NOT-NULL columns, sender alternation ──────────────
Deno.test("buildMessages: every row has NOT-NULL columns + valid message_type", () => {
  const reviewer = "rev-id";
  const friends = ["f1", "f2", "f3"];
  const rows = buildMessages("conv-1", reviewer, friends, 1_000_000_000_000);

  assert(rows.length >= 4 && rows.length <= 5, "4-5 messages");
  for (const r of rows) {
    assert(r.conversation_id === "conv-1", "conversation_id set (NOT NULL)");
    assert(typeof r.content === "string" && r.content.length > 0, "content non-empty (NOT NULL)");
    assert(r.message_type === "text", "message_type CHECK-valid");
    assert(typeof r.sender_id === "string" && r.sender_id.length > 0, "sender_id set");
    assert(!Number.isNaN(Date.parse(r.created_at)), "created_at is ISO");
  }
});

Deno.test("buildMessages: senders alternate (not all from one person) and include reviewer + friends", () => {
  const reviewer = "rev-id";
  const friends = ["f1", "f2", "f3"];
  const rows = buildMessages("conv-1", reviewer, friends);

  const senders = rows.map((r) => r.sender_id);
  const distinct = new Set(senders);
  assert(distinct.size >= 2, "more than one sender (alternation)");
  assert(senders.includes(reviewer), "reviewer speaks");
  assert(friends.some((f) => senders.includes(f)), "at least one friend speaks");
  // No two consecutive identical senders would feel robotic — verify alternation
  // happens at least once (some adjacent pair differs).
  let alternates = false;
  for (let i = 1; i < senders.length; i++) {
    if (senders[i] !== senders[i - 1]) alternates = true;
  }
  assert(alternates, "consecutive senders differ at least once");
});

Deno.test("buildMessages: created_at is strictly increasing (staggered)", () => {
  const rows = buildMessages("c", "r", ["f1", "f2", "f3"], 2_000_000_000_000);
  for (let i = 1; i < rows.length; i++) {
    assert(
      Date.parse(rows[i].created_at) > Date.parse(rows[i - 1].created_at),
      "timestamps strictly increasing",
    );
  }
});

// ── Saved-card builder: NOT-NULL columns + renderable card_data ───────────────
Deno.test("buildSavedCards: 2-3 rows with all NOT-NULL columns present", () => {
  const cards = buildSavedCards("rev-id");
  assert(cards.length >= 2 && cards.length <= 3, "2-3 cards");
  const ids = new Set<string>();
  for (const c of cards) {
    assert(c.profile_id === "rev-id", "profile_id = reviewer (NOT NULL)");
    assert(typeof c.experience_id === "string" && c.experience_id.length > 0, "experience_id (NOT NULL)");
    assert(!!c.card_data && typeof c.card_data === "object", "card_data present (NOT NULL)");
    // card_data must carry the fields the consumer UI rehydrates from.
    const cd = c.card_data as Record<string, unknown>;
    assert(typeof cd.id === "string", "card_data.id");
    assert(typeof cd.title === "string", "card_data.title");
    assert(typeof cd.image === "string", "card_data.image");
    ids.add(c.experience_id);
  }
  assert(ids.size === cards.length, "experience_ids unique (no upsert self-collision)");
});
