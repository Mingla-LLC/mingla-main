import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifySafeFileMime } from "./fileSafety.ts";

Deno.test("#3720 file verifier accepts bytes that match safe declared types", async () => {
  assertEquals(await verifySafeFileMime(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])]), "application/pdf"), "application/pdf");
  assertEquals(await verifySafeFileMime(new Blob(["name,email\nA,a@example.com\n"]), "text/csv"), "text/csv");
});

Deno.test("#3720 file verifier rejects executable bytes disguised as a previewable file", async () => {
  await assertRejects(() => verifySafeFileMime(new Blob(["<script>alert(1)</script>"]), "application/pdf"), Error, "FILE_BYTES_UNSAFE");
  await assertRejects(() => verifySafeFileMime(new Blob([new Uint8Array([0, 1, 2])]), "text/plain"), Error, "FILE_BYTES_UNSAFE");
});
