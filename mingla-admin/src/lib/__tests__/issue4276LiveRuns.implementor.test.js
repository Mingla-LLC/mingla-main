// Issue #4276 Live runs: the words and rules behind Place pool > Pipeline > Live runs.
//
// MINGLA-INVARIANT: I-4276-LIVE-RUNS-WAIT-IS-NOT-STALL | issue #4276 | A run that chose to wait (rate limit, Intelligence) reads as Waiting, never as stalled or failed; only 5+ min with no progress and no wait reads "No progress"
// MINGLA-INVARIANT: I-4276-LIVE-RUNS-POLL-BUDGET | issue #4276 | Live runs reads one RPC every 5 s while a run is active, every 30 s otherwise, nothing while the tab is hidden, and shows an error only after 3 failures in a row
//
// FAILS-ON-REVERT: drop the wait branch from heartbeatState and the rate-limited run
// reads "No progress"; move the moving/stalled lines and the 2 min / 5 min boundary
// tests fail; fold unpriced Serper into dollars and the "not priced" tests fail; unmount
// LiveRunsSection or move it under the gaps table and the mount test fails; remove the
// document.hidden check or the 3-failure rule and the poller contract fails.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  clockTime,
  etaText,
  finishedRunRow,
  heartbeatState,
  liveChipFor,
  livePill,
  liveSpend,
  liveStats,
  outcomeText,
  pauseNote,
  problemNote,
  runRate,
  stageProgress,
  stageTrack,
  waitReasonText,
} from "../cityPipeline.js";

