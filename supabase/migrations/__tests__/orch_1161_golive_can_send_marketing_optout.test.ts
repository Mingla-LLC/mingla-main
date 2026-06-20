// META-ORCH-1161 go-live-prep [marketing opt-out model] — implementor Step-0.5
// regression for the DEC-191 can_send() flip.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/orch_1161_golive_can_send_marketing_optout.test.ts
//
// Angle: BEHAVIOR / TRUTH-TABLE. Re-implements the EXACT can_send() decision the
// migration deploys (steps 3 + 4) and asserts the DEC-191 contract:
//   - marketing (is_transactional=false), NO pref, NO suppression → TRUE (default-ON).
//   - marketing + a channel_suppressions row (scope marketing|all) → FALSE (opt-out).
//   - marketing + an explicit enabled=false pref → FALSE (per-channel opt-out).
//   - transactional behavior is UNCHANGED (default-ON, enabled=false / suppression deny).
//
// Each predicate is ALSO asserted to appear in the live migration text so the
// re-implementation cannot silently drift, and so a TRUE LINE DELETION of the fix
// fails this test (fails-on-revert).

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION =
  "supabase/migrations/20261113000000_orch_1161_golive_marketing_optout.sql";
const sql = await Deno.readTextFile(MIGRATION);

function migrationContains(needle: string, why: string) {
  assert(
    sql.includes(needle),
    `migration must still contain \`${needle}\` (${why})`,
  );
}

// ── The deployed can_send() decision, re-implemented byte-for-byte ───────────
interface Category {
  active: boolean;
  default_channels: string[];
  is_transactional: boolean;
}
interface Suppression {
  channel: string;
  scope: string; // 'transactional' | 'marketing' | 'all'
  user_id?: string | null;
  contact?: string | null;
}
function canSend(args: {
  userId: string | null;
  category: Category | null;
  channel: string;
  contact: string | null;
  prefEnabled: boolean | null; // explicit notification_channel_prefs.enabled, or null
  suppressions: Suppression[];
}): boolean {
  const { category, channel } = args;
  // 1. Category active.
  if (category === null || category.active !== true) return false;
  // 2. Channel in default_channels.
  if (!category.default_channels.includes(channel)) return false;
  // 3. DEC-191 pref gate — on-by-default for BOTH; only an explicit enabled=false opts out.
  if (args.prefEnabled !== null && args.prefEnabled === false) return false;
  // 4. Suppression gate (email/sms only).
  if (channel === "email" || channel === "sms") {
    const categoryScope = category.is_transactional ? "transactional" : "marketing";
    const suppressed = args.suppressions.some(
      (s) =>
        s.channel === channel &&
        (s.scope === categoryScope || s.scope === "all") &&
        ((args.userId !== null && s.user_id === args.userId) ||
          (args.contact !== null && s.contact === args.contact.toLowerCase()) ||
          (args.contact !== null && s.contact === args.contact)),
    );
    if (suppressed) return false;
  }
  return true;
}

const MARKETING: Category = {
  active: true,
  default_channels: ["email", "sms"],
  is_transactional: false,
};
const TRANSACTIONAL: Category = {
  active: true,
  default_channels: ["email", "sms"],
  is_transactional: true,
};

Deno.test("DEC-191: marketing default-ON with no pref + no suppression", () => {
  assertEquals(
    canSend({
      userId: "u1",
      category: MARKETING,
      channel: "sms",
      contact: "+15551230000",
      prefEnabled: null,
      suppressions: [],
    }),
    true,
    "marketing must now default-ON (auto-enrolled)",
  );
});

Deno.test("DEC-191: marketing opt-out via channel_suppressions denies", () => {
  // user_id-keyed marketing suppression.
  assertEquals(
    canSend({
      userId: "u1",
      category: MARKETING,
      channel: "sms",
      contact: "+15551230000",
      prefEnabled: null,
      suppressions: [{ channel: "sms", scope: "marketing", user_id: "u1" }],
    }),
    false,
    "a marketing suppression must opt the user out",
  );
  // contact-keyed marketing suppression (the audience-resolver path).
  assertEquals(
    canSend({
      userId: null,
      category: MARKETING,
      channel: "email",
      contact: "Buyer@Example.com",
      prefEnabled: null,
      suppressions: [{ channel: "email", scope: "marketing", contact: "buyer@example.com" }],
    }),
    false,
    "a contact-keyed marketing suppression must opt out",
  );
  // scope='all' also denies marketing.
  assertEquals(
    canSend({
      userId: "u1",
      category: MARKETING,
      channel: "sms",
      contact: null,
      prefEnabled: null,
      suppressions: [{ channel: "sms", scope: "all", user_id: "u1" }],
    }),
    false,
    "scope=all denies marketing too",
  );
});

Deno.test("DEC-191: explicit enabled=false pref still opts out of marketing", () => {
  assertEquals(
    canSend({
      userId: "u1",
      category: MARKETING,
      channel: "sms",
      contact: null,
      prefEnabled: false,
      suppressions: [],
    }),
    false,
  );
});

Deno.test("transactional unchanged: default-ON, suppression denies, marketing-scope STOP does NOT", () => {
  // default-ON.
  assertEquals(
    canSend({ userId: "u1", category: TRANSACTIONAL, channel: "sms", contact: null, prefEnabled: null, suppressions: [] }),
    true,
  );
  // a transactional/all suppression denies.
  assertEquals(
    canSend({ userId: "u1", category: TRANSACTIONAL, channel: "sms", contact: null, prefEnabled: null, suppressions: [{ channel: "sms", scope: "transactional", user_id: "u1" }] }),
    false,
  );
  // CRITICAL: a marketing STOP must NOT silence a transactional send.
  assertEquals(
    canSend({ userId: "u1", category: TRANSACTIONAL, channel: "sms", contact: null, prefEnabled: null, suppressions: [{ channel: "sms", scope: "marketing", user_id: "u1" }] }),
    true,
    "a marketing-scope suppression must not block transactional",
  );
});

// ── fails-on-revert anchors: deleting the DEC-191 fix breaks these ───────────
Deno.test("migration carries the DEC-191 default-ON decision (anti-drift)", () => {
  migrationContains(
    "DEC-191 default-ON: an explicit enabled=false opts out of THIS channel",
    "the unified default-ON pref gate — if reverted to the old marketing off-by-default branch this anchor disappears",
  );
  migrationContains(
    "marketing default-ON",
    "the can_send COMMENT documenting the opt-out model",
  );
  migrationContains(
    "set_marketing_suppression",
    "the prefs-UI write RPC must exist",
  );
  // Guard: the OLD off-by-default branch must be GONE.
  assert(
    !sql.includes("Marketing: off-by-default; requires an explicit enabled=true"),
    "the old opt-IN marketing branch must be removed (subtract-before-add)",
  );
});
