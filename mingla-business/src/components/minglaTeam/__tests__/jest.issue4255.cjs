const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: [
    "**/src/components/minglaTeam/__tests__/issue_4255_mingla_team.implementor.test.tsx",
    "**/src/components/minglaTeam/__tests__/issue_4255_mingla_team.tester.adversarial.test.ts",
    "**/src/i18n/__tests__/issue_3988_locale_parity.test.ts",
  ],
};
