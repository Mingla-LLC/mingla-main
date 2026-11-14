// Issue #4423 rework 1 (tester P2-1 and P3-1).
//
// P2-1: Messages and the draft counts went stale silently: the hooks set
// `stale` but nothing showed it. Now a failed or held-back read keeps what is
// on screen, marks it stale, and MessagesBody / RoleHomePage show "may be out
// of date" with Try again (the Work board's pattern).
// P3-1: during the request ceiling pause a person's Try again replaced the
// whole board with "Couldn't load the board". Now a read refused under the
// pause keeps the last data (stale + paused, the pause words shown) and reads
// again once just after the pause ends.
//
// FAILS-ON-REVERT: drop `paused` from the keep-data branch of
// stateAfterFailure (lib/pollGate.js) and test 1b goes red; make
// messagesAfterRefresh keep `stale: false` on a rejected inbox and test 3
// goes red; delete the MessagesBody or RoleHomePage notice and test 5 goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequestCeiling } from "../lib/requestCeiling.js";
import { ceilingPaused, stateAfterFailure, whenCeilingLifts } from "../lib/pollGate.js";
import { messagesAfterRefresh } from "../lib/messagesModel.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const BOARD = { cards: [{ id: "a" }] };
const ERR = new Error("server said no");

describe("#4423 P3-1: what a failed read leaves on screen", () => {
  it("1a a background failure keeps the data, stale, and shows no error", () => {
    const prev = { key: "k", data: BOARD, error: null, loaded: true };
    const next = stateAfterFailure(prev, { key: "k", error: ERR, quiet: true, paused: false });
    assert.equal(next.data, BOARD);
    assert.equal(next.error, null);
    assert.equal(next.stale, true);
    assert.equal(next.paused, false);
  });
  it("1b a person's Try again refused by the ceiling pause keeps the board (no error), stale and paused", () => {
    const prev = { key: "k", data: BOARD, error: null, loaded: true };
    const next = stateAfterFailure(prev, { key: "k", error: new Error("request_ceiling"), quiet: false, paused: true });
    assert.equal(next.data, BOARD);
    assert.equal(next.error, null, "the board is never replaced by an error during the pause");
    assert.equal(next.stale, true);
    assert.equal(next.paused, true);
  });
  it("1c a person's retry the server refused (no pause) shows the error, data kept beside it", () => {
    const prev = { key: "k", data: BOARD, error: null, loaded: true };
    const next = stateAfterFailure(prev, { key: "k", error: ERR, quiet: false, paused: false });
    assert.equal(next.error, ERR);
    assert.equal(next.data, BOARD);
  });
  it("1d nothing on screen yet: the error shows; another key's data is never kept", () => {
    assert.equal(stateAfterFailure({ key: "k", data: null }, { key: "k", error: ERR, quiet: true, paused: true }).error, ERR);
    const other = stateAfterFailure({ key: "old", data: BOARD }, { key: "k", error: ERR, quiet: true });
    assert.equal(other.data, null);
    assert.equal(other.error, ERR);
  });
});

