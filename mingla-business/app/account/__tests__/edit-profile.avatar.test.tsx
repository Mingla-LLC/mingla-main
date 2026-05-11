import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const profileSource = (): string =>
  readFileSync(path.join(process.cwd(), "app/account/edit-profile.tsx"), "utf8");

const serviceSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/services/creatorAvatarService.ts"),
    "utf8",
  );

describe("edit-profile avatar upload contract", () => {
  test("T-18 Image onError flips to the initials fallback and shows retry copy", () => {
    const text = profileSource();

    expect(text).toContain("avatarLoadFailed");
    expect(text).toContain("onError={() =>");
    expect(text).toContain("setAvatarLoadFailed(true)");
    expect(text).toContain("Couldn't show your photo. Tap the avatar to retry.");
    expect(text).toContain("<Text style={styles.avatarInitials}>{initials}</Text>");
  });

  test("T-19 saved avatar_url stays canonical after upload", () => {
    const text = profileSource();

    expect(text).toContain("const { publicUrl } = await uploadCreatorAvatar");
    expect(text).toContain("setPhotoUri(publicUrl)");
    expect(text).toContain("avatar_url: photoUri");
    expect(text).not.toContain("setPhotoUri(`${publicUrlData.publicUrl}?t=");
  });

  test("T-20 render-time cache-bust is isolated to the Image source", () => {
    const text = profileSource();

    expect(text).toContain("avatarRenderToken");
    expect(text).toContain("avatarImageSource");
    expect(text).toContain('photoUri.includes("?") ? "&" : "?"');
    expect(text).toContain("t=${avatarRenderToken}");
    expect(text).not.toMatch(/updateAccount\(\{[\s\S]*avatar_url:\s*`[^`]*\?t=/);
  });

  test("T-21 empty-byte upload failures keep prior photo state and show reader copy", () => {
    const text = profileSource();
    const serviceText = serviceSource();

    expect(text).toContain("err instanceof CreatorAvatarError");
    expect(text).toContain("showToast(err.message)");
    expect(serviceText).toContain("We couldn't read that photo. Try another.");
    expect(text).not.toContain("fetch(asset.uri)");
    expect(text).not.toContain("response.blob()");
  });
});
