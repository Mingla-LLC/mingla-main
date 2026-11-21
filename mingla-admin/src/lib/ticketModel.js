// Issue #4420 (step 4) — Ticket cards on the Work board.
//
// A ticket is an ordinary Work card with kind "ticket" (the database keeps its
// type, product area and reporters beside it). Pure module: no React, no
// Supabase. The form, the detail sections and a plain node test read it.
//
// Rules this file holds (Seth's decisions, 2026-11-21):
//   * the person making a ticket CHOOSES its owner, like any card; there is no
//     automatic owner and no owner lock;
//   * a ticket has exactly one watcher who is not the owner, like any card
//     (#4398). The form has the card form's Watcher field; the creator is
//     filled in as watcher only when they are not the owner, and the form is
//     not sent without a valid watcher;
//   * a ticket without a due date is due in 7 days: the form shows that date
//     filled in, and the person may change it;
//   * agents never create tickets (the form is a person's).
import { addDays } from "./opsModel.js";

export const TICKET_TYPES = Object.freeze([
  Object.freeze({ value: "bug", label: "Bug" }),
  Object.freeze({ value: "idea", label: "Idea" }),
  Object.freeze({ value: "question", label: "Question" }),
  Object.freeze({ value: "task", label: "Task" }),
]);
const TYPE_VALUES = TICKET_TYPES.map((t) => t.value);

export const TICKET_DEFAULT_DUE_DAYS = 7;
export const TITLE_MIN = 3;
export const TITLE_MAX = 160;
export const WRONG_MIN = 10;
export const WRONG_MAX = 4000;
export const SIMILAR_MIN_CHARS = 3;
export const SIMILAR_DEBOUNCE_MS = 300;
export const TICKET_CONVERSATION_LIMIT = 20;

/** The label of a ticket type ("bug" -> "Bug"); "" for anything else. */
export function ticketTypeLabel(value) {
  return TICKET_TYPES.find((t) => t.value === value)?.label || "";
}

/**
 * THE one test for "this Work card is a ticket" (filter, chip, views, detail,
 * menu count). The server adds the `ticket` key to a card's JSON for tickets
 * only, in every shape (full, board, board_text, and the single card); the
 * board shape carries no `kind`, so `kind` must never be read for this.
 */
export function isTicketCard(card) {
  return !!card && typeof card === "object" && Object.prototype.hasOwnProperty.call(card, "ticket");
}

/** THE one way a ticket's number is written: "T12" (the card's own number). */
export function ticketNumber(number) {
  const n = Number(number);
  return Number.isInteger(n) && n > 0 ? `T${n}` : "T?";
}

/** The date a ticket without a chosen date is due: today plus 7 days, as YYYY-MM-DD. */
export function defaultTicketDue(today) {
  return addDays(today, TICKET_DEFAULT_DUE_DAYS);
}

/** The Ticket chip on a card face: "Ticket", T-number, type and reporter count. */
export function ticketChipWords(card) {
  if (!isTicketCard(card)) return null;
  const t = card.ticket || {};
  const reporters = Number(t.reporter_count) || 0;
  return {
    label: "Ticket",
    number: ticketNumber(card.number),
    type: ticketTypeLabel(t.type),
    reporters,
    reporterWords: reporters > 0 ? `${reporters} ${reporters === 1 ? "reporter" : "reporters"}` : "",
  };
}

/**
 * The #4398 watcher rule, worded exactly as the server's ops_people_check
 * fix for the watchers field.
 */
export const WATCHER_RULE_WORDS = "A card has one watcher, who is not the owner.";

const clean = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/** The watcher a new ticket form starts with: the creator, only when they are not the owner. */
export function initialTicketWatchers(owners, me) {
  const o = clean(owners);
  return me && o.length > 0 && !o.some((x) => same(x, me)) ? [me] : [];
}

/**
 * The watcher after the owner changes. A watcher who became the owner is
 * dropped; an empty watcher is filled with the creator when they are not the
 * new owner; the creator filled in that way is dropped when they become the
 * owner. A watcher the person picked otherwise stays.
 */
export function nextTicketWatchers(nextOwners, watchers, me) {
  const o = clean(nextOwners);
  const w = clean(watchers).filter((x) => !o.some((y) => same(x, y)));
  return w.length > 0 ? w : initialTicketWatchers(o, me);
}

/**
 * The call's ticket object. The owner and the watcher are what the person
 * picked (like any card). `conversationIds` are the source conversations.
 */
