/**
 * #4453 Website workspace — Ari's side of the panel, as plain data. Ari's
 * plan is a tool proposal (`propose_site_change_set`); the workspace confirms
 * it on the owner's behalf (draft only, undoable) and shows each step land.
 * Everything Ari's server sends is read defensively here: a missing or odd
 * field degrades to less detail, never to a claim that something changed.
 */

export const CHANGE_SET_TOOL = "propose_site_change_set";
export const TEAM_REQUEST_TOOL = "propose_website_team_request";
export const WORKSPACE_CONTEXT = "website_workspace" as const;

/** The same five fields the server accepts (anything else is a 400); the label is cut to its 80. */
export type AriSiteFocus = {
  page_id: string;
  page_path: string;
  section_id: string;
  section_type: string;
  section_label: string;
};
export const SITE_FOCUS_LABEL_MAX = 80;

type Loose = Record<string, unknown>;
const isRecord = (value: unknown): value is Loose => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export type AriPlanStep = { label: string; why: string; pageId: string | null; sectionId: string | null };
export type AriCouldnt = { what: string; why: string };
export type AriPlan = { request: string; summary: string; steps: AriPlanStep[]; couldnt: AriCouldnt[] };

function couldntOf(value: unknown): AriCouldnt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [{ what: entry.trim(), why: "" }];
    if (!isRecord(entry) || !str(entry.what)) return [];
    return [{ what: str(entry.what), why: str(entry.why) }];
  });
}

/** Ari's plan from its proposal, or null when the proposal is not a change set. */
export function planFromProposal(toolName: string, args: unknown): AriPlan | null {
  if (toolName !== CHANGE_SET_TOOL || !isRecord(args) || !Array.isArray(args.steps)) return null;
  const steps = args.steps.flatMap((entry): AriPlanStep[] => {
    if (!isRecord(entry) || !str(entry.label)) return [];
    const step = isRecord(entry.step) ? entry.step : {};
    return [{ label: str(entry.label), why: str(entry.why), pageId: str(step.page_id) || null, sectionId: str(step.section_id) || null }];
  });
  if (steps.length === 0 && couldntOf(args.couldnt).length === 0) return null;
  return { request: str(args.request), summary: str(args.summary), steps, couldnt: couldntOf(args.couldnt) };
}

export type TeamRequestDraft = {
  what: string;
  where: { page_path: string; section_id: string | null; section_label: string | null };
  whereLine: string;
  why: string;
  missingCapability: string;
};

export function ticketWhereLine(pageTitle: string | null, sectionLabel: string | null): string {
  const page = pageTitle?.trim() || "Your website";
  return sectionLabel?.trim() ? `${page} › ${sectionLabel.trim()}` : page;
}

/**
 * What the team reads under "Ari could not" when nothing more exact is known:
 * plain words, never a code.
 */
export const NO_CONTROL_YET = "The website editor has no control for this change yet";

/** The request Ari wrote for the team, from its proposal. */
export function teamRequestFromProposal(toolName: string, args: unknown, pageTitleOf: (path: string) => string | null): TeamRequestDraft | null {
  if (toolName !== TEAM_REQUEST_TOOL || !isRecord(args) || !str(args.what)) return null;
  const where = isRecord(args.where) ? args.where : {};
  const pagePath = typeof where.page_path === "string" ? where.page_path : "";
  const sectionLabel = str(where.section_label) || null;
  return {
    what: str(args.what),
    where: { page_path: pagePath, section_id: str(where.section_id) || null, section_label: sectionLabel },
    whereLine: ticketWhereLine(pageTitleOf(pagePath), sectionLabel),
    why: str(args.why) || "Ari has no way to make this change yet",
    missingCapability: str(args.missing_capability) || NO_CONTROL_YET,
  };
}

/**
 * What confirming a request Ari proposed sends as `edited_args`. The server
 * REPLACES the stored request with it and checks every required field again
 * (brand, site, where, why, what the website cannot do), so the owner's
 * edited words travel with the rest of the proposal, never on their own.
 */
export function teamRequestEditedArgs(toolArgs: Record<string, unknown> | null, what: string): Record<string, unknown> | undefined {
  if (!toolArgs) return undefined;
  const { __proposal_context: _context, ...args } = toolArgs;
  return { ...args, what };
}

