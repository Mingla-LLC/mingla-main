// Issue #3980 synced program, Wave 3 rework 2 — the Admin fixes after the
// second Wave 3 test:
//   DEV1  a "Recently shipped" wording card shows only on What hosts are told
//         for the owner and admins (counted once by the server); anyone else
//         on such a card still reaches it under Spend or publish
//   DEV2  people without the roadmap tab read the design's shorter line
//   TABS  the Needs you tabs wrap inside their bar at 375px, never clipped
//   STEPS the save never says steps exist when none do (far-off series)
//   GROUP Group by Person or Event shows each card's status
//   DEAD  the unused CalendarLayers.jsx is gone and nothing imports it
//   44PX  the Hosts board Add host, Search, Clear filters and the "Move to"
//         buttons are at least 44px tall
import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { expectedSavedWords, spendQueueCards, workStatusLabel } from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

Deno.test("#3980 W3 rework 2 DEV1: the wording card is listed only on What hosts are told for those who have that tab", () => {
  const cards = [
    { id: "a", person_reason: "spend", auto_kind: null },
    { id: "b", person_reason: "other", auto_kind: "roadmap_shipped" },
    { id: "c", person_reason: "publish", auto_kind: null },
  ];
  assertEquals(spendQueueCards(cards, true).map((c: { id: string }) => c.id), ["a", "c"]);
  // Anyone without the tab still reaches it here, so a person can approve it.
  assertEquals(spendQueueCards(cards, false).map((c: { id: string }) => c.id), ["a", "b", "c"]);
  assertEquals(spendQueueCards(null, true), []);
  const queue = code("components/ops/ReviewQueue.jsx");
  assertMatch(queue, /export function ReviewQueue\(\{[^}]*hideHostsTold = false \}\)/);
  assertMatch(queue, /const cards = spendQueueCards\(queue\.data\?\.cards, hideHostsTold\);/);
  const page = code("pages/DraftsPage.jsx");
  assertMatch(page, /<ReviewQueue online=\{online\} hideHostsTold=\{canTell\}/);
  assertMatch(page, /<WordingQueue /);
});

Deno.test("#3980 W3 rework 2 DEV2: the roadmap words only for the owner and admins; the design's shorter line for everyone else", () => {
  const page = code("pages/DraftsPage.jsx");
  assertMatch(page, /\{canTell\s*\? <PageHeader title="Needs you" description="Only what needs a person: messages to send, money to spend, events to publish, and roadmap news to approve before hosts see it\." meta=\{headerMeta\} \/>\s*: <PageHeader title="Needs you" description="Only what needs a person: messages to send, money to spend, events to publish\." meta=\{headerMeta\} \/>\}/);
});

Deno.test("#3980 W3 rework 2 TABS: the Needs you tabs wrap inside their bar instead of clipping", () => {
  const fields = code("components/crm/fields.jsx");
  assertMatch(fields, /wrap = false, className = "" \}\)/);
  assertMatch(fields, /\$\{wrap \? "flex-wrap" : "flex-nowrap overflow-x-auto"\}/);
  assertMatch(code("pages/DraftsPage.jsx"), /<Segmented label="What to review" options=\{reviewTabs\} value=\{review\.tab\} onChange=\{selectTab\} variant="highContrast" fullWidth wrap /);
});

Deno.test("#3980 W3 rework 2 STEPS: no steps open yet is said plainly, never 'already in Work'", () => {
  const far = expectedSavedWords({ auto_steps: true, steps: { added: 0, closed: 0, redated: 0, open: 0 } });
  assertEquals(far, "Saved. It’s on the Calendar. No steps are needed yet; Mingla adds them nearer the date.");
  assertNotMatch(far, /in Work/);
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { added: 0, closed: 0, redated: 0, open: 2 } }), "Saved. It’s on the Calendar; its steps were already in Work.");
  assertEquals(expectedSavedWords({ auto_steps: true, steps: { added: 1, closed: 0, redated: 0, open: 1 } }), "Saved. It’s on the Calendar and its steps are in Work.");
});

Deno.test("#3980 W3 rework 2 GROUP: grouped by Person or Event, each card shows its status", () => {
  // #4130: Needs you is retired; the first column and the status say "Waiting on a person".
  assertEquals(["person", "todo", "doing", "done", "x"].map(workStatusLabel), ["Waiting on a person", "To do", "In progress", "Done", ""]);
  const cols = code("components/ops/WorkColumns.jsx");
  assertMatch(cols, /export function WorkColumnCard\(\{ card, selected, onSelect, showStatus = false, draftsReady = 0 \}\)/);
  assertMatch(cols, /showStatus && workStatusLabel\(card\.status\) && <span data-card-status=\{card\.status\}/);
  const groups = cols.slice(cols.indexOf("export function WorkGroups"));
  assertMatch(groups, /<WorkColumnCard card=\{card\} selected=\{card\.id === selectedId\} onSelect=\{onSelect\} showStatus \/>/);
  // The status columns already say the status, so the column board does not repeat it.
  const columns = cols.slice(cols.indexOf("export function WorkColumns"), cols.indexOf("export function WorkGroups"));
  assertNotMatch(columns, /showStatus/);
});

Deno.test("#3980 W3 rework 2 DEAD: CalendarLayers.jsx is gone and nothing imports it", () => {
  let exists = true;
  try { Deno.statSync(new URL("components/ops/CalendarLayers.jsx", SRC)); } catch { exists = false; }
  assertEquals(exists, false);
  const stack = [new URL("./", SRC)];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of Deno.readDirSync(dir)) {
      if (e.isDirectory) { if (e.name !== "__tests__") stack.push(new URL(e.name + "/", dir)); continue; }
      if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
      assertNotMatch(Deno.readTextFileSync(new URL(e.name, dir)), /CalendarLayers/, e.name);
    }
  }
});

Deno.test("#3980 W3 rework 2 44PX: Add host, Search, Clear filters and Move to are at least 44px", () => {
  const search = code("components/ui/SearchInput.jsx");
  assertMatch(search, /inputClassName = ""/);
  assertMatch(search, /\n\s+inputClassName,\n\s+\]\.filter\(Boolean\)\.join\(" "\)/);
  assertMatch(code("components/crm/PipelineToolbar.jsx"), /<SearchInput\s+className="w-full sm:w-64"\s+inputClassName="min-h-11"/);
  const page = code("pages/PipelinePage.jsx");
  assertMatch(page, /icon=\{Plus\} className="min-h-11" disabled=\{addDisabled\} onClick=\{\(\) => openCard\(NEW_CARD\)\}>\s*Add \{singular\}/);
  assertMatch(page, /<Button variant="secondary" className="min-h-11" onClick=\{clearFilters\}>\s*Clear filters/);
  assertMatch(code("components/crm/RecordCard.jsx"), /className="min-h-11 max-sm:h-11"\s+iconRight=\{ArrowRight\}[\s\S]*?title=\{`Move to \$\{next\.label\}`\}/);
  assertMatch(code("components/crm/RecordDrawer.jsx"), /className="min-h-11 max-sm:h-11"\s+iconRight=\{ArrowRight\}\s+disabled=\{locked \|\| pending\}[\s\S]*?Move to \{next\.label\}/);
});
