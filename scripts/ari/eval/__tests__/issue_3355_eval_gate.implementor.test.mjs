// Issue #3355 Wave F (F1) — the live-eval release gate as a command: exit 1
// on a drop of 2+ points (any suite or overall) against the stored
// baseline, exit 0 otherwise. Files only, no network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GATE = join(here, "../gate.mjs");
const BASELINE = join(here, "../../../../docs/contracts/ari-live-eval-baseline.json");

function gate(baseline, run) {
  const dir = mkdtempSync(join(tmpdir(), "ari-gate-"));
  const b = join(dir, "baseline.json");
  const r = join(dir, "run.json");
  writeFileSync(b, JSON.stringify(baseline));
  writeFileSync(r, JSON.stringify(run));
  return spawnSync(process.execPath, [GATE, `--baseline=${b}`, `--run=${r}`], { encoding: "utf8" });
}

describe("#3355 Wave F — Ari eval gate", () => {
  const baseline = { run_id: "base", scores: { replay: 100, flows: 84.6, route_table: 100, overall: 94.9 } };

  it("passes an equal or slightly lower run", () => {
    const same = gate(baseline, { run_id: "same", scores: { ...baseline.scores } });
    assert.equal(same.status, 0, same.stdout);
    assert.match(same.stdout, /PASS/);
    const small = gate(baseline, { run_id: "small", scores: { ...baseline.scores, flows: 83, overall: 93.4 } });
    assert.equal(small.status, 0, small.stdout);
  });

  it("fails a drop of 2 or more points, and a missing suite", () => {
    const drop = gate(baseline, { run_id: "drop", scores: { ...baseline.scores, route_table: 96, overall: 93.5 } });
    assert.equal(drop.status, 1);
    assert.match(drop.stdout, /FAIL route_table: dropped 4 points/);
    const missing = gate(baseline, { run_id: "missing", scores: { replay: 100, flows: 90, overall: 95 } });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /FAIL route_table: missing from the run/);
  });

  it("needs --run", () => {
    const none = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
    assert.equal(none.status, 2);
  });

  it("the stored baseline has every suite the gate compares", () => {
    const stored = JSON.parse(readFileSync(BASELINE, "utf8"));
    for (const suite of ["replay", "flows", "route_table", "overall"]) {
      assert.equal(typeof stored.scores[suite], "number", suite);
    }
    // #3355 rework 3b: answers and claim_check are documented baseline
    // sections, gated like the core suites.
    for (const suite of ["answers", "claim_check"]) {
      assert.equal(typeof stored.scores[suite], "number", suite);
    }
    assert.ok(stored.answers.some((item) => item.id === "answer_read_code_end_local_time"));
    assert.ok(stored.answers.every((item) => item.facts_total > 0));
    assert.ok(stored.claim_check.total > 0);
    assert.match(stored.description, /answers .*claim_check/s);
    const self = gate(stored, { run_id: "self", scores: stored.scores });
    assert.equal(self.status, 0, self.stdout);
  });
});

describe("#3355 Wave F — promoting a reviewed run", () => {
  it("--promote writes the run's scores as the baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "ari-gate-"));
    const b = join(dir, "baseline.json");
    const r = join(dir, "run.json");
    writeFileSync(r, JSON.stringify({ run_id: "r1", scores: { replay: 99, overall: 99 }, suites: {} }));
    const out = spawnSync(process.execPath, [GATE, `--baseline=${b}`, `--run=${r}`, "--promote"], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const written = JSON.parse(readFileSync(b, "utf8"));
    assert.equal(written.run_id, "r1");
    assert.deepEqual(written.scores, { replay: 99, overall: 99 });
  });

  // #3355 rework 5 (R5-19): a local-model run is labelled as local and never
  // becomes, or is compared with, the Gemini baseline.
  it("refuses a local-model run in the gate and in --promote", () => {
    const baseline = { run_id: "base", scores: { replay: 100, flows: 84.6, route_table: 100, overall: 94.9 } };
    const local = { run_id: "local", model: "local (qwen3:4b-instruct, Ollama)", model_local: true, scores: { ...baseline.scores } };
    const gated = gate(baseline, local);
    assert.equal(gated.status, 2, gated.stdout);
    assert.match(gated.stderr, /local model/);
    const dir = mkdtempSync(join(tmpdir(), "ari-gate-"));
    const b = join(dir, "baseline.json");
    const r = join(dir, "run.json");
    writeFileSync(b, JSON.stringify(baseline));
    writeFileSync(r, JSON.stringify(local));
    const promoted = spawnSync(process.execPath, [GATE, `--baseline=${b}`, `--run=${r}`, "--promote"], { encoding: "utf8" });
    assert.equal(promoted.status, 2, promoted.stdout);
    assert.deepEqual(JSON.parse(readFileSync(b, "utf8")), baseline);
  });

  it("run-live labels the model it used and refuses --write-baseline on the local model", async () => {
    const { evalModel, assertBaselineWritable } = await import("../run-live.mjs");
    const local = evalModel({}, { ARI_LOCAL_MODEL_ENABLED: "true", ARI_LOCAL_MODEL_ID: "qwen3:4b-instruct" });
    assert.equal(local.local, true);
    assert.equal(local.label, "local (qwen3:4b-instruct, Ollama)");
    assert.throws(() => assertBaselineWritable(local), /refused/);
    const fromProcess = evalModel({ ARI_LOCAL_MODEL_ENABLED: "true" }, {});
    assert.equal(fromProcess.local, true);
    const gemini = evalModel({}, { GEMINI_API_KEY_ARI: "placeholder" });
    assert.equal(gemini.local, false);
    assert.match(gemini.label, /^gemini/);
    assert.doesNotThrow(() => assertBaselineWritable(gemini));
  });
});
