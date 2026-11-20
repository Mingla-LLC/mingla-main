// #4453 Website workspace — Ari's side (build contract section F).
//
// One owner request becomes ONE plan (`propose_site_change_set`): up to eight
// typed steps, each with its own plain label, reason and citations. When the
// plan is confirmed the steps are applied to the DRAFT in order through Core's
// `apply_site_change`, all under one change group (the pending action's id),
// so the owner undoes the whole request with one tap. If any step fails the
// group is rolled back through `undo_site_change_group`, so the draft is never
// left half-changed; the answer names the step and says why in plain words.
//
// Nothing here can publish. Core re-derives the caller's rank and the site's
// brand before it signs anything for Studio, and Studio checks every step
// (citations, claims, layouts, media, readable colours) again.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type {
  AgentToolDefinition,
  AgentToolExecutionContext,
} from "./agentToolHelpers.ts";
import {
  isUuid,
  requireAgentOperationId,
  ToolError,
} from "./agentToolHelpers.ts";
import { assertAgentReadBrand } from "./agentTenantScope.ts";
import {
  fontChoicesSchema,
  MAX_WORK_LOG_DECISION,
  schemaProblems,
  tokenOverridesSchema,
  workLogCitesProblem,
  workLogCitesSchema,
} from "./siteContracts/ariToolSchemas.ts";
import { ARI_DESIGN_KEYS } from "./siteContracts/designs.ts";
import { MAX_NAV_ITEMS, MAX_NAV_LABEL_LENGTH } from "./siteContracts/limits.ts";
import {
  BUTTON_SHAPES,
  MOTION_PRESETS,
  RADIUS_PRESETS,
} from "./siteContracts/tokens.ts";

// ---------------------------------------------------------------------------
// The turn surface
// ---------------------------------------------------------------------------

/** `workflow_context` of a turn sent from the Website workspace. */
export const SITE_WORKSPACE_CONTEXT = "website_workspace";

export const GET_SITE_WORKSPACE_TOOL = "get_site_workspace";
export const SITE_CHANGE_SET_TOOL = "propose_site_change_set";
export const SITE_TEAM_REQUEST_TOOL = "propose_website_team_request";

/** The tools a workspace turn's model may see (nothing that publishes). */
export const SITE_WORKSPACE_TURN_TOOLS: readonly string[] = [
  GET_SITE_WORKSPACE_TOOL,
  SITE_CHANGE_SET_TOOL,
  SITE_TEAM_REQUEST_TOOL,
];

export const SITE_CHANGE_SET_MAX_STEPS = 8;
export const SITE_STEP_LABEL_MAX = 80;
export const SITE_CHANGE_SET_SUMMARY_MAX = 120;
const SITE_REQUEST_MAX = 1000;
const SITE_COULDNT_MAX = 6;
const SITE_EDITS_MAX = 40;
const SITE_EDIT_VALUE_MAX = 5000;
export const SITE_LIST_OPS_MAX = 20;
export const SITE_LIST_OPS = ["add", "remove", "move"] as const;
const SITE_TEAM_TEXT_MAX = 1000;

/** Every step type the change set may carry (build contract section B). */
export const SITE_STEP_OPS = [
  "edit_section",
  "move_section",
  "remove_section",
  "add_section",
  "set_section_media",
  "set_look",
  "set_menu",
  "set_page_enabled",
] as const;
export type SiteStepOp = (typeof SITE_STEP_OPS)[number];

/** Step types that change one named section (the only ones a scoped request may use). */
const SECTION_SCOPED_OPS: ReadonlySet<string> = new Set([
  "edit_section",
  "move_section",
  "remove_section",
  "set_section_media",
]);

/** The section the owner opened Ari from (validated; never trusted as words). */
export interface SiteFocus {
  page_id: string;
  page_path: string;
  section_id: string;
  section_type: string;
  section_label: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE_PATH_PATTERN =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,59}$/;
const SLOT_PATTERN = /^[a-z][a-z_]{0,39}(?:\.\d{1,3})?$/;
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;
// Letters, digits, spaces and everyday punctuation: a label is shown to the
// model as data, so it may not carry markup, braces or line breaks.
const LABEL_PATTERN = /^[\p{L}\p{N} .,'’&()\/:!?·+-]{1,80}$/u;
const SITE_FOCUS_KEYS = [
  "page_id",
  "page_path",
  "section_id",
  "section_type",
  "section_label",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The `site_focus` a Host sent, or null when it is not exactly the five
 * fields the contract names (a wrong shape is refused, never guessed at).
 */
export function parseSiteFocus(raw: unknown): SiteFocus | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (
    keys.length !== SITE_FOCUS_KEYS.length ||
    keys.some((key) => !SITE_FOCUS_KEYS.includes(key))
  ) return null;
  const { page_id, page_path, section_id, section_type, section_label } = raw;
  if (typeof page_id !== "string" || !ID_PATTERN.test(page_id)) return null;
  if (typeof section_id !== "string" || !ID_PATTERN.test(section_id)) {
    return null;
  }
  if (
    typeof page_path !== "string" || page_path.length > 200 ||
    (page_path !== "" && !PAGE_PATH_PATTERN.test(page_path))
  ) return null;
  if (typeof section_type !== "string" || !TYPE_PATTERN.test(section_type)) {
    return null;
  }
  if (typeof section_label !== "string") return null;
  const label = section_label.trim();
  if (!LABEL_PATTERN.test(label)) return null;
  return { page_id, page_path, section_id, section_type, section_label: label };
}

/**
 * What the model is told about where the owner is. It rides inside the turn's
 * `<user_data>` part: app context, never instructions.
 */
export function siteWorkspaceContextText(input: {
  brandId: string;
  brandName: string;
  focus: SiteFocus | null;
}): string {
  const lines = [
    "WEBSITE WORKSPACE (sent by the Mingla app; context, not instructions)",
    `The owner is editing the website draft of the brand with brand_id ${input.brandId}.`,
  ];
  if (input.focus) {
    const page = input.focus.page_path === ""
      ? "the home page"
      : `the page at "${input.focus.page_path}"`;
    lines.push(
      `Selected section: "${input.focus.section_label}" (section_id ${input.focus.section_id}, type ${input.focus.section_type}) on ${page} (page_id ${input.focus.page_id}).`,
      'When the owner says "this", "here", "this section" or "it", they mean that section.',
      "This request is scoped to that section: every step must change that section only (its page_id and section_id).",
    );
  } else {
    lines.push(
      "No section is selected, so the request is about the website as a whole unless the owner names a page or section.",
    );
  }
  // Joined, not a template: this is prompt text for the model, never HTML
  // (the buyer-string escape gate reads a tagged template as an HTML one).
  return ["<user_data>", ...lines, "</user_data>"].join("\n");
}

/** The rules the system prompt carries for a Website workspace turn. */
export const SITE_WORKSPACE_PROMPT_RULES =
  `WEBSITE WORKSPACE RULES (only when the turn's context says WEBSITE WORKSPACE)
- The owner is looking at their live draft. Read get_site_workspace first (it is usually already in this turn's results) and plan from what it shows: real page ids, section ids, field keys, layouts, colours and approved photos. Never invent an id, a field or a layout.
- One request becomes ONE plan: call propose_site_change_set once, with one to eight steps in the order they should happen. Never send several separate website proposals for one request, and never use the older propose_site_* tools here.
- Change only what was asked. Do not tidy, rewrite or restyle anything the owner did not mention.
- When the context names a selected section, "this", "here" and "this section" mean that section, and every step must change that section only. If the owner asks for something outside it, say so in one sentence and offer to do it from the main Ari panel.
- Each step has a label of at most 80 characters in plain words the owner will read ("Shorten the welcome heading"), and a short why. A step that writes words a visitor reads (edits, menu labels) also carries cites: the owner's own words, a Mingla record, or an approved photo. Never write "block", "variant", "token" or "revision" in a label, a summary or a reply; say "section", "layout" and "colour".
- When a fact about the venue is missing (a price, a date, opening hours, an address, a name, a review), do not guess and do not call a write tool. Ask ONE question, then end the reply with a last line that starts "Choices:" and lists two to four short answers separated by " | ".
- Never say a change was made unless its result says it was applied. A plan that has not been applied is "ready", not "done". If a step failed, say which one and that nothing was changed.
- A new section must be one of addable_sections; one marked needs_photo takes a media_id from the workspace's media list (ask which photo when the owner did not say). A photo spot is named by its slot exactly as the workspace lists it.
- For the look, send only the colours that change. You may set the style to atelier or voyage only; any other style is the owner's pick in Design. If a colour would be hard to read you will be told the nearest shade that reads: say which shade was used, never hide it.
- A section's lists entry names the lists whose rows you can add, remove or reorder with list_ops on edit_section (questions and answers, steps, facts, and the like), with how few and how many rows each may hold. A new row needs every field of the row in the owner's own words (ask when they did not give them) and cites. Photo lists are changed through their photo spots. A list that is not in lists (one Mingla fills, or one whose rows need a link, such as the top buttons) is a team request.
- When part of the request cannot be done with these steps, do the part you can and list the rest in couldnt (what, and why in plain words).
- When nothing here can do what the owner asked, say so plainly in one sentence and call propose_website_team_request so the Mingla team can build it. Never pretend, and never offer a workaround that links bookings off Mingla.
- You never publish from here. Publishing is the owner's Publish button. Never invent facts, prices, dates or reviews.
- Keep every reply to two sentences.`;

// ---------------------------------------------------------------------------
// The one question with tappable choices
// ---------------------------------------------------------------------------

export interface SiteQuestionChoices {
  prompt: string;
  options: string[];
}

/**
 * A reply that ends with "Choices: A | B | C" is a question with tappable
 * answers: the line is taken off the text and returned as structured options
 * (two to four, each at most 60 characters). Anything else is left as it is.
 */
export function splitSiteQuestionChoices(
  text: string,
): { text: string; question: SiteQuestionChoices | null } {
  const lines = text.replace(/\s+$/, "").split("\n");
  const last = lines[lines.length - 1] ?? "";
  const match = /^\s*choices\s*:\s*(.+)$/i.exec(last);
  if (!match || lines.length < 2) return { text, question: null };
  const options = match[1].split("|").map((option) =>
    option.trim().replace(/^["“]|["”]$/g, "")
  ).filter((option) => option.length > 0);
  const body = lines.slice(0, -1).join("\n").replace(/\s+$/, "");
  if (
    options.length < 2 || options.length > 4 ||
    options.some((option) => option.length > 60) ||
    new Set(options.map((option) => option.toLowerCase())).size !==
      options.length ||
    !body
  ) {
    return { text: body || text, question: null };
  }
  const sentences = body.split(/(?<=[.?!])\s+/).filter(Boolean);
  const prompt = (sentences.findLast((sentence) => sentence.endsWith("?")) ??
    sentences[sentences.length - 1] ?? body).slice(0, 240);
  return { text: body, question: { prompt, options } };
}

// ---------------------------------------------------------------------------
// Schemas (what the model is shown)
// ---------------------------------------------------------------------------

const UUID = { type: "string", format: "uuid" };
const ID = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description: "An id exactly as get_site_workspace returned it",
};
const EDITS = {
  type: "array",
  maxItems: SITE_EDITS_MAX,
  description:
    "Text fields to change: key is the field's key from get_site_workspace (for a list item, e.g. items.2.question), value is the new plain text",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      key: { type: "string", minLength: 1, maxLength: 120 },
      value: { type: "string", maxLength: SITE_EDIT_VALUE_MAX },
    },
    required: ["key", "value"],
  },
};

