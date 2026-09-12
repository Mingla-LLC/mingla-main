/**
 * #1983 — client account-deletion confirm requires legal name + DELETE.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(
  path.join(ROOT, "src/components/ari/ToolProposalCard.tsx"),
  "utf8",
);

describe("#1983 ToolProposalCard account deletion confirm", () => {
  it("keeps request_account_deletion in MONEY_CONFIRM_TOOLS as DELETE", () => {
    expect(source).toMatch(/request_account_deletion:\s*"DELETE"/);
  });

  it("collects legal_name and confirm_phrase DELETE on confirm", () => {
    expect(source).toContain('toolName === "request_account_deletion"');
    expect(source).toContain("legalNameInput");
    expect(source).toMatch(/legal_name:\s*legalNameInput\.trim\(\)/);
    expect(source).toMatch(/confirm_phrase:\s*"DELETE"/);
    expect(source).toContain("Type your legal name and DELETE to confirm");
  });

  it("gates the delete button on legal name + DELETE", () => {
    expect(source).toContain("canAccountDeletion");
    expect(source).toMatch(
      /legalNameInput\.trim\(\)\.length > 0[\s\S]*typedName\.trim\(\)\.toUpperCase\(\) === "DELETE"/,
    );
  });
});
