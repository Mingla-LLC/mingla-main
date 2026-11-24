// Issue #3980 synced program, Wave 2 rework 2 — the Admin side of the
// tester's P2: Bridge D's approval card (a drafted "Recently shipped" roadmap
// card, auto_kind roadmap_shipped) offered "Mark published", which checks
// that an EVENT is public and so always failed on it ("not_public_yet").
//   - no "Mark published" on it, in To review or on the Work board
//   - its own To review group, "What hosts are told", not "Publish an event"
//   - a path that works: "Open the draft in Roadmap" (Community, Roadmap with
//     the drafted card open in the editor) plus "Close with proof"
// The server side (a person closes it with proof; it still closes itself when
// the draft is published or archived) is in
// supabase/migrations/__tests__/issue_3980_synced_w2_rework2.implementor.pg17.test.sql.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isRoadmapApproval,
  PERSON_ACTIONS,
  personActionFor,
  REVIEW_GROUPS,
  reviewGroupOf,
} from "../lib/opsModel.js";
// [TEST-MOD #4420] the Roadmap screen is retired: roadmapDraftHref and
// roadmapCardFromHash (its deep link) were removed with it, and their two
// tests left; the wording is approved on the Work card itself (CardWording).
// #4130 Wave 6: Roadmap is a tab of the Community page.
import { redirectHash } from "../lib/adminRoutes.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const DRAFT = "6f2c1a4e-8b1d-4c2a-9e3f-0a1b2c3d4e5f";
const approval = { status: "person", person_reason: "publish", auto: true, auto_kind: "roadmap_shipped",
  links: [{ kind: "github", id: "x" }, { kind: "roadmap_card", id: DRAFT, label: "Recently shipped: X" }] };
const eventCard = { status: "person", person_reason: "publish", auto_kind: "gate_live", links: [{ kind: "event", id: DRAFT }] };

Deno.test("#3980 W2 rework 2: a roadmap approval card offers no Mark published; an event card keeps it", () => {
  assertEquals(isRoadmapApproval(approval), true);
  assertEquals(personActionFor(approval), null, "Close with proof instead");
  assertEquals(personActionFor(eventCard), PERSON_ACTIONS.publish);
  assertEquals(personActionFor({ person_reason: "spend" }), PERSON_ACTIONS.spend);
  assertEquals(personActionFor({ person_reason: "other" }), null);
  assertEquals(personActionFor(null), null);
});

Deno.test("#3980 W2 rework 2: To review has a 'What hosts are told' group and the approval card is in it", () => {
  // W2 rework 3: Send cards have their own group again (it was "Other" with no Mark sent).
  assertEquals(REVIEW_GROUPS.map((g) => g.title), ["Send a message", "Spend money", "Publish an event", "What hosts are told", "Other"]);
  assertEquals(reviewGroupOf(approval), "hosts");
  assertEquals(reviewGroupOf(eventCard), "publish");
  assertEquals(reviewGroupOf({ person_reason: "spend" }), "spend");
  assertEquals(reviewGroupOf({ person_reason: "other" }), "other");
  assertEquals(reviewGroupOf({ person_reason: "send" }), "send", "never dropped from the list, and in its own group (W2 rework 3)");
  assertEquals(REVIEW_GROUPS.find((g) => g.id === reviewGroupOf(approval))?.title, "What hosts are told");
});

// #4383: Roadmap is its own Communications screen (#/roadmap).

Deno.test("#3980 W2 rework 2: To review shows the draft link and Close with proof, never Mark published, on an approval card", () => {
  const q = read("components/ops/ReviewQueue.jsx");
  assert(!/const GROUPS = \[/.test(q), "the groups come from REVIEW_GROUPS");
  assertMatch(q, /REVIEW_GROUPS\.map\(\(g\) => \{\n\s+const rows = cards\.filter\(\(c\) => reviewGroupOf\(c\) === g\.id\);/);
  assert(!/card\.person_reason === "publish" && <Button/.test(q), "Mark published no longer follows the bare reason");
  assertMatch(q, /\{personActionFor\(card\)\?\.action === "mark_published" && <Button[^\n]*>Mark published<\/Button>\}/);
  assert(!/Open the draft in Roadmap/.test(q), "[TEST-MOD #4420] no link to the retired Roadmap screen");
  assertMatch(q, /\{isRoadmapApproval\(card\) && <Button[^\n]*>Close with proof<\/Button>\}/);
  assertMatch(q, /form === "close" && <ProofForm [^\n]*act\("close", null, proof, result\)/);
  assertMatch(q, /action === "close"\n\s+\? await ops\.closeWork\(card\.id, proof, result \|\| null, card\.revision\)/);
});

Deno.test("#3980 W2 rework 2: the Work board card shows the draft link and Close with proof on an approval card", () => {
  const d = read("components/ops/WorkDetail.jsx");
  assert(!/PERSON_ACTIONS\[card\.person_reason\]/.test(d), "the action is no longer read from the bare reason");
  // [TEST-MOD #4420] no link to the retired Roadmap screen; the card's own wording editor stays.
  assertMatch(d, /const action = personActionFor\(card\);/);
  assert(!/draftHref|Open the draft in Roadmap/.test(d));
  assertMatch(d, /<CardWording card=\{card\}/);
  // #4270: the Next step box calls it "Done with proof". #4255 W3: the status line's one primary
  // button is the card's action when it has one, else Done with proof (tagged or In progress).
  assertMatch(d, /else if \(tagged && action\) primary = <Button[^\n]*>\{action\.label\}<\/Button>;/);
  // #4398: the close button says Mark done (Close as done for the watcher); it still opens the proof form.
  assertMatch(d, /else primary = <Button[^\n]*onClick=\{startClose\}>\{role\.isWatcher \? "Close as done" : "Mark done"\}<\/Button>;/);
});

