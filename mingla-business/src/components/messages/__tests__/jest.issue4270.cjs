const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: [
    "**/src/components/messages/__tests__/issue_4270_brand_plan.test.tsx",
    "**/src/i18n/__tests__/issue_3988_locale_parity.test.ts",
  ],
};