/** The request an owner starts themselves from a section ("Ask the Mingla team"). */
export function teamRequestFromSection(input: { typed: string; pageTitle: string | null; pagePath: string; sectionId: string | null; sectionLabel: string | null }): TeamRequestDraft {
  const want = input.typed.trim();
  const section = input.sectionLabel?.trim() || null;
  const place = section ? `“${section}” on ${input.pageTitle?.trim() || "your website"}` : input.pageTitle?.trim() || "your website";
  return {
    what: want ? `${want.replace(/[.\s]+$/, "")} (in ${place}).` : "",
    where: { page_path: input.pagePath, section_id: input.sectionId, section_label: section },
    whereLine: ticketWhereLine(input.pageTitle, section),
    why: "A custom change to this part of the website",
    missingCapability: NO_CONTROL_YET,
  };
}

/** The request built from what Ari said it could not do. */
export function teamRequestFromCouldnt(input: { request: string; couldnt: readonly AriCouldnt[]; pageTitle: string | null; pagePath: string; focus: AriSiteFocus | null }): TeamRequestDraft {
  const first = input.couldnt[0];
  return {
    what: input.request.trim() || first?.what || "",
    where: { page_path: input.focus?.page_path ?? input.pagePath, section_id: input.focus?.section_id ?? null, section_label: input.focus?.section_label ?? null },
    whereLine: ticketWhereLine(input.pageTitle, input.focus?.section_label ?? null),
    why: first ? [first.what, first.why].filter(Boolean).join(": ") : "Ari could not make this change",
    missingCapability: first?.what || NO_CONTROL_YET,
  };
}

/** The shortest of the limits a request passes through (Ari's request tool takes 1000; the database 2000). */
export const TEAM_REQUEST_MAX = 1000;

export function teamRequestBlocked(what: string, sending: boolean): string | null {
  if (sending) return "Sending…";
  if (!what.trim()) return "Say what you want changed first.";
  if (what.length > TEAM_REQUEST_MAX) return `Keep it under ${TEAM_REQUEST_MAX} characters.`;
  return null;
}

export const TEAM_REQUEST_SENT = {
  title: "Sent. Usually ready within 24 hours.",
  body: "The team makes it on your draft, not your live site. You’ll get a notification to review it, then you publish when you’re happy. Track it under ⋯ › Requests to the team.",
} as const;

export function teamRequestStatusLine(status: "received" | "ready" | "closed"): { text: string; tone: "warn" | "ok" | "neutral" } {
  if (status === "ready") return { text: "Ready for your review", tone: "ok" };
  if (status === "closed") return { text: "Closed", tone: "neutral" };
  return { text: "Received · usually ready within 24 hours", tone: "warn" };
}

/* ── Live step status ────────────────────────────────────────────────────── */
export type StepStatus = "waiting" | "active" | "done" | "failed" | "putback";
export type StepEvent = { event_type: string } & Loose;

