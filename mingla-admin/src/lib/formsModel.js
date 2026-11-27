// #4452 §7.3–§7.5 — the Forms builder's rules, kept pure so they are tested
// without a browser. Validation is the shared contract itself
// (supabase/functions/_shared/formsContract.ts, byte-identical to the marketing
// copy): the builder never keeps its own copy of a rule the server enforces.
import {
  FIELD_TYPES,
  LABEL_NAME,
  emailKinds,
  formTokens,
  publishChecks,
  validateDefinition,
  validateFlow,
} from "../../../supabase/functions/_shared/formsContract.ts";

export { FIELD_TYPES, LABEL_NAME, emailKinds, formTokens };

// ---------------------------------------------------------------------------
// The field palette (design TYPES) and the Validation line (design `val` map)
// ---------------------------------------------------------------------------
export const TYPE_LABEL = Object.freeze({
  name: "Name", email: "Email", phone: "Phone", short: "Short text", long: "Long text",
  single: "Single choice", multi: "Multiple choice", dropdown: "Dropdown", social: "URL or social",
  date: "Date", consent: "Consent checkbox",
});

const VALIDATION_LINE = Object.freeze({
  email: 'Real email format; "did you mean gmail.com" for common typos.',
  phone: "Country code picker, digits only. Saved as +234 801 234 5678.",
  social: "@handle or a profile link; saved as a link the team can open.",
  short: "Up to 120 characters.",
  long: "Up to 2,000 characters.",
  date: "No past dates.",
  name: "2 to 80 characters. First name is used in emails.",
  consent: "Never pre-ticked, never required.",
});

/** The props panel's Validation line for a field type (design `val`). */
export function validationLine(type) {
  return VALIDATION_LINE[type] || "At least one when required.";
}

export const CHOICE_TYPES = Object.freeze(["single", "multi", "dropdown"]);
const SINGLETONS = Object.freeze(["name", "email", "phone", "consent"]);

export const LOCKED_HINT = "Locked by the Creators template: name, email and phone are always required.";
export const CONSENT_HINT = "Consent can never be required.";

/** A stable key from a label: lower-case words joined by _, unique among `taken`. */
export function keyFromLabel(label, taken) {
  let base = String(label || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  if (!/^[a-z]/.test(base)) base = `q_${base}`.replace(/_+$/, "");
  if (base.length < 2) base = "question";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const k = `${base.slice(0, 36)}_${n}`;
    if (!used.has(k)) return k;
  }
  return `${base.slice(0, 30)}_${Date.now() % 100000}`;
}

const NEW_FIELD_LABEL = Object.freeze({
  name: "Your name", email: "Email", phone: "Phone", short: "Short answer", long: "Tell us more",
  single: "Pick one", multi: "Pick any", dropdown: "Choose one", social: "Your main social",
  date: "When?", consent: "Send me occasional emails from Mingla. Unsubscribe anytime.",
});

/** Can another field of this type be added? (R-2: one name, email, phone and consent.) */
export function canAddType(fields, type) {
  if (!SINGLETONS.includes(type)) return (fields || []).length < 40;
  return !(fields || []).some((f) => f.type === type) && (fields || []).length < 40;
}

/** A new field of `type`, keyed from its label (keys never change on rename). */
export function newField(type, fields) {
  const label = NEW_FIELD_LABEL[type] || "Question";
  const key = SINGLETONS.includes(type) && !fields.some((f) => f.key === type) ? type : keyFromLabel(label, fields.map((f) => f.key));
  const field = { key, type, label, required: type === "email" };
  if (type === "single" || type === "multi" || type === "dropdown") field.options = ["Option 1", "Option 2"];
  if (type === "dropdown") field.source = "options";
  return field;
}

