/**
 * Issue #3801 — a Jest environment that can really change the process
 * timezone from inside a test.
 *
 * Inside a test file `process.env` is Jest's sandbox COPY, so assigning
 * `process.env.TZ` there changes nothing: `Date` keeps the machine's zone and a
 * "runs in New York" test silently runs in whatever zone the machine is in
 * (UTC on CI). This file runs OUTSIDE the sandbox, where `process` is the real
 * one and Node re-reads the zone on assignment.
 *
 * It exposes `globalThis.__setProcessTimeZone(zone)` to the test and puts the
 * original zone back when the file finishes, so other suites in the same
 * worker are unaffected. Opt in per file with a docblock:
 *
 *   @jest-environment ./jest.issue3801.timezone-env.cjs
 */

const { TestEnvironment: NodeEnvironment } = require("jest-environment-node");

class TimeZoneEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    this.originalTimeZone = process.env.TZ;
  }

  async setup() {
    await super.setup();
    this.global.__setProcessTimeZone = (zone) => {
      process.env.TZ = zone;
    };
  }

  async teardown() {
    if (this.originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = this.originalTimeZone;
    await super.teardown();
  }
}

module.exports = TimeZoneEnvironment;
