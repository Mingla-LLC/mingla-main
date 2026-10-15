import { spawnSync } from "node:child_process";
import path from "node:path";

const appRoot = path.resolve(__dirname, "../../..");
const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnvironment } = process.env;

const nodeGuards = [
  "src/components/expandedCard/__tests__/issue_3859_private_intake_claim.implementor.happy.test.mjs",
  "src/payments/__tests__/issue_3859_explorer_checkout_contact.implementor.happy.test.mjs",
  "src/payments/__tests__/issue_3859_explorer_checkout_contact_hydration.implementor.happy.test.mjs",
  "src/payments/__tests__/issue_3859_explorer_checkout_contact_wiring.implementor.happy.test.mjs",
  "src/payments/__tests__/issue_3859_explorer_purchase_consent.implementor.happy.test.mjs",
] as const;

const runNodeGuard = (relativePath: string): void => {
  const result = spawnSync(
    process.execPath,
    ["--test", relativePath],
    {
      cwd: appRoot,
      encoding: "utf8",
      env: childEnvironment,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `${relativePath} exited with ${String(result.status)}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
};

describe("issue #3859 — required Node guards execute in app CI", () => {
  test.each(nodeGuards)("executes %s", (relativePath) => {
    runNodeGuard(relativePath);
  });
});
