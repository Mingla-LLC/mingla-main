// MINGLA-INVARIANT: I-4572-BRAND-AVATAR-WEB-VERIFY-SAME-ORIGIN | issue #4572 | Host web verifies a newly uploaded public brand avatar through /_sb while persisting the canonical Supabase public URL; native/service callers remain direct.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const upload = jest.fn();
const getPublicUrl = jest.fn();
const remove = jest.fn();
const verify = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload,
        getPublicUrl,
        remove,
      })),
    },
  },
}));

jest.mock("../brandAvatarFileReader", () => ({
  readBrandAvatarFileBytes: jest.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    byteLength: 3,
  })),
}));

jest.mock("../../utils/brandAvatarRules", () => {
  const actual = jest.requireActual("../../utils/brandAvatarRules");
  return {
    ...actual,
    generateBrandAvatarPathToken: () => "token",
    verifyBrandAvatarPublicUrl: (...args: unknown[]) => verify(...args),
  };
});

import { uploadBrandAvatar } from "../brandAvatarService";

const canonical =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/brand_avatars/brand-id/token.png";
const sameOrigin =
  "/_sb/storage/v1/object/public/brand_avatars/brand-id/token.png";
const asset = {
  uri: "blob:avatar",
  mimeType: "image/png",
  fileName: "avatar.png",
  fileSize: 3,
};

describe("#4572 brand avatar verification road", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upload.mockResolvedValue({ error: null });
    getPublicUrl.mockReturnValue({ data: { publicUrl: canonical } });
    verify.mockResolvedValue(undefined);
  });

  test("web can verify through /_sb without changing the canonical returned URL", async () => {
    const result = await uploadBrandAvatar("brand-id", asset, {
      verificationUrlFor: (url) =>
        `/_sb${new URL(url).pathname}`,
    });

    expect(verify).toHaveBeenCalledWith(sameOrigin);
    expect(result.publicUrl).toBe(canonical);
  });

  test("the service default remains the canonical direct URL for native callers", async () => {
    await uploadBrandAvatar("brand-id", asset);
    expect(verify).toHaveBeenCalledWith(canonical);
  });

  test("the hook selects the same-origin converter only on Host web", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/hooks/useBrandAvatarUpload.ts",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /Platform\.OS === "web" \? toSameOriginStorage : undefined/,
    );
  });
});
