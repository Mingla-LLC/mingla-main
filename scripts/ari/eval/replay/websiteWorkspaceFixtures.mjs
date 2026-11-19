/**
 * #4453 Website workspace — scripted owner requests for the replay harness.
 *
 * Each fixture is one owner request sent from the Website workspace's Ari
 * panel against the SYNTHETIC brand "Harmattan Kitchen" (no real host, brand,
 * phone, email or address appears here). The CI replay
 * (supabase/functions/_shared/__tests__/issue_4453_website_workspace_replay.implementor.test.ts)
 * runs every turn through the shipped deterministic layers with a stub model
 * and a stub Core: the focus check, the draft snapshot pre-read, the loop and
 * its budget, the plan checks the model can repair (shape, plain labels, the
 * selected section's scope, ids that exist on the draft), the change-set
 * executor (one group, steps in order, rollback, design checks) and the
 * server's own follow-up line. No network, no model, no model key.
 *
 * Each turn has:
 *   - say: the owner's words;
 *   - focus: the selected section, or null for the whole website;
 *   - stub.model: what the model answers, in order (a tool call or a reply);
 *     more than one entry means the first was sent back for a repair;
 *   - stub.core: how the stub Core behaves when the plan is applied;
 *   - expect: what grade.mjs checks, plus `workspace` facts (see the test).
 */

export const WS_BRAND_ID = "733bc470-45e1-4684-8896-acd7e26074ff";
export const WS_SITE_ID = "11111111-1111-4111-8111-111111111111";
export const WS_MEDIA_TERRACE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const WS_MEDIA_KITCHEN = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const WS_RECORD_BRAND = WS_BRAND_ID;

const layouts = (...keys) => keys.map((key) => ({ key, label: key }));
const field = (key, label, value, kind = "text") => ({
  key,
  label,
  kind,
  value,
  max: null,
});

