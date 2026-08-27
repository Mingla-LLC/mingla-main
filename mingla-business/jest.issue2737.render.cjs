const base = require("./jest.issue1403.render.cjs");

module.exports = {
  ...base,
  testMatch: [
    "**/__tests__/reservationCalendar.issue2737.happy.render.test.tsx",
  ],
};
