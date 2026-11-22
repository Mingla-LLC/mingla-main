import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

// [TEST-MOD #4420] The Guides tab, its player and captions left the Host app
// ("Browse all help videos" opens the Help Centre); their pins went with them.
// The Help Centre canon check stays.
describe("#3720 Wave 3 Guides and Brand-group files", () => {
  it("keeps the in-app catalog byte-identical to the public Help Centre canon", () => {
    expect(read("packages/help-content/index.ts")).toBe(read("mingla-marketing/content/help/registry.ts"));
  });

  it("keeps Drive provider ids and raw URLs out of both browser clients", () => {
    // [TEST-MOD-APPROVED #3988] The authorized read request moved out of the upload service.
    const host = read("mingla-business/src/services/brandGroupFileRequests.ts");
    const admin = read("mingla-admin/src/services/communityService.js");
    for (const source of [host, admin]) {
      expect(source).toContain("brand-group-files?file_id=");
      expect(source).not.toContain("drive.google.com");
      expect(source).not.toContain("provider_file_id");
    }
  });

  it("turns browser previews into revocable object URLs and treats an already-staged retry as finalizable", () => {
    const preview = read("mingla-business/src/components/messages/BrandGroupFilePreviewModal.tsx");
    const service = read("mingla-business/src/services/brandGroupFilesService.ts");
    expect(preview).toContain("URL.createObjectURL");
    expect(preview).toContain("URL.revokeObjectURL");
    expect(service).toContain("xhr.status === 409");
    expect(service).toContain("result.status !== 409");
  });
});