function eventIndex(event: StepEvent): number | null {
  for (const holder of [event, event.payload, event.detail, event.metadata, event.data]) {
    if (!isRecord(holder)) continue;
    const value = holder.index ?? holder.step_index;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

/**
 * Each step's status from the activity events seen so far. Events may carry
 * the step's index; when they do not, they are read in order (a start moves
 * to the next step). `outcome` is the confirmed end: once the run is done
 * every step is done even if an event was missed; once it failed, everything
 * that had landed was put back.
 */
export function stepStatuses(count: number, events: readonly StepEvent[], outcome: "running" | "done" | "failed", failedIndex: number | null = null): StepStatus[] {
  const statuses: StepStatus[] = Array.from({ length: count }, () => "waiting");
  let cursor = -1;
  for (const event of events) {
    if (!event.event_type.startsWith("site_step_")) continue;
    const index = eventIndex(event);
    if (event.event_type === "site_step_started") {
      cursor = index ?? cursor + 1;
      if (cursor < count) statuses[cursor] = "active";
    } else {
      const at = index ?? cursor;
      if (at < 0 || at >= count) continue;
      statuses[at] = event.event_type === "site_step_done" ? "done" : event.event_type === "site_step_failed" ? "failed" : statuses[at]!;
    }
  }
  if (outcome === "done") return statuses.map(() => "done" as const);
  if (outcome === "failed") {
    const failedAt = failedIndex ?? statuses.indexOf("failed");
    return statuses.map((status, index) => (index === failedAt ? "failed" : status === "done" || status === "active" ? "putback" : "waiting"));
  }
  return statuses;
}

export const STEP_STATUS_WORDS: Readonly<Record<StepStatus, string>> = {
  waiting: "Not started",
  active: "Changing now",
  done: "Done",
  failed: "Didn’t work",
  putback: "Put back",
};

/* ── The end of a run ────────────────────────────────────────────────────── */
/*
 * As built (ARI-AS-BUILT.md): `agent-confirm-action` answers `executed` with
 * { group_id, status: "applied" | "rolled_back" | "partly_applied", total,
 *   applied: [{index,label,op,page_id,section_id}], failed?: {index,label,reason},
 *   checks: {passed, warnings: string[]} | null, checks_note?, couldnt: [{what,why}] }.
 * A failed step is a RESULT, not an error. A 409 DOMAIN_ACTION_REFUSED on a
 * re-run means the change set already ran: refresh, never retry.
 */
export type AriRunResult =
  | { ok: true; /** Colours Ari moved to the nearest readable shade. */ adjustedColours: number; groupId: string | null; applied: number; touched: { pageId: string; sectionId: string }[]; lookChanged: boolean; warnings: string[]; checksPassed: boolean; checksNote: string | null; couldnt: AriCouldnt[]; alreadyDone: boolean }
  | { ok: false; groupId: string | null; partly: boolean; failedIndex: number | null; failedLabel: string | null; reason: string };

const FAILED_FALLBACK = "One step didn’t work.";
export const ALREADY_DONE_CODE = "DOMAIN_ACTION_REFUSED";

function appliedOf(result: Loose): { count: number; touched: { pageId: string; sectionId: string }[]; lookChanged: boolean; adjusted: number } {
  const applied = Array.isArray(result.applied) ? result.applied : [];
  const touched: { pageId: string; sectionId: string }[] = [];
  let lookChanged = false;
  let adjusted = 0;
  for (const entry of applied) {
    if (!isRecord(entry)) continue;
    if (Array.isArray(entry.adjusted_colours)) adjusted += entry.adjusted_colours.length;
    if (str(entry.page_id) && str(entry.section_id)) touched.push({ pageId: str(entry.page_id), sectionId: str(entry.section_id) });
    if (entry.op === "set_look") lookChanged = true;
  }
  return { count: applied.length, touched, lookChanged, adjusted };
}

/** What `agent-confirm-action` returned for a change set, in the panel's terms. */
export function runResultFrom(response: { kind: string; result?: unknown; message?: string; code?: string }): AriRunResult {
  if (response.kind !== "executed") {
    if (response.code === ALREADY_DONE_CODE) {
      return { ok: true, adjustedColours: 0, groupId: null, applied: 0, touched: [], lookChanged: true, warnings: [], checksPassed: true, checksNote: null, couldnt: [], alreadyDone: true };
    }
    return { ok: false, groupId: null, partly: false, failedIndex: null, failedLabel: null, reason: str(response.message) || FAILED_FALLBACK };
  }
  const result = isRecord(response.result) ? response.result : {};
  const groupId = str(result.group_id) || null;
  const failed = isRecord(result.failed) ? result.failed : null;
  if (result.status === "rolled_back" || result.status === "partly_applied" || failed) {
    return {
      ok: false,
      groupId,
      partly: result.status === "partly_applied",
      failedIndex: typeof failed?.index === "number" ? failed.index : null,
      failedLabel: str(failed?.label) || null,
      reason: str(failed?.reason) || FAILED_FALLBACK,
    };
  }
  const applied = appliedOf(result);
  const checks = isRecord(result.checks) ? result.checks : null;
  const warnings = Array.isArray(checks?.warnings) ? checks.warnings.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
  return {
    ok: true,
    adjustedColours: applied.adjusted,
    groupId,
    applied: applied.count,
    touched: applied.touched,
    lookChanged: applied.lookChanged,
    warnings,
    checksPassed: checks ? checks.passed !== false : true,
    checksNote: str(result.checks_note) || (checks ? null : "The checks couldn’t run this time. Publish runs them again."),
    couldnt: couldntOf(result.couldnt),
    alreadyDone: false,
  };
}

/** A change set the server refused to run twice: it may have landed in part the first time. */
export const ALREADY_STARTED_LINE = "This change was already started. Check your draft, and use Undo this if it looks half done.";

export function doneLine(applied: number, couldnt: number): string {
  if (applied === 0) return couldnt > 0 ? "I can’t do this one myself yet, but the Mingla team can." : "Nothing needed changing.";
  return `${applied} ${applied === 1 ? "change is" : "changes are"} on your draft. Nothing is live until you publish.`;
}

export function adjustedColoursLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Ari used the nearest readable shade for one colour." : `Ari used the nearest readable shade for ${count} colours.`;
}

export function failedLine(result: Extract<AriRunResult, { ok: false }>): string {
  const step = result.failedLabel ? `“${result.failedLabel}” didn’t work. ` : "";
  const reason = /[.!?]$/.test(result.reason) ? result.reason : `${result.reason}.`;
  return result.partly
    ? `${step}${reason} I couldn’t confirm everything was put back, so part of this may still be on your draft. Undo this puts it all back.`
    : `${step}${reason} I put everything back, so your draft is exactly as it was.`;
}

/** Ari's one question (as built: `site_question` on a text reply; answers go back as ordinary messages). */
export type AriQuestion = { prompt: string; options: string[] };
export function questionFrom(value: unknown): AriQuestion | null {
  if (!isRecord(value) || !str(value.prompt) || !Array.isArray(value.options)) return null;
  const options = value.options.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 4);
  return options.length >= 2 ? { prompt: str(value.prompt), options } : null;
}

