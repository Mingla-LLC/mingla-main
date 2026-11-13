// #4402 polish PR, Admin leg: the "Posts to check" queue (D1), the Local pick
// window (D5) and the Creators board thumbnail. The PostgreSQL suites prove the
// server gates; these checks keep Admin on the RPC names and shapes in the spec.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  checkPickWindowDraft,
  checkPostFailReason,
  contractStateWord,
  creatorStepRows,
  payoutNameReview,
  creatorCardThumb,
  localAlreadyPicked,
  localHistoryLine,
  pickLocalWord,
  pickWindowButtonLabel,
  pickWindowConfirmLabel,
  pickWindowSummary,
  postWaitingHours,
  postWaitingOverDay,
  programErrorMessage,
  safePostUrl,
  sortPostChecks,
} from "../../lib/creatorPrograms.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const gigs = read("pages/ProgramGigsPage.jsx");
const locals = read("pages/locals/LocalsPanel.jsx");
const creators = read("pages/ProgramCreatorsPage.jsx");
const service = read("services/creatorProgramsService.js");

test("#4402 posts to check: oldest first, over 24 h marked, server hours win", () => {
  const rows = [
    { post_id: "c", submitted_at: "2026-12-16T09:00:00Z" },
    { post_id: "a", submitted_at: "2026-12-15T09:00:00Z" },
    { post_id: "x" },
    { submitted_at: "2026-12-14T09:00:00Z" },
    { post_id: "b", submitted_at: "2026-12-15T12:00:00Z" },
  ];
  assert.deepEqual(sortPostChecks(rows).map((r) => r.post_id), ["a", "b", "c", "x"]);
  assert.deepEqual(sortPostChecks(null), []);
  assert.equal(postWaitingHours({ hours_waiting: 27.9 }), 27);
  assert.equal(postWaitingOverDay({ hours_waiting: 24 }), false);
  assert.equal(postWaitingOverDay({ hours_waiting: 25 }), true);
  const now = Date.parse("2026-12-16T12:00:00Z");
  assert.equal(postWaitingHours({ submitted_at: "2026-12-15T09:00:00Z" }, now), 27);
  assert.equal(postWaitingOverDay({ submitted_at: "2026-12-16T09:00:00Z" }, now), false);
});

test("#4402 a Failed decision needs a 5 to 300 character reason; links open only as web addresses", () => {
  assert.equal(checkPostFailReason("abcd").ok, false);
  assert.equal(checkPostFailReason("    ab   ").ok, false);
  assert.deepEqual(checkPostFailReason("  the post is missing @handle  "), { ok: true, reason: "the post is missing @handle" });
  assert.equal(checkPostFailReason("x".repeat(300)).ok, true);
  assert.equal(checkPostFailReason("x".repeat(301)).ok, false);
  assert.equal(safePostUrl("https://instagram.com/reel/abc"), "https://instagram.com/reel/abc");
  assert.equal(safePostUrl("javascript:alert(1)"), null);
  assert.equal(safePostUrl("not a url"), null);
});