export function moveField(fields, index, delta) {
  const j = index + delta;
  if (j < 0 || j >= fields.length) return fields;
  const next = fields.slice();
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** Locked fields are never removed (R-6). */
export function removeField(fields, key) {
  const f = fields.find((x) => x.key === key);
  if (!f || f.locked) return fields;
  return fields.filter((x) => x.key !== key).map((x) => (x.show_if?.field_key === key ? omit(x, "show_if") : x));
}

/** A props edit. Locked fields stay required; consent is never required (R-3, R-6). */
export function patchField(fields, key, patch) {
  return fields.map((f) => {
    if (f.key !== key) return f;
    const next = { ...f, ...patch, key: f.key, type: f.type };
    if (f.locked) next.required = true;
    if (f.type === "consent") next.required = false;
    if (next.help === "") delete next.help;
    return next;
  });
}

/** One-line summary under a canvas row (design `fsum`). */
export function fieldSummary(f) {
  const parts = [TYPE_LABEL[f.type] || f.type];
  if (Array.isArray(f.options) && f.options.length) parts.push(f.options.join(" · "));
  if (f.type === "dropdown" && f.source === "google_city") parts.push("Google city search");
  if (f.show_if) parts.push(`only when "${f.show_if.field_key}" ${f.show_if.op.replace("_", " ")} ${f.show_if.value}`);
  if (f.help) parts.push(f.help);
  return parts.join(" · ");
}

/** The fields a show_if can point at: an earlier single, multi or options dropdown (R-7). */
export function showIfTargets(fields, key) {
  const at = fields.findIndex((f) => f.key === key);
  return fields.slice(0, Math.max(0, at)).filter((f) => CHOICE_TYPES.includes(f.type) && f.source !== "google_city" && Array.isArray(f.options));
}

function omit(obj, k) {
  const { [k]: _drop, ...rest } = obj;
  void _drop;
  return rest;
}

// ---------------------------------------------------------------------------
// Design tab (design `designTab`, limits exact)
// ---------------------------------------------------------------------------
export const LAYOUTS = Object.freeze([
  { id: "centre", name: "Big centre pop-up", hint: "Photo left, form right" },
  { id: "side", name: "Full-height side panel", hint: "Slides in from the right" },
  { id: "inline", name: "Card on the page", hint: "Sits in a page spot" },
  { id: "page", name: "Its own page", hint: "/apply/<link>" },
]);

/** The backdrop washes (design SCRIMS, exact rgba). */
export const SCRIMS = Object.freeze({
  night: { name: "Night", rgba: [21, 23, 28, 0.72] },
  ink: { name: "Ink", rgba: [17, 17, 16, 0.7] },
  moss: { name: "Moss", rgba: [47, 58, 46, 0.74] },
  clay: { name: "Clay", rgba: [140, 90, 60, 0.74] },
  paper: { name: "Paper", rgba: [245, 244, 240, 0.86] },
});
export const TEXT_COLOURS = Object.freeze([
  { name: "White", hex: "#ffffff" }, { name: "Paper", hex: "#f5f4f0" }, { name: "Sand", hex: "#d9cbb4" }, { name: "Ink", hex: "#111110" },
]);
export const TICKS = Object.freeze({ orange: "#f0904a", white: "#ffffff", sand: "#d9cbb4" });
export const TEXT_ROWS = Object.freeze(["top", "centre", "bottom"]);
export const TEXT_COLS = Object.freeze(["left", "centre", "right"]);
export const ALIGNS = Object.freeze(["left", "centre", "right"]);

/** Every text field's limit (design maxlength values). */
export const DESIGN_LIMITS = Object.freeze({ title: 40, head: 24, em: 20, reason: 44, send: 24, dismiss: 16, small: 60 });

export const DESIGN_DEFAULTS = Object.freeze({
  layout: "centre",
  photo: null,
  photo_url: null,
  photo_thumb_url: null,
  text_pos: "centre-centre",
  align: "left",
  text_color: "#ffffff",
  backdrop: "night",
  tick: "orange",
  title: "Apply to make with Mingla",
  head: "Make with",
  em: "Mingla.",
  reasons: ["Paid gigs at places people love", "Your name on the work", "Lagos, Raleigh, London, Dublin, Helsinki"],
  send: "Send application",
  dismiss: "Not now",
  small: "Takes 2 minutes · we reply in 3 days",
  columns: 1,
  phone_steps: false,
});

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** The draft's design with every value checked and every default filled. */
export function designOf(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const pick = (k, ok) => (ok(d[k]) ? d[k] : DESIGN_DEFAULTS[k]);
  const text = (k, max) => (typeof d[k] === "string" ? d[k].slice(0, max) : DESIGN_DEFAULTS[k]);
  const pos = typeof d.text_pos === "string" ? (d.text_pos === "centre" ? "centre-centre" : d.text_pos) : DESIGN_DEFAULTS.text_pos;
  const [row, col] = pos.split("-");
  return {
    layout: pick("layout", (v) => LAYOUTS.some((l) => l.id === v)),
    photo: typeof d.photo === "string" ? d.photo : null,
    photo_url: typeof d.photo_url === "string" ? d.photo_url : null,
    photo_thumb_url: typeof d.photo_thumb_url === "string" ? d.photo_thumb_url : null,
    text_pos: TEXT_ROWS.includes(row) && TEXT_COLS.includes(col) ? `${row}-${col}` : DESIGN_DEFAULTS.text_pos,
    align: pick("align", (v) => ALIGNS.includes(v)),
    text_color: pick("text_color", (v) => typeof v === "string" && HEX_RE.test(v)),
    backdrop: pick("backdrop", (v) => Object.hasOwn(SCRIMS, v)),
    tick: pick("tick", (v) => Object.hasOwn(TICKS, v)),
    title: text("title", DESIGN_LIMITS.title),
    head: text("head", DESIGN_LIMITS.head),
    em: text("em", DESIGN_LIMITS.em),
    reasons: Array.isArray(d.reasons)
      ? [0, 1, 2].map((i) => (typeof d.reasons[i] === "string" ? d.reasons[i].slice(0, DESIGN_LIMITS.reason) : ""))
      : DESIGN_DEFAULTS.reasons.slice(),
    send: text("send", DESIGN_LIMITS.send),
    dismiss: text("dismiss", DESIGN_LIMITS.dismiss),
    small: text("small", DESIGN_LIMITS.small),
    columns: d.columns === 2 ? 2 : 1,
    phone_steps: d.phone_steps === true,
  };
}

function lum([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function hexRgb(hex) {
  const h = String(hex).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/**
 * The live contrast badge (design fdContrast): the text colour against the
 * backdrop blended over a mid-grey photo base rgb(96,92,88).
 */
export function designContrast(design) {
  const d = designOf(design);
  const [r, g, b, a] = SCRIMS[d.backdrop].rgba;
  const base = [96, 92, 88];
  const blended = [r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a)));
  const l1 = lum(hexRgb(d.text_color));
  const l2 = lum(blended);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The badge words; it warns and never blocks publishing. */
export function contrastBadge(ratio) {
  const ok = ratio >= 4.5;
  return { ok, text: `Contrast ${ratio.toFixed(1)}:1 · ${ok ? "easy to read" : "too low, pick a darker backdrop or lighter text"}` };
}

// ---------------------------------------------------------------------------
// Photo uploads (§1.6): accepted up to 8 MB, stored ≤ 5 MiB, plus a _thumb
// ---------------------------------------------------------------------------
export const PHOTO_INPUT_MAX = 8 * 1024 * 1024;
export const PHOTO_STORED_MAX = 5 * 1024 * 1024;
export const PHOTO_LONG_EDGE = 2400;
export const PHOTO_THUMB_EDGE = 600;
export const PHOTO_TOO_BIG = "That photo is over 8 MB. Pick a smaller one.";
export const PHOTO_TOO_BIG_AFTER = "That photo is too large even after resizing. Try a smaller one.";

/** Refuse before reading anything: type and the 8 MB input limit. */
export function photoPrecheck(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type || "")) return "Use a JPG, PNG or WebP photo.";
  if (file.size > PHOTO_INPUT_MAX) return PHOTO_TOO_BIG;
  return null;
}

/** The resized size for a long edge. */
export function fitEdge(width, height, edge) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// ---------------------------------------------------------------------------
// Own page (§7.4): the link and the limits
// ---------------------------------------------------------------------------
export const OWN_LIMITS = Object.freeze({ slug: 32, h: 28, em: 24, lead: 160 });
export const RESERVED_SLUGS = Object.freeze(["thanks", "booked", "preview", "api", "new"]);
export function slugProblem(slug) {
  if (!slug) return "Add a link.";
  if (slug.length > OWN_LIMITS.slug) return "32 characters at most.";
  if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(slug)) return "Lowercase letters, numbers and dashes.";
  if (RESERVED_SLUGS.includes(slug)) return "That link is taken by the site. Pick another.";
  return null;
}
export function slugify(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
}

