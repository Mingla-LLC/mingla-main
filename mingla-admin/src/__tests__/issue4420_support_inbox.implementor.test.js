// MINGLA-INVARIANT: I-4420-INBOX-LABELS-DERIVED | issue #4420 | every label on a Support conversation is derived in lib/supportInboxModel.js from the row and the tickets linked to it; none is stored in the browser.
// MINGLA-INVARIANT: I-4420-NOTES-NEVER-IN-PREVIEW | issue #4420 | an internal note never reaches a list preview, a suggested customer line or a ticket pre-fill.
// MINGLA-INVARIANT: I-4420-CREATE-TICKET-NO-AUTO-OWNER | issue #4420 | Create ticket from a conversation passes the conversation as the source and never offers or sends an automatic owner; the person chooses.
//
// Issue #4420 (step 5) — the Admin Support chat inbox.
//
//   S-1  every label rule (Host, Explorer, Staff, topic, Needs reply, Waiting on
//        customer, Website request, Ticket T-n and closed, Reported, Resolved)
//   S-2  Open vs Resolved: the split, Needs reply first, Reported rows sit in
//        Open, Resolved is collapsed until clicked
//   S-3  an internal note never appears in a preview, a pre-fill or a copied line
//   S-4  old and new addresses open the right conversation; unknown ones open
//        the default list
//   S-5  Create ticket: a side panel (not a modal), the conversation is the
//        source, no automatic owner; a reported row never offers it
//   S-6  every write path is the one it was; the retired desk code is gone
//
// FAILS-ON-REVERT: before this change lib/supportInboxModel.js does not exist, so
// the first import fails and every block below reds.
//
// Run: node --test src/__tests__/issue4420_support_inbox.implementor.test.js
// (from mingla-admin; pure logic and source assertions: no install needed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INBOX_CHIPS,
  conversationRow,
  createTicketButton,
  customerLineFor,
  hashForSelection,
  inboxParamsFromHash,
  isOpenRow,
  needsReply,
  rowLabels,
  rowPreview,
  rowTitle,
  reportedRow,
  sidePanelOnSwitch,
  DISCARD_TICKET_WORDS,
  splitInbox,
  ticketPrefill,
} from "../lib/supportInboxModel.js";
import * as metrics from "../lib/supportTicketMetrics.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const T = (over = {}) => ({ id: "t1", ticket_number: 12, subject: "Payout shows zero", origin: "customer", requester_segment: "business", status: "open", last_sender_kind: "customer", last_message_at: "2026-11-20T10:00:00Z", ...over });
const texts = (t, linked) => rowLabels(conversationRow(t), linked).map((l) => l.text);

