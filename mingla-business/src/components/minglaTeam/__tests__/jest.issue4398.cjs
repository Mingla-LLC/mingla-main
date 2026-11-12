const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: [
    "**/src/components/minglaTeam/__tests__/issue_4398_work_updates.implementor.test.ts",
  ],
};
