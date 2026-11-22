const base = require("./jest.issue1403.render.cjs");

module.exports = {
  ...base,
  modulePaths: [require("path").join(__dirname, "node_modules")],
  testMatch: [
    "**/__tests__/PublicVenueTabs.issue2738.keyboard.happy.render.test.tsx",
    "**/__tests__/PublicVenueTabs.issue2738.keyboard.adversarial.render.test.tsx",
    // #4490 W3 fix 6 (W3-N41): the Menu pane (the order basket) survives a tab switch.
    "**/__tests__/PublicVenueTabs.issue4490.menuKept.render.test.tsx",
  ],
};
