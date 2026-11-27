// MINGLA-INVARIANT: I-ARI-EVENT-CLAIM-NEEDS-EVENT-READ | issue #4599 | A capability claim about an event survives only with a same-turn get_event_settings read that supports it.
// MINGLA-INVARIANT: I-ARI-NO-UNSUPPORTED-MONEY-FIGURE | issue #4599 | Every money amount or percentage in a reply traces to host text, a tool result, or a shown arithmetic step whose operands trace to those sources.
// MINGLA-INVARIANT: I-ARI-GUEST-DRAFT-NO-UNSTATED-PROMISE | issue #4599 | A guest-facing refund, date, or ticket-validity promise not stated by the host or returned by a read becomes a square-bracket placeholder.

import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyAriTruthClaims } from "../ariClaimCheck.ts";
import { lintAriCopy, softenAriHeadings } from "../agentCopyLint.ts";

const settings = (overrides: Record<string, unknown> = {}) => ({
  tool: "get_event_settings",
  result: {
    event: { id: "e1", title: "Sunday Brunch" },
    refund_policy_set: false,
    tiers: [{
      sells_at_door: false,
      allow_transfers: true,
      payment_plan: null,
    }],
    ...overrides,
  },
});

Deno.test("#4599 V1 requires and obeys the event settings read", () => {
  const unread = verifyAriTruthClaims({
    text: "Cash at the door is supported for this event.",
    ownerTexts: [],
    observations: [],
  });
  assertEquals(
    unread.text,
    "I haven't checked this event's settings for that yet.",
  );
  assertEquals(unread.replacements[0]?.reason, "event_settings_not_read");

  const off = verifyAriTruthClaims({
    text: "Cash at the door is supported for this event.",
    ownerTexts: [],
    observations: [settings()],
  });
  assertEquals(off.text, "This event does not have door sales switched on.");

  const on = verifyAriTruthClaims({
    text: "Cash at the door is supported for this event.",
    ownerTexts: [],
    observations: [settings({ tiers: [{ sells_at_door: true }] })],
  });
  assertEquals(on.text, "Cash at the door is supported for this event.");

  const transfers = verifyAriTruthClaims({
    text: "Transfers are available for this event.",
    ownerTexts: [],
    observations: [settings()],
  });
  assertEquals(transfers.text, "Transfers are not available yet.");
});

Deno.test("#4599 V2 keeps sourced and shown arithmetic, removes invented money and turnout", () => {
  const kept = verifyAriTruthClaims({
    text: "You said 15% off ₦35,000 = ₦29,750 paid value.",
    ownerTexts: ["Give the group 15% off the ₦35,000 price"],
    observations: [],
  });
  assertMatch(kept.text, /₦29,750/);
  assertEquals(kept.replacements, []);
  const multiStep = verifyAriTruthClaims({
    text:
      "31 × NGN 18,000 = NGN 558,000; 10 × NGN 15,000 = NGN 150,000; NGN 558,000 + NGN 150,000 = NGN 708,000.",
    ownerTexts: ["31 tickets at NGN 18,000 and 10 tickets at NGN 15,000"],
    observations: [],
  });
  assertMatch(multiStep.text, /NGN 708,000/);
  assertEquals(multiStep.replacements, []);
  const profitCases = verifyAriTruthClaims({
    text:
      "NGN 1,110,000 - (NGN 310,000 + NGN 180,000 + NGN 250,000) = NGN 370,000; NGN 1,110,000 - (NGN 310,000 + NGN 180,000 + NGN 250,000 + NGN 120,000) = NGN 250,000.",
    ownerTexts: [
      "Gross NGN 1,110,000; ads NGN 310,000; DJs NGN 180,000; food NGN 250,000; staff NGN 120,000.",
    ],
    observations: [],
  });
  assertMatch(profitCases.text, /NGN 370,000/);
  assertMatch(profitCases.text, /NGN 250,000/);
  assertEquals(profitCases.replacements, []);

  for (const text of ["The cash price is ₦12,000.", "Turnout was 87%."]) {
    const removed = verifyAriTruthClaims({
      text,
      ownerTexts: [],
      observations: [],
    });
    assertEquals(
      removed.text,
      "I don't have a confirmed figure for that, so I've left it out.",
    );
  }
  const countAndDate = verifyAriTruthClaims({
    text: "There are 18 places and the date is 20 Dec.",
    ownerTexts: [],
    observations: [],
  });
  assertEquals(
    countAndDate.text,
    "There are 18 places and the date is 20 Dec.",
  );

  const completedDiscount = verifyAriTruthClaims({
    text: "The group does not fit yet.",
    ownerTexts: [
      "A 15% discount is proposed, not approved, from NGN 35,000.",
    ],
    observations: [],
  });
  assertMatch(completedDiscount.text, /NGN 35,000.*15%.*NGN 29,750/);
  assertMatch(completedDiscount.text, /proposed, not approved/i);
});

