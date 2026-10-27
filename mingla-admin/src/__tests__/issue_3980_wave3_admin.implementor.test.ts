// Issue #3980 Wave 3 — the launch kit, the giveaway and ads override, the
// Team dashboard panels, My day's cards and the owner-only next-step
// conversion in Mingla Admin: the pure words and choices, the one caller of
// the new ops_* functions, and the rules each screen keeps (the convert runs
// only from its confirm step, the override only for the owner or an admin).
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOSTS_WITHOUT_OWNER_PROMPT,
  addResultSummary,
  conversionIssue,
  conversionResultWords,
  conversionSelectable,
  dueOrder,
  hostsWithoutOwnerWords,
  kitPlanSummary,
  kitSkipWords,
  proofFromLines,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));
const code = (relative: string) => read(relative).replace(/^\s*\/\/.*$/gm, "");

Deno.test("#3980 W3 why a kit step was skipped, in words", () => {
  assertEquals(kitSkipWords("card_exists"), "Already has a card");
  assertEquals(kitSkipWords("already_public"), "Done: the event is public");
  assertEquals(kitSkipWords("date_passed"), "Its day has passed");
  assertEquals(kitSkipWords("no_date"), "The event has no date yet");
  assertEquals(kitSkipWords("anything"), "Not proposed");
});

Deno.test("#3980 W3 a plan's button and the held giveaway card", () => {
  const cards = [{ kind: "task" }, { kind: "gate_live" }, { kind: "promo" }];
  assertEquals(kitPlanSummary({ cards, skipped: [{}], promo_gate: { blocked: true } }), { count: 3, skipped: 1, promoHeld: true, addLabel: "Add 3 cards" });
  assertEquals(kitPlanSummary({ cards, skipped: [], promo_gate: { blocked: false } }).promoHeld, false);
  assertEquals(kitPlanSummary({ cards: [{ kind: "task" }], promo_gate: { blocked: true } }), { count: 1, skipped: 0, promoHeld: false, addLabel: "Add 1 card" });
  assertEquals(kitPlanSummary(null).count, 0);
});

Deno.test("#3980 W3 after adding the kit: the toast and every card that was not added, with its fixes", () => {
  const s = addResultSummary({
    added: 6,
    results: [
      { index: 0, status: "added" },
      { index: 1, status: "refused", title: "Go-live gate", fixes: [{ field: "due_on", message: "Due date must be a real date from today up to two years ahead." }] },
      { index: 2, status: "duplicate", message: "An open card already does this: \"X\" (Card 4). Update that card instead." },
    ],
  });
  assertEquals(s.added, 6);
  assertEquals(s.toast, "6 cards added. Owners were told.");
  assertEquals(s.problems.map((p: { messages: string[] }) => p.messages[0]), [
    "Due date must be a real date from today up to two years ahead.",
    "An open card already does this: \"X\" (Card 4). Update that card instead.",
  ]);
  assertEquals(addResultSummary({ added: 1, results: [] }).toast, "1 card added. Owners were told.");
});

Deno.test("#3980 W3 a next step can be picked when ready, or with a fallback owner when nobody owns it", () => {
  assertEquals(conversionSelectable({ issue: null }, ""), true);
  assertEquals(conversionSelectable({ issue: "no_owner" }, ""), false);
  assertEquals(conversionSelectable({ issue: "no_owner" }, "bo@usemingla.com"), true);
  for (const issue of ["already_converted", "duplicate_title", "too_short"]) {
    assertEquals(conversionSelectable({ issue }, "bo@usemingla.com"), false, issue);
  }
  assertEquals(conversionSelectable(null, "x"), false);
  assertEquals(conversionIssue(null), null);
  assertEquals(conversionIssue("no_owner")?.label, "No owner");
  assertEquals(conversionIssue("already_converted")?.label, "Already converted");
  assertEquals(conversionIssue("duplicate_title")?.label, "Same title as an open card");
  assertEquals(conversionIssue("too_short")?.label, "Next step too short");
});

