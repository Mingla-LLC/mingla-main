import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoFile = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

describe("ORCH-1097 browser picker component contracts", () => {
  // [TEST-MOD-APPROVED #2715] Wildcard video/* admitted unsupported costly
  // inputs; SC-5 requires exact supported formats while phone web stays enabled.
  test("browser image/GIF and video selections use deterministic phone/desktop parity and exact supported formats", () => {
    const deviceMedia = stripComments(repoFile("src/components/ui/coverPickerDeviceMedia.ts"));
    const picker = stripComments(repoFile("src/components/ui/CoverPicker.tsx"));

    expect(deviceMedia).toContain("export const launchCoverImagePicker");
    expect(deviceMedia).toContain("accept: \"image/jpeg,image/png,image/webp,image/gif\"");
    expect(deviceMedia).toContain("export const launchCoverVideoPicker");
    expect(deviceMedia).toContain("accept: \"video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm\"");
    expect(deviceMedia).not.toContain("video/*");
    expect(deviceMedia).toContain("duration: await readBrowserVideoDurationMs(file.uri)");
    expect(deviceMedia).toContain("revokeCoverPickedAssets");

    // ORCH-1307: the isPhoneWeb video gate + desktop-only copy were removed —
    // mobile web now uploads video covers too. The durable browser file-picker
    // contracts (accept types, duration read, revoke) above are unchanged.
    expect(picker).not.toContain("isPhoneWeb");
    expect(picker).not.toContain(
      "Video cover uploads are available on desktop or in the app for now.",
    );
    expect(picker).toContain("video covers upload the clip as-is");
    expect(picker).toContain("revokeCoverPickedAssets(pickedAssets)");
  });

  test("brand and creator avatar web branches use browser files while native permission helpers stay native-only", () => {
    const brandAvatar = stripComments(
      repoFile("src/components/brand/BrandAvatarPickerSheet.tsx"),
    );
    const creatorAvatar = stripComments(repoFile("app/account/edit-profile.tsx"));

    expect(brandAvatar).toContain("if (Platform.OS !== \"web\")");
    expect(brandAvatar).toContain("requestMediaLibraryPermissionsAsync()");
    expect(brandAvatar).toContain("if (Platform.OS === \"web\")");
    expect(brandAvatar).toContain("pickBrowserFiles({");
    expect(brandAvatar).toContain("maxBytes: BRAND_AVATAR_MAX_BYTES");
    expect(brandAvatar).toContain("revokeBrowserPickedFiles(browserFiles)");

    expect(creatorAvatar).toContain("if (Platform.OS !== \"web\")");
    expect(creatorAvatar).toContain("photoGate.requestWithFallback()");
    expect(creatorAvatar).toContain("if (Platform.OS === \"web\")");
    expect(creatorAvatar).toContain("pickBrowserFiles({");
    expect(creatorAvatar).toContain("maxBytes: CREATOR_AVATAR_MAX_BYTES");
    expect(creatorAvatar).toContain("uploadCreatorAvatar(");
    expect(creatorAvatar).toContain("revokeBrowserPickedFiles(browserFiles)");
  });

  test("stop-photo browser multi-add respects remaining slots and skips invalid files per-file", () => {
    const source = stripComments(
      repoFile("src/components/experience/ExperienceStopPhotoSheet.tsx"),
    );

    expect(source).toContain("const remaining = Math.max(0, MAX_STOP_PHOTOS - currentCount)");
    expect(source).toContain("maxFiles: remaining");
    expect(source).toContain("multiple: remaining > 1");
    expect(source).toContain("validate: false");
    expect(source).toContain("validateBrowserFile(file.file");
    expect(source).toContain(".filter((asset): asset is NonNullable<typeof asset> => asset !== null)");
    expect(source).toContain("Some files were skipped. Use JPEG, PNG, WebP, or GIF under 8 MB.");
    expect(source).toContain("if (added >= remaining) break");
    expect(source).toContain("revokeBrowserPickedFiles(browserFiles)");
  });

  test.each([
    ["ActivitiesSnapInput", "src/components/experience/ActivitiesSnapInput.tsx", "onFilesReady"],
    ["MenuSnapInput", "src/components/experience/MenuSnapInput.tsx", "onFilesReady"],
  ])("%s reads browser image/PDF files into the existing base64 callback payload", (_label, path, callbackName) => {
    const source = stripComments(repoFile(path));

    expect(source).toContain("pickBrowserFiles({");
    expect(source).toContain("readBrowserFileAsBase64(file.file)");
    expect(source).toContain("accept: \"application/pdf,.pdf\"");
    expect(source).toContain("accept: \"image/jpeg,image/png,image/webp\"");
    expect(source).toContain("capture: \"environment\"");
    expect(source).toContain(`${callbackName}([await browserFileTo`);
    expect(source).toContain("revokeBrowserPickedFiles(files)");
    expect(source).not.toContain("platformFileSystem");
    expect(source).not.toContain("expo-document-picker");
  });
});
