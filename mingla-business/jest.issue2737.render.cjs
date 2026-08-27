const base = require("./jest.issue1403.render.cjs");

module.exports = {
  ...base,
  testMatch: [
    "**/__tests__/reservationCalendar.issue2737.happy.render.test.tsx",
    "**/__tests__/reservationCalendarModel.issue2737.tester.adversarial.test.ts",
  ],
};
