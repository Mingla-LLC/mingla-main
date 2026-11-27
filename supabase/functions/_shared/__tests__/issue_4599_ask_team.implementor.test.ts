// MINGLA-INVARIANT: I-ARI-NO-UNTAKEN-ACTION-CLAIM | issue #4599 | No server-added or model text says the team or support was contacted without a receipt in the chat.
// MINGLA-INVARIANT: I-ARI-FRUSTRATION-IGNORES-NEUTRAL-WORDS | issue #4599 | The lone words "again" and "still" do not log frustration; the strong phrase "still not working" still does.

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_ESCALATION_FAILURE_TYPES,
  ASK_TEAM_ALREADY_SENT,
  classifyAriReplyGaps,
  detectAriFrustration,
} from "../ariGaps.ts";

Deno.test("#4599 unconfirmed is logged, carries the host question, and is not an escalation failure", () => {
  const gaps = classifyAriReplyGaps({
    replyText:
      "I couldn't confirm whether refunds are on. Open a support request.",
    ownerText: "Can guests get refunds for Sunday Brunch?",
    hasRendition: false,
  });
  assertEquals(gaps.map((gap) => gap.type), ["unconfirmed"]);
  assertEquals(gaps[0]?.excerpt, "Can guests get refunds for Sunday Brunch?");
  assert(!ARI_ESCALATION_FAILURE_TYPES.has("unconfirmed"));
});

Deno.test("#4599 neutral words do not manufacture frustration", () => {
  assertEquals(detectAriFrustration("again").frustrated, false);
  assertEquals(detectAriFrustration("still").frustrated, false);
  assertEquals(detectAriFrustration("why seriously??").strong, true);
  assertEquals(detectAriFrustration("still not working").strong, true);
});

Deno.test("#4599 the recent-note refusal is truthful and agent-chat appends no note", () => {
  assertEquals(
    ASK_TEAM_ALREADY_SENT,
    "A note to the Mingla team already went from this chat in the last hour; they'll reply in your brand group chat.",
  );
  const source = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertNotMatch(source, /singleCallEscalationNote|let escalationNote/);
  assertNotMatch(source, /I've already asked the Mingla team/);
  assertMatch(source, /loopUnconfirmed/);
  assertMatch(source, /singleCallUnconfirmed/);
  assertNotMatch(
    source,
    /\(escalation\.escalate \|\| loopUnconfirmed\)/,
  );
  assertNotMatch(
    source,
    /\(escalation\.escalate \|\| singleCallUnconfirmed\)/,
  );
});
