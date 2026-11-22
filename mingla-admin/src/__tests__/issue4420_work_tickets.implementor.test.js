// MINGLA-INVARIANT: I-4420-NOTES-STAFF-ONLY-UI | issue #4420 | the Work board never renders a ticket's linked conversations (messages, photos, internal notes) from an answer that is not Support access; everyone else sees only the reporter count and "Support access needed to read these conversations".
// MINGLA-INVARIANT: I-4420-TICKET-OWNER-CHOSEN-UI | issue #4420 | the ticket form sends the owner and the one watcher the person chose with the card form's fields and the server's one-watcher-not-the-owner rule; no automatic owner and no owner lock is drawn or sent.
// MINGLA-INVARIANT: I-4420-ORDINARY-CARD-FORM-UNCHANGED | issue #4420 | the add-card form, its payload and its linked-record kinds are exactly the card form, with nothing about tickets in it.
//
// Issue #4420 (step 4) — Ticket cards on the Admin Work board.
//
//   T-1  Type filter (All, Tickets, Cards) and Linked to: Support
//        conversations: parsed from the Work address, written back by the
//        page, applied by workFilter; old and unknown values fall away
//   T-2  tickets sit in Board, Today, This week and This month by the same
//        rules as any card
//   T-3  the ticket form: Type, Title, What is wrong, Product area, an owner
//        the person CHOOSES, Due filled in at 7 days; nothing is locked
//   T-4  the Ticket chip: T-number, type, reporter count; none on a card
//   T-5  ticket detail: conversations only for Support staff; others get the
//        count and "Support access needed"; Send to GitHub states
//   T-6  ordinary cards: the add form, its picker kinds and the header without
//        the ticket props are as before; the Work menu count includes tickets
//
// FAILS-ON-REVERT: before this change lib/ticketModel.js does not exist and
// workViews has no WORK_TYPE / "support" option / type filter, so every block
// below reds (the first import fails).
//
// Run: node --test src/__tests__/issue4420_work_tickets.implementor.test.js
// (from mingla-admin; pure logic and source assertions: no install needed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORK_LINKED, WORK_TYPE, filterFeed, pageFiltersActive, parseWorkView, periodBucket, periodRows, periodWindow, workFilter } from "../lib/workViews.js";
import { activeFilterCount } from "../lib/workBoardModel.js";
import { DETAIL_LINK_KINDS, LINK_KINDS } from "../lib/opsModel.js";
import {
  GITHUB_LOCKED_WORDS,
  SUPPORT_ACCESS_WORDS,
  buildTicketPayload,
  conversationsView,
  defaultTicketDue,
  fixesByField,
  githubSectionState,
  messageKind,
  shouldSearchSimilar,
  ticketChipWords,
  ticketFormProblems,
  initialTicketWatchers,
  nextTicketWatchers,
  WATCHER_RULE_WORDS,
  workMenuCount,
  ticketsNotAlreadyDue,
  isTicketCard,
  ticketNumber,
  githubErrorWords,
  GITHUB_ERROR_FALLBACK,
} from "../lib/ticketModel.js";
import * as ticketModel from "../lib/ticketModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => strip(read(rel));

const SETH = { email: "seth@x.test", name: "Seth" };
const TAO = { email: "tao@x.test", name: "Taofeek" };
const link = (kind, id = "x") => ({ kind, id, label: kind });
// #4420 rework 1 (P1-1): the fixtures are the REAL board shape. The first
// pass hand-made rows with `kind: "ticket"`, a key the board shape does not
// carry, so the Type filter, the chip and the views passed here while the live
// board showed no tickets. BOARD_KEYS is read from the migration's own
// ops_cards_json('board') body (the `common` object), and every fixture below
// must have exactly those keys (plus `ticket` for a ticket): see T-7.
const MIGRATION = path.resolve(SRC, "../../supabase/migrations/20281121034420_issue_4420_tickets_on_work_board.sql");
function topLevelKeys(expr) {
  // Keys of each top-level jsonb_build_object( ... ) in a `||` chain.
  const keys = [];
  let i = 0;
  while ((i = expr.indexOf("jsonb_build_object(", i)) !== -1) {
    let depth = 0; let arg = ""; let argIndex = 0; let inStr = false;
    for (let j = i + "jsonb_build_object".length; j < expr.length; j += 1) {
      const ch = expr[j];
      if (inStr) { arg += ch; if (ch === "'") inStr = false; continue; }
      if (ch === "'") { inStr = true; arg += ch; continue; }
      if (ch === "(") { depth += 1; if (depth === 1) continue; }
      if (ch === ")") { depth -= 1; if (depth === 0) { i = j; break; } }
      if (ch === "," && depth === 1) {
        if (argIndex % 2 === 0) keys.push(arg.trim().replace(/^'|'$/g, ""));
        argIndex += 1; arg = ""; continue;
      }
      arg += ch;
    }
    i += 1;
  }
  return keys;
}
const SQL = fs.readFileSync(MIGRATION, "utf8").replace(/--[^\n]*/g, "");
const CARDS_JSON = SQL.slice(SQL.lastIndexOf("FUNCTION public.ops_cards_json("));
const COMMON = CARDS_JSON.slice(CARDS_JSON.indexOf("jsonb_build_object(\n        'id', p.id"), CARDS_JSON.indexOf(") AS common") + 1);
const BOARD_KEYS = topLevelKeys(COMMON);
const FULL_EXTRA = CARDS_JSON.slice(CARDS_JSON.indexOf("CASE WHEN p_shape = 'full' THEN"), CARDS_JSON.indexOf("WHEN p_shape = 'board_text'"));
const FULL_KEYS = topLevelKeys(FULL_EXTRA);

/** One board-shape row exactly as ops_cards_json(..., 'board') returns it. */
function boardRow(over = {}) {
  const base = {
    id: "c1", number: 7, title: "Edit the video", status: "todo", blocked: false, person_reason: null, tag: null, anchor: null,
    due_on: "2026-11-28", overdue: false, owners: [TAO], watchers: [SETH], links: [link("host", "h1")], proof: null, closed_at: null,
    working: null, revision: 1, auto: false, auto_kind: null, archived: false, status_id: null, parent: null, depth: 0, position: 1,
    estimate_minutes: null, subtasks: { total: 0, done: 0 }, files_count: 0, thread_count: 0, goal: null, review: null,
    sent_back: null, release_items: null,
  };
  return { ...base, ...over };
}
// A ticket's board row: the same keys plus `ticket` (ops_ticket_json), and NO `kind`.
const ticket = (extra = {}) => boardRow({ id: "t1", number: 12, title: "Payout shows twice", links: [link("support_conversation", "c1")],
  ticket: { type: "bug", product_area: "Host app · Payouts", created_from: "conversation", reporter_count: 2, source_signal_id: null }, ...extra });