export function buildTicketPayload(form, { createdFrom = "board" } = {}) {
  const f = form || {};
  const out = {
    type: f.type,
    title: String(f.title || "").replace(/[\r\n]+/g, " ").trim(),
    what_is_wrong: String(f.whatIsWrong || "").trim(),
    product_area: String(f.productArea || "").trim(),
    created_from: createdFrom,
    owners: clean(f.owners),
    watchers: clean(f.watchers),
  };
  if (f.due) out.due_on = f.due;
  const ids = Array.isArray(f.conversationIds) ? f.conversationIds.filter(Boolean) : [];
  if (ids.length) out.conversation_ids = ids.slice(0, TICKET_CONVERSATION_LIMIT);
  if (f.brandId) out.brand_id = f.brandId;
  return out;
}

/** What is wrong with the form before it is sent (the server checks again and has the last word). */
export function ticketFormProblems(form) {
  const f = form || {};
  const problems = {};
  if (!TYPE_VALUES.includes(f.type)) problems.type = "Pick a type.";
  const title = String(f.title || "").trim();
  if (title.length < TITLE_MIN) problems.title = `Give the ticket a title of at least ${TITLE_MIN} characters.`;
  if (String(f.whatIsWrong || "").trim().length < WRONG_MIN) problems.what_is_wrong = `Say what is wrong in at least ${WRONG_MIN} characters.`;
  if (!String(f.productArea || "").trim()) problems.product_area = "Pick the product area.";
  if (!Array.isArray(f.owners) || f.owners.filter(Boolean).length < 1) problems.owner = "Choose who owns this ticket.";
  const w = clean(f.watchers);
  if (w.length !== 1 || clean(f.owners).some((o) => same(o, w[0]))) problems.watchers = WATCHER_RULE_WORDS;
  return problems;
}

/** The refused answer's fixes, by field: { title: "...", what_is_wrong: "..." }. */
export function fixesByField(fixes) {
  const out = {};
  for (const fix of Array.isArray(fixes) ? fixes : []) {
    const field = typeof fix?.field === "string" ? fix.field : "item";
    const words = typeof fix?.message === "string" ? fix.message : "";
    if (words) out[field] = out[field] ? `${out[field]} ${words}` : words;
  }
  return out;
}

/**
 * Whether to look for similar open tickets for this title: 3+ characters and
 * the words are not the ones already searched.
 */
export function shouldSearchSimilar(title) {
  return String(title || "").trim().length >= SIMILAR_MIN_CHARS;
}

/** The similar-ticket row's words: "T12 · Bug · 3 reporters". */
export function similarWords(row) {
  const reporters = Number(row?.reporter_count) || 0;
  return [ticketNumber(row?.number), ticketTypeLabel(row?.type), `${reporters} ${reporters === 1 ? "reporter" : "reporters"}`].filter(Boolean).join(" · ");
}

export const SUPPORT_ACCESS_WORDS = "Support access needed to read these conversations";

/**
 * What the ticket's conversations show, from ops_ticket_conversations:
 *   { mode: "support", conversations }   Support staff: the messages, photos and notes
 *   { mode: "count", reporters, words }  anyone else: only how many reporters, never content
 *   { mode: "error" }                    the read failed
 * Content is only ever taken from an answer whose access is "support".
 */
export function conversationsView(answer) {
  if (!answer || typeof answer !== "object") return { mode: "error" };
  if (answer.access === "support") {
    return { mode: "support", reporters: Number(answer.reporter_count) || 0, conversations: Array.isArray(answer.conversations) ? answer.conversations : [] };
  }
  const reporters = Number(answer.reporter_count) || 0;
  return {
    mode: "count",
    reporters,
    words: `${reporters} ${reporters === 1 ? "reporter" : "reporters"}. ${SUPPORT_ACCESS_WORDS}.`,
  };
}

/** A conversation message's label: staff-only notes are marked. */
export function messageKind(message) {
  if (message?.is_internal) return "note";
  if (message?.sender_kind === "customer") return "customer";
  if (message?.sender_kind === "system") return "system";
  return "staff";
}

export function segmentLabel(segment) {
  return segment === "business" ? "Host" : segment === "explorer" ? "Explorer" : "";
}

/** "Conversation 12 · Host · Open" for a reporter row. */
export function reporterRowWords(conversation) {
  const status = String(conversation?.status || "");
  const statusWords = status ? status.charAt(0).toUpperCase() + status.slice(1) : "";
  return [`Conversation ${conversation?.ticket_number ?? ""}`.trim(), segmentLabel(conversation?.segment), statusWords].filter(Boolean).join(" · ");
}