describe("S-1 labels are derived, one rule each", () => {
  it("Host or Explorer from the segment; Staff for a staff-opened conversation", () => {
    assert.ok(texts(T()).includes("Host"));
    assert.ok(texts(T({ requester_segment: "explorer" })).includes("Explorer"));
    assert.ok(texts(T({ origin: "staff" })).includes("Staff"));
    assert.equal(texts(T({ origin: "staff" })).includes("Host"), false);
  });
  it("topic when there is one, nothing when there is none", () => {
    assert.ok(texts(T({ topic: "payouts" })).includes("Payouts"));
    assert.equal(texts(T({ topic: null })).length, 2, "Host + Needs reply only");
  });
  it("Needs reply: new or open and the customer spoke last", () => {
    assert.ok(texts(T()).includes("Needs reply"));
    assert.ok(texts(T({ status: "new" })).includes("Needs reply"));
    assert.equal(texts(T({ last_sender_kind: "staff" })).includes("Needs reply"), false);
    assert.equal(needsReply(T({ status: "pending" })), false);
  });
  it("a resolved conversation with the customer's message last is NOT Needs reply", () => {
    for (const status of ["resolved", "closed"]) {
      const t = T({ status, last_sender_kind: "customer" });
      assert.equal(texts(t).includes("Needs reply"), false, status);
      assert.ok(texts(t).includes("Resolved"), status);
    }
  });
  it("Waiting on customer: status pending", () => {
    assert.ok(texts(T({ status: "pending", last_sender_kind: "staff" })).includes("Waiting on customer"));
    assert.equal(texts(T()).includes("Waiting on customer"), false);
  });
  it("Website request: the website_change topic", () => {
    assert.ok(texts(T({ topic: "website_change" })).includes("Website request"));
    assert.equal(texts(T({ topic: "payouts" })).includes("Website request"), false);
  });
  it("Ticket T-n per linked ticket; a closed one says closed", () => {
    const linked = [{ card_id: "c1", number: 31, status: "doing" }, { card_id: "c2", number: 8, status: "done" }];
    const out = texts(T(), linked);
    assert.ok(out.includes("Ticket T31"));
    assert.ok(out.includes("Ticket T8 closed"));
    assert.equal(texts(T()).some((x) => x.startsWith("Ticket")), false, "none linked, none shown");
  });
  it("Reported for a reported enquiry, with its topic", () => {
    const labels = rowLabels(reportedRow({ id: "e1", topic_label: "Refunds" })).map((l) => l.text);
    assert.deepEqual(labels, ["Reported", "Refunds"]);
  });
  it("the chips are the labels worth filtering on", () => {
    assert.deepEqual(INBOX_CHIPS.map((c) => c.id), ["needs", "waiting", "reported", "website", "mine", "unassigned", "overdue"]);
  });
  it("no label is stored in the browser", () => {
    for (const f of ["lib/supportInboxModel.js", "components/support/InboxList.jsx", "components/support/InboxLabels.jsx", "pages/SupportDeskPage.jsx"]) {
      assert.doesNotMatch(read(f), /localStorage|sessionStorage/, f);
    }
  });
});