describe("#4423 P3-1: the read again when the pause ends", () => {
  it("2 ceilingPaused follows the real ceiling; whenCeilingLifts fires just after resumeInMs", async () => {
    let t = 0;
    const ceiling = createRequestCeiling({ fetchImpl: async () => ({ status: 200 }), now: () => t, ceiling: 2, windowMs: 60_000, pauseMs: 60_000 });
    await ceiling.governedFetch("http://x/rest/v1/rpc/a");
    await ceiling.governedFetch("http://x/rest/v1/rpc/a");
    await assert.rejects(ceiling.governedFetch("http://x/rest/v1/rpc/a"), /request_ceiling/);
    assert.equal(ceilingPaused(ceiling), true);
    t = 20_000;
    const timers = [];
    let ran = 0;
    const cancel = whenCeilingLifts(() => { ran += 1; }, { ceiling, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 40_050, "40 s left in the pause, plus 50 ms");
    timers[0].fn();
    assert.equal(ran, 1);
    assert.equal(typeof cancel, "function");
    t = 61_000;
    assert.equal(ceilingPaused(ceiling), false);
  });
});

describe("#4423 P2-1: Messages keeps its numbers on a failed read and says they are stale", () => {
  const prev = { owner: "u", badge: { chats: 2 }, inbox: { mentions: [1] }, loading: false, stale: false, paused: false };
  it("3 a rejected inbox keeps the old inbox and sets stale (paused under the pause)", () => {
    const next = messagesAfterRefresh(prev, { owner: "u", badge: { status: "fulfilled", value: { chats: 3 } }, inbox: { status: "rejected", reason: ERR }, paused: true });
    assert.deepEqual(next.inbox, prev.inbox);
    assert.equal(next.inboxError, ERR);
    assert.deepEqual(next.badge, { chats: 3 });
    assert.equal(next.stale, true);
    assert.equal(next.paused, true);
  });
  it("3b a good read clears stale; a badge-only read leaves an old inbox stale", () => {
    const stale = { ...prev, stale: true, paused: true };
    const ok = messagesAfterRefresh(stale, { owner: "u", badge: { status: "fulfilled", value: { chats: 1 } }, inbox: { status: "fulfilled", value: { mentions: [] } } });
    assert.equal(ok.stale, false);
    assert.equal(ok.paused, false);
    const badgeOnly = messagesAfterRefresh(stale, { owner: "u", badge: { status: "fulfilled", value: { chats: 1 } }, inbox: null });
    assert.equal(badgeOnly.stale, true);
  });
  it("3c the first read failing (nothing on screen) is an error, not stale", () => {
    const first = messagesAfterRefresh({ owner: "u", badge: null, inbox: null }, { owner: "u", badge: { status: "rejected", reason: ERR }, inbox: { status: "rejected", reason: ERR } });
    assert.equal(first.stale, false);
    assert.equal(first.inboxError, ERR);
  });
});

describe("#4423 P2-1 / P3-1: the hooks use the shared rules and the screens show them", () => {
  it("4 useOpsPoll, useDraftCounts and useMessages keep data on failure and read again after the pause", () => {
    const ops = read("hooks/useOpsWork.js");
    assert.match(ops, /setState\(\(prev\) => stateAfterFailure\(prev, \{ key, error, quiet, paused \}\)\);/);
    assert.match(ops, /whenCeilingLifts\(/);
    assert.match(ops, /paused: current \? !!state\.paused : false,/);
    const drafts = read("hooks/useDraftCounts.js");
    assert.match(drafts, /stateAfterFailure\(prev, \{ key, error, quiet, paused \}\)/);
    assert.match(drafts, /whenCeilingLifts\(/);
    assert.equal(/setState\(\{ key, data: null, error, loaded: true \}\)/.test(drafts), false, "a failed Try again never blanks the counts");
    const msgs = read("hooks/useMessages.js");
    assert.match(msgs, /emit\(messagesAfterRefresh\(state, \{/);
    assert.match(msgs, /whenCeilingLifts\(/);
    assert.match(msgs, /paused: !!current\.paused,/);
  });
  it("5 Messages (panel and page), Home's draft counts and the board show the notice with Try again", () => {
    const body = read("components/messages/MessagesBody.jsx");
    assert.match(body, /\{messages\.stale && \(\s*<div data-messages-stale=""[\s\S]*?title="Messages may be out of date"[\s\S]*?onClick=\{\(\) => messages\.refetch\(\)\}>Try again<\/Button>[\s\S]*?\{messages\.paused \? STALE_PAUSED_WORDS : null\}/);
    const home = read("pages/RoleHomePage.jsx");
    assert.match(home, /\{!error && draftCounts\.stale && \(\s*<AlertCard variant="warning" title="Draft counts may be out of date"[\s\S]*?onClick=\{\(\) => draftCounts\.refetch\(\)\}>Try again<\/Button>[\s\S]*?\{draftCounts\.paused \? STALE_PAUSED_WORDS : null\}/);
    const board = read("pages/WorkBoardPage.jsx");
    assert.match(board, /\{list\.stale && <AlertCard variant="warning" title="The board may be out of date"[^\n]*>\{list\.paused \? STALE_PAUSED_WORDS : null\}<\/AlertCard>\}/);
    // MessagesBody is the one body of both the panel and the full page.
    assert.match(read("components/messages/MessagesButton.jsx"), /<MessagesBody /);
    assert.match(read("pages/MessagesPage.jsx"), /<MessagesBody messages=\{messages\}/);
  });
});
