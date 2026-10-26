/**
 * #4114 Wave 6 — the host's event chat shows Explorer media again.
 *
 * Since #4114 Wave 4 an Explorer photo or video is stored as a private-bucket
 * PATH (`<conversation>/<client>.<ext>`), which the host panel used to put
 * straight into <Image source={{ uri }}> (broken image). The panel now signs
 * the path (cached), keeps old public URLs as they are, and never shows a
 * view-once item.
 *
 * fails-on-revert (true line deletion): delete the `message.view_once === true`
 * branch of groupChatMediaKind → the view-once case resolves to "image" and the
 * hidden-media test fails; delete the `isGroupChatStoragePath` → `cache.get`
 * branch of the resolver → stored paths resolve to null and the signing test
 * fails; delete the `peek` short-circuit in GroupChatSignedUrlCache.get → the
 * cache test sees a second sign call.
 */
import {
  GroupChatSignedUrlCache,
  createGroupChatMediaResolver,
  groupChatMediaKind,
  isGroupChatDirectUrl,
  isGroupChatStoragePath,
} from "../groupChatMedia";

const PATH = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/7d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.jpg";
const ONCE = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/once/7d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.jpg";
const PUBLIC = "https://example.supabase.co/storage/v1/object/public/messages/conv/u_1.jpg";

describe("#4114 W6 host event chat media", () => {
  it("tells a private-bucket path from an old public URL", () => {
    expect(isGroupChatStoragePath(PATH)).toBe(true);
    expect(isGroupChatStoragePath(PUBLIC)).toBe(false);
    expect(isGroupChatDirectUrl(PUBLIC)).toBe(true);
    expect(isGroupChatDirectUrl(PATH)).toBe(false);
  });

  it("never shows view-once media: it is text only", () => {
    expect(groupChatMediaKind({ message_type: "image", file_url: ONCE, view_once: true })).toBe("view_once_photo");
    expect(groupChatMediaKind({ message_type: "video", file_url: ONCE, view_once: true })).toBe("view_once_video");
    expect(groupChatMediaKind({ message_type: "image", file_url: PATH, view_once: false })).toBe("image");
    expect(groupChatMediaKind({ message_type: "video", file_url: PATH })).toBe("video");
    expect(groupChatMediaKind({ message_type: "text", file_url: null })).toBe("none");
  });

  it("signs a stored path, caches it, and passes an old public URL through", async () => {
    const sign = jest.fn(async (path: string, seconds: number) => `https://signed.test/${path}?ttl=${seconds}`);
    let now = 1_000_000;
    const resolver = createGroupChatMediaResolver(new GroupChatSignedUrlCache(sign, () => now));

    await expect(resolver.resolve(PATH)).resolves.toBe(`https://signed.test/${PATH}?ttl=3600`);
    await expect(resolver.resolve(PATH)).resolves.toBe(`https://signed.test/${PATH}?ttl=3600`);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(resolver.peek(PATH)).toBe(`https://signed.test/${PATH}?ttl=3600`);

    await expect(resolver.resolve(PUBLIC)).resolves.toBe(PUBLIC);
    expect(sign).toHaveBeenCalledTimes(1);
    await expect(resolver.resolve("not a path")).resolves.toBeNull();

    // Near expiry the link is signed again.
    now += 3600 * 1000;
    await resolver.resolve(PATH);
    expect(sign).toHaveBeenCalledTimes(2);
  });
});
