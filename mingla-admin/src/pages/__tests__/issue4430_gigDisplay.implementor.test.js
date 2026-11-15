// #4430 Admin leg: the shared contract timeline shows one row per action
// (item 2), the Disputes and gig queues reload when the page comes back and
// every 60 s while visible (item 7), and "Posts due" is the deadline
// gig-timers enforces, with the agreed post-by day under it (item 4, Q2).
//
// FAILS-ON-REVERT: GigTimeline without dedupeGigEvents, useProgramLoad
// without the page-return poller, a queue page without
// PROGRAM_QUEUE_REFRESH, or "Posts due" back to the raw post-by day.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GIG_EVENT_PAIRS, dedupeGigEvents, postsDueWords, zoneWords } from "../../lib/creatorPrograms.js";
import { createPageReturn } from "../../lib/pageReturn.js";
import { createPoller } from "../../lib/pollGate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", "..", rel), "utf8");

const PAIRS = [
  ["plan_confirmed", "shoot_plan_confirmed"],
  ["send_script", "script_sent"],
  ["deliver", "delivery_submitted"],
  ["approve", "approved"],
  ["request_fix", "fix_requested"],
  ["open_dispute", "dispute_opened"],
  ["submit_posts", "posts_submitted"],
];

test("item 2: each production action/fact pair is one timeline row", () => {
  assert.deepEqual(Object.entries(GIG_EVENT_PAIRS).sort(), [...PAIRS].sort());
  for (const [action, fact] of PAIRS) {
    const events = [
      { id: "1", kind: action, actor: "host", at: "2026-12-01T10:00:00.000Z" },
      { id: "2", kind: fact, actor: "host", at: "2026-12-01T10:00:02.000Z" },
    ];
    assert.deepEqual(dedupeGigEvents(events).map((e) => e.kind), [fact], action);
    assert.equal(dedupeGigEvents([events[0], { ...events[1], actor: "creator" }]).length, 2);
    assert.equal(dedupeGigEvents([events[0], { ...events[1], at: "2026-12-01T10:00:06.000Z" }]).length, 2);
  }
  const timeline = read("pages/crm/GigTimeline.jsx");
  assert.match(timeline, /const events = dedupeGigEvents\(rawEvents\)/);
});

test("item 7: the queues reload on page return and on a 60 s timer, through the shared signal", () => {
  const hook = read("hooks/useProgramLoad.js");
  assert.match(hook, /createPoller\(\{\s*initial: false,\s*intervalMs,\s*pageReturn,/);
  assert.match(hook, /refetchOnFocus: true, intervalMs: 60_000/);
  // #4423: no listener of its own (I-ADMIN-SINGLE-PAGE-RETURN-LISTENER).
  assert.doesNotMatch(hook, /addEventListener/);
  for (const page of ["pages/ProgramDisputesPage.jsx", "pages/ProgramGigsPage.jsx"]) {
    assert.match(read(page), /useProgramLoad\(getGigQueue, PROGRAM_QUEUE_REFRESH\)/, page);
  }
});

test("item 7: becoming visible again reloads; a hidden tab does not", async () => {
  const listeners = {};
  const target = () => ({
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: (name) => { delete listeners[name]; },
  });
  const doc = { ...target(), visibilityState: "visible" };
  let clock = 1_000_000;
  const signal = createPageReturn({ win: target(), doc, nav: { onLine: true }, now: () => clock });
  let reloads = 0;
  const poller = createPoller({
    initial: false,
    intervalMs: 60_000,
    pageReturn: signal,
    isVisible: () => doc.visibilityState === "visible",
    setTimer: () => 1,
    clearTimer: () => {},
    refresh: () => { reloads += 1; return { skipped: false }; },
  });
  poller.start();
  doc.visibilityState = "hidden";
  listeners.visibilitychange?.();
  assert.equal(reloads, 0, "hidden sends nothing");
  doc.visibilityState = "visible";
  clock += 30_000;
  listeners.visibilitychange?.();
  await Promise.resolve();
  assert.equal(reloads, 1, "visible again reloads once");
  poller.stop();
});

test("item 4 / Q2: Posts due is the enforced deadline, the agreed day sits under it", () => {
  assert.equal(postsDueWords("2026-12-15", "Africa/Lagos"), "Wed 16 Dec, 11:59 PM Lagos time");
  assert.equal(postsDueWords("2026-12-31", "America/New_York"), "Fri 1 Jan, 11:59 PM New York time");
  assert.equal(postsDueWords(null, "Africa/Lagos"), "");
  // No zone slug ever reaches the page (Seth: no slugs).
  for (const zone of ["Africa/Lagos", "America/Argentina/Buenos_Aires", "Etc/UTC", "UTC"]) {
    const words = postsDueWords("2026-12-15", zone);
    assert.doesNotMatch(words, /\//, words);
    assert.doesNotMatch(zoneWords(zone), /\//);
  }
  const page = read("pages/ProgramGigsPage.jsx");
  assert.match(page, />Posts due<\/dt><dd[^>]*>\{post\.post_by \? postsDueWords\(post\.post_by, post\.timezone\)/);
  assert.match(page, />Post by \(agreed\)<\/dt>/);
  // The page imports the helper it renders with (a missing import blanks the page).
  assert.match(page, /import \{[^}]*\bpostsDueWords\b[^}]*\} from "\.\.\/lib\/creatorPrograms"/);
});
