import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile("supabase/functions/notify-dispatch/index.ts");

function position(needle: string): number {
  const found = SRC.indexOf(needle);
  assert(found >= 0, `missing production contract: ${needle}`);
  return found;
}

Deno.test("preference lookup failure stops every durable or provider side effect", () => {
  const lookup = position('.from("business_notification_type_preferences")');
  const lookupFailure = position('"business_notification_preference_lookup_failed"');
  const notificationInsert = position('.from("notifications")\n        .insert(insertPayload)');
  const userEmailDispatch = SRC.indexOf("dispatchDurableLegacyEmail", lookupFailure);
  const pushDispatch = position("pushSent = await sendPush(");

  assert(lookup < lookupFailure);
  assert(lookupFailure < notificationInsert);
  assert(userEmailDispatch < 0 || lookupFailure < userEmailDispatch);
  assert(lookupFailure < pushDispatch);
  assertStringIncludes(SRC.slice(lookup, notificationInsert), "retryPending: true");
});

Deno.test("in-app suppression and push veto are independent channel decisions", () => {
  const suppression = position("businessChannels?.in_app === false");
  const insert = position('.from("notifications")\n        .insert(insertPayload)');
  const pushVeto = position("businessChannels?.push === false");
  const coarseVeto = position("pref.push_enabled === false");

  assert(suppression < insert, "suppression timestamp must be part of the durable insert");
  assert(insert < pushVeto, "push OFF must retain the auditable notification row");
  assert(pushVeto < coarseVeto, "legacy coarse preference remains an additional veto");
  assertEquals(
    SRC.slice(suppression - 80, suppression + 180).includes("businessChannels?.push"),
    false,
    "push state must not control inbox suppression",
  );
  assertEquals(
    SRC.slice(pushVeto - 40, pushVeto + 220).includes("businessChannels?.in_app"),
    false,
    "in-app state must not control provider push",
  );
});

Deno.test("only the locked eleven exact Business types enter the new lookup", () => {
  assertStringIncludes(SRC, "if (userId && isBusinessPreferenceType(type))");
  assertStringIncludes(
    SRC,
    "Object.prototype.hasOwnProperty.call(\n    BUSINESS_NOTIFICATION_CHANNEL_DEFAULTS,\n    type,\n  )",
  );
  assertEquals(
    (SRC.match(/^  "business\.[a-z_]+": \{ push:/gm) ?? []).length,
    11,
  );
});
