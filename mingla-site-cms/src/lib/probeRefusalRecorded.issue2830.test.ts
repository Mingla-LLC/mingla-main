/*
 * #2830 — a refused publish must record WHY.
 *
 * The probe names its failing check (#3134), but that name travels in the
 * response body and nothing here read it. A refusal left
 * `failure_code: PROBE_FAILED` in the job row and nothing else, so narrowing
 * one refusal on the Gogi pilot meant downloading the artifact from its private
 * bucket and re-running all ten checks by hand.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The comments above name these fields, so they are stripped before asserting.
const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/artifactBuilder.ts"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const probe = source.slice(source.indexOf("export async function probePublicationCandidate"));

describe("#2830 a probe refusal is recorded, not swallowed", () => {
  it("reads the probe's own failed_check out of the body", () => {
    expect(probe).toContain("failed_check");
    expect(probe).toContain("detail");
  });

  it("records the refusal before throwing", () => {
    const emit = probe.indexOf("publish.probe.refused");
    const shout = probe.indexOf('throw new Error("PROBE_FAILED")', emit);
    expect(emit).toBeGreaterThan(-1);
    expect(shout).toBeGreaterThan(emit);
  });

  it("names the digest case, which never reaches the probe's own checks", () => {
    expect(probe).toContain("observed_digest_mismatch");
  });

  it("records an unreachable probe separately from a refused one", () => {
    // A network failure and a rejection are different problems with the same
    // job row otherwise.
    expect(probe).toContain("publish.probe.unreachable");
  });

  it("measures how long the probe took", () => {
    // "every check passed" and "it never finished" look identical without this.
    expect(probe).toContain("latency_ms: latencyMs");
    expect(probe).toContain("const startedAt = Date.now()");
  });

  it("still fails closed on every path", () => {
    const throws = probe.match(/throw new Error\("PROBE_FAILED"\)/g) || [];
    expect(throws.length).toBe(2);
  });

  it("bounds what it writes, so a hostile body cannot flood the log", () => {
    expect(probe).toContain("slice(0, 300)");
  });
});