// ---------------------------------------------------------------------------
// Routing and lead label (A1.3)
// ---------------------------------------------------------------------------
export const PIPELINE_FOR = Object.freeze({ host: "hosts", creator: "creators", local: null });
export const NO_LOCALS_PIPELINE = "Local leads stay in Leads. There is no Locals pipeline yet.";
export const GOALS = Object.freeze([
  { id: "call_booked", label: "Booked a call" },
  { id: "app_signup", label: "Signed up in the app" },
  { id: "approved", label: "Approved in the pipeline" },
  { id: "none", label: "None, Lead only" },
]);
export const GOAL_LATER_HINT = "Counted in Results; not sent to ad platforms yet";

/** Turning the card on fixes the pipeline by the label; a local form cannot turn it on (R-25). */
export function setCard(def, on) {
  const pipeline = PIPELINE_FOR[def.audience];
  if (on && !pipeline) return def;
  const routing = on ? { card: { on: true, pipeline } } : { card: { on: false } };
  if (on && def.routing?.owner) routing.owner = def.routing.owner;
  return { ...def, routing };
}

/** A new label keeps the card in step (R-25): the pipeline follows, a local label turns it off. */
export function setAudience(def, audience) {
  const next = { ...def, audience };
  if (def.routing?.card?.on) return setCard(next, Boolean(PIPELINE_FOR[audience]));
  return next;
}