Deno.test("#3980 W3 host cards with no owner: the words and the agent prompt", () => {
  assertEquals(hostsWithoutOwnerWords(0), "");
  assertEquals(hostsWithoutOwnerWords(1), "1 host card has no owner. Work cannot be assigned to it.");
  assertEquals(hostsWithoutOwnerWords(567), "567 host cards have no owner. Work cannot be assigned to them.");
  assertEquals(
    HOSTS_WITHOUT_OWNER_PROMPT,
    "Give every host card that has no owner an owner by city and ICP: find_records for hosts with no owner, then set_owners. Tell me who you assigned.",
  );
});

Deno.test("#3980 W3 My cards: open only, soonest first, at most the number asked", () => {
  const cards = [
    { id: "a", number: 3, status: "todo", due_on: "2026-11-03" },
    { id: "b", number: 1, status: "done", due_on: "2026-10-01" },
    { id: "c", number: 2, status: "doing", due_on: "2026-10-20" },
    { id: "d", number: 4, status: "person", due_on: "2026-10-20" },
  ];
  assertEquals(dueOrder(cards).map((c: { id: string }) => c.id), ["c", "d", "a"]);
  assertEquals(dueOrder(cards, 1).map((c: { id: string }) => c.id), ["c"]);
  assertEquals(dueOrder(null, 5), []);
});

Deno.test("#3980 W3 proof lines are pure and shared by close and push back", () => {
  assertEquals(proofFromLines(["  Sent the deck  ", "ok", ""]), [{ kind: "text", text: "Sent the deck" }]);
  assertEquals(proofFromLines(null), []);
  assertMatch(read("components/ops/ProofForm.jsx"), /import \{ proofFromLines \} from "\.\.\/\.\.\/lib\/opsModel";/);
  assertMatch(read("components/ops/PushBackForm.jsx"), /import \{ proofFromLines \} from "\.\.\/\.\.\/lib\/opsModel";/);
});

