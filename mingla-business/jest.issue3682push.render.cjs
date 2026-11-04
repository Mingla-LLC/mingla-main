// #3682 wave 2 — push campaign channel + multi-channel composer render proof.
//
// Run:
//   npx jest --config jest.issue3682push.render.cjs --runInBand

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
    "**/__tests__/issue_3682_push_campaign.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|expo|@expo)",
  ],
};
