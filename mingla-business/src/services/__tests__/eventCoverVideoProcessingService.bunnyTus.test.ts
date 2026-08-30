// META-ORCH-1270 (Phase 1) — implementor happy-path test for the client Bunny
// TUS upload leg (couplings C1 + C7). Source-structural (readFileSync), mirroring
// the ORCH-1209 EventCoverMedia proof: importing the service pulls react-native +
// expo-file-system (which resolve to the platform web stub under ts-jest here), so
// the transport wiring is asserted against the SOURCE. Deleting the TUS branch,
// the TUS creation headers, or the BINARY_CONTENT patch flips an assertion →
// fails-on-revert.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const businessRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(businessRoot, rel), "utf8");

const SERVICE = read("src/services/eventCoverVideoProcessingService.ts");
const NATIVE_FS = read("src/utils/platformFileSystem.native.ts");
const WEB_FS = read("src/utils/platformFileSystem.ts");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("META-ORCH-1270 — client Bunny TUS upload leg (C1 + C7)", () => {
  const service = stripComments(SERVICE);

  it("C1: the upload-intent response provider union includes bunny", () => {
    expect(service).toMatch(/provider\?:\s*"cloudinary"\s*\|\s*"bunny"/);
  });

  it("C7: uploadEventCoverVideoSource dispatches the transport on upload.protocol === \"tus\"", () => {
    expect(service).toMatch(/input\.upload\.protocol\s*===\s*"tus"/);
    expect(service).toMatch(/return\s+await\s+uploadEventCoverVideoSourceViaTus\(input\)/);
    // The descriptor carries the transport discriminator through from the edge fn.
    expect(service).toMatch(/protocol\?:\s*EventCoverVideoUploadProtocol/);
  });

  it("uses the server-issued TUS resource and recovers its offset with HEAD", () => {
    // [TEST-MOD-APPROVED #2715] Resource creation belongs to the durable edge job.
    expect(service).toMatch(/"Tus-Resumable":\s*"1\.0\.0"/);
    expect(service).toMatch(/method:\s*"HEAD"/);
    expect(service).toMatch(/headers\.get\("Upload-Offset"\)/);
    expect(service).not.toMatch(/method:\s*"POST"[\s\S]*Upload-Length/);
  });

  it("tusMetadata base64-encodes filetype and title per the TUS spec", () => {
    expect(service).toMatch(/`filetype \$\{toBase64\(filetype\)\}`/);
    expect(service).toMatch(/`title \$\{toBase64\(title\)\}`/);
    // The base64 encoder uses the standard alphabet (portable native + web).
    expect(service).toContain(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    );
  });

  it("the PATCH leg uses the raw TUS body content type + offset headers", () => {
    expect(service).toMatch(/"Content-Type":\s*"application\/offset\+octet-stream"/);
    // [TEST-MOD-APPROVED #2715] PATCH starts at server truth and uses bounded chunks.
    expect(service).toMatch(/"Upload-Offset":\s*String\(offset\)/);
    expect(service).toMatch(/EVENT_COVER_TUS_CHUNK_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
    // ORCH-1295 — the native PATCH reads bytes with the File API and streams them
    // via expo/fetch (patchBunnyTusNative) so Upload-Offset reaches Bunny. It must
    // NOT route through expo-file-system's binary upload task (dropped
    // Upload-Offset → 400) NOR fetch(uri).blob() (size-0 on iOS → empty body).
    // Native-module access is isolated in eventCoverVideoTusPatch.native.ts; web
    // keeps the XHR path. (Prior assertions here pinned the buggy BINARY_CONTENT
    // PATCH — replaced under [TEST-MOD-APPROVED ORCH-1295].)
    expect(service).toMatch(/patchTusNative/);
    expect(service).toMatch(/patchBunnyTusNative\(/);
    expect(service).toMatch(/readEventCoverVideoChunk\(/);
    expect(service).not.toMatch(/createBinaryUploadTask/);
    // Web PATCH still rides the verbatim-header XHR helper.
    expect(service).toMatch(/await patchTusWithXhr\(/);
  });

  it("platformFileSystem exposes a BINARY_CONTENT native task + a web stub (OTA-safe, no new native module)", () => {
    expect(NATIVE_FS).toMatch(/export const createBinaryUploadTask/);
    expect(NATIVE_FS).toMatch(/FileSystemUploadType\.BINARY_CONTENT/);
    // The native task must NOT wrap the body in multipart (raw bytes for TUS).
    expect(NATIVE_FS).not.toMatch(/createBinaryUploadTask[\s\S]*FileSystemUploadType\.MULTIPART/);
    expect(WEB_FS).toMatch(/export const createBinaryUploadTask/);
  });
});
