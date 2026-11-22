// MINGLA-INVARIANT: I-4420-NO-FALSE-LINK-CLAIM | issue #4420 | the Create ticket panel says a conversation is linked only after the server confirmed "Link here"; "Open" opens a ticket and links nothing.
// MINGLA-INVARIANT: I-4420-SIDE-PANEL-ONE-DISCARD-RULE | issue #4420 | Escape, the backdrop, the close button, Cancel / Done, opening a ticket and opening another conversation all go through the one discard decision (sidePanelOnSwitch).
//
// Issue #4420 rework 4 (QA pass 4): F1, F2 (and F5 to F7 below).
// Run: node --test src/__tests__/issue4420_rework4.implementor.test.js (from mingla-admin).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ticketDuplicateNotice } from "../lib/ticketModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

describe("F1 Open opens, Link here links, nothing claims a link that did not happen", () => {
  const form = read("components/ops/TicketForm.jsx");
  const panel = read("components/support/CreateTicketPanel.jsx");
  const page = read("pages/SupportDeskPage.jsx");
  it("the duplicate notice carries the title so Open can show the ticket", () => {
    const n = ticketDuplicateNotice({ existing: { id: "c1", number: 36, title: "Cannot find my ticket" } }, { hasSource: true });
    assert.equal(n.title, "Cannot find my ticket");
  });
  it("linkHere reports a link only after the server answered, and only through onLinked", () => {
    const body = form.slice(form.indexOf("const linkHere"), form.indexOf("const submit"));
    assert.ok(body.indexOf("linkTicketConversation") < body.indexOf("onLinked?.("), "onLinked after the server call");
    assert.doesNotMatch(body, /onOpenCard/, "linking never calls the open path");
    assert.match(body, /catch \(error\)[\s\S]*Couldn’t link here/);
    assert.ok(body.indexOf("onLinked?.(") < body.indexOf("catch"), "not in the catch");
  });
  it("both Open buttons call onOpenCard and never linkHere", () => {
    const opens = form.match(/onClick=\{\(\) => onOpenCard\?\./g) || [];
    assert.equal(opens.length, 2);
  });
  it("the panel's Open does not set the linked state; only onLinked does", () => {
    const open = panel.match(/onOpenCard=\{[^\n]*\n/)[0];
    assert.doesNotMatch(open, /setDone|onLinked/);
    assert.match(open, /onOpenTicket/);
    assert.match(panel, /onLinked=\{\(id\) => \{[^\n]*setDone\(\{ number: null, id \}\)[^\n]*onLinked\?\.\(id\)/);
  });
  it("the page shows the ticket summary for Open and reloads labels only on a real link", () => {
    assert.match(page, /onOpenTicket=\{\(info\) => leaveSide\(\{ kind: "summary"/);
    assert.match(page, /onLinked=\{\(\) => \{ void loadLinked\(tickets\); \}\}/);
    assert.doesNotMatch(read("components/support/TicketSummaryPanel.jsx"), /Linked to/);
  });
});

describe("F2 every close path uses the one discard decision", () => {
  const page = read("pages/SupportDeskPage.jsx");
  it("no side-panel close calls setSide(null) directly any more", () => {
    const direct = (page.match(/setSide\(null\)/g) || []).length;
    // only the decision itself (leaveSide uses setSide(next)) and switchSelection's already-decided close remain
    assert.equal(direct, 1, "just switchSelection's close after its own decision");
    assert.match(page, /if \(e\.key === "Escape" && !e\.defaultPrevented\) leaveSide\(null\)/);
    assert.match(page, /data-side-backdrop="" onClick=\{\(\) => leaveSide\(null\)\}/);
    assert.match(page, /<CreateTicketPanel[\s\S]{0,200}onClose=\{\(\) => leaveSide\(null\)\}/);
    assert.match(page, /<TicketSummaryPanel linked=\{side\.linked\} onClose=\{\(\) => leaveSide\(null\)\}/);
  });
  it("leaveSide asks through sidePanelOnSwitch and keeps the form when the person cancels", () => {
    const body = page.slice(page.indexOf("const leaveSide"), page.indexOf("const loadLinked"));
    assert.match(body, /sidePanelOnSwitch\(\{ sideKind: open\?\.kind \|\| null, dirty: createDirtyRef\.current, same: false \}\)/);
    assert.match(body, /decision === "ask" && !window\.confirm\(DISCARD_TICKET_WORDS\)\) return false/);
    assert.ok(body.indexOf("return false") < body.indexOf("setSide(next)"), "the form is kept before anything closes");
  });
});

import { customerFallbackLine, inboxLookupNotice, NAMES_HIDDEN_LINE } from "../lib/supportInboxModel.js";

describe("F5 the details line when names are hidden", () => {
  it("says names are hidden for a conversation that has a customer, never 'No customer linked'", () => {
    assert.equal(customerFallbackLine({ hasCustomer: true, namesHidden: true }), NAMES_HIDDEN_LINE);
    assert.match(NAMES_HIDDEN_LINE, /^Names aren't shown for your account/);
    assert.ok(inboxLookupNotice(["people"]).startsWith(NAMES_HIDDEN_LINE), "same wording as the notice");
  });
  it("'No customer linked' stays for a conversation with truly no customer, or names that are shown", () => {
    assert.equal(customerFallbackLine({ hasCustomer: false, namesHidden: true }), "No customer linked");
    assert.equal(customerFallbackLine({ hasCustomer: true, namesHidden: false }), "No customer linked");
  });
  it("the panel and page wire it", () => {
    assert.match(read("components/support/TicketPanel.jsx"), /customerFallbackLine\(\{ hasCustomer: Boolean\(ticket\.requester_user_id\), namesHidden \}\)/);
    assert.match(read("pages/SupportDeskPage.jsx"), /setNamesHidden\(lookups\.missing\.includes\("people"\)\)/);
    assert.match(read("pages/SupportDeskPage.jsx"), /namesHidden=\{namesHidden\}/);
  });
});

describe("F7 the Work search box follows the address", () => {
  it("resets the typed text whenever the address's q changes", () => {
    assert.match(read("pages/WorkBoardPage.jsx"), /if \(seenQ !== view\.q\) \{ setSeenQ\(view\.q\); setTyping\(\{ q: view\.q, text: view\.q \}\); \}/);
  });
});

// #4420 rework 5 (H3). FAILS-ON-REVERT: put back `|| "Ticket"` and the summary
// says "Type: Ticket" for a ticket whose type the row does not carry.
import { ticketTypeLabel } from "../lib/ticketModel.js";
describe("H3 the ticket summary shows the ticket's own type, or no type", () => {
  const panel = read("components/support/TicketSummaryPanel.jsx");
  it("the one label helper gives Bug, Idea, Question and Task for the real type values", () => {
    assert.deepEqual(["bug", "idea", "question", "task"].map(ticketTypeLabel), ["Bug", "Idea", "Question", "Task"]);
  });
  it("a row with no type (the duplicate answer: id, number, title only) gives an empty label", () => {
    assert.equal(ticketTypeLabel(undefined), "");
    assert.equal(ticketTypeLabel(null), "");
  });
  it("the panel renders the Type row only with a label and never invents 'Ticket'", () => {
    assert.match(panel, /const typeLabel = ticketTypeLabel\(linked\.type\)/);
    assert.match(panel, /typeLabel \? \(/);
    assert.doesNotMatch(panel, /\|\| "Ticket"/);
  });
});
