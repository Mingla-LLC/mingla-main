const base = require("../../../mingla-business/jest.issue679.cfg.cjs");

// issue #4420 wave 2 — the public brand / venue / stay behaviour suites.
module.exports = {
  ...base,
  testMatch: ["**/__tests__/issue_4420_public_wave2.*.render.test.tsx"],
};