test("#4402 the queue and the drawer use the spec RPCs and close three ways", () => {
  assert.match(service, /export function decidePostCheck\(postId, result, reason\)/);
  assert.match(service, /write\("admin_gig_post_decide", \{[\s\S]*p_post_id: postId,[\s\S]*p_result: result,[\s\S]*p_reason:/);
  assert.match(service, /post_checks: data\?\.post_checks \?\? \[\]/);
  assert.match(gigs, /Posts to check · /);
  assert.match(gigs, /Waiting over a day/);
  assert.match(gigs, /target="_blank" rel="noopener noreferrer"/);
  assert.match(gigs, /sortPostChecks\(queue\.data\?\.post_checks\)/);
  assert.match(gigs, /Open post/);
  assert.match(gigs, />Passed</);
  assert.match(gigs, />Failed</);
  assert.match(gigs, /disabled=\{!checked\.ok \|\| !!saving\}/);
  assert.match(gigs, /History/);
  // The shared Drawer closes on a scrim click, Escape and the close button.
  const drawer = read("components/ui/Drawer.jsx");
  assert.match(drawer, /aria-label="Close"[\s\S]*onClick=\{onClose\}/);
  assert.match(drawer, /e\.key === "Escape"/);
  assert.match(gigs, /<Drawer\s+open\s+onClose=/);
});

test("#4402 a failed decision is never shown as a success", () => {
  assert.match(gigs, /catch \(cause\)[\s\S]*setError\(programErrorMessage\(cause/);
  assert.match(programErrorMessage({ error: "post_not_reviewable" }), /already checked/);
  assert.match(programErrorMessage({ error: "reason_required" }), /5 to 300/);
});

test("#4402 Local pick window: labels, validation and the summary column", () => {
  assert.equal(pickWindowConfirmLabel(7), "Open for 7 days");
  assert.equal(pickWindowConfirmLabel(1), "Open for 1 day");
  assert.equal(pickWindowConfirmLabel("3"), "Open for 3 days");
  assert.equal(checkPickWindowDraft({ days: "7", reason: "Seat paused for KYC" }).ok, true);
  assert.deepEqual(checkPickWindowDraft({ days: "7", reason: "Seat paused" }), { ok: true, days: 7, reason: "Seat paused" });
  for (const days of ["0", "15", "2.5", "", "abc"]) assert.ok(checkPickWindowDraft({ days, reason: "valid reason" }).errors.days, days);
  assert.ok(checkPickWindowDraft({ days: "7", reason: "four" }).errors.reason);
  assert.ok(checkPickWindowDraft({ days: "7", reason: "x".repeat(301) }).errors.reason);
  assert.deepEqual(pickWindowSummary({ open: true, reason: "new_seat", open_until: "2026-11-19T00:00:00Z" }), { open: true, text: "Open until Nov 19", source: "New seat" });
  assert.equal(pickWindowSummary({ open: true, reason: "admin", open_until: "2026-11-20T00:00:00Z" }).source, "Opened by admin");
  assert.deepEqual(pickWindowSummary({ open: false, opens_on: "2026-12-01" }), { open: false, text: "Closed", source: "Opens Dec 1" });
  assert.deepEqual(pickWindowSummary(null), { open: false, text: "Closed", source: null });
});

test("#4402 Extend window when an admin window is open; disabled once picked", () => {
  assert.equal(pickWindowButtonLabel({ window: { open: true, reason: "admin" } }), "Extend window");
  assert.equal(pickWindowButtonLabel({ window: { open: true, reason: "new_seat", open_until: "2026-11-19T00:00:00Z" } }), "Extend window");
  assert.equal(pickWindowButtonLabel({ window: { open: true, reason: "month_start" } }), "Extend window");
  assert.match(locals, /const extending = Boolean\(local\.window\?\.open\)/);
  assert.equal(pickWindowButtonLabel({ window: { open: false } }), "Open pick window");
  assert.equal(localAlreadyPicked({ pick: { status: "picked", place_name: "Nok" } }), true);
  assert.equal(localAlreadyPicked({ pick: null }), false);
  assert.equal(pickLocalWord({ pick: null }), "Not yet");
  assert.equal(pickLocalWord({ pick: { status: "picked", place_name: "Nok by Alara" } }), "Nok by Alara");
  assert.match(locals, /disabled=\{picked\}/);
});

test("#4402 History row names who opened the window and why", () => {
  const line = localHistoryLine({ kind: "pick_window_opened", actor: "admin", data: { open_until: "2026-11-20T00:00:00Z", reason: "Seat was paused", admin_name: "Seth" } });
  assert.equal(line, "Pick window opened until Nov 20 by Seth: Seat was paused");
  assert.match(localHistoryLine({ kind: "pick_window_opened", actor: "admin", data: { open_until: "2026-11-20T00:00:00Z", reason: "r r r r" } }), /by Mingla team/);
});

test("#4402 the Locals tab and dialog use the spec RPC", () => {
  assert.match(service, /export function openLocalPickWindow\(localId, reason, days = 7\)/);
  assert.match(service, /write\("admin_local_open_pick_window", \{[\s\S]*p_local_id: localId,[\s\S]*p_reason:[\s\S]*p_days: Number\(days\)/);
  assert.match(service, /locals: data\?\.locals \?\? \[\]/);
  assert.match(locals, /label: `Locals · \$\{queue\.locals\.length\}`/);
  assert.match(locals, /Pick window/);
  assert.match(locals, /<Modal open onClose=/);
  assert.match(locals, /pickWindowConfirmLabel\(days\)/);
  assert.match(locals, /disabled=\{!draft\.ok\}/);
  assert.match(locals, /LocalHistory/);
});

test("#4402 board card: thumbnail when there is one, an icon with No video yet when not", () => {
  assert.equal(creatorCardThumb({ thumbnail_url: "https://cdn.example/t.jpg" }), "https://cdn.example/t.jpg");
  assert.equal(creatorCardThumb({ showcase: [{ thumb: "https://cdn.example/s.jpg" }] }), "https://cdn.example/s.jpg");
  assert.equal(creatorCardThumb({ thumbnail_url: "javascript:x" }), null);
  assert.equal(creatorCardThumb({}), null);
  assert.match(creators, /No video yet/);
  assert.match(creators, /<img src=\{thumb\}/);
  assert.doesNotMatch(creators, /<span aria-hidden="true" className="h-12 w-9 shrink-0 rounded-md bg-\[var\(--gray-200\)\]" \/>/);
});

test("#4402 the Posts failed state reads as a fix, not a check failure", () => {
  assert.equal(contractStateWord("posts_failed"), "A post needs a fix");
});

test("#4402 payout name mismatch: a warning on the card and the Payout account row, never a block", () => {
  const flagged = { payout_name_review: { required: true, reason: "Bank name shares no word with the profile", checked_at: "2026-11-13T10:00:00Z" }, flags: ["payout_name_review"] };
  assert.deepEqual(payoutNameReview(flagged), { warning: "Payout name doesn't match: check before the first payout", reason: "Bank name shares no word with the profile" });
  assert.equal(payoutNameReview({ flags: ["payout_name_review"] }).reason, null);
  assert.equal(payoutNameReview({ payout_name_review: { required: false }, flags: [] }), null);
  assert.equal(payoutNameReview({ payout_name_review: null }), null);
  const rows = creatorStepRows({ ...flagged, checks: [], payout: { provider: "paystack", status: "active" } });
  assert.equal(rows.find((r) => r.key === "payout").nameReview.reason, "Bank name shares no word with the profile");
  assert.equal(creatorStepRows({ checks: [] }).find((r) => r.key === "payout").nameReview, undefined);
  assert.match(creators, /const nameReview = payoutNameReview\(creator\)/);
  assert.match(creators, /row\.nameReview\.reason/);
  assert.doesNotMatch(read("lib/creatorPrograms.js"), /payout_name_review[^\n]*(disabled|block)/i);
});
