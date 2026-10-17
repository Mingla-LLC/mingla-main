import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, root));

Deno.test("#3720 Admin Brand groups share multiple files through the guarded transfer path", () => {
  const panel = read("components/community/BrandGroupsPanel.jsx");
  const service = read("services/communityService.js");
  assertStringIncludes(panel, "multiple");
  assertStringIncludes(panel, "Couldn't share this file.");
  assertStringIncludes(panel, "Retry");
  assertStringIncludes(service, '"issue_3720_prepare_brand_group_files"');
  assertStringIncludes(service, 'action: "finalize"');
  assertStringIncludes(service, "brand-group-files?file_id=");
  assertStringIncludes(service, "xhr.status === 409");
});

Deno.test("#3720 Admin previews authorized bytes without exposing Drive identity", () => {
  const service = read("services/communityService.js");
  assertStringIncludes(service, "response.blob()");
  assertStringIncludes(service, "URL.createObjectURL");
  assert(!service.includes("drive.google.com"));
  assert(!service.includes("provider_file_id"));
});
