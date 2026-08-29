const base = require("./jest.issue1561.web.render.cjs");

module.exports = {
  ...base,
  testMatch: [
    "**/__tests__/publicHeroAccessibility.issue2774.happy.render.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2774.adversarial.render.test.tsx",
  ],
};