/** The draft Core's get_site_workspace returns in every replay. */
export const WORKSPACE_SNAPSHOT = {
  draft_digest: "d".repeat(64),
  pages: [
    {
      id: "pg_home",
      title: "Home",
      path: "",
      enabled: true,
      in_menu: true,
      sections: [
        {
          id: "sec_hero",
          index: 0,
          type: "hero",
          label: "Top of the page",
          layout: "split",
          layouts: layouts("split", "full", "centered"),
          review: { state: "reviewed", source: "person" },
          feed: false,
          fields: [
            field("heading", "Heading", "Welcome to Harmattan Kitchen, where the coals never go out"),
            field("body", "Text", "West African fire cooking in a small room.", "multiline"),
          ],
          media: [{ slot: "image", label: "Photo", media_id: WS_MEDIA_KITCHEN }],
          can_remove: false,
        },
        {
          id: "sec_story",
          index: 1,
          type: "story",
          label: "Our story",
          layout: "text_left",
          layouts: layouts("text_left", "text_right"),
          review: { state: "draft", source: "ari" },
          feed: false,
          fields: [
            field("heading", "Heading", "Our story"),
            field("body", "Text", "We started with one grill and a borrowed table.", "multiline"),
          ],
          media: [{ slot: "image", label: "Photo", media_id: null }],
          can_remove: true,
        },
        {
          id: "sec_reviews",
          index: 2,
          type: "reviews",
          label: "What guests say",
          layout: "cards",
          layouts: layouts("cards", "single"),
          review: { state: "reviewed", source: "person" },
          feed: false,
          fields: [field("heading", "Heading", "What guests say")],
          media: [],
          can_remove: true,
        },
        {
          id: "sec_faq",
          index: 3,
          type: "faq",
          label: "Questions",
          layout: "list",
          layouts: layouts("list", "two_column"),
          review: { state: "reviewed", source: "person" },
          feed: false,
          fields: [
            field("heading", "Heading", "Good to know"),
            field("items.0.question", "Question 1", "Do you take walk-ins?"),
            field("items.0.answer", "Answer 1", "Yes, at the bar.", "multiline"),
            field("items.1.question", "Question 2", "Is there parking?"),
            field("items.1.answer", "Answer 2", "Street parking only.", "multiline"),
            field("items.2.question", "Question 3", "Can I bring a cake?"),
            field("items.2.answer", "Answer 3", "Yes, tell us when you book.", "multiline"),
          ],
          media: [],
          can_remove: true,
        },
      ],
    },
    {
      id: "pg_about",
      title: "About",
      path: "about",
      enabled: true,
      in_menu: true,
      sections: [
        {
          id: "sec_about_intro",
          index: 0,
          type: "page_header",
          label: "Page heading",
          layout: "neutral",
          layouts: layouts("neutral", "image"),
          review: { state: "reviewed", source: "person" },
          feed: false,
          fields: [field("heading", "Heading", "About us")],
          media: [],
          can_remove: false,
        },
      ],
    },
    {
      id: "pg_events",
      title: "Events",
      path: "events",
      enabled: true,
      in_menu: true,
      sections: [
        {
          id: "sec_events_feed",
          index: 0,
          type: "offering_grid",
          label: "Upcoming events",
          layout: "grid",
          layouts: layouts("grid", "list"),
          review: null,
          feed: true,
          fields: [field("heading", "Heading", "Upcoming events")],
          media: [],
          can_remove: true,
        },
      ],
    },
  ],
  look: {
    design: "atelier",
    tokens: { colors: { action: "#b4451f", canvas: "#fbf7f1" } },
    fonts: { display: { family: "Fraunces" }, body: { family: "Inter" } },
    warnings: [],
  },
  menu: [
    { page_id: "pg_home", label: "Home" },
    { page_id: "pg_about", label: "About" },
    { page_id: "pg_events", label: "Events" },
  ],
  addable_section_types: [
    { type: "gallery", label: "Photo gallery", description: "A grid of photos" },
    { type: "faq", label: "Questions", description: "Questions and answers" },
    { type: "cta", label: "Call to action", description: "One line and a button" },
  ],
  media: [
    { id: WS_MEDIA_TERRACE, caption: "The terrace at dusk" },
    { id: WS_MEDIA_KITCHEN, caption: "The grill in the open kitchen" },
  ],
  facts: { brand_name: "Harmattan Kitchen", city: "Lagos", offerings: [] },
};

export const FOCUS_HERO = {
  page_id: "pg_home",
  page_path: "",
  section_id: "sec_hero",
  section_type: "hero",
  section_label: "Top of the page",
};
export const FOCUS_STORY = {
  page_id: "pg_home",
  page_path: "",
  section_id: "sec_story",
  section_type: "story",
  section_label: "Our story",
};

const words = (quote) => [{ kind: "owner_words", quote }];

/** A change-set call the stub model makes for `say`. */
function plan(say, summary, steps, couldnt) {
  return {
    call: {
      tool: "propose_site_change_set",
      args: {
        brand_id: WS_BRAND_ID,
        site_id: WS_SITE_ID,
        request: say,
        summary,
        steps: steps.map(([label, step, cites]) => ({
          label,
          why: "The owner asked for this.",
          cites: cites ?? words(say),
          step,
        })),
        ...(couldnt ? { couldnt } : {}),
      },
    },
  };
}

const NEVER_OVERCLAIMS = [
  "(?<!Nothing )\\b(?:is|are) (?:now )?(?:live|published)\\b",
  "\\bI(?:'ve|’ve| have)? published\\b",
];
const NO_JARGON = ["\\bblocks?\\b", "\\bvariants?\\b", "\\btokens?\\b", "\\brevisions?\\b"];

