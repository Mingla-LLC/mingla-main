// Issue #3980 synced program, Wave 2 rework 3 — the Admin side of the
// tester's P2 and P4:
//   P2  Community, Roadmap opens a roadmap card only from its own address
//       (#/community-support with tab=roadmap). The Work board and To review
//       carry ?card= too (a work card), so going Back or moving there from
//       Roadmap showed a false "That roadmap card isn't here any more". The
//       panel's hashchange listener now treats leaving Roadmap as leaving: no
//       card to open and no warning, also while the panel is closing.
//   P4  To review's description names roadmap approvals in plain words, and
//       a card that waits for a person to send a message has its own group
//       and its "Mark sent" action again (rework 2 put it under "Other" with
//       no action).
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isRoadmapHash,
  PERSON_ACTIONS,
  personActionFor,
  REVIEW_GROUPS,
  reviewGroupOf,
  roadmapCardFromHash,
  roadmapDraftHref,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const ID = "467a79ac-76c5-4b65-bc54-89b52073c574";

Deno.test("#3980 W2 rework 3: only a Community, Roadmap address opens a roadmap card", () => {
  assertEquals(roadmapCardFromHash(`#/community-support?tab=roadmap&card=${ID}`), ID);
  assertEquals(roadmapCardFromHash(`#/community-support?card=${ID}&tab=roadmap`), ID, "parameter order does not matter");
  assertEquals(roadmapCardFromHash(`#/work-board?card=${ID}`), null, "the Work board's ?card= is a work card");
  assertEquals(roadmapCardFromHash(`#/drafts?tab=spend&card=${ID}`), null, "To review's ?card= is a work card");
  assertEquals(roadmapCardFromHash(`#/drafts?card=${ID}`), null);
  assertEquals(roadmapCardFromHash(`#/community-support?tab=support&card=${ID}`), null, "another Community tab");
  assertEquals(roadmapCardFromHash(`#/community-support?card=${ID}`), null, "no tab is Overview, not Roadmap");
  assertEquals(roadmapCardFromHash(`#/community-support-x?tab=roadmap&card=${ID}`), null, "a near-miss page");
  assertEquals(roadmapCardFromHash(`#/other/community-support?tab=roadmap&card=${ID}`), null);
  assertEquals(roadmapCardFromHash(""), null);
  assertEquals(roadmapCardFromHash(undefined), null);
  // The link To review and the Work board build is still read back.
  const href = roadmapDraftHref({ links: [{ kind: "roadmap_card", id: ID }] })!;
  assertEquals(roadmapCardFromHash(href), ID);
  assertEquals(isRoadmapHash(href), true);
  assertEquals(isRoadmapHash("#/community-support?tab=roadmap"), true);
  assertEquals(isRoadmapHash(`#/drafts?tab=spend&card=${ID}`), false);
  assertEquals(isRoadmapHash("#/community-support?tab=overview"), false);
});

// The listener's decision, exactly as RoadmapPanel runs it on each hashchange.
function onHash(hash: string) {
  const leaving = !isRoadmapHash(hash);
  return { leaving, open: leaving ? null : roadmapCardFromHash(hash) };
}

Deno.test("#3980 W2 rework 3: Back to To review or moving to the Work board is leaving, never a missing card", () => {
  for (const hash of [`#/drafts?tab=spend&card=${ID}`, `#/work-board?card=${ID}`, "#/drafts", "#/community-support?tab=support"]) {
    assertEquals(onHash(hash), { leaving: true, open: null }, hash);
  }
  assertEquals(onHash(`#/community-support?tab=roadmap&card=${ID}`), { leaving: false, open: ID });
  assertEquals(onHash("#/community-support?tab=roadmap"), { leaving: false, open: null });
});

Deno.test("#3980 W2 rework 3: the Roadmap panel's listener says nothing while the page is closing", () => {
  const p = read("components/community/RoadmapPanel.jsx");
  assertMatch(p, /const leavingRef = useRef\(false\);/);
  assertMatch(p, /const onHash = \(\) => \{\n\s+const hash = window\.location\.hash;\n\s+leavingRef\.current = !isRoadmapHash\(hash\);\n\s+setOpenCardId\(leavingRef\.current \? null : roadmapCardFromHash\(hash\)\);\n\s+\};/);
  assertMatch(p, /return \(\) => \{\n\s+leavingRef\.current = true;\n\s+window\.removeEventListener\("hashchange", onHash\);\n\s+\};/);
  assertMatch(p, /if \(!row\) \{\n\s+if \(leavingRef\.current\) return;\n\s+addToast\(\{ variant: "warning", title: "That roadmap card isn’t here any more"/);
  assert(!/const onHash = \(\) => setOpenCardId\(roadmapCardFromHash\(window\.location\.hash\)\);/.test(p), "the bare listener is gone");
});

Deno.test("#3980 W2 rework 3: To review's description names roadmap approvals in plain words", () => {
  const d = read("pages/DraftsPage.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (D-11, R8) renames the page "Needs you" (the menu label and the design);
  // Wave 2 rework 3's description is kept word for word.
  assertMatch(d, /<PageHeader title="Needs you" description="Only what needs a person: messages to send, money to spend, events to publish, and roadmap news to approve before hosts see it\."/);
});

Deno.test("#3980 W2 rework 3: a Send card has its own To review group and its Mark sent action", () => {
  const send = { status: "person", person_reason: "send", links: [] };
  assertEquals(reviewGroupOf(send), "send");
  assertEquals(REVIEW_GROUPS.find((g) => g.id === "send")?.title, "Send a message");
  assertEquals(REVIEW_GROUPS.map((g) => g.id), ["send", "spend", "publish", "hosts", "other"]);
  assertEquals(personActionFor(send), PERSON_ACTIONS.send);
  assertEquals(personActionFor(send)?.label, "Mark sent");
  // Every person reason lands in a group that exists; nothing is dropped.
  for (const reason of ["send", "spend", "publish", "other", "unknown", undefined]) {
    assert(REVIEW_GROUPS.some((g) => g.id === reviewGroupOf({ person_reason: reason })), String(reason));
  }
  const q = read("components/ops/ReviewQueue.jsx");
  assertMatch(q, /\{personActionFor\(card\)\?\.action === "mark_sent" && <Button className="min-h-11" disabled=\{!online \|\| busy\} onClick=\{\(\) => setForm\("mark_sent"\)\}>Mark sent<\/Button>\}/);
  assertMatch(q, /action === "mark_sent" \? "Marked sent"/);
  // The form posts the action it was opened for (mark_sent goes to ops_work_person_action).
  assertMatch(q, /onSubmit=\{\(note\) => act\(form === "sendback" \? "send_back" : form, note\)\}/);
  assertMatch(q, /: await ops\.personAction\(card\.id, action, note, card\.revision\);/);
  const w = read("components/ops/WorkDetail.jsx");
  assertMatch(w, /const submit = kind === "approve_spend" \? "Approve spend" : kind === "sendback" \? "Send back" : kind === "mark_sent" \? "Mark sent" : "Mark published";/);
});
