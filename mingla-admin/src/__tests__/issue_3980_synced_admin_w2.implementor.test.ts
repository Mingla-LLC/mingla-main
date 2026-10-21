// Issue #3980 synced program, Wave 2 — the Admin side of the bridges: the
// status chip tones (D-15 words), the "Blocked until #n is Live" switch on a
// work card, the ticket's Engineering row, the Product Inbox using the bridge's
// word, roadmap links with GitHub's lane suggestion (applied only through the
// existing roadmap editor), the Feature Guide release line, and every new
// call going through the one ops_ caller.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  githubChipClass,
  githubChipTone,
  githubWaitWords,
  roadmapSuggestionWords,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));

Deno.test("#3980 W2: each D-15 word has its tone; unknown words read as checking", () => {
  const want: Record<string, string> = {
    Planned: "neutral", "In Progress": "info", "In Review": "warning", Shipped: "brand", Live: "success",
    "Not on GitHub": "error", "Checking GitHub": "checking", Open: "info", Merged: "brand", Closed: "neutral",
  };
  for (const [label, tone] of Object.entries(want)) assertEquals(githubChipTone(label), tone, label);
  assertEquals(githubChipTone("Anything else"), "checking");
  assertMatch(githubChipClass("Live"), /color-success-50/);
  assertMatch(githubChipClass("Checking GitHub"), /border-dashed/);
  for (const label of Object.keys(want)) assertEquals(/bg-white|text-black|#[0-9a-f]{3,6}/i.test(githubChipClass(label)), false, label);
});

Deno.test("#3980 W2: the wait switch and suggestion words", () => {
  assertEquals(githubWaitWords([{ number: 3980 }]), "Blocked until #3980 is Live");
  assertEquals(githubWaitWords([{ number: 1 }, { number: 2 }]), "Blocked until #1, #2 are Live");
  assertEquals(githubWaitWords([]), "");
  assertEquals(roadmapSuggestionWords({ lane: "next", reason: "GitHub: Horizon Next" }), "Next (Horizon Next)");
  assertEquals(roadmapSuggestionWords({ lane: "shipped", reason: "Live on 20 Oct" }), "Recently shipped (Live on 20 Oct)");
  assertEquals(roadmapSuggestionWords({ lane: "bogus" }), "");
});

Deno.test("#3980 W2: a work card's chips carry the tone, and people switch the GitHub wait", () => {
  const detail = read("components/ops/WorkDetail.jsx");
  assertMatch(detail, /githubChipClass\(g\.label\)/);
  assertMatch(detail, /role="switch"/);
  assertMatch(detail, /update\(\{ blocked_on_github: on \}/);
  assertMatch(detail, /card\.blocked_kind === "github"/);
});

Deno.test("#3980 W2: the ticket shows one Engineering row with loading, error and Live words", () => {
  const page = read("pages/SupportDeskPage.jsx");
  assertMatch(page, /fetchTicketEngineering/);
  assertMatch(page, /Engineering: \{data\.label\} · #\{n\}/);
  assertMatch(page, /Live: you can tell the host it is fixed\./);
  assertMatch(page, /Couldn't read engineering status\./);
  assertMatch(page, />Try again</);
  assertMatch(page, /if \(!data\?\.linked\) return null;/);
  assertMatch(page, /rel="noopener noreferrer"/);
});

Deno.test("#3980 W2: the Product Inbox uses the bridge's word when it has the issue", () => {
  const inbox = read("components/community/ProductInboxPanel.jsx");
  assertMatch(inbox, /\["Engineering", engineering \|\| selected\.item\.board_status \|\| "Todo"\]/);
  assertMatch(inbox, /item\?\.checked && !item\.not_found/);
});

Deno.test("#3980 W2: roadmap links and suggestions; apply goes through the existing editor, never a lane write", () => {
  const panel = read("components/community/RoadmapPanel.jsx");
  assertMatch(panel, /GitHub suggests: \{roadmapSuggestionWords\(suggestion\)\}/);
  assertMatch(panel, /Draft from GitHub/);
  assertMatch(panel, />Link issue</);
  assertMatch(panel, />Change</);
  assertMatch(panel, />Remove</);
  const apply = panel.slice(panel.indexOf("async function applySuggestion"), panel.indexOf("async function dismissSuggestion"));
  assertMatch(apply, /decideRoadmapSuggestion\(row\.id, "apply"\)/);
  assertMatch(apply, /upsertRoadmapCard\(\{/);
  assertMatch(apply, /status: row\.status/);
  assertEquals(/status: "published"/.test(panel), false);
});

Deno.test("#3980 W2: the Feature Guide shows what shipped an entry and what it still misses", () => {
  const guide = read("components/community/FeatureGuidePanel.jsx");
  assertMatch(guide, /Shipped by PR #\{shipped\.pr\} on/);
  assertMatch(guide, /Not Live yet: \{missing\.join\(", "\)\}/);
  assertMatch(guide, /fetchFeatureGuideRelease\(capabilityKey\)/);
});

Deno.test("#3980 W2: every new ops_ call lives in the one ops_ caller", () => {
  const service = read("services/opsService.js");
  for (const fn of ["ops_github_status_list", "ops_ticket_engineering", "ops_roadmap_links_list", "ops_roadmap_link_set",
    "ops_roadmap_suggestion_decide", "ops_release_records_list", "ops_feature_guide_release"]) {
    assert(service.includes(`"${fn}"`), fn);
    for (const file of ["pages/SupportDeskPage.jsx", "components/community/RoadmapPanel.jsx", "components/community/FeatureGuidePanel.jsx",
      "components/community/ProductInboxPanel.jsx", "components/ops/WorkDetail.jsx"]) {
      assertEquals(read(file).includes(`"${fn}"`), false, `${fn} in ${file}`);
    }
  }
});
