const path = require("path");
const businessRoot = path.resolve(__dirname, "../mingla-business");
const businessModules = path.join(businessRoot, "node_modules");
const base = require(path.join(businessRoot, "jest.issue1561.web.render.cjs"));

module.exports = {
  ...base,
  rootDir: __dirname,
  modulePaths: [businessModules],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    "^react$": path.join(businessModules, "react"),
    "^react/(.*)$": path.join(businessModules, "react", "$1"),
    "^react-native$": path.join(businessModules, "react-native-web"),
    "^react-test-renderer$": path.join(businessModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      businessModules,
      "react-test-renderer",
      "$1",
    ),
  },
  testMatch: [
    "**/__tests__/publicHeroAccessibility.issue2774.happy.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2774.adversarial.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2788.singleReactOwner.test.cjs",
    // issue #3321 — mounts the consumer experience detail through the #2774
    // hero-label path that crashed every open; runs in this same CI step.
    "**/__tests__/issue_3321_experience_detail_opens.render.test.tsx",
    // issue #3321 — no undeclared name / missing property in the three consumer
    // detail screens (a scoped type check; app-mobile has no typecheck gate).
    "**/__tests__/consumerDetailScreens.issue3321.namesExist.test.cjs",
    // issue #3682 — mounts the consumer brand page and presses its X: with no
    // history (app opened by a brand link) it must land on the Explorer home.
    "**/__tests__/issue_3682_brand_close_fallback.render.test.tsx",
    // issue #3682 (tester) — mounts both brand link routes against a history
    // model: X ends on Home with nothing underneath, never a dead back().
    "**/__tests__/issue_3682_brand_close_fallback.tester_adversarial.render.test.tsx",
  ],
};