// ---------------------------------------------------------------------------
// Publish (design `checks()`, the server's five checks, plus every R / F error)
// ---------------------------------------------------------------------------
const CHECK_COPY = Object.freeze({
  email_required: ["An email field is required", "Mingla needs it to reply and to spot repeats."],
  consent_for_follow_ups: ["Follow-up emails have a consent box", "Emails after a wait are marketing emails."],
  consent_optional: ["Consent stays optional", "It can never block Send."],
  lead_label_set: ["Lead label is set", "Every lead must say Host, Creator or Local."],
  tested: ["You sent yourself a test", 'Press "Send me a test" to see the real emails.'],
});
// #4452 B22: check 5 when the flow sends the person no email (the server passes it too).
const NO_EMAILS_TO_TEST = Object.freeze(["No emails to test", "This form sends the person no email, so there is nothing to test."]);

const ERROR_COPY = Object.freeze({
  bad_label: "needs a label (up to 120 characters)",
  bad_help: "help text is over 200 characters",
  bad_options: "needs 1 to 20 different options, each up to 60 characters",
  bad_key: "has a broken key",
  duplicate_key: "has the same key as another field",
  email_not_required: "Email must be required",
  consent_required: "Consent can never be required",
  locked_field: "is locked by the template and must stay required",
  show_if_order: "can only depend on an earlier question",
  show_if_type: "can only depend on a single, multiple or dropdown question",
  bad_show_if: "has an incomplete 'Show this question only when…'",
  email_field_count: "The form needs exactly one email field",
  duplicate_singleton: "Only one name, phone and consent field each",
  bad_slug: "The own-page link needs lowercase letters, numbers and dashes (32 at most)",
  bad_own_page: "An own-page text is too long",
  card_local: NO_LOCALS_PIPELINE,
  card_needs_pipeline: "Pick a pipeline for the card",
  card_pipeline_mismatch: "The card's pipeline must match the lead label",
  owner_without_card: "An owner needs the pipeline card on",
  bad_owner: "Pick an owner (one person, or two or more for round robin)",
  follow_up_needs_consent: "Follow-up emails need a consent box on the form",
  stage_needs_card: "A pipeline move needs the pipeline card on",
  waits_over_90_days: "Waits add up to more than 90 days",
  too_many_steps: "The flow has more than 30 steps",
  branch_too_deep: "Branches are nested more than 3 deep",
  empty_doc: "an email needs some text",
  bad_subject: "an email needs a subject (up to 80 characters)",
  bad_branch_field: "a branch question must be a choice question on this form",
  bad_wait: "a wait needs 1 to 60 hours, days or weeks",
  bad_name: "needs a name (up to 60 characters)",
  bad_to: "pick who it goes to",
  bad_from: "pick who it is from",
  bad_reply_to: "pick where replies go",
  bad_button: "the button text needs 1 to 28 characters",
  bad_show_answers: "turn \"Show their answers\" on or off",
  bad_include_answers: "turn \"Include their answers\" on or off",
  bad_action_bar: "pick the buttons above the footer",
  bad_cond: "the branch condition is incomplete",
  bad_branch: "a branch needs a Yes and a No path",
  bad_stage: "pick a stage that is in this pipeline",
  bad_type: "this kind of step is not supported",
  bad_id: "has a broken step id",
  duplicate_id: "Two steps share an id. Remove one and add it again",
  bad_flow: "The flow could not be read. Reload the page",
});

