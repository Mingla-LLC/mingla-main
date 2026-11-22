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
// [TEST-MOD #4420] the Roadmap screen and its deep-link helpers (isRoadmapHash,
// roadmapCardFromHash, roadmapDraftHref) are retired; their three tests left.
// Old roadmap addresses open Announcements (issue4420_admin_redirects).
import {
  PERSON_ACTIONS,
  personActionFor,
  REVIEW_GROUPS,
  reviewGroupOf,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const ID = "467a79ac-76c5-4b65-bc54-89b52073c574";





Deno.test("#3980 W2 rework 3: To review's description names roadmap approvals in plain words", () => {
  const d = read("pages/DraftsPage.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (D-11, R8) renames the page "Needs you" (the menu label and the design);
  // Wave 2 rework 3's description is kept word for word.
  // #4270 rework (P3-4): "needs your OK", never "needs a person".
  assertMatch(d, /<PageHeader title="Needs you" description="Only what needs your OK: messages to send, money to spend, events to publish, and roadmap news to approve before hosts see it\."/);
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
