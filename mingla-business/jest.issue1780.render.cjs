// #1780 [invite-during-creation] — reachable-person review and publish render proof.
//
// Run:
//   npx jest --config jest.issue1780.render.cjs --runInBand

const path = require("path");

module.exports = {
  rootDir: __dirname,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(__dirname, "jest.orch1118.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/InvitePeopleStep.issue1780.render.test.tsx",
    "**/__tests__/InvitePeopleStep.issue1780.tester_adversarial.render.test.tsx",
    "**/__tests__/InvitePeopleStep.issue3682.render.test.tsx",
    "**/__tests__/AccountInviteSummaryCard.issue3682.render.test.tsx",
    // #3682 wave 2 push composer proof: same preset, run by CI through this
    // config (#1486 — a config no workflow runs guards nothing).
    "**/__tests__/issue_3682_push_campaign.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|expo|@expo)",
  ],
};