describe("S-2 Open vs Resolved", () => {
  const rows = [
    conversationRow(T({ id: "a", status: "open", last_sender_kind: "staff", last_message_at: "2026-11-20T12:00:00Z" })),
    conversationRow(T({ id: "b", status: "open", last_sender_kind: "customer", last_message_at: "2026-11-19T09:00:00Z" })),
    conversationRow(T({ id: "c", status: "pending", last_sender_kind: "staff", last_message_at: "2026-11-20T08:00:00Z" })),
    conversationRow(T({ id: "d", status: "resolved", last_message_at: "2026-11-18T08:00:00Z" })),
    conversationRow(T({ id: "e", status: "closed", last_message_at: "2026-11-19T08:00:00Z" })),
    reportedRow({ id: "r1", reported_at: "2026-11-20T11:00:00Z" }),
  ];
  const out = splitInbox(rows, {});
  it("open = new, open, pending and every reported row; resolved = resolved and closed", () => {
    assert.deepEqual(out.resolved.map((r) => r.id), ["e", "d"]);
    assert.equal(out.open.length, 4);
    assert.ok(out.open.some((r) => r.kind === "reported"));
    assert.equal(out.resolved.some((r) => r.kind === "reported"), false);
    assert.equal(isOpenRow(rows[3]), false);
  });
  it("open conversations are listed first, Needs reply on top, then newest activity", () => {
    assert.deepEqual(out.open.map((r) => r.id), ["b", "a", "r1", "c"]);
  });
  it("Resolved is collapsed by default and only opens on a click or an address", () => {
    assert.equal(inboxParamsFromHash("#/support").showResolved, false);
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /const \[resolvedOpen, setResolvedOpen\] = useState\(initial\.showResolved\);/);
    const list = read("components/support/InboxList.jsx");
    assert.match(list, /aria-expanded=\{resolvedOpen\}/);
    assert.match(list, /\{resolvedOpen \? \(\s*<div id="inbox-resolved"/);
    assert.match(list, /Open · \{open\.length\}/);
    assert.match(list, /Resolved · \{resolved\.length\}/);
    // The Resolved section sits after (below) the Open list.
    assert.ok(list.indexOf("Resolved · {resolved.length}") > list.indexOf("Open · {open.length}"));
  });
  it("the chips and the search narrow both lists", () => {
    assert.deepEqual(splitInbox(rows, { chip: "reported" }).open.map((r) => r.id), ["r1"]);
    assert.deepEqual(splitInbox(rows, { chip: "needs" }).open.map((r) => r.id), ["b"]);
    assert.equal(splitInbox(rows, { chip: "needs" }).resolved.length, 0);
  });
});

describe("S-3 an internal note never reaches a preview, a pre-fill or a copied line", () => {
  const row = conversationRow(T({ subject: "Payout shows zero", conversation_id: "cv1" }));
  const note = { is_internal: true, message_type: "text", content: "SECRET: customer is on a watch list", sender_id: "staff" };
  it("a note given as the last message is ignored: the subject shows instead", () => {
    const preview = rowPreview(row, note);
    assert.equal(preview, "Payout shows zero");
    assert.doesNotMatch(preview, /SECRET/);
  });
  it("a system line is ignored; a customer-visible message is shown", () => {
    assert.equal(rowPreview(row, { message_type: "system", content: "Reopened automatically" }), "Payout shows zero");
    assert.equal(rowPreview(row, { message_type: "text", content: "Still waiting on my payout" }), "Still waiting on my payout");
    assert.equal(rowPreview(row, { message_type: "text", content: "" }), "Attachment");
  });
  it("the previews are asked for without internal notes or system lines", () => {
    const svc = read("services/supportDeskService.js");
    const body = svc.slice(svc.indexOf("export async function loadLastPublicMessages"));
    assert.match(body, /\.eq\("is_internal", false\)/);
    assert.match(body, /\.neq\("message_type", "system"\)/);
  });
  it("Create ticket's pre-fill reads only customer-visible messages", () => {
    const ticket = T({ requester_user_id: "u1", topic: "broken" });
    const messages = [
      { id: "n", is_internal: true, content: "SECRET: watch list", sender_id: "u1" },
      { id: "s", message_type: "system", content: "Reopened automatically", sender_id: null },
      { id: "c", content: "The map stays blank after I book", sender_id: "u1" },
    ];
    const prefill = ticketPrefill(ticket, messages);
    assert.equal(prefill.whatIsWrong, "The map stays blank after I book");
    assert.doesNotMatch(JSON.stringify(prefill), /SECRET/);
    const onlyNote = ticketPrefill(ticket, [messages[0]]);
    assert.equal(onlyNote.whatIsWrong, "Payout shows zero", "falls back to the subject, never to a note");
    assert.equal(prefill.type, "bug");
    assert.deepEqual(prefill.source, { id: "t1", label: "Conversation 12" });
  });
  it("the line offered to send the customer carries only the ticket number", () => {
    assert.equal(customerLineFor(31), "Thanks for flagging this. We have logged it as ticket T31 and the team is on it. We will update you here.");
  });
  it("the list rows never read the thread's notes", () => {
    const list = read("components/support/InboxList.jsx");
    assert.doesNotMatch(list, /is_internal|internal note/i);
  });
});

describe("S-4 addresses", () => {
  it("#/support?ticket=<id> (old) and ?conversation=<id> (new) both open that conversation", () => {
    assert.equal(inboxParamsFromHash("#/support?ticket=abc-123").conversationId, "abc-123");
    assert.equal(inboxParamsFromHash("#/support?conversation=abc-123").conversationId, "abc-123");
    assert.equal(inboxParamsFromHash("#/support?conversation=new&ticket=old").conversationId, "new");
  });
  it("the desk opens it on load, on a hash change, and writes the new spelling back", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /useState\(\{ conversationId: initial\.conversationId, reportedId: initial\.reportedId \}\)/);
    assert.match(desk, /window\.addEventListener\("hashchange", onHash\)/);
    assert.match(desk, /hashForSelection\(window\.location\.hash, selected\)/);
    assert.equal(hashForSelection("#/support?ticket=abc", { conversationId: "abc" }), "#/support?conversation=abc");
    assert.equal(hashForSelection("#/support?filter=needs&conversation=abc", { conversationId: null }), "#/support?filter=needs");
  });
  it("one the loaded list does not hold (an old resolved one) is read by id", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /getSupportTicket\(selected\.conversationId\)/);
    assert.match(desk, /That conversation isn't available to you, or it doesn't exist\./);
  });
  it("view and filter params map to a chip or the Resolved section; anything else falls to the default list", () => {
    assert.equal(inboxParamsFromHash("#/support?filter=reported").chip, "reported");
    assert.equal(inboxParamsFromHash("#/support?view=needs").chip, "needs");
    assert.equal(inboxParamsFromHash("#/support?view=resolved").showResolved, true);
    assert.equal(inboxParamsFromHash("#/support?view=all").chip, "");
    for (const bad of ["#/support?filter=nope", "#/support?view=%E0%A4%A", "#/support?", "#/support", "", undefined, null, 5]) {
      const p = inboxParamsFromHash(bad);
      assert.equal(p.chip, "", String(bad));
      assert.equal(p.conversationId, null);
    }
  });
  it("a reported row has its own address", () => {
    assert.equal(inboxParamsFromHash("#/support?reported=e9").reportedId, "e9");
  });
  it("the person drawer links with the new spelling", () => {
    assert.match(read("components/people/PersonDrawer.jsx"), /#\/support\?conversation=\$\{encodeURIComponent\(ticket\.id\)\}/);
  });
});