/** The open-in-Support address of a conversation (both spellings are accepted by Support). */
export function conversationHref(id) {
  return `#/support?conversation=${encodeURIComponent(id)}`;
}

/**
 * The Send to GitHub section's state (spec section 8):
 *   task      a task ticket uses the card's own GitHub field
 *   closed    the ticket is done
 *   operator  can send: product operators (owner, admin, partner)
 *   locked    anyone else sees the section with the button off and the words
 */
export const GITHUB_LOCKED_WORDS = "Only product operators send tickets to GitHub.";
export const GITHUB_TASK_WORDS = "A task ticket uses the GitHub field on the card.";

/**
 * The Send to GitHub steps answer with bare codes ("acceptance_criteria_required").
 * A person never sees a code: each known one becomes what is missing and where
 * to fix it; anything else gets one plain sentence.
 */
export const GITHUB_ERROR_WORDS = Object.freeze({
  acceptance_criteria_required: "Add at least one line under “Acceptance criteria · one per line”, then save again.",
  product_fields_required: "Pick the Product, Theme, Priority, Estimate, Horizon and Quarter, then save again.",
  public_review_required: "Save the public review first: title, problem, outcome and acceptance criteria.",
  create_uses_reviewed_fields_only: "Save the public review first. GitHub only gets the saved wording.",
  search_uses_reviewed_fields_only: "Save the public review first. The search only uses the saved wording.",
  candidate_search_required: "Search GitHub for matching issues first.",
  candidate_decisions_required: "For each issue found, choose it or say why it doesn’t fit, then try again.",
  candidate_reason_required: "Say why this issue doesn’t fit in “Why this issue doesn’t fit”.",
  candidate_search_and_no_fit_reason_required: "Search GitHub first, then say in “Why none of these fits” (at least 20 characters) why no issue fits.",
  no_fit_reason_required: "Say in “Why none of these fits” (at least 20 characters) why no issue fits.",
  selected_candidate_required: "Choose the matching issue first.",
  selected_candidate_must_be_linked: "Link the issue you chose first.",
  candidate_not_found: "That issue is no longer in the search results. Search again.",
  product_operator_required: GITHUB_LOCKED_WORDS,
  not_authorized: GITHUB_LOCKED_WORDS,
  stale_revision: "Someone else changed this ticket. Reload it and try again.",
  invalid_expected_revision: "Someone else changed this ticket. Reload it and try again.",
  signal_not_found: "This ticket’s GitHub record wasn’t found. Reload the ticket and try again.",
});
export const GITHUB_ERROR_FALLBACK = "GitHub didn’t take that. Check the fields above and try again. If it keeps happening, tell the engineering team.";

export function githubErrorWords(error) {
  const text = String(error?.message ?? error ?? "");
  for (const word of text.match(/[a-z][a-z_]*[a-z]/g) || []) {
    if (Object.prototype.hasOwnProperty.call(GITHUB_ERROR_WORDS, word)) return GITHUB_ERROR_WORDS[word];
  }
  return GITHUB_ERROR_FALLBACK;
}

export function githubSectionState(card, { isOperator = false } = {}) {
  if (!isTicketCard(card)) return { mode: "none" };
  if (card.ticket?.type === "task") return { mode: "task", words: GITHUB_TASK_WORDS };
  if (!isOperator) return { mode: "locked", words: GITHUB_LOCKED_WORDS, disabled: true };
  return { mode: "operator", disabled: false, hasSignal: !!card.ticket?.source_signal_id };
}

/** The menu's Work count: due-today and overdue cards plus tickets I own still in To do. */
export function workMenuCount(dueCards, ticketsNew) {
  const a = Number(dueCards);
  const b = Number(ticketsNew);
  return (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) && b > 0 ? b : 0);
}

/**
 * A ticket I own in To do is already in the due-today and overdue counts when
 * its date has come. This counts only the owned To do tickets that are NOT yet
 * due (no date, or a later one), so each card is counted once in the menu.
 * `cards` is my To do list (board shape: the ticket key, status and due_on are all it reads); `raw` is
 * ops_ticket_counts' answer and caps the result.
 */
export function ticketsNotAlreadyDue(cards, today, raw) {
  const ceiling = Number(raw);
  if (!Array.isArray(cards) || !(ceiling > 0)) return 0;
  const todayKey = String(today || "").slice(0, 10);
  const n = cards.filter((c) => {
    if (!isTicketCard(c) || c?.status !== "todo") return false;
    const due = c?.due_on ? String(c.due_on).slice(0, 10) : "";
    return !due || !todayKey || due > todayKey;
  }).length;
  return Math.min(n, ceiling);
}
