/*
 * Issue #4572 item 17 — "relabel the header button" can never rename a menu item.
 *
 * Kolanut (agent_messages, brand b8a7c337, 2026-11-23 18:23:55): the owner
 * wrote "change the red button's words from Tckets to RSVP, still linking to
 * the events page", and Ari answered with ONE set_menu step that renamed the
 * Events menu item to RSVP (it had no header-button step and could not see the
 * button). Now:
 *   - set_header_button and set_logo are step types, shaped exactly;
 *   - the menu's own description says it is never the header button;
 *   - a change set for a header-button request that sets the menu without a
 *     set_header_button step is refused with the sentence that names the step.
 *
 * Fails on revert: without the two ops, `set_header_button` is "step.op must
 * be one of …"; without siteHeaderButtonProblem the Kolanut plan is accepted.
 *
 * Run: deno test --no-check --allow-read --allow-env \
 *   supabase/functions/_shared/__tests__/issue_4572_ari_header_button.test.ts
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  SITE_STEP_OPS,
  SITE_WORKSPACE_PROMPT_RULES,
  siteChangeSetProblem,
  siteHeaderButtonProblem,
  siteStepProblem,
  siteStepWritesWords,
} from "../agentSiteWorkspaceTools.ts";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { PROMPT_VERSION } from "../agentSystemPrompt.ts";

const BRAND = "b8a7c337-0000-4000-8000-000000000001";
const SITE = "d9656ffd-0000-4000-8000-000000000002";
const EVENTS_PAGE = "a718b05b-0000-4000-8000-000000000003";
const KOLANUT = "change the red button's words from Tckets to RSVP, still linking to the events page";
const CITES = [{ kind: "owner_words", quote: KOLANUT }];

const changeSet = (steps: Array<Record<string, unknown>>, request = KOLANUT) => ({
  brand_id: BRAND,
  site_id: SITE,
  request,
  summary: "Change the red button to RSVP",
  steps: steps.map((step) => ({ label: "Change the button", why: "The owner asked.", cites: CITES, step })),
});

// What Ari proposed for Kolanut: the menu, with the Events item renamed.
const KOLANUT_PLAN_STEP = {
  op: "set_menu",
  items: [
    { page_id: "e1000000-0000-4000-8000-000000000001", label: "Exhibitions" },
    { page_id: EVENTS_PAGE, label: "RSVP" },
    { page_id: "e1000000-0000-4000-8000-000000000002", label: "About" },
  ],
};

Deno.test("#4572 item 17: the header button and the logo are step types", () => {
  assert((SITE_STEP_OPS as readonly string[]).includes("set_header_button"));
  assert((SITE_STEP_OPS as readonly string[]).includes("set_logo"));
  assertEquals(siteStepProblem({ op: "set_header_button", button_label: "RSVP" }), null);
  assertEquals(siteStepProblem({ op: "set_header_button", button_label: "RSVP", page_id: EVENTS_PAGE }), null);
  assertEquals(siteStepProblem({ op: "set_logo", media_id: "f0000000-0000-4000-8000-000000000001" }), null);
  assertEquals(siteStepProblem({ op: "set_logo", media_id: null }), null);
  assertMatch(siteStepProblem({ op: "set_header_button" }) ?? "", /button_label/);
  assertMatch(siteStepProblem({ op: "set_header_button", button_label: "R".repeat(200) }) ?? "", /button_label/);
  assertMatch(siteStepProblem({ op: "set_header_button", button_label: "RSVP", items: [] }) ?? "", /does not take items/);
  assertMatch(siteStepProblem({ op: "set_logo", media_id: "logo.png" }) ?? "", /media_id/);
  // New words on the button say what they are based on.
  assert(siteStepWritesWords({ op: "set_header_button", button_label: "RSVP" }));
});

Deno.test("#4572 item 17: the tool text tells the menu and the header button apart", () => {
  const tool = SITE_AGENT_TOOLS.find((entry) => entry.name === "propose_site_change_set");
  assert(tool, "propose_site_change_set is declared");
  const text = JSON.stringify(tool);
  assertStringIncludes(text, "never changes the header button: use set_header_button");
  assertStringIncludes(text, "set_header_button: button_label");
  assertStringIncludes(SITE_WORKSPACE_PROMPT_RULES, "never rename a menu item for it");
  assertEquals(PROMPT_VERSION, "v42"); // #4599 confirm-before-claim rules on top of v41
});

Deno.test("#4572 item 17: the Kolanut plan (menu only) is sent back; the header-button plan passes", () => {
  const refused = siteChangeSetProblem(changeSet([KOLANUT_PLAN_STEP]));
  assert(refused !== null, "a header-button request answered with only a menu change is refused");
  assertStringIncludes(refused!, "set_header_button");
  assertEquals(siteChangeSetProblem(changeSet([{ op: "set_header_button", button_label: "RSVP" }])), null);
  // Both, when the owner asked for both, is fine.
  assertEquals(siteChangeSetProblem(changeSet([{ op: "set_header_button", button_label: "RSVP" }, KOLANUT_PLAN_STEP])), null);
});

Deno.test("#4572 item 17: a real menu request still sets the menu", () => {
  assertEquals(siteChangeSetProblem(changeSet([KOLANUT_PLAN_STEP], "rename Events in the menu to RSVP")), null);
  for (const request of ["the header button should say Book", "make the button at the top say RSVP", "change the big button to Tickets", "header CTA should say Join"]) {
    assert(siteHeaderButtonProblem(request, [{ step: KOLANUT_PLAN_STEP }]) !== null, request);
  }
  assertEquals(siteHeaderButtonProblem("change the menu", [{ step: KOLANUT_PLAN_STEP }]), null);
});