Deno.test("#3980 W3 the service is the one caller of the new functions", () => {
  const service = read("services/opsService.js");
  for (const fn of ["ops_launch_kit_preview", "ops_gate_override", "ops_team_overview", "ops_next_action_preview", "ops_next_action_convert"]) {
    assertMatch(service, new RegExp(`supabase\\.rpc\\("${fn}"`), fn);
  }
  for (const file of ["components/ops/LaunchPlanner.jsx", "components/ops/TeamOpsPanels.jsx", "components/ops/MyCardsPanels.jsx", "components/ops/WorkDetail.jsx", "pages/TeamDashboardPage.jsx", "pages/RoleHomePage.jsx"]) {
    assertNotMatch(read(file), /\.rpc\(|lib\/supabase/, file);
  }
});

Deno.test("#3980 W3 Plan this launch: shown in the event panel only while the event has no kit card, and adds through the checked add", () => {
  const panel = read("components/ops/EventPanel.jsx");
  // [TEST-MOD-APPROVED #3980] synced Wave 3 (R2, D-8): steps are made by themselves, so the Plan button left the
  // event panel; LaunchPlanner stays for old links and agents (plan_work).
  assertNotMatch(panel, /<LaunchPlanner/);
  assertMatch(panel, /<EventSteps /);
  const planner = read("components/ops/LaunchPlanner.jsx");
  assertMatch(planner, /Plan this launch/);
  assertMatch(planner, /ops\.previewLaunchKit\(anchor\.kind, anchor\.id, \{\}, todayIso\(\)\)/);
  assertMatch(planner, /ops\.addWork\(cards, requestKey\("kit"\)\)/);
  assertMatch(planner, /Blocked until go-live/);
  assertMatch(planner, /label: "Open Work board"/);
  assertMatch(read("pages/ContentCalendarPage.jsx"), /<EventPanel ref=\{eventHeadingRef\} selection=\{route\.event\} onSelect=\{selectEvent\} onBack=\{clearEvent\} online=\{online\} \/>/);
});

Deno.test("#3980 W3 a held giveaway card: Override only for the owner or an admin, with a reason of 10 characters or more", () => {
  const detail = code("components/ops/WorkDetail.jsx");
  assertMatch(detail, /card\.kind === "promo" && me\.can_override && \(form === "override"/);
  assertMatch(detail, /disabled=\{locked \|\| overrideReason\.trim\(\)\.length < 10 \|\| !!busy\}/);
  assertMatch(detail, /ops\.overrideGate\(card\.id, overrideReason\.trim\(\)\)/);
});

Deno.test("#3980 W3 the conversion runs only from its confirm step, for the owner, for the ticked rows", () => {
  const panels = code("components/ops/TeamOpsPanels.jsx");
  // the panel is the owner's only
  assertMatch(panels, /\{canConvert && <NextStepConversion /);
  assertMatch(panels, /const canConvert = !!config\.data\?\.me\?\.can_convert;/);
  // one call site, guarded by the confirm state
  assertEquals([...panels.matchAll(/ops\.convertNextActions\(/g)].length, 1);
  assertMatch(panels, /if \(state !== "confirm" \|\| chosen\.length === 0\) return;\s*setState\("converting"\);/);
  // the first button only asks; the second converts
  assertMatch(panels, /onClick=\{\(\) => setState\("confirm"\)\}>Convert selected \(\{chosen\.length\}\)/);
  assertMatch(panels, /onClick=\{convert\}>\{state === "converting" \? "Adding…" : `Yes, add \$\{chosen\.length\} cards`\}/);
  assertMatch(panels, /Each host or creator is converted once\. Their next step text stays on the card/);
});

Deno.test("#3980 W3 the Team dashboard and My day show the new panels and keep what they had", () => {
  const team = read("pages/TeamDashboardPage.jsx");
  // #4130: the dashboard keeps the runway (collapsed at the bottom); the sprint table lives on Work.
  assertMatch(team, /<RunwayPanel runway=\{overview\.data\.runway\} \/>/);
  assertMatch(team, /const summary = useCrmSummary\("team"\);/);
  const home = read("pages/RoleHomePage.jsx");
  assertMatch(home, /<AgentPromptStrip routine="my_plate" \/>\s*<MyCardsPanels \/>/);
  assertMatch(home, /label="Drafts waiting"/);
  const panels = read("components/ops/TeamOpsPanels.jsx");
  for (const words of ["Runway", "Open calendar", "Open board", "Person", "Needs a person", "Agent closed", "Carried", "Copy prompt", "Turn next steps into cards", "Preview"]) {
    assert(panels.includes(words), words);
  }
  const mine = read("components/ops/MyCardsPanels.jsx");
  for (const words of ["My cards", "Watching", "Open Work board"]) assert(mine.includes(words), words);
});

Deno.test("#3980 W3 new ops components use tokens only, no overlay, and text that wraps", () => {
  for (const file of ["components/ops/LaunchPlanner.jsx", "components/ops/TeamOpsPanels.jsx", "components/ops/MyCardsPanels.jsx", "components/ops/revealDetail.js"]) {
    const src = read(file);
    assertNotMatch(src, /bg-white|text-black|["'\s(]#[0-9a-fA-F]{6}\b/, file);
    assertNotMatch(src, /from "[^"]*(Modal|Drawer)"/, file);
    assertNotMatch(src, /\btruncate\b/, file);
  }
});

Deno.test("#3980 W3 the next-step preview shows each card's title and why a record is skipped", () => {
  assertEquals(conversionIssue("duplicate_record")?.label, "Same name and next step as another record");
  assertEquals(conversionSelectable({ issue: "duplicate_record" }, "bo@usemingla.com"), false);
  assertEquals(
    conversionResultWords({ added: 4, skipped: 1, refused: 0 }),
    "Last convert: 4 added, 1 skipped because they are already a card, 0 not converted.",
  );
  assertEquals(conversionResultWords(null), "Last convert: 0 added, 0 skipped because they are already a card, 0 not converted.");
  const panels = read("components/ops/TeamOpsPanels.jsx");
  assertMatch(panels, /r\.proposed\?\.title \? `Card: \$\{r\.proposed\.title\}`/);
  assertMatch(panels, /\{r\.reason && <span[^>]*>\{r\.reason\}<\/span>\}/);
  assertMatch(panels, /\{preview\?\.totals\?\.skipped \|\| 0\} skipped/);
  assertMatch(panels, /\{conversionResultWords\(result\)\}/);
  assert(panels.includes("Each card is titled with the next step and the name"));
});
