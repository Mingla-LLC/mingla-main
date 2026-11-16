// #4452 §5.1–§5.2 — the automation flow the builder edits: a tree of steps
// (email, team, wait, branch, stage) with Yes / No paths. Pure functions over
// the AutomationFlow JSON the server validates (forms_validate_flow) and the
// sender walks. Ids are minted on add and never reused (F-2).
import { emailKinds } from "../../../supabase/functions/_shared/formsContract.ts";

export const STEP_TYPES = Object.freeze([
  { type: "email", label: "Email to the person", hint: "In the Mingla style" },
  { type: "team", label: "Team alert", hint: "Their answers, reply goes to them" },
  { type: "wait", label: "Wait", hint: "Then send at 10:00 their time" },
  { type: "branch", label: "Branch", hint: "Split on an answer or what they did" },
  { type: "stage", label: "Move in the pipeline", hint: "Needs the pipeline card" },
]);

export const FROM_OPTIONS = Object.freeze([
  { id: "creators", label: "Mingla Creators" },
  { id: "locals", label: "Mingla Locals" },
  { id: "hosts", label: "Mingla Hosts" },
  { id: "seth", label: "Seth at Mingla" },
]);
export const TEAM_TO = Object.freeze([
  { id: "creators_inbox", label: "Creators inbox" },
  { id: "locals_inbox", label: "Locals inbox" },
  { id: "hosts_inbox", label: "Hosts inbox" },
  { id: "owner", label: "The card owner" },
  { id: "seth", label: "Seth" },
]);
export const ACTION_BAR_OPTIONS = Object.freeze([
  { id: "auto", label: "Auto (recommended)" },
  { id: "host", label: "Host" },
  { id: "creator", label: "Creator" },
  { id: "local", label: "Local" },
  { id: "off", label: "None" },
]);
export const BRANCH_ON = Object.freeze([
  { id: "answer", label: "An answer" },
  { id: "booked", label: "They booked a call" },
  { id: "opened_last", label: "They opened the last email" },
  { id: "clicked_last", label: "They clicked the last email" },
  { id: "lead_label", label: "Lead label" },
]);
export const WAIT_UNITS = Object.freeze(["hours", "days", "weeks"]);
export const KIND_COPY = Object.freeze({
  confirmation: ["Confirmation", "Sent to everyone, straight away. No consent needed."],
  follow_up: ["Follow-up", "After a wait, so it is a marketing email: needs consent and carries an unsubscribe link."],
  team_alert: ["Team alert", "To the team inbox; Reply goes to the person."],
});
export const SAVED_TOAST = "Saved. People already in the flow keep the emails they were sent; new steps apply from their next step.";
export const STOP_RULES = Object.freeze([
  { id: "booked", label: "Book a call", locked: false },
  { id: "replied", label: "Reply to any email", locked: true, soon: true },
  { id: "unsub", label: "Unsubscribe", locked: true, always: true },
  { id: "stage", label: "Move past New in the pipeline", locked: false },
]);

/** A short random id: lower-case letters and digits, unique in `taken`. */
export function mintId(type, taken) {
  const used = new Set(taken);
  for (let i = 0; i < 50; i += 1) {
    const id = `${type.slice(0, 2)}${Math.random().toString(36).slice(2, 8)}`;
    if (/^[a-z0-9_-]{2,40}$/.test(id) && !used.has(id)) return id;
  }
  return `${type.slice(0, 2)}${Date.now().toString(36)}`;
}

/** Every step id in the tree (F-2 is checked against all of them). */
export function allIds(steps) {
  const out = [];
  const walk = (list) => (list || []).forEach((s) => {
    out.push(s.id);
    if (s.type === "branch") { walk(s.yes); walk(s.no); }
  });
  walk(steps);
  return out;
}

/** Defaults for a new step (the composer's opening line, 2 days at 10:00, …). */
export function newStep(type, flow, ctx = {}) {
  const id = mintId(type, allIds(flow.steps));
  switch (type) {
    case "email":
      return {
        id, type, name: "New email", to: "person", from: ctx.from || "creators", reply_to: "team",
        subject: "Hi {first_name}", doc: [{ id: `${id}b`, type: "rich_text", html: "<p>Hi {first_name},</p><p>Write your note here.</p>" }],
        show_answers: false, action_bar: "auto",
      };
    case "team":
      return { id, type, name: "Team alert", to: ctx.teamTo || "creators_inbox", include_answers: true };
    case "wait":
      return { id, type, n: 2, unit: "days", at10: true, skip_weekends: false };
    case "branch":
      return { id, type, cond: { on: "booked", op: "is", value: "yes" }, yes: [], no: [] };
    case "stage":
      return { id, type, stage: ctx.firstStage || "" };
    default:
      throw new Error(`unknown step type ${type}`);
  }
}

/**
 * Insert `step` into the list addressed by `path` ([] = top level; [branchId, "yes"|"no"]
 * for a branch path) at `index`.
 */