/**
 * One step, as a flat object keyed by `op` (no oneOf: the provider schema and
 * Flash both handle a flat shape far more reliably). Which fields each op
 * needs is enforced exactly by `siteStepProblem`.
 */
const STEP = {
  type: "object",
  additionalProperties: false,
  description:
    "One typed change. edit_section: page_id, section_id, and at least one of edits, layout, list_ops. move_section: page_id, section_id, to_index. remove_section: page_id, section_id. add_section: page_id, type, after_section_id (leave out to add at the top), optional edits, and media_id when the type needs a photo. set_section_media: page_id, section_id, slot, media_id. set_look: at least one of design, tokens (only the colours that change), fonts, radius, button_shape, motion. set_menu: items. set_page_enabled: page_id, enabled.",
  properties: {
    op: { type: "string", enum: [...SITE_STEP_OPS] },
    page_id: ID,
    section_id: ID,
    edits: EDITS,
    layout: {
      type: "string",
      maxLength: 40,
      description: "A layout key this section offers (its layouts list)",
    },
    list_ops: {
      type: "array",
      maxItems: SITE_LIST_OPS_MAX,
      description:
        "edit_section only: add, remove or move rows of one of the section's lists (its lists entry in the workspace: name, min, max, count, fields). Rows are applied first, in order, then edits, so a new row's words can also be written by its new index. add: list, after_index (leave out for the top), values with every field of the row. remove: list, index. move: list, index, to_index. Indexes count from 0.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          list: {
            type: "string",
            maxLength: 60,
            description: "The list's name from the section's lists",
          },
          op: { type: "string", enum: [...SITE_LIST_OPS] },
          after_index: {
            type: "integer",
            minimum: 0,
            maximum: 199,
            nullable: true,
            description:
              "add: the row the new one goes after; null or left out is the top",
          },
          index: { type: "integer", minimum: 0, maximum: 199 },
          to_index: { type: "integer", minimum: 0, maximum: 199 },
          values: {
            type: "array",
            maxItems: 12,
            description:
              "add: the new row's words, one entry per row field (key is the row field, e.g. question)",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string", minLength: 1, maxLength: 60 },
                value: { type: "string", maxLength: SITE_EDIT_VALUE_MAX },
              },
              required: ["key", "value"],
            },
          },
        },
        required: ["list", "op"],
      },
    },
    to_index: {
      type: "integer",
      minimum: 0,
      maximum: 59,
      description: "The section's new position on its page, counting from 0",
    },
    type: {
      type: "string",
      maxLength: 60,
      description: "A section type the workspace says may be added",
    },
    after_section_id: {
      ...ID,
      description:
        "The section the new one goes after; leave out to put it at the top",
    },
    slot: {
      type: "string",
      maxLength: 60,
      description:
        "The photo spot as the workspace names it: media, video, poster, images.0, members.2",
    },
    media_id: {
      ...UUID,
      nullable: true,
      description:
        "An approved photo or video id from the workspace. On set_section_media, null clears the spot. add_section needs one when the section type says needs_photo.",
    },
    design: {
      type: "string",
      enum: [...ARI_DESIGN_KEYS],
      description:
        "Only these two; any other style is the owner's pick in Design",
    },
    tokens: tokenOverridesSchema(),
    fonts: fontChoicesSchema(),
    radius: { type: "string", enum: [...RADIUS_PRESETS] },
    button_shape: { type: "string", enum: [...BUTTON_SHAPES] },
    motion: { type: "string", enum: [...MOTION_PRESETS] },
    items: {
      type: "array",
      minItems: 1,
      maxItems: MAX_NAV_ITEMS,
      description: "The whole menu, in order",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          page_id: ID,
          label: {
            type: "string",
            minLength: 1,
            maxLength: MAX_NAV_LABEL_LENGTH,
          },
        },
        required: ["page_id", "label"],
      },
    },
    enabled: { type: "boolean" },
  },
  required: ["op"],
};

const CHANGE_SET_PROPERTIES = {
  brand_id: UUID,
  site_id: UUID,
  request: {
    type: "string",
    minLength: 1,
    maxLength: SITE_REQUEST_MAX,
    description: "What the owner asked for, in their own words",
  },
  summary: {
    type: "string",
    minLength: 1,
    maxLength: SITE_CHANGE_SET_SUMMARY_MAX,
    description:
      "The whole plan in one plain line; it becomes the Undo label (e.g. “Shorten the welcome and move Reviews up”)",
  },
  steps: {
    type: "array",
    minItems: 1,
    maxItems: SITE_CHANGE_SET_MAX_STEPS,
    description: "The steps, in the order they are applied",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: {
          type: "string",
          minLength: 1,
          maxLength: SITE_STEP_LABEL_MAX,
          description:
            "What this step does, in plain words the owner reads while it runs",
        },
        why: {
          type: "string",
          minLength: 1,
          maxLength: MAX_WORK_LOG_DECISION,
          description: "Why this step, in one plain sentence",
        },
        cites: {
          ...workLogCitesSchema(),
          description:
            "Required when the step writes words a visitor reads (edits, or the menu's labels): the owner's own words, a Mingla record, or an approved photo. A move, a removal, a photo, a layout or a look change may leave it out.",
        },
        step: STEP,
      },
      required: ["label", "why", "step"],
    },
  },
  couldnt: {
    type: "array",
    maxItems: SITE_COULDNT_MAX,
    description:
      "Parts of the request these steps cannot do, each with a plain reason",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        what: { type: "string", minLength: 1, maxLength: 200 },
        why: { type: "string", minLength: 1, maxLength: MAX_WORK_LOG_DECISION },
      },
      required: ["what", "why"],
    },
  },
};

const TEAM_REQUEST_PROPERTIES = {
  brand_id: UUID,
  site_id: UUID,
  what: {
    type: "string",
    minLength: 1,
    maxLength: SITE_TEAM_TEXT_MAX,
    description:
      "What the owner wants, written so the Mingla team can build it; the owner can edit it before sending",
  },
  where: {
    type: "object",
    additionalProperties: false,
    description: "Where on the website the change belongs",
    properties: {
      page_path: {
        type: "string",
        maxLength: 200,
        description: 'The page\'s address ("" is the home page)',
      },
      section_id: ID,
      section_label: { type: "string", maxLength: SITE_STEP_LABEL_MAX },
    },
    required: ["page_path"],
  },
  why: {
    type: "string",
    minLength: 1,
    maxLength: SITE_TEAM_TEXT_MAX,
    description: "Why the owner wants it, in their words where possible",
  },
  missing_capability: {
    type: "string",
    minLength: 1,
    maxLength: 300,
    description: "What the website cannot do yet, in one plain sentence",
  },
};

