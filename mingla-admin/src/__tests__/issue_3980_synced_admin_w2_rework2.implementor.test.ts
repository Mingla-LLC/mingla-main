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
  roadmapCardFromHash,
  roadmapDraftHref,
} from "../lib/opsModel.js";
// #4130 Wave 6: Roadmap is a tab of the Community page.
import { pageTabFromHash } from "../lib/supportCommunityTabs.js";
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

Deno.test("#3980 W2 rework 2: 'Open the draft in Roadmap' is a deep link Community, Roadmap reads back", () => {
  const href = roadmapDraftHref(approval)!;
  assertEquals(href, `#/community?tab=roadmap&card=${DRAFT}`);
  assertEquals(redirectHash(href), null, "a live Community address");
  assertEquals(pageTabFromHash(href, "community"), "roadmap", "the page opens the Roadmap tab");
  const old = `#/community-support?tab=roadmap&card=${DRAFT}`;
  assertEquals(redirectHash(old), href, "a link sent before the split lands in the same place");
  assertEquals(roadmapCardFromHash(href), DRAFT, "and the panel opens this card");
  assertEquals(roadmapDraftHref(eventCard), null, "no roadmap card linked, no link");
  assertEquals(roadmapDraftHref({ links: [{ kind: "roadmap_card", id: "" }] }), null);
  assertEquals(roadmapCardFromHash("#/community-support?tab=roadmap&card=not-a-card"), null);
  assertEquals(roadmapCardFromHash("#/community-support?tab=roadmap"), null);
});

Deno.test("#3980 W2 rework 2: To review shows the draft link and Close with proof, never Mark published, on an approval card", () => {
  const q = read("components/ops/ReviewQueue.jsx");
  assert(!/const GROUPS = \[/.test(q), "the groups come from REVIEW_GROUPS");
  assertMatch(q, /REVIEW_GROUPS\.map\(\(g\) => \{\n\s+const rows = cards\.filter\(\(c\) => reviewGroupOf\(c\) === g\.id\);/);
  assert(!/card\.person_reason === "publish" && <Button/.test(q), "Mark published no longer follows the bare reason");
  assertMatch(q, /\{personActionFor\(card\)\?\.action === "mark_published" && <Button[^\n]*>Mark published<\/Button>\}/);
  assertMatch(q, /\{roadmapDraftHref\(card\) && <a href=\{roadmapDraftHref\(card\)\}[^\n]*>Open the draft in Roadmap<\/a>\}/);
  assertMatch(q, /\{isRoadmapApproval\(card\) && <Button[^\n]*>Close with proof<\/Button>\}/);
  assertMatch(q, /form === "close" && <ProofForm [^\n]*act\("close", null, proof, result\)/);
  assertMatch(q, /action === "close"\n\s+\? await ops\.closeWork\(card\.id, proof, result \|\| null, card\.revision\)/);
});

Deno.test("#3980 W2 rework 2: the Work board card shows the draft link and Close with proof on an approval card", () => {
  const d = read("components/ops/WorkDetail.jsx");
  assert(!/PERSON_ACTIONS\[card\.person_reason\]/.test(d), "the action is no longer read from the bare reason");
  assertMatch(d, /const action = personActionFor\(card\);\n\s+const draftHref = roadmapDraftHref\(card\);/);
  assertMatch(d, /\{draftHref && <a href=\{draftHref\}[^\n]*>Open the draft in Roadmap<\/a>\}/);
  assertMatch(d, /\{!action && <Button[^\n]*>Close with proof<\/Button>\}/);
});

Deno.test("#3980 W2 rework 2: Community, Roadmap opens the linked draft in the editor", () => {
  const r = read("components/community/RoadmapPanel.jsx");
  assertMatch(r, /useState\(\(\) => roadmapCardFromHash\(window\.location\.hash\)\)/);
  assertMatch(r, /window\.addEventListener\("hashchange", onHash\)/);
  const effect = r.slice(r.indexOf("if (!openCardId || loading) return;"));
  assertMatch(effect.slice(0, 900), /setStatusFilter\(row\.status\);\n\s+setEditor\(\{\n\s+id: row\.id,/);
  assertMatch(effect.slice(0, 900), /That roadmap card isn’t here any more/);
});
