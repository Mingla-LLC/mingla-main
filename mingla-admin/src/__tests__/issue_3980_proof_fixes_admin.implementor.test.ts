// Issue #3980 synced program — fixes from the full proof pass (the Admin and
// repository side; the database side is
// supabase/migrations/__tests__/issue_3980_proof_fixes.implementor.pg17.test.sql):
//   P1-1  the #3526 model gate reads the GraphQL fixtures as text, so it is
//         green on the branch (its extension list has ".graphql")
//   P2-1  an old #/agent-log link opened fresh lands on Work > Agent activity
//         before any page is chosen, so nothing writes #/agent-log back
//   P2-2  a promised event's repeat changes in place on the host card
//   P2-3  a card counted from a repeating series names its next date that is
//         not live, with that date's plain state
//   P2-5  a host or creator card that has owners keeps at least one in the
//         people field, with the work card's words
//   P3    long single-word names, Work tabs at 375 px, calendar dot targets,
//         no "Mingla closed" notice for a guide card, staff entries never
//         drafted for hosts
import { assert, assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cardAnchorWords } from "../lib/opsModel.js";
import { removePerson } from "../lib/peopleField.js";
// #4130: App rewrites retired addresses through this map before the Agent log check.
import { redirectHash } from "../lib/adminRoutes.js";

const SRC = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const repo = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

// The source of one top-level `function <name>(...) { ... }` in a file.
function fnSource(text: string, name: string): string {
  const at = text.indexOf(`function ${name}(`);
  assert(at >= 0, `${name} is in the file`);
  let depth = 0;
  for (let i = text.indexOf("{", at); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error(`${name} never ends`);
}

Deno.test("#3980 P1-1: the #3526 model gate scans .graphql fixtures as text", () => {
  const gate = repo(".github/scripts/strict-grep/i-3526-gemini-model-single-source.mjs");
  const list = gate.slice(gate.indexOf("const SCANNED_EXTENSIONS = ["), gate.indexOf("];", gate.indexOf("const SCANNED_EXTENSIONS = [")));
  assertMatch(list, /"\.graphql"/);
  const fixtures = [...Deno.readDirSync(new URL("supabase/functions/_shared/__tests__/fixtures/issue_3980_follow_query/", ROOT))]
    .map((e) => e.name).filter((n) => n.endsWith(".graphql"));
  assert(fixtures.length >= 1, "the GraphQL fixtures the gate must see are there");
});

Deno.test("#3980 P2-1: a fresh #/agent-log lands on Work > Agent activity before a page is chosen", () => {
  const app = read("App.jsx");
  const redirect = read("pages/AgentLogPage.jsx").match(/export const AGENT_LOG_REDIRECT = "([^"]+)"/)?.[1];
  assertEquals(redirect, "#/work-board?tab=activity");
  const body = `${fnSource(app, "requestedPageId")}\n${fnSource(app, "canonicalizeLegacyCommunityHashes")}\n` +
    "canonicalizeLegacyCommunityHashes(); return window.location.hash;";
  const run = (hash: string) => {
    const location = { hash, pathname: "/", search: "" };
    const window = { location, history: { replaceState: (_s: unknown, _t: string, url: string) => { location.hash = url; } } };
    return new Function("window", "AGENT_LOG_REDIRECT", "redirectHash", body)(window, redirect, redirectHash) as string;
  };
  assertEquals(run("#/agent-log"), "#/work-board?tab=activity");
  assertEquals(run("#/agent-log?card=1"), "#/work-board?tab=activity");
  // #4130 Wave 6: #/support is a page again; the old console redirects by tab.
  assertEquals(run("#/support"), "#/support");
  assertEquals(run("#/community-support?tab=support"), "#/support");
  assertEquals(run("#/work-board?tab=board"), "#/work-board?tab=board");
  // The address is read through getTabFromHash, which canonicalizes first.
  assertMatch(fnSource(app, "getTabFromHash"), /canonicalizeLegacyCommunityHashes\(\);[\s\S]*requestedPageId\(\)/);
  assertMatch(app, /import \{ AGENT_LOG_REDIRECT, AgentLogPage \} from "\.\/pages\/AgentLogPage";/);
});