describe("S-5 Create ticket", () => {
  it("opens a side panel beside the thread, not a modal", () => {
    const panel = read("components/support/CreateTicketPanel.jsx");
    assert.match(panel, /<aside aria-label="Create ticket"/);
    assert.doesNotMatch(panel, /Modal/);
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /<CreateTicketPanel/);
    assert.match(desk, /onCreateTicket=\{\(messages\) => setSide\(\{ kind: "create", messages \}\)\}/);
  });
  it("passes the conversation as the source and says it was created from a conversation", () => {
    const panel = read("components/support/CreateTicketPanel.jsx");
    assert.match(panel, /conversation=\{prefill\.source\}/);
    assert.match(panel, /createdFrom="conversation"/);
    assert.match(panel, /initialTitle=\{prefill\.title\}/);
    assert.match(panel, /initialWhatIsWrong=\{prefill\.whatIsWrong\}/);
    assert.match(panel, /initialProductArea=\{prefill\.productArea\}/);
  });
  it("never offers an automatic owner: the form's owner is the person's choice, and the pre-fill has none", () => {
    const panel = read("components/support/CreateTicketPanel.jsx");
    assert.doesNotMatch(panel, /owners?\s*[=:]|default_owner|autoOwner|assignTo/i);
    const prefill = ticketPrefill(T({ assigned_staff_id: "someone" }), []);
    assert.deepEqual(Object.keys(prefill).sort(), ["productArea", "source", "title", "type", "whatIsWrong"]);
    // The step 4 form is reused, not forked: one form, one place that builds the payload.
    assert.match(panel, /import \{ TicketForm \} from "\.\.\/ops\/TicketForm"/);
    assert.match(read("components/ops/TicketForm.jsx"), /PeopleField id="new-ticket-owner" label="Owner"/);
    assert.doesNotMatch(read("components/ops/TicketForm.jsx"), /default_owner/);
  });
  it("shows the ticket number, that it is on the Work board, and the line for the customer; sends nothing", () => {
    const panel = read("components/support/CreateTicketPanel.jsx");
    assert.match(panel, /Ticket \$\{ticketNumber\(done\.number\)\} is made/);
    assert.match(panel, /It is on the Work board/);
    assert.match(panel, /Nothing was sent to the customer/);
    assert.doesNotMatch(panel, /sendSupportMessage|support-send/);
  });
  it("the header shows Create ticket, or the number once a ticket is linked", () => {
    assert.deepEqual(createTicketButton([]), { text: "Create ticket", linked: false });
    assert.deepEqual(createTicketButton([{ number: 31 }]), { text: "Ticket T31", linked: true });
    const panel = read("components/support/TicketPanel.jsx");
    assert.match(panel, /ticketButton\.text/);
    assert.match(panel, />Resolve</);
    assert.match(panel, />Reopen</);
  });
  it("a reported row opens its own thread and never offers Create ticket", () => {
    assert.doesNotMatch(read("components/support/ReportedEnquiryThread.jsx"), /Create ticket|CreateTicketPanel|onCreateTicket/);
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /<ReportedEnquiryThread/);
    assert.equal(rowTitle(reportedRow({ guest_name: "Ada", brand_name: "Afro Fest" })), "Ada · Afro Fest");
  });
  it("a linked ticket opens a read-only summary with Open on the Work board", () => {
    const sum = read("components/support/TicketSummaryPanel.jsx");
    assert.match(sum, /Open on the Work board/);
    assert.doesNotMatch(sum, /supabase|rpc\(|onSave|updateTicket/);
  });
});