// ---------------------------------------------------------------------------
// Validation (proposal time and again at confirmation)
// ---------------------------------------------------------------------------

const JARGON = /\b(?:blocks?|variants?|tokens?|revisions?)\b/i;
const CODEISH = /[{}\[\]<>`_=\\|]|[0-9a-f]{8}-[0-9a-f]{4}-|\n|\r/i;

/** Why an owner-facing line is not plain words, or null. */
export function plainWordsProblem(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return "is required";
  if (value.length > max) return `must be at most ${max} characters`;
  if (CODEISH.test(value)) {
    return "must be plain words (no ids, code or line breaks)";
  }
  if (JARGON.test(value)) {
    return 'must not say "block", "variant", "token" or "revision" (say "section", "layout", "colour")';
  }
  return null;
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  return Object.keys(value).filter((key) =>
    !allowed.includes(key) && value[key] !== undefined
  );
}

function idProblem(value: unknown, name: string): string | null {
  return typeof value === "string" && ID_PATTERN.test(value)
    ? null
    : `${name} must be an id from get_site_workspace`;
}

function editsProblem(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `${path} must be a list`;
  if (value.length > SITE_EDITS_MAX) {
    return `${path} allows at most ${SITE_EDITS_MAX}`;
  }
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return `${path}[${index}] must be an object`;
    if (unknownKeys(raw, ["key", "value"]).length) {
      return `${path}[${index}] carries a field that is not key or value`;
    }
    if (
      typeof raw.key !== "string" || raw.key.length > 120 ||
      !FIELD_KEY_PATTERN.test(raw.key)
    ) {
      return `${path}[${index}].key must be a field key from get_site_workspace`;
    }
    if (
      typeof raw.value !== "string" || raw.value.length > SITE_EDIT_VALUE_MAX
    ) return `${path}[${index}].value must be text`;
  }
  return null;
}

const LIST_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const rowIndex = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < 200;

/** The first problem with a step's list rows (add / remove / move), or null. */
function listOpsProblem(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `${path} must be a list`;
  if (value.length > SITE_LIST_OPS_MAX) {
    return `${path} allows at most ${SITE_LIST_OPS_MAX} row changes in one step`;
  }
  for (const [index, raw] of value.entries()) {
    const at = `${path}[${index}]`;
    if (!isRecord(raw)) return `${at} must be an object`;
    if (typeof raw.list !== "string" || !LIST_NAME_PATTERN.test(raw.list)) {
      return `${at}.list must be a list name from the section's lists`;
    }
    if (raw.op === "add") {
      if (unknownKeys(raw, ["list", "op", "after_index", "values"]).length) {
        return `${at} (add) takes only list, after_index and values`;
      }
      if (
        raw.after_index !== undefined && raw.after_index !== null &&
        !rowIndex(raw.after_index)
      ) {
        return `${at}.after_index must be a row position, or left out for the top`;
      }
      const values = raw.values;
      if (!Array.isArray(values) || values.length < 1 || values.length > 12) {
        return `${at}.values must give the new row's words, one entry per row field`;
      }
      const seen = new Set<string>();
      for (const [n, item] of values.entries()) {
        if (
          !isRecord(item) || unknownKeys(item, ["key", "value"]).length ||
          typeof item.key !== "string" || !LIST_NAME_PATTERN.test(item.key) ||
          seen.has(item.key)
        ) return `${at}.values[${n}].key must be one row field, named once`;
        seen.add(item.key);
        if (
          typeof item.value !== "string" || !item.value.trim() ||
          item.value.length > SITE_EDIT_VALUE_MAX
        ) return `${at}.values[${n}].value must be the words for that field`;
      }
    } else if (raw.op === "remove") {
      if (unknownKeys(raw, ["list", "op", "index"]).length) {
        return `${at} (remove) takes only list and index`;
      }
      if (!rowIndex(raw.index)) return `${at}.index must be a row position`;
    } else if (raw.op === "move") {
      if (unknownKeys(raw, ["list", "op", "index", "to_index"]).length) {
        return `${at} (move) takes only list, index and to_index`;
      }
      if (!rowIndex(raw.index) || !rowIndex(raw.to_index)) {
        return `${at} needs index and to_index as row positions`;
      }
    } else return `${at}.op must be one of ${SITE_LIST_OPS.join(", ")}`;
  }
  return null;
}

const STEP_FIELDS: Record<SiteStepOp, readonly string[]> = {
  edit_section: ["page_id", "section_id", "edits", "layout", "list_ops"],
  move_section: ["page_id", "section_id", "to_index"],
  remove_section: ["page_id", "section_id"],
  add_section: ["page_id", "type", "after_section_id", "edits", "media_id"],
  set_section_media: ["page_id", "section_id", "slot", "media_id"],
  set_look: ["design", "tokens", "fonts", "radius", "button_shape", "motion"],
  set_menu: ["items"],
  set_page_enabled: ["page_id", "enabled"],
};

const shortText = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** The first problem with one typed step, or null. `path` names it for the model. */
export function siteStepProblem(step: unknown, path = "step"): string | null {
  if (!isRecord(step)) return `${path} must be an object`;
  const op = step.op;
  if (
    typeof op !== "string" || !(SITE_STEP_OPS as readonly string[]).includes(op)
  ) {
    return `${path}.op must be one of ${SITE_STEP_OPS.join(", ")}`;
  }
  const allowed = STEP_FIELDS[op as SiteStepOp];
  const extra = unknownKeys(step, ["op", ...allowed]);
  if (extra.length) {
    return `${path} (${op}) does not take ${extra.slice(0, 4).join(", ")}`;
  }
  const at = (name: string) => `${path}.${name}`;
  switch (op as SiteStepOp) {
    case "edit_section": {
      const hasEdits = Array.isArray(step.edits) && step.edits.length > 0;
      const hasLayout = step.layout !== undefined && step.layout !== null;
      const hasRows = Array.isArray(step.list_ops) &&
        step.list_ops.length > 0;
      if (!hasEdits && !hasLayout && !hasRows) {
        return `${path} (edit_section) needs edits, a layout or list_ops`;
      }
      if (step.list_ops !== undefined) {
        const problem = listOpsProblem(step.list_ops, at("list_ops"));
        if (problem) return problem;
      }
      if (step.edits !== undefined) {
        const problem = editsProblem(step.edits, at("edits"));
        if (problem) return problem;
      }
      if (hasLayout && !shortText(step.layout, 40)) {
        return `${at("layout")} must be a layout key the section offers`;
      }
      return idProblem(step.page_id, at("page_id")) ??
        idProblem(step.section_id, at("section_id"));
    }
    case "move_section":
      if (
        !Number.isInteger(step.to_index) || (step.to_index as number) < 0 ||
        (step.to_index as number) > 59
      ) return `${at("to_index")} must be a position from 0 to 59`;
      return idProblem(step.page_id, at("page_id")) ??
        idProblem(step.section_id, at("section_id"));
    case "remove_section":
      return idProblem(step.page_id, at("page_id")) ??
        idProblem(step.section_id, at("section_id"));
    case "add_section":
      if (typeof step.type !== "string" || !TYPE_PATTERN.test(step.type)) {
        return `${
          at("type")
        } must be a section type the workspace says may be added`;
      }
      if (
        step.after_section_id !== undefined && step.after_section_id !== null
      ) {
        const problem = idProblem(
          step.after_section_id,
          at("after_section_id"),
        );
        if (problem) return problem;
      }
      if (step.edits !== undefined) {
        const problem = editsProblem(step.edits, at("edits"));
        if (problem) return problem;
      }
      if (
        step.media_id !== undefined && step.media_id !== null &&
        !isUuid(step.media_id)
      ) return `${at("media_id")} must be an approved photo or video id`;
      return idProblem(step.page_id, at("page_id"));
    case "set_section_media":
      if (
        typeof step.slot !== "string" || !SLOT_PATTERN.test(step.slot)
      ) {
        return `${
          at("slot")
        } must be a photo spot the workspace names (media, video, poster, images.0, members.2)`;
      }
      // null clears the spot; leaving it out is never read as "clear".
      if (step.media_id !== null && !isUuid(step.media_id)) {
        return `${
          at("media_id")
        } must be an approved photo or video id, or null to clear the spot`;
      }
      return idProblem(step.page_id, at("page_id")) ??
        idProblem(step.section_id, at("section_id"));
    case "set_look": {
      const given = allowed.filter((key) =>
        step[key] !== undefined && step[key] !== null
      );
      if (given.length === 0) {
        return `${path} (set_look) needs at least one of ${allowed.join(", ")}`;
      }
      if (
        step.design !== undefined &&
        !(ARI_DESIGN_KEYS as readonly string[]).includes(step.design as string)
      ) {
        return `${at("design")} must be one of ${
          ARI_DESIGN_KEYS.join(", ")
        }; any other style is the owner's pick in Design`;
      }
      if (step.tokens !== undefined) {
        const problems = schemaProblems(
          step.tokens,
          tokenOverridesSchema(),
          at("tokens"),
        );
        if (problems.length) return problems.slice(0, 3).join("; ");
      }
      if (step.fonts !== undefined) {
        const problems = schemaProblems(
          step.fonts,
          fontChoicesSchema(),
          at("fonts"),
        );
        if (problems.length) return problems.slice(0, 3).join("; ");
      }
      for (
        const [key, options] of [
          ["radius", RADIUS_PRESETS],
          ["button_shape", BUTTON_SHAPES],
          ["motion", MOTION_PRESETS],
        ] as const
      ) {
        if (
          step[key] !== undefined && step[key] !== null &&
          !(options as readonly string[]).includes(step[key] as string)
        ) return `${at(key)} must be one of ${options.join(", ")}`;
      }
      return null;
    }
    case "set_menu": {
      const items = step.items;
      if (!Array.isArray(items) || items.length < 1) {
        return `${at("items")} must list the menu`;
      }
      if (items.length > MAX_NAV_ITEMS) {
        return `${at("items")} allows at most ${MAX_NAV_ITEMS}`;
      }
      for (const [index, raw] of items.entries()) {
        if (!isRecord(raw) || unknownKeys(raw, ["page_id", "label"]).length) {
          return `${at("items")}[${index}] must be a page_id and a label`;
        }
        const problem = idProblem(
          raw.page_id,
          `${at("items")}[${index}].page_id`,
        );
        if (problem) return problem;
        if (!shortText(raw.label, MAX_NAV_LABEL_LENGTH)) {
          return `${
            at("items")
          }[${index}].label must be 1 to ${MAX_NAV_LABEL_LENGTH} characters`;
        }
      }
      return null;
    }
    case "set_page_enabled":
      if (typeof step.enabled !== "boolean") {
        return `${at("enabled")} must be true or false`;
      }
      return idProblem(step.page_id, at("page_id"));
  }
}

