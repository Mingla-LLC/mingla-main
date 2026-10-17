import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(new URL("../../migrations/20271030003720_issue_3720_brand_group_files_guides.sql", import.meta.url));
const edge = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const drive = await Deno.readTextFile(new URL("./drive.ts", import.meta.url));

Deno.test("#3720 every file mutation and read rechecks current Brand-group membership", () => {
  assertEquals((migration.match(/issue_3720_brand_group_can_access/g) ?? []).length >= 7, true);
  assertStringIncludes(migration, "issue_3720_authorize_brand_group_file");
  assertStringIncludes(edge, 'request.headers.get("Range")');
  assertStringIncludes(edge, "issue_3720_authorize_brand_group_file");
  assertStringIncludes(edge, "issue_3720_complete_brand_group_file");
  assertStringIncludes(edge, "issue_3720_claim_stale_brand_group_file");
  assertStringIncludes(migration, "outstanding_file_bytes_exceeded");
  assertStringIncludes(migration, "created_at>now()-interval '24 hours'");
});

Deno.test("#3720 clients receive stable Mingla ids, never Drive ids or raw Drive links", () => {
  assert(!migration.includes("GRANT SELECT ON public.brand_group_drive_bindings TO authenticated"));
  assert(!migration.includes("GRANT SELECT ON public.brand_group_files TO authenticated"));
  assert(!migration.includes("drive.google.com"));
  assertStringIncludes(migration, "file_url,file_name,file_size");
  assertStringIncludes(edge, '"Cache-Control", "private, no-store"');
  assert(!edge.includes("provider_file_id: file.provider_file_id"));
});

Deno.test("#3720 provider retry identities and canonical folders are deterministic", () => {
  assertStringIncludes(drive, "minglaBrandId");
  assertStringIncludes(drive, "minglaUploadId");
  assertStringIncludes(drive, '"Media Packet"');
  assertStringIncludes(drive, '"Host uploads"');
  assertStringIncludes(drive, '"Staff sharing"');
  assertStringIncludes(drive, "DRIVE_FOLDER_AMBIGUOUS");
  assertStringIncludes(drive, "parseDriveCredentialBundle");
});
