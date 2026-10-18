/**
 * #1982 — client team/scanner/Brand People confirm card titles + field summaries.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(
  path.join(ROOT, "src/components/ari/ToolProposalCard.tsx"),
  "utf8",
);

describe("#1982 ToolProposalCard team confirm card", () => {
  it("humanizes invite and revoke tool titles", () => {
    const titles = {
      invite_brand_member: "Invite team member",
      invite_scanner: "Invite scanner",
      revoke_brand_member: "Revoke team member",
      revoke_brand_invitation: "Revoke team invitation",
      revoke_scanner_invitation: "Revoke scanner invitation",
      manage_brand_people: "Add Brand Person",
    };
    for (const [tool, title] of Object.entries(titles)) {
      expect(source).toMatch(
        new RegExp(`case \\"${tool}\\":\\s*return \\"${title}\\"`),
      );
    }
  });

  it("summarizes email/role/scope on team confirm cards", () => {
    expect(source).toContain('toolName === "invite_brand_member"');
    expect(source).toContain('toolName === "invite_scanner"');
    expect(source).toContain('toolName === "revoke_brand_invitation"');
    expect(source).toContain('{ label: "Email", value: args.email.trim() }');
    expect(source).toContain(
      '{ label: "Role", value: args.role.replace(/_/g, " ") }',
    );
    expect(source).toContain('{ label: "Scope", value: args.scope }');
  });

  it("does not put team invites in MONEY_CONFIRM_TOOLS (standard confirm)", () => {
    expect(source).not.toMatch(/invite_brand_member:\s*"/);
    expect(source).not.toMatch(/invite_scanner:\s*"/);
    expect(source).not.toMatch(/revoke_brand_member:\s*"/);
    expect(source).not.toMatch(/revoke_brand_invitation:\s*"/);
    expect(source).not.toMatch(/revoke_scanner_invitation:\s*"/);
    // Export stays type-to-confirm under #1984 ownership.
    expect(source).toMatch(/export_brand_people:\s*"EXPORT"/);
  });
});