/** Does this step write words a visitor reads? (Studio's own rule.) */
export function siteStepWritesWords(step: Record<string, unknown>): boolean {
  if (step.op === "set_menu") return true;
  // A new list row is new words too.
  if (
    step.op === "edit_section" && Array.isArray(step.list_ops) &&
    step.list_ops.some((row) => isRecord(row) && row.op === "add")
  ) return true;
  return (step.op === "edit_section" || step.op === "add_section") &&
    Array.isArray(step.edits) && step.edits.length > 0;
}

/** The first problem with a whole change set, or null. */
export function siteChangeSetProblem(
  args: Record<string, unknown>,
): string | null {
  const extra = unknownKeys(args, Object.keys(CHANGE_SET_PROPERTIES));
  if (extra.length) return `unknown field ${extra.slice(0, 4).join(", ")}`;
  if (!isUuid(args.brand_id) || !isUuid(args.site_id)) {
    return "brand_id and site_id must be UUIDs";
  }
  if (!shortText(args.request, SITE_REQUEST_MAX)) {
    return "request must be the owner's words (1 to 1000 characters)";
  }
  const summary = plainWordsProblem(args.summary, SITE_CHANGE_SET_SUMMARY_MAX);
  if (summary) return `summary ${summary}`;
  const steps = args.steps;
  if (!Array.isArray(steps) || steps.length < 1) {
    return "steps needs at least one step";
  }
  if (steps.length > SITE_CHANGE_SET_MAX_STEPS) {
    return `steps allows at most ${SITE_CHANGE_SET_MAX_STEPS}; do the most important ${SITE_CHANGE_SET_MAX_STEPS} and list the rest in couldnt`;
  }
  for (const [index, raw] of steps.entries()) {
    const path = `steps[${index}]`;
    if (!isRecord(raw)) return `${path} must be an object`;
    const stray = unknownKeys(raw, ["label", "why", "cites", "step"]);
    if (stray.length) return `${path} does not take ${stray.join(", ")}`;
    const label = plainWordsProblem(raw.label, SITE_STEP_LABEL_MAX);
    if (label) return `${path}.label ${label}`;
    if (!shortText(raw.why, MAX_WORK_LOG_DECISION)) {
      return `${path}.why is required (at most ${MAX_WORK_LOG_DECISION} characters)`;
    }
    const step = siteStepProblem(raw.step, `${path}.step`);
    if (step) return step;
    // Words a visitor reads say what they are based on; a move, a removal,
    // a photo, a layout or a look change may go without.
    const cited = Array.isArray(raw.cites) && raw.cites.length > 0;
    if (cited || siteStepWritesWords(raw.step as Record<string, unknown>)) {
      const cites = workLogCitesProblem(raw.cites);
      if (cites) {
        return `${path}.${cites} (a step that writes words says what they are based on)`;
      }
    } else if (raw.cites !== undefined && !Array.isArray(raw.cites)) {
      return `${path}.cites must be a list`;
    }
  }
  if (args.couldnt !== undefined) {
    if (
      !Array.isArray(args.couldnt) || args.couldnt.length > SITE_COULDNT_MAX
    ) {
      return `couldnt must be a list of at most ${SITE_COULDNT_MAX}`;
    }
    for (const [index, raw] of args.couldnt.entries()) {
      if (
        !isRecord(raw) || unknownKeys(raw, ["what", "why"]).length ||
        !shortText(raw.what, 200) || !shortText(raw.why, MAX_WORK_LOG_DECISION)
      ) return `couldnt[${index}] needs what and why in plain words`;
    }
  }
  return null;
}

/** The first problem with a team request, or null. */
export function siteTeamRequestProblem(
  args: Record<string, unknown>,
): string | null {
  const extra = unknownKeys(args, Object.keys(TEAM_REQUEST_PROPERTIES));
  if (extra.length) return `unknown field ${extra.slice(0, 4).join(", ")}`;
  if (!isUuid(args.brand_id) || !isUuid(args.site_id)) {
    return "brand_id and site_id must be UUIDs";
  }
  for (const key of ["what", "why"]) {
    if (!shortText(args[key], SITE_TEAM_TEXT_MAX)) {
      return `${key} is required (at most ${SITE_TEAM_TEXT_MAX} characters)`;
    }
  }
  if (!shortText(args.missing_capability, 300)) {
    return "missing_capability is required (one plain sentence)";
  }
  const where = args.where;
  if (!isRecord(where)) return "where must name the page";
  if (unknownKeys(where, ["page_path", "section_id", "section_label"]).length) {
    return "where takes only page_path, section_id and section_label";
  }
  if (
    typeof where.page_path !== "string" || where.page_path.length > 200 ||
    (where.page_path !== "" && !PAGE_PATH_PATTERN.test(where.page_path))
  ) return 'where.page_path must be the page\'s address ("" is the home page)';
  if (where.section_id !== undefined && where.section_id !== null) {
    const problem = idProblem(where.section_id, "where.section_id");
    if (problem) return problem;
  }
  if (
    where.section_label !== undefined && where.section_label !== null &&
    !shortText(where.section_label, SITE_STEP_LABEL_MAX)
  ) return "where.section_label must be the section's plain name";
  return null;
}

/** Throws INVALID_ARGS for a workspace write that is not well formed. */
export function assertSiteWorkspaceToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): void {
  const problem = toolName === SITE_CHANGE_SET_TOOL
    ? siteChangeSetProblem(args)
    : toolName === SITE_TEAM_REQUEST_TOOL
    ? siteTeamRequestProblem(args)
    : null;
  if (problem) throw new ToolError("INVALID_ARGS", problem);
}

/**
 * A request opened on one section may only change that section. Returns the
 * sentence the model reads when a step reaches outside it, or null.
 */
export function siteChangeSetFocusProblem(
  args: Record<string, unknown>,
  focus: SiteFocus | null,
): string | null {
  if (!focus) return null;
  const steps = Array.isArray(args.steps) ? args.steps : [];
  for (const [index, raw] of steps.entries()) {
    const step = isRecord(raw) && isRecord(raw.step) ? raw.step : {};
    const inside = typeof step.op === "string" &&
      SECTION_SCOPED_OPS.has(step.op) &&
      step.page_id === focus.page_id && step.section_id === focus.section_id;
    if (!inside) {
      return `steps[${index}] reaches outside the selected section. This request is scoped to "${focus.section_label}" (page_id ${focus.page_id}, section_id ${focus.section_id}): every step must be edit_section, move_section, remove_section or set_section_media on that section. Remove the other steps; if the owner asked for something outside this section, tell them in one sentence that it is outside it and offer to do it from the main Ari panel.`;
    }
  }
  return null;
}

const GROUNDED_ID_KEYS = new Set([
  "id",
  "page_id",
  "section_id",
  "media_id",
]);

/** Every page, section and media id the snapshot names. */
export function siteWorkspaceIds(snapshot: unknown): Set<string> {
  const ids = new Set<string>();
  let budget = 20_000;
  const visit = (value: unknown, depth: number): void => {
    if (budget-- <= 0 || depth > 8 || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (GROUNDED_ID_KEYS.has(key) && typeof child === "string") {
        ids.add(child);
      } else visit(child, depth + 1);
    }
  };
  visit(snapshot, 0);
  // The snapshot's own address is not a page or section.
  if (isRecord(snapshot)) {
    for (const key of ["site_id", "brand_id"]) {
      if (typeof snapshot[key] === "string") ids.delete(snapshot[key]);
    }
  }
  return ids;
}

