const base = require("./jest.issue1403.render.cjs");

module.exports = {
  ...base,
  modulePaths: [require("path").join(__dirname, "node_modules")],
  testMatch: [
    "**/__tests__/PublicVenueTabs.issue2738.keyboard.happy.render.test.tsx",
    "**/__tests__/PublicVenueTabs.issue2738.keyboard.adversarial.render.test.tsx",
  ],
};
