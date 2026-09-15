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
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|expo|@expo)",
  ],
};