/** A contract error as a line the builder lists ("Your city: needs a label…"). */
export function errorLine(err, def, flow) {
  const m = /^fields\[(\d+)\]/.exec(err.path || "");
  const tok = /^unknown_token:(.+)$/.exec(err.code || "");
  if (tok) return `Unknown merge field {${tok[1]}}${stepName(err.path, flow)}`;
  const words = ERROR_COPY[err.code] || err.code.replace(/_/g, " ");
  if (m) {
    const f = def?.fields?.[Number(m[1])];
    return `${f?.label || `Field ${Number(m[1]) + 1}`}: ${words}`;
  }
  if ((err.path || "").startsWith("steps")) return `${words[0].toUpperCase()}${words.slice(1)}${stepName(err.path, flow)}`;
  return words[0].toUpperCase() + words.slice(1);
}

function stepName(path, flow) {
  const step = findByPath(flow?.steps || [], path || "");
  return step?.name ? ` (in "${step.name}")` : "";
}

function findByPath(steps, path) {
  const parts = [...String(path).matchAll(/\[(\d+)\]|\.(yes|no)/g)];
  let list = steps;
  let cur = null;
  for (const p of parts) {
    if (p[1] !== undefined) { cur = list?.[Number(p[1])]; }
    else { list = Array.isArray(cur?.[p[2]]) ? cur[p[2]] : []; }
  }
  return cur;
}

/** The Publish tab: the five checks (✓ / !) and every R / F error, by field. */
export function publishReview(def, flow, testedAt, { cardOn, stages = [] } = {}) {
  const sendsEmail = Object.values(flow ? emailKinds(flow) : {}).some((k) => k === "confirmation" || k === "follow_up");
  const checks = publishChecks(def, flow, testedAt).map((c) => {
    const [title, detail] = c.id === "tested" && !sendsEmail && testedAt === null ? NO_EMAILS_TO_TEST : CHECK_COPY[c.id];
    return { ...c, title, detail };
  });
  const defErrors = validateDefinition(def);
  const flowErrors = flow && Array.isArray(flow.steps) && flow.steps.length
    ? validateFlow(flow, { def, cardOn: cardOn ?? Boolean(def?.routing?.card?.on), stages })
    : [];
  const errors = [...defErrors, ...flowErrors].map((e) => ({ ...e, line: errorLine(e, def, flow) }));
  const ok = checks.every((c) => c.ok) && errors.length === 0;
  return { checks, errors, ok };
}

/** The server's publish_check_failed DETAIL (a JSON list) as builder lines. */
export function serverCheckLines(detail, def, flow) {
  let list = [];
  try { list = JSON.parse(detail || "[]"); } catch { list = []; }
  return (Array.isArray(list) ? list : []).map((e) => (e.path === "check" ? CHECK_COPY[e.code]?.[0] || e.code : errorLine(e, def, flow)));
}

/**
 * #4452 B23: the server's invalid_flow DETAIL (a JSON list of {path, code}) mapped onto the
 * Automations steps. `bad_step:<id>` names the step; the client contract says why. Returns
 * `{ byStep: { [stepId]: reason }, general: [line] }`; the toast never points at Publish.
 */
