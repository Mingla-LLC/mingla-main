// #1780 [invite-during-creation] — reachable-person review and publish render proof.
//
// Run:
//   npx jest --config jest.issue1780.render.cjs --runInBand

const path = require("path");

module.exports = {
  rootDir: __dirname,
  preset: "react-native",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      // #4273 polish: the campaign screen loads the composer panes through a
      // dynamic import() (keeps them out of __common); the #2323 config is the
      // shared render transform plus the import()-to-require lowering Metro does.
      { configFile: path.join(__dirname, "jest.issue2323.babel.cjs") },
    ],
  },
  testMatch: [
    "**/__tests__/InvitePeopleStep.issue1780.render.test.tsx",
    "**/__tests__/InvitePeopleStep.issue1780.tester_adversarial.render.test.tsx",
    "**/__tests__/InvitePeopleStep.issue3682.render.test.tsx",
    // #4273 wave A: combining source ticks and "How to reach them".
    "**/__tests__/InvitePeopleStep.issue4273.render.test.tsx",
    "**/__tests__/inviteSelectionModel.issue4273.test.ts",
    "**/__tests__/AccountInviteSummaryCard.issue3682.render.test.tsx",
    "**/__tests__/AccountInviteSummaryCard.issue3682.tester_adversarial.render.test.tsx",
    // #3682 wave 2 push composer proof: same preset, run by CI through this
    // config (#1486 — a config no workflow runs guards nothing).
    "**/__tests__/issue_3682_push_campaign.render.test.tsx",
    // #3682 closeout: the composer carries the subject once (email + push).
    "**/__tests__/issue_3682_subject_once.render.test.tsx",
    // #4273 wave B: the audience picker, Send by, pre-fill and the review sheet.
    "**/__tests__/issue_4273_send_by.render.test.tsx",
    "**/__tests__/issue_4273_breakpoint_keeps_state.render.test.tsx",
    "**/__tests__/blastSendModel.issue4273.test.ts",
    "**/__tests__/blastSendModel.issue4273.tester_adversarial.test.ts",
    "**/__tests__/issue_4273_hidden_skip_response.tester_adversarial.test.ts",
    "**/__tests__/blastSendModel.issue4273.rework.test.ts",
    "**/__tests__/smsCost.issue4273.test.ts",
    // #4273 polish: the campaign screen (one tab per method, as sent).
    "**/__tests__/issue_4273_sent_report.render.test.tsx",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|expo|@expo)",
  ],
};