export function insertStep(flow, path, index, step) {
  const put = (list) => {
    const next = list.slice();
    next.splice(Math.max(0, Math.min(index, next.length)), 0, step);
    return next;
  };
  if (!path.length) return { ...flow, steps: put(flow.steps || []) };
  const [branchId, side] = path;
  return { ...flow, steps: mapTree(flow.steps || [], (s) => (s.id === branchId && s.type === "branch" ? { ...s, [side]: put(s[side] || []) } : s)) };
}

/** Remove a step (a branch goes with both its paths). */
export function removeStep(flow, id) {
  const drop = (list) => (list || []).filter((s) => s.id !== id).map((s) => (s.type === "branch" ? { ...s, yes: drop(s.yes), no: drop(s.no) } : s));
  return { ...flow, steps: drop(flow.steps) };
}

export function updateStep(flow, id, patch) {
  return { ...flow, steps: mapTree(flow.steps || [], (s) => (s.id === id ? { ...s, ...patch, id: s.id, type: s.type } : s)) };
}

export function findStep(steps, id) {
  for (const s of steps || []) {
    if (s.id === id) return s;
    if (s.type === "branch") {
      const hit = findStep(s.yes, id) || findStep(s.no, id);
      if (hit) return hit;
    }
  }
  return null;
}

function mapTree(list, fn) {
  return list.map((s) => {
    const m = fn(s);
    return m.type === "branch" ? { ...m, yes: mapTree(m.yes || [], fn), no: mapTree(m.no || [], fn) } : m;
  });
}

/** The kind of every email (F-6): confirmation before any wait on its path, else follow-up. */
export function kindsOf(flow) {
  return emailKinds({ v: 1, steps: flow?.steps || [] });
}

/** Every email step in path order (for "Send me a test": one test per step, in order). */
export function emailSteps(flow) {
  const out = [];
  const walk = (list) => (list || []).forEach((s) => {
    if (s.type === "email") out.push(s);
    if (s.type === "branch") { walk(s.yes); walk(s.no); }
  });
  walk(flow?.steps);
  return out;
}

/** A card's title (design aTitle). */
export function stepTitle(s, fields = []) {
  if (s.type === "email" || s.type === "team") return s.name || (s.type === "team" ? "Team alert" : "Email");
  if (s.type === "wait") return `Wait ${s.n} ${s.n === 1 ? s.unit.replace(/s$/, "") : s.unit}`;
  if (s.type === "stage") return "Move in the pipeline";
  if (s.type === "branch") {
    const c = s.cond || {};
    if (c.on === "answer") {
      const f = fields.find((x) => x.key === c.field_key);
      return `${f?.label || "An answer"} ${c.op === "is_not" ? "is not" : c.op === "contains" ? "includes" : "is"} ${c.value || "…"}?`;
    }
    if (c.on === "lead_label") return `Lead label is ${c.value || "…"}?`;
    return `${(BRANCH_ON.find((b) => b.id === c.on)?.label || "Branch")}?`;
  }
  return s.type;
}

/** A card's sub-line (design aSub): who it goes to and what it needs. */
export function stepSub(s, kinds) {
  if (s.type === "email") return kinds[s.id] === "follow_up" ? "To the person · follow-up, needs consent" : "To the person · confirmation";
  if (s.type === "team") return `To ${TEAM_TO.find((t) => t.id === s.to)?.label || "the team"} · reply goes to the person`;
  if (s.type === "wait") return `${s.at10 ? "Then at 10:00 in their time zone" : "Then at the same time of day"}${s.skip_weekends ? " · skips weekends" : ""}`;
  if (s.type === "branch") return "Yes and No each get their own steps";
  if (s.type === "stage") return s.stage ? `To ${s.stage}` : "Pick a stage";
  return "";
}

/** "214 sent · 92% opened · 41% clicked" from admin_automation_get's per-step stats. */
export function stepStats(stats) {
  if (!stats || !stats.sent) return null;
  const pct = (n) => `${Math.round((100 * n) / stats.sent)}%`;
  return `${stats.sent} sent · ${pct(stats.opened || 0)} opened · ${pct(stats.clicked || 0)} clicked`;
}

/** A wait in words for the editor's line: "Then send at 10:00 in their time zone". */
export function totalWaitDays(steps) {
  let max = 0;
  const walk = (list, d) => {
    let days = d;
    for (const s of list || []) {
      if (s.type === "wait") days += s.unit === "hours" ? s.n / 24 : s.unit === "weeks" ? s.n * 7 : s.n;
      if (s.type === "branch") { walk(s.yes, days); walk(s.no, days); }
    }
    max = Math.max(max, days);
  };
  walk(steps, 0);
  return max;
}

/** The stops object the server stores (unsub always on, replied always off). */
export function normalizeStops(stops) {
  return { booked: stops?.booked !== false, replied: false, unsub: true, stage: stops?.stage !== false };
}

/** The design's sample person for previews and "Send me this email" (§5.7). */
export const SAMPLE_VALUES = Object.freeze({
  first_name: "Ada", name: "Ada Okafor", page: "/creators", spot: "after the steps",
  utm_source: "meta", utm_campaign: "creators-lagos-nov", form_name: "Creators: join the program",
});