export function flowSaveErrors(detail, flow, def, { cardOn = false, stages = [] } = {}) {
  let list = [];
  try { list = JSON.parse(detail || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const steps = flow?.steps || [];
  const all = [];
  const walk = (xs) => (xs || []).forEach((s) => {
    if (s && typeof s === "object") all.push(s);
    if (s?.type === "branch") { walk(s.yes); walk(s.no); }
  });
  walk(steps);
  const local = flow && Array.isArray(steps) && def
    ? validateFlow(flow, { def, cardOn, stages: stages.map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean) })
    : [];
  const reasonFor = (step) => {
    const hit = local.find((e) => (e.path || "").startsWith("steps") && findByPath(steps, e.path) === step);
    if (!hit) return "Mingla could not save this step. Check each setting.";
    const words = ERROR_COPY[hit.code] || (/^unknown_token:(.+)$/.exec(hit.code) ? `has an unknown merge field {${hit.code.split(":")[1]}}` : hit.code.replace(/_/g, " "));
    return words[0].toUpperCase() + words.slice(1) + ".";
  };
  const kinds = flow ? emailKinds(flow) : {};
  const byStep = {};
  const general = [];
  const mark = (step, reason) => { if (step?.id && !byStep[step.id]) byStep[step.id] = reason; };
  for (const e of list) {
    const code = String(e?.code || "");
    const bad = /^bad_step:(.+)$/.exec(code);
    const tok = /^unknown_token:(.+)$/.exec(code);
    if (bad) {
      const step = all.find((s) => s.id === bad[1]);
      if (step) mark(step, reasonFor(step));
      else general.push("A step could not be saved. Remove it and add it again.");
    } else if (tok) {
      const needle = `{${tok[1]}}`;
      const hits = all.filter((s) => s.type === "email" && JSON.stringify([s.subject, s.doc]).includes(needle));
      if (hits.length) hits.forEach((s) => mark(s, `Unknown merge field ${needle}. Pick one from Insert.`));
      else general.push(`Unknown merge field ${needle}.`);
    } else if (code === "stage_needs_card") {
      const hits = all.filter((s) => s.type === "stage");
      if (hits.length) hits.forEach((s) => mark(s, "A pipeline move needs the pipeline card on (Settings)."));
      else general.push(ERROR_COPY.stage_needs_card);
    } else if (code === "follow_up_needs_consent") {
      const hits = all.filter((s) => kinds[s.id] === "follow_up");
      if (hits.length) hits.forEach((s) => mark(s, "A follow-up needs a consent box on the form (Fields)."));
      else general.push(ERROR_COPY.follow_up_needs_consent);
    } else {
      const words = ERROR_COPY[code] || code.replace(/_/g, " ") || "The emails could not be saved";
      general.push(words[0].toUpperCase() + words.slice(1) + ".");
    }
  }
  return { byStep, general };
}

// ---------------------------------------------------------------------------
// The forms list (§7.3)
// ---------------------------------------------------------------------------
export const STATUS_FILTERS = Object.freeze([
  { id: "all", label: "All", status: null },
  { id: "live", label: "Live", status: "live" },
  { id: "draft", label: "Drafts", status: "draft" },
  { id: "archived", label: "Archived", status: "archived" },
]);
export const STATUS_PILL = Object.freeze({ live: ["live", "Live"], draft: ["draft", "Draft"], archived: ["stop", "Archived"] });
export const DUPLICATED_TOAST = "Duplicated as a draft. It is not on any page yet.";
export const ARCHIVED_TOAST = "Archived and taken off every page. Answers stay.";
export const UNARCHIVED_TOAST = "Unarchived as a draft. It is not on any page until you publish it again.";
export const unarchiveQuestion = (name) => `Unarchive '${name}'? It comes back as a draft, not on any page and with its emails off, until you publish it again. Answers stay.`;
export const archiveQuestion = (name) => `Archive '${name}'? It is taken off every page and its emails stop. Answers stay.`;

const SPOT_WORDS = Object.freeze({ popup: "Pop-up", "after-steps": "after the steps", "after-hero": "after the hero", details: "Details step", footer: "footer" });
/** One tag per placement ("Creators · after the steps"), or none. */
export function placementTags(row, pageName = (k) => k) {
  return (row.placements || []).map((p) => `${pageName(p.page_key)} · ${SPOT_WORDS[p.spot] || String(p.spot || "").replace(/-/g, " ")}`);
}

/** #4452 B18: the four "Free tool follow-ups" forms are system forms (template 'tool', migration 20280714004452). */
export const isToolForm = (row) => row?.template === "tool";
export const TOOL_FORM_BADGE = "Free tool emails";
export const TOOL_FORM_HINT = "The follow-up emails a free tool sends after someone uses it. Not a form on a page.";

/** "n steps" or "Uses Book-a-call emails" (design list sub-line). */
export function formSubLine(row) {
  if (row.template === "book_call_extra") return "Uses Book-a-call emails";
  if (row.template === "tool") return TOOL_FORM_HINT;
  const n = Number(row.fields || 0);
  return `${n} ${n === 1 ? "question" : "questions"}`;
}

/** The KPI change line: "+38 vs last week". */
export function weekChange(now, prev) {
  const d = Number(now || 0) - Number(prev || 0);
  return `${d >= 0 ? "+" : "−"}${Math.abs(d)} vs last week`;
}

// ---------------------------------------------------------------------------
// Results (§7.5): the funnel steps, % of the previous, bars ≥ 3%
// ---------------------------------------------------------------------------
const GOAL_STEP = Object.freeze({ call_booked: "Booked a call", app_signup: "Signed up in the app", approved: "Approved in the pipeline", none: null });

export function funnelSteps(results) {
  const f = results?.funnel || {};
  const label = LABEL_NAME[results?.label] || "Lead";
  const steps = [
    { id: "ad_clicks", label: "Ad clicks", value: f.ad_clicks ?? null },
    { id: "shown", label: "Pop-up or page shown", value: f.shown ?? 0 },
    { id: "started", label: "Started the form", value: f.started ?? 0 },
    { id: "sent", label: `Sent: ${label}`, value: f.sent ?? 0 },
  ];
  if (results?.goal === "call_booked" || results?.goal === "none" || !results?.goal) steps.push({ id: "calls_booked", label: "Booked a call", value: f.calls_booked ?? 0 });
  else steps.push({ id: results.goal, label: GOAL_STEP[results.goal], value: results.goal === "approved" ? f.approved ?? 0 : null });
  steps.push({ id: "approved", label: "Approved", value: f.approved ?? 0 });
  const top = Math.max(1, ...steps.map((s) => (typeof s.value === "number" ? s.value : 0)));
  return steps.map((s, i) => {
    const prev = steps.slice(0, i).reverse().find((p) => typeof p.value === "number");
    const pct = typeof s.value === "number" && prev && prev.value > 0 ? Math.round((100 * s.value) / prev.value) : null;
    const width = typeof s.value === "number" ? Math.max(3, Math.round((100 * s.value) / top)) : 3;
    return { ...s, pct, width };
  });
}

/** Money in the campaign's currency, or "—" when the Ads engine has no spend for it. */
export function money(cents, currency) {
  if (typeof cents !== "number") return "—";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ""}`.trim();
  }
}

export function perUnit(cents, n, currency) {
  if (typeof cents !== "number" || !n) return "—";
  return money(Math.round(cents / n), currency);
}

export const RESULTS_FOOTNOTE = "Every step above comes from the same events as the tracking log. Spend comes from the Ads engine we already run. A lead is tied to its ad click once, so the call it books later is credited to the same ad.";
export const SPEND_UNMATCHED = "Spend not in the Ads engine for this campaign";

export const RESULT_RANGES = Object.freeze([
  { id: "30d", label: "30 days", days: 30 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "all", label: "All time", days: null },
]);
export function rangeBounds(id, now = Date.now()) {
  const r = RESULT_RANGES.find((x) => x.id === id) || RESULT_RANGES[0];
  return { from: r.days ? new Date(now - r.days * 86400000).toISOString() : null, to: null };
}

// ---------------------------------------------------------------------------
// The builder's tabs and its autosave (§7.4)
// ---------------------------------------------------------------------------
export const BUILDER_TABS = Object.freeze([
  { id: "fields", label: "Fields" },
  { id: "design", label: "Design" },
  { id: "automations", label: "Automations" },
  { id: "routing", label: "Leads and lead label" },
  { id: "aftersend", label: "After send" },
  { id: "ownpage", label: "Own page" },
  { id: "where", label: "Where it shows" },
  { id: "publish", label: "Publish" },
  { id: "results", label: "Results" },
]);
export const AUTOSAVE_MS = 800;
export const CONFLICT_COPY = "Someone else changed this form.";

/** `#/forms/<id>?tab=<tab>` → {id, tab}; `#/forms?tab=submissions` → {id:null, tab}. */
export function formsRoute(hash) {
  const m = /^#\/forms(?:\/([0-9a-f-]{36}))?(?:\?(.*))?$/i.exec(String(hash || ""));
  if (!m) return { id: null, tab: null };
  const tab = new URLSearchParams(m[2] || "").get("tab");
  const tabs = m[1] ? BUILDER_TABS.map((t) => t.id) : ["submissions"];
  return { id: m[1] ? m[1].toLowerCase() : null, tab: tabs.includes(tab) ? tab : null };
}
export function formsHash(id, tab) {
  return `#/forms${id ? `/${id}` : ""}${tab ? `?tab=${tab}` : ""}`;
}

/** The header's sub-line: "<label> · goes to Leads (+ Creators) · <n> emails". */
export function builderSubLine(def, kinds) {
  const emails = Object.values(kinds || {}).filter((k) => k !== "team_alert").length;
  const goes = def?.routing?.card?.on ? `Leads + ${def.routing.card.pipeline === "hosts" ? "Hosts" : "Creators"}` : "Leads";
  return `${LABEL_NAME[def?.audience] || "No label"} · goes to ${goes} · ${emails} ${emails === 1 ? "email" : "emails"}`;
}

/** Google conversions setup card (§7.8): the six kinds and their words. */
export const GOOGLE_KINDS = Object.freeze([
  { kind: "host_lead", label: "Host lead" },
  { kind: "creator_lead", label: "Creator lead" },
  { kind: "local_lead", label: "Local lead" },
  { kind: "host_call_booked", label: "Host call booked" },
  { kind: "creator_call_booked", label: "Creator call booked" },
  { kind: "local_call_booked", label: "Local call booked" },
]);

/** The autosave state machine, kept apart from React so it is tested on its own. */
export function autosaveReducer(state, event) {
  switch (event.type) {
    case "edit":
      return { ...state, draft: event.draft, dirty: true, saveError: null };
    case "saving":
      return { ...state, saving: true };
    case "saved":
      // A newer edit than the one saved stays dirty.
      return { ...state, saving: false, rev: event.rev, dirty: state.draft !== event.sent, conflict: false };
    case "conflict":
      return { ...state, saving: false, conflict: true };
    case "error":
      return { ...state, saving: false, saveError: event.message };
    case "load":
      return { draft: event.draft, rev: event.rev, dirty: false, saving: false, conflict: false, saveError: null };
    default:
      return state;
  }
}

// ── #4452 B19: plain words when an Admin → edge function call fails ─────────
/** The browser could not reach the function at all (network, CORS, cold-start relay). */
export const FUNCTION_UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
const FUNCTION_CODE_WORDS = Object.freeze({
  forbidden: "You don't have edit access. Ask an admin for the Website editor role.",
  form_not_found: "That form is gone. It may have been removed.",
  server: "Something on the server failed. Try again.",
});
/**
 * The toast line for a failed functions.invoke: the server's own message when
 * it sent one, else words for its error code, else the unreachable line. The
 * client library's raw "Failed to send a request to the Edge Function" is never shown.
 */
export function functionErrorWords(error, payload) {
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
  const code = typeof payload?.error === "string" ? payload.error : "";
  if (code) return FUNCTION_CODE_WORDS[code] || "That did not go through. Try again.";
  if (error?.name === "FunctionsFetchError" || error?.name === "FunctionsRelayError") return FUNCTION_UNREACHABLE;
  return "That did not go through. Try again.";
}
