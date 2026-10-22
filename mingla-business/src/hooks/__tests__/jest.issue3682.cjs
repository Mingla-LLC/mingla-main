const path = require("path");
const base = require("../../../jest.config.cjs");

module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, "../../.."),
  testMatch: [
    "**/src/components/brand/__tests__/issue_3682_followers_kpi.test.tsx",
    "**/src/components/home/__tests__/issue_3682_followers_home_tile.test.tsx",
    "**/src/components/checkout/__tests__/issue_3682_youre_in_count.test.tsx",
    "**/src/components/people/__tests__/issue_3682_people_follower_count.test.tsx",
    "**/src/hooks/__tests__/issue_3682_follower_count_optimistic.test.tsx",
    "**/src/services/__tests__/issue_3682_follower_summary_parser.test.ts",
  ],
};
