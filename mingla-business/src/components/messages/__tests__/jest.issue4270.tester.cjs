const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: ["**/src/components/messages/__tests__/issue_4270_brand_plan.tester.adversarial.test.tsx"],
};
