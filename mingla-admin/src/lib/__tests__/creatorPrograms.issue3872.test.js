// Issue #3872 — the Programs pages' words and number rules. No raw keys,
// codes, provider names or minor units reach a screen.
import assert from "node:assert/strict";
import test from "node:test";
import {
  checksProgress,
  contractStateWord,
  creatorColumnFor,
  decisionNoteError,
  decisionsFor,
  deliverablesSummary,
  flagLines,
  gigEventWord,
  minorToWhole,
  moneyStateWord,
  payUpToWord,
  payeeKindWord,
  payeeStatusWord,
  programErrorMessage,
  railWord,
  refundPercentToBps,
  wholeToMinor,
} from "../creatorPrograms.js";

test("creators sit in the four approved columns", () => {
  assert.equal(creatorColumnFor("incomplete"), "setting_up");
  assert.equal(creatorColumnFor("needs_more"), "setting_up");
  assert.equal(creatorColumnFor("review"), "needs_person");
  assert.equal(creatorColumnFor("verified"), "verified");
  assert.equal(creatorColumnFor("suspended"), "suspended");
  assert.equal(creatorColumnFor("declined"), "declined");
});

test("Ask for more needs a note; Decline and Suspend need a reason; Verify needs nothing", () => {
  assert.equal(decisionNoteError("verify", ""), null);
  assert.match(decisionNoteError("ask_more", "   "), /needs to send/);
  assert.match(decisionNoteError("decline", ""), /reason/);
  assert.match(decisionNoteError("suspend", "\n"), /reason/);
  assert.equal(decisionNoteError("decline", "Showcase videos are not theirs"), null);
  assert.deepEqual(decisionsFor("review"), ["verify", "ask_more", "decline", "suspend"]);
  assert.deepEqual(decisionsFor("verified"), ["suspend"]);
});

test("checks and flags read as words", () => {
  assert.equal(checksProgress([{ key: "profile", done: true }, { key: "rates", done: false }]).text, "1 of 2 done");
  assert.deepEqual(flagLines(["handle_conflict", { key: "audience_screenshot" }, { label: "Two accounts, one phone" }, null]), [
    "Handle claimed by someone else",
    "Audience screenshot needs a look",
    "Two accounts, one phone",
  ]);
  assert.deepEqual(flagLines(["some_new_flag"]), ["Some new flag"]);
});

test("contract states and timeline events never show a raw key", () => {
  assert.equal(contractStateWord("script_sent"), "Script with the host");
  assert.equal(contractStateWord("posts_verified"), "Posts verified");
  assert.equal(contractStateWord("resolved_partial"), "Settled · part refunded");
  assert.equal(contractStateWord("brand_new_state"), "Brand new state");
  assert.equal(gigEventWord("hold_captured"), "Hired · fee held");
  assert.equal(gigEventWord("dispute_decided"), "Mingla decided the dispute");
  for (const word of [contractStateWord("fix_requested"), gigEventWord("terms_change_declined")]) assert.doesNotMatch(word, /_/);
  assert.equal(deliverablesSummary([{ kind: "video", count: 1 }, { kind: "stories", count: 4 }]), "1 video + 4 Stories");
});

test("money is typed whole and stored in minor units", () => {
  assert.equal(wholeToMinor("300", "USD"), 30000);
  assert.equal(wholeToMinor("1,500", "NGN"), 150000);
  assert.equal(wholeToMinor("", "USD"), null);
  assert.ok(Number.isNaN(wholeToMinor("12.50", "USD")));
  assert.equal(minorToWhole(15000, "USD"), "150");
  assert.equal(refundPercentToBps("25"), 2500);
  assert.equal(refundPercentToBps("0"), null);
  assert.equal(refundPercentToBps("100"), null);
});

test("a gig shows the pay the host set, in the gig's currency", () => {
  assert.equal(payUpToWord(30000, "USD"), "Up to $300");
  assert.match(payUpToWord(5000000, "NGN"), /^Up to .*50,000/);
  assert.equal(payUpToWord(null, "USD"), "—");
  assert.equal(payUpToWord(0, "USD"), "—");
  assert.equal(payUpToWord(undefined, "USD"), "—");
});

test("payees: kind and rail in plain words, money words On the way · Ready · Paid", () => {
  assert.equal(payeeKindWord("referral"), "Referral");
  assert.equal(payeeKindWord("gig_fee"), "Gig fee");
  assert.equal(payeeKindWord("local_month"), "Local");
  assert.equal(railWord("stripe", "USD"), "Bank (US)");
  assert.equal(railWord("paystack", "NGN"), "Bank (NG)");
  for (const w of [railWord("stripe", "GBP"), railWord("paystack", "NGN")]) assert.doesNotMatch(w, /stripe|paystack/i);
  assert.equal(payeeStatusWord("releasable"), "Ready");
  assert.equal(payeeStatusWord("held_until_event"), "On the way");
  assert.equal(moneyStateWord("accumulating"), "On the way");
  assert.equal(moneyStateWord("paid"), "Paid");
  assert.equal(moneyStateWord(null), "Not queued yet");
});

test("server errors become one plain sentence, never raw text", () => {
  assert.equal(programErrorMessage({ error: "seats_below_active_locals" }), "Seats can't be fewer than the Locals already seated.");
  assert.equal(programErrorMessage({ message: 'new row violates check "seats_below_active_locals"' }), "Seats can't be fewer than the Locals already seated.");
  assert.equal(programErrorMessage(new Error("duplicate key value violates unique constraint")), "That didn't work. Try again.");
  assert.equal(programErrorMessage(null, "Fallback."), "Fallback.");
});