function ungroundedId(
  args: Record<string, unknown>,
  ids: Set<string>,
  complete: { sections: boolean; media: boolean },
): string | null {
  if (ids.size === 0) return null;
  const steps = Array.isArray(args.steps) ? args.steps : [];
  for (const [index, raw] of steps.entries()) {
    const step = isRecord(raw) && isRecord(raw.step) ? raw.step : {};
    const named: Array<[string, unknown]> = [
      ["page_id", step.page_id],
      // A snapshot cut to fit lists some pages without their sections, and
      // only the first photos of a large library: Core checks those ids.
      ...(complete.sections
        ? [
          ["section_id", step.section_id] as [string, unknown],
          ["after_section_id", step.after_section_id] as [string, unknown],
        ]
        : []),
      ...(complete.media
        ? [["media_id", step.media_id] as [string, unknown]]
        : []),
      ...(Array.isArray(step.items)
        ? step.items.map((item, n): [string, unknown] => [
          `items[${n}].page_id`,
          isRecord(item) ? item.page_id : undefined,
        ])
        : []),
    ];
    for (const [name, value] of named) {
      if (typeof value === "string" && !ids.has(value)) {
        return `steps[${index}].step.${name}`;
      }
    }
  }
  return null;
}

/** A new section must be a type this draft may add, with a photo when it needs one. */
function siteAddableSectionProblem(
  args: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): { code: string; message: string } | null {
  const catalog = Array.isArray(snapshot.addable_sections)
    ? snapshot.addable_sections.filter(isRecord)
    : [];
  if (catalog.length === 0) return null;
  const steps = Array.isArray(args.steps) ? args.steps : [];
  for (const [index, raw] of steps.entries()) {
    const step = isRecord(raw) && isRecord(raw.step) ? raw.step : {};
    if (step.op !== "add_section") continue;
    const entry = catalog.find((item) => item.type === step.type);
    if (!entry) {
      return {
        code: "SECTION_TYPE_NOT_AVAILABLE",
        message: `steps[${index}].step.type "${
          String(step.type)
        }" cannot be added to this website. The section types that can be added are: ${
          catalog.map((item) => String(item.type)).join(", ")
        }. If none fits what the owner asked, say so and propose the team request.`,
      };
    }
    if (entry.needs_photo === true && !isUuid(step.media_id)) {
      return {
        code: "MEDIA_REQUIRED",
        message: `steps[${index}].step needs media_id: a "${
          String(step.type)
        }" section starts with one of the owner's approved photos (the workspace's media list). If the owner did not say which photo and there is more than one, ask which; if there is none, say they need to add a photo first.`,
      };
    }
  }
  return null;
}

/**
 * List rows against the draft: the list must be one the section says can
 * take rows, and the plan (every step, in order) must stay inside its
 * minimum and maximum and name rows that exist.
 */
function siteListRowsProblem(
  args: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): { code: string; message: string } | null {
  // A snapshot cut hard to fit drops the lists: Core then checks them.
  if (snapshot.truncated === true) return null;
  const sections = new Map<string, Record<string, unknown>>();
  let listsKnown = false;
  for (const page of Array.isArray(snapshot.pages) ? snapshot.pages : []) {
    if (!isRecord(page) || !Array.isArray(page.sections)) continue;
    for (const section of page.sections) {
      if (!isRecord(section) || typeof section.id !== "string") continue;
      sections.set(`${String(page.id)}#${section.id}`, section);
      if (Array.isArray(section.lists)) listsKnown = true;
    }
  }
  // Compacted past the point where lists are listed at all.
  if (!listsKnown && snapshot.compacted === true) return null;
  const counts = new Map<string, number>();
  const steps = Array.isArray(args.steps) ? args.steps : [];
  for (const [index, raw] of steps.entries()) {
    const step = isRecord(raw) && isRecord(raw.step) ? raw.step : {};
    if (step.op !== "edit_section" || !Array.isArray(step.list_ops)) continue;
    const sectionKey = `${String(step.page_id)}#${String(step.section_id)}`;
    const section = sections.get(sectionKey);
    if (!section) continue;
    const lists = (Array.isArray(section.lists) ? section.lists : []).filter(
      isRecord,
    );
    for (const [n, op] of step.list_ops.entries()) {
      if (!isRecord(op)) continue;
      const at = `steps[${index}].step.list_ops[${n}]`;
      const list = lists.find((item) => item.name === op.list);
      if (!list) {
        return {
          code: "LIST_NOT_EDITABLE",
          message: `${at}: rows cannot be added, removed or moved in "${
            String(op.list)
          }" of that section. ${
            lists.length
              ? `Its lists that take rows are: ${
                lists.map((item) => String(item.name)).join(", ")
              }.`
              : "It has no list that takes rows."
          } A photo list is changed through its photo spots (set_section_media); a list Mingla fills, or one whose rows need a link, is a team request.`,
        };
      }
      const key = `${sectionKey}#${String(list.name)}`;
      const count = counts.get(key) ??
        (typeof list.count === "number" ? list.count : 0);
      const max = typeof list.max === "number" ? list.max : null;
      const min = typeof list.min === "number" ? list.min : 0;
      const outside = (value: unknown) =>
        typeof value === "number" && value >= count;
      if (op.op === "add") {
        if (max !== null && count + 1 > max) {
          return {
            code: "LIST_LIMIT_REACHED",
            message:
              `${at}: that list holds at most ${max} rows and would have ${
                count + 1
              }. Add fewer rows, or tell the owner the list is full and ask which row to replace.`,
          };
        }
        if (outside(op.after_index)) {
          return {
            code: "INVALID_ARGS",
            message:
              `${at}.after_index is past the end: the list has ${count} rows (positions 0 to ${
                count - 1
              }). Leave it out for the top.`,
          };
        }
        const fields = (Array.isArray(list.fields) ? list.fields : []).filter((
          field,
        ): field is string => typeof field === "string");
        const given = (Array.isArray(op.values) ? op.values : []).flatMap((
          item,
        ) => isRecord(item) && typeof item.key === "string" ? [item.key] : []);
        const unknown = given.filter((field) => !fields.includes(field));
        const missing = fields.filter((field) => !given.includes(field));
        if (fields.length && (unknown.length || missing.length)) {
          return {
            code: "INVALID_ARGS",
            message: `${at}.values must give exactly this row's fields (${
              fields.join(", ")
            }), each in the owner's own words or from Mingla's records. ${
              missing.length ? `Missing: ${missing.join(", ")}. ` : ""
            }${
              unknown.length ? `Not a field: ${unknown.join(", ")}. ` : ""
            }If the owner did not give the words for one, ask for them; never write them yourself.`,
          };
        }
        counts.set(key, count + 1);
      } else if (op.op === "remove") {
        if (outside(op.index)) {
          return {
            code: "INVALID_ARGS",
            message: `${at}.index is past the end: the list has ${count} rows.`,
          };
        }
        if (count - 1 < min) {
          return {
            code: "LIST_ROW_REQUIRED",
            message: `${at}: that list keeps at least ${min} row${
              min === 1 ? "" : "s"
            }. Tell the owner it cannot be emptied; they can remove the whole section instead.`,
          };
        }
        counts.set(key, count - 1);
      } else if (outside(op.index) || outside(op.to_index)) {
        return {
          code: "INVALID_ARGS",
          message:
            `${at}: index and to_index must be rows that exist (the list has ${count}).`,
        };
      }
    }
  }
  return null;
}

/**
 * The check a workspace plan passes while the model can still repair it.
 * Fills the brand and site from the turn (never from the model's memory),
 * then: the right tool for the surface, the exact shape, the selected
 * section's scope, and ids that the draft snapshot really has.
 */
