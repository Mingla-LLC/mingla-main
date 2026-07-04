import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import {
  normalizeLocalFileUri,
  resolveRawClipUploadUri,
} from "../coverPickerVideoTrimUpload";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// ORCH-1303 [web cover VIDEO upload — mangled blob URL] regression.
//
// ROOT CAUSE: on business WEB the raw-clip branch of `pickVideoCover`
// (CoverPicker.tsx) ran `normalizeLocalFileUri(asset.uri)` on the picker's
// browser object URL (`blob:https://…`). That prefixes `file://`, producing
// `file://blob:https://…`, which the web TUS upload's `fetch(input.uri)`
// rejects ("Failed to fetch") — so a web video cover never uploaded. IMAGE
// worked (its uri was passed unmangled). NATIVE worked (real file paths).
//
// FIX: `resolveRawClipUploadUri(assetUri, isWeb)` — on web pass the blob uri
// through UNMANGLED; on native still normalize the real file path. The call
// site passes `Platform.OS === "web"`.
describe("ORCH-1303 web raw-clip cover video uri is not file://-mangled", () => {
  const WEB_BLOB_URI = "blob:https://business.usemingla.com/2f0c-4b21-uuid";
  const NATIVE_BARE_PATH = "/var/mobile/Containers/Data/tmp/clip.mp4";
  const NATIVE_FILE_URI = "file:///var/mobile/Containers/Data/tmp/clip.mp4";

  test("T-1303-01 WEB: a blob object URL passes through UNMANGLED (no file:// prefix)", () => {
    const resolved = resolveRawClipUploadUri(WEB_BLOB_URI, true);

    expect(resolved).toBe(WEB_BLOB_URI);
    // The exact regression: the corrupt `file://blob:…` must never be produced.
    expect(resolved.startsWith("file://")).toBe(false);
    expect(resolved).not.toContain("file://blob:");
  });

  test("T-1303-02 WEB blob URL stays fetch-scheme-valid (blob:, not file:)", () => {
    const resolved = resolveRawClipUploadUri(WEB_BLOB_URI, true);
    expect(resolved.startsWith("blob:")).toBe(true);
  });

  test("T-1303-03 NATIVE: a bare filesystem path is still normalized to file:// (unchanged)", () => {
    const resolved = resolveRawClipUploadUri(NATIVE_BARE_PATH, false);

    expect(resolved).toBe(NATIVE_FILE_URI);
    // Native byte-identical to the pre-fix behaviour (normalizeLocalFileUri).
    expect(resolved).toBe(normalizeLocalFileUri(NATIVE_BARE_PATH));
  });

  test("T-1303-04 NATIVE: an already-file:// path is left untouched", () => {
    expect(resolveRawClipUploadUri(NATIVE_FILE_URI, false)).toBe(NATIVE_FILE_URI);
  });

  // Source-level lock on the call site so a future edit can't quietly revert
  // to the unconditional mangle (also enforced by the strict-grep gate).
  test("T-1303-05 CoverPicker raw-clip branch calls resolveRawClipUploadUri with the web flag, never the unconditional mangle", () => {
    const picker = repoFile("src/components/ui/CoverPicker.tsx");

    expect(picker).toContain(
      'resolveRawClipUploadUri(asset.uri, Platform.OS === "web")',
    );
    // The pre-ORCH-1303 mangling call site must be gone.
    expect(picker).not.toContain("uri: normalizeLocalFileUri(asset.uri)");
  });
});
