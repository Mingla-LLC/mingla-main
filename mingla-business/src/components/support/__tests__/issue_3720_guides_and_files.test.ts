import fs from "node:fs";
import path from "node:path";

import { parseGuideCaptions } from "../guideCaptions";

const root = path.resolve(process.cwd(), "..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

describe("#3720 Wave 3 Guides and Brand-group files", () => {
  it("keeps the in-app catalog byte-identical to the public Help Centre canon", () => {
    expect(read("packages/help-content/index.ts")).toBe(read("mingla-marketing/content/help/registry.ts"));
  });

  it("features the five approved walkthroughs in the approved order", () => {
    const source = read("mingla-business/src/components/support/GuidesTabPanel.tsx");
    const expected = [
      "getting-the-apps",
      "sign-up-and-create-a-brand",
      "connect-a-bank-and-get-paid",
      "build-your-guest-list-and-groups",
      "send-a-campaign-to-a-group",
    ];
    expect(expected.map((slug) => source.indexOf(`\"${slug}\"`))).toEqual([...expected.map((slug) => source.indexOf(`\"${slug}\"`))].sort((a, b) => a - b));
    expect(source).toContain("View more videos");
    expect(source).toContain("ESSENTIAL_GUIDES");
    expect(source).not.toContain("Search the full Mingla Host video library");
  });

  it("parses VTT captions for the in-app caption and transcript surfaces", () => {
    expect(parseGuideCaptions("WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nWelcome <b>Host</b>\n\n")).toEqual([
      { start: 1, end: 3.5, text: "Welcome Host" },
    ]);
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