export function siteWorkspaceProposalIssue(input: {
  toolName: string;
  args: Record<string, unknown>;
  workspace: boolean;
  focus: SiteFocus | null;
  brandId: string | null;
  snapshot: unknown;
}): { code: string; message: string } | null {
  const ours = input.toolName === SITE_CHANGE_SET_TOOL ||
    input.toolName === SITE_TEAM_REQUEST_TOOL;
  if (input.workspace && !ours) {
    return {
      code: "WEBSITE_WORKSPACE_TOOL",
      message:
        `In the Website workspace a draft change is one ${SITE_CHANGE_SET_TOOL} plan, and anything it cannot do is ${SITE_TEAM_REQUEST_TOOL}. Do not call ${input.toolName} here. Publishing is the owner's Publish button.`,
    };
  }
  if (!ours) return null;
  const snapshot = isRecord(input.snapshot) ? input.snapshot : null;
  if (input.workspace) {
    if (input.brandId) input.args.brand_id = input.brandId;
    if (snapshot && isUuid(snapshot.site_id)) {
      input.args.site_id = snapshot.site_id;
    }
  }
  const shape = input.toolName === SITE_CHANGE_SET_TOOL
    ? siteChangeSetProblem(input.args)
    : siteTeamRequestProblem(input.args);
  if (shape) return { code: "INVALID_ARGS", message: shape };
  if (input.toolName !== SITE_CHANGE_SET_TOOL) return null;
  const scope = siteChangeSetFocusProblem(input.args, input.focus);
  if (scope) return { code: "OUTSIDE_SELECTED_SECTION", message: scope };
  if (input.workspace && snapshot) {
    const pages = Array.isArray(snapshot.pages) ? snapshot.pages : [];
    const media = Array.isArray(snapshot.media) ? snapshot.media : null;
    const stray = ungroundedId(input.args, siteWorkspaceIds(snapshot), {
      sections: snapshot.truncated !== true &&
        !pages.some((page) => isRecord(page) && page.sections_omitted === true),
      // Studio lists at most 60 photos (20 when compacted).
      media: snapshot.truncated !== true && snapshot.compacted !== true &&
        media !== null && media.length < 60,
    });
    if (stray) {
      return {
        code: "UNKNOWN_SITE_ID",
        message:
          `${stray} is not an id in the draft that get_site_workspace returned. Use the ids exactly as it lists them; never invent one. If the thing the owner means is not on the draft, ask one question.`,
      };
    }
    const addable = siteAddableSectionProblem(input.args, snapshot);
    if (addable) return addable;
    const rows = siteListRowsProblem(input.args, snapshot);
    if (rows) return rows;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The change-set executor
// ---------------------------------------------------------------------------

/** Progress the Host shows while a plan is applied (one activity row each). */
export type SiteStepActivity =
  | {
    type: "site_step_started";
    detail: { group_id: string; index: number; total: number; label: string };
  }
  | {
    type: "site_step_done";
    detail: { group_id: string; index: number; total: number; label: string };
  }
  | {
    type: "site_step_failed";
    detail: {
      group_id: string;
      index: number;
      total: number;
      label: string;
      reason: string;
      rolled_back: boolean;
    };
  };

export interface SiteChangeSetApplied {
  index: number;
  label: string;
  op: SiteStepOp;
  page_id: string | null;
  section_id: string | null;
  /** set_look: colours changed to the nearest shade that stays readable. */
  adjusted_colours?: Array<{ from: string; to: string }>;
  /** set_look: readability notes already on the look, in plain words. */
  warnings?: string[];
}

export interface SiteChangeSetResult {
  group_id: string;
  /**
   * applied: every step is on the draft. rolled_back: a step failed and the
   * draft is as it was. partly_applied: a step failed and Ari could not
   * confirm the draft was put back (some of the plan may still be on it; the
   * owner's Undo removes it, as it is one group).
   */
  status: "applied" | "rolled_back" | "partly_applied";
  total: number;
  applied: SiteChangeSetApplied[];
  /** The step that stopped the plan, in plain words; absent when all applied. */
  failed?: { index: number; label: string; reason: string };
  /** The design checks on the changed draft; null when they did not run. */
  checks: { passed: boolean; warnings: string[] } | null;
  /** Why the checks did not run, when they did not. */
  checks_note?: string;
  couldnt: Array<{ what: string; why: string }>;
}

export interface SiteChangeSetBudget {
  /** Everything (steps, rollback, checks) ends inside this. */
  totalMs: number;
  /** One Core call may take this long. */
  stepMs: number;
  /** Kept back for the rollback, whatever the steps used. */
  rollbackReserveMs: number;
  checksMs: number;
}

/**
 * The confirm request holds its approval for two minutes (the executing
 * lease). Eight steps at Core's usual one to three seconds fit several times
 * over; these limits make a slow Core fail the plan cleanly (and roll back)
 * well inside that lease instead of running past it.
 */
export const SITE_CHANGE_SET_BUDGET: SiteChangeSetBudget = Object.freeze({
  totalMs: 80_000,
  stepMs: 20_000,
  rollbackReserveMs: 15_000,
  checksMs: 12_000,
});

export interface SiteChangeSetDeps {
  /** One Core Ari action for this site (throws ToolError on a refusal or outage). */
  call: (
    action: string,
    args: Record<string, unknown>,
    operationId: string,
  ) => Promise<unknown>;
  emit?: (event: SiteStepActivity) => Promise<void>;
  now?: () => number;
  /** The pause before a step that is still running is asked again. */
  sleep?: (ms: number) => Promise<void>;
  budget?: Partial<SiteChangeSetBudget>;
}

/** How long to wait before asking again for a step Core says is still running. */
export const SITE_STEP_IN_PROGRESS_WAIT_MS = 1_500;

const TIMEOUT_CODE = "SITE_STEP_TIMEOUT";
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Core's own refusal code and the bounded detail a caller can act on. */
export interface SiteRefusalDetail {
  code: string;
  /** UNREADABLE_COLOURS: the colour that fails, and the nearest shade that reads. */
  suggestions?: Array<{ foreground: string; nearest_readable: string }>;
}

const SITE_REFUSAL = Symbol("siteRefusal");

export function attachSiteRefusal(
  error: ToolError,
  detail: SiteRefusalDetail,
): ToolError {
  (error as unknown as Record<symbol, unknown>)[SITE_REFUSAL] = detail;
  return error;
}

export function siteRefusalOf(error: unknown): SiteRefusalDetail | null {
  const detail = error instanceof ToolError
    ? (error as unknown as Record<symbol, unknown>)[SITE_REFUSAL]
    : null;
  return isRecord(detail) ? detail as unknown as SiteRefusalDetail : null;
}

/**
 * Core refused a look change because a colour would be hard to read, and
 * named the nearest shade that reads. The same step with those shades in
 * place of the colours it sent, or null when the step did not send them
 * (the clash is then with a colour already on the site: the owner decides).
 */
export function readableLookStep(
  step: Record<string, unknown>,
  error: unknown,
): {
  step: Record<string, unknown>;
  adjusted: Array<{ from: string; to: string }>;
} | null {
  const refusal = siteRefusalOf(error);
  if (
    step.op !== "set_look" || refusal?.code !== "UNREADABLE_COLOURS" ||
    !refusal.suggestions?.length || !isRecord(step.tokens) ||
    !isRecord(step.tokens.colors)
  ) return null;
  const swap = new Map(
    refusal.suggestions.map((item) => [
      item.foreground.toLowerCase(),
      item.nearest_readable.toLowerCase(),
    ]),
  );
  const adjusted = new Map<string, string>();
  const fix = (value: unknown): unknown => {
    if (typeof value === "string") {
      const next = swap.get(value.toLowerCase());
      if (next && next !== value.toLowerCase()) {
        adjusted.set(value.toLowerCase(), next);
        return next;
      }
      return value;
    }
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, fix(child)]),
      );
    }
    return value;
  };
  const colors = fix(step.tokens.colors);
  if (adjusted.size === 0) return null;
  return {
    step: { ...step, tokens: { ...step.tokens, colors } },
    adjusted: [...adjusted].map(([from, to]) => ({ from, to })),
  };
}

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new ToolError(TIMEOUT_CODE, "It took too long.")),
      Math.max(1, ms),
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A stable UUID for one step of one confirmed plan, so a repeated request for
 * the same step carries the same operation id.
 */
