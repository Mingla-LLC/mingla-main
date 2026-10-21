// Issue #3980 synced program, Wave 1 rework — the Admin side of the tester's
// FAIL: owner chips never let a name run under the remove button (D8), two
// teammates with one name are told apart by email in every picker (D9), the
// owner hears about a shared name when saving it, the two "Link" buttons have
// their own accessible names, and the Work board row names the agent's chat.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { agentName, personLabel, sharedNames } from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));

Deno.test("#3980 rework D9: names two teammates share are found across the team and the chips", () => {
  const team = [
    { email: "kim@x.test", name: "Debrah" },
    { email: "lou@x.test", name: "debrah" },
    { email: "ada@x.test", name: "Ada" },
  ];
  const shared = sharedNames(team, [{ email: "kim@x.test", name: "Debrah" }]);
  assertEquals([...shared], ["debrah"], "one person listed twice is not a shared name; two people are");
  assertEquals(personLabel(team[0], shared), "Debrah (kim@x.test)");
  assertEquals(personLabel(team[1], shared), "debrah (lou@x.test)");
  assertEquals(personLabel(team[2], shared), "Ada", "a name nobody else has shows alone");
  assertEquals(sharedNames([], null as unknown as []).size, 0);
});

Deno.test("#3980 rework D8 and D9: the people picker", () => {
  const picker = read("components/ops/PeoplePicker.jsx");
  assert(!/min-w-\[6ch\]/.test(picker), "no six-character floor that lets a long word shrink under the button");
  assert(!/<li key=\{p\.email\} data-chip="person" className="[^"]*max-w-full/.test(picker), "the chip is never capped narrower than its longest word");
  assertMatch(picker, /<li key=\{p\.email\} data-chip="person" className="inline-flex min-w-min /);
  assertMatch(picker, /min-h-8 min-w-8 shrink-0 place-items-center/, "the remove button keeps its size");
  assertMatch(picker, /const shared = sharedNames\(team, people\);/);
  assertEquals((picker.match(/shared\.has\(String\(p\.name \?\? ""\)\.trim\(\)\.toLowerCase\(\)\) && <span[^>]*>\{p\.email\}<\/span>/g) ?? []).length, 2,
    "the chip and the list both show the email of a shared name");
  assertMatch(picker, /aria-label=\{`Remove \$\{personLabel\(p, shared\)\}`\}/);
  assertMatch(picker, /aria-label=\{`Add \$\{personLabel\(p, shared\)\}, \$\{p\.role_label\}`\}/);
});

Deno.test("#3980 rework D9: saving a shared name shows the server's warning", () => {
  const service = read("services/teamProfileService.js");
  assertMatch(service, /warning: typeof data\.warning === "string" && data\.warning \? data\.warning : ""/);
  const page = read("pages/AdminPage.jsx");
  assertMatch(page, /state: "saved", error: "", warning: saved\?\.warning \|\| ""/);
  assertMatch(page, /`Saved\. \$\{profiles\[email\]\.warning\}`/);
});

Deno.test("#3980 rework: the two Link buttons have their own names, and the board row names the chat", () => {
  const detail = read("components/ops/WorkDetail.jsx");
  assertEquals((detail.match(/aria-label="Link a record"/g) ?? []).length, 1);
  assertEquals((detail.match(/aria-label="Link GitHub"/g) ?? []).length, 1);
  assertMatch(read("components/ops/WorkItem.jsx"), /agentName\(card\.claim\.holder_name, card\.claim\.holder_via, card\.claim\.holder_chat_label\)/);
  assertEquals(agentName("Seth", "claude", "Hosts sweep"), "Seth's Claude (Hosts sweep)");
});
