const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: [
    "**/src/components/door/__tests__/issue_4271_door_pay.implementor.test.ts",
    "**/src/services/__tests__/issue_4271_door_pay_code_service.implementor.test.ts",
    "**/src/utils/__tests__/issue_4271_team_member_identity.implementor.test.ts",
    "**/src/services/__tests__/doorSalesService.issue4063.test.ts",
  ],
};
