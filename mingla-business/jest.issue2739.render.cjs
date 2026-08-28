const base = require("./jest.issue1561.web.render.cjs");

module.exports = {
  ...base,
  testMatch: [
    "**/__tests__/CoverGalleryRow.issue2739.web.happy.render.test.tsx",
    "**/__tests__/CoverGalleryRow.issue2739.web.adversarial.render.test.tsx",
  ],
};