const SRC = new URL("../../", import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const NOW = Date.parse("2026-11-07T21:30:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();

const searchStage = { stage: "fill", ord: 2, status: "running", progress: { kind: "search", done: 1237, failed: 3, total: 4536, places_new: 1804, places_duped: 612, cost_usd: 39.68, child_status: "running" } };
const running = (over = {}) => ({
  id: "run-1", city_id: "city-1", city_name: "Abuja", country: "Nigeria", status: "running", current_stage: "fill",
  spend_limit_usd: 160, spent_usd: 39.68, serper_requests: 0, last_progress_at: ago(9_000), last_outcome: { kind: "progress", why: null, retry_after_ms: null, at: ago(9_000), calls: 50 },
  next_attempt_at: null, error_streak: 0, last_error: null, created_at: ago(1_800_000), started_at: ago(1_740_000),
  stages: [{ stage: "box", ord: 1, status: "skipped" }, searchStage, { stage: "split", ord: 3, status: "skipped" }], ...over,
});

// ── heartbeatState ───────────────────────────────────────────────────────────

test("moving: running with progress under 2 minutes ago", () => {
  assert.deepEqual(heartbeatState(running(), NOW), { state: "moving", text: "Moving: last progress 9 s ago" });
  const edge = heartbeatState(running({ last_progress_at: ago(119_000) }), NOW);
  assert.equal(edge.state, "moving");
  assert.equal(edge.text, "Moving: last progress 1 min ago");
});

test("at 2 minutes the run stops claiming it is moving, and it is not stalled yet", () => {
  const two = heartbeatState(running({ last_progress_at: ago(120_000) }), NOW);
  assert.equal(two.state, "moving");
  assert.equal(two.quiet, true);
  assert.equal(two.text, "Last progress 2 min ago");
  const justUnder = heartbeatState(running({ last_progress_at: ago(299_999) }), NOW);
  assert.notEqual(justUnder.state, "stalled");
});

test("stalled: running, 5 minutes or more with no progress and not waiting", () => {
  assert.deepEqual(heartbeatState(running({ last_progress_at: ago(300_000) }), NOW), { state: "stalled", text: "No progress for 5 min" });
  assert.deepEqual(heartbeatState(running({ last_progress_at: ago(6 * 60_000 + 10_000) }), NOW), { state: "stalled", text: "No progress for 6 min" });
});

test("waiting: a rate-limit wait reads as waiting with its seconds, never stalled", () => {
  const run = running({
    last_progress_at: ago(7 * 60_000),
    last_outcome: { kind: "wait", why: "function_rate_limit", retry_after_ms: 32_000, at: ago(0), calls: 50 },
    next_attempt_at: ahead(32_000),
  });
  assert.deepEqual(heartbeatState(run, NOW), { state: "waiting", text: "Waiting 32 s: Supabase asked us to slow down" });
  // A retry time ahead is enough, whatever the last outcome said.
  const retry = heartbeatState(running({ last_outcome: null, next_attempt_at: ahead(10_000) }), NOW);
  assert.equal(retry.state, "waiting");
  // Without next_attempt_at the seconds come from retry_after_ms.
  const fromOutcome = heartbeatState(running({ last_outcome: { kind: "wait", why: "google rate limit", retry_after_ms: 30_000, at: ago(10_000) } }), NOW);
  assert.deepEqual(fromOutcome, { state: "waiting", text: "Waiting 20 s: Google asked us to slow down" });
});

test("waiting for Intelligence names its progress", () => {
  const run = running({
    current_stage: "intelligence",
    last_outcome: { kind: "wait", why: "intelligence running", at: ago(20_000) },
    stages: [{ stage: "intelligence", status: "running", progress: { kind: "intelligence", done: 3120, total: 4400, succeeded: 3100, failed: 20, cost_usd: 4, serper_requests: 0 } }],
  });
  assert.deepEqual(heartbeatState(run, NOW), { state: "waiting", text: "Waiting for Intelligence to finish (3,120 of 4,400)" });
  const busy = heartbeatState(running({ last_outcome: { kind: "wait", why: "intelligence_city_busy", at: ago(20_000) } }), NOW);
  assert.equal(busy.text, "Waiting: Another Intelligence run is using this city");
});

test("a wait recorded over 5 minutes ago with nothing ahead is a stall: nothing is waking the run", () => {
  const run = running({ last_progress_at: ago(9 * 60_000), last_outcome: { kind: "wait", why: "function_rate_limit", at: ago(8 * 60_000) } });
  assert.equal(heartbeatState(run, NOW).state, "stalled");
});

test("stopped: paused names how long and where; awaiting approval names since when", () => {
  const paused = running({ status: "paused", current_stage: "photos", pause_reason: "spend_limit", last_outcome: { kind: "pause", why: "spend_limit", at: ago(14 * 60_000) } });
  assert.deepEqual(heartbeatState(paused, NOW), { state: "stopped", text: "Stopped 14 min ago at Photos" });
  const at = ago(32 * 60_000);
  const appr = heartbeatState(running({ status: "awaiting_approval", last_outcome: { kind: "approval", at } }), NOW);
  assert.equal(appr.state, "stopped");
  assert.equal(appr.text, `Waiting for you since ${clockTime(at)}`);
  assert.match(appr.text, /^Waiting for you since \d{2}:\d{2}$/);
});

test("done: finished, cancelled and failed runs", () => {
  for (const [status, word] of [["completed", "Finished"], ["complete", "Finished"], ["cancelled", "Cancelled"], ["failed", "Failed"]]) {
    const beat = heartbeatState(running({ status, completed_at: ago(60_000) }), NOW);
    assert.equal(beat.state, "done", status);
    assert.equal(beat.text, `${word} 1 min ago`);
  }
});

// ── outcomeText and wait reasons ─────────────────────────────────────────────

test("every wait reason reads in plain words; an unknown one gets a safe generic line", () => {
  assert.equal(waitReasonText("function_rate_limit"), "Supabase asked us to slow down");
  assert.equal(waitReasonText("wait:function_rate_limit"), "Supabase asked us to slow down");
  assert.equal(waitReasonText("google rate limit"), "Google asked us to slow down");
  assert.equal(waitReasonText("a search is still running"), "A search is still running");
  assert.equal(waitReasonText("intelligence running"), "Intelligence is still working");
  assert.equal(waitReasonText("intelligence started"), "Intelligence just started");
  assert.equal(waitReasonText("intelligence_city_busy"), "Another Intelligence run is using this city");
  assert.equal(waitReasonText("<script>quota_xyz</script>"), "Waiting for the next step");
  assert.equal(waitReasonText(null), "Waiting for the next step");
});

test("outcomeText covers every kind and never echoes an unknown one raw", () => {
  assert.equal(outcomeText(null), "");
  assert.equal(outcomeText({ kind: "progress", calls: 50 }), "Moved forward · 50 calls");
  assert.equal(outcomeText({ kind: "wait", why: "function_rate_limit", calls: 1 }), "Waited: Supabase asked us to slow down · 1 call");
  assert.equal(outcomeText({ kind: "wait", why: "mystery" }), "Waited: Waiting for the next step");
  assert.equal(outcomeText({ kind: "budget", calls: 50 }), "Ended at its per-minute cap · 50 calls");
  assert.equal(outcomeText({ kind: "approval" }), "Stopped to ask for your OK");
  assert.equal(outcomeText({ kind: "pause", why: "spend_limit" }), "Paused: It reached its spend limit. Raise the limit to resume.");
  assert.equal(outcomeText({ kind: "error", why: "run_next_batch returned 504: sub_call_timeout" }), "Hit a problem: run_next_batch returned 504: sub_call_timeout");
  assert.equal(outcomeText({ kind: "complete" }), "Finished");
  assert.equal(outcomeText({ kind: "brand_new_kind" }), "Did something this page doesn't know how to describe");
});

// ── stageProgress ────────────────────────────────────────────────────────────

test("stageProgress reads every progress kind", () => {
  const search = stageProgress(searchStage);
  assert.deepEqual([search.label, search.done, search.total, search.pct], ["Searching", 1240, 4536, 27]);
  assert.equal(search.line, "1,240 of 4,536 searches (27%)");

  const split = stageProgress({ stage: "split", progress: { kind: "search", done: 10, failed: 0, total: 40 } });
  assert.equal(split.label, "Capped searches");
  assert.equal(split.pct, 25);

  const photos = stageProgress({ stage: "photos", progress: { kind: "photos", done: 40, failed: 0, total: 80, places_total: 800, succeeded: 480, failed_places: 8, cost_usd: 3 } });
  assert.deepEqual([photos.done, photos.total, photos.pct, photos.line], [488, 800, 61, "488 of 800 places (61%)"]);

  const photoBatches = stageProgress({ stage: "photos", progress: { kind: "photos", done: 4, failed: 1, total: 10 } });
  assert.equal(photoBatches.line, "5 of 10 batches (50%)");

  const intel = stageProgress({ stage: "intelligence", progress: { kind: "intelligence", done: 3120, total: 4400, succeeded: 3100, failed: 20 } });
  assert.deepEqual([intel.label, intel.pct, intel.line], ["Reviews and Intelligence", 71, "3,120 of 4,400 places (71%)"]);

  const check = stageProgress({ stage: "pre_check", progress: { kind: "check", processed: 2000 } });
  assert.deepEqual([check.label, check.done, check.total, check.pct, check.line], ["Pre-check", 2000, null, null, "2,000 places checked"]);

  const score = stageProgress({ stage: "score", progress: { kind: "score", signal_index: 2, signals: 5, written: 1400 } });
  assert.deepEqual([score.pct, score.line], [40, "Signal 2 of 5 · 1,400 scores written"]);

  const comp = stageProgress({ stage: "completeness", progress: { kind: "completeness" } });
  assert.equal(comp.line, "Checking what is still missing");
  assert.equal(comp.pct, null);

  assert.equal(stageProgress({ stage: "box", progress: null }), null);
  assert.equal(stageProgress(null), null);
  assert.equal(stageProgress({ stage: "fill", progress: { kind: "unknown" } }), null);
  // A total of zero never divides into a made-up percentage.
  assert.equal(stageProgress({ stage: "fill", progress: { kind: "search", done: 0, failed: 0, total: 0 } }).pct, null);
});

// ── pace ─────────────────────────────────────────────────────────────────────

test("runRate is a rolling 3-minute rate, null until 30 s of samples", () => {
  assert.equal(runRate([]), null);
  assert.equal(runRate([{ ts: 0, done: 0 }, { ts: 10_000, done: 20 }]), null, "under 30 s is too soon");
  assert.equal(runRate([{ ts: 0, done: 0 }, { ts: 60_000, done: 50 }]), 50);
  // Only the last 3 minutes count: an old slow stretch is dropped.
  const samples = [{ ts: 0, done: 0 }, { ts: 300_000, done: 10 }, { ts: 420_000, done: 110 }, { ts: 480_000, done: 160 }];
  assert.equal(runRate(samples), 50);
  assert.equal(runRate([{ ts: 0, done: 100 }, { ts: 60_000, done: 50 }]), null, "a counter that went back is not a rate");
  assert.equal(runRate([{ ts: 0, done: 5 }, { ts: 60_000, done: 5 }]), 0);
});

test("etaText says the pace and the time left in plain words", () => {
  assert.equal(etaText(50, 3296), "About 50 searches a minute · about 66 min left");
  assert.equal(etaText(48, 274), "About 48 searches a minute · about 6 min left");
  assert.equal(etaText(10, 1500), "About 10 searches a minute · about 2 h 30 min left");
  assert.equal(etaText(120, 30), "About 120 searches a minute · under a minute left");
  assert.equal(etaText(30, 300, "places"), "About 30 places a minute · about 10 min left");
  assert.equal(etaText(0.5, 10), "Less than 1 search a minute · about 20 min left");
  assert.equal(etaText(null, 100), "Working out the pace…");
  assert.equal(etaText(0, 100), "No progress in the last 3 min");
  assert.equal(etaText(50, 0), "Almost done");
});

// ── chips, pills, track ──────────────────────────────────────────────────────

test("liveChipFor: the city row's chip matches the card", () => {
  assert.equal(liveChipFor(null), null);
  assert.equal(liveChipFor(running({ status: "completed" })), null, "finished runs get no live chip");
  assert.deepEqual(liveChipFor(running(), NOW), { label: "Running 27%", variant: "success", runId: "run-1" });
  assert.deepEqual(liveChipFor(running({ next_attempt_at: ahead(5000) }), NOW), { label: "Waiting", variant: "info", runId: "run-1" });
  assert.deepEqual(liveChipFor(running({ last_progress_at: ago(600_000), last_outcome: null }), NOW), { label: "No progress", variant: "warning", runId: "run-1" });
  assert.deepEqual(liveChipFor(running({ status: "paused" }), NOW), { label: "Paused", variant: "warning", runId: "run-1" });
  assert.deepEqual(liveChipFor(running({ status: "awaiting_approval" }), NOW), { label: "Needs your OK", variant: "info", runId: "run-1" });
  assert.deepEqual(liveChipFor(running({ status: "queued" }), NOW), { label: "Queued", variant: "info", runId: "run-1" });
  assert.equal(liveChipFor(running({ stages: [] }), NOW).label, "Running", "no progress object, no invented percentage");
  assert.equal(livePill(running({ status: "cancelled" })).label, "Cancelled");
});

test("the stage track has 11 segments: skipped, done, current and paused", () => {
  const track = stageTrack(running());
  assert.equal(track.length, 11);
  assert.deepEqual(track.slice(0, 4).map((s) => s.state), ["skipped", "current", "skipped", "pending"]);
  const paused = stageTrack(running({ status: "paused", current_stage: "photos", stages: [{ stage: "fill", status: "complete" }, { stage: "photos", status: "running" }] }));
  assert.equal(paused.find((s) => s.id === "fill").state, "done");
  assert.equal(paused.find((s) => s.id === "photos").state, "paused");
});

// ── money: Serper is never $0 ────────────────────────────────────────────────

test("spend reads against the limit, and unpriced Serper reads 'not priced', never $0", () => {
  const s = liveSpend(running({ serper_requests: 412 }), null);
  assert.equal(s.spentText, "$39.68");
  assert.equal(s.limitText, "$160.00");
  assert.equal(s.pct, 25);
  assert.equal(s.serperText, "412 Serper requests, not priced");
  assert.equal(liveSpend(running({ serper_requests: 0 }), null).serperText, null);
  assert.equal(liveSpend(running({ serper_requests: 1000 }), 0.001).serperText, "1,000 Serper requests, $1.00");
  assert.equal(liveSpend(running({ spent_usd: null })).spentText, "unknown");
  assert.equal(liveSpend(running({ spent_usd: 60, spend_limit_usd: 60 })).over, true);

  const intel = liveStats(running({ current_stage: "intelligence", stages: [{ stage: "intelligence", status: "running", progress: { kind: "intelligence", done: 10, total: 20, succeeded: 9, failed: 1, serper_requests: 30 } }] }), null);
  const serper = intel.find((x) => x.label === "Serper");
  assert.equal(serper.value, "30");
  assert.equal(serper.note, "requests · not priced");
  for (const x of intel) assert.ok(!String(x.value).includes("$0") && !String(x.note ?? "").includes("$0"), x.label);
  const other = liveStats(running({ status: "awaiting_approval", current_stage: "split", held_places: 640, serper_requests: 7, stages: [] }), null);
  assert.deepEqual(other.map((x) => x.label), ["Places held", "Stage", "Serper"]);
  assert.equal(other[2].note, "requests · not priced");
});

test("search-stage stats: places stored new, already known, failed searches", () => {
  assert.deepEqual(liveStats(running()), [
    { label: "Places stored", value: "1,804", note: "new" },
    { label: "Already known", value: "612" },
    { label: "Failed searches", value: "3", note: "0.2%" },
  ]);
});

// ── notes ────────────────────────────────────────────────────────────────────

test("an error before a pause shows while the run keeps going", () => {
  assert.equal(problemNote(running()), null);
  assert.deepEqual(problemNote(running({ last_outcome: { kind: "error", why: "x" }, last_error: "run_next_batch returned 504: sub_call_timeout" })),
    { title: "1 problem, still running", message: "run_next_batch returned 504: sub_call_timeout" });
  assert.equal(problemNote(running({ error_streak: 2, last_error: { message: "boom" } })).title, "2 problems in a row, still running");
  assert.equal(problemNote(running({ status: "paused", error_streak: 3 })), null, "a paused run says its pause reason instead");
});

test("a paused run says its reason in plain words with the numbers behind it", () => {
  const note = pauseNote(running({ status: "paused", pause_reason: "spend_limit", spent_usd: 60, spend_limit_usd: 60 }));
  assert.equal(note.title, "It reached its spend limit. Raise the limit to resume.");
  assert.deepEqual(note.lines, ["$60.00 of $60.00 spent."]);
  const unjudged = pauseNote(running({ status: "paused", pause_reason: "places_unfinished", pause_detail: { unjudged: 12 } }));
  assert.ok(unjudged.lines[0].startsWith("12 places never got a final check verdict"));
  assert.equal(pauseNote(running({ status: "paused", pause_reason: "intelligence_busy" })).title, "Intelligence was busy in this city");
  assert.equal(pauseNote(running()), null);
});

test("a finished run's row: result, stages, took, and dashes for numbers it does not have", () => {
  const row = finishedRunRow(running({
    status: "completed", spent_usd: 9.84, started_at: "2026-11-06T13:42:00Z", completed_at: "2026-11-06T14:20:00Z",
    stages: [{ stage: "pre_check", ord: 5, status: "complete" }, { stage: "photos", ord: 6, status: "complete" }, { stage: "release", ord: 10, status: "complete", result: { released: 212 } }],
  }));
  assert.equal(row.pill.label, "Finished");
  assert.equal(row.stagesText, "Pre-check to release");
  assert.equal(row.liveText, "212");
  assert.equal(row.storedText, "–");
  assert.equal(row.spentText, "$9.84");
  assert.equal(row.tookText, "38 min");
});

// ── source contracts ─────────────────────────────────────────────────────────

test("Live runs is mounted at the top of the Pipeline tab, above the gaps table", () => {
  const section = stripComments(read("components/placePool/PipelineSection.jsx"));
  const live = section.indexOf("<LiveRunsSection ");
  assert.ok(live > 0, "LiveRunsSection is mounted");
  assert.ok(live < section.indexOf("<HealthCard "), "it is the first thing in the tab");
  assert.ok(live < section.indexOf("What each city is missing"), "above the gaps table");
  assert.ok(section.includes("useLiveCityRuns()"), "the tab owns the one live read");
  assert.ok(section.includes("liveChipFor(liveByCity[c.city_id])"), "the city row chip comes from the live data");
  assert.ok(section.includes("showRunCard(chip.runId)"), "the chip jumps to the card");
});

test("the poller: 5 s while active, 30 s idle, nothing while hidden, error after 3 misses, last data kept", () => {
  const hook = stripComments(read("hooks/useLiveCityRuns.js"));
  assert.match(hook, /LIVE_ACTIVE_POLL_MS\s*=\s*5000\b/);
  assert.match(hook, /LIVE_IDLE_POLL_MS\s*=\s*30000\b/);
  assert.ok(hook.includes("activeRef.current ? LIVE_ACTIVE_POLL_MS : LIVE_IDLE_POLL_MS"));
  assert.ok(hook.includes("document.hidden) return"), "a hidden tab reads nothing");
  assert.ok(hook.includes('addEventListener("visibilitychange"'), "it resumes when the tab is back");
  assert.match(hook, /ERROR_THRESHOLD\s*=\s*3\b/);
  assert.ok(hook.includes("failuresRef.current >= ERROR_THRESHOLD"), "an error only after 3 misses in a row");
  const catchBlock = hook.slice(hook.indexOf("} catch (err) {"), hook.indexOf("} finally {"));
  assert.equal(catchBlock.includes("setRuns("), false, "a failed read keeps the last good runs");
  assert.ok(hook.includes("fetchLiveRuns(days)"), "one database read per poll");
  assert.equal(/invokeWithRefresh|functions\.invoke/.test(hook), false, "no edge function call per poll");
  const svc = read("services/cityPipelineService.js");
  assert.ok(svc.includes('supabase.rpc("admin_city_pipeline_live", { p_days: days })'));
});

test("the Run plan drops its own 15 s poll while the live read answers", () => {
  const run = stripComments(read("components/placePool/CityRunPanel.jsx"));
  assert.ok(run.includes("if (liveReady) return undefined;"));
  assert.ok(run.includes("if (before !== null && before !== status) onChanged();"), "a status change refreshes the city row");
  assert.ok(run.includes("stageProgress(liveStage("), "every stage row can show its progress");
  assert.ok(run.includes("problemNote(run)"), "errors before a pause show in the panel too");
});

test("no live-runs screen writes Serper as $0", () => {
  for (const rel of ["components/placePool/LiveRunsSection.jsx", "components/placePool/CityRunPanel.jsx", "hooks/useLiveCityRuns.js"]) {
    const code = stripComments(read(rel));
    assert.equal(/Serper[^\n]{0,80}\$0/.test(code), false, rel);
    assert.equal(/\$0[^\n]{0,80}Serper/.test(code), false, rel);
  }
  const live = stripComments(read("components/placePool/LiveRunsSection.jsx"));
  assert.ok(live.includes("liveSpend(run, serperRate)"), "the spend meter goes through liveSpend");
});

test("card actions go through the conductor with the Run plan's confirm steps", () => {
  const live = stripComments(read("components/placePool/LiveRunsSection.jsx"));
  assert.ok(live.includes("await pipeline(action, { runId: run.id, ...body });"));
  assert.ok(live.includes('act("cancel", {}, '), "cancel");
  assert.ok(live.includes('open={confirm === "cancel"}'), "cancel asks first");
  assert.ok(live.includes('act("rules_only", { confirmRulesOnly: true }, '), "rules only asks first");
  assert.ok(live.includes('act("resume", { spendLimitUsd: limitNumber }, '), "raise limit and resume");
  assert.ok(live.includes('confirmHighCost: approval.highCost ? true : undefined'), "high cost asks first");
  assert.ok(live.includes("No runs going"), "the empty state");
  assert.ok(live.includes("This is normal."), "a wait is explained as normal");
  assert.ok(live.includes("Last 7 days"), "finished runs table");
});
