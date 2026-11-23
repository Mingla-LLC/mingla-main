// Issue #4571 W2 (links on subtasks, call and booking links, call outcomes) —
// implementor tests for Admin.
//
//   O-1  CALL_OUTCOMES is the SOP's six, in order, with keys 1 to 6, and
//        matches the connector's and the database's lists
//   O-2  the log form picks an outcome with keys 1 to 6 and sends it in its
//        own field (never in the note); Wrong number needs the number
//   O-3  a call's length: "4:05" or seconds, 0 to 4 hours
//   L-1  link chips: at most two, then +N
//   L-2  removing a link asks about the subtasks only when one holds it
//   L-3  the picker offers call and demo booking links
//
// FAILS-ON-REVERT: on W1 CALL_OUTCOMES, linkChips, subtasksWithLink and the
// call and booking link kinds do not exist.
//
// Run: node --test src/__tests__/issue4571_w2_links_calls.implementor.test.js (after `npm ci`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALL_OUTCOMES, activityLine, callLengthLabel, callOutcomeForKey, callOutcomeLabel, callSuggestionWords,
  isOutboundCall, parseCallLength, usablePhones,
} from "../lib/crmModel.js";
import { DETAIL_LINK_KINDS, LINK_KINDS, linkChips, subtasksWithLink } from "../lib/opsModel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("O-1 the six call outcomes", () => {
  it("are the SOP's six, in order, with keys 1 to 6", () => {
    assert.deepEqual(CALL_OUTCOMES.map((o) => o.label),
      ["Demo booked", "Spoke – follow up", "Call back", "No answer", "Not interested", "Wrong number"]);
    assert.deepEqual(CALL_OUTCOMES.map((o) => o.key), ["1", "2", "3", "4", "5", "6"]);
  });
  it("use the same slugs as the connector and the database", () => {
    const slugs = CALL_OUTCOMES.map((o) => o.value);
    const tools = read("supabase/functions/_shared/teamAgentTools.ts");
    const list = /export const CALL_OUTCOMES: readonly string\[\] = \[([^\]]*)\]/.exec(tools)?.[1] || "";
    assert.deepEqual([...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]), slugs);
    const sql = read("supabase/migrations/20281126024571_issue_4571_w2_links_and_call_outcomes.sql");
    for (const o of CALL_OUTCOMES) assert.ok(sql.includes(`WHEN '${o.value}'`) && sql.includes(`THEN '${o.label}'`), o.value);
  });
  it("label stored values and nothing else", () => {
    assert.equal(callOutcomeLabel("no_answer"), "No answer");
    assert.equal(callOutcomeLabel("busy"), "");
  });
});

describe("O-2 the log form", () => {
  it("keys 1 to 6 pick the outcomes; other keys pick nothing", () => {
    assert.equal(callOutcomeForKey("1"), "demo_booked");
    assert.equal(callOutcomeForKey("6"), "wrong_number");
    assert.equal(callOutcomeForKey("7"), null);
    assert.equal(callOutcomeForKey("a"), null);
  });
  it("only a call the rep made takes an outcome", () => {
    assert.equal(isOutboundCall({ kind: "touch", channel: "phone", direction: "outbound" }), true);
    assert.equal(isOutboundCall({ kind: "touch", channel: "email", direction: "outbound" }), false);
    assert.equal(isOutboundCall({ kind: "touch", channel: "phone", direction: "inbound" }), false);
  });
  it("sends outcome, length, number and card as their own fields, and reads keys on the outcome group", () => {
    const src = read("mingla-admin/src/components/crm/LogForm.jsx");
    assert.match(src, /entry\.outcome = outcome/);
    assert.match(src, /entry\.duration_seconds = parsed\.seconds/);
    assert.match(src, /entry\.identifier_id = badPhone/);
    assert.match(src, /entry\.work_card = Number\(card\)/);
    assert.match(src, /onKeyDown=\{outcomeKeys\}/);
    assert.doesNotMatch(src, /entry\.body = .*outcome/);
    assert.doesNotMatch(src, /type="date"/);
  });
  it("offers only usable phones for Wrong number", () => {
    const record = { identifiers: [
      { id: "a", kind: "phone", value: "+234 1", status: "ok" },
      { id: "b", kind: "phone", value: "+234 2", status: "bad" },
      { id: "c", kind: "email", value: "x@y.z", status: "ok" },
    ] };
    assert.deepEqual(usablePhones(record).map((p) => p.id), ["a"]);
  });
  it("the timeline shows the outcome and length", () => {
    const line = activityLine({ kind: "touch", channel: "phone", direction: "outbound", outcome: "no_answer", duration_seconds: 0 },
      null, { channels: [{ id: "phone", label: "Phone" }] });
    assert.equal(line.headline, "Phone · reached out · No answer · 0:00");
    assert.equal(line.body, "");
  });
  it("a suggestion is words, never a move", () => {
    assert.equal(callSuggestionWords({ suggest_stage: { stage: null, note: "Find a new number." } }, null), "Find a new number.");
    assert.equal(callSuggestionWords({}, null), "");
  });
});

