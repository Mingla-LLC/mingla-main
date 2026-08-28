const base = require("./jest.issue1403.render.cjs");

module.exports = {
  ...base,
  testMatch: [
    "**/__tests__/reservationCalendar.issue2737.happy.render.test.tsx",
    "**/__tests__/reservationCalendarModel.issue2737.tester.adversarial.test.ts",
    "**/__tests__/reservationCalendar.issue2737.states.render.test.tsx",
    "**/__tests__/reservationCalendar.issue2737.a11y.render.test.tsx",
    "**/__tests__/reservationCalendar.issue2737.shellScroll.render.test.tsx",
    "**/__tests__/reservationCalendar.issue2737.offscreenDay.render.test.tsx",
    "**/__tests__/reservationCalendar.issue2737.detailVenueTime.render.test.tsx",
  ],
};
