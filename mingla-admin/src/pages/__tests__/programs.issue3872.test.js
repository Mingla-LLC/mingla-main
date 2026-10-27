// Issue #3872 — the Programs group: Creators, Gigs, Mingla Locals and
// Disputes, each on its own page and calling the agreed server contract.
// Gig budget levels are retired: a gig carries the exact pay the host set.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { NAV_GROUPS } from "../../lib/constants.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const code = (file) => read(file).replace(/^\s*\/\/.*$/gm, "");

const service = code("services/creatorProgramsService.js");
const creators = code("pages/ProgramCreatorsPage.jsx");
const gigs = code("pages/ProgramGigsPage.jsx");
const locals = code("pages/locals/LocalsPanel.jsx");
const disputes = code("pages/ProgramDisputesPage.jsx");
const app = code("App.jsx");

test("a Programs menu group holds Creators, Gigs, Mingla Locals and Disputes, each its own page", () => {
  const group = NAV_GROUPS.find((g) => g.label === "Programs");
  assert.ok(group, "Programs group");
  assert.deepEqual(group.items.map((i) => `${i.id}:${i.label}`), [
    "program-creators:Creators", "program-gigs:Gigs", "program-locals:Mingla Locals", "program-disputes:Disputes",
  ]);
  for (const [id, page] of [["program-creators", "ProgramCreatorsPage"], ["program-gigs", "ProgramGigsPage"], ["program-locals", "ProgramLocalsPage"], ["program-disputes", "ProgramDisputesPage"]]) {
    assert.match(app, new RegExp(`"${id}": ${page},`));
  }
  assert.equal(NAV_GROUPS.flatMap((g) => g.items).some((i) => i.id === "gig-queue"), false, "the stacked page is gone from the menu");
  assert.match(app, /page === "gig-queue"[\s\S]{0,200}#\/program-disputes/, "old #/gig-queue links open Disputes");
  assert.equal(fs.existsSync(path.join(root, "pages/GigQueuePage.jsx")), false);
});

test("Creators: pipeline from admin_creator_queue, decisions through admin_creator_decide, ok:false is a failure", () => {
  assert.match(service, /rpc\(name, params\)/);
  assert.match(service, /"admin_creator_queue", \{ p_status: status \}/);
  assert.match(service, /write\("admin_creator_decide", \{\s*p_creator_id: creatorId,\s*p_decision: decision,\s*p_note:/);
  assert.match(service, /data\.ok === false\) throw new ProgramWriteError/);
  for (const words of ["Setting up", "Needs a person", "Verified", "Suspended"]) assert.match(read("lib/creatorPrograms.js"), new RegExp(`label: "${words}"`));
  assert.match(creators, /CREATOR_COLUMNS/);
  assert.match(creators, /aria-label="Setup checks"/);
  assert.match(creators, /title="Flags"/);
  assert.match(creators, /title="History"/);
  assert.match(creators, /decisionNoteError\(decision, note\)/, "a missing note blocks the decision before any call");
  assert.match(creators, /setNoteError\(programErrorMessage\(cause\)\)/, "a failed decision shows next to the note");
});

test("Gigs: read-only list with plain state words, the gig's pay and the shared timeline in a drawer", () => {
  assert.match(gigs, /contractStateWord\(row\.state\)/);
  assert.match(gigs, /getContractWorkspace\(gig\.contract_id\)/);
  assert.match(gigs, /<GigTimeline /);
  assert.match(gigs, /Read-only\. Mingla watches; the two parties run the deal\./);
  assert.doesNotMatch(gigs, /supabase\.rpc\(|\.functions\.invoke\(/, "the Gigs page writes nothing");
  assert.match(gigs, /payUpToWord\(row\.pay_up_to_minor, row\.pay_currency \?\? row\.currency\)/);
  assert.match(code("pages/crm/GigTimeline.jsx"), /gigEventWord\(event\.kind\)/);
  assert.doesNotMatch(code("pages/crm/GigTimeline.jsx"), /replaceAll\("_"/);
});

test("Budget levels are gone: no ranges editor, tab, table read or save call", () => {
  assert.equal(fs.existsSync(path.join(root, "pages/programs")), false, "the ranges editor folder still exists");
  for (const [name, source] of [["service", service], ["gigs page", gigs], ["lib", code("lib/creatorPrograms.js")]]) {
    assert.doesNotMatch(source, /budget/i, `${name} still mentions budget levels`);
  }
  assert.doesNotMatch(gigs, /tab=|<Tabs /, "the Gigs page keeps no second tab");
});

test("Mingla Locals: city cards with seats, open or paused, rate and payout currency; four tabs with the existing decisions", () => {
  assert.match(service, /write\("local_city_program_save", \{[\s\S]*p_monthly_rate_minor: monthlyRateMinor,\s*p_payout_currency: payoutCurrency,/);
  assert.doesNotMatch(service, /p_monthly_usd_minor/);
  assert.match(locals, /seats used/);
  assert.match(locals, /"Open" : "Paused"/);
  assert.match(locals, /label="Paid in"|>Paid in</);
  for (const tab of ["applications", "picks", "reviews", "payouts"]) assert.match(locals, new RegExp(`id: "${tab}"`));
  for (const rpc of ["local_application_decide", "local_review_decide", "local_month_void", "local-payout", "admin_local_queue"]) assert.match(service, new RegExp(rpc));
  assert.match(locals, /Approved agreement version/);
  assert.match(locals, /Required before accepting anyone/);
  assert.match(locals, /disabled=\{!agreementVersion\.trim\(\)\}/);
  assert.match(locals, /Create city program/);
  assert.match(locals, /Open applications immediately/);
  assert.match(code("pages/ProgramLocalsPage.jsx"), /Mingla—not the place/);
  assert.doesNotMatch(locals, /\$150|Monthly USD|\.toFixed\(/, "no hard-coded USD rate or minor-unit maths on screen");
});

test("Disputes: escalated only, evidence pack, three outcomes through the existing decide path", () => {
  assert.match(service, /"admin_gig_queue"/);
  assert.match(service, /functions\.invoke\("gig-dispute-resolve"/);
  for (const label of ["Release fee", "Partial refund", "Full refund"]) assert.match(disputes, new RegExp(label));
  assert.match(disputes, /Evidence pack/);
  for (const row of ["Terms", "Locked script", "Delivered video", "Offers"]) assert.match(disputes, new RegExp(`label="${row}"`));
  assert.match(disputes, /refundPercentToBps\(refundPercent\)/, "admins type a percentage, never basis points");
  assert.doesNotMatch(disputes, /basis points/i);
  assert.match(disputes, /This can't be undone\./);
});