describe("O-3 a call's length", () => {
  it("reads m:ss and seconds, up to four hours", () => {
    assert.deepEqual(parseCallLength(""), { seconds: null });
    assert.deepEqual(parseCallLength("4:05"), { seconds: 245 });
    assert.deepEqual(parseCallLength("90"), { seconds: 90 });
    assert.deepEqual(parseCallLength("240:00"), { seconds: 14400 });
    assert.ok(parseCallLength("240:01").error);
    assert.ok(parseCallLength("4:75").error);
    assert.ok(parseCallLength("-3").error);
    assert.equal(callLengthLabel(245), "4:05");
    assert.equal(callLengthLabel(null), "");
  });
});

describe("L-1 link chips", () => {
  const links = [1, 2, 3, 4].map((n) => ({ kind: "host", id: `h${n}`, label: `Host ${n}` }));
  it("show two, then +N", () => {
    const { shown, more } = linkChips(links);
    assert.deepEqual(shown.map((l) => l.id), ["h1", "h2"]);
    assert.equal(more, 2);
  });
  it("skip links without a label and show nothing for none", () => {
    assert.deepEqual(linkChips([{ kind: "host", id: "x" }]), { shown: [], more: 0 });
    assert.deepEqual(linkChips(undefined), { shown: [], more: 0 });
  });
  it("are drawn on tiles and subtask rows", () => {
    assert.match(read("mingla-admin/src/components/ops/WorkBoard.jsx"), /<LinkChips links=\{card\.links\} \/>/);
    assert.match(read("mingla-admin/src/components/ops/CardSubtasks.jsx"), /<LinkChips links=\{sub\.links\} open \/>/);
  });
});

describe("L-2 removing a link", () => {
  const link = { kind: "host", id: "h1" };
  const subs = [
    { id: "s1", status: "todo", links: [link] },
    { id: "s2", status: "done", links: [link] },
    { id: "s3", status: "doing", links: [{ kind: "host", id: "h2" }] },
  ];
  it("asks only about open subtasks that hold the same link", () => {
    assert.deepEqual(subtasksWithLink(subs, link).map((s) => s.id), ["s1"]);
    assert.deepEqual(subtasksWithLink([], link), []);
  });
  it("goes through ops_work_link_remove, with the subtasks off by default", () => {
    const svc = read("mingla-admin/src/services/opsService.js");
    assert.match(svc, /rpc\("ops_work_link_remove"/);
    const detail = read("mingla-admin/src/components/ops/WorkDetail.jsx");
    assert.match(detail, /setUnlinking\(l\); setAlsoSubs\(false\)/);
    assert.match(detail, /Also remove from \{subtasksWithLink/);
  });
});

describe("L-3 the picker", () => {
  it("offers call and demo booking links on a card, not in the quick add", () => {
    assert.ok(DETAIL_LINK_KINDS.some((k) => k.value === "call"));
    assert.ok(DETAIL_LINK_KINDS.some((k) => k.value === "booking"));
    assert.ok(!LINK_KINDS.some((k) => k.value === "call"));
  });
});