describe("S-6 writes are unchanged and the retired desk code is gone", () => {
  it("claim, status and priority still go through the support-* functions; replies through the composer", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /invokeSupportFunction\("support-claim", \{ ticketId: selectedTicket\.id \}\)/);
    assert.match(desk, /invokeSupportFunction\("support-set-status", \{ ticketId: selectedTicket\.id, status \}\)/);
    assert.match(desk, /invokeSupportFunction\("support-set-status", \{ ticketId: selectedTicket\.id, priority \}\)/);
    assert.match(read("components/support/TicketPanel.jsx"), /<SupportComposer/);
    assert.match(read("components/support/SupportComposer.jsx"), /sendSupportMessage\(body\)/);
  });
  it("nothing in the inbox writes a table from the browser", () => {
    for (const f of ["pages/SupportDeskPage.jsx", "components/support/InboxList.jsx", "components/support/CreateTicketPanel.jsx", "components/support/ReportedEnquiryThread.jsx", "components/support/TicketSummaryPanel.jsx", "lib/supportInboxModel.js"]) {
      assert.doesNotMatch(read(f), /\.from\("[a-z_]+"\)\s*\.(insert|update|upsert|delete)\(/, f);
    }
    const svc = read("services/supportDeskService.js");
    const added = svc.slice(svc.indexOf("export async function getSupportTicket"), svc.indexOf("const WEBSITE_REQUEST_COLUMNS"));
    assert.doesNotMatch(added, /\.(insert|update|upsert|delete)\(/);
  });
  it("the eight views rail, the Opened-by switch, the filter bar and the Product box are gone", () => {
    for (const name of ["SUPPORT_INBOX_VIEWS", "OPENED_BY_OPTIONS", "supportInboxRows", "supportInboxCounts", "supportInboxBase", "railCountLabel", "originChip", "ticketMatchesView"]) {
      assert.equal(name in metrics, false, name);
    }
    const desk = read("pages/SupportDeskPage.jsx");
    assert.doesNotMatch(desk, /Inbox views|Opened by|SendToProductModal|listProductSignals|support_product_signals|Any product area/);
    assert.doesNotMatch(read("components/support/TicketPanel.jsx"), /ProductBox|EngineeringRow|onSendToProduct|productBoardModel/);
  });
  it("customer-thread words: a conversation, not a ticket", () => {
    const list = read("components/support/InboxList.jsx");
    assert.match(list, /aria-label="Conversations"/);
    assert.match(read("components/support/SupportThread.jsx"), /No messages yet in this conversation\./);
  });
  it("the ticket labels read the one function the database gave for them", () => {
    assert.match(read("services/opsService.js"), /rpc\("issue_4420_conversation_tickets", \{ p_support_ticket_ids: supportTicketIds \}\)/);
    assert.match(read("pages/SupportDeskPage.jsx"), /fetchConversationTickets\(part\)/);
    assert.ok(read("../../supabase/migrations/20281121034420_issue_4420_tickets_on_work_board.sql").includes("FUNCTION public.issue_4420_conversation_tickets(p_support_ticket_ids uuid[])"));
  });
});