Deno.test("#4599 V3 and V4 remove legal advice and unstated guest promises", () => {
  const legal = verifyAriTruthClaims({
    text: "Guests are legally entitled to a refund.",
    ownerTexts: [],
    observations: [],
  });
  assertMatch(legal.text, /I can't advise on legal rights/);
  const harmless = verifyAriTruthClaims({
    text: "The legal team can review the wording.",
    ownerTexts: [],
    observations: [],
  });
  assertEquals(harmless.replacements, []);

  const draft = verifyAriTruthClaims({
    text:
      "Draft message to guests: Your tickets remain valid. The event is postponed to a new date. You will receive a refund.",
    ownerTexts: [],
    observations: [],
  });
  assertMatch(draft.text, /\[decide: ticket validity\]/);
  assertMatch(draft.text, /\[new date once confirmed\]/);
  assertMatch(draft.text, /\[decide: refund\]/);
  assertNotMatch(draft.text, /remain valid|will receive a refund/i);

  const explicitlyUndecided = verifyAriTruthClaims({
    text:
      "Draft guest update: Your tickets remain valid. We will refund you. The replacement date is 20 December.",
    ownerTexts: [
      "Refund timing, ticket validity and any replacement date are undecided.",
    ],
    observations: [],
  });
  assertMatch(explicitlyUndecided.text, /\[decide: ticket validity\]/);
  assertMatch(explicitlyUndecided.text, /\[decide: refund\]/);
  assertMatch(explicitlyUndecided.text, /\[new date once confirmed\]/);

  const omittedDecisions = verifyAriTruthClaims({
    text: "Draft guest update: We are reviewing next steps.",
    ownerTexts: [
      "Refund timing, ticket validity and any replacement date are undecided.",
    ],
    observations: [],
  });
  assertMatch(omittedDecisions.text, /\[decide: ticket validity\]/);
  assertMatch(omittedDecisions.text, /\[decide: refund\]/);
  assertMatch(omittedDecisions.text, /\[new date once confirmed\]/);
});

Deno.test("#4599 V5 requires a receipt before saying the team was contacted", () => {
  const falseClaim = verifyAriTruthClaims({
    text: "I already asked the Mingla team.",
    ownerTexts: [],
    observations: [],
  });
  assertMatch(falseClaim.text, /I haven't contacted the Mingla team/);
  const backed = verifyAriTruthClaims({
    text: "I asked the Mingla team.",
    ownerTexts: [],
    observations: [{
      tool: "tell_owner_in_brand_group",
      result: { sent: true },
    }],
  });
  assertEquals(backed.text, "I asked the Mingla team.");
});

Deno.test("#4599 restores host-stated trip distinctions and blocks unsupported ad advice", () => {
  const trip = verifyAriTruthClaims({
    text: "Draft: Breakfast is included. Questions follow.",
    ownerTexts: [
      "Eight rooms are only on hold; there are 11 DMs but three paid bookings in Mingla; someone sent NGN 50,000 but I do not know who or what it reserves.",
    ],
    observations: [],
  });
  assertMatch(trip.text, /8 rooms are on hold, not guaranteed/i);
  assertMatch(trip.text, /11 DMs are inquiries, not bookings/i);
  assertMatch(trip.text, /Who sent NGN 50,000/i);

  const ads = verifyAriTruthClaims({
    text: "Increase ad spend for the next event.",
    ownerTexts: ["We have no ad-attribution report."],
    observations: [],
  });
  assertEquals(
    ads.text,
    "I can't recommend increasing ad spend without an ad-attribution report.",
  );
});

Deno.test("#4599 compound truth turns use the narrow read lane", () => {
  const source = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(source, /function ariTruthReadLane/);
  assertMatch(source, /selectedTools = turnTools\.filter/);
  assertMatch(
    source,
    /standaloneResearchRequest = !websiteWorkspace && !truthReadLane/,
  );
  assertMatch(
    source,
    /launchPlanRequest && launchPlanNeedsPublicResearch\(semanticMessage\)/,
  );
  assertMatch(source, /publicLoopText = softenAriHeadings/);
  assertMatch(source, /TRUTH TURN RESPONSE/);
  assertMatch(source, /event_performance/);
});

Deno.test("#4599 plain truth replies do not fail on a model separator", () => {
  const softened = softenAriHeadings(
    "**Confirmed**\nOne active scanner.\n***\n**Pending**\nOne invite.",
  );
  assertNotMatch(softened, /^\*\*\*$/m);
  assertEquals(lintAriCopy(softened).ok, true);
});
