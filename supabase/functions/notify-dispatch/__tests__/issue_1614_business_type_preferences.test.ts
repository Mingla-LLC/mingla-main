import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile(
  "supabase/functions/notify-dispatch/index.ts",
);

const TYPES = [
  "order_paid",
  "event_sold_out",
  "low_inventory",
  "refund_processed",
  "dispute_opened",
  "dispute_action_needed",
  "payout_paid",
  "account_status_changed",
  "new_review",
  "claim_decision",
  "team_member_joined",
];

Deno.test("all eleven Business types have independent locked channel defaults", () => {
  for (const leaf of TYPES) {
    const expectedPush = leaf === "team_member_joined" ? "false" : "true";
    assertStringIncludes(
      SRC,
      `"business.${leaf}": { push: ${expectedPush}, in_app: true }`,
    );
  }
  assertEquals((SRC.match(/"business\.[a-z_]+": \{ push:/g) ?? []).length, 11);
});

Deno.test("lookup fails closed before durable insert and redacts the structured event", () => {
  const lookup = SRC.indexOf('.from("business_notification_type_preferences")');
  const insert = SRC.indexOf(
    '.from("notifications")\n        .insert(insertPayload)',
  );
  assert(
    lookup > 0 && insert > lookup,
    "Business preference lookup must precede insert",
  );
  assertStringIncludes(
    SRC,
    'event: "business_notification_preference_lookup_failed"',
  );
  assertStringIncludes(SRC, 'reason: "business_preference_lookup_failed"');
  assertStringIncludes(SRC, "retryPending: true");
  const logBlock = SRC.slice(
    SRC.indexOf("console.error({", lookup),
    SRC.indexOf("});", SRC.indexOf("console.error({", lookup)) + 3,
  );
  assert(
    !/userId|payload|data|title|body/.test(logBlock),
    "structured lookup log leaked PII/payload",
  );
});

Deno.test("push and in-app gates remain independent and coarse push stays dominant", () => {
  assertStringIncludes(SRC, "businessChannels?.in_app === false");
  assertStringIncludes(SRC, "businessChannels?.push === false");
  assertStringIncludes(SRC, 'reason: "user_disabled_type"');
  assertStringIncludes(SRC, "pref.push_enabled === false");
  assertStringIncludes(SRC, "pref[prefKey] === false");
  assert(
    SRC.indexOf("businessChannels?.push === false") <
      SRC.indexOf("pref.push_enabled === false"),
    "per-type push gate must compose before the preserved coarse veto",
  );
});