describe("S-9 (rework 1, P3-c) the Create ticket panel is in view at 1024 px", () => {
  const page = read("pages/SupportDeskPage.jsx");
  const slot = (page.match(/const SIDE_SLOT = "([^"]+)"/) || [])[1] || "";
  const cls = slot.split(/\s+/);
  it("below xl (no third column) the slot is a fixed panel on the right edge, full height, not stacked under the thread", () => {
    for (const c of ["fixed", "inset-y-0", "right-0", "w-full", "max-w-[420px]", "[&>aside]:h-full"]) assert.ok(cls.includes(c), c);
    assert.ok(!cls.some((c) => /^lg:col-start/.test(c)), "no lg grid placement that drops it under the thread");
  });
  it("at xl it is the third grid column again, as before", () => {
    for (const c of ["xl:static", "xl:col-start-3", "xl:w-auto", "xl:max-w-none", "xl:p-0", "xl:shadow-none"]) assert.ok(cls.includes(c), c);
    assert.match(page, /xl:grid-cols-\[minmax\(300px,380px\)_minmax\(0,1fr\)_minmax\(340px,420px\)\]/);
  });
  it("both side panels use the slot; it is dismissible by backdrop, Escape and the panel's own Cancel", () => {
    assert.equal((page.match(/data-side-slot="" className=\{SIDE_SLOT\}/g) || []).length, 2);
    assert.match(page, /data-side-backdrop="" onClick=\{\(\) => setSide\(null\)\}/);
    assert.match(page, /data-side-backdrop=""[\s\S]{0,200}xl:hidden/);
    assert.match(page, /e\.key === "Escape" && !e\.defaultPrevented\) setSide\(null\)/);
    assert.match(page, /<CreateTicketPanel[\s\S]{0,200}onClose=\{\(\) => setSide\(null\)\}/);
  });
});

// P3-2 (rework 2): opening another conversation never re-fills an open Create
// ticket form. FAILS-ON-REVERT: without sidePanelOnSwitch the import fails;
// without the page wiring the source assertions fail.
describe("S-10 an open Create ticket panel and another conversation", () => {
  it("an untouched form closes; one with edits asks; the same conversation keeps it", () => {
    assert.equal(sidePanelOnSwitch({ sideKind: "create", dirty: false }), "close");
    assert.equal(sidePanelOnSwitch({ sideKind: "create", dirty: true }), "ask");
    assert.equal(sidePanelOnSwitch({ sideKind: "create", dirty: true, same: true }), "keep");
    assert.equal(sidePanelOnSwitch({ sideKind: "summary", dirty: true }), "close", "a summary has nothing to lose");
    assert.equal(sidePanelOnSwitch({ sideKind: null }), "keep");
    assert.match(DISCARD_TICKET_WORDS, /Discard the ticket you started\?/);
  });
  it("every way of opening a conversation goes through the decision", () => {
    const src = read("pages/SupportDeskPage.jsx");
    assert.match(src, /sidePanelOnSwitch\(\{ sideKind: open\?\.kind \|\| null, dirty: createDirtyRef\.current, same \}\)/);
    assert.match(src, /window\.confirm\(DISCARD_TICKET_WORDS\)/);
    assert.match(src, /!switchSelection\(\{ conversationId: p\.conversationId, reportedId: p\.reportedId \}\)/, "the address and Back or Forward");
    assert.match(src, /const select = useCallback\(\(row\) => \{\n {4}switchSelection\(/, "a row click");
    assert.doesNotMatch(src, /setSelected\(\{ conversationId: (id|p\.conversationId)/, "no path sets the selection around the decision");
    assert.match(src, /onDirtyChange=\{\(dirty\) => \{ createDirtyRef\.current = dirty; \}\}/);
    assert.match(read("components/support/CreateTicketPanel.jsx"), /onDirtyChange=\{onDirtyChange\}/);
    assert.match(read("components/ops/TicketForm.jsx"), /useEffect\(\(\) => \{ onDirtyChange\?\.\(dirty\); \}, \[dirty, onDirtyChange\]\);/);
  });
});
