// #966 [TEST-MOD-APPROVED ORCH-0966] — recoverJobIdFromPayload was removed with
// the Cloudinary webhook arm (dead residue post-META-1270). The former
// public_id-last-segment fallback test is retired; this assert-absence proves the
// export is gone so it cannot be reintroduced silently. (The live Bunny webhook
// keys the job on source_asset_id = VideoGuid, not on any public_id.)
const assertEquals = <T>(actual: T, expected: T, message: string): void => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

Deno.test("#966 recoverJobIdFromPayload is removed — webhook is Bunny-only (no Cloudinary public_id recovery)", async () => {
  const mod = await import("../index.ts") as Record<string, unknown>;
  assertEquals(
    typeof mod.recoverJobIdFromPayload,
    "undefined",
    "recoverJobIdFromPayload must not exist post-#966 (the Cloudinary webhook arm was removed)",
  );
});