Deno.test("#3980 P2-2: a promised event's repeat changes in place, never by cancelling", () => {
  const section = code("components/crm/OnMinglaSection.jsx");
  assertMatch(section, /ops\.setExpectedEvent\(\{ record_id: id, id: x\.id, repeats \}, requestKey\("web_expected_repeats"\)\)/);
  assertMatch(section, /onChange=\{\(e\) => changeRepeats\(u\.row, e\.target\.value\)\}/);
  assertMatch(section, /options=\{REPEAT_OPTIONS\}\s*value=\{u\.row\.repeats \|\| "none"\}/);
  assertMatch(section, /Couldn’t change how often it repeats/);
});

Deno.test("#3980 P2-3: the counted-from line of a series names its next date that is not live", () => {
  const series = cardAnchorWords({
    kind: "expected", title: "Supper Club", start_on: "2026-10-31", series: true, is_public: false,
    runway: { band: "late" }, state: { k: "notlive", name: "Not live yet", by: "2026-10-03" },
  });
  assertEquals(series?.lead, "Next date to publish:");
  assertEquals(series?.title, "Supper Club");
  assertMatch(series!.rest, /31 Oct · Not live yet, live by 3 Oct$/);
  assertNotMatch(series!.rest, /Too late for promo/);
  const live = cardAnchorWords({ kind: "event", title: "Supper Club live", start_on: "2026-10-24", series: true, is_public: true,
    series_title: "Supper Club", state: { k: "ready", name: "Ready to promote" } });
  assertEquals(live?.lead, "Next date, live:");
  assertMatch(live!.rest, /Ready to promote$/);
  const oneOff = cardAnchorWords({ kind: "event", title: "Rooftop", start_on: "2026-11-20", runway: { band: "full", lead_days: 40 } });
  assertEquals(oneOff?.lead, "Counted from");
  assertEquals(cardAnchorWords(null), null);
  const detail = code("components/ops/WorkDetail.jsx");
  assertMatch(detail, /const anchorWords = cardAnchorWords\(card\.anchor\);/);
  assertNotMatch(detail, /runwayLabel\(card\.anchor\.runway\)/);
});

Deno.test("#3980 P2-5: a host or creator card that has owners keeps one in the people field", () => {
  assertMatch(code("components/crm/OwnersField.jsx"), /export function OwnersField\(\{ team, value, onChange, disabled = false, labelId, min = 0 \}\)/);
  assertMatch(code("components/crm/OwnersField.jsx"), /<PeopleField[\s\S]*min=\{min\}/);
  assertMatch(code("components/crm/RecordDrawer.jsx"), /<OwnersField[\s\S]*min=\{\(record\.owners \|\| \[\]\)\.length \? 1 : 0\}[\s\S]*onChange=\{\(owners\) => save\("owners", owners\)\}/);
  // The field's own rule with min 1: the last owner stays, with the words.
  const r = removePerson(["ada@x.test"], "ada@x.test", 1);
  assertEquals(r.value, ["ada@x.test"]);
  assertEquals(r.refused, "A card always keeps one owner. Add someone else first, then remove this one.");
});

Deno.test("#3980 P3: names, tabs, calendar targets, guide notices and staff drafts", () => {
  // P3-1: one long word is cut inside the chip with the full name on hover.
  assertMatch(code("components/people/PeopleField.jsx"), /<span title=\{name\} className="min-w-0 truncate">\{name\}<\/span>/);
  // P3-2: the Work tabs wrap at 375 px instead of running off the screen.
  // #4130: the Work views (Board, Today, This week, This month) still wrap at 375 px.
  assertMatch(code("pages/WorkBoardPage.jsx"), /<Segmented label="Work view" wrap /);
  // P3-3: the narrow calendar's dot button is a 44 px target.
  assertMatch(code("pages/ContentCalendarPage.jsx"), /data-calendar-day-dense=\{key\}[\s\S]*?-mx-1 flex min-h-11 w-\[calc\(100%\+0\.5rem\)\]/);
  // P3-5 and P3-8, in the migrations.
  const w1 = repo("supabase/migrations/20271129003980_issue_3980_synced_w1_foundations.sql");
  assertMatch(w1, /IF c\.auto_key IS NULL OR split_part\(c\.auto_key, ':', 1\) <> 'guide_live' THEN\s+PERFORM public\.ops_notify_people\(c\.id, v_event, public\.ops_card_people\(c\.id, NULL\), c_actor, format\('Mingla closed:/);
  const w2 = repo("supabase/migrations/20271130003980_issue_3980_synced_w2_bridges.sql");
  assertMatch(w2, /JOIN public\.product_capabilities pc ON pc\.capability_key = f\.k[\s\S]{0,200}WHERE pc\.capability_key NOT LIKE 'staff-%';/);
});
