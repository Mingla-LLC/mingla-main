const path = require("path");
const base = require("../../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../../.."),
  testMatch: [
    "**/src/components/door/__tests__/issue_4271_door_pay.implementor.test.ts",
    // #4271 door polish (design items 1 to 11).
    "**/src/components/door/__tests__/issue_4271_door_polish.implementor.test.ts",
    "**/src/services/__tests__/issue_4271_door_pay_code_service.implementor.test.ts",
    "**/src/utils/__tests__/issue_4271_team_member_identity.implementor.test.ts",
    "**/src/services/__tests__/doorSalesService.issue4063.test.ts",
    "**/src/native/__tests__/issue_4271_android_min_sdk.implementor.test.ts",
    "**/src/hooks/__tests__/issue_4271_door_screen_awake.implementor.test.ts",
    "**/src/utils/__tests__/issue_4271_door_sale_money.implementor.test.ts",
    "**/src/services/terminal/__tests__/issue_4271_apple_requirements.implementor.test.ts",
    "**/src/services/terminal/__tests__/issue_4271_tap_address.implementor.test.ts",
    "**/src/services/terminal/__tests__/issue_4271_tap_live_reader.implementor.test.ts",
    "**/src/hooks/__tests__/issue_4271_tap_slim_brand.implementor.test.tsx",
    "**/src/utils/__tests__/issue_4271_refund_reason_hint.implementor.test.ts",
    "**/src/services/__tests__/issue_4271_refund_failed_code.implementor.test.ts",
    // #4271 tester adversarial suites.
    "**/src/components/door/__tests__/issue_4271_door_pay_qr.tester.adversarial.test.ts",
    "**/src/hooks/__tests__/issue_4271_tap_to_pay_availability.tester.adversarial.test.ts",
  ],
};