function applied(say, summary, steps, extra = {}) {
  return {
    say,
    focus: extra.focus ?? null,
    stub: { model: [plan(say, summary, steps, extra.couldnt)], core: extra.core ?? {} },
    confirm: true,
    expect: {
      route: "proposal:propose_site_change_set",
      proposal: { tool: "propose_site_change_set", args: { summary } },
      reply_must: extra.reply_must ?? ["on your draft", "Nothing is published"],
      reply_must_not: [...NEVER_OVERCLAIMS, ...NO_JARGON],
      workspace: {
        model_calls: 1,
        status: "applied",
        applied: steps.length,
        ops: steps.map(([, step]) => step.op),
        undo_called: false,
        ...(extra.workspace ?? {}),
      },
    },
  };
}

const HEADING_EDIT = {
  op: "edit_section",
  page_id: "pg_home",
  section_id: "sec_hero",
  edits: [{ key: "heading", value: "Fire cooking in the heart of Lagos" }],
};

export const WEBSITE_WORKSPACE_FIXTURES = [
  // --- every step type, one request each ---------------------------------
  {
    id: "ws_edit_words",
    source: "Step type edit_section (words).",
    turns: [applied(
      "Change the main heading to Fire cooking in the heart of Lagos",
      "Change the main heading",
      [["Change the main heading", HEADING_EDIT]],
    )],
  },
  {
    id: "ws_edit_layout",
    source: "Step type edit_section (layout only).",
    turns: [applied(
      "Put the photo on the right in Our story",
      "Move the story photo to the right",
      [["Use the photo-on-the-right layout", {
        op: "edit_section",
        page_id: "pg_home",
        section_id: "sec_story",
        layout: "text_right",
      }]],
    )],
  },
  {
    id: "ws_edit_list_item",
    source: "Step type edit_section (a list item's field key).",
    turns: [applied(
      "Change the cake question to Can we bring our own cake?",
      "Reword the cake question",
      [["Reword the third question", {
        op: "edit_section",
        page_id: "pg_home",
        section_id: "sec_faq",
        edits: [{ key: "items.2.question", value: "Can we bring our own cake?" }],
      }]],
    )],
  },
  {
    id: "ws_move_section",
    source: "Step type move_section.",
    turns: [applied(
      "Move the reviews above our story",
      "Move What guests say above Our story",
      [["Move What guests say up", {
        op: "move_section",
        page_id: "pg_home",
        section_id: "sec_reviews",
        to_index: 1,
      }]],
    )],
  },
  {
    id: "ws_remove_section",
    source: "Step type remove_section.",
    turns: [applied(
      "Remove the questions section from the home page",
      "Remove Questions from Home",
      [["Remove the Questions section", {
        op: "remove_section",
        page_id: "pg_home",
        section_id: "sec_faq",
      }]],
    )],
  },
  {
    id: "ws_add_section_after",
    source: "Step type add_section (after a section, with first words).",
    turns: [applied(
      "Add a photo gallery under our story called A night at Harmattan",
      "Add a photo gallery under Our story",
      [["Add a photo gallery", {
        op: "add_section",
        page_id: "pg_home",
        type: "gallery",
        after_section_id: "sec_story",
        edits: [{ key: "heading", value: "A night at Harmattan" }],
      }]],
    )],
  },
  {
    id: "ws_add_section_top",
    source: "Step type add_section (top of the page: no after_section_id).",
    turns: [applied(
      "Add a call to action at the very top of the About page",
      "Add a call to action at the top of About",
      [["Add a call to action", { op: "add_section", page_id: "pg_about", type: "cta" }]],
    )],
  },
  {
    id: "ws_set_section_media",
    source: "Step type set_section_media (an approved photo).",
    turns: [applied(
      "Use the terrace photo in Our story",
      "Use the terrace photo in Our story",
      [["Set the story photo", {
        op: "set_section_media",
        page_id: "pg_home",
        section_id: "sec_story",
        slot: "image",
        media_id: WS_MEDIA_TERRACE,
      }, [{ kind: "owner_material", media_id: WS_MEDIA_TERRACE }]]],
    )],
  },
  {
    id: "ws_set_look_colours",
    source: "Step type set_look (colours).",
    turns: [applied(
      "Make the main colour a deep green, #1f5a3c",
      "Change the main colour to deep green",
      [["Change the main colour", {
        op: "set_look",
        tokens: { colors: { action: "#1f5a3c" } },
      }]],
    )],
  },
  {
    id: "ws_set_look_fonts",
    source: "Step type set_look (fonts).",
    turns: [applied(
      "Use Playfair Display for headings",
      "Change the heading font",
      [["Change the heading font", {
        op: "set_look",
        fonts: { display: { family: "Playfair Display" } },
      }]],
    )],
  },
  {
    id: "ws_set_look_shape_motion",
    source: "Step type set_look (corners, buttons, motion).",
    turns: [applied(
      "Rounder corners, pill buttons and calmer motion please",
      "Soften corners, buttons and motion",
      [["Soften the corners, buttons and motion", {
        op: "set_look",
        radius: "soft",
        button_shape: "pill",
        motion: "calm",
      }]],
    )],
  },
  {
    id: "ws_set_menu",
    source: "Step type set_menu.",
    turns: [applied(
      "Put Events before About in the menu and call it What's on",
      "Reorder the menu",
      [["Reorder the menu", {
        op: "set_menu",
        items: [
          { page_id: "pg_home", label: "Home" },
          { page_id: "pg_events", label: "What's on" },
          { page_id: "pg_about", label: "About" },
        ],
      }]],
    )],
  },
  {
    id: "ws_set_page_enabled",
    source: "Step type set_page_enabled.",
    turns: [applied(
      "Turn the Events page off for now",
      "Turn the Events page off",
      [["Turn the Events page off", {
        op: "set_page_enabled",
        page_id: "pg_events",
        enabled: false,
      }]],
    )],
  },
  // --- one request, one plan ----------------------------------------------
  {
    id: "ws_three_steps_one_plan",
    source: "One request with three parts becomes one plan, one undo group.",
    turns: [applied(
      "Shorten the welcome to Fire cooking in the heart of Lagos, move reviews up, and use the terrace photo in our story",
      "Shorten the welcome, move reviews up, new story photo",
      [
        ["Shorten the welcome heading", HEADING_EDIT],
        ["Move What guests say up", {
          op: "move_section",
          page_id: "pg_home",
          section_id: "sec_reviews",
          to_index: 1,
        }],
        ["Set the story photo", {
          op: "set_section_media",
          page_id: "pg_home",
          section_id: "sec_story",
          slot: "image",
          media_id: WS_MEDIA_TERRACE,
        }],
      ],
      { workspace: { one_group: true, events: 6 } },
    )],
  },
  {
    id: "ws_eight_steps_fit",
    source: "The largest plan (eight steps) applies inside the confirm budget.",
    turns: [applied(
      "Reword all three questions and answers, the questions heading and the story heading",
      "Reword the questions and the story heading",
      [
        ...[0, 1, 2].flatMap((n) => [
          [`Reword question ${n + 1}`, {
            op: "edit_section",
            page_id: "pg_home",
            section_id: "sec_faq",
            edits: [{ key: `items.${n}.question`, value: `Question ${n + 1}, reworded?` }],
          }],
          [`Reword answer ${n + 1}`, {
            op: "edit_section",
            page_id: "pg_home",
            section_id: "sec_faq",
            edits: [{ key: `items.${n}.answer`, value: "Reworded answer." }],
          }],
        ]),
        ["Reword the questions heading", {
          op: "edit_section",
          page_id: "pg_home",
          section_id: "sec_faq",
          edits: [{ key: "heading", value: "Before you come" }],
        }],
        ["Reword the story heading", {
          op: "edit_section",
          page_id: "pg_home",
          section_id: "sec_story",
          edits: [{ key: "heading", value: "How we started" }],
        }],
      ],
      { reply_must: ["All 8 changes are on your draft"] },
    )],
  },
  // --- the selected section -------------------------------------------------
  {
    id: "ws_scoped_this_section",
    source: "Scoped request: \"this\" is the selected section.",
    turns: [applied(
      "Make this shorter: Fire cooking in the heart of Lagos",
      "Shorten this heading",
      [["Shorten the heading", HEADING_EDIT]],
      { focus: FOCUS_HERO, workspace: { context_names: "Top of the page" } },
    )],
  },
  {
    id: "ws_scoped_repair_outside_step",
    source: "Scoped request: a plan that also touches another section is sent back and repaired.",
    turns: [{
      say: "Tighten the text here to: We started with one grill.",
      focus: FOCUS_STORY,
      stub: {
        model: [
          plan("Tighten the text here to: We started with one grill.", "Tighten the story", [
            ["Tighten the story text", {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_story",
              edits: [{ key: "body", value: "We started with one grill." }],
            }],
            ["Tidy the top heading too", HEADING_EDIT],
          ]),
          plan("Tighten the text here to: We started with one grill.", "Tighten the story", [
            ["Tighten the story text", {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_story",
              edits: [{ key: "body", value: "We started with one grill." }],
            }],
          ]),
        ],
        core: {},
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        reply_must: ["on your draft"],
        reply_must_not: NEVER_OVERCLAIMS,
        workspace: {
          model_calls: 2,
          bounced: ["OUTSIDE_SELECTED_SECTION"],
          status: "applied",
          applied: 1,
          only_section: "sec_story",
        },
      },
    }],
  },
  {
    id: "ws_scoped_whole_site_ask",
    source: "Scoped request: a whole-site ask from a section card is not applied; Ari says where to ask.",
    turns: [{
      say: "Change the whole site to dark green",
      focus: FOCUS_HERO,
      stub: {
        model: [
          plan("Change the whole site to dark green", "Change the main colour", [
            ["Change the main colour", { op: "set_look", tokens: { colors: { action: "#1f5a3c" } } }],
          ]),
          {
            text:
              "That changes the whole website, not just Top of the page. Ask me from the main Ari panel and I'll set it up.",
          },
        ],
      },
      expect: {
        route: "text",
        reply_must: ["whole website", "Ari panel"],
        reply_must_not: NEVER_OVERCLAIMS,
        workspace: { model_calls: 2, bounced: ["OUTSIDE_SELECTED_SECTION"], core_writes: 0 },
      },
    }],
  },
  // --- a missing fact is a question, never a guess -------------------------
  {
    id: "ws_missing_hours_question",
    source: "A missing venue fact (opening hours): one question with tappable choices.",
    turns: [{
      say: "Add our opening hours to the questions",
      focus: null,
      stub: {
        model: [{
          text:
            "I don't have your opening hours. What are they?\nChoices: Every day, noon to late | Tuesday to Sunday | I'll type them",
        }],
      },
      expect: {
        route: "text",
        reply_must: ["opening hours", "\\?"],
        reply_must_not: ["Choices:", "\\b\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)\\b", ...NEVER_OVERCLAIMS],
        workspace: { model_calls: 1, question_options: 3, core_writes: 0 },
      },
    }],
  },
  {
    id: "ws_missing_price_question",
    source: "A missing price: Ari asks and never writes a number of its own.",
    turns: [{
      say: "Add a line saying how much the tasting menu costs",
      focus: FOCUS_STORY,
      stub: {
        model: [{
          text:
            "I don't have a price for the tasting menu. How much is it?\nChoices: I'll type the price | Leave the price off",
        }],
      },
      expect: {
        route: "text",
        reply_must: ["price", "\\?"],
        reply_must_not: ["[₦$£€]\\s?\\d", "\\b\\d{2,}\\b", "Choices:"],
        workspace: { model_calls: 1, question_options: 2, core_writes: 0 },
      },
    }],
  },
  // --- what it cannot do -----------------------------------------------------
  {
    id: "ws_cannot_do_team_request",
    source: "Cannot do → the request to the Mingla team, sent on confirm.",
    turns: [{
      say: "Add a gift card shop to my website",
      focus: null,
      stub: {
        model: [{
          call: {
            tool: "propose_website_team_request",
            args: {
              brand_id: WS_BRAND_ID,
              site_id: WS_SITE_ID,
              what: "A page where guests can buy gift cards for Harmattan Kitchen.",
              where: { page_path: "" },
              why: "Add a gift card shop to my website",
              missing_capability: "The website cannot sell gift cards yet.",
            },
          },
        }],
        core: {},
      },
      confirm: true,
      expect: {
        route: "proposal:propose_website_team_request",
        proposal: {
          tool: "propose_website_team_request",
          args: { missing_capability: "The website cannot sell gift cards yet." },
        },
        reply_must: ["Mingla team", "24 hours"],
        reply_must_not: NEVER_OVERCLAIMS,
        workspace: { model_calls: 1, team_request: true, core_writes: 0 },
      },
    }],
  },
  {
    id: "ws_scoped_team_request",
    source: "Cannot do, from a section card: the request names the section.",
    turns: [{
      say: "Make this a video that plays behind the heading with sound",
      focus: FOCUS_HERO,
      stub: {
        model: [{
          call: {
            tool: "propose_website_team_request",
            args: {
              brand_id: WS_BRAND_ID,
              site_id: WS_SITE_ID,
              what: "A background video with sound behind the top heading.",
              where: { page_path: "", section_id: "sec_hero", section_label: "Top of the page" },
              why: "Make this a video that plays behind the heading with sound",
              missing_capability: "Background videos on the website play without sound.",
            },
          },
        }],
        core: {},
      },
      confirm: true,
      expect: {
        route: "proposal:propose_website_team_request",
        reply_must: ["Mingla team"],
        workspace: { model_calls: 1, team_request: true, team_where_section: "sec_hero" },
      },
    }],
  },
  {
    id: "ws_part_done_part_not",
    source: "Part of a request can be done; the rest is said plainly in couldnt.",
    turns: [applied(
      "Shorten the welcome to Fire cooking in the heart of Lagos and add a live Instagram feed",
      "Shorten the welcome heading",
      [["Shorten the welcome heading", HEADING_EDIT]],
      {
        couldnt: [{
          what: "A live Instagram feed",
          why: "The website cannot show a live social feed yet.",
        }],
        reply_must: ["on your draft", "could not do one part"],
        workspace: { couldnt: 1 },
      },
    )],
  },
  // --- failure, rollback, a stale draft -------------------------------------
  {
    id: "ws_failing_step_full_rollback",
    source: "Step 2 of 3 is refused: the whole plan is put back; the reply names the step.",
    turns: [{
      say: "Shorten the welcome, set the story layout to stacked, and move reviews up",
      focus: null,
      stub: {
        model: [plan(
          "Shorten the welcome, set the story layout to stacked, and move reviews up",
          "Shorten the welcome, restyle the story, move reviews",
          [
            ["Shorten the welcome heading", HEADING_EDIT],
            ["Use the stacked layout for Our story", {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_story",
              layout: "stacked",
            }],
            ["Move What guests say up", {
              op: "move_section",
              page_id: "pg_home",
              section_id: "sec_reviews",
              to_index: 1,
            }],
          ],
        )],
        core: {
          fail: {
            index: 1,
            code: "VARIANT_NOT_IN_DESIGN",
            message: "This design does not draw that layout for this section.",
          },
        },
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        reply_must: ["Step 2 of 3", "Use the stacked layout for Our story", "Nothing was changed"],
        reply_must_not: ["on your draft, ready", ...NEVER_OVERCLAIMS, "VARIANT_NOT_IN_DESIGN"],
        workspace: {
          model_calls: 1,
          status: "rolled_back",
          applied: 0,
          failed_index: 1,
          undo_called: true,
          checks_ran: false,
          last_event: "site_step_failed",
        },
      },
    }],
  },
  {
    id: "ws_first_step_refused",
    source: "The first step is refused: nothing was applied, so nothing needs undoing.",
    turns: [{
      say: "Remove the top section of the home page",
      focus: null,
      stub: {
        model: [plan("Remove the top section of the home page", "Remove the top of the page", [
          ["Remove the top of the page", {
            op: "remove_section",
            page_id: "pg_home",
            section_id: "sec_hero",
          }],
        ])],
        core: {
          fail: {
            index: 0,
            code: "SECTION_CANNOT_BE_REMOVED",
            message: "Every home page keeps its top section.",
          },
        },
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        reply_must: ["Step 1 of 1", "Every home page keeps its top section", "Nothing was changed"],
        workspace: { status: "rolled_back", applied: 0, failed_index: 0, undo_called: false },
      },
    }],
  },
  {
    id: "ws_stale_draft_retry",
    source: "The draft moved under a step (the owner typed): the step is asked once more and applies.",
    turns: [applied(
      "Change the main heading to Fire cooking in the heart of Lagos and move reviews up",
      "Change the heading and move reviews up",
      [
        ["Change the main heading", HEADING_EDIT],
        ["Move What guests say up", {
          op: "move_section",
          page_id: "pg_home",
          section_id: "sec_reviews",
          to_index: 1,
        }],
      ],
      {
        core: { stale_once: 1 },
        // Step 2 is asked twice: once refused as stale, once applied.
        workspace: {
          apply_calls: 3,
          ops: ["edit_section", "move_section", "move_section"],
        },
      },
    )],
  },
  {
    id: "ws_outage_mid_plan_honest",
    source: "Core stops answering mid-plan and the undo cannot be confirmed: Ari says so and points at Undo.",
    turns: [{
      say: "Change the main heading to Fire cooking in the heart of Lagos and move reviews up",
      focus: null,
      stub: {
        model: [plan(
          "Change the main heading to Fire cooking in the heart of Lagos and move reviews up",
          "Change the heading and move reviews up",
          [
            ["Change the main heading", HEADING_EDIT],
            ["Move What guests say up", {
              op: "move_section",
              page_id: "pg_home",
              section_id: "sec_reviews",
              to_index: 1,
            }],
          ],
        )],
        core: { down_from: 1 },
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        reply_must: ["Step 2 of 2", "may still be on your draft", "Undo"],
        reply_must_not: ["Nothing was changed", "All 2 changes", ...NEVER_OVERCLAIMS],
        workspace: { status: "partly_applied", failed_index: 1, undo_called: true },
      },
    }],
  },
  {
    id: "ws_checks_surface_warnings",
    source: "After the last step the design checks run; a warning is said, not hidden.",
    turns: [applied(
      "Make the main colour pale yellow, #fff3a6",
      "Change the main colour to pale yellow",
      [["Change the main colour", { op: "set_look", tokens: { colors: { action: "#fff3a6" } } }]],
      {
        core: { checks: "warn" },
        reply_must: ["on your draft", "design checks found 1 thing"],
        workspace: { checks_passed: false, warnings: 1 },
      },
    )],
  },
  // --- plans the model must repair before the owner sees them -------------
  {
    id: "ws_repair_invented_id",
    source: "A plan that names a section the draft does not have is sent back.",
    turns: [{
      say: "Change the heading on the team section to Meet the cooks",
      focus: null,
      stub: {
        model: [
          plan("Change the heading on the team section to Meet the cooks", "Change the team heading", [
            ["Change the team heading", {
              op: "edit_section",
              page_id: "pg_about",
              section_id: "sec_team",
              edits: [{ key: "heading", value: "Meet the cooks" }],
            }],
          ]),
          {
            text:
              "I can't find a team section on your draft. Which page should it go on?\nChoices: About | Home",
          },
        ],
      },
      expect: {
        route: "text",
        reply_must: ["team section", "\\?"],
        workspace: { model_calls: 2, bounced: ["UNKNOWN_SITE_ID"], question_options: 2, core_writes: 0 },
      },
    }],
  },
  {
    id: "ws_repair_jargon_label",
    source: "A step label in builder words is sent back and comes back in plain words.",
    turns: [{
      say: "Put the photo on the right in Our story",
      focus: null,
      stub: {
        model: [
          plan("Put the photo on the right in Our story", "Move the story photo to the right", [
            ["Switch block variant to text_right", {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_story",
              layout: "text_right",
            }],
          ]),
          plan("Put the photo on the right in Our story", "Move the story photo to the right", [
            ["Put the photo on the right", {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_story",
              layout: "text_right",
            }],
          ]),
        ],
        core: {},
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        reply_must: ["on your draft"],
        reply_must_not: NO_JARGON,
        workspace: { model_calls: 2, bounced: ["INVALID_ARGS"], status: "applied", applied: 1 },
      },
    }],
  },
  {
    id: "ws_repair_old_tool",
    source: "The one-card-per-change website tools are not taken from the workspace.",
    turns: [{
      say: "Change the main heading to Fire cooking in the heart of Lagos",
      focus: null,
      stub: {
        model: [
          {
            call: {
              tool: "propose_site_copy",
              args: {
                brand_id: WS_BRAND_ID,
                site_id: WS_SITE_ID,
                page_path: "",
                expected_revision: "r1",
                edits: [{ block_index: 0, field: "heading", value: "Fire cooking in the heart of Lagos" }],
                why: "The owner asked.",
                cites: words("Change the main heading to Fire cooking in the heart of Lagos"),
              },
            },
          },
          plan("Change the main heading to Fire cooking in the heart of Lagos", "Change the main heading", [
            ["Change the main heading", HEADING_EDIT],
          ]),
        ],
        core: {},
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        workspace: { model_calls: 2, bounced: ["WEBSITE_WORKSPACE_TOOL"], status: "applied" },
      },
    }],
  },
  {
    id: "ws_never_publishes",
    source: "Hard limit: asked to publish, Ari never calls a publish tool from the workspace.",
    turns: [{
      say: "Looks good, publish it",
      focus: null,
      stub: {
        model: [
          {
            call: {
              tool: "publish_site",
              args: {
                brand_id: WS_BRAND_ID,
                site_id: WS_SITE_ID,
                expected_revision: "r1",
                source_digest: "a".repeat(64),
                arguments_digest: "b".repeat(64),
              },
            },
          },
          { text: "Publishing is yours to do: tap Publish at the top right when you're ready." },
        ],
      },
      expect: {
        route: "text",
        not_route: ["proposal:publish_site"],
        reply_must: ["Publish"],
        reply_must_not: NEVER_OVERCLAIMS,
        workspace: { model_calls: 2, bounced: ["WEBSITE_WORKSPACE_TOOL"], core_writes: 0 },
      },
    }],
  },
  {
    id: "ws_repair_nine_steps",
    source: "More than eight steps is sent back; the plan comes back with eight and says what is left.",
    turns: [{
      say: "Reword every question, every answer, and all three headings on the home page",
      focus: null,
      stub: {
        model: [
          plan(
            "Reword every question, every answer, and all three headings on the home page",
            "Reword the home page",
            Array.from({ length: 9 }, (_, n) => [`Reword part ${n + 1}`, {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_faq",
              edits: [{ key: "heading", value: `Heading ${n + 1}` }],
            }]),
          ),
          plan(
            "Reword every question, every answer, and all three headings on the home page",
            "Reword the home page",
            Array.from({ length: 8 }, (_, n) => [`Reword part ${n + 1}`, {
              op: "edit_section",
              page_id: "pg_home",
              section_id: "sec_faq",
              edits: [{ key: "heading", value: `Heading ${n + 1}` }],
            }]),
            [{ what: "The story heading", why: "A plan holds eight steps; ask me again for this one." }],
          ),
        ],
        core: {},
      },
      confirm: true,
      expect: {
        route: "proposal:propose_site_change_set",
        reply_must: ["All 8 changes", "could not do one part"],
        workspace: { model_calls: 2, bounced: ["INVALID_ARGS"], status: "applied", applied: 8, couldnt: 1 },
      },
    }],
  },
];