const card = (extra = {}) => boardRow(extra);

describe("T-1 the Type filter and Linked to: Support conversations", () => {
  it("lists the options in the approved words", () => {
    assert.deepEqual(WORK_TYPE.map((o) => [o.value, o.label]), [["", "All"], ["tickets", "Tickets"], ["cards", "Cards"]]);
    assert.ok(WORK_LINKED.some((o) => o.value === "support" && o.label === "Support conversations"));
    assert.deepEqual(WORK_LINKED.slice(0, 4).map((o) => o.value), ["", "host", "creator", "calendar"], "the old options keep their order");
  });
  it("round-trips through the Work address", () => {
    const v = parseWorkView("view=week&type=tickets&linked=support&show=attention");
    assert.equal(v.type, "tickets");
    assert.equal(v.linked, "support");
    assert.equal(v.view, "week");
    // the page writes the same keys back (go({ type }) / go({ linked })).
    const p = new URLSearchParams();
    p.set("type", v.type); p.set("linked", v.linked);
    const again = parseWorkView(p.toString());
    assert.equal(again.type, "tickets");
    assert.equal(again.linked, "support");
    assert.equal(parseWorkView("type=cards").type, "cards");
  });
  it("an unknown or missing value is no filter (never a blank page)", () => {
    assert.equal(parseWorkView("type=bogus").type, "");
    assert.equal(parseWorkView("").type, "");
    assert.equal(parseWorkView("linked=bogus").linked, "");
    assert.equal(parseWorkView("type=TICKETS").type, "", "values are exact");
  });
  it("the old Product board address lands on tickets", () => {
    assert.equal(parseWorkView("type=tickets").type, "tickets");
  });
  it("Tickets shows only tickets; Cards shows none; All shows both", () => {
    const all = [ticket(), card(), card({ id: "c2", number: 8 })];
    assert.deepEqual(workFilter(all, { type: "tickets" }).map((c) => c.id), ["t1"]);
    assert.deepEqual(workFilter(all, { type: "cards" }).map((c) => c.id), ["c1", "c2"]);
    assert.equal(workFilter(all, { type: "" }).length, 3);
    assert.equal(workFilter(all, {}).length, 3, "no type is today's behaviour");
  });
  it("Linked to: Support conversations matches support_conversation links only", () => {
    const all = [ticket(), card(), card({ id: "c3", links: [link("support_conversation", "c9")] }), card({ id: "c4", links: [] })];
    assert.deepEqual(workFilter(all, { linked: "support" }).map((c) => c.id), ["t1", "c3"], "ordinary cards can carry one too");
    assert.deepEqual(workFilter(all, { linked: "host" }).map((c) => c.id), ["c1"], "Hosts is unchanged");
    assert.deepEqual(workFilter(all, { linked: "support", type: "tickets" }).map((c) => c.id), ["t1"], "the filters combine");
  });
  it("the Type filter counts as an active filter", () => {
    assert.equal(activeFilterCount({ type: "tickets" }), 1);
    assert.equal(activeFilterCount({ owner: "a@b", show: "watch", linked: "support", type: "cards" }), 4);
    assert.equal(activeFilterCount({}), 0);
  });
  it("the page and header carry the filter in the address and clear it", () => {
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /type=\{view\.type\}/);
    assert.match(page, /onType=\{\(v\) => setFilter\(\{ type: v \}\)\}/);
    assert.match(page, /view\.linked \|\| view\.type \|\| view\.q/, "Clear filters shows when only Type is on");
    assert.match(page, /go\(\{ owner: null, show: null, linked: null, type: null, q: null, who: null \}/);
    assert.match(page, /filters = \{ owner: ownerFilter, show: view\.show, linked: view\.linked, type: view\.type,/);
    const header = code("components/ops/WorkHeader.jsx");
    assert.match(header, /<FilterChip name="type" label="Type" value=\{type\} options=\{WORK_TYPE\}/);
  });
});

describe("T-2 tickets are in Board, Today, This week and This month", () => {
  const NOW = new Date(2026, 10, 18, 10, 0, 0); // Wed 18 Nov 2026
  it("a ticket is bucketed exactly like the same card (undated open work counts as open)", () => {
    for (const view of ["today", "week", "month"]) {
      const win = periodWindow(view, NOW);
      for (const extra of [{ status: "doing" }, { status: "doing", blocked: true }, { status: "todo" }, { status: "doing", due_on: "2026-11-16" }, { status: "doing", due_on: "2027-03-01" }]) {
        assert.equal(periodBucket(ticket(extra), win), periodBucket(card(extra), win), `${view} ${JSON.stringify(extra)}`);
      }
    }
    assert.equal(periodBucket(ticket({ status: "doing", due_on: null }), periodWindow("today", NOW)), "doing", "an undated open ticket is open");
  });
  it("this week lists a ticket under its owner; a closed ticket is Done in the window", () => {
    const win = periodWindow("week", NOW);
    const closed = ticket({ id: "t2", status: "done", closed_at: new Date(2026, 10, 17, 9).toISOString() });
    const { totals, rows } = periodRows([ticket({ status: "doing", due_on: null }), closed], win, [TAO]);
    assert.equal(totals.doing, 1);
    assert.equal(totals.done, 1);
    assert.equal(rows[0].email, TAO.email);
  });
  it("the board and period lists draw the chip (WorkItem.jsx is imported nowhere, on main either)", () => {
    assert.match(code("components/ops/WorkBoard.jsx"), /<TicketChip card=\{card\} \/>/);
    assert.match(code("components/ops/WorkViews.jsx"), /<TicketChip card=\{c\} compact \/>/);
  });
});

describe("T-3 the ticket form: the creator chooses the owner", () => {
  const form = { type: "bug", title: "Payout shows twice", whatIsWrong: "A host sees the same payout twice in the list.", productArea: "Host app · Payouts", owners: ["tao@x.test"], watchers: ["seth@x.test"], due: "2026-11-28" };
  it("sends the owner and the watcher the person chose", () => {
    const p = buildTicketPayload(form);
    assert.deepEqual(p.owners, ["tao@x.test"]);
    assert.deepEqual(p.watchers, ["seth@x.test"]);
    assert.equal(p.type, "bug");
    assert.equal(p.what_is_wrong, form.whatIsWrong);
    assert.equal(p.created_from, "board");
    assert.equal(p.due_on, "2026-11-28");
  });
  it("a ticket with no owner chosen is refused before it is sent", () => {
    assert.ok(ticketFormProblems({ ...form, owners: [] }).owner);
    assert.deepEqual(ticketFormProblems(form), {});
  });
  it("checks type, title length, what is wrong and product area", () => {
    assert.ok(ticketFormProblems({ ...form, type: "" }).type);
    assert.ok(ticketFormProblems({ ...form, title: "ab" }).title);
    assert.ok(ticketFormProblems({ ...form, whatIsWrong: "short" }).what_is_wrong);
    assert.ok(ticketFormProblems({ ...form, productArea: " " }).product_area);
  });
  it("a due date is pre-filled 7 days out and may be cleared (the server then defaults it)", () => {
    assert.equal(defaultTicketDue("2026-11-21"), "2026-11-28");
    assert.equal(defaultTicketDue("2026-11-28"), "2026-12-05", "rolls into the next month");
    assert.equal(Object.hasOwn(buildTicketPayload({ ...form, due: "" }), "due_on"), false);
    const src = code("components/ops/TicketForm.jsx");
    assert.match(src, /useState\(\(\) => defaultTicketDue\(today\)\)/);
    assert.match(src, /type="date"/, "the card form's own date control (CalendarInput is not on this branch)");
  });
  it("carries the source conversation and a brand", () => {
    const p = buildTicketPayload({ ...form, conversationIds: ["c1", "c2"], brandId: "b1" }, { createdFrom: "conversation" });
    assert.deepEqual(p.conversation_ids, ["c1", "c2"]);
    assert.equal(p.brand_id, "b1");
    assert.equal(p.created_from, "conversation");
    assert.equal(buildTicketPayload(form).conversation_ids, undefined);
  });
  it("the server's refusals show next to their fields", () => {
    assert.deepEqual(fixesByField([{ field: "title", message: "Too short." }, { field: "title", message: "Be specific." }, { field: "product_area", message: "Pick one." }]), { title: "Too short. Be specific.", product_area: "Pick one." });
  });
  it("similar open tickets are searched from 3 characters, debounced, and offer Link here or Open", () => {
    assert.equal(shouldSearchSimilar("ab"), false);
    assert.equal(shouldSearchSimilar("pay"), true);
    const src = code("components/ops/TicketForm.jsx");
    assert.match(src, /ops\.similarTickets\(searched, 5\)/);
    assert.match(src, /SIMILAR_DEBOUNCE_MS/);
    assert.match(src, /Link here/);
    assert.match(src, /ops\.linkTicketConversation\(row\.id, source\.id, read\?\.card\?\.revision\)/);
  });
  it("never draws an automatic owner or an owner lock, and never fixes the owner", () => {
    const src = code("components/ops/TicketForm.jsx") + code("components/ops/TicketSections.jsx") + code("lib/ticketModel.js");
    assert.doesNotMatch(src, /ticket_owner_fixed|ticket_owner_unset|ops_ticket_settings|default_owner|defaultOwner/);
    assert.doesNotMatch(src, /read-only|readOnly|owner is fixed|assigned to Seth|Seth owns|always owned|automatically assigned|Owner is locked/i);
    const form = code("components/ops/TicketForm.jsx");
    // [TEST-MOD #4420] rework 3 (G8): the field also asks for a fitted pick list.
    assert.match(form, /<PeopleField id="new-ticket-owner" label="Owner" single fitMenu value=\{owners\}/);
    assert.doesNotMatch(form, /<PeopleField[^>]*(disabled|readOnly)/, "the owner field is a live picker");
    assert.match(form, /const \[owners, setOwners\] = useState\(me \? \[me\] : \[\]\)/, "the creator is the usual suggestion, like the card form");
  });
  it("agents never create tickets: the only create call is the form's, a person's", () => {
    const svc = code("services/opsService.js");
    assert.match(svc, /supabase\.rpc\("ops_ticket_create"/);
    assert.equal((read("components/ops/TicketForm.jsx").match(/ops\.createTicket/g) || []).length, 1);
    assert.doesNotMatch(code("lib/agentConnect.js"), /ticket_create|createTicket/);
  });
  it("+ New offers Card or Ticket and the page opens the form", () => {
    const header = code("components/ops/WorkHeader.jsx");
    assert.match(header, /onNewCard\(\); close\(\);/);
    assert.match(header, /onNewTicket\(\); close\(\);/);
    const page = code("pages/WorkBoardPage.jsx");
    assert.match(page, /onNewTicket=\{\(\) => go\(\{ newticket: true \}\)\}/);
    assert.match(page, /<TicketForm/);
    assert.match(page, /"newticket"/);
  });
});

describe("T-4 the Ticket chip", () => {
  it("shows Ticket, the T-number, the type and the reporter count", () => {
    assert.deepEqual(ticketChipWords(ticket()), { label: "Ticket", number: "T12", type: "Bug", reporters: 2, reporterWords: "2 reporters" });
    assert.equal(ticketChipWords(ticket({ ticket: { type: "idea", reporter_count: 1 } })).reporterWords, "1 reporter");
    assert.equal(ticketChipWords(ticket({ ticket: { type: "question", reporter_count: 0 } })).reporterWords, "");
  });
  it("an ordinary card has no chip", () => {
    assert.equal(ticketChipWords(card()), null);
    assert.equal(isTicketCard(card()), false);
    assert.equal(isTicketCard(ticket()), true);
    assert.equal(ticketChipWords(null), null);
  });
});

describe("T-5 ticket detail: reporters, conversations, Send to GitHub", () => {
  const secret = { support_ticket_id: "c1", ticket_number: 5, customer_name: "Ada", messages: [{ id: "m1", content: "TOP SECRET NOTE", is_internal: true, sender_kind: "staff" }] };
  it("Support staff get the conversations, notes marked staff only", () => {
    const v = conversationsView({ access: "support", reporter_count: 1, conversations: [secret] });
    assert.equal(v.mode, "support");
    assert.equal(v.conversations.length, 1);
    assert.equal(messageKind({ is_internal: true, sender_kind: "customer" }), "note", "an internal note is a note whoever sent it");
    assert.equal(messageKind({ sender_kind: "customer" }), "customer");
    assert.equal(messageKind({ sender_kind: "system" }), "system");
    assert.equal(messageKind({ sender_kind: "staff" }), "staff");
  });
  it("anyone else gets the count and the Support-access words, never content", () => {
    // Even an answer that carries conversations is not drawn unless access is "support".
    const v = conversationsView({ access: "support_required", reporter_count: 3, conversations: [secret] });
    assert.equal(v.mode, "count");
    assert.equal(v.reporters, 3);
    assert.ok(v.words.includes(SUPPORT_ACCESS_WORDS));
    assert.equal(JSON.stringify(v).includes("TOP SECRET"), false);
    assert.equal("conversations" in v, false);
    assert.equal(conversationsView({ conversations: [secret] }).mode, "count", "no access field is not support access");
    assert.equal(JSON.stringify(conversationsView({ conversations: [secret] })).includes("TOP SECRET"), false);
    assert.equal(conversationsView(null).mode, "error");
    assert.equal(conversationsView({ access: "support_required", reporter_count: 1 }).words, `1 reporter. ${SUPPORT_ACCESS_WORDS}.`);
  });
  it("the component takes conversations and photo paths only from the support view", () => {
    const src = code("components/ops/TicketConversations.jsx");
    assert.match(src, /const conversations = useMemo\(\(\) => \(view\?\.mode === "support" \? view\.conversations : \[\]\), \[view\]\);/);
    assert.match(src, /conversationsView\(read\.data\)/);
    assert.doesNotMatch(src, /read\.data\??\.(conversations|messages)/, "the raw answer is never drawn");
    assert.match(src, /view\?\.mode === "support" && conversations\.length > 0/);
    assert.match(src, /view\.words/);
    assert.match(src, /ops\.fetchTicketConversations\(cardId\)/);
    assert.match(src, /Internal note · staff only/);
    assert.match(src, /signAttachmentUrls/);
    // photos are signed from the support view's paths only
    assert.match(src, /const paths = useMemo\(\(\) => conversations\.flatMap/);
  });
  it("type and product area are editable by Work board users through ops_ticket_update", () => {
    const src = code("components/ops/TicketSections.jsx");
    assert.match(src, /ops\.updateTicket\(card\.id, \{ type, product_area: area\.trim\(\) \}, card\.revision\)/);
    assert.match(code("services/opsService.js"), /supabase\.rpc\("ops_ticket_update", \{ p_card_id: cardId, p_changes: changes, p_expected_revision: revision \}\)/);
    const detail = code("components/ops/WorkDetail.jsx");
    assert.match(detail, /isTicketCard\(card\) && <TicketSections/);
  });
  it("Send to GitHub: task tickets use the card's field; non-operators see it off with the reason; operators send", () => {
    assert.equal(githubSectionState(card(), { isOperator: true }).mode, "none");
    assert.equal(githubSectionState(ticket({ ticket: { type: "task" } }), { isOperator: true }).mode, "task");
    const locked = githubSectionState(ticket(), { isOperator: false });
    assert.deepEqual([locked.mode, locked.disabled, locked.words], ["locked", true, GITHUB_LOCKED_WORDS]);
    assert.equal(GITHUB_LOCKED_WORDS, "Only product operators send tickets to GitHub.");
    const op = githubSectionState(ticket(), { isOperator: true });
    assert.deepEqual([op.mode, op.disabled, op.hasSignal], ["operator", false, false]);
    assert.equal(githubSectionState(ticket({ ticket: { type: "bug", source_signal_id: "s1" } }), { isOperator: true }).hasSignal, true);
    const section = code("components/ops/TicketGithubSection.jsx");
    assert.match(section, /ops\.ensureTicketSignal\(card\.id\)/);
    assert.match(section, /ops\.mirrorTicketGithub\(card\.id\)/);
    assert.match(section, /runProductAvengersCommand\(signalId, "create_issue"\)/);
    assert.match(section, /runProductAvengersCommand\(signalId, "link_existing"/);
    assert.match(section, /<Button variant="secondary" className="min-h-11 self-start" disabled/, "the locked button is off");
    assert.match(code("components/ops/WorkDetail.jsx"), /isOperator=\{isFullAdmin\(access\)\}/);
  });
  it("calls only the database functions the migration defines", () => {
    const sql = fs.readFileSync(path.resolve(SRC, "../../supabase/migrations/20281121034420_issue_4420_tickets_on_work_board.sql"), "utf8");
    const svc = read("services/opsService.js");
    const mine = svc.slice(svc.indexOf("// #4420 (step 4)"), svc.indexOf("export const searchLinks"));
    const called = [...mine.matchAll(/supabase\.rpc\("((?:ops_ticket|issue_4420)_[a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(called.length >= 8);
    for (const fn of called) assert.ok(sql.includes(`FUNCTION public.${fn}(`), `${fn} is defined by the migration`);
  });
});

describe("T-6 ordinary cards behave as before", () => {
  it("the add-card form has nothing about tickets and keeps its payload and fields", () => {
    const raw = read("components/ops/WorkAddForm.jsx");
    assert.doesNotMatch(raw, /ticket|Ticket/);
    const src = code("components/ops/WorkAddForm.jsx");
    assert.match(src, /ops\.addWork\(\[item\], keyRef\.current\.key\)/);
    assert.match(src, /const out = \{ title, instructions, done_means: doneMeans, owners, watchers, links: links\.map/);
    for (const label of ["Title", "Instructions", "Done means", "Linked records", "GitHub", "Files link", "Due date"]) assert.ok(src.includes(`>${label}<`), label);
    assert.match(src, /label="Owner"/);
    assert.match(src, /label="Watcher"/);
    assert.match(src, /<RecordPicker onClose=\{\(\) => setLinking\(false\)\}/, "its picker takes the default kinds");
  });
  it("the add form's linked-record kinds are the original six; only a card's detail also offers Support conversation", () => {
    assert.deepEqual(LINK_KINDS.map((k) => k.value), ["host", "creator", "brand", "event", "content", "expected"]);
    assert.deepEqual(DETAIL_LINK_KINDS.map((k) => k.value), [...LINK_KINDS.map((k) => k.value), "support_conversation"]);
    assert.match(code("components/ops/WorkDetail.jsx"), /<RecordPicker\s+kinds=\{DETAIL_LINK_KINDS\}/);
    assert.match(code("components/ops/RecordPicker.jsx"), /ops\.searchConversations\(query\)/);
  });
  it("the header without the ticket props is the old one-button header", () => {
    const src = code("components/ops/WorkHeader.jsx");
    assert.match(src, /onNewTicket \? \(/);
    assert.match(src, /data-new-card="" disabled=\{!online\} onClick=\{onNewCard\} aria-label="New card"/);
    assert.match(src, /\{onType && <FilterChip name="type"/, "no Type chip without onType");
  });
  it("an ordinary card's face, list row and filters are unchanged", () => {
    const board = code("components/ops/WorkBoard.jsx");
    assert.match(board, /\|\| card\.auto \|\| isTicketCard\(card\)\) && \(/);
    assert.equal(workFilter([card()], { show: "watch", me: "seth@x.test" }).length, 1);
    assert.equal(workFilter([card()], { type: "cards", linked: "host" }).length, 1);
  });
  it("the Work menu count adds the tickets I own that are still new, and a failed read adds none", () => {
    assert.equal(workMenuCount(3, 2), 5);
    assert.equal(workMenuCount(3, 0), 3);
    assert.equal(workMenuCount(3, undefined), 3);
    assert.equal(workMenuCount(0, 4), 4);
    const hook = code("hooks/useReviewCount.js");
    assert.match(hook, /ops\.fetchTicketCounts\(\)/);
    assert.match(hook, /cards: work\.status === "ready" \? workMenuCount\(work\.dueToday \+ work\.overdue, ticketsNew\) : null,/);
    assert.match(hook, /tickets\.data\?\.tickets_new_mine/);
    assert.match(code("services/opsService.js"), /supabase\.rpc\("ops_ticket_counts"\)/);
    assert.match(code("components/layout/Sidebar.jsx"), /item\.id === "work-board" \? reviewCount\.cards \|\| 0/);
  });
});

// Part A (#4420): the Work count never counts a ticket twice.
describe("Work count counts each ticket once", () => {
  const today = "2026-11-21";
  const t = (due_on, status = "todo") => ticket({ status, due_on });
  it("a To do ticket already due or overdue is not added again", () => {
    assert.equal(ticketsNotAlreadyDue([t("2026-11-21"), t("2026-11-10")], today, 2), 0);
  });
  it("undated and later tickets are added; cards and other statuses are not", () => {
    const cards = [t(null), t("2026-11-25"), t("2026-11-21"), { kind: "task", status: "todo", due_on: null }, t(null, "doing")];
    assert.equal(ticketsNotAlreadyDue(cards, today, 3), 2);
  });
  it("never exceeds the server count; no list or no tickets adds nothing", () => {
    assert.equal(ticketsNotAlreadyDue([t(null), t(null)], today, 1), 1);
    assert.equal(ticketsNotAlreadyDue(undefined, today, 2), 0);
    assert.equal(ticketsNotAlreadyDue([t(null)], today, 0), 0);
  });
  it("the hook feeds ticketsNew from the de-duplicated count", () => {
    const hook = read("hooks/useReviewCount.js");
    assert.match(hook, /const ticketsNew = ticketsNotAlreadyDue\(/);
  });
});

describe("T-7 (rework 1, P1-1) the REAL board shape drives the Type filter, the chip, every view and the menu count", () => {
  const NOW = new Date(2026, 10, 18, 10, 0, 0);
  it("the fixtures are exactly the server's board shape: no kind, and ticket only on a ticket", () => {
    assert.ok(BOARD_KEYS.length > 25, `parsed the board keys from the migration (${BOARD_KEYS.length})`);
    assert.ok(!BOARD_KEYS.includes("kind"), "the board shape carries no kind");
    assert.ok(!BOARD_KEYS.includes("ticket"), "ticket is not a common key");
    assert.ok(FULL_KEYS.includes("kind"), "only the full shape carries kind");
    assert.deepEqual(Object.keys(card()).sort(), [...BOARD_KEYS].sort());
    assert.deepEqual(Object.keys(ticket()).sort(), [...BOARD_KEYS, "ticket"].sort());
    assert.match(CARDS_JSON, /CASE WHEN p\.kind = 'ticket' THEN jsonb_build_object\('ticket', public\.ops_ticket_json\(p\.id\)\) ELSE '\{\}'::jsonb END AS ticket_part/,
      "the server adds `ticket` for tickets only, in every shape");
  });
  it("one predicate: a board ticket, a full ticket and a ticket whose ticket row is missing are tickets; cards are not", () => {
    assert.equal(isTicketCard(ticket()), true);
    assert.equal(isTicketCard({ ...ticket(), kind: "ticket" }), true, "full shape");
    assert.equal(isTicketCard(boardRow({ ticket: null })), true, "ops_ticket_json null still marks a ticket");
    for (const k of ["task", "gate_live", "promo"]) assert.equal(isTicketCard({ ...card(), kind: k }), false, k);
    assert.equal(isTicketCard(card()), false);
    assert.equal(isTicketCard(null), false);
  });
  it("Type: Tickets lists the board ticket, Type: Cards does not, the old Product address view too", () => {
    const rows = [ticket(), card(), card({ id: "c2", number: 8, links: [link("support_conversation", "c9")] })];
    assert.deepEqual(workFilter(rows, { type: "tickets" }).map((c) => c.id), ["t1"]);
    assert.deepEqual(workFilter(rows, { type: "cards" }).map((c) => c.id), ["c1", "c2"]);
    assert.deepEqual(workFilter(rows, { ...parseWorkView("type=tickets&linked=support") }).map((c) => c.id), ["t1"]);
  });
  it("the chip shows on the board row", () => {
    assert.deepEqual(ticketChipWords(ticket()), { label: "Ticket", number: "T12", type: "Bug", reporters: 2, reporterWords: "2 reporters" });
    assert.equal(ticketChipWords(card()), null);
  });
  it("Board, Today, This week and This month all keep the ticket after Type: Tickets", () => {
    const rows = [ticket({ status: "doing", due_on: "2026-11-18" }), card({ status: "doing", due_on: "2026-11-18" })];
    const only = workFilter(rows, { type: "tickets" });
    assert.deepEqual(only.map((c) => c.id), ["t1"], "Board");
    for (const view of ["today", "week", "month"]) {
      const { totals } = periodRows(only, periodWindow(view, NOW), [TAO]);
      assert.equal(totals.doing, 1, view);
    }
  });
  it("the menu count counts a board-shape To do ticket that is not yet due", () => {
    assert.equal(ticketsNotAlreadyDue([ticket({ due_on: "2026-12-05" }), card({ due_on: "2026-12-05" })], "2026-11-21", 5), 1);
  });
  it("no Admin source decides 'is a ticket' from kind, or by hand", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(full); continue; }
        if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
        const text = strip(fs.readFileSync(full, "utf8"));
        if (/(card|c|row|item)\??\.kind\s*[!=]==?\s*["']ticket["']/.test(text)) offenders.push(path.relative(SRC, full));
      }
    };
    walk(SRC);
    assert.deepEqual(offenders, []);
  });
});

describe("T-8 (rework 1, P3-b) one ticket number format", () => {
  it("ticketNumber writes the card's own number as T<n>", () => {
    assert.equal(ticketNumber(12), "T12");
    assert.equal(ticketNumber("3"), "T3");
    assert.equal(ticketNumber(undefined), "T?");
    assert.equal(ticketNumber(0), "T?");
  });
  it("the toast, inbox, summary, side panel, Brand groups, chip and card header use it; nobody writes T${...} by hand", () => {
    const files = ["components/ops/TicketForm.jsx", "components/support/CreateTicketPanel.jsx", "components/support/TicketSummaryPanel.jsx",
      "components/support/TicketPanel.jsx", "components/community/BrandGroupsPanel.jsx", "lib/supportInboxModel.js", "components/ops/WorkDetail.jsx"];
    for (const f of files) {
      const text = code(f);
      assert.match(text, /ticketNumber\(/, f);
      // WorkDetail's T${kit_step} is the launch-kit step ("T-3"), not a ticket.
      const hand = text.replace(/T\$\{card\.kit_step/g, "").match(/T\$\{/g);
      assert.equal(hand, null, `${f} formats a ticket number by hand`);
    }
    assert.match(code("components/ops/WorkDetail.jsx"), /isTicketCard\(card\) \? ticketNumber\(card\.number\) : `#\$\{card\.number\}`/, "a ticket's header says T<n>, a card's #<n>");
  });
});

describe("T-9 (rework 1, P3-a) Send to GitHub never shows a code", () => {
  it("known codes become what to do and where", () => {
    assert.match(githubErrorWords(new Error("acceptance_criteria_required")), /Acceptance criteria/);
    assert.match(githubErrorWords({ message: "product_fields_required" }), /Product, Theme, Priority/);
    assert.match(githubErrorWords(new Error("no_fit_reason_required")), /Why none of these fits/);
  });
  it("unknown codes and empty errors get the plain sentence, never the code", () => {
    assert.equal(githubErrorWords(new Error("some_new_code")), GITHUB_ERROR_FALLBACK);
    assert.equal(githubErrorWords(undefined), GITHUB_ERROR_FALLBACK);
    for (const words of [githubErrorWords(new Error("acceptance_criteria_required")), githubErrorWords(new Error("x_y"))]) {
      assert.doesNotMatch(words, /[a-z]+_[a-z_]+/);
    }
  });
  it("the section's toast and load error use it, not e.message", () => {
    const section = code("components/ops/TicketGithubSection.jsx");
    assert.match(section, /e\?\.token \? opsErrorWords\(e\) : githubErrorWords\(e\)/);
    assert.doesNotMatch(section, /e\?\.message|error\.message/);
  });
});

// P1-A (rework 2): the ticket form against the #4398 rule as the migrations
// write it. FAILS-ON-REVERT: without the Watcher field the default form (the
// creator as owner) sends no watcher and is refused by the server.
describe("T-3b the ticket form's default request meets the server's watcher rule", () => {
  const ROOT = path.resolve(SRC, "../..");
  const MIG = path.join(ROOT, "supabase/migrations");
  const sqlFiles = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  const newest = (name) => sqlFiles.filter((f) => new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`).test(fs.readFileSync(path.join(MIG, f), "utf8"))).pop();
  const fnBody = (file, name) => {
    const text = fs.readFileSync(path.join(MIG, file), "utf8");
    const heads = [...text.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "g"))];
    const at = heads[heads.length - 1].index;
    return text.slice(at, text.indexOf("\n$", text.indexOf("BEGIN", at)) + 1 || undefined);
  };
  const peopleFile = newest("ops_people_check");
  const people = fnBody(peopleFile, "ops_people_check");
  const ticket = fnBody(newest("ops_ticket_create"), "ops_ticket_create");
  const ruleWords = /'watchers', 'message', '(A card has one watcher[^']*)'/.exec(people)?.[1];
  const allowedKeys = /k NOT IN \(([^)]*)\)/.exec(ticket)?.[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
  const ME = "seth@x.test";
  const filled = { type: "bug", title: "Payout shows twice", whatIsWrong: "A host sees the same payout twice in the list.", productArea: "Host app · Payouts", due: "2026-11-28" };
  // The rule as read from ops_people_check: exactly one watcher, never the owner.
  const meetsServerRule = (p) => {
    const w = (p.watchers || []).filter((x) => !(p.owners || []).includes(x));
    return w.length === 1;
  };

  it("reads the rule from the newest ops_people_check: one watcher, who is not the owner", () => {
    assert.ok(peopleFile, "ops_people_check is defined in a migration");
    assert.match(people, /cardinality\(v_watchers\) <> 1/, "exactly one watcher");
    assert.match(people, /NOT v_email = ANY \(v_owners\) AND NOT v_email = ANY \(v_watchers\)/, "an owner is never counted as the watcher");
    assert.equal(ruleWords, WATCHER_RULE_WORDS, "the form says what the server says");
  });
  it("ops_ticket_create takes the watcher from the request and checks it with the card validator", () => {
    assert.ok(allowedKeys.includes("watchers"));
    assert.match(ticket, /v_watchers := p_ticket->'watchers'/);
    assert.match(ticket, /'watchers', v_watchers/);
    assert.match(ticket, /public\.ops_validate_card\(v_item, 'add'/);
  });
  it("the default form (the creator owns it) starts with no watcher and is not sent until one is picked", () => {
    const owners = [ME];
    const watchers = initialTicketWatchers(owners, ME);
    assert.deepEqual(watchers, [], "the owner cannot also be the watcher");
    const def = { ...filled, owners, watchers };
    assert.equal(ticketFormProblems(def).watchers, WATCHER_RULE_WORDS, "blocked before sending, in the server's words");
    assert.equal(meetsServerRule(buildTicketPayload(def)), false, "the server would refuse it too");
    const picked = { ...def, watchers: ["tao@x.test"] };
    assert.deepEqual(ticketFormProblems(picked), {});
    const p = buildTicketPayload(picked);
    assert.ok(Object.keys(p).every((k) => allowedKeys.includes(k)), `every key is one ops_ticket_create takes: ${Object.keys(p)}`);
    assert.equal(meetsServerRule(p), true);
  });
  it("from Support and Brand groups the same request shape is sent", () => {
    for (const createdFrom of ["conversation", "brand_group"]) {
      const p = buildTicketPayload({ ...filled, owners: [ME], watchers: ["tao@x.test"], conversationIds: ["c1"], brandId: "b1" }, { createdFrom });
      assert.ok(Object.keys(p).every((k) => allowedKeys.includes(k)));
      assert.equal(meetsServerRule(p), true);
    }
  });
  it("the creator is filled in as watcher only when they are not the owner", () => {
    assert.deepEqual(initialTicketWatchers(["tao@x.test"], ME), [ME]);
    assert.deepEqual(nextTicketWatchers(["tao@x.test"], [], ME), [ME], "owner moved away from me: I watch");
    assert.deepEqual(nextTicketWatchers([ME], [ME], ME), [], "owner moved to me: I stop watching");
    assert.deepEqual(nextTicketWatchers(["abi@x.test"], ["tao@x.test"], ME), ["tao@x.test"], "a picked watcher stays");
    assert.deepEqual(nextTicketWatchers(["tao@x.test"], ["tao@x.test"], ME), [ME], "a watcher who became the owner is replaced by the creator");
    assert.ok(ticketFormProblems({ ...filled, owners: ["tao@x.test"], watchers: ["tao@x.test"] }).watchers, "watcher = owner is refused");
  });
  it("the form draws the card form's Watcher field and routes owner changes through the rule", () => {
    const src = code("components/ops/TicketForm.jsx");
    assert.match(src, /label="Watcher" single fitMenu min=\{0\} hint="One watcher, who is not the owner\. They confirm the card is done\."/);
    assert.match(code("components/ops/WorkAddForm.jsx"), /hint="One watcher, who is not the owner\. They confirm the card is done\."/, "same words as the card form");
    assert.match(src, /onChange=\{changeOwners\}/);
    assert.match(src, /words=\{wordsFor\("watchers"\)\}/);
    assert.doesNotMatch(src, /You watch it unless you own it/);
  });
});

// P3-1 (rework 2): "What changed" follows the page's filters. FAILS-ON-REVERT:
// without filterFeed the import fails; without the WorkViews wiring the source
// assertion fails.
describe("T-7 What changed follows Type, Linked to, Show and search", () => {
  const tk = { id: "t1", kind: "ticket", ticket: { type: "bug" }, title: "Payout twice", status: "doing", owners: [], watchers: [], links: [] };
  const cd = { id: "c1", kind: null, title: "Call the venue", status: "doing", owners: [], watchers: [], links: [] };
  const feed = { entries: [{ id: "e1", card: { id: "t1" } }, { id: "e2", card: { id: "c1" } }, { id: "e3", card: { id: "gone" } }], truncated: false, total: 3 };
  const ids = (f) => f.entries.map((e) => e.id);
  it("Type: Tickets shows only ticket changes, Cards only card changes", () => {
    assert.deepEqual(ids(filterFeed(feed, [tk, cd], workFilter([tk, cd], { type: "tickets" }))), ["e1"]);
    assert.deepEqual(ids(filterFeed(feed, [tk, cd], workFilter([tk, cd], { type: "cards" }))), ["e2"]);
  });
  it("search narrows it the same way", () => {
    assert.deepEqual(ids(filterFeed(feed, [tk, cd], workFilter([tk, cd], { q: "venue" }))), ["e2"]);
  });
  it("no filter: every entry stays, even one whose card the period did not load", () => {
    const out = filterFeed(feed, [tk, cd], workFilter([tk, cd], {}));
    assert.deepEqual(ids(out), ["e1", "e2", "e3"]);
    assert.equal(out.filtered, false);
  });
  it("the Today view passes the filtered cards to the feed", () => {
    // [TEST-MOD #4420] rework 3 (G5): the page's filter state goes with the cards.
    assert.match(code("components/ops/WorkViews.jsx"), /<WhatChanged feed=\{filterFeed\(read\.data\?\.feed, read\.data\?\.cards, cards, \{ filtersActive \}\)\}/);
  });
});

// G4 (rework 3, QA P2-3): a duplicate refusal rendered at the top of the form,
// out of view. It now sits beside Make ticket, is announced, and offers the
// existing ticket. FAILS-ON-REVERT: without ticketDuplicateNotice the calls
// throw; with the old top-of-form box the source assertions fail.
describe("T-10 a refused submit is said beside Make ticket", () => {
  const dup = { status: "duplicate", existing: { id: "c6", number: 6, title: "Refund stuck" }, message: "An open card already does this: \"Refund stuck\" (Card 6)." };
  it("the duplicate names the existing ticket with T-n and offers Link here only with a source", () => {
    const withSource = ticketModel.ticketDuplicateNotice(dup, { hasSource: true });
    assert.equal(withSource.existingId, "c6");
    assert.equal(withSource.canLink, true);
    assert.match(withSource.words, /\(T6\)/);
    assert.doesNotMatch(withSource.words, /Card 6/);
    const board = ticketModel.ticketDuplicateNotice(dup);
    assert.equal(board.canLink, false);
    assert.match(board.words, /Open it and update it instead/);
  });
  it("without the existing ticket in the answer: a plain sentence, nothing to open", () => {
    for (const answer of [{ status: "duplicate" }, { status: "duplicate", existing: null }, { status: "duplicate", existing: { number: 3 } }, null]) {
      const notice = ticketModel.ticketDuplicateNotice(answer, { hasSource: true });
      assert.equal(notice.existingId, null);
      assert.equal(notice.canLink, false);
      assert.match(notice.words, /^An open ticket already covers this\./);
    }
  });
  it("the form renders every submit notice in the actions row, as alerts, and none at the top", () => {
    const form = strip(read("components/ops/TicketForm.jsx"));
    const actionsAt = form.indexOf('data-ticket-actions=""');
    const typeAt = form.indexOf("<legend className={LABEL}>Type</legend>");
    assert.ok(actionsAt > 0 && typeAt > 0);
    const notices = [...form.matchAll(/role="alert" data-ticket-submit-notice=""/g)].map((m) => m.index);
    assert.equal(notices.length, 3, "server fixes, duplicate, request failed");
    for (const at of notices) assert.ok(at > actionsAt, "beside Make ticket, not at the top of the form");
    assert.doesNotMatch(form.slice(form.indexOf("<form onSubmit"), typeAt), /duplicate|dupNotice|unplaced\.map/);
    assert.match(form, /onClick=\{\(\) => linkHere\(\{ id: dupNotice\.existingId, number: dupNotice\.number \}\)\}>Link here</);
    assert.match(form, /setSubmitFailed\(`\$\{TICKET_SUBMIT_FAILED_WORDS\}/);
  });
});

// G9 (rework 3, QA P3-5): the ticket Title box had no accessible name.
// FAILS-ON-REVERT: without the id / aria-labelledby pair this reds.
describe("T-11 the Title box is named like the other fields", () => {
  it("the textarea is labelled by the visible Title label", () => {
    const form = read("components/ops/TicketForm.jsx");
    assert.match(form, /<span id="new-ticket-title-label" className=\{LABEL\}>Title<\/span>\s*<textarea\s+id="new-ticket-title"\s+aria-labelledby="new-ticket-title-label"/);
  });
});

// G8 (rework 3, QA P3-4): the Watcher pick list was wider than the Create
// ticket panel and pushed it sideways. FAILS-ON-REVERT: without fitMenu the
// list keeps its 17rem minimum and these red.
describe("T-12 the ticket form's people lists stay inside the field", () => {
  it("both ticket people fields ask for a fitted list, and the list then takes the field's width", () => {
    const form = read("components/ops/TicketForm.jsx");
    assert.match(form, /<PeopleField id="new-ticket-owner" label="Owner" single fitMenu /);
    assert.match(form, /<PeopleField id="new-ticket-watcher" label="Watcher" single fitMenu /);
    const field = read("components/people/PeopleField.jsx");
    // [TEST-MOD #4420] the width is chosen in menuWidth, so the 300px scroll
    // classes stay together for #3980 W3 R9; the listbox still uses it.
    assert.match(field, /const menuWidth = fitMenu \? "w-full max-w-full" : "w-\[max\(100%,17rem\)\]/);
    assert.match(field, /role="listbox"[^>]*className=\{`[^`]*max-h-\[300px\] overflow-auto \$\{menuWidth\}/);
  });
});

// G5 (rework 3, QA P3-1): Show and search narrow the period on the server, so
// the loaded and the shown cards were the same and the feed kept every entry.
// FAILS-ON-REVERT: without the filtersActive option / pageFiltersActive these red.
describe("T-13 What changed also follows Show and search", () => {
  const w = { id: "w1", title: "Watched", status: "doing", owners: [], watchers: [{ email: "me@x" }], links: [] };
  const feed = { entries: [{ id: "e1", card: { id: "w1" } }, { id: "e2", card: { id: "not-loaded" } }], truncated: false, total: 2 };
  const ids = (f) => f.entries.map((e) => e.id);
  it("Show: Cards I watch (server already narrowed the period) keeps only the shown cards' changes", () => {
    const filters = { show: "watch", me: "me@x" };
    const out = filterFeed(feed, [w], workFilter([w], filters), { filtersActive: pageFiltersActive(filters) });
    assert.deepEqual(ids(out), ["e1"]);
    assert.equal(out.filtered, true);
  });
  it("search (server already narrowed the period) does the same", () => {
    const filters = { q: "watched" };
    assert.deepEqual(ids(filterFeed(feed, [w], workFilter([w], filters), { filtersActive: pageFiltersActive(filters) })), ["e1"]);
  });
  it("no page filter (owner only): every entry stays", () => {
    assert.equal(pageFiltersActive({ owner: "a@x", q: "  " }), false);
    assert.deepEqual(ids(filterFeed(feed, [w], [w], { filtersActive: false })), ["e1", "e2"]);
  });
  it("the board passes its filters to the Today view", () => {
    assert.match(code("pages/WorkBoardPage.jsx"), /<PeriodView [^>]*filtersActive=\{pageFiltersActive\(filters\)\} \/>/);
  });
});

// G10 (rework 3, QA P3-6): the agent log said "Added Ticket 6 … Card 6:". The
// server's ticket text now says T6 (pg17 T-WORDING-T) and the row's link
// label follows it. FAILS-ON-REVERT: without logCardLabel these red.
describe("T-14 the agent log names a ticket T<n>, a card Card <n>", () => {
  it("a ticket entry (the server's ticket wording) is labelled T<n>; any other card keeps Card <n>", () => {
    assert.equal(ticketModel.logCardLabel({ summary: "Added ticket T6: Refund stuck", card: { number: 6 } }), "T6");
    assert.equal(ticketModel.logCardLabel({ summary: "Ticket T6 closed: fixed", card: { number: 6 } }), "T6");
    assert.equal(ticketModel.logCardLabel({ summary: "Added Call the venue", card: { number: 6 } }), "Card 6");
    assert.equal(ticketModel.logCardLabel({ summary: "Added ticket T61: x", card: { number: 6 } }), "Card 6", "T61 is not T6");
    assert.equal(ticketModel.logCardLabel({ summary: "", card: {} }), "Card ?");
  });
  it("LogRow uses it, and writes no number by hand", () => {
    const row = read("components/ops/LogRow.jsx");
    assert.match(row, /\{logCardLabel\(entry\)\}: \{entry\.card\.title\}/);
    assert.doesNotMatch(row, /Card \{entry\.card\.number\}/);
  });
  it("the ticket migration writes T<n> in every ticket text, and an ordinary card duplicate keeps its words", () => {
    const sql = fs.readFileSync(path.resolve(SRC, "../../supabase/migrations/20281121034420_issue_4420_tickets_on_work_board.sql"), "utf8");
    assert.doesNotMatch(sql, /Ticket %s|ticket %s\./);
    assert.match(sql, /format\('Added ticket T%s: %s', c\.number, c\.title\)/);
    assert.equal((sql.match(/An open ticket already does this: "%s" \(T%s\)\. Update that ticket instead\./g) || []).length, 2);
    assert.equal((sql.match(/ELSE format\('An open card already does this: "%s" \(Card %s\)\. Update that card instead\.'/g) || []).length, 2);
  });
});
