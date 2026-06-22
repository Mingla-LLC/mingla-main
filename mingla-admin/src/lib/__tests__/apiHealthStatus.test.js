// ORCH-1201 — I-PROPOSED-1201-NO-FABRICATED-HEALTH UI unit test.
// The board NEVER renders a green/healthy dot for a service with no signal;
// `unknown`/empty → grey. `alerting` forces red.
//
// Fails-on-revert: if statusDotClass returns the green class for an
// empty/unknown service, this test FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statusDotClass, worstOfLayers } from "../apiHealthStatus.js";

const GREEN = "bg-[#22c55e]";
const AMBER = "bg-[#f59e0b]";
const RED = "bg-[#ef4444]";
const GREY = "bg-[var(--gray-400)]";

describe("ORCH-1201 — no fabricated health (status dot derivation)", () => {
  it("empty layers → grey, NEVER green", () => {
    assert.equal(statusDotClass({}, "ok"), GREY);
    assert.notEqual(statusDotClass({}, "ok"), GREEN);
  });

  it("all-unknown layers → grey, NEVER green", () => {
    const layers = { status_page: { status: "unknown" }, synthetic: { status: "unknown" } };
    assert.equal(statusDotClass(layers, "ok"), GREY);
  });

  it("worstOfLayers returns null when there is no real signal", () => {
    assert.equal(worstOfLayers({}), null);
    assert.equal(worstOfLayers({ a: { status: "unknown" } }), null);
  });

  it("healthy → green", () => {
    assert.equal(statusDotClass({ synthetic: { status: "healthy" } }, "ok"), GREEN);
  });

  it("worst-of-layers: healthy + down → red", () => {
    const layers = { status_page: { status: "healthy" }, synthetic: { status: "down" } };
    assert.equal(statusDotClass(layers, "ok"), RED);
  });

  it("degraded → amber", () => {
    assert.equal(statusDotClass({ synthetic: { status: "degraded" } }, "ok"), AMBER);
  });

  it("alert_state='alerting' forces red regardless of layers", () => {
    assert.equal(statusDotClass({ synthetic: { status: "healthy" } }, "alerting"), RED);
    assert.equal(statusDotClass({}, "alerting"), RED);
  });
});
