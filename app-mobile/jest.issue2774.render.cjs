const path = require("path");
const businessRoot = path.resolve(__dirname, "../mingla-business");
const businessModules = path.join(businessRoot, "node_modules");
const base = require(path.join(businessRoot, "jest.issue1561.web.render.cjs"));

module.exports = {
  ...base,
  rootDir: __dirname,
  modulePaths: [businessModules],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    "^react$": path.join(businessModules, "react"),
    "^react/(.*)$": path.join(businessModules, "react", "$1"),
    "^react-native$": path.join(businessModules, "react-native-web"),
    "^react-test-renderer$": path.join(businessModules, "react-test-renderer"),
    "^react-test-renderer/(.*)$": path.join(
      businessModules,
      "react-test-renderer",
      "$1",
    ),
    "^react-i18next$": path.resolve(
      __dirname,
      "src/test/reactI18next.render.mock.cjs",
    ),
    "^@mingla/offering-rendering/(.*)$": path.resolve(
      __dirname,
      "../packages/offering-rendering/$1",
    ),
  },
  testMatch: [
    "**/__tests__/publicHeroAccessibility.issue2774.happy.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2774.adversarial.test.tsx",
    "**/__tests__/publicHeroAccessibility.issue2788.singleReactOwner.test.cjs",
    // issue #3321 — mounts the consumer experience detail through the #2774
    // hero-label path that crashed every open; runs in this same CI step.
    "**/__tests__/issue_3321_experience_detail_opens.render.test.tsx",
    // issue #3321 — no undeclared name / missing property in the three consumer
    // detail screens (a scoped type check; app-mobile has no typecheck gate).
    "**/__tests__/consumerDetailScreens.issue3321.namesExist.test.cjs",
    // issue #3682 — mounts the consumer brand page and presses its X: with no
    // history (app opened by a brand link) it must land on the Explorer home.
    "**/__tests__/issue_3682_brand_close_fallback.render.test.tsx",
    // issue #3682 (tester) — mounts both brand link routes against a history
    // model: X ends on Home with nothing underneath, never a dead back().
    "**/__tests__/issue_3682_brand_close_fallback.tester_adversarial.render.test.tsx",
    // issue #3859 — mounts the real Explorer brand host and invokes its public
    // navigation callbacks through the shared parity-contract adapter.
    "**/__tests__/issue_3859_explorer_public_parity.implementor.happy.test.tsx",
    // issue #3859 — Explorer stays signed-in-only during auth expiry and
    // recovers the account recap without losing the buyer's cart lines.
    "**/__tests__/issue_3859_expired_session_guard.implementor.happy.render.test.tsx",
    "**/__tests__/issue_3859_expired_session_guard.tester.adversarial.render.test.tsx",
    // issue #3859 — native checkout request, recovery, and terminal truth.
    "**/__tests__/issue_3859_checkout_v2_client.implementor.happy.test.ts",
    "**/__tests__/issue_3859_native_checkout_recovery.implementor.happy.test.ts",
    "**/__tests__/issue_3859_native_checkout_recovery.tester_adversarial.test.ts",
    "**/__tests__/issue_3859_native_checkout_terminal_flow.implementor.happy.test.ts",
    "**/__tests__/issue_3859_native_terminal_wiring.implementor.happy.test.ts",
    "**/__tests__/issue_3859_paystack_recovery_terminal_truth.implementor.happy.test.ts",
    // issue #3859 — public installment capability runs in this Node 20 lane
    // through Jest's existing TypeScript transform; the other pure Node guards
    // are spawned below without depending on app-mobile/node_modules.
    "**/__tests__/issue_3859_public_installment_capability.implementor.happy.test.ts",
    "**/__tests__/issue_3859_node_guards_ci.render.test.ts",
    // issue #2107 — mounts the Explorer welcome video, runs a restart whose
    // reloadAsync fails, and proves the released player is never touched again.
    "**/__tests__/issue_2107_welcome_video_released_on_restart.render.test.tsx",
    // issue #3682 — the consumer app updates the public aggregate immediately
    // on follow and restores the server count if the write fails.
    "**/__tests__/issue_3682_follower_count_optimistic.render.test.tsx",
    // issue #4111 Wave D — Explorer "Message {Brand}": enquiry rows, send args,
    // calendar prefills, push route, claim after email sign-in; the sheet
    // wiring from every entry point and the signed-out sign-in step; the
    // enquiry thread (composer, Report, resolved banner).
    "**/__tests__/issue_4111_explorer_enquiry_model.implementor.happy.test.ts",
    "**/__tests__/issue_4111_explorer_message_entry_points.implementor.happy.render.test.tsx",
    "**/__tests__/issue_4111_explorer_enquiry_thread.implementor.happy.render.test.tsx",
    // issue #4111 — tester adversarial: enquiry rows and read status under
    // hostile data (other people's receipts, system rows, cross-thread pages).
    "**/__tests__/issue_4111_explorer_enquiry_rows.tester.adversarial.test.ts",
  ],
};
