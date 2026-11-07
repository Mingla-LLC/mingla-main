// Issue #4270 (Wave 2 rework) — implementor regression tests for the tester's
// Wave 2 findings, in Admin.
//
//   R-1  (P1-1) a trip or experience on right now is "Live now" only: its row
//        has no plain-state pill (that would say Happened) and it is left out
//        of Past events
//   R-2  (P3-1) the host card read sends the viewer's time zone, so "done
//        this week" starts on Monday 00:00 there, like the Work board
//   R-3  (P3-2) "Back to the chat" goes back when this page opened the host
//        card (never a replace), so the browser's Back is never a dead press
//   R-4  (P3-5) the work card shows "Host can see this" on a host's card and
//        switches it with ops_work_update (Undo comes with it)
//
// Run: node --test src/__tests__/issue4270_w2_rework.implementor.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostPastRows, hostUpcomingRows, showsHostSees } from "../lib/opsModel.js";
import { hostCloseStep } from "../lib/panelStack.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

const TODAY = "2026-11-04";
const live = { id: "t1", title: "Long Trip", start_on: "2026-09-25", live: true, event_type: "trip", state: { k: "done", name: "Happened" } };
const soon = { id: "e1", title: "Supper", start_on: "2026-11-20", live: false, event_type: "event", state: { k: "ready", name: "Ready to promote" } };

describe("R-1 Live now is the only word for what is on now", () => {
  it("a live row carries no plain state; a coming row keeps its state", () => {
    const rows = hostUpcomingRows([live, soon], [], TODAY);
    const trip = rows.find((r) => r.id === "t1");
    assert.equal(trip.live, true);
    assert.equal(trip.state, null);
    assert.equal(rows.find((r) => r.id === "e1").state.k, "ready");
  });
  it("Past events leave out what is live", () => {
    const past = [{ id: "t1", title: "Long Trip" }, { id: "p1", title: "Old Party" }];
    assert.deepEqual(hostPastRows(past, [live, soon]).map((p) => p.id), ["p1"]);
    assert.deepEqual(hostPastRows(null, null), []);
  });
  it("On Mingla renders the state pill only when there is a state, and its past list through hostPastRows", () => {
    const src = code("components/crm/OnMinglaSection.jsx");
    assert.match(src, /\{u\.state && <StatePill state=\{u\.state\} \/>\}/);
    assert.match(src, /const past = hostPastRows\(data\?\.past, data\?\.events\);/);
  });
});

describe("R-2 done this week in the viewer's zone", () => {
  it("the service sends p_tz and the hook passes the browser's zone", () => {
    assert.match(code("services/opsService.js"), /rpc\("ops_host_on_mingla", \{ p_record_id: recordId, p_today: today \|\| null, p_tz: tz \|\| null \}\)/);
    assert.match(code("hooks/useHostOnMingla.js"), /fetchHostOnMingla\(recordId, todayIso\(\), browserTimeZone\(\)\)/);
  });
});

describe("R-3 Back to the chat keeps browser Back working", () => {
  it("goes back when this page opened the host card, else pushes", () => {
    assert.equal(hostCloseStep(true), "back");
    assert.equal(hostCloseStep(false), "push");
  });
  // #4270 W7: the host card is one item of the Brand group side panel now;
  // closePanel keeps this rule (sideCloseStep: go back what this page pushed,
  // else push, never replace).
  it("closing the side panel never replaces the address", () => {
    const src = code("components/community/BrandGroupsPanel.jsx");
    const close = src.slice(src.indexOf("const closePanel = useCallback"), src.indexOf("const onPop = () =>"));
    assert.ok(close.length > 40, "closePanel is there");
    assert.doesNotMatch(close, /replace:\s*true/);
    assert.match(close, /const step = sideCloseStep\(pushesHere\.current\);/);
    assert.match(close, /if \(step\.kind === "go"\) window\.history\.go\(step\.delta\);/);
    assert.match(close, /else setSearch\(brandGroupSearch\(search, \{ side: null \}\)\);/);
  });
});

describe("R-4 Host can see this on the work card", () => {
  it("shows on a card linked to a host, or one the host already sees", () => {
    assert.equal(showsHostSees({ links: [{ kind: "host", id: "r1" }] }), true);
    assert.equal(showsHostSees({ on_brand_plan: true, links: [] }), true);
    assert.equal(showsHostSees({ links: [{ kind: "event", id: "e1" }] }), false);
    assert.equal(showsHostSees(null), false);
  });
  it("the toggle saves on_brand_plan through update (which offers Undo)", () => {
    const src = code("components/ops/WorkDetail.jsx");
    assert.match(src, /showsHostSees\(card\) && \(\s*<HostSeesToggle/);
    assert.match(src, /onChange=\{\(on\) => update\(\{ on_brand_plan: on \}/);
    assert.match(src, /data-host-sees-toggle=""/);
  });
});