export async function siteStepOperationId(
  groupId: string,
  name: string,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${groupId}:${name}`),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

/** A failure as the owner reads it: no codes, ids or draft version detail. */
export function siteStepFailureReason(error: unknown): string {
  if (error instanceof ToolError) {
    if (error.code === TIMEOUT_CODE) return "It took too long to save.";
    if (error.code === "SITE_SERVICE_UNAVAILABLE") {
      return "The website service did not answer.";
    }
    // Core's own plain sentence, less anything written for the model
    // (draft versions, layout keys, field keys).
    const cleaned = error.message.replace(/\s+/g, " ").trim()
      .split(/(?<=[.?!])\s+/)
      .filter((sentence) =>
        sentence &&
        !/^(?:Latest revision|Layouts on offer|This design draws):/i.test(
          sentence,
        ) && !CODEISH.test(sentence)
      ).join(" ");
    if (cleaned) return cleaned.slice(0, 300);
    if (error.code === "REVISION_CONFLICT" || error.code === "CONFLICT") {
      return "The draft changed while this was being applied.";
    }
  }
  return "It could not be saved.";
}

/** Did this failure possibly land? (No answer is not a "no".) */
function mayHaveLanded(error: unknown): boolean {
  return !(error instanceof ToolError) ||
    [
      TIMEOUT_CODE,
      "SITE_SERVICE_UNAVAILABLE",
      "SERVICE_TEMPORARILY_UNAVAILABLE",
    ]
      .includes(error.code);
}

function normalizedStep(
  step: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (value !== undefined) clean[key] = value;
  }
  if (clean.op === "add_section" && clean.after_section_id === undefined) {
    clean.after_section_id = null;
  }
  if (clean.op === "edit_section" && clean.edits === undefined) {
    clean.edits = [];
  }
  // Studio takes a new row's words as { field: words } and the top of a
  // list as after_index null.
  if (Array.isArray(clean.list_ops)) {
    if (clean.list_ops.length === 0) delete clean.list_ops;
    else {
      clean.list_ops = clean.list_ops.map((raw) => {
        const row = raw as Record<string, unknown>;
        if (row.op !== "add") {
          return row.op === "remove"
            ? { list: row.list, op: "remove", index: row.index }
            : {
              list: row.list,
              op: "move",
              index: row.index,
              to_index: row.to_index,
            };
        }
        return {
          list: row.list,
          op: "add",
          after_index: row.after_index ?? null,
          values: Object.fromEntries(
            (row.values as Array<{ key: string; value: string }>).map((
              item,
            ) => [item.key, item.value]),
          ),
        };
      });
    }
  }
  return clean;
}

function checksFrom(
  raw: unknown,
): { passed: boolean; warnings: string[] } | null {
  if (!isRecord(raw) || !Array.isArray(raw.checks)) return null;
  const warnings: string[] = [];
  for (const check of raw.checks) {
    if (!isRecord(check) || check.status !== "warn") continue;
    const items = Array.isArray(check.items) ? check.items : [];
    for (const item of items) {
      if (isRecord(item) && typeof item.message === "string" && item.message) {
        warnings.push(item.message.slice(0, 300));
      }
    }
    if (items.length === 0 && typeof check.label === "string") {
      warnings.push(check.label.slice(0, 120));
    }
  }
  return { passed: warnings.length === 0, warnings: warnings.slice(0, 12) };
}

/**
 * Apply a confirmed plan. Never throws for a step that failed: the result
 * says which step stopped it and whether the draft was put back.
 */
export async function runSiteChangeSet(input: {
  args: Record<string, unknown>;
  groupId: string;
  deps: SiteChangeSetDeps;
}): Promise<SiteChangeSetResult> {
  const { args, groupId, deps } = input;
  const budget = { ...SITE_CHANGE_SET_BUDGET, ...(deps.budget ?? {}) };
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const remaining = () => budget.totalMs - (now() - started);
  const steps = args.steps as Array<Record<string, unknown>>;
  const total = steps.length;
  const couldnt = (Array.isArray(args.couldnt) ? args.couldnt : []).map((
    item,
  ) => ({
    what: String((item as { what?: unknown }).what ?? ""),
    why: String((item as { why?: unknown }).why ?? ""),
  }));
  const base = { brand_id: args.brand_id, site_id: args.site_id };
  const groupLabel = String(args.summary ?? "").slice(
    0,
    SITE_CHANGE_SET_SUMMARY_MAX,
  );
  const emit = async (event: SiteStepActivity) => {
    try {
      await deps.emit?.(event);
    } catch {
      // Progress is a courtesy: a lost row never fails or undoes a change.
    }
  };
  const applied: SiteChangeSetApplied[] = [];

  for (const [index, entry] of steps.entries()) {
    const label = String(entry.label);
    const step = normalizedStep(entry.step as Record<string, unknown>);
    const detail = { group_id: groupId, index, total, label };
    await emit({ type: "site_step_started", detail });
    let failure: unknown = null;
    let landedMaybe = false;
    const room = remaining() - budget.rollbackReserveMs;
    if (room < Math.min(2_000, budget.stepMs)) {
      failure = new ToolError(TIMEOUT_CODE, "It took too long.");
    } else {
      const operationId = await siteStepOperationId(groupId, `step:${index}`);
      const cites = Array.isArray(entry.cites) ? entry.cites : [];
      const apply = (sent: Record<string, unknown>) =>
        within(
          deps.call("apply_site_change", {
            ...base,
            group_id: groupId,
            group_label: groupLabel,
            step: sent,
            why: entry.why,
            ...(cites.length ? { cites } : {}),
          }, operationId),
          Math.min(budget.stepMs, remaining() - budget.rollbackReserveMs),
        );
      try {
        let outcome: unknown;
        let adjusted: Array<{ from: string; to: string }> = [];
        try {
          outcome = await apply(step);
        } catch (error) {
          // One more ask, never two, and only after a clean "no" (nothing
          // was written): the draft moved under this step, or a colour
          // would be hard to read and Core named the nearest shade that
          // reads.
          const room = remaining() - budget.rollbackReserveMs > 2_000;
          const readable = readableLookStep(step, error);
          if (
            room && error instanceof ToolError &&
            error.code === "REVISION_CONFLICT"
          ) {
            outcome = await apply(step);
          } else if (
            // Core runs a step once per operation id. "Still running" means
            // an earlier ask for this same step has not finished: wait a
            // moment and ask again with the same id (the answer is then the
            // first try's own result, marked repeated, and nothing is
            // applied twice).
            siteRefusalOf(error)?.code === "STEP_IN_PROGRESS" &&
            remaining() - budget.rollbackReserveMs >
              SITE_STEP_IN_PROGRESS_WAIT_MS + 2_000
          ) {
            await (deps.sleep ?? defaultSleep)(SITE_STEP_IN_PROGRESS_WAIT_MS);
            outcome = await apply(step);
          } else if (room && readable) {
            outcome = await apply(readable.step);
            adjusted = readable.adjusted;
          } else throw error;
        }
        const warnings = isRecord(outcome) && Array.isArray(outcome.warnings)
          ? outcome.warnings.filter((item): item is string =>
            typeof item === "string"
          ).slice(0, 8).map((item) => item.slice(0, 300))
          : [];
        const touched = isRecord(outcome) && isRecord(outcome.touched)
          ? outcome.touched
          : {};
        const idOf = (value: unknown, fallback: unknown) =>
          typeof value === "string"
            ? value
            : typeof fallback === "string"
            ? fallback
            : null;
        applied.push({
          index,
          label,
          op: step.op as SiteStepOp,
          page_id: idOf(touched.page_id, step.page_id),
          section_id: idOf(touched.section_id, step.section_id),
          ...(adjusted.length ? { adjusted_colours: adjusted } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
        await emit({ type: "site_step_done", detail });
        continue;
      } catch (error) {
        failure = error;
        landedMaybe = mayHaveLanded(error);
      }
    }

    // A step failed: put the draft back so nothing is half-applied.
    const reason = siteStepFailureReason(failure);
    let rolledBack = true;
    if (applied.length > 0 || landedMaybe) {
      try {
        await within(
          deps.call(
            "undo_site_change_group",
            { ...base, group_id: groupId },
            await siteStepOperationId(groupId, "undo"),
          ),
          Math.max(2_000, Math.min(budget.rollbackReserveMs, remaining())),
        );
      } catch (undoError) {
        // Core answering "there is nothing to undo" when no earlier step had
        // applied means the failed step never landed: the draft is as it
        // was. Anything else (no answer, or an undo refused after steps had
        // applied) is an honest "could not put it back".
        rolledBack = applied.length === 0 && !mayHaveLanded(undoError);
      }
    }
    await emit({
      type: "site_step_failed",
      detail: { ...detail, reason, rolled_back: rolledBack },
    });
    return {
      group_id: groupId,
      status: rolledBack ? "rolled_back" : "partly_applied",
      total,
      applied: rolledBack ? [] : applied,
      failed: { index, label, reason },
      checks: null,
      couldnt,
    };
  }

  // Every step is on the draft: run the design checks on it.
  let checks: SiteChangeSetResult["checks"] = null;
  let checksNote: string | undefined;
  if (remaining() < 2_000) {
    checksNote = "The design checks did not run. Run them before you publish.";
  } else {
    try {
      checks = checksFrom(
        await within(
          deps.call(
            "run_site_design_checks",
            base,
            await siteStepOperationId(groupId, "checks"),
          ),
          Math.min(budget.checksMs, remaining()),
        ),
      );
      if (!checks) {
        checksNote =
          "The design checks did not run. Run them before you publish.";
      }
    } catch {
      checksNote =
        "The design checks did not run. Run them before you publish.";
    }
  }
  return {
    group_id: groupId,
    status: "applied",
    total,
    applied,
    checks,
    ...(checksNote ? { checks_note: checksNote } : {}),
    couldnt,
  };
}

/** The request's number as the database returns it (a whole number), else null. */
export function siteTicketNumber(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d{1,15}$/.test(value)
    ? Number(value)
    : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Ari's line after a confirmed workspace write (the server's words, not the model's). */
export function siteWorkspaceFollowupText(
  toolName: string,
  result: unknown,
): string | null {
  if (toolName === SITE_TEAM_REQUEST_TOOL) {
    const ticket = isRecord(result)
      ? siteTicketNumber(result.ticket_number)
      : null;
    const number = ticket === null ? "" : ` (request ${ticket})`;
    return `Sent to the Mingla team${number}. They reply within 24 hours, and you’ll see it under Requests to the team.`;
  }
  if (toolName !== SITE_CHANGE_SET_TOOL || !isRecord(result)) return null;
  const failed = isRecord(result.failed) ? result.failed : null;
  const total = typeof result.total === "number" ? result.total : 0;
  if (result.status === "rolled_back" && failed) {
    return `Step ${
      Number(failed.index) + 1
    } of ${total}, “${failed.label}”, could not be applied: ${failed.reason} Nothing was changed.`;
  }
  if (result.status === "partly_applied" && failed) {
    return `Step ${
      Number(failed.index) + 1
    } of ${total}, “${failed.label}”, could not be applied: ${failed.reason} Some of this may still be on your draft. Check it, and use Undo to remove it.`;
  }
  if (result.status !== "applied") return null;
  const count = Array.isArray(result.applied) ? result.applied.length : total;
  const checks = isRecord(result.checks) ? result.checks : null;
  const warnings = checks && Array.isArray(checks.warnings)
    ? checks.warnings.length
    : 0;
  const left = Array.isArray(result.couldnt) ? result.couldnt.length : 0;
  const parts = [
    `${
      count === 1 ? "That change is" : `All ${count} changes are`
    } on your draft, ready for you to read. Nothing is published.`,
  ];
  const shades = Array.isArray(result.applied)
    ? result.applied.reduce(
      (sum: number, item: unknown) =>
        sum +
        (isRecord(item) && Array.isArray(item.adjusted_colours)
          ? item.adjusted_colours.length
          : 0),
      0,
    )
    : 0;
  if (shades > 0) {
    parts.push(
      `I used the nearest shade that stays readable for ${
        shades === 1 ? "one colour" : `${shades} colours`
      }.`,
    );
  }
  if (warnings > 0) {
    parts.push(
      `The design checks found ${warnings} thing${
        warnings === 1 ? "" : "s"
      } to look at.`,
    );
  } else if (!checks && typeof result.checks_note === "string") {
    parts.push(result.checks_note);
  }
  if (left > 0) {
    parts.push(
      `I could not do ${
        left === 1 ? "one part" : `${left} parts`
      } of what you asked.`,
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

/** What agentSiteTools.ts lends this file (no import cycle). */
export interface SiteWorkspaceToolDeps {
  /** POST /v1/sites/{id}/ari with the action and args (re-addressed once on a wrong site id). */
  cmsCall: (
    action: string,
    args: Record<string, unknown>,
    client: SupabaseClient,
    operationId: string,
  ) => Promise<unknown>;
  /** The brand's one site, read as the caller (null when it has none or may not see it). */
  resolveSiteId: (
    client: SupabaseClient,
    brandId: string,
  ) => Promise<string | null>;
}

/** Progress rows for a confirmed plan: set by agent-confirm-action only. */
export interface SiteWorkspaceExecutionContext
  extends AgentToolExecutionContext {
  onSiteStep?: (event: SiteStepActivity) => Promise<void>;
}

const WORKSPACE_MAX_CHARS = 30_000;
// The snapshot's own top-level keys (Studio `get_site_workspace`), least
// needed for planning first. Studio already keeps it under 24 KB; this is
// the last line of defence, so it must name keys that exist.
const WORKSPACE_DROP_ORDER = [
  "media",
  "facts",
  "addable_sections",
];

/** Keep the planning snapshot inside the turn's context budget. */
export function boundSiteWorkspace(
  data: Record<string, unknown>,
): Record<string, unknown> {
  let bounded = data;
  for (const key of WORKSPACE_DROP_ORDER) {
    if (JSON.stringify(bounded).length <= WORKSPACE_MAX_CHARS) return bounded;
    if (key in bounded) {
      const { [key]: _dropped, ...rest } = bounded;
      bounded = { ...rest, truncated: true };
    }
  }
  return bounded;
}

/** One tool's description, schema and executor; agentSiteTools.ts registers it by name. */
export interface SiteWorkspaceToolPart {
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  executor: AgentToolDefinition["executor"];
}

const part = (
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  executor: AgentToolDefinition["executor"],
): SiteWorkspaceToolPart => ({ description, properties, required, executor });

export function siteWorkspaceToolParts(deps: SiteWorkspaceToolDeps): {
  getSiteWorkspace: SiteWorkspaceToolPart;
  proposeSiteChangeSet: SiteWorkspaceToolPart;
  proposeWebsiteTeamRequest: SiteWorkspaceToolPart;
} {
  const getSiteWorkspace = part(
    "Read the website draft as one planning snapshot: every page with its sections (ids, order, type, plain label, layout and the layouts on offer, text field keys with their current words, photo spots, review state), the look (design, colours, fonts, readability warnings), the menu, the section types that may be added, the owner's approved photos, and the facts Mingla holds. Read this before planning any website change. Leave site_id out when you do not have it.",
    { brand_id: UUID, site_id: UUID },
    ["brand_id"],
    async (args, client, userId) => {
      await assertAgentReadBrand(client, userId, args.brand_id);
      const brandId = args.brand_id as string;
      const siteId = isUuid(args.site_id)
        ? args.site_id
        : await deps.resolveSiteId(client, brandId);
      if (!siteId) {
        throw new ToolError(
          "NOT_FOUND",
          "This brand does not have a website to edit yet.",
        );
      }
      const data = await deps.cmsCall(
        GET_SITE_WORKSPACE_TOOL,
        { brand_id: brandId, site_id: siteId },
        client,
        crypto.randomUUID(),
      );
      return boundSiteWorkspace({
        ...(isRecord(data) ? data : {}),
        brand_id: brandId,
        site_id: siteId,
      });
    },
  );

  const proposeSiteChangeSet = part(
    "Propose ONE plan for a website request: one to eight typed steps applied to the draft in order as a single change the owner can undo in one tap. Each step has a plain label, a why and what it is based on (cites). Steps may edit a section's words or layout, move, remove or add a section, set a section's photo, change the look, set the menu, or turn a page on or off. If a step cannot be applied the whole plan is put back, and the answer says which step and why. Draft only; never publishes.",
    CHANGE_SET_PROPERTIES,
    ["brand_id", "site_id", "request", "summary", "steps"],
    async (args, client, _userId, context) => {
      const groupId = requireAgentOperationId(context);
      assertSiteWorkspaceToolArgs(SITE_CHANGE_SET_TOOL, args);
      // A second run of the same approval never applies anything: the first
      // run may have landed some or all of it, and applying again would put
      // the same change on the draft twice.
      if (context?.retry) {
        throw new ToolError(
          "DOMAIN_ACTION_REFUSED",
          "This change was already started. Check your draft, and use Undo if it looks half done.",
        );
      }
      return await runSiteChangeSet({
        args,
        groupId,
        deps: {
          call: (action, callArgs, operationId) =>
            deps.cmsCall(action, callArgs, client, operationId),
          emit: (context as SiteWorkspaceExecutionContext | undefined)
            ?.onSiteStep,
        },
      });
    },
  );

  const proposeWebsiteTeamRequest = part(
    "Write up a website change the workspace cannot make, as a request to the Mingla team: what the owner wants, where on the site, why, and what the website cannot do yet. The owner reads and edits it on the card; sending it opens a request the team answers within 24 hours. Use this when no step can do what was asked. Never use it for something a change set can do.",
    TEAM_REQUEST_PROPERTIES,
    ["brand_id", "site_id", "what", "where", "why", "missing_capability"],
    async (args, client, _userId, context) => {
      const requestId = requireAgentOperationId(context);
      assertSiteWorkspaceToolArgs(SITE_TEAM_REQUEST_TOOL, args);
      const where = args.where as Record<string, unknown>;
      // The draft the owner was looking at, when Core can say (the team opens
      // the same version). Never a reason to lose the request.
      let draftDigest: string | null = null;
      try {
        const snapshot = await within(
          deps.cmsCall(
            GET_SITE_WORKSPACE_TOOL,
            { brand_id: args.brand_id, site_id: args.site_id },
            client,
            crypto.randomUUID(),
          ),
          8_000,
        );
        if (isRecord(snapshot) && typeof snapshot.draft_digest === "string") {
          draftDigest = snapshot.draft_digest.slice(0, 128);
        }
      } catch {
        draftDigest = null;
      }
      const { data, error } = await client.rpc(
        "issue_4453_create_website_request",
        {
          p_client_request_id: requestId,
          p_brand_id: args.brand_id,
          p_site_id: args.site_id,
          p_what: String(args.what).trim(),
          p_where: {
            // The request table holds the address visitors see ("/" is the
            // home page, "/about"); the workspace names pages without the
            // leading slash ("" is the home page).
            page_path: `/${String(where.page_path)}`,
            ...(typeof where.section_id === "string"
              ? { section_id: where.section_id }
              : {}),
            ...(typeof where.section_label === "string"
              ? { section_label: where.section_label.trim() }
              : {}),
          },
          p_why: String(args.why).trim(),
          p_missing_capability: String(args.missing_capability).trim(),
          p_draft_digest: draftDigest,
        },
      );
      if (error) {
        const code = String((error as { code?: unknown }).code ?? "");
        if (code === "42501") {
          throw new ToolError(
            "FORBIDDEN",
            "Your role on this brand cannot send website requests.",
          );
        }
        throw new ToolError(
          "RPC_FAILED",
          "The request could not be sent to the Mingla team. Nothing was sent.",
        );
      }
      const row = isRecord(data) ? data : {};
      if (typeof row.ticket_id !== "string") {
        throw new ToolError(
          "RPC_FAILED",
          "The request could not be sent to the Mingla team. Nothing was sent.",
        );
      }
      return {
        ticket_id: row.ticket_id,
        ticket_number: siteTicketNumber(row.ticket_number),
        status: "received",
      };
    },
  );

  return { getSiteWorkspace, proposeSiteChangeSet, proposeWebsiteTeamRequest };
}
