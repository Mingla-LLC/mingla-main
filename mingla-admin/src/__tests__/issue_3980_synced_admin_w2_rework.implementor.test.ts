// Issue #3980 synced program, Wave 2 rework — the Admin side of the tester's
// CONDITIONAL verdict:
//   P3  Bridge D's approval card (a drafted "Recently shipped" roadmap card)
//       says "Approve what hosts are told", not "Publishes an event", on the
//       Work board row and the card's status chip
//   P4  the "Blocked until #n is Live" switch is not offered on a card whose
//       linked issues are all Live already; it stays while the card waits,
//       so a person can switch it off
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { githubWaitOffered, personReasonLabel, PERSON_REASONS } from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));

Deno.test("#3980 W2 rework: Bridge D's approval card says what it asks a person for", () => {
  assertEquals(personReasonLabel({ person_reason: "publish", auto: true, auto_kind: "roadmap_shipped" }), "Approve what hosts are told");
  assertEquals(personReasonLabel({ person_reason: "publish", auto_kind: null }), "Publishes an event", "an event card keeps its words");
  assertEquals(personReasonLabel({ person_reason: "send" }), PERSON_REASONS.send);
  assertEquals(personReasonLabel({ person_reason: null }), "Needs a person");
  assertEquals(personReasonLabel(null), "Needs a person");
  const item = read("components/ops/WorkItem.jsx");
  assertMatch(item, /\{personReasonLabel\(card\)\}/);
  assert(!/PERSON_REASONS\[card\.person_reason\]/.test(item), "the row no longer reads the bare reason");
  const detail = read("components/ops/WorkDetail.jsx");
  assertMatch(detail, /` · \$\{personReasonLabel\(card\)\}`/);
  assert(!/PERSON_REASONS\[card\.person_reason\]/.test(detail), "the status chip no longer reads the bare reason");
});

Deno.test("#3980 W2 rework: the wait switch is offered only while something linked is not Live yet", () => {
  const live = (n: number) => ({ number: n, label: "Live", live: true });
  const prog = (n: number) => ({ number: n, label: "In Progress", live: false });
  assertEquals(githubWaitOffered({ github: [live(1), live(2)] }), false, "everything is Live: waiting would unblock at once");
  assertEquals(githubWaitOffered({ github: [live(1), prog(2)] }), true);
  assertEquals(githubWaitOffered({ github: [{ number: 3, label: "Checking GitHub" }] }), true, "not read yet counts as not Live");
  assertEquals(githubWaitOffered({ github: [] }), false);
  assertEquals(githubWaitOffered({ blocked: true, blocked_kind: "github", github: [live(1)] }), true, "a waiting card keeps the switch to lift it");
  assertEquals(githubWaitOffered({ blocked: true, blocked_kind: "manual", github: [live(1)] }), false);
  const detail = read("components/ops/WorkDetail.jsx");
  const wait = detail.slice(detail.indexOf("function GithubWait("));
  assertMatch(wait.slice(0, 400), /if \(!words \|\| !githubWaitOffered\(card\)\) return null;/);
});
