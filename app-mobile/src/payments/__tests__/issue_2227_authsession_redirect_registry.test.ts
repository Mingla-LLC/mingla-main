/**
 * issue #2227 — SPEC §7 T-2, SPEC §9 structural safeguard.
 *
 * Runs the strict-grep registry `scripts/ci/check-native-authsession-redirects.sh`
 * as part of the jest suite so the gate has teeth wherever these tests run, not
 * only wherever someone remembers to invoke a shell script.
 *
 * Fails on revert: restore `openAuthSessionAsync(data.authorizationUrl,
 * data.returnUrl)` anywhere under the scanned roots and this goes red, because
 * `data.returnUrl` cannot be statically proven to be a custom scheme — which is
 * precisely the deny-by-default rule that would have stopped #2227 shipping.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const GATE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "ci",
  "check-native-authsession-redirects.sh",
);

const runGate = (...args: string[]): string =>
  execFileSync("bash", [GATE, ...args], { encoding: "utf8" });

describe("#2227 T-2 — no native openAuthSessionAsync redirect may be https", () => {
  it("the gate proves itself: it accepts custom schemes and rejects https", () => {
    const output = runGate("--self-test");
    expect(output).toContain("SELF-TEST OK");
  });

  it("every call site under app-mobile and mingla-business passes", () => {
    const output = runGate();
    expect(output).toMatch(/^OK — \d+ openAuthSessionAsync call site\(s\)/m);
    expect(output).toContain("zero https redirects");
  });

  it("the gate actually found call sites — an empty scan is not a pass", () => {
    const output = runGate();
    const count = Number(/OK — (\d+) openAuthSessionAsync/.exec(output)?.[1]);
    expect(count).toBeGreaterThan(0);
  });
});