export function planIntro(state: "running" | "done" | "failed", focusLabel: string | null): string {
  if (state === "done") return "Done. Here is what I changed and why.";
  if (state === "failed") return "I stopped and put your draft back.";
  return focusLabel ? `Only “${focusLabel}” changes. Watch it on the page.` : "I’ll make these on your draft one at a time. Watch the page.";
}

export function couldntLine(entry: AriCouldnt): string {
  return entry.why ? `Couldn’t do: ${entry.what}. ${entry.why}` : `Couldn’t do: ${entry.what}.`;
}

/* ── Suggestions ─────────────────────────────────────────────────────────── */
export const ARI_INTRO = {
  title: "What should change?",
  body: "Ask here, or click anything on your page and tell Ari right there. Ari plans it, changes your draft while you watch, checks its work, and every step can be undone.",
} as const;

export const ARI_SUGGESTIONS: readonly string[] = [
  "Put booking first and make the headline punchier",
  "Make it feel more premium, keep it fun",
  "Shorten the words on this page",
  "Check my site for anything hard to read",
];

const SECTION_SUGGESTIONS: readonly { match: RegExp; chips: readonly string[] }[] = [
  { match: /hero|cover|top/i, chips: ["Make the headline punchier", "Use a different photo", "Centre it", "Shorter words"] },
  { match: /offer|experience|event|trip|listing|card|grid/i, chips: ["Show as a list", "Change the heading", "Make it stand out"] },
  { match: /time|slot|book|calendar/i, chips: ["Make it stand out", "Change the heading"] },
  { match: /faq|question|know/i, chips: ["Add a question", "Shorter answers", "Change the heading"] },
  { match: /review|testimonial|quote/i, chips: ["Change the heading", "Make it stand out"] },
  { match: /gallery|photo|image|media/i, chips: ["Use different photos", "Change the layout"] },
];

/** Up to four requests that make sense for this kind of section. */
export function sectionSuggestions(type: string, label: string): string[] {
  const found = SECTION_SUGGESTIONS.find((entry) => entry.match.test(type) || entry.match.test(label));
  return [...(found?.chips ?? ["Shorter words", "Make it stand out", "Change the layout"])].slice(0, 4);
}

/** The owner's words for a section-scoped request. */
export function scopedRequest(typed: string): string {
  return typed.trim() || "Make this section better";
}

/**
 * In Ari's message box on the web, Enter sends and Shift+Enter starts a new
 * line (a key press while an input method is composing is never a send).
 * Phones keep the return key as a new line and send with the button.
 */
export function enterSendsToAri(platform: string, key: { key?: string; shiftKey?: boolean; isComposing?: boolean }): boolean {
  return platform === "web" && key.key === "Enter" && key.shiftKey !== true && key.isComposing !== true;
}
