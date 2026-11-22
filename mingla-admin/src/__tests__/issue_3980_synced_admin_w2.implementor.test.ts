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
  assertNotMatch,
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

// [TEST-MOD #4420] the Engineering row lived in the Support thread's Product box.
// The chat inbox has no Product box (a linked Work ticket shows its GitHub issue
// on the Work card), so the row is retired from TicketPanel. The Product board
// card panel keeps its own Engineering line (next test).
Deno.test("#3980 W2: the Support thread no longer carries a Product box or an Engineering row", () => {
  const page = read("components/support/TicketPanel.jsx");
  assertNotMatch(page, /fetchTicketEngineering|EngineeringRow|ProductBox|onSendToProduct/);
});



// [TEST-MOD #4420] two tests left with the deleted Product board card panel and Roadmap panel.
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
    // [TEST-MOD #4420] RoadmapPanel, ProductInboxPanel and ProductCardPanel were
    // deleted (Roadmap screen and Product board retired); the ticket GitHub
    // section that replaced the board's card is checked in their place.
    for (const file of ["pages/SupportDeskPage.jsx", "components/support/TicketPanel.jsx", "components/community/FeatureGuidePanel.jsx",
      "components/ops/TicketGithubSection.jsx", "components/ops/WorkDetail.jsx"]) {
      assertEquals(read(file).includes(`"${fn}"`), false, `${fn} in ${file}`);
    }
  }
});
