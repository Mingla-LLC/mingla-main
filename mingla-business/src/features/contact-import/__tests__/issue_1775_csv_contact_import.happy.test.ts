import fs from "node:fs";
import path from "node:path";
const root = path.resolve(__dirname, "../../../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
describe("#1775 happy contract", () => {
  it("keeps one shared three-runtime flow and honest suppression copy", () => {
    const flow = read(
      "mingla-business/src/features/contact-import/ContactImportFlow.tsx",
    );
    const grid = read(
      "mingla-business/src/features/contact-import/ContactImportOutcomeGrid.tsx",
    );
    expect(flow).toContain("pickContactImportFile");
    expect(flow).toContain("Confirm and import");
    expect(grid).toContain("These six outcomes add up to all");
    expect(grid).toContain("still in Your Book");
    expect(grid).toContain("Overlaps the outcomes above");
  });
  it("calls only the Edge authority", () => {
    const service = read(
      "mingla-business/src/services/contactImportService.ts",
    );
    expect(service).toContain('functions.invoke("contact-import"');
    expect(service).not.toMatch(/\.from\(|\.rpc\(/);
  });
  it("locks exact attestation bytes", () => {
    const client = read(
      "mingla-business/src/constants/contactImportAttestation.ts",
    );
    const server = read("supabase/functions/_shared/contactImportContract.ts");
    const template = /"I confirm the people[\s\S]*?tied to this import\."/;
    expect(client.match(template)?.[0]).toBe(server.match(template)?.[0]);
  });
});
