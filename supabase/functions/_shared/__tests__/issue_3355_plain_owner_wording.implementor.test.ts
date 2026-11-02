// Issue #3355 bug 19 — Website setup text the owner sees (Ari's replies, card
// titles, bodies, labels, button labels, and messages sent as the owner's own
// bubble) is plain English: no snake_case keys, tool names or engine words
// ("re-audit", "checkpoint", "fingerprint", "part key", "gap chain",
// "durable job", "brand-context").
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_plain_owner_wording.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { AgentLoopObservation } from "../agentLoop.ts";
import {
  buildWebsiteSetupPresentation,
  detectWebsiteSetupIntent,
  WEBSITE_SETUP_FIX_ALL_MESSAGE,
  WEBSITE_SETUP_RETURN_MESSAGES,
  websiteSetupPlainKey,
  websiteSetupQuestion,
} from "../agentWebsiteSetup.ts";

const ROOT = new URL("../../../../", import.meta.url);
const BRAND_ID = "33550000-0000-4000-8000-000000000019";

/** Words the owner must never see. */
const INTERNAL_WORDING =
  /\b[a-z]+_[a-z0-9_]+\b|re-audit|\bcheckpoint|fingerprint|part key|gap chain|complete chain|durable job|brand[- ]context|get_site_plan|start_brand_completeness_job/i;

function observation(tool: string, result: unknown): AgentLoopObservation {
  return { tool, args: { brand_id: BRAND_ID }, result, elapsedMs: 1 };
}

// Synthetic plan; some keys have no label on purpose (fallbacks are shown).
const plan = {
  status: {
    done_count: 1,
    parts: [
      { key: "offer", done: true },
      { key: "first_offering", done: false },
      { key: "some_future_part", done: false },
    ],
  },
  completeness: {
    fields: [
      { key: "design_key", label: "Website design", requirement: "required", state: "missing" },
      { key: "story.who", requirement: "recommended", state: "missing" },
      { key: "contact_phone", requirement: "recommended", state: "stale" },
      {
        key: "profile_photo",
        label: "Brand logo",
        requirement: "recommended",
        state: "missing",
        human_action_required: true,
      },
      {
        key: "brand_badge",
        requirement: "recommended",
        state: "missing",
        human_action_required: true,
      },
    ],
  },
};

const NON_TEXT_KEYS = new Set([
  "id",
  "rendition_id",
  "kind",
  "type",
  "route",
  "graphic",
  "tone",
  "state",
  "style",
  "selection",
  "schema_version",
  "version",
  "placeholder_kind",
]);

/** Every string the owner can read in a presentation. */
function ownerStrings(value: unknown, key = "", out: string[] = []): string[] {
  if (typeof value === "string") {
    if (!NON_TEXT_KEYS.has(key)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) ownerStrings(item, key, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) ownerStrings(v, k, out);
  }
  return out;
}

function assertPlain(strings: string[], where: string): void {
  // A structured "Use my answer for …" submission is rewritten into the
  // owner's words by the Host before it shows (friendlyWebsiteSetupAnswer),
  // so its wire format is not owner text.
  const visible = strings.filter((s) => !/^Use my answer for /.test(s));
  assert(visible.length > 0, `${where}: nothing to check`);
  for (const text of visible) {
    assert(!INTERNAL_WORDING.test(text), `${where}: internal wording in "${text}"`);
  }
}

Deno.test("#3355 bug 19: the Website setup audit reads in plain English", () => {
  for (const withGaps of [true, false]) {
    const read = withGaps
      ? plan
      : { ...plan, completeness: { fields: [] } };
    const presentation = buildWebsiteSetupPresentation(
      "audit",
      [observation("get_site_plan", read)],
      "Coast Walks",
      BRAND_ID,
    );
    assert(presentation);
    assertPlain(ownerStrings(presentation), `audit (gaps: ${withGaps})`);
  }
});

Deno.test("#3355 bug 19: every Fix-all step Ari presents reads in plain English", () => {
  for (const current of ["design_key", "story.who", "contact_phone", "profile_photo", "brand_badge", "approved_plan"]) {
    const presentation = buildWebsiteSetupPresentation(
      "fix_all",
      [
        observation("get_site_plan", plan),
        observation("start_brand_completeness_job", {
          resumed: true,
          job: {
            status: "running",
            pending_step_keys: [current],
            completed_step_keys: ["name"],
            checkpoint: { current_step: current },
          },
          completeness: plan.completeness,
        }),
      ],
      "Coast Walks",
      BRAND_ID,
    );
    assert(presentation);
    assertPlain(ownerStrings(presentation), `fix_all step ${current}`);
  }
  const done = buildWebsiteSetupPresentation(
    "fix_all",
    [
      observation("get_site_plan", plan),
      observation("start_brand_completeness_job", {
        job: { status: "completed", pending_step_keys: [], completed_step_keys: ["name"] },
        completeness: plan.completeness,
      }),
    ],
    "Coast Walks",
    BRAND_ID,
  );
  assert(done);
  assertPlain(ownerStrings(done), "fix_all complete");
  assertPlain(
    [websiteSetupQuestion("brand_badge", { human_action_required: true, label: "Badge" })],
    "upload question",
  );
});

Deno.test("#3355 bug 19: messages sent as the owner's own bubble are plain and still reach the right job", () => {
  assertPlain(
    [WEBSITE_SETUP_FIX_ALL_MESSAGE, ...Object.values(WEBSITE_SETUP_RETURN_MESSAGES)],
    "owner bubbles",
  );
  assertEquals(detectWebsiteSetupIntent(WEBSITE_SETUP_FIX_ALL_MESSAGE), "fix_all");
  // The Host's "Fix all gaps with Ari" button sends the same words.
  const screen = Deno.readTextFileSync(
    new URL("mingla-business/src/screens/ari/AriChatScreen.tsx", ROOT),
  );
  assert(screen.includes(JSON.stringify(WEBSITE_SETUP_FIX_ALL_MESSAGE)));
  const handleSends = [...screen.matchAll(/handleSend\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/g)]
    .map((match) => match[1]);
  assert(handleSends.length >= 2, "the setup pane's two buttons");
  assertPlain(handleSends, "Ari screen owner bubbles");
});

Deno.test("#3355 bug 19: a key with no label reads as words", () => {
  assertEquals(websiteSetupPlainKey("first_offering"), "First offering");
  assertEquals(websiteSetupPlainKey("story.who"), "Story who");
  assertEquals(websiteSetupPlainKey(""), "Website detail");
});
