// #2879 / #2947 — queue-health pure helpers (no fabricated green).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVerdict,
  verdictLabel,
  verdictDotClass,
  verdictBadgeVariant,
  observeFreshness,
  gaugeNumber,
  worstCrossSignal,
} from "../lib/queueHealthStatus.js";

describe("#2879 queueHealthStatus", () => {
  it("never paints green without a clean verdict that observed a queue window", () => {
    assert.match(verdictDotClass({ verdict: "clean", queueWindowsObserved: 1 }), /22c55e/);
    assert.match(verdictDotClass({ verdict: "clean", queueWindowsObserved: 0 }), /gray-400/);
    assert.match(verdictDotClass(null), /gray-400/);
    assert.match(verdictDotClass({ verdict: "unknown" }), /gray-400/);
  });

  it("maps the four known verdicts and falls back to no-signal copy", () => {
    assert.equal(normalizeVerdict("stalled"), "stalled");
    assert.equal(normalizeVerdict({ verdict: "orphaned" }), "orphaned");
    assert.equal(normalizeVerdict("nope"), null);
    assert.equal(verdictLabel("insufficient_evidence"), "Insufficient evidence");
    assert.equal(verdictLabel(null), "No signal yet");
    assert.equal(verdictBadgeVariant("orphaned"), "error");
    assert.equal(verdictBadgeVariant(null), "default");
  });

  it("marks observe freshness and cross-signal attention without inventing rates", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    assert.deepEqual(observeFreshness(null, now), { state: "none", ageMs: null });
    assert.equal(observeFreshness("2026-10-19T11:59:00Z", now).state, "fresh");
    assert.equal(observeFreshness("2026-10-19T11:50:00Z", now).state, "stale");
    assert.equal(gaugeNumber("12"), 12);
    assert.equal(gaugeNumber("x"), null);
    assert.equal(worstCrossSignal({ orphanInfinityCount: 1, paidWithoutTicketCount: 0 }), "orphaned");
    assert.equal(worstCrossSignal({ orphanInfinityCount: 0, paidWithoutTicketCount: 2 }), "attention");
    assert.equal(worstCrossSignal({}), "clear");
  });
});
